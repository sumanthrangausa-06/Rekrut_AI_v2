const express = require('express');
const crypto = require('node:crypto');
const { authMiddleware, requireRole } = require('../lib/auth');
const { AuditLogger } = require('../services/auditLogger');
const {
	findMatchingJobs,
	findMatchingCandidates,
	explainMatch,
	updateCandidateEmbedding,
	updateJobEmbedding,
} = require('../services/matching-engine');

const router = express.Router();

// Secure error response helper
function sendError(res, err, consolePrefix) {
	const ref = crypto.randomUUID();
	console.error(`[ERROR ref=${ref}] ${consolePrefix}:`, err);
	if (process.env.NODE_ENV === 'production') {
		res.status(500).json({ error: 'Internal server error', ref });
	} else {
		res.status(500).json({ error: 'Internal server error', details: err.message, ref });
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

		// Authorization: candidates can only see their own explanations
		if (req.user.role === 'candidate' && req.user.id !== candidateId) {
			return res.status(403).json({ error: 'Not authorized' });
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

		res.json({
			success: true,
			candidate_id: candidateId,
			job_id: jobId,
			match_result: explanation,
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
