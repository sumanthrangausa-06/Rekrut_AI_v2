// TrustScore API Routes
const express = require('express');
const { authMiddleware } = require('../lib/auth');
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

// Get current TrustScore
router.get('/', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const score = await trustscoreService.getOrCreateTrustScore(req.user.company_id);
    const currentScores = await trustscoreService.calculateTrustScore(req.user.company_id);

    res.json({
      success: true,
      trustscore: currentScores
    });
  } catch (err) {
    console.error('Get TrustScore error:', err);
    res.status(500).json({ error: 'Failed to get TrustScore' });
  }
});

// Get detailed score breakdown
router.get('/breakdown', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const breakdown = await trustscoreService.getTrustScoreBreakdown(req.user.company_id);

    res.json({
      success: true,
      ...breakdown
    });
  } catch (err) {
    console.error('Get TrustScore breakdown error:', err);
    res.status(500).json({ error: 'Failed to get TrustScore breakdown' });
  }
});

// Get score history
router.get('/history', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const { limit = 30 } = req.query;

    const result = await pool.query(`
      SELECT previous_score, new_score, change_amount, change_reason, component_type, created_at
      FROM trust_score_history
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [req.user.company_id, limit]);

    res.json({
      success: true,
      history: result.rows
    });
  } catch (err) {
    console.error('Get TrustScore history error:', err);
    res.status(500).json({ error: 'Failed to get TrustScore history' });
  }
});

// Get recommendations
router.get('/recommendations', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const currentScores = await trustscoreService.calculateTrustScore(req.user.company_id);
    const recommendations = trustscoreService.generateTrustRecommendations(currentScores);

    res.json({
      success: true,
      current_score: currentScores.total_score,
      tier: currentScores.tier,
      recommendations
    });
  } catch (err) {
    console.error('Get TrustScore recommendations error:', err);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Get hiring analytics (for TrustScore dashboard)
router.get('/analytics', authMiddleware, requireRecruiter, async (req, res) => {
  try {
    const companyId = req.user.company_id;

    // Get overall stats
    const stats = await pool.query(`
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
    `, [companyId]);

    // Get recent applications
    const recentApplications = await pool.query(`
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
    `, [companyId]);

    // Get average feedback rating
    const feedback = await pool.query(`
      SELECT
        AVG(rating) as avg_rating,
        AVG(communication_rating) as avg_communication,
        AVG(process_rating) as avg_process,
        COUNT(*) as total_reviews
      FROM candidate_feedback
      WHERE company_id = $1
    `, [companyId]);

    // Calculate interview-to-offer ratio
    const { total_interviews, total_offers } = stats.rows[0];
    const ratio = total_interviews > 0
      ? ((total_offers / total_interviews) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      analytics: {
        ...stats.rows[0],
        interview_to_offer_ratio: ratio + '%',
        avg_rating: feedback.rows[0].avg_rating
          ? parseFloat(feedback.rows[0].avg_rating).toFixed(1)
          : null,
        avg_communication: feedback.rows[0].avg_communication
          ? parseFloat(feedback.rows[0].avg_communication).toFixed(1)
          : null,
        avg_process: feedback.rows[0].avg_process
          ? parseFloat(feedback.rows[0].avg_process).toFixed(1)
          : null,
        total_reviews: parseInt(feedback.rows[0].total_reviews)
      },
      recent_applications: recentApplications.rows
    });
  } catch (err) {
    console.error('Get analytics error:', err);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Get public TrustScore for a company (for candidates to see)
router.get('/public/:companySlug', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ts.total_score, ts.score_tier, ts.verification_score,
             ts.job_authenticity_score, ts.feedback_score,
             c.name as company_name, c.is_verified
      FROM companies c
      JOIN trust_scores ts ON c.id = ts.company_id
      WHERE c.slug = $1
    `, [req.params.companySlug]);

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
          data.feedback_score >= 160 && { type: 'candidate_approved', label: 'Candidate Approved' }
        ].filter(Boolean)
      }
    });
  } catch (err) {
    console.error('Get public TrustScore error:', err);
    res.status(500).json({ error: 'Failed to get TrustScore' });
  }
});

module.exports = router;
