const express = require('express');
const crypto = require('node:crypto');
const { authMiddleware } = require('../lib/auth');
const { createRateLimit } = require('../lib/distributed-rate-limiter');
const { calculateFitScore, calculateFitScoresBatch } = require('../services/fitScore');

const router = express.Router();

// Rate limit: 100 requests/minute per user (keyed by user ID, not IP)
const _fitScoreRateLimit = createRateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: 100,
	keyPrefix: 'fitscore',
});

// Override key generation to use user ID for per-user rate limiting
function userRateLimit(req, res, next) {
	// Skip rate limiting in test/e2e environments
	if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'e2e') {
		return next();
	}
	const userId = req.user?.id;
	if (!userId) {
		return next();
	}
	const path = req.route?.path || req.path;
	const key = `fitscore:${req.method}:${path}:user:${userId}`;

	const { distributedRateLimiter } = require('../lib/distributed-rate-limiter');
	distributedRateLimiter
		.checkLimit(key, 60 * 1000, 100)
		.then((result) => {
			res.setHeader('X-RateLimit-Limit', 100);
			res.setHeader('X-RateLimit-Remaining', Math.max(0, 100 - result.count));
			res.setHeader('X-RateLimit-Reset', Math.ceil(new Date(result.resetAt).getTime() / 1000));

			if (!result.allowed) {
				res.setHeader('Retry-After', result.retryAfter);
				return res.status(429).json({
					error: 'Too many requests',
					retryAfter: result.retryAfter,
					message: `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
				});
			}
			next();
		})
		.catch((_err) => {
			// Fail open
			next();
		});
}

// Helper: structured error response with UUID reference
function sendError(res, statusCode, message, consolePrefix, err) {
	const ref = crypto.randomUUID();
	console.error(`[ERROR ref=${ref}] ${consolePrefix}:`, err?.message || err || message);
	res.status(statusCode).json({ error: message, ref });
}

// Helper: ensure candidate role
function requireCandidate(req, res, next) {
	if (req.user.role !== 'candidate') {
		return sendError(res, 403, 'Candidate access required', 'Auth check');
	}
	next();
}

// ─── GET /api/candidate/jobs/:id/fit-score ───────────────────────────────
// Returns fit score for a single job

router.get(
	'/jobs/:id/fit-score',
	authMiddleware,
	requireCandidate,
	userRateLimit,
	async (req, res) => {
		try {
			const jobId = parseInt(req.params.id, 10);
			if (Number.isNaN(jobId) || jobId <= 0) {
				return sendError(res, 400, 'Invalid job ID', 'Validation');
			}

			const result = await calculateFitScore(req.user.id, jobId);

			res.json({
				success: true,
				job_id: jobId,
				...result,
			});
		} catch (err) {
			if (err.statusCode === 404) {
				return sendError(res, 404, 'Job not found', 'Fit score', err);
			}
			sendError(res, 500, 'Failed to calculate fit score', 'Fit score', err);
		}
	},
);

// ─── GET /api/candidate/jobs/fit-scores ──────────────────────────────────
// Returns batch fit scores
// Query: job_ids (comma-separated, max 50)

router.get(
	'/jobs/fit-scores',
	authMiddleware,
	requireCandidate,
	userRateLimit,
	async (req, res) => {
		try {
			const { job_ids } = req.query;

			if (!job_ids || typeof job_ids !== 'string') {
				return sendError(res, 400, 'job_ids query parameter is required', 'Validation');
			}

			const rawIds = job_ids
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);

			if (rawIds.length === 0) {
				return sendError(res, 400, 'job_ids must contain at least one job ID', 'Validation');
			}

			if (rawIds.length > 50) {
				return sendError(res, 400, 'Maximum 50 job IDs allowed', 'Validation');
			}

			const jobIds = [];
			for (const raw of rawIds) {
				const parsed = parseInt(raw, 10);
				if (Number.isNaN(parsed) || parsed <= 0) {
					return sendError(res, 400, `Invalid job ID: ${raw}`, 'Validation');
				}
				jobIds.push(parsed);
			}

			// Deduplicate while preserving order
			const uniqueJobIds = [...new Set(jobIds)];

			const results = await calculateFitScoresBatch(req.user.id, uniqueJobIds);

			res.json({
				success: true,
				count: results.length,
				scores: results,
			});
		} catch (err) {
			sendError(res, 500, 'Failed to calculate fit scores', 'Fit scores batch', err);
		}
	},
);

module.exports = router;
