/**
 * Screening Questionnaire Routes (Issue #110)
 * Custom per-job questionnaire with AI evaluation, knockout questions, and recruiter overrides.
 */

const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../lib/auth');
const pool = require('../lib/db');
const { chat, safeParseJSON, handleAIError } = require('../lib/polsia-ai');
const { AuditLogger } = require('../services/auditLogService');

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Check if a recruiter has access to a job via company_id.
 */
async function verifyJobAccess(userId, jobId) {
	const result = await pool.query(
		`
    SELECT j.* FROM jobs j
    WHERE j.id = $1 AND j.company_id = (SELECT company_id FROM users WHERE id = $2)
  `,
		[jobId, userId],
	);
	return result.rows[0] || null;
}

/**
 * Check if a candidate has an application for a job.
 */
async function getApplication(candidateId, jobId) {
	const result = await pool.query(
		`SELECT * FROM job_applications WHERE candidate_id = $1 AND job_id = $2`,
		[candidateId, jobId],
	);
	return result.rows[0] || null;
}

/**
 * Check if a candidate's answer triggers a knockout.
 * Returns { triggered: boolean, reason: string|null }
 */
function checkKnockout(question, answer) {
	if (
		!question.is_knockout ||
		question.knockout_answer === null ||
		question.knockout_answer === undefined
	) {
		return { triggered: false, reason: null };
	}

	const ka = question.knockout_answer;
	let matched = false;

	switch (question.question_type) {
		case 'yes_no':
			matched = String(answer).toLowerCase().trim() === String(ka).toLowerCase().trim();
			break;
		case 'single_choice':
			matched = String(answer).trim() === String(ka).trim();
			break;
		case 'multiple_choice': {
			const candidateAnswers = Array.isArray(answer) ? answer : [answer];
			const knockoutAnswers = Array.isArray(ka) ? ka : [ka];
			// Match if the sets are equal (same elements, same count)
			const sortedCandidate = [...candidateAnswers].map(String).sort();
			const sortedKnockout = [...knockoutAnswers].map(String).sort();
			matched =
				sortedCandidate.length === sortedKnockout.length &&
				sortedCandidate.every((v, i) => v === sortedKnockout[i]);
			break;
		}
		case 'numeric': {
			const numAnswer = Number(answer);
			if (typeof ka === 'number') {
				matched = numAnswer === ka;
			} else if (ka && typeof ka === 'object' && (ka.min !== undefined || ka.max !== undefined)) {
				const inRange =
					(ka.min === undefined || numAnswer >= ka.min) &&
					(ka.max === undefined || numAnswer <= ka.max);
				matched = inRange;
			}
			break;
		}
		case 'short_text':
			// Knockout not supported for short_text — AI evaluates instead
			matched = false;
			break;
		default:
			matched = false;
	}

	if (matched) {
		return {
			triggered: true,
			reason: `Knockout question failed: ${question.question_text}`,
		};
	}
	return { triggered: false, reason: null };
}

/**
 * Run AI evaluation for a single short_text answer.
 */
async function evaluateAnswer(question, answer, job) {
	const prompt = `Score this candidate's answer to a screening question.

Job Title: ${job.title || 'Unknown'}
Job Description: ${(job.description || '').substring(0, 500)}

Question: ${question.question_text}

Candidate's Answer: ${answer || '(no answer)'}

Evaluate the answer based on relevance, completeness, clarity, and alignment with the job requirements.

Return ONLY a JSON object with this exact structure:
{
  "score": 0-100,
  "explanation": "1-2 sentence explanation of why this score was given"
}`;

	const response = await chat(prompt, {
		system:
			'You are an expert hiring evaluator. Score candidate screening answers objectively and fairly. Always return valid JSON.',
		module: 'screening_questionnaire',
		feature: 'answer_evaluation',
		response_format: { type: 'json_object' },
	});

	const parsed = safeParseJSON(response);
	if (parsed && typeof parsed === 'object' && typeof parsed.score === 'number') {
		return {
			score: Math.max(0, Math.min(100, Math.round(parsed.score))),
			explanation: parsed.explanation || 'No explanation provided',
		};
	}

	// Fallback if parsing fails
	return {
		score: 50,
		explanation: 'AI evaluation could not be parsed. Default score applied.',
	};
}

// ─── Recruiter Endpoints ──────────────────────────────────────────────────

/**
 * GET /api/questionnaire/:job_id
 * Get full questionnaire for a job (including questions ordered by order_index)
 */
router.get(
	'/:job_id',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'admin', 'employer'),
	async (req, res) => {
		try {
			const { job_id } = req.params;
			const job = await verifyJobAccess(req.user.id, job_id);
			if (!job) {
				return res.status(403).json({ error: 'You do not have access to this job' });
			}

			const qResult = await pool.query(`SELECT * FROM screening_questionnaires WHERE job_id = $1`, [
				job_id,
			]);

			if (qResult.rows.length === 0) {
				return res.status(404).json({ error: 'Questionnaire not found for this job' });
			}

			const questionnaire = qResult.rows[0];

			const questionsResult = await pool.query(
				`SELECT * FROM screening_questions WHERE questionnaire_id = $1 ORDER BY order_index ASC, id ASC`,
				[questionnaire.id],
			);

			res.json({
				success: true,
				questionnaire: {
					...questionnaire,
					questions: questionsResult.rows,
				},
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [questionnaire/get] Error:`, err);
			res.status(500).json({ error: 'Failed to get questionnaire', ref });
		}
	},
);

/**
 * POST /api/questionnaire
 * Create or update a questionnaire for a job (upsert with full question replacement)
 */
router.post(
	'/',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'admin', 'employer'),
	async (req, res) => {
		try {
			const { job_id, pass_threshold = 70, questions = [] } = req.body;

			if (!job_id) {
				return res.status(400).json({ error: 'job_id is required' });
			}

			const job = await verifyJobAccess(req.user.id, job_id);
			if (!job) {
				return res.status(403).json({ error: 'You do not have access to this job' });
			}

			// Validate pass_threshold
			const threshold = Math.max(0, Math.min(100, parseInt(pass_threshold, 10) || 70));

			// Validate questions
			const validTypes = ['single_choice', 'multiple_choice', 'short_text', 'yes_no', 'numeric'];
			for (const q of questions) {
				if (!q.question_text || !q.question_type) {
					return res
						.status(400)
						.json({ error: 'Each question must have question_text and question_type' });
				}
				if (!validTypes.includes(q.question_type)) {
					return res.status(400).json({ error: `Invalid question_type: ${q.question_type}` });
				}
				if (q.question_type === 'short_text' && q.is_knockout) {
					return res
						.status(400)
						.json({ error: 'short_text questions cannot be knockout questions' });
				}
			}

			await pool.query('BEGIN');

			try {
				// Upsert questionnaire
				const qResult = await pool.query(
					`
          INSERT INTO screening_questionnaires (job_id, pass_threshold, is_active, updated_at)
          VALUES ($1, $2, true, NOW())
          ON CONFLICT (job_id) DO UPDATE SET
            pass_threshold = EXCLUDED.pass_threshold,
            is_active = true,
            updated_at = NOW()
          RETURNING *
        `,
					[job_id, threshold],
				);

				// NOTE: The ON CONFLICT above requires a UNIQUE constraint on job_id.
				// If that doesn't exist yet, we handle it manually:
				let questionnaire = qResult.rows[0];
				if (!questionnaire) {
					// Fallback: check if exists and update, else insert
					const existing = await pool.query(
						`SELECT * FROM screening_questionnaires WHERE job_id = $1`,
						[job_id],
					);
					if (existing.rows.length > 0) {
						const updateResult = await pool.query(
							`
              UPDATE screening_questionnaires
              SET pass_threshold = $1, is_active = true, updated_at = NOW()
              WHERE job_id = $2
              RETURNING *
            `,
							[threshold, job_id],
						);
						questionnaire = updateResult.rows[0];
					} else {
						const insertResult = await pool.query(
							`
              INSERT INTO screening_questionnaires (job_id, pass_threshold, is_active)
              VALUES ($1, $2, true)
              RETURNING *
            `,
							[job_id, threshold],
						);
						questionnaire = insertResult.rows[0];
					}
				}

				// Delete old questions and replace
				await pool.query(`DELETE FROM screening_questions WHERE questionnaire_id = $1`, [
					questionnaire.id,
				]);

				const insertedQuestions = [];
				for (let i = 0; i < questions.length; i++) {
					const q = questions[i];
					const iqResult = await pool.query(
						`
            INSERT INTO screening_questions
              (questionnaire_id, question_text, question_type, options, is_knockout, knockout_answer, order_index, required)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
          `,
						[
							questionnaire.id,
							q.question_text,
							q.question_type,
							q.options ? JSON.stringify(q.options) : null,
							q.is_knockout || false,
							q.knockout_answer !== undefined ? JSON.stringify(q.knockout_answer) : null,
							q.order_index !== undefined ? q.order_index : i,
							q.required !== undefined ? q.required : true,
						],
					);
					insertedQuestions.push(iqResult.rows[0]);
				}

				await pool.query('COMMIT');

				res.json({
					success: true,
					questionnaire: {
						...questionnaire,
						questions: insertedQuestions,
					},
				});
			} catch (err) {
				await pool.query('ROLLBACK');
				throw err;
			}
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [questionnaire/post] Error:`, err);
			res.status(500).json({ error: 'Failed to save questionnaire', ref });
		}
	},
);

/**
 * DELETE /api/questionnaire/:job_id
 * Delete questionnaire and all associated questions, responses, evaluations, overrides
 */
router.delete(
	'/:job_id',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'admin', 'employer'),
	async (req, res) => {
		try {
			const { job_id } = req.params;
			const job = await verifyJobAccess(req.user.id, job_id);
			if (!job) {
				return res.status(403).json({ error: 'You do not have access to this job' });
			}

			const qResult = await pool.query(
				`SELECT id FROM screening_questionnaires WHERE job_id = $1`,
				[job_id],
			);

			if (qResult.rows.length === 0) {
				return res.status(404).json({ error: 'Questionnaire not found' });
			}

			await pool.query(`DELETE FROM screening_questionnaires WHERE id = $1`, [qResult.rows[0].id]);

			res.json({ success: true, message: 'Questionnaire deleted' });
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [questionnaire/delete] Error:`, err);
			res.status(500).json({ error: 'Failed to delete questionnaire', ref });
		}
	},
);

/**
 * POST /api/questionnaire/:response_id/override
 * Recruiter override of AI screening decision
 */
router.post(
	'/:response_id/override',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'admin', 'employer'),
	async (req, res) => {
		try {
			const { response_id } = req.params;
			const { override_decision, reason } = req.body;

			if (!override_decision || !['evaluated', 'rejected'].includes(override_decision)) {
				return res
					.status(400)
					.json({ error: 'override_decision must be "evaluated" or "rejected"' });
			}

			// Verify recruiter has access to the job this response belongs to
			const respCheck = await pool.query(
				`
      SELECT sr.*, sq.job_id
      FROM screening_responses sr
      JOIN screening_questionnaires sq ON sq.id = sr.questionnaire_id
      WHERE sr.id = $1
    `,
				[response_id],
			);

			if (respCheck.rows.length === 0) {
				return res.status(404).json({ error: 'Response not found' });
			}

			const response = respCheck.rows[0];
			const job = await verifyJobAccess(req.user.id, response.job_id);
			if (!job) {
				return res.status(403).json({ error: 'You do not have access to this job' });
			}

			const originalDecision = response.status;

			await pool.query('BEGIN');
			try {
				// Update response status
				await pool.query(
					`
          UPDATE screening_responses
          SET status = $1, updated_at = NOW()
          WHERE id = $2
        `,
					[override_decision, response_id],
				);

				// Record override
				await pool.query(
					`
          INSERT INTO screening_overrides
            (response_id, recruiter_id, original_decision, override_decision, reason)
          VALUES ($1, $2, $3, $4, $5)
        `,
					[response_id, req.user.id, originalDecision, override_decision, reason || null],
				);

				await pool.query('COMMIT');

				// Audit log
				await AuditLogger.log({
					actionType: 'screening_override',
					userId: req.user.id,
					targetType: 'screening_response',
					targetId: parseInt(response_id, 10),
					metadata: {
						response_id: parseInt(response_id, 10),
						original_decision: originalDecision,
						override_decision,
						reason: reason || null,
						job_id: response.job_id,
					},
					req,
				});

				res.json({
					success: true,
					message: `Screening decision overridden from "${originalDecision}" to "${override_decision}"`,
				});
			} catch (err) {
				await pool.query('ROLLBACK');
				throw err;
			}
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [questionnaire/override] Error:`, err);
			res.status(500).json({ error: 'Failed to override screening decision', ref });
		}
	},
);

// ─── Candidate Endpoints ──────────────────────────────────────────────────

/**
 * GET /api/questionnaire/candidate/:job_id
 * Get questionnaire for candidate (before starting). Excludes knockout answers.
 */
router.get('/candidate/:job_id', authMiddleware, async (req, res) => {
	try {
		const { job_id } = req.params;

		// Candidate must have applied
		const application = await getApplication(req.user.id, job_id);
		if (!application) {
			return res.status(403).json({ error: 'You have not applied to this job' });
		}

		const qResult = await pool.query(
			`SELECT * FROM screening_questionnaires WHERE job_id = $1 AND is_active = true`,
			[job_id],
		);

		if (qResult.rows.length === 0) {
			return res.status(404).json({ error: 'No active questionnaire for this job' });
		}

		const questionnaire = qResult.rows[0];

		const questionsResult = await pool.query(
			`
      SELECT id, question_text, question_type, options, is_knockout, order_index, required
      FROM screening_questions
      WHERE questionnaire_id = $1
      ORDER BY order_index ASC, id ASC
    `,
			[questionnaire.id],
		);

		// Check if candidate already has a response in progress
		const respResult = await pool.query(
			`SELECT id, status, answers FROM screening_responses WHERE application_id = $1`,
			[application.id],
		);

		res.json({
			success: true,
			questionnaire: {
				id: questionnaire.id,
				job_id: questionnaire.job_id,
				pass_threshold: questionnaire.pass_threshold,
				questions: questionsResult.rows,
			},
			ai_disclosure:
				'Your answers will be evaluated by AI. This helps us review applications faster. You can pause and resume at any time.',
			existing_response: respResult.rows[0] || null,
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [questionnaire/candidate/get] Error:`, err);
		res.status(500).json({ error: 'Failed to get questionnaire', ref });
	}
});

/**
 * POST /api/questionnaire/start
 * Start a new screening session
 */
router.post('/start', authMiddleware, async (req, res) => {
	try {
		const { job_id } = req.body;
		if (!job_id) {
			return res.status(400).json({ error: 'job_id is required' });
		}

		const application = await getApplication(req.user.id, job_id);
		if (!application) {
			return res.status(403).json({ error: 'You have not applied to this job' });
		}

		const qResult = await pool.query(
			`SELECT id FROM screening_questionnaires WHERE job_id = $1 AND is_active = true`,
			[job_id],
		);

		if (qResult.rows.length === 0) {
			return res.status(404).json({ error: 'No active questionnaire for this job' });
		}

		const questionnaireId = qResult.rows[0].id;

		// Check if there's already an in-progress response
		const existing = await pool.query(
			`SELECT id, status FROM screening_responses WHERE application_id = $1`,
			[application.id],
		);

		if (existing.rows.length > 0 && existing.rows[0].status === 'in_progress') {
			return res.json({
				success: true,
				response_id: existing.rows[0].id,
				message: 'Resuming existing screening session',
			});
		}

		// Create new response
		const insertResult = await pool.query(
			`
      INSERT INTO screening_responses (application_id, candidate_id, questionnaire_id, status, started_at)
      VALUES ($1, $2, $3, 'in_progress', NOW())
      RETURNING id
    `,
			[application.id, req.user.id, questionnaireId],
		);

		res.json({
			success: true,
			response_id: insertResult.rows[0].id,
			message: 'Screening session started',
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [questionnaire/start] Error:`, err);
		res.status(500).json({ error: 'Failed to start screening', ref });
	}
});

/**
 * POST /api/questionnaire/save
 * Save progress (answers) without submitting
 */
router.post('/save', authMiddleware, async (req, res) => {
	try {
		const { response_id, answers = {} } = req.body;
		if (!response_id) {
			return res.status(400).json({ error: 'response_id is required' });
		}

		// Verify the response belongs to this candidate
		const respResult = await pool.query(
			`SELECT * FROM screening_responses WHERE id = $1 AND candidate_id = $2`,
			[response_id, req.user.id],
		);

		if (respResult.rows.length === 0) {
			return res.status(404).json({ error: 'Response not found' });
		}

		const response = respResult.rows[0];
		if (response.status !== 'in_progress') {
			return res
				.status(400)
				.json({ error: `Cannot save: screening is already ${response.status}` });
		}

		// Merge new answers with existing
		const mergedAnswers = { ...response.answers, ...answers };

		await pool.query(
			`
      UPDATE screening_responses
      SET answers = $1, updated_at = NOW()
      WHERE id = $2
    `,
			[JSON.stringify(mergedAnswers), response_id],
		);

		res.json({
			success: true,
			message: 'Progress saved',
			answers: mergedAnswers,
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [questionnaire/save] Error:`, err);
		res.status(500).json({ error: 'Failed to save progress', ref });
	}
});

/**
 * POST /api/questionnaire/submit
 * Submit final answers, run knockout check, then AI evaluation for short_text questions
 */
router.post('/submit', authMiddleware, async (req, res) => {
	try {
		const { response_id, answers = {} } = req.body;
		if (!response_id) {
			return res.status(400).json({ error: 'response_id is required' });
		}

		// Verify the response belongs to this candidate
		const respResult = await pool.query(
			`
      SELECT sr.*, sq.job_id, sq.pass_threshold
      FROM screening_responses sr
      JOIN screening_questionnaires sq ON sq.id = sr.questionnaire_id
      WHERE sr.id = $1 AND sr.candidate_id = $2
    `,
			[response_id, req.user.id],
		);

		if (respResult.rows.length === 0) {
			return res.status(404).json({ error: 'Response not found' });
		}

		const response = respResult.rows[0];
		if (response.status !== 'in_progress') {
			return res
				.status(400)
				.json({ error: `Cannot submit: screening is already ${response.status}` });
		}

		// Get all questions for this questionnaire
		const questionsResult = await pool.query(
			`SELECT * FROM screening_questions WHERE questionnaire_id = $1 ORDER BY order_index ASC, id ASC`,
			[response.questionnaire_id],
		);
		const questions = questionsResult.rows;

		// Merge final answers
		const finalAnswers = { ...response.answers, ...answers };

		// ─── Knockout Check ─────────────────────────────────────────────────
		let knockoutTriggered = false;
		let knockoutReason = null;

		for (const question of questions) {
			if (question.is_knockout && finalAnswers[question.id] !== undefined) {
				const ko = checkKnockout(question, finalAnswers[question.id]);
				if (ko.triggered) {
					knockoutTriggered = true;
					knockoutReason = ko.reason;
					break;
				}
			}
		}

		if (knockoutTriggered) {
			await pool.query(
				`
          UPDATE screening_responses
          SET answers = $1, status = 'rejected', completed_at = NOW(),
              knockout_triggered = true, knockout_reason = $2, updated_at = NOW()
          WHERE id = $3
        `,
				[JSON.stringify(finalAnswers), knockoutReason, response_id],
			);

			return res.json({
				success: true,
				message: 'Screening submitted',
				status: 'rejected',
				knockout_triggered: true,
				knockout_reason: knockoutReason,
			});
		}

		// ─── AI Evaluation ──────────────────────────────────────────────────
		let overallScore = null;
		let aiExplanation = null;
		let status = 'completed';

		const shortTextQuestions = questions.filter((q) => q.question_type === 'short_text');

		if (shortTextQuestions.length > 0) {
			// Get job details for context
			const jobResult = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [response.job_id]);
			const job = jobResult.rows[0] || {};

			const evaluations = [];
			let totalScore = 0;
			let evaluatedCount = 0;

			for (const question of shortTextQuestions) {
				const answer = finalAnswers[question.id];
				if (answer !== undefined && String(answer).trim().length > 0) {
					try {
						const evalResult = await evaluateAnswer(question, answer, job);
						evaluations.push({
							question_id: question.id,
							score: evalResult.score,
							explanation: evalResult.explanation,
						});
						totalScore += evalResult.score;
						evaluatedCount++;
					} catch (aiErr) {
						console.error(
							`[questionnaire/submit] AI eval failed for Q${question.id}:`,
							aiErr.message,
						);
						// Continue with other questions — don't fail the whole submission
					}
				}
			}

			// Store evaluations
			for (const ev of evaluations) {
				await pool.query(
					`
            INSERT INTO screening_question_evaluations (response_id, question_id, score, explanation)
            VALUES ($1, $2, $3, $4)
          `,
					[response_id, ev.question_id, ev.score, ev.explanation],
				);
			}

			// Calculate overall score: average of all evaluated short_text questions
			// If there are non-short_text questions, they don't contribute to the score
			// (they were already validated via knockout logic)
			if (evaluatedCount > 0) {
				overallScore = Math.round(totalScore / evaluatedCount);
				const passThreshold = response.pass_threshold || 70;

				if (overallScore >= passThreshold) {
					status = 'evaluated';
					aiExplanation = `Candidate passed with a score of ${overallScore}/100 (threshold: ${passThreshold}).`;
				} else {
					status = 'rejected';
					aiExplanation = `Candidate scored ${overallScore}/100, below the passing threshold of ${passThreshold}.`;
				}
			} else {
				// No short_text answers to evaluate — auto-pass if no knockouts
				status = 'evaluated';
				overallScore = 100;
				aiExplanation =
					'No free-text questions required evaluation. All knockout questions passed.';
			}
		} else {
			// No short_text questions — auto-pass if no knockouts
			status = 'evaluated';
			overallScore = 100;
			aiExplanation = 'No free-text questions required evaluation. All knockout questions passed.';
		}

		await pool.query(
			`
      UPDATE screening_responses
      SET answers = $1, status = $2, completed_at = NOW(),
          overall_score = $3, ai_explanation = $4, updated_at = NOW()
      WHERE id = $5
    `,
			[JSON.stringify(finalAnswers), status, overallScore, aiExplanation, response_id],
		);

		res.json({
			success: true,
			message: 'Screening submitted',
			status,
			overall_score: overallScore,
			ai_explanation: aiExplanation,
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [questionnaire/submit] Error:`, err);
		res.status(500).json({ error: 'Failed to submit screening', ref });
	}
});

/**
 * GET /api/questionnaire/result/:response_id
 * Get screening results including evaluations and override info
 */
router.get('/result/:response_id', authMiddleware, async (req, res) => {
	try {
		const { response_id } = req.params;

		const respResult = await pool.query(
			`
      SELECT sr.*, sq.job_id, sq.pass_threshold
      FROM screening_responses sr
      JOIN screening_questionnaires sq ON sq.id = sr.questionnaire_id
      WHERE sr.id = $1
    `,
			[response_id],
		);

		if (respResult.rows.length === 0) {
			return res.status(404).json({ error: 'Response not found' });
		}

		const response = respResult.rows[0];

		// Authorization: candidate can see their own; recruiter can see for their job
		const isCandidate = req.user.id === response.candidate_id;
		let isRecruiter = false;
		if (!isCandidate) {
			const job = await verifyJobAccess(req.user.id, response.job_id);
			isRecruiter = !!job;
		}

		if (!isCandidate && !isRecruiter) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Get evaluations
		const evalResult = await pool.query(
			`
      SELECT sqe.*, sq.question_text, sq.question_type
      FROM screening_question_evaluations sqe
      JOIN screening_questions sq ON sq.id = sqe.question_id
      WHERE sqe.response_id = $1
    `,
			[response_id],
		);

		// Get override info
		const overrideResult = await pool.query(
			`
      SELECT so.*, u.name as recruiter_name
      FROM screening_overrides so
      JOIN users u ON u.id = so.recruiter_id
      WHERE so.response_id = $1
      ORDER BY so.created_at DESC
      LIMIT 1
    `,
			[response_id],
		);

		res.json({
			success: true,
			response: {
				id: response.id,
				application_id: response.application_id,
				candidate_id: response.candidate_id,
				questionnaire_id: response.questionnaire_id,
				answers: response.answers,
				status: response.status,
				started_at: response.started_at,
				completed_at: response.completed_at,
				overall_score: response.overall_score,
				ai_explanation: response.ai_explanation,
				knockout_triggered: response.knockout_triggered,
				knockout_reason: response.knockout_reason,
			},
			evaluations: evalResult.rows,
			override: overrideResult.rows[0] || null,
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [questionnaire/result] Error:`, err);
		res.status(500).json({ error: 'Failed to get results', ref });
	}
});

/**
 * GET /api/questionnaire/response-by-application/:application_id
 * Get screening response for a specific application (recruiter only)
 */
router.get(
	'/response-by-application/:application_id',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'admin', 'employer'),
	async (req, res) => {
		try {
			const { application_id } = req.params;

			// Verify recruiter has access to the job this application belongs to
			const appCheck = await pool.query(
				`
			SELECT ja.*, j.company_id
			FROM job_applications ja
			JOIN jobs j ON j.id = ja.job_id
			WHERE ja.id = $1
			`,
				[application_id],
			);

			if (appCheck.rows.length === 0) {
				return res.status(404).json({ error: 'Application not found' });
			}

			const app = appCheck.rows[0];
			const userResult = await pool.query('SELECT company_id FROM users WHERE id = $1', [
				req.user.id,
			]);
			const userCompanyId = userResult.rows[0]?.company_id;

			if (app.company_id !== userCompanyId && app.user_id !== req.user.id) {
				return res.status(403).json({ error: 'Access denied' });
			}

			const respResult = await pool.query(
				`
			SELECT sr.*, sq.job_id, sq.pass_threshold
			FROM screening_responses sr
			JOIN screening_questionnaires sq ON sq.id = sr.questionnaire_id
			WHERE sr.application_id = $1
			`,
				[application_id],
			);

			if (respResult.rows.length === 0) {
				return res.status(404).json({ error: 'No screening response found for this application' });
			}

			const response = respResult.rows[0];

			// Get evaluations
			const evalResult = await pool.query(
				`
			SELECT sqe.*, sq.question_text, sq.question_type
			FROM screening_question_evaluations sqe
			JOIN screening_questions sq ON sq.id = sqe.question_id
			WHERE sqe.response_id = $1
			`,
				[response.id],
			);

			// Get override info
			const overrideResult = await pool.query(
				`
			SELECT so.*, u.name as recruiter_name
			FROM screening_overrides so
			JOIN users u ON u.id = so.recruiter_id
			WHERE so.response_id = $1
			ORDER BY so.created_at DESC
			LIMIT 1
			`,
				[response.id],
			);

			res.json({
				success: true,
				response: {
					id: response.id,
					application_id: response.application_id,
					candidate_id: response.candidate_id,
					questionnaire_id: response.questionnaire_id,
					answers: response.answers,
					status: response.status,
					started_at: response.started_at,
					completed_at: response.completed_at,
					overall_score: response.overall_score,
					ai_explanation: response.ai_explanation,
					knockout_triggered: response.knockout_triggered,
					knockout_reason: response.knockout_reason,
				},
				evaluations: evalResult.rows,
				override: overrideResult.rows[0] || null,
			});
		} catch (err) {
			const ref = require('node:crypto').randomUUID();
			console.error(`[ERROR ref=${ref}] [questionnaire/response-by-application] Error:`, err);
			res.status(500).json({ error: 'Failed to get screening response', ref });
		}
	},
);

module.exports = router;
