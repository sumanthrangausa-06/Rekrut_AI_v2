const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const helmet = require('helmet');
const crypto = require('node:crypto');

// Load environment variables from .env file
require('dotenv').config();

const pool = require('./lib/db');

// ─── Startup Environment Validation ─────────────────────────────────────
const REQUIRED_ENV_VARS = [
	{ key: 'DATABASE_URL', required: true },
	{ key: 'JWT_SECRET', required: true },
	{ key: 'SESSION_SECRET', required: true },
];

const missingEnv = REQUIRED_ENV_VARS.filter((env) => env.required && !process.env[env.key]);
if (missingEnv.length > 0) {
	console.error('[startup] CRITICAL: Missing required environment variables:');
	missingEnv.forEach((env) => console.error(`  - ${env.key}`));
	console.error('[startup] Application will start but may fail on database-dependent endpoints.');
}

// Validate SMTP configuration (warn only, not fatal)
const smtpVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
const missingSmtp = smtpVars.filter((v) => !process.env[v]);
if (missingSmtp.length > 0) {
	console.warn('[startup] SMTP not fully configured. Email sending will be disabled.');
	console.warn(`  Missing: ${missingSmtp.join(', ')}`);
}

// Validate Stripe configuration (warn only)
const stripeVars = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'];
const missingStripe = stripeVars.filter((v) => !process.env[v]);
if (missingStripe.length > 0) {
	console.warn('[startup] Stripe not fully configured. Billing features will be disabled.');
	console.warn(`  Missing: ${missingStripe.join(', ')}`);
}

const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const interviewRoutes = require('./routes/interviews');
const quickPracticeRoutes = require('./routes/quick-practice'); // ISOLATED from Mock Interview (#32717)
const omniscoreRoutes = require('./routes/omniscore');
const companyRoutes = require('./routes/company');
const trustscoreRoutes = require('./routes/trustscore');
const recruiterRoutes = require('./routes/recruiter');
const candidateRoutes = require('./routes/candidate');
const assessmentRoutes = require('./routes/assessments');
const matchingRoutes = require('./routes/matching');
const documentRoutes = require('./routes/documents');
const payrollRoutes = require('./routes/payroll');
const complianceRoutes = require('./routes/compliance');
const onboardingRoutes = require('./routes/onboarding');
const analyticsRoutes = require('./routes/analytics');
const countryRoutes = require('./routes/countries');
const adminRoutes = require('./routes/admin');
const { requireAdmin } = require('./routes/admin');
const memoryRoutes = require('./routes/memory');
const communicationsRoutes = require('./routes/communications');
const notificationsRoutes = require('./routes/notifications');
const billingRoutes = require('./routes/billing');
const voiceNotificationsRoutes = require('./routes/voice-notifications');
const screeningRoutes = require('./routes/screening');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// Disable x-powered-by header
app.disable('x-powered-by');

// Trust proxy (Render runs behind a reverse proxy)
app.set('trust proxy', 1);

// Security headers — MUST be first, before all middleware and routes
app.use(
	helmet({
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'self'"],
				styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
				fontSrc: ["'self'", 'https://fonts.gstatic.com'],
				scriptSrc: ["'self'"],
				imgSrc: ["'self'", 'data:', 'https:'],
				connectSrc: [
					"'self'",
					...(process.env.NODE_ENV === 'development' ? ['https://rekrutai-dev.onrender.com'] : []),
					'https://api.rekrutai.co',
				],
				frameAncestors: ["'none'"],
				upgradeInsecureRequests: [],
			},
		},
		crossOriginEmbedderPolicy: false, // Allow embedded resources
		hsts: {
			maxAge: 31536000,
			includeSubDomains: true,
			preload: true,
		},
	}),
);


// Version / deployment verification endpoint
app.get('/version', (_req, res) => {
	try {
		const { execSync } = require('node:child_process');
		const commit = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
		const branch = execSync('git branch --show-current', { cwd: __dirname, encoding: 'utf8' }).trim();
		const timestamp = execSync('git log -1 --format=%ci', { cwd: __dirname, encoding: 'utf8' }).trim();
		res.json({ commit, branch, timestamp, env: process.env.NODE_ENV || 'unknown' });
	} catch (err) {
		res.json({ commit: 'unknown', branch: 'unknown', env: process.env.NODE_ENV || 'unknown', error: err.message });
	}
});

// Health check — available after helmet so security headers are present
app.get('/health', async (_req, res) => {
	try {
		const { runHealthCheck } = require('./lib/db-health'); // deployed 2026-06-13
		const health = await runHealthCheck();
		const statusCode = health.healthy ? 200 : 503;
		res.status(statusCode).json({
			status: health.healthy ? 'ok' : 'degraded',
			timestamp: new Date().toISOString(),
			deployed_at: '2026-06-13T02:20:00Z', // Force redeploy trigger
			version: '2.0.1',
			commit: 'staging-redeploy-2026-06-13',
			db: health.connection,
			tables: health.tables,
			pool: health.pool,
			env: health.env,
			issues: health.issues,
		});
	} catch (err) {
		res.status(503).json({
			status: 'error',
			timestamp: new Date().toISOString(),
			error: err.message,
		});
	}
});

// API health alias for monitoring consistency
app.get('/api/health', async (_req, res) => {
	try {
		const { runHealthCheck } = require('./lib/db-health');
		const health = await runHealthCheck();
		const statusCode = health.healthy ? 200 : 503;
		res.status(statusCode).json({
			status: health.healthy ? 'ok' : 'degraded',
			timestamp: new Date().toISOString(),
			db: health.connection,
			tables: health.tables,
			pool: health.pool,
			env: health.env,
			issues: health.issues,
		});
	} catch (err) {
		res.status(503).json({
			status: 'error',
			timestamp: new Date().toISOString(),
			error: err.message,
		});
	}
});

// CORS — whitelist origins in production, allow dev origins in development
const corsOrigins = process.env.CORS_ORIGINS
	? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
	: process.env.NODE_ENV === 'production'
		? [
				'https://rekrutai.co',
				'https://www.rekrutai.co',
				'https://app.rekrutai.co',
			]
		: [
				'http://localhost:3000',
				'http://localhost:5173',
				'http://localhost:4173',
				'http://127.0.0.1:5173',
				'http://127.0.0.1:4173',
				'http://127.0.0.1:3000',
				'https://hireloop-vzvw.polsia.app',
				'https://rekrutai-dev.onrender.com',
				'https://rekrutai-staging.onrender.com',
			];

app.use(
	cors({
		origin: (origin, callback) => {
			// Allow requests with no origin (e.g., mobile apps, curl, server-to-server)
			if (!origin) return callback(null, true);
			if (corsOrigins.includes(origin)) return callback(null, true);
			return callback(new Error('Not allowed by CORS'));
		},
		credentials: true,
	}),
);

// Permissions-Policy: deny-by-default, allow only camera and microphone for same-origin
app.use((_req, res, next) => {
	res.setHeader(
		'Permissions-Policy',
		'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), vr=(), ambient-light-sensor=()',
	);
	next();
});

app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── CSRF Protection — double-submit cookie pattern ──────────────────────
const CSRF_COOKIE_NAME = '_csrf';

// Generate CSRF token cookie if missing; expose token on req.csrfToken
function generateCsrfToken(req, res, next) {
	if (!req.cookies[CSRF_COOKIE_NAME]) {
		const token = crypto.randomBytes(32).toString('hex');
		res.cookie(CSRF_COOKIE_NAME, token, {
			httpOnly: false, // frontend must read it
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
		});
		req.csrfToken = token;
	} else {
		req.csrfToken = req.cookies[CSRF_COOKIE_NAME];
	}
	next();
}

// CSRF validation: skip safe methods and /csrf-token endpoint
function csrfProtection(req, res, next) {
	if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
		return next();
	}
	if (req.path === '/csrf-token') {
		return next();
	}
	// Exempt auth endpoints from CSRF — these don't have a session yet
	// and the login/register forms are protected by other means (rate limits, CORS)
	if (req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/auth/register')) {
		return next();
	}
	const cookieToken = req.cookies[CSRF_COOKIE_NAME];
	const headerToken = req.headers['x-csrf-token'] || req.headers['X-CSRF-Token'];
	if (!cookieToken || !headerToken || cookieToken !== headerToken) {
		console.log('[csrf] Validation failed:', {
			path: req.path,
			method: req.method,
			hasCookie: !!cookieToken,
			hasHeader: !!headerToken,
			match: cookieToken === headerToken,
		});
		return res.status(403).json({ error: 'CSRF token validation failed', code: 'CSRF_INVALID' });
	}
	next();
}

app.use(generateCsrfToken);

// GET /csrf-token — returns the current CSRF token for the frontend
app.get('/csrf-token', (req, res) => {
	res.json({ csrfToken: req.csrfToken });
});

// Apply CSRF protection to all subsequent state-changing routes
app.use(csrfProtection);

// Validate session secret before configuring session middleware
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
	throw new Error('SESSION_SECRET environment variable is required. Set a strong random string.');
}

app.use(
	session({
		store: new pgSession({
			pool: pool,
			tableName: 'user_sessions',
			createTableIfMissing: true, // Auto-creates table on first run
		}),
		secret: sessionSecret,
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: process.env.NODE_ENV === 'production', // Secure in production; allow HTTP in dev
			httpOnly: true,
			maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
			sameSite: 'lax',
		},
	}),
);

// Metrics middleware — tracks request counts, latency, error rates per endpoint
try {
	const { metricsMiddleware } = require('./lib/metrics-collector');
	app.use(metricsMiddleware);
} catch (err) {
	console.warn('[server] Metrics collector not available:', err.message);
}

// Activity request logger — captures all API calls for the admin activity feed
try {
	const { requestLogger } = require('./lib/activity-logger');
	app.use(requestLogger);
} catch (err) {
	console.warn('[server] Activity logger not available:', err.message);
}

// API Routes - Admin
app.use('/api/admin', adminRoutes);

// API Routes - Candidate side
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/interviews', quickPracticeRoutes); // ISOLATED Quick Practice — must be BEFORE interview routes (#32717)
app.use('/api/interviews', interviewRoutes); // Mock Interview + video analysis (no practice routes)
app.use('/api/omniscore', omniscoreRoutes);
app.use('/api/candidate/omniscore', omniscoreRoutes);
app.use('/api/recruiter/omniscore', omniscoreRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/assessments', assessmentRoutes);

// API Routes - Recruiter/Company side
app.use('/api/company', companyRoutes);
app.use('/api/trustscore', trustscoreRoutes);
app.use('/api/recruiter', recruiterRoutes);

// API Routes - Matching Engine
app.use('/api/matching', matchingRoutes);

// API Routes - Document Verification
app.use('/api/documents', documentRoutes);

// API Routes - Payroll
app.use('/api/payroll', payrollRoutes);

// API Routes - Compliance & GDPR
app.use('/api/compliance', complianceRoutes);

// API Routes - Onboarding & Post-Hire
app.use('/api/onboarding', onboardingRoutes);

// API Routes - Analytics
app.use('/api/analytics', analyticsRoutes);

// API Routes - Country Configuration
app.use('/api/countries', countryRoutes);

// API Routes - AI Memory, Auto-Fill, Question Bank
app.use('/api/memory', memoryRoutes);

// API Routes - AI Communication Hub
app.use('/api/communications', communicationsRoutes);

// API Routes - Email Notifications
app.use('/api/notifications', notificationsRoutes);
app.use('/api/notifications', voiceNotificationsRoutes);

// API Routes - Billing and subscriptions
app.use('/api/billing', billingRoutes);

// API Routes - AI Screening (Recruiter AI Coach)
app.use('/api/screening', screeningRoutes);

// API Routes - Settings (profile, notifications, privacy, avatar)
app.use('/api/settings', settingsRoutes);

const voiceRoutes = require('./routes/voice');
const ttsRoutes = require('./routes/tts');
app.use('/api/voice', voiceRoutes);
app.use('/api/tts', ttsRoutes);

// API Routes - Calendar Integration (Google + Outlook)
const calendarRoutes = require('./routes/calendar');
app.use('/api/calendar', calendarRoutes);

// Comprehensive Monitoring Metrics — protected by admin auth
app.get('/api/admin/metrics', requireAdmin, async (_req, res) => {
	try {
		const { getAllMetrics } = require('./lib/metrics-collector');
		const metrics = await getAllMetrics();
		res.json(metrics);
	} catch (err) {
		res.status(500).json({ error: 'Failed to get metrics', message: err.message });
	}
});

// Activity Feed — protected by admin auth
app.get('/api/admin/activity', requireAdmin, async (req, res) => {
	try {
		const { queryEvents, getRecentEvents } = require('./lib/activity-logger');
		const { category, event_type, user_id, search, start_date, end_date, limit, offset, realtime } =
			req.query;

		// Real-time mode: return from in-memory buffer (fast, no DB)
		if (realtime === 'true') {
			const events = getRecentEvents({
				category,
				eventType: event_type,
				limit: parseInt(limit, 10) || 50,
			});
			return res.json({ events, total: events.length, source: 'memory' });
		}

		// Historical mode: query from database
		const result = await queryEvents({
			category,
			eventType: event_type,
			userId: user_id ? parseInt(user_id, 10) : undefined,
			search,
			startDate: start_date,
			endDate: end_date,
			limit: parseInt(limit, 10) || 50,
			offset: parseInt(offset, 10) || 0,
		});

		res.json({ ...result, source: 'database' });
	} catch (err) {
		res.status(500).json({ error: 'Failed to get activity log', message: err.message });
	}
});

// OpenAI Token Budget — protected by admin auth
app.get('/api/admin/token-usage', requireAdmin, (_req, res) => {
	try {
		const tokenBudget = require('./lib/token-budget');
		res.json(tokenBudget.getStatus());
	} catch (err) {
		res.status(500).json({ error: 'Failed to get token usage', message: err.message });
	}
});

// AI Provider Health — protected by admin auth
app.get('/api/ai-health', requireAdmin, (_req, res) => {
	try {
		const { aiProvider } = require('./lib/polsia-ai');
		res.json(aiProvider.getHealth());
	} catch (err) {
		res.status(500).json({ error: 'Failed to get AI health status', message: err.message });
	}
});

// Reset AI provider circuit breakers — protected by admin auth
app.post('/api/ai-health/reset', requireAdmin, (_req, res) => {
	try {
		const { aiProvider } = require('./lib/polsia-ai');
		aiProvider.resetCircuitBreakers();
		res.json({
			success: true,
			message: 'All circuit breakers reset',
			health: aiProvider.getHealth(),
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to reset circuit breakers', message: err.message });
	}
});

// POST /api/ai-health/verify — run real API calls to verify ALL providers across ALL modalities
app.post('/api/ai-health/verify', requireAdmin, async (_req, res) => {
	try {
		const { aiProvider } = require('./lib/polsia-ai');
		const result = await aiProvider.verifyModels();
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: 'Model verification failed', message: err.message });
	}
});

// GET /api/ai-health/verify-status — get last verification results + auto-verify status
app.get('/api/ai-health/verify-status', requireAdmin, (_req, res) => {
	try {
		const { aiProvider } = require('./lib/polsia-ai');
		const last = aiProvider.getLastVerification();
		if (!last) {
			return res.json({
				verified: false,
				message: 'No verification run yet. Click "Verify Now" to run.',
			});
		}
		// Calculate age in minutes
		const ageMs = Date.now() - new Date(last.timestamp).getTime();
		const ageMinutes = Math.round(ageMs / 60000);
		res.json({
			verified: true,
			ageMinutes,
			stale: ageMinutes > 35, // auto-verify runs every 30min, flag if >35min
			...last,
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to get verify status', message: err.message });
	}
});

// ─── Auto-verify cron: run full verification every 30 minutes ─────────────
// Minimal token cost (~3 tokens per model, ~60 tokens total per cycle)
(function startAutoVerify() {
	const AUTO_VERIFY_INTERVAL = 30 * 60 * 1000; // 30 minutes
	// Run first verification 30s after startup (let all providers initialize)
	setTimeout(async () => {
		try {
			const { aiProvider } = require('./lib/polsia-ai');
			console.log('[auto-verify] Running initial verification...');
			await aiProvider.verifyModels();
			console.log('[auto-verify] Initial verification complete');
		} catch (err) {
			console.error('[auto-verify] Initial verification failed:', err.message);
		}
	}, 30000);

	// Then every 30 minutes
	setInterval(async () => {
		try {
			const { aiProvider } = require('./lib/polsia-ai');
			console.log('[auto-verify] Running scheduled verification...');
			await aiProvider.verifyModels();
			console.log('[auto-verify] Scheduled verification complete');
		} catch (err) {
			console.error('[auto-verify] Scheduled verification failed:', err.message);
		}
	}, AUTO_VERIFY_INTERVAL);
})();

// ─── AI Health Monitoring Endpoints ──────────────────────────────────────────
// Comprehensive AI call logs, model metrics, budget predictions, prompt management

// GET /api/ai-health/usage — usage summary with model + module breakdown
app.get('/api/ai-health/usage', requireAdmin, (_req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		const tokenBudgetSvc = require('./lib/token-budget');
		res.json({
			summary: aiCallLogger.getUsageSummary(),
			models: aiCallLogger.getModelMetrics(),
			modules: aiCallLogger.getModuleBreakdown(),
			hourly: aiCallLogger.getHourlyUsage(),
			budget: tokenBudgetSvc.getStatus(),
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to get usage', message: err.message });
	}
});

// GET /api/ai-health/budget — budget status + predictions
app.get('/api/ai-health/budget', requireAdmin, (_req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		const tokenBudgetSvc = require('./lib/token-budget');
		const status = tokenBudgetSvc.getStatus();
		res.json({
			...status,
			prediction: aiCallLogger.getBudgetPrediction(status),
			moduleBreakdown: aiCallLogger.getModuleBreakdown(),
			throttleStatus: Object.entries(aiCallLogger.MODULE_PRIORITY).map(([mod, priority]) => ({
				module: mod,
				priority,
				throttled: aiCallLogger.shouldThrottle(mod, status),
			})),
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to get budget', message: err.message });
	}
});

// GET /api/ai-health/logs — searchable call logs
app.get('/api/ai-health/logs', requireAdmin, async (req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		const { module, modality, provider, success, start_date, end_date, limit, offset, realtime } =
			req.query;

		if (realtime === 'true') {
			const calls = aiCallLogger.getRecentCalls({
				module,
				modality,
				provider,
				success: success !== undefined ? success === 'true' : undefined,
				limit: parseInt(limit, 10) || 50,
			});
			return res.json({ logs: calls, total: calls.length, source: 'memory' });
		}

		const result = await aiCallLogger.queryCallLogs({
			module,
			modality,
			provider,
			success: success !== undefined ? success === 'true' : undefined,
			startDate: start_date,
			endDate: end_date,
			limit: parseInt(limit, 10) || 50,
			offset: parseInt(offset, 10) || 0,
		});
		res.json({ ...result, source: 'database' });
	} catch (err) {
		res.status(500).json({ error: 'Failed to get logs', message: err.message });
	}
});

// GET /api/ai-health/daily-breakdown — per-module daily token breakdown from DB
app.get('/api/ai-health/daily-breakdown', requireAdmin, async (req, res) => {
	try {
		const pool = require('./lib/db');
		const date = req.query.date || new Date().toISOString().substring(0, 10);
		const result = await pool.query(
			`SELECT module,
              COUNT(*) as call_count,
              COALESCE(SUM(total_tokens), 0) as total_tokens,
              COALESCE(SUM(cost_estimate), 0) as total_cost,
              COUNT(*) FILTER (WHERE success = false) as failures
       FROM ai_call_log
       WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')
       GROUP BY module
       ORDER BY total_tokens DESC`,
			[date],
		);

		// Calculate totals for percentage
		const totalTokens = result.rows.reduce((s, r) => s + parseInt(r.total_tokens, 10), 0);
		const dailyBudget = 100000; // 100K daily budget

		const breakdown = result.rows.map((r) => ({
			module: r.module,
			call_count: parseInt(r.call_count, 10),
			total_tokens: parseInt(r.total_tokens, 10),
			total_cost: Math.round(parseFloat(r.total_cost) * 10000) / 10000,
			failures: parseInt(r.failures, 10),
			pct_of_daily:
				totalTokens > 0 ? Math.round((parseInt(r.total_tokens, 10) / totalTokens) * 1000) / 10 : 0,
			pct_of_budget: Math.round((parseInt(r.total_tokens, 10) / dailyBudget) * 1000) / 10,
		}));

		res.json({
			date,
			total_tokens: totalTokens,
			total_calls: result.rows.reduce((s, r) => s + parseInt(r.call_count, 10), 0),
			daily_budget: dailyBudget,
			budget_used_pct: Math.round((totalTokens / dailyBudget) * 1000) / 10,
			modules: breakdown,
		});
	} catch (err) {
		// Fallback to in-memory if DB table doesn't exist yet
		if (err.message.includes('does not exist')) {
			const aiCallLogger = require('./lib/ai-call-logger');
			const modules = aiCallLogger.getModuleBreakdown();
			const totalTokens = Object.values(modules).reduce((s, m) => s + m.totalTokens, 0);
			res.json({
				date: new Date().toISOString().substring(0, 10),
				total_tokens: totalTokens,
				total_calls: Object.values(modules).reduce((s, m) => s + m.calls, 0),
				daily_budget: 100000,
				budget_used_pct: Math.round((totalTokens / 100000) * 1000) / 10,
				modules: Object.entries(modules).map(([mod, m]) => ({
					module: mod,
					call_count: m.calls,
					total_tokens: m.totalTokens,
					total_cost: m.cost,
					failures: m.failures,
					pct_of_daily: totalTokens > 0 ? Math.round((m.totalTokens / totalTokens) * 1000) / 10 : 0,
					pct_of_budget: Math.round((m.totalTokens / 100000) * 1000) / 10,
				})),
			});
		} else {
			res.status(500).json({ error: 'Failed to get daily breakdown', message: err.message });
		}
	}
});

// GET /api/ai-health/models — per-model performance metrics
app.get('/api/ai-health/models', requireAdmin, (_req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		res.json(aiCallLogger.getModelMetrics());
	} catch (err) {
		res.status(500).json({ error: 'Failed to get model metrics', message: err.message });
	}
});

// GET /api/ai-health/failover-stats — failover analytics
app.get('/api/ai-health/failover-stats', requireAdmin, (_req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		res.json(aiCallLogger.getFailoverStats());
	} catch (err) {
		res.status(500).json({ error: 'Failed to get failover stats', message: err.message });
	}
});

// GET /api/ai-health/predictions — budget predictions + throttle status
app.get('/api/ai-health/predictions', requireAdmin, (_req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		const tokenBudgetSvc = require('./lib/token-budget');
		const status = tokenBudgetSvc.getStatus();
		res.json({
			prediction: aiCallLogger.getBudgetPrediction(status),
			hourlyUsage: aiCallLogger.getHourlyUsage(),
			throttleStatus: Object.entries(aiCallLogger.MODULE_PRIORITY).map(([mod, priority]) => ({
				module: mod,
				priority,
				throttled: aiCallLogger.shouldThrottle(mod, status),
			})),
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to get predictions', message: err.message });
	}
});

// ─── Prompt Management (Pezzo-style) ────────────────────────────────────────

// GET /api/ai-health/prompts — list all prompts with performance data
app.get('/api/ai-health/prompts', requireAdmin, async (_req, res) => {
	try {
		const result = await pool.query('SELECT * FROM ai_prompts ORDER BY module, name');
		res.json({ prompts: result.rows });
	} catch (err) {
		if (err.message.includes('does not exist')) {
			return res.json({ prompts: [], message: 'Migration pending' });
		}
		res.status(500).json({ error: 'Failed to get prompts', message: err.message });
	}
});

// GET /api/ai-health/prompts/:id — get a prompt with all versions
app.get('/api/ai-health/prompts/:id', requireAdmin, async (req, res) => {
	try {
		const [promptResult, versionsResult, testsResult] = await Promise.all([
			pool.query('SELECT * FROM ai_prompts WHERE id = $1', [req.params.id]),
			pool.query('SELECT * FROM ai_prompt_versions WHERE prompt_id = $1 ORDER BY version DESC', [
				req.params.id,
			]),
			pool.query('SELECT * FROM ai_ab_tests WHERE prompt_id = $1 ORDER BY created_at DESC', [
				req.params.id,
			]),
		]);
		if (promptResult.rows.length === 0) return res.status(404).json({ error: 'Prompt not found' });
		res.json({
			prompt: promptResult.rows[0],
			versions: versionsResult.rows,
			abTests: testsResult.rows,
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to get prompt', message: err.message });
	}
});

// POST /api/ai-health/prompts — create or update a prompt
app.post('/api/ai-health/prompts', requireAdmin, async (req, res) => {
	try {
		const {
			slug,
			name,
			module,
			feature,
			description,
			systemPrompt,
			userTemplate,
			temperature,
			maxTokens,
			model,
			changeNote,
		} = req.body;
		if (!slug || !name || !module) {
			return res.status(400).json({ error: 'slug, name, and module are required' });
		}

		// Upsert prompt
		const upsertResult = await pool.query(
			`INSERT INTO ai_prompts (slug, name, module, feature, description, model)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, module = EXCLUDED.module, feature = EXCLUDED.feature,
         description = EXCLUDED.description, model = EXCLUDED.model,
         current_version = ai_prompts.current_version + 1,
         updated_at = NOW()
       RETURNING *`,
			[slug, name, module, feature || null, description || null, model || null],
		);
		const prompt = upsertResult.rows[0];

		// Create version entry
		await pool.query(
			`INSERT INTO ai_prompt_versions (prompt_id, version, system_prompt, user_template, temperature, max_tokens, model, change_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				prompt.id,
				prompt.current_version,
				systemPrompt || null,
				userTemplate || null,
				temperature || 0.7,
				maxTokens || 8192,
				model || null,
				changeNote || 'Initial version',
			],
		);

		res.json({ prompt, message: `Version ${prompt.current_version} created` });
	} catch (err) {
		res.status(500).json({ error: 'Failed to save prompt', message: err.message });
	}
});

// PUT /api/ai-health/prompts/:id — update a prompt (creates new version)
app.put('/api/ai-health/prompts/:id', requireAdmin, async (req, res) => {
	try {
		const { systemPrompt, userTemplate, temperature, maxTokens, model, changeNote } = req.body;
		// Increment version
		const updateResult = await pool.query(
			`UPDATE ai_prompts SET current_version = current_version + 1, updated_at = NOW() WHERE id = $1 RETURNING *`,
			[req.params.id],
		);
		if (updateResult.rows.length === 0) return res.status(404).json({ error: 'Prompt not found' });
		const prompt = updateResult.rows[0];

		// Create new version
		await pool.query(
			`INSERT INTO ai_prompt_versions (prompt_id, version, system_prompt, user_template, temperature, max_tokens, model, change_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				prompt.id,
				prompt.current_version,
				systemPrompt,
				userTemplate,
				temperature || 0.7,
				maxTokens || 8192,
				model || null,
				changeNote || 'Updated',
			],
		);

		res.json({ prompt, message: `Version ${prompt.current_version} created` });
	} catch (err) {
		res.status(500).json({ error: 'Failed to update prompt', message: err.message });
	}
});

// POST /api/ai-health/prompts/:id/rollback — revert to previous version
app.post('/api/ai-health/prompts/:id/rollback', requireAdmin, async (req, res) => {
	try {
		const { targetVersion } = req.body;
		if (!targetVersion) return res.status(400).json({ error: 'targetVersion required' });

		// Get the target version content
		const versionResult = await pool.query(
			'SELECT * FROM ai_prompt_versions WHERE prompt_id = $1 AND version = $2',
			[req.params.id, targetVersion],
		);
		if (versionResult.rows.length === 0)
			return res.status(404).json({ error: 'Version not found' });
		const oldVersion = versionResult.rows[0];

		// Create new version with old content
		const updateResult = await pool.query(
			`UPDATE ai_prompts SET current_version = current_version + 1, updated_at = NOW() WHERE id = $1 RETURNING *`,
			[req.params.id],
		);
		const prompt = updateResult.rows[0];

		await pool.query(
			`INSERT INTO ai_prompt_versions (prompt_id, version, system_prompt, user_template, temperature, max_tokens, model, change_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				prompt.id,
				prompt.current_version,
				oldVersion.system_prompt,
				oldVersion.user_template,
				oldVersion.temperature,
				oldVersion.max_tokens,
				oldVersion.model,
				`Rollback to version ${targetVersion}`,
			],
		);

		res.json({
			prompt,
			message: `Rolled back to version ${targetVersion} (as new version ${prompt.current_version})`,
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to rollback', message: err.message });
	}
});

// POST /api/ai-health/prompts/:id/ab-test — start A/B test between versions
app.post('/api/ai-health/prompts/:id/ab-test', requireAdmin, async (req, res) => {
	try {
		const { name, versionA, versionB, trafficSplit } = req.body;
		if (!versionA || !versionB)
			return res.status(400).json({ error: 'versionA and versionB required' });

		const result = await pool.query(
			`INSERT INTO ai_ab_tests (prompt_id, name, version_a, version_b, traffic_split)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
			[
				req.params.id,
				name || `A/B Test v${versionA} vs v${versionB}`,
				versionA,
				versionB,
				trafficSplit || 0.5,
			],
		);

		res.json({ test: result.rows[0], message: 'A/B test started' });
	} catch (err) {
		res.status(500).json({ error: 'Failed to start A/B test', message: err.message });
	}
});

// PUT /api/ai-health/ab-tests/:id/end — end an A/B test with winner
app.put('/api/ai-health/ab-tests/:id/end', requireAdmin, async (req, res) => {
	try {
		const { winner } = req.body; // 'a' or 'b'
		const result = await pool.query(
			`UPDATE ai_ab_tests SET status = 'completed', winner = $1, ended_at = NOW() WHERE id = $2 RETURNING *`,
			[winner || null, req.params.id],
		);
		if (result.rows.length === 0) return res.status(404).json({ error: 'Test not found' });
		res.json({
			test: result.rows[0],
			message: `A/B test ended${winner ? ` — winner: version ${winner}` : ''}`,
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to end test', message: err.message });
	}
});

// POST /api/ai-health/query — natural language query about AI usage
app.post('/api/ai-health/query', requireAdmin, async (req, res) => {
	try {
		const { question } = req.body;
		if (!question) return res.status(400).json({ error: 'question required' });

		const aiCallLogger = require('./lib/ai-call-logger');
		const tokenBudgetSvc = require('./lib/token-budget');

		// Gather context data
		const summary = aiCallLogger.getUsageSummary();
		const models = aiCallLogger.getModelMetrics();
		const modules = aiCallLogger.getModuleBreakdown();
		const budget = tokenBudgetSvc.getStatus();
		const failoverStats = aiCallLogger.getFailoverStats();

		// Use AI to answer the question based on current metrics
		const { aiProvider } = require('./lib/polsia-ai');
		const context = JSON.stringify({ summary, models, modules, budget, failoverStats }, null, 2);
		const answer = await aiProvider.chatCompletion([{ role: 'user', content: question }], {
			system: `You are an AI analytics assistant for HireLoop. Answer questions about AI usage based on the following real-time metrics data. Be concise and specific with numbers.\n\nMetrics Data:\n${context}`,
			maxTokens: 1024,
			temperature: 0.3,
			module: 'admin',
			feature: 'nl-query',
		});

		res.json({ question, answer, data: { summary, models, modules, budget } });
	} catch (err) {
		res.status(500).json({ error: 'Query failed', message: err.message });
	}
});

// ─── Comprehensive Module Metrics — ALL platform modules ────────────────────
app.get('/api/admin/modules', requireAdmin, async (_req, res) => {
	try {
		const safeQuery = async (sql, fallback = {}) => {
			try {
				const r = await pool.query(sql);
				return r.rows[0] || fallback;
			} catch {
				return fallback;
			}
		};
		const safeQueryRows = async (sql, fallback = []) => {
			try {
				const r = await pool.query(sql);
				return r.rows || fallback;
			} catch {
				return fallback;
			}
		};

		const [
			apps,
			appRecent,
			jobs,
			offers,
			payrollRuns,
			paychecks,
			interviews,
			practiceCount,
			mockCount,
			onboardingDocs,
			onboardingData,
			assessments,
			profiles,
			recruiterCount,
			companies,
			consentRecords,
			dataRequests,
			fairnessAudits,
			auditLogs,
			docVerifications,
			verificationDocs,
			verifiedCreds,
			// ─── NEW: Missing domain groups from architecture docs ───
			usersAuth,
			activeSessions,
			oauthConns,
			omniScores,
			trustScores,
			scoreAppeals,
			communications,
			commTemplates,
			sequenceEnroll,
			matchResults,
			mutualMatches,
			screeningTemplates,
			screeningSessions,
			userMemory,
			ttsCache,
			systemEvents,
			agentData,
		] = await Promise.all([
			// ─── Applications ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'reviewing') as reviewing,
          COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE status = 'withdrawn') as withdrawn,
          COUNT(*) FILTER (WHERE applied_at >= NOW() - INTERVAL '24 hours') as today,
          COUNT(*) FILTER (WHERE applied_at >= NOW() - INTERVAL '7 days') as this_week
        FROM job_applications
      `),
			safeQueryRows(`
        SELECT ja.id, ja.status, ja.applied_at, u.email as candidate_email, j.title as job_title
        FROM job_applications ja
        LEFT JOIN users u ON u.id = ja.candidate_id
        LEFT JOIN jobs j ON j.id = ja.job_id
        ORDER BY ja.applied_at DESC LIMIT 5
      `),

			// ─── Jobs / Recruiter Dashboard ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'active' OR status = 'open') as active,
          COUNT(*) FILTER (WHERE status = 'closed') as closed,
          COUNT(*) FILTER (WHERE status = 'draft') as draft,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as posted_this_week
        FROM jobs
      `),

			// ─── Offers ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'sent' OR status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'accepted') as accepted,
          COUNT(*) FILTER (WHERE status = 'declined' OR status = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE status = 'expired') as expired,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM offers
      `),

			// ─── Payroll ───
			safeQuery(`
        SELECT
          COUNT(*) as total_runs,
          COUNT(*) FILTER (WHERE status = 'processed' OR status = 'completed') as processed,
          COUNT(*) FILTER (WHERE status = 'pending' OR status = 'draft') as pending,
          COUNT(*) FILTER (WHERE status = 'error' OR status = 'failed') as errors,
          COALESCE(SUM(total_gross), 0) as total_gross,
          COALESCE(SUM(total_net), 0) as total_net
        FROM payroll_runs
      `),
			safeQuery(`SELECT COUNT(*) as total FROM paychecks`),

			// ─── Interviews ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status IN ('in-progress', 'pending')) as active,
          COUNT(*) FILTER (WHERE status IN ('abandoned', 'cancelled')) as abandoned,
          COUNT(*) FILTER (WHERE interview_type = 'practice') as practice,
          COUNT(*) FILTER (WHERE interview_type = 'mock') as mock,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as today,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM interviews
      `),
			safeQuery(`SELECT COUNT(*) as total FROM practice_sessions`),
			safeQuery(`SELECT COUNT(*) as total FROM mock_interview_sessions`),

			// ─── Onboarding ───
			safeQuery(`
        SELECT
          COUNT(*) as total_docs,
          COUNT(*) FILTER (WHERE status = 'uploaded' OR status = 'completed' OR status = 'signed') as completed_docs,
          COUNT(*) FILTER (WHERE status = 'pending') as pending_docs,
          COUNT(*) FILTER (WHERE ai_generated_at IS NOT NULL) as ai_generated
        FROM onboarding_documents
      `),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE wizard_status = 'completed') as completed,
          COUNT(*) FILTER (WHERE wizard_status = 'in_progress' OR wizard_status = 'started') as in_progress,
          COUNT(*) FILTER (WHERE wizard_status = 'not_started' OR wizard_status IS NULL) as not_started
        FROM candidate_onboarding_data
      `),

			// ─── Assessments ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'started') as in_progress,
          COUNT(*) FILTER (WHERE status = 'abandoned') as abandoned,
          ROUND(AVG(score) FILTER (WHERE score IS NOT NULL), 1) as avg_score,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM assessment_sessions
      `),

			// ─── Profiles ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE headline IS NOT NULL AND headline != '') as with_headline,
          COUNT(*) FILTER (WHERE resume_url IS NOT NULL AND resume_url != '') as with_resume,
          COUNT(*) FILTER (WHERE linkedin_url IS NOT NULL AND linkedin_url != '') as with_linkedin
        FROM candidate_profiles
      `),
			safeQuery(`SELECT COUNT(*) as total FROM users WHERE role = 'recruiter'`),

			// ─── Companies ───
			safeQuery(`SELECT COUNT(*) as total FROM companies`),

			// ─── Compliance ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE consented = true) as consented,
          COUNT(*) FILTER (WHERE consented = false) as declined
        FROM consent_records
      `),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'processed' OR status = 'completed') as processed
        FROM data_requests
      `),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COALESCE(ROUND(AVG(overall_fairness_score), 1), 0) as avg_score,
          COALESCE(SUM(issues_found), 0) as total_issues
        FROM fairness_audits
      `),
			safeQuery(`SELECT COUNT(*) as total FROM audit_logs`),

			// ─── Document Verification ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COALESCE(ROUND(AVG(authenticity_score), 0), 0) as avg_score,
          COUNT(*) FILTER (WHERE fraud_risk = 'high') as high_risk,
          COUNT(*) FILTER (WHERE fraud_risk = 'low' OR fraud_risk = 'none') as low_risk,
          COUNT(*) FILTER (WHERE is_duplicate = true) as duplicates
        FROM document_verifications
      `),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'verified' OR status = 'processed') as verified,
          COUNT(*) FILTER (WHERE status = 'pending' OR status = 'uploaded') as pending
        FROM verification_documents
      `),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE verification_status = 'verified') as verified,
          COUNT(*) FILTER (WHERE verification_status = 'pending') as pending
        FROM verified_credentials
      `),

			// ─── Users & Auth (architecture domain group 1) ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE role = 'candidate') as candidates,
          COUNT(*) FILTER (WHERE role = 'recruiter') as recruiters,
          COUNT(*) FILTER (WHERE role = 'admin') as admins,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as today,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week,
          COUNT(*) FILTER (WHERE last_login >= NOW() - INTERVAL '24 hours') as active_today
        FROM users
      `),
			safeQuery(`SELECT COUNT(*) as total FROM user_sessions`),
			safeQuery(`SELECT COUNT(*) as total FROM oauth_connections`),

			// ─── Scoring & Trust (architecture domain group 7) ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          ROUND(AVG(overall_score) FILTER (WHERE overall_score IS NOT NULL), 1) as avg_score,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM omni_scores
      `),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          ROUND(AVG(overall_score) FILTER (WHERE overall_score IS NOT NULL), 1) as avg_score,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM trust_scores
      `),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'rejected' OR status = 'denied') as rejected
        FROM score_appeals
      `),

			// ─── Communications (architecture domain group 9) ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'sent' OR status = 'delivered') as sent,
          COUNT(*) FILTER (WHERE status = 'pending' OR status = 'draft') as pending,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM communications
      `),
			safeQuery(`SELECT COUNT(*) as total FROM communication_templates`),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'completed') as completed
        FROM sequence_enrollments
      `),

			// ─── Matching & Recommendations (architecture domain group 14) ───
			safeQuery(`
        SELECT
          COUNT(*) as total,
          ROUND(AVG(match_score) FILTER (WHERE match_score IS NOT NULL), 1) as avg_score,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM match_results
      `),
			safeQuery(`SELECT COUNT(*) as total FROM mutual_matches`),

			// ─── Screening (architecture domain group 6 — separate from assessments) ───
			safeQuery(`SELECT COUNT(*) as total FROM screening_templates`),
			safeQuery(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'pending') as active,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as this_week
        FROM screening_sessions
      `),

			// ─── Memory & System (architecture domain groups 15+16) ───
			safeQuery(`SELECT COUNT(*) as total FROM user_memory`),
			safeQuery(`SELECT COUNT(*) as total FROM tts_cache`),
			safeQuery(`SELECT COUNT(*) as total FROM events`),
			safeQuery(`SELECT COUNT(*) as total FROM agent_data`),
		]);

		res.json({
			timestamp: new Date().toISOString(),
			applications: {
				total: parseInt(apps.total || 0, 10),
				pending: parseInt(apps.pending || 0, 10),
				reviewing: parseInt(apps.reviewing || 0, 10),
				accepted: parseInt(apps.accepted || 0, 10),
				rejected: parseInt(apps.rejected || 0, 10),
				withdrawn: parseInt(apps.withdrawn || 0, 10),
				today: parseInt(apps.today || 0, 10),
				thisWeek: parseInt(apps.this_week || 0, 10),
				recent: appRecent,
			},
			recruiter: {
				activeRecruiters: parseInt(recruiterCount.total || 0, 10),
				totalJobs: parseInt(jobs.total || 0, 10),
				activeJobs: parseInt(jobs.active || 0, 10),
				closedJobs: parseInt(jobs.closed || 0, 10),
				draftJobs: parseInt(jobs.draft || 0, 10),
				jobsPostedThisWeek: parseInt(jobs.posted_this_week || 0, 10),
				totalCompanies: parseInt(companies.total || 0, 10),
			},
			offers: {
				total: parseInt(offers.total || 0, 10),
				pending: parseInt(offers.pending || 0, 10),
				accepted: parseInt(offers.accepted || 0, 10),
				rejected: parseInt(offers.rejected || 0, 10),
				expired: parseInt(offers.expired || 0, 10),
				thisWeek: parseInt(offers.this_week || 0, 10),
			},
			payroll: {
				totalRuns: parseInt(payrollRuns.total_runs || 0, 10),
				processed: parseInt(payrollRuns.processed || 0, 10),
				pending: parseInt(payrollRuns.pending || 0, 10),
				errors: parseInt(payrollRuns.errors || 0, 10),
				totalGross: parseFloat(payrollRuns.total_gross || 0),
				totalNet: parseFloat(payrollRuns.total_net || 0),
				totalPaychecks: parseInt(paychecks.total || 0, 10),
			},
			interviews: {
				total: parseInt(interviews.total || 0, 10),
				completed: parseInt(interviews.completed || 0, 10),
				active: parseInt(interviews.active || 0, 10),
				abandoned: parseInt(interviews.abandoned || 0, 10),
				practice: parseInt(interviews.practice || 0, 10),
				mock: parseInt(interviews.mock || 0, 10),
				today: parseInt(interviews.today || 0, 10),
				thisWeek: parseInt(interviews.this_week || 0, 10),
				practiceSessions: parseInt(practiceCount.total || 0, 10),
				mockSessions: parseInt(mockCount.total || 0, 10),
			},
			onboarding: {
				totalSessions: parseInt(onboardingData.total || 0, 10),
				completed: parseInt(onboardingData.completed || 0, 10),
				inProgress: parseInt(onboardingData.in_progress || 0, 10),
				notStarted: parseInt(onboardingData.not_started || 0, 10),
				totalDocuments: parseInt(onboardingDocs.total_docs || 0, 10),
				completedDocuments: parseInt(onboardingDocs.completed_docs || 0, 10),
				pendingDocuments: parseInt(onboardingDocs.pending_docs || 0, 10),
				aiGenerated: parseInt(onboardingDocs.ai_generated || 0, 10),
			},
			assessments: {
				total: parseInt(assessments.total || 0, 10),
				completed: parseInt(assessments.completed || 0, 10),
				inProgress: parseInt(assessments.in_progress || 0, 10),
				abandoned: parseInt(assessments.abandoned || 0, 10),
				avgScore: assessments.avg_score ? parseFloat(assessments.avg_score) : null,
				thisWeek: parseInt(assessments.this_week || 0, 10),
			},
			profiles: {
				totalCandidateProfiles: parseInt(profiles.total || 0, 10),
				withHeadline: parseInt(profiles.with_headline || 0, 10),
				withResume: parseInt(profiles.with_resume || 0, 10),
				withLinkedIn: parseInt(profiles.with_linkedin || 0, 10),
				completenessRate:
					parseInt(profiles.total || 0, 10) > 0
						? Math.round(
								((parseInt(profiles.with_headline || 0, 10) +
									parseInt(profiles.with_resume || 0, 10)) /
									(parseInt(profiles.total || 0, 10) * 2)) *
									100,
							)
						: 0,
			},
			compliance: {
				totalConsents: parseInt(consentRecords.total || 0, 10),
				consented: parseInt(consentRecords.consented || 0, 10),
				declined: parseInt(consentRecords.declined || 0, 10),
				dataRequests: parseInt(dataRequests.total || 0, 10),
				dataRequestsPending: parseInt(dataRequests.pending || 0, 10),
				dataRequestsProcessed: parseInt(dataRequests.processed || 0, 10),
				fairnessAudits: parseInt(fairnessAudits.total || 0, 10),
				auditsCompleted: parseInt(fairnessAudits.completed || 0, 10),
				fairnessScore: parseFloat(fairnessAudits.avg_score || 0),
				issuesFound: parseInt(fairnessAudits.total_issues || 0, 10),
				auditLogEntries: parseInt(auditLogs.total || 0, 10),
			},
			docVerification: {
				totalVerifications: parseInt(docVerifications.total || 0, 10),
				avgAuthScore: parseInt(docVerifications.avg_score || 0, 10),
				highRisk: parseInt(docVerifications.high_risk || 0, 10),
				lowRisk: parseInt(docVerifications.low_risk || 0, 10),
				duplicates: parseInt(docVerifications.duplicates || 0, 10),
				totalDocuments: parseInt(verificationDocs.total || 0, 10),
				docsVerified: parseInt(verificationDocs.verified || 0, 10),
				docsPending: parseInt(verificationDocs.pending || 0, 10),
				credentials: parseInt(verifiedCreds.total || 0, 10),
				credentialsVerified: parseInt(verifiedCreds.verified || 0, 10),
				credentialsPending: parseInt(verifiedCreds.pending || 0, 10),
			},
			// ─── NEW: Architecture-documented domain groups ───
			usersAuth: {
				totalUsers: parseInt(usersAuth.total || 0, 10),
				candidates: parseInt(usersAuth.candidates || 0, 10),
				recruiters: parseInt(usersAuth.recruiters || 0, 10),
				admins: parseInt(usersAuth.admins || 0, 10),
				registeredToday: parseInt(usersAuth.today || 0, 10),
				registeredThisWeek: parseInt(usersAuth.this_week || 0, 10),
				activeToday: parseInt(usersAuth.active_today || 0, 10),
				activeSessions: parseInt(activeSessions.total || 0, 10),
				oauthConnections: parseInt(oauthConns.total || 0, 10),
			},
			scoring: {
				omniScoreTotal: parseInt(omniScores.total || 0, 10),
				omniScoreAvg: omniScores.avg_score ? parseFloat(omniScores.avg_score) : null,
				omniScoreThisWeek: parseInt(omniScores.this_week || 0, 10),
				trustScoreTotal: parseInt(trustScores.total || 0, 10),
				trustScoreAvg: trustScores.avg_score ? parseFloat(trustScores.avg_score) : null,
				trustScoreThisWeek: parseInt(trustScores.this_week || 0, 10),
				appealsTotal: parseInt(scoreAppeals.total || 0, 10),
				appealsPending: parseInt(scoreAppeals.pending || 0, 10),
				appealsApproved: parseInt(scoreAppeals.approved || 0, 10),
				appealsRejected: parseInt(scoreAppeals.rejected || 0, 10),
			},
			communications: {
				totalMessages: parseInt(communications.total || 0, 10),
				sent: parseInt(communications.sent || 0, 10),
				pending: parseInt(communications.pending || 0, 10),
				thisWeek: parseInt(communications.this_week || 0, 10),
				templates: parseInt(commTemplates.total || 0, 10),
				sequenceEnrollments: parseInt(sequenceEnroll.total || 0, 10),
				activeSequences: parseInt(sequenceEnroll.active || 0, 10),
				completedSequences: parseInt(sequenceEnroll.completed || 0, 10),
			},
			matching: {
				totalMatches: parseInt(matchResults.total || 0, 10),
				avgMatchScore: matchResults.avg_score ? parseFloat(matchResults.avg_score) : null,
				matchesThisWeek: parseInt(matchResults.this_week || 0, 10),
				mutualMatches: parseInt(mutualMatches.total || 0, 10),
			},
			screening: {
				templates: parseInt(screeningTemplates.total || 0, 10),
				totalSessions: parseInt(screeningSessions.total || 0, 10),
				completed: parseInt(screeningSessions.completed || 0, 10),
				active: parseInt(screeningSessions.active || 0, 10),
				thisWeek: parseInt(screeningSessions.this_week || 0, 10),
			},
			system: {
				userMemoryEntries: parseInt(userMemory.total || 0, 10),
				ttsCacheEntries: parseInt(ttsCache.total || 0, 10),
				systemEvents: parseInt(systemEvents.total || 0, 10),
				agentDataEntries: parseInt(agentData.total || 0, 10),
			},
		});
	} catch (err) {
		console.error('[admin/modules] Error:', err.message);
		res.status(500).json({ error: 'Failed to get module metrics', message: err.message });
	}
});

// ─── Route Metrics — Full 351-endpoint monitoring ────────────────────────
app.get('/api/admin/routes', requireAdmin, (_req, res) => {
	try {
		const { getAllMetrics } = require('./lib/metrics-collector');
		const metricsData = getAllMetrics();
		// Return all endpoints from metrics collector with full performance data
		const endpoints = metricsData?.api?.topEndpoints || [];
		// Also build a summary of route files from architecture
		const routeFiles = [
			{ file: 'routes/quick-practice.js', domain: 'Quick Practice', endpoints: 7 },
			{ file: 'routes/interviews.js', domain: 'Mock Interviews', endpoints: 37 },
			{ file: 'routes/onboarding.js', domain: 'Onboarding', endpoints: 43 },
			{ file: 'routes/candidate.js', domain: 'Candidate', endpoints: 46 },
			{ file: 'routes/assessments.js', domain: 'Assessments', endpoints: 22 },
			{ file: 'routes/recruiter.js', domain: 'Recruiter', endpoints: 43 },
			{ file: 'routes/payroll.js', domain: 'Payroll', endpoints: 16 },
			{ file: 'routes/communications.js', domain: 'Communications', endpoints: 13 },
			{ file: 'routes/memory.js', domain: 'Memory', endpoints: 14 },
			{ file: 'routes/omniscore.js', domain: 'OmniScore', endpoints: 13 },
			{ file: 'routes/compliance.js', domain: 'Compliance', endpoints: 16 },
			{ file: 'routes/auth.js', domain: 'Auth', endpoints: 13 },
			{ file: 'routes/documents.js', domain: 'Documents', endpoints: 8 },
			{ file: 'routes/company.js', domain: 'Company', endpoints: 7 },
			{ file: 'routes/jobs.js', domain: 'Jobs', endpoints: 6 },
			{ file: 'routes/matching.js', domain: 'Matching', endpoints: 6 },
			{ file: 'routes/trustscore.js', domain: 'TrustScore', endpoints: 6 },
			{ file: 'routes/admin.js', domain: 'Admin', endpoints: 3 },
			{ file: 'routes/analytics.js', domain: 'Analytics', endpoints: 2 },
			{ file: 'routes/countries.js', domain: 'Countries', endpoints: 4 },
			{ file: 'server.js', domain: 'Server (Health/AI)', endpoints: 26 },
		];
		const totalArchEndpoints = routeFiles.reduce((s, r) => s + r.endpoints, 0);
		res.json({
			summary: {
				totalArchEndpoints,
				totalTrackedEndpoints: endpoints.length,
				routeFiles: routeFiles.length,
				api: metricsData?.api || {},
			},
			routeFiles,
			trackedEndpoints: endpoints,
		});
	} catch (err) {
		res.status(500).json({ error: 'Failed to get route metrics', message: err.message });
	}
});

// Serve React SPA — this is the only frontend
const reactBuildPath = path.join(__dirname, 'client', 'dist');
const publicAssetsPath = path.join(__dirname, 'public');

// Cache the React SPA index.html in memory to avoid filesystem race conditions
const indexPath = path.join(reactBuildPath, 'index.html');
let indexHtml = null;
try {
	if (fs.existsSync(indexPath)) {
		indexHtml = fs.readFileSync(indexPath, 'utf8');
	}
} catch (err) {
	console.error('[server] Error reading React build:', err.message);
}

// Serve static assets from public/ (favicon, robots.txt, etc. — NOT HTML files)
app.use(
	express.static(publicAssetsPath, {
		// Explicitly exclude HTML files from public/
		// All routing goes through React SPA
		index: false,
	}),
);

// Serve React app build
app.use(
	express.static(reactBuildPath, {
		// Don't serve index.html via static — we handle SPA fallback below
		index: false,
	}),
);

// SPA fallback — serve React index.html for all non-API routes that don't match a file
app.get('*', (req, res) => {
	if (!req.path.startsWith('/api/') && req.path !== '/api') {
		// Check if the requested file exists as a static asset
		const assetPath = path.join(reactBuildPath, req.path);
		if (req.path !== '/' && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
			res.sendFile(assetPath);
			return;
		}
		if (indexHtml) {
			res.send(indexHtml);
		} else {
			// Fallback message if React build doesn't exist
			res.status(503).json({
				error: 'Application not ready',
				message: 'React build not found. Run: npm run build',
			});
		}
	} else {
		res.status(404).json({ error: 'API endpoint not found' });
	}
});

// Global error handler — return JSON for API routes, HTML for everything else
app.use((err, _req, res, _next) => {
	console.error('[error]', err.stack || err.message || err);
	if (res.headersSent) return;
	// If the request is for an API endpoint or static asset, return JSON
	if (_req.path.startsWith('/api/') || _req.path.startsWith('/assets/')) {
		return res.status(500).json({ error: 'Internal server error', message: err.message });
	}
	res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Only start the server if not in test mode (prevents port binding during integration tests)
const server = process.env.NODE_ENV !== 'test'
	? app.listen(PORT, () => {
		console.log(`Rekrut AI running on port ${PORT}`);

		// Start distributed rate limiter cleanup
		try {
			const { distributedRateLimiter } = require('./lib/distributed-rate-limiter');
			distributedRateLimiter.startCleanup(5 * 60 * 1000); // Clean every 5 minutes
		} catch (err) {
			console.warn('[server] Could not start rate limiter cleanup:', err.message);
		}
	})
	: null;

// Wire up active HTTP connection tracking for the metrics dashboard
if (server) {
	try {
		const { setHttpServer } = require('./lib/metrics-collector');
		setHttpServer(server);
	} catch (err) {
		console.warn('[server] Could not wire HTTP connection tracking:', err.message);
	}
}

module.exports = app;
// Deploy trigger: 2026-06-12T18:36:42Z
