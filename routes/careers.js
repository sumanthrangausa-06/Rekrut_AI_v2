// Career Pages Routes
const express = require('express');
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

// #1188: real average time to hire, in days, from hired applications.
// Null when the company has no hires - never a default number.
// Mirrors the pattern in routes/recruiter.js (dashboard time-to-hire).
async function getAvgTimeToHire(companyId) {
	try {
		const result = await pool.query(
			`SELECT AVG(EXTRACT(EPOCH FROM (hired_at - applied_at)) / 86400) as avg_days
			 FROM job_applications
			 WHERE company_id = $1 AND status = 'hired' AND hired_at IS NOT NULL`,
			[companyId],
		);
		return result.rows[0]?.avg_days ? Number(parseFloat(result.rows[0].avg_days).toFixed(1)) : null;
	} catch (_err) {
		return null;
	}
}

// GET /api/careers/default — return default career page for current recruiter's company
router.get('/default', authMiddleware, async (req, res) => {
	try {
		const companyId = req.user?.company_id;
		if (!companyId) {
			return res.status(404).json({ error: 'No company associated' });
		}

		// Get company data
		const companyResult = await pool.query(
			`SELECT id, name, slug, industry, company_size AS size, website, description, logo_url, headquarters AS location, founded_year,
			        (SELECT COUNT(*) FROM jobs WHERE company_id = companies.id AND status = 'active') as open_positions,
			        (SELECT AVG(overall_rating) FROM company_ratings WHERE company_id = companies.id AND status = 'published') as rating,
			        (SELECT COUNT(*) FROM company_ratings WHERE company_id = companies.id AND status = 'published') as review_count,
			        (SELECT ts.total_score FROM trust_scores ts WHERE ts.company_id = companies.id) as trustscore
			 FROM companies WHERE id = $1`,
			[companyId],
		);

		if (companyResult.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const company = companyResult.rows[0];

		// Get active jobs for this company
		const jobsResult = await pool.query(
			`SELECT j.id, j.title, d.name AS department, j.location, j.job_type, j.salary_range, j.created_at
			 FROM jobs j LEFT JOIN departments d ON d.id = j.department_id WHERE j.company_id = $1 AND j.status = 'active' ORDER BY j.created_at DESC`,
			[companyId],
		);

		const avgTimeToHire = await getAvgTimeToHire(company.id);

		// Build response matching CareerPageData type
		const data = {
			company: {
				id: String(company.id),
				name: company.name,
				logo: company.logo_url,
				tagline: company.description
					? company.description.split('.')[0]
					: `Join ${company.name} — we're hiring!`,
				description:
					company.description ||
					`${company.name} is a leading company in the ${company.industry || 'technology'} industry.`,
				website: company.website || '#',
				location: company.location || 'Remote-friendly',
				size: company.size || null,
				industry: company.industry || 'Technology / SaaS',
				founded: company.founded_year ? String(company.founded_year) : null,
				trustscore: company.trustscore != null ? Math.round(company.trustscore) : null,
				rating:
					parseInt(company.review_count, 10) > 0 && company.rating != null
						? Number(parseFloat(company.rating).toFixed(1))
						: null,
				reviewCount: parseInt(company.review_count, 10) || 0,
			},
			culture: {
				values: ['Innovation', 'Diversity', 'Transparency', 'Growth', 'Impact'],
				benefits: [
					{
						icon: 'health',
						label: 'Health Insurance',
						description: '100% coverage for you and dependents',
					},
					{
						icon: 'remote',
						label: 'Remote Work',
						description: 'Work from anywhere, async-friendly',
					},
					{
						icon: 'flexible',
						label: 'Flexible Hours',
						description: 'Choose your own schedule',
					},
					{
						icon: 'learning',
						label: 'Learning Budget',
						description: '$5,000/year for courses and conferences',
					},
					{
						icon: 'equity',
						label: 'Equity',
						description: 'Meaningful stock options for all employees',
					},
					{
						icon: 'vacation',
						label: 'Unlimited PTO',
						description: 'Take time when you need it',
					},
					{
						icon: 'parental',
						label: 'Parental Leave',
						description: '20 weeks paid for all parents',
					},
					{
						icon: 'gym',
						label: 'Wellness',
						description: '$100/month gym or wellness stipend',
					},
				],
				photos: [],
			},
			team: [
				{
					id: '1',
					name: 'Team Lead',
					role: 'Engineering Manager',
					quote: 'We build the future together',
				},
				{
					id: '2',
					name: 'Hiring Manager',
					role: 'People Operations',
					quote: 'People are our greatest asset',
				},
			],
			jobs: jobsResult.rows.map((j) => ({
				id: String(j.id),
				title: j.title,
				department: j.department || 'General',
				location: j.location || 'Remote',
				type: j.job_type || 'Full-time',
				salary: j.salary_range || 'Competitive',
				postedAt: j.created_at ? new Date(j.created_at).toISOString().split('T')[0] : '',
				matchScore: undefined,
			})),
			stats: {
				openPositions: parseInt(company.open_positions, 10) || jobsResult.rows.length,
				avgTimeToHire,
				// Declared company_size, not a headcount - never the platform
				// team-account count, never a default.
				employees: company.size ? String(company.size) : null,
				// No real source for growth exists; do not invent one (#1188).
				growthRate: null,
			},
		};

		res.json(data);
	} catch (err) {
		console.error('Career page error:', err);
		res.status(500).json({ error: 'Failed to load career page' });
	}
});

// GET /api/careers/:id — return career page by company id or slug (public, no auth required)
router.get('/:id', async (req, res) => {
	try {
		const { id } = req.params;

		// Try to find by id first, then by slug
		let companyResult;
		if (/^\d+$/.test(id)) {
			companyResult = await pool.query(
				`SELECT id, name, slug, industry, company_size AS size, website, description, logo_url, headquarters AS location, founded_year,
				        (SELECT COUNT(*) FROM jobs WHERE company_id = companies.id AND status = 'active') as open_positions,
				        (SELECT AVG(overall_rating) FROM company_ratings WHERE company_id = companies.id AND status = 'published') as rating,
				        (SELECT COUNT(*) FROM company_ratings WHERE company_id = companies.id AND status = 'published') as review_count,
				        (SELECT ts.total_score FROM trust_scores ts WHERE ts.company_id = companies.id) as trustscore
				 FROM companies WHERE id = $1`,
				[id],
			);
		} else {
			companyResult = await pool.query(
				`SELECT id, name, slug, industry, company_size AS size, website, description, logo_url, headquarters AS location, founded_year,
				        (SELECT COUNT(*) FROM jobs WHERE company_id = companies.id AND status = 'active') as open_positions,
				        (SELECT AVG(overall_rating) FROM company_ratings WHERE company_id = companies.id AND status = 'published') as rating,
				        (SELECT COUNT(*) FROM company_ratings WHERE company_id = companies.id AND status = 'published') as review_count,
				        (SELECT ts.total_score FROM trust_scores ts WHERE ts.company_id = companies.id) as trustscore
				 FROM companies WHERE slug = $1`,
				[id],
			);
		}

		if (companyResult.rows.length === 0) {
			return res.status(404).json({ error: 'Company not found' });
		}

		const company = companyResult.rows[0];

		// Get active jobs for this company
		const jobsResult = await pool.query(
			`SELECT j.id, j.title, d.name AS department, j.location, j.job_type, j.salary_range, j.created_at
			 FROM jobs j LEFT JOIN departments d ON d.id = j.department_id WHERE j.company_id = $1 AND j.status = 'active' ORDER BY j.created_at DESC`,
			[company.id],
		);

		const avgTimeToHire = await getAvgTimeToHire(company.id);

		// Build response matching CareerPageData type
		const data = {
			company: {
				id: String(company.id),
				name: company.name,
				logo: company.logo_url,
				tagline: company.description
					? company.description.split('.')[0]
					: `Join ${company.name} — we're hiring!`,
				description:
					company.description ||
					`${company.name} is a leading company in the ${company.industry || 'technology'} industry.`,
				website: company.website || '#',
				location: company.location || 'Remote-friendly',
				size: company.size || null,
				industry: company.industry || 'Technology / SaaS',
				founded: company.founded_year ? String(company.founded_year) : null,
				trustscore: company.trustscore != null ? Math.round(company.trustscore) : null,
				rating:
					parseInt(company.review_count, 10) > 0 && company.rating != null
						? Number(parseFloat(company.rating).toFixed(1))
						: null,
				reviewCount: parseInt(company.review_count, 10) || 0,
			},
			culture: {
				values: ['Innovation', 'Diversity', 'Transparency', 'Growth', 'Impact'],
				benefits: [
					{
						icon: 'health',
						label: 'Health Insurance',
						description: '100% coverage for you and dependents',
					},
					{
						icon: 'remote',
						label: 'Remote Work',
						description: 'Work from anywhere, async-friendly',
					},
					{
						icon: 'flexible',
						label: 'Flexible Hours',
						description: 'Choose your own schedule',
					},
					{
						icon: 'learning',
						label: 'Learning Budget',
						description: '$5,000/year for courses and conferences',
					},
					{
						icon: 'equity',
						label: 'Equity',
						description: 'Meaningful stock options for all employees',
					},
					{
						icon: 'vacation',
						label: 'Unlimited PTO',
						description: 'Take time when you need it',
					},
					{
						icon: 'parental',
						label: 'Parental Leave',
						description: '20 weeks paid for all parents',
					},
					{
						icon: 'gym',
						label: 'Wellness',
						description: '$100/month gym or wellness stipend',
					},
				],
				photos: [],
			},
			team: [
				{
					id: '1',
					name: 'Team Lead',
					role: 'Engineering Manager',
					quote: 'We build the future together',
				},
				{
					id: '2',
					name: 'Hiring Manager',
					role: 'People Operations',
					quote: 'People are our greatest asset',
				},
			],
			jobs: jobsResult.rows.map((j) => ({
				id: String(j.id),
				title: j.title,
				department: j.department || 'General',
				location: j.location || 'Remote',
				type: j.job_type || 'Full-time',
				salary: j.salary_range || 'Competitive',
				postedAt: j.created_at ? new Date(j.created_at).toISOString().split('T')[0] : '',
				matchScore: undefined,
			})),
			stats: {
				openPositions: parseInt(company.open_positions, 10) || jobsResult.rows.length,
				avgTimeToHire,
				// Declared company_size, not a headcount - never the platform
				// team-account count, never a default.
				employees: company.size ? String(company.size) : null,
				// No real source for growth exists; do not invent one (#1188).
				growthRate: null,
			},
		};

		res.json(data);
	} catch (err) {
		console.error('Career page error:', err);
		res.status(500).json({ error: 'Failed to load career page' });
	}
});

module.exports = router;
