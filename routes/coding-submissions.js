// =============================================================================
// routes/coding-submissions.js — Coding Submission API (Issue #119)
// =============================================================================
//
// Endpoints:
//   POST /api/coding-submissions                        — Start a submission (candidate only)
//   PUT  /api/coding-submissions/:id                    — Save draft code
//   POST /api/coding-submissions/:id/submit             — Submit for grading
//   POST /api/coding-submissions/:id/run                — Run against sample test cases
//   GET  /api/coding-submissions/:id                    — Get submission with score breakdown
//   GET  /api/coding-submissions/candidate/:candidateId — List candidate's submissions
//
// Security:
//   - authMiddleware on all routes
//   - role checks (recruiter vs candidate)
//   - Rate limiting on run/submit endpoints
//   - Hidden test cases never exposed to candidates
//
// =============================================================================

const express = require('express');
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { createRateLimit, rateLimits } = require('../lib/distributed-rate-limiter');
const { AuditLogger } = require('../services/auditLogService');
const codingGrader = require('../services/codingGrader');

const router = express.Router();

const RECRUITER_ROLES = ['recruiter', 'hiring_manager', 'employer', 'admin'];

function isRecruiter(user) {
	return RECRUITER_ROLES.includes(user?.role);
}

// Rate limits for run/submit (expensive operations)
const runRateLimit = createRateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'coding-run' });
const submitRateLimit = createRateLimit({
	windowMs: 60 * 1000,
	max: 5,
	keyPrefix: 'coding-submit',
});

// =============================================================================
// POST /api/coding-submissions
// Start a new submission (candidate only)
// =============================================================================
router.post('/', authMiddleware, async (req, res) => {
	const client = await pool.connect();
	try {
		const { template_id, job_application_id, language } = req.body;
		const candidateId = req.user.id;

		if (req.user.role !== 'candidate') {
			return res.status(403).json({ error: 'Only candidates can start coding submissions' });
		}
		if (!template_id) {
			return res.status(400).json({ error: 'template_id is required' });
		}
		if (!language) {
			return res.status(400).json({ error: 'language is required' });
		}

		// Verify template exists and is active
		const templateResult = await client.query(
			`SELECT id, starter_code, language_support FROM coding_templates
       WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
			[template_id],
		);
		if (templateResult.rows.length === 0) {
			return res.status(404).json({ error: 'Template not found or inactive' });
		}
		const template = templateResult.rows[0];

		// Verify language is supported
		const supported =
			typeof template.language_support === 'string'
				? JSON.parse(template.language_support)
				: template.language_support || [];
		if (!supported.includes(language)) {
			return res.status(400).json({
				error: `Language '${language}' not supported for this template`,
				supported_languages: supported,
			});
		}

		// Check if there's an existing draft for this candidate + template + application
		const existingResult = await client.query(
			`SELECT id FROM coding_submissions
       WHERE candidate_id = $1 AND template_id = $2
         AND job_application_id IS NOT DISTINCT FROM $3
         AND status = 'draft'
       ORDER BY created_at DESC LIMIT 1`,
			[candidateId, template_id, job_application_id || null],
		);
		if (existingResult.rows.length > 0) {
			return res.json({
				submissionId: existingResult.rows[0].id,
				message: 'Resuming existing draft',
				isNew: false,
			});
		}

		// Get starter code if available
		const starterCode =
			typeof template.starter_code === 'string' && template.starter_code
				? JSON.parse(template.starter_code)
				: template.starter_code || {};
		const initialCode = starterCode[language] || '';

		// Create new submission
		const insertResult = await client.query(
			`INSERT INTO coding_submissions
         (candidate_id, template_id, job_application_id, code_text, language, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
       RETURNING *`,
			[candidateId, template_id, job_application_id || null, initialCode, language],
		);

		const submission = insertResult.rows[0];

		res.status(201).json({
			submissionId: submission.id,
			templateId: template_id,
			language,
			codeText: submission.code_text,
			status: submission.status,
			isNew: true,
		});
	} catch (error) {
		console.error('[coding-submissions] Start error:', error);
		res.status(500).json({ error: 'Failed to start submission' });
	} finally {
		client.release();
	}
});

// =============================================================================
// PUT /api/coding-submissions/:id
// Save draft code
// =============================================================================
router.put('/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const { code_text } = req.body;
		const userId = req.user.id;

		// Verify ownership
		const subResult = await pool.query(`SELECT * FROM coding_submissions WHERE id = $1`, [id]);
		if (subResult.rows.length === 0) {
			return res.status(404).json({ error: 'Submission not found' });
		}
		const submission = subResult.rows[0];

		// Candidates can only save their own drafts
		if (submission.candidate_id !== userId && !isRecruiter(req.user)) {
			return res.status(403).json({ error: 'Access denied' });
		}
		if (submission.status !== 'draft') {
			return res.status(400).json({ error: 'Cannot edit a submitted or graded submission' });
		}

		await pool.query(
			`UPDATE coding_submissions
       SET code_text = $1,
           updated_at = NOW()
       WHERE id = $2`,
			[code_text || '', id],
		);

		res.json({ saved: true, submissionId: id });
	} catch (error) {
		console.error('[coding-submissions] Save draft error:', error);
		res.status(500).json({ error: 'Failed to save draft' });
	}
});

// =============================================================================
// POST /api/coding-submissions/:id/submit
// Submit for grading
// =============================================================================
router.post('/:id/submit', authMiddleware, submitRateLimit, async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user.id;

		// Verify ownership
		const subResult = await pool.query(
			`SELECT s.*, t.title, t.role_type, t.difficulty
       FROM coding_submissions s
       JOIN coding_templates t ON s.template_id = t.id
       WHERE s.id = $1`,
			[id],
		);
		if (subResult.rows.length === 0) {
			return res.status(404).json({ error: 'Submission not found' });
		}
		const submission = subResult.rows[0];

		if (submission.candidate_id !== userId && !isRecruiter(req.user)) {
			return res.status(403).json({ error: 'Access denied' });
		}
		if (submission.status === 'submitted' || submission.status === 'graded') {
			return res.status(400).json({ error: 'Submission already finalized' });
		}

		// Mark as submitted
		await pool.query(
			`UPDATE coding_submissions SET status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
			[id],
		);

		// Run plagiarism detection (non-blocking to response)
		const plagiarismPromise = codingGrader.detectPlagiarism(
			id,
			submission.candidate_id,
			submission.template_id,
			submission.code_text || '',
		);

		// Run grading (synchronous — waits for all test cases)
		const gradingResult = await codingGrader.gradeSubmission(id);

		// Wait for plagiarism check
		let plagiarism = { flagged: false, similarity: 0 };
		try {
			plagiarism = await plagiarismPromise;
		} catch (_e) {
			console.warn('[coding-submissions] Plagiarism check failed:', _e.message);
		}

		// Generate AI review (non-blocking, fire-and-forget)
		codingGrader
			.generateAIReview(
				submission.code_text || '',
				submission.language,
				submission.role_type,
				submission.difficulty,
			)
			.then((review) => codingGrader.saveAIReview(id, review))
			.catch((err) => console.warn('[coding-submissions] AI review failed:', err.message));

		await AuditLogger.log({
			actionType: 'coding_submission_submitted',
			userId: submission.candidate_id,
			targetType: 'coding_submission',
			targetId: id,
			metadata: {
				template_id: submission.template_id,
				score: gradingResult.score,
				max_score: gradingResult.maxScore,
				plagiarism_flagged: plagiarism.flagged,
			},
			req,
		});

		res.json({
			submissionId: id,
			status: 'graded',
			score: gradingResult.score,
			maxScore: gradingResult.maxScore,
			passedCount: gradingResult.passedCount,
			totalCount: gradingResult.totalCount,
			plagiarism,
			message: 'Submission graded successfully',
		});
	} catch (error) {
		console.error('[coding-submissions] Submit error:', error);
		res.status(500).json({ error: 'Failed to grade submission' });
	}
});

// =============================================================================
// POST /api/coding-submissions/:id/run
// Run code against sample test cases (uses sandbox)
// =============================================================================
router.post('/:id/run', authMiddleware, runRateLimit, async (req, res) => {
	try {
		const { id } = req.params;
		const { code_text, language } = req.body;
		const userId = req.user.id;

		// Verify ownership
		const subResult = await pool.query(`SELECT * FROM coding_submissions WHERE id = $1`, [id]);
		if (subResult.rows.length === 0) {
			return res.status(404).json({ error: 'Submission not found' });
		}
		const submission = subResult.rows[0];

		if (submission.candidate_id !== userId && !isRecruiter(req.user)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Use provided code or fallback to saved code
		const codeToRun = code_text !== undefined ? code_text : submission.code_text || '';
		const langToRun = language || submission.language;

		const runResult = await codingGrader.runSampleTests(
			submission.template_id,
			codeToRun,
			langToRun,
		);

		res.json(runResult);
	} catch (error) {
		console.error('[coding-submissions] Run error:', error);
		res.status(500).json({ error: 'Failed to run code' });
	}
});

// =============================================================================
// GET /api/coding-submissions/:id
// Get submission with score breakdown
// =============================================================================
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user.id;

		const subResult = await pool.query(
			`SELECT s.*, t.title, t.role_type, t.difficulty
       FROM coding_submissions s
       JOIN coding_templates t ON s.template_id = t.id
       WHERE s.id = $1`,
			[id],
		);
		if (subResult.rows.length === 0) {
			return res.status(404).json({ error: 'Submission not found' });
		}
		const submission = subResult.rows[0];

		// Access control
		const canViewFull = isRecruiter(req.user) || submission.candidate_id === userId;
		if (!canViewFull) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// If graded, get detailed breakdown
		let grading = null;
		if (submission.status === 'graded') {
			grading = await codingGrader.getGradingResult(id, isRecruiter(req.user));
		}

		const response = {
			submissionId: submission.id,
			candidateId: submission.candidate_id,
			templateId: submission.template_id,
			templateTitle: submission.title,
			roleType: submission.role_type,
			difficulty: submission.difficulty,
			language: submission.language,
			status: submission.status,
			score: submission.score,
			maxScore: submission.max_score,
			codeText: canViewFull ? submission.code_text : null,
			startedAt: submission.started_at,
			submittedAt: submission.submitted_at,
			gradedAt: submission.graded_at,
		};

		if (grading) {
			response.grading = {
				score: grading.score,
				maxScore: grading.maxScore,
				passedCount: grading.results.filter((r) => r.passed).length,
				totalCount: grading.results.length,
				results: grading.results,
			};
			if (grading.aiReview) {
				response.grading.aiReview = grading.aiReview;
			}
			if (isRecruiter(req.user)) {
				response.grading.plagiarism = grading.plagiarism;
			}
		}

		res.json(response);
	} catch (error) {
		console.error('[coding-submissions] Get error:', error);
		res.status(500).json({ error: 'Failed to get submission' });
	}
});

// =============================================================================
// GET /api/coding-submissions/candidate/:candidateId
// List candidate's submissions
// =============================================================================
router.get('/candidate/:candidateId', authMiddleware, async (req, res) => {
	try {
		const { candidateId } = req.params;
		const { template_id, status, limit = 50, offset = 0 } = req.query;
		const userId = req.user.id;

		// Access control: candidates can only view their own; recruiters can view any
		if (parseInt(candidateId, 10) !== userId && !isRecruiter(req.user)) {
			return res.status(403).json({ error: 'Access denied' });
		}

		const conditions = ['s.candidate_id = $1'];
		const params = [candidateId];
		let paramIdx = 2;

		if (template_id) {
			conditions.push(`s.template_id = $${paramIdx++}`);
			params.push(parseInt(template_id, 10));
		}
		if (status) {
			conditions.push(`s.status = $${paramIdx++}`);
			params.push(status);
		}

		params.push(parseInt(limit, 10));
		params.push(parseInt(offset, 10));

		const result = await pool.query(
			`SELECT s.id, s.candidate_id, s.template_id, t.title as template_title,
              t.role_type, t.difficulty, s.language, s.status, s.score, s.max_score,
              s.plagiarism_flag, s.started_at, s.submitted_at, s.graded_at
       FROM coding_submissions s
       JOIN coding_templates t ON s.template_id = t.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
			params,
		);

		const countResult = await pool.query(
			`SELECT COUNT(*) FROM coding_submissions s
       WHERE ${conditions.join(' AND ')}`,
			params.slice(0, -2),
		);

		res.json({
			submissions: result.rows,
			total: parseInt(countResult.rows[0].count, 10),
			limit: parseInt(limit, 10),
			offset: parseInt(offset, 10),
		});
	} catch (error) {
		console.error('[coding-submissions] List error:', error);
		res.status(500).json({ error: 'Failed to list submissions' });
	}
});

module.exports = router;
