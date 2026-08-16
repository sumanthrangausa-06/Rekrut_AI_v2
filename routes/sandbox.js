// =============================================================================
// routes/sandbox.js — Code Sandbox API (Issue #117)
// =============================================================================
// Self-hosted Judge0 integration for Rekrut AI's technical assessment platform.
// Candidates write code in the browser; we execute it safely in isolated Docker
// containers via Judge0.
//
// Endpoints:
//   GET    /api/sandbox/languages          — List supported languages
//   POST   /api/sandbox/submit             — Submit code for execution
//   GET    /api/sandbox/result/:token      — Get execution result by token
//   POST   /api/sandbox/validate           — Validate code against test cases
//   POST   /api/sandbox/batch-validate     — Batch validate multiple test cases
//   GET    /api/sandbox/submissions        — List user's submissions (candidate)
//   GET    /api/sandbox/submissions/:id    — Get single submission detail
//
// Security:
//   - Rate limiting on all submission endpoints
//   - Source code size limit (64KB)
//   - Resource limits (time, memory, output) enforced at API and Judge0 levels
//   - Input sanitization via DOMPurify
//   - No network access in sandbox containers (Judge0 DISABLE_NETWORK=true)
//   - Auth required for all endpoints except GET /languages
// =============================================================================

const express = require('express');
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const { rateLimits, createRateLimit } = require('../lib/distributed-rate-limiter');
const { AuditLogger } = require('../services/auditLogger');

const router = express.Router();

// =============================================================================
// Configuration
// =============================================================================

const JUDGE0_API_URL = process.env.JUDGE0_API_URL || 'http://localhost:2358';
const JUDGE0_AUTH_TOKEN = process.env.JUDGE0_AUTH_TOKEN || null;

// Hard limits — enforced before sending to Judge0
const MAX_SOURCE_CODE_SIZE = 64 * 1024;        // 64 KB
const MAX_STDIN_SIZE = 8 * 1024;               // 8 KB
const MAX_CPU_TIME_SECONDS = 15;               // 15 seconds
const MAX_MEMORY_KB = 512 * 1024;              // 512 MB
const MAX_OUTPUT_SIZE = 16 * 1024;             // 16 KB

// Rate limits specific to sandbox
const sandboxRateLimits = {
	// Submit: very strict — candidates should think before submitting
	submit: createRateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'sandbox-submit' }),
	// Validate: strict — auto-grading can be expensive
	validate: createRateLimit({ windowMs: 60 * 1000, max: 5, keyPrefix: 'sandbox-validate' }),
	// Read results: generous
	result: createRateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'sandbox-result' }),
};

// =============================================================================
// Judge0 Status IDs
// =============================================================================

const JUDGE0_STATUS = {
	1: { id: 1,  description: 'In Queue' },
	2: { id: 2,  description: 'Processing' },
	3: { id: 3,  description: 'Accepted' },
	4: { id: 4,  description: 'Wrong Answer' },
	5: { id: 5,  description: 'Time Limit Exceeded' },
	6: { id: 6,  description: 'Compilation Error' },
	7: { id: 7,  description: 'Runtime Error (SIGSEGV)' },
	8: { id: 8,  description: 'Runtime Error (SIGXFSZ)' },
	9: { id: 9,  description: 'Runtime Error (SIGFPE)' },
	10: { id: 10, description: 'Runtime Error (SIGABRT)' },
	11: { id: 11, description: 'Runtime Error (SIGBUS)' },
	12: { id: 12, description: 'Runtime Error (SIGKILL)' },
	13: { id: 13, description: 'Runtime Error (NZEC)' },
	14: { id: 14, description: 'Runtime Error (OTHER)' },
	15: { id: 15, description: 'Internal Error' },
	16: { id: 16, description: 'Exec Format Error' },
};

// =============================================================================
// Helpers
// =============================================================================

function generateToken() {
	return crypto.randomBytes(24).toString('hex');
}

function sanitizeSourceCode(code) {
	if (typeof code !== 'string') return '';
	// Strip null bytes and control characters (except newlines and tabs)
	return code
		.replace(/\x00/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function validateResourceLimits(limits) {
	const cpu = Math.min(Math.max(parseInt(limits.cpuTimeSeconds, 10) || 5, 1), MAX_CPU_TIME_SECONDS);
	const mem = Math.min(Math.max(parseInt(limits.memoryKb, 10) || 128000, 32000), MAX_MEMORY_KB);
	const out = Math.min(Math.max(parseInt(limits.maxOutputSize, 10) || 4096, 1024), MAX_OUTPUT_SIZE);
	return { cpuTimeSeconds: cpu, memoryKb: mem, maxOutputSize: out };
}

async function callJudge0(endpoint, body) {
	const url = `${JUDGE0_API_URL}${endpoint}`;
	const headers = {
		'Content-Type': 'application/json',
		Accept: 'application/json',
	};
	if (JUDGE0_AUTH_TOKEN) {
		headers['X-Auth-Token'] = JUDGE0_AUTH_TOKEN;
	}
	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
		timeout: 30000,
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Judge0 error (${response.status}): ${text}`);
	}
	return response.json();
}

async function getJudge0Result(token) {
	const url = `${JUDGE0_API_URL}/submissions/${token}?base64_encoded=false&fields=*`;
	const headers = {};
	if (JUDGE0_AUTH_TOKEN) {
		headers['X-Auth-Token'] = JUDGE0_AUTH_TOKEN;
	}
	const response = await fetch(url, { headers, timeout: 10000 });
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Judge0 error (${response.status}): ${text}`);
	}
	return response.json();
}

function _getClientIp(req) {
	const forwarded = req.headers['x-forwarded-for'];
	if (typeof forwarded === 'string' && forwarded.length > 0) {
		return forwarded.split(',')[0].trim();
	}
	return req.ip || req.socket?.remoteAddress || null;
}

function normalizeStdout(stdout) {
	if (!stdout) return '';
	// Normalize line endings and trailing whitespace for comparison
	return stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

// =============================================================================
// Middleware
// =============================================================================

// Attach user context for all sandbox routes
function sandboxContext(req, res, next) {
	req.sandboxContext = {
		userId: req.user?.id || null,
		userRole: req.user?.role || 'anonymous',
		ip: _getClientIp(req),
		userAgent: req.headers['user-agent'] || null,
	};
	next();
}

// =============================================================================
// Routes
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sandbox/languages
// List supported programming languages
// ─────────────────────────────────────────────────────────────────────────────
router.get('/languages', async (_req, res) => {
	try {
		const result = await pool.query(
			`SELECT id, name, slug, version, file_extension,
              default_cpu_time_seconds, default_memory_kb,
              is_active, display_order
       FROM sandbox_languages
       WHERE is_active = true
       ORDER BY display_order ASC, name ASC`
		);
		res.json({ languages: result.rows });
	} catch (error) {
		console.error('[sandbox] Error fetching languages:', error);
		res.status(500).json({ error: 'Failed to fetch languages' });
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sandbox/submit
// Submit code for execution in the sandbox
// ─────────────────────────────────────────────────────────────────────────────
router.post(
	'/submit',
	authMiddleware,
	sandboxContext,
	sandboxRateLimits.submit,
	async (req, res) => {
		const ctx = req.sandboxContext;

		try {
			const {
				languageSlug,
				sourceCode,
				stdin = '',
				cpuTimeSeconds,
				memoryKb,
				maxOutputSize,
				assessmentId,
				assessmentAttemptId,
				jobId,
			} = req.body;

			// ── Validation ────────────────────────────────────────────────────
			if (!languageSlug || typeof languageSlug !== 'string') {
				return res.status(400).json({ error: 'languageSlug is required' });
			}
			if (!sourceCode || typeof sourceCode !== 'string') {
				return res.status(400).json({ error: 'sourceCode is required' });
			}
			if (Buffer.byteLength(sourceCode, 'utf8') > MAX_SOURCE_CODE_SIZE) {
				return res.status(400).json({
					error: `Source code exceeds maximum size of ${MAX_SOURCE_CODE_SIZE / 1024}KB`,
					code: 'SOURCE_TOO_LARGE',
				});
			}
			if (Buffer.byteLength(stdin || '', 'utf8') > MAX_STDIN_SIZE) {
				return res.status(400).json({
					error: `stdin exceeds maximum size of ${MAX_STDIN_SIZE / 1024}KB`,
					code: 'STDIN_TOO_LARGE',
				});
			}

			// Look up language
			const langResult = await pool.query(
				`SELECT id, judge0_id, default_cpu_time_seconds, default_memory_kb, default_max_output_size
         FROM sandbox_languages
         WHERE slug = $1 AND is_active = true`,
				[languageSlug]
			);
			if (langResult.rows.length === 0) {
				return res.status(400).json({ error: 'Unsupported language', code: 'UNSUPPORTED_LANGUAGE' });
			}
			const language = langResult.rows[0];

			// Apply resource limits
			const limits = validateResourceLimits({
				cpuTimeSeconds: cpuTimeSeconds || language.default_cpu_time_seconds,
				memoryKb: memoryKb || language.default_memory_kb,
				maxOutputSize: maxOutputSize || language.default_max_output_size,
			});

			// Sanitize source code
			const sanitizedCode = sanitizeSourceCode(sourceCode);
			const sanitizedStdin = sanitizeSourceCode(stdin);

			// Generate local token
			const token = generateToken();

			// ── Insert into DB (queued state) ────────────────────────────────
			await pool.query(
				`INSERT INTO sandbox_submissions
         (token, user_id, user_role, assessment_id, assessment_attempt_id, job_id,
          language_id, source_code, stdin,
          cpu_time_seconds, memory_kb, max_output_size,
          status_id, status_description, ip_address, user_agent, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
				[
					token,
					ctx.userId,
					ctx.userRole,
					assessmentId || null,
					assessmentAttemptId || null,
					jobId || null,
					language.id,
					sanitizedCode,
					sanitizedStdin || null,
					limits.cpuTimeSeconds,
					limits.memoryKb,
					limits.maxOutputSize,
					1, // In Queue
					'In Queue',
					ctx.ip,
					ctx.userAgent,
				]
			);

			// ── Submit to Judge0 (fire-and-forget style) ─────────────────────
			const judge0Payload = {
				source_code: sanitizedCode,
				language_id: language.judge0_id,
				stdin: sanitizedStdin || '',
				cpu_time_limit: limits.cpuTimeSeconds,
				memory_limit: limits.memoryKb,
				max_output_size: limits.maxOutputSize,
				enable_network: false,
			};

			let judge0Token = null;
			try {
				const judge0Result = await callJudge0('/submissions?base64_encoded=false&wait=false', judge0Payload);
				judge0Token = judge0Result.token;

				// Update DB with Judge0 token mapping
				await pool.query(
					`UPDATE sandbox_submissions
             SET started_at = NOW(),
                 status_id = $1,
                 status_description = $2
             WHERE token = $3`,
					[1, 'In Queue', token]
				);
			} catch (judgeErr) {
				console.error('[sandbox] Judge0 submission error:', judgeErr.message);
				await pool.query(
					`UPDATE sandbox_submissions
             SET status_id = $1,
                 status_description = $2,
                 stderr = $3,
                 completed_at = NOW()
             WHERE token = $4`,
					[15, 'Internal Error', `Sandbox engine error: ${judgeErr.message}`, token]
				);
				return res.status(503).json({
					token,
					error: 'Sandbox engine temporarily unavailable',
					code: 'SANDBOX_UNAVAILABLE',
				});
			}

			// Audit log
			await AuditLogger.log({
				actionType: 'sandbox_submitted',
				userId: ctx.userId,
				targetType: 'sandbox_submission',
				targetId: token,
				metadata: {
					language: languageSlug,
					assessment_id: assessmentId,
					cpu_time: limits.cpuTimeSeconds,
					memory: limits.memoryKb,
				},
				req,
			});

			res.status(202).json({
				token,
				status: 'queued',
				message: 'Submission queued for execution',
			});
		} catch (error) {
			console.error('[sandbox] Submit error:', error);
			res.status(500).json({ error: 'Failed to submit code' });
		}
	}
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sandbox/result/:token
// Get execution result by token. Polls Judge0 if still processing.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	'/result/:token',
	authMiddleware,
	sandboxContext,
	sandboxRateLimits.result,
	async (req, res) => {
		const ctx = req.sandboxContext;
		const { token } = req.params;

		try {
			// Fetch from our DB
			const subResult = await pool.query(
				`SELECT s.*, l.slug as language_slug, l.name as language_name, l.judge0_id
         FROM sandbox_submissions s
         JOIN sandbox_languages l ON s.language_id = l.id
         WHERE s.token = $1`,
				[token]
			);
			if (subResult.rows.length === 0) {
				return res.status(404).json({ error: 'Submission not found' });
			}
			const submission = subResult.rows[0];

			// Ownership check — candidates can only view their own submissions
			// Recruiters/admins can view any submission for their assessments
			if (ctx.userRole === 'candidate' && submission.user_id !== ctx.userId) {
				return res.status(403).json({ error: 'Access denied' });
			}

			// If already completed in our DB, return cached result
			if (submission.completed_at) {
				return res.json(formatSubmissionResponse(submission));
			}

			// Still processing — poll Judge0 for latest status
			try {
				const judge0Result = await getJudge0Result(token);

				// Update DB with latest status
				const status = JUDGE0_STATUS[judge0Result.status?.id] || {
					id: judge0Result.status?.id,
					description: judge0Result.status?.description || 'Unknown',
				};

				const isCompleted = judge0Result.status?.id > 2; // Not In Queue or Processing

				await pool.query(
					`UPDATE sandbox_submissions
           SET status_id = $1,
               status_description = $2,
               stdout = $3,
               stderr = $4,
               compile_output = $5,
               exit_code = $6,
               wall_time_seconds = $7,
               memory_used_kb = $8,
               output_size = $9,
               completed_at = CASE WHEN $10 THEN NOW() ELSE completed_at END,
               updated_at = NOW()
           WHERE token = $11`,
					[
						status.id,
						status.description,
						judge0Result.stdout || null,
						judge0Result.stderr || null,
						judge0Result.compile_output || null,
						judge0Result.exit_code ?? null,
						judge0Result.time || null,
						judge0Result.memory || null,
						judge0Result.stdout ? Buffer.byteLength(judge0Result.stdout, 'utf8') : null,
						isCompleted,
						token,
					]
				);

				// Re-fetch updated row
				const updatedResult = await pool.query(
					`SELECT s.*, l.slug as language_slug, l.name as language_name
           FROM sandbox_submissions s
           JOIN sandbox_languages l ON s.language_id = l.id
           WHERE s.token = $1`,
					[token]
				);

				return res.json(formatSubmissionResponse(updatedResult.rows[0]));
			} catch (pollErr) {
				console.error('[sandbox] Poll error:', pollErr.message);
				// Return what we have without failing
				return res.json(formatSubmissionResponse(submission));
			}
		} catch (error) {
			console.error('[sandbox] Result error:', error);
			res.status(500).json({ error: 'Failed to fetch result' });
		}
	}
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sandbox/validate
// Validate candidate code against test cases for auto-grading
// ─────────────────────────────────────────────────────────────────────────────
router.post(
	'/validate',
	authMiddleware,
	sandboxContext,
	sandboxRateLimits.validate,
	async (req, res) => {
		const ctx = req.sandboxContext;

		try {
			const {
				languageSlug,
				sourceCode,
				assessmentId,
				assessmentAttemptId,
				jobId,
				cpuTimeSeconds,
				memoryKb,
			} = req.body;

			// ── Validation ────────────────────────────────────────────────────
			if (!languageSlug) {
				return res.status(400).json({ error: 'languageSlug is required' });
			}
			if (!sourceCode) {
				return res.status(400).json({ error: 'sourceCode is required' });
			}
			if (Buffer.byteLength(sourceCode, 'utf8') > MAX_SOURCE_CODE_SIZE) {
				return res.status(400).json({ error: 'Source code too large', code: 'SOURCE_TOO_LARGE' });
			}

			// Look up language
			const langResult = await pool.query(
				`SELECT id, judge0_id, default_cpu_time_seconds, default_memory_kb
         FROM sandbox_languages
         WHERE slug = $1 AND is_active = true`,
				[languageSlug]
			);
			if (langResult.rows.length === 0) {
				return res.status(400).json({ error: 'Unsupported language', code: 'UNSUPPORTED_LANGUAGE' });
			}
			const language = langResult.rows[0];

			const limits = validateResourceLimits({
				cpuTimeSeconds: cpuTimeSeconds || language.default_cpu_time_seconds,
				memoryKb: memoryKb || language.default_memory_kb,
			});

			const sanitizedCode = sanitizeSourceCode(sourceCode);

			// ── Fetch test cases ──────────────────────────────────────────────
			const tcQuery = assessmentId
				? `SELECT * FROM sandbox_test_cases WHERE assessment_id = $1 ORDER BY order_index ASC`
				: `SELECT * FROM sandbox_test_cases WHERE job_id = $1 ORDER BY order_index ASC`;
			const tcParam = assessmentId || jobId;

			if (!tcParam) {
				return res.status(400).json({ error: 'assessmentId or jobId is required for validation' });
			}

			const tcResult = await pool.query(tcQuery, [tcParam]);
			const testCases = tcResult.rows;

			if (testCases.length === 0) {
				return res.status(404).json({ error: 'No test cases found for this assessment' });
			}

			// ── Run code against each test case ──────────────────────────────
			const results = [];
			let passedCount = 0;
			let failedCount = 0;
			let totalPoints = 0;
			let earnedPoints = 0;

			for (const tc of testCases) {
				const judge0Payload = {
					source_code: sanitizedCode,
					language_id: language.judge0_id,
					stdin: tc.stdin || '',
					cpu_time_limit: limits.cpuTimeSeconds,
					memory_limit: limits.memoryKb,
					max_output_size: MAX_OUTPUT_SIZE,
					enable_network: false,
				};

				let tcResult = {
					testCaseId: tc.id,
					name: tc.name,
					passed: false,
					points: tc.points || 0,
					actualOutput: null,
					expectedOutput: tc.is_hidden ? null : tc.expected_stdout,
					isHidden: tc.is_hidden,
					error: null,
					executionTime: null,
					memoryUsed: null,
				};

				try {
					const judge0Response = await callJudge0(
						'/submissions?base64_encoded=false&wait=true',
						judge0Payload
					);

					const statusId = judge0Response.status?.id;
					const stdout = normalizeStdout(judge0Response.stdout);
					const expected = normalizeStdout(tc.expected_stdout);

					tcResult.actualOutput = tc.is_hidden ? null : stdout;
					tcResult.executionTime = judge0Response.time;
					tcResult.memoryUsed = judge0Response.memory;

					if (statusId === 3) {
						// Accepted — check output matches
						if (stdout === expected) {
							tcResult.passed = true;
							passedCount++;
							earnedPoints += tc.points || 0;
						} else {
							tcResult.passed = false;
							failedCount++;
							tcResult.error = 'Output mismatch';
						}
					} else if (statusId === 5) {
						tcResult.error = 'Time Limit Exceeded';
						failedCount++;
					} else if (statusId === 6) {
						tcResult.error = `Compilation Error: ${judge0Response.compile_output || ''}`;
						failedCount++;
					} else if (statusId >= 7 && statusId <= 14) {
						tcResult.error = `Runtime Error (${judge0Response.status?.description || 'Unknown'})`;
						failedCount++;
					} else {
						tcResult.error = judge0Response.status?.description || 'Execution failed';
						failedCount++;
					}
				} catch (execErr) {
					console.error('[sandbox] Test case execution error:', execErr.message);
					tcResult.error = `Execution engine error: ${execErr.message}`;
					failedCount++;
				}

				totalPoints += tc.points || 0;
				results.push(tcResult);

				// Short-circuit on compilation error — no point running more test cases
				if (tcResult.error && tcResult.error.startsWith('Compilation Error')) {
					break;
				}
			}

			// ── Calculate score ──────────────────────────────────────────────
			const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100 * 100) / 100 : 0;
			const passed = score >= 60; // Default passing threshold

			// ── Store aggregated result ──────────────────────────────────────
			const token = generateToken();
			await pool.query(
				`INSERT INTO sandbox_submissions
         (token, user_id, user_role, assessment_id, assessment_attempt_id, job_id,
          language_id, source_code,
          cpu_time_seconds, memory_kb, max_output_size,
          status_id, status_description,
          test_cases_total, test_cases_passed, test_cases_failed,
          score, passed, grader_feedback,
          ip_address, user_agent, submitted_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW())`,
				[
					token,
					ctx.userId,
					ctx.userRole,
					assessmentId || null,
					assessmentAttemptId || null,
					jobId || null,
					language.id,
					sanitizedCode,
					limits.cpuTimeSeconds,
					limits.memoryKb,
					MAX_OUTPUT_SIZE,
					passed ? 3 : 4, // Accepted or Wrong Answer
					passed ? 'Accepted' : 'Wrong Answer',
					testCases.length,
					passedCount,
					failedCount,
					score,
					passed,
					JSON.stringify({ results, totalPoints, earnedPoints }),
					ctx.ip,
					ctx.userAgent,
				]
			);

			// Audit log
			await AuditLogger.log({
				actionType: 'sandbox_validated',
				userId: ctx.userId,
				targetType: 'sandbox_submission',
				targetId: token,
				metadata: {
					assessment_id: assessmentId,
					job_id: jobId,
					passed,
					score,
					test_cases: testCases.length,
				},
				req,
			});

			res.json({
				token,
				passed,
				score,
				totalPoints,
				earnedPoints,
				testCasesTotal: testCases.length,
				testCasesPassed: passedCount,
				testCasesFailed: failedCount,
				results,
			});
		} catch (error) {
			console.error('[sandbox] Validate error:', error);
			res.status(500).json({ error: 'Failed to validate code' });
		}
	}
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sandbox/submissions
// List current user's submissions (candidates) or all (recruiters/admins)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	'/submissions',
	authMiddleware,
	sandboxContext,
	rateLimits.standard,
	async (req, res) => {
		const ctx = req.sandboxContext;
		const { assessmentId, jobId, limit = 50, offset = 0 } = req.query;

		try {
			let whereClause = '';
			const params = [];
			let paramIdx = 1;

			// Candidates only see their own submissions
			if (ctx.userRole === 'candidate') {
				whereClause += ` AND s.user_id = $${paramIdx++}`;
				params.push(ctx.userId);
			}

			if (assessmentId) {
				whereClause += ` AND s.assessment_id = $${paramIdx++}`;
				params.push(parseInt(assessmentId, 10));
			}

			if (jobId) {
				whereClause += ` AND s.job_id = $${paramIdx++}`;
				params.push(parseInt(jobId, 10));
			}

			params.push(parseInt(limit, 10));
			params.push(parseInt(offset, 10));

			const result = await pool.query(
				`SELECT s.id, s.token, s.status_id, s.status_description,
              s.score, s.passed, s.test_cases_total, s.test_cases_passed,
              s.submitted_at, s.completed_at,
              l.name as language_name, l.slug as language_slug
       FROM sandbox_submissions s
       JOIN sandbox_languages l ON s.language_id = l.id
       WHERE 1=1 ${whereClause}
       ORDER BY s.submitted_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
				params
			);

			res.json({
				submissions: result.rows,
				limit: parseInt(limit, 10),
				offset: parseInt(offset, 10),
			});
		} catch (error) {
			console.error('[sandbox] List submissions error:', error);
			res.status(500).json({ error: 'Failed to list submissions' });
		}
	}
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sandbox/submissions/:token
// Get single submission detail (with source code — owner only)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	'/submissions/:token',
	authMiddleware,
	sandboxContext,
	rateLimits.standard,
	async (req, res) => {
		const ctx = req.sandboxContext;
		const { token } = req.params;

		try {
			const result = await pool.query(
				`SELECT s.*, l.name as language_name, l.slug as language_slug
         FROM sandbox_submissions s
         JOIN sandbox_languages l ON s.language_id = l.id
         WHERE s.token = $1`,
				[token]
			);

			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Submission not found' });
			}

			const submission = result.rows[0];

			// Candidates can only view their own
			if (ctx.userRole === 'candidate' && submission.user_id !== ctx.userId) {
				return res.status(403).json({ error: 'Access denied' });
			}

			res.json(formatSubmissionResponse(submission));
		} catch (error) {
			console.error('[sandbox] Get submission error:', error);
			res.status(500).json({ error: 'Failed to get submission' });
		}
	}
);

// =============================================================================
// Recruiter / Admin Routes — Test Case Management
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sandbox/test-cases
// Create a test case (recruiter/admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
	'/test-cases',
	authMiddleware,
	sandboxContext,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.standard,
	async (req, res) => {
		const ctx = req.sandboxContext;

		try {
			const {
				assessmentId,
				jobId,
				name,
				description,
				stdin,
				expectedStdout,
				expectedExitCode,
				isHidden,
				points,
				orderIndex,
			} = req.body;

			if (!assessmentId && !jobId) {
				return res.status(400).json({ error: 'assessmentId or jobId is required' });
			}
			if (!name) {
				return res.status(400).json({ error: 'name is required' });
			}

			const result = await pool.query(
				`INSERT INTO sandbox_test_cases
         (assessment_id, job_id, name, description, stdin, expected_stdout,
          expected_exit_code, is_hidden, points, order_index, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
				[
					assessmentId || null,
					jobId || null,
					name,
					description || null,
					stdin || null,
					expectedStdout || null,
					expectedExitCode !== undefined ? expectedExitCode : 0,
					isHidden !== undefined ? isHidden : false,
					points || 10,
					orderIndex || 0,
					ctx.userId,
				]
			);

			await AuditLogger.log({
				actionType: 'sandbox_test_case_created',
				userId: ctx.userId,
				targetType: 'sandbox_test_case',
				targetId: result.rows[0].id,
				metadata: { assessment_id: assessmentId, job_id: jobId, name },
				req,
			});

			res.status(201).json({ testCase: result.rows[0] });
		} catch (error) {
			console.error('[sandbox] Create test case error:', error);
			res.status(500).json({ error: 'Failed to create test case' });
		}
	}
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sandbox/test-cases
// List test cases for an assessment or job
// ─────────────────────────────────────────────────────────────────────────────
router.get(
	'/test-cases',
	authMiddleware,
	rateLimits.standard,
	async (req, res) => {
		const { assessmentId, jobId } = req.query;

		try {
			if (!assessmentId && !jobId) {
				return res.status(400).json({ error: 'assessmentId or jobId is required' });
			}

			const where = assessmentId
				? 'WHERE assessment_id = $1'
				: 'WHERE job_id = $1';
			const param = assessmentId || jobId;

			const result = await pool.query(
				`SELECT id, assessment_id, job_id, name, description,
              stdin, expected_stdout, expected_exit_code,
              is_hidden, points, order_index, created_at
       FROM sandbox_test_cases
       ${where}
       ORDER BY order_index ASC, created_at ASC`,
				[param]
			);

			res.json({ testCases: result.rows });
		} catch (error) {
			console.error('[sandbox] List test cases error:', error);
			res.status(500).json({ error: 'Failed to list test cases' });
		}
	}
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sandbox/test-cases/:id
// Update a test case
// ─────────────────────────────────────────────────────────────────────────────
router.put(
	'/test-cases/:id',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const { id } = req.params;
			const {
				name,
				description,
				stdin,
				expectedStdout,
				expectedExitCode,
				isHidden,
				points,
				orderIndex,
			} = req.body;

			const result = await pool.query(
				`UPDATE sandbox_test_cases
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             stdin = COALESCE($3, stdin),
             expected_stdout = COALESCE($4, expected_stdout),
             expected_exit_code = COALESCE($5, expected_exit_code),
             is_hidden = COALESCE($6, is_hidden),
             points = COALESCE($7, points),
             order_index = COALESCE($8, order_index),
             updated_at = NOW()
         WHERE id = $9
         RETURNING *`,
				[
					name || null,
					description || null,
					stdin !== undefined ? stdin : null,
					expectedStdout !== undefined ? expectedStdout : null,
					expectedExitCode !== undefined ? expectedExitCode : null,
					isHidden !== undefined ? isHidden : null,
					points !== undefined ? points : null,
					orderIndex !== undefined ? orderIndex : null,
					id,
				]
			);

			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Test case not found' });
			}

			res.json({ testCase: result.rows[0] });
		} catch (error) {
			console.error('[sandbox] Update test case error:', error);
			res.status(500).json({ error: 'Failed to update test case' });
		}
	}
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/sandbox/test-cases/:id
// Delete a test case
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
	'/test-cases/:id',
	authMiddleware,
	requireRole('recruiter', 'hiring_manager', 'employer', 'admin'),
	rateLimits.standard,
	async (req, res) => {
		try {
			const { id } = req.params;
			const result = await pool.query(
				'DELETE FROM sandbox_test_cases WHERE id = $1 RETURNING *',
				[id]
			);

			if (result.rows.length === 0) {
				return res.status(404).json({ error: 'Test case not found' });
			}

			res.json({ deleted: true, testCase: result.rows[0] });
		} catch (error) {
			console.error('[sandbox] Delete test case error:', error);
			res.status(500).json({ error: 'Failed to delete test case' });
		}
	}
);

// =============================================================================
// Helpers — Response Formatting
// =============================================================================

function formatSubmissionResponse(submission) {
	const base = {
		token: submission.token,
		status: {
			id: submission.status_id,
			description: submission.status_description,
		},
		language: {
			slug: submission.language_slug,
			name: submission.language_name,
		},
		submittedAt: submission.submitted_at,
		completedAt: submission.completed_at,
	};

	// Include execution output only if completed
	if (submission.completed_at) {
		base.stdout = submission.stdout || null;
		base.stderr = submission.stderr || null;
		base.compileOutput = submission.compile_output || null;
		base.exitCode = submission.exit_code;
		base.executionTime = submission.wall_time_seconds;
		base.memoryUsed = submission.memory_used_kb;
		base.outputSize = submission.output_size;
	}

	// Include grading results if available
	if (submission.score !== null) {
		base.grading = {
			score: submission.score,
			passed: submission.passed,
			testCasesTotal: submission.test_cases_total,
			testCasesPassed: submission.test_cases_passed,
			testCasesFailed: submission.test_cases_failed,
			feedback: submission.grader_feedback,
		};
	}

	return base;
}

module.exports = router;
