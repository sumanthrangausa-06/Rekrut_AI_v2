// =============================================================================
// services/codingGrader.js — Auto-Grading Engine for Coding Submissions (Issue #119)
// =============================================================================
// Depends on: Judge0 sandbox (routes/sandbox.js / Issue #117)
//
// Responsibilities:
//   - Execute code against hidden test cases via Judge0
//   - Calculate partial credit based on test case weights
//   - AI code review using the existing AI integration
//   - Plagiarism detection via token similarity
//   - Generate detailed score breakdown with explanations
//
// =============================================================================

const pool = require('../lib/db');
const { chat } = require('../lib/polsia-ai');

// =============================================================================
// Configuration
// =============================================================================

const JUDGE0_API_URL = process.env.JUDGE0_API_URL || 'http://localhost:2358';
const JUDGE0_AUTH_TOKEN = process.env.JUDGE0_AUTH_TOKEN || null;

const MAX_SOURCE_CODE_SIZE = 64 * 1024;
const _MAX_STDIN_SIZE = 8 * 1024;
const MAX_CPU_TIME_SECONDS = 15;
const MAX_MEMORY_KB = 512 * 1024;
const MAX_OUTPUT_SIZE = 16 * 1024;

// Language slug -> Judge0 language ID mapping (from sandbox_languages)
// We look these up dynamically, but have a fallback map for speed.
const JUDGE0_FALLBACK_IDS = {
	python: 71,
	javascript: 63,
	java: 62,
	cpp: 54,
	go: 60,
	c: 50,
	typescript: 74,
	ruby: 72,
	rust: 73,
	php: 68,
	kotlin: 78,
	swift: 83,
};

// Judge0 Status IDs
const _JUDGE0_STATUS = {
	1: { id: 1, description: 'In Queue' },
	2: { id: 2, description: 'Processing' },
	3: { id: 3, description: 'Accepted' },
	4: { id: 4, description: 'Wrong Answer' },
	5: { id: 5, description: 'Time Limit Exceeded' },
	6: { id: 6, description: 'Compilation Error' },
	7: { id: 7, description: 'Runtime Error (SIGSEGV)' },
	8: { id: 8, description: 'Runtime Error (SIGXFSZ)' },
	9: { id: 9, description: 'Runtime Error (SIGFPE)' },
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

function normalizeOutput(stdout) {
	if (!stdout) return '';
	return stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

function sanitizeSourceCode(code) {
	if (typeof code !== 'string') return '';
	return code.replace(/\x00/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

async function getLanguageJudge0Id(languageSlug) {
	const result = await pool.query(
		`SELECT judge0_id FROM sandbox_languages WHERE slug = $1 AND is_active = true`,
		[languageSlug],
	);
	if (result.rows.length > 0) return result.rows[0].judge0_id;
	return JUDGE0_FALLBACK_IDS[languageSlug] || null;
}

async function callJudge0(endpoint, body) {
	const url = `${JUDGE0_API_URL}${endpoint}`;
	const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
	if (JUDGE0_AUTH_TOKEN) headers['X-Auth-Token'] = JUDGE0_AUTH_TOKEN;
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

// =============================================================================
// Core Grading
// =============================================================================

/**
 * Grade a submission by running all test cases (hidden + visible) against
 * the submitted code. Stores results in coding_scores table.
 *
 * @param {number} submissionId
 * @returns {Promise<Object>} grading result with score breakdown
 */
async function gradeSubmission(submissionId) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		// Fetch submission + template
		const subResult = await client.query(
			`SELECT s.*, t.time_limit_seconds, t.memory_limit_mb
         FROM coding_submissions s
         JOIN coding_templates t ON s.template_id = t.id
         WHERE s.id = $1`,
			[submissionId],
		);
		if (subResult.rows.length === 0) throw new Error('Submission not found');
		const submission = subResult.rows[0];

		if (submission.status === 'graded') {
			await client.query('ROLLBACK');
			return await getGradingResult(submissionId);
		}

		// Fetch all test cases
		const tcResult = await client.query(
			`SELECT * FROM coding_test_cases WHERE template_id = $1 ORDER BY order_index ASC`,
			[submission.template_id],
		);
		const testCases = tcResult.rows;
		if (testCases.length === 0) throw new Error('No test cases found for template');

		// Resolve Judge0 language ID
		const judge0LangId = await getLanguageJudge0Id(submission.language);
		if (!judge0LangId) throw new Error(`Unsupported language: ${submission.language}`);

		const sanitizedCode = sanitizeSourceCode(submission.code_text || '');
		if (Buffer.byteLength(sanitizedCode, 'utf8') > MAX_SOURCE_CODE_SIZE) {
			throw new Error('Source code exceeds maximum size');
		}

		const limits = {
			cpuTimeSeconds: Math.min(
				Math.max(parseInt(submission.time_limit_seconds, 10) || 10, 1),
				MAX_CPU_TIME_SECONDS,
			),
			memoryKb: Math.min(
				Math.max(parseInt(submission.memory_limit_mb, 10) * 1024 || 128000, 32000),
				MAX_MEMORY_KB,
			),
			maxOutputSize: MAX_OUTPUT_SIZE,
		};

		// Execute each test case
		let totalWeight = 0;
		let earnedWeight = 0;
		const results = [];

		for (const tc of testCases) {
			totalWeight += tc.weight || 10;

			const judge0Payload = {
				source_code: sanitizedCode,
				language_id: judge0LangId,
				stdin: tc.stdin || '',
				cpu_time_limit: limits.cpuTimeSeconds,
				memory_limit: limits.memoryKb,
				max_output_size: limits.maxOutputSize,
				enable_network: false,
			};

			let passed = false;
			let actualOutput = null;
			let executionTimeMs = null;
			let memoryUsedMb = null;
			let scoreEarned = 0;
			let errorMessage = null;

			try {
				const jResult = await callJudge0(
					'/submissions?base64_encoded=false&wait=true',
					judge0Payload,
				);
				const statusId = jResult.status?.id;
				actualOutput = normalizeOutput(jResult.stdout);
				executionTimeMs = jResult.time != null ? jResult.time * 1000 : null;
				memoryUsedMb = jResult.memory != null ? jResult.memory / 1024 : null;

				if (statusId === 3) {
					// Accepted — compare output
					const expected = normalizeOutput(tc.expected_output);
					if (actualOutput === expected) {
						passed = true;
						scoreEarned = tc.weight || 10;
						earnedWeight += scoreEarned;
					} else {
						errorMessage = 'Output mismatch';
					}
				} else if (statusId === 5) {
					errorMessage = 'Time Limit Exceeded';
				} else if (statusId === 6) {
					errorMessage = `Compilation Error: ${normalizeOutput(jResult.compile_output) || ''}`;
				} else if (statusId >= 7 && statusId <= 14) {
					errorMessage = `Runtime Error (${jResult.status?.description || 'Unknown'})`;
				} else {
					errorMessage = jResult.status?.description || 'Execution failed';
				}
			} catch (execErr) {
				errorMessage = `Sandbox engine error: ${execErr.message}`;
			}

			// Upsert into coding_scores
			await client.query(
				`INSERT INTO coding_scores
           (submission_id, test_case_id, passed, actual_output, execution_time_ms, memory_used_mb, score_earned, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (submission_id, test_case_id) DO UPDATE SET
           passed = EXCLUDED.passed,
           actual_output = EXCLUDED.actual_output,
           execution_time_ms = EXCLUDED.execution_time_ms,
           memory_used_mb = EXCLUDED.memory_used_mb,
           score_earned = EXCLUDED.score_earned,
           error_message = EXCLUDED.error_message`,
				[
					submissionId,
					tc.id,
					passed,
					actualOutput,
					executionTimeMs,
					memoryUsedMb,
					scoreEarned,
					errorMessage,
				],
			);

			results.push({
				testCaseId: tc.id,
				name: tc.name,
				passed,
				isHidden: tc.is_hidden,
				actualOutput: actualOutput,
				expectedOutput: tc.is_hidden ? null : tc.expected_output,
				executionTimeMs,
				memoryUsedMb,
				scoreEarned,
				maxScore: tc.weight || 10,
				errorMessage,
			});

			// Short-circuit on compilation error
			if (errorMessage?.startsWith('Compilation Error')) {
				break;
			}
		}

		const maxScore = totalWeight;
		const score = maxScore > 0 ? Math.round((earnedWeight / maxScore) * 100 * 100) / 100 : 0;

		// Update submission
		await client.query(
			`UPDATE coding_submissions
         SET status = 'graded',
             score = $1,
             max_score = $2,
             graded_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
			[score, maxScore, submissionId],
		);

		await client.query('COMMIT');

		return {
			submissionId,
			score,
			maxScore,
			passedCount: results.filter((r) => r.passed).length,
			totalCount: testCases.length,
			results,
		};
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Run code against sample (non-hidden) test cases only.
 * Does not persist scores or change submission status.
 *
 * @param {number} templateId
 * @param {string} codeText
 * @param {string} language
 * @returns {Promise<Object>} run results
 */
async function runSampleTests(templateId, codeText, language) {
	const template = await pool.query(
		'SELECT time_limit_seconds, memory_limit_mb FROM coding_templates WHERE id = $1',
		[templateId],
	);
	if (template.rows.length === 0) throw new Error('Template not found');

	const tcResult = await pool.query(
		`SELECT * FROM coding_test_cases WHERE template_id = $1 AND is_hidden = false ORDER BY order_index ASC`,
		[templateId],
	);
	const testCases = tcResult.rows;
	if (testCases.length === 0) throw new Error('No sample test cases available');

	const judge0LangId = await getLanguageJudge0Id(language);
	if (!judge0LangId) throw new Error(`Unsupported language: ${language}`);

	const sanitizedCode = sanitizeSourceCode(codeText || '');
	if (Buffer.byteLength(sanitizedCode, 'utf8') > MAX_SOURCE_CODE_SIZE) {
		throw new Error('Source code exceeds maximum size');
	}

	const limits = {
		cpuTimeSeconds: Math.min(
			Math.max(parseInt(template.rows[0].time_limit_seconds, 10) || 10, 1),
			MAX_CPU_TIME_SECONDS,
		),
		memoryKb: Math.min(
			Math.max(parseInt(template.rows[0].memory_limit_mb, 10) * 1024 || 128000, 32000),
			MAX_MEMORY_KB,
		),
		maxOutputSize: MAX_OUTPUT_SIZE,
	};

	const results = [];
	let passedCount = 0;

	for (const tc of testCases) {
		const judge0Payload = {
			source_code: sanitizedCode,
			language_id: judge0LangId,
			stdin: tc.stdin || '',
			cpu_time_limit: limits.cpuTimeSeconds,
			memory_limit: limits.memoryKb,
			max_output_size: limits.maxOutputSize,
			enable_network: false,
		};

		let passed = false;
		let actualOutput = null;
		let executionTimeMs = null;
		let memoryUsedMb = null;
		let errorMessage = null;

		try {
			const jResult = await callJudge0(
				'/submissions?base64_encoded=false&wait=true',
				judge0Payload,
			);
			const statusId = jResult.status?.id;
			actualOutput = normalizeOutput(jResult.stdout);
			executionTimeMs = jResult.time != null ? jResult.time * 1000 : null;
			memoryUsedMb = jResult.memory != null ? jResult.memory / 1024 : null;

			if (statusId === 3) {
				const expected = normalizeOutput(tc.expected_output);
				if (actualOutput === expected) {
					passed = true;
					passedCount++;
				} else {
					errorMessage = 'Output mismatch';
				}
			} else if (statusId === 5) {
				errorMessage = 'Time Limit Exceeded';
			} else if (statusId === 6) {
				errorMessage = `Compilation Error: ${normalizeOutput(jResult.compile_output) || ''}`;
			} else if (statusId >= 7 && statusId <= 14) {
				errorMessage = `Runtime Error (${jResult.status?.description || 'Unknown'})`;
			} else {
				errorMessage = jResult.status?.description || 'Execution failed';
			}
		} catch (execErr) {
			errorMessage = `Sandbox engine error: ${execErr.message}`;
		}

		results.push({
			testCaseId: tc.id,
			name: tc.name,
			description: tc.description,
			passed,
			actualOutput,
			expectedOutput: tc.expected_output,
			executionTimeMs,
			memoryUsedMb,
			errorMessage,
		});

		if (errorMessage?.startsWith('Compilation Error')) {
			break;
		}
	}

	return {
		templateId,
		passedCount,
		totalCount: testCases.length,
		results,
	};
}

// =============================================================================
// AI Code Review
// =============================================================================

/**
 * Generate an AI review of submitted code.
 *
 * @param {string} codeText
 * @param {string} language
 * @param {string} roleType
 * @param {string} difficulty
 * @returns {Promise<Object>} review object with critique, score, suggestions
 */
async function generateAIReview(codeText, language, roleType, difficulty) {
	const prompt = `You are a senior ${roleType} engineer conducting a code review. Review the following ${language} code submission for a ${difficulty} difficulty coding challenge.

CODE:
\`\`\`${language}
${codeText.substring(0, 8000)}
\`\`\`

Provide a structured code review. Return ONLY valid JSON (no markdown):

{
  "code_quality_score": <number 0-100>,
  "readability_score": <number 0-100>,
  "efficiency_score": <number 0-100>,
  "best_practices_score": <number 0-100>,
  "overall_review": "<2-3 paragraph detailed review. Be constructive but honest. Mention specific code patterns, naming, structure, edge cases>",
  "strengths": ["<specific strength with code reference>"],
  "improvements": ["<specific improvement with code reference>"],
  "suggestions": ["<actionable suggestion>"],
  "correctness_summary": "<brief assessment of whether the code is likely correct>",
  "time_complexity": "<assessed time complexity, e.g. O(n), O(n log n)>",
  "space_complexity": "<assessed space complexity>"
}

Scoring guide:
- 90-100: Excellent, production-ready code
- 70-89: Good, minor improvements needed
- 50-69: Acceptable, several issues
- Below 50: Significant problems, needs rework

Be specific. Reference actual code patterns, variable names, and logic.`;

	try {
		const response = await chat(prompt, {
			system:
				'You are a senior software engineer conducting thorough code reviews. Be constructive, specific, and honest. Always return valid JSON.',
			maxTokens: 2048,
			module: 'coding_assessment',
			feature: 'ai_code_review',
		});

		// Parse with robust fallback
		let cleaned = response.trim();
		if (cleaned.startsWith('```')) {
			cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
		}
		const match = cleaned.match(/(\{[\s\S]*\})/);
		if (match) cleaned = match[0];

		const parsed = JSON.parse(cleaned);
		return {
			codeQualityScore: Math.min(100, Math.max(0, parsed.code_quality_score || 0)),
			readabilityScore: Math.min(100, Math.max(0, parsed.readability_score || 0)),
			efficiencyScore: Math.min(100, Math.max(0, parsed.efficiency_score || 0)),
			bestPracticesScore: Math.min(100, Math.max(0, parsed.best_practices_score || 0)),
			overallReview: parsed.overall_review || 'No review generated.',
			strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
			improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
			suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
			correctnessSummary: parsed.correctness_summary || 'Unable to assess.',
			timeComplexity: parsed.time_complexity || 'Unknown',
			spaceComplexity: parsed.space_complexity || 'Unknown',
		};
	} catch (err) {
		console.error('[codingGrader] AI review failed:', err.message);
		return {
			codeQualityScore: 0,
			readabilityScore: 0,
			efficiencyScore: 0,
			bestPracticesScore: 0,
			overallReview: 'AI review could not be generated at this time.',
			strengths: [],
			improvements: [],
			suggestions: [],
			correctnessSummary: 'Review unavailable.',
			timeComplexity: 'Unknown',
			spaceComplexity: 'Unknown',
		};
	}
}

/**
 * Save AI review to a submission.
 */
async function saveAIReview(submissionId, review) {
	const _reviewText = review.overall_review || review.overallReview || '';
	const reviewJson = JSON.stringify(review);
	await pool.query(
		`UPDATE coding_submissions SET ai_review_text = $1, updated_at = NOW() WHERE id = $2`,
		[reviewJson, submissionId],
	);
	return review;
}

// =============================================================================
// Plagiarism Detection
// =============================================================================

/**
 * Simple token-based plagiarism detection.
 * Compares the submission against all previous submissions for the same template.
 * Uses normalized token similarity (Jaccard-like on token n-grams).
 *
 * @param {number} submissionId
 * @param {number} candidateId
 * @param {number} templateId
 * @param {string} codeText
 * @returns {Promise<Object>} { flagged, similarity, matchedSubmissionId }
 */
async function detectPlagiarism(submissionId, candidateId, templateId, codeText) {
	if (!codeText || codeText.length < 20) {
		return { flagged: false, similarity: 0, matchedSubmissionId: null };
	}

	// Normalize code: lowercase, strip comments (basic), normalize whitespace
	function normalizeCode(code) {
		return code
			.toLowerCase()
			.replace(/\/\/.*$/gm, '') // single-line comments
			.replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
			.replace(/\s+/g, ' ')
			.replace(/[^a-z0-9_\s]/g, ' ')
			.trim();
	}

	function tokenize(code) {
		return normalizeCode(code)
			.split(/\s+/)
			.filter((t) => t.length > 0);
	}

	function getNgrams(tokens, n = 3) {
		const ngrams = new Set();
		for (let i = 0; i <= tokens.length - n; i++) {
			ngrams.add(tokens.slice(i, i + n).join(' '));
		}
		return ngrams;
	}

	function similarity(a, b) {
		if (a.length === 0 || b.length === 0) return 0;
		const setA = getNgrams(a);
		const setB = getNgrams(b);
		if (setA.size === 0 || setB.size === 0) return 0;
		let intersection = 0;
		for (const g of setA) if (setB.has(g)) intersection++;
		return intersection / Math.max(setA.size, setB.size);
	}

	const currentTokens = tokenize(codeText);

	// Compare against previous submissions for same template (excluding self)
	const prevResult = await pool.query(
		`SELECT id, candidate_id, code_text FROM coding_submissions
       WHERE template_id = $1 AND id != $2 AND status != 'draft' AND code_text IS NOT NULL
       ORDER BY submitted_at DESC NULLS LAST
       LIMIT 50`,
		[templateId, submissionId],
	);

	let maxSimilarity = 0;
	let matchedId = null;

	for (const prev of prevResult.rows) {
		// Skip comparing against the same candidate (they can resubmit)
		if (prev.candidate_id === candidateId) continue;
		const prevTokens = tokenize(prev.code_text);
		const sim = similarity(currentTokens, prevTokens);
		if (sim > maxSimilarity) {
			maxSimilarity = sim;
			matchedId = prev.id;
		}
	}

	// Flag if similarity > 0.75 (75% token n-gram overlap)
	const flagged = maxSimilarity > 0.75;
	const similarityPct = Math.round(maxSimilarity * 100 * 100) / 100;

	await pool.query(
		`UPDATE coding_submissions
       SET plagiarism_flag = $1,
           plagiarism_similarity = $2,
           updated_at = NOW()
       WHERE id = $3`,
		[flagged, similarityPct, submissionId],
	);

	return { flagged, similarity: similarityPct, matchedSubmissionId: matchedId };
}

// =============================================================================
// Result Retrieval
// =============================================================================

/**
 * Get full grading result for a submission, including per-test-case breakdown.
 * Filters out hidden test case details for non-recruiters.
 */
async function getGradingResult(submissionId, isRecruiter = false) {
	const subResult = await pool.query(
		`SELECT s.*, t.title as template_title, t.role_type, t.difficulty
       FROM coding_submissions s
       JOIN coding_templates t ON s.template_id = t.id
       WHERE s.id = $1`,
		[submissionId],
	);
	if (subResult.rows.length === 0) return null;
	const submission = subResult.rows[0];

	const scoresResult = await pool.query(
		`SELECT cs.*, tc.name, tc.description, tc.is_hidden, tc.weight
       FROM coding_scores cs
       JOIN coding_test_cases tc ON cs.test_case_id = tc.id
       WHERE cs.submission_id = $1
       ORDER BY tc.order_index ASC`,
		[submissionId],
	);

	const results = scoresResult.rows.map((r) => ({
		testCaseId: r.test_case_id,
		name: r.name,
		description: r.description,
		passed: r.passed,
		isHidden: r.is_hidden,
		// Hide actual output for hidden cases from candidates
		actualOutput: r.is_hidden && !isRecruiter ? null : r.actual_output,
		expectedOutput: r.is_hidden && !isRecruiter ? null : r.expected_output,
		executionTimeMs: r.execution_time_ms,
		memoryUsedMb: r.memory_used_mb,
		scoreEarned: r.score_earned,
		maxScore: r.weight || 10,
		errorMessage: r.is_hidden && !isRecruiter && !r.passed ? null : r.error_message,
	}));

	let aiReview = null;
	if (submission.ai_review_text) {
		try {
			aiReview = JSON.parse(submission.ai_review_text);
		} catch (_e) {
			aiReview = { overallReview: submission.ai_review_text };
		}
	}

	return {
		submissionId,
		candidateId: submission.candidate_id,
		templateId: submission.template_id,
		templateTitle: submission.template_title,
		roleType: submission.role_type,
		difficulty: submission.difficulty,
		language: submission.language,
		status: submission.status,
		score: submission.score,
		maxScore: submission.max_score,
		aiReview,
		plagiarism: {
			flagged: submission.plagiarism_flag,
			similarity: submission.plagiarism_similarity,
		},
		startedAt: submission.started_at,
		submittedAt: submission.submitted_at,
		gradedAt: submission.graded_at,
		results,
	};
}

// =============================================================================
// Batch Grading (for async processing)
// =============================================================================

/**
 * Submit a submission for async grading.
 * This is useful when grading may take a while (many test cases).
 */
async function queueGrading(submissionId) {
	// For now, we grade synchronously. In the future, this could queue to a job system.
	return gradeSubmission(submissionId);
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
	gradeSubmission,
	runSampleTests,
	generateAIReview,
	saveAIReview,
	detectPlagiarism,
	getGradingResult,
	queueGrading,
};
