// TrustScore API Routes v2 — Deep company scoring and accountability (Issue #122)
const express = require('express');
const { authMiddleware, requireApprovedRecruiter } = require('../lib/auth');
const trustscoreService = require('../services/trustscore');
const pool = require('../lib/db');

const router = express.Router();

// Check if user is a recruiter
function requireRecruiter(req, res, next) {
	if (!req.user.company_id || !['recruiter', 'hiring_manager', 'admin'].includes(req.user.role)) {
		return res.status(403).json({ error: 'Recruiter access required' });
	}
	next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// V1 ROUTES (preserved)
// ═══════════════════════════════════════════════════════════════════════════════

// Get current TrustScore
router.get('/', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const _score = await trustscoreService.getOrCreateTrustScore(req.user.company_id);
		const currentScores = await trustscoreService.calculateTrustScore(req.user.company_id);

		res.json({
			success: true,
			trustscore: currentScores,
		});
	} catch (err) {
		console.error('Get TrustScore error:', err);
		res.status(500).json({ error: 'Failed to get TrustScore' });
	}
});

// Get detailed score breakdown
router.get('/breakdown', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const breakdown = await trustscoreService.getTrustScoreBreakdown(req.user.company_id);

		res.json({
			success: true,
			...breakdown,
		});
	} catch (err) {
		console.error('Get TrustScore breakdown error:', err);
		res.status(500).json({ error: 'Failed to get TrustScore breakdown' });
	}
});

// Get score history
router.get('/history', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const { limit = 30 } = req.query;

		const result = await pool.query(
			`
      SELECT previous_score, new_score, change_amount, change_reason, component_type, created_at
      FROM trust_score_history
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
			[req.user.company_id, limit],
		);

		res.json({
			success: true,
			history: result.rows,
		});
	} catch (err) {
		console.error('Get TrustScore history error:', err);
		res.status(500).json({ error: 'Failed to get TrustScore history' });
	}
});

// Get recommendations
router.get('/recommendations', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const currentScores = await trustscoreService.calculateTrustScore(req.user.company_id);
		const v2Scores = await trustscoreService.calculateTrustScoreV2(req.user.company_id);
		const recommendations = trustscoreService.generateTrustRecommendations(currentScores);
		const v2Guidance = trustscoreService.generateV2ImprovementGuidance(v2Scores);

		res.json({
			success: true,
			current_score: currentScores.total_score,
			tier: currentScores.tier,
			recommendations,
			v2_guidance: v2Guidance,
		});
	} catch (err) {
		console.error('Get TrustScore recommendations error:', err);
		res.status(500).json({ error: 'Failed to get recommendations' });
	}
});

// Get hiring analytics (for TrustScore dashboard)
router.get('/analytics', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const companyId = req.user.company_id;

		const stats = await pool.query(
			`
      SELECT
        COUNT(DISTINCT j.id) as total_jobs,
        COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'active') as active_jobs,
        COALESCE(SUM(ja.views), 0) as total_views,
        COALESCE(SUM(ja.applications), 0) as total_applications,
        COALESCE(SUM(ja.interviews_scheduled), 0) as total_interviews,
        COALESCE(SUM(ja.offers_made), 0) as total_offers
      FROM jobs j
      LEFT JOIN job_analytics ja ON j.id = ja.job_id
      WHERE j.company_id = $1
    `,
			[companyId],
		);

		const recentApplications = await pool.query(
			`
      SELECT
        jap.id, jap.status, jap.applied_at, jap.omniscore_at_apply,
        u.name as candidate_name, u.email as candidate_email,
        j.title as job_title
      FROM job_applications jap
      JOIN users u ON jap.candidate_id = u.id
      JOIN jobs j ON jap.job_id = j.id
      WHERE jap.company_id = $1
      ORDER BY jap.applied_at DESC
      LIMIT 10
    `,
			[companyId],
		);

		const feedback = await pool.query(
			`
      SELECT
        AVG(rating) as avg_rating,
        AVG(communication_rating) as avg_communication,
        AVG(process_rating) as avg_process,
        COUNT(*) as total_reviews
      FROM candidate_feedback
      WHERE company_id = $1
    `,
			[companyId],
		);

		const { total_interviews, total_offers } = stats.rows[0];
		const ratio = total_interviews > 0 ? ((total_offers / total_interviews) * 100).toFixed(1) : 0;

		res.json({
			success: true,
			analytics: {
				...stats.rows[0],
				interview_to_offer_ratio: `${ratio}%`,
				avg_rating: feedback.rows[0].avg_rating
					? parseFloat(feedback.rows[0].avg_rating).toFixed(1)
					: null,
				avg_communication: feedback.rows[0].avg_communication
					? parseFloat(feedback.rows[0].avg_communication).toFixed(1)
					: null,
				avg_process: feedback.rows[0].avg_process
					? parseFloat(feedback.rows[0].avg_process).toFixed(1)
					: null,
				total_reviews: parseInt(feedback.rows[0].total_reviews, 10),
			},
			recent_applications: recentApplications.rows,
		});
	} catch (err) {
		console.error('Get analytics error:', err);
		res.status(500).json({ error: 'Failed to get analytics' });
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// V2 ROUTES — New endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/trustscore/leaderboard — Public company leaderboard
 * Query: ?limit=50&offset=0&tier=&min_score=0
 */
router.get('/leaderboard', async (req, res) => {
	try {
		const { limit = 50, offset = 0, tier, min_score = 0 } = req.query;

		const leaderboard = await trustscoreService.getLeaderboard({
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
			tier: tier || undefined,
			minScore: parseInt(min_score, 10),
		});

		res.json({
			success: true,
			...leaderboard,
		});
	} catch (err) {
		console.error('Get leaderboard error:', err);
		res.status(500).json({ error: 'Failed to get leaderboard' });
	}
});

/**
 * GET /api/trustscore/compare — Company-to-company comparison
 * Query: ?company_ids=1,2,3 (comma-separated)
 */
router.get('/compare', async (req, res) => {
	try {
		const { company_ids } = req.query;
		if (!company_ids) {
			return res.status(400).json({ error: 'company_ids parameter required (comma-separated)' });
		}

		const ids = company_ids.split(',').map((id) => parseInt(id.trim(), 10)).filter(Boolean);
		if (ids.length < 2) {
			return res.status(400).json({ error: 'At least 2 company IDs required for comparison' });
		}
		if (ids.length > 5) {
			return res.status(400).json({ error: 'Maximum 5 companies can be compared at once' });
		}

		const comparison = await trustscoreService.compareCompanies(ids);

		res.json({
			success: true,
			...comparison,
		});
	} catch (err) {
		console.error('Compare companies error:', err);
		res.status(500).json({ error: 'Failed to compare companies' });
	}
});

/**
 * GET /api/trustscore/company/:id/public — Public company TrustScore (for candidates before applying)
 */
router.get('/company/:id/public', async (req, res) => {
	try {
		const companyId = parseInt(req.params.id, 10);
		if (!companyId || isNaN(companyId)) {
			return res.status(400).json({ error: 'Invalid company ID' });
		}

		// Get company info
		const companyResult = await pool.query(
			`
      SELECT id, name, slug, logo_url, industry, company_size, headquarters, is_verified, description
      FROM companies WHERE id = $1
    `,
			[companyId],
		);

		if (companyResult.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const company = companyResult.rows[0];

		// Calculate v2 score (this also updates the DB cache)
		const v2Scores = await trustscoreService.calculateTrustScoreV2(companyId);

		// Get AI summary (generate if stale or missing)
		let aiSummary = v2Scores.ai_summary;
		const aiSummaryAge = v2Scores.ai_summary_generated_at
			? Date.now() - new Date(v2Scores.ai_summary_generated_at).getTime()
			: Infinity;
		if (!aiSummary || aiSummaryAge > 7 * 24 * 60 * 60 * 1000) {
			aiSummary = await trustscoreService.generateAISummary(companyId);
		}

		// Get recent public reviews
		const reviews = await pool.query(
			`
      SELECT
        overall_rating, interview_experience, communication, transparency,
        work_life_balance, culture, growth_opportunity,
        review_text, pros, cons,
        is_anonymous, created_at
      FROM company_ratings
      WHERE company_id = $1 AND status = 'published'
      ORDER BY created_at DESC
      LIMIT 5
    `,
			[companyId],
		);

		// Get company responses to reviews
		const responses = await pool.query(
			`
      SELECT crr.*, cr.review_text as original_review_text
      FROM company_review_responses crr
      JOIN company_ratings cr ON crr.review_id = cr.id
      WHERE crr.company_id = $1 AND crr.is_public = true
      ORDER BY crr.created_at DESC
      LIMIT 5
    `,
			[companyId],
		);

		// Build response
		const tierInfo = trustscoreService.TRUST_SCORE_RANGES.TIERS[v2Scores.tier];
		const insufficientData = v2Scores.data_sufficiency?.overall < 50;

		res.json({
			success: true,
			company: {
				id: company.id,
				name: company.name,
				slug: company.slug,
				logo_url: company.logo_url,
				industry: company.industry,
				company_size: company.company_size,
				headquarters: company.headquarters,
				is_verified: company.is_verified,
				description: company.description,
			},
			trustscore: {
				score: v2Scores.total_score,
				tier: v2Scores.tier,
				tier_label: tierInfo?.label || 'New Employer',
				tier_color: tierInfo?.color || '#94a3b8',
				insufficient_data: insufficientData,
				data_sufficiency_score: v2Scores.data_sufficiency?.overall || 0,
			},
			factors: {
				verification: { score: v2Scores.verification, max: 80 },
				job_authenticity: { score: v2Scores.job_authenticity, max: 120 },
				hiring_ratio: { score: v2Scores.hiring_ratio, max: 120 },
				feedback: { score: v2Scores.feedback, max: 80 },
				behavior: { score: v2Scores.behavior, max: 50 },
				employee_satisfaction: {
					score: v2Scores.employee_satisfaction,
					max: 100,
					sufficient: v2Scores.data_sufficiency?.factors?.employee_satisfaction || false,
				},
				interview_experience: {
					score: v2Scores.interview_experience,
					max: 100,
					sufficient: v2Scores.data_sufficiency?.factors?.interview_experience || false,
				},
				offer_acceptance_rate: {
					score: v2Scores.offer_acceptance_rate,
					max: 75,
					sufficient: v2Scores.data_sufficiency?.factors?.offer_acceptance_rate || false,
				},
				time_to_hire: {
					score: v2Scores.time_to_hire,
					max: 50,
					sufficient: v2Scores.data_sufficiency?.factors?.time_to_hire || false,
				},
				response_rate: {
					score: v2Scores.response_rate,
					max: 75,
					sufficient: v2Scores.data_sufficiency?.factors?.response_rate || false,
				},
				salary_competitiveness: {
					score: v2Scores.salary_competitiveness,
					max: 50,
					sufficient: v2Scores.data_sufficiency?.factors?.salary_competitiveness || false,
				},
				diversity_metrics: {
					score: v2Scores.diversity_metrics,
					max: 0,
					sufficient: false,
					message: 'Diversity metrics require demographic data not yet available',
				},
				career_growth: {
					score: v2Scores.career_growth,
					max: 100,
					sufficient: v2Scores.data_sufficiency?.factors?.career_growth || false,
				},
			},
			ai_summary: aiSummary,
			badges: trustscoreService.buildBadges({
				is_verified: company.is_verified,
				total_score: v2Scores.total_score,
				feedback_score: v2Scores.feedback,
				response_rate_score: v2Scores.response_rate,
				offer_acceptance_rate_score: v2Scores.offer_acceptance_rate,
			}),
			reviews: reviews.rows,
			company_responses: responses.rows,
		});
	} catch (err) {
		console.error('Get public TrustScore error:', err);
		res.status(500).json({ error: 'Failed to get TrustScore' });
	}
});

/**
 * POST /api/trustscore/feedback — Candidate submits interview feedback after decision
 * Body: { job_id, interview_id, overall_rating, interview_experience_rating, communication_rating, transparency_rating, professionalism_rating, feedback_text, would_recommend, is_anonymous }
 */
router.post('/feedback', authMiddleware, async (req, res) => {
	try {
		const candidateId = req.user.id;
		const {
			company_id,
			job_id,
			interview_id,
			overall_rating,
			interview_experience_rating,
			communication_rating,
			transparency_rating,
			professionalism_rating,
			feedback_text,
			would_recommend,
			is_anonymous = true,
		} = req.body;

		if (!company_id || !overall_rating) {
			return res.status(400).json({ error: 'company_id and overall_rating are required' });
		}

		// Validate rating ranges
		for (const [field, value] of Object.entries({
			overall_rating,
			interview_experience_rating,
			communication_rating,
			transparency_rating,
			professionalism_rating,
		})) {
			if (value !== undefined && (value < 1 || value > 5)) {
				return res.status(400).json({ error: `${field} must be between 1 and 5` });
			}
		}

		// Get IP and user agent for brigading detection
		const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
		const userAgent = req.headers['user-agent'] || null;

		// Insert interview feedback
		const result = await pool.query(
			`
      INSERT INTO interview_feedback (
        company_id, candidate_id, job_id, interview_id,
        overall_rating, interview_experience_rating, communication_rating,
        transparency_rating, professionalism_rating, feedback_text,
        would_recommend, is_anonymous, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `,
			[
				company_id,
				candidateId,
				job_id || null,
				interview_id || null,
				overall_rating,
				interview_experience_rating || null,
				communication_rating || null,
				transparency_rating || null,
				professionalism_rating || null,
				feedback_text || null,
				would_recommend !== undefined ? would_recommend : null,
				is_anonymous,
				ipAddress,
				userAgent,
			],
		);

		// Also update company_ratings if not already rated by this candidate
		await pool.query(
			`
      INSERT INTO company_ratings (company_id, candidate_id, overall_rating, interview_experience, communication, is_anonymous, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'published')
      ON CONFLICT (company_id, candidate_id) DO UPDATE SET
        overall_rating = EXCLUDED.overall_rating,
        interview_experience = EXCLUDED.interview_experience,
        communication = EXCLUDED.communication,
        updated_at = NOW()
    `,
			[company_id, candidateId, overall_rating, interview_experience_rating || null, communication_rating || null, is_anonymous],
		);

		// Recalculate TrustScore for the company
		await trustscoreService.calculateTrustScoreV2(company_id);

		res.json({
			success: true,
			message: 'Feedback submitted successfully',
			feedback: result.rows[0],
		});
	} catch (err) {
		console.error('Submit feedback error:', err);
		res.status(500).json({ error: 'Failed to submit feedback' });
	}
});

/**
 * POST /api/trustscore/company/response — Company responds publicly to a review
 * Body: { review_id, response_text, is_public }
 */
router.post('/company/response', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const companyId = req.user.company_id;
		const { review_id, response_text, is_public = true } = req.body;

		if (!review_id || !response_text?.trim()) {
			return res.status(400).json({ error: 'review_id and response_text are required' });
		}

		// Verify the review belongs to this company
		const reviewCheck = await pool.query(
			`SELECT id FROM company_ratings WHERE id = $1 AND company_id = $2`,
			[review_id, companyId],
		);

		if (reviewCheck.rows.length === 0) {
			return res.status(403).json({ error: 'Review not found or does not belong to your company' });
		}

		const result = await pool.query(
			`
      INSERT INTO company_review_responses (company_id, review_id, responder_id, response_text, is_public)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
			[companyId, review_id, req.user.id, response_text.trim(), is_public],
		);

		res.json({
			success: true,
			message: 'Response posted successfully',
			response: result.rows[0],
		});
	} catch (err) {
		console.error('Post company response error:', err);
		res.status(500).json({ error: 'Failed to post response' });
	}
});

/**
 * GET /api/trustscore/methodology — Published scoring methodology
 */
router.get('/methodology', async (req, res) => {
	try {
		const { version = '2.0' } = req.query;
		const methodology = await trustscoreService.getMethodology(version);

		res.json({
			success: true,
			...methodology,
		});
	} catch (err) {
		console.error('Get methodology error:', err);
		res.status(500).json({ error: 'Failed to get methodology' });
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// V2 ADMIN / RECRUITER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/trustscore/brigading-check — Check for suspicious review patterns
 * Recruiter only
 */
router.get('/brigading-check', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const { lookback_days = 30 } = req.query;
		const report = await trustscoreService.detectReviewBrigading(
			req.user.company_id,
			parseInt(lookback_days, 10),
		);

		res.json({
			success: true,
			...report,
		});
	} catch (err) {
		console.error('Brigading check error:', err);
		res.status(500).json({ error: 'Failed to check for brigading' });
	}
});

/**
 * POST /api/trustscore/regenerate-summary — Force AI summary regeneration
 * Recruiter only
 */
router.post('/regenerate-summary', authMiddleware, requireApprovedRecruiter, requireRecruiter, async (req, res) => {
	try {
		const summary = await trustscoreService.generateAISummary(req.user.company_id);

		res.json({
			success: true,
			message: 'AI summary regenerated',
			summary,
		});
	} catch (err) {
		console.error('Regenerate summary error:', err);
		res.status(500).json({ error: 'Failed to regenerate summary' });
	}
});

/**
 * GET /api/trustscore/public/:companySlug — Legacy public endpoint (preserved)
 */
router.get('/public/:companySlug', async (req, res) => {
	try {
		const result = await pool.query(
			`
      SELECT ts.total_score, ts.score_tier, ts.verification_score,
             ts.job_authenticity_score, ts.feedback_score,
             c.name as company_name, c.is_verified
      FROM companies c
      JOIN trust_scores ts ON c.id = ts.company_id
      WHERE c.slug = $1
    `,
			[req.params.companySlug],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const data = result.rows[0];
		const tierInfo = trustscoreService.TRUST_SCORE_RANGES.TIERS[data.score_tier];

		res.json({
			success: true,
			trustscore: {
				score: data.total_score,
				tier: data.score_tier,
				tier_label: tierInfo?.label || 'Unknown',
				tier_color: tierInfo?.color || '#94a3b8',
				is_verified: data.is_verified,
				company_name: data.company_name,
				badges: [
					data.is_verified && { type: 'verified', label: 'Verified Company' },
					data.total_score >= 800 && { type: 'trusted', label: 'Highly Trusted' },
					data.feedback_score >= 160 && { type: 'candidate_approved', label: 'Candidate Approved' },
				].filter(Boolean),
			},
		});
	} catch (err) {
		console.error('Get public TrustScore error:', err);
		res.status(500).json({ error: 'Failed to get TrustScore' });
	}
});

module.exports = router;
