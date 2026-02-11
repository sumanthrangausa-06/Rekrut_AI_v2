const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { generateInterviewQuestions, analyzeInterviewResponse, generateOverallFeedback, generateInterviewCoaching, analyzeVideoInterviewResponse, generateQuestionBank, conductInterviewTurn, generateSessionFeedback, textToSpeech, transcribeAudioWithWhisper } = require('../lib/polsia-ai');
const crypto = require('crypto');
const omniscoreService = require('../services/omniscore');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Fallback questions if AI generation fails
const FALLBACK_QUESTIONS = [
  {
    question: 'Tell me about yourself and why you are interested in this role.',
    category: 'behavioral',
    difficulty: 'easy',
    key_points: ['Self-introduction', 'Relevant experience', 'Career goals', 'Enthusiasm']
  },
  {
    question: 'Describe a challenging project you worked on. What was your role and how did you handle obstacles?',
    category: 'behavioral',
    difficulty: 'medium',
    key_points: ['Problem-solving', 'Resilience', 'Technical skills', 'Teamwork']
  },
  {
    question: 'How do you prioritize your work when you have multiple deadlines?',
    category: 'situational',
    difficulty: 'medium',
    key_points: ['Time management', 'Organization', 'Communication', 'Prioritization frameworks']
  },
  {
    question: 'Tell me about a time you received constructive criticism. How did you respond?',
    category: 'behavioral',
    difficulty: 'medium',
    key_points: ['Self-awareness', 'Growth mindset', 'Professional maturity', 'Adaptability']
  },
  {
    question: 'Where do you see yourself in 5 years, and how does this role fit into your career plan?',
    category: 'situational',
    difficulty: 'easy',
    key_points: ['Career vision', 'Ambition', 'Role alignment', 'Long-term thinking']
  }
];

// Start a new interview
router.post('/start', authMiddleware, async (req, res) => {
  try {
    const { job_id, job_title, job_description, interview_type = 'mock' } = req.body;

    // Generate questions using AI with fallback
    let questions;
    try {
      questions = await generateInterviewQuestions(
        job_title || 'Software Developer',
        job_description,
        5
      );
      console.log('AI generated', questions.length, 'interview questions');
    } catch (aiErr) {
      console.error('AI question generation failed, using fallback questions:', aiErr.message);
      questions = FALLBACK_QUESTIONS;
    }

    // Validate questions array
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      console.warn('Invalid questions from AI, using fallback');
      questions = FALLBACK_QUESTIONS;
    }

    // Create interview record
    const result = await pool.query(
      `INSERT INTO interviews (user_id, job_id, interview_type, questions, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       RETURNING *`,
      [req.user.id, job_id, interview_type, JSON.stringify(questions)]
    );

    // Track mock interview start
    try {
      await pool.query(
        'INSERT INTO events (event_type, user_id, metadata) VALUES ($1, $2, $3)',
        ['mock_interview_start', req.user.id, JSON.stringify({ interview_type, job_id })]
      );
    } catch (e) {
      console.error('Failed to log interview start event:', e);
    }

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

    // Update responses - use updated_at if column exists, fallback gracefully
    try {
      await pool.query(
        `UPDATE interviews SET responses = $1, video_urls = $2, updated_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(responses), JSON.stringify(videoUrls), req.params.id]
      );
    } catch (updateErr) {
      // Fallback if updated_at column doesn't exist yet (pre-migration)
      if (updateErr.message && updateErr.message.includes('updated_at')) {
        console.warn('updated_at column missing, updating without it');
        await pool.query(
          `UPDATE interviews SET responses = $1, video_urls = $2
           WHERE id = $3`,
          [JSON.stringify(responses), JSON.stringify(videoUrls), req.params.id]
        );
      } else {
        throw updateErr;
      }
    }

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

// Upload video for interview response
router.post('/upload-video', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const { interview_id, question_index } = req.body;

    if (!interview_id || question_index === undefined) {
      return res.status(400).json({ error: 'Missing interview_id or question_index' });
    }

    // Verify interview belongs to user
    const interview = await pool.query(
      'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
      [interview_id, req.user.id]
    );

    if (interview.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    // Upload to R2
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: `interview-${interview_id}-q${question_index}.webm`,
      contentType: req.file.mimetype
    });

    const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const result = await uploadRes.json();

    if (!result.success) {
      console.error('R2 upload error:', result.error);
      return res.status(500).json({ error: 'Failed to upload video' });
    }

    res.json({
      success: true,
      video_url: result.file.url
    });
  } catch (err) {
    console.error('Upload video error:', err);
    res.status(500).json({ error: 'Failed to upload video' });
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

// Predefined question library (shared between routes)
const PRACTICE_QUESTION_LIBRARY = [
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

// Get practice question library
router.get('/practice/library', authMiddleware, async (req, res) => {
  try {
    const questionLibrary = PRACTICE_QUESTION_LIBRARY;

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
    const { question_id, category, response_text } = req.body;
    // Default question text from library if not provided
    const libraryQ = PRACTICE_QUESTION_LIBRARY.find(q => q.id === question_id);
    const question = req.body.question || (libraryQ && libraryQ.question) || `Practice question ${question_id || 'unknown'}`;

    if (!response_text || response_text.trim().length < 50) {
      return res.status(400).json({ error: 'Response must be at least 50 characters' });
    }

    // Look up key_points from question library
    const libraryQuestion = PRACTICE_QUESTION_LIBRARY.find(q => q.id === question_id);
    const keyPoints = libraryQuestion ? libraryQuestion.key_points : ['Content quality', 'Structure', 'Clarity', 'Relevance'];

    // First, analyze the response with real key points
    const analysis = await analyzeInterviewResponse(
      question,
      response_text,
      keyPoints,
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

// Submit video practice response and get comprehensive AI coaching
router.post('/practice/submit-video', authMiddleware, async (req, res) => {
  try {
    const { question_id, category, transcription, frames, duration_seconds, audio_data } = req.body;
    // Default question text from library if not provided
    const libQ = PRACTICE_QUESTION_LIBRARY.find(q => q.id === question_id);
    const question = req.body.question || (libQ && libQ.question) || `Practice question ${question_id || 'unknown'}`;

    if (!transcription || transcription.trim().length < 20) {
      return res.status(400).json({ error: 'Transcription too short. Please speak for at least 15-20 seconds.' });
    }

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'No video frames captured. Please allow camera access.' });
    }

    // Look up key_points from question library
    const libraryQuestion = PRACTICE_QUESTION_LIBRARY.find(q => q.id === question_id);
    const keyPoints = libraryQuestion ? libraryQuestion.key_points : ['Content quality', 'Structure', 'Clarity', 'Relevance'];

    // Run comprehensive multi-modal analysis (now with optional audio)
    const coaching = await analyzeVideoInterviewResponse(
      question,
      transcription,
      frames,
      duration_seconds || 60,
      keyPoints,
      { subscriptionId: req.user.stripe_subscription_id, audioData: audio_data || null }
    );

    // Save practice session with video data
    await pool.query(
      `INSERT INTO practice_sessions
       (user_id, question_id, question, category, response_text, score, coaching_data, response_type, transcription, audio_analysis, video_analysis, duration_seconds, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'video', $8, $9, $10, $11, NOW())`,
      [
        req.user.id,
        question_id,
        question,
        category,
        transcription,
        Math.round(coaching.overall_score),
        JSON.stringify(coaching),
        transcription,
        JSON.stringify(coaching.communication),
        JSON.stringify(coaching.presentation),
        duration_seconds || 60
      ]
    );

    res.json({
      success: true,
      coaching
    });
  } catch (err) {
    console.error('Submit video practice response error:', err);
    res.status(500).json({ error: 'Failed to analyze video response. Please try again.' });
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

// =============== COACHING SESSION HISTORY ===============

// Get all coaching sessions with full feedback data
router.get('/practice/sessions', authMiddleware, async (req, res) => {
  try {
    const { limit = 20, offset = 0, category } = req.query;

    let whereClause = 'WHERE user_id = $1';
    const params = [req.user.id];

    if (category && category !== 'all') {
      params.push(category);
      whereClause += ` AND category = $${params.length}`;
    }

    const sessions = await pool.query(
      `SELECT
        id, question_id, question, category, response_text, score,
        coaching_data, response_type, transcription,
        audio_analysis, video_analysis, duration_seconds, created_at
       FROM practice_sessions
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), Number(offset)]
    );

    const total = await pool.query(
      `SELECT COUNT(*) as count FROM practice_sessions ${whereClause}`,
      params
    );

    // Parse JSONB fields
    const parsed = sessions.rows.map(row => ({
      ...row,
      coaching_data: typeof row.coaching_data === 'string' ? JSON.parse(row.coaching_data) : row.coaching_data,
      audio_analysis: typeof row.audio_analysis === 'string' ? JSON.parse(row.audio_analysis) : row.audio_analysis,
      video_analysis: typeof row.video_analysis === 'string' ? JSON.parse(row.video_analysis) : row.video_analysis,
    }));

    res.json({
      success: true,
      sessions: parsed,
      total: parseInt(total.rows[0].count),
      has_more: (Number(offset) + parsed.length) < parseInt(total.rows[0].count)
    });
  } catch (err) {
    console.error('Get practice sessions error:', err);
    res.status(500).json({ error: 'Failed to fetch coaching sessions' });
  }
});

// Get single coaching session detail
router.get('/practice/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const session = await pool.query(
      `SELECT
        id, question_id, question, category, response_text, score,
        coaching_data, response_type, transcription,
        audio_analysis, video_analysis, duration_seconds, created_at
       FROM practice_sessions
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const row = session.rows[0];
    res.json({
      success: true,
      session: {
        ...row,
        coaching_data: typeof row.coaching_data === 'string' ? JSON.parse(row.coaching_data) : row.coaching_data,
        audio_analysis: typeof row.audio_analysis === 'string' ? JSON.parse(row.audio_analysis) : row.audio_analysis,
        video_analysis: typeof row.video_analysis === 'string' ? JSON.parse(row.video_analysis) : row.video_analysis,
      }
    });
  } catch (err) {
    console.error('Get practice session detail error:', err);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

// =============== VIDEO ANALYSIS ===============

// Save video analysis data
router.post('/save-analysis', authMiddleware, async (req, res) => {
  try {
    const { interview_id, question_index, analysis_data, scores } = req.body;

    // Verify interview belongs to user
    const interview = await pool.query(
      'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
      [interview_id, req.user.id]
    );

    if (interview.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    // Insert or update analysis
    await pool.query(
      `INSERT INTO interview_analysis (
        interview_id, question_index, analysis_data,
        eye_contact_score, expression_score, body_language_score,
        voice_score, presentation_score
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (interview_id, question_index)
      DO UPDATE SET
        analysis_data = $3,
        eye_contact_score = $4,
        expression_score = $5,
        body_language_score = $6,
        voice_score = $7,
        presentation_score = $8`,
      [
        interview_id,
        question_index,
        JSON.stringify(analysis_data),
        scores.eyeContact || 0,
        scores.expression || 0,
        scores.bodyLanguage || 0,
        scores.voice || 0,
        scores.presentation || 0
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Save analysis error:', err);
    res.status(500).json({ error: 'Failed to save analysis' });
  }
});

// Get video analysis for an interview
router.get('/:id/analysis', authMiddleware, async (req, res) => {
  try {
    // Verify interview belongs to user
    const interview = await pool.query(
      'SELECT * FROM interviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (interview.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    // Get all analysis data for this interview
    const analysis = await pool.query(
      `SELECT * FROM interview_analysis
       WHERE interview_id = $1
       ORDER BY question_index ASC`,
      [req.params.id]
    );

    // Calculate aggregate presentation score for OmniScore
    let avgPresentationScore = null;
    if (analysis.rows.length > 0) {
      const scores = analysis.rows.map(row => parseFloat(row.presentation_score || 0));
      avgPresentationScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    }

    res.json({
      success: true,
      interview: interview.rows[0],
      analysis: analysis.rows.map(row => ({
        ...row,
        analysis_data: typeof row.analysis_data === 'string'
          ? JSON.parse(row.analysis_data)
          : row.analysis_data
      })),
      aggregate_scores: {
        presentation: avgPresentationScore
      }
    });
  } catch (err) {
    console.error('Get analysis error:', err);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

// =============== MOCK INTERVIEW SESSIONS (Dynamic AI Interviewer) ===============

// Helper: hash JD for dedup
function hashJD(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex').substring(0, 16);
}

// Start a mock interview session — generates or pulls questions for the role
router.post('/mock/start', authMiddleware, async (req, res) => {
  try {
    const { target_role, job_description } = req.body;

    if (!target_role || target_role.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter a target role (e.g., "Software Engineer", "Product Manager")' });
    }

    const role = target_role.trim();
    const jdHash = hashJD(job_description);

    // Check if we already have questions in the bank for this role/JD combo
    let bankQuestions;
    const existing = await pool.query(
      `SELECT * FROM question_bank WHERE LOWER(role) = LOWER($1) ${jdHash ? 'AND jd_hash = $2' : 'AND jd_hash IS NULL'}
       ORDER BY RANDOM()`,
      jdHash ? [role, jdHash] : [role]
    );

    if (existing.rows.length >= 8) {
      // Use existing bank — pick random 8-10
      bankQuestions = existing.rows.slice(0, Math.min(10, existing.rows.length));
      console.log(`[mock] Found ${existing.rows.length} existing questions for "${role}", using ${bankQuestions.length}`);
    } else {
      // Generate new question bank
      console.log(`[mock] Generating new question bank for "${role}"...`);
      const generated = await generateQuestionBank(role, job_description, {
        subscriptionId: req.user.stripe_subscription_id
      });

      if (!generated || !Array.isArray(generated) || generated.length === 0) {
        return res.status(500).json({ error: 'Failed to generate questions. Please try again.' });
      }

      // Store in question_bank
      const insertedIds = [];
      for (const q of generated) {
        try {
          const result = await pool.query(
            `INSERT INTO question_bank (role, jd_hash, skills, question_text, question_type, difficulty, key_points)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              role,
              jdHash,
              q.skills_tested || [],
              q.question_text,
              q.question_type || 'behavioral',
              q.difficulty || 'medium',
              q.key_points || []
            ]
          );
          insertedIds.push(result.rows[0].id);
        } catch (insertErr) {
          console.error('[mock] Failed to insert question:', insertErr.message);
        }
      }

      console.log(`[mock] Stored ${insertedIds.length} questions in bank`);

      // Pull 8-10 random from what we just inserted
      const freshQuestions = await pool.query(
        `SELECT * FROM question_bank WHERE id = ANY($1) ORDER BY RANDOM() LIMIT 10`,
        [insertedIds]
      );
      bankQuestions = freshQuestions.rows;
    }

    if (!bankQuestions || bankQuestions.length === 0) {
      return res.status(500).json({ error: 'No questions available. Please try again.' });
    }

    // Create mock interview session
    const questionIds = bankQuestions.map(q => q.id);

    // Build opening message from the AI interviewer
    const openingMessage = {
      role: 'interviewer',
      text: `Hi! Thanks for joining this mock interview for the ${role} position. I'll be asking you a series of questions to assess your fit. Take your time with each answer — I may ask follow-ups based on what you share. Let's get started.\n\n${bankQuestions[0].question_text}`,
      action: 'transition',
      timestamp: new Date().toISOString()
    };

    const session = await pool.query(
      `INSERT INTO mock_interview_sessions
       (user_id, target_role, job_description, jd_hash, question_ids, conversation, current_question_index, questions_asked)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 1)
       RETURNING *`,
      [
        req.user.id,
        role,
        job_description || null,
        jdHash,
        questionIds,
        JSON.stringify([openingMessage])
      ]
    );

    // Increment times_used for first question
    await pool.query('UPDATE question_bank SET times_used = times_used + 1 WHERE id = $1', [bankQuestions[0].id]);

    res.json({
      success: true,
      session: session.rows[0],
      questions_count: bankQuestions.length,
      first_message: openingMessage
    });
  } catch (err) {
    console.error('Start mock interview error:', err);
    res.status(500).json({ error: 'Failed to start mock interview' });
  }
});

// Submit a response in a mock interview — AI responds conversationally
router.post('/mock/:sessionId/respond', authMiddleware, async (req, res) => {
  try {
    const { response_text } = req.body;
    const sessionId = req.params.sessionId;

    if (!response_text || response_text.trim().length < 10) {
      return res.status(400).json({ error: 'Response too short. Please elaborate on your answer.' });
    }

    // Get session
    const sessionResult = await pool.query(
      'SELECT * FROM mock_interview_sessions WHERE id = $1 AND user_id = $2 AND status = $3',
      [sessionId, req.user.id, 'in_progress']
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or already completed' });
    }

    const session = sessionResult.rows[0];
    const conversation = session.conversation || [];
    const questionIds = session.question_ids || [];

    // Get base questions from bank
    const questionsResult = await pool.query(
      'SELECT * FROM question_bank WHERE id = ANY($1)',
      [questionIds]
    );
    // Maintain order from questionIds
    const questionMap = {};
    questionsResult.rows.forEach(q => { questionMap[q.id] = q; });
    const baseQuestions = questionIds.map(id => questionMap[id]).filter(Boolean);

    // Add candidate response to conversation
    const candidateMessage = {
      role: 'candidate',
      text: response_text.trim(),
      timestamp: new Date().toISOString()
    };
    conversation.push(candidateMessage);

    // AI generates next interviewer turn
    const aiTurn = await conductInterviewTurn(
      conversation,
      baseQuestions,
      session.current_question_index,
      session.target_role,
      { subscriptionId: req.user.stripe_subscription_id }
    );

    // Build interviewer message
    let interviewerText = aiTurn.reaction || '';
    if (aiTurn.question) {
      interviewerText += (interviewerText ? '\n\n' : '') + aiTurn.question;
    }

    const interviewerMessage = {
      role: 'interviewer',
      text: interviewerText,
      action: aiTurn.action || 'transition',
      score_hint: aiTurn.score_hint || null,
      notes: aiTurn.notes || null,
      timestamp: new Date().toISOString()
    };
    conversation.push(interviewerMessage);

    // Update session
    const isWrappingUp = aiTurn.action === 'wrap_up';
    const isTransition = aiTurn.action === 'transition';
    const newQuestionIndex = isTransition
      ? Math.min(session.current_question_index + 1, baseQuestions.length)
      : session.current_question_index;
    const newFollowUps = (aiTurn.action === 'follow_up' || aiTurn.action === 'challenge')
      ? (session.follow_ups_asked || 0) + 1
      : session.follow_ups_asked || 0;

    // Increment times_used for the new question if transitioning
    if (isTransition && newQuestionIndex < baseQuestions.length) {
      const nextQ = baseQuestions[newQuestionIndex];
      if (nextQ) {
        await pool.query('UPDATE question_bank SET times_used = times_used + 1 WHERE id = $1', [nextQ.id]);
      }
    }

    await pool.query(
      `UPDATE mock_interview_sessions
       SET conversation = $1, current_question_index = $2,
           questions_asked = $3, follow_ups_asked = $4
       WHERE id = $5`,
      [
        JSON.stringify(conversation),
        newQuestionIndex,
        isTransition ? (session.questions_asked || 0) + 1 : session.questions_asked || 0,
        newFollowUps,
        sessionId
      ]
    );

    res.json({
      success: true,
      interviewer_message: interviewerMessage,
      action: aiTurn.action,
      questions_asked: isTransition ? (session.questions_asked || 0) + 1 : session.questions_asked || 0,
      is_wrapping_up: isWrappingUp
    });
  } catch (err) {
    console.error('Mock interview respond error:', err);
    res.status(500).json({ error: 'Failed to process response. Please try again.' });
  }
});

// End a mock interview session and get comprehensive feedback
router.post('/mock/:sessionId/end', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    const sessionResult = await pool.query(
      'SELECT * FROM mock_interview_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];
    const conversation = session.conversation || [];

    if (conversation.length < 3) {
      return res.status(400).json({ error: 'Not enough conversation to generate feedback. Answer at least one question.' });
    }

    // Generate comprehensive feedback
    const feedback = await generateSessionFeedback(
      conversation,
      session.target_role,
      { subscriptionId: req.user.stripe_subscription_id }
    );

    // Update session as completed
    await pool.query(
      `UPDATE mock_interview_sessions
       SET status = 'completed', overall_score = $1, overall_feedback = $2, completed_at = NOW()
       WHERE id = $3`,
      [feedback.overall_score || 5, JSON.stringify(feedback), sessionId]
    );

    // Also save as a practice_session for stats continuity
    try {
      await pool.query(
        `INSERT INTO practice_sessions
         (user_id, question_id, question, category, response_text, score, coaching_data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          req.user.id,
          `mock-${sessionId}`,
          `Mock Interview: ${session.target_role}`,
          'mock_interview',
          conversation.filter(t => t.role === 'candidate').map(t => t.text).join('\n\n'),
          Math.round(feedback.overall_score || 5),
          JSON.stringify(feedback)
        ]
      );
    } catch (psErr) {
      console.error('Failed to save mock session to practice_sessions:', psErr.message);
    }

    res.json({
      success: true,
      feedback,
      session: {
        id: session.id,
        target_role: session.target_role,
        questions_asked: session.questions_asked,
        follow_ups_asked: session.follow_ups_asked,
        duration_minutes: Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000)
      }
    });
  } catch (err) {
    console.error('End mock interview error:', err);
    res.status(500).json({ error: 'Failed to generate feedback' });
  }
});

// Get mock interview session history
router.get('/mock/sessions', authMiddleware, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const sessions = await pool.query(
      `SELECT id, target_role, status, overall_score, questions_asked, follow_ups_asked,
              started_at, completed_at,
              EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) / 60 as duration_minutes
       FROM mock_interview_sessions
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, Number(limit), Number(offset)]
    );

    const total = await pool.query(
      'SELECT COUNT(*) as count FROM mock_interview_sessions WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      sessions: sessions.rows,
      total: parseInt(total.rows[0].count)
    });
  } catch (err) {
    console.error('Get mock sessions error:', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get single mock interview session with full conversation
router.get('/mock/sessions/:id', authMiddleware, async (req, res) => {
  try {
    const session = await pool.query(
      `SELECT * FROM mock_interview_sessions WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ success: true, session: session.rows[0] });
  } catch (err) {
    console.error('Get mock session error:', err);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Get question bank stats (for admin/debugging)
router.get('/mock/question-bank', authMiddleware, async (req, res) => {
  try {
    const { role } = req.query;

    let whereClause = '';
    const params = [];
    if (role) {
      params.push(role);
      whereClause = 'WHERE LOWER(role) = LOWER($1)';
    }

    const stats = await pool.query(
      `SELECT role, question_type, COUNT(*) as count, AVG(avg_score) as avg_score
       FROM question_bank ${whereClause}
       GROUP BY role, question_type
       ORDER BY role, question_type`,
      params
    );

    const totalQuestions = await pool.query(
      `SELECT COUNT(*) as total, COUNT(DISTINCT role) as roles FROM question_bank ${whereClause}`,
      params
    );

    res.json({
      success: true,
      bank_stats: stats.rows,
      total_questions: parseInt(totalQuestions.rows[0].total),
      total_roles: parseInt(totalQuestions.rows[0].roles)
    });
  } catch (err) {
    console.error('Get question bank error:', err);
    res.status(500).json({ error: 'Failed to fetch question bank' });
  }
});

// =============== VOICE INTERVIEW (TTS + STT) ===============

// Text-to-Speech endpoint — converts interviewer text to spoken audio
router.post('/mock/tts', authMiddleware, async (req, res) => {
  try {
    const { text, voice } = req.body;

    if (!text || text.trim().length < 2) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const audioBuffer = await textToSpeech(text.trim(), {
      voice: voice || 'nova',
      subscriptionId: req.user.stripe_subscription_id
    });

    if (!audioBuffer) {
      return res.status(500).json({ error: 'TTS generation failed' });
    }

    // Return audio as binary MP3
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache',
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error('TTS endpoint error:', err);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

// Voice response endpoint — candidate audio → Whisper transcription → AI response → TTS audio
router.post('/mock/:sessionId/voice-respond', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    // Get session
    const sessionResult = await pool.query(
      'SELECT * FROM mock_interview_sessions WHERE id = $1 AND user_id = $2 AND status = $3',
      [sessionId, req.user.id, 'in_progress']
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or already completed' });
    }

    const session = sessionResult.rows[0];
    const conversation = session.conversation || [];
    const questionIds = session.question_ids || [];

    // Step 1: Transcribe audio with Whisper
    let transcribedText = '';
    if (req.file) {
      // Audio file uploaded as multipart
      const audioBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const whisperResult = await transcribeAudioWithWhisper(audioBase64, {
        subscriptionId: req.user.stripe_subscription_id
      });
      if (whisperResult && whisperResult.text) {
        transcribedText = whisperResult.text.trim();
      }
    } else if (req.body.audio_base64) {
      // Audio sent as base64 in JSON
      const whisperResult = await transcribeAudioWithWhisper(req.body.audio_base64, {
        subscriptionId: req.user.stripe_subscription_id
      });
      if (whisperResult && whisperResult.text) {
        transcribedText = whisperResult.text.trim();
      }
    } else if (req.body.response_text) {
      // Fallback: text directly (for cases where transcription happens client-side)
      transcribedText = req.body.response_text.trim();
    }

    if (!transcribedText || transcribedText.length < 5) {
      return res.status(400).json({ error: 'Could not transcribe your response. Please try speaking louder and more clearly.' });
    }

    // Step 2: Add candidate response to conversation
    const candidateMessage = {
      role: 'candidate',
      text: transcribedText,
      timestamp: new Date().toISOString()
    };
    conversation.push(candidateMessage);

    // Step 3: Get base questions and AI response
    const questionsResult = await pool.query(
      'SELECT * FROM question_bank WHERE id = ANY($1)',
      [questionIds]
    );
    const questionMap = {};
    questionsResult.rows.forEach(q => { questionMap[q.id] = q; });
    const baseQuestions = questionIds.map(id => questionMap[id]).filter(Boolean);

    const aiTurn = await conductInterviewTurn(
      conversation,
      baseQuestions,
      session.current_question_index,
      session.target_role,
      { subscriptionId: req.user.stripe_subscription_id }
    );

    // Build interviewer message
    let interviewerText = aiTurn.reaction || '';
    if (aiTurn.question) {
      interviewerText += (interviewerText ? '\n\n' : '') + aiTurn.question;
    }

    const interviewerMessage = {
      role: 'interviewer',
      text: interviewerText,
      action: aiTurn.action || 'transition',
      score_hint: aiTurn.score_hint || null,
      notes: aiTurn.notes || null,
      timestamp: new Date().toISOString()
    };
    conversation.push(interviewerMessage);

    // Step 4: Update session in DB
    const isWrappingUp = aiTurn.action === 'wrap_up';
    const isTransition = aiTurn.action === 'transition';
    const newQuestionIndex = isTransition
      ? Math.min(session.current_question_index + 1, baseQuestions.length)
      : session.current_question_index;
    const newFollowUps = (aiTurn.action === 'follow_up' || aiTurn.action === 'challenge')
      ? (session.follow_ups_asked || 0) + 1
      : session.follow_ups_asked || 0;

    if (isTransition && newQuestionIndex < baseQuestions.length) {
      const nextQ = baseQuestions[newQuestionIndex];
      if (nextQ) {
        await pool.query('UPDATE question_bank SET times_used = times_used + 1 WHERE id = $1', [nextQ.id]);
      }
    }

    await pool.query(
      `UPDATE mock_interview_sessions
       SET conversation = $1, current_question_index = $2,
           questions_asked = $3, follow_ups_asked = $4
       WHERE id = $5`,
      [
        JSON.stringify(conversation),
        newQuestionIndex,
        isTransition ? (session.questions_asked || 0) + 1 : session.questions_asked || 0,
        newFollowUps,
        sessionId
      ]
    );

    // Step 5: Generate TTS for interviewer response
    let audioBase64 = null;
    try {
      const audioBuffer = await textToSpeech(interviewerText, {
        voice: 'nova',
        subscriptionId: req.user.stripe_subscription_id
      });
      if (audioBuffer) {
        audioBase64 = audioBuffer.toString('base64');
      }
    } catch (ttsErr) {
      console.error('TTS generation failed for voice-respond:', ttsErr.message);
      // Non-fatal — response still works without audio
    }

    res.json({
      success: true,
      transcribed_text: transcribedText,
      interviewer_message: interviewerMessage,
      interviewer_audio_base64: audioBase64,
      action: aiTurn.action,
      questions_asked: isTransition ? (session.questions_asked || 0) + 1 : session.questions_asked || 0,
      is_wrapping_up: isWrappingUp
    });
  } catch (err) {
    console.error('Voice respond error:', err);
    res.status(500).json({ error: 'Failed to process voice response. Please try again.' });
  }
});

module.exports = router;