const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { generateInterviewQuestions, analyzeInterviewResponse, generateOverallFeedback, generateInterviewCoaching, analyzeVideoInterviewResponse, analyzeVideoPresentation, analyzeVoiceQuality, generateQuestionBank, conductInterviewTurn, generateSessionFeedback, textToSpeech, transcribeAudioWithWhisper, aiProvider } = require('../lib/polsia-ai');
const crypto = require('crypto');
const omniscoreService = require('../services/omniscore');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper: Race a promise against a timeout to prevent hanging when AI providers are slow.
// The AI provider chain can take 9×15s = 135s worst case; Render kills requests at ~30s.
// This ensures we hit the scripted fallback BEFORE the request is killed.
function withTimeout(promise, ms, label = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms))
  ]);
}

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
    const { response_text } = req.body;
    // Ensure NOT NULL fields have safe defaults
    const question_id = req.body.question_id || 'general';
    const category = req.body.category || 'behavioral';
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
    const { transcription, frames, duration_seconds, audio_data } = req.body;
    // Ensure NOT NULL fields have safe defaults
    const question_id = req.body.question_id || 'general';
    const category = req.body.category || 'behavioral';
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
        const generated = await withTimeout(
          generateQuestionBank(role, job_description, {
            subscriptionId: req.user.stripe_subscription_id
          }),
          25000,
          'AI question generation'
        );

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

    // BUG FIX #1: Hard question limit — force wrap_up after 8 candidate turns
    const MAX_QUESTIONS = 8;
    const candidateTurnCount = conversation.filter(t => t.role === 'candidate').length;
    const shouldForceEnd = candidateTurnCount >= MAX_QUESTIONS;

    // AI generates next interviewer turn (with fallback on failure)
    // BUG FIX: Wrap with 20s overall timeout — the LLM chain can take 135s (9 providers × 15s each),
    // but Render kills the request at ~30s. Without this, the scripted fallback never fires.
    let aiTurn;

    if (shouldForceEnd) {
      // Hard limit reached — skip AI call entirely to save tokens
      console.log(`[mock] Hard question limit reached (${candidateTurnCount} turns), forcing wrap_up`);
      aiTurn = {
        reaction: `That's been a really thorough interview — we've covered a lot of ground across ${candidateTurnCount} questions.`,
        action: 'wrap_up',
        question: "Before we finish, is there anything you'd like to add or any questions about the role?",
        score_hint: null,
        notes: 'Hard question limit reached'
      };
    } else {
      try {
        aiTurn = await withTimeout(
          conductInterviewTurn(
            conversation,
            baseQuestions,
            session.current_question_index,
            session.target_role,
            { subscriptionId: req.user.stripe_subscription_id }
          ),
          20000,
          'Interview AI turn generation'
        );
        // BUG FIX: Override generic AI reactions — don't echo user's words
        if (aiTurn && aiTurn.reaction && /^(Thank you for (that|sharing|your) (response|answer)|That's (helpful|great|good|interesting)\.?)\s*$/i.test(aiTurn.reaction.trim())) {
          const NATURAL_AI_ACKS = [
            "Interesting perspective. Let me follow up on that.",
            "That gives me good context. I'd like to dig a little deeper.",
            "That's a thoughtful response. Let me explore another angle.",
            "I appreciate the detail. Let me build on that.",
          ];
          aiTurn.reaction = NATURAL_AI_ACKS[candidateTurnCount % NATURAL_AI_ACKS.length];
        }
      } catch (aiErr) {
        console.warn(`[mock] AI turn generation failed (${aiErr.message}), using scripted fallback`);
        // BUG FIX: Don't echo user's words back — use natural acknowledgments instead
        const nextIdx = session.current_question_index + 1;
        const nextQ = baseQuestions[nextIdx];
        const NATURAL_ACKS = [
          "Thanks for that. Really helpful to understand your perspective.",
          "Appreciate you sharing that. It gives me good insight into how you think.",
          "Good to hear. That's exactly the kind of detail I was looking for.",
          "Understood. That paints a clear picture of your experience.",
          "Thanks for walking me through that. Let me ask you something else.",
        ];
        const ackIdx = candidateTurnCount % NATURAL_ACKS.length;
        if (nextQ && candidateTurnCount < MAX_QUESTIONS) {
          aiTurn = {
            reaction: NATURAL_ACKS[ackIdx],
            action: 'transition',
            question: nextQ.question_text,
            score_hint: null,
            notes: 'AI unavailable — scripted transition'
          };
        } else {
          aiTurn = {
            reaction: `We've covered a good range of topics across our conversation. I've got a strong sense of your background.`,
            action: 'wrap_up',
            question: "Is there anything else you'd like to add before we wrap up?",
            score_hint: null,
            notes: 'AI unavailable — scripted wrap-up'
          };
        }
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
    const currentCandidateTurns = conversation.filter(t => t.role === 'candidate').length;
    if (currentCandidateTurns >= 3 && !isWrappingUp) {
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

    // BUG FIX: Allow ending at any time. If 0 answers, return success with no_feedback flag
    // instead of 400 error (which left the session stuck and the end button broken).
    const candidateTurns = conversation.filter(t => t.role === 'candidate');
    if (candidateTurns.length === 0) {
      // Mark session as completed even with no answers
      await pool.query(
        `UPDATE mock_interview_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      return res.json({
        success: true,
        no_feedback: true,
        feedback: null,
        session: {
          id: session.id,
          target_role: session.target_role,
          questions_asked: 0,
          follow_ups_asked: 0,
          duration_minutes: 0
        }
      });
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

    // BUG FIX #7: Compute dominant category from actual questions asked (not hardcoded 'mock_interview')
    let dominantCategory = 'behavioral'; // default fallback
    try {
      const questionIds = session.question_ids || [];
      if (questionIds.length > 0) {
        const qTypesResult = await pool.query(
          'SELECT question_type, COUNT(*) as cnt FROM question_bank WHERE id = ANY($1) GROUP BY question_type ORDER BY cnt DESC LIMIT 1',
          [questionIds]
        );
        if (qTypesResult.rows.length > 0) {
          const rawType = qTypesResult.rows[0].question_type;
          dominantCategory = rawType === 'competency' ? 'behavioral' : rawType;
        }
      }
    } catch (catErr) {
      console.error('Failed to compute dominant category:', catErr.message);
    }

    // Save as practice_session for stats (with correct category)
    try {
      await pool.query(
        `INSERT INTO practice_sessions
         (user_id, question_id, question, category, response_text, score, coaching_data, response_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          req.user.id,
          `mock-${sessionId}`,
          `Mock Interview: ${session.target_role}`,
          dominantCategory,
          candidateText,
          Math.round(feedback.overall_score || 5),
          JSON.stringify(feedback),
          'voice'
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
    // SAFETY NET: Always mark session completed even if everything else fails
    try {
      const sessionId = req.params.sessionId;
      const safetyFeedback = {
        overall_score: 5,
        interview_readiness: 'almost_ready',
        summary: 'Your interview feedback could not be fully generated due to a temporary issue. Please try another interview — your practice still counts!',
        strengths: ['You showed up and practiced'],
        improvements: ['Try again for detailed AI feedback'],
        question_scores: [],
        star_method_usage: { score: 5, feedback: 'Unavailable' },
        communication_quality: { score: 5, feedback: 'Unavailable' },
        technical_depth: { score: 5, feedback: 'Unavailable' },
        top_tip: 'Keep practicing — consistency is key!'
      };
      await pool.query(
        `UPDATE mock_interview_sessions SET status = 'completed', overall_score = 5, overall_feedback = $1, completed_at = NOW() WHERE id = $2 AND status = 'in_progress'`,
        [JSON.stringify(safetyFeedback), sessionId]
      );
      return res.json({ success: true, feedback: safetyFeedback, session: { id: parseInt(sessionId) } });
    } catch (safetyErr) {
      console.error('Safety net also failed:', safetyErr.message);
    }
    res.status(500).json({ error: 'Failed to generate feedback. Please try again.' });
  }
});

// Get mock interview session history (with category tags from question_bank)
router.get('/mock/sessions', authMiddleware, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const sessions = await pool.query(
      `SELECT id, target_role, status, overall_score, questions_asked, follow_ups_asked,
              question_ids, started_at, completed_at,
              EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) / 60 as duration_minutes
       FROM mock_interview_sessions
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, Number(limit), Number(offset)]
    );

    // BUG FIX #7: Compute actual category tags for each session from question_bank
    const allQuestionIds = [...new Set(sessions.rows.flatMap(s => s.question_ids || []))];
    let questionTypeMap = {};
    if (allQuestionIds.length > 0) {
      const qTypes = await pool.query(
        'SELECT id, question_type FROM question_bank WHERE id = ANY($1)',
        [allQuestionIds]
      );
      qTypes.rows.forEach(q => { questionTypeMap[q.id] = q.question_type; });
    }

    // Enrich sessions with category tags
    const enrichedSessions = sessions.rows.map(s => {
      const categories = [...new Set((s.question_ids || []).map(id => questionTypeMap[id]).filter(Boolean))];
      // Normalize category names: 'competency' → 'behavioral' for display
      const normalizedCategories = [...new Set(categories.map(c => c === 'competency' ? 'behavioral' : c))];
      return {
        ...s,
        question_ids: undefined, // Don't leak raw IDs to client
        category_tags: normalizedCategories.length > 0 ? normalizedCategories : ['behavioral'],
        interview_type: 'voice', // Mock interviews are always voice-based
      };
    });

    const total = await pool.query(
      'SELECT COUNT(*) as count FROM mock_interview_sessions WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      sessions: enrichedSessions,
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

// =============== QUESTION BANK BROWSE (Bug Fix #8) ===============

// Browse question bank — candidates can browse/filter past questions by role/category
router.get('/mock/question-bank/browse', authMiddleware, async (req, res) => {
  try {
    const { role, category, difficulty, limit = 50, offset = 0 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (role) {
      params.push(role);
      whereClause += ` AND LOWER(role) = LOWER($${params.length})`;
    }
    if (category) {
      params.push(category);
      whereClause += ` AND question_type = $${params.length}`;
    }
    if (difficulty) {
      params.push(difficulty);
      whereClause += ` AND difficulty = $${params.length}`;
    }

    // Get questions
    const questions = await pool.query(
      `SELECT id, role, question_text, question_type, difficulty, key_points, times_used, avg_score, created_at
       FROM question_bank
       ${whereClause}
       ORDER BY times_used DESC, created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), Number(offset)]
    );

    // Get available roles for filter dropdown
    const roles = await pool.query(
      'SELECT DISTINCT role, COUNT(*) as count FROM question_bank GROUP BY role ORDER BY count DESC'
    );

    // Get category counts
    const categoryCounts = await pool.query(
      `SELECT question_type, COUNT(*) as count FROM question_bank ${whereClause} GROUP BY question_type ORDER BY count DESC`,
      params
    );

    const total = await pool.query(
      `SELECT COUNT(*) as count FROM question_bank ${whereClause}`,
      params
    );

    res.json({
      success: true,
      questions: questions.rows,
      total: parseInt(total.rows[0].count),
      available_roles: roles.rows,
      category_counts: categoryCounts.rows
    });
  } catch (err) {
    console.error('Browse question bank error:', err);
    res.status(500).json({ error: 'Failed to browse question bank' });
  }
});

// Get session feedback (for polling — allows frontend to fetch updated feedback after background analysis)
router.get('/mock/sessions/:id/feedback', authMiddleware, async (req, res) => {
  try {
    const session = await pool.query(
      'SELECT overall_feedback, overall_score, status FROM mock_interview_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const row = session.rows[0];
    const feedback = typeof row.overall_feedback === 'string'
      ? JSON.parse(row.overall_feedback)
      : row.overall_feedback;

    res.json({
      success: true,
      feedback,
      overall_score: row.overall_score,
      status: row.status
    });
  } catch (err) {
    console.error('Get session feedback error:', err);
    res.status(500).json({ error: 'Failed to fetch feedback' });
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

    // Quick analysis with vision API — uses provider fallback (GPT-4o → NIM Cosmos → NIM Nemotron VL)
    const { aiProvider } = require('../lib/polsia-ai');
    const analysisPrompt = `Quick interview body language check. Rate each as "good", "fair", or "poor" with a 2-3 word tip. Return JSON only:
{"eye_contact":"good|fair|poor","posture":"good|fair|poor","confidence":"good|fair|poor","expression":"good|fair|poor","tip":"brief tip"}`;

    const text = await aiProvider.visionAnalysis([frameUrl], analysisPrompt, {
      maxTokens: 200,
      task: 'interview-realtime-body-language',
      module: 'mock_interview', feature: 'realtime_body_language',
    });
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
      // Audio file uploaded as multipart — use ASR fallback chain (Whisper → NIM Parakeet v2 → v3)
      const baseMime = (req.file.mimetype || 'audio/webm').split(';')[0];
      const ext = baseMime.includes('mp4') ? 'mp4' : baseMime.includes('ogg') ? 'ogg' : 'webm';
      const filename = `recording.${ext}`;
      console.log(`[voice-respond] Received file: ${req.file.size} bytes, mime: ${req.file.mimetype}, client transcript: ${clientTranscript.length} chars`);

      try {
        // Use the full ASR fallback chain (OpenAI Whisper → NIM Parakeet v2 → NIM Parakeet v3)
        const asrResult = await aiProvider.transcribeAudio(
          req.file.buffer,
          filename,
          baseMime,
          { subscriptionId: req.user.stripe_subscription_id, module: 'mock_interview', feature: 'voice_transcription' }
        );
        if (asrResult && asrResult.text) {
          transcribedText = asrResult.text.trim();
          console.log(`[voice-respond] ASR transcription: "${transcribedText.substring(0, 100)}..."`);
        } else if (clientTranscript.length >= 10) {
          // ASR returned nothing — use client transcript
          transcribedText = clientTranscript;
          usedFallback = true;
          console.log(`[voice-respond] ASR empty, using client transcript`);
        }
      } catch (asrErr) {
        console.error('[voice-respond] ASR fallback chain failed:', asrErr.message);
        // All ASR providers failed — fall back to client-side SpeechRecognition transcript
        if (clientTranscript.length >= 10) {
          transcribedText = clientTranscript;
          usedFallback = true;
          console.log(`[voice-respond] Using client SpeechRecognition fallback: "${transcribedText.substring(0, 100)}..."`);
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

    // BUG FIX #1: Hard question limit — force wrap_up after 8 candidate turns
    const MAX_QUESTIONS = 8;
    const voiceCandidateCount = conversation.filter(t => t.role === 'candidate').length;
    const shouldForceEnd = voiceCandidateCount >= MAX_QUESTIONS;

    let aiTurn;

    if (shouldForceEnd) {
      console.log(`[voice-respond] Hard question limit reached (${voiceCandidateCount} turns), forcing wrap_up`);
      aiTurn = {
        reaction: `Great conversation — we've covered a lot across ${voiceCandidateCount} questions. I have a good picture of your background.`,
        action: 'wrap_up',
        question: "Before we wrap up, is there anything you'd like to add or ask about the role?",
        score_hint: null,
        notes: 'Hard question limit reached'
      };
    } else {
      // BUG FIX: Wrap with 20s overall timeout — the LLM chain can take 135s (9 providers × 15s each),
      // but Render kills the request at ~30s. Without this, the scripted fallback never fires.
      try {
        aiTurn = await withTimeout(
          conductInterviewTurn(
            conversation,
            baseQuestions,
            session.current_question_index,
            session.target_role,
            { subscriptionId: req.user.stripe_subscription_id }
          ),
          20000,
          'Voice interview AI turn generation'
        );
        // BUG FIX: Override generic AI reactions — don't echo user's words
        if (aiTurn && aiTurn.reaction && /^(Thank you for (that|sharing|your) (response|answer)|That's (helpful|great|good|interesting)\.?)\s*$/i.test(aiTurn.reaction.trim())) {
          const NATURAL_AI_ACKS = [
            "Interesting perspective. Let me follow up on that.",
            "That gives me good context. I'd like to dig a little deeper.",
            "That's a thoughtful response. Let me explore another angle.",
            "I appreciate the detail. Let me build on that.",
          ];
          aiTurn.reaction = NATURAL_AI_ACKS[voiceCandidateCount % NATURAL_AI_ACKS.length];
        }
      } catch (aiErr) {
        console.warn(`[voice-respond] AI turn generation failed (${aiErr.message}), using scripted fallback`);
        const nextIdx = session.current_question_index + 1;
        const nextQ = baseQuestions[nextIdx];
        // BUG FIX: Don't echo user's words back — use natural acknowledgments instead
        const NATURAL_ACKS = [
          "Thanks for that. Really helpful to understand your perspective.",
          "Appreciate you sharing that. It gives me good insight into how you think.",
          "Good to hear. That's exactly the kind of detail I was looking for.",
          "Understood. That paints a clear picture of your experience.",
          "Thanks for walking me through that. Let me ask you something else.",
        ];
        const ackIdx = voiceCandidateCount % NATURAL_ACKS.length;
        if (nextQ && voiceCandidateCount < MAX_QUESTIONS) {
          aiTurn = {
            reaction: NATURAL_ACKS[ackIdx],
            action: 'transition',
            question: nextQ.question_text,
            score_hint: null,
            notes: 'AI unavailable — scripted transition'
          };
        } else {
          aiTurn = {
            reaction: `We've had a thorough discussion. I've got a good sense of your experience and approach.`,
            action: 'wrap_up',
            question: "Is there anything else you'd like to add before we wrap up?",
            score_hint: null,
            notes: 'AI unavailable — scripted wrap-up'
          };
        }
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

    // Step 5: Generate TTS for interviewer response (8s timeout — TTS chain is 2 providers × 8s max)
    let audioBase64 = null;
    try {
      const audioBuffer = await withTimeout(
        textToSpeech(interviewerText, {
          voice: 'nova',
          subscriptionId: req.user.stripe_subscription_id
        }),
        10000,
        'TTS generation'
      );
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

// =============== SMART SCHEDULING ===============
const interviewAI = require('../services/interview-ai');

// POST /api/interviews/suggest-slots — AI suggests optimal interview time slots
router.post('/suggest-slots', authMiddleware, async (req, res) => {
  try {
    const { candidate_timezone, days_ahead, slots_count, duration_minutes } = req.body;

    const slots = await interviewAI.suggestSlots(
      req.user.id,
      candidate_timezone || 'America/New_York',
      {
        daysAhead: Math.min(days_ahead || 7, 30),
        slotsCount: Math.min(slots_count || 6, 12),
        durationMinutes: duration_minutes || 60
      }
    );

    res.json({ success: true, slots, count: slots.length });
  } catch (err) {
    console.error('Suggest slots error:', err);
    res.status(500).json({ error: 'Failed to suggest interview slots' });
  }
});

// POST /api/interviews/schedule — Schedule with AI-suggested slot + create reminders
router.post('/schedule', authMiddleware, async (req, res) => {
  try {
    const { job_id, candidate_id, scheduled_at, duration_minutes = 60, interview_type = 'video', notes } = req.body;

    if (!job_id || !candidate_id || !scheduled_at) {
      return res.status(400).json({ error: 'Job, candidate, and time are required' });
    }

    // Auto-generate meeting link
    let meeting_link = null;
    if (interview_type === 'video') {
      const roomId = `RekrutAI-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
      meeting_link = `https://meet.jit.si/${roomId}`;
    }

    // Get company_id from user
    const companyId = req.user.company_id;

    const result = await pool.query(
      `INSERT INTO scheduled_interviews
       (company_id, job_id, candidate_id, recruiter_id, scheduled_at, duration_minutes, interview_type, meeting_link, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [companyId, job_id, candidate_id, req.user.id, scheduled_at, duration_minutes, interview_type, meeting_link, notes]
    );

    const interview = result.rows[0];

    // Create reminders
    const reminderCount = await interviewAI.createReminders(interview.id, candidate_id, req.user.id, scheduled_at);

    res.json({
      success: true,
      interview,
      reminders_created: reminderCount
    });
  } catch (err) {
    console.error('Schedule interview error:', err);
    res.status(500).json({ error: 'Failed to schedule interview' });
  }
});

// PUT /api/interviews/reschedule — Cancel and suggest new slots
router.put('/reschedule', authMiddleware, async (req, res) => {
  try {
    const { interview_id, new_scheduled_at } = req.body;

    if (!interview_id) {
      return res.status(400).json({ error: 'Interview ID is required' });
    }

    // Get interview
    const existing = await pool.query(
      'SELECT * FROM scheduled_interviews WHERE id = $1',
      [interview_id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Interview not found' });
    }

    if (new_scheduled_at) {
      // Reschedule to specific time
      let meeting_link = existing.rows[0].meeting_link;
      if (existing.rows[0].interview_type === 'video' && !meeting_link) {
        const roomId = `RekrutAI-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
        meeting_link = `https://meet.jit.si/${roomId}`;
      }

      await pool.query(
        `UPDATE scheduled_interviews SET scheduled_at = $1, status = 'scheduled', meeting_link = $2, updated_at = NOW() WHERE id = $3`,
        [new_scheduled_at, meeting_link, interview_id]
      );

      // Delete old reminders, create new ones
      await pool.query('DELETE FROM interview_reminders WHERE interview_id = $1', [interview_id]);
      const reminderCount = await interviewAI.createReminders(
        interview_id,
        existing.rows[0].candidate_id,
        existing.rows[0].recruiter_id,
        new_scheduled_at
      );

      const updated = await pool.query('SELECT * FROM scheduled_interviews WHERE id = $1', [interview_id]);
      res.json({ success: true, interview: updated.rows[0], reminders_created: reminderCount });
    } else {
      // Cancel current and suggest new slots
      await pool.query(
        `UPDATE scheduled_interviews SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [interview_id]
      );

      const suggestedSlots = await interviewAI.suggestRescheduleSlots(interview_id);
      res.json({ success: true, cancelled: true, suggested_slots: suggestedSlots });
    }
  } catch (err) {
    console.error('Reschedule interview error:', err);
    res.status(500).json({ error: 'Failed to reschedule interview' });
  }
});

// Save/update scheduling preferences
router.post('/scheduling-preferences', authMiddleware, async (req, res) => {
  try {
    const { timezone, available_days, available_hours, buffer_minutes, preferred_duration, blackout_dates } = req.body;

    const result = await pool.query(
      `INSERT INTO scheduling_preferences (user_id, timezone, available_days, available_hours, buffer_minutes, preferred_duration, blackout_dates)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         timezone = COALESCE($2, scheduling_preferences.timezone),
         available_days = COALESCE($3, scheduling_preferences.available_days),
         available_hours = COALESCE($4, scheduling_preferences.available_hours),
         buffer_minutes = COALESCE($5, scheduling_preferences.buffer_minutes),
         preferred_duration = COALESCE($6, scheduling_preferences.preferred_duration),
         blackout_dates = COALESCE($7, scheduling_preferences.blackout_dates),
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.id,
        timezone || 'America/New_York',
        JSON.stringify(available_days || ['monday','tuesday','wednesday','thursday','friday']),
        JSON.stringify(available_hours || { start: '09:00', end: '17:00' }),
        buffer_minutes || 15,
        preferred_duration || 60,
        JSON.stringify(blackout_dates || [])
      ]
    );

    res.json({ success: true, preferences: result.rows[0] });
  } catch (err) {
    console.error('Save scheduling preferences error:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// Get scheduling preferences
router.get('/scheduling-preferences', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM scheduling_preferences WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      preferences: result.rows[0] || {
        timezone: 'America/New_York',
        available_days: ['monday','tuesday','wednesday','thursday','friday'],
        available_hours: { start: '09:00', end: '17:00' },
        buffer_minutes: 15,
        preferred_duration: 60,
        blackout_dates: []
      }
    });
  } catch (err) {
    console.error('Get scheduling preferences error:', err);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// =============== SCREENING PIPELINE ===============

// POST /api/interviews/screening/create-template — Recruiter creates a screening template
router.post('/screening/create-template', authMiddleware, async (req, res) => {
  try {
    const { job_id, title, description, questions, time_limit_minutes, auto_send_on_apply } = req.body;

    if (!job_id) {
      return res.status(400).json({ error: 'Job ID is required' });
    }

    // Get job details for AI question generation
    const job = await pool.query('SELECT title, description FROM jobs WHERE id = $1', [job_id]);
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Use provided questions or generate with AI
    let finalQuestions = questions;
    if (!finalQuestions || finalQuestions.length === 0) {
      finalQuestions = await interviewAI.generateScreeningQuestions(
        job.rows[0].title,
        job.rows[0].description
      );
    }

    const result = await pool.query(
      `INSERT INTO screening_templates (company_id, job_id, created_by, title, description, questions, time_limit_minutes, auto_send_on_apply)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.company_id,
        job_id,
        req.user.id,
        title || `Screening: ${job.rows[0].title}`,
        description || `AI screening interview for ${job.rows[0].title} candidates`,
        JSON.stringify(finalQuestions),
        time_limit_minutes || 45,
        auto_send_on_apply || false
      ]
    );

    res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    console.error('Create screening template error:', err);
    res.status(500).json({ error: 'Failed to create screening template' });
  }
});

// GET /api/interviews/screening/templates — Get screening templates for company
router.get('/screening/templates', authMiddleware, async (req, res) => {
  try {
    const { job_id } = req.query;
    let query = `
      SELECT st.*, j.title as job_title,
             (SELECT COUNT(*) FROM screening_sessions ss WHERE ss.template_id = st.id) as sessions_count,
             (SELECT COUNT(*) FROM screening_sessions ss WHERE ss.template_id = st.id AND ss.status = 'completed') as completed_count
      FROM screening_templates st
      JOIN jobs j ON st.job_id = j.id
      WHERE st.company_id = $1 AND st.status = 'active'
    `;
    const params = [req.user.company_id];

    if (job_id) {
      query += ` AND st.job_id = $2`;
      params.push(job_id);
    }

    query += ' ORDER BY st.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ success: true, templates: result.rows });
  } catch (err) {
    console.error('Get screening templates error:', err);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/interviews/screening/send — Send screening invite to candidate
router.post('/screening/send', authMiddleware, async (req, res) => {
  try {
    const { template_id, candidate_id, application_id, job_id } = req.body;

    if (!template_id || !candidate_id) {
      return res.status(400).json({ error: 'Template and candidate are required' });
    }

    // Get template
    const template = await pool.query(
      'SELECT * FROM screening_templates WHERE id = $1 AND company_id = $2',
      [template_id, req.user.company_id]
    );

    if (template.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const tmpl = template.rows[0];

    // Check if screening already sent
    const existing = await pool.query(
      `SELECT id FROM screening_sessions WHERE template_id = $1 AND candidate_id = $2 AND status != 'expired'`,
      [template_id, candidate_id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Screening already sent to this candidate', session_id: existing.rows[0].id });
    }

    // Create screening session with invite token
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60000); // 7 days

    const result = await pool.query(
      `INSERT INTO screening_sessions
       (template_id, company_id, job_id, candidate_id, application_id, invited_by, invite_token, questions, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        template_id,
        req.user.company_id,
        tmpl.job_id || job_id,
        candidate_id,
        application_id || null,
        req.user.id,
        inviteToken,
        JSON.stringify(tmpl.questions),
        expiresAt
      ]
    );

    // Update application screening status
    if (application_id) {
      await pool.query(
        `UPDATE job_applications SET screening_status = 'sent', updated_at = NOW() WHERE id = $1`,
        [application_id]
      );
    }

    res.json({
      success: true,
      session: result.rows[0],
      invite_url: `/screening/${inviteToken}`
    });
  } catch (err) {
    console.error('Send screening error:', err);
    res.status(500).json({ error: 'Failed to send screening invite' });
  }
});

// GET /api/interviews/screening/session/:token — Candidate loads screening (by token)
router.get('/screening/session/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ss.*, j.title as job_title, j.description as job_description, c.name as company_name
       FROM screening_sessions ss
       JOIN jobs j ON ss.job_id = j.id
       JOIN companies c ON ss.company_id = c.id
       WHERE ss.invite_token = $1`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screening not found or expired' });
    }

    const session = result.rows[0];

    // Check expiry
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Screening has expired' });
    }

    // Don't expose internal IDs
    res.json({
      success: true,
      screening: {
        id: session.id,
        job_title: session.job_title,
        company_name: session.company_name,
        questions: session.questions,
        status: session.status,
        time_limit_minutes: 45,
        started_at: session.started_at,
        completed_at: session.completed_at
      }
    });
  } catch (err) {
    console.error('Get screening session error:', err);
    res.status(500).json({ error: 'Failed to load screening' });
  }
});

// POST /api/interviews/screening/session/:token/start — Candidate starts screening
router.post('/screening/session/:token/start', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE screening_sessions SET status = 'in_progress', started_at = NOW()
       WHERE invite_token = $1 AND status = 'invited'
       RETURNING id`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screening not found or already started' });
    }

    // Update application status
    const session = await pool.query('SELECT application_id FROM screening_sessions WHERE invite_token = $1', [req.params.token]);
    if (session.rows[0]?.application_id) {
      await pool.query(
        `UPDATE job_applications SET screening_status = 'in_progress', updated_at = NOW() WHERE id = $1`,
        [session.rows[0].application_id]
      );
    }

    res.json({ success: true, started: true });
  } catch (err) {
    console.error('Start screening error:', err);
    res.status(500).json({ error: 'Failed to start screening' });
  }
});

// POST /api/interviews/screening/session/:token/respond — Candidate submits a response
router.post('/screening/session/:token/respond', async (req, res) => {
  try {
    const { question_index, response_text } = req.body;

    const session = await pool.query(
      `SELECT * FROM screening_sessions WHERE invite_token = $1 AND status = 'in_progress'`,
      [req.params.token]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Screening not found or not in progress' });
    }

    const s = session.rows[0];
    const responses = s.responses || [];
    const conversation = s.conversation || [];

    // Save response
    responses[question_index] = {
      question_index,
      response_text: response_text || '',
      submitted_at: new Date().toISOString()
    };

    // Add to conversation
    const q = s.questions[question_index];
    if (q) {
      conversation.push(
        { role: 'interviewer', text: q.question_text, timestamp: new Date().toISOString() },
        { role: 'candidate', text: response_text || '', timestamp: new Date().toISOString() }
      );
    }

    await pool.query(
      `UPDATE screening_sessions SET responses = $1, conversation = $2 WHERE id = $3`,
      [JSON.stringify(responses), JSON.stringify(conversation), s.id]
    );

    const answeredCount = responses.filter(r => r && r.response_text).length;
    const totalQuestions = s.questions.length;

    res.json({
      success: true,
      answered: answeredCount,
      total: totalQuestions,
      is_complete: answeredCount >= totalQuestions
    });
  } catch (err) {
    console.error('Screening respond error:', err);
    res.status(500).json({ error: 'Failed to save response' });
  }
});

// POST /api/interviews/screening/session/:token/complete — Candidate completes screening
router.post('/screening/session/:token/complete', async (req, res) => {
  try {
    const session = await pool.query(
      `SELECT * FROM screening_sessions WHERE invite_token = $1 AND status = 'in_progress'`,
      [req.params.token]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Screening not found or not in progress' });
    }

    const s = session.rows[0];

    // Generate AI evaluation report
    const report = await interviewAI.generateScreeningReport(s);

    // Save report and complete
    await pool.query(
      `UPDATE screening_sessions SET status = 'completed', ai_report = $1, overall_score = $2, completed_at = NOW() WHERE id = $3`,
      [JSON.stringify(report), report.overall_score, s.id]
    );

    // Update application screening status
    if (s.application_id) {
      await pool.query(
        `UPDATE job_applications SET screening_status = 'completed', screening_score = $1, updated_at = NOW() WHERE id = $2`,
        [report.overall_score, s.application_id]
      );
    }

    // Run multi-evaluator scoring in background
    const jobResult = await pool.query('SELECT title, description FROM jobs WHERE id = $1', [s.job_id]);
    const jobData = jobResult.rows[0] || {};

    interviewAI.runMultiEvaluation(s.candidate_id, s.job_id, s.company_id, {
      screeningSessionId: s.id,
      conversation: s.conversation || [],
      responses: s.responses || [],
      jobTitle: jobData.title,
      jobDescription: jobData.description
    }).catch(err => console.error('[screening] Multi-evaluation background failed:', err.message));

    res.json({
      success: true,
      report: {
        overall_score: report.overall_score,
        recommendation: report.recommendation,
        strengths: report.strengths
      }
    });
  } catch (err) {
    console.error('Complete screening error:', err);
    res.status(500).json({ error: 'Failed to complete screening' });
  }
});

// GET /api/interviews/screening/:id/report — Recruiter gets screening report
router.get('/screening/:id/report', authMiddleware, async (req, res) => {
  try {
    const session = await pool.query(
      `SELECT ss.*, j.title as job_title, u.name as candidate_name, u.email as candidate_email
       FROM screening_sessions ss
       JOIN jobs j ON ss.job_id = j.id
       JOIN users u ON ss.candidate_id = u.id
       WHERE ss.id = $1 AND ss.company_id = $2`,
      [req.params.id, req.user.company_id]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Screening session not found' });
    }

    const s = session.rows[0];

    // Get multi-evaluation scores if available
    const evaluations = await pool.query(
      `SELECT evaluator_type, score, breakdown, reasoning FROM interview_evaluations
       WHERE screening_session_id = $1 ORDER BY created_at`,
      [s.id]
    );

    const composite = await pool.query(
      `SELECT * FROM interview_composite_scores WHERE screening_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [s.id]
    );

    res.json({
      success: true,
      session: {
        id: s.id,
        candidate_name: s.candidate_name,
        candidate_email: s.candidate_email,
        job_title: s.job_title,
        status: s.status,
        overall_score: s.overall_score,
        started_at: s.started_at,
        completed_at: s.completed_at,
        questions: s.questions,
        responses: s.responses,
        conversation: s.conversation
      },
      report: s.ai_report,
      evaluations: evaluations.rows,
      composite: composite.rows[0] || null
    });
  } catch (err) {
    console.error('Get screening report error:', err);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// =============== MULTI-EVALUATOR SCORING ===============

// POST /api/interviews/evaluate — Run multi-agent evaluation on an interview
router.post('/evaluate', authMiddleware, async (req, res) => {
  try {
    const { interview_id, screening_session_id } = req.body;

    let candidateId, jobId, companyId, conversation, responses, jobTitle, jobDescription;

    if (interview_id) {
      // Evaluate a scheduled interview
      const interview = await pool.query(
        `SELECT si.*, j.title as job_title, j.description as job_description
         FROM scheduled_interviews si
         JOIN jobs j ON si.job_id = j.id
         WHERE si.id = $1 AND si.company_id = $2`,
        [interview_id, req.user.company_id]
      );

      if (interview.rows.length === 0) {
        return res.status(404).json({ error: 'Interview not found' });
      }

      const i = interview.rows[0];
      candidateId = i.candidate_id;
      jobId = i.job_id;
      companyId = i.company_id;
      jobTitle = i.job_title;
      jobDescription = i.job_description;

      // Try to get conversation from mock_interview_sessions for this candidate
      const mockSession = await pool.query(
        `SELECT conversation FROM mock_interview_sessions
         WHERE user_id = $1 AND status = 'completed'
         ORDER BY completed_at DESC LIMIT 1`,
        [candidateId]
      );
      conversation = mockSession.rows[0]?.conversation || [];

      // Also check feedback from interview notes
      if (i.feedback) {
        const fb = typeof i.feedback === 'string' ? JSON.parse(i.feedback) : i.feedback;
        if (fb.notes) {
          conversation.push({ role: 'interviewer_notes', text: fb.notes });
        }
      }
    } else if (screening_session_id) {
      // Evaluate a screening session
      const session = await pool.query(
        `SELECT ss.*, j.title as job_title, j.description as job_description
         FROM screening_sessions ss
         JOIN jobs j ON ss.job_id = j.id
         WHERE ss.id = $1 AND ss.company_id = $2`,
        [screening_session_id, req.user.company_id]
      );

      if (session.rows.length === 0) {
        return res.status(404).json({ error: 'Screening session not found' });
      }

      const s = session.rows[0];
      candidateId = s.candidate_id;
      jobId = s.job_id;
      companyId = s.company_id;
      conversation = s.conversation || [];
      responses = s.responses || [];
      jobTitle = s.job_title;
      jobDescription = s.job_description;
    } else {
      return res.status(400).json({ error: 'interview_id or screening_session_id required' });
    }

    const result = await interviewAI.runMultiEvaluation(candidateId, jobId, companyId, {
      interviewId: interview_id || null,
      screeningSessionId: screening_session_id || null,
      conversation,
      responses,
      jobTitle,
      jobDescription
    });

    if (!result) {
      return res.status(400).json({ error: 'Not enough interview data to evaluate' });
    }

    // Update interview record with AI evaluation
    if (interview_id) {
      await pool.query(
        `UPDATE scheduled_interviews SET ai_evaluation = $1, ai_composite_score = $2, updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(result), result.composite.composite_score, interview_id]
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Evaluate interview error:', err);
    res.status(500).json({ error: 'Failed to evaluate interview' });
  }
});

// GET /api/interviews/:id/ai-scores — Get AI evaluation scores for an interview
router.get('/:id/ai-scores', authMiddleware, async (req, res) => {
  try {
    const interviewId = req.params.id;

    // Get individual evaluations
    const evaluations = await pool.query(
      `SELECT evaluator_type, score, breakdown, reasoning, created_at
       FROM interview_evaluations
       WHERE interview_id = $1 OR screening_session_id = $1
       ORDER BY created_at`,
      [interviewId]
    );

    // Get composite score
    const composite = await pool.query(
      `SELECT * FROM interview_composite_scores
       WHERE interview_id = $1 OR screening_session_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [interviewId]
    );

    res.json({
      success: true,
      evaluations: evaluations.rows,
      composite: composite.rows[0] || null
    });
  } catch (err) {
    console.error('Get AI scores error:', err);
    res.status(500).json({ error: 'Failed to fetch AI scores' });
  }
});

module.exports = router;