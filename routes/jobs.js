const express = require('express');
const pool = require('../lib/db');
const { authMiddleware, optionalAuth, requireRole } = require('../lib/auth');

const router = express.Router();

// List jobs (public)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { status = 'active', limit = 20, offset = 0 } = req.query;
    
    const result = await pool.query(
      `SELECT j.*, u.company_name as poster_company
       FROM jobs j
       LEFT JOIN users u ON j.user_id = u.id
       WHERE j.status = $1
       ORDER BY j.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    res.json({ jobs: result.rows });
  } catch (err) {
    console.error('List jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Get single job
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT j.*, u.company_name as poster_company, u.name as poster_name
       FROM jobs j
       LEFT JOIN users u ON j.user_id = u.id
       WHERE j.id = $1`,
      [req.params.id]
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
      [req.user.id, req.user.company_id || null, title, company || req.user.company_name, description, requirements, location, salary_range, job_type, JSON.stringify(screening_questions || []),
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