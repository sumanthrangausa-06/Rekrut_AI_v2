/**
 * Proctoring API Routes — Issue #120
 *
 * Core infrastructure for assessment proctoring:
 *   - Session lifecycle management
 *   - Explicit consent capture
 *   - Event logging with auto-flagging
 *   - Human review queue (never auto-reject)
 *
 * Role enforcement:
 *   - Candidate endpoints: requireRole('candidate')
 *   - Recruiter endpoints: requireRole('recruiter', 'hiring_manager', 'employer', 'admin')
 */

const express = require('express');
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const { AuditLogger } = require('../services/auditLogService');

const router = express.Router();

function _getClientIp(req) {
	const forwarded = req.headers['x-forwarded-for'];
	if (typeof forwarded === 'string' && forwarded.length > 0) {
		return forwarded.split(',')[0].trim();
	}
	return req.ip || req.socket?.remoteAddress || 'unknown';
}

// ─── Candidate: Create a new proctoring session ──────────────────────────
router.post(
	'/session',
	authMiddleware,
	requireRole('candidate'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const { application_id } = req.body;
			if (!application_id) {
				return res
					.status(400)
					.json({ error: 'application_id is required', code: 'MISSING_APPLICATION_ID' });
			}

			// Verify the application belongs to this candidate
			const appCheck = await pool.query(
				'SELECT id, candidate_id, job_id, company_id FROM job_applications WHERE id = $1 AND candidate_id = $2',
				[application_id, req.user.id],
			);
			if (appCheck.rows.length === 0) {
				return res
					.status(404)
					.json({ error: 'Application not found', code: 'APPLICATION_NOT_FOUND' });
			}

			const app = appCheck.rows[0];

			// Prevent duplicate active sessions for the same application
			const existing = await pool.query(
				`SELECT id FROM proctoring_sessions
			 WHERE application_id = $1 AND candidate_id = $2
			   AND status IN ('pending', 'consent_requested', 'in_progress')`,
				[application_id, req.user.id],
			);
			if (existing.rows.length > 0) {
				return res.status(409).json({
					error: 'An active proctoring session already exists for this application',
					code: 'SESSION_EXISTS',
					session_id: existing.rows[0].id,
				});
			}

			const result = await pool.query(
				`INSERT INTO proctoring_sessions (application_id, candidate_id, status)
			 VALUES ($1, $2, 'consent_requested')
			 RETURNING *`,
				[application_id, req.user.id],
			);

			const session = result.rows[0];

			// Audit log
			try {
				await AuditLogger.log({
					actionType: 'proctoring_session_created',
					userId: req.user.id,
					targetType: 'proctoring_session',
					targetId: session.id,
					metadata: { application_id, job_id: app.job_id, company_id: app.company_id },
					req,
				});
			} catch (e) {
				console.error('[proctoring] Audit log failed (non-blocking):', e.message);
			}

			res.status(201).json({ success: true, session });
		} catch (err) {
			console.error('[proctoring] Create session error:', err.message, err.code);
			res
				.status(500)
				.json({ error: 'Failed to create proctoring session', code: 'INTERNAL_ERROR' });
		}
	},
);

// ─── Shared: Get session with events ─────────────────────────────────────
router.get('/session/:id', authMiddleware, rateLimits.public, async (req, res) => {
	try {
		const sessionId = parseInt(req.params.id, 10);
		if (Number.isNaN(sessionId)) {
			return res.status(400).json({ error: 'Invalid session ID', code: 'INVALID_ID' });
		}

		// Fetch session with application context
		const sessionResult = await pool.query(
			`SELECT ps.*,
				u.name as candidate_name, u.email as candidate_email,
				j.title as job_title, j.user_id as job_owner_id, j.company_id
			 FROM proctoring_sessions ps
			 JOIN users u ON ps.candidate_id = u.id
			 LEFT JOIN job_applications ja ON ps.application_id = ja.id
			 LEFT JOIN jobs j ON ja.job_id = j.id
			 WHERE ps.id = $1`,
			[sessionId],
		);

		if (sessionResult.rows.length === 0) {
			return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
		}

		const session = sessionResult.rows[0];
		const user = req.user;
		const isCandidate = user.role === 'candidate';
		const isRecruiter = ['recruiter', 'hiring_manager', 'employer', 'admin'].includes(user.role);

		// Authorization: candidate must own it; recruiter must own the job or share company
		if (isCandidate && session.candidate_id !== user.id) {
			return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
		}
		if (isRecruiter) {
			// Recruiter can view if they posted the job or belong to the company
			const canView =
				session.job_owner_id === user.id ||
				session.company_id === user.company_id ||
				user.role === 'admin';
			if (!canView) {
				return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
			}
		}

		// Fetch events
		const eventsResult = await pool.query(
			`SELECT id, event_type, severity, details, created_at
			 FROM proctoring_events
			 WHERE session_id = $1
			 ORDER BY created_at DESC`,
			[sessionId],
		);

		// Fetch flags
		const flagsResult = await pool.query(
			`SELECT pf.*, ru.name as reviewer_name
			 FROM proctoring_flags pf
			 LEFT JOIN users ru ON pf.reviewed_by = ru.id
			 WHERE pf.session_id = $1
			 ORDER BY pf.created_at DESC`,
			[sessionId],
		);

		res.json({
			success: true,
			session,
			events: eventsResult.rows,
			flags: flagsResult.rows,
		});
	} catch (err) {
		console.error('[proctoring] Get session error:', err.message, err.code);
		res.status(500).json({ error: 'Failed to fetch session', code: 'INTERNAL_ERROR' });
	}
});

// ─── Candidate: Record explicit consent ──────────────────────────────────
router.post(
	'/session/:id/consent',
	authMiddleware,
	requireRole('candidate'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const sessionId = parseInt(req.params.id, 10);
			if (Number.isNaN(sessionId)) {
				return res.status(400).json({ error: 'Invalid session ID', code: 'INVALID_ID' });
			}

			const { consent_given } = req.body;
			if (consent_given !== true) {
				return res
					.status(400)
					.json({ error: 'Consent must be explicitly given (true)', code: 'CONSENT_REQUIRED' });
			}

			// Verify ownership
			const sessionResult = await pool.query(
				`SELECT * FROM proctoring_sessions WHERE id = $1 AND candidate_id = $2`,
				[sessionId, req.user.id],
			);
			if (sessionResult.rows.length === 0) {
				return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
			}

			const session = sessionResult.rows[0];
			if (session.consent_given) {
				return res
					.status(409)
					.json({ error: 'Consent already recorded', code: 'CONSENT_ALREADY_GIVEN' });
			}

			const clientIp = _getClientIp(req);
			const updated = await pool.query(
				`UPDATE proctoring_sessions
			 SET consent_given = true,
			     consent_timestamp = NOW(),
			     consent_ip = $1,
			     status = 'in_progress',
			     started_at = NOW(),
			     updated_at = NOW()
			 WHERE id = $2
			 RETURNING *`,
				[clientIp, sessionId],
			);

			// Audit log
			try {
				await AuditLogger.log({
					actionType: 'proctoring_consent_given',
					userId: req.user.id,
					targetType: 'proctoring_session',
					targetId: sessionId,
					metadata: { ip: clientIp },
					req,
				});
			} catch (e) {
				console.error('[proctoring] Audit log failed (non-blocking):', e.message);
			}

			res.json({ success: true, session: updated.rows[0] });
		} catch (err) {
			console.error('[proctoring] Consent error:', err.message, err.code);
			res.status(500).json({ error: 'Failed to record consent', code: 'INTERNAL_ERROR' });
		}
	},
);

// ─── Candidate: Log a proctoring event ───────────────────────────────────
router.post(
	'/session/:id/event',
	authMiddleware,
	requireRole('candidate'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const sessionId = parseInt(req.params.id, 10);
			if (Number.isNaN(sessionId)) {
				return res.status(400).json({ error: 'Invalid session ID', code: 'INVALID_ID' });
			}

			const { event_type, severity = 'low', details = {} } = req.body;
			const VALID_TYPES = new Set([
				'tab_switch',
				'copy_paste',
				'no_face',
				'multiple_faces',
				'audio_anomaly',
				'timing_anomaly',
				'fullscreen_exit',
				'right_click',
				'window_blur',
				'suspicious_keypress',
			]);
			const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

			if (!event_type || !VALID_TYPES.has(event_type)) {
				return res.status(400).json({ error: 'Invalid event_type', code: 'INVALID_EVENT_TYPE' });
			}
			if (!VALID_SEVERITIES.has(severity)) {
				return res.status(400).json({ error: 'Invalid severity', code: 'INVALID_SEVERITY' });
			}

			// Verify ownership and consent
			const sessionResult = await pool.query(
				`SELECT consent_given, status FROM proctoring_sessions WHERE id = $1 AND candidate_id = $2`,
				[sessionId, req.user.id],
			);
			if (sessionResult.rows.length === 0) {
				return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
			}
			const session = sessionResult.rows[0];
			if (!session.consent_given) {
				return res
					.status(403)
					.json({ error: 'Consent required before logging events', code: 'CONSENT_REQUIRED' });
			}
			if (session.status !== 'in_progress') {
				return res
					.status(409)
					.json({ error: `Session is ${session.status}`, code: 'SESSION_NOT_IN_PROGRESS' });
			}

			// Insert event
			const eventResult = await pool.query(
				`INSERT INTO proctoring_events (session_id, event_type, severity, details)
			 VALUES ($1, $2, $3, $4)
			 RETURNING *`,
				[sessionId, event_type, severity, JSON.stringify(details)],
			);

			// Auto-flag on high severity (never auto-reject; always queue for human review)
			let flag = null;
			if (severity === 'high') {
				const flagResult = await pool.query(
					`INSERT INTO proctoring_flags (session_id, flag_type, description, severity)
				 VALUES ($1, $2, $3, $4)
				 ON CONFLICT DO NOTHING
				 RETURNING *`,
					[sessionId, event_type, `High-severity event detected: ${event_type}`, severity],
				);
				if (flagResult.rows.length > 0) {
					flag = flagResult.rows[0];
					// Also update session status to flagged
					await pool.query(
						`UPDATE proctoring_sessions
					 SET status = CASE WHEN status = 'in_progress' THEN 'flagged' ELSE status END,
					     updated_at = NOW()
					 WHERE id = $1`,
						[sessionId],
					);
				}
			}

			res.status(201).json({ success: true, event: eventResult.rows[0], flag });
		} catch (err) {
			console.error('[proctoring] Log event error:', err.message, err.code);
			res.status(500).json({ error: 'Failed to log event', code: 'INTERNAL_ERROR' });
		}
	},
);

// ─── Candidate: Mark session complete ────────────────────────────────────
router.post(
	'/session/:id/complete',
	authMiddleware,
	requireRole('candidate'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const sessionId = parseInt(req.params.id, 10);
			if (Number.isNaN(sessionId)) {
				return res.status(400).json({ error: 'Invalid session ID', code: 'INVALID_ID' });
			}

			const sessionResult = await pool.query(
				`SELECT * FROM proctoring_sessions WHERE id = $1 AND candidate_id = $2`,
				[sessionId, req.user.id],
			);
			if (sessionResult.rows.length === 0) {
				return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
			}

			const session = sessionResult.rows[0];
			if (!session.consent_given) {
				return res.status(403).json({ error: 'Consent required', code: 'CONSENT_REQUIRED' });
			}
			if (session.status === 'completed') {
				return res
					.status(409)
					.json({ error: 'Session already completed', code: 'ALREADY_COMPLETED' });
			}

			// Determine final status: flagged if any high-severity events exist, else completed
			const highSeverityCheck = await pool.query(
				`SELECT 1 FROM proctoring_events WHERE session_id = $1 AND severity = 'high' LIMIT 1`,
				[sessionId],
			);
			const finalStatus = highSeverityCheck.rows.length > 0 ? 'flagged' : 'completed';

			const updated = await pool.query(
				`UPDATE proctoring_sessions
			 SET status = $1,
			     ended_at = NOW(),
			     updated_at = NOW()
			 WHERE id = $2
			 RETURNING *`,
				[finalStatus, sessionId],
			);

			// Audit log
			try {
				await AuditLogger.log({
					actionType: 'proctoring_session_completed',
					userId: req.user.id,
					targetType: 'proctoring_session',
					targetId: sessionId,
					metadata: { final_status: finalStatus },
					req,
				});
			} catch (e) {
				console.error('[proctoring] Audit log failed (non-blocking):', e.message);
			}

			res.json({ success: true, session: updated.rows[0] });
		} catch (err) {
			console.error('[proctoring] Complete session error:', err.message, err.code);
			res.status(500).json({ error: 'Failed to complete session', code: 'INTERNAL_ERROR' });
		}
	},
);

// ─── Recruiter: List flagged sessions for review ─────────────────────────
router.get(
	'/flags',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.public,
	async (req, res) => {
		try {
			const { status = 'pending', limit = 20, offset = 0 } = req.query;
			const companyId = req.user.company_id;
			const userId = req.user.id;
			const isAdmin = req.user.role === 'admin';

			// Build query scoped to recruiter's company or their own jobs
			let whereClause = 'WHERE 1=1';
			const params = [];

			if (status !== 'all') {
				params.push(status);
				whereClause += ` AND pf.review_decision = $${params.length}`;
			}

			if (!isAdmin) {
				// Scope to company jobs OR jobs owned by this user
				params.push(companyId || null);
				params.push(userId);
				whereClause += ` AND (j.company_id = $${params.length - 1} OR j.user_id = $${params.length})`;
			}

			params.push(Number(limit));
			params.push(Number(offset));

			const result = await pool.query(
				`SELECT
				pf.id as flag_id,
				pf.flag_type,
				pf.description,
				pf.severity,
				pf.review_decision,
				pf.created_at as flagged_at,
				pf.reviewed_by,
				pf.review_notes,
				ps.id as session_id,
				ps.status as session_status,
				ps.started_at,
				ps.ended_at,
				u.id as candidate_id,
				u.name as candidate_name,
				u.email as candidate_email,
				j.id as job_id,
				j.title as job_title,
				j.company_id
			 FROM proctoring_flags pf
			 JOIN proctoring_sessions ps ON pf.session_id = ps.id
			 JOIN users u ON ps.candidate_id = u.id
			 LEFT JOIN job_applications ja ON ps.application_id = ja.id
			 LEFT JOIN jobs j ON ja.job_id = j.id
			 ${whereClause}
			 ORDER BY pf.created_at DESC
			 LIMIT $${params.length - 1} OFFSET $${params.length}`,
				params,
			);

			// Total count
			let countWhere = 'WHERE 1=1';
			const countParams = [];
			if (status !== 'all') {
				countParams.push(status);
				countWhere += ` AND pf.review_decision = $${countParams.length}`;
			}
			if (!isAdmin) {
				countParams.push(companyId || null);
				countParams.push(userId);
				countWhere += ` AND (j.company_id = $${countParams.length - 1} OR j.user_id = $${countParams.length})`;
			}

			const countResult = await pool.query(
				`SELECT COUNT(*) as total FROM proctoring_flags pf
			 JOIN proctoring_sessions ps ON pf.session_id = ps.id
			 LEFT JOIN job_applications ja ON ps.application_id = ja.id
			 LEFT JOIN jobs j ON ja.job_id = j.id
			 ${countWhere}`,
				countParams,
			);

			res.json({
				success: true,
				flags: result.rows,
				total: parseInt(countResult.rows[0].total, 10),
				limit: Number(limit),
				offset: Number(offset),
			});
		} catch (err) {
			console.error('[proctoring] List flags error:', err.message, err.code);
			res.status(500).json({ error: 'Failed to fetch flags', code: 'INTERNAL_ERROR' });
		}
	},
);

// ─── Recruiter: Submit human review decision ─────────────────────────────
router.post(
	'/flags/:id/review',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const flagId = parseInt(req.params.id, 10);
			if (Number.isNaN(flagId)) {
				return res.status(400).json({ error: 'Invalid flag ID', code: 'INVALID_ID' });
			}

			const { decision, notes = '' } = req.body;
			if (!decision || !['approved', 'rejected'].includes(decision)) {
				return res
					.status(400)
					.json({ error: "Decision must be 'approved' or 'rejected'", code: 'INVALID_DECISION' });
			}

			// Verify recruiter can review this flag
			const flagCheck = await pool.query(
				`SELECT pf.*, j.company_id, j.user_id as job_owner_id
			 FROM proctoring_flags pf
			 JOIN proctoring_sessions ps ON pf.session_id = ps.id
			 LEFT JOIN job_applications ja ON ps.application_id = ja.id
			 LEFT JOIN jobs j ON ja.job_id = j.id
			 WHERE pf.id = $1`,
				[flagId],
			);
			if (flagCheck.rows.length === 0) {
				return res.status(404).json({ error: 'Flag not found', code: 'FLAG_NOT_FOUND' });
			}

			const flag = flagCheck.rows[0];
			const isAdmin = req.user.role === 'admin';
			if (
				!isAdmin &&
				flag.company_id !== req.user.company_id &&
				flag.job_owner_id !== req.user.id
			) {
				return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
			}

			const updated = await pool.query(
				`UPDATE proctoring_flags
			 SET review_decision = $1,
			     review_notes = $2,
			     reviewed_by = $3,
			     updated_at = NOW()
			 WHERE id = $4
			 RETURNING *`,
				[decision, notes, req.user.id, flagId],
			);

			// If all flags for the session are reviewed, update session to reviewed
			const pendingFlags = await pool.query(
				`SELECT COUNT(*) as pending FROM proctoring_flags WHERE session_id = $1 AND review_decision = 'pending'`,
				[flag.session_id],
			);
			if (parseInt(pendingFlags.rows[0].pending, 10) === 0) {
				await pool.query(
					`UPDATE proctoring_sessions SET status = 'reviewed', updated_at = NOW() WHERE id = $1`,
					[flag.session_id],
				);
			}

			// Audit log
			try {
				await AuditLogger.log({
					actionType: 'proctoring_flag_reviewed',
					userId: req.user.id,
					targetType: 'proctoring_flag',
					targetId: flagId,
					metadata: { decision, notes, session_id: flag.session_id },
					req,
				});
			} catch (e) {
				console.error('[proctoring] Audit log failed (non-blocking):', e.message);
			}

			res.json({ success: true, flag: updated.rows[0] });
		} catch (err) {
			console.error('[proctoring] Review flag error:', err.message, err.code);
			res.status(500).json({ error: 'Failed to submit review', code: 'INTERNAL_ERROR' });
		}
	},
);

module.exports = router;
