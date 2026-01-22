// OmniScore API Routes
const express = require('express');
const { authMiddleware } = require('../lib/auth');
const omniscoreService = require('../services/omniscore');

const router = express.Router();

// Get current OmniScore
router.get('/', authMiddleware, async (req, res) => {
  try {
    const score = await omniscoreService.getOrCreateScore(req.user.id);
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

    res.json({
      success: true,
      ...breakdown
    });
  } catch (err) {
    console.error('Get score breakdown error:', err);
    res.status(500).json({ error: 'Failed to get score breakdown' });
  }
});

// Get role-specific scores
router.get('/roles', authMiddleware, async (req, res) => {
  try {
    const roleScores = await omniscoreService.getRoleScores(req.user.id);

    res.json({
      success: true,
      role_scores: roleScores
    });
  } catch (err) {
    console.error('Get role scores error:', err);
    res.status(500).json({ error: 'Failed to get role scores' });
  }
});

// Get score history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const pool = require('../lib/db');
    const { limit = 20 } = req.query;

    const result = await pool.query(`
      SELECT previous_score, new_score, change_amount, change_reason, component_type, created_at
      FROM score_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [req.user.id, limit]);

    res.json({
      success: true,
      history: result.rows
    });
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

    res.json({
      success: true,
      current_score: currentScores.total_score,
      recommendations
    });
  } catch (err) {
    console.error('Get recommendations error:', err);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Record daily login (behavior component)
router.post('/checkin', authMiddleware, async (req, res) => {
  try {
    const pool = require('../lib/db');

    // Check if already checked in today
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

    // Add daily login points
    const newScore = await omniscoreService.addBehaviorComponent(
      req.user.id,
      'daily_login',
      5, // 5 points per daily login
      10
    );

    res.json({
      success: true,
      new_score: newScore.total_score,
      points_earned: 5
    });
  } catch (err) {
    console.error('Checkin error:', err);
    res.status(500).json({ error: 'Failed to record check-in' });
  }
});

module.exports = router;
