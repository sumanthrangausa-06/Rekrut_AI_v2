const express = require('express');
const pool = require('../lib/db');
const { authMiddleware, optionalAuth, requireRole } = require('../lib/auth');

const router = express.Router();

// List jobs (public) with search/filter
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { status = 'active', limit = 20, offset = 0, search, location, job_type, salary_min, salary_max } = req.query;

    let query = `
      SELECT j.*, u.company_name as poster_company
      FROM jobs j
      LEFT JOIN users u ON j.user_id = u.id
      WHERE j.status = $1
    `;
    const params = [status];
    let idx = 2;

    // Text search across title, company, description, requirements
    if (search && search.trim()) {
      query += ` AND (
        j.title ILIKE $${idx} OR j.company ILIKE $${idx}
        OR j.description ILIKE $${idx} OR j.requirements ILIKE $${idx}
      )`;
      params.push(`%${search.trim()}%`);
      idx++;
    }

    // Location filter (partial match)
    if (location && location.trim()) {
      query += ` AND j.location ILIKE $${idx}`;
      params.push(`%${location.trim()}%`);
      idx++;
    }

    // Job type filter (exact match)
    if (job_type && job_type.trim()) {
      query += ` AND j.job_type = $${idx}`;
      params.push(job_type.trim());
      idx++;
    }

    // Salary range filters
    if (salary_min) {
      query += ` AND (j.salary_min >= $${idx} OR j.salary_min IS NULL)`;
      params.push(parseInt(salary_min));
      idx++;
    }
    if (salary_max) {
      query += ` AND (j.salary_max <= $${idx} OR j.salary_max IS NULL)`;
      params.push(parseInt(salary_max));
      idx++;
    }

    query += ` ORDER BY j.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM jobs j WHERE j.status = $1`;
    const countParams = [status];
    let cIdx = 2;
    if (search && search.trim()) {
      countQuery += ` AND (j.title ILIKE $${cIdx} OR j.company ILIKE $${cIdx} OR j.description ILIKE $${cIdx} OR j.requirements ILIKE $${cIdx})`;
      countParams.push(`%${search.trim()}%`);
      cIdx++;
    }
    if (location && location.trim()) {
      countQuery += ` AND j.location ILIKE $${cIdx}`;
      countParams.push(`%${location.trim()}%`);
      cIdx++;
    }
    if (job_type && job_type.trim()) {
      countQuery += ` AND j.job_type = $${cIdx}`;
      countParams.push(job_type.trim());
      cIdx++;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      jobs: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('List jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Search jobs (must be before /:id to avoid route collision)
router.get('/search', optionalAuth, async (req, res) => {
  // Redirect search to list endpoint with query params
  const queryString = new URLSearchParams(req.query).toString();
  return res.redirect(`/api/jobs?${queryString}`);
});

// Get single job
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const result = await pool.query(
      `SELECT j.*, u.company_name as poster_company, u.name as poster_name
       FROM jobs j
       LEFT JOIN users u ON j.user_id = u.id
       WHERE j.id = $1`,
      [id]
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
router.post('/', authMiddleware, requireRole('hiring_manager', 'admin', 'recruiter', 'employer'), async (req, res) => {
  try {
    const { title, company, description, requirements, location, salary_range, job_type, screening_questions,
            country_code, currency_code, salary_min, salary_max } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    // Default country from company if not specified
    let jobCountry = country_code || 'US';
    let jobCurrency = currency_code || 'USD';
    if (!country_code && req.user.company_id) {
      try {
        const companyCountry = await pool.query(
          'SELECT primary_country FROM companies WHERE id = $1',
          [req.user.company_id]
        );
        if (companyCountry.rows.length > 0 && companyCountry.rows[0].primary_country) {
          jobCountry = companyCountry.rows[0].primary_country;
          // Get currency from country config
          const countryConfig = require('../services/country-config');
          const cc = await countryConfig.getCountry(jobCountry);
          if (cc) jobCurrency = cc.currency_code;
        }
      } catch (e) { /* use defaults */ }
    }

    const result = await pool.query(
      `INSERT INTO jobs (user_id, company_id, title, company, description, requirements, location, salary_range, job_type, screening_questions, country_code, currency_code, salary_min, salary_max)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [req.user.id, req.user.company_id || null, title, company || req.user.company_name || 'Company', description, requirements, location, salary_range, job_type, JSON.stringify(screening_questions || []),
       jobCountry, jobCurrency, salary_min || null, salary_max || null]
    );

    // Track job post creation
    try {
      await pool.query(
        'INSERT INTO events (event_type, user_id, metadata) VALUES ($1, $2, $3)',
        ['job_post_created', req.user.id, JSON.stringify({ title, company, job_type })]
      );
    } catch (e) {
      console.error('Failed to log job post event:', e);
    }

    res.json({ success: true, job: result.rows[0] });
  } catch (err) {
    console.error('Create job error:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Update job
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, requirements, location, salary_range, job_type, status, screening_questions } = req.body;

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
      [title, description, requirements, location, salary_range, job_type, status, screening_questions ? JSON.stringify(screening_questions) : null, req.params.id]
    );

    res.json({ success: true, job: result.rows[0] });
  } catch (err) {
    console.error('Update job error:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

// Delete job
router.delete('/:id', authMiddleware, async (req, res) => {
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

module.exports = router;