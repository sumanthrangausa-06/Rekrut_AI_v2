const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { generateInterviewQuestions, analyzeInterviewResponse, generateOverallFeedback, generateInterviewCoaching, analyzeVideoInterviewResponse, analyzeVideoPresentation, analyzeVoiceQuality, generateQuestionBank, conductInterviewTurn, generateSessionFeedback, textToSpeech, transcribeAudioWithWhisper } = require('../lib/polsia-ai');
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

// Universal fallback questions — used when AI question generation fails (429, timeout, etc.)
// Adapted with the target role name to feel personalized
function getFallbackMockQuestions(role) {
  return [
    { question_text: `Tell me about yourself and why you're interested in a ${role} position.`, question_type: 'behavioral', difficulty: 'easy', key_points: ['Self-introduction', 'Relevant experience', 'Role motivation'], skills_tested: ['communication', 'self-awareness'] },
    { question_text: `Describe a challenging project you worked on recently. What was your role and how did you handle obstacles?`, question_type: 'behavioral', difficulty: 'medium', key_points: ['Problem-solving', 'Resilience', 'Technical skills', 'Teamwork'], skills_tested: ['problem-solving', 'resilience'] },
    { question_text: `What specific skills or experiences make you a strong candidate for a ${role} position?`, question_type: 'competency', difficulty: 'medium', key_points: ['Core competencies', 'Specific examples', 'Self-assessment'], skills_tested: ['self-assessment', 'communication'] },
    { question_text: `How do you prioritize your work when you have multiple deadlines?`, question_type: 'situational', difficulty: 'medium', key_points: ['Time management', 'Organization', 'Communication', 'Prioritization'], skills_tested: ['time-management', 'organization'] },
    { question_text: `Tell me about a time you received constructive criticism. How did you respond and what did you change?`, question_type: 'behavioral', difficulty: 'medium', key_points: ['Self-awareness', 'Growth mindset', 'Professional maturity', 'Adaptability'], skills_tested: ['adaptability', 'growth-mindset'] },
    { question_text: `How do you stay current with industry trends and developments relevant to ${role}?`, question_type: 'competency', difficulty: 'easy', key_points: ['Continuous learning', 'Industry knowledge', 'Proactive development'], skills_tested: ['learning', 'industry-knowledge'] },
    { question_text: `Describe a situation where you had to work with someone who had a very different working style from yours.`, question_type: 'behavioral', difficulty: 'medium', key_points: ['Collaboration', 'Flexibility', 'Communication', 'Conflict resolution'], skills_tested: ['teamwork', 'communication'] },
    { question_text: `Where do you see yourself in 3-5 years, and how does a ${role} position fit into your career plan?`, question_type: 'situational', difficulty: 'easy', key_points: ['Career vision', 'Ambition', 'Role alignment', 'Long-term thinking'], skills_tested: ['planning', 'ambition'] },
  ];
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
    let usedFallback = false;
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
      // Try to generate new question bank
      console.log(`[mock] Generating new question bank for "${role}"...`);
      try {
        const generated = await generateQuestionBank(role, job_description, {
          subscriptionId: req.user.stripe_subscription_id
        });

        if (generated && Array.isArray(generated) && generated.length > 0) {
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
      } catch (genErr) {
        console.warn(`[mock] AI question generation failed (${genErr.message}), using fallback questions`);
      }

      // FALLBACK: If AI generation failed or returned nothing, insert generic role-adapted questions
      if (!bankQuestions || bankQuestions.length === 0) {
        console.log(`[mock] Using fallback questions for "${role}"`);
        usedFallback = true;
        const fallbacks = getFallbackMockQuestions(role);
        const insertedIds = [];
        for (const q of fallbacks) {
          try {
            const result = await pool.query(
              `INSERT INTO question_bank (role, jd_hash, skills, question_text, question_type, difficulty, key_points)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id`,
              [role, jdHash, q.skills_tested || [], q.question_text, q.question_type, q.difficulty, q.key_points || []]
            );
            insertedIds.push(result.rows[0].id);
          } catch (insertErr) {
            console.error('[mock] Failed to insert fallback question:', insertErr.message);
          }
        }
        if (insertedIds.length > 0) {
          const freshQuestions = await pool.query(
            `SELECT * FROM question_bank WHERE id = ANY($1) ORDER BY RANDOM() LIMIT 10`,
            [insertedIds]
          );
          bankQuestions = freshQuestions.rows;
        }
      }
    }

    if (!bankQuestions || bankQuestions.length === 0) {
      return res.status(500).json({ error: 'No questions available. Please try again.' });
    }

    // Create mock interview session
    const questionIds = bankQuestions.map(q => q.id);

    // Build opening message — natural interview greeting, NO format explanation
    // The first actual question comes AFTER the candidate introduces themselves
    const openingMessage = {
      role: 'interviewer',
      text: `Hi there! I'm Alex, and I'll be interviewing you today for the ${role} position. Thanks for taking the time — before we dive in, could you tell me a little about yourself and what drew you to this role?`,
      action: 'introduction',
      timestamp: new Date().toISOString()
    };

    const session = await pool.query(
      `INSERT INTO mock_interview_sessions
       (user_id, target_role, job_description, jd_hash, question_ids, conversation, current_question_index, questions_asked)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0)
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

    // Don't increment times_used yet — first question comes after candidate intro

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

    // AI generates next interviewer turn (with fallback on failure)
    let aiTurn;
    try {
      aiTurn = await conductInterviewTurn(
        conversation,
        baseQuestions,
        session.current_question_index,
        session.target_role,
        { subscriptionId: req.user.stripe_subscription_id }
      );
    } catch (aiErr) {
      console.warn(`[mock] AI turn generation failed (${aiErr.message}), using scripted fallback`);
      // Scripted fallback: acknowledge answer and move to next question from bank
      const nextIdx = session.current_question_index + 1;
      const nextQ = baseQuestions[nextIdx];
      const candidateTurnCount = conversation.filter(t => t.role === 'candidate').length;
      if (nextQ && candidateTurnCount < 8) {
        aiTurn = {
          reaction: "Thank you for that response. That's helpful context.",
          action: 'transition',
          question: nextQ.question_text,
          score_hint: null,
          notes: 'AI unavailable — scripted transition'
        };
      } else {
        aiTurn = {
          reaction: "Thank you for sharing all of that. I think we've covered a good range of topics.",
          action: 'wrap_up',
          question: "Is there anything else you'd like to add before we wrap up?",
          score_hint: null,
          notes: 'AI unavailable — scripted wrap-up'
        };
      }
    }

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

    // BUG FIX: Pre-generate feedback in background after 3+ candidate turns
    // This dramatically reduces wait time when user clicks "End"
    const candidateTurnCount = conversation.filter(t => t.role === 'candidate').length;
    if (candidateTurnCount >= 3 && !isWrappingUp) {
      // Fire and forget — generate text feedback in background and cache it
      generateSessionFeedback(conversation, session.target_role, { subscriptionId: req.user.stripe_subscription_id })
        .then(feedback => {
          // Store cached feedback in session (overwrite each time for freshest data)
          pool.query(
            `UPDATE mock_interview_sessions SET cached_feedback = $1 WHERE id = $2 AND status = 'in_progress'`,
            [JSON.stringify(feedback), sessionId]
          ).catch(() => {}); // Non-fatal
          console.log(`[mock] Background feedback cached for session ${sessionId} (${candidateTurnCount} turns)`);
        })
        .catch(err => console.warn('[mock] Background feedback generation failed:', err.message));
    }

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
    const { frames } = req.body; // Video frames for body language analysis

    const sessionResult = await pool.query(
      'SELECT * FROM mock_interview_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];
    const conversation = session.conversation || [];

    // Allow ending with at least 2 messages (intro + 1 candidate turn)
    // Previously required 3, which blocked users when AI was unavailable
    const candidateTurns = conversation.filter(t => t.role === 'candidate');
    if (candidateTurns.length === 0) {
      return res.status(400).json({ error: 'Not enough conversation to generate feedback. Answer at least one question.' });
    }

    // BUG FIX: Return text feedback IMMEDIATELY. Video/voice analysis runs in background.
    const candidateText = candidateTurns.map(t => t.text).join('\n\n');
    const durationSeconds = Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000);
    const options = { subscriptionId: req.user.stripe_subscription_id };

    // Step 1: Get text feedback (use cache if available — pre-generated during interview)
    let feedback = null;
    if (session.cached_feedback) {
      try {
        feedback = typeof session.cached_feedback === 'string'
          ? JSON.parse(session.cached_feedback)
          : session.cached_feedback;
        console.log(`[mock-end] Using cached feedback (pre-generated during interview)`);
      } catch { feedback = null; }
    }
    if (!feedback) {
      try {
        feedback = await generateSessionFeedback(conversation, session.target_role, options);
      } catch (feedbackErr) {
        console.warn(`[mock-end] AI feedback generation failed (${feedbackErr.message}), using basic feedback`);
        // Generate basic feedback without AI when rate-limited
        feedback = {
          overall_score: 5,
          interview_readiness: 'almost_ready',
          summary: `You completed a ${session.target_role} mock interview with ${candidateTurns.length} response(s). AI-powered detailed feedback is temporarily unavailable — try again later for in-depth analysis.`,
          strengths: ['You showed up and practiced — that alone puts you ahead of most candidates.'],
          improvements: ['Try the interview again when AI analysis is available for detailed feedback on your responses.'],
          question_scores: [],
          star_method_usage: { score: 5, feedback: 'Detailed STAR analysis unavailable at this time.' },
          communication_quality: { score: 5, feedback: 'Detailed communication analysis unavailable at this time.' },
          technical_depth: { score: 5, feedback: 'Detailed technical analysis unavailable at this time.' },
          top_tip: 'Practice makes perfect. Come back and try again for AI-powered feedback!'
        };
      }
    }

    // Step 2: Save and return text feedback immediately
    await pool.query(
      `UPDATE mock_interview_sessions
       SET status = 'completed', overall_score = $1, overall_feedback = $2, completed_at = NOW()
       WHERE id = $3`,
      [feedback.overall_score || 5, JSON.stringify(feedback), sessionId]
    );

    // Save as practice_session for stats
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
          candidateText,
          Math.round(feedback.overall_score || 5),
          JSON.stringify(feedback)
        ]
      );
    } catch (psErr) {
      console.error('Failed to save mock session to practice_sessions:', psErr.message);
    }

    // Return feedback to user IMMEDIATELY (no waiting for video/voice analysis)
    res.json({
      success: true,
      feedback,
      session: {
        id: session.id,
        target_role: session.target_role,
        questions_asked: session.questions_asked,
        follow_ups_asked: session.follow_ups_asked,
        duration_minutes: Math.round(durationSeconds / 60)
      }
    });

    // Step 3: Run video/voice analysis in BACKGROUND (fire and forget)
    // Results get saved to DB — user can see them on next page load or refresh
    const bgSessionId = sessionId;
    const bgUserId = req.user.id;
    (async () => {
      try {
        const bgPromises = [];
        if (frames && Array.isArray(frames) && frames.length > 0) {
          console.log(`[mock-end-bg] Running background body language analysis with ${frames.length} frames`);
          bgPromises.push(analyzeVideoPresentation(frames, options).catch(e => { console.warn('[mock-end-bg] Video analysis failed:', e.message); return null; }));
        } else {
          bgPromises.push(Promise.resolve(null));
        }
        if (candidateText.length > 20) {
          console.log(`[mock-end-bg] Running background voice quality analysis`);
          bgPromises.push(analyzeVoiceQuality(candidateText, durationSeconds, options).catch(e => { console.warn('[mock-end-bg] Voice analysis failed:', e.message); return null; }));
        } else {
          bgPromises.push(Promise.resolve(null));
        }

        const [videoAnalysis, voiceAnalysis] = await Promise.all(bgPromises);

        // Merge into feedback
        if (videoAnalysis) {
          feedback.presentation = {
            score: videoAnalysis.overall_presentation || 5,
            eye_contact: videoAnalysis.eye_contact || { score: 5, feedback: '' },
            facial_expressions: videoAnalysis.facial_expressions || { score: 5, feedback: '' },
            body_language: videoAnalysis.body_language || { score: 5, feedback: '' },
            professional_appearance: videoAnalysis.professional_appearance || { score: 5, feedback: '' },
            summary: videoAnalysis.summary || ''
          };
        }
        if (voiceAnalysis) {
          feedback.voice_analysis = voiceAnalysis;
        }

        // Recalculate score with presentation/voice
        if (videoAnalysis || voiceAnalysis) {
          const textScore = feedback.overall_score || 5;
          const presScore = videoAnalysis?.overall_presentation || textScore;
          const voiceScore = voiceAnalysis?.overall_voice_score || textScore;
          feedback.overall_score = Math.round((textScore * 0.5 + presScore * 0.25 + voiceScore * 0.25) * 10) / 10;
        }

        // Update DB with enriched feedback
        await pool.query(
          `UPDATE mock_interview_sessions SET overall_score = $1, overall_feedback = $2 WHERE id = $3`,
          [feedback.overall_score, JSON.stringify(feedback), bgSessionId]
        );
        console.log(`[mock-end-bg] Background analysis complete for session ${bgSessionId}`);
      } catch (bgErr) {
        console.error('[mock-end-bg] Background analysis error:', bgErr.message);
      }
    })();
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
// Real-time single-frame body language analysis (lightweight, called every ~20s during interview)
router.post('/mock/analyze-frame', authMiddleware, async (req, res) => {
  try {
    const { frame } = req.body;
    if (!frame) {
      return res.status(400).json({ error: 'No frame provided' });
    }

    // Upload single frame to R2
    const { uploadFrameToR2 } = require('../lib/polsia-ai');
    const frameUrl = await uploadFrameToR2(frame, 0);
    if (!frameUrl) {
      return res.json({ success: false, error: 'Frame upload failed' });
    }

    // Quick analysis with GPT-4o mini vision — short prompt for speed
    const openai = new (require('openai').default)();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      task: 'interview-realtime-body-language',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Quick interview body language check. Rate each as "good", "fair", or "poor" with a 2-3 word tip. Return JSON only:
{"eye_contact":"good|fair|poor","posture":"good|fair|poor","confidence":"good|fair|poor","expression":"good|fair|poor","tip":"brief tip"}`
          },
          {
            type: 'image_url',
            image_url: { url: frameUrl, detail: 'low' }
          }
        ]
      }]
    });

    const text = response.choices?.[0]?.message?.content || '';
    let indicators;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      indicators = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      indicators = null;
    }

    if (indicators) {
      res.json({ success: true, indicators });
    } else {
      res.json({ success: false, error: 'Could not parse analysis' });
    }
  } catch (err) {
    console.error('[analyze-frame] Error:', err.message);
    res.json({ success: false, error: 'Analysis failed' });
  }
});

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
      // Return 200 with JSON flag instead of 500 — lets frontend fall back to browser speech synthesis
      return res.status(200).json({ tts_unavailable: true, text: text.trim() });
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
    // Return 200 with fallback flag instead of crashing
    res.status(200).json({ tts_unavailable: true, text: req.body?.text || '' });
  }
});

// Voice response endpoint — candidate audio → Whisper transcription → AI response → TTS audio
router.post('/mock/:sessionId/voice-respond', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    // BUG FIX: Validate sessionId is a valid integer (prevents "undefined" SQL errors)
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null' || isNaN(parseInt(sessionId))) {
      return res.status(400).json({ error: 'Invalid session. Please restart the interview.' });
    }

    // Get session
    const sessionResult = await pool.query(
      'SELECT * FROM mock_interview_sessions WHERE id = $1 AND user_id = $2 AND status = $3',
      [parseInt(sessionId), req.user.id, 'in_progress']
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or already completed' });
    }

    const session = sessionResult.rows[0];
    const conversation = session.conversation || [];
    const questionIds = session.question_ids || [];

    // Step 1: Transcribe audio with Whisper (with client-side SpeechRecognition fallback)
    // The client sends the live SpeechRecognition transcript alongside the audio as a fallback
    const clientTranscript = (req.body.response_text || '').trim();
    let transcribedText = '';
    let usedFallback = false;

    if (req.file) {
      // Audio file uploaded as multipart — send buffer directly to Whisper
      const baseMime = (req.file.mimetype || 'audio/webm').split(';')[0];
      const ext = baseMime.includes('mp4') ? 'mp4' : baseMime.includes('ogg') ? 'ogg' : 'webm';
      console.log(`[voice-respond] Received file: ${req.file.size} bytes, mime: ${req.file.mimetype}, client transcript: ${clientTranscript.length} chars`);

      const whisperFormData = new FormData();
      whisperFormData.append('file', req.file.buffer, {
        filename: `recording.${ext}`,
        contentType: baseMime
      });
      whisperFormData.append('model', 'whisper-1');
      whisperFormData.append('response_format', 'verbose_json');

      const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const apiKey = process.env.OPENAI_API_KEY;
      const whisperHeaders = { 'Authorization': `Bearer ${apiKey}` };
      if (req.user.stripe_subscription_id) whisperHeaders['X-Subscription-ID'] = req.user.stripe_subscription_id;

      try {
        const whisperRes = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: whisperHeaders,
          body: whisperFormData
        });
        if (whisperRes.ok) {
          const whisperResult = await whisperRes.json();
          if (whisperResult && whisperResult.text) {
            transcribedText = whisperResult.text.trim();
            console.log(`[voice-respond] Whisper transcription: "${transcribedText.substring(0, 100)}..."`);
          }
        } else {
          const errText = await whisperRes.text();
          console.error('[voice-respond] Whisper API error:', whisperRes.status, errText);
          // BUG FIX: On 429 or other Whisper failure, use client-side SpeechRecognition transcript
          if (clientTranscript.length >= 10) {
            transcribedText = clientTranscript;
            usedFallback = true;
            console.log(`[voice-respond] Using client SpeechRecognition fallback: "${transcribedText.substring(0, 100)}..."`);
          }
        }
      } catch (whisperErr) {
        console.error('[voice-respond] Whisper call failed:', whisperErr.message);
        // BUG FIX: Use client transcript on Whisper failure
        if (clientTranscript.length >= 10) {
          transcribedText = clientTranscript;
          usedFallback = true;
          console.log(`[voice-respond] Using client SpeechRecognition fallback after error`);
        }
      }
    } else if (req.body.audio_base64) {
      const whisperResult = await transcribeAudioWithWhisper(req.body.audio_base64, {
        subscriptionId: req.user.stripe_subscription_id
      });
      if (whisperResult && whisperResult.text) {
        transcribedText = whisperResult.text.trim();
      }
    } else if (clientTranscript.length >= 5) {
      // Client-side transcript only (no audio file)
      transcribedText = clientTranscript;
      usedFallback = true;
    }

    // BUG FIX: Whisper hallucinates known phrases on silent/near-silent audio
    const WHISPER_HALLUCINATIONS = [
      'ご視聴ありがとうございました', '視聴ありがとうございました', 'ありがとうございました',
      'ご視聴ありがとうございます', '字幕', 'サブスクライブ', 'チャンネル登録',
      '谢谢观看', '感谢观看', 'Sous-titres', 'Sottotitoli', 'Untertitel',
      'Thanks for watching', 'Thank you for watching', 'Please subscribe', 'Like and subscribe',
    ];
    const isHallucination = !usedFallback && WHISPER_HALLUCINATIONS.some(phrase =>
      transcribedText.toLowerCase().includes(phrase.toLowerCase())
    );
    if (isHallucination) {
      console.log(`[voice-respond] Filtered Whisper hallucination: "${transcribedText}"`);
      // Try client transcript before rejecting
      if (clientTranscript.length >= 10) {
        transcribedText = clientTranscript;
        usedFallback = true;
      } else {
        return res.status(400).json({ error: 'I didn\'t catch that. Could you please repeat your answer.' });
      }
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

    // Step 3: Get base questions and AI response (with fallback)
    const questionsResult = await pool.query(
      'SELECT * FROM question_bank WHERE id = ANY($1)',
      [questionIds]
    );
    const questionMap = {};
    questionsResult.rows.forEach(q => { questionMap[q.id] = q; });
    const baseQuestions = questionIds.map(id => questionMap[id]).filter(Boolean);

    let aiTurn;
    try {
      aiTurn = await conductInterviewTurn(
        conversation,
        baseQuestions,
        session.current_question_index,
        session.target_role,
        { subscriptionId: req.user.stripe_subscription_id }
      );
    } catch (aiErr) {
      console.warn(`[voice-respond] AI turn generation failed (${aiErr.message}), using scripted fallback`);
      const nextIdx = session.current_question_index + 1;
      const nextQ = baseQuestions[nextIdx];
      const candidateTurnCount = conversation.filter(t => t.role === 'candidate').length;
      if (nextQ && candidateTurnCount < 8) {
        aiTurn = {
          reaction: "Thank you for that response.",
          action: 'transition',
          question: nextQ.question_text,
          score_hint: null,
          notes: 'AI unavailable — scripted transition'
        };
      } else {
        aiTurn = {
          reaction: "Thank you for sharing all of that.",
          action: 'wrap_up',
          question: "Is there anything else you'd like to add before we wrap up?",
          score_hint: null,
          notes: 'AI unavailable — scripted wrap-up'
        };
      }
    }

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

    // BUG FIX: Pre-generate feedback in background after 3+ candidate turns (same as text respond)
    const voiceCandidateTurnCount = conversation.filter(t => t.role === 'candidate').length;
    if (voiceCandidateTurnCount >= 3 && !isWrappingUp) {
      generateSessionFeedback(conversation, session.target_role, { subscriptionId: req.user.stripe_subscription_id })
        .then(feedback => {
          pool.query(
            `UPDATE mock_interview_sessions SET cached_feedback = $1 WHERE id = $2 AND status = 'in_progress'`,
            [JSON.stringify(feedback), sessionId]
          ).catch(() => {});
          console.log(`[voice-respond] Background feedback cached for session ${sessionId} (${voiceCandidateTurnCount} turns)`);
        })
        .catch(err => console.warn('[voice-respond] Background feedback generation failed:', err.message));
    }

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