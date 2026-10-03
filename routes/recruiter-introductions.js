// routes/recruiter-introductions.js
// Issue #38 — Recruiter Introductions: Direct hiring manager intros for Top 5 matches

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool = require('../lib/db');
const {
	authMiddleware,
	requireRole,
	requireApprovedRecruiter,
	requireNotSuspended,
} = require('../lib/auth');
const { requireFeature } = require('../lib/subscription');
const emailService = require('../lib/email-service');

let matchingEngine;
try {
	matchingEngine = require('../services/matching-engine');
} catch (_e) {
	matchingEngine = null;
}

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────

function getMondayOfWeek(date) {
	const d = new Date(date);
	const day = d.getDay();
	const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
	return new Date(d.setDate(diff));
}

function formatDate(date) {
	return date.toISOString().slice(0, 10);
}

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ error: 'Validation failed', details: errors.array() });
	}
	next();
}

// In-app notification helper (non-blocking)
async function sendInAppNotification(userId, type, title, message, metadata = {}) {
	try {
		await pool.query(
			`INSERT INTO user_notifications (user_id, type, title, message, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
			[userId, type, title, message, JSON.stringify(metadata)],
		);
	} catch (err) {
		console.error('[recruiter-intros] Failed to send in-app notification:', err.message);
	}
}

// ─── Candidate-facing endpoints ──────────────────────────────────────────

/**
 * POST /api/recruiter-intros/request
 * Request an introduction to the hiring manager for a job.
 * Requirements: premium (Pro), in Top 5 matches, quota remaining (3/week).
 */
router.post(
	'/request',
	authMiddleware,
	requireRole('candidate'),
	requireFeature('recruiter_intros'),
	[
		body('job_id').isInt({ min: 1 }).withMessage('job_id is required'),
		body('message').optional().trim().isLength({ max: 2000 }),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const { job_id, message } = req.body;
			const candidateId = req.user.id;

			// ── 1. Verify job exists and is active ──
			const jobResult = await pool.query(
				`SELECT j.id, j.title, j.user_id as recruiter_id, j.company_id, c.name as company_name
         FROM jobs j
         LEFT JOIN companies c ON j.company_id = c.id
         WHERE j.id = $1 AND j.status = 'active'`,
				[job_id],
			);
			if (jobResult.rows.length === 0) {
				return res.status(404).json({ error: 'Job not found or not active' });
			}
			const job = jobResult.rows[0];

			// ── 2. Check quota ──
			const currentMonday = formatDate(getMondayOfWeek(new Date()));
			const quotaResult = await pool.query(
				`SELECT week_start, used_count, max_count FROM candidate_intro_quota WHERE candidate_id = $1`,
				[candidateId],
			);

			let quota = quotaResult.rows[0];
			if (!quota) {
				// First time — create quota record
				await pool.query(
					`INSERT INTO candidate_intro_quota (candidate_id, week_start, used_count, max_count)
           VALUES ($1, $2, 0, 3)`,
					[candidateId, currentMonday],
				);
				quota = { week_start: currentMonday, used_count: 0, max_count: 3 };
			} else if (formatDate(quota.week_start) !== currentMonday) {
				// New week — reset
				await pool.query(
					`UPDATE candidate_intro_quota
           SET week_start = $2, used_count = 0, updated_at = NOW()
           WHERE candidate_id = $1`,
					[candidateId, currentMonday],
				);
				quota = { week_start: currentMonday, used_count: 0, max_count: 3 };
			}

			if (quota.used_count >= quota.max_count) {
				return res.status(429).json({
					error: 'Weekly introduction quota exceeded',
					code: 'QUOTA_EXCEEDED',
					used: quota.used_count,
					remaining: 0,
					max: quota.max_count,
					week_start: quota.week_start,
				});
			}

			// ── 3. Check candidate is in Top 5 for this job ──
			let rank = null;
			let fitScore = null;
			let isTopFive = false;

			if (matchingEngine?.findMatchingCandidates) {
				try {
					const matches = await matchingEngine.findMatchingCandidates(job_id, {
						limit: 5,
						minScore: 0.3,
					});
					const candidateMatch = matches.find((m) => m.candidate_id === candidateId);
					if (candidateMatch) {
						isTopFive = true;
						rank = matches.indexOf(candidateMatch) + 1;
						fitScore = Math.round(
							candidateMatch.weighted_score || candidateMatch.similarity_score || 0,
						);
					}
				} catch (matchErr) {
					console.warn('[recruiter-intros] Matching engine error:', matchErr.message);
					// Fallback: check cached match_results
					const cachedMatch = await pool.query(
						`SELECT weighted_score FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
						[candidateId, job_id],
					);
					if (cachedMatch.rows.length > 0) {
						fitScore = Math.round(cachedMatch.rows[0].weighted_score || 0);
						// Without exact ranking, we allow if score >= 70 (heuristic for top-tier)
						isTopFive = fitScore >= 70;
						rank = null;
					}
				}
			} else {
				// Fallback when matching engine unavailable
				const cachedMatch = await pool.query(
					`SELECT weighted_score FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
					[candidateId, job_id],
				);
				if (cachedMatch.rows.length > 0) {
					fitScore = Math.round(cachedMatch.rows[0].weighted_score || 0);
					isTopFive = fitScore >= 70;
				}
			}

			if (!isTopFive) {
				return res.status(403).json({
					error: 'You must be in the Top 5 matches for this job to request an introduction',
					code: 'NOT_TOP_FIVE',
				});
			}

			// ── 4. Prevent duplicate active request ──
			const existing = await pool.query(
				`SELECT id FROM recruiter_introductions
         WHERE candidate_id = $1 AND job_id = $2 AND status = 'requested'`,
				[candidateId, job_id],
			);
			if (existing.rows.length > 0) {
				return res.status(409).json({
					error: 'An active introduction request already exists for this job',
					code: 'DUPLICATE_REQUEST',
					intro_id: existing.rows[0].id,
				});
			}

			// ── 5. Create introduction request ──
			const introResult = await pool.query(
				`INSERT INTO recruiter_introductions
         (candidate_id, job_id, recruiter_id, company_id, status, fit_score_at_request, rank_at_request, request_message, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'requested', $5, $6, $7, NOW(), NOW())
         RETURNING *`,
				[candidateId, job_id, job.recruiter_id, job.company_id, fitScore, rank, message || null],
			);
			const intro = introResult.rows[0];

			// ── 6. Decrement quota ──
			await pool.query(
				`UPDATE candidate_intro_quota
         SET used_count = used_count + 1, updated_at = NOW()
         WHERE candidate_id = $1`,
				[candidateId],
			);

			// ── 7. Notify recruiter (non-blocking) ──
			const candidateInfo = await pool.query(`SELECT name, email FROM users WHERE id = $1`, [
				candidateId,
			]);
			const candidateName = candidateInfo.rows[0]?.name || 'A candidate';

			// In-app notification to recruiter
			await sendInAppNotification(
				job.recruiter_id,
				'intro_request',
				'New Introduction Request',
				`${candidateName} requested an introduction for ${job.title}`,
				{ intro_id: intro.id, job_id, candidate_id: candidateId, company_id: job.company_id },
			);

			// Email notification to recruiter (non-blocking)
			try {
				const recruiterInfo = await pool.query(`SELECT email, name FROM users WHERE id = $1`, [
					job.recruiter_id,
				]);
				const recruiter = recruiterInfo.rows[0];
				if (recruiter?.email) {
					await emailService.sendTemplatedEmail({
						to: recruiter.email,
						templateName: 'intro_request',
						templateData: {
							recruiter_name: recruiter.name || 'Hiring Manager',
							candidate_name: candidateName,
							job_title: job.title,
							company_name: job.company_name || 'Your Company',
							fit_score: fitScore || 'N/A',
							rank: rank || 'N/A',
						},
						userId: job.recruiter_id,
						metadata: {
							intro_id: intro.id,
							job_id,
							candidate_id: candidateId,
							type: 'intro_request',
						},
					});
				}
			} catch (emailErr) {
				console.error(
					'[recruiter-intros] Email notification failed (non-blocking):',
					emailErr.message,
				);
			}

			res.status(201).json({
				success: true,
				intro,
				quota: {
					used: (quota.used_count || 0) + 1,
					remaining: Math.max(0, (quota.max_count || 3) - (quota.used_count || 0) - 1),
					max: quota.max_count || 3,
					week_start: quota.week_start,
				},
			});
		} catch (err) {
			console.error('[recruiter-intros] Request error:', err.message);
			res.status(500).json({ error: 'Failed to request introduction' });
		}
	},
);

/**
 * GET /api/recruiter-intros/my-requests
 * List all introduction requests made by the current candidate.
 */
router.get('/my-requests', authMiddleware, requireRole('candidate'), async (req, res) => {
	try {
		const { limit = 50, offset = 0 } = req.query;

		const result = await pool.query(
			`SELECT
        ri.*,
        j.title as job_title, j.company as job_company, j.location as job_location,
        u.name as recruiter_name, u.email as recruiter_email,
        c.name as company_name
      FROM recruiter_introductions ri
      JOIN jobs j ON ri.job_id = j.id
      JOIN users u ON ri.recruiter_id = u.id
      LEFT JOIN companies c ON ri.company_id = c.id
      WHERE ri.candidate_id = $1
      ORDER BY ri.created_at DESC
      LIMIT $2 OFFSET $3`,
			[req.user.id, parseInt(limit, 10), parseInt(offset, 10)],
		);

		// Total count
		const countResult = await pool.query(
			`SELECT COUNT(*) FROM recruiter_introductions WHERE candidate_id = $1`,
			[req.user.id],
		);

		res.json({
			success: true,
			requests: result.rows,
			total: parseInt(countResult.rows[0].count, 10),
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
		});
	} catch (err) {
		console.error('[recruiter-intros] My requests error:', err.message);
		res.status(500).json({ error: 'Failed to fetch introduction requests' });
	}
});

/**
 * GET /api/recruiter-intros/quota
 * Get remaining introduction quota for the current week.
 */
router.get('/quota', authMiddleware, requireRole('candidate'), async (req, res) => {
	try {
		const currentMonday = formatDate(getMondayOfWeek(new Date()));

		const result = await pool.query(
			`SELECT week_start, used_count, max_count FROM candidate_intro_quota WHERE candidate_id = $1`,
			[req.user.id],
		);

		let used = 0;
		let maxCount = 3;
		let weekStart = currentMonday;

		if (result.rows.length === 0) {
			// No record yet
			await pool.query(
				`INSERT INTO candidate_intro_quota (candidate_id, week_start, used_count, max_count)
         VALUES ($1, $2, 0, 3)`,
				[req.user.id, currentMonday],
			);
		} else {
			const row = result.rows[0];
			if (formatDate(row.week_start) !== currentMonday) {
				// Reset for new week
				await pool.query(
					`UPDATE candidate_intro_quota
           SET week_start = $2, used_count = 0, updated_at = NOW()
           WHERE candidate_id = $1`,
					[req.user.id, currentMonday],
				);
				used = 0;
			} else {
				used = parseInt(row.used_count, 10) || 0;
				maxCount = parseInt(row.max_count, 10) || 3;
				weekStart = formatDate(row.week_start);
			}
		}

		res.json({
			success: true,
			used,
			remaining: Math.max(0, maxCount - used),
			max: maxCount,
			week_start: weekStart,
		});
	} catch (err) {
		console.error('[recruiter-intros] Quota error:', err.message);
		res.status(500).json({ error: 'Failed to fetch quota' });
	}
});

// ─── Recruiter-facing endpoints ──────────────────────────────────────────

/**
 * GET /api/recruiter-intros/incoming
 * List incoming introduction requests for jobs owned by this recruiter.
 */
router.get('/incoming', authMiddleware, requireApprovedRecruiter, async (req, res) => {
	try {
		const { status, limit = 50, offset = 0 } = req.query;
		const recruiterId = req.user.id;

		let query = `
      SELECT
        ri.*,
        j.title as job_title,
        u.name as candidate_name, u.email as candidate_email, u.avatar_url as candidate_avatar,
        cp.headline as candidate_headline, cp.location as candidate_location, cp.years_experience,
        c.name as company_name
      FROM recruiter_introductions ri
      JOIN jobs j ON ri.job_id = j.id
      JOIN users u ON ri.candidate_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN companies c ON ri.company_id = c.id
      WHERE ri.recruiter_id = $1
    `;
		const params = [recruiterId];
		let paramIdx = 2;

		if (status) {
			query += ` AND ri.status = $${paramIdx++}`;
			params.push(status);
		}

		query += ` ORDER BY ri.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
		params.push(parseInt(limit, 10), parseInt(offset, 10));

		const result = await pool.query(query, params);

		// Total count
		let countQuery = `SELECT COUNT(*) FROM recruiter_introductions WHERE recruiter_id = $1`;
		const countParams = [recruiterId];
		if (status) {
			countQuery += ` AND status = $2`;
			countParams.push(status);
		}
		const countResult = await pool.query(countQuery, countParams);

		res.json({
			success: true,
			requests: result.rows,
			total: parseInt(countResult.rows[0].count, 10),
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
		});
	} catch (err) {
		console.error('[recruiter-intros] Incoming error:', err.message);
		res.status(500).json({ error: 'Failed to fetch incoming requests' });
	}
});

/**
 * PATCH /api/recruiter-intros/:id/status
 * Accept or reject an introduction request.
 */
router.patch(
	'/:id/status',
	authMiddleware,
	requireApprovedRecruiter,
	requireNotSuspended,
	[
		param('id').isInt({ min: 1 }).withMessage('Invalid introduction ID'),
		body('status')
			.isIn(['accepted', 'rejected'])
			.withMessage("status must be 'accepted' or 'rejected'"),
		body('notes').optional().trim().isLength({ max: 2000 }),
	],
	handleValidationErrors,
	async (req, res) => {
		try {
			const { id } = req.params;
			const { status, notes } = req.body;

			// Verify the intro belongs to this recruiter
			const introResult = await pool.query(
				`SELECT ri.*, j.title as job_title, j.company_id,
            u.name as candidate_name, u.email as candidate_email
       FROM recruiter_introductions ri
       JOIN jobs j ON ri.job_id = j.id
       JOIN users u ON ri.candidate_id = u.id
       WHERE ri.id = $1 AND ri.recruiter_id = $2`,
				[id, req.user.id],
			);

			if (introResult.rows.length === 0) {
				return res.status(404).json({ error: 'Introduction request not found' });
			}
			const intro = introResult.rows[0];

			if (intro.status !== 'requested') {
				return res.status(400).json({
					error: `Cannot update status from '${intro.status}'`,
					code: 'INVALID_STATE_TRANSITION',
				});
			}

			const updateResult = await pool.query(
				`UPDATE recruiter_introductions
         SET status = $1,
             recruiter_notes = COALESCE($2, recruiter_notes),
             responded_at = NOW(),
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
				[status, notes || null, id],
			);

			// Notify candidate (non-blocking)
			const actionText = status === 'accepted' ? 'accepted' : 'rejected';
			await sendInAppNotification(
				intro.candidate_id,
				`intro_${status}`,
				`Introduction ${actionText}`,
				`Your introduction request for ${intro.job_title} was ${actionText}${notes ? `: ${notes}` : ''}`,
				{ intro_id: intro.id, job_id: intro.job_id, recruiter_id: req.user.id },
			);

			// Email notification to candidate (non-blocking)
			try {
				if (intro.candidate_email) {
					await emailService.sendTemplatedEmail({
						to: intro.candidate_email,
						templateName: `intro_${status}`,
						templateData: {
							candidate_name: intro.candidate_name || 'Candidate',
							job_title: intro.job_title,
							status,
							notes: notes || '',
							recruiter_name: req.user.name || 'Hiring Manager',
						},
						userId: intro.candidate_id,
						metadata: { intro_id: intro.id, job_id: intro.job_id, type: `intro_${status}` },
					});
				}
			} catch (emailErr) {
				console.error(
					'[recruiter-intros] Candidate email failed (non-blocking):',
					emailErr.message,
				);
			}

			res.json({
				success: true,
				intro: updateResult.rows[0],
			});
		} catch (err) {
			console.error('[recruiter-intros] Status update error:', err.message);
			res.status(500).json({ error: 'Failed to update introduction status' });
		}
	},
);

/**
 * GET /api/recruiter-intros/stats
 * Dashboard stats for the recruiter's introduction requests.
 */
router.get('/stats', authMiddleware, requireApprovedRecruiter, async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT
        COUNT(*) FILTER (WHERE status = 'requested') as requested,
        COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) as total
      FROM recruiter_introductions
      WHERE recruiter_id = $1`,
			[req.user.id],
		);

		res.json({
			success: true,
			stats: result.rows[0],
		});
	} catch (err) {
		console.error('[recruiter-intros] Stats error:', err.message);
		res.status(500).json({ error: 'Failed to fetch stats' });
	}
});

module.exports = router;
