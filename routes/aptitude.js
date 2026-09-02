const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const { AuditLogger } = require('../services/auditLogService');

const RECRUITER_ROLES = ['employer', 'recruiter', 'hiring_manager', 'admin'];

function requireRecruiter(req, res, next) {
	if (!req.user) {
		return res.status(401).json({ error: 'Authentication required' });
	}
	if (!RECRUITER_ROLES.includes(req.user.role)) {
		return res.status(403).json({ error: 'Recruiter access required' });
	}
	next();
}

// ───────────────────────────────────────────────
// CANDIDATE ROUTES
// ───────────────────────────────────────────────

/**
 * GET /aptitude-tests/available
 * List active aptitude tests for the candidate
 */
router.get('/aptitude-tests/available', authMiddleware, async (req, res) => {
	try {
		const candidateId = req.user.id;

		const result = await pool.query(
			`
      SELECT at.*,
        (SELECT COUNT(*) FROM aptitude_questions WHERE test_id = at.id AND is_active = true) as available_questions,
        (SELECT COUNT(*) FROM aptitude_test_attempts
         WHERE candidate_id = $1 AND test_id = at.id AND status = 'completed') as completed_count,
        (SELECT MAX(completed_at) FROM aptitude_test_attempts
         WHERE candidate_id = $1 AND test_id = at.id AND status = 'completed') as last_completed_at
      FROM aptitude_tests at
      WHERE at.is_active = true
      ORDER BY at.created_at DESC
    `,
			[candidateId],
		);

		const tests = result.rows.map((t) => ({
			...t,
			can_retake: canRetake(t.retake_lockout_days, t.last_completed_at),
		}));

		res.json({ tests });
	} catch (error) {
		console.error('Error fetching available aptitude tests:', error);
		res.status(500).json({ error: 'Failed to fetch tests' });
	}
});

/**
 * POST /aptitude-tests/:id/start
 * Start an aptitude test attempt.
 * - Check retake lockout
 * - Create attempt record
 * - Select randomized question set
 * - Return first question + attemptId
 */
router.post('/aptitude-tests/:id/start', authMiddleware, async (req, res) => {
	const client = await pool.connect();
	try {
		const candidateId = req.user.id;
		const testId = parseInt(req.params.id, 10);
		const { applicationId } = req.body;

		await client.query('BEGIN');

		// Verify test exists and is active
		const testResult = await client.query(
			'SELECT * FROM aptitude_tests WHERE id = $1 AND is_active = true',
			[testId],
		);
		if (testResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Test not found or inactive' });
		}
		const test = testResult.rows[0];

		// Check retake lockout
		const lastAttempt = await client.query(
			`
        SELECT completed_at, status FROM aptitude_test_attempts
        WHERE candidate_id = $1 AND test_id = $2 AND status = 'completed'
        ORDER BY completed_at DESC LIMIT 1
      `,
			[candidateId, testId],
		);

		if (lastAttempt.rows.length > 0) {
			const last = lastAttempt.rows[0];
			if (!canRetake(test.retake_lockout_days, last.completed_at)) {
				await client.query('ROLLBACK');
				return res.status(403).json({
					error: 'Retake lockout active',
					code: 'RETAKE_LOCKOUT',
					lockoutDays: test.retake_lockout_days,
					lastCompletedAt: last.completed_at,
				});
			}
		}

		// Abandon any in-progress attempts for this test
		await client.query(
			"UPDATE aptitude_test_attempts SET status = 'abandoned', updated_at = NOW() WHERE candidate_id = $1 AND test_id = $2 AND status = 'in_progress'",
			[candidateId, testId],
		);

		// Select randomized question set
		const qCount = test.question_count || 50;
		const questionsResult = await client.query(
			`
        SELECT id, category, difficulty, question_text, options, time_limit_seconds
        FROM aptitude_questions
        WHERE test_id = $1 AND is_active = true
        ORDER BY RANDOM()
        LIMIT $2
      `,
			[testId, qCount],
		);

		if (questionsResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return res.status(500).json({ error: 'No questions available for this test' });
		}

		const questions = questionsResult.rows;
		const maxScore = questions.length; // 1 point per question

		// Create attempt record with question order stored in answers
		const questionOrder = questions.map((q, idx) => ({
			questionId: q.id,
			orderIndex: idx,
			answered: false,
			answer: null,
			timeTaken: 0,
			timestamp: null,
		}));

		const attemptResult = await client.query(
			`
        INSERT INTO aptitude_test_attempts
        (candidate_id, test_id, application_id, status, answers, max_score, started_at)
        VALUES ($1, $2, $3, 'in_progress', $4, $5, NOW())
        RETURNING *
      `,
			[candidateId, testId, applicationId || null, JSON.stringify(questionOrder), maxScore],
		);
		const attempt = attemptResult.rows[0];

		await client.query('COMMIT');

		// Audit log
		await AuditLogger.log({
			actionType: 'aptitude_test_started',
			userId: candidateId,
			targetType: 'aptitude_test',
			targetId: testId,
			metadata: {
				attempt_id: attempt.id,
				application_id: applicationId || null,
				question_count: questions.length,
			},
			req,
		});

		// Return first question (hide correct_answer)
		const firstQ = questions[0];
		res.json({
			attemptId: attempt.id,
			test: {
				id: test.id,
				title: test.title,
				durationMinutes: test.duration_minutes,
				passScore: test.pass_score,
			},
			totalQuestions: questions.length,
			maxScore,
			currentQuestion: {
				id: firstQ.id,
				text: firstQ.question_text,
				category: firstQ.category,
				difficulty: firstQ.difficulty,
				options: typeof firstQ.options === 'string' ? JSON.parse(firstQ.options) : firstQ.options,
				timeLimit: firstQ.time_limit_seconds,
				questionNumber: 1,
			},
		});
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Error starting aptitude test:', error);
		res.status(500).json({ error: 'Failed to start test' });
	} finally {
		client.release();
	}
});

/**
 * GET /aptitude-tests/attempt/:id/current
 * Get current attempt state + current question (supports page refresh).
 */
router.get('/aptitude-tests/attempt/:id/current', authMiddleware, async (req, res) => {
	try {
		const candidateId = req.user.id;
		const attemptId = parseInt(req.params.id, 10);

		const attemptResult = await pool.query(
			`
        SELECT ata.*, at.title, at.duration_minutes, at.pass_score
        FROM aptitude_test_attempts ata
        JOIN aptitude_tests at ON ata.test_id = at.id
        WHERE ata.id = $1 AND ata.candidate_id = $2
      `,
			[attemptId, candidateId],
		);

		if (attemptResult.rows.length === 0) {
			return res.status(404).json({ error: 'Attempt not found' });
		}

		const attempt = attemptResult.rows[0];

		if (attempt.status === 'completed' || attempt.status === 'timed_out') {
			return res.json({
				status: attempt.status,
				score: attempt.score,
				maxScore: attempt.max_score,
				percentile: attempt.percentile,
				antiCheatScore: attempt.anti_cheat_score,
				timeSpent: attempt.time_spent_seconds,
			});
		}

		if (attempt.status === 'abandoned') {
			return res.json({ status: 'abandoned' });
		}

		// Calculate time remaining server-side
		const timeSpent = getTimeSpentSeconds(attempt.started_at);
		const totalDurationSeconds = attempt.duration_minutes * 60;
		const timeRemaining = Math.max(0, totalDurationSeconds - timeSpent);

		// If time is up, auto-timeout
		if (timeRemaining <= 0) {
			await autoTimeoutAttempt(attemptId, candidateId);
			return res.json({
				status: 'timed_out',
				score: attempt.score,
				maxScore: attempt.max_score,
			});
		}

		// Get current question
		const answers =
			typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : attempt.answers || [];
		const currentIdx = answers.findIndex((a) => !a.answered);

		if (currentIdx === -1) {
			// All answered but not marked complete — mark complete
			await completeAttempt(attemptId, candidateId, answers, attempt);
			return res.json({
				status: 'completed',
				score: attempt.score,
				maxScore: attempt.max_score,
				percentile: attempt.percentile,
			});
		}

		const currentQData = answers[currentIdx];
		const qResult = await pool.query(
			'SELECT id, category, difficulty, question_text, options, time_limit_seconds FROM aptitude_questions WHERE id = $1',
			[currentQData.questionId],
		);

		if (qResult.rows.length === 0) {
			return res.status(404).json({ error: 'Question not found' });
		}

		const q = qResult.rows[0];
		res.json({
			status: 'in_progress',
			attemptId,
			testTitle: attempt.title,
			timeRemaining,
			totalDurationSeconds,
			currentQuestion: {
				id: q.id,
				text: q.question_text,
				category: q.category,
				difficulty: q.difficulty,
				options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
				timeLimit: q.time_limit_seconds,
				questionNumber: currentIdx + 1,
				totalQuestions: answers.length,
			},
		});
	} catch (error) {
		console.error('Error fetching current attempt:', error);
		res.status(500).json({ error: 'Failed to fetch attempt state' });
	}
});

/**
 * POST /aptitude-tests/attempt/:id/answer
 * Submit answer, record time, return next question or complete.
 */
router.post('/aptitude-tests/attempt/:id/answer', authMiddleware, async (req, res) => {
	const client = await pool.connect();
	try {
		const candidateId = req.user.id;
		const attemptId = parseInt(req.params.id, 10);
		const { answer, timeTaken } = req.body;

		await client.query('BEGIN');

		const attemptResult = await client.query(
			`
        SELECT ata.*, at.duration_minutes, at.title
        FROM aptitude_test_attempts ata
        JOIN aptitude_tests at ON ata.test_id = at.id
        WHERE ata.id = $1 AND ata.candidate_id = $2
        FOR UPDATE
      `,
			[attemptId, candidateId],
		);

		if (attemptResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Attempt not found' });
		}

		const attempt = attemptResult.rows[0];

		if (attempt.status !== 'in_progress') {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: `Attempt is ${attempt.status}` });
		}

		// Check timer server-side
		const timeSpent = getTimeSpentSeconds(attempt.started_at);
		const totalDurationSeconds = attempt.duration_minutes * 60;
		if (timeSpent >= totalDurationSeconds) {
			await autoTimeoutAttempt(client, attemptId, candidateId);
			await client.query('COMMIT');
			return res.status(410).json({ error: 'Time expired', status: 'timed_out' });
		}

		const answers =
			typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : attempt.answers || [];
		const currentIdx = answers.findIndex((a) => !a.answered);

		if (currentIdx === -1) {
			await client.query('ROLLBACK');
			return res.status(400).json({ error: 'No pending questions' });
		}

		const currentQ = answers[currentIdx];

		// Verify answer against DB
		const qResult = await client.query(
			'SELECT correct_answer FROM aptitude_questions WHERE id = $1',
			[currentQ.questionId],
		);
		if (qResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Question not found' });
		}

		const correctAnswer = qResult.rows[0].correct_answer;
		const isCorrect = answer === correctAnswer;

		// Time anomaly detection (too fast)
		const isTimeAnomaly = (timeTaken || 0) < 3; // under 3 seconds is suspicious

		// Record answer
		answers[currentIdx] = {
			...answers[currentIdx],
			answered: true,
			answer,
			isCorrect,
			timeTaken: timeTaken || 0,
			timestamp: new Date().toISOString(),
			isTimeAnomaly,
		};

		const newScore = answers.filter((a) => a.answered && a.isCorrect).length;
		const newTimeAnomalies = (attempt.time_anomalies || 0) + (isTimeAnomaly ? 1 : 0);
		const newTimeSpent = timeTaken || 0;

		await client.query(
			`
        UPDATE aptitude_test_attempts
        SET answers = $1, score = $2, time_anomalies = $3,
            time_spent_seconds = COALESCE(time_spent_seconds, 0) + $4,
            updated_at = NOW()
        WHERE id = $5
      `,
			[JSON.stringify(answers), newScore, newTimeAnomalies, newTimeSpent, attemptId],
		);

		// Check if there are more questions
		const nextIdx = answers.findIndex((a, i) => i > currentIdx && !a.answered);

		if (nextIdx === -1) {
			// All answered — complete the test
			const completed = await completeAttempt(client, attemptId, candidateId, answers, attempt);
			await client.query('COMMIT');

			return res.json({
				completed: true,
				score: completed.score,
				maxScore: completed.maxScore,
				percentile: completed.percentile,
				antiCheatScore: completed.antiCheatScore,
				passed: completed.passed,
			});
		}

		// Return next question
		const nextQData = answers[nextIdx];
		const nextQResult = await client.query(
			'SELECT id, category, difficulty, question_text, options, time_limit_seconds FROM aptitude_questions WHERE id = $1',
			[nextQData.questionId],
		);
		const nextQ = nextQResult.rows[0];

		const timeRemaining = Math.max(0, totalDurationSeconds - timeSpent);

		await client.query('COMMIT');

		res.json({
			completed: false,
			isCorrect,
			feedback: isCorrect ? 'Correct!' : 'Incorrect',
			timeRemaining,
			nextQuestion: {
				id: nextQ.id,
				text: nextQ.question_text,
				category: nextQ.category,
				difficulty: nextQ.difficulty,
				options: typeof nextQ.options === 'string' ? JSON.parse(nextQ.options) : nextQ.options,
				timeLimit: nextQ.time_limit_seconds,
				questionNumber: nextIdx + 1,
				totalQuestions: answers.length,
			},
		});
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Error submitting answer:', error);
		res.status(500).json({ error: 'Failed to submit answer' });
	} finally {
		client.release();
	}
});

/**
 * POST /aptitude-tests/attempt/:id/timeout
 * Auto-submit on timer expiry, calculate score.
 */
router.post('/aptitude-tests/attempt/:id/timeout', authMiddleware, async (req, res) => {
	const client = await pool.connect();
	try {
		const candidateId = req.user.id;
		const attemptId = parseInt(req.params.id, 10);

		await client.query('BEGIN');

		const attemptResult = await client.query(
			`
        SELECT ata.*, at.duration_minutes
        FROM aptitude_test_attempts ata
        JOIN aptitude_tests at ON ata.test_id = at.id
        WHERE ata.id = $1 AND ata.candidate_id = $2
        FOR UPDATE
      `,
			[attemptId, candidateId],
		);

		if (attemptResult.rows.length === 0) {
			await client.query('ROLLBACK');
			return res.status(404).json({ error: 'Attempt not found' });
		}

		const attempt = attemptResult.rows[0];

		if (attempt.status !== 'in_progress') {
			await client.query('ROLLBACK');
			return res.json({
				status: attempt.status,
				score: attempt.score,
				maxScore: attempt.max_score,
			});
		}

		const answers =
			typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : attempt.answers || [];

		const completed = await completeAttempt(client, attemptId, candidateId, answers, attempt);
		await client.query('COMMIT');

		res.json({
			status: 'timed_out',
			score: completed.score,
			maxScore: completed.maxScore,
			percentile: completed.percentile,
			antiCheatScore: completed.antiCheatScore,
			passed: completed.passed,
		});
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('Error on timeout:', error);
		res.status(500).json({ error: 'Failed to process timeout' });
	} finally {
		client.release();
	}
});

/**
 * POST /aptitude-tests/attempt/:id/event
 * Anti-cheat events: tab_switch, copy_paste.
 */
router.post('/aptitude-tests/attempt/:id/event', authMiddleware, async (req, res) => {
	try {
		const candidateId = req.user.id;
		const attemptId = parseInt(req.params.id, 10);
		const { eventType } = req.body;

		// Verify attempt belongs to user
		const checkResult = await pool.query(
			'SELECT id FROM aptitude_test_attempts WHERE id = $1 AND candidate_id = $2 AND status = $3',
			[attemptId, candidateId, 'in_progress'],
		);
		if (checkResult.rows.length === 0) {
			return res.status(404).json({ error: 'Active attempt not found' });
		}

		if (eventType === 'tab_switch') {
			await pool.query(
				'UPDATE aptitude_test_attempts SET tab_switches = COALESCE(tab_switches, 0) + 1, updated_at = NOW() WHERE id = $1',
				[attemptId],
			);
		} else if (eventType === 'copy_paste') {
			await pool.query(
				'UPDATE aptitude_test_attempts SET copy_paste_attempts = COALESCE(copy_paste_attempts, 0) + 1, updated_at = NOW() WHERE id = $1',
				[attemptId],
			);
		} else {
			return res.status(400).json({ error: 'Unknown event type' });
		}

		res.json({ logged: true, eventType });
	} catch (error) {
		console.error('Error logging anti-cheat event:', error);
		res.status(500).json({ error: 'Failed to log event' });
	}
});

/**
 * GET /aptitude-tests/results
 * Candidate's past aptitude test results.
 */
router.get('/aptitude-tests/results', authMiddleware, async (req, res) => {
	try {
		const candidateId = req.user.id;

		const result = await pool.query(
			`
        SELECT ata.*, at.title, at.pass_score,
          (SELECT COUNT(*) FROM aptitude_questions WHERE test_id = ata.test_id) as total_questions
        FROM aptitude_test_attempts ata
        JOIN aptitude_tests at ON ata.test_id = at.id
        WHERE ata.candidate_id = $1
          AND ata.status IN ('completed', 'timed_out')
        ORDER BY ata.completed_at DESC
      `,
			[candidateId],
		);

		res.json({ results: result.rows });
	} catch (error) {
		console.error('Error fetching aptitude results:', error);
		res.status(500).json({ error: 'Failed to fetch results' });
	}
});

/**
 * GET /aptitude-tests/attempt/:id
 * Single attempt detail.
 */
router.get('/aptitude-tests/attempt/:id', authMiddleware, async (req, res) => {
	try {
		const candidateId = req.user.id;
		const attemptId = parseInt(req.params.id, 10);

		const result = await pool.query(
			`
        SELECT ata.*, at.title, at.pass_score, at.duration_minutes
        FROM aptitude_test_attempts ata
        JOIN aptitude_tests at ON ata.test_id = at.id
        WHERE ata.id = $1 AND ata.candidate_id = $2
      `,
			[attemptId, candidateId],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Attempt not found' });
		}

		const attempt = result.rows[0];

		// Enrich answers with question details
		const answers =
			typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : attempt.answers || [];
		const questionIds = answers.map((a) => a.questionId).filter(Boolean);

		let questions = [];
		if (questionIds.length > 0) {
			const qResult = await pool.query(
				`SELECT id, question_text, correct_answer, explanation, category, difficulty
           FROM aptitude_questions WHERE id = ANY($1)`,
				[questionIds],
			);
			questions = qResult.rows;
		}

		const enrichedAnswers = answers.map((a) => {
			const q = questions.find((q) => q.id === a.questionId);
			return {
				...a,
				questionText: q ? q.question_text : 'Question not found',
				correctAnswer: q ? q.correct_answer : null,
				explanation: q ? q.explanation : null,
				category: q ? q.category : null,
				difficulty: q ? q.difficulty : null,
			};
		});

		res.json({
			attempt: {
				...attempt,
				detailedAnswers: enrichedAnswers,
			},
		});
	} catch (error) {
		console.error('Error fetching attempt detail:', error);
		res.status(500).json({ error: 'Failed to fetch attempt' });
	}
});

// ───────────────────────────────────────────────
// RECRUITER ROUTES
// ───────────────────────────────────────────────

/**
 * GET /recruiter/aptitude-tests
 * List all aptitude tests.
 */
router.get('/recruiter/aptitude-tests', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const result = await pool.query(
			`
        SELECT at.*,
          (SELECT COUNT(*) FROM aptitude_questions WHERE test_id = at.id) as question_count,
          (SELECT COUNT(*) FROM aptitude_test_attempts WHERE test_id = at.id AND status = 'completed') as total_attempts,
          (SELECT ROUND(AVG(score), 1) FROM aptitude_test_attempts WHERE test_id = at.id AND status = 'completed') as avg_score
        FROM aptitude_tests at
        ORDER BY at.created_at DESC
      `,
		);

		res.json({ tests: result.rows });
	} catch (error) {
		console.error('Error fetching aptitude tests:', error);
		res.status(500).json({ error: 'Failed to fetch tests' });
	}
});

/**
 * POST /recruiter/aptitude-tests
 * Create a new aptitude test.
 */
router.post('/recruiter/aptitude-tests', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { title, description, durationMinutes, passScore, retakeLockoutDays, questionCount } =
			req.body;

		if (!title) {
			return res.status(400).json({ error: 'Title is required' });
		}

		const result = await pool.query(
			`
        INSERT INTO aptitude_tests
        (title, description, duration_minutes, pass_score, retake_lockout_days, question_count, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
			[
				title,
				description || null,
				durationMinutes || 15,
				passScore || 60,
				retakeLockoutDays ?? 30,
				questionCount || 50,
				req.user.id,
			],
		);

		await AuditLogger.log({
			actionType: 'aptitude_test_created',
			userId: req.user.id,
			targetType: 'aptitude_test',
			targetId: result.rows[0].id,
			metadata: { title },
			req,
		});

		res.json({ test: result.rows[0] });
	} catch (error) {
		console.error('Error creating aptitude test:', error);
		res.status(500).json({ error: 'Failed to create test' });
	}
});

/**
 * POST /recruiter/aptitude-tests/:id/questions
 * Add a question to a test.
 */
router.post(
	'/recruiter/aptitude-tests/:id/questions',
	authMiddleware,
	requireRecruiter,
	async (req, res) => {
		try {
			const testId = parseInt(req.params.id, 10);
			const { category, difficulty, questionText, options, correctAnswer, explanation, timeLimit } =
				req.body;

			if (!questionText || !options || !correctAnswer || !category) {
				return res.status(400).json({
					error: 'questionText, options, correctAnswer, and category are required',
				});
			}

			if (!['logic', 'verbal', 'numerical'].includes(category)) {
				return res.status(400).json({ error: 'category must be logic, verbal, or numerical' });
			}

			const result = await pool.query(
				`
          INSERT INTO aptitude_questions
          (test_id, category, difficulty, question_text, options, correct_answer, explanation, time_limit_seconds)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
				[
					testId,
					category,
					difficulty || 3,
					questionText,
					JSON.stringify(options),
					correctAnswer,
					explanation || null,
					timeLimit || 90,
				],
			);

			res.json({ question: result.rows[0] });
		} catch (error) {
			console.error('Error adding question:', error);
			res.status(500).json({ error: 'Failed to add question' });
		}
	},
);

/**
 * PUT /recruiter/aptitude-tests/:id/questions/:qid
 * Update a question.
 */
router.put(
	'/recruiter/aptitude-tests/:id/questions/:qid',
	authMiddleware,
	requireRecruiter,
	async (req, res) => {
		try {
			const qid = parseInt(req.params.qid, 10);
			const { questionText, options, correctAnswer, explanation, difficulty, timeLimit, isActive } =
				req.body;

			const result = await pool.query(
				`
          UPDATE aptitude_questions
          SET question_text = COALESCE($1, question_text),
              options = COALESCE($2, options),
              correct_answer = COALESCE($3, correct_answer),
              explanation = COALESCE($4, explanation),
              difficulty = COALESCE($5, difficulty),
              time_limit_seconds = COALESCE($6, time_limit_seconds),
              is_active = COALESCE($7, is_active),
              updated_at = NOW()
          WHERE id = $8
          RETURNING *
        `,
				[
					questionText || null,
					options ? JSON.stringify(options) : null,
					correctAnswer || null,
					explanation || null,
					difficulty || null,
					timeLimit || null,
					isActive !== undefined ? isActive : null,
					qid,
				],
			);

			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Question not found' });
			}

			res.json({ question: result.rows[0] });
		} catch (error) {
			console.error('Error updating question:', error);
			res.status(500).json({ error: 'Failed to update question' });
		}
	},
);

/**
 * DELETE /recruiter/aptitude-tests/:id/questions/:qid
 * Deactivate a question (soft delete).
 */
router.delete(
	'/recruiter/aptitude-tests/:id/questions/:qid',
	authMiddleware,
	requireRecruiter,
	async (req, res) => {
		try {
			const qid = parseInt(req.params.qid, 10);

			const result = await pool.query(
				'UPDATE aptitude_questions SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
				[qid],
			);

			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Question not found' });
			}

			res.json({ question: result.rows[0], deactivated: true });
		} catch (error) {
			console.error('Error deactivating question:', error);
			res.status(500).json({ error: 'Failed to deactivate question' });
		}
	},
);

/**
 * POST /recruiter/jobs/:id/aptitude-test
 * Assign an aptitude test to a job.
 */
router.post(
	'/recruiter/jobs/:id/aptitude-test',
	authMiddleware,
	requireRecruiter,
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.id, 10);
			const { testId, isRequired, targetScoreMin, targetScoreMax } = req.body;

			if (!testId) {
				return res.status(400).json({ error: 'testId is required' });
			}

			const result = await pool.query(
				`
          INSERT INTO aptitude_test_assignments
          (job_id, test_id, is_required, target_score_min, target_score_max, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (job_id, test_id) DO UPDATE SET
            is_required = EXCLUDED.is_required,
            target_score_min = EXCLUDED.target_score_min,
            target_score_max = EXCLUDED.target_score_max
          RETURNING *
        `,
				[
					jobId,
					testId,
					isRequired !== false,
					targetScoreMin || null,
					targetScoreMax || null,
					req.user.id,
				],
			);

			res.json({ assignment: result.rows[0] });
		} catch (error) {
			console.error('Error assigning test to job:', error);
			res.status(500).json({ error: 'Failed to assign test' });
		}
	},
);

/**
 * GET /recruiter/aptitude-tests/candidates/:candidateId
 * View candidate aptitude test results (recruiter view).
 */
router.get(
	'/recruiter/aptitude-tests/candidates/:candidateId',
	authMiddleware,
	requireRecruiter,
	async (req, res) => {
		try {
			const candidateId = parseInt(req.params.candidateId, 10);

			const result = await pool.query(
				`
          SELECT ata.*, at.title, at.pass_score,
            u.name as candidate_name, u.email as candidate_email
          FROM aptitude_test_attempts ata
          JOIN aptitude_tests at ON ata.test_id = at.id
          JOIN users u ON ata.candidate_id = u.id
          WHERE ata.candidate_id = $1
            AND ata.status IN ('completed', 'timed_out')
          ORDER BY ata.completed_at DESC
        `,
				[candidateId],
			);

			res.json({ results: result.rows });
		} catch (error) {
			console.error('Error fetching candidate aptitude results:', error);
			res.status(500).json({ error: 'Failed to fetch results' });
		}
	},
);

/**
 * GET /recruiter/aptitude-tests/stats
 * Pool statistics: avg score, score distribution, percentile data.
 */
router.get(
	'/recruiter/aptitude-tests/stats',
	authMiddleware,
	requireRecruiter,
	async (req, res) => {
		try {
			const { testId } = req.query;

			// Overall stats
			let statsQuery = `
          SELECT
            COUNT(*) as total_attempts,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
            COUNT(*) FILTER (WHERE status = 'timed_out') as timed_out_count,
            ROUND(AVG(score) FILTER (WHERE status IN ('completed', 'timed_out')), 1) as avg_score,
            ROUND(AVG(max_score) FILTER (WHERE status IN ('completed', 'timed_out')), 1) as avg_max_score,
            ROUND(AVG(percentile) FILTER (WHERE percentile IS NOT NULL), 1) as avg_percentile,
            MAX(score) as highest_score,
            MIN(score) as lowest_score,
            ROUND(AVG(anti_cheat_score), 1) as avg_anti_cheat_score,
            ROUND(AVG(time_spent_seconds), 0) as avg_time_spent
          FROM aptitude_test_attempts
          WHERE status IN ('completed', 'timed_out')
        `;
			const statsParams = [];

			if (testId) {
				statsQuery += ' AND test_id = $1';
				statsParams.push(parseInt(testId, 10));
			}

			const statsResult = await pool.query(statsQuery, statsParams);

			// Score distribution buckets
			let distQuery = `
          SELECT
            CASE
              WHEN score < max_score * 0.4 THEN '0-39%'
              WHEN score < max_score * 0.5 THEN '40-49%'
              WHEN score < max_score * 0.6 THEN '50-59%'
              WHEN score < max_score * 0.7 THEN '60-69%'
              WHEN score < max_score * 0.8 THEN '70-79%'
              WHEN score < max_score * 0.9 THEN '80-89%'
              ELSE '90-100%'
            END as bucket,
            COUNT(*) as count
          FROM aptitude_test_attempts
          WHERE status IN ('completed', 'timed_out')
        `;
			if (testId) {
				distQuery += ' AND test_id = $1';
			}
			distQuery += ' GROUP BY 1 ORDER BY 1';

			const distResult = await pool.query(distQuery, statsParams);

			// Category performance breakdown (from answers JSONB)
			let categoryQuery = `
          SELECT
            q.category,
            COUNT(*) as total_answers,
            COUNT(*) FILTER (WHERE (a.value->>'isCorrect')::boolean = true) as correct_answers,
            ROUND(
              COUNT(*) FILTER (WHERE (a.value->>'isCorrect')::boolean = true) * 100.0 / NULLIF(COUNT(*), 0),
              1
            ) as accuracy_pct
          FROM aptitude_test_attempts ata,
               LATERAL jsonb_array_elements(ata.answers) a
          JOIN aptitude_questions q ON (a.value->>'questionId')::int = q.id
          WHERE ata.status IN ('completed', 'timed_out')
            AND (a.value->>'answered')::boolean = true
        `;
			if (testId) {
				categoryQuery += ' AND ata.test_id = $1';
			}
			categoryQuery += ' GROUP BY q.category ORDER BY accuracy_pct DESC';

			const categoryResult = await pool.query(categoryQuery, statsParams);

			res.json({
				stats: statsResult.rows[0] || {},
				scoreDistribution: distResult.rows,
				categoryBreakdown: categoryResult.rows,
			});
		} catch (error) {
			console.error('Error fetching aptitude stats:', error);
			res.status(500).json({ error: 'Failed to fetch stats' });
		}
	},
);

// ───────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────

function canRetake(lockoutDays, lastCompletedAt) {
	if (!lastCompletedAt) return true;
	if (!lockoutDays || lockoutDays <= 0) return true;
	const lockoutEnd = new Date(lastCompletedAt);
	lockoutEnd.setDate(lockoutEnd.getDate() + lockoutDays);
	return new Date() >= lockoutEnd;
}

function getTimeSpentSeconds(startedAt) {
	const start = new Date(startedAt);
	const now = new Date();
	return Math.floor((now - start) / 1000);
}

/**
 * Complete an attempt: calculate score, anti-cheat, percentile, update DB.
 * Accepts optional client for transaction context.
 */
async function completeAttempt(clientOrPool, attemptId, candidateId, answers, attempt) {
	const db = clientOrPool || pool;
	const score = answers.filter((a) => a.answered && a.isCorrect).length;
	const maxScore = answers.length;

	// Anti-cheat score (100 = clean, lower = suspicious)
	let antiCheatScore = 100;
	antiCheatScore -= (attempt.tab_switches || 0) * 5;
	antiCheatScore -= (attempt.copy_paste_attempts || 0) * 10;
	antiCheatScore -= (attempt.time_anomalies || 0) * 5;
	antiCheatScore = Math.max(0, Math.min(100, antiCheatScore));

	// Calculate percentile using PERCENT_RANK over all completed attempts for this test
	let percentile = null;
	try {
		const pctResult = await db.query(
			`
        SELECT PERCENT_RANK($1) WITHIN GROUP (ORDER BY score)
        FROM aptitude_test_attempts
        WHERE test_id = $2 AND status IN ('completed', 'timed_out')
      `,
			[score, attempt.test_id],
		);
		if (pctResult.rows.length > 0 && pctResult.rows[0].percent_rank !== null) {
			percentile = Math.round(parseFloat(pctResult.rows[0].percent_rank) * 10000) / 100;
		}
	} catch (_err) {
		// percentile is optional, don't fail on it
	}

	const timeSpent = getTimeSpentSeconds(attempt.started_at);

	await db.query(
		`
      UPDATE aptitude_test_attempts
      SET status = 'completed',
          score = $1,
          max_score = $2,
          anti_cheat_score = $3,
          percentile = $4,
          completed_at = NOW(),
          time_spent_seconds = $5,
          updated_at = NOW()
      WHERE id = $6 AND candidate_id = $7
    `,
		[score, maxScore, antiCheatScore, percentile, timeSpent, attemptId, candidateId],
	);

	const passed = score >= (attempt.pass_score || 60);

	// Audit log
	await AuditLogger.log({
		actionType: 'aptitude_test_completed',
		userId: candidateId,
		targetType: 'aptitude_test_attempt',
		targetId: attemptId,
		metadata: {
			test_id: attempt.test_id,
			score,
			max_score: maxScore,
			percentile,
			anti_cheat_score: antiCheatScore,
			passed,
		},
		req: null,
	});

	return { score, maxScore, percentile, antiCheatScore, passed };
}

/**
 * Auto-timeout an attempt.
 * Accepts optional client for transaction context.
 */
async function autoTimeoutAttempt(clientOrPool, attemptId, candidateId) {
	const db = clientOrPool || pool;
	const attemptResult = await db.query(
		`
      SELECT ata.*, at.pass_score
      FROM aptitude_test_attempts ata
      JOIN aptitude_tests at ON ata.test_id = at.id
      WHERE ata.id = $1 AND ata.candidate_id = $2
    `,
		[attemptId, candidateId],
	);

	if (attemptResult.rows.length === 0) return;

	const attempt = attemptResult.rows[0];
	const answers =
		typeof attempt.answers === 'string' ? JSON.parse(attempt.answers) : attempt.answers || [];

	const score = answers.filter((a) => a.answered && a.isCorrect).length;
	const maxScore = answers.length;
	const timeSpent = getTimeSpentSeconds(attempt.started_at);

	let antiCheatScore = 100;
	antiCheatScore -= (attempt.tab_switches || 0) * 5;
	antiCheatScore -= (attempt.copy_paste_attempts || 0) * 10;
	antiCheatScore -= (attempt.time_anomalies || 0) * 5;
	antiCheatScore = Math.max(0, Math.min(100, antiCheatScore));

	await db.query(
		`
      UPDATE aptitude_test_attempts
      SET status = 'timed_out',
          score = $1,
          max_score = $2,
          anti_cheat_score = $3,
          completed_at = NOW(),
          time_spent_seconds = $4,
          updated_at = NOW()
      WHERE id = $5
    `,
		[score, maxScore, antiCheatScore, timeSpent, attemptId],
	);

	await AuditLogger.log({
		actionType: 'aptitude_test_timed_out',
		userId: candidateId,
		targetType: 'aptitude_test_attempt',
		targetId: attemptId,
		metadata: { test_id: attempt.test_id, score, max_score: maxScore },
		req: null,
	});
}

module.exports = router;
