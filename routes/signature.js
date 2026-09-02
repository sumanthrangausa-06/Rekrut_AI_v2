/**
 * E-Signature Engine Routes
 *
 * REST API for digital signature document lifecycle.
 * All endpoints require authentication.
 *
 * Endpoints:
 *   POST   /api/signatures/documents           — Create a new signature document
 *   GET    /api/signatures/documents           — List company documents
 *   GET    /api/signatures/documents/:id       — Get document with signers
 *   DELETE /api/signatures/documents/:id       — Cancel a document
 *   POST   /api/signatures/documents/:id/send  — Send document to signers
 *   POST   /api/signatures/documents/:id/signers — Add signers to a document
 *
 *   POST   /api/signatures/requests/:id/view   — Record document view
 *   POST   /api/signatures/requests/:id/sign   — Submit signature
 *   POST   /api/signatures/requests/:id/decline — Decline to sign
 *
 *   GET    /api/signatures/documents/:id/audit — Get full audit trail
 *   POST   /api/signatures/documents/:id/verify — Verify document integrity
 *
 * @module routes/signature
 */

const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const signatureService = require('../server/services/signatureService');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function requireCompanyAccess(req, res, next) {
	if (!req.user?.company_id && req.user?.role !== 'admin') {
		return res.status(403).json({ error: 'Company access required', code: 'NO_COMPANY' });
	}
	next();
}

async function verifyDocumentOwnership(req, res, next) {
	const { id } = req.params;
	const userId = req.user.id;
	const companyId = req.user.company_id;
	const role = req.user.role;

	try {
		const result = await pool.query(
			`SELECT company_id, created_by FROM signature_documents WHERE id = $1`,
			[id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
		}

		const doc = result.rows[0];

		// Admin can access anything
		if (role === 'admin') {
			req.document = doc;
			return next();
		}

		// Company users can access their company's documents
		if (companyId && doc.company_id === companyId) {
			req.document = doc;
			return next();
		}

		// Document creator can access
		if (doc.created_by === userId) {
			req.document = doc;
			return next();
		}

		return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
	} catch (err) {
		console.error('[signature] Ownership check error:', err);
		return res.status(500).json({ error: 'Server error' });
	}
}

async function verifySignerAccess(req, res, next) {
	const { id } = req.params;
	const userId = req.user?.id;
	const userEmail = req.user?.email;

	try {
		const result = await pool.query(
			`
			SELECT sr.*, sp.email as party_email, sd.company_id
			FROM signature_requests sr
			JOIN signing_parties sp ON sr.party_id = sp.id
			JOIN signature_documents sd ON sr.document_id = sd.id
			WHERE sr.id = $1
			`,
			[id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Signature request not found', code: 'NOT_FOUND' });
		}

		const request = result.rows[0];

		// Signer matches by user_id or email
		const isSigner =
			(request.party_email &&
				request.party_email.toLowerCase() === (userEmail || '').toLowerCase()) ||
			false;

		// Company admin/recruiter can also manage
		const isCompanyUser = req.user?.company_id && req.user.company_id === request.company_id;
		const isAdmin = req.user?.role === 'admin';

		if (!isSigner && !isCompanyUser && !isAdmin) {
			return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
		}

		req.signatureRequest = request;
		next();
	} catch (err) {
		console.error('[signature] Signer access check error:', err);
		return res.status(500).json({ error: 'Server error' });
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Document Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/signatures/documents
 * Create a new signature document.
 *
 * Body: { title, description?, document_type?, file_url?, file_size?, mime_type?,
 *         original_filename?, document_content (base64), signature_type?,
 *         legal_jurisdiction?, compliance_framework?, expires_at?, metadata? }
 */
router.post('/documents', authMiddleware, requireCompanyAccess, async (req, res) => {
	try {
		const {
			title,
			description,
			document_type,
			file_url,
			file_size,
			mime_type,
			original_filename,
			document_content, // base64-encoded
			signature_type,
			legal_jurisdiction,
			compliance_framework,
			expires_at,
			metadata,
		} = req.body;

		if (!title) {
			return res.status(400).json({ error: 'Title is required', code: 'MISSING_TITLE' });
		}

		// Decode base64 content for hashing
		let contentBuffer = null;
		if (document_content) {
			try {
				contentBuffer = Buffer.from(document_content, 'base64');
			} catch {
				return res.status(400).json({
					error: 'Invalid base64 document_content',
					code: 'INVALID_BASE64',
				});
			}
		}

		const result = await signatureService.createDocument({
			companyId: req.user.company_id,
			createdBy: req.user.id,
			title,
			description,
			documentType: document_type,
			fileUrl: file_url,
			fileSize: file_size,
			mimeType: mime_type,
			originalFilename: original_filename,
			documentContent: contentBuffer || Buffer.from(title, 'utf8'), // fallback hash
			signatureType: signature_type,
			legalJurisdiction: legal_jurisdiction,
			complianceFramework: compliance_framework,
			expiresAt: expires_at ? new Date(expires_at) : undefined,
			metadata,
		});

		res.status(201).json({
			success: true,
			document: result.document,
			hashRecord: result.hashRecord,
		});
	} catch (error) {
		console.error('[signature] Create document error:', error);
		res.status(500).json({ error: 'Failed to create document', code: 'CREATE_FAILED' });
	}
});

/**
 * GET /api/signatures/documents
 * List signature documents for the company.
 *
 * Query: ?status=&limit=&offset=
 */
router.get('/documents', authMiddleware, requireCompanyAccess, async (req, res) => {
	try {
		const { status, limit, offset } = req.query;

		const result = await signatureService.listDocuments(req.user.company_id, {
			status,
			limit: limit ? parseInt(limit, 10) : undefined,
			offset: offset ? parseInt(offset, 10) : undefined,
		});

		res.json({
			success: true,
			...result,
		});
	} catch (error) {
		console.error('[signature] List documents error:', error);
		res.status(500).json({ error: 'Failed to list documents', code: 'LIST_FAILED' });
	}
});

/**
 * GET /api/signatures/documents/:id
 * Get a single document with all signers and their status.
 */
router.get('/documents/:id', authMiddleware, verifyDocumentOwnership, async (req, res) => {
	try {
		const { id } = req.params;
		const document = await signatureService.getDocumentWithParties(parseInt(id, 10));

		if (!document) {
			return res.status(404).json({ error: 'Document not found', code: 'NOT_FOUND' });
		}

		res.json({
			success: true,
			document,
		});
	} catch (error) {
		console.error('[signature] Get document error:', error);
		res.status(500).json({ error: 'Failed to get document', code: 'GET_FAILED' });
	}
});

/**
 * DELETE /api/signatures/documents/:id
 * Cancel a document.
 */
router.delete('/documents/:id', authMiddleware, verifyDocumentOwnership, async (req, res) => {
	try {
		const { id } = req.params;
		const { reason } = req.body;

		const document = await signatureService.cancelDocument(parseInt(id, 10), req.user.id, reason);

		res.json({
			success: true,
			document,
			message: 'Document cancelled successfully',
		});
	} catch (error) {
		console.error('[signature] Cancel document error:', error);
		const statusCode = error.message.includes('not found')
			? 404
			: error.message.includes('Cannot cancel')
				? 409
				: 500;
		res.status(statusCode).json({
			error: error.message,
			code: statusCode === 409 ? 'CONFLICT' : 'CANCEL_FAILED',
		});
	}
});

/**
 * POST /api/signatures/documents/:id/signers
 * Add signing parties to a document.
 *
 * Body: { parties: [{ email, full_name, phone?, job_title?, party_role?, auth_method?, signing_order? }] }
 */
router.post('/documents/:id/signers', authMiddleware, verifyDocumentOwnership, async (req, res) => {
	try {
		const { id } = req.params;
		const { parties } = req.body;

		if (!Array.isArray(parties) || parties.length === 0) {
			return res.status(400).json({ error: 'Parties array required', code: 'MISSING_PARTIES' });
		}

		// Create parties and build signer list
		const signerList = [];
		for (const party of parties) {
			if (!party.email || !party.full_name) {
				return res.status(400).json({
					error: 'Each party requires email and full_name',
					code: 'INVALID_PARTY',
				});
			}

			const createdParty = await signatureService.createParty({
				email: party.email,
				fullName: party.full_name,
				phone: party.phone,
				companyId: req.user.company_id,
				jobTitle: party.job_title,
				partyRole: party.party_role || 'signer',
				authMethod: party.auth_method || 'email_link',
			});

			signerList.push({
				partyId: createdParty.id,
				signingOrder: party.signing_order || 0,
			});
		}

		const result = await signatureService.addSigners(parseInt(id, 10), signerList, req.user.id);

		res.json({
			success: true,
			requests: result.requests,
			document: result.document,
		});
	} catch (error) {
		console.error('[signature] Add signers error:', error);
		const statusCode = error.message.includes('draft') ? 409 : 500;
		res.status(statusCode).json({
			error: error.message,
			code: statusCode === 409 ? 'CONFLICT' : 'ADD_SIGNERS_FAILED',
		});
	}
});

/**
 * POST /api/signatures/documents/:id/send
 * Send the document to signers (move from draft -> sent).
 */
router.post('/documents/:id/send', authMiddleware, verifyDocumentOwnership, async (req, res) => {
	try {
		const { id } = req.params;
		const document = await signatureService.sendDocument(parseInt(id, 10), req.user.id);

		res.json({
			success: true,
			document,
			message: 'Document sent to signers',
		});
	} catch (error) {
		console.error('[signature] Send document error:', error);
		const statusCode = error.message.includes('draft') ? 409 : 500;
		res.status(statusCode).json({
			error: error.message,
			code: statusCode === 409 ? 'CONFLICT' : 'SEND_FAILED',
		});
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Signer Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/signatures/requests/:id/view
 * Record that a signer viewed the document.
 */
router.post('/requests/:id/view', authMiddleware, verifySignerAccess, async (req, res) => {
	try {
		const { id } = req.params;
		const request = await signatureService.recordView(
			parseInt(id, 10),
			req.ip,
			req.get('user-agent'),
		);

		res.json({
			success: true,
			request,
		});
	} catch (error) {
		console.error('[signature] Record view error:', error);
		res.status(500).json({ error: 'Failed to record view', code: 'VIEW_FAILED' });
	}
});

/**
 * POST /api/signatures/requests/:id/sign
 * Submit a signature.
 *
 * Body: { signature_type?, signature_value? (base64), document_content? (base64),
 *         signature_metadata?: { ip_address?, user_agent?, geo_location?, device_fingerprint?, actor_id? } }
 */
router.post('/requests/:id/sign', authMiddleware, verifySignerAccess, async (req, res) => {
	try {
		const { id } = req.params;
		const { signature_type, signature_value, document_content, signature_metadata = {} } = req.body;

		// Decode base64 content if provided (for tamper check)
		let contentBuffer = null;
		if (document_content) {
			try {
				contentBuffer = Buffer.from(document_content, 'base64');
			} catch {
				return res.status(400).json({
					error: 'Invalid base64 document_content',
					code: 'INVALID_BASE64',
				});
			}
		}

		// Build metadata
		const meta = {
			ip_address: signature_metadata.ip_address || req.ip,
			user_agent: signature_metadata.user_agent || req.get('user-agent'),
			geo_location: signature_metadata.geo_location || null,
			device_fingerprint: signature_metadata.device_fingerprint || null,
			actor_id: req.user?.id || signature_metadata.actor_id || null,
		};

		const result = await signatureService.recordSignature(parseInt(id, 10), {
			signatureType: signature_type,
			signatureValue: signature_value,
			documentContent: contentBuffer,
			signatureMetadata: meta,
		});

		res.json({
			success: true,
			request: result.request,
			hashRecord: result.hashRecord,
			message: 'Signature recorded successfully',
		});
	} catch (error) {
		console.error('[signature] Record signature error:', error);
		const statusCode = error.message.includes('already')
			? 409
			: error.message.includes('not found')
				? 404
				: 500;
		res.status(statusCode).json({
			error: error.message,
			code: statusCode === 409 ? 'CONFLICT' : statusCode === 404 ? 'NOT_FOUND' : 'SIGN_FAILED',
		});
	}
});

/**
 * POST /api/signatures/requests/:id/decline
 * Decline to sign.
 *
 * Body: { reason? }
 */
router.post('/requests/:id/decline', authMiddleware, verifySignerAccess, async (req, res) => {
	try {
		const { id } = req.params;
		const { reason } = req.body;

		const meta = {
			ip_address: req.ip,
			user_agent: req.get('user-agent'),
			actor_id: req.user?.id || null,
		};

		const request = await signatureService.recordDecline(parseInt(id, 10), reason, meta);

		res.json({
			success: true,
			request,
			message: 'Signature declined',
		});
	} catch (error) {
		console.error('[signature] Decline error:', error);
		res.status(500).json({ error: 'Failed to record decline', code: 'DECLINE_FAILED' });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit & Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/signatures/documents/:id/audit
 * Get the full audit trail for a document.
 */
router.get('/documents/:id/audit', authMiddleware, verifyDocumentOwnership, async (req, res) => {
	try {
		const { id } = req.params;
		const { event_type, limit, offset } = req.query;

		const result = await signatureService.getAuditTrail(parseInt(id, 10), {
			eventType: event_type,
			limit: limit ? parseInt(limit, 10) : undefined,
			offset: offset ? parseInt(offset, 10) : undefined,
		});

		res.json({
			success: true,
			...result,
		});
	} catch (error) {
		console.error('[signature] Get audit trail error:', error);
		res.status(500).json({ error: 'Failed to get audit trail', code: 'AUDIT_FAILED' });
	}
});

/**
 * POST /api/signatures/documents/:id/verify
 * Verify document integrity (hash chain + signatures).
 *
 * Body: { document_content? (base64) }
 */
router.post('/documents/:id/verify', authMiddleware, verifyDocumentOwnership, async (req, res) => {
	try {
		const { id } = req.params;
		const { document_content } = req.body;

		let contentBuffer = null;
		if (document_content) {
			try {
				contentBuffer = Buffer.from(document_content, 'base64');
			} catch {
				return res.status(400).json({
					error: 'Invalid base64 document_content',
					code: 'INVALID_BASE64',
				});
			}
		}

		const result = await signatureService.verifyDocumentIntegrity(parseInt(id, 10), contentBuffer);

		// Also verify the audit chain
		const auditResult = await signatureService.verifyAuditChain(parseInt(id, 10));

		res.json({
			success: true,
			integrity: {
				documentValid: result.documentValid,
				chainValid: result.chainValid,
				signaturesValid: result.signaturesValid,
				auditChainValid: auditResult.valid,
			},
			details: result.details,
			auditErrors: auditResult.errors,
		});
	} catch (error) {
		console.error('[signature] Verify error:', error);
		res.status(500).json({ error: 'Verification failed', code: 'VERIFY_FAILED' });
	}
});

/**
 * POST /api/signatures/documents/:id/verify-audit
 * Verify only the audit chain integrity.
 */
router.post(
	'/documents/:id/verify-audit',
	authMiddleware,
	verifyDocumentOwnership,
	async (req, res) => {
		try {
			const { id } = req.params;
			const result = await signatureService.verifyAuditChain(parseInt(id, 10));

			res.json({
				success: true,
				valid: result.valid,
				errors: result.errors,
			});
		} catch (error) {
			console.error('[signature] Verify audit error:', error);
			res.status(500).json({ error: 'Audit verification failed', code: 'AUDIT_VERIFY_FAILED' });
		}
	},
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin / System Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/signatures/admin/expire
 * Trigger expiration check (admin only).
 */
router.post('/admin/expire', authMiddleware, requireRole('admin'), async (_req, res) => {
	try {
		const count = await signatureService.expireDocuments();
		res.json({
			success: true,
			expired_count: count,
			message: `${count} document(s) expired`,
		});
	} catch (error) {
		console.error('[signature] Expire error:', error);
		res.status(500).json({ error: 'Expiration check failed', code: 'EXPIRE_FAILED' });
	}
});

/**
 * GET /api/signatures/admin/stats
 * Get e-signature platform stats (admin only).
 */
router.get('/admin/stats', authMiddleware, requireRole('admin'), async (_req, res) => {
	try {
		const stats = await pool.query(`
			SELECT
				(SELECT COUNT(*) FROM signature_documents) as total_documents,
				(SELECT COUNT(*) FROM signature_documents WHERE status = 'completed') as completed_documents,
				(SELECT COUNT(*) FROM signature_documents WHERE status = 'in_progress') as in_progress_documents,
				(SELECT COUNT(*) FROM signature_documents WHERE status = 'draft') as draft_documents,
				(SELECT COUNT(*) FROM signature_documents WHERE status = 'expired') as expired_documents,
				(SELECT COUNT(*) FROM signature_documents WHERE status = 'cancelled') as cancelled_documents,
				(SELECT COUNT(*) FROM signature_requests WHERE status = 'signed') as total_signatures,
				(SELECT COUNT(*) FROM signature_requests WHERE status = 'declined') as declined_signatures,
				(SELECT COUNT(*) FROM signing_parties) as total_parties,
				(SELECT COUNT(*) FROM signature_audit_events) as total_audit_events
		`);

		res.json({
			success: true,
			stats: stats.rows[0],
		});
	} catch (error) {
		console.error('[signature] Stats error:', error);
		res.status(500).json({ error: 'Failed to get stats', code: 'STATS_FAILED' });
	}
});

module.exports = router;
