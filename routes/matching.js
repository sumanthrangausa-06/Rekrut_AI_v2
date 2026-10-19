const express = require('express');
const crypto = require('node:crypto');
const { authMiddleware, requireRole } = require('../lib/auth');
const pool = require('../lib/db');
const { AuditLogger } = require('../services/auditLogService');
const {
	findMatchingJobs,
	findMatchingCandidates,
	explainMatch,
	updateCandidateEmbedding,
	updateJobEmbedding,
} = require('../services/matching-engine');

const router = express.Router();

// #1468: candidate-safe projection of an explainMatch() result (privacy
// seat, STOP 1 on #1468; #1458/#1463 precedent). explainMatch() returns
// the raw match_results row (SELECT *) — or, on its on-demand branch, an
// object nesting the same explanation — whose match_explanation /
// explanation carries recruiter-side artifacts (company TrustScore and
// OmniScore boost text) alongside trustscore_at_match /
// omniscore_at_match. A candidate-self caller receives ONLY the fields
// enumerated here, constructed key by key — never a spread with
// deletions, so a future match_results column cannot leak by default.
function toCandidateSafeMatchResult(result) {
	if (!result || typeof result !== 'object') return result;
	// Privacy review note (#1468): the projection controls keys, not
	// values — the two allowlisted JSONB skill lists are passed only as
	// string arrays, so a future writer storing objects/free text in
	// those columns cannot pass it through to candidates verbatim.
	const skillList = (v) =>
		v === undefined ? undefined : Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
	return {
		weighted_score: result.weighted_score,
		similarity_score: result.similarity_score,
		match_level: result.match_level,
		matching_skills: skillList(result.matching_skills),
		missing_skills: skillList(result.missing_skills),
	};
}

// Secure error response helper
function sendError(res, err, consolePrefix) {
	const ref = crypto.randomUUID();
	console.error(`[ERROR ref=${ref}] ${consolePrefix}:`, err);
	if (process.env.NODE_ENV === 'production') {
		res.status(500).json({ error: 'Internal server error', ref });
	} else {
		res.status(500).json({ error: 'Internal server error', ref });
	}
}

/**
 * GET /api/matching/recommendations
 * Get personalized job recommendations for the logged-in candidate
 */
router.get('/recommendations', authMiddleware, async (req, res) => {
	try {
		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can get job recommendations' });
		}

		const { limit = 20, min_score = 50 } = req.query;

		const matches = await findMatchingJobs(req.user.id, {
			limit: parseInt(limit, 10),
			minScore: parseFloat(min_score) / 100,
		});

		// Log AI matching decision for compliance
		await AuditLogger.log({
			actionType: 'matching_decision',
			userId: req.user.id,
			targetType: 'candidate',
			targetId: req.user.id,
			metadata: {
				match_count: matches.length,
				min_score: parseFloat(min_score) / 100,
				model_version: 'matching-engine-v1',
				confidence:
					matches.length > 0 ? Math.max(...matches.map((m) => m.final_score || m.score || 0)) : 0,
			},
			req,
		});

		res.json({
			success: true,
			recommendations: matches,
			explanation: {
				how_it_works:
					'Jobs are ranked using semantic skill matching, company TrustScore, and your OmniScore',
				score_breakdown:
					'Weighted score = 60% skill match + 30% company trust + 10% your OmniScore',
				improve_matches: 'Complete your profile and boost your OmniScore to see better matches',
			},
		});
	} catch (err) {
		sendError(res, err, 'Get recommendations error');
	}
});

/**
 * GET /api/matching/candidates/:jobId
 * Get ranked candidates for a specific job (recruiters only)
 */
router.get(
	'/candidates/:jobId',
	authMiddleware,
	requireRole('hiring_manager', 'admin', 'recruiter'),
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.jobId, 10);
			const { limit = 50, min_score = 50 } = req.query;

			const matches = await findMatchingCandidates(jobId, {
				limit: parseInt(limit, 10),
				minScore: parseFloat(min_score) / 100,
			});

			// Log AI matching decision for compliance
			await AuditLogger.log({
				actionType: 'matching_decision',
				userId: req.user.id,
				targetType: 'job',
				targetId: jobId,
				metadata: {
					match_count: matches.length,
					min_score: parseFloat(min_score) / 100,
					model_version: 'matching-engine-v1',
					confidence:
						matches.length > 0 ? Math.max(...matches.map((m) => m.final_score || m.score || 0)) : 0,
				},
				req,
			});

			res.json({
				success: true,
				candidates: matches,
				job_id: jobId,
				explanation: {
					how_it_works:
						'Candidates are ranked using semantic skill matching, OmniScore, and your company TrustScore',
					score_breakdown:
						'Weighted score = 60% skill match + 30% candidate OmniScore + 10% your TrustScore',
					score_tiers: {
						excellent: '85-100 (Highly recommended)',
						good: '70-84 (Strong match)',
						fair: '55-69 (Potential match)',
						poor: '0-54 (Not recommended)',
					},
				},
			});
		} catch (err) {
			sendError(res, err, 'Get candidates error');
		}
	},
);

/**
 * GET /api/matching/explain/:candidateId/:jobId
 * Get detailed explanation of why a candidate matched a job
 */
router.get('/explain/:candidateId/:jobId', authMiddleware, async (req, res) => {
	try {
		const candidateId = parseInt(req.params.candidateId, 10);
		const jobId = parseInt(req.params.jobId, 10);

		if (!Number.isInteger(candidateId) || !Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid candidate ID and job ID required' });
		}

		// Authorization: candidates can only see their own explanations
		if (req.user.role === 'candidate' && req.user.id !== candidateId) {
			return res.status(403).json({ error: 'Not authorized' });
		}

		// Object-level authorisation (#1479; FS-145/#1100 convention —
		// reference implementation: routes/compliance.js GET
		// /explain/job/:jobId/candidate/:candidateId, the same
		// candidate×job resource). Candidate-self (identity, #927) and
		// admin bypass the object checks; every other caller must be a
		// hiring role tied to this exact candidate×job pair:
		//   1. the caller's company owns the job — a missing job, a null
		//      company_id on either side, or a company mismatch are the
		//      same 404, so foreign jobs cannot be distinguished from
		//      non-existent ones;
		//   2. the candidate has an application for this job with the
		//      caller's company (job_applications linkage) — owning a
		//      job the candidate never applied to is not a relationship
		//      with the candidate.
		// Both checks run before explainMatch(): a denied caller never
		// reaches the service.
		const isAdmin = req.user.role === 'admin';
		const isSelf = Number(req.user.id) === candidateId;
		if (!isAdmin && !isSelf) {
			const isHiringRole = ['employer', 'recruiter', 'hiring_manager'].includes(req.user.role);
			if (!isHiringRole) {
				return res.status(403).json({ error: 'Access denied' });
			}

			const jobResult = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
			const job = jobResult.rows[0];
			if (
				!job ||
				req.user.company_id == null ||
				job.company_id == null ||
				Number(req.user.company_id) !== Number(job.company_id)
			) {
				return res.status(404).json({ error: 'Job not found' });
			}

			const linkage = await pool.query(
				'SELECT 1 FROM job_applications WHERE candidate_id = $1 AND job_id = $2 AND company_id = $3 LIMIT 1',
				[candidateId, jobId, req.user.company_id],
			);
			if (linkage.rows.length === 0) {
				return res.status(403).json({ error: 'Access denied' });
			}
		}

		const explanation = await explainMatch(candidateId, jobId);

		// Log AI explanation generation for compliance
		await AuditLogger.log({
			actionType: 'ai_explanation_generated',
			userId: req.user.id,
			targetType: 'match',
			targetId: jobId,
			metadata: {
				candidate_id: candidateId,
				job_id: jobId,
				model_version: 'matching-engine-v1',
				explanation_type: 'match_explanation',
				confidence: explanation?.score || explanation?.final_score || 0.5,
			},
			req,
		});

		// Audience shaping (#1468, privacy seat; #927 fix-round ruling):
		// shape on authorisation identity (self && !admin), not on
		// role === 'candidate' alone — a self-applicant whose account role
		// has changed is still the candidate audience. Other callers
		// (recruiter / hiring roles / admin) keep the full record.
		const isCandidateSelf = Number(req.user.id) === candidateId && req.user.role !== 'admin';

		res.json({
			success: true,
			candidate_id: candidateId,
			job_id: jobId,
			match_result: isCandidateSelf ? toCandidateSafeMatchResult(explanation) : explanation,
			transparency_note:
				'Our matching algorithm uses semantic analysis of skills and experience, combined with OmniScore and TrustScore for fairness and quality.',
		});
	} catch (err) {
		sendError(res, err, 'Explain match error');
	}
});

/**
 * POST /api/matching/update-profile-embedding
 * Update the candidate's profile embedding (triggered after profile updates)
 */
router.post('/update-profile-embedding', authMiddleware, async (req, res) => {
	try {
		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can update profile embeddings' });
		}

		await updateCandidateEmbedding(req.user.id);

		res.json({
			success: true,
			message: 'Profile embedding updated successfully. Job recommendations will be refreshed.',
		});
	} catch (err) {
		sendError(res, err, 'Update profile embedding error');
	}
});

/**
 * POST /api/matching/update-job-embedding/:jobId
 * Update a job's embedding (triggered after job updates)
 */
router.post(
	'/update-job-embedding/:jobId',
	authMiddleware,
	requireRole('hiring_manager', 'admin', 'recruiter'),
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.jobId, 10);

			await updateJobEmbedding(jobId);

			res.json({
				success: true,
				message: 'Job embedding updated successfully. Candidate matches will be refreshed.',
			});
		} catch (err) {
			sendError(res, err, 'Update job embedding error');
		}
	},
);

/**
 * GET /api/matching/stats
 * Get matching statistics for the current user
 */
router.get('/stats', authMiddleware, async (req, res) => {
	try {
		const pool = require('../lib/db');

		if (req.user.role === 'candidate') {
			// Candidate stats
			const result = await pool.query(
				`
        SELECT
          COUNT(*) as total_matches,
          AVG(match_score) as avg_match_score,
          COUNT(CASE WHEN match_score >= 85 THEN 1 END) as excellent_matches,
          COUNT(CASE WHEN match_score >= 70 AND match_score < 85 THEN 1 END) as good_matches
        FROM job_recommendations
        WHERE user_id = $1
      `,
				[req.user.id],
			);

			res.json({
				success: true,
				stats: result.rows[0],
				your_profile_strength: 'Complete your profile and take assessments to improve matches',
			});
		} else {
			// Recruiter stats
			const result = await pool.query(
				`
        SELECT
          j.id as job_id,
          j.title,
          COUNT(mr.id) as candidate_matches,
          AVG(mr.weighted_score) as avg_match_score,
          COUNT(CASE WHEN mr.match_level = 'excellent' THEN 1 END) as excellent_matches
        FROM jobs j
        LEFT JOIN match_results mr ON j.id = mr.job_id
        WHERE j.user_id = $1 OR j.company_id IN (
          SELECT company_id FROM users WHERE id = $1
        )
        GROUP BY j.id, j.title
        ORDER BY candidate_matches DESC
        LIMIT 10
      `,
				[req.user.id],
			);

			res.json({
				success: true,
				job_stats: result.rows,
			});
		}
	} catch (err) {
		sendError(res, err, 'Get stats error');
	}
});

module.exports = router;
