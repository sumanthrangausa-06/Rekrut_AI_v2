/**
 * Identity Verification Routes — Issue #135
 * Aadhaar/PAN verification for India market
 *
 * Security:
 * - NEVER stores full Aadhaar/PAN numbers (only masked + SHA-256 hash)
 * - NEVER logs full numbers in any response
 * - Explicit consent required before any verification attempt
 * - Rate limited: 5 requests per hour per user
 *
 * Mounted at: /api/identity-verification
 */

const express = require('express');
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { AuditLogger } = require('../services/auditLogger');
const auditLogService = require('../services/auditLogService');

const router = express.Router();

// ─── Verhoeff Checksum Algorithm (stdlib, no external lib) ────────────────

const VERHOEFF_D = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
	[2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
	[3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
	[4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
	[5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
	[6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
	[7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
	[8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
	[9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
	[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	[1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
	[5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
	[8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
	[9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
	[4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
	[2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
	[7, 0, 4, 6, 9, 1, 3, 5, 2, 8],
];

function validateAadhaar(aadhaarNumber) {
	if (!aadhaarNumber || typeof aadhaarNumber !== 'string') return false;
	const clean = aadhaarNumber.replace(/\s/g, '');
	if (!/^\d{12}$/.test(clean)) return false;

	let c = 0;
	const digits = clean.split('').reverse().map(Number);
	for (let i = 0; i < digits.length; i++) {
		c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
	}
	return c === 0;
}

function maskAadhaar(aadhaarNumber) {
	const clean = aadhaarNumber.replace(/\s/g, '');
	return `XXXX-XXXX-${clean.slice(-4)}`;
}

function hashIdentity(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

// ─── PAN Helpers ──────────────────────────────────────────────────────────

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

function validatePan(panNumber) {
	return PAN_REGEX.test(panNumber);
}

function maskPan(panNumber) {
	return `XXXXX${panNumber.slice(5, 9)}X`;
}

// ─── Rate Limiter (in-memory, per user, 5 req/hour) ───────────────────────
// ponytail: simple in-memory Map. Upgrade to Redis if multi-instance.

const rateLimitMap = new Map(); // userId -> { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(userId) {
	const now = Date.now();
	const entry = rateLimitMap.get(userId);
	if (!entry || now > entry.resetAt) {
		rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
		return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
	}
	if (entry.count >= RATE_LIMIT_MAX) {
		return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
	}
	entry.count += 1;
	return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

function rateLimitMiddleware(req, res, next) {
	const check = checkRateLimit(req.user.id);
	if (!check.allowed) {
		return res.status(429).json({
			error: 'Rate limit exceeded',
			retryAfter: check.retryAfter,
			limit: RATE_LIMIT_MAX,
			window: '1 hour',
		});
	}
	next();
}

// ─── Audit Logging Helpers ────────────────────────────────────────────────

async function logIdentityAudit(userId, action, metadata, req) {
	try {
		await AuditLogger.log({
			actionType: `identity_${action}`,
			userId,
			targetType: 'identity_verification',
			targetId: userId,
			metadata,
			req,
		});
	} catch (e) {
		console.error('[identity-verification] AuditLogger failed (non-blocking):', e.message);
	}
}

async function logComplianceAudit(userId, action, payload, req) {
	try {
		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.VERIFICATION,
			entityType: auditLogService.ENTITY_TYPES.USER,
			entityId: userId,
			actorId: userId,
			actorRole: req.user?.role,
			payload: { action, ...payload },
			req,
		});
	} catch (e) {
		console.error('[identity-verification] Compliance audit failed (non-blocking):', e.message);
	}
}

// ─── 1. POST /aadhaar/validate ────────────────────────────────────────────
// Client-side helper, also server-side validation

router.post('/aadhaar/validate', authMiddleware, async (req, res) => {
	try {
		const { aadhaarNumber } = req.body;
		if (!aadhaarNumber || typeof aadhaarNumber !== 'string') {
			return res.status(400).json({ error: 'aadhaarNumber is required' });
		}

		const valid = validateAadhaar(aadhaarNumber);
		const masked = valid ? maskAadhaar(aadhaarNumber) : null;

		// Audit: log validation attempt (never log full number)
		await logIdentityAudit(req.user.id, 'aadhaar_validate', { valid }, req);

		res.json({ valid, masked });
	} catch (err) {
		console.error('[identity/aadhaar/validate] Error:', err.message);
		res.status(500).json({ error: 'Failed to validate Aadhaar' });
	}
});

// ─── 2. POST /aadhaar/initiate-otp ────────────────────────────────────────

router.post('/aadhaar/initiate-otp', authMiddleware, rateLimitMiddleware, async (req, res) => {
	try {
		const { aadhaarNumber, consent } = req.body;

		// Consent MUST be explicit
		if (consent !== true) {
			return res.status(400).json({ error: 'Explicit consent is required', code: 'CONSENT_REQUIRED' });
		}

		if (!aadhaarNumber || typeof aadhaarNumber !== 'string') {
			return res.status(400).json({ error: 'aadhaarNumber is required' });
		}

		// Validate Aadhaar format + checksum
		if (!validateAadhaar(aadhaarNumber)) {
			return res.status(400).json({ error: 'Invalid Aadhaar number', code: 'INVALID_AADHAAR' });
		}

		const clean = aadhaarNumber.replace(/\s/g, '');
		const masked = maskAadhaar(clean);
		const hash = hashIdentity(clean);

		// Check if already verified for this user
		const existing = await pool.query(
			`SELECT id, status FROM identity_verifications
       WHERE user_id = $1 AND type = 'aadhaar' AND status = 'verified'
       LIMIT 1`,
			[req.user.id],
		);
		if (existing.rows.length > 0) {
			return res.status(409).json({ error: 'Aadhaar already verified', code: 'ALREADY_VERIFIED' });
		}

		// Upsert: mark any existing non-failed as failed, then insert new otp_sent
		await pool.query(
			`UPDATE identity_verifications
       SET status = 'failed', updated_at = NOW()
       WHERE user_id = $1 AND type = 'aadhaar' AND status != 'failed'`,
			[req.user.id],
		);

		const result = await pool.query(
			`INSERT INTO identity_verifications
       (user_id, type, status, masked_value, hash, consent_given, consent_at, metadata, created_at, updated_at)
       VALUES ($1, 'aadhaar', 'otp_sent', $2, $3, true, NOW(), $4, NOW(), NOW())
       RETURNING id`,
			[req.user.id, masked, hash, JSON.stringify({ initiated_via: 'otp' })],
		);

		// ponytail: Stub UIDAI API call — real integration needs legal review + API keys
		// TODO: Integrate with UIDAI Aadhaar OTP API (requires legal review, API keys, MOU)
		console.log(`[identity-verification] UIDAI OTP stub: OTP would be sent to registered mobile for hash ${hash.slice(0, 8)}...`);

		await logIdentityAudit(req.user.id, 'aadhaar_otp_initiated', { verification_id: result.rows[0].id, masked }, req);
		await logComplianceAudit(req.user.id, 'aadhaar_otp_initiated', { masked, verification_id: result.rows[0].id }, req);

		res.json({ success: true, message: 'OTP sent to registered mobile' });
	} catch (err) {
		console.error('[identity/aadhaar/initiate-otp] Error:', err.message);
		res.status(500).json({ error: 'Failed to initiate OTP' });
	}
});

// ─── 3. POST /aadhaar/verify-otp ──────────────────────────────────────────

router.post('/aadhaar/verify-otp', authMiddleware, rateLimitMiddleware, async (req, res) => {
	try {
		const { aadhaarHash, otp } = req.body;

		if (!aadhaarHash || typeof aadhaarHash !== 'string') {
			return res.status(400).json({ error: 'aadhaarHash is required' });
		}
		if (!otp || typeof otp !== 'string') {
			return res.status(400).json({ error: 'otp is required' });
		}

		// Look up by hash, check status = otp_sent
		const lookup = await pool.query(
			`SELECT id, user_id, status, masked_value, consent_given
       FROM identity_verifications
       WHERE hash = $1 AND type = 'aadhaar'
       ORDER BY created_at DESC
       LIMIT 1`,
			[aadhaarHash],
		);

		if (lookup.rows.length === 0) {
			return res.status(404).json({ error: 'Verification not found', code: 'NOT_FOUND' });
		}

		const record = lookup.rows[0];

		// Authorization: user can only verify their own
		if (record.user_id !== req.user.id) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Consent check
		if (!record.consent_given) {
			return res.status(403).json({ error: 'Consent not given', code: 'CONSENT_REQUIRED' });
		}

		if (record.status !== 'otp_sent') {
			return res.status(400).json({ error: 'OTP not initiated or already processed', code: 'INVALID_STATE' });
		}

		// ponytail: Stub OTP validation — always accept "123456" for demo
		// TODO: Integrate with UIDAI OTP verify API (requires legal review + API keys)
		const verified = otp === '123456';
		const newStatus = verified ? 'verified' : 'failed';

		await pool.query(
			`UPDATE identity_verifications
       SET status = $2, updated_at = NOW(),
           metadata = metadata || $3
       WHERE id = $1`,
			[record.id, newStatus, JSON.stringify({ verified_at: verified ? new Date().toISOString() : null, otp_attempted: true })],
		);

		await logIdentityAudit(req.user.id, `aadhaar_otp_${newStatus}`, { verification_id: record.id, masked: record.masked_value }, req);
		await logComplianceAudit(req.user.id, `aadhaar_otp_${newStatus}`, { verification_id: record.id, masked: record.masked_value }, req);

		res.json({ success: true, verified });
	} catch (err) {
		console.error('[identity/aadhaar/verify-otp] Error:', err.message);
		res.status(500).json({ error: 'Failed to verify OTP' });
	}
});

// ─── 4. POST /aadhaar/offline-xml ─────────────────────────────────────────

router.post('/aadhaar/offline-xml', authMiddleware, rateLimitMiddleware, async (req, res) => {
	try {
		const { xmlData, consent } = req.body;

		if (consent !== true) {
			return res.status(400).json({ error: 'Explicit consent is required', code: 'CONSENT_REQUIRED' });
		}
		if (!xmlData || typeof xmlData !== 'string') {
			return res.status(400).json({ error: 'xmlData is required' });
		}

		// Parse XML using native string extraction (no external XML lib installed)
		// Aadhaar offline XML contains attributes: name, uid (masked), dob, gender, etc.
		const nameMatch = xmlData.match(/name="([^"]*)"/);
		const uidMatch = xmlData.match(/uid="([^"]*)"/);
		const name = nameMatch ? nameMatch[1] : null;
		const maskedAadhaar = uidMatch ? uidMatch[1] : null;

		if (!maskedAadhaar) {
			return res.status(400).json({ error: 'Invalid Aadhaar XML: uid not found', code: 'INVALID_XML' });
		}

		// ponytail: Stub XML signature verification
		// TODO: Implement real XML signature verification using UIDAI public key
		console.log('[identity-verification] XML signature verification stub — always passing for demo');

		// Derive a synthetic hash from the masked Aadhaar for storage
		// In production, the XML contains the full Aadhaar number; here we hash the masked
		// TODO: Extract full Aadhaar from signed XML and hash that instead
		const hash = hashIdentity(maskedAadhaar);

		// Check if already verified
		const existing = await pool.query(
			`SELECT id FROM identity_verifications
       WHERE user_id = $1 AND type = 'aadhaar' AND status = 'verified'
       LIMIT 1`,
			[req.user.id],
		);
		if (existing.rows.length > 0) {
			return res.status(409).json({ error: 'Aadhaar already verified', code: 'ALREADY_VERIFIED' });
		}

		await pool.query(
			`UPDATE identity_verifications
       SET status = 'failed', updated_at = NOW()
       WHERE user_id = $1 AND type = 'aadhaar' AND status != 'failed'`,
			[req.user.id],
		);

		const result = await pool.query(
			`INSERT INTO identity_verifications
       (user_id, type, status, masked_value, hash, consent_given, consent_at, metadata, created_at, updated_at)
       VALUES ($1, 'aadhaar', 'verified', $2, $3, true, NOW(), $4, NOW(), NOW())
       RETURNING id`,
			[req.user.id, maskedAadhaar, hash, JSON.stringify({ source: 'offline_xml', name })],
		);

		await logIdentityAudit(req.user.id, 'aadhaar_offline_verified', { verification_id: result.rows[0].id, masked: maskedAadhaar, name }, req);
		await logComplianceAudit(req.user.id, 'aadhaar_offline_verified', { verification_id: result.rows[0].id, masked: maskedAadhaar, name }, req);

		res.json({ success: true, details: { name, maskedAadhaar } });
	} catch (err) {
		console.error('[identity/aadhaar/offline-xml] Error:', err.message);
		res.status(500).json({ error: 'Failed to process offline XML' });
	}
});

// ─── 5. POST /pan/verify ──────────────────────────────────────────────────

router.post('/pan/verify', authMiddleware, rateLimitMiddleware, async (req, res) => {
	try {
		const { panNumber, consent } = req.body;

		if (consent !== true) {
			return res.status(400).json({ error: 'Explicit consent is required', code: 'CONSENT_REQUIRED' });
		}
		if (!panNumber || typeof panNumber !== 'string') {
			return res.status(400).json({ error: 'panNumber is required' });
		}

		const clean = panNumber.toUpperCase().trim();
		if (!validatePan(clean)) {
			return res.status(400).json({ error: 'Invalid PAN format. Expected: ABCDE1234F', code: 'INVALID_PAN' });
		}

		const masked = maskPan(clean);
		const hash = hashIdentity(clean);

		// Check if already verified
		const existing = await pool.query(
			`SELECT id FROM identity_verifications
       WHERE user_id = $1 AND type = 'pan' AND status = 'verified'
       LIMIT 1`,
			[req.user.id],
		);
		if (existing.rows.length > 0) {
			return res.status(409).json({ error: 'PAN already verified', code: 'ALREADY_VERIFIED' });
		}

		// ponytail: Stub NSDL API call — real integration needs API keys + legal review
		// TODO: Integrate with NSDL PAN verification API
		console.log(`[identity-verification] NSDL PAN verification stub for hash ${hash.slice(0, 8)}...`);

		await pool.query(
			`UPDATE identity_verifications
       SET status = 'failed', updated_at = NOW()
       WHERE user_id = $1 AND type = 'pan' AND status != 'failed'`,
			[req.user.id],
		);

		const result = await pool.query(
			`INSERT INTO identity_verifications
       (user_id, type, status, masked_value, hash, consent_given, consent_at, metadata, created_at, updated_at)
       VALUES ($1, 'pan', 'verified', $2, $3, true, NOW(), $4, NOW(), NOW())
       RETURNING id`,
			[req.user.id, masked, hash, JSON.stringify({ source: 'nsdl_stub' })],
		);

		await logIdentityAudit(req.user.id, 'pan_verified', { verification_id: result.rows[0].id, masked }, req);
		await logComplianceAudit(req.user.id, 'pan_verified', { verification_id: result.rows[0].id, masked }, req);

		res.json({ success: true, message: 'PAN verified' });
	} catch (err) {
		console.error('[identity/pan/verify] Error:', err.message);
		res.status(500).json({ error: 'Failed to verify PAN' });
	}
});

// ─── 6. GET /status ───────────────────────────────────────────────────────

router.get('/status', authMiddleware, async (req, res) => {
	try {
		const { type } = req.query;
		const allowedTypes = ['aadhaar', 'pan'];

		let query = `
      SELECT type, status, masked_value, consent_given, consent_at,
             metadata->>'verified_at' as verified_at, created_at, updated_at
      FROM identity_verifications
      WHERE user_id = $1`;
		const params = [req.user.id];

		if (type) {
			if (!allowedTypes.includes(type)) {
				return res.status(400).json({ error: "type must be 'aadhaar' or 'pan'" });
			}
			query += ' AND type = $2';
			params.push(type);
		}

		query += ' ORDER BY created_at DESC';

		const result = await pool.query(query, params);

		await logIdentityAudit(req.user.id, 'status_viewed', { type: type || 'all', count: result.rows.length }, req);

		res.json({
			success: true,
			verifications: result.rows.map((row) => ({
				type: row.type,
				status: row.status,
				masked_value: row.masked_value,
				verified_at: row.verified_at,
				consent_given: row.consent_given,
			})),
		});
	} catch (err) {
		console.error('[identity/status] Error:', err.message);
		res.status(500).json({ error: 'Failed to get verification status' });
	}
});

// ─── 7. POST /consent ─────────────────────────────────────────────────────

router.post('/consent', authMiddleware, async (req, res) => {
	try {
		const { type, purpose, agreed } = req.body;

		if (!type || !['aadhaar', 'pan'].includes(type)) {
			return res.status(400).json({ error: "type must be 'aadhaar' or 'pan'" });
		}
		if (!purpose || typeof purpose !== 'string') {
			return res.status(400).json({ error: 'purpose is required' });
		}
		if (agreed !== true) {
			return res.status(400).json({ error: 'Consent must be explicitly agreed to', code: 'CONSENT_REQUIRED' });
		}

		// Update the most recent pending record, or create a standalone consent record
		const result = await pool.query(
			`UPDATE identity_verifications
       SET consent_given = true, consent_at = NOW(),
           metadata = metadata || $3,
           updated_at = NOW()
       WHERE user_id = $1 AND type = $2 AND status = 'pending'
       RETURNING id`,
			[req.user.id, type, JSON.stringify({ consent_purpose: purpose, consented_at: new Date().toISOString() })],
		);

		const consentId = result.rows.length > 0 ? result.rows[0].id : null;

		await logIdentityAudit(req.user.id, 'consent_recorded', { type, purpose, consentId }, req);
		await logComplianceAudit(req.user.id, 'consent_recorded', { type, purpose, consentId }, req);

		res.json({ success: true, consentId });
	} catch (err) {
		console.error('[identity/consent] Error:', err.message);
		res.status(500).json({ error: 'Failed to record consent' });
	}
});

module.exports = router;
