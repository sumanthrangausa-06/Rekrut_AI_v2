const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { chat, handleAIError } = require('../lib/polsia-ai');
const omniscoreService = require('../services/omniscore');

// Skill catalog - available to all candidates without pre-existing skills
const SKILL_CATALOG = [
  { name: 'JavaScript', category: 'technical', icon: 'JS', description: 'Core JS, ES6+, async/await, closures, prototypes', difficulty: 'Adaptive' },
  { name: 'Python', category: 'technical', icon: 'PY', description: 'Core Python, data structures, OOP, standard library', difficulty: 'Adaptive' },
  { name: 'React', category: 'technical', icon: 'RE', description: 'Components, hooks, state management, lifecycle', difficulty: 'Adaptive' },
  { name: 'Node.js', category: 'technical', icon: 'NJ', description: 'Express, APIs, async patterns, middleware', difficulty: 'Adaptive' },
  { name: 'SQL', category: 'technical', icon: 'SQL', description: 'Queries, joins, indexing, optimization, transactions', difficulty: 'Adaptive' },
  { name: 'TypeScript', category: 'technical', icon: 'TS', description: 'Types, interfaces, generics, type guards', difficulty: 'Adaptive' },
  { name: 'Java', category: 'technical', icon: 'JV', description: 'OOP, collections, multithreading, design patterns', difficulty: 'Adaptive' },
  { name: 'CSS & HTML', category: 'technical', icon: 'CSS', description: 'Flexbox, Grid, responsive design, accessibility', difficulty: 'Adaptive' },
  { name: 'AWS', category: 'technical', icon: 'AWS', description: 'EC2, S3, Lambda, IAM, CloudFormation', difficulty: 'Adaptive' },
  { name: 'Docker', category: 'technical', icon: 'DK', description: 'Containers, images, compose, networking', difficulty: 'Adaptive' },
  { name: 'Git', category: 'technical', icon: 'GIT', description: 'Branching, merging, rebasing, workflows', difficulty: 'Adaptive' },
  { name: 'Data Analysis', category: 'analytical', icon: 'DA', description: 'Statistics, visualization, pandas, Excel formulas', difficulty: 'Adaptive' },
  { name: 'System Design', category: 'technical', icon: 'SD', description: 'Scalability, databases, caching, load balancing', difficulty: 'Adaptive' },
  { name: 'Project Management', category: 'soft_skill', icon: 'PM', description: 'Agile, planning, risk management, stakeholders', difficulty: 'Adaptive' },
  { name: 'Communication', category: 'soft_skill', icon: 'CM', description: 'Written, verbal, presentation, feedback', difficulty: 'Adaptive' },
  { name: 'Machine Learning', category: 'technical', icon: 'ML', description: 'Algorithms, neural networks, training, evaluation', difficulty: 'Adaptive' },
];

// Get skill catalog with user's assessment history
router.get('/available', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's existing skills and assessment data
    const userSkillsResult = await pool.query(`
      SELECT cs.id, cs.skill_name, cs.category, cs.level, cs.is_verified, cs.verified_score,
             COUNT(sa.id) as assessment_count,
             MAX(sa.score) as best_score,
             MAX(sa.completed_at) as last_attempted
      FROM candidate_skills cs
      LEFT JOIN skill_assessments sa ON cs.id = sa.skill_id AND sa.completed_at IS NOT NULL
      WHERE cs.user_id = $1
      GROUP BY cs.id
      ORDER BY cs.is_verified ASC, cs.created_at DESC
    `, [userId]);

    const userSkillMap = {};
    for (const skill of userSkillsResult.rows) {
      userSkillMap[skill.skill_name.toLowerCase()] = skill;
    }

    // Build catalog with user's data overlaid
    const catalog = SKILL_CATALOG.map(catalogSkill => {
      const userSkill = userSkillMap[catalogSkill.name.toLowerCase()];
      return {
        catalog_name: catalogSkill.name,
        category: catalogSkill.category,
        icon: catalogSkill.icon,
        description: catalogSkill.description,
        difficulty: catalogSkill.difficulty,
        // User-specific data
        skill_id: userSkill ? userSkill.id : null,
        is_verified: userSkill ? userSkill.is_verified : false,
        verified_score: userSkill ? userSkill.verified_score : null,
        assessment_count: userSkill ? parseInt(userSkill.assessment_count) : 0,
        best_score: userSkill ? userSkill.best_score : null,
        last_attempted: userSkill ? userSkill.last_attempted : null,
      };
    });

    // Also include any user skills NOT in the catalog
    for (const skill of userSkillsResult.rows) {
      const inCatalog = SKILL_CATALOG.some(c => c.name.toLowerCase() === skill.skill_name.toLowerCase());
      if (!inCatalog) {
        catalog.push({
          catalog_name: skill.skill_name,
          category: skill.category,
          icon: skill.skill_name.substring(0, 2).toUpperCase(),
          description: `Custom skill: ${skill.skill_name}`,
          difficulty: 'Adaptive',
          skill_id: skill.id,
          is_verified: skill.is_verified,
          verified_score: skill.verified_score,
          assessment_count: parseInt(skill.assessment_count),
          best_score: skill.best_score,
          last_attempted: skill.last_attempted,
        });
      }
    }

    res.json({ skills: catalog });
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

// Start new assessment - accepts skillName+category OR skillId
router.post('/start', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { skillId, skillName, category, jobId } = req.body;

    await client.query('BEGIN');

    let skill;

    if (skillId) {
      // Legacy: lookup by ID
      const skillResult = await client.query(
        'SELECT * FROM candidate_skills WHERE id = $1 AND user_id = $2',
        [skillId, userId]
      );
      skill = skillResult.rows[0];
    }

    if (!skill && skillName) {
      // Look up or auto-create the skill in candidate_skills
      const existingResult = await client.query(
        'SELECT * FROM candidate_skills WHERE user_id = $1 AND LOWER(skill_name) = LOWER($2)',
        [userId, skillName]
      );

      if (existingResult.rows.length > 0) {
        skill = existingResult.rows[0];
      } else {
        // Auto-create the skill for this user
        const insertResult = await client.query(`
          INSERT INTO candidate_skills (user_id, skill_name, category, level)
          VALUES ($1, $2, $3, 1)
          RETURNING *
        `, [userId, skillName, category || 'technical']);
        skill = insertResult.rows[0];
      }
    }

    if (!skill) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Skill name or ID required' });
    }

    // Check for active session
    const activeSession = await client.query(
      "SELECT id FROM assessment_sessions WHERE user_id = $1 AND skill_id = $2 AND status = 'in_progress'",
      [userId, skill.id]
    );
    if (activeSession.rows.length > 0) {
      // Abandon old session
      await client.query(
        "UPDATE assessment_sessions SET status = 'abandoned' WHERE id = $1",
        [activeSession.rows[0].id]
      );
    }

    // Create assessment session
    const sessionResult = await client.query(`
      INSERT INTO assessment_sessions
      (user_id, skill_id, job_id, status, current_difficulty, current_question_index, score,
       max_difficulty_reached, tab_switches, copy_paste_attempts, time_anomalies,
       questions_asked, answers_given, started_at)
      VALUES ($1, $2, $3, 'in_progress', 2, 0, 0, 2, 0, 0, 0, '[]'::jsonb, '[]'::jsonb, NOW())
      RETURNING *
    `, [userId, skill.id, jobId || null]);

    const session = sessionResult.rows[0];

    // Generate first question
    const question = await generateQuestion(skill.skill_name, skill.category, 2, client);

    if (!question) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Failed to generate questions. Please try again.' });
    }

    // Record question asked
    const questionsAsked = [{ questionId: question.id, difficulty: question.difficulty_level, timestamp: new Date() }];
    await client.query(
      'UPDATE assessment_sessions SET questions_asked = $1, current_question_index = 1 WHERE id = $2',
      [JSON.stringify(questionsAsked), session.id]
    );

    await client.query('COMMIT');

    res.json({
      sessionId: session.id,
      skillName: skill.skill_name,
      question: {
        id: question.id,
        text: question.question_text,
        type: question.question_type,
        options: typeof question.options === 'string' ? JSON.parse(question.options) : question.options,
        timeLimit: question.time_limit_seconds || 120,
        questionNumber: 1,
        totalQuestions: 10
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error starting assessment:', error);
    if (error.allProvidersFailed) {
      return handleAIError(res, error, 'Assessment generation');
    }
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

    if (questionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Question not found' });
    }

    const question = questionResult.rows[0];

    // Evaluate answer
    let isCorrect = false;
    let scorePoints = 0;
    let aiFeedback = null;

    if (question.question_type === 'multiple_choice') {
      isCorrect = answer === question.correct_answer;
      scorePoints = isCorrect ? (question.difficulty_level || 2) * 10 : 0;
    } else if (question.question_type === 'short_answer') {
      // Use AI to evaluate short answer
      const evaluation = await evaluateShortAnswer(question.question_text, answer, question.explanation);
      isCorrect = evaluation.score >= 70;
      scorePoints = Math.round((evaluation.score / 100) * (question.difficulty_level || 2) * 15);
      aiFeedback = evaluation.feedback;
    }

    // Check for time anomaly (too fast)
    const expectedMinTime = question.question_type === 'multiple_choice' ? 5 : 15;
    const isTimeAnomaly = timeTaken < expectedMinTime;

    // Update session
    const questionsAsked = typeof session.questions_asked === 'string'
      ? JSON.parse(session.questions_asked) : (session.questions_asked || []);
    const answersGiven = typeof session.answers_given === 'string'
      ? JSON.parse(session.answers_given) : (session.answers_given || []);

    answersGiven.push({
      questionId,
      answer,
      isCorrect,
      scorePoints,
      timeTaken,
      timestamp: new Date(),
      aiFeedback
    });

    const newScore = (session.score || 0) + scorePoints;
    const currentQuestionIndex = (session.current_question_index || 0) + 1;

    // Adaptive difficulty: increase if correct and no time anomaly, decrease if wrong
    let newDifficulty = session.current_difficulty || 2;
    if (isCorrect && !isTimeAnomaly && newDifficulty < 5) {
      newDifficulty += 1;
    } else if (!isCorrect && newDifficulty > 1) {
      newDifficulty -= 1;
    }

    const maxDifficultyReached = Math.max(session.max_difficulty_reached || 2, newDifficulty);
    const timeAnomalies = (session.time_anomalies || 0) + (isTimeAnomaly ? 1 : 0);

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

    if (skillResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Skill not found for session' });
    }

    const skill = skillResult.rows[0];

    // Generate next question
    const nextQuestion = await generateQuestion(skill.skill_name, skill.category, newDifficulty, client);

    if (!nextQuestion) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Failed to generate next question' });
    }

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
        options: typeof nextQuestion.options === 'string' ? JSON.parse(nextQuestion.options) : nextQuestion.options,
        timeLimit: nextQuestion.time_limit_seconds || 120,
        questionNumber: currentQuestionIndex + 1,
        totalQuestions: 10
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error submitting answer:', error);
    if (error.allProvidersFailed) {
      return handleAIError(res, error, 'Answer evaluation');
    }
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
    `, [sessionId, eventType, JSON.stringify(eventData || {})]);

    // Update session counters
    if (eventType === 'tab_switch') {
      await pool.query(
        'UPDATE assessment_sessions SET tab_switches = COALESCE(tab_switches, 0) + 1 WHERE id = $1',
        [sessionId]
      );
    } else if (eventType === 'copy_paste') {
      await pool.query(
        'UPDATE assessment_sessions SET copy_paste_attempts = COALESCE(copy_paste_attempts, 0) + 1 WHERE id = $1',
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
    WHERE LOWER(skill_category) = LOWER($1) AND difficulty_level = $2
    ORDER BY RANDOM()
    LIMIT 1
  `, [skillName, difficulty]);

  if (existingResult.rows.length > 0) {
    return existingResult.rows[0];
  }

  // Generate new question using AI
  const questionType = Math.random() > 0.3 ? 'multiple_choice' : 'short_answer';
  const prompt = `Generate a difficulty ${difficulty}/5 technical assessment question about "${skillName}" (category: ${category}).

Question type: ${questionType}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "question_text": "The question text here",
  "question_type": "${questionType}",
  ${questionType === 'multiple_choice' ? '"options": ["Option A text", "Option B text", "Option C text", "Option D text"],\n  "correct_answer": "Option A text",' : ''}
  "explanation": "Brief explanation of the correct answer",
  "time_limit_seconds": ${questionType === 'multiple_choice' ? '90' : '180'}
}

Requirements:
- Make it practical and relevant to real-world ${skillName} work
- Difficulty ${difficulty}/5 (1=beginner, 5=expert)
- ${questionType === 'multiple_choice' ? 'Provide exactly 4 options. correct_answer must exactly match one of the options.' : 'Ask a question that requires a detailed written response.'}
- Keep question clear and unambiguous`;

  try {
    const response = await chat(prompt, { maxTokens: 1024, module: 'assessments', feature: 'question_generation' });

    // Parse response - handle potential markdown code blocks
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const questionData = JSON.parse(cleanResponse);

    // Validate the response
    if (!questionData.question_text) {
      throw new Error('Missing question_text in AI response');
    }

    const qType = questionData.question_type || questionType;
    const options = qType === 'multiple_choice' && questionData.options
      ? (typeof questionData.options === 'string' ? questionData.options : JSON.stringify(questionData.options))
      : null;

    // Save to database
    const result = await client.query(`
      INSERT INTO assessment_questions
      (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      skillName,
      difficulty,
      qType,
      questionData.question_text,
      options,
      questionData.correct_answer || null,
      questionData.explanation || 'See the correct answer above.',
      questionData.time_limit_seconds || (qType === 'multiple_choice' ? 90 : 180)
    ]);

    return result.rows[0];
  } catch (error) {
    console.error('Error generating AI question:', error);

    // Fallback: try any question from the bank
    const fallbackResult = await client.query(`
      SELECT * FROM assessment_questions
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (fallbackResult.rows.length > 0) {
      return fallbackResult.rows[0];
    }

    // Last resort: create a hardcoded question
    const fallbackInsert = await client.query(`
      INSERT INTO assessment_questions
      (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
      VALUES ($1, $2, 'multiple_choice', $3, $4, $5, $6, 90)
      RETURNING *
    `, [
      skillName,
      difficulty,
      `Which of the following best describes a key concept in ${skillName}?`,
      JSON.stringify([
        `A fundamental principle of ${skillName} that enables modularity`,
        `A deprecated feature that is no longer recommended`,
        `A testing framework specific to ${skillName}`,
        `A build tool used exclusively in ${skillName} projects`
      ]),
      `A fundamental principle of ${skillName} that enables modularity`,
      `Understanding core principles is essential for working effectively with ${skillName}.`
    ]);
    return fallbackInsert.rows[0];
  }
}

// Helper: Evaluate short answer
async function evaluateShortAnswer(question, answer, rubric) {
  const prompt = `Evaluate this short answer response to a technical assessment question.

Question: ${question}

Student's Answer: ${answer}

Expected concepts: ${rubric}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "score": <number 0-100>,
  "feedback": "<brief feedback explaining the score>"
}

Score guide: 90-100=excellent, 70-89=good, 50-69=partial, below 50=incorrect`;

  try {
    const response = await chat(prompt, { maxTokens: 512, module: 'assessments', feature: 'answer_evaluation' });
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    return JSON.parse(cleanResponse);
  } catch (error) {
    console.error('Error evaluating answer:', error);
    return { score: 50, feedback: 'Unable to evaluate automatically. Your answer has been recorded for manual review.' };
  }
}

// Helper: Complete assessment
async function completeAssessment(client, sessionId, userId) {
  const sessionResult = await client.query(
    'SELECT * FROM assessment_sessions WHERE id = $1',
    [sessionId]
  );
  const session = sessionResult.rows[0];

  // Get skill name for the title
  const skillResult = await client.query(
    'SELECT skill_name FROM candidate_skills WHERE id = $1',
    [session.skill_id]
  );
  const skillName = skillResult.rows.length > 0 ? skillResult.rows[0].skill_name : 'Unknown';

  // Calculate anti-cheat score (100 = clean, lower = suspicious)
  let antiCheatScore = 100;
  antiCheatScore -= (session.tab_switches || 0) * 5;
  antiCheatScore -= (session.copy_paste_attempts || 0) * 10;
  antiCheatScore -= (session.time_anomalies || 0) * 5;
  antiCheatScore = Math.max(0, antiCheatScore);

  const passed = (session.score || 0) >= 60 && antiCheatScore >= 50;

  // Mark session complete
  await client.query(
    "UPDATE assessment_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1",
    [sessionId]
  );

  // Create skill assessment record
  const assessmentResult = await client.query(`
    INSERT INTO skill_assessments
    (user_id, skill_id, session_id, assessment_type, title, score, max_score, passed,
     anti_cheat_score, behavioral_flags, duration_seconds, started_at, completed_at)
    VALUES ($1, $2, $3, 'dynamic', $4, $5, 100, $6, $7, $8,
            EXTRACT(EPOCH FROM (NOW() - $9::timestamp)), $9, NOW())
    RETURNING id
  `, [
    userId,
    session.skill_id,
    sessionId,
    `${skillName} Assessment`,
    session.score || 0,
    passed,
    antiCheatScore,
    JSON.stringify({
      tab_switches: session.tab_switches || 0,
      copy_paste: session.copy_paste_attempts || 0,
      time_anomalies: session.time_anomalies || 0,
      max_difficulty: session.max_difficulty_reached || 2
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

  // Event-driven: Feed assessment score into OmniScore technical component
  try {
    await omniscoreService.addTechnicalComponent(userId, assessmentResult.rows[0].id, session.score || 0, 100);
    console.log(`[OmniScore] Assessment ${assessmentResult.rows[0].id} fed into OmniScore for user ${userId} (score: ${session.score})`);
  } catch (err) {
    console.error('[OmniScore] Failed to update from assessment:', err.message);
  }

  return assessmentResult.rows[0].id;
}

// Get current session state (supports page refresh during assessment + completed results)
router.get('/session/:sessionId/current', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const sessionId = req.params.sessionId;

    // Get the session
    const sessionResult = await pool.query(
      'SELECT * FROM assessment_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    // Get skill name
    const skillResult = await pool.query(
      'SELECT skill_name, category FROM candidate_skills WHERE id = $1',
      [session.skill_id]
    );
    const skillName = skillResult.rows.length > 0 ? skillResult.rows[0].skill_name : 'Unknown';

    if (session.status === 'completed') {
      // Get the skill_assessment record for full results
      const assessmentResult = await pool.query(`
        SELECT sa.score, sa.passed, sa.anti_cheat_score, sa.duration_seconds
        FROM skill_assessments sa
        WHERE sa.session_id = $1 AND sa.user_id = $2
        ORDER BY sa.completed_at DESC LIMIT 1
      `, [sessionId, userId]);

      const assessment = assessmentResult.rows[0] || {};
      return res.json({
        status: 'completed',
        skillName,
        score: assessment.score || session.score || 0,
        passed: assessment.passed || false,
        antiCheatScore: assessment.anti_cheat_score || 100,
        durationSeconds: assessment.duration_seconds || 0,
        maxDifficultyReached: session.max_difficulty_reached || 0,
      });
    }

    if (session.status === 'in_progress') {
      // Find the last question that was asked
      const questionsAsked = typeof session.questions_asked === 'string'
        ? JSON.parse(session.questions_asked) : (session.questions_asked || []);
      const answersGiven = typeof session.answers_given === 'string'
        ? JSON.parse(session.answers_given) : (session.answers_given || []);

      // If there's a question asked but not yet answered, return it
      if (questionsAsked.length > answersGiven.length) {
        const lastAsked = questionsAsked[questionsAsked.length - 1];
        const questionResult = await pool.query(
          'SELECT * FROM assessment_questions WHERE id = $1',
          [lastAsked.questionId]
        );

        if (questionResult.rows.length > 0) {
          const q = questionResult.rows[0];
          return res.json({
            status: 'in_progress',
            skillName,
            question: {
              id: q.id,
              text: q.question_text,
              type: q.question_type,
              options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
              timeLimit: q.time_limit_seconds || 120,
              questionNumber: session.current_question_index || questionsAsked.length,
              totalQuestions: 10,
            },
          });
        }
      }

      // All questions answered but session not completed - might need to generate next
      // For now, return the state so client can handle
      return res.json({
        status: 'in_progress',
        skillName,
        currentQuestionIndex: session.current_question_index || 0,
      });
    }

    // Abandoned or other status
    return res.json({ status: session.status, skillName });

  } catch (error) {
    console.error('Error fetching session current state:', error);
    res.status(500).json({ error: 'Failed to fetch session state' });
  }
});

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
             sa.duration_seconds, sa.completed_at, sa.title,
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

// ========== RECRUITER ASSESSMENT MANAGEMENT ==========

// Recruiter: Get all assessment results across all candidates
router.get('/recruiter/all', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const { skill, status, sort } = req.query;

    let query = `
      SELECT sa.id, sa.score, sa.max_score, sa.passed, sa.anti_cheat_score,
             sa.duration_seconds, sa.completed_at, sa.title,
             cs.skill_name, cs.category, cs.is_verified,
             ass.max_difficulty_reached, ass.tab_switches, ass.copy_paste_attempts,
             u.name as candidate_name, u.email as candidate_email, u.id as candidate_id
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.completed_at IS NOT NULL
    `;
    const params = [];
    let paramIdx = 1;

    if (skill) {
      query += ` AND LOWER(cs.skill_name) = LOWER($${paramIdx})`;
      params.push(skill);
      paramIdx++;
    }

    if (status === 'passed') {
      query += ` AND sa.passed = true`;
    } else if (status === 'failed') {
      query += ` AND sa.passed = false`;
    }

    if (sort === 'score_desc') {
      query += ` ORDER BY sa.score DESC`;
    } else if (sort === 'score_asc') {
      query += ` ORDER BY sa.score ASC`;
    } else {
      query += ` ORDER BY sa.completed_at DESC`;
    }

    query += ` LIMIT 100`;

    const result = await pool.query(query, params);

    // Also get summary stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(DISTINCT sa.user_id) as total_candidates,
        COUNT(*) as total_assessments,
        COUNT(*) FILTER (WHERE sa.passed = true) as total_passed,
        ROUND(AVG(sa.score), 1) as avg_score,
        COUNT(DISTINCT cs.skill_name) as skills_tested
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      WHERE sa.completed_at IS NOT NULL
    `);

    // Get skill breakdown
    const skillBreakdown = await pool.query(`
      SELECT cs.skill_name, cs.category,
             COUNT(*) as attempt_count,
             COUNT(*) FILTER (WHERE sa.passed = true) as pass_count,
             ROUND(AVG(sa.score), 1) as avg_score
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      WHERE sa.completed_at IS NOT NULL
      GROUP BY cs.skill_name, cs.category
      ORDER BY attempt_count DESC
    `);

    res.json({
      assessments: result.rows,
      stats: statsResult.rows[0] || {},
      skillBreakdown: skillBreakdown.rows,
    });
  } catch (error) {
    console.error('Error fetching recruiter assessments:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

// Recruiter: Get assessment detail with individual question answers
router.get('/recruiter/detail/:assessmentId', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const assessmentId = req.params.assessmentId;

    const result = await pool.query(`
      SELECT sa.*, cs.skill_name, cs.category,
             ass.questions_asked, ass.answers_given, ass.tab_switches,
             ass.copy_paste_attempts, ass.time_anomalies, ass.max_difficulty_reached,
             ass.started_at as session_started, ass.completed_at as session_completed,
             u.name as candidate_name, u.email as candidate_email
      FROM skill_assessments sa
      LEFT JOIN candidate_skills cs ON sa.skill_id = cs.id
      LEFT JOIN assessment_sessions ass ON sa.session_id = ass.id
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.id = $1
    `, [assessmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    const assessment = result.rows[0];

    // Get the actual questions for the detailed view
    const answersGiven = typeof assessment.answers_given === 'string'
      ? JSON.parse(assessment.answers_given) : (assessment.answers_given || []);

    const questionIds = answersGiven.map(a => a.questionId).filter(Boolean);
    let questions = [];
    if (questionIds.length > 0) {
      const qResult = await pool.query(
        `SELECT id, question_text, question_type, correct_answer, explanation, difficulty_level
         FROM assessment_questions WHERE id = ANY($1)`,
        [questionIds]
      );
      questions = qResult.rows;
    }

    // Merge questions with answers
    const detailedAnswers = answersGiven.map(answer => {
      const q = questions.find(q => q.id === answer.questionId);
      return {
        ...answer,
        questionText: q ? q.question_text : 'Question not found',
        questionType: q ? q.question_type : 'unknown',
        correctAnswer: q ? q.correct_answer : null,
        explanation: q ? q.explanation : null,
        difficulty: q ? q.difficulty_level : null,
      };
    });

    res.json({
      assessment: {
        ...assessment,
        detailedAnswers,
      },
    });
  } catch (error) {
    console.error('Error fetching assessment detail:', error);
    res.status(500).json({ error: 'Failed to fetch assessment detail' });
  }
});

// Recruiter: Get the available skill catalog (for assigning)
router.get('/recruiter/catalog', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    res.json({ catalog: SKILL_CATALOG });
  } catch (error) {
    console.error('Error fetching skill catalog:', error);
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// ========== JOB-BASED AI ASSESSMENT ENGINE ==========
// Generate assessments from job requirements, auto-score, adaptive difficulty, conversational mode

const { safeParseJSON } = require('../lib/polsia-ai');

// Recruiter: Generate AI assessment from job posting
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    // Get job details
    const jobResult = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = jobResult.rows[0];

    // Check if assessment already exists for this job
    const existing = await pool.query(
      'SELECT id FROM job_assessments WHERE job_id = $1 AND status != $2',
      [jobId, 'archived']
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Assessment already exists for this job',
        assessmentId: existing.rows[0].id
      });
    }

    // Detect job level from title/description for difficulty targeting
    const titleLower = (job.title || '').toLowerCase();
    const descLower = (job.description || '').toLowerCase();
    let targetLevel = 'mid';
    if (titleLower.includes('senior') || titleLower.includes('lead') || titleLower.includes('principal') || titleLower.includes('staff')) {
      targetLevel = 'senior';
    } else if (titleLower.includes('junior') || titleLower.includes('intern') || titleLower.includes('entry') || descLower.includes('0-2 years')) {
      targetLevel = 'junior';
    }

    const difficultyRange = { junior: '1-2', mid: '2-3', senior: '3-5' }[targetLevel];

    // Map experience level to valid difficulty_level for DB constraint (easy/medium/mid/hard)
    const difficultyLevel = { junior: 'easy', mid: 'medium', senior: 'hard' }[targetLevel] || 'medium';

    // Generate assessment questions via AI
    const prompt = `You are an expert hiring manager. Generate a comprehensive skill assessment for this job posting.

JOB TITLE: ${job.title}
COMPANY: ${job.company || 'Not specified'}
DESCRIPTION: ${(job.description || '').substring(0, 2000)}
REQUIREMENTS: ${(job.requirements || '').substring(0, 1500)}
JOB TYPE: ${job.job_type || 'full-time'}
LEVEL: ${targetLevel}

Generate exactly 15 assessment questions across these categories:
- "technical" (6 questions): Test specific technical skills mentioned in requirements
- "scenario" (4 questions): Real-world work scenarios relevant to the role
- "behavioral" (3 questions): Soft skills, teamwork, communication, problem-solving
- "code_challenge" (2 questions): Practical coding/analytical problems (if technical role) OR additional scenario questions (if non-technical)

For each question, include:
- question_type: "multiple_choice", "free_text", "scenario_response", or "code_challenge"
- difficulty_level: ${difficultyRange} (1=beginner, 5=expert)
- points: 5-20 based on difficulty and importance

Rules:
- Make questions SPECIFIC to this exact role, not generic
- Multiple choice: exactly 4 options, one correct
- Free text / scenario: provide a rubric for what a good answer includes
- Code challenges: provide a clear problem with expected approach
- Vary difficulty within the range

Return ONLY valid JSON:
{
  "title": "Assessment title",
  "description": "Brief assessment description",
  "questions": [
    {
      "category": "technical|scenario|behavioral|code_challenge",
      "question_type": "multiple_choice|free_text|scenario_response|code_challenge",
      "question_text": "The question",
      "options": ["A", "B", "C", "D"] or null,
      "correct_answer": "A" or null,
      "rubric": "What makes a good answer (for free text/scenario)",
      "explanation": "Why the correct answer is right",
      "difficulty_level": 1-5,
      "points": 5-20,
      "time_limit_seconds": 60-300
    }
  ]
}`;

    const response = await chat(prompt, {
      maxTokens: 4096,
      system: 'You are a senior hiring manager creating job-specific assessments. Generate practical, relevant questions that test real-world capability. Always return valid JSON.',
      module: 'assessments', feature: 'job_assessment_generation'
    });

    const parsed = safeParseJSON(response);
    if (!parsed || !parsed.questions || !Array.isArray(parsed.questions)) {
      console.error('[assessment-gen] Failed to parse AI response');
      return res.status(500).json({ error: 'Failed to generate assessment. Please try again.' });
    }

    // Save assessment to database
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const categories = [...new Set(parsed.questions.map(q => q.category))];
      const assessmentResult = await client.query(`
        INSERT INTO job_assessments (job_id, created_by, title, description, difficulty_level, question_count, categories, ai_config)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        jobId, req.user.id,
        parsed.title || `${job.title} Assessment`,
        parsed.description || `AI-generated assessment for ${job.title}`,
        difficultyLevel,
        parsed.questions.length,
        JSON.stringify(categories),
        JSON.stringify({ targetLevel, difficultyLevel, generated_at: new Date() })
      ]);

      const assessment = assessmentResult.rows[0];

      // Insert questions
      for (let i = 0; i < parsed.questions.length; i++) {
        const q = parsed.questions[i];
        await client.query(`
          INSERT INTO job_assessment_questions
          (assessment_id, category, question_type, question_text, options, correct_answer, rubric, explanation, difficulty_level, points, time_limit_seconds, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          assessment.id,
          q.category || 'technical',
          q.question_type || 'multiple_choice',
          q.question_text,
          q.options ? JSON.stringify(q.options) : null,
          q.correct_answer || null,
          q.rubric || null,
          q.explanation || null,
          q.difficulty_level || 3,
          q.points || 10,
          q.time_limit_seconds || 120,
          i
        ]);
      }

      await client.query('COMMIT');

      // Return the full assessment
      const questions = await pool.query(
        'SELECT * FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
        [assessment.id]
      );

      res.json({
        assessment: { ...assessment, questions: questions.rows }
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error generating job assessment:', error);
    res.status(500).json({ error: 'Failed to generate assessment' });
  }
});

// Get job assessment (for a specific job)
router.get('/job/:jobId', authMiddleware, async (req, res) => {
  try {
    const jobId = req.params.jobId;

    const result = await pool.query(
      "SELECT * FROM job_assessments WHERE job_id = $1 AND status != 'archived' ORDER BY created_at DESC LIMIT 1",
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.json({ assessment: null });
    }

    const assessment = result.rows[0];
    const questions = await pool.query(
      'SELECT * FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
      [assessment.id]
    );

    // Get attempt stats
    const stats = await pool.query(`
      SELECT COUNT(*) as total_attempts,
             COUNT(*) FILTER (WHERE status = 'completed') as completed,
             ROUND(AVG(composite_score) FILTER (WHERE scored_at IS NOT NULL), 1) as avg_score
      FROM job_assessment_attempts WHERE assessment_id = $1
    `, [assessment.id]);

    res.json({
      assessment: {
        ...assessment,
        questions: questions.rows,
        stats: stats.rows[0] || {}
      }
    });
  } catch (error) {
    console.error('Error fetching job assessment:', error);
    res.status(500).json({ error: 'Failed to fetch assessment' });
  }
});

// Recruiter: Update assessment question
router.put('/job-assessment/:id/question/:qId', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const { question_text, options, correct_answer, rubric, explanation, points, time_limit_seconds } = req.body;

    const result = await pool.query(`
      UPDATE job_assessment_questions
      SET question_text = COALESCE($1, question_text),
          options = COALESCE($2, options),
          correct_answer = COALESCE($3, correct_answer),
          rubric = COALESCE($4, rubric),
          explanation = COALESCE($5, explanation),
          points = COALESCE($6, points),
          time_limit_seconds = COALESCE($7, time_limit_seconds)
      WHERE id = $8 AND assessment_id = $9
      RETURNING *
    `, [
      question_text || null,
      options ? JSON.stringify(options) : null,
      correct_answer || null,
      rubric || null,
      explanation || null,
      points || null,
      time_limit_seconds || null,
      req.params.qId,
      req.params.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json({ question: result.rows[0] });
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({ error: 'Failed to update question' });
  }
});

// Recruiter: Publish assessment
router.post('/job-assessment/:id/publish', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const result = await pool.query(
      "UPDATE job_assessments SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    res.json({ assessment: result.rows[0] });
  } catch (error) {
    console.error('Error publishing assessment:', error);
    res.status(500).json({ error: 'Failed to publish assessment' });
  }
});

// Candidate: Start a job assessment attempt
router.post('/job-assessment/:id/start', authMiddleware, async (req, res) => {
  try {
    const assessmentId = req.params.id;
    const candidateId = req.user.id;
    const { applicationId } = req.body;

    // Check assessment exists and is published
    const assessment = await pool.query(
      "SELECT * FROM job_assessments WHERE id = $1 AND status = 'published'",
      [assessmentId]
    );
    if (assessment.rows.length === 0) {
      return res.status(404).json({ error: 'Assessment not found or not published' });
    }

    // Check for existing active attempt
    const existing = await pool.query(
      "SELECT * FROM job_assessment_attempts WHERE assessment_id = $1 AND candidate_id = $2 AND status = 'in_progress'",
      [assessmentId, candidateId]
    );
    if (existing.rows.length > 0) {
      // Resume existing attempt
      const attempt = existing.rows[0];
      const answers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : (attempt.answers || []);
      const nextIndex = answers.length;

      const questions = await pool.query(
        'SELECT id, category, question_type, question_text, options, difficulty_level, points, time_limit_seconds, order_index FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
        [assessmentId]
      );

      const nextQ = questions.rows[nextIndex];
      return res.json({
        attemptId: attempt.id,
        resumed: true,
        progress: { current: nextIndex + 1, total: questions.rows.length },
        question: nextQ ? {
          id: nextQ.id,
          category: nextQ.category,
          type: nextQ.question_type,
          text: nextQ.question_text,
          options: typeof nextQ.options === 'string' ? JSON.parse(nextQ.options) : nextQ.options,
          timeLimit: nextQ.time_limit_seconds,
          points: nextQ.points,
          difficulty: nextQ.difficulty_level,
        } : null
      });
    }

    // Create new attempt
    const attempt = await pool.query(`
      INSERT INTO job_assessment_attempts (assessment_id, candidate_id, application_id, status)
      VALUES ($1, $2, $3, 'in_progress')
      RETURNING *
    `, [assessmentId, candidateId, applicationId || null]);

    // Get first question
    const questions = await pool.query(
      'SELECT id, category, question_type, question_text, options, difficulty_level, points, time_limit_seconds FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index LIMIT 1',
      [assessmentId]
    );

    const firstQ = questions.rows[0];
    const totalCount = await pool.query(
      'SELECT COUNT(*) as total FROM job_assessment_questions WHERE assessment_id = $1',
      [assessmentId]
    );

    res.json({
      attemptId: attempt.rows[0].id,
      resumed: false,
      progress: { current: 1, total: parseInt(totalCount.rows[0].total) },
      question: firstQ ? {
        id: firstQ.id,
        category: firstQ.category,
        type: firstQ.question_type,
        text: firstQ.question_text,
        options: typeof firstQ.options === 'string' ? JSON.parse(firstQ.options) : firstQ.options,
        timeLimit: firstQ.time_limit_seconds,
        points: firstQ.points,
        difficulty: firstQ.difficulty_level,
      } : null
    });
  } catch (error) {
    console.error('Error starting job assessment:', error);
    res.status(500).json({ error: 'Failed to start assessment' });
  }
});

// Candidate: Submit answer and get next question (with adaptive difficulty)
router.post('/job-assessment/:id/answer', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const assessmentId = req.params.id;
    const candidateId = req.user.id;
    const { attemptId, questionId, answer, timeTaken } = req.body;

    await client.query('BEGIN');

    // Get attempt
    const attemptResult = await client.query(
      "SELECT * FROM job_assessment_attempts WHERE id = $1 AND candidate_id = $2 AND status = 'in_progress'",
      [attemptId, candidateId]
    );
    if (attemptResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active attempt not found' });
    }
    const attempt = attemptResult.rows[0];

    // Get question
    const qResult = await client.query(
      'SELECT * FROM job_assessment_questions WHERE id = $1 AND assessment_id = $2',
      [questionId, assessmentId]
    );
    if (qResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Question not found' });
    }
    const question = qResult.rows[0];

    // Quick-score multiple choice immediately
    let quickScore = null;
    let feedback = null;
    if (question.question_type === 'multiple_choice') {
      const isCorrect = answer === question.correct_answer;
      quickScore = isCorrect ? question.points : 0;
      feedback = isCorrect ? 'Correct!' : `Incorrect. ${question.explanation || ''}`;
    }

    // Check for time anomaly
    const minTime = question.question_type === 'multiple_choice' ? 3 : 10;
    const isTimeAnomaly = timeTaken && timeTaken < minTime;

    // Update answers
    const answers = typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : (attempt.answers || []);
    answers.push({
      questionId,
      answer,
      timeTaken: timeTaken || 0,
      quickScore,
      category: question.category,
      questionType: question.question_type,
      points: question.points,
      isTimeAnomaly,
      timestamp: new Date()
    });

    // Adaptive difficulty: adjust based on performance in category
    const categoryAnswers = answers.filter(a => a.category === question.category);
    const categoryCorrect = categoryAnswers.filter(a => a.quickScore > 0).length;
    const categoryRate = categoryAnswers.length > 0 ? categoryCorrect / categoryAnswers.length : 0.5;
    let newDifficulty = attempt.current_difficulty || 3;
    if (categoryRate > 0.75 && newDifficulty < 5) newDifficulty++;
    else if (categoryRate < 0.4 && newDifficulty > 1) newDifficulty--;

    const newTimeAnomalies = (attempt.time_anomalies || 0) + (isTimeAnomaly ? 1 : 0);
    const newTimeSpent = (attempt.time_spent_seconds || 0) + (timeTaken || 0);

    await client.query(`
      UPDATE job_assessment_attempts
      SET answers = $1, current_question_index = $2, current_difficulty = $3,
          time_anomalies = $4, time_spent_seconds = $5
      WHERE id = $6
    `, [JSON.stringify(answers), answers.length, newDifficulty, newTimeAnomalies, newTimeSpent, attemptId]);

    // Get all questions to find next
    const allQuestions = await client.query(
      'SELECT id, category, question_type, question_text, options, difficulty_level, points, time_limit_seconds, order_index FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
      [assessmentId]
    );

    const totalQuestions = allQuestions.rows.length;
    const nextIndex = answers.length;

    if (nextIndex >= totalQuestions) {
      // Assessment complete — trigger auto-scoring
      await client.query(
        "UPDATE job_assessment_attempts SET status = 'completed', completed_at = NOW() WHERE id = $1",
        [attemptId]
      );
      await client.query('COMMIT');

      // Trigger async scoring (don't wait)
      scoreAttempt(attemptId, assessmentId).catch(err =>
        console.error('[scoring] Async scoring failed:', err.message)
      );

      return res.json({
        completed: true,
        feedback,
        progress: { current: totalQuestions, total: totalQuestions }
      });
    }

    const nextQ = allQuestions.rows[nextIndex];
    await client.query('COMMIT');

    res.json({
      completed: false,
      feedback,
      quickScore,
      progress: { current: nextIndex + 1, total: totalQuestions },
      nextQuestion: nextQ ? {
        id: nextQ.id,
        category: nextQ.category,
        type: nextQ.question_type,
        text: nextQ.question_text,
        options: typeof nextQ.options === 'string' ? JSON.parse(nextQ.options) : nextQ.options,
        timeLimit: nextQ.time_limit_seconds,
        points: nextQ.points,
        difficulty: nextQ.difficulty_level,
      } : null
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error submitting job assessment answer:', error);
    res.status(500).json({ error: 'Failed to submit answer' });
  } finally {
    client.release();
  }
});

// Score an assessment attempt using AI
async function scoreAttempt(attemptId, assessmentId) {
  try {
    const attempt = await pool.query('SELECT * FROM job_assessment_attempts WHERE id = $1', [attemptId]);
    if (attempt.rows.length === 0) return;
    const att = attempt.rows[0];

    const answers = typeof att.answers === 'string' ? JSON.parse(att.answers) : (att.answers || []);
    if (answers.length === 0) return;

    // Get all questions
    const questions = await pool.query(
      'SELECT * FROM job_assessment_questions WHERE assessment_id = $1 ORDER BY order_index',
      [assessmentId]
    );
    const qMap = {};
    for (const q of questions.rows) qMap[q.id] = q;

    // Group answers by category
    const categoryGroups = {};
    let totalPoints = 0;
    let earnedPoints = 0;

    for (const ans of answers) {
      const q = qMap[ans.questionId];
      if (!q) continue;

      if (!categoryGroups[q.category]) {
        categoryGroups[q.category] = { questions: [], totalPoints: 0, earnedPoints: 0 };
      }

      totalPoints += q.points;

      if (q.question_type === 'multiple_choice') {
        // Already scored
        const pts = ans.quickScore || 0;
        earnedPoints += pts;
        categoryGroups[q.category].earnedPoints += pts;
        categoryGroups[q.category].totalPoints += q.points;
        categoryGroups[q.category].questions.push({
          text: q.question_text, answer: ans.answer, score: pts, maxPoints: q.points, type: 'multiple_choice'
        });
      } else {
        // AI-score free text / scenario / code challenge
        const scorePrompt = `Score this assessment answer.

QUESTION (${q.category}, ${q.question_type}): ${q.question_text}
${q.rubric ? 'RUBRIC: ' + q.rubric : ''}
${q.correct_answer ? 'EXPECTED: ' + q.correct_answer : ''}
MAX POINTS: ${q.points}

CANDIDATE'S ANSWER: ${ans.answer}

Score on three dimensions:
- Relevance: Does it address the question? (0-100)
- Depth: How thorough and insightful? (0-100)
- Accuracy: Is the information correct? (0-100)

Return ONLY valid JSON:
{
  "relevance": 0-100,
  "depth": 0-100,
  "accuracy": 0-100,
  "score": 0-${q.points},
  "feedback": "2-3 sentence explanation of the score",
  "strengths": ["strength 1"],
  "weaknesses": ["weakness 1"]
}`;

        try {
          const scoreResponse = await chat(scorePrompt, {
            maxTokens: 512,
            module: 'assessments', feature: 'ai_scoring'
          });
          const scoreData = safeParseJSON(scoreResponse);
          if (scoreData) {
            const pts = Math.min(q.points, Math.max(0, scoreData.score || 0));
            earnedPoints += pts;
            categoryGroups[q.category].earnedPoints += pts;
            categoryGroups[q.category].totalPoints += q.points;
            categoryGroups[q.category].questions.push({
              text: q.question_text, answer: ans.answer, score: pts, maxPoints: q.points,
              type: q.question_type, aiScore: scoreData
            });
            // Store score back in answers
            ans.aiScore = scoreData;
            ans.quickScore = pts;
          }
        } catch (err) {
          console.error(`[scoring] Failed to score Q${q.id}:`, err.message);
          categoryGroups[q.category].totalPoints += q.points;
          categoryGroups[q.category].questions.push({
            text: q.question_text, answer: ans.answer, score: 0, maxPoints: q.points, type: q.question_type
          });
        }
      }
    }

    // Calculate composite and category scores
    const compositeScore = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100 * 10) / 10 : 0;
    const categoryScores = {};
    for (const [cat, data] of Object.entries(categoryGroups)) {
      categoryScores[cat] = {
        score: data.totalPoints > 0 ? Math.round((data.earnedPoints / data.totalPoints) * 100 * 10) / 10 : 0,
        earned: data.earnedPoints,
        total: data.totalPoints,
        questionCount: data.questions.length
      };
    }

    // Generate AI summary for recruiter
    const summaryPrompt = `You are a senior recruiter reviewing assessment results for a candidate.

COMPOSITE SCORE: ${compositeScore}%
CATEGORY BREAKDOWN:
${Object.entries(categoryScores).map(([cat, s]) => `- ${cat}: ${s.score}% (${s.earned}/${s.total} points)`).join('\n')}

DETAILED RESULTS:
${Object.entries(categoryGroups).map(([cat, data]) =>
  data.questions.map(q => `[${cat}] Q: ${q.text.substring(0, 100)}... → Score: ${q.score}/${q.maxPoints}${q.aiScore ? ' | ' + (q.aiScore.feedback || '') : ''}`).join('\n')
).join('\n')}

Provide a recruiter-facing assessment summary.

Return ONLY valid JSON:
{
  "recommendation": "strong_hire|hire|maybe|no_hire",
  "summary": "2-3 sentence overall assessment",
  "strengths": ["Top strength 1", "Top strength 2", "Top strength 3"],
  "weaknesses": ["Area of concern 1", "Area of concern 2"],
  "fit_notes": "1-2 sentences about role fit",
  "suggested_interview_focus": ["Topic to probe in interview 1", "Topic 2"]
}`;

    let aiSummary = null;
    try {
      const summaryResponse = await chat(summaryPrompt, {
        maxTokens: 1024,
        module: 'assessments', feature: 'recruiter_summary'
      });
      aiSummary = safeParseJSON(summaryResponse);
    } catch (err) {
      console.error('[scoring] Summary generation failed:', err.message);
    }

    // Calculate anti-cheat score
    let antiCheatScore = 100;
    antiCheatScore -= (att.tab_switches || 0) * 3;
    antiCheatScore -= (att.copy_paste_attempts || 0) * 8;
    antiCheatScore -= (att.time_anomalies || 0) * 5;
    antiCheatScore = Math.max(0, antiCheatScore);

    // Save scores
    await pool.query(`
      UPDATE job_assessment_attempts
      SET answers = $1, scores = $2, composite_score = $3, category_scores = $4,
          ai_summary = $5, anti_cheat_score = $6, scored_at = NOW()
      WHERE id = $7
    `, [
      JSON.stringify(answers),
      JSON.stringify({ earnedPoints, totalPoints, compositeScore }),
      compositeScore,
      JSON.stringify(categoryScores),
      JSON.stringify(aiSummary),
      antiCheatScore,
      attemptId
    ]);

    console.log(`[scoring] Attempt ${attemptId} scored: ${compositeScore}% (${earnedPoints}/${totalPoints} pts)`);
  } catch (error) {
    console.error('[scoring] Failed to score attempt:', error);
  }
}

// Manually trigger scoring for an attempt
router.post('/job-assessment/:id/score', authMiddleware, async (req, res) => {
  try {
    const { attemptId } = req.body;
    const assessmentId = req.params.id;

    if (!attemptId) return res.status(400).json({ error: 'attemptId required' });

    // Verify access
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    const isRecruiter = recruiterRoles.includes(req.user.role);
    const isCandidate = !isRecruiter;

    if (isCandidate) {
      const check = await pool.query(
        'SELECT id FROM job_assessment_attempts WHERE id = $1 AND candidate_id = $2',
        [attemptId, req.user.id]
      );
      if (check.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
    }

    await scoreAttempt(attemptId, assessmentId);

    const result = await pool.query('SELECT * FROM job_assessment_attempts WHERE id = $1', [attemptId]);
    res.json({ attempt: result.rows[0] || null });
  } catch (error) {
    console.error('Error scoring assessment:', error);
    res.status(500).json({ error: 'Failed to score assessment' });
  }
});

// Get assessment results
router.get('/job-assessment/:id/results', authMiddleware, async (req, res) => {
  try {
    const assessmentId = req.params.id;
    const { attemptId, candidateId } = req.query;

    let query = 'SELECT ja.*, u.name as candidate_name, u.email as candidate_email FROM job_assessment_attempts ja LEFT JOIN users u ON ja.candidate_id = u.id WHERE ja.assessment_id = $1';
    const params = [assessmentId];

    if (attemptId) {
      query += ' AND ja.id = $2';
      params.push(attemptId);
    } else if (candidateId) {
      query += ' AND ja.candidate_id = $2';
      params.push(candidateId);
    } else {
      // If candidate, show only their own
      const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
      if (!recruiterRoles.includes(req.user.role)) {
        query += ' AND ja.candidate_id = $2';
        params.push(req.user.id);
      }
    }

    query += ' ORDER BY ja.created_at DESC';

    const results = await pool.query(query, params);

    // Get the assessment details too
    const assessment = await pool.query(
      'SELECT title, description, question_count, categories, passing_score FROM job_assessments WHERE id = $1',
      [assessmentId]
    );

    res.json({
      assessment: assessment.rows[0] || null,
      attempts: results.rows
    });
  } catch (error) {
    console.error('Error fetching assessment results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Recruiter: Get all job assessment results across all jobs
router.get('/job-assessments/all', authMiddleware, async (req, res) => {
  try {
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (!recruiterRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Recruiter access required' });
    }

    const result = await pool.query(`
      SELECT jaa.id, jaa.composite_score, jaa.category_scores, jaa.ai_summary,
             jaa.anti_cheat_score, jaa.status, jaa.completed_at, jaa.scored_at,
             jaa.time_spent_seconds,
             ja.title as assessment_title, ja.job_id,
             j.title as job_title, j.company,
             u.name as candidate_name, u.email as candidate_email, u.id as candidate_id
      FROM job_assessment_attempts jaa
      JOIN job_assessments ja ON jaa.assessment_id = ja.id
      LEFT JOIN jobs j ON ja.job_id = j.id
      LEFT JOIN users u ON jaa.candidate_id = u.id
      WHERE jaa.scored_at IS NOT NULL
      ORDER BY jaa.scored_at DESC
      LIMIT 100
    `);

    res.json({ results: result.rows });
  } catch (error) {
    console.error('Error fetching all job assessment results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Conversational assessment — AI asks follow-up questions based on answers
router.post('/job-assessment/:id/converse', authMiddleware, async (req, res) => {
  try {
    const assessmentId = req.params.id;
    const candidateId = req.user.id;
    const { attemptId, questionId, message } = req.body;

    if (!attemptId || !message) {
      return res.status(400).json({ error: 'attemptId and message required' });
    }

    // Get the question context
    const qResult = await pool.query(
      'SELECT * FROM job_assessment_questions WHERE id = $1 AND assessment_id = $2',
      [questionId, assessmentId]
    );
    if (qResult.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const question = qResult.rows[0];

    // Get conversation history for this question
    const history = await pool.query(
      'SELECT role, message FROM assessment_conversations WHERE attempt_id = $1 AND question_id = $2 ORDER BY created_at',
      [attemptId, questionId]
    );

    const convoHistory = history.rows.map(h => `${h.role}: ${h.message}`).join('\n');

    // Save candidate's message
    await pool.query(
      'INSERT INTO assessment_conversations (attempt_id, question_id, role, message) VALUES ($1, $2, $3, $4)',
      [attemptId, questionId, 'candidate', message]
    );

    // Limit to 3 follow-ups per question
    const aiTurns = history.rows.filter(h => h.role === 'ai').length;
    if (aiTurns >= 3) {
      return res.json({
        reply: "Thank you for your thorough response. Let's move on to the next question.",
        done: true,
        followUpCount: aiTurns
      });
    }

    // AI generates follow-up
    const prompt = `You are conducting a skill assessment conversation. Based on the candidate's answer, ask ONE probing follow-up question to assess their depth of understanding.

ASSESSMENT QUESTION: ${question.question_text}
${question.rubric ? 'RUBRIC: ' + question.rubric : ''}

CONVERSATION SO FAR:
${convoHistory}
candidate: ${message}

Rules:
- Ask ONE specific follow-up that probes deeper
- If they gave a surface-level answer, ask for specifics
- If they mentioned an interesting approach, ask them to elaborate
- If they seem to have fully answered, say so and indicate you're satisfied
- Keep it conversational and professional

Return ONLY valid JSON:
{
  "reply": "Your follow-up question or acknowledgment",
  "satisfied": true/false,
  "depth_score": 1-10,
  "notes": "Brief assessment note"
}`;

    const response = await chat(prompt, {
      maxTokens: 512,
      module: 'assessments', feature: 'conversational'
    });
    const parsed = safeParseJSON(response);

    const reply = parsed?.reply || "Could you elaborate on your approach?";
    const satisfied = parsed?.satisfied || false;

    // Save AI reply
    await pool.query(
      'INSERT INTO assessment_conversations (attempt_id, question_id, role, message, metadata) VALUES ($1, $2, $3, $4, $5)',
      [attemptId, questionId, 'ai', reply, JSON.stringify({ satisfied, depth_score: parsed?.depth_score, notes: parsed?.notes })]
    );

    res.json({
      reply,
      done: satisfied,
      followUpCount: aiTurns + 1
    });
  } catch (error) {
    console.error('Error in conversational assessment:', error);
    res.status(500).json({ error: 'Failed to generate follow-up' });
  }
});

// Anti-cheat event logging for job assessments
router.post('/job-assessment/:id/event', authMiddleware, async (req, res) => {
  try {
    const { attemptId, eventType } = req.body;
    if (!attemptId || !eventType) return res.status(400).json({ error: 'attemptId and eventType required' });

    if (eventType === 'tab_switch') {
      await pool.query(
        'UPDATE job_assessment_attempts SET tab_switches = COALESCE(tab_switches, 0) + 1 WHERE id = $1 AND candidate_id = $2',
        [attemptId, req.user.id]
      );
    } else if (eventType === 'copy_paste') {
      await pool.query(
        'UPDATE job_assessment_attempts SET copy_paste_attempts = COALESCE(copy_paste_attempts, 0) + 1 WHERE id = $1 AND candidate_id = $2',
        [attemptId, req.user.id]
      );
    }

    res.json({ logged: true });
  } catch (error) {
    console.error('Error logging assessment event:', error);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

module.exports = router;
