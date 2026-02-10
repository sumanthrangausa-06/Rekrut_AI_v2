// OmniScore v2 API Routes - Two-Sided Scoring System
const express = require('express');
const { authMiddleware } = require('../lib/auth');
const omniscoreService = require('../services/omniscore');
const trustscoreService = require('../services/trustscore');
const { AuditLogger } = require('../services/auditLogger');
const pool = require('../lib/db');

const router = express.Router();

// ============================================================
// CANDIDATE ENDPOINTS (their own score)
// ============================================================

// Get current OmniScore
router.get('/', authMiddleware, async (req, res) => {
  try {
    await omniscoreService.getOrCreateScore(req.user.id);
    const currentScores = await omniscoreService.calculateScore(req.user.id);

    res.json({
      success: true,
      omniscore: currentScores
    });
  } catch (err) {
    console.error('Get OmniScore error:', err);
    res.status(500).json({ error: 'Failed to get OmniScore' });
  }
});

// Get detailed score breakdown
router.get('/breakdown', authMiddleware, async (req, res) => {
  try {
    const breakdown = await omniscoreService.getScoreBreakdown(req.user.id);
    res.json({ success: true, ...breakdown });
  } catch (err) {
    console.error('Get score breakdown error:', err);
    res.status(500).json({ error: 'Failed to get score breakdown' });
  }
});

// Get role-specific scores
router.get('/roles', authMiddleware, async (req, res) => {
  try {
    const roleScores = await omniscoreService.getRoleScores(req.user.id);
    res.json({ success: true, role_scores: roleScores });
  } catch (err) {
    console.error('Get role scores error:', err);
    res.status(500).json({ error: 'Failed to get role scores' });
  }
});

// Get score history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const result = await pool.query(`
      SELECT previous_score, new_score, change_amount, change_reason, component_type, created_at
      FROM score_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [req.user.id, limit]);

    res.json({ success: true, history: result.rows });
  } catch (err) {
    console.error('Get score history error:', err);
    res.status(500).json({ error: 'Failed to get score history' });
  }
});

// Get recommendations to improve score
router.get('/recommendations', authMiddleware, async (req, res) => {
  try {
    const currentScores = await omniscoreService.calculateScore(req.user.id);
    const recommendations = omniscoreService.generateRecommendations(currentScores);
    res.json({ success: true, current_score: currentScores.total_score, recommendations });
  } catch (err) {
    console.error('Get recommendations error:', err);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Record daily login (behavior component)
router.post('/checkin', authMiddleware, async (req, res) => {
  try {
    const today = await pool.query(`
      SELECT id FROM score_components
      WHERE user_id = $1
        AND component_type = 'behavior'
        AND source_type = 'daily_login'
        AND DATE(created_at) = CURRENT_DATE
    `, [req.user.id]);

    if (today.rows.length > 0) {
      return res.json({ success: true, already_checked_in: true });
    }

    const newScore = await omniscoreService.addBehaviorComponent(req.user.id, 'daily_login', 5, 10);

    res.json({ success: true, new_score: newScore.total_score, points_earned: 5 });
  } catch (err) {
    console.error('Checkin error:', err);
    res.status(500).json({ error: 'Failed to record check-in' });
  }
});

// ============================================================
// COMPANY SCORE ENDPOINTS (for candidates to view & rate)
// ============================================================

// Get company score (public for candidates to see)
router.get('/company-score/:companyId', authMiddleware, async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId);

    // Get TrustScore
    const trustScore = await trustscoreService.getOrCreateTrustScore(companyId);
    const calculated = await trustscoreService.calculateTrustScore(companyId);

    // Get company info
    const companyResult = await pool.query(`
      SELECT c.name, c.slug, c.logo_url, c.industry, c.company_size, c.is_verified,
             c.website, c.headquarters, c.description
      FROM companies c WHERE c.id = $1
    `, [companyId]);

    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Get aggregated candidate ratings
    const ratingsResult = await pool.query(`
      SELECT
        COUNT(*) as total_ratings,
        ROUND(AVG(overall_rating)::numeric, 1) as avg_overall,
        ROUND(AVG(interview_experience)::numeric, 1) as avg_interview,
        ROUND(AVG(communication)::numeric, 1) as avg_communication,
        ROUND(AVG(transparency)::numeric, 1) as avg_transparency,
        ROUND(AVG(work_life_balance)::numeric, 1) as avg_work_life,
        ROUND(AVG(culture)::numeric, 1) as avg_culture,
        ROUND(AVG(growth_opportunity)::numeric, 1) as avg_growth
      FROM company_ratings
      WHERE company_id = $1 AND status = 'published'
    `, [companyId]);

    // Get recent reviews (anonymous)
    const reviewsResult = await pool.query(`
      SELECT overall_rating, interview_experience, communication, transparency,
             review_text, pros, cons, created_at
      FROM company_ratings
      WHERE company_id = $1 AND status = 'published'
      ORDER BY created_at DESC
      LIMIT 10
    `, [companyId]);

    // Check if current user has already rated
    let userRating = null;
    if (req.user && req.user.role === 'candidate') {
      const userRatingResult = await pool.query(
        'SELECT * FROM company_ratings WHERE company_id = $1 AND candidate_id = $2',
        [companyId, req.user.id]
      );
      userRating = userRatingResult.rows[0] || null;
    }

    const tierInfo = trustscoreService.TRUST_SCORE_RANGES.TIERS[calculated.tier];

    res.json({
      success: true,
      company: companyResult.rows[0],
      trust_score: {
        score: calculated.total_score,
        tier: calculated.tier,
        tier_label: tierInfo?.label || 'New Employer',
        tier_color: tierInfo?.color || '#94a3b8',
        breakdown: {
          verification: { score: calculated.verification, max: 200, label: 'Company Verification' },
          job_authenticity: { score: calculated.job_authenticity, max: 250, label: 'Job Authenticity' },
          hiring_ratio: { score: calculated.hiring_ratio, max: 250, label: 'Hiring Track Record' },
          feedback: { score: calculated.feedback, max: 200, label: 'Candidate Feedback' },
          behavior: { score: calculated.behavior, max: 100, label: 'Platform Activity' }
        }
      },
      candidate_ratings: {
        summary: ratingsResult.rows[0],
        reviews: reviewsResult.rows
      },
      user_rating: userRating
    });
  } catch (err) {
    console.error('Get company score error:', err);
    res.status(500).json({ error: 'Failed to get company score' });
  }
});

// Rate a company (candidates only)
router.post('/rate-company', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'candidate') {
      return res.status(403).json({ error: 'Only candidates can rate companies' });
    }

    const {
      company_id, job_id,
      overall_rating, interview_experience, communication, transparency,
      work_life_balance, culture, growth_opportunity,
      review_text, pros, cons, is_anonymous
    } = req.body;

    if (!company_id || !overall_rating) {
      return res.status(400).json({ error: 'company_id and overall_rating are required' });
    }

    // Validate ratings are 1-5
    const ratings = { overall_rating, interview_experience, communication, transparency,
      work_life_balance, culture, growth_opportunity };
    for (const [key, val] of Object.entries(ratings)) {
      if (val !== undefined && val !== null && (val < 1 || val > 5)) {
        return res.status(400).json({ error: `${key} must be between 1 and 5` });
      }
    }

    // Upsert rating
    const result = await pool.query(`
      INSERT INTO company_ratings (
        company_id, candidate_id, job_id,
        overall_rating, interview_experience, communication, transparency,
        work_life_balance, culture, growth_opportunity,
        review_text, pros, cons, is_anonymous
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (company_id, candidate_id) DO UPDATE SET
        job_id = COALESCE(EXCLUDED.job_id, company_ratings.job_id),
        overall_rating = EXCLUDED.overall_rating,
        interview_experience = EXCLUDED.interview_experience,
        communication = EXCLUDED.communication,
        transparency = EXCLUDED.transparency,
        work_life_balance = EXCLUDED.work_life_balance,
        culture = EXCLUDED.culture,
        growth_opportunity = EXCLUDED.growth_opportunity,
        review_text = EXCLUDED.review_text,
        pros = EXCLUDED.pros,
        cons = EXCLUDED.cons,
        is_anonymous = EXCLUDED.is_anonymous,
        updated_at = NOW()
      RETURNING *
    `, [company_id, req.user.id, job_id || null,
        overall_rating, interview_experience || null, communication || null, transparency || null,
        work_life_balance || null, culture || null, growth_opportunity || null,
        review_text || null, pros || null, cons || null, is_anonymous !== false]);

    // Also update the TrustScore feedback component
    try {
      await trustscoreService.addFeedbackComponent(company_id, result.rows[0].id, overall_rating);
    } catch (e) {
      console.warn('Failed to update TrustScore feedback:', e.message);
    }

    await AuditLogger.log({
      actionType: 'company_rated',
      userId: req.user.id,
      targetType: 'company',
      targetId: company_id,
      metadata: { overall_rating, company_id },
      req
    });

    res.json({ success: true, rating: result.rows[0] });
  } catch (err) {
    console.error('Rate company error:', err);
    res.status(500).json({ error: 'Failed to rate company' });
  }
});

// Get companies the candidate can rate (applied/interviewed/offered)
router.get('/ratable-companies', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'candidate') {
      return res.status(403).json({ error: 'Only candidates can view ratable companies' });
    }

    const result = await pool.query(`
      SELECT DISTINCT c.id as company_id, c.name, c.logo_url, c.industry, c.is_verified,
             ja.status as application_status, j.title as job_title, j.id as job_id,
             ts.total_score as trust_score, ts.score_tier,
             cr.overall_rating as my_rating
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      JOIN companies c ON ja.company_id = c.id
      LEFT JOIN trust_scores ts ON c.id = ts.company_id
      LEFT JOIN company_ratings cr ON c.id = cr.company_id AND cr.candidate_id = $1
      WHERE ja.candidate_id = $1
        AND ja.status IN ('applied', 'interviewed', 'offered', 'hired')
      ORDER BY ja.applied_at DESC
    `, [req.user.id]);

    res.json({ success: true, companies: result.rows });
  } catch (err) {
    console.error('Get ratable companies error:', err);
    res.status(500).json({ error: 'Failed to get ratable companies' });
  }
});

// ============================================================
// MUTUAL MATCHING ENDPOINTS
// ============================================================

// Get mutual matches for a candidate
router.get('/mutual-matches', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'candidate') {
      return res.status(403).json({ error: 'Only candidates can view mutual matches' });
    }

    // Get candidate's OmniScore
    await omniscoreService.getOrCreateScore(req.user.id);
    const candidateScores = await omniscoreService.calculateScore(req.user.id);

    // Find jobs where the candidate applied or was matched AND the company has a decent score
    const result = await pool.query(`
      SELECT
        j.id as job_id, j.title, j.location, j.salary_range, j.job_type,
        c.id as company_id, c.name as company_name, c.logo_url, c.industry, c.is_verified,
        ts.total_score as company_trust_score, ts.score_tier as company_tier,
        ja.status as application_status,
        mr.weighted_score as match_score, mr.match_level,
        COALESCE(
          ROUND(AVG(cr.overall_rating)::numeric, 1),
          0
        ) as avg_company_rating,
        COUNT(cr.id) as rating_count
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      LEFT JOIN trust_scores ts ON c.id = ts.company_id
      LEFT JOIN job_applications ja ON ja.job_id = j.id AND ja.candidate_id = $1
      LEFT JOIN match_results mr ON mr.job_id = j.id AND mr.candidate_id = $1
      LEFT JOIN company_ratings cr ON cr.company_id = c.id AND cr.status = 'published'
      WHERE j.status = 'active'
        AND (ja.candidate_id = $1 OR mr.candidate_id = $1)
      GROUP BY j.id, j.title, j.location, j.salary_range, j.job_type,
               c.id, c.name, c.logo_url, c.industry, c.is_verified,
               ts.total_score, ts.score_tier, ja.status,
               mr.weighted_score, mr.match_level
      ORDER BY
        COALESCE(mr.weighted_score, 0) + COALESCE(ts.total_score, 0) / 20 DESC
      LIMIT 20
    `, [req.user.id]);

    // Calculate mutual fit for each
    const matches = result.rows.map(row => {
      const candidateStrength = (candidateScores.total_score - 300) / 550; // 0-1 scale
      const companyStrength = (row.company_trust_score || 500) / 1000; // 0-1 scale
      const matchStrength = (row.match_score || 50) / 100; // 0-1 scale

      // Mutual fit: geometric mean of all three signals
      const mutualFit = Math.round(
        Math.pow(candidateStrength * companyStrength * matchStrength, 1/3) * 100
      );

      let mutualLevel = 'low';
      if (mutualFit >= 80) mutualLevel = 'excellent';
      else if (mutualFit >= 65) mutualLevel = 'good';
      else if (mutualFit >= 50) mutualLevel = 'fair';

      return {
        ...row,
        your_omniscore: candidateScores.total_score,
        your_tier: candidateScores.tier_label,
        mutual_fit_score: mutualFit,
        mutual_level: mutualLevel,
        signals: {
          your_score: `OmniScore ${candidateScores.total_score} (${candidateScores.tier_label})`,
          company_score: `TrustScore ${row.company_trust_score || 'N/A'} (${row.company_tier || 'new'})`,
          skill_match: `${Math.round(row.match_score || 0)}% match`
        }
      };
    });

    res.json({
      success: true,
      your_omniscore: candidateScores,
      mutual_matches: matches,
      explanation: 'Mutual fit combines your OmniScore, company TrustScore, and skill match into a single compatibility score.'
    });
  } catch (err) {
    console.error('Get mutual matches error:', err);
    res.status(500).json({ error: 'Failed to get mutual matches' });
  }
});

// ============================================================
// RECRUITER ENDPOINTS
// ============================================================

// Get candidate's OmniScore (recruiter viewing a candidate)
router.get('/candidate/:candidateId', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'admin', 'employer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const candidateId = parseInt(req.params.candidateId);
    await omniscoreService.getOrCreateScore(candidateId);
    const scores = await omniscoreService.calculateScore(candidateId);
    const roleScores = await omniscoreService.getRoleScores(candidateId);

    // Get candidate info
    const candidateResult = await pool.query(`
      SELECT u.name, u.email, u.avatar_url, cp.headline, cp.location, cp.years_experience
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1
    `, [candidateId]);

    res.json({
      success: true,
      candidate: candidateResult.rows[0] || {},
      omniscore: scores,
      role_scores: roleScores
    });
  } catch (err) {
    console.error('Get candidate OmniScore error:', err);
    res.status(500).json({ error: 'Failed to get candidate OmniScore' });
  }
});

// Get ranked candidates with OmniScores (recruiter dashboard)
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'admin', 'employer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const { limit = 50, min_score = 0, tier } = req.query;

    let query = `
      SELECT os.*, u.name, u.email, u.avatar_url,
             cp.headline, cp.location, cp.years_experience,
             (SELECT COUNT(*) FROM job_applications ja WHERE ja.candidate_id = u.id AND ja.company_id = $1) as applications_count
      FROM omni_scores os
      JOIN users u ON os.user_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE u.role = 'candidate'
        AND os.total_score >= $2
    `;
    const params = [req.user.company_id || 0, parseInt(min_score)];

    if (tier) {
      query += ` AND os.score_tier = $${params.length + 1}`;
      params.push(tier);
    }

    query += ` ORDER BY os.total_score DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    // Get score tier distribution
    const distribution = await pool.query(`
      SELECT score_tier, COUNT(*) as count
      FROM omni_scores os
      JOIN users u ON os.user_id = u.id
      WHERE u.role = 'candidate'
      GROUP BY score_tier
      ORDER BY
        CASE score_tier
          WHEN 'exceptional' THEN 1
          WHEN 'excellent' THEN 2
          WHEN 'good' THEN 3
          WHEN 'fair' THEN 4
          WHEN 'needs_work' THEN 5
          ELSE 6
        END
    `);

    res.json({
      success: true,
      candidates: result.rows,
      distribution: distribution.rows,
      score_ranges: omniscoreService.SCORE_RANGES
    });
  } catch (err) {
    console.error('Get leaderboard error:', err);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// Get company's own TrustScore + feedback summary (recruiter)
router.get('/company-dashboard', authMiddleware, async (req, res) => {
  try {
    if (!['recruiter', 'hiring_manager', 'admin', 'employer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const companyId = req.user.company_id;
    if (!companyId) {
      return res.status(400).json({ error: 'No company associated with account' });
    }

    // Get TrustScore
    await trustscoreService.getOrCreateTrustScore(companyId);
    const trustScores = await trustscoreService.calculateTrustScore(companyId);
    const tierInfo = trustscoreService.TRUST_SCORE_RANGES.TIERS[trustScores.tier];

    // Get candidate ratings
    const ratingsResult = await pool.query(`
      SELECT
        COUNT(*) as total_ratings,
        ROUND(AVG(overall_rating)::numeric, 1) as avg_overall,
        ROUND(AVG(interview_experience)::numeric, 1) as avg_interview,
        ROUND(AVG(communication)::numeric, 1) as avg_communication,
        ROUND(AVG(transparency)::numeric, 1) as avg_transparency,
        ROUND(AVG(work_life_balance)::numeric, 1) as avg_work_life,
        ROUND(AVG(culture)::numeric, 1) as avg_culture,
        ROUND(AVG(growth_opportunity)::numeric, 1) as avg_growth
      FROM company_ratings
      WHERE company_id = $1 AND status = 'published'
    `, [companyId]);

    // Get recent reviews
    const reviewsResult = await pool.query(`
      SELECT cr.overall_rating, cr.interview_experience, cr.communication,
             cr.review_text, cr.pros, cr.cons, cr.created_at,
             CASE WHEN cr.is_anonymous THEN 'Anonymous' ELSE u.name END as reviewer_name
      FROM company_ratings cr
      LEFT JOIN users u ON cr.candidate_id = u.id
      WHERE cr.company_id = $1 AND cr.status = 'published'
      ORDER BY cr.created_at DESC
      LIMIT 10
    `, [companyId]);

    // Get hiring funnel stats
    const funnelResult = await pool.query(`
      SELECT
        COUNT(*) as total_applications,
        COUNT(*) FILTER (WHERE status = 'reviewing') as reviewing,
        COUNT(*) FILTER (WHERE status = 'interviewed') as interviewed,
        COUNT(*) FILTER (WHERE status = 'offered') as offered,
        COUNT(*) FILTER (WHERE status = 'hired') as hired,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        ROUND(AVG(omniscore_at_apply)::numeric) as avg_applicant_omniscore
      FROM job_applications
      WHERE company_id = $1
    `, [companyId]);

    // TrustScore recommendations
    const recommendations = trustscoreService.generateTrustRecommendations(trustScores);

    res.json({
      success: true,
      trust_score: {
        score: trustScores.total_score,
        tier: trustScores.tier,
        tier_label: tierInfo?.label || 'New Employer',
        tier_color: tierInfo?.color || '#94a3b8',
        breakdown: {
          verification: { score: trustScores.verification, max: 200, label: 'Company Verification' },
          job_authenticity: { score: trustScores.job_authenticity, max: 250, label: 'Job Authenticity' },
          hiring_ratio: { score: trustScores.hiring_ratio, max: 250, label: 'Hiring Track Record' },
          feedback: { score: trustScores.feedback, max: 200, label: 'Candidate Feedback' },
          behavior: { score: trustScores.behavior, max: 100, label: 'Platform Activity' }
        }
      },
      candidate_ratings: {
        summary: ratingsResult.rows[0],
        reviews: reviewsResult.rows
      },
      hiring_funnel: funnelResult.rows[0],
      recommendations
    });
  } catch (err) {
    console.error('Get company dashboard error:', err);
    res.status(500).json({ error: 'Failed to get company dashboard' });
  }
});

module.exports = router;
