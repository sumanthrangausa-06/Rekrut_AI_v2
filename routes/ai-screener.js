/**
 * AI Recruiter Screener Routes (Issue #112)
 *
 * Provides REST API endpoints for AI-powered candidate screening:
 * - Single candidate screening
 * - Batch screening
 * - Human review / override
 * - Audit trail
 * - Candidate self-service (view screenings, request human review)
 *
 * Security:
 * - All routes require authentication
 * - Recruiters can only screen candidates for jobs they own
 * - Candidates can only view their own screenings
 * - Rate limiting on AI endpoints (expensive calls)
 * - Input validation with express-validator
 * - Advisory-only recommendations — never auto-reject
 */

const express = require('express');
const crypto = require('node:crypto');
const { body, param, validationResult } = require('express-validator');
const { authMiddleware } = require('../lib/auth');
const screener = require('../lib/recruiter-screener');
const pool = require('../lib/db');
const auditLogService = require('../services/auditLogService');
const { rateLimits } = require('../lib/distributed-rate-limiter');

const router = express.Router();

// ─── Helpers ───────────────────────────────────────────────────────────────

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ error: 'Validation failed', details: errors.array() });
	}
	next();
}

function hashJSON(obj) {
	return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function logAudit(screeningId, action, actorId, inputs, outputs, metadata = {}) {
	const inputsHash = inputs ? hashJSON(inputs) : null;
	const outputsHash = outputs ? hashJSON(outputs) : null;
	await pool.query(
		`INSERT INTO ai_screening_audit_logs
       (screening_id, action, actor_id, inputs_hash, outputs_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
		[screeningId, action, actorId, inputsHash, outputsHash, JSON.stringify(metadata)],
	);
}

async function verifyRecruiterOwnsJob(userId, jobId) {
	const result = await pool.query(
		`SELECT j.id, j.company_id, u.company_id as user_company_id
       FROM jobs j
       JOIN users u ON u.id = $1
       WHERE j.id = $2`,
		[userId, jobId],
	);
	if (result.rows.length === 0) return { ok: false, status: 404, error: 'Job not found' };
	const row = result.rows[0];
	// Recruiter owns job if their company matches job's company, or they are the job poster
	const ownershipCheck = await pool.query(
		`SELECT 1 FROM jobs WHERE id = $1 AND (user_id = $2 OR company_id = $3)`,
		[jobId, userId, row.user_company_id],
	);
	if (ownershipCheck.rows.length === 0) {
		return { ok: false, status: 403, error: 'You do not have access to this job' };
	}
	return { ok: true, job: row };
}

async function getCandidateFullProfile(candidateId) {
	const result = await pool.query(
		`
      SELECT
        u.id, u.name, u.email,
        cp.headline, cp.years_experience,
        (SELECT json_agg(json_build_object('name', skill, 'level', level))
         FROM candidate_skills WHERE user_id = u.id) as skills,
        (SELECT json_agg(json_build_object('degree', degree, 'field', field_of_study, 'institution', institution))
         FROM education WHERE user_id = u.id) as education,
        (SELECT json_agg(json_build_object('title', title, 'company', company_name, 'start_date', start_date, 'end_date', end_date))
         FROM work_experience WHERE user_id = u.id) as experience,
        (SELECT total_score FROM omni_scores WHERE user_id = u.id ORDER BY last_updated DESC LIMIT 1) as omni_score,
        (SELECT json_agg(json_build_object('skill', skill_name, 'score', score))
         FROM assessment_results WHERE user_id = u.id AND score IS NOT NULL) as assessment_scores,
        (SELECT AVG(score)::decimal(3,1) FROM interview_evaluations WHERE candidate_id = u.id) as interview_avg_score
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1 AND u.role = 'candidate'
    `,
		[candidateId],
	);
	return result.rows[0] || null;
}

async function getJobForScreening(jobId) {
	const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
	if (result.rows.length === 0) return null;
	const job = result.rows[0];
	return {
		...job,
		required_skills: job.required_skills || [],
		preferred_skills: job.preferred_skills || [],
		min_years: job.min_years_experience || 0,
	};
}

async function findOrCreateApplication(candidateId, jobId) {
	const existing = await pool.query(
		`SELECT id FROM job_applications WHERE candidate_id = $1 AND job_id = $2 LIMIT 1`,
		[candidateId, jobId],
	);
	if (existing.rows.length > 0) return existing.rows[0].id;
	const inserted = await pool.query(
		`INSERT INTO job_applications (candidate_id, job_id, status, applied_at)
       VALUES ($1, $2, 'reviewing', NOW()) RETURNING id`,
		[candidateId, jobId],
	);
	return inserted.rows[0].id;
}

async function storeScreeningResult(jobId, candidateId, applicationId, screenedBy, result) {
	const upsert = await pool.query(
		`
      INSERT INTO ai_screenings
        (job_id, candidate_id, application_id, fit_score, fit_breakdown,
         recommendation, recommendation_reason, matched_skills, missing_skills,
         strengths, concerns, red_flags, screening_questions, interview_focus_areas,
         estimated_success_probability, raw_screening_data, screened_by, human_review_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'pending')
      ON CONFLICT (job_id, candidate_id) DO UPDATE SET
        fit_score = EXCLUDED.fit_score,
        fit_breakdown = EXCLUDED.fit_breakdown,
        recommendation = EXCLUDED.recommendation,
        recommendation_reason = EXCLUDED.recommendation_reason,
        matched_skills = EXCLUDED.matched_skills,
        missing_skills = EXCLUDED.missing_skills,
        strengths = EXCLUDED.strengths,
        concerns = EXCLUDED.concerns,
        red_flags = EXCLUDED.red_flags,
        screening_questions = EXCLUDED.screening_questions,
        interview_focus_areas = EXCLUDED.interview_focus_areas,
        estimated_success_probability = EXCLUDED.estimated_success_probability,
        raw_screening_data = EXCLUDED.raw_screening_data,
        screened_by = EXCLUDED.screened_by,
        updated_at = NOW()
      RETURNING id
    `,
		[
			jobId,
			candidateId,
			applicationId,
			result.fit_score,
			JSON.stringify(result.fit_breakdown || {}),
			result.recommendation,
			result.recommendation_reason || null,
			result.matched_skills || [],
			result.missing_skills || [],
			result.strengths || [],
			result.concerns || [],
			JSON.stringify(result.red_flags || []),
			JSON.stringify(result.screening_questions || []),
			result.interview_focus_areas || [],
			result.estimated_success_probability || null,
			JSON.stringify(result),
			screenedBy,
		],
	);
	return upsert.rows[0].id;
}

// ─── POST /api/jobs/:jobId/screen/:candidateId ─────────────────────────────
// Run AI screening for a single candidate against a job

router.post(
	'/jobs/:jobId/screen/:candidateId',
	authMiddleware,
	rateLimits.ai,
	[
		param('jobId').isInt({ min: 1 }).withMessage('jobId must be a positive integer'),
		param('candidateId').isInt({ min: 1 }).withMessage('candidateId must be a positive integer'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.jobId, 10);
			const candidateId = parseInt(req.params.candidateId, 10);

			// Role check: recruiters/hiring_managers/admins only for screening
			const allowedRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
			if (!allowedRoles.includes(req.user.role)) {
				return res.status(403).json({ error: 'Only recruiters can run AI screenings' });
			}

			// Verify job ownership
			const access = await verifyRecruiterOwnsJob(req.user.id, jobId);
			if (!access.ok) {
				return res.status(access.status).json({ error: access.error });
			}

			// Get candidate profile
			const candidate = await getCandidateFullProfile(candidateId);
			if (!candidate) {
				return res.status(404).json({ error: 'Candidate not found' });
			}

			// Get job data
			const job = await getJobForScreening(jobId);
			if (!job) {
				return res.status(404).json({ error: 'Job not found' });
			}

			// Run AI screening
			const screeningResult = await screener.screenCandidate(candidate, job, {
				subscriptionId: req.user.id,
			});

			// Ensure application exists (for foreign key)
			const applicationId = await findOrCreateApplication(candidateId, jobId);

			// Store result
			const screeningId = await storeScreeningResult(
				jobId,
				candidateId,
				applicationId,
				req.user.id,
				screeningResult,
			);

			// Log to audit
			await logAudit(
				screeningId,
				'ai_screening',
				req.user.id,
				{ candidate, job },
				screeningResult,
				{ fit_score: screeningResult.fit_score, recommendation: screeningResult.recommendation },
			);

			// ─── Compliance audit trail (Issue #136) ───────────────────────
			try {
				await auditLogService.logEvent({
					eventType: auditLogService.EVENT_TYPES.AI_DECISION,
					entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
					entityId: candidateId,
					actorId: req.user.id,
					actorRole: req.user.role,
					jobId,
					companyId: access.job?.company_id || req.user.company_id || null,
					payload: {
						screening_id: screeningId,
						inputs: { candidate_id: candidateId, job_id: jobId },
						outputs: {
							fit_score: screeningResult.fit_score,
							recommendation: screeningResult.recommendation,
							recommendation_reason: screeningResult.recommendation_reason,
							matched_skills: screeningResult.matched_skills,
							missing_skills: screeningResult.missing_skills,
						},
						model_version: 'recruiter-screener-v1',
					},
					req,
				});
			} catch (e) {
				console.error('[compliance-audit] AI decision log failed (non-blocking):', e.message);
			}

			// Also log to legacy screening_logs for backward compatibility
			try {
				await pool.query(
					`INSERT INTO screening_logs (candidate_id, job_id, fit_score, recommendation, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
					[candidateId, jobId, screeningResult.fit_score, screeningResult.recommendation],
				);
			} catch (_e) {
				// Non-fatal
			}

			res.json({
				success: true,
				screening_id: screeningId,
				candidate: {
					id: candidate.id,
					name: candidate.name,
					omni_score: candidate.omni_score,
				},
				job: {
					id: job.id,
					title: job.title,
				},
				screening: {
					...screeningResult,
					advisory_note:
						'This recommendation is advisory only. No candidate has been automatically rejected.',
				},
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [ai-screener/screen] Error:`, err);
			res.status(500).json({ error: 'Screening failed', ref });
		}
	},
);

// ─── GET /api/jobs/:jobId/screenings ───────────────────────────────────────
// List all screenings for a job (recruiter/owner only). Sorted by fit_score desc.

router.get(
	'/jobs/:jobId/screenings',
	authMiddleware,
	[param('jobId').isInt({ min: 1 }).withMessage('jobId must be a positive integer')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.jobId, 10);

			// Verify access
			const access = await verifyRecruiterOwnsJob(req.user.id, jobId);
			if (!access.ok) {
				return res.status(access.status).json({ error: access.error });
			}

			const result = await pool.query(
				`
        SELECT
          ais.id as screening_id,
          ais.job_id,
          ais.candidate_id,
          ais.fit_score,
          ais.fit_breakdown,
          ais.recommendation,
          ais.recommendation_reason,
          ais.matched_skills,
          ais.missing_skills,
          ais.strengths,
          ais.concerns,
          ais.red_flags,
          ais.screening_questions,
          ais.interview_focus_areas,
          ais.estimated_success_probability,
          ais.human_review_status,
          ais.created_at,
          ais.updated_at,
          u.name as candidate_name,
          u.email as candidate_email,
          os.total_score as omni_score
        FROM ai_screenings ais
        JOIN users u ON u.id = ais.candidate_id
        LEFT JOIN omni_scores os ON os.user_id = u.id
        WHERE ais.job_id = $1
        ORDER BY ais.fit_score DESC
      `,
				[jobId],
			);

			res.json({
				success: true,
				job: { id: jobId, title: access.job?.title || null },
				screenings: result.rows,
				total: result.rows.length,
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [ai-screener/list] Error:`, err);
			res.status(500).json({ error: 'Failed to list screenings', ref });
		}
	},
);

// ─── GET /api/jobs/:jobId/screenings/:candidateId ──────────────────────────
// Get screening result for a specific candidate

router.get(
	'/jobs/:jobId/screenings/:candidateId',
	authMiddleware,
	[
		param('jobId').isInt({ min: 1 }).withMessage('jobId must be a positive integer'),
		param('candidateId').isInt({ min: 1 }).withMessage('candidateId must be a positive integer'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.jobId, 10);
			const candidateId = parseInt(req.params.candidateId, 10);

			// Access control: recruiter must own job, OR candidate must be viewing own record
			const isCandidateViewingOwn = req.user.role === 'candidate' && req.user.id === candidateId;
			if (!isCandidateViewingOwn) {
				const access = await verifyRecruiterOwnsJob(req.user.id, jobId);
				if (!access.ok) {
					return res.status(access.status).json({ error: access.error });
				}
			}

			const result = await pool.query(
				`
        SELECT
          ais.*,
          u.name as candidate_name,
          u.email as candidate_email,
          os.total_score as omni_score
        FROM ai_screenings ais
        JOIN users u ON u.id = ais.candidate_id
        LEFT JOIN omni_scores os ON os.user_id = u.id
        WHERE ais.job_id = $1 AND ais.candidate_id = $2
        LIMIT 1
      `,
				[jobId, candidateId],
			);

			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Screening not found' });
			}

			// If candidate is viewing, sanitize sensitive fields
			const screening = result.rows[0];
			if (isCandidateViewingOwn) {
				delete screening.raw_screening_data;
				screening.advisory_note =
					'This is an AI-generated assessment. You may request a human review if you believe this assessment is inaccurate.';
			}

			res.json({
				success: true,
				screening,
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [ai-screener/get] Error:`, err);
			res.status(500).json({ error: 'Failed to get screening', ref });
		}
	},
);

// ─── POST /api/jobs/:jobId/screen-batch ────────────────────────────────────
// Batch screen multiple candidates (max 50)

router.post(
	'/jobs/:jobId/screen-batch',
	authMiddleware,
	rateLimits.ai,
	[
		param('jobId').isInt({ min: 1 }).withMessage('jobId must be a positive integer'),
		body('candidate_ids')
			.isArray({ min: 1, max: 50 })
			.withMessage('candidate_ids must be an array of 1-50 items'),
		body('candidate_ids.*')
			.isInt({ min: 1 })
			.withMessage('Each candidate_id must be a positive integer'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.jobId, 10);
			const { candidate_ids } = req.body;

			// Role check
			const allowedRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
			if (!allowedRoles.includes(req.user.role)) {
				return res.status(403).json({ error: 'Only recruiters can run AI screenings' });
			}

			// Verify job ownership
			const access = await verifyRecruiterOwnsJob(req.user.id, jobId);
			if (!access.ok) {
				return res.status(access.status).json({ error: access.error });
			}

			// Get job data
			const job = await getJobForScreening(jobId);
			if (!job) {
				return res.status(404).json({ error: 'Job not found' });
			}

			// Fetch all candidates
			const candidates = [];
			for (const cid of candidate_ids) {
				const candidate = await getCandidateFullProfile(cid);
				if (candidate) {
					candidates.push(candidate);
				}
			}

			if (candidates.length === 0) {
				return res.status(400).json({ error: 'No valid candidates found' });
			}

			// Run batch screening
			const batchResults = await screener.screenCandidatesBatch(candidates, job, {
				subscriptionId: req.user.id,
			});

			// Store results and build response
			const storedResults = [];
			for (let i = 0; i < batchResults.length; i++) {
				const result = batchResults[i];
				const candidate = candidates[i];
				if (!candidate) continue;

				const applicationId = await findOrCreateApplication(candidate.id, jobId);
				const screeningId = await storeScreeningResult(
					jobId,
					candidate.id,
					applicationId,
					req.user.id,
					result,
				);

				await logAudit(screeningId, 'ai_screening_batch', req.user.id, { candidate, job }, result, {
					batch: true,
				});

				// ─── Compliance audit trail (Issue #136) ───────────────────
				try {
					await auditLogService.logEvent({
						eventType: auditLogService.EVENT_TYPES.AI_DECISION,
						entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
						entityId: candidate.id,
						actorId: req.user.id,
						actorRole: req.user.role,
						jobId,
						companyId: access.job?.company_id || req.user.company_id || null,
						payload: {
							screening_id: screeningId,
							batch: true,
							inputs: { candidate_id: candidate.id, job_id: jobId },
							outputs: {
								fit_score: result.fit_score,
								recommendation: result.recommendation,
							},
							model_version: 'recruiter-screener-v1',
						},
						req,
					});
				} catch (e) {
					console.error(
						'[compliance-audit] Batch AI decision log failed (non-blocking):',
						e.message,
					);
				}

				storedResults.push({
					screening_id: screeningId,
					candidate: {
						id: candidate.id,
						name: candidate.name,
					},
					fit_score: result.fit_score,
					recommendation: result.recommendation,
				});
			}

			res.json({
				success: true,
				job: { id: job.id, title: job.title },
				screenings: storedResults,
				total_processed: candidates.length,
				advisory_note:
					'All recommendations are advisory only. No candidate has been automatically rejected.',
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [ai-screener/batch] Error:`, err);
			res.status(500).json({ error: 'Batch screening failed', ref });
		}
	},
);

// ─── POST /api/screenings/:screeningId/human-review ────────────────────────
// Submit human override decision with reason. Logged to audit.

router.post(
	'/screenings/:screeningId/human-review',
	authMiddleware,
	[
		param('screeningId').isInt({ min: 1 }).withMessage('screeningId must be a positive integer'),
		body('decision')
			.notEmpty()
			.withMessage('decision is required')
			.isIn(['interview', 'reject', 'more_info', 'hold'])
			.withMessage('decision must be one of: interview, reject, more_info, hold'),
		body('reason').trim().notEmpty().withMessage('reason is required').isLength({ max: 2000 }),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const screeningId = parseInt(req.params.screeningId, 10);
			const { decision, reason } = req.body;

			// Role check
			const allowedRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
			if (!allowedRoles.includes(req.user.role)) {
				return res.status(403).json({ error: 'Only recruiters can submit human reviews' });
			}

			// Get screening and verify ownership via job
			const screeningResult = await pool.query(`SELECT job_id FROM ai_screenings WHERE id = $1`, [
				screeningId,
			]);
			if (screeningResult.rows.length === 0) {
				return res.status(404).json({ error: 'Screening not found' });
			}

			const access = await verifyRecruiterOwnsJob(req.user.id, screeningResult.rows[0].job_id);
			if (!access.ok) {
				return res.status(access.status).json({ error: access.error });
			}

			// Store human review
			const reviewResult = await pool.query(
				`
        INSERT INTO ai_screening_human_reviews
          (screening_id, reviewer_id, decision, reason)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (screening_id, reviewer_id) DO UPDATE SET
          decision = EXCLUDED.decision,
          reason = EXCLUDED.reason,
          created_at = NOW()
        RETURNING *
      `,
				[screeningId, req.user.id, decision, reason],
			);

			// Update screening human_review_status
			await pool.query(
				`UPDATE ai_screenings SET human_review_status = 'overridden', updated_at = NOW() WHERE id = $1`,
				[screeningId],
			);

			// Audit log
			await logAudit(screeningId, 'human_review', req.user.id, null, null, { decision, reason });

			// ─── Compliance audit trail (Issue #136) ───────────────────────
			try {
				await auditLogService.logEvent({
					eventType: auditLogService.EVENT_TYPES.HUMAN_OVERRIDE,
					entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
					entityId: screeningResult.rows[0]?.candidate_id || null,
					actorId: req.user.id,
					actorRole: req.user.role,
					jobId: screeningResult.rows[0]?.job_id || null,
					companyId: req.user.company_id || null,
					payload: {
						screening_id: screeningId,
						override_decision: decision,
						reason,
						original_ai_status: 'pending',
					},
					req,
				});
			} catch (e) {
				console.error('[compliance-audit] Human override log failed (non-blocking):', e.message);
			}

			res.json({
				success: true,
				review: reviewResult.rows[0],
				message: 'Human review submitted successfully',
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [ai-screener/human-review] Error:`, err);
			res.status(500).json({ error: 'Failed to submit human review', ref });
		}
	},
);

// ─── GET /api/screenings/:screeningId/audit-log ────────────────────────────
// Get audit trail for a screening

router.get(
	'/screenings/:screeningId/audit-log',
	authMiddleware,
	[param('screeningId').isInt({ min: 1 }).withMessage('screeningId must be a positive integer')],
	handleValidationErrors,
	async (req, res) => {
		try {
			const screeningId = parseInt(req.params.screeningId, 10);

			// Get screening to check access
			const screeningResult = await pool.query(
				`SELECT job_id, candidate_id FROM ai_screenings WHERE id = $1`,
				[screeningId],
			);
			if (screeningResult.rows.length === 0) {
				return res.status(404).json({ error: 'Screening not found' });
			}

			const { job_id: jobId, candidate_id: candidateId } = screeningResult.rows[0];

			// Access: recruiter owns job, OR candidate is viewing own, OR admin
			const isCandidateViewingOwn = req.user.role === 'candidate' && req.user.id === candidateId;
			const isAdmin = req.user.role === 'admin';

			if (!isCandidateViewingOwn && !isAdmin) {
				const access = await verifyRecruiterOwnsJob(req.user.id, jobId);
				if (!access.ok) {
					return res.status(access.status).json({ error: access.error });
				}
			}

			// If candidate is viewing, show limited audit info (hide hashes)
			const selectCols = isCandidateViewingOwn
				? 'id, screening_id, action, actor_id, metadata, created_at'
				: 'id, screening_id, action, actor_id, inputs_hash, outputs_hash, metadata, created_at';

			const result = await pool.query(
				`
        SELECT ${selectCols}
        FROM ai_screening_audit_logs
        WHERE screening_id = $1
        ORDER BY created_at DESC
      `,
				[screeningId],
			);

			res.json({
				success: true,
				screening_id: screeningId,
				logs: result.rows,
				total: result.rows.length,
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [ai-screener/audit-log] Error:`, err);
			res.status(500).json({ error: 'Failed to get audit log', ref });
		}
	},
);

// ─── GET /api/candidates/me/screenings ─────────────────────────────────────
// Candidate views their own screenings

router.get('/candidates/me/screenings', authMiddleware, async (req, res) => {
	try {
		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can access this endpoint' });
		}

		const result = await pool.query(
			`
        SELECT
          ais.id as screening_id,
          ais.job_id,
          ais.fit_score,
          ais.recommendation,
          ais.matched_skills,
          ais.missing_skills,
          ais.strengths,
          ais.concerns,
          ais.human_review_status,
          ais.created_at,
          j.title as job_title,
          j.company as job_company
        FROM ai_screenings ais
        JOIN jobs j ON j.id = ais.job_id
        WHERE ais.candidate_id = $1
        ORDER BY ais.created_at DESC
      `,
			[req.user.id],
		);

		res.json({
			success: true,
			screenings: result.rows,
			total: result.rows.length,
			advisory_note:
				'These are AI-generated assessments. You may request a human review if you believe an assessment is inaccurate.',
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [ai-screener/me-screenings] Error:`, err);
		res.status(500).json({ error: 'Failed to get screenings', ref });
	}
});

// ─── POST /api/candidates/me/screenings/:screeningId/request-human-review ──
// Candidate requests human review

router.post(
	'/candidates/me/screenings/:screeningId/request-human-review',
	authMiddleware,
	[
		param('screeningId').isInt({ min: 1 }).withMessage('screeningId must be a positive integer'),
		body('reason')
			.optional()
			.trim()
			.isLength({ max: 1000 })
			.withMessage('reason must be at most 1000 characters'),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const screeningId = parseInt(req.params.screeningId, 10);
			const { reason } = req.body;

			if (req.user.role !== 'candidate') {
				return res.status(403).json({ error: 'Only candidates can access this endpoint' });
			}

			// Verify the screening belongs to this candidate
			const screeningResult = await pool.query(
				`SELECT id, human_review_status FROM ai_screenings WHERE id = $1 AND candidate_id = $2`,
				[screeningId, req.user.id],
			);
			if (screeningResult.rows.length === 0) {
				return res.status(404).json({ error: 'Screening not found' });
			}

			const currentStatus = screeningResult.rows[0].human_review_status;
			if (currentStatus === 'requested' || currentStatus === 'overridden') {
				return res.status(409).json({
					error: 'Human review has already been requested or completed for this screening',
				});
			}

			// Update status
			await pool.query(
				`UPDATE ai_screenings SET human_review_status = 'requested', updated_at = NOW() WHERE id = $1`,
				[screeningId],
			);

			// Audit log
			await logAudit(screeningId, 'candidate_requested_human_review', req.user.id, null, null, {
				reason: reason || 'Candidate requested human review',
			});

			res.json({
				success: true,
				message: 'Human review requested successfully',
				screening_id: screeningId,
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [ai-screener/request-review] Error:`, err);
			res.status(500).json({ error: 'Failed to request human review', ref });
		}
	},
);

module.exports = router;
