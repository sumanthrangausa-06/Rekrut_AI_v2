// Company Management Routes
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { generateToken, authMiddleware, optionalAuth } = require('../lib/auth');
const trustscoreService = require('../services/trustscore');

const router = express.Router();

// List of common personal email domains
const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'live.com', 'msn.com', 'me.com', 'inbox.com'
];

// Check if email is a company email
function isCompanyEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain && !PERSONAL_EMAIL_DOMAINS.includes(domain);
}

// Register company and recruiter account
router.post('/register', async (req, res) => {
  try {
    const {
      email, password, name,
      company_name, company_description, industry, company_size,
      website, linkedin_url, headquarters, founded_year
    } = req.body;

    // Validation
    if (!email || !password || !company_name) {
      return res.status(400).json({
        error: 'Email, password, and company name are required'
      });
    }

    // Verify company email domain
    const email_domain = email.split('@')[1]?.toLowerCase();
    const isWorkEmail = isCompanyEmail(email);

    // Check if user exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check if company domain already registered
    if (isWorkEmail) {
      const existingCompany = await pool.query(
        'SELECT id FROM companies WHERE email_domain = $1',
        [email_domain]
      );
      if (existingCompany.rows.length > 0) {
        return res.status(400).json({
          error: 'A company with this email domain already exists. Please contact your administrator.',
          existing_company: true
        });
      }
    }

    // Generate slug from company name
    const slug = company_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check slug uniqueness
    const existingSlug = await pool.query('SELECT id FROM companies WHERE slug = $1', [slug]);
    const finalSlug = existingSlug.rows.length > 0 ? `${slug}-${Date.now()}` : slug;

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create company
      const companyResult = await client.query(
        `INSERT INTO companies (
          name, slug, email_domain, description, industry, company_size,
          website, linkedin_url, headquarters, founded_year, is_verified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [company_name, finalSlug, isWorkEmail ? email_domain : null,
         company_description, industry, company_size,
         website, linkedin_url, headquarters, founded_year,
         isWorkEmail] // Auto-verify if using work email
      );
      const company = companyResult.rows[0];

      // Create recruiter user
      const password_hash = await bcrypt.hash(password, 10);
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, name, role, company_name, company_id)
         VALUES ($1, $2, $3, 'recruiter', $4, $5)
         RETURNING id, email, name, role, company_name, company_id, created_at`,
        [email, password_hash, name, company_name, company.id]
      );
      const user = userResult.rows[0];

      // Set company owner
      await client.query('UPDATE companies SET owner_id = $1 WHERE id = $2', [user.id, company.id]);

      // Initialize TrustScore
      await client.query(
        `INSERT INTO trust_scores (company_id, total_score, score_tier)
         VALUES ($1, $2, 'new')`,
        [company.id, 500]
      );

      // Add verification bonus if work email
      if (isWorkEmail) {
        await client.query(
          `INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
           VALUES ($1, 'verification', 'email_domain', 50, 50, $2)`,
          [company.id, JSON.stringify({ domain: email_domain, verified: true })]
        );
      }

      await client.query('COMMIT');

      // Generate token
      const token = generateToken({ ...user, role: 'recruiter' });

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'recruiter',
          company_id: company.id
        },
        company: {
          id: company.id,
          name: company.name,
          slug: company.slug,
          is_verified: company.is_verified
        },
        token,
        message: isWorkEmail
          ? 'Company verified automatically via email domain!'
          : 'Account created. Consider using a company email for automatic verification.'
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('Company registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get company profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    if (!req.user.company_id) {
      return res.status(400).json({ error: 'No company associated with this account' });
    }

    const result = await pool.query(
      `SELECT c.*, ts.total_score as trust_score, ts.score_tier
       FROM companies c
       LEFT JOIN trust_scores ts ON c.id = ts.company_id
       WHERE c.id = $1`,
      [req.user.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ company: result.rows[0] });
  } catch (err) {
    console.error('Get company profile error:', err);
    res.status(500).json({ error: 'Failed to fetch company profile' });
  }
});

// Update company profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    if (!req.user.company_id) {
      return res.status(400).json({ error: 'No company associated with this account' });
    }

    const {
      name, description, industry, company_size, website,
      linkedin_url, headquarters, founded_year, logo_url,
      culture_description, core_values, benefits, office_locations
    } = req.body;

    // Calculate profile completeness
    const fields = [
      name, description, industry, company_size, website, logo_url, headquarters,
      culture_description,
      core_values && JSON.parse(core_values).length > 0,
      benefits && JSON.parse(benefits).length > 0,
      office_locations && JSON.parse(office_locations).length > 0
    ];
    const completedFields = fields.filter(f => f && (typeof f === 'boolean' ? f : f.length > 0)).length;
    const completenessBonus = Math.round((completedFields / fields.length) * 30);

    const result = await pool.query(
      `UPDATE companies SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        industry = COALESCE($3, industry),
        company_size = COALESCE($4, company_size),
        website = COALESCE($5, website),
        linkedin_url = COALESCE($6, linkedin_url),
        headquarters = COALESCE($7, headquarters),
        founded_year = COALESCE($8, founded_year),
        logo_url = COALESCE($9, logo_url),
        culture_description = COALESCE($10, culture_description),
        core_values = COALESCE($11::jsonb, core_values),
        benefits = COALESCE($12::jsonb, benefits),
        office_locations = COALESCE($13::jsonb, office_locations),
        updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [name, description, industry, company_size, website,
       linkedin_url, headquarters, founded_year, logo_url,
       culture_description, core_values, benefits, office_locations,
       req.user.company_id]
    );

    // Add behavior points for profile completeness
    if (completedFields >= 7) {
      await trustscoreService.addBehaviorComponent(
        req.user.company_id,
        'profile_complete',
        completenessBonus,
        30
      );
    }

    res.json({
      success: true,
      company: result.rows[0],
      message: completedFields >= 7 ? 'Profile updated! TrustScore bonus applied.' : 'Profile updated'
    });
  } catch (err) {
    console.error('Update company profile error:', err);
    res.status(500).json({ error: 'Failed to update company profile' });
  }
});

// Get public company profile
router.get('/:slug', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.slug, c.logo_url, c.description, c.industry,
              c.company_size, c.headquarters, c.website, c.is_verified,
              ts.total_score as trust_score, ts.score_tier
       FROM companies c
       LEFT JOIN trust_scores ts ON c.id = ts.company_id
       WHERE c.slug = $1`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const company = result.rows[0];

    // Get active jobs count
    const jobsCount = await pool.query(
      `SELECT COUNT(*) as count FROM jobs WHERE company_id = $1 AND status = 'active'`,
      [company.id]
    );

    // Get average feedback rating
    const avgRating = await pool.query(
      `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
       FROM candidate_feedback WHERE company_id = $1`,
      [company.id]
    );

    res.json({
      company: {
        ...company,
        active_jobs: parseInt(jobsCount.rows[0].count),
        avg_rating: avgRating.rows[0].avg_rating ? parseFloat(avgRating.rows[0].avg_rating).toFixed(1) : null,
        review_count: parseInt(avgRating.rows[0].review_count)
      }
    });
  } catch (err) {
    console.error('Get public company profile error:', err);
    res.status(500).json({ error: 'Failed to fetch company' });
  }
});

// Verify company (manual verification request)
router.post('/verify', authMiddleware, async (req, res) => {
  try {
    if (!req.user.company_id) {
      return res.status(400).json({ error: 'No company associated with this account' });
    }

    const { linkedin_url, website_proof } = req.body;

    // In production, this would trigger a verification process
    // For now, we'll add partial verification points

    if (linkedin_url) {
      await pool.query(
        'UPDATE companies SET linkedin_url = $1, updated_at = NOW() WHERE id = $2',
        [linkedin_url, req.user.company_id]
      );

      await trustscoreService.addVerificationComponent(
        req.user.company_id,
        'linkedin_added',
        30,
        50
      );
    }

    res.json({
      success: true,
      message: 'Verification request submitted. TrustScore updated.'
    });
  } catch (err) {
    console.error('Company verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Get company team members
router.get('/team/members', authMiddleware, async (req, res) => {
  try {
    if (!req.user.company_id) {
      return res.status(400).json({ error: 'No company associated with this account' });
    }

    const result = await pool.query(
      `SELECT id, email, name, role, created_at
       FROM users
       WHERE company_id = $1
       ORDER BY created_at`,
      [req.user.company_id]
    );

    res.json({ members: result.rows });
  } catch (err) {
    console.error('Get team members error:', err);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

// Invite team member
router.post('/team/invite', authMiddleware, async (req, res) => {
  try {
    if (!req.user.company_id) {
      return res.status(400).json({ error: 'No company associated with this account' });
    }

    const { email, name, role = 'recruiter' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    const password_hash = await bcrypt.hash(tempPassword, 10);

    // Get company name
    const company = await pool.query('SELECT name FROM companies WHERE id = $1', [req.user.company_id]);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, company_name, company_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, role`,
      [email, password_hash, name, role, company.rows[0].name, req.user.company_id]
    );

    // In production, send email with invite link
    res.json({
      success: true,
      member: result.rows[0],
      temp_password: tempPassword, // In production, this would be sent via email
      message: 'Team member invited successfully'
    });
  } catch (err) {
    console.error('Invite team member error:', err);
    res.status(500).json({ error: 'Failed to invite team member' });
  }
});

module.exports = router;
