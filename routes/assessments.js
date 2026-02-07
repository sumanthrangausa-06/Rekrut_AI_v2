const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { chat } = require('../lib/polsia-ai');

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
    const response = await chat(prompt, { maxTokens: 1024 });

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
    const response = await chat(prompt, { maxTokens: 512 });
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

module.exports = router;
