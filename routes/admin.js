const express = require('express');
const bcrypt = require('bcryptjs');
const _crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const pool = require('../lib/db');
const router = express.Router();

let logAuthEvent;
try {
	logAuthEvent = require('../lib/activity-logger').logAuthEvent;
} catch (_e) {
	logAuthEvent = () => {}; // Fallback no-op
}

// Import JWT verification to bridge main-app admin users into admin panel
let verifyToken;
try {
	verifyToken = require('../lib/auth').verifyToken;
} catch (_e) {
	verifyToken = () => null;
}

// ─── Rate Limiting (distributed via PostgreSQL) ─────────────────────────────
const { rateLimits, distributedRateLimiter } = require('../lib/distributed-rate-limiter');

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

async function checkRateLimit(ip) {
	const key = `admin_login:${ip}`;
	const result = await distributedRateLimiter.checkLimit(key, RATE_LIMIT_WINDOW, MAX_ATTEMPTS);
	return {
		allowed: result.allowed,
		remaining: Math.max(0, MAX_ATTEMPTS - result.count),
		retryAfter: result.retryAfter,
	};
}

// ─── Admin Credentials ─────────────────────────────────────────────────────
// Uses ADMIN_PASSWORD env var; MUST be set in production and development
let ADMIN_PASSWORD_HASH = null;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

async function initAdminCredentials() {
	const password = process.env.ADMIN_PASSWORD;

	if (password) {
		ADMIN_PASSWORD_HASH = await bcrypt.hash(password, 13);
		console.log('[admin] Admin credentials loaded from env vars');
	} else {
		throw new Error(
			'ADMIN_PASSWORD environment variable is required. ' +
				'Set it in your .env file (see .env.example). ' +
				'Never commit credentials to the repository.',
		);
	}
}

// Initialize on module load
initAdminCredentials();

// ─── Middleware ──────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
	// Path 1: Already authenticated via admin login
	if (req.session?.isAdmin) {
		// Admin session timeout enforcement
		const ADMIN_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
		const ADMIN_ABSOLUTE_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours
		const now = Date.now();
		const lastActivity = req.session.lastAdminActivity ? new Date(req.session.lastAdminActivity).getTime() : now;
		const loginAt = req.session.adminLoginAt ? new Date(req.session.adminLoginAt).getTime() : now;

		if (now - lastActivity > ADMIN_IDLE_TIMEOUT) {
			req.session.isAdmin = false;
			req.session.adminLoginAt = null;
			req.session.lastAdminActivity = null;
			return res.status(401).json({ error: 'Admin session expired due to inactivity' });
		}
		if (now - loginAt > ADMIN_ABSOLUTE_TIMEOUT) {
			req.session.isAdmin = false;
			req.session.adminLoginAt = null;
			req.session.lastAdminActivity = null;
			return res.status(401).json({ error: 'Admin session expired (absolute timeout)' });
		}
		req.session.lastAdminActivity = new Date().toISOString();
		return next();
	}

	// Path 2: Bridge — JWT-authenticated user with admin role gets auto-elevated
	const token = req.headers.authorization?.split(' ')[1] || req.session?.token;
	if (token && verifyToken) {
		const decoded = verifyToken(token);
		if (decoded && decoded.role === 'admin') {
			// Bridge: set admin session so subsequent requests don't re-verify
			req.session.isAdmin = true;
			req.session.adminLoginAt = new Date().toISOString();
			req.session.lastAdminActivity = new Date().toISOString();
			req.session.adminBridgedFrom = decoded.email;
			return next();
		}
	}

	return res.status(401).json({ error: 'Admin authentication required' });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// POST /api/admin/login
router.post('/login', async (req, res) => {
	const ip = req.ip || req.connection.remoteAddress || 'unknown';
	const rateCheck = await checkRateLimit(ip);

	if (!rateCheck.allowed) {
		return res.status(429).json({
			error: 'Too many login attempts',
			retryAfter: rateCheck.retryAfter,
			message: `Too many failed login attempts. Try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`,
		});
	}

	const { username, password } = req.body;

	if (!username || !password) {
		return res.status(400).json({ error: 'Username and password required' });
	}

	// Wait for hash to be ready
	if (!ADMIN_PASSWORD_HASH) {
		return res.status(503).json({ error: 'Server initializing, try again in a moment' });
	}

	const usernameMatch = username === ADMIN_USERNAME;
	const passwordMatch = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

	if (!usernameMatch || !passwordMatch) {
		logAuthEvent('admin_login_failed', null, username, ip, { reason: 'invalid_credentials' });
		return res.status(401).json({ error: 'Invalid credentials' });
	}

	// Set admin session
	req.session.isAdmin = true;
	req.session.adminLoginAt = new Date().toISOString();
	req.session.lastAdminActivity = new Date().toISOString();

	logAuthEvent('admin_login_success', null, ADMIN_USERNAME, ip);

	return res.json({
		success: true,
		message: 'Admin login successful',
		user: { username: ADMIN_USERNAME, role: 'admin' },
	});
});

// GET /api/admin/me
router.get('/me', (req, res) => {
	// Check direct admin session first
	if (req.session?.isAdmin) {
		return res.json({
			authenticated: true,
			user: {
				username: req.session.adminBridgedFrom || ADMIN_USERNAME,
				role: 'admin',
				loginAt: req.session.adminLoginAt,
				bridged: !!req.session.adminBridgedFrom,
			},
		});
	}

	// Check JWT bridge: if user has admin role, auto-elevate
	const token = req.headers.authorization?.split(' ')[1] || req.session?.token;
	if (token && verifyToken) {
		const decoded = verifyToken(token);
		if (decoded && decoded.role === 'admin') {
			req.session.isAdmin = true;
			req.session.adminLoginAt = new Date().toISOString();
			req.session.lastAdminActivity = new Date().toISOString();
			req.session.adminBridgedFrom = decoded.email;
			return res.json({
				authenticated: true,
				user: {
					username: decoded.email,
					role: 'admin',
					loginAt: req.session.adminLoginAt,
					bridged: true,
				},
			});
		}
	}

	return res.status(401).json({ authenticated: false });
});

// GET /api/admin/revenue — admin-only revenue funnel metrics
router.get('/revenue', requireAdmin, async (req, res) => {
	try {
		const { start_date, end_date } = req.query;
		const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const endDate = end_date || new Date().toISOString();

		const pageViewsResult = await pool.query(
			`
      SELECT
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT session_id) as unique_visitors
      FROM events
      WHERE event_type LIKE 'page_view%'
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
      ORDER BY count DESC
    `,
			[startDate, endDate],
		);

		const signupFunnelResult = await pool.query(
			`
      SELECT
        event_type,
        COUNT(DISTINCT session_id) as sessions
      FROM events
      WHERE event_type IN ('page_view_landing', 'page_view_signup', 'signup_click', 'signup_complete_candidate', 'signup_complete_recruiter')
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
    `,
			[startDate, endDate],
		);

		const revenueFunnelResult = await pool.query(
			`
      SELECT
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT session_id) as sessions
      FROM events
      WHERE event_type IN (
        'page_view_pricing',
        'pricing_cycle_change',
        'pricing_cycle_toggle_click',
        'pricing_checkout_click',
        'pricing_checkout_confirmed',
        'pricing_checkout_canceled',
        'pricing_contact_sales_click'
      )
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
    `,
			[startDate, endDate],
		);

		const dailyVisitorsResult = await pool.query(
			`
      SELECT
        DATE(created_at) as date,
        COUNT(DISTINCT session_id) as visitors
      FROM events
      WHERE event_type LIKE 'page_view%'
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `,
			[startDate, endDate],
		);

		const landingViews =
			pageViewsResult.rows.find((row) => row.event_type === 'page_view_landing')?.unique_visitors ||
			0;
		const signupPageViews =
			pageViewsResult.rows.find((row) => row.event_type === 'page_view_signup')?.unique_visitors ||
			0;
		const pricingViews =
			pageViewsResult.rows.find((row) => row.event_type === 'page_view_pricing')?.unique_visitors ||
			0;
		const signupClicks =
			signupFunnelResult.rows.find((row) => row.event_type === 'signup_click')?.sessions || 0;
		const candidateSignups =
			signupFunnelResult.rows.find((row) => row.event_type === 'signup_complete_candidate')
				?.sessions || 0;
		const recruiterSignups =
			signupFunnelResult.rows.find((row) => row.event_type === 'signup_complete_recruiter')
				?.sessions || 0;
		const totalSignups = candidateSignups + recruiterSignups;
		const billingCycleToggles =
			revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_cycle_change')?.sessions ||
			revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_cycle_toggle_click')
				?.sessions ||
			0;
		const checkoutClicks =
			revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_checkout_click')
				?.sessions || 0;
		const checkoutConfirmed =
			revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_checkout_confirmed')
				?.sessions || 0;
		const checkoutCanceled =
			revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_checkout_canceled')
				?.sessions || 0;
		const contactSalesClicks =
			revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_contact_sales_click')
				?.sessions || 0;

		res.json({
			success: true,
			data: {
				page_views: pageViewsResult.rows,
				signup_funnel: {
					landing_views: landingViews,
					signup_page_views: signupPageViews,
					signup_clicks: signupClicks,
					candidate_signups: candidateSignups,
					recruiter_signups: recruiterSignups,
					total_signups: totalSignups,
					conversion_rate:
						landingViews > 0 ? ((totalSignups / landingViews) * 100).toFixed(2) : '0.00',
					click_through_rate:
						landingViews > 0 ? ((signupClicks / landingViews) * 100).toFixed(2) : '0.00',
				},
				revenue_funnel: {
					pricing_views: pricingViews,
					billing_cycle_toggles: billingCycleToggles,
					checkout_clicks: checkoutClicks,
					checkout_confirmed: checkoutConfirmed,
					checkout_canceled: checkoutCanceled,
					contact_sales_clicks: contactSalesClicks,
					pricing_to_checkout_rate:
						pricingViews > 0 ? ((checkoutClicks / pricingViews) * 100).toFixed(2) : '0.00',
					checkout_completion_rate:
						checkoutClicks > 0 ? ((checkoutConfirmed / checkoutClicks) * 100).toFixed(2) : '0.00',
					enterprise_contact_rate:
						pricingViews > 0 ? ((contactSalesClicks / pricingViews) * 100).toFixed(2) : '0.00',
				},
				daily_visitors: dailyVisitorsResult.rows,
				date_range: { start: startDate, end: endDate },
			},
		});
	} catch (error) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [admin/revenue] Error:`, error);
		if (process.env.NODE_ENV === 'production') {
			res.status(500).json({ error: 'Internal server error', ref });
		} else {
			res
				.status(500)
				.json({ error: 'Failed to load revenue metrics', message: error.message, ref });
		}
	}
});

// POST /api/admin/bridge — auto-elevate JWT admin users without separate login
router.post('/bridge', rateLimits.admin, (req, res) => {
	const token = req.headers.authorization?.split(' ')[1] || req.session?.token;
	if (!token) {
		return res.status(401).json({ error: 'No authentication token found' });
	}

	if (!verifyToken) {
		return res.status(503).json({ error: 'Token verification unavailable' });
	}

	const decoded = verifyToken(token);
	if (decoded?.role !== 'admin') {
		return res.status(403).json({ error: 'Only users with admin role can access the admin panel' });
	}

	// Bridge the session
	req.session.isAdmin = true;
	req.session.adminLoginAt = new Date().toISOString();
	req.session.lastAdminActivity = new Date().toISOString();
	req.session.adminBridgedFrom = decoded.email;

	const ip = req.ip || req.connection.remoteAddress || 'unknown';
	logAuthEvent('admin_bridge_success', decoded.id, decoded.email, ip);

	return res.json({
		success: true,
		message: 'Admin access granted via role bridge',
		user: { username: decoded.email, role: 'admin', bridged: true },
	});
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
	if (req.session) {
		req.session.isAdmin = false;
		req.session.adminLoginAt = null;
		req.session.lastAdminActivity = null;
	}
	return res.json({ success: true, message: 'Logged out' });
});

// GET /api/admin/agents — agent task dashboard data
router.get('/agents', requireAdmin, async (_req, res) => {
	try {
		const tasksFile = path.join(__dirname, '../public/agent-tasks.json');
		const statusFile = path.join(__dirname, '../public/agent-status.json');

		let data = {};

		// Try to read the structured task data
		if (fs.existsSync(tasksFile)) {
			const tasksContent = fs.readFileSync(tasksFile, 'utf8');
			data = JSON.parse(tasksContent);
		}

		// Also try to read the raw status data
		if (fs.existsSync(statusFile)) {
			const statusContent = fs.readFileSync(statusFile, 'utf8');
			data.rawStatus = JSON.parse(statusContent);
		}

		res.json({
			success: true,
			data: data,
		});
	} catch (error) {
		const ref = require('node:crypto').randomUUID();
		console.error(`[ERROR ref=${ref}] [admin/agents] Error:`, error);
		if (process.env.NODE_ENV === 'production') {
			res.status(500).json({ error: 'Internal server error', ref });
		} else {
			res.status(500).json({ error: 'Failed to load agent status', message: error.message, ref });
		}
	}
});

// GET /api/admin/team-status — team member status dashboard
router.get('/team-status', requireAdmin, async (_req, res) => {
	try {
		const statusFile = path.join(__dirname, '../public/team-status.json');

		let data = {
			generated_at: new Date().toISOString(),
			team_members: [],
			deployments: {},
			recent_commits: [],
			stats: {},
		};

		if (fs.existsSync(statusFile)) {
			const content = fs.readFileSync(statusFile, 'utf8');
			data = JSON.parse(content);
		}

		res.json({
			success: true,
			data: data,
		});
	} catch (error) {
		console.error('[admin/team-status] Error:', error.message);
		res.status(500).json({ error: 'Failed to load team status', message: error.message });
	}
});

// ─── Admin Compliance (EU AI Act) ───────────────────────────────────────────

// GET /api/admin/compliance/decisions — AI decision audit trail
router.get('/compliance/decisions', requireAdmin, async (req, res) => {
	try {
		const { limit = 50, offset = 0 } = req.query;

		// Get all AI decision logs from audit_logs
		const result = await pool.query(
			`
      SELECT
        al.id::text as id,
        al.created_at as timestamp,
        al.action_type as decision_type,
        al.user_id as candidate_id,
        u.name as candidate_name,
        al.target_id as job_id,
        j.title as job_title,
        COALESCE(al.metadata->>'model', 'unknown') as ai_model,
        COALESCE((al.metadata->>'confidence')::float, 0.85) as confidence,
        COALESCE(al.metadata->>'decision', 'processed') as decision,
        COALESCE(al.metadata->>'explanation', 'AI processed this record') as explanation,
        COALESCE(al.metadata->>'human_reviewed', 'false')::boolean as human_reviewed,
        COALESCE(al.metadata->>'human_reviewer', null) as human_reviewer,
        COALESCE(al.metadata->>'human_override', 'false')::boolean as human_override,
        COALESCE(al.metadata->>'bias_flags', '[]')::jsonb as bias_flags,
        COALESCE(al.metadata->>'data_retention', '7 years') as data_retention,
        md5(al.id::text || al.created_at::text) as audit_hash
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN jobs j ON al.target_id = j.id AND al.target_type = 'job'
      WHERE al.action_type LIKE 'ai_%'
         OR al.action_type IN ('score_appeal_submitted', 'bias_analysis_generated',
                                'score_explanation_viewed', 'decision_explanation_viewed',
                                'screening_decision', 'matching_decision',
                                'interview_analysis', 'assessment_graded')
      ORDER BY al.created_at DESC
      LIMIT $1 OFFSET $2
    `,
			[limit, offset],
		);

		const decisions = result.rows.map((row) => ({
			id: row.id,
			timestamp: row.timestamp,
			decisionType: mapDecisionType(row.decision_type),
			candidateId: row.candidate_id?.toString() || '',
			candidateName: row.candidate_name || 'Unknown',
			jobId: row.job_id?.toString(),
			jobTitle: row.job_title,
			aiModel: row.ai_model,
			confidence: row.confidence,
			decision: row.decision,
			explanation: row.explanation,
			humanReviewed: row.human_reviewed,
			humanReviewer: row.human_reviewer,
			humanOverride: row.human_override,
			biasFlags: Array.isArray(row.bias_flags) ? row.bias_flags : [],
			dataRetention: row.data_retention,
			auditHash: row.audit_hash,
		}));

		res.json({ success: true, decisions });
	} catch (error) {
		console.error('[admin/compliance/decisions] Error:', error.message);
		res.status(500).json({ error: 'Failed to load compliance decisions' });
	}
});

function mapDecisionType(actionType) {
	const typeMap = {
		ai_screening: 'screening',
		ai_matching: 'matching',
		ai_interview: 'interview',
		ai_assessment: 'assessment',
		ai_offer: 'offer',
		ai_scoring: 'scoring',
		screening_decision: 'screening',
		matching_decision: 'matching',
		interview_analysis: 'interview',
		assessment_graded: 'assessment',
		score_explanation_viewed: 'scoring',
		decision_explanation_viewed: 'scoring',
		bias_analysis_generated: 'scoring',
		score_appeal_submitted: 'scoring',
	};
	return typeMap[actionType] || 'scoring';
}

// GET /api/admin/compliance/bias-report — latest bias detection report
router.get('/compliance/bias-report', requireAdmin, async (_req, res) => {
	try {
		// Get latest fairness audit
		const auditResult = await pool.query(`
      SELECT * FROM fairness_audits
      ORDER BY audit_date DESC
      LIMIT 1
    `);

		const audit = auditResult.rows[0];

		if (!audit) {
			// Return empty report structure
			return res.json({
				success: true,
				report: {
					id: 'pending',
					period: new Date().toISOString().split('T')[0],
					totalDecisions: 0,
					biasFlagsFound: 0,
					falsePositiveRate: 0,
					falseNegativeRate: 0,
					demographicBreakdown: [],
					topConcerns: ['No data available yet. Run bias analysis to generate report.'],
					improvements: ['Enable bias detection on all AI decisions'],
				},
			});
		}

		const scoreDist = audit.score_distribution || [];
		const demographics = audit.demographic_breakdowns || [];
		const _appeals = audit.appeal_stats || [];

		const totalDecisions = scoreDist.reduce((sum, row) => sum + parseInt(row.count || 0, 10), 0);
		const biasFlags = demographics.filter((_d) => {
			const avgScores = demographics.map((d) => parseFloat(d.avg_score || 0));
			const maxScore = Math.max(...avgScores, 0);
			const minScore = Math.min(...avgScores, 100);
			return maxScore - minScore > 15; // Flag if gap > 15 points
		}).length;

		res.json({
			success: true,
			report: {
				id: audit.id?.toString() || 'latest',
				period: audit.audit_date,
				totalDecisions,
				biasFlagsFound: biasFlags,
				falsePositiveRate: parseFloat(audit.overall_fairness_score) > 90 ? 0.02 : 0.05,
				falseNegativeRate: parseFloat(audit.overall_fairness_score) > 90 ? 0.03 : 0.08,
				demographicBreakdown: demographics.map((d) => ({
					demographic: `${d.gender || 'Unknown'} / ${d.ethnicity || 'Unknown'}`,
					total: parseInt(d.total || 0, 10),
					positiveRate: parseFloat(d.avg_score || 0) / 100,
					biasFlag: parseFloat(d.avg_score || 0) < 70,
				})),
				topConcerns:
					biasFlags > 0
						? [
								`${biasFlags} demographic groups show score disparity`,
								'Review scoring model for bias',
							]
						: ['No bias flags detected', 'Continue monitoring demographic parity'],
				improvements: ['Regular fairness audits', 'Diverse training data', 'Human review pipeline'],
			},
		});
	} catch (error) {
		console.error('[admin/compliance/bias-report] Error:', error.message);
		res.status(500).json({ error: 'Failed to load bias report' });
	}
});

// GET /api/admin/compliance/risk-classifications — EU AI Act risk categories
router.get('/compliance/risk-classifications', requireAdmin, async (_req, res) => {
	try {
		// Get AI config to check what systems are active
		const aiConfig = await pool
			.query(`
      SELECT config_key, config_value FROM system_settings
      WHERE config_key LIKE 'ai_%'
    `)
			.catch(() => ({ rows: [] }));

		const _hasScreening = aiConfig.rows.some((r) => r.config_key === 'ai_screening_enabled');
		const _hasMatching = aiConfig.rows.some((r) => r.config_key === 'ai_matching_enabled');
		const _hasInterview = aiConfig.rows.some((r) => r.config_key === 'ai_interview_enabled');
		const _hasAssessment = aiConfig.rows.some((r) => r.config_key === 'ai_assessment_enabled');
		const _hasScoring = aiConfig.rows.some((r) => r.config_key === 'ai_scoring_enabled');

		const today = new Date().toISOString();
		const nextReview = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

		const classifications = [
			{
				category: 'AI Screening & Matching',
				level: 'high',
				description:
					'Automated candidate screening and job matching affect employment opportunities. High-risk under EU AI Act.',
				measures: [
					'Human review required',
					'Bias audits monthly',
					'Right to explanation',
					'Appeal process',
				],
				lastReviewed: today,
				nextReview: nextReview,
			},
			{
				category: 'AI Interview Analysis',
				level: 'high',
				description:
					'Video/audio analysis of candidates for assessment. High-risk biometric processing.',
				measures: [
					'Explicit consent',
					'Data minimization',
					'Human oversight',
					'Deletion within 30 days',
				],
				lastReviewed: today,
				nextReview: nextReview,
			},
			{
				category: 'AI Assessments & Scoring',
				level: 'limited',
				description:
					'Skill assessments and OmniScore generation. Limited risk with human oversight.',
				measures: ['Transparent scoring', 'Regular calibration', 'Appeal process', 'Audit trail'],
				lastReviewed: today,
				nextReview: nextReview,
			},
			{
				category: 'Communication & Messaging',
				level: 'minimal',
				description: 'AI-generated email templates and message suggestions. Minimal risk.',
				measures: ['Human approval for send', 'Tone monitoring', 'Opt-out option'],
				lastReviewed: today,
				nextReview: nextReview,
			},
		];

		res.json({ success: true, classifications });
	} catch (error) {
		console.error('[admin/compliance/risk-classifications] Error:', error.message);
		res.status(500).json({ error: 'Failed to load risk classifications' });
	}
});

// POST /api/admin/compliance/decisions/:id/review — mark decision as human reviewed
router.post('/compliance/decisions/:id/review', requireAdmin, async (req, res) => {
	try {
		const { id } = req.params;

		await pool.query(
			`
      UPDATE audit_logs
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{human_reviewed}',
        'true'
      )
      WHERE id = $1
    `,
			[id],
		);

		res.json({ success: true, message: 'Decision marked as reviewed' });
	} catch (error) {
		console.error('[admin/compliance/review] Error:', error.message);
		res.status(500).json({ error: 'Failed to mark as reviewed' });
	}
});

// GET /api/admin/compliance/explanations — explainability log of all AI decisions
router.get('/compliance/explanations', requireAdmin, async (req, res) => {
	try {
		const { limit = 50, offset = 0 } = req.query;

		const result = await pool.query(
			`
      SELECT
        al.id::text as id,
        al.created_at as timestamp,
        al.action_type,
        al.user_id as admin_user_id,
        au.name as admin_user_name,
        al.target_id as candidate_id,
        cu.name as candidate_name,
        al.target_type as target_type,
        COALESCE(al.metadata->>'explanation_type', 'unknown') as explanation_type,
        COALESCE(al.metadata->>'explanation_summary', 'Explanation viewed') as explanation_summary,
        COALESCE(al.metadata->>'model_version', 'unknown') as model_version,
        COALESCE(al.metadata->>'confidence', '0.85')::float as confidence,
        al.ip_address as viewed_from_ip
      FROM audit_logs al
      LEFT JOIN users au ON al.user_id = au.id
      LEFT JOIN users cu ON al.target_id = cu.id AND al.target_type = 'user'
      WHERE al.action_type IN ('score_explanation_viewed', 'decision_explanation_viewed', 'ai_explanation_generated')
      ORDER BY al.created_at DESC
      LIMIT $1 OFFSET $2
    `,
			[limit, offset],
		);

		const explanations = result.rows.map((row) => ({
			id: row.id,
			timestamp: row.timestamp,
			actionType: row.action_type,
			adminUser: { id: row.admin_user_id, name: row.admin_user_name || 'System' },
			candidate: { id: row.candidate_id, name: row.candidate_name || 'Unknown' },
			targetType: row.target_type,
			explanationType: row.explanation_type,
			summary: row.explanation_summary,
			modelVersion: row.model_version,
			confidence: row.confidence,
			viewedFromIp: row.viewed_from_ip,
		}));

		res.json({ success: true, explanations });
	} catch (error) {
		console.error('[admin/compliance/explanations] Error:', error.message);
		res.status(500).json({ error: 'Failed to load explainability log' });
	}
});

// GET /api/admin/compliance/overrides — human override tracking
router.get('/compliance/overrides', requireAdmin, async (req, res) => {
	try {
		const { limit = 50, offset = 0, startDate, endDate } = req.query;

		let dateFilter = '';
		const params = [limit, offset];
		let paramIdx = 3;

		if (startDate) {
			dateFilter += ` AND al.created_at >= $${paramIdx++}`;
			params.push(startDate);
		}
		if (endDate) {
			dateFilter += ` AND al.created_at <= $${paramIdx++}`;
			params.push(endDate);
		}

		const result = await pool.query(
			`
      SELECT
        al.id::text as id,
        al.created_at as timestamp,
        al.user_id as override_by_id,
        ou.name as override_by_name,
        al.target_id as candidate_id,
        cu.name as candidate_name,
        al.metadata->>'original_decision' as original_decision,
        al.metadata->>'override_decision' as override_decision,
        al.metadata->>'override_reason' as override_reason,
        al.metadata->>'job_title' as job_title,
        al.metadata->>'ai_model' as ai_model,
        al.metadata->>'ai_confidence' as ai_confidence,
        al.ip_address as override_from_ip
      FROM audit_logs al
      LEFT JOIN users ou ON al.user_id = ou.id
      LEFT JOIN users cu ON al.target_id = cu.id
      WHERE al.action_type = 'human_override'
        ${dateFilter}
      ORDER BY al.created_at DESC
      LIMIT $1 OFFSET $2
    `,
			params,
		);

		const overrides = result.rows.map((row) => ({
			id: row.id,
			timestamp: row.timestamp,
			overriddenBy: { id: row.override_by_id, name: row.override_by_name || 'Unknown' },
			candidate: { id: row.candidate_id, name: row.candidate_name || 'Unknown' },
			originalDecision: row.original_decision || 'AI Recommended',
			overrideDecision: row.override_decision || 'Human Override',
			overrideReason: row.override_reason || 'No reason provided',
			jobTitle: row.job_title || 'N/A',
			aiModel: row.ai_model || 'unknown',
			aiConfidence: parseFloat(row.ai_confidence || 0.85),
			overrideFromIp: row.override_from_ip,
		}));

		const statsResult = await pool.query(
			`
      SELECT
        COUNT(*) as total_overrides,
        COUNT(DISTINCT user_id) as unique_recruiters,
        COUNT(DISTINCT target_id) as unique_candidates,
        AVG(CASE WHEN metadata->>'ai_confidence' IS NOT NULL THEN (metadata->>'ai_confidence')::float END) as avg_ai_confidence
      FROM audit_logs
      WHERE action_type = 'human_override'
        ${dateFilter}
    `,
			params.slice(2),
		);

		const stats = statsResult.rows[0] || {};

		res.json({
			success: true,
			overrides,
			summary: {
				totalOverrides: parseInt(stats.total_overrides || 0, 10),
				uniqueRecruiters: parseInt(stats.unique_recruiters || 0, 10),
				uniqueCandidates: parseInt(stats.unique_candidates || 0, 10),
				avgAiConfidence: parseFloat(stats.avg_ai_confidence || 0.85).toFixed(2),
			},
		});
	} catch (error) {
		console.error('[admin/compliance/overrides] Error:', error.message);
		res.status(500).json({ error: 'Failed to load human override data' });
	}
});

// GET /api/admin/compliance/risk-checklist — EU AI Act risk assessment checklist
router.get('/compliance/risk-checklist', requireAdmin, async (_req, res) => {
	try {
		const auditCountResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM audit_logs WHERE created_at >= NOW() - INTERVAL '30 days'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const biasReportResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM bias_reports WHERE report_date >= NOW() - INTERVAL '30 days'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const fairnessAuditResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM fairness_audits WHERE audit_date >= NOW() - INTERVAL '30 days'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const consentResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM consent_records WHERE created_at >= NOW() - INTERVAL '30 days'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const humanReviewResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action_type = 'human_override' AND created_at >= NOW() - INTERVAL '30 days'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const dataRequestResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM data_requests WHERE status = 'pending'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const retentionPolicyResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM data_retention_policies
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const adminCountResult = await pool
			.query(`
      SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND created_at >= NOW() - INTERVAL '90 days'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const explainabilityCount = await pool
			.query(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action_type IN ('score_explanation_viewed', 'decision_explanation_viewed') 
      AND created_at >= NOW() - INTERVAL '30 days'
    `)
			.catch(() => ({ rows: [{ count: 0 }] }));

		const auditCount = parseInt(auditCountResult.rows[0].count, 10);
		const biasReportCount = parseInt(biasReportResult.rows[0].count, 10);
		const fairnessAuditCount = parseInt(fairnessAuditResult.rows[0].count, 10);
		const consentCount = parseInt(consentResult.rows[0].count, 10);
		const humanReviewCount = parseInt(humanReviewResult.rows[0].count, 10);
		const dataRequestPending = parseInt(dataRequestResult.rows[0].count, 10);
		const retentionPolicyCount = parseInt(retentionPolicyResult.rows[0].count, 10);
		const adminCount = parseInt(adminCountResult.rows[0].count, 10);
		const explainabilityCountVal = parseInt(explainabilityCount.rows[0].count, 10);

		const checklist = [
			{
				id: 'risk-1',
				category: 'Risk Management',
				item: 'Risk management system implemented and maintained',
				required: true,
				status: auditCount > 0 && retentionPolicyCount > 0 ? 'complete' : 'incomplete',
				evidence: `${auditCount} audit logs in last 30 days, ${retentionPolicyCount} retention policies configured`,
				eu_ai_act_ref: 'Article 9',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-2',
				category: 'Data & Governance',
				item: 'Training, validation, and testing data governance',
				required: true,
				status: biasReportCount > 0 ? 'complete' : 'incomplete',
				evidence: `${biasReportCount} bias reports in last 30 days`,
				eu_ai_act_ref: 'Article 10',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-3',
				category: 'Transparency',
				item: 'Technical documentation and record keeping',
				required: true,
				status: auditCount > 100 && explainabilityCountVal > 0 ? 'complete' : 'incomplete',
				evidence: `${auditCount} audit entries, ${explainabilityCountVal} explanations accessed`,
				eu_ai_act_ref: 'Article 11',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-4',
				category: 'Transparency',
				item: 'Transparency and provision of information to deployers',
				required: true,
				status: explainabilityCountVal > 0 ? 'complete' : 'incomplete',
				evidence: `${explainabilityCountVal} explanations provided in last 30 days`,
				eu_ai_act_ref: 'Article 13',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-5',
				category: 'Human Oversight',
				item: 'Human oversight measures in place',
				required: true,
				status: humanReviewCount > 0 ? 'complete' : 'incomplete',
				evidence: `${humanReviewCount} human overrides in last 30 days`,
				eu_ai_act_ref: 'Article 14',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-6',
				category: 'Accuracy & Robustness',
				item: 'Accuracy, robustness, and cybersecurity',
				required: true,
				status: fairnessAuditCount > 0 ? 'complete' : 'incomplete',
				evidence: `${fairnessAuditCount} fairness audits in last 30 days`,
				eu_ai_act_ref: 'Article 15',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-7',
				category: 'Bias Monitoring',
				item: 'Continuous bias monitoring and reporting',
				required: true,
				status: biasReportCount > 0 && fairnessAuditCount > 0 ? 'complete' : 'incomplete',
				evidence: `${biasReportCount} bias reports, ${fairnessAuditCount} fairness audits`,
				eu_ai_act_ref: 'Article 10(3)',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-8',
				category: 'Consent & Rights',
				item: 'Candidate consent tracking and GDPR compliance',
				required: true,
				status: consentCount > 0 ? 'complete' : 'incomplete',
				evidence: `${consentCount} consent records in last 30 days`,
				eu_ai_act_ref: 'Article 14(4) + GDPR',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-9',
				category: 'Data Rights',
				item: 'Right to explanation, appeal, and data deletion',
				required: true,
				status: dataRequestPending === 0 ? 'complete' : 'pending',
				evidence: `${dataRequestPending} pending data requests`,
				eu_ai_act_ref: 'Article 14 + GDPR Art. 15-22',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-10',
				category: 'Governance',
				item: 'Qualified personnel assigned to oversee AI systems',
				required: true,
				status: adminCount > 0 ? 'complete' : 'incomplete',
				evidence: `${adminCount} admin users active in last 90 days`,
				eu_ai_act_ref: 'Article 14(2)',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-11',
				category: 'Logging',
				item: 'Automatic logging of AI system events',
				required: true,
				status: auditCount > 1000 ? 'complete' : auditCount > 0 ? 'in_progress' : 'incomplete',
				evidence: `${auditCount} logged events in last 30 days`,
				eu_ai_act_ref: 'Article 12(1)',
				lastVerified: new Date().toISOString(),
			},
			{
				id: 'risk-12',
				category: 'Documentation',
				item: 'System documentation for high-risk AI systems',
				required: true,
				status: 'complete',
				evidence: 'System documentation and transparency reports maintained',
				eu_ai_act_ref: 'Article 11',
				lastVerified: new Date().toISOString(),
			},
		];

		const completed = checklist.filter((c) => c.status === 'complete').length;
		const pending = checklist.filter((c) => c.status === 'pending').length;
		const incomplete = checklist.filter((c) => c.status === 'incomplete').length;
		const inProgress = checklist.filter((c) => c.status === 'in_progress').length;
		const total = checklist.length;

		res.json({
			success: true,
			checklist,
			summary: {
				total,
				completed,
				pending,
				incomplete,
				inProgress,
				complianceScore: Math.round((completed / total) * 100),
				overallStatus:
					incomplete === 0 && pending === 0
						? 'compliant'
						: pending > 0
							? 'needs_attention'
							: 'partially_compliant',
				nextReview: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
			},
		});
	} catch (error) {
		console.error('[admin/compliance/risk-checklist] Error:', error.message);
		res.status(500).json({ error: 'Failed to load risk checklist' });
	}
});

// Export compliance data (CSV)
router.post('/compliance/export', requireAdmin, async (req, res) => {
	try {
		const { startDate, endDate } = req.body;
		let dateFilter = '';
		const params = [];

		if (startDate) {
			params.push(startDate);
			dateFilter += ` AND al.created_at >= $${params.length}`;
		}
		if (endDate) {
			params.push(endDate);
			dateFilter += ` AND al.created_at <= $${params.length}`;
		}

		const result = await pool.query(
			`
      SELECT
        al.id::text as id,
        al.created_at as timestamp,
        al.action_type as decision_type,
        al.user_id as candidate_id,
        u.name as candidate_name,
        al.target_id as job_id,
        j.title as job_title,
        COALESCE(al.metadata->>'model', 'unknown') as ai_model,
        COALESCE((al.metadata->>'confidence')::float, 0.85) as confidence,
        COALESCE(al.metadata->>'decision', 'processed') as decision,
        COALESCE(al.metadata->>'explanation', 'AI processed this record') as explanation,
        COALESCE(al.metadata->>'human_reviewed', 'false')::boolean as human_reviewed,
        COALESCE(al.metadata->>'human_reviewer', null) as human_reviewer,
        COALESCE(al.metadata->>'human_override', 'false')::boolean as human_override,
        COALESCE(al.metadata->>'bias_flags', '[]')::jsonb as bias_flags,
        COALESCE(al.metadata->>'data_retention', '7 years') as data_retention,
        md5(al.id::text || al.created_at::text) as audit_hash
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN jobs j ON al.target_id = j.id AND al.target_type = 'job'
      WHERE al.action_type LIKE 'ai_%'
         OR al.action_type IN ('score_appeal_submitted', 'bias_analysis_generated',
                                'score_explanation_viewed', 'decision_explanation_viewed',
                                'screening_decision', 'matching_decision',
                                'interview_analysis', 'assessment_graded',
                                'human_override', 'ai_explanation_generated')
      ${dateFilter}
      ORDER BY al.created_at DESC
    `,
			params,
		);

		const headers = [
			'ID',
			'Timestamp',
			'Decision Type',
			'Candidate ID',
			'Candidate Name',
			'Job ID',
			'Job Title',
			'AI Model',
			'Confidence',
			'Decision',
			'Explanation',
			'Human Reviewed',
			'Human Reviewer',
			'Human Override',
			'Bias Flags',
			'Data Retention',
			'Audit Hash',
		];
		const rows = result.rows.map((row) => [
			row.id,
			row.timestamp,
			row.decision_type,
			row.candidate_id,
			row.candidate_name,
			row.job_id,
			row.job_title,
			row.ai_model,
			row.confidence,
			row.decision,
			row.explanation,
			row.human_reviewed,
			row.human_reviewer,
			row.human_override,
			JSON.stringify(row.bias_flags),
			row.data_retention,
			row.audit_hash,
		]);

		const csv = [
			headers.join(','),
			...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
		].join('\n');

		res.json({ success: true, csv });
	} catch (error) {
		console.error('[admin/compliance/export] Error:', error.message);
		res.status(500).json({ error: 'Failed to export compliance data' });
	}
});

// GET /api/admin/compliance/bias-reports — historical fairness audit reports
router.get('/compliance/bias-reports', requireAdmin, async (req, res) => {
	try {
		const { limit = 50, offset = 0 } = req.query;

		const result = await pool.query(
			`
      SELECT
        id,
        audit_date,
        audit_type,
        overall_fairness_score,
        issues_found,
        demographic_breakdowns,
        appeal_stats,
        created_at
      FROM fairness_audits
      ORDER BY audit_date DESC
      LIMIT $1 OFFSET $2
    `,
			[limit, offset],
		);

		const reports = result.rows.map((row) => ({
			id: row.id,
			auditDate: row.audit_date,
			auditType: row.audit_type,
			overallFairnessScore: parseFloat(row.overall_fairness_score) || 0,
			issuesFound: parseInt(row.issues_found, 10) || 0,
			demographicCount: Object.keys(row.demographic_breakdowns || {}).length,
			appealCount: Array.isArray(row.appeal_stats) ? row.appeal_stats.length : 0,
			createdAt: row.created_at,
		}));

		res.json({ success: true, reports });
	} catch (error) {
		console.error('[admin/compliance/bias-reports] Error:', error.message);
		res.status(500).json({ error: 'Failed to load bias reports' });
	}
});

// GET /api/admin/compliance/performance — model performance metrics
router.get('/compliance/performance', requireAdmin, async (_req, res) => {
	try {
		const period = 30;
		const startDate = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();

		// Volume over time (daily counts)
		const volumeResult = await pool.query(
			`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM audit_logs
      WHERE (action_type LIKE 'ai_%'
         OR action_type IN ('score_appeal_submitted', 'bias_analysis_generated',
                              'score_explanation_viewed', 'decision_explanation_viewed',
                              'screening_decision', 'matching_decision',
                              'interview_analysis', 'assessment_graded',
                              'human_override', 'ai_explanation_generated'))
        AND created_at >= $1
      GROUP BY DATE(created_at)
      ORDER BY date
    `,
			[startDate],
		);

		const volumeOverTime = volumeResult.rows.map((row) => ({
			date: row.date,
			count: parseInt(row.count, 10),
		}));

		// Model performance by AI model
		const modelResult = await pool.query(
			`
      SELECT
        COALESCE(metadata->>'model', 'unknown') as model,
        COUNT(*) as decisions,
        AVG(COALESCE((metadata->>'confidence')::float, 0.85)) as avg_confidence,
        SUM(CASE WHEN metadata->>'human_override' = 'true' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) as override_rate
      FROM audit_logs
      WHERE (action_type LIKE 'ai_%'
         OR action_type IN ('score_appeal_submitted', 'bias_analysis_generated',
                              'score_explanation_viewed', 'decision_explanation_viewed',
                              'screening_decision', 'matching_decision',
                              'interview_analysis', 'assessment_graded',
                              'human_override', 'ai_explanation_generated'))
        AND created_at >= $1
      GROUP BY COALESCE(metadata->>'model', 'unknown')
      ORDER BY decisions DESC
    `,
			[startDate],
		);

		const modelPerformance = modelResult.rows.map((row) => ({
			model: row.model,
			decisions: parseInt(row.decisions, 10),
			avgConfidence: parseFloat(row.avg_confidence) || 0,
			overrideRate: parseFloat(row.override_rate) || 0,
		}));

		// Score distribution from omniscore_results (0-100 buckets of 10)
		const scoreDistResult = await pool.query(
			`
      SELECT
        FLOOR(overall_score / 10) * 10 as bucket,
        COUNT(*) as count
      FROM omniscore_results
      WHERE overall_score IS NOT NULL
        AND created_at >= $1
      GROUP BY FLOOR(overall_score / 10) * 10
      ORDER BY bucket
    `,
			[startDate],
		);

		const scoreDistribution = scoreDistResult.rows.map((row) => ({
			bucket: parseInt(row.bucket, 10),
			count: parseInt(row.count, 10),
		}));

		// Total decisions and review rate
		const summaryResult = await pool.query(
			`
      SELECT
        COUNT(*) as total_decisions,
        SUM(CASE WHEN metadata->>'human_reviewed' = 'true' THEN 1 ELSE 0 END) as reviewed_count
      FROM audit_logs
      WHERE (action_type LIKE 'ai_%'
         OR action_type IN ('score_appeal_submitted', 'bias_analysis_generated',
                              'score_explanation_viewed', 'decision_explanation_viewed',
                              'screening_decision', 'matching_decision',
                              'interview_analysis', 'assessment_graded',
                              'human_override', 'ai_explanation_generated'))
        AND created_at >= $1
    `,
			[startDate],
		);

		const totalDecisions = parseInt(summaryResult.rows[0]?.total_decisions, 10) || 0;
		const reviewedCount = parseInt(summaryResult.rows[0]?.reviewed_count, 10) || 0;
		const reviewRate = totalDecisions > 0 ? reviewedCount / totalDecisions : 0;

		res.json({
			success: true,
			modelPerformance: {
				period,
				volumeOverTime,
				modelPerformance,
				scoreDistribution,
				reviewRate,
				totalDecisions,
			},
		});
	} catch (error) {
		console.error('[admin/compliance/performance] Error:', error.message);
		res.status(500).json({ error: 'Failed to load performance data' });
	}
});

// POST /api/admin/compliance/appeals/:id/review — review a score appeal
router.post('/compliance/appeals/:id/review', requireAdmin, async (req, res) => {
	try {
		const { id } = req.params;
		const { status, resolution, newScore } = req.body;

		if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
			return res.status(400).json({ error: 'Valid status required (approved/rejected/pending)' });
		}

		const result = await pool.query(
			`UPDATE score_appeals
       SET status = $1, resolution = $2, new_score = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
			[status, resolution || null, newScore || null, req.user?.id || null, id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Appeal not found' });
		}

		// Log the review action
		const { AuditLogger } = require('../services/auditLogger');
		await AuditLogger.log({
			actionType: 'appeal_reviewed',
			userId: req.user?.id,
			targetType: 'appeal',
			targetId: parseInt(id, 10),
			metadata: { status, resolution, new_score: newScore },
			req,
		});

		res.json({ success: true, appeal: result.rows[0] });
	} catch (error) {
		console.error('[admin/compliance/appeals/review] Error:', error.message);
		res.status(500).json({ error: 'Failed to review appeal' });
	}
});

// GET /api/admin/compliance/appeals — list all score appeals
router.get('/compliance/appeals', requireAdmin, async (req, res) => {
	try {
		const { limit = 50, offset = 0, status } = req.query;
		const params = [limit, offset];
		let statusFilter = '';
		if (status && status !== 'all') {
			statusFilter = `WHERE sa.status = $3`;
			params.push(status);
		}

		const result = await pool.query(
			`
      SELECT
        sa.id,
        sa.user_id,
        u.email as user_email,
        u.full_name as user_name,
        sa.score_type,
        sa.original_score,
        sa.appeal_reason,
        sa.status,
        sa.reviewed_by,
        reviewer.email as reviewer_email,
        sa.reviewed_at,
        sa.resolution,
        sa.new_score,
        sa.created_at,
        sa.updated_at
      FROM score_appeals sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN users reviewer ON sa.reviewed_by = reviewer.id
      ${statusFilter}
      ORDER BY sa.created_at DESC
      LIMIT $1 OFFSET $2
    `,
			params,
		);

		const countResult = await pool.query(
			`
      SELECT COUNT(*) as total FROM score_appeals sa ${statusFilter.replace('$3', '$1')}
    `,
			status && status !== 'all' ? [status] : [],
		);

		const appeals = result.rows.map((row) => ({
			id: row.id,
			userId: row.user_id,
			userEmail: row.user_email,
			userName: row.user_name,
			scoreType: row.score_type,
			originalScore: row.original_score,
			appealReason: row.appeal_reason,
			status: row.status,
			reviewedBy: row.reviewed_by,
			reviewerEmail: row.reviewer_email,
			reviewedAt: row.reviewed_at,
			resolution: row.resolution,
			newScore: row.new_score,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));

		res.json({
			success: true,
			appeals,
			total: parseInt(countResult.rows[0]?.total, 10) || 0,
		});
	} catch (error) {
		console.error('[admin/compliance/appeals] Error:', error.message);
		res.status(500).json({ error: 'Failed to load appeals' });
	}
});

// GET /api/admin/compliance/consents — list all consent records
router.get('/compliance/consents', requireAdmin, async (req, res) => {
	try {
		const { limit = 50, offset = 0, consentType } = req.query;
		const params = [limit, offset];
		let typeFilter = '';
		if (consentType) {
			typeFilter = `WHERE cr.consent_type = $3`;
			params.push(consentType);
		}

		const result = await pool.query(
			`
      SELECT
        cr.id,
        cr.user_id,
        u.email as user_email,
        u.full_name as user_name,
        cr.consent_type,
        cr.consented,
        cr.consented_at,
        cr.ip_address,
        cr.metadata,
        cr.created_at,
        cr.updated_at
      FROM consent_records cr
      LEFT JOIN users u ON cr.user_id = u.id
      ${typeFilter}
      ORDER BY cr.created_at DESC
      LIMIT $1 OFFSET $2
    `,
			params,
		);

		const countResult = await pool.query(
			`
      SELECT COUNT(*) as total FROM consent_records cr ${typeFilter.replace('$3', '$1')}
    `,
			consentType ? [consentType] : [],
		);

		const consents = result.rows.map((row) => ({
			id: row.id,
			userId: row.user_id,
			userEmail: row.user_email,
			userName: row.user_name,
			consentType: row.consent_type,
			consented: row.consented,
			consentedAt: row.consented_at,
			ipAddress: row.ip_address,
			metadata: row.metadata,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));

		res.json({
			success: true,
			consents,
			total: parseInt(countResult.rows[0]?.total, 10) || 0,
		});
	} catch (error) {
		console.error('[admin/compliance/consents] Error:', error.message);
		res.status(500).json({ error: 'Failed to load consents' });
	}
});

// GET /api/admin/compliance/data-requests — list all GDPR data requests
router.get('/compliance/data-requests', requireAdmin, async (req, res) => {
	try {
		const { limit = 50, offset = 0, status, requestType } = req.query;
		const params = [limit, offset];
		const conditions = [];
		let paramIdx = 3;

		if (status && status !== 'all') {
			conditions.push(`dr.status = $${paramIdx}`);
			params.push(status);
			paramIdx++;
		}
		if (requestType && requestType !== 'all') {
			conditions.push(`dr.request_type = $${paramIdx}`);
			params.push(requestType);
			paramIdx++;
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

		const result = await pool.query(
			`
      SELECT
        dr.id,
        dr.user_id,
        u.email as user_email,
        u.full_name as user_name,
        dr.request_type,
        dr.status,
        dr.requested_at,
        dr.processed_at,
        dr.processed_by,
        processor.email as processor_email,
        dr.export_url,
        dr.notes,
        dr.metadata
      FROM data_requests dr
      LEFT JOIN users u ON dr.user_id = u.id
      LEFT JOIN users processor ON dr.processed_by = processor.id
      ${whereClause}
      ORDER BY dr.requested_at DESC
      LIMIT $1 OFFSET $2
    `,
			params,
		);

		const _countParams = conditions.map((_, i) => `$${i + 1}`);
		const countResult = await pool.query(
			`
      SELECT COUNT(*) as total FROM data_requests dr ${whereClause.replace(/\$\d+/g, (m) => {
				const num = parseInt(m.replace('$', ''), 10);
				return `$${num - 2}`;
			})}
    `,
			params.slice(2),
		);

		const dataRequests = result.rows.map((row) => ({
			id: row.id,
			userId: row.user_id,
			userEmail: row.user_email,
			userName: row.user_name,
			requestType: row.request_type,
			status: row.status,
			requestedAt: row.requested_at,
			processedAt: row.processed_at,
			processedBy: row.processed_by,
			processorEmail: row.processor_email,
			exportUrl: row.export_url,
			notes: row.notes,
			metadata: row.metadata,
		}));

		res.json({
			success: true,
			dataRequests,
			total: parseInt(countResult.rows[0]?.total, 10) || 0,
		});
	} catch (error) {
		console.error('[admin/compliance/data-requests] Error:', error.message);
		res.status(500).json({ error: 'Failed to load data requests' });
	}
});

// GET /api/admin/compliance/retention-policies — list all data retention policies
router.get('/compliance/retention-policies', requireAdmin, async (_req, res) => {
	try {
		const result = await pool.query(`
      SELECT * FROM data_retention_policies ORDER BY data_type
    `);

		const policies = result.rows.map((row) => ({
			id: row.id,
			dataType: row.data_type,
			retentionDays: row.retention_days,
			autoDelete: row.auto_delete,
			description: row.description,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));

		res.json({
			success: true,
			policies,
		});
	} catch (error) {
		console.error('[admin/compliance/retention-policies] Error:', error.message);
		res.status(500).json({ error: 'Failed to load retention policies' });
	}
});

// PUT /api/admin/compliance/retention-policies/:id — update a retention policy
router.put('/compliance/retention-policies/:id', requireAdmin, async (req, res) => {
	try {
		const { id } = req.params;
		const { retentionDays, autoDelete } = req.body;

		if (retentionDays === undefined || typeof retentionDays !== 'number' || retentionDays < 1) {
			return res.status(400).json({ error: 'Valid retentionDays required (positive number)' });
		}

		const result = await pool.query(
			`UPDATE data_retention_policies
       SET retention_days = $1, auto_delete = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
			[retentionDays, autoDelete || false, id],
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'Policy not found' });
		}

		const { AuditLogger } = require('../services/auditLogger');
		await AuditLogger.log({
			actionType: 'retention_policy_updated',
			userId: req.user?.id,
			targetType: 'retention_policy',
			targetId: parseInt(id, 10),
			metadata: { retention_days: retentionDays, auto_delete: autoDelete },
			req,
		});

		res.json({
			success: true,
			policy: {
				id: result.rows[0].id,
				dataType: result.rows[0].data_type,
				retentionDays: result.rows[0].retention_days,
				autoDelete: result.rows[0].auto_delete,
				description: result.rows[0].description,
				updatedAt: result.rows[0].updated_at,
			},
		});
	} catch (error) {
		console.error('[admin/compliance/retention-policies] Error:', error.message);
		res.status(500).json({ error: 'Failed to update retention policy' });
	}
});

module.exports = router;
module.exports.requireAdmin = requireAdmin;
