const express = require('express');
const pool = require('../lib/db');
const { apiAuthMiddleware, optionalApiAuth } = require('../middleware/api-auth');
const { apiRateLimit } = require('../middleware/api-rate-limit');

const router = express.Router();

// ponytail: Exclude E2E test data from public listings
const EXCLUDE_TEST_JOBS = " AND j.company NOT ILIKE '%E2E%' AND j.title NOT ILIKE '%E2E%'";

// Apply optional API auth + rate limit to all public API routes
// Optional auth means jobs are publicly listable, but api key holders get higher limits
router.use(optionalApiAuth);
router.use(apiRateLimit);

// GET /api/v1/jobs — list public job postings (paginated)
router.get('/jobs', async (req, res) => {
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

		const requestedStatus = status.trim().toLowerCase();
		if (requestedStatus !== 'active') {
			return res
				.status(400)
				.json({ error: 'Invalid status. Only active jobs are publicly listed.' });
		}

		const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10)));
		const parsedOffset =
			offset !== undefined
				? Math.max(0, parseInt(offset, 10))
				: (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit;

		let sqlQuery = `
      SELECT j.id, j.title, j.company, j.description, j.requirements, j.location,
             j.salary_range, j.job_type, j.country_code, j.currency_code,
             j.salary_min, j.salary_max, j.status, j.created_at,
             u.company_name as poster_company
      FROM jobs j
      LEFT JOIN users u ON j.user_id = u.id
      WHERE j.status = $1${EXCLUDE_TEST_JOBS}
    `;
		const params = [requestedStatus];
		let idx = 2;

		if (search?.trim()) {
			sqlQuery += ` AND (
        j.title ILIKE $${idx} OR j.company ILIKE $${idx}
        OR j.description ILIKE $${idx} OR j.requirements ILIKE $${idx}
      )`;
			params.push(`%${search.trim()}%`);
			idx++;
		}

		if (location?.trim()) {
			sqlQuery += ` AND j.location ILIKE $${idx}`;
			params.push(`%${location.trim()}%`);
			idx++;
		}

		if (job_type?.trim()) {
			sqlQuery += ` AND j.job_type = $${idx}`;
			params.push(job_type.trim().toLowerCase());
			idx++;
		}

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

		let countQuery = `SELECT COUNT(*) as total FROM jobs j WHERE j.status = $1${EXCLUDE_TEST_JOBS}`;
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
			countParams.push(job_type.trim().toLowerCase());
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
		console.error('[public-api] List jobs error:', err.message);
		res.status(500).json({ error: 'Failed to fetch jobs' });
	}
});

// GET /api/v1/jobs/:id — get single job details
router.get('/jobs/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: 'Invalid job ID' });
		}

		const result = await pool.query(
			`SELECT j.id, j.title, j.company, j.description, j.requirements, j.location,
              j.salary_range, j.job_type, j.country_code, j.currency_code,
              j.salary_min, j.salary_max, j.status, j.created_at,
              u.company_name as poster_company, u.name as poster_name
       FROM jobs j
       LEFT JOIN users u ON j.user_id = u.id
       WHERE j.id = $1 AND j.status = 'active'${EXCLUDE_TEST_JOBS}`,
			[id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		res.json({ job: result.rows[0] });
	} catch (err) {
		console.error('[public-api] Get job error:', err.message);
		res.status(500).json({ error: 'Failed to fetch job' });
	}
});

// GET /api/v1/candidates — list candidates for authorized recruiters (requires API key)
router.get('/candidates', apiAuthMiddleware, async (req, res) => {
	try {
		// Verify the API key has the 'candidates:read' scope (or 'read' as fallback)
		const scopes = req.apiKey?.scopes || [];
		const hasScope =
			scopes.includes('candidates:read') || scopes.includes('read:all') || scopes.includes('admin');
		if (!hasScope) {
			return res.status(403).json({
				error: 'Insufficient scope. Required: candidates:read',
				code: 'INSUFFICIENT_SCOPE',
			});
		}

		const { limit = 50, page = 1, search, status } = req.query;
		const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10)));
		const parsedOffset = (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit;

		// ponytail: candidates list is scoped to the key creator's company.
		// If no company, return empty. Upgrade to cross-company admin if needed.
		const userResult = await pool.query('SELECT company_id FROM users WHERE id = $1', [
			req.apiKey.createdBy,
		]);
		const companyId = userResult.rows[0]?.company_id;
		if (!companyId) {
			return res.json({
				candidates: [],
				total: 0,
				limit: parsedLimit,
				offset: parsedOffset,
				page: 1,
			});
		}

		let sqlQuery = `
      SELECT DISTINCT ON (u.id)
        u.id, u.name, u.email, u.avatar_url,
        cp.headline, cp.location, cp.years_experience,
        ja.status as application_status, ja.applied_at,
        COALESCE(os.total_score, ja.match_score, 0) as omniscore
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE ja.company_id = $1
    `;
		const params = [companyId];
		let idx = 2;

		if (search?.trim()) {
			sqlQuery += ` AND (u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR cp.headline ILIKE $${idx})`;
			params.push(`%${search.trim()}%`);
			idx++;
		}
		if (status?.trim()) {
			sqlQuery += ` AND ja.status = $${idx}`;
			params.push(status.trim());
			idx++;
		}

		sqlQuery += ` ORDER BY u.id, ja.applied_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
		params.push(parsedLimit, parsedOffset);

		const result = await pool.query(sqlQuery, params);

		const countResult = await pool.query(
			`SELECT COUNT(DISTINCT ja.candidate_id) as total
       FROM job_applications ja
       JOIN users u ON ja.candidate_id = u.id
       LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE ja.company_id = $1
       ${search?.trim() ? `AND (u.name ILIKE $2 OR u.email ILIKE $2 OR cp.headline ILIKE $2)` : ''}
       ${status?.trim() ? (search?.trim() ? 'AND ja.status = $3' : 'AND ja.status = $2') : ''}`,
			params.slice(0, idx - 1),
		);

		res.json({
			candidates: result.rows,
			total: parseInt(countResult.rows[0].total, 10),
			limit: parsedLimit,
			offset: parsedOffset,
			page: Math.floor(parsedOffset / parsedLimit) + 1,
		});
	} catch (err) {
		console.error('[public-api] List candidates error:', err.message);
		res.status(500).json({ error: 'Failed to fetch candidates' });
	}
});

module.exports = router;
