/**
 * Career Coach API Routes — Issue #121
 *
 * Endpoints:
 *  GET  /api/career-coach/status              — Feature access + usage
 *  POST /api/career-coach/career-paths        — Career path recommendations
 *  POST /api/career-coach/skill-gaps          — Skill gap analysis
 *  POST /api/career-coach/learning-path       — Learning path generation
 *  POST /api/career-coach/company-research    — Company research brief
 *  POST /api/career-coach/application-optimize — Application optimizer
 *  POST /api/career-coach/salary-practice/start   — Start salary practice
 *  POST /api/career-coach/salary-practice/continue — Continue salary practice
 *  POST /api/career-coach/salary-practice/finalize — Finalize salary practice
 *  GET  /api/career-coach/history             — Session history
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../lib/db');
const { authMiddleware, requireNotSuspended } = require('../lib/auth');
const { requireFeature, incrementUsage } = require('../lib/subscription');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const {
	generateCareerPaths,
	analyzeSkillGaps,
	generateLearningPath,
	generateCompanyBrief,
	optimizeApplication,
	startSalaryPractice,
	continueSalaryPractice,
	finalizeSalaryPractice,
	saveSession,
	getSessionHistory,
} = require('../lib/career-coach-ai');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────

function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ error: 'Validation failed', details: errors.array() });
	}
	next();
}

function asyncHandler(fn) {
	return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ── Feature: career coach uses 'ai_coaching' tier limits ─────

// ── GET /api/career-coach/status ─────────────────────────────

router.get(
	'/status',
	authMiddleware,
	requireNotSuspended,
	asyncHandler(async (req, res) => {
		const { checkFeatureAccess } = require('../lib/subscription');
		const access = await checkFeatureAccess(req.user, 'ai_coaching');
		const history = await getSessionHistory(req.user.id, null, 5);
		res.json({
			access,
			recentSessions: history,
		});
	}),
);

// ── POST /api/career-coach/career-paths ──────────────────────

router.post(
	'/career-paths',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[
		body('targetRole').optional().isString().trim().isLength({ max: 100 }),
		body('yearsAhead').optional().isInt({ min: 1, max: 10 }),
	],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { targetRole, yearsAhead } = req.body;

		const { result, jobs, candidate } = await generateCareerPaths(req.user.id, {
			targetRole,
			yearsAhead,
		});

		const sessionId = await saveSession(req.user.id, 'career_path', { targetRole, yearsAhead }, result);
		await incrementUsage(req.user.id, 'ai_coaching');

		res.json({
			success: true,
			sessionId,
			pathways: result.pathways || [],
			summary: result.summary || '',
			groundedJobs: jobs.slice(0, 10).map((j) => ({
				id: j.id,
				title: j.title,
				company: j.company || j.company_name,
				location: j.location,
				salaryMin: j.salary_min,
				salaryMax: j.salary_max,
				currency: j.currency_code,
				jobType: j.job_type,
			})),
		});
	}),
);

// ── POST /api/career-coach/skill-gaps ────────────────────────

router.post(
	'/skill-gaps',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[body('targetRole').isString().trim().isLength({ min: 1, max: 100 })],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { targetRole } = req.body;

		const { result, jobs, candidate } = await analyzeSkillGaps(req.user.id, { targetRole });

		const sessionId = await saveSession(req.user.id, 'skill_gap', { targetRole }, result);
		await incrementUsage(req.user.id, 'ai_coaching');

		res.json({
			success: true,
			sessionId,
			targetRole: result.target_role || targetRole,
			currentSkills: result.current_skills || [],
			requiredSkills: result.required_skills || [],
			gapAnalysis: result.gap_analysis || [],
			qualifyingJobsNow: (result.qualifying_jobs_now || []).map((j) => ({
				id: j.job_id,
				title: j.title,
				company: j.company,
				missingSkills: j.missing_skills || [],
			})),
			qualifyingJobsAfterGaps: (result.qualifying_jobs_after_gaps || []).map((j) => ({
				id: j.job_id,
				title: j.title,
				company: j.company,
			})),
			actionPlan: result.action_plan || [],
			summary: result.summary || '',
		});
	}),
);

// ── POST /api/career-coach/learning-path ─────────────────────

router.post(
	'/learning-path',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[
		body('targetRole').isString().trim().isLength({ min: 1, max: 100 }),
		body('focusSkills').optional().isArray(),
	],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { targetRole, focusSkills } = req.body;

		const result = await generateLearningPath(req.user.id, { targetRole, focusSkills });

		const sessionId = await saveSession(req.user.id, 'learning_path', { targetRole, focusSkills }, result);
		await incrementUsage(req.user.id, 'ai_coaching');

		res.json({
			success: true,
			sessionId,
			pathName: result.path_name || `${targetRole} Learning Path`,
			targetRole: result.target_role || targetRole,
			totalEstimatedHours: result.total_estimated_hours || 0,
			steps: result.steps || [],
			milestones: result.milestones || [],
			summary: result.summary || '',
		});
	}),
);

// ── POST /api/career-coach/company-research ──────────────────

router.post(
	'/company-research',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[body('companyId').isInt({ min: 1 })],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { companyId } = req.body;

		const { result, company, trustscore, feedback, activeJobs } = await generateCompanyBrief(req.user.id, {
			companyId,
		});

		const sessionId = await saveSession(req.user.id, 'company_research', { companyId }, result);
		await incrementUsage(req.user.id, 'ai_coaching');

		// Also save to company_research_briefs for richer querying
		await pool.query(
			`INSERT INTO company_research_briefs
       (user_id, session_id, company_id, company_name, brief_json, trust_score_at_time, job_openings_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				req.user.id,
				sessionId,
				companyId,
				company?.name || '',
				JSON.stringify(result),
				trustscore?.total_score || null,
				activeJobs,
			],
		);

		res.json({
			success: true,
			sessionId,
			company: {
				id: company?.id,
				name: company?.name,
				industry: company?.industry,
				size: company?.company_size,
				headquarters: company?.headquarters,
				isVerified: company?.is_verified,
			},
			trustscore: trustscore
				? {
						score: trustscore.total_score,
						tier: trustscore.score_tier,
						breakdown: {
							verification: trustscore.verification_score,
							authenticity: trustscore.job_authenticity_score,
							hiringRatio: trustscore.hiring_ratio_score,
							feedback: trustscore.feedback_score,
							behavior: trustscore.behavior_score,
						},
					}
				: null,
			feedback: feedback?.avg_rating
				? { averageRating: Number(feedback.avg_rating).toFixed(1), count: feedback.count }
				: null,
			activeJobs,
			brief: result,
		});
	}),
);

// ── POST /api/career-coach/application-optimize ──────────────

router.post(
	'/application-optimize',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[
		body('jobId').isInt({ min: 1 }),
		body('coverLetter').optional().isString(),
		body('answers').optional().isArray(),
	],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { jobId, coverLetter, answers } = req.body;

		const { result, job, originalCoverLetter, originalAnswers } = await optimizeApplication(req.user.id, {
			jobId,
			coverLetter,
			answers,
		});

		const sessionId = await saveSession(req.user.id, 'application_optimize', { jobId }, result);
		await incrementUsage(req.user.id, 'ai_coaching');

		// Persist to application_optimizations
		await pool.query(
			`INSERT INTO application_optimizations
       (user_id, session_id, job_id, job_title, company_name, original_cover_letter, optimized_cover_letter,
        original_answers, optimized_answers, diff_highlights, score_before, score_after, feedback)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			[
				req.user.id,
				sessionId,
				jobId,
				job?.title || '',
				job?.company || '',
				originalCoverLetter || null,
				result.optimized_cover_letter || null,
				JSON.stringify(originalAnswers || []),
				JSON.stringify(result.optimized_answers || []),
				JSON.stringify(result.diff_highlights || []),
				result.score_before || null,
				result.score_after || null,
				JSON.stringify(result.feedback || {}),
			],
		);

		res.json({
			success: true,
			sessionId,
			job: { id: job?.id, title: job?.title, company: job?.company },
			optimizedCoverLetter: result.optimized_cover_letter || '',
			optimizedAnswers: result.optimized_answers || [],
			diffHighlights: result.diff_highlights || [],
			scoreBefore: result.score_before || 0,
			scoreAfter: result.score_after || 0,
			feedback: result.feedback || {},
		});
	}),
);

// ── POST /api/career-coach/salary-practice/start ─────────────

router.post(
	'/salary-practice/start',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[
		body('jobId').isInt({ min: 1 }),
		body('offeredSalary').isInt({ min: 0 }),
		body('targetSalary').isInt({ min: 0 }),
	],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { jobId, offeredSalary, targetSalary } = req.body;

		const { result, job, marketBenchmark } = await startSalaryPractice(req.user.id, {
			jobId,
			offeredSalary,
			targetSalary,
		});

		const sessionId = await saveSession(req.user.id, 'salary_practice', { jobId, offeredSalary, targetSalary }, {
			ai_message: result.ai_message,
			tips: result.tips,
		});
		await incrementUsage(req.user.id, 'ai_coaching');

		// Persist to salary_practice_sessions
		await pool.query(
			`INSERT INTO salary_practice_sessions
       (user_id, session_id, job_id, job_title, company_name, offered_salary, target_salary, market_benchmark, conversation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				req.user.id,
				sessionId,
				jobId,
				job?.title || '',
				job?.company || '',
				offeredSalary,
				targetSalary,
				marketBenchmark,
				JSON.stringify([{ role: 'ai', text: result.ai_message, timestamp: new Date().toISOString() }]),
			],
		);

		res.json({
			success: true,
			sessionId,
			job: { id: job?.id, title: job?.title, company: job?.company },
			aiMessage: result.ai_message,
			scenarioSetup: result.scenario_setup || '',
			tips: result.tips || [],
			suggestedOpeners: result.suggested_openers || [],
			marketContext: result.market_context || { benchmark: marketBenchmark, currency: job?.currency_code || 'USD' },
		});
	}),
);

// ── POST /api/career-coach/salary-practice/continue ──────────

router.post(
	'/salary-practice/continue',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[
		body('sessionId').isInt({ min: 1 }),
		body('userMessage').isString().trim().isLength({ min: 1, max: 2000 }),
		body('jobId').isInt({ min: 1 }),
		body('offeredSalary').isInt({ min: 0 }),
		body('targetSalary').isInt({ min: 0 }),
		body('conversationHistory').isArray(),
	],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { sessionId, userMessage, jobId, offeredSalary, targetSalary, conversationHistory } = req.body;

		const result = await continueSalaryPractice(req.user.id, {
			conversationHistory,
			userMessage,
			jobId,
			offeredSalary,
			targetSalary,
		});

		// Update conversation in DB
		const newMessages = [
			...conversationHistory,
			{ role: 'user', text: userMessage, timestamp: new Date().toISOString() },
			{ role: 'ai', text: result.ai_message, timestamp: new Date().toISOString() },
		];

		await pool.query(
			`UPDATE salary_practice_sessions
       SET conversation = $1, updated_at = NOW()
       WHERE session_id = $2`,
			[JSON.stringify(newMessages), sessionId],
		);

		await incrementUsage(req.user.id, 'ai_coaching');

		res.json({
			success: true,
			sessionId,
			aiMessage: result.ai_message,
			coachingFeedback: result.coaching_feedback || {},
			isOfferImproved: result.is_offer_improved || false,
			newOfferAmount: result.new_offer_amount || null,
			conversationShouldEnd: result.conversation_should_end || false,
			endReason: result.end_reason || null,
		});
	}),
);

// ── POST /api/career-coach/salary-practice/finalize ──────────

router.post(
	'/salary-practice/finalize',
	authMiddleware,
	requireNotSuspended,
	requireFeature('ai_coaching'),
	rateLimits.ai,
	[
		body('sessionId').isInt({ min: 1 }),
		body('conversationHistory').isArray(),
		body('finalOffer').optional().isInt({ min: 0 }),
		body('accepted').optional().isBoolean(),
	],
	handleValidationErrors,
	asyncHandler(async (req, res) => {
		const { sessionId, conversationHistory, finalOffer, accepted } = req.body;

		const result = await finalizeSalaryPractice(req.user.id, {
			conversationHistory,
			finalOffer,
			accepted,
		});

		await pool.query(
			`UPDATE salary_practice_sessions
       SET ai_feedback = $1, completed = true, updated_at = NOW()
       WHERE session_id = $2`,
			[JSON.stringify(result), sessionId],
		);

		await incrementUsage(req.user.id, 'ai_coaching');

		res.json({
			success: true,
			sessionId,
			overallScore: result.overall_score || 0,
			grade: result.grade || 'C',
			summary: result.summary || '',
			strengths: result.strengths || [],
			weaknesses: result.weaknesses || [],
			tacticsUsedWell: result.tactics_used_well || [],
			missedOpportunities: result.missed_opportunities || [],
			specificImprovements: result.specific_improvements || [],
			nextTimeRecommendations: result.next_time_recommendations || [],
			whatTheyShouldHaveAskedFor: result.what_they_should_have_asked_for || '',
		});
	}),
);

// ── GET /api/career-coach/history ────────────────────────────

router.get(
	'/history',
	authMiddleware,
	requireNotSuspended,
	asyncHandler(async (req, res) => {
		const { type, limit = 20 } = req.query;
		const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
		const history = await getSessionHistory(req.user.id, type || null, parsedLimit);
		res.json({
			success: true,
			history: history.map((h) => ({
				id: h.id,
				type: h.session_type,
				status: h.status,
				createdAt: h.created_at,
				updatedAt: h.updated_at,
				inputData: h.input_data,
				resultSummary: h.result_data?.summary || null,
			})),
		});
	}),
);

module.exports = router;
