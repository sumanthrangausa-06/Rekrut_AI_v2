const { query, validationResult } = require('express-validator');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../lib/db');
const { authMiddleware, optionalAuth, requireRole, requireApprovedRecruiter, requireNotSuspended } = require('../lib/auth');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();

// Validation rules for job search/list queries
const validateJobSearch = [
	query('limit')
		.optional()
		.isInt({ min: 1, max: 100 })
		.withMessage('limit must be an integer between 1 and 100')
		.toInt(),
	query('offset')
		.optional()
		.isInt({ min: 0 })
		.withMessage('offset must be an integer >= 0')
		.toInt(),
	query('page').optional().isInt({ min: 1 }).withMessage('page must be an integer >= 1').toInt(),
	query('search')
		.optional()
		.isString()
		.trim()
		.isLength({ max: 200 })
		.withMessage('search must be a string with max length 200')
		.escape(),
	query('location')
		.optional()
		.isString()
		.trim()
		.isLength({ max: 100 })
		.withMessage('location must be a string with max length 100')
		.escape(),
];

// Helper to return 400 on validation errors
function handleValidationErrors(req, res, next) {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(400).json({ error: 'Validation failed', details: errors.array() });
	}
	next();
}

// List jobs (public) with search/filter
router.get('/', optionalAuth, validateJobSearch, handleValidationErrors, async (req, res) => {
	try {
		const {
			status = 'active',
			limit = 20,
			page = 1,
			offset,
			search,
			location,
			job_type,
			salary_min,
			salary_max,
		} = req.query;

		const allowedStatuses = ['active'];
		const requestedStatus = status ? status.trim().toLowerCase() : 'active';
		if (!allowedStatuses.includes(requestedStatus)) {
			return res.status(400).json({ error: 'Invalid status parameter' });
		}

		const parsedLimit = parseInt(limit, 10);
		const parsedOffset =
			offset !== undefined ? parseInt(offset, 10) : (parseInt(page, 10) - 1) * parsedLimit;

		let sqlQuery = `
      SELECT j.id, j.title, j.company, j.description, j.requirements, j.location,
             j.salary_range, j.job_type, j.screening_questions, j.country_code,
             j.currency_code, j.salary_min, j.salary_max, j.status, j.created_at,
             u.company_name as poster_company
      FROM jobs j
      LEFT JOIN users u ON j.user_id = u.id
      WHERE j.status = $1
    `;
		const params = [requestedStatus];
		let idx = 2;

		// Text search across title, company, description, requirements
		if (search?.trim()) {
			sqlQuery += ` AND (
        j.title ILIKE $${idx} OR j.company ILIKE $${idx}
        OR j.description ILIKE $${idx} OR j.requirements ILIKE $${idx}
      )`;
			params.push(`%${search.trim()}%`);
			idx++;
		}

		// Location filter (partial match)
		if (location?.trim()) {
			sqlQuery += ` AND j.location ILIKE $${idx}`;
			params.push(`%${location.trim()}%`);
			idx++;
		}

		// Job type filter (exact match)
		if (job_type?.trim()) {
			sqlQuery += ` AND j.job_type = $${idx}`;
			params.push(job_type.trim());
			idx++;
		}

		// Salary range filters
		if (salary_min) {
			sqlQuery += ` AND (j.salary_min >= $${idx} OR j.salary_min IS NULL)`;
			params.push(parseInt(salary_min, 10));
			idx++;
		}
		if (salary_max) {
			sqlQuery += ` AND (j.salary_max <= $${idx} OR j.salary_max IS NULL)`;
			params.push(parseInt(salary_max, 10));
			idx++;
		}

		sqlQuery += ` ORDER BY j.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
		params.push(parsedLimit, parsedOffset);

		const result = await pool.query(sqlQuery, params);

		// Get total count for pagination
		let countQuery = `SELECT COUNT(*) as total FROM jobs j WHERE j.status = $1`;
		const countParams = [requestedStatus];
		let cIdx = 2;
		if (search?.trim()) {
			countQuery += ` AND (j.title ILIKE $${cIdx} OR j.company ILIKE $${cIdx} OR j.description ILIKE $${cIdx} OR j.requirements ILIKE $${cIdx})`;
			countParams.push(`%${search.trim()}%`);
			cIdx++;
		}
		if (location?.trim()) {
			countQuery += ` AND j.location ILIKE $${cIdx}`;
			countParams.push(`%${location.trim()}%`);
			cIdx++;
		}
		if (job_type?.trim()) {
			countQuery += ` AND j.job_type = $${cIdx}`;
			countParams.push(job_type.trim());
			cIdx++;
		}

		const countResult = await pool.query(countQuery, countParams);

		res.json({
			jobs: result.rows,
			total: parseInt(countResult.rows[0].total, 10),
			limit: parsedLimit,
			offset: parsedOffset,
			page: Math.floor(parsedOffset / parsedLimit) + 1,
		});
	} catch (err) {
		console.error('List jobs error:', err);

		if (err.code === '42P01') {
			return res.status(500).json({
				error: 'Database table missing. Please contact support.',
				code: 'DB_TABLE_MISSING',
			});
		}
		if (err.code === '42703') {
			return res.status(500).json({
				error: 'Database schema error. Please try again in a few minutes.',
				code: 'DB_SCHEMA_ERROR',
			});
		}
		if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
			return res.status(500).json({
				error: 'Database connection failed. Please try again later.',
				code: 'DB_CONNECTION_FAILED',
			});
		}
		res.status(500).json({ error: 'Failed to fetch jobs' });
	}
});

// Search jobs (must be before /:id to avoid route collision)
router.get('/search', optionalAuth, validateJobSearch, handleValidationErrors, async (req, res) => {
	// Redirect search to list endpoint with query params
	const queryString = new URLSearchParams(req.query).toString();
	return res.redirect(`/api/jobs?${queryString}`);
});

// Get single job
router.get('/:id', optionalAuth, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}
		const result = await pool.query(
			`SELECT j.id, j.title, j.company, j.description, j.requirements, j.location,
              j.salary_range, j.job_type, j.screening_questions, j.country_code,
              j.currency_code, j.salary_min, j.salary_max, j.status, j.created_at,
              u.company_name as poster_company, u.name as poster_name
       FROM jobs j
       LEFT JOIN users u ON j.user_id = u.id
       WHERE j.id = $1 AND j.status = 'active'`,
			[id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		res.json({ job: result.rows[0] });
	} catch (err) {
		console.error('Get job error:', err);
		res.status(500).json({ error: 'Failed to fetch job' });
	}
});

// Create job (hiring managers and recruiters)
router.post(
	'/',
	authMiddleware,
	requireNotSuspended,
	requireApprovedRecruiter,
	requirePermission('jobs:create'),
	async (req, res) => {
		try {
			const {
				title,
				company,
				description,
				requirements,
				location,
				salary_range,
				job_type,
				screening_questions,
				country_code,
				currency_code,
				salary_min,
				salary_max,
			} = req.body;

			if (!title) {
				return res.status(400).json({ error: 'Job title is required' });
			}

			// Normalize job_type to lowercase to match CHECK constraint
			const validJobTypes = ['full-time', 'part-time', 'contract', 'internship', 'freelance'];
			const normalizedJobType = job_type ? job_type.toLowerCase().trim() : 'full-time';
			if (!validJobTypes.includes(normalizedJobType)) {
				return res
					.status(400)
					.json({ error: `Invalid job type. Must be one of: ${validJobTypes.join(', ')}` });
			}

			// Default country from company if not specified
			let jobCountry = country_code || 'US';
			let jobCurrency = currency_code || 'USD';
			if (!country_code && req.user.company_id) {
				try {
					const companyCountry = await pool.query(
						'SELECT primary_country FROM companies WHERE id = $1',
						[req.user.company_id],
					);
					if (companyCountry.rows.length > 0 && companyCountry.rows[0].primary_country) {
						jobCountry = companyCountry.rows[0].primary_country;
						// Get currency from country config
						const countryConfig = require('../services/country-config');
						const cc = await countryConfig.getCountry(jobCountry);
						if (cc) jobCurrency = cc.currency_code;
					}
				} catch (_e) {
					/* use defaults */
				}
			}

			const result = await pool.query(
				`INSERT INTO jobs (user_id, company_id, title, company, description, requirements, location, salary_range, job_type, screening_questions, country_code, currency_code, salary_min, salary_max)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
				[
					req.user.id,
					req.user.company_id || null,
					title,
					company || req.user.company_name || 'Company',
					description,
					requirements,
					location,
					salary_range,
					normalizedJobType,
					JSON.stringify(screening_questions || []),
					jobCountry,
					jobCurrency,
					salary_min || null,
					salary_max || null,
				],
			);

			// Track job post creation
			try {
				const { ensureEventsTable } = require('../lib/db-health');
				const eventsCheck = await ensureEventsTable();
				if (eventsCheck.exists) {
					await pool.query(
						'INSERT INTO events (event_type, user_id, metadata) VALUES ($1, $2, $3)',
						['job_post_created', req.user.id, JSON.stringify({ title, company, job_type })],
					);
				} else {
					console.warn('[jobs] events table missing, skipping job post event log');
				}
			} catch (e) {
				console.error(
					'Failed to log job post event:',
					e.message,
					e.code ? `(code: ${e.code})` : '',
				);
			}

			res.json({ success: true, job: result.rows[0] });
		} catch (err) {
			console.error('Create job error:', err);
			res.status(500).json({ error: 'Failed to create job' });
		}
	},
);

// Update job
router.put('/:id', authMiddleware, requireNotSuspended, requireApprovedRecruiter, requirePermission('jobs:update'), async (req, res) => {
	try {
		const {
			title,
			description,
			requirements,
			location,
			salary_range,
			job_type,
			status,
			screening_questions,
		} = req.body;

		// Normalize job_type to lowercase if provided
		const normalizedUpdateJobType = job_type ? job_type.toLowerCase().trim() : null;
		if (normalizedUpdateJobType) {
			const validJobTypes = ['full-time', 'part-time', 'contract', 'internship', 'freelance'];
			if (!validJobTypes.includes(normalizedUpdateJobType)) {
				return res
					.status(400)
					.json({ error: `Invalid job type. Must be one of: ${validJobTypes.join(', ')}` });
			}
		}

		// Check ownership
		const existing = await pool.query('SELECT user_id FROM jobs WHERE id = $1', [req.params.id]);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
			return res.status(403).json({ error: 'Not authorized' });
		}

		const result = await pool.query(
			`UPDATE jobs SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        requirements = COALESCE($3, requirements),
        location = COALESCE($4, location),
        salary_range = COALESCE($5, salary_range),
        job_type = COALESCE($6, job_type),
        status = COALESCE($7, status),
        screening_questions = COALESCE($8, screening_questions),
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
			[
				title,
				description,
				requirements,
				location,
				salary_range,
				normalizedUpdateJobType,
				status,
				screening_questions ? JSON.stringify(screening_questions) : null,
				req.params.id,
			],
		);

		res.json({ success: true, job: result.rows[0] });
	} catch (err) {
		console.error('Update job error:', err);
		res.status(500).json({ error: 'Failed to update job' });
	}
});

// Delete job
router.delete('/:id', authMiddleware, requireNotSuspended, requireApprovedRecruiter, requirePermission('jobs:delete'), async (req, res) => {
	try {
		const existing = await pool.query('SELECT user_id FROM jobs WHERE id = $1', [req.params.id]);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}
		if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
			return res.status(403).json({ error: 'Not authorized' });
		}

		await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
		res.json({ success: true });
	} catch (err) {
		console.error('Delete job error:', err);
		res.status(500).json({ error: 'Failed to delete job' });
	}
});

// Cartesia TTS cache directory
const CARTESIA_CACHE_DIR = path.join('/tmp', 'cartesia-cache');
if (!fs.existsSync(CARTESIA_CACHE_DIR)) {
	fs.mkdirSync(CARTESIA_CACHE_DIR, { recursive: true });
}

// Generate audio narration for job description (POST /api/jobs/:id/audio)
router.post('/:id/audio', optionalAuth, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}

		// Fetch job from DB
		const result = await pool.query(
			`SELECT id, title, company, description, requirements, location, job_type
       FROM jobs WHERE id = $1 AND status = 'active'`,
			[id],
		);
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		const job = result.rows[0];
		const text = `${job.title} at ${job.company || 'our company'}. ${job.location ? `Located in ${job.location}. ` : ''}${job.description || ''}`;

		const cacheFile = path.join(CARTESIA_CACHE_DIR, `job-${id}.mp3`);

		// If cached, return immediately
		if (fs.existsSync(cacheFile)) {
			return res.json({ audioUrl: `/api/jobs/${id}/audio-file` });
		}

		const apiKey = process.env.CARTESIA_API_KEY;
		if (!apiKey) {
			return res.status(500).json({ error: 'Cartesia API key not configured' });
		}

		// Call Cartesia TTS API
		const response = await fetch('https://api.cartesia.ai/tts/bytes', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'Cartesia-Version': '2026-03-01',
			},
			body: JSON.stringify({
				model_id: 'sonic-3.5',
				voice: { id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', mode: 'id' },
				transcript: text,
				output_format: { container: 'mp3', sample_rate: 24000 },
			}),
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => 'Unknown error');
			console.error('[Cartesia TTS] HTTP', response.status, errText);
			return res.status(502).json({ error: 'Cartesia TTS generation failed', detail: errText });
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		fs.writeFileSync(cacheFile, buffer);

		res.json({ audioUrl: `/api/jobs/${id}/audio-file` });
	} catch (err) {
		console.error('Generate audio error:', err);
		res.status(500).json({ error: 'Failed to generate audio narration' });
	}
});

// Serve cached audio file (GET /api/jobs/:id/audio-file)
router.get('/:id/audio-file', optionalAuth, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}

		const cacheFile = path.join(CARTESIA_CACHE_DIR, `job-${id}.mp3`);
		if (!fs.existsSync(cacheFile)) {
			return res
				.status(404)
				.json({ error: 'Audio not found. Generate it first via POST /api/jobs/:id/audio' });
		}

		res.setHeader('Content-Type', 'audio/mpeg');
		res.setHeader('Content-Length', fs.statSync(cacheFile).size);
		res.setHeader('Cache-Control', 'public, max-age=86400');
		const stream = fs.createReadStream(cacheFile);
		stream.pipe(res);
	} catch (err) {
		console.error('Serve audio error:', err);
		res.status(500).json({ error: 'Failed to serve audio file' });
	}
});

module.exports = router;
