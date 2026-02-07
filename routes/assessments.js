const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { chat } = require('../lib/polsia-ai');

// Get user's available assessments
router.get('/available', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's skills that don't have verified assessments
    const result = await pool.query(`
      SELECT cs.id, cs.skill_name, cs.category, cs.level, cs.is_verified,
             COUNT(sa.id) as assessment_count,
             MAX(sa.score) as best_score
      FROM candidate_skills cs
      LEFT JOIN skill_assessments sa ON cs.id = sa.skill_id AND sa.completed_at IS NOT NULL
      WHERE cs.user_id = $1
      GROUP BY cs.id
      ORDER BY cs.is_verified ASC, cs.created_at DESC
    `, [userId]);

    res.json({ skills: result.rows });
  } catch (error) {
    console.error('Error fetching available assessments:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

// Get past assessment results
router.get('/results', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT sa.*, cs.skill_name, cs.category,
             ass.tab_switches, ass.copy_paste_attempts, ass.time_anomalies,
             ass.max_difficulty_reached, ass.answers_given
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL
      ORDER BY sa.completed_at DESC
    `, [userId]);

    res.json({ results: result.rows });
  } catch (error) {
    console.error('Error fetching assessment results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Start new assessment
router.post('/start', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { skillId, jobId } = req.body;

    if (!skillId) {
      return res.status(400).json({ error: 'Skill ID required' });
    }

    await client.query('BEGIN');

    // Get skill details
    const skillResult = await client.query(
      'SELECT * FROM candidate_skills WHERE id = $1 AND user_id = $2',
      [skillId, userId]
    );

    if (skillResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Skill not found' });
    }

    const skill = skillResult.rows[0];

    // Create assessment session
    const sessionResult = await client.query(`
      INSERT INTO assessment_sessions
      (user_id, skill_id, job_id, current_difficulty, started_at)
      VALUES ($1, $2, $3, 2, NOW())
      RETURNING *
    `, [userId, skillId, jobId || null]);

    const session = sessionResult.rows[0];

    // Generate first question
    const question = await generateQuestion(skill.skill_name, skill.category, 2, client);

    // Record question asked
    const questionsAsked = [{ questionId: question.id, difficulty: question.difficulty_level, timestamp: new Date() }];
    await client.query(
      'UPDATE assessment_sessions SET questions_asked = $1, current_question_index = 1 WHERE id = $2',
      [JSON.stringify(questionsAsked), session.id]
    );

    await client.query('COMMIT');

    res.json({
      sessionId: session.id,
      question: {
        id: question.id,
        text: question.question_text,
        type: question.question_type,
        options: question.options,
        timeLimit: question.time_limit_seconds,
        questionNumber: 1,
        totalQuestions: 10
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error starting assessment:', error);
    res.status(500).json({ error: 'Failed to start assessment' });
  } finally {
    client.release();
  }
});

// Submit answer and get next question
router.post('/answer', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { sessionId, questionId, answer, timeTaken } = req.body;

    await client.query('BEGIN');

    // Get session
    const sessionResult = await client.query(
      'SELECT * FROM assessment_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Session is not active' });
    }

    // Get question details
    const questionResult = await client.query(
      'SELECT * FROM assessment_questions WHERE id = $1',
      [questionId]
    );

    const question = questionResult.rows[0];

    // Evaluate answer
    let isCorrect = false;
    let scorePoints = 0;
    let aiFeedback = null;

    if (question.question_type === 'multiple_choice') {
      isCorrect = answer === question.correct_answer;
      scorePoints = isCorrect ? question.difficulty_level * 10 : 0;
    } else if (question.question_type === 'short_answer') {
      // Use AI to evaluate short answer
      const evaluation = await evaluateShortAnswer(question.question_text, answer, question.explanation);
      isCorrect = evaluation.score >= 70;
      scorePoints = Math.round((evaluation.score / 100) * question.difficulty_level * 15);
      aiFeedback = evaluation.feedback;
    }

    // Check for time anomaly (too fast)
    const expectedMinTime = question.question_type === 'multiple_choice' ? 10 : 30;
    const isTimeAnomaly = timeTaken < expectedMinTime;

    // Update session
    const questionsAsked = session.questions_asked;
    const answersGiven = session.answers_given || [];

    answersGiven.push({
      questionId,
      answer,
      isCorrect,
      scorePoints,
      timeTaken,
      timestamp: new Date(),
      aiFeedback
    });

    const newScore = session.score + scorePoints;
    const currentQuestionIndex = session.current_question_index + 1;

    // Adaptive difficulty: increase if correct and no time anomaly, decrease if wrong
    let newDifficulty = session.current_difficulty;
    if (isCorrect && !isTimeAnomaly && newDifficulty < 5) {
      newDifficulty += 1;
    } else if (!isCorrect && newDifficulty > 1) {
      newDifficulty -= 1;
    }

    const maxDifficultyReached = Math.max(session.max_difficulty_reached, newDifficulty);
    const timeAnomalies = session.time_anomalies + (isTimeAnomaly ? 1 : 0);

    await client.query(`
      UPDATE assessment_sessions
      SET answers_given = $1, score = $2, current_question_index = $3,
          current_difficulty = $4, max_difficulty_reached = $5,
          time_anomalies = $6
      WHERE id = $7
    `, [
      JSON.stringify(answersGiven), newScore, currentQuestionIndex,
      newDifficulty, maxDifficultyReached, timeAnomalies, sessionId
    ]);

    // Check if assessment is complete (10 questions)
    if (currentQuestionIndex >= 10) {
      await completeAssessment(client, sessionId, userId);
      await client.query('COMMIT');

      return res.json({
        completed: true,
        score: newScore,
        feedback: isCorrect ? 'Correct!' : 'Incorrect',
        explanation: question.explanation,
        aiFeedback
      });
    }

    // Get skill for next question
    const skillResult = await client.query(
      'SELECT cs.* FROM candidate_skills cs JOIN assessment_sessions ass ON cs.id = ass.skill_id WHERE ass.id = $1',
      [sessionId]
    );
    const skill = skillResult.rows[0];

    // Generate next question
    const nextQuestion = await generateQuestion(skill.skill_name, skill.category, newDifficulty, client);

    // Record question asked
    questionsAsked.push({
      questionId: nextQuestion.id,
      difficulty: nextQuestion.difficulty_level,
      timestamp: new Date()
    });

    await client.query(
      'UPDATE assessment_sessions SET questions_asked = $1 WHERE id = $2',
      [JSON.stringify(questionsAsked), sessionId]
    );

    await client.query('COMMIT');

    res.json({
      completed: false,
      feedback: isCorrect ? 'Correct!' : 'Incorrect',
      explanation: question.explanation,
      aiFeedback,
      nextQuestion: {
        id: nextQuestion.id,
        text: nextQuestion.question_text,
        type: nextQuestion.question_type,
        options: nextQuestion.options,
        timeLimit: nextQuestion.time_limit_seconds,
        questionNumber: currentQuestionIndex,
        totalQuestions: 10
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error submitting answer:', error);
    res.status(500).json({ error: 'Failed to submit answer' });
  } finally {
    client.release();
  }
});

// Log anti-cheat event
router.post('/event', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId, eventType, eventData } = req.body;

    // Verify session belongs to user
    const sessionResult = await pool.query(
      'SELECT id FROM assessment_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Log event
    await pool.query(`
      INSERT INTO assessment_events (session_id, event_type, event_data)
      VALUES ($1, $2, $3)
    `, [sessionId, eventType, eventData]);

    // Update session counters
    if (eventType === 'tab_switch') {
      await pool.query(
        'UPDATE assessment_sessions SET tab_switches = tab_switches + 1 WHERE id = $1',
        [sessionId]
      );
    } else if (eventType === 'copy_paste') {
      await pool.query(
        'UPDATE assessment_sessions SET copy_paste_attempts = copy_paste_attempts + 1 WHERE id = $1',
        [sessionId]
      );
    }

    res.json({ logged: true });
  } catch (error) {
    console.error('Error logging event:', error);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

// Helper: Generate or fetch question
async function generateQuestion(skillName, category, difficulty, client) {
  // Try to find existing question from bank
  const existingResult = await client.query(`
    SELECT * FROM assessment_questions
    WHERE skill_category = $1 AND difficulty_level = $2
    ORDER BY RANDOM()
    LIMIT 1
  `, [skillName, difficulty]);

  if (existingResult.rows.length > 0) {
    return existingResult.rows[0];
  }

  // Generate new question using AI
  const prompt = `Generate a ${difficulty}/5 difficulty technical assessment question for ${skillName} (${category} skill).

Format your response as JSON:
{
  "question_type": "multiple_choice" or "short_answer",
  "question_text": "The question...",
  "options": ["A", "B", "C", "D"] (only for multiple choice),
  "correct_answer": "A" (only for multiple choice),
  "explanation": "Why this is correct...",
  "time_limit_seconds": 60-300
}

Make it practical and relevant to real-world ${skillName} work.`;

  try {
    const response = await chat(prompt, { maxTokens: 1024 });
    const questionData = JSON.parse(response);

    // Save to database
    const result = await client.query(`
      INSERT INTO assessment_questions
      (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      skillName,
      difficulty,
      questionData.question_type,
      questionData.question_text,
      questionData.options ? JSON.stringify(questionData.options) : null,
      questionData.correct_answer || null,
      questionData.explanation,
      questionData.time_limit_seconds || 120
    ]);

    return result.rows[0];
  } catch (error) {
    console.error('Error generating question:', error);
    // Fallback to generic question
    const fallbackResult = await client.query(`
      SELECT * FROM assessment_questions
      ORDER BY RANDOM()
      LIMIT 1
    `);
    return fallbackResult.rows[0];
  }
}

// Helper: Evaluate short answer
async function evaluateShortAnswer(question, answer, rubric) {
  const prompt = `Evaluate this short answer response:

Question: ${question}

Answer: ${answer}

Rubric: ${rubric}

Provide a score from 0-100 and brief feedback. Format as JSON:
{
  "score": 85,
  "feedback": "Good answer because..."
}`;

  try {
    const response = await chat(prompt, { maxTokens: 512 });
    return JSON.parse(response);
  } catch (error) {
    console.error('Error evaluating answer:', error);
    return { score: 50, feedback: 'Unable to evaluate. Manual review needed.' };
  }
}

// Helper: Complete assessment
async function completeAssessment(client, sessionId, userId) {
  const sessionResult = await client.query(
    'SELECT * FROM assessment_sessions WHERE id = $1',
    [sessionId]
  );
  const session = sessionResult.rows[0];

  // Calculate anti-cheat score (100 = clean, lower = suspicious)
  let antiCheatScore = 100;
  antiCheatScore -= session.tab_switches * 5;  // -5 per tab switch
  antiCheatScore -= session.copy_paste_attempts * 10;  // -10 per copy/paste
  antiCheatScore -= session.time_anomalies * 5;  // -5 per time anomaly
  antiCheatScore = Math.max(0, antiCheatScore);

  const passed = session.score >= 60 && antiCheatScore >= 50;  // Need 60% score and minimal cheating

  // Mark session complete
  await client.query(
    'UPDATE assessment_sessions SET status = $1, completed_at = NOW() WHERE id = $2',
    ['completed', sessionId]
  );

  // Create skill assessment record
  const assessmentResult = await client.query(`
    INSERT INTO skill_assessments
    (user_id, skill_id, session_id, assessment_type, title, score, max_score, passed,
     anti_cheat_score, behavioral_flags, duration_seconds, started_at, completed_at)
    VALUES ($1, $2, $3, 'dynamic', $4, $5, 100, $6, $7, $8,
            EXTRACT(EPOCH FROM (NOW() - $9)), $9, NOW())
    RETURNING id
  `, [
    userId,
    session.skill_id,
    sessionId,
    `Dynamic ${session.skill_id} Assessment`,
    session.score,
    passed,
    antiCheatScore,
    JSON.stringify({
      tab_switches: session.tab_switches,
      copy_paste: session.copy_paste_attempts,
      time_anomalies: session.time_anomalies,
      max_difficulty: session.max_difficulty_reached
    }),
    session.started_at
  ]);

  // If passed, mark skill as verified
  if (passed) {
    await client.query(
      'UPDATE candidate_skills SET is_verified = true, verified_at = NOW(), verified_score = $1 WHERE id = $2',
      [session.score, session.skill_id]
    );
  }

  return assessmentResult.rows[0].id;
}

// Get single session result (for results page redirect)
router.get('/session/:sessionId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const sessionId = req.params.sessionId;

    const result = await pool.query(`
      SELECT sa.*, cs.skill_name, cs.category,
             ass.tab_switches, ass.copy_paste_attempts, ass.time_anomalies,
             ass.max_difficulty_reached, ass.answers_given, ass.started_at as session_started,
             EXTRACT(EPOCH FROM (ass.completed_at - ass.started_at)) as duration_seconds
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      WHERE ass.id = $1 AND sa.user_id = $2
      ORDER BY sa.completed_at DESC
      LIMIT 1
    `, [sessionId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Result not found' });
    }

    res.json({ result: result.rows[0] });
  } catch (error) {
    console.error('Error fetching session result:', error);
    res.status(500).json({ error: 'Failed to fetch result' });
  }
});

// Recruiter: Get candidate assessment results (for application review)
router.get('/candidate/:candidateId', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const candidateId = req.params.candidateId;

    const result = await pool.query(`
      SELECT sa.id, sa.score, sa.max_score, sa.passed, sa.anti_cheat_score,
             sa.duration_seconds, sa.completed_at,
             cs.skill_name, cs.category, cs.is_verified,
             ass.max_difficulty_reached, ass.tab_switches, ass.copy_paste_attempts
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      WHERE sa.user_id = $1 AND sa.completed_at IS NOT NULL
      ORDER BY sa.completed_at DESC
    `, [candidateId]);

    res.json({ assessments: result.rows });
  } catch (error) {
    console.error('Error fetching candidate assessments:', error);
    res.status(500).json({ error: 'Failed to fetch candidate assessments' });
  }
});

module.exports = router;
