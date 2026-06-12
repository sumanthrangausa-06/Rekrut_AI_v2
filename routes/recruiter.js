// Recruiter Dashboard & Job Management Routes
const express = require('express');
const crypto = require('node:crypto');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const trustscoreService = require('../services/trustscore');
const jobOptimizer = require('../services/job-optimizer');
const calendarService = require('../server/services/calendar-service');
const { AuditLogger } = require('../services/auditLogger');
const emailService = require('../lib/email-service');

const router = express.Router();

function badRequest(message) {
	const err = new Error(message);
	err.statusCode = 400;
	return err;
}

function normalizeTextField(value, maxLength, fieldName) {
	if (value === undefined || value === null) return value;
	const normalized = String(value)
		.replace(/<[^>]*>/g, '')
		.trim();
	if (!normalized) return null;
	if (normalized.length > maxLength) {
		throw badRequest(`${fieldName} must be ${maxLength} characters or fewer`);
	}
	return normalized;
}

function normalizeSalary(value, fieldName) {
	if (value === undefined || value === null || value === '') return value;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw badRequest(`${fieldName} must be a non-negative integer`);
	}
	return parsed;
}

// Middleware to require recruiter role — auto-provisions company if recruiter has company_name but no company_id
async function requireRecruiter(req, res, next) {
	const recruiterRoles = ['recruiter', 'hiring_manager', 'employer', 'admin'];
	if (!recruiterRoles.includes(req.user.role)) {
		return res.status(403).json({ error: 'Recruiter access required' });
	}

	// Auto-provision company for recruiters with company_name but no company_id
	if (!req.user.company_id && req.user.company_name) {
		try {
			const slug = req.user.company_name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '')
				.substring(0, 50);
			const companyResult = await pool.query(
				`INSERT INTO companies (owner_id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET slug = companies.slug
         RETURNING id`,
				[req.user.id, req.user.company_name, `${slug}-${req.user.id}`],
			);
			const companyId = companyResult.rows[0].id;
			await pool.query('UPDATE users SET company_id = $1 WHERE id = $2', [companyId, req.user.id]);
			req.user.company_id = companyId;
			console.log(
				`Auto-provisioned company "${req.user.company_name}" (id=${companyId}) for user ${req.user.id}`,
			);
		} catch (e) {
			console.error('Failed to auto-provision company for recruiter:', e.message);
			return res.status(403).json({ error: 'Recruiter access required — company setup failed' });
		}
	}

	if (!req.user.company_id) {
		return res.status(403).json({ error: 'Recruiter access required — no company associated' });
	}

	next();
}

// Dashboard overview
router.get('/dashboard', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const companyId = req.user.company_id;
		const days = parseInt(req.query.days, 10) || 30;
		const dateFilter = days > 0 ? `AND applied_at >= NOW() - INTERVAL '1 day' * $2` : '';

		// Get TrustScore
		const trustScore = await trustscoreService.calculateTrustScore(companyId);

		// Get job stats
		const jobStats = await pool.query(
			`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active_jobs,
        COUNT(*) FILTER (WHERE status = 'paused') as paused_jobs,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_jobs
      FROM jobs WHERE company_id = $1
    `,
			[companyId],
		);

		// Get application stats (with reviewed count and rejected)
		const appStats = await pool.query(
			`
      SELECT
        COUNT(*) as total_applications,
        COUNT(*) FILTER (WHERE status = 'applied') as new_applications,
        COUNT(*) FILTER (WHERE status = 'screening') as screening,
        COUNT(*) FILTER (WHERE status = 'reviewed' OR status = 'screening') as reviewed,
        COUNT(*) FILTER (WHERE status = 'interviewed') as interviewed,
        COUNT(*) FILTER (WHERE status = 'offered') as offered,
        COUNT(*) FILTER (WHERE status = 'hired') as hired,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected
      FROM job_applications WHERE company_id = $1 ${dateFilter}
    `,
			[companyId, days],
		);

		// Get total job views (graceful if job_analytics doesn't exist)
		let totalViews = 0;
		try {
			const viewStats = await pool.query(
				`
        SELECT COALESCE(SUM(views), 0) as total_views
        FROM job_analytics WHERE job_id IN (
          SELECT id FROM jobs WHERE company_id = $1
        )
      `,
				[companyId],
			);
			totalViews = parseInt(viewStats.rows[0]?.total_views || '0', 10);
		} catch (_viewErr) {
			console.log('[dashboard] job_analytics table not available, total_views = 0');
		}

		// Get average time to hire (graceful if hired_at doesn't exist)
		let avgTimeToHire = null;
		try {
			const timeToHire = await pool.query(
				`
        SELECT AVG(EXTRACT(EPOCH FROM (hired_at - applied_at)) / 86400) as avg_days
        FROM job_applications
        WHERE company_id = $1 ${dateFilter} AND status = 'hired' AND hired_at IS NOT NULL
      `,
				[companyId, days],
			);
			avgTimeToHire = timeToHire.rows[0]?.avg_days
				? parseFloat(timeToHire.rows[0].avg_days).toFixed(1)
				: null;
		} catch (_timeErr) {
			console.log('[dashboard] hired_at column not available, avg_time_to_hire = null');
		}

		// Get OmniScore distribution (graceful if omniscore_at_apply doesn't exist)
		let scoreDistribution = { 900: 0, 800: 0, 700: 0, 600: 0, below: 0 };
		try {
			const scoreDist = await pool.query(
				`
        SELECT
          COUNT(*) FILTER (WHERE omniscore_at_apply >= 900) as "900",
          COUNT(*) FILTER (WHERE omniscore_at_apply >= 800 AND omniscore_at_apply < 900) as "800",
          COUNT(*) FILTER (WHERE omniscore_at_apply >= 700 AND omniscore_at_apply < 800) as "700",
          COUNT(*) FILTER (WHERE omniscore_at_apply >= 600 AND omniscore_at_apply < 700) as "600",
          COUNT(*) FILTER (WHERE omniscore_at_apply < 600 OR omniscore_at_apply IS NULL) as below
        FROM job_applications WHERE company_id = $1 ${dateFilter}
      `,
				[companyId, days],
			);
			scoreDistribution = scoreDist.rows[0] || scoreDistribution;
		} catch (_scoreErr) {
			console.log('[dashboard] omniscore_at_apply column not available, using defaults');
		}

		// ─── HIRING VELOCITY ───
		let hiringVelocity = [];
		try {
			const lookbackMonths = days > 0 && days <= 30 ? 1 : days <= 90 ? 3 : 6;
			const velocityResult = await pool.query(
				`
        SELECT
          TO_CHAR(DATE_TRUNC('month', applied_at), 'Mon') as month,
          COUNT(*) as applications,
          COUNT(*) FILTER (WHERE status = 'hired') as hired,
          COUNT(*) FILTER (WHERE status = 'interviewed') as interviews
        FROM job_applications
        WHERE company_id = $1 AND applied_at >= NOW() - INTERVAL '1 month' * $2
        GROUP BY DATE_TRUNC('month', applied_at)
        ORDER BY DATE_TRUNC('month', applied_at) ASC
        LIMIT 6
      `,
				[companyId, lookbackMonths],
			);
			hiringVelocity = velocityResult.rows.map((r) => ({
				month: r.month,
				applications: parseInt(r.applications, 10) || 0,
				hired: parseInt(r.hired, 10) || 0,
				interviews: parseInt(r.interviews, 10) || 0,
			}));
		} catch (_velErr) {
			console.log('[dashboard] hiring_velocity query failed, using defaults');
		}

		// ─── TIME TO HIRE BY STAGE ───
		let timeToHireByStage = [];
		try {
			const stageResult = await pool.query(
				`
        SELECT
          'Applied → Screened' as stage,
          AVG(EXTRACT(EPOCH FROM (updated_at - applied_at)) / 86400) as avg_days,
          COUNT(*) as count
        FROM job_applications
        WHERE company_id = $1 AND status IN ('screening', 'reviewed', 'interviewed', 'offered', 'hired')
        AND applied_at IS NOT NULL AND updated_at IS NOT NULL ${dateFilter}
        UNION ALL
        SELECT
          'Screened → Interview' as stage,
          AVG(EXTRACT(EPOCH FROM (updated_at - applied_at)) / 86400) as avg_days,
          COUNT(*) as count
        FROM job_applications
        WHERE company_id = $1 AND status IN ('interviewed', 'offered', 'hired')
        AND applied_at IS NOT NULL AND updated_at IS NOT NULL ${dateFilter}
        UNION ALL
        SELECT
          'Interview → Offer' as stage,
          AVG(EXTRACT(EPOCH FROM (updated_at - applied_at)) / 86400) as avg_days,
          COUNT(*) as count
        FROM job_applications
        WHERE company_id = $1 AND status IN ('offered', 'hired')
        AND applied_at IS NOT NULL AND updated_at IS NOT NULL ${dateFilter}
        UNION ALL
        SELECT
          'Offer → Hired' as stage,
          AVG(EXTRACT(EPOCH FROM (updated_at - applied_at)) / 86400) as avg_days,
          COUNT(*) as count
        FROM job_applications
        WHERE company_id = $1 AND status = 'hired'
        AND applied_at IS NOT NULL AND updated_at IS NOT NULL ${dateFilter}
      `,
				[companyId, days],
			);
			timeToHireByStage = stageResult.rows.map((r) => ({
				stage: r.stage,
				avg_days: r.avg_days ? parseFloat(r.avg_days).toFixed(1) : 0,
				count: parseInt(r.count, 10) || 0,
			}));
		} catch (_stageErr) {
			console.log('[dashboard] time_to_hire_by_stage query failed, using defaults');
		}

		// ─── SOURCE BREAKDOWN (graceful) ───
		let sourceBreakdown = [
			{ name: 'Direct', count: 0, percentage: 0 },
			{ name: 'LinkedIn', count: 0, percentage: 0 },
			{ name: 'Indeed', count: 0, percentage: 0 },
			{ name: 'Referral', count: 0, percentage: 0 },
		];
		try {
			const sourceResult = await pool.query(
				`
        SELECT COALESCE(source, 'Direct') as name, COUNT(*) as count
        FROM job_applications
        WHERE company_id = $1 ${dateFilter}
        GROUP BY source
      `,
				[companyId, days],
			);
			const total = sourceResult.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0) || 1;
			sourceBreakdown = sourceResult.rows.map((r) => ({
				name: r.name,
				count: parseInt(r.count, 10),
				percentage: Math.round((parseInt(r.count, 10) / total) * 100),
			}));
		} catch (_sourceErr) {
			console.log('[dashboard] source tracking not available, using default breakdown');
		}

		// ─── DIVERSITY METRICS (graceful) ───
		let diversityMetrics = null;
		try {
			const genderResult = await pool.query(
				`
        SELECT
          COALESCE(cp.gender, 'Unknown') as label,
          COUNT(*) as count
        FROM job_applications ja
        JOIN candidate_profiles cp ON ja.candidate_id = cp.user_id
        WHERE ja.company_id = $1 ${dateFilter}
        GROUP BY cp.gender
      `,
				[companyId, days],
			);
			const totalGender = genderResult.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0) || 1;
			const genderDistribution = genderResult.rows.map((r) => ({
				label: r.label,
				percentage: Math.round((parseInt(r.count, 10) / totalGender) * 100),
			}));

			const ethnicityResult = await pool.query(
				`
        SELECT
          COALESCE(cp.ethnicity, 'Unknown') as label,
          COUNT(*) as count
        FROM job_applications ja
        JOIN candidate_profiles cp ON ja.candidate_id = cp.user_id
        WHERE ja.company_id = $1 ${dateFilter}
        GROUP BY cp.ethnicity
      `,
				[companyId, days],
			);
			const totalEthnicity =
				ethnicityResult.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0) || 1;
			const ethnicityDistribution = ethnicityResult.rows.map((r) => ({
				label: r.label,
				percentage: Math.round((parseInt(r.count, 10) / totalEthnicity) * 100),
			}));

			diversityMetrics = {
				gender_distribution: genderDistribution,
				ethnicity_distribution: ethnicityDistribution,
			};
		} catch (_divErr) {
			console.log('[dashboard] diversity metrics not available');
		}

		// ─── COST PER HIRE & QUALITY OF HIRE ───
		let costPerHire = null;
		let qualityOfHire = null;
		try {
			const hiredCount = parseInt(appStats.rows[0].hired, 10) || 0;
			if (hiredCount > 0) {
				costPerHire = 2450; // Mock until real cost tracking is implemented
			}
			const qualityResult = await pool.query(
				`
        SELECT AVG(omniscore_at_apply) as avg_score
        FROM job_applications
        WHERE company_id = $1 ${dateFilter} AND status = 'hired' AND omniscore_at_apply IS NOT NULL
      `,
				[companyId, days],
			);
			const avgScore = parseFloat(qualityResult.rows[0]?.avg_score) || 0;
			if (avgScore > 0) {
				qualityOfHire = Math.min(5, Math.max(1, avgScore / 200)).toFixed(1); // Scale 1000 -> 5
			}
		} catch (_err) {
			console.log('[dashboard] quality metrics not available');
		}

		// Get upcoming interviews
		const upcomingInterviews = await pool.query(
			`
      SELECT si.id, si.scheduled_at, si.interview_type, si.status,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title
      FROM scheduled_interviews si
      JOIN users u ON si.candidate_id = u.id
      JOIN jobs j ON si.job_id = j.id
      WHERE si.company_id = $1
        AND si.scheduled_at > NOW()
        AND si.status = 'scheduled'
      ORDER BY si.scheduled_at
      LIMIT 5
    `,
			[companyId],
		);

		// Get recent applications
		const recentApps = await pool.query(
			`
      SELECT ja.id, ja.status, ja.applied_at, ja.omniscore_at_apply,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title, j.id as job_id
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      JOIN jobs j ON ja.job_id = j.id
      WHERE ja.company_id = $1 ${dateFilter}
      ORDER BY ja.applied_at DESC
      LIMIT 10
    `,
			[companyId, days],
		);

		res.json({
			success: true,
			trust_score: trustScore,
			job_stats: {
				...jobStats.rows[0],
				total_views: totalViews,
			},
			application_stats: {
				...appStats.rows[0],
			},
			avg_time_to_hire: avgTimeToHire,
			score_distribution: scoreDistribution,
			source_breakdown: sourceBreakdown,
			hiring_velocity: hiringVelocity,
			time_to_hire_by_stage: timeToHireByStage,
			diversity_metrics: diversityMetrics,
			cost_per_hire: costPerHire,
			quality_of_hire: qualityOfHire,
			upcoming_interviews: upcomingInterviews.rows,
			recent_applications: recentApps.rows,
		});
	} catch (err) {
		console.error('Dashboard error:', err);
		res.status(500).json({ error: 'Failed to load dashboard' });
	}
});

// Get all jobs for company
router.get('/jobs', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { status, limit = 50, offset = 0 } = req.query;

		let query = `
      SELECT j.*,
             COALESCE(ja.views, 0) as views,
             COALESCE((SELECT COUNT(*) FROM job_applications japp WHERE japp.job_id = j.id), 0) as application_count,
             COALESCE(ja.interviews_scheduled, 0) as interviews
      FROM jobs j
      LEFT JOIN job_analytics ja ON j.id = ja.job_id
      WHERE (j.company_id = $1 OR j.user_id = $2)
    `;
		const params = [req.user.company_id, req.user.id];

		if (status) {
			query += ` AND j.status = $${params.length + 1}`;
			params.push(status);
		}

		query += ` ORDER BY j.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
		params.push(limit, offset);

		const result = await pool.query(query, params);

		res.json({ jobs: result.rows });
	} catch (err) {
		console.error('Get jobs error:', err);
		res.status(500).json({ error: 'Failed to fetch jobs' });
	}
});

// Create job with optional AI optimization
router.post('/jobs', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const {
			title,
			description,
			requirements,
			location,
			salary_range,
			job_type,
			screening_questions,
			optimize = false, // Flag to run AI optimization
		} = req.body;

		const sanitizedTitle = normalizeTextField(title, 120, 'Job title');
		const sanitizedDescription = normalizeTextField(description, 8000, 'Description');
		const sanitizedRequirements = normalizeTextField(requirements, 8000, 'Requirements');
		const sanitizedLocation = normalizeTextField(location, 200, 'Location');

		if (!sanitizedTitle) {
			return res.status(400).json({ error: 'Job title is required' });
		}

		if (salary_range !== undefined && salary_range !== null && salary_range !== '') {
			const salaryText = String(salary_range).trim();
			const rangeMatch = salaryText.match(/^(\d+)\s*[-–]\s*(\d+)$/);
			if (rangeMatch) {
				const minSalary = normalizeSalary(rangeMatch[1], 'salary_range minimum');
				const maxSalary = normalizeSalary(rangeMatch[2], 'salary_range maximum');
				if (minSalary > maxSalary) {
					return res.status(400).json({ error: 'Minimum salary cannot exceed maximum salary' });
				}
			}
		}

		// Normalize job_type to lowercase to match CHECK constraint
		const validJobTypes = ['full-time', 'part-time', 'contract', 'internship', 'freelance'];
		const normalizedJobType = job_type ? job_type.toLowerCase().trim() : 'full-time';
		if (!validJobTypes.includes(normalizedJobType)) {
			return res
				.status(400)
				.json({ error: `Invalid job type. Must be one of: ${validJobTypes.join(', ')}` });
		}

		let finalDescription = sanitizedDescription;
		let finalRequirements = sanitizedRequirements;
		let optimizationResult = null;

		// Run AI optimization if requested
		if (optimize) {
			try {
				optimizationResult = await jobOptimizer.optimizeJobDescription({
					title: sanitizedTitle,
					description: sanitizedDescription,
					requirements: sanitizedRequirements,
					location: sanitizedLocation,
					salary_range,
					job_type,
					company: req.user.company_name,
				});
				finalDescription = optimizationResult.optimized_description || sanitizedDescription;
				finalRequirements = optimizationResult.optimized_requirements || sanitizedRequirements;
			} catch (e) {
				console.error('Job optimization error:', e);
			}
		}

		// Create job
		const result = await pool.query(
			`INSERT INTO jobs (user_id, company_id, title, company, description, requirements, location, salary_range, job_type, screening_questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
			[
				req.user.id,
				req.user.company_id,
				sanitizedTitle,
				req.user.company_name,
				finalDescription,
				finalRequirements,
				sanitizedLocation,
				salary_range,
				normalizedJobType,
				screening_questions ? JSON.stringify(screening_questions) : null,
			],
		);

		const job = result.rows[0];

		// Create analytics entry
		await pool.query('INSERT INTO job_analytics (job_id) VALUES ($1)', [job.id]);

		// Analyze and add authenticity score
		try {
			const analysis = await jobOptimizer.analyzeJobPosting({
				title: sanitizedTitle,
				description: finalDescription,
				requirements: finalRequirements,
				location: sanitizedLocation,
				salary_range,
				job_type,
				company: req.user.company_name,
			});

			await trustscoreService.addJobAuthenticityComponent(
				req.user.company_id,
				job.id,
				analysis.overall_score,
			);

			res.json({
				success: true,
				job,
				optimization: optimizationResult,
				analysis,
				message: optimize ? 'Job created with AI optimization!' : 'Job created successfully',
			});
		} catch (_e) {
			res.json({ success: true, job });
		}
	} catch (err) {
		if (err.statusCode === 400) {
			return res.status(400).json({ error: err.message });
		}
		console.error('Create job error:', err);
		res.status(500).json({ error: 'Failed to create job' });
	}
});

// Analyze job posting
router.post('/jobs/analyze', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const analysis = await jobOptimizer.analyzeJobPosting(req.body);
		res.json({ success: true, analysis });
	} catch (err) {
		console.error('Analyze job error:', err);
		res.status(500).json({ error: 'Failed to analyze job' });
	}
});

// Optimize job description with AI
router.post('/jobs/optimize', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const optimized = await jobOptimizer.optimizeJobDescription(req.body);
		res.json({ success: true, optimized });
	} catch (err) {
		console.error('Optimize job error:', err);
		res.status(500).json({ error: 'Failed to optimize job' });
	}
});

// Get salary insights
router.get('/salary-insights', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { title, location, experience_level } = req.query;

		if (!title) {
			return res.status(400).json({ error: 'Job title is required' });
		}

		const insights = await jobOptimizer.getSalaryInsights(title, location, experience_level);
		res.json({ success: true, insights });
	} catch (err) {
		console.error('Salary insights error:', err);
		res.status(500).json({ error: 'Failed to get salary insights' });
	}
});

// Generate complete job description from title + optional notes
router.post('/jobs/generate', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { title, brief_notes, location, job_type } = req.body;

		if (!title) {
			return res.status(400).json({ error: 'Job title is required' });
		}

		const generated = await jobOptimizer.generateJobDescription(title, brief_notes, {
			location,
			job_type,
			company: req.user.company_name,
		});
		res.json({ success: true, generated });
	} catch (err) {
		console.error('Generate job description error:', err);
		res.status(500).json({ error: 'Failed to generate job description' });
	}
});

// Suggest skills and requirements for a role
router.post('/jobs/suggest-skills', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { title, description, current_skills } = req.body;

		if (!title) {
			return res.status(400).json({ error: 'Job title is required' });
		}

		const suggestions = await jobOptimizer.suggestSkillsForRole(
			title,
			description,
			current_skills || [],
		);
		res.json({ success: true, suggestions });
	} catch (err) {
		console.error('Suggest skills error:', err);
		res.status(500).json({ error: 'Failed to suggest skills' });
	}
});

// Suggest optimized job titles
router.post('/jobs/suggest-title', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { title, description } = req.body;

		if (!title) {
			return res.status(400).json({ error: 'Current job title is required' });
		}

		const suggestions = await jobOptimizer.suggestJobTitles(title, description);
		res.json({ success: true, suggestions });
	} catch (err) {
		console.error('Suggest title error:', err);
		res.status(500).json({ error: 'Failed to suggest titles' });
	}
});

// Update job
router.put('/jobs/:id', authMiddleware, requireRecruiter, async (req, res) => {
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

		const sanitizedTitle =
			title !== undefined ? normalizeTextField(title, 120, 'Job title') : title;
		const sanitizedDescription =
			description !== undefined
				? normalizeTextField(description, 8000, 'Description')
				: description;
		const sanitizedRequirements =
			requirements !== undefined
				? normalizeTextField(requirements, 8000, 'Requirements')
				: requirements;
		const sanitizedLocation =
			location !== undefined ? normalizeTextField(location, 200, 'Location') : location;

		let normalizedSalaryRange = salary_range;
		if (salary_range !== undefined && salary_range !== null && salary_range !== '') {
			const salaryText = String(salary_range).trim();
			const rangeMatch = salaryText.match(/^(\d+)\s*[-–]\s*(\d+)$/);
			if (rangeMatch) {
				const minSalary = normalizeSalary(rangeMatch[1], 'salary_range minimum');
				const maxSalary = normalizeSalary(rangeMatch[2], 'salary_range maximum');
				if (minSalary > maxSalary) {
					return res.status(400).json({ error: 'Minimum salary cannot exceed maximum salary' });
				}
			}
			normalizedSalaryRange = salaryText;
		}

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

		// Verify ownership (company_id or user_id)
		const existing = await pool.query(
			'SELECT id FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[req.params.id, req.user.company_id, req.user.id],
		);

		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
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
				sanitizedTitle,
				sanitizedDescription,
				sanitizedRequirements,
				sanitizedLocation,
				normalizedSalaryRange,
				normalizedUpdateJobType,
				status,
				screening_questions || null,
				req.params.id,
			],
		);

		res.json({ success: true, job: result.rows[0] });
	} catch (err) {
		if (err.statusCode === 400) {
			return res.status(400).json({ error: err.message });
		}
		console.error('Update job error:', err);
		res.status(500).json({ error: 'Failed to update job' });
	}
});

// Get ALL applications for the company
router.get('/applications', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { status, job_id, limit = 100, offset = 0 } = req.query;

		let query = `
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title, j.id as job_id,
             j.screening_questions,
             os.total_score as current_omniscore, os.score_tier,
             (SELECT COUNT(*) FROM skill_assessments sa2 JOIN candidate_skills cs2 ON sa2.skill_id = cs2.id WHERE cs2.user_id = ja.candidate_id AND sa2.passed = true) as verified_skills_count,
             (SELECT MAX(i2.overall_score) FROM interviews i2 WHERE i2.user_id = ja.candidate_id AND i2.status = 'completed') as best_interview_score,
             (SELECT COUNT(*) FROM interviews i3 WHERE i3.user_id = ja.candidate_id AND i3.status = 'completed') as completed_interviews
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      JOIN jobs j ON ja.job_id = j.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      WHERE ja.company_id = $1
    `;
		const params = [req.user.company_id];

		if (status) {
			query += ` AND ja.status = $${params.length + 1}`;
			params.push(status);
		}

		if (job_id) {
			query += ` AND ja.job_id = $${params.length + 1}`;
			params.push(job_id);
		}

		query += ` ORDER BY ja.applied_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
		params.push(limit, offset);

		const result = await pool.query(query, params);

		res.json({ applications: result.rows });
	} catch (err) {
		console.error('Get applications error:', err);
		res.status(500).json({ error: 'Failed to fetch applications' });
	}
});

// Update application status (alternative route)
router.put('/applications/:id/status', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { status } = req.body;

		// Validate status against CHECK constraint (chk_job_applications_status)
		const VALID_APP_STATUSES = [
			'applied',
			'screening',
			'interviewed',
			'offered',
			'hired',
			'rejected',
			'withdrawn',
		];
		if (!VALID_APP_STATUSES.includes(status)) {
			return res.status(400).json({
				error: `Invalid status: '${status}'. Must be one of: ${VALID_APP_STATUSES.join(', ')}`,
			});
		}

		// Verify application belongs to company
		const existing = await pool.query(
			'SELECT id, job_id, candidate_id FROM job_applications WHERE id = $1 AND company_id = $2',
			[req.params.id, req.user.company_id],
		);

		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const result = await pool.query(
			`UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
			[status, req.params.id],
		);

		// Audit log
		await AuditLogger.log({
			actionType: 'application_status_changed',
			userId: req.user.id,
			targetType: 'job_application',
			targetId: parseInt(req.params.id, 10),
			metadata: {
				candidate_id: existing.rows[0].candidate_id,
				job_id: existing.rows[0].job_id,
				new_status: status,
			},
			req,
		});

		res.json({ success: true, application: result.rows[0] });
	} catch (err) {
		console.error('Update application status error:', err);
		res.status(500).json({ error: 'Failed to update application' });
	}
});

// Create interview (POST to /interviews)
router.post('/interviews', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const {
			application_id,
			scheduled_at,
			duration = 60,
			interview_type = 'video',
			notes,
		} = req.body;

		// Get application details
		const app = await pool.query(
			'SELECT ja.job_id, ja.candidate_id FROM job_applications ja WHERE ja.id = $1 AND ja.company_id = $2',
			[application_id, req.user.company_id],
		);

		if (app.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const { job_id, candidate_id } = app.rows[0];

		// Auto-generate Jitsi meeting link for video interviews
		let meeting_link = null;
		if (interview_type === 'video') {
			const roomId = `Rekrut AI-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('base64url')}`;
			meeting_link = `https://meet.jit.si/${roomId}`;
		}

		const result = await pool.query(
			`INSERT INTO scheduled_interviews
       (company_id, job_id, candidate_id, recruiter_id, scheduled_at, duration_minutes, interview_type, meeting_link, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
			[
				req.user.company_id,
				job_id,
				candidate_id,
				req.user.id,
				scheduled_at,
				duration,
				interview_type,
				meeting_link,
				notes,
			],
		);

		// Update application status
		await pool.query(
			`UPDATE job_applications SET status = 'interviewed', updated_at = NOW() WHERE id = $1`,
			[application_id],
		);

		res.json({ success: true, interview: result.rows[0] });

		// ── Calendar auto-sync (non-blocking) ──
		try {
			await calendarService.syncInterview(result.rows[0], 'create');
		} catch (calErr) {
			console.error('[calendar] Auto-sync failed (non-blocking):', calErr.message);
		}
	} catch (err) {
		console.error('Create interview error:', err);
		res.status(500).json({ error: 'Failed to create interview' });
	}
});

// Delete/cancel interview
router.delete('/interviews/:id', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const result = await pool.query(
			'DELETE FROM scheduled_interviews WHERE id = $1 AND company_id = $2 RETURNING id, calendar_event_id, calendar_provider, recruiter_id',
			[req.params.id, req.user.company_id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found' });
		}

		// ── Calendar auto-sync (non-blocking) ──
		try {
			const deleted = result.rows[0];
			if (deleted.calendar_event_id && deleted.calendar_provider) {
				await calendarService.deleteCalendarEvent(deleted.recruiter_id, deleted.calendar_provider, deleted.calendar_event_id);
			}
		} catch (calErr) {
			console.error('[calendar] Auto-sync delete failed (non-blocking):', calErr.message);
		}

		res.json({ success: true });
	} catch (err) {
		console.error('Delete interview error:', err);
		res.status(500).json({ error: 'Failed to delete interview' });
	}
});

// Get all candidates who have applied (for offer creation dropdown)
router.get('/candidates', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const result = await pool.query(
			`
      SELECT DISTINCT ON (u.id)
        u.id, u.name, u.email
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      WHERE ja.company_id = $1
      ORDER BY u.id, ja.applied_at DESC
    `,
			[req.user.company_id],
		);

		res.json({ candidates: result.rows });
	} catch (err) {
		console.error('Get candidates error:', err);
		res.status(500).json({ error: 'Failed to fetch candidates' });
	}
});

// Get full candidate profiles with pipeline data (B-001)
router.get('/candidates/full', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const {
			search,
			status,
			experience,
			location,
			skills,
			minScore,
			maxScore,
			sortBy = 'applied_at',
			sortOrder = 'DESC',
			page = 1,
			limit = 20,
		} = req.query;
		const companyId = req.user.company_id;
		const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

		// Build WHERE conditions dynamically
		const conditions = ['ja.company_id = $1'];
		const params = [companyId];
		let paramIdx = 2;

		if (search) {
			conditions.push(`(
        u.name ILIKE $${paramIdx} OR
        cp.headline ILIKE $${paramIdx} OR
        cp.location ILIKE $${paramIdx} OR
        EXISTS (SELECT 1 FROM candidate_skills cs WHERE cs.user_id = u.id AND cs.skill_name ILIKE $${paramIdx})
      )`);
			params.push(`%${search}%`);
			paramIdx++;
		}

		if (status) {
			conditions.push(`ja.status = $${paramIdx}`);
			params.push(status);
			paramIdx++;
		}

		if (experience) {
			const [min, max] = experience.split('-').map(Number);
			if (!Number.isNaN(min) && !Number.isNaN(max)) {
				conditions.push(
					`cp.years_experience >= $${paramIdx} AND cp.years_experience <= $${paramIdx + 1}`,
				);
				params.push(min, max);
				paramIdx += 2;
			} else if (experience === '10+') {
				conditions.push(`cp.years_experience >= $${paramIdx}`);
				params.push(10);
				paramIdx++;
			}
		}

		if (location) {
			conditions.push(`cp.location ILIKE $${paramIdx}`);
			params.push(`%${location}%`);
			paramIdx++;
		}

		if (skills) {
			const skillList = skills
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			if (skillList.length > 0) {
				const skillPlaceholders = skillList.map((_, i) => `$${paramIdx + i}`).join(',');
				conditions.push(
					`EXISTS (SELECT 1 FROM candidate_skills cs WHERE cs.user_id = u.id AND cs.skill_name IN (${skillPlaceholders}))`,
				);
				params.push(...skillList);
				paramIdx += skillList.length;
			}
		}

		if (minScore) {
			conditions.push(`COALESCE(os.total_score, ja.match_score, 0) >= $${paramIdx}`);
			params.push(parseInt(minScore, 10));
			paramIdx++;
		}

		if (maxScore) {
			conditions.push(`COALESCE(os.total_score, ja.match_score, 0) <= $${paramIdx}`);
			params.push(parseInt(maxScore, 10));
			paramIdx++;
		}

		const whereClause = conditions.join(' AND ');

		// Get total count for pagination
		const countResult = await pool.query(
			`
      SELECT COUNT(DISTINCT u.id) as total
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE ${whereClause}
    `,
			params,
		);

		const totalCount = parseInt(countResult.rows[0].total, 10);

		// Get candidates with full data
		const result = await pool.query(
			`
      SELECT
        u.id,
        u.name,
        u.email,
        u.avatar_url,
        cp.headline,
        cp.location,
        cp.years_experience,
        cp.phone,
        cp.salary_min,
        cp.salary_max,
        cp.remote_preference,
        COALESCE(os.total_score, latest_ja.match_score, 0) as omniscore,
        os.score_tier,
        latest_ja.status as application_status,
        latest_ja.applied_at,
        latest_ja.match_score,
        (SELECT COUNT(*) FROM candidate_skills csi WHERE csi.user_id = u.id) as skill_count,
        (SELECT json_agg(json_build_object(
          'name', csk2.skill_name,
          'level', csk2.level,
          'category', csk2.category
        ))
        FROM (SELECT * FROM candidate_skills csk2 WHERE csk2.user_id = u.id LIMIT 10) csk2
        ) as skills
      FROM (
        SELECT DISTINCT ON (candidate_id) candidate_id, status, applied_at, match_score, company_id
        FROM job_applications
        WHERE company_id = $1
        ORDER BY candidate_id, applied_at DESC
      ) latest_ja
      JOIN users u ON latest_ja.candidate_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE ${whereClause.replace(/ja\./g, 'latest_ja.')}
      ORDER BY latest_ja.applied_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `,
			[...params, parseInt(limit, 10), offset],
		);

		// Format candidates for frontend
		const candidates = result.rows.map((row) => ({
			id: String(row.id),
			name: row.name,
			email: row.email,
			avatar: row.avatar_url,
			headline: row.headline || 'No headline set',
			location: row.location || 'Location not specified',
			experienceYears: row.years_experience || 0,
			phone: row.phone,
			skills: row.skills || [],
			matchScore: row.match_score || 0,
			omniscore: row.omniscore || 0,
			scoreTier: row.score_tier,
			applicationStatus: row.application_status,
			lastActivity: row.applied_at ? new Date(row.applied_at).toISOString() : null,
			isTopCandidate: row.omniscore >= 85,
			salaryMin: row.salary_min,
			salaryMax: row.salary_max,
			remotePreference: row.remote_preference,
			skillCount: row.skill_count || 0,
		}));

		res.json({
			success: true,
			candidates,
			pagination: {
				page: parseInt(page, 10),
				limit: parseInt(limit, 10),
				total: totalCount,
				totalPages: Math.ceil(totalCount / parseInt(limit, 10)),
			},
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] Get full candidates error:`, err);
		if (process.env.NODE_ENV === 'production') {
			res.status(500).json({ error: 'Internal server error', ref });
		} else {
			res.status(500).json({ error: 'Failed to fetch candidates', message: err.message, ref });
		}
	}
});

router.post('/candidates/bulk-status', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { candidateIds, status } = req.body;
		const VALID = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
		if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
			return res.status(400).json({ error: 'candidateIds array required' });
		}
		if (!VALID.includes(status)) {
			return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
		}
		const result = await pool.query(
			'UPDATE candidates SET status = $1, updated_at = NOW() WHERE id = ANY($2) AND company_id = $3',
			[status, candidateIds, req.user.company_id],
		);
		console.log('[AUDIT] Bulk status update', {
			userId: req.user.id,
			count: result.rowCount,
			fromStatus: 'various',
			toStatus: status,
		});
		res.json({ updated: result.rowCount, candidateIds });
	} catch (err) {
		console.error('Bulk status update error:', err);
		res.status(500).json({ error: 'Failed to update candidate statuses' });
	}
});

// Get pipeline stats (B-001)
router.get('/pipeline-stats', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const companyId = req.user.company_id;

		const stats = await pool.query(
			`
      SELECT
        COUNT(DISTINCT ja.id) as total,
        COUNT(DISTINCT CASE WHEN ja.status = 'applied' THEN ja.id END) as new,
        COUNT(DISTINCT CASE WHEN ja.status = 'screening' THEN ja.id END) as screening,
        COUNT(DISTINCT CASE WHEN ja.status = 'interview' THEN ja.id END) as interview,
        COUNT(DISTINCT CASE WHEN ja.status = 'offer' THEN ja.id END) as offer,
        COUNT(DISTINCT CASE WHEN ja.status = 'hired' THEN ja.id END) as hired,
        COUNT(DISTINCT CASE WHEN ja.status = 'rejected' THEN ja.id END) as rejected
      FROM job_applications ja
      WHERE ja.company_id = $1
    `,
			[companyId],
		);

		const recentActivity = await pool.query(
			`
      SELECT
        COUNT(DISTINCT CASE WHEN ja.updated_at >= NOW() - INTERVAL '24 hours' THEN ja.id END) as last_24h,
        COUNT(DISTINCT CASE WHEN ja.updated_at >= NOW() - INTERVAL '7 days' THEN ja.id END) as last_7d
      FROM job_applications ja
      WHERE ja.company_id = $1
    `,
			[companyId],
		);

		const topCandidates = await pool.query(
			`
      SELECT COUNT(DISTINCT u.id) as count
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      WHERE ja.company_id = $1 AND COALESCE(os.total_score, ja.match_score, 0) >= 85
    `,
			[companyId],
		);

		const row = stats.rows[0];
		const activity = recentActivity.rows[0];

		res.json({
			success: true,
			stats: {
				total: parseInt(row.total, 10) || 0,
				new: parseInt(row.new, 10) || 0,
				screening: parseInt(row.screening, 10) || 0,
				interview: parseInt(row.interview, 10) || 0,
				offer: parseInt(row.offer, 10) || 0,
				hired: parseInt(row.hired, 10) || 0,
				rejected: parseInt(row.rejected, 10) || 0,
				topCandidates: parseInt(topCandidates.rows[0].count, 10) || 0,
				last24h: parseInt(activity.last_24h, 10) || 0,
				last7d: parseInt(activity.last_7d, 10) || 0,
			},
		});
	} catch (err) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] Get pipeline stats error:`, err);
		if (process.env.NODE_ENV === 'production') {
			res.status(500).json({ error: 'Internal server error', ref });
		} else {
			res.status(500).json({ error: 'Failed to fetch pipeline stats', message: err.message, ref });
		}
	}
});

// Get applications for a job
router.get('/jobs/:id/applications', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		// Verify job belongs to company or user
		const job = await pool.query(
			'SELECT id, title, screening_questions FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[req.params.id, req.user.company_id, req.user.id],
		);

		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		const applications = await pool.query(
			`
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             os.total_score as current_omniscore, os.score_tier
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      WHERE ja.job_id = $1
      ORDER BY ja.applied_at DESC
    `,
			[req.params.id],
		);

		res.json({
			job: job.rows[0],
			applications: applications.rows,
		});
	} catch (err) {
		console.error('Get applications error:', err);
		res.status(500).json({ error: 'Failed to fetch applications' });
	}
});

// Update application status
router.put('/applications/:id', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { status, recruiter_notes } = req.body;

		// Validate status against pipeline stages
		if (status && !PIPELINE_STAGES.includes(status)) {
			return res
				.status(400)
				.json({ error: `Invalid status. Must be one of: ${PIPELINE_STAGES.join(', ')}` });
		}

		// Verify application belongs to company
		const existing = await pool.query(
			'SELECT id, job_id, candidate_id, status as old_status FROM job_applications WHERE id = $1 AND company_id = $2',
			[req.params.id, req.user.company_id],
		);

		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const result = await pool.query(
			`UPDATE job_applications SET
        status = COALESCE($1, status),
        recruiter_notes = COALESCE($2, recruiter_notes),
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
			[status, recruiter_notes, req.params.id],
		);

		// Log to activity feed (events table) for status changes
		if (status && status !== existing.rows[0].old_status) {
			try {
				await pool.query(
					`INSERT INTO events (user_id, event_type, event_data, created_at)
           VALUES ($1, 'application_status_changed', $2, NOW())`,
					[
						req.user.id,
						JSON.stringify({
							application_id: parseInt(req.params.id, 10),
							candidate_id: existing.rows[0].candidate_id,
							job_id: existing.rows[0].job_id,
							old_status: existing.rows[0].old_status,
							new_status: status,
							changed_by: req.user.id,
						}),
					],
				);
			} catch (_e) {
				/* non-critical */
			}
		}

		// Update job analytics
		if (status) {
			const app = existing.rows[0];

			// Update counters based on status
			if (status === 'interviewed') {
				await pool.query(
					'UPDATE job_analytics SET interviews_scheduled = interviews_scheduled + 1 WHERE job_id = $1',
					[app.job_id],
				);
			} else if (status === 'offered') {
				await pool.query(
					'UPDATE job_analytics SET offers_made = offers_made + 1 WHERE job_id = $1',
					[app.job_id],
				);

				// Update hiring ratio score
				await trustscoreService.updateHiringRatioScore(req.user.company_id);
			} else if (status === 'hired') {
				await pool.query(
					'UPDATE job_analytics SET offers_accepted = offers_accepted + 1 WHERE job_id = $1',
					[app.job_id],
				);
			}
		}

		// If status is being changed, check if this overrides an AI recommendation
		if (status) {
			const aiDecision = await pool.query(
				`
        SELECT action_type, metadata
        FROM audit_logs
        WHERE target_type = 'job_application' AND target_id = $1
          AND action_type IN ('screening_decision', 'matching_decision', 'ai_screening', 'ai_matching')
        ORDER BY created_at DESC
        LIMIT 1
      `,
				[req.params.id],
			);

			if (aiDecision.rows.length > 0) {
				const aiMetadata = aiDecision.rows[0].metadata || {};
				await AuditLogger.log({
					actionType: 'human_override',
					userId: req.user.id,
					targetType: 'job_application',
					targetId: parseInt(req.params.id, 10),
					metadata: {
						candidate_id: existing.rows[0].candidate_id,
						job_id: existing.rows[0].job_id,
						original_ai_decision: aiMetadata.decision || aiMetadata.status || 'ai_recommended',
						override_decision: status,
						override_reason: recruiter_notes || 'Manual status change by recruiter',
						ai_model: aiMetadata.model || 'unknown',
						ai_confidence: aiMetadata.confidence || 0.85,
						job_title: existing.rows[0].job_title || 'Unknown Position',
					},
					req,
				});
			}
		}

		// Audit log: Application status change
		if (status) {
			await AuditLogger.log({
				actionType: 'application_status_changed',
				userId: req.user.id,
				targetType: 'job_application',
				targetId: parseInt(req.params.id, 10),
				metadata: {
					candidate_id: existing.rows[0].candidate_id,
					job_id: existing.rows[0].job_id,
					new_status: status,
					recruiter_notes: recruiter_notes || null,
				},
				req,
			});
		}

		res.json({ success: true, application: result.rows[0] });
	} catch (err) {
		console.error('Update application error:', err);
		res.status(500).json({ error: 'Failed to update application' });
	}
});

// Schedule interview
router.post('/interviews/schedule', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		let {
			job_id,
			candidate_id,
			scheduled_at,
			duration_minutes = 60,
			interview_type = 'video',
			meeting_link,
			notes,
		} = req.body;

		if (!job_id || !candidate_id || !scheduled_at) {
			return res.status(400).json({ error: 'Job, candidate, and scheduled time are required' });
		}

		// Verify job belongs to company
		const job = await pool.query('SELECT id FROM jobs WHERE id = $1 AND company_id = $2', [
			job_id,
			req.user.company_id,
		]);

		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		// Auto-generate Jitsi meeting link for video interviews if not provided
		if (interview_type === 'video' && !meeting_link) {
			const roomId = `Rekrut AI-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('base64url')}`;
			meeting_link = `https://meet.jit.si/${roomId}`;
		}

		const result = await pool.query(
			`INSERT INTO scheduled_interviews
       (company_id, job_id, candidate_id, recruiter_id, scheduled_at, duration_minutes, interview_type, meeting_link, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
			[
				req.user.company_id,
				job_id,
				candidate_id,
				req.user.id,
				scheduled_at,
				duration_minutes,
				interview_type,
				meeting_link,
				notes,
			],
		);

		// Update application status
		await pool.query(
			`UPDATE job_applications SET status = 'interviewed', updated_at = NOW()
       WHERE job_id = $1 AND candidate_id = $2`,
			[job_id, candidate_id],
		);

		// Update job analytics
		await pool.query(
			'UPDATE job_analytics SET interviews_scheduled = interviews_scheduled + 1 WHERE job_id = $1',
			[job_id],
		);

		// Add behavior points for scheduling
		await trustscoreService.addBehaviorComponent(req.user.company_id, 'interview_scheduled', 5, 10);

		res.json({ success: true, interview: result.rows[0] });
	} catch (err) {
		console.error('Schedule interview error:', err);
		res.status(500).json({ error: 'Failed to schedule interview' });
	}
});

// Get scheduled interviews
router.get('/interviews', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { upcoming_only = 'false', status, limit = 50 } = req.query;

		let query = `
      SELECT si.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title
      FROM scheduled_interviews si
      JOIN users u ON si.candidate_id = u.id
      JOIN jobs j ON si.job_id = j.id
      WHERE si.company_id = $1
    `;
		const params = [req.user.company_id];

		if (upcoming_only === 'true') {
			query += ` AND si.scheduled_at > NOW() AND si.status IN ('scheduled', 'confirmed')`;
		}

		if (status) {
			query += ` AND si.status = $${params.length + 1}`;
			params.push(status);
		}

		query += ` ORDER BY si.scheduled_at DESC LIMIT $${params.length + 1}`;
		params.push(limit);

		const result = await pool.query(query, params);

		res.json({ interviews: result.rows });
	} catch (err) {
		console.error('Get interviews error:', err);
		res.status(500).json({ error: 'Failed to fetch interviews' });
	}
});

// Update interview outcome
router.put('/interviews/:id', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { status, outcome, feedback, meeting_link } = req.body;

		const result = await pool.query(
			`UPDATE scheduled_interviews SET
        status = COALESCE($1, status),
        outcome = COALESCE($2, outcome),
        feedback = COALESCE($3, feedback),
        meeting_link = COALESCE($4, meeting_link),
        updated_at = NOW()
       WHERE id = $5 AND company_id = $6
       RETURNING *`,
			[
				status,
				outcome,
				feedback ? JSON.stringify(feedback) : null,
				meeting_link,
				req.params.id,
				req.user.company_id,
			],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Interview not found' });
		}

		res.json({ success: true, interview: result.rows[0] });

		// ── Calendar auto-sync (non-blocking) ──
		try {
			if (status === 'cancelled') {
				await calendarService.syncInterview(result.rows[0], 'delete');
			} else if (meeting_link) {
				await calendarService.syncInterview(result.rows[0], 'update');
			}
		} catch (calErr) {
			console.error('[calendar] Auto-sync update failed (non-blocking):', calErr.message);
		}
	} catch (err) {
		console.error('Update interview error:', err);
		res.status(500).json({ error: 'Failed to update interview' });
	}
});

// Generate interview questions for a job
router.post('/jobs/:id/questions', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const job = await pool.query(
			'SELECT title, description, requirements FROM jobs WHERE id = $1 AND company_id = $2',
			[req.params.id, req.user.company_id],
		);

		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		const { count = 8 } = req.body;
		const questions = await jobOptimizer.generateInterviewQuestionsForJob(job.rows[0], count);

		res.json({ success: true, questions });
	} catch (err) {
		console.error('Generate questions error:', err);
		res.status(500).json({ error: 'Failed to generate questions' });
	}
});

// Analyze candidate fit for a job
router.post('/jobs/:id/analyze-candidate', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { candidate_id } = req.body;

		// Get job details
		const job = await pool.query('SELECT * FROM jobs WHERE id = $1 AND company_id = $2', [
			req.params.id,
			req.user.company_id,
		]);

		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		// Get candidate profile
		const candidate = await pool.query(
			`
      SELECT u.*, os.total_score as omniscore, os.score_tier,
             AVG(i.overall_score) as avg_interview_score
      FROM users u
      LEFT JOIN omni_scores os ON u.id = os.user_id
      LEFT JOIN interviews i ON u.id = i.user_id AND i.status = 'completed'
      WHERE u.id = $1
      GROUP BY u.id, os.total_score, os.score_tier
    `,
			[candidate_id],
		);

		if (candidate.rows.length === 0) {
			return res.status(404).json({ error: 'Candidate not found' });
		}

		const analysis = await jobOptimizer.analyzeCandidateFit(
			{
				name: candidate.rows[0].name,
				omniscore: candidate.rows[0].omniscore,
				interview_score: candidate.rows[0].avg_interview_score,
			},
			job.rows[0],
		);

		res.json({ success: true, analysis });
	} catch (err) {
		console.error('Analyze candidate error:', err);
		res.status(500).json({ error: 'Failed to analyze candidate' });
	}
});

// Get candidate coaching/practice history (for recruiter review)
router.get('/candidates/:id/coaching', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const candidateId = req.params.id;

		// Verify candidate has applied to one of recruiter's jobs
		const hasRelation = await pool.query(
			`SELECT 1 FROM job_applications ja
       JOIN jobs j ON ja.job_id = j.id
       WHERE ja.candidate_id = $1 AND (j.company_id = $2 OR j.user_id = $3)
       LIMIT 1`,
			[candidateId, req.user.company_id, req.user.id],
		);

		if (hasRelation.rows.length === 0) {
			return res
				.status(403)
				.json({ error: 'Access denied — candidate has not applied to your jobs' });
		}

		// Get candidate name
		const candidate = await pool.query('SELECT name, email FROM users WHERE id = $1', [
			candidateId,
		]);

		// Get all coaching sessions
		const sessions = await pool.query(
			`SELECT
        id, question, category, score, coaching_data, response_type,
        duration_seconds, created_at
       FROM practice_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
			[candidateId],
		);

		// Get aggregate stats
		const stats = await pool.query(
			`SELECT
        COUNT(*) as total_sessions,
        AVG(score) as average_score,
        MIN(score) as lowest_score,
        MAX(score) as highest_score,
        MIN(created_at) as first_session,
        MAX(created_at) as last_session
       FROM practice_sessions
       WHERE user_id = $1`,
			[candidateId],
		);

		// Calculate improvement trend
		const improvement = await pool.query(
			`WITH ordered AS (
        SELECT score, ROW_NUMBER() OVER (ORDER BY created_at) as rn,
               COUNT(*) OVER () as total
        FROM practice_sessions WHERE user_id = $1
      )
      SELECT
        AVG(CASE WHEN rn <= total/2 THEN score END) as first_half_avg,
        AVG(CASE WHEN rn > total/2 THEN score END) as second_half_avg
      FROM ordered`,
			[candidateId],
		);

		let improvementPercent = null;
		if (improvement.rows[0].first_half_avg && improvement.rows[0].second_half_avg) {
			const firstHalf = parseFloat(improvement.rows[0].first_half_avg);
			const secondHalf = parseFloat(improvement.rows[0].second_half_avg);
			improvementPercent = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
		}

		// Category breakdown
		const byCategory = await pool.query(
			`SELECT category, COUNT(*) as count, AVG(score) as avg_score
       FROM practice_sessions WHERE user_id = $1
       GROUP BY category ORDER BY avg_score DESC`,
			[candidateId],
		);

		const parsed = sessions.rows.map((row) => ({
			...row,
			coaching_data:
				typeof row.coaching_data === 'string' ? JSON.parse(row.coaching_data) : row.coaching_data,
		}));

		res.json({
			success: true,
			candidate: candidate.rows[0] || { name: 'Unknown', email: '' },
			stats: {
				total_sessions: parseInt(stats.rows[0].total_sessions, 10) || 0,
				average_score: parseFloat(stats.rows[0].average_score) || null,
				lowest_score: parseFloat(stats.rows[0].lowest_score) || null,
				highest_score: parseFloat(stats.rows[0].highest_score) || null,
				improvement_percent: improvementPercent,
				first_session: stats.rows[0].first_session,
				last_session: stats.rows[0].last_session,
			},
			by_category: byCategory.rows,
			sessions: parsed,
		});
	} catch (err) {
		console.error('Get candidate coaching history error:', err);
		res.status(500).json({ error: 'Failed to fetch coaching history' });
	}
});

// ============= PIPELINE STAGES =============

// Valid pipeline stages in order (canonical)
// Based on industry research: LinkedIn, Greenhouse, Lever, Ashby, SmartRecruiters
// Valid pipeline stages — must match chk_job_applications_status CHECK constraint
const PIPELINE_STAGES = [
	'applied',
	'screening',
	'interviewed',
	'offered',
	'hired',
	'rejected',
	'withdrawn',
];

// GET pipeline stages (so frontend stays in sync)
router.get('/pipeline-stages', authMiddleware, requireRecruiter, (_req, res) => {
	const active = PIPELINE_STAGES.filter((s) => !['rejected', 'withdrawn'].includes(s));
	const terminal = ['rejected', 'withdrawn'];
	res.json({
		success: true,
		stages: PIPELINE_STAGES,
		active_stages: active,
		terminal_stages: terminal,
		stage_config: {
			applied: { label: 'Applied', color: 'blue', order: 0 },
			screening: { label: 'Screening', color: 'purple', order: 1 },
			interviewed: { label: 'Interviewed', color: 'cyan', order: 2 },
			offered: { label: 'Offered', color: 'emerald', order: 3 },
			hired: { label: 'Hired', color: 'green', order: 4 },
			rejected: { label: 'Rejected', color: 'red', order: -1 },
			withdrawn: { label: 'Withdrawn', color: 'gray', order: -1 },
		},
	});
});

// Batch update application status (for bulk actions)
router.put('/applications/batch-status', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { application_ids, status } = req.body;

		if (!application_ids || !Array.isArray(application_ids) || application_ids.length === 0) {
			return res.status(400).json({ error: 'application_ids array required' });
		}

		if (!status || !PIPELINE_STAGES.includes(status)) {
			return res
				.status(400)
				.json({ error: `Invalid status. Must be one of: ${PIPELINE_STAGES.join(', ')}` });
		}

		if (application_ids.length > 50) {
			return res.status(400).json({ error: 'Max 50 applications per batch' });
		}

		// Verify all applications belong to the company
		const placeholders = application_ids.map((_, i) => `$${i + 2}`).join(',');
		const verification = await pool.query(
			`SELECT id FROM job_applications WHERE company_id = $1 AND id IN (${placeholders})`,
			[req.user.company_id, ...application_ids],
		);

		const validIds = verification.rows.map((r) => r.id);
		if (validIds.length === 0) {
			return res.status(404).json({ error: 'No valid applications found' });
		}

		// Update all valid applications
		const updatePlaceholders = validIds.map((_, i) => `$${i + 2}`).join(',');
		const result = await pool.query(
			`UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id IN (${updatePlaceholders}) RETURNING *`,
			[status, ...validIds],
		);

		// Check for AI decisions on each application and log human overrides
		for (const appId of validIds) {
			const aiDecision = await pool.query(
				`
        SELECT action_type, metadata
        FROM audit_logs
        WHERE target_type = 'job_application' AND target_id = $1
          AND action_type IN ('screening_decision', 'matching_decision', 'ai_screening', 'ai_matching')
        ORDER BY created_at DESC
        LIMIT 1
      `,
				[appId],
			);

			if (aiDecision.rows.length > 0) {
				const aiMetadata = aiDecision.rows[0].metadata || {};
				await AuditLogger.log({
					actionType: 'human_override',
					userId: req.user.id,
					targetType: 'job_application',
					targetId: appId,
					metadata: {
						original_ai_decision: aiMetadata.decision || aiMetadata.status || 'ai_recommended',
						override_decision: status,
						override_reason: 'Batch status change by recruiter',
						ai_model: aiMetadata.model || 'unknown',
						ai_confidence: aiMetadata.confidence || 0.85,
						batch_operation: true,
					},
					req,
				});
			}
		}

		// Audit log batch action
		await AuditLogger.log({
			actionType: 'batch_status_change',
			userId: req.user.id,
			targetType: 'job_applications',
			targetId: null,
			metadata: {
				application_ids: validIds,
				new_status: status,
				count: validIds.length,
			},
			req,
		});

		res.json({
			success: true,
			updated: result.rows.length,
			applications: result.rows,
		});
	} catch (err) {
		console.error('Batch status update error:', err);
		res.status(500).json({ error: 'Failed to update applications' });
	}
});

// Get applications grouped by pipeline stage (for kanban view)
router.get('/pipeline/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const jobId = req.params.jobId;

		// Verify job belongs to company
		const job = await pool.query(
			'SELECT id, title, status FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[jobId, req.user.company_id, req.user.id],
		);

		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		// Get all applications for this job with candidate details
		const applications = await pool.query(
			`
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             os.total_score as current_omniscore, os.score_tier,
             (SELECT COUNT(*) FROM skill_assessments sa2 JOIN candidate_skills cs2 ON sa2.skill_id = cs2.id WHERE cs2.user_id = ja.candidate_id AND sa2.passed = true) as verified_skills_count,
             (SELECT MAX(i2.overall_score) FROM interviews i2 WHERE i2.user_id = ja.candidate_id AND i2.status = 'completed') as best_interview_score
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      WHERE ja.job_id = $1
      ORDER BY ja.match_score DESC NULLS LAST, ja.applied_at ASC
    `,
			[jobId],
		);

		// Group by pipeline stage
		const pipeline = {};
		for (const stage of PIPELINE_STAGES) {
			pipeline[stage] = [];
		}

		for (const app of applications.rows) {
			const stage = PIPELINE_STAGES.includes(app.status) ? app.status : 'applied';
			pipeline[stage].push(app);
		}

		// Get stage counts
		const stageCounts = {};
		for (const stage of PIPELINE_STAGES) {
			stageCounts[stage] = pipeline[stage].length;
		}

		res.json({
			success: true,
			job: job.rows[0],
			pipeline,
			stage_counts: stageCounts,
			total: applications.rows.length,
			stages: PIPELINE_STAGES,
		});
	} catch (err) {
		console.error('Get pipeline error:', err);
		res.status(500).json({ error: 'Failed to get pipeline' });
	}
});

// Get ranked candidates for a job (by match score)
router.get('/jobs/:id/ranked-candidates', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const jobId = req.params.id;
		const { min_score = 0 } = req.query;

		// Verify job belongs to company
		const job = await pool.query(
			'SELECT id, title FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[jobId, req.user.company_id, req.user.id],
		);

		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		// Get applications ranked by match score
		const ranked = await pool.query(
			`
      SELECT ja.*,
             u.name as candidate_name, u.email as candidate_email,
             os.total_score as current_omniscore, os.score_tier,
             cp.headline, cp.location as candidate_location, cp.years_experience,
             (SELECT json_agg(json_build_object('name', cs.skill_name, 'level', cs.level, 'verified', cs.is_verified))
              FROM candidate_skills cs WHERE cs.user_id = ja.candidate_id) as skills,
             mr.matching_skills, mr.missing_skills, mr.similarity_score, mr.match_explanation
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON u.id = os.user_id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN match_results mr ON mr.candidate_id = ja.candidate_id AND mr.job_id = ja.job_id
      WHERE ja.job_id = $1
        AND ja.status NOT IN ('withdrawn', 'rejected')
        AND COALESCE(ja.match_score, 0) >= $2
      ORDER BY ja.match_score DESC NULLS LAST, os.total_score DESC NULLS LAST
    `,
			[jobId, min_score],
		);

		res.json({
			success: true,
			job: job.rows[0],
			candidates: ranked.rows,
			total: ranked.rows.length,
		});
	} catch (err) {
		console.error('Get ranked candidates error:', err);
		res.status(500).json({ error: 'Failed to get ranked candidates' });
	}
});

// ============= AI FEATURES =============

// AI Candidate Summary — one-click strengths/concerns/fit assessment
router.post('/ai/candidate-summary', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { application_id } = req.body;
		if (!application_id) return res.status(400).json({ error: 'application_id required' });
		const { chat } = require('../lib/polsia-ai');

		// Get application with all candidate data
		const app = await pool.query(
			`
      SELECT ja.*, j.title as job_title, j.description as job_desc, j.requirements as job_reqs,
             j.screening_questions,
             u.name as candidate_name, u.email as candidate_email,
             cp.headline, cp.bio, cp.location as candidate_location, cp.years_experience,
             cp.salary_min, cp.salary_max
      FROM job_applications ja
      JOIN jobs j ON ja.job_id = j.id
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      WHERE ja.id = $1 AND (j.company_id = $2 OR j.user_id = $3)
    `,
			[application_id, req.user.company_id, req.user.id],
		);

		if (app.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
		const a = app.rows[0];

		// Get skills
		const skills = await pool.query(
			'SELECT skill_name, category, years_experience, is_verified FROM candidate_skills WHERE user_id = $1',
			[a.candidate_id],
		);
		// Get experience
		const experience = await pool.query(
			'SELECT company_name, title, description FROM work_experience WHERE user_id = $1 ORDER BY start_date DESC LIMIT 5',
			[a.candidate_id],
		);

		const prompt = `Provide a comprehensive assessment of this candidate for the ${a.job_title} position.

CANDIDATE: ${a.candidate_name}
Headline: ${a.headline || 'Not set'}
Bio: ${a.bio || 'Not set'}
Location: ${a.candidate_location || 'Not specified'}
Years Experience: ${a.years_experience || 'Unknown'}
Skills: ${skills.rows.map((s) => `${s.skill_name}${s.is_verified ? ' ✓' : ''} (${s.years_experience || '?'}y)`).join(', ') || 'None'}
Recent Roles: ${experience.rows.map((e) => `${e.title} at ${e.company_name}`).join('; ') || 'None listed'}
Cover Letter: ${a.cover_letter?.substring(0, 500) || 'Not provided'}
Screening Answers: ${JSON.stringify(a.screening_answers || {}).substring(0, 500)}
Match Score: ${a.match_score || 'N/A'}

JOB: ${a.job_title}
Requirements: ${a.job_reqs?.substring(0, 500) || 'Not specified'}

Return JSON:
{
  "fit_score": 0-100,
  "fit_level": "strong_fit|good_fit|moderate_fit|weak_fit",
  "summary": "2-3 sentence executive summary",
  "strengths": ["Top 3 strengths for this role"],
  "concerns": ["Top 2-3 concerns or gaps"],
  "interview_focus_areas": ["2-3 topics to probe in interview"],
  "salary_alignment": "aligned|above_range|below_range|unknown",
  "recommendation": "advance|consider|pass",
  "recommendation_reason": "1 sentence explanation"
}
Only return JSON.`;

		const result = await chat(prompt, {
			system:
				'You are a senior recruiter providing candidate assessments. Be objective, data-driven, and concise. Always return valid JSON.',
			module: 'recruiter_tools',
			feature: 'candidate_assessment',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\{[\s\S]*\}/);
			parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed' };
		}
		res.json({ success: true, summary: parsed });
	} catch (err) {
		console.error('AI candidate summary error:', err);
		res.status(500).json({ error: 'Failed to generate summary' });
	}
});

// AI Screening Questions Suggestions — based on job + recruiter's past bank
router.post('/ai/suggest-questions', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { job_title, job_description, existing_questions = [] } = req.body;
		if (!job_title) return res.status(400).json({ error: 'job_title required' });
		const { chat } = require('../lib/polsia-ai');

		// Get recruiter's past screening questions from question_bank
		const pastQuestions = await pool.query(
			`
      SELECT DISTINCT question_text, category, usage_count FROM question_bank
      WHERE recruiter_id = $1
      ORDER BY usage_count DESC LIMIT 20
    `,
			[req.user.id],
		);

		const prompt = `Suggest screening questions for a ${job_title} position.

Job Description: ${job_description?.substring(0, 500) || 'Not provided'}

Recruiter's Past Questions (for reuse):
${pastQuestions.rows.map((q) => `- [${q.category}] ${q.question_text}`).join('\n') || 'None'}

Already Added:
${existing_questions.map((q) => `- ${q.question || q.text}`).join('\n') || 'None'}

Suggest 5 screening questions. Mix reusable ones from the bank with new job-specific ones.

Return JSON array:
[
  {
    "question": "The question text",
    "type": "text|yes_no|select",
    "category": "work_authorization|salary|availability|experience|technical|culture",
    "options": ["only if type is select"],
    "required": true/false,
    "from_bank": true/false
  }
]
Only return JSON array.`;

		const result = await chat(prompt, {
			system:
				'You are an expert recruiter designing screening questions. Make them practical and relevant. Always return valid JSON.',
			module: 'recruiter_tools',
			feature: 'screening_questions',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\[[\s\S]*\]/);
			parsed = m ? JSON.parse(m[0]) : [];
		}
		res.json({ success: true, suggestions: parsed });
	} catch (err) {
		console.error('AI suggest questions error:', err);
		res.status(500).json({ error: 'Failed to suggest questions' });
	}
});

// Save questions to recruiter's question bank
router.post('/question-bank', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { questions } = req.body;
		if (!questions || !Array.isArray(questions))
			return res.status(400).json({ error: 'questions array required' });

		const saved = [];
		for (const q of questions) {
			const result = await pool.query(
				`
        INSERT INTO question_bank (recruiter_id, question_text, category, question_type, options)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (recruiter_id, question_text) WHERE recruiter_id IS NOT NULL
        DO UPDATE SET usage_count = question_bank.usage_count + 1
        RETURNING *
      `,
				[
					req.user.id,
					q.question || q.question_text,
					q.category || 'general',
					q.type || 'text',
					JSON.stringify(q.options || []),
				],
			);
			saved.push(result.rows[0]);
		}

		res.json({ success: true, questions: saved });
	} catch (err) {
		console.error('Save question bank error:', err);
		res.status(500).json({ error: 'Failed to save questions' });
	}
});

// Get recruiter's question bank
router.get('/question-bank', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const questions = await pool.query(
			`
      SELECT * FROM question_bank WHERE recruiter_id = $1 ORDER BY usage_count DESC, created_at DESC
    `,
			[req.user.id],
		);
		res.json({ success: true, questions: questions.rows });
	} catch (err) {
		console.error('Get question bank error:', err);
		res.status(500).json({ error: 'Failed to get question bank' });
	}
});

// ============= OFFER MANAGEMENT =============

// Create an offer
router.post('/offers', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const {
			candidate_id,
			job_id,
			title,
			salary,
			start_date,
			benefits,
			location,
			employment_type,
			reporting_to,
		} = req.body;

		if (!candidate_id || !job_id) {
			return res.status(400).json({ error: 'candidate_id and job_id are required' });
		}

		// Verify job belongs to company
		const job = await pool.query(
			'SELECT id, title, company FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[job_id, req.user.company_id, req.user.id],
		);
		if (job.rows.length === 0) {
			return res.status(404).json({ error: 'Job not found' });
		}

		// Verify candidate has applied
		const application = await pool.query(
			'SELECT id FROM job_applications WHERE job_id = $1 AND candidate_id = $2',
			[job_id, candidate_id],
		);
		if (application.rows.length === 0) {
			return res.status(400).json({ error: 'Candidate has not applied to this job' });
		}

		const result = await pool.query(
			`INSERT INTO offers (
        candidate_id, job_id, recruiter_id, company_id,
        title, company_name, salary, start_date,
        benefits, location, employment_type, reporting_to,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', NOW(), NOW())
      RETURNING *`,
			[
				candidate_id,
				job_id,
				req.user.id,
				req.user.company_id,
				title || job.rows[0].title,
				req.user.company_name || job.rows[0].company || 'Company',
				parseFloat(salary) || 0,
				start_date || null,
				benefits || null,
				location || null,
				employment_type || 'full-time',
				reporting_to || null,
			],
		);

		res.json({ success: true, offer: result.rows[0] });

		// ── Send offer extended notification (non-blocking) ──
		try {
			const [candidate, jobInfo] = await Promise.all([
				pool.query('SELECT id, name, email FROM users WHERE id = $1', [candidate_id]),
				pool.query('SELECT id, title FROM jobs WHERE id = $1', [job_id]),
			]);

			const candInfo = candidate.rows[0];
			const jobData = jobInfo.rows[0];

			if (candInfo?.email) {
				await emailService.sendTemplatedEmail({
					to: candInfo.email,
					templateName: 'offer_extended',
					templateData: {
						candidate_name: candInfo.name || 'Candidate',
						job_title: jobData?.title || 'the position',
						company_name: req.user.company_name || job.rows[0]?.company || 'Our Company',
						salary: salary ? `$${parseFloat(salary).toLocaleString()}` : 'Competitive',
						work_location: location || 'Remote',
						start_date: start_date || 'To be determined',
						benefits: benefits || '',
						offer_link: `${process.env.FRONTEND_URL || 'https://rekrut.ai'}/candidate/offers`,
						offer_deadline: '7 days',
					},
					userId: candidate_id,
					metadata: { job_id, company_id: req.user.company_id, offer_id: result.rows[0].id },
				});
			}
		} catch (emailErr) {
			console.error(
				'[email] Failed to send offer extended email (non-blocking):',
				emailErr.message,
			);
		}
	} catch (err) {
		console.error('Create offer error:', err);
		res.status(500).json({ error: 'Failed to create offer' });
	}
});

// List offers for company
router.get('/offers', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { status, job_id, limit = 50, offset = 0 } = req.query;

		let query = `
      SELECT o.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title
      FROM offers o
      JOIN users u ON o.candidate_id = u.id
      LEFT JOIN jobs j ON o.job_id = j.id
      WHERE o.company_id = $1
    `;
		const params = [req.user.company_id];

		if (status) {
			query += ` AND o.status = $${params.length + 1}`;
			params.push(status);
		}
		if (job_id) {
			query += ` AND o.job_id = $${params.length + 1}`;
			params.push(job_id);
		}

		query += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
		params.push(parseInt(limit, 10), parseInt(offset, 10));

		const result = await pool.query(query, params);
		res.json({ success: true, offers: result.rows });
	} catch (err) {
		console.error('List offers error:', err);
		res.status(500).json({ error: 'Failed to fetch offers' });
	}
});

// Get single offer
router.get('/offers/:id', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const result = await pool.query(
			`
      SELECT o.*,
             u.name as candidate_name, u.email as candidate_email,
             j.title as job_title, j.description as job_description
      FROM offers o
      JOIN users u ON o.candidate_id = u.id
      LEFT JOIN jobs j ON o.job_id = j.id
      WHERE o.id = $1 AND o.company_id = $2
    `,
			[req.params.id, req.user.company_id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Offer not found' });
		}

		res.json({ success: true, offer: result.rows[0] });
	} catch (err) {
		console.error('Get offer error:', err);
		res.status(500).json({ error: 'Failed to fetch offer' });
	}
});

// Update offer (edit draft or add details)
router.put('/offers/:id', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const {
			title,
			salary,
			start_date,
			benefits,
			location,
			employment_type,
			reporting_to,
			offer_letter_html,
		} = req.body;

		// Verify offer belongs to company
		const existing = await pool.query(
			'SELECT id, status FROM offers WHERE id = $1 AND company_id = $2',
			[req.params.id, req.user.company_id],
		);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Offer not found' });
		}

		const result = await pool.query(
			`UPDATE offers SET
        title = COALESCE($1, title),
        salary = COALESCE($2, salary),
        start_date = COALESCE($3, start_date),
        benefits = COALESCE($4, benefits),
        location = COALESCE($5, location),
        employment_type = COALESCE($6, employment_type),
        reporting_to = COALESCE($7, reporting_to),
        offer_letter_html = COALESCE($8, offer_letter_html),
        offer_letter_generated_at = CASE WHEN $8 IS NOT NULL THEN NOW() ELSE offer_letter_generated_at END,
        updated_at = NOW()
      WHERE id = $9
      RETURNING *`,
			[
				title,
				salary,
				start_date,
				benefits,
				location,
				employment_type,
				reporting_to,
				offer_letter_html,
				req.params.id,
			],
		);

		res.json({ success: true, offer: result.rows[0] });
	} catch (err) {
		console.error('Update offer error:', err);
		res.status(500).json({ error: 'Failed to update offer' });
	}
});

// Send offer to candidate (changes status from draft to sent)
router.put('/offers/:id/send', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const existing = await pool.query(
			'SELECT id, status, candidate_id, job_id FROM offers WHERE id = $1 AND company_id = $2',
			[req.params.id, req.user.company_id],
		);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Offer not found' });
		}
		if (existing.rows[0].status !== 'draft') {
			return res
				.status(400)
				.json({ error: `Cannot send offer with status: ${existing.rows[0].status}` });
		}

		const result = await pool.query(
			`UPDATE offers SET status = 'sent', sent_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
			[req.params.id],
		);

		// Update application status to 'offered'
		await pool.query(
			`UPDATE job_applications SET status = 'offered', updated_at = NOW()
       WHERE job_id = $1 AND candidate_id = $2`,
			[existing.rows[0].job_id, existing.rows[0].candidate_id],
		);

		// Update job analytics
		try {
			await pool.query(
				'UPDATE job_analytics SET offers_made = COALESCE(offers_made, 0) + 1 WHERE job_id = $1',
				[existing.rows[0].job_id],
			);
		} catch (_e) {
			/* non-critical */
		}

		// Check if this offer overrides an AI decision
		const aiDecision = await pool.query(
			`
      SELECT action_type, metadata
      FROM audit_logs
      WHERE target_type = 'job_application' AND target_id = (
        SELECT id FROM job_applications WHERE job_id = $1 AND candidate_id = $2 LIMIT 1
      )
        AND action_type IN ('screening_decision', 'matching_decision', 'ai_screening', 'ai_matching')
      ORDER BY created_at DESC
      LIMIT 1
    `,
			[existing.rows[0].job_id, existing.rows[0].candidate_id],
		);

		if (aiDecision.rows.length > 0) {
			const aiMetadata = aiDecision.rows[0].metadata || {};
			await AuditLogger.log({
				actionType: 'human_override',
				userId: req.user.id,
				targetType: 'job_application',
				targetId: existing.rows[0].job_id,
				metadata: {
					candidate_id: existing.rows[0].candidate_id,
					job_id: existing.rows[0].job_id,
					original_ai_decision: aiMetadata.decision || aiMetadata.status || 'ai_recommended',
					override_decision: 'offered',
					override_reason: 'Recruiter sent offer to candidate',
					ai_model: aiMetadata.model || 'unknown',
					ai_confidence: aiMetadata.confidence || 0.85,
					offer_id: parseInt(req.params.id, 10),
				},
				req,
			});
		}

		// Audit log
		await AuditLogger.log({
			actionType: 'offer_sent',
			userId: req.user.id,
			targetType: 'offer',
			targetId: parseInt(req.params.id, 10),
			metadata: {
				candidate_id: existing.rows[0].candidate_id,
				job_id: existing.rows[0].job_id,
			},
			req,
		});

		res.json({ success: true, offer: result.rows[0] });
	} catch (err) {
		console.error('Send offer error:', err);
		res.status(500).json({ error: 'Failed to send offer' });
	}
});

// Withdraw/cancel offer (recruiter action)
router.put('/offers/:id/withdraw', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { reason } = req.body;

		const existing = await pool.query(
			'SELECT id, status FROM offers WHERE id = $1 AND company_id = $2',
			[req.params.id, req.user.company_id],
		);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Offer not found' });
		}
		if (['accepted', 'declined'].includes(existing.rows[0].status)) {
			return res.status(400).json({ error: `Cannot withdraw an ${existing.rows[0].status} offer` });
		}

		const result = await pool.query(
			`UPDATE offers SET status = 'rescinded', decline_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
			[req.params.id, reason || 'Rescinded by recruiter'],
		);

		res.json({ success: true, offer: result.rows[0] });
	} catch (err) {
		console.error('Withdraw offer error:', err);
		res.status(500).json({ error: 'Failed to withdraw offer' });
	}
});

// ============= AI AGENT ENDPOINTS (Phase 4) =============

// AI Candidate Comparison — side-by-side analysis of 2+ candidates
router.post('/ai/compare-candidates', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { candidate_ids, job_id } = req.body;
		if (!candidate_ids || !Array.isArray(candidate_ids) || candidate_ids.length < 2) {
			return res.status(400).json({ error: 'At least 2 candidate_ids required' });
		}
		if (!job_id) return res.status(400).json({ error: 'job_id required' });
		const { chat } = require('../lib/polsia-ai');

		// Get candidate data for all
		const candidates = [];
		for (const cid of candidate_ids.slice(0, 5)) {
			// Max 5 candidates
			const data = await pool.query(
				`
        SELECT u.name, u.email, cp.headline, cp.location, cp.years_experience, cp.salary_min, cp.salary_max,
               os.total_score as omniscore, os.score_tier,
               ja.match_score, ja.status as app_status, ja.cover_letter,
               (SELECT json_agg(json_build_object('name', cs.skill_name, 'level', cs.level, 'verified', cs.is_verified))
                FROM candidate_skills cs WHERE cs.user_id = u.id) as skills,
               (SELECT json_agg(json_build_object('title', we.title, 'company', we.company_name, 'years', EXTRACT(YEAR FROM AGE(COALESCE(we.end_date, NOW()), we.start_date))))
                FROM work_experience we WHERE we.user_id = u.id ORDER BY we.start_date DESC LIMIT 3) as experience
        FROM users u
        LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
        LEFT JOIN omni_scores os ON os.user_id = u.id
        LEFT JOIN job_applications ja ON ja.candidate_id = u.id AND ja.job_id = $2
        WHERE u.id = $1
      `,
				[cid, job_id],
			);
			if (data.rows[0]) candidates.push({ id: cid, ...data.rows[0] });
		}

		if (candidates.length < 2)
			return res.status(400).json({ error: 'Need at least 2 valid candidates' });

		// Get job info
		const job = await pool.query('SELECT title, requirements FROM jobs WHERE id = $1', [job_id]);

		const prompt = `Compare these ${candidates.length} candidates for the ${job.rows[0]?.title || 'position'} role.

${candidates
	.map(
		(c, i) => `CANDIDATE ${i + 1}: ${c.name}
- OmniScore: ${c.omniscore || 'N/A'} (${c.score_tier || 'new'})
- Match Score: ${c.match_score || 'N/A'}
- Experience: ${c.years_experience || '?'} years
- Skills: ${(c.skills || []).map((s) => `${s.name}${s.verified ? '✓' : ''}`).join(', ') || 'N/A'}
- Recent Roles: ${(c.experience || []).map((e) => `${e.title} at ${e.company}`).join('; ') || 'N/A'}
- Salary: ${c.salary_min ? `$${c.salary_min}-$${c.salary_max}` : 'N/A'}
- Location: ${c.location || 'N/A'}
`,
	)
	.join('\n')}

JOB Requirements: ${job.rows[0]?.requirements?.substring(0, 400) || 'N/A'}

Return JSON:
{
  "recommendation": "candidate_id of recommended hire",
  "ranking": [{ "candidate_id": id, "rank": 1, "overall_score": 0-100 }],
  "comparison_matrix": {
    "skills_match": [{ "candidate_id": id, "score": 0-100 }],
    "experience": [{ "candidate_id": id, "score": 0-100 }],
    "culture_fit": [{ "candidate_id": id, "score": 0-100 }],
    "salary_fit": [{ "candidate_id": id, "score": 0-100 }]
  },
  "summary": "2-3 sentence comparison summary",
  "key_differentiators": ["What sets the top candidate apart"],
  "risks": [{ "candidate_id": id, "risk": "concern" }]
}
Only return JSON.`;

		const result = await chat(prompt, {
			system:
				'You are a senior talent acquisition specialist comparing candidates. Be objective and data-driven. Always return valid JSON.',
			module: 'recruiter_tools',
			feature: 'candidate_comparison',
		});

		let parsed;
		try {
			parsed = JSON.parse(result);
		} catch {
			const m = result.match(/\{[\s\S]*\}/);
			parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed' };
		}
		res.json({
			success: true,
			comparison: parsed,
			candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
		});
	} catch (err) {
		console.error('AI compare candidates error:', err);
		res.status(500).json({ error: 'Failed to compare candidates' });
	}
});

// AI Bulk Rank — rank all candidates for a job by OmniScore (uses existing scores, no recalculation)
router.get('/ai/rank-all/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const jobId = req.params.jobId;

		// Verify job belongs to company
		const job = await pool.query(
			'SELECT id, title FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[jobId, req.user.company_id, req.user.id],
		);
		if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

		// Get all applicants ranked by composite score (OmniScore + match_score)
		const ranked = await pool.query(
			`
      SELECT ja.id as application_id, ja.candidate_id, ja.match_score, ja.status, ja.applied_at,
             u.name as candidate_name, u.email,
             os.total_score as omniscore, os.score_tier,
             os.interview_score, os.technical_score, os.resume_score, os.behavior_score,
             cp.headline, cp.years_experience,
             mr.matching_skills, mr.missing_skills,
             -- Composite rank: 50% OmniScore + 50% match_score
             (COALESCE(os.total_score, 300) * 0.5 + COALESCE(ja.match_score, 50) * 0.5 * 8.5) as composite_score
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      LEFT JOIN omni_scores os ON os.user_id = u.id
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN match_results mr ON mr.candidate_id = ja.candidate_id AND mr.job_id = ja.job_id
      WHERE ja.job_id = $1 AND ja.status NOT IN ('withdrawn', 'rejected')
      ORDER BY composite_score DESC
    `,
			[jobId],
		);

		res.json({
			success: true,
			job: job.rows[0],
			ranked_candidates: ranked.rows.map((r, i) => ({
				...r,
				rank: i + 1,
				composite_score: Math.round(r.composite_score * 100) / 100,
				matching_skills: r.matching_skills
					? typeof r.matching_skills === 'string'
						? JSON.parse(r.matching_skills)
						: r.matching_skills
					: [],
				missing_skills: r.missing_skills
					? typeof r.missing_skills === 'string'
						? JSON.parse(r.missing_skills)
						: r.missing_skills
					: [],
			})),
			total: ranked.rows.length,
		});
	} catch (err) {
		console.error('AI rank all error:', err);
		res.status(500).json({ error: 'Failed to rank candidates' });
	}
});

// Pipeline Automation Settings — get/set auto-advance rules per job
router.get('/pipeline/automation/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const jobId = req.params.jobId;

		// Verify job belongs to company
		const job = await pool.query(
			'SELECT id FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[jobId, req.user.company_id, req.user.id],
		);
		if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

		// Get existing automation rules
		const rules = await pool.query(
			`
      SELECT * FROM pipeline_automation_rules
      WHERE job_id = $1 AND recruiter_id = $2
      ORDER BY from_stage
    `,
			[jobId, req.user.id],
		);

		// Default rules if none exist
		if (rules.rows.length === 0) {
			res.json({
				success: true,
				rules: PIPELINE_STAGES.filter((s) => !['rejected', 'withdrawn', 'hired'].includes(s)).map(
					(stage) => ({
						from_stage: stage,
						to_stage: PIPELINE_STAGES[PIPELINE_STAGES.indexOf(stage) + 1] || stage,
						auto_advance: false,
						omniscore_threshold: 600,
						match_score_threshold: 70,
						auto_reject: false,
						auto_reject_threshold: 400,
					}),
				),
				enabled: false,
			});
			return;
		}

		res.json({
			success: true,
			rules: rules.rows,
			enabled: rules.rows.some((r) => r.auto_advance || r.auto_reject),
		});
	} catch (err) {
		console.error('Get pipeline automation error:', err);
		res.status(500).json({ error: 'Failed to get automation settings' });
	}
});

// Save pipeline automation rules
router.put('/pipeline/automation/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const jobId = req.params.jobId;
		const { rules } = req.body;
		if (!rules || !Array.isArray(rules))
			return res.status(400).json({ error: 'rules array required' });

		// Verify job
		const job = await pool.query(
			'SELECT id FROM jobs WHERE id = $1 AND (company_id = $2 OR user_id = $3)',
			[jobId, req.user.company_id, req.user.id],
		);
		if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

		// Upsert rules
		const saved = [];
		for (const rule of rules) {
			const result = await pool.query(
				`
        INSERT INTO pipeline_automation_rules (job_id, recruiter_id, from_stage, to_stage, auto_advance, omniscore_threshold, match_score_threshold, auto_reject, auto_reject_threshold)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (job_id, recruiter_id, from_stage) DO UPDATE SET
          to_stage = $4, auto_advance = $5, omniscore_threshold = $6,
          match_score_threshold = $7, auto_reject = $8, auto_reject_threshold = $9,
          updated_at = NOW()
        RETURNING *
      `,
				[
					jobId,
					req.user.id,
					rule.from_stage,
					rule.to_stage,
					rule.auto_advance || false,
					rule.omniscore_threshold || 600,
					rule.match_score_threshold || 70,
					rule.auto_reject || false,
					rule.auto_reject_threshold || 400,
				],
			);
			saved.push(result.rows[0]);
		}

		res.json({ success: true, rules: saved });
	} catch (err) {
		console.error('Save pipeline automation error:', err);
		res.status(500).json({ error: 'Failed to save automation settings' });
	}
});

// Recruiter Feedback on candidate — feeds into OmniScore calibration
router.post('/ai/feedback', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const { candidate_id, job_id, feedback_type, notes } = req.body;
		if (!candidate_id || !feedback_type)
			return res
				.status(400)
				.json({ error: 'candidate_id and feedback_type (good_fit/not_fit) required' });

		const omniscoreService = require('../services/omniscore');
		const memoryService = require('../services/memory-service');

		// Save feedback
		const result = await pool.query(
			`
      INSERT INTO recruiter_feedback (recruiter_id, candidate_id, job_id, feedback_type, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (recruiter_id, candidate_id, job_id) DO UPDATE SET
        feedback_type = $4, notes = $5, updated_at = NOW()
      RETURNING *
    `,
			[req.user.id, candidate_id, job_id || null, feedback_type, notes || null],
		);

		// Feed into OmniScore: good_fit = +5 behavior points, not_fit = -3
		try {
			const points = feedback_type === 'good_fit' ? 5 : -2;
			const reason =
				feedback_type === 'good_fit'
					? 'Positive recruiter feedback'
					: 'Negative recruiter feedback';
			await omniscoreService.addBehaviorComponent(candidate_id, reason, Math.max(0, points), 10);
		} catch (e) {
			console.error('OmniScore feedback update (non-fatal):', e.message);
		}

		// Store in memory for MemGPT-style recall
		try {
			await memoryService.extractFromRecruiterAction(req.user.id, {
				type: 'candidate_feedback',
				feedback_type,
				candidate_id,
				job_title: 'position',
			});
		} catch (_e) {
			/* non-critical */
		}

		res.json({ success: true, feedback: result.rows[0] });
	} catch (err) {
		console.error('Recruiter feedback error:', err);
		res.status(500).json({ error: 'Failed to save feedback' });
	}
});

// Trigger pipeline auto-advance check for a job (event-driven: call after application status change)
router.post('/pipeline/auto-check/:jobId', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const jobId = req.params.jobId;

		// Get automation rules
		const rules = await pool.query(
			`
      SELECT * FROM pipeline_automation_rules
      WHERE job_id = $1 AND recruiter_id = $2 AND (auto_advance = true OR auto_reject = true)
    `,
			[jobId, req.user.id],
		);

		if (rules.rows.length === 0) {
			return res.json({ success: true, actions: [], message: 'No automation rules configured' });
		}

		const actions = [];

		// Get all active applications for this job
		const apps = await pool.query(
			`
      SELECT ja.id, ja.candidate_id, ja.status, ja.match_score,
             os.total_score as omniscore
      FROM job_applications ja
      LEFT JOIN omni_scores os ON os.user_id = ja.candidate_id
      WHERE ja.job_id = $1 AND ja.status NOT IN ('withdrawn', 'rejected', 'hired')
    `,
			[jobId],
		);

		for (const app of apps.rows) {
			for (const rule of rules.rows) {
				if (app.status !== rule.from_stage) continue;

				const omniscore = app.omniscore || 300;
				const matchScore = app.match_score || 0;

				// Auto-advance check
				if (
					rule.auto_advance &&
					omniscore >= rule.omniscore_threshold &&
					matchScore >= rule.match_score_threshold
				) {
					await pool.query(
						`UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id = $2`,
						[rule.to_stage, app.id],
					);
					actions.push({
						type: 'advanced',
						application_id: app.id,
						candidate_id: app.candidate_id,
						from: rule.from_stage,
						to: rule.to_stage,
						reason: `OmniScore ${omniscore} >= ${rule.omniscore_threshold} and match ${matchScore} >= ${rule.match_score_threshold}`,
					});
				}

				// Auto-reject check
				if (rule.auto_reject && omniscore < rule.auto_reject_threshold) {
					await pool.query(
						`UPDATE job_applications SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
						[app.id],
					);
					actions.push({
						type: 'rejected',
						application_id: app.id,
						candidate_id: app.candidate_id,
						from: rule.from_stage,
						reason: `OmniScore ${omniscore} < ${rule.auto_reject_threshold}`,
					});
				}
			}
		}

		res.json({
			success: true,
			actions,
			total_checked: apps.rows.length,
			rules_applied: rules.rows.length,
		});
	} catch (err) {
		console.error('Pipeline auto-check error:', err);
		res.status(500).json({ error: 'Failed to run pipeline automation' });
	}
});

// Get recruiter analytics dashboard data
router.get('/analytics', authMiddleware, requireRecruiter, async (req, res) => {
	try {
		const companyId = req.user.company_id;
		const days = parseInt(req.query.days, 10) || 30;
		const dateFilter = days > 0 ? `AND applied_at >= NOW() - INTERVAL '1 day' * $2` : '';

		// ─── OVERVIEW ───

		// Total active jobs for this company
		const activeJobsResult = await pool.query(
			`
      SELECT COUNT(*) as total_active_jobs
      FROM jobs WHERE company_id = $1 AND status = 'active'
    `,
			[companyId],
		);
		const totalActiveJobs = parseInt(activeJobsResult.rows[0]?.total_active_jobs, 10) || 0;

		// Total applications (all time)
		const totalAppsResult = await pool.query(
			`
      SELECT COUNT(*) as total_applications
      FROM job_applications WHERE company_id = $1 ${dateFilter}
    `,
			[companyId, days],
		);
		const totalApplications = parseInt(totalAppsResult.rows[0]?.total_applications, 10) || 0;

		// New applications this week (last 7 days)
		const newAppsWeekResult = await pool.query(
			`
      SELECT COUNT(*) as new_applications_this_week
      FROM job_applications
      WHERE company_id = $1 AND applied_at >= NOW() - INTERVAL '7 days'
    `,
			[companyId],
		);
		const newApplicationsThisWeek =
			parseInt(newAppsWeekResult.rows[0]?.new_applications_this_week, 10) || 0;

		// Total candidates (unique candidates who applied)
		const totalCandidatesResult = await pool.query(
			`
      SELECT COUNT(DISTINCT candidate_id) as total_candidates
      FROM job_applications WHERE company_id = $1
    `,
			[companyId],
		);
		const totalCandidates = parseInt(totalCandidatesResult.rows[0]?.total_candidates, 10) || 0;

		// Total job views (graceful)
		let totalViews = 0;
		try {
			const viewsResult = await pool.query(
				`
        SELECT COALESCE(SUM(views), 0) as total_views
        FROM job_analytics WHERE job_id IN (SELECT id FROM jobs WHERE company_id = $1)
      `,
				[companyId],
			);
			totalViews = parseInt(viewsResult.rows[0]?.total_views || '0', 10);
		} catch (_viewErr) {
			console.log('[analytics] job_analytics table not available, total_views = 0');
		}

		// ─── PIPELINE ───

		// Candidates in pipeline by stage (excluding terminal stages)
		const pipelineResult = await pool.query(
			`
      SELECT
        status,
        COUNT(*) as count
      FROM job_applications
      WHERE company_id = $1 AND status NOT IN ('rejected', 'withdrawn', 'hired')
      ${dateFilter}
      GROUP BY status
      ORDER BY count DESC
    `,
			[companyId, days],
		);

		const candidatesInPipeline = pipelineResult.rows.reduce((acc, row) => {
			acc[row.status] = parseInt(row.count, 10);
			return acc;
		}, {});
		const totalInPipeline = pipelineResult.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

		// Average time in current stage (days since application, grouped by current status)
		const timeInStageResult = await pool.query(
			`
      SELECT
        status,
        AVG(EXTRACT(EPOCH FROM (NOW() - applied_at)) / 86400) as avg_days
      FROM job_applications
      WHERE company_id = $1 AND status NOT IN ('rejected', 'withdrawn', 'hired')
      ${dateFilter}
      GROUP BY status
    `,
			[companyId, days],
		);

		const avgTimeInStage = timeInStageResult.rows.reduce((acc, row) => {
			acc[row.status] = row.avg_days ? parseFloat(row.avg_days).toFixed(1) : null;
			return acc;
		}, {});

		// ─── APPLICATIONS ───

		// All time application counts by status
		const allTimeAppsResult = await pool.query(
			`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'applied') as applied,
        COUNT(*) FILTER (WHERE status = 'screening') as screening,
        COUNT(*) FILTER (WHERE status = 'interviewed') as interviewed,
        COUNT(*) FILTER (WHERE status = 'offered') as offered,
        COUNT(*) FILTER (WHERE status = 'hired') as hired,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'withdrawn') as withdrawn
      FROM job_applications WHERE company_id = $1 ${dateFilter}
    `,
			[companyId, days],
		);
		const allTimeApps = allTimeAppsResult.rows[0] || {};

		// Last 7 days application counts
		const last7DaysAppsResult = await pool.query(
			`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'applied') as applied,
        COUNT(*) FILTER (WHERE status = 'screening') as screening,
        COUNT(*) FILTER (WHERE status = 'interviewed') as interviewed,
        COUNT(*) FILTER (WHERE status = 'offered') as offered,
        COUNT(*) FILTER (WHERE status = 'hired') as hired,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'withdrawn') as withdrawn
      FROM job_applications
      WHERE company_id = $1 AND applied_at >= NOW() - INTERVAL '7 days'
    `,
			[companyId],
		);
		const last7DaysApps = last7DaysAppsResult.rows[0] || {};

		// Last 30 days application counts
		const last30DaysAppsResult = await pool.query(
			`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'applied') as applied,
        COUNT(*) FILTER (WHERE status = 'screening') as screening,
        COUNT(*) FILTER (WHERE status = 'interviewed') as interviewed,
        COUNT(*) FILTER (WHERE status = 'offered') as offered,
        COUNT(*) FILTER (WHERE status = 'hired') as hired,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'withdrawn') as withdrawn
      FROM job_applications
      WHERE company_id = $1 AND applied_at >= NOW() - INTERVAL '30 days'
    `,
			[companyId],
		);
		const last30DaysApps = last30DaysAppsResult.rows[0] || {};

		// Source breakdown (graceful — mock if source column not tracked yet)
		let sourceBreakdown = [
			{ name: 'Direct', count: 0, percentage: 0 },
			{ name: 'LinkedIn', count: 0, percentage: 0 },
			{ name: 'Indeed', count: 0, percentage: 0 },
			{ name: 'Referral', count: 0, percentage: 0 },
			{ name: 'Other', count: 0, percentage: 0 },
		];
		try {
			const sourceResult = await pool.query(
				`
        SELECT COALESCE(source, 'Direct') as name, COUNT(*) as count
        FROM job_applications
        WHERE company_id = $1 ${dateFilter}
        GROUP BY source
      `,
				[companyId, days],
			);
			const total = sourceResult.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0) || 1;
			sourceBreakdown = sourceResult.rows.map((r) => ({
				name: r.name,
				count: parseInt(r.count, 10),
				percentage: Math.round((parseInt(r.count, 10) / total) * 100),
			}));
		} catch (_sourceErr) {
			console.log('[analytics] source tracking not available, using default breakdown');
		}

		// ─── CANDIDATES ───

		// Top skills in demand (from job requirements)
		let topSkills = [];
		try {
			// Try skills array column (PostgreSQL array)
			const skillsResult = await pool.query(
				`
        SELECT UNNEST(skills_required) as skill, COUNT(*) as count
        FROM jobs
        WHERE company_id = $1 AND skills_required IS NOT NULL
        GROUP BY skill
        ORDER BY count DESC
        LIMIT 10
      `,
				[companyId],
			);
			topSkills = skillsResult.rows.map((r) => ({ skill: r.skill, count: parseInt(r.count, 10) }));
		} catch (_skillsErr) {
			try {
				// Fallback: try skills as JSONB column
				const skillsJsonResult = await pool.query(
					`
          SELECT jsonb_array_elements_text(skills) as skill, COUNT(*) as count
          FROM jobs
          WHERE company_id = $1 AND skills IS NOT NULL
          GROUP BY skill
          ORDER BY count DESC
          LIMIT 10
        `,
					[companyId],
				);
				topSkills = skillsJsonResult.rows.map((r) => ({
					skill: r.skill,
					count: parseInt(r.count, 10),
				}));
			} catch (_skillsJsonErr) {
				console.log('[analytics] skills columns not available, top_skills empty');
			}
		}

		// Recent applications (top 10)
		const recentAppsResult = await pool.query(
			`
      SELECT
        ja.id, ja.status, ja.applied_at,
        u.name as candidate_name, u.email as candidate_email,
        j.title as job_title, j.id as job_id
      FROM job_applications ja
      JOIN users u ON ja.candidate_id = u.id
      JOIN jobs j ON ja.job_id = j.id
      WHERE ja.company_id = $1 ${dateFilter}
      ORDER BY ja.applied_at DESC
      LIMIT 10
    `,
			[companyId, days],
		);

		res.json({
			success: true,
			// Frontend-compatible AnalyticsData shape
			job_stats: {
				active_jobs: totalActiveJobs,
				paused_jobs: 0, // will be overridden if we fetch it
				closed_jobs: 0,
				total_views: totalViews,
			},
			application_stats: {
				total_applications: totalApplications,
				new_applications: newApplicationsThisWeek,
				reviewed: parseInt(allTimeApps.screening, 10) || 0,
				interviewed: parseInt(allTimeApps.interviewed, 10) || 0,
				offered: parseInt(allTimeApps.offered, 10) || 0,
				hired: parseInt(allTimeApps.hired, 10) || 0,
				rejected: parseInt(allTimeApps.rejected, 10) || 0,
			},
			avg_time_to_hire: avgTimeInStage?.hired || null,
			score_distribution: { 900: 0, 800: 0, 700: 0, 600: 0, below: 0 },
			source_breakdown: sourceBreakdown,
			// Extended detailed shape
			overview: {
				total_active_jobs: totalActiveJobs,
				total_applications: totalApplications,
				new_applications_this_week: newApplicationsThisWeek,
				total_candidates: totalCandidates,
				total_views: totalViews,
			},
			pipeline: {
				candidates_in_pipeline: candidatesInPipeline,
				total_in_pipeline: totalInPipeline,
				average_time_in_stage: avgTimeInStage,
			},
			applications: {
				all_time: {
					total: parseInt(allTimeApps.total, 10) || 0,
					applied: parseInt(allTimeApps.applied, 10) || 0,
					screening: parseInt(allTimeApps.screening, 10) || 0,
					interviewed: parseInt(allTimeApps.interviewed, 10) || 0,
					offered: parseInt(allTimeApps.offered, 10) || 0,
					hired: parseInt(allTimeApps.hired, 10) || 0,
					rejected: parseInt(allTimeApps.rejected, 10) || 0,
					withdrawn: parseInt(allTimeApps.withdrawn, 10) || 0,
				},
				last_7_days: {
					total: parseInt(last7DaysApps.total, 10) || 0,
					applied: parseInt(last7DaysApps.applied, 10) || 0,
					screening: parseInt(last7DaysApps.screening, 10) || 0,
					interviewed: parseInt(last7DaysApps.interviewed, 10) || 0,
					offered: parseInt(last7DaysApps.offered, 10) || 0,
					hired: parseInt(last7DaysApps.hired, 10) || 0,
					rejected: parseInt(last7DaysApps.rejected, 10) || 0,
					withdrawn: parseInt(last7DaysApps.withdrawn, 10) || 0,
				},
				last_30_days: {
					total: parseInt(last30DaysApps.total, 10) || 0,
					applied: parseInt(last30DaysApps.applied, 10) || 0,
					screening: parseInt(last30DaysApps.screening, 10) || 0,
					interviewed: parseInt(last30DaysApps.interviewed, 10) || 0,
					offered: parseInt(last30DaysApps.offered, 10) || 0,
					hired: parseInt(last30DaysApps.hired, 10) || 0,
					rejected: parseInt(last30DaysApps.rejected, 10) || 0,
					withdrawn: parseInt(last30DaysApps.withdrawn, 10) || 0,
				},
				source_breakdown: sourceBreakdown,
			},
			candidates: {
				top_skills_in_demand: topSkills,
				recent_applications: recentAppsResult.rows,
			},
		});
	} catch (err) {
		console.error('Recruiter analytics error:', err);
		res.status(500).json({ error: 'Failed to fetch analytics' });
	}
});

module.exports = router;
