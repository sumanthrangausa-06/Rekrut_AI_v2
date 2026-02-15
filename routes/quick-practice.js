/**
 * ISOLATED Quick Practice Routes — Decoupled from Mock Interview (#32717)
 *
 * This file contains ALL Quick Practice API routes (/practice/*).
 * It imports ONLY from lib/qp-ai.js and lib/qp-provider.js — NEVER from
 * lib/polsia-ai.js or lib/ai-provider.js.
 *
 * Changes to Mock Interview routes (interviews.js) or shared AI modules
 * (polsia-ai.js, ai-provider.js) will NOT affect Quick Practice.
 */
const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

// ISOLATED imports — Quick Practice's OWN analysis pipeline
const {
  analyzeInterviewResponse,
  generateInterviewCoaching,
  analyzeVideoInterviewResponse,
  handleAIError,
} = require('../lib/qp-ai');

const router = express.Router();

// ─── PRACTICE QUESTION LIBRARY ──────────────────────────────────
// Quick Practice's OWN copy — not shared with Mock Interview
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

// ─── Question type → category mapping ────────────────────────────
const TYPE_TO_CATEGORY = {
  behavioral: 'behavioral',
  technical: 'technical',
  situational: 'situational',
  competency: 'technical',
  role_specific: 'technical',
};

function capitalizeDifficulty(d) {
  if (!d) return 'Medium';
  const s = d.toLowerCase();
  if (s === 'easy') return 'Easy';
  if (s === 'hard') return 'Hard';
  return 'Medium';
}

// ─── GET /practice/library ──────────────────────────────────────
// Pulls from question_bank (DB) first; falls back to hardcoded if DB is empty
router.get('/practice/library', authMiddleware, async (req, res) => {
  try {
    // 1. Try to load questions from question_bank
    let questionLibrary = [];
    try {
      const dbQuestions = await pool.query(
        `SELECT id, question_text, question_type, difficulty, key_points, role
         FROM question_bank
         ORDER BY times_used DESC, created_at DESC
         LIMIT 200`
      );

      if (dbQuestions.rows.length > 0) {
        questionLibrary = dbQuestions.rows.map(row => ({
          id: `qb-${row.id}`,
          category: TYPE_TO_CATEGORY[row.question_type] || 'behavioral',
          difficulty: capitalizeDifficulty(row.difficulty),
          question: row.question_text,
          key_points: Array.isArray(row.key_points) && row.key_points.length > 0
            ? row.key_points
            : ['Content quality', 'Structure', 'Clarity', 'Relevance'],
          role: row.role || null,
        }));
        console.log(`[QP] Loaded ${questionLibrary.length} questions from question_bank`);
      }
    } catch (dbErr) {
      console.warn('[QP] Failed to query question_bank, falling back to hardcoded:', dbErr.message);
    }

    // 2. Fall back to hardcoded if DB returned nothing
    if (questionLibrary.length === 0) {
      questionLibrary = PRACTICE_QUESTION_LIBRARY;
      console.log('[QP] Using hardcoded fallback question library');
    }

    // 3. Enrich with user's practice history
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
    console.error('[QP] Get practice library error:', err);
    res.status(500).json({ error: 'Failed to fetch question library' });
  }
});

// ─── Helper: resolve question from DB or hardcoded library ──────
async function resolveQuestion(questionId) {
  // Try question_bank first (IDs like "qb-123")
  if (questionId && questionId.startsWith('qb-')) {
    const dbId = parseInt(questionId.replace('qb-', ''));
    if (!isNaN(dbId)) {
      try {
        const result = await pool.query(
          'SELECT question_text, question_type, difficulty, key_points FROM question_bank WHERE id = $1',
          [dbId]
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];
          return {
            question: row.question_text,
            key_points: Array.isArray(row.key_points) && row.key_points.length > 0
              ? row.key_points
              : ['Content quality', 'Structure', 'Clarity', 'Relevance'],
            category: TYPE_TO_CATEGORY[row.question_type] || 'behavioral',
          };
        }
      } catch (err) {
        console.warn('[QP] Failed to resolve question from DB:', err.message);
      }
    }
  }
  // Fall back to hardcoded library
  const libraryQ = PRACTICE_QUESTION_LIBRARY.find(q => q.id === questionId);
  if (libraryQ) {
    return { question: libraryQ.question, key_points: libraryQ.key_points, category: libraryQ.category };
  }
  return null;
}

// ─── POST /practice/submit ──────────────────────────────────────
router.post('/practice/submit', authMiddleware, async (req, res) => {
  try {
    const { response_text } = req.body;
    const question_id = req.body.question_id || 'general';
    const category = req.body.category || 'behavioral';
    const resolved = await resolveQuestion(question_id);
    const question = req.body.question || (resolved && resolved.question) || `Practice question ${question_id || 'unknown'}`;

    if (!response_text || response_text.trim().length < 50) {
      return res.status(400).json({ error: 'Response must be at least 50 characters' });
    }

    const keyPoints = resolved ? resolved.key_points : ['Content quality', 'Structure', 'Clarity', 'Relevance'];

    const analysis = await analyzeInterviewResponse(
      question,
      response_text,
      keyPoints,
      { subscriptionId: req.user.stripe_subscription_id }
    );

    let coaching;
    try {
      coaching = await generateInterviewCoaching(
        question,
        response_text,
        analysis,
        { subscriptionId: req.user.stripe_subscription_id }
      );
    } catch (coachErr) {
      console.warn('[QP] Coaching generation failed, using analysis only:', coachErr.message);
      coaching = null;
    }

    const fullCoaching = {
      score: analysis.score,
      strengths: analysis.strengths || [],
      improvements: analysis.improvements || [],
      ...(coaching && typeof coaching === 'object' ? coaching : {
        improved_response: '', specific_tips: [], body_language_tips: [],
        common_mistake: '', practice_prompt: ''
      })
    };

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
    console.error('[QP] Submit practice response error:', err);
    res.status(500).json({ error: 'Failed to analyze response' });
  }
});

// ─── POST /practice/submit-video ────────────────────────────────
router.post('/practice/submit-video', authMiddleware, async (req, res) => {
  try {
    const { transcription, frames, duration_seconds, audio_data } = req.body;
    const question_id = req.body.question_id || 'general';
    const category = req.body.category || 'behavioral';
    const resolved = await resolveQuestion(question_id);
    const question = req.body.question || (resolved && resolved.question) || `Practice question ${question_id || 'unknown'}`;

    if (!transcription || transcription.trim().length < 20) {
      return res.status(400).json({ error: 'Transcription too short. Please speak for at least 15-20 seconds.' });
    }

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'No video frames captured. Please allow camera access.' });
    }

    const keyPoints = resolved ? resolved.key_points : ['Content quality', 'Structure', 'Clarity', 'Relevance'];

    // Route-level 38s safety timeout (internal analysis has 25s master timeout)
    const ROUTE_TIMEOUT_MS = 38000;
    const coaching = await Promise.race([
      analyzeVideoInterviewResponse(
        question,
        transcription,
        frames,
        duration_seconds || 60,
        keyPoints,
        { subscriptionId: req.user.stripe_subscription_id, audioData: audio_data || null }
      ),
      new Promise((_, reject) => setTimeout(() => {
        console.error('[QP] ⏱️ Route-level safety timeout (38s) — analysis hung');
        reject(new Error('Analysis timeout'));
      }, ROUTE_TIMEOUT_MS))
    ]);

    if (!coaching || typeof coaching !== 'object') {
      console.warn('[QP] AI analysis returned null/invalid — returning graceful error');
      return res.status(200).json({
        success: true,
        coaching: {
          overall_score: 5,
          content: {
            score: 5, strengths: ['Response provided'], improvements: ['AI analysis temporarily unavailable — please try again'],
            covered_points: [], missed_points: [], detailed_feedback: 'Analysis could not be completed. Please try again.',
            improved_response: '', specific_tips: ['Try again for detailed coaching tips'],
            common_mistake: '', practice_prompt: ''
          },
          communication: { score: 5, word_count: 0, words_per_minute: 0, duration_seconds: duration_seconds || 60,
            filler_words: {}, total_fillers: 0, filler_rate: 0, pace: 'unknown', tips: [],
            voice_analysis: null },
          presentation: { score: 5, eye_contact: { score: 5, feedback: 'Analysis unavailable' },
            facial_expressions: { score: 5, feedback: 'Analysis unavailable' },
            body_language: { score: 5, feedback: 'Analysis unavailable' },
            professional_appearance: { score: 5, feedback: 'Analysis unavailable' },
            summary: 'Video analysis could not be completed.', timestamped_notes: [] }
        }
      });
    }

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
        Math.round(coaching.overall_score || 5),
        JSON.stringify(coaching),
        transcription,
        JSON.stringify(coaching.communication || {}),
        JSON.stringify(coaching.presentation || {}),
        duration_seconds || 60
      ]
    );

    res.json({
      success: true,
      coaching
    });
  } catch (err) {
    console.error('[QP] Submit video practice response error:', err.message || err);
    if (err.message === 'Analysis timeout' || err.allProvidersFailed) {
      return res.status(503).json({
        error: 'AI analysis is temporarily slow. Please try again in a moment.',
        retryable: true,
        retryAfterMs: 3000,
      });
    }
    res.status(500).json({ error: 'Failed to analyze video response. Please try again.' });
  }
});

// ─── GET /practice/stats ────────────────────────────────────────
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
    console.error('[QP] Get practice stats error:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ─── GET /practice/progress ─────────────────────────────────────
router.get('/practice/progress', authMiddleware, async (req, res) => {
  try {
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

    const sessionsWithParsedData = recentSessions.rows.map(row => {
      let improvements = [];
      try {
        if (row.improvements) {
          improvements = JSON.parse(row.improvements);
        }
      } catch (e) {
        console.error('[QP] Failed to parse improvements:', e);
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
    console.error('[QP] Get practice progress error:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// ─── GET /practice/sessions ─────────────────────────────────────
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

    // BUG FIX #29: For mock interview sessions, compute real category from question_bank
    const mockSessionIds = sessions.rows
      .filter(r => r.question_id && r.question_id.startsWith('mock-'))
      .map(r => parseInt(r.question_id.replace('mock-', '')));
    let mockCategoryMap = {};
    if (mockSessionIds.length > 0) {
      try {
        const mockSessions = await pool.query(
          'SELECT id, question_ids FROM mock_interview_sessions WHERE id = ANY($1)',
          [mockSessionIds]
        );
        const allQIds = [...new Set(mockSessions.rows.flatMap(s => s.question_ids || []))];
        if (allQIds.length > 0) {
          const qTypes = await pool.query('SELECT id, question_type FROM question_bank WHERE id = ANY($1)', [allQIds]);
          const typeMap = {};
          qTypes.rows.forEach(q => { typeMap[q.id] = q.question_type; });
          const typeToCategory = { behavioral: 'behavioral', technical: 'technical', situational: 'situational', competency: 'technical', role_specific: 'technical' };
          for (const ms of mockSessions.rows) {
            const counts = { behavioral: 0, technical: 0, situational: 0 };
            (ms.question_ids || []).forEach(id => {
              const raw = typeMap[id];
              const cat = typeToCategory[raw] || 'behavioral';
              counts[cat]++;
            });
            const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
            mockCategoryMap[ms.id] = dominant[1] > 0 ? dominant[0] : 'behavioral';
          }
        }
      } catch (mcErr) { console.error('[QP] Mock category enrichment failed:', mcErr.message); }
    }

    const parsed = sessions.rows.map(row => {
      let category = row.category;
      // Override mock_interview or behavioral for mock sessions with computed category
      if (row.question_id && row.question_id.startsWith('mock-')) {
        const mockId = parseInt(row.question_id.replace('mock-', ''));
        if (mockCategoryMap[mockId]) category = mockCategoryMap[mockId];
      }
      return {
        ...row,
        category,
        coaching_data: typeof row.coaching_data === 'string' ? JSON.parse(row.coaching_data) : row.coaching_data,
        audio_analysis: typeof row.audio_analysis === 'string' ? JSON.parse(row.audio_analysis) : row.audio_analysis,
        video_analysis: typeof row.video_analysis === 'string' ? JSON.parse(row.video_analysis) : row.video_analysis,
      };
    });

    res.json({
      success: true,
      sessions: parsed,
      total: parseInt(total.rows[0].count),
      has_more: (Number(offset) + parsed.length) < parseInt(total.rows[0].count)
    });
  } catch (err) {
    console.error('[QP] Get practice sessions error:', err);
    res.status(500).json({ error: 'Failed to fetch coaching sessions' });
  }
});

// ─── GET /practice/sessions/:id ─────────────────────────────────
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
    console.error('[QP] Get practice session detail error:', err);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

module.exports = router;
