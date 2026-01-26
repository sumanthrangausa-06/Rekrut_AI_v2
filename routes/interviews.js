const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { generateInterviewQuestions, analyzeInterviewResponse, generateOverallFeedback, generateInterviewCoaching } = require('../lib/polsia-ai');
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

// =============== INTERVIEW PRACTICE & COACHING ===============

// Get practice question library
router.get('/practice/library', authMiddleware, async (req, res) => {
  try {
    // Predefined question library organized by category
    const questionLibrary = [
      // Behavioral Questions
      {
        id: 'beh-1',
        category: 'behavioral',
        difficulty: 'Medium',
        question: 'Tell me about a time when you had to deal with a difficult team member. How did you handle it?',
        key_points: ['Conflict resolution', 'Communication skills', 'Team dynamics', 'Professional approach']
      },
      {
        id: 'beh-2',
        category: 'behavioral',
        difficulty: 'Medium',
        question: 'Describe a situation where you failed at something. What did you learn from it?',
        key_points: ['Self-awareness', 'Learning from mistakes', 'Growth mindset', 'Accountability']
      },
      {
        id: 'beh-3',
        category: 'behavioral',
        difficulty: 'Hard',
        question: 'Tell me about a time when you had to make a difficult decision with incomplete information.',
        key_points: ['Decision-making', 'Risk assessment', 'Critical thinking', 'Taking initiative']
      },
      {
        id: 'beh-4',
        category: 'behavioral',
        difficulty: 'Easy',
        question: 'What motivates you to come to work every day?',
        key_points: ['Passion', 'Career goals', 'Work ethic', 'Cultural fit']
      },
      {
        id: 'beh-5',
        category: 'behavioral',
        difficulty: 'Medium',
        question: 'Describe a time when you went above and beyond your job responsibilities.',
        key_points: ['Initiative', 'Dedication', 'Problem-solving', 'Impact']
      },

      // Technical Questions
      {
        id: 'tech-1',
        category: 'technical',
        difficulty: 'Medium',
        question: 'Walk me through how you would approach debugging a critical production issue.',
        key_points: ['Systematic approach', 'Problem-solving', 'Communication', 'Technical knowledge']
      },
      {
        id: 'tech-2',
        category: 'technical',
        difficulty: 'Hard',
        question: 'How would you design a system to handle 1 million concurrent users?',
        key_points: ['Scalability', 'Architecture', 'Trade-offs', 'Technical depth']
      },
      {
        id: 'tech-3',
        category: 'technical',
        difficulty: 'Medium',
        question: 'Explain a complex technical concept to someone without a technical background.',
        key_points: ['Communication', 'Simplification', 'Analogies', 'Clarity']
      },
      {
        id: 'tech-4',
        category: 'technical',
        difficulty: 'Easy',
        question: 'What are your favorite tools or technologies, and why?',
        key_points: ['Technical passion', 'Learning', 'Practical experience', 'Reasoning']
      },

      // Situational Questions
      {
        id: 'sit-1',
        category: 'situational',
        difficulty: 'Medium',
        question: 'If you were given a project with an impossible deadline, how would you handle it?',
        key_points: ['Time management', 'Communication', 'Prioritization', 'Stakeholder management']
      },
      {
        id: 'sit-2',
        category: 'situational',
        difficulty: 'Hard',
        question: 'You discover your manager is making a decision you strongly disagree with. What do you do?',
        key_points: ['Professional disagreement', 'Communication', 'Respect', 'Problem-solving']
      },
      {
        id: 'sit-3',
        category: 'situational',
        difficulty: 'Medium',
        question: 'How would you handle a situation where you need to learn a new technology quickly?',
        key_points: ['Learning agility', 'Resourcefulness', 'Time management', 'Adaptability']
      },
      {
        id: 'sit-4',
        category: 'situational',
        difficulty: 'Easy',
        question: 'What would you do if you noticed a coworker was struggling with their workload?',
        key_points: ['Teamwork', 'Empathy', 'Communication', 'Collaboration']
      }
    ];

    // Get user's practice history for this question
    const practiceHistory = await pool.query(
      `SELECT question_id, COUNT(*) as times_practiced,
              MAX(score) as best_score,
              AVG(score) as avg_score,
              MAX(created_at) as last_practiced
       FROM practice_sessions
       WHERE user_id = $1
       GROUP BY question_id`,
      [req.user.id]
    );

    const historyMap = {};
    practiceHistory.rows.forEach(row => {
      historyMap[row.question_id] = {
        times_practiced: parseInt(row.times_practiced),
        last_score: row.best_score,
        avg_score: parseFloat(row.avg_score),
        last_practiced: row.last_practiced
      };
    });

    // Enrich questions with user's practice data
    const enrichedQuestions = questionLibrary.map(q => ({
      ...q,
      times_practiced: historyMap[q.id]?.times_practiced || 0,
      last_score: historyMap[q.id]?.last_score || null,
      avg_score: historyMap[q.id]?.avg_score || null,
      last_practiced: historyMap[q.id]?.last_practiced || null
    }));

    res.json({
      success: true,
      questions: enrichedQuestions
    });
  } catch (err) {
    console.error('Get practice library error:', err);
    res.status(500).json({ error: 'Failed to fetch question library' });
  }
});

// Submit practice response and get AI coaching
router.post('/practice/submit', authMiddleware, async (req, res) => {
  try {
    const { question_id, question, category, response_text } = req.body;

    if (!response_text || response_text.trim().length < 50) {
      return res.status(400).json({ error: 'Response must be at least 50 characters' });
    }

    // First, analyze the response
    const analysis = await analyzeInterviewResponse(
      question,
      response_text,
      [], // key_points not needed for practice
      { subscriptionId: req.user.stripe_subscription_id }
    );

    // Then, generate detailed coaching
    const coaching = await generateInterviewCoaching(
      question,
      response_text,
      analysis,
      { subscriptionId: req.user.stripe_subscription_id }
    );

    // Combine analysis and coaching
    const fullCoaching = {
      score: analysis.score,
      strengths: analysis.strengths,
      improvements: analysis.improvements,
      ...coaching
    };

    // Save practice session
    await pool.query(
      `INSERT INTO practice_sessions
       (user_id, question_id, question, category, response_text, score, coaching_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        req.user.id,
        question_id,
        question,
        category,
        response_text,
        analysis.score,
        JSON.stringify(fullCoaching)
      ]
    );

    res.json({
      success: true,
      coaching: fullCoaching
    });
  } catch (err) {
    console.error('Submit practice response error:', err);
    res.status(500).json({ error: 'Failed to analyze response' });
  }
});

// Get practice statistics
router.get('/practice/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT
        COUNT(*) as total_questions,
        AVG(score) as average_score,
        MAX(created_at) as last_practice
       FROM practice_sessions
       WHERE user_id = $1`,
      [req.user.id]
    );

    // Calculate improvement (compare first half vs second half of sessions)
    const improvement = await pool.query(
      `WITH ordered_sessions AS (
        SELECT score, ROW_NUMBER() OVER (ORDER BY created_at) as rn,
               COUNT(*) OVER () as total
        FROM practice_sessions
        WHERE user_id = $1
      )
      SELECT
        AVG(CASE WHEN rn <= total/2 THEN score END) as first_half_avg,
        AVG(CASE WHEN rn > total/2 THEN score END) as second_half_avg
      FROM ordered_sessions`,
      [req.user.id]
    );

    let improvementPercent = null;
    if (improvement.rows[0].first_half_avg && improvement.rows[0].second_half_avg) {
      const firstHalf = parseFloat(improvement.rows[0].first_half_avg);
      const secondHalf = parseFloat(improvement.rows[0].second_half_avg);
      improvementPercent = ((secondHalf - firstHalf) / firstHalf) * 100;
    }

    // Calculate day streak
    const streakResult = await pool.query(
      `WITH RECURSIVE date_series AS (
        SELECT CURRENT_DATE::date as check_date, 0 as days_back
        UNION ALL
        SELECT (check_date - INTERVAL '1 day')::date, days_back + 1
        FROM date_series
        WHERE days_back < 30
      )
      SELECT COUNT(*) as streak
      FROM date_series d
      WHERE EXISTS (
        SELECT 1 FROM practice_sessions
        WHERE user_id = $1 AND DATE(created_at) = d.check_date
      )
      AND d.check_date <= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM date_series d2
        WHERE d2.check_date > d.check_date
        AND d2.check_date <= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM practice_sessions
          WHERE user_id = $1 AND DATE(created_at) = d2.check_date
        )
      )`,
      [req.user.id]
    );

    res.json({
      success: true,
      stats: {
        total_questions: parseInt(stats.rows[0].total_questions) || 0,
        average_score: parseFloat(stats.rows[0].average_score) || null,
        improvement: improvementPercent,
        day_streak: parseInt(streakResult.rows[0].streak) || 0,
        last_practice: stats.rows[0].last_practice
      }
    });
  } catch (err) {
    console.error('Get practice stats error:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get practice progress dashboard
router.get('/practice/progress', authMiddleware, async (req, res) => {
  try {
    // Progress by category
    const byCategory = await pool.query(
      `SELECT
        category,
        COUNT(*) as count,
        AVG(score) as average_score
       FROM practice_sessions
       WHERE user_id = $1
       GROUP BY category
       ORDER BY average_score DESC`,
      [req.user.id]
    );

    // Recent practice sessions
    const recentSessions = await pool.query(
      `SELECT
        question,
        category,
        score,
        coaching_data->>'improvements' as improvements,
        created_at
       FROM practice_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.user.id]
    );

    // Parse improvements JSON string
    const sessionsWithParsedData = recentSessions.rows.map(row => {
      let improvements = [];
      try {
        if (row.improvements) {
          improvements = JSON.parse(row.improvements);
        }
      } catch (e) {
        console.error('Failed to parse improvements:', e);
      }

      return {
        question: row.question,
        category: row.category,
        score: row.score,
        improvements,
        created_at: row.created_at
      };
    });

    res.json({
      success: true,
      progress: {
        by_category: byCategory.rows,
        recent_sessions: sessionsWithParsedData
      }
    });
  } catch (err) {
    console.error('Get practice progress error:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

module.exports = router;