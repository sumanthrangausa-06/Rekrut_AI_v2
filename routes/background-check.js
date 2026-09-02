/**
 * Background Check Routes
 * Issue #133 — Employment/education verification, discrepancy detection, reference checks
 *
 * Mounted:
 *   candidateRouter at /api/candidates (employment, education, discrepancies)
 *   router at /api (verification-requests, reference-checks, discrepancies actions)
 */

const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const verificationService = require('../server/services/verification-service');
const discrepancyService = require('../server/services/discrepancy-service');
const auditLogService = require('../services/auditLogService');
const { AuditLogger } = auditLogService;

const candidateRouter = express.Router();
const router = express.Router();

// ─── Authorization Helpers ──────────────────────────────────────────────────

async function canAccessCandidate(req, candidateId) {
	if (!req.user) return false;
	if (req.user.role === 'admin') return true;
	if (req.user.id === parseInt(candidateId, 10)) return true;

	// Recruiters: candidate must have applied to a job at their company
	const recruiterRoles = ['recruiter', 'hiring_manager', 'employer'];
	if (recruiterRoles.includes(req.user.role) && req.user.company_id) {
		const check = await pool.query(
			`SELECT 1 FROM job_applications ja
       JOIN jobs j ON j.id = ja.job_id
       WHERE ja.candidate_id = $1 AND j.company_id = $2
       LIMIT 1`,
			[candidateId, req.user.company_id],
		);
		return check.rows.length > 0;
	}
	return false;
}

function requireAccessCandidate(paramName = 'id') {
	return async (req, res, next) => {
		const candidateId = req.params[paramName];
		const ok = await canAccessCandidate(req, candidateId);
		if (!ok) return res.status(403).json({ error: 'Access denied' });
		next();
	};
}

// ─── Employment History (under /api/candidates/:id) ─────────────────────────

candidateRouter.get(
	'/:id/employment',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const result = await pool.query(
				`SELECT * FROM employment_history WHERE candidate_id = $1 ORDER BY start_date DESC NULLS LAST, created_at DESC`,
				[req.params.id],
			);
			res.json({ success: true, employment: result.rows });
		} catch (err) {
			console.error('[bg-check/employment/get] Error:', err.message);
			res.status(500).json({ error: 'Failed to get employment history' });
		}
	},
);

candidateRouter.post(
	'/:id/employment',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const {
				company_name,
				job_title,
				start_date,
				end_date,
				is_current,
				reference_name,
				reference_email,
				reference_phone,
				description,
			} = req.body;
			if (!company_name || !job_title) {
				return res.status(400).json({ error: 'company_name and job_title are required' });
			}
			const result = await pool.query(
				`
      INSERT INTO employment_history
        (candidate_id, company_name, job_title, start_date, end_date, is_current, reference_name, reference_email, reference_phone, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `,
				[
					req.params.id,
					company_name,
					job_title,
					start_date || null,
					end_date || null,
					is_current || false,
					reference_name || null,
					reference_email || null,
					reference_phone || null,
					description || null,
				],
			);
			res.status(201).json({ success: true, employment: result.rows[0] });
		} catch (err) {
			console.error('[bg-check/employment/post] Error:', err.message);
			res.status(500).json({ error: 'Failed to create employment entry' });
		}
	},
);

candidateRouter.put(
	'/:id/employment/:entryId',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const {
				company_name,
				job_title,
				start_date,
				end_date,
				is_current,
				reference_name,
				reference_email,
				reference_phone,
				description,
			} = req.body;
			const result = await pool.query(
				`
      UPDATE employment_history
      SET company_name = COALESCE($2, company_name),
          job_title = COALESCE($3, job_title),
          start_date = COALESCE($4, start_date),
          end_date = COALESCE($5, end_date),
          is_current = COALESCE($6, is_current),
          reference_name = COALESCE($7, reference_name),
          reference_email = COALESCE($8, reference_email),
          reference_phone = COALESCE($9, reference_phone),
          description = COALESCE($10, description),
          updated_at = NOW()
      WHERE id = $1 AND candidate_id = $11
      RETURNING *
    `,
				[
					req.params.entryId,
					company_name,
					job_title,
					start_date,
					end_date,
					is_current,
					reference_name,
					reference_email,
					reference_phone,
					description,
					req.params.id,
				],
			);
			if (result.rows.length === 0)
				return res.status(404).json({ error: 'Employment entry not found' });
			res.json({ success: true, employment: result.rows[0] });
		} catch (err) {
			console.error('[bg-check/employment/put] Error:', err.message);
			res.status(500).json({ error: 'Failed to update employment entry' });
		}
	},
);

candidateRouter.delete(
	'/:id/employment/:entryId',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const result = await pool.query(
				'DELETE FROM employment_history WHERE id = $1 AND candidate_id = $2 RETURNING id',
				[req.params.entryId, req.params.id],
			);
			if (result.rows.length === 0)
				return res.status(404).json({ error: 'Employment entry not found' });
			res.json({ success: true, message: 'Employment entry deleted' });
		} catch (err) {
			console.error('[bg-check/employment/delete] Error:', err.message);
			res.status(500).json({ error: 'Failed to delete employment entry' });
		}
	},
);

// ─── Education History (under /api/candidates/:id) ──────────────────────────

candidateRouter.get(
	'/:id/education',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const result = await pool.query(
				`SELECT * FROM education_history WHERE candidate_id = $1 ORDER BY start_date DESC NULLS LAST, created_at DESC`,
				[req.params.id],
			);
			res.json({ success: true, education: result.rows });
		} catch (err) {
			console.error('[bg-check/education/get] Error:', err.message);
			res.status(500).json({ error: 'Failed to get education history' });
		}
	},
);

candidateRouter.post(
	'/:id/education',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const {
				institution_name,
				degree,
				field_of_study,
				start_date,
				end_date,
				is_current,
				description,
			} = req.body;
			if (!institution_name) {
				return res.status(400).json({ error: 'institution_name is required' });
			}
			const result = await pool.query(
				`
      INSERT INTO education_history
        (candidate_id, institution_name, degree, field_of_study, start_date, end_date, is_current, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `,
				[
					req.params.id,
					institution_name,
					degree || null,
					field_of_study || null,
					start_date || null,
					end_date || null,
					is_current || false,
					description || null,
				],
			);
			res.status(201).json({ success: true, education: result.rows[0] });
		} catch (err) {
			console.error('[bg-check/education/post] Error:', err.message);
			res.status(500).json({ error: 'Failed to create education entry' });
		}
	},
);

candidateRouter.put(
	'/:id/education/:entryId',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const {
				institution_name,
				degree,
				field_of_study,
				start_date,
				end_date,
				is_current,
				description,
			} = req.body;
			const result = await pool.query(
				`
      UPDATE education_history
      SET institution_name = COALESCE($2, institution_name),
          degree = COALESCE($3, degree),
          field_of_study = COALESCE($4, field_of_study),
          start_date = COALESCE($5, start_date),
          end_date = COALESCE($6, end_date),
          is_current = COALESCE($7, is_current),
          description = COALESCE($8, description),
          updated_at = NOW()
      WHERE id = $1 AND candidate_id = $9
      RETURNING *
    `,
				[
					req.params.entryId,
					institution_name,
					degree,
					field_of_study,
					start_date,
					end_date,
					is_current,
					description,
					req.params.id,
				],
			);
			if (result.rows.length === 0)
				return res.status(404).json({ error: 'Education entry not found' });
			res.json({ success: true, education: result.rows[0] });
		} catch (err) {
			console.error('[bg-check/education/put] Error:', err.message);
			res.status(500).json({ error: 'Failed to update education entry' });
		}
	},
);

candidateRouter.delete(
	'/:id/education/:entryId',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const result = await pool.query(
				'DELETE FROM education_history WHERE id = $1 AND candidate_id = $2 RETURNING id',
				[req.params.entryId, req.params.id],
			);
			if (result.rows.length === 0)
				return res.status(404).json({ error: 'Education entry not found' });
			res.json({ success: true, message: 'Education entry deleted' });
		} catch (err) {
			console.error('[bg-check/education/delete] Error:', err.message);
			res.status(500).json({ error: 'Failed to delete education entry' });
		}
	},
);

// ─── Discrepancies (candidate-scoped, under /api/candidates/:id) ────────────

candidateRouter.get(
	'/:id/discrepancies',
	authMiddleware,
	requireAccessCandidate(),
	async (req, res) => {
		try {
			const discrepancies = await discrepancyService.getDiscrepanciesForCandidate(req.params.id);
			res.json({ success: true, discrepancies });
		} catch (err) {
			console.error('[bg-check/discrepancies/get] Error:', err.message);
			res.status(500).json({ error: 'Failed to get discrepancies' });
		}
	},
);

// ─── Verification Requests (under /api/verification-requests) ───────────────

router.post('/verification-requests', authMiddleware, async (req, res) => {
	try {
		const { candidate_id, type, target_id, target_email, notes } = req.body;
		if (!candidate_id || !type || !target_id) {
			return res.status(400).json({ error: 'candidate_id, type, and target_id are required' });
		}
		if (!['employment', 'education', 'reference'].includes(type)) {
			return res.status(400).json({ error: 'type must be employment, education, or reference' });
		}

		// Auth check
		const ok = await canAccessCandidate(req, candidate_id);
		if (!ok) return res.status(403).json({ error: 'Access denied' });

		const request = await verificationService.createVerificationRequest({
			candidateId: candidate_id,
			type,
			targetId,
			targetEmail,
			notes,
		});

		// Send email if target_email provided
		let emailSent = false;
		if (target_email) {
			emailSent = await verificationService.sendVerificationEmail(request.id);
		}

		// Audit log
		try {
			await AuditLogger.log({
				actionType: 'verification_request_created',
				userId: req.user.id,
				targetType: 'bg_verification_request',
				targetId: request.id,
				metadata: { candidate_id, type, target_id, email_sent: emailSent },
				req,
			});
		} catch (e) {
			console.error('[bg-check] Audit log failed (non-blocking):', e.message);
		}

		res.status(201).json({ success: true, verification_request: request, email_sent: emailSent });
	} catch (err) {
		console.error('[bg-check/verification/create] Error:', err.message);
		res.status(500).json({ error: 'Failed to create verification request' });
	}
});

router.get('/verification-requests/:id', authMiddleware, async (req, res) => {
	try {
		const result = await pool.query('SELECT * FROM bg_verification_requests WHERE id = $1', [
			req.params.id,
		]);
		if (result.rows.length === 0)
			return res.status(404).json({ error: 'Verification request not found' });

		const request = result.rows[0];
		const ok = await canAccessCandidate(req, request.candidate_id);
		if (!ok) return res.status(403).json({ error: 'Access denied' });

		// Include summary
		const summary = await verificationService.generateSummary(request.id);
		res.json({ success: true, verification_request: summary });
	} catch (err) {
		console.error('[bg-check/verification/get] Error:', err.message);
		res.status(500).json({ error: 'Failed to get verification request' });
	}
});

/**
 * POST /api/verification-requests/:id/respond
 * PUBLIC endpoint — no auth required. Uses token query param.
 * Employer/institution submits structured response form.
 */
router.post('/verification-requests/:id/respond', async (req, res) => {
	try {
		const { token } = req.query;
		if (!token) return res.status(400).json({ error: 'token is required' });

		const responseData = req.body;
		if (!responseData || Object.keys(responseData).length === 0) {
			return res.status(400).json({ error: 'response data is required' });
		}

		const result = await verificationService.processResponse(
			parseInt(req.params.id, 10),
			token,
			responseData,
		);

		// Notify candidate of discrepancies (fairness: candidate sees first)
		try {
			await discrepancyService.notifyCandidate(parseInt(req.params.id, 10));
		} catch (e) {
			console.error('[bg-check] Failed to notify candidate of discrepancies:', e.message);
		}

		res.json({ success: true, ...result });
	} catch (err) {
		console.error('[bg-check/verification/respond] Error:', err.message);
		res.status(400).json({ error: err.message });
	}
});

router.post('/verification-requests/:id/manual-review', authMiddleware, async (req, res) => {
	try {
		const { notes } = req.body;
		const requestId = parseInt(req.params.id, 10);

		// Verify access
		const reqResult = await pool.query(
			'SELECT candidate_id FROM bg_verification_requests WHERE id = $1',
			[requestId],
		);
		if (reqResult.rows.length === 0)
			return res.status(404).json({ error: 'Verification request not found' });

		const ok = await canAccessCandidate(req, reqResult.rows[0].candidate_id);
		if (!ok) return res.status(403).json({ error: 'Access denied' });

		await verificationService.markManualReview(requestId, req.user.id, notes);
		res.json({ success: true, message: 'Marked for manual review' });
	} catch (err) {
		console.error('[bg-check/verification/manual-review] Error:', err.message);
		res.status(500).json({ error: 'Failed to mark manual review' });
	}
});

// ─── Discrepancy Actions (under /api/discrepancies) ─────────────────────────

router.post('/discrepancies/:id/respond', authMiddleware, async (req, res) => {
	try {
		const { candidate_response } = req.body;
		if (!candidate_response) {
			return res.status(400).json({ error: 'candidate_response is required' });
		}

		const discrepancy = await discrepancyService.respondToDiscrepancy(
			parseInt(req.params.id, 10),
			req.user.id,
			candidate_response,
		);

		res.json({ success: true, discrepancy });
	} catch (err) {
		console.error('[bg-check/discrepancies/respond] Error:', err.message);
		res.status(400).json({ error: err.message });
	}
});

router.post('/discrepancies/:id/resolve', authMiddleware, async (req, res) => {
	try {
		const { resolution } = req.body;
		const discrepancyId = parseInt(req.params.id, 10);

		// Verify the discrepancy's candidate is accessible to this recruiter
		const discResult = await pool.query(
			`
      SELECT d.id, v.candidate_id
      FROM discrepancies d
      JOIN bg_verification_requests v ON v.id = d.verification_request_id
      WHERE d.id = $1
    `,
			[discrepancyId],
		);
		if (discResult.rows.length === 0)
			return res.status(404).json({ error: 'Discrepancy not found' });

		const ok = await canAccessCandidate(req, discResult.rows[0].candidate_id);
		if (!ok) return res.status(403).json({ error: 'Access denied' });

		const discrepancy = await discrepancyService.resolveDiscrepancy(
			discrepancyId,
			req.user.id,
			resolution,
		);
		res.json({ success: true, discrepancy });
	} catch (err) {
		console.error('[bg-check/discrepancies/resolve] Error:', err.message);
		res.status(500).json({ error: 'Failed to resolve discrepancy' });
	}
});

// ─── Reference Checks (under /api/reference-checks) ─────────────────────────

router.get('/reference-checks', authMiddleware, async (req, res) => {
	try {
		const { candidate_id } = req.query;
		if (!candidate_id)
			return res.status(400).json({ error: 'candidate_id query param is required' });

		const ok = await canAccessCandidate(req, candidate_id);
		if (!ok) return res.status(403).json({ error: 'Access denied' });

		const result = await pool.query(
			`SELECT * FROM reference_checks WHERE candidate_id = $1 ORDER BY created_at DESC`,
			[candidate_id],
		);
		res.json({ success: true, reference_checks: result.rows });
	} catch (err) {
		console.error('[bg-check/reference-checks/get] Error:', err.message);
		res.status(500).json({ error: 'Failed to get reference checks' });
	}
});

router.post('/reference-checks', authMiddleware, async (req, res) => {
	try {
		const {
			candidate_id,
			employment_history_id,
			reference_name,
			reference_email,
			reference_phone,
			relationship,
		} = req.body;
		if (!candidate_id || !reference_name) {
			return res.status(400).json({ error: 'candidate_id and reference_name are required' });
		}

		const ok = await canAccessCandidate(req, candidate_id);
		if (!ok) return res.status(403).json({ error: 'Access denied' });

		const result = await pool.query(
			`
      INSERT INTO reference_checks
        (candidate_id, employment_history_id, reference_name, reference_email, reference_phone, relationship, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())
      RETURNING *
    `,
			[
				candidate_id,
				employment_history_id || null,
				reference_name,
				reference_email || null,
				reference_phone || null,
				relationship || null,
			],
		);

		res.status(201).json({ success: true, reference_check: result.rows[0] });
	} catch (err) {
		console.error('[bg-check/reference-checks/post] Error:', err.message);
		res.status(500).json({ error: 'Failed to create reference check' });
	}
});

module.exports = { candidateRouter, router };
