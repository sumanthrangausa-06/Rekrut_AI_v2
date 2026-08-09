// Company Management Routes
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const {
	generateToken,
	generateRefreshToken,
	authMiddleware,
	optionalAuth,
} = require('../lib/auth');
const trustscoreService = require('../services/trustscore');
const { rateLimits } = require('../lib/distributed-rate-limiter');
const {
	validateRecruiterEmail,
	getBlockedDomainExamples,
	isCompanyEmail,
} = require('../services/email-domain-validator');
const {
	findCompanyByDomain,
	storeVerifiedDomain,
	createJoinRequest,
	approveJoinRequest,
	rejectJoinRequest,
	listPendingJoinRequests,
	getJoinRequestById,
} = require('../services/company-domain-service');

const router = express.Router();

// Re-export for backward compatibility
function isCompanyEmailCompat(email) {
	return isCompanyEmail(email);
}

// Register company and recruiter account
router.post('/register', rateLimits.standard, async (req, res) => {
	try {
		const {
			email,
			password,
			name,
			company_name,
			company_description,
			industry,
			company_size,
			website,
			linkedin_url,
			headquarters,
			founded_year,
			primary_country,
			operating_countries,
		} = req.body;

		// Validation
		if (!email || !password || !company_name) {
			return res.status(400).json({
				error: 'Email, password, and company name are required',
			});
		}

		// --- Issue #103: Enforce company email domain ---
		// 1. Block free/disposable email providers
		const emailValidation = validateRecruiterEmail(email);
		if (!emailValidation.valid) {
			return res.status(400).json({
				error: `${emailValidation.error} Free/disposable email providers (${getBlockedDomainExamples()}) are not allowed for recruiter registration. Please use your company email address.`,
				code: 'BLOCKED_EMAIL_DOMAIN',
			});
		}

		const email_domain = emailValidation.domain;

		// Check if user exists
		const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
		if (existingUser.rows.length > 0) {
			return res.status(400).json({ error: 'Email already registered' });
		}

		// 2. Check if company domain already maps to an existing company
		const existingCompany = await findCompanyByDomain(email_domain);
		if (existingCompany) {
			// 3. Route to approval workflow instead of creating duplicate company
			// Create the user first (without company_id, they'll be pending)
			const password_hash = await bcrypt.hash(password, 13);
			const userResult = await pool.query(
				`INSERT INTO users (email, password_hash, name, role, company_name)
         VALUES ($1, $2, $3, 'recruiter', $4)
         RETURNING id, email, name, role, company_name, created_at`,
				[email, password_hash, name, company_name],
			);
			const user = userResult.rows[0];

			// Create join request for approval
			await createJoinRequest(user.id, existingCompany.id, email, email_domain);

			// Generate tokens so they can log in and see pending status
			const token = generateToken({
				...user,
				role: 'recruiter',
				company_id: null,
				company_name: company_name,
			});
			const { token: refreshToken } = await generateRefreshToken(user.id);

			return res.status(202).json({
				success: true,
				pending_approval: true,
				user: {
					id: user.id,
					email: user.email,
					name: user.name,
					role: 'recruiter',
					company_id: null,
					company_name: company_name,
				},
				company: {
					id: existingCompany.id,
					name: existingCompany.name,
					slug: existingCompany.slug,
				},
				token,
				accessToken: token,
				refreshToken,
				message: `A company with domain "${email_domain}" already exists. Your registration is pending approval from the company administrator.`,
			});
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

			// Create company (with country support)
			const companyCountry = primary_country || 'US';
			const companyCountries = operating_countries || [companyCountry];
			const companyResult = await client.query(
				`INSERT INTO companies (
          name, slug, email_domain, verified_domain, description, industry, company_size,
          website, linkedin_url, headquarters, founded_year, is_verified,
          primary_country, operating_countries, domain_enforced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        RETURNING *`,
				[
					company_name,
					finalSlug,
					email_domain,
					email_domain,
					company_description,
					industry,
					company_size,
					website,
					linkedin_url,
					headquarters,
					founded_year,
					true, // verified via email domain
					companyCountry,
					JSON.stringify(companyCountries),
				],
			);
			const company = companyResult.rows[0];

			// Create recruiter user
			const password_hash = await bcrypt.hash(password, 13);
			const userResult = await client.query(
				`INSERT INTO users (email, password_hash, name, role, company_name, company_id)
         VALUES ($1, $2, $3, 'recruiter', $4, $5)
         RETURNING id, email, name, role, company_name, company_id, created_at`,
				[email, password_hash, name, company_name, company.id],
			);
			const user = userResult.rows[0];

			// Set company owner
			await client.query('UPDATE companies SET owner_id = $1 WHERE id = $2', [user.id, company.id]);

			// Initialize TrustScore
			await client.query(
				`INSERT INTO trust_scores (company_id, total_score, score_tier)
         VALUES ($1, $2, 'new')`,
				[company.id, 500],
			);

			// Add verification bonus for work email (domain verified)
			await client.query(
				`INSERT INTO trust_score_components (company_id, component_type, source_type, points, max_points, metadata)
           VALUES ($1, 'verification', 'email_domain', 50, 50, $2)`,
				[company.id, JSON.stringify({ domain: email_domain, verified: true })],
			);

			await client.query('COMMIT');

			// Generate tokens (access + refresh)
			const token = generateToken({
				...user,
				role: 'recruiter',
				company_id: company.id,
				company_name: company_name,
			});
			const { token: refreshToken } = await generateRefreshToken(user.id);

			res.status(201).json({
				success: true,
				user: {
					id: user.id,
					email: user.email,
					name: user.name,
					role: 'recruiter',
					company_id: company.id,
					company_name: company_name,
				},
				company: {
					id: company.id,
					name: company.name,
					slug: company.slug,
					is_verified: true,
					verified_domain: company.verified_domain,
				},
				token,
				accessToken: token,
				refreshToken,
				message: 'Company verified automatically via email domain!',
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
			[req.user.company_id],
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
			name,
			description,
			industry,
			company_size,
			website,
			linkedin_url,
			headquarters,
			founded_year,
			logo_url,
			culture_description,
			core_values,
			benefits,
			office_locations,
			primary_country,
			operating_countries,
		} = req.body;

		// Calculate profile completeness
		const fields = [
			name,
			description,
			industry,
			company_size,
			website,
			logo_url,
			headquarters,
			culture_description,
			core_values && JSON.parse(core_values).length > 0,
			benefits && JSON.parse(benefits).length > 0,
			office_locations && JSON.parse(office_locations).length > 0,
		];
		const completedFields = fields.filter(
			(f) => f && (typeof f === 'boolean' ? f : f.length > 0),
		).length;
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
        primary_country = COALESCE($15, primary_country),
        operating_countries = COALESCE($16::jsonb, operating_countries),
        updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
			[
				name,
				description,
				industry,
				company_size,
				website,
				linkedin_url,
				headquarters,
				founded_year,
				logo_url,
				culture_description,
				core_values,
				benefits,
				office_locations,
				req.user.company_id,
				primary_country || null,
				operating_countries ? JSON.stringify(operating_countries) : null,
			],
		);

		// Add behavior points for profile completeness
		if (completedFields >= 7) {
			await trustscoreService.addBehaviorComponent(
				req.user.company_id,
				'profile_complete',
				completenessBonus,
				30,
			);
		}

		res.json({
			success: true,
			company: result.rows[0],
			message:
				completedFields >= 7 ? 'Profile updated! TrustScore bonus applied.' : 'Profile updated',
		});
	} catch (err) {
		console.error('Update company profile error:', err);
		res.status(500).json({ error: 'Failed to update company profile' });
	}
});

// Get public company profile (full data for public page)
router.get('/public/:slug', optionalAuth, async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT c.id, c.name, c.slug, c.logo_url, c.description, c.industry,
              c.company_size, c.headquarters, c.website, c.linkedin_url, c.founded_year,
              c.is_verified, c.culture_description, c.core_values, c.benefits, c.office_locations,
              ts.total_score as trust_score, ts.score_tier
       FROM companies c
       LEFT JOIN trust_scores ts ON c.id = ts.company_id
       WHERE c.slug = $1`,
			[req.params.slug],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const company = result.rows[0];

		// Get active jobs count
		const jobsCount = await pool.query(
			`SELECT COUNT(*) as count FROM jobs WHERE company_id = $1 AND status = 'active'`,
			[company.id],
		);

		// Get average feedback rating with breakdowns
		const avgRating = await pool.query(
			`SELECT 
        AVG(rating) as avg_rating,
        AVG(communication_rating) as avg_communication,
        AVG(process_rating) as avg_process,
        COUNT(*) as review_count
       FROM candidate_feedback WHERE company_id = $1`,
			[company.id],
		);

		const ratingData = avgRating.rows[0];
		const avgRatingVal = ratingData.avg_rating ? parseFloat(ratingData.avg_rating) : 0;

		res.json({
			company: {
				...company,
				active_jobs: parseInt(jobsCount.rows[0].count, 10),
				total_ratings: parseInt(ratingData.review_count, 10),
				avg_rating: avgRatingVal ? parseFloat(avgRatingVal.toFixed(1)) : 0,
				avg_overall: avgRatingVal ? parseFloat(avgRatingVal.toFixed(1)) : 0,
				avg_interview: ratingData.avg_process
					? parseFloat(parseFloat(ratingData.avg_process).toFixed(1))
					: 0,
				avg_communication: ratingData.avg_communication
					? parseFloat(parseFloat(ratingData.avg_communication).toFixed(1))
					: 0,
				avg_transparency: avgRatingVal ? parseFloat((avgRatingVal * 0.95).toFixed(1)) : 0,
				avg_culture: avgRatingVal ? parseFloat((avgRatingVal * 0.9).toFixed(1)) : 0,
				avg_growth: avgRatingVal ? parseFloat((avgRatingVal * 0.85).toFixed(1)) : 0,
			},
		});
	} catch (err) {
		console.error('Get public company profile error:', err);
		res.status(500).json({ error: 'Failed to fetch company' });
	}
});

// Get company jobs (public)
router.get('/:slug/jobs', optionalAuth, async (req, res) => {
	try {
		const company = await pool.query('SELECT id FROM companies WHERE slug = $1', [req.params.slug]);
		if (company.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const jobs = await pool.query(
			`SELECT id, title, location, salary_min, salary_max, job_type, created_at, status
       FROM jobs WHERE company_id = $1 AND status = 'active'
       ORDER BY created_at DESC`,
			[company.rows[0].id],
		);

		const formattedJobs = jobs.rows.map((j) => ({
			id: j.id,
			title: j.title,
			location: j.location || 'Remote',
			salary_range:
				j.salary_min && j.salary_max
					? `$${j.salary_min.toLocaleString()} - $${j.salary_max.toLocaleString()}`
					: null,
			job_type: j.job_type || 'full-time',
			created_at: j.created_at,
		}));

		res.json({ jobs: formattedJobs });
	} catch (err) {
		console.error('Get company jobs error:', err);
		res.status(500).json({ error: 'Failed to fetch jobs' });
	}
});

// Get company reviews (public)
router.get('/:slug/reviews', optionalAuth, async (req, res) => {
	try {
		const company = await pool.query('SELECT id FROM companies WHERE slug = $1', [req.params.slug]);
		if (company.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const reviews = await pool.query(
			`SELECT 
        rating as overall_rating,
        communication_rating as communication,
        process_rating as interview_experience,
        feedback_text as review_text,
        created_at,
        CASE WHEN is_anonymous THEN 'Anonymous' ELSE 'Candidate' END as reviewer_name
       FROM candidate_feedback
       WHERE company_id = $1 AND rating IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10`,
			[company.rows[0].id],
		);

		const formattedReviews = reviews.rows.map((r) => ({
			overall_rating: r.overall_rating || 0,
			interview_experience: r.interview_experience || 0,
			communication: r.communication || 0,
			review_text: r.review_text || '',
			pros: '',
			cons: '',
			created_at: r.created_at,
			reviewer_name: r.reviewer_name,
		}));

		res.json({ reviews: formattedReviews });
	} catch (err) {
		console.error('Get company reviews error:', err);
		res.status(500).json({ error: 'Failed to fetch reviews' });
	}
});

// Get company team (public)
router.get('/:slug/team', optionalAuth, async (req, res) => {
	try {
		const company = await pool.query('SELECT id FROM companies WHERE slug = $1', [req.params.slug]);
		if (company.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const team = await pool.query(
			`SELECT id, name, role, avatar_url
       FROM users
       WHERE company_id = $1 AND role IN ('recruiter', 'hiring_manager', 'employer', 'admin')
       ORDER BY created_at DESC
       LIMIT 20`,
			[company.rows[0].id],
		);

		res.json({ team: team.rows });
	} catch (err) {
		console.error('Get company team error:', err);
		res.status(500).json({ error: 'Failed to fetch team' });
	}
});

// Get public company profile (legacy — keep for backward compat)
router.get('/:slug', optionalAuth, async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT c.id, c.name, c.slug, c.logo_url, c.description, c.industry,
              c.company_size, c.headquarters, c.website, c.is_verified,
              ts.total_score as trust_score, ts.score_tier
       FROM companies c
       LEFT JOIN trust_scores ts ON c.id = ts.company_id
       WHERE c.slug = $1`,
			[req.params.slug],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const company = result.rows[0];

		// Get active jobs count
		const jobsCount = await pool.query(
			`SELECT COUNT(*) as count FROM jobs WHERE company_id = $1 AND status = 'active'`,
			[company.id],
		);

		// Get average feedback rating
		const avgRating = await pool.query(
			`SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
       FROM candidate_feedback WHERE company_id = $1`,
			[company.id],
		);

		res.json({
			company: {
				...company,
				active_jobs: parseInt(jobsCount.rows[0].count, 10),
				avg_rating: avgRating.rows[0].avg_rating
					? parseFloat(avgRating.rows[0].avg_rating).toFixed(1)
					: null,
				review_count: parseInt(avgRating.rows[0].review_count, 10),
			},
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

		const { linkedin_url } = req.body;

		// In production, this would trigger a verification process
		// For now, we'll add partial verification points

		if (linkedin_url) {
			await pool.query('UPDATE companies SET linkedin_url = $1, updated_at = NOW() WHERE id = $2', [
				linkedin_url,
				req.user.company_id,
			]);

			await trustscoreService.addVerificationComponent(
				req.user.company_id,
				'linkedin_added',
				30,
				50,
			);
		}

		res.json({
			success: true,
			message: 'Verification request submitted. TrustScore updated.',
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
			[req.user.company_id],
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

		// Validate invited email domain matches company domain
		const companyResult = await pool.query(
			'SELECT verified_domain, email_domain FROM companies WHERE id = $1',
			[req.user.company_id],
		);
		const company = companyResult.rows[0];
		const companyDomain = company?.verified_domain || company?.email_domain;

		if (companyDomain) {
			const invitedDomain = email.split('@')[1]?.toLowerCase();
			if (invitedDomain) {
				const { normalizeDomain } = require('../services/email-domain-validator');
				const normalizedInvited = normalizeDomain(invitedDomain);
				const normalizedCompany = normalizeDomain(companyDomain);
				if (normalizedInvited !== normalizedCompany) {
					return res.status(400).json({
						error: `Invited email domain "${invitedDomain}" does not match the company domain "${companyDomain}". All team members must use the company's verified email domain.`,
						code: 'DOMAIN_MISMATCH',
					});
				}
			}
		}

		// Check if user already exists
		const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
		if (existing.rows.length > 0) {
			return res.status(400).json({ error: 'User with this email already exists' });
		}

		// Generate temporary password
		const tempPassword = crypto.randomBytes(12).toString('base64url').slice(0, 16);
		const password_hash = await bcrypt.hash(tempPassword, 13);

		// Get company name
		const companyNameResult = await pool.query('SELECT name FROM companies WHERE id = $1', [
			req.user.company_id,
		]);

		const result = await pool.query(
			`INSERT INTO users (email, password_hash, name, role, company_name, company_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, role`,
			[email, password_hash, name, role, companyNameResult.rows[0].name, req.user.company_id],
		);

		// In production, send email with invite link
		res.json({
			success: true,
			member: result.rows[0],
			temp_password: tempPassword, // In production, this would be sent via email
			message: 'Team member invited successfully',
		});
	} catch (err) {
		console.error('Invite team member error:', err);
		res.status(500).json({ error: 'Failed to invite team member' });
	}
});

// ============= JOIN REQUEST MANAGEMENT (Issue #103) =============

// List pending join requests for the current company
router.get('/join-requests', authMiddleware, async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}

		// Only company owner/admin or existing recruiters can approve
		const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Not authorized to view join requests' });
		}

		const requests = await listPendingJoinRequests(req.user.company_id);
		res.json({ success: true, requests });
	} catch (err) {
		console.error('List join requests error:', err);
		res.status(500).json({ error: 'Failed to fetch join requests' });
	}
});

// Approve a join request
router.post('/join-requests/:id/approve', authMiddleware, async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}

		const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Not authorized to approve join requests' });
		}

		const request = await getJoinRequestById(req.params.id);
		if (!request) {
			return res.status(404).json({ error: 'Join request not found' });
		}

		// Verify the request is for the current user's company
		if (request.company_id !== req.user.company_id) {
			return res.status(403).json({ error: 'Not authorized to approve this request' });
		}

		const approved = await approveJoinRequest(request.id, req.user.id);
		if (!approved) {
			return res.status(400).json({ error: 'Failed to approve join request' });
		}

		res.json({
			success: true,
			message: 'Recruiter approved and added to company',
			request: approved,
		});
	} catch (err) {
		console.error('Approve join request error:', err);
		res.status(500).json({ error: 'Failed to approve join request' });
	}
});

// Reject a join request
router.post('/join-requests/:id/reject', authMiddleware, async (req, res) => {
	try {
		if (!req.user.company_id) {
			return res.status(400).json({ error: 'No company associated with this account' });
		}

		const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
		if (!recruiterRoles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Not authorized to reject join requests' });
		}

		const request = await getJoinRequestById(req.params.id);
		if (!request) {
			return res.status(404).json({ error: 'Join request not found' });
		}

		if (request.company_id !== req.user.company_id) {
			return res.status(403).json({ error: 'Not authorized to reject this request' });
		}

		const { reason } = req.body;
		const rejected = await rejectJoinRequest(request.id, req.user.id, reason);
		if (!rejected) {
			return res.status(400).json({ error: 'Failed to reject join request' });
		}

		res.json({
			success: true,
			message: 'Join request rejected',
			request: rejected,
		});
	} catch (err) {
		console.error('Reject join request error:', err);
		res.status(500).json({ error: 'Failed to reject join request' });
	}
});

// Check if current user has a pending join request
router.get('/join-requests/me', authMiddleware, async (req, res) => {
	try {
		const { findPendingJoinRequest } = require('../services/company-domain-service');
		const request = await findPendingJoinRequest(req.user.id);

		if (!request) {
			return res.json({ success: true, hasPendingRequest: false });
		}

		const company = await pool.query('SELECT name, slug FROM companies WHERE id = $1', [
			request.company_id,
		]);

		res.json({
			success: true,
			hasPendingRequest: true,
			request: {
				...request,
				company_name: company.rows[0]?.name,
				company_slug: company.rows[0]?.slug,
			},
		});
	} catch (err) {
		console.error('Get my join request error:', err);
		res.status(500).json({ error: 'Failed to fetch join request status' });
	}
});

module.exports = router;
