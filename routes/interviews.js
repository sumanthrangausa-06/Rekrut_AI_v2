const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { generateInterviewQuestions, analyzeInterviewResponse, generateOverallFeedback } = require('../lib/polsia-ai');
const omniscoreService = require('../services/omniscore');

const router = express.Router();

// Start a new interview
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const { job_id, job_title, job_description, interview_type = 'mock' } = req.body;

    // Generate questions using AI
    const questions = await generateInterviewQuestions(
      job_title || 'Software Developer',
      job_description,
      5
    );

    // Create interview record
    const result = await pool.query(
      `INSERT INTO interviews (user_id, job_id, interview_type, questions, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       RETURNING *`,
      [req.user.id, job_id, interview_type, JSON.stringify(questions)]
    );

    res.json({
      success: true,
      interview: result.rows[0],
      questions: questions.map((q, i) => ({
        index: i,
        question: q.question,
        category: q.category,
        difficulty: q.difficulty
      }))
    });
  } catch (err) {
    console.error('Start interview error:', err);
    res.status(500).json({ error: 'Failed to start interview' });
  }
});

// Submit response to a question
router.post('/:id/respond', authMiddleware, async (req, res) => {
  try {
    const { question_index, response_text, video_url } = req.body;

    // Get interview
    const interview = await pool.query(
      'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (interview.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    const interviewData = interview.rows[0];
    const questions = interviewData.questions;
    const question = questions[question_index];

    if (!question) {
      return res.status(400).json({ error: 'Invalid question index' });
    }

    // Analyze response with AI
    const analysis = await analyzeInterviewResponse(
      question.question,
      response_text,
      question.key_points || [],
      { subscriptionId: req.user.stripe_subscription_id }
    );

    // Update responses array
    const responses = interviewData.responses || [];
    responses[question_index] = {
      question_index,
      response_text,
      video_url,
      analysis,
      submitted_at: new Date().toISOString()
    };

    // Update video URLs if provided
    const videoUrls = interviewData.video_urls || [];
    if (video_url) {
      videoUrls[question_index] = video_url;
    }

    await pool.query(
      `UPDATE interviews SET responses = $1, video_urls = $2, updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(responses), JSON.stringify(videoUrls), req.params.id]
    );

    res.json({
      success: true,
      analysis,
      questions_remaining: questions.length - responses.filter(r => r).length
    });
  } catch (err) {
    console.error('Submit response error:', err);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

// Complete interview and get overall feedback
router.post('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const interview = await pool.query(
      'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (interview.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    const interviewData = interview.rows[0];
    const responses = interviewData.responses || [];
    const validResponses = responses.filter(r => r && r.analysis);

    if (validResponses.length === 0) {
      return res.status(400).json({ error: 'No responses to evaluate' });
    }

    // Generate overall feedback
    const overallFeedback = await generateOverallFeedback(
      validResponses.map(r => r.analysis),
      { subscriptionId: req.user.stripe_subscription_id }
    );

    // Calculate duration
    const startTime = new Date(interviewData.created_at);
    const duration = Math.floor((Date.now() - startTime.getTime()) / 1000);

    // Update interview record
    await pool.query(
      `UPDATE interviews SET
        status = 'completed',
        ai_feedback = $1,
        overall_score = $2,
        duration_seconds = $3,
        completed_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(overallFeedback), overallFeedback.overall_score, duration, req.params.id]
    );

    // Update OmniScore with interview results
    let omniscoreUpdate = null;
    try {
      omniscoreUpdate = await omniscoreService.addInterviewComponent(
        req.user.id,
        req.params.id,
        overallFeedback.overall_score
      );

      // Update role-specific score if job title is available
      if (interviewData.job_id) {
        const job = await pool.query('SELECT title FROM jobs WHERE id = $1', [interviewData.job_id]);
        if (job.rows.length > 0) {
          await omniscoreService.updateRoleScore(
            req.user.id,
            job.rows[0].title,
            overallFeedback.overall_score
          );
        }
      }
    } catch (scoreErr) {
      console.error('OmniScore update error:', scoreErr);
      // Don't fail the request if OmniScore update fails
    }

    res.json({
      success: true,
      overall_feedback: overallFeedback,
      duration_seconds: duration,
      response_count: validResponses.length,
      omniscore: omniscoreUpdate
    });
  } catch (err) {
    console.error('Complete interview error:', err);
    res.status(500).json({ error: 'Failed to complete interview' });
  }
});

// Get interview history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT i.*, j.title as job_title, j.company as job_company
       FROM interviews i
       LEFT JOIN jobs j ON i.job_id = j.id
       WHERE i.user_id = $1
       ORDER BY i.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    res.json({ interviews: result.rows });
  } catch (err) {
    console.error('Get history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get interview details
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*, j.title as job_title, j.company as job_company
       FROM interviews i
       LEFT JOIN jobs j ON i.job_id = j.id
       WHERE i.id = $1 AND i.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    res.json({ interview: result.rows[0] });
  } catch (err) {
    console.error('Get interview error:', err);
    res.status(500).json({ error: 'Failed to fetch interview' });
  }
});

// Get stats for dashboard
router.get('/stats/summary', authMiddleware, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT
        COUNT(*) as total_interviews,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        AVG(CASE WHEN overall_score IS NOT NULL THEN overall_score END) as avg_score,
        MAX(overall_score) as best_score
       FROM interviews
       WHERE user_id = $1`,
      [req.user.id]
    );

    const recentScores = await pool.query(
      `SELECT overall_score, created_at
       FROM interviews
       WHERE user_id = $1 AND status = 'completed' AND overall_score IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.user.id]
    );

    res.json({
      stats: stats.rows[0],
      recent_scores: recentScores.rows
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;