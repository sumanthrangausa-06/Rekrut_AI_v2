const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const helmet = require('helmet');
const crypto = require('node:crypto');
const { cspMiddleware } = require('./server/middleware/csp');

// Load environment variables from .env file
require('dotenv').config();

// ─── Sentry Error Tracking ───────────────────────────────────────────────
// Initialize BEFORE express app so request handlers are instrumented
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		tracesSampleRate: 1.0,
		profilesSampleRate: 1.0,
		environment: process.env.NODE_ENV || 'development',
	});
	console.log('[sentry] Initialized');
} else {
	console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
}

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
	missingEnv.forEach((env) => {
		console.error(`  - ${env.key}`);
	});
	console.error('[startup] Application will start but may fail on database-dependent endpoints.');
}

// Validate DATABASE_URL is not a placeholder
const dbUrl = process.env.DATABASE_URL || '';
if (
	dbUrl.includes('@host/') ||
	dbUrl.includes('@localhost:5432/db') ||
	dbUrl.includes('user:password@')
) {
	console.error(
		'[startup] CRITICAL: DATABASE_URL appears to be a placeholder. Please update .env with a real database URL.',
	);
	console.error(
		'[startup] Example local PostgreSQL: postgresql://test:test@localhost:5432/rekrutai',
	);
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

// Fatal guard: prevent non-production environments from booting with live Stripe keys
const nodeEnv = process.env.NODE_ENV || 'development';
const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
if (nodeEnv !== 'production' && stripeSecret.startsWith('sk_live_')) {
	console.error('[FATAL] Non-production environment detected with live Stripe key. Refusing to start.');
	console.error(`  NODE_ENV: ${nodeEnv}`);
	console.error(`  STRIPE_SECRET_KEY prefix: sk_live_*`);
	process.exit(1);
}

// Fatal guard: prevent non-production environments from booting against the production
// database. Staging and dev each have their own Neon branch, so a match here is always a
// misconfiguration rather than a deliberate setup. Reuses the dbUrl read above — a second
// `const dbUrl` here is a SyntaxError that takes the whole process down at startup.
const PROD_DB_HOSTNAME = 'ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech';
if (nodeEnv !== 'production' && dbUrl.includes(PROD_DB_HOSTNAME)) {
	console.error('[FATAL] Non-production environment detected with production database endpoint. Refusing to start.');
	console.error(`  NODE_ENV: ${nodeEnv}`);
	console.error(`  DATABASE_URL contains: ${PROD_DB_HOSTNAME}`);
	process.exit(1);
}

const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const interviewRoutes = require('./routes/interviews');
const interviewEventsRoutes = require('./routes/interview-events'); // Issue #127 — Calendar scheduling
const quickPracticeRoutes = require('./routes/quick-practice'); // ISOLATED from Mock Interview (#32717)
const omniscoreRoutes = require('./routes/omniscore');
const companyRoutes = require('./routes/company');
const { router: auditRoutes } = require('./routes/audit');
const trustscoreRoutes = require('./routes/trustscore');
const recruiterRoutes = require('./routes/recruiter');
const recruiterImportRoutes = require('./routes/recruiter-import'); // Issue #141 — Bulk import
const matchingRoutes = require('./routes/matching');
const companyMatchRoutes = require('./routes/candidate-company-matches'); // Issue #27 — Company Matches
const recruiterIntroductionRoutes = require('./routes/recruiter-introductions'); // Issue #38 — Recruiter Introductions
const candidateRoutes = require('./routes/candidate');
const assessmentRoutes = require('./routes/assessments');
const panelRoutes = require('./routes/panels');
const documentRoutes = require('./routes/documents');
const careerCoachRoutes = require('./routes/career-coach'); // Issue #121 — AI Career Coach
const candidateDocumentRoutes = require('./routes/candidate-documents');
const fitScoreRoutes = require('./routes/fitScore'); // Issue #76 — Job Fit Score API
const profileEnhancementRoutes = require('./routes/profile-enhancement'); // Issue #26 — Profile Enhancement Tools
const recruiterDocumentRoutes = require('./routes/recruiter-documents');
const payrollRoutes = require('./routes/payroll');
const complianceRoutes = require('./routes/compliance');
const onboardingRoutes = require('./routes/onboarding');
const analyticsRoutes = require('./routes/analytics');
const { queryProfiler } = require('./lib/query-profiler');
const { analyticsCache } = require('./lib/analytics-cache');
const countryRoutes = require('./routes/countries');
const adminRoutes = require('./routes/admin');
const { requireAdmin } = require('./routes/admin');
const memoryRoutes = require('./routes/memory');
const communicationsRoutes = require('./routes/communications');
const notificationsRoutes = require('./routes/notifications');
const billingRoutes = require('./routes/billing');
const voiceNotificationsRoutes = require('./routes/voice-notifications');
const screeningRoutes = require('./routes/screening');
const proctoringRoutes = require('./routes/proctoring');
const aiScreenerRoutes = require('./routes/ai-screener');
const questionnaireRoutes = require('./routes/questionnaire');
const settingsRoutes = require('./routes/settings');
const signatureRoutes = require('./routes/signature');
const chatRoutes = require('./routes/chat');
const candidateSearchRoutes = require('./routes/candidateSearch'); // Issue #3 — Candidate Search API
const sandboxRoutes = require('./routes/sandbox');
const codingTemplateRoutes = require('./routes/coding-templates');
const codingSubmissionRoutes = require('./routes/coding-submissions');
const livekitRoutes = require('./server/routes/livekit'); // Issue #124 — LiveKit video infrastructure
const backgroundCheckRoutes = require('./routes/background-check'); // Issue #133 — Background check
const recordingRoutes = require('./server/routes/recordings'); // Issue #126 — Interview recording, playback & AI transcript
const collaborationRoutes = require('./routes/collaboration'); // Issue #128 — Real-time collaboration for hiring teams
const apiKeyRoutes = require('./routes/api-keys'); // Issue #140 — Public API key management
const publicApiRoutes = require('./routes/public-api'); // Issue #140 — Public API v1


// ─── Prometheus metrics (Phase 1 observability — Issue #144) ─────────────
const prometheus = require('./server/middleware/prometheus');

const app = express();
const PORT = process.env.PORT || 3000;

// Sentry request handler — must be the first middleware on the app
if (process.env.SENTRY_DSN) {
	app.use(Sentry.Handlers.requestHandler());
	app.use(Sentry.Handlers.tracingHandler());
}

// Disable x-powered-by header
app.disable('x-powered-by');

// Trust proxy (Render runs behind a reverse proxy)
app.set('trust proxy', 1);

// Security headers — MUST be first, before all middleware and routes
app.use(
	helmet({
		contentSecurityPolicy: false, // Handled by dedicated cspMiddleware below
		crossOriginEmbedderPolicy: false, // Allow embedded resources
		hsts: {
			maxAge: 31536000,
			includeSubDomains: true,
			preload: true,
		},
	}),
);
app.use(cspMiddleware);

// Deploy verification endpoint — dynamically reads actual git commit
app.get('/deploy-check', (_req, res) => {
	try {
		const { execSync } = require('node:child_process');
		const commit = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
		const branch = execSync('git branch --show-current', {
			cwd: __dirname,
			encoding: 'utf8',
		}).trim();
		const timestamp = execSync('git log -1 --format=%ci', {
			cwd: __dirname,
			encoding: 'utf8',
		}).trim();
		res.json({
			deployed: true,
			commit,
			branch,
			timestamp: new Date().toISOString(),
			built_at: timestamp,
			env: process.env.NODE_ENV || 'unknown',
		});
	} catch (_err) {
		res.json({
			deployed: true,
			commit: 'unknown',
			timestamp: new Date().toISOString(),
			error: 'Failed to read deployment info',
		});
	}
});

// Version / deployment verification endpoint
app.get('/version', (_req, res) => {
	try {
		const { execSync } = require('node:child_process');
		const commit = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
		const branch = execSync('git branch --show-current', {
			cwd: __dirname,
			encoding: 'utf8',
		}).trim();
		const timestamp = execSync('git log -1 --format=%ci', {
			cwd: __dirname,
			encoding: 'utf8',
		}).trim();
		res.json({ commit, branch, timestamp, env: process.env.NODE_ENV || 'unknown' });
	} catch (_err) {
		res.json({
			commit: 'unknown',
			branch: 'unknown',
			env: process.env.NODE_ENV || 'unknown',
			error: 'Failed to read version info',
		});
	}
});

// Health check — available after helmet so security headers are present
// NOTE: This must return quickly for Render deploy health checks.
// If DB checks hang, we return 200 with degraded status so Render doesn't kill the deploy.
app.get('/health', async (_req, res) => {
	// Set a hard timeout so Render's health check never hangs
	const HEALTH_TIMEOUT_MS = 3000;
	let responded = false;

	const timeout = setTimeout(() => {
		if (!responded) {
			responded = true;
			res.status(200).json({
				status: 'degraded',
				timestamp: new Date().toISOString(),
				version: '2.0.1',
				commit: process.env.RENDER_GIT_COMMIT || 'unknown',
				branch: process.env.RENDER_GIT_BRANCH || 'unknown',
				deployed_at: process.env.RENDER_DEPLOYED_AT || new Date().toISOString(),
				db: { connected: false, error: 'Health check timed out' },
				issues: { healthCheckTimeout: true },
			});
		}
	}, HEALTH_TIMEOUT_MS);

	try {
		const { runHealthCheckFast } = require('./lib/db-health');
		const health = await runHealthCheckFast();
		if (responded) return; // timeout already fired
		clearTimeout(timeout);

		const statusCode = health.healthy ? 200 : 200; // Always 200 for Render, mark degraded in body
		let commit = process.env.RENDER_GIT_COMMIT || 'unknown';
		let branch = process.env.RENDER_GIT_BRANCH || 'unknown';
		if (commit === 'unknown') {
			try {
				const { execSync } = require('node:child_process');
				commit = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
				branch = execSync('git branch --show-current', { cwd: __dirname, encoding: 'utf8' }).trim();
			} catch (_e) {
				/* ignore */
			}
		}
		res.status(statusCode).json({
			status: health.healthy ? 'ok' : 'degraded',
			timestamp: new Date().toISOString(),
			version: '2.0.1',
			commit,
			branch,
			deployed_at: process.env.RENDER_DEPLOYED_AT || new Date().toISOString(),
			db: health.connection,
			tables: health.tables,
			pool: health.pool,
			env: health.env,
			issues: health.issues,
		});
	} catch (_err) {
		if (responded) return;
		clearTimeout(timeout);
		res.status(200).json({
			status: 'degraded',
			timestamp: new Date().toISOString(),
			version: '2.0.1',
			commit: process.env.RENDER_GIT_COMMIT || 'unknown',
			branch: process.env.RENDER_GIT_BRANCH || 'unknown',
			deployed_at: process.env.RENDER_DEPLOYED_AT || new Date().toISOString(),
			db: { connected: false, error: 'Health check failed' },
			issues: { healthCheckError: true },
		});
	}
});

// API health alias for monitoring consistency — delegated to routes/health.js
const healthRoutes = require('./routes/health');
app.use('/api/health', healthRoutes);

// Issue #143: Analytics performance health endpoint
app.get('/health/analytics', (_req, res) => {
	res.json({
		timestamp: new Date().toISOString(),
		cache: analyticsCache.stats(),
		queries: queryProfiler.stats(),
	});
});

// CORS — restricted to known origins only
const ALLOWED_ORIGINS = [
	'https://hireloop-vzvw.polsia.app',
	'https://rekrutai-dev.onrender.com',
	'https://rekrutai-staging.onrender.com',
	// Production's Render URL. Vite tags its bundles crossorigin, so a host that
	// is missing here cannot load its own assets and renders a blank page.
	'https://rekrut-ai.onrender.com',
	'https://rekrutai.co',
	'http://localhost:5173',
	'http://localhost:3000',
	'http://localhost:3001',
];

app.use(
	cors({
		origin: (origin, callback) => {
			// Allow requests with no origin (e.g., mobile apps, curl, server-to-server)
			if (!origin) return callback(null, true);
			if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
			return callback(new Error('Not allowed by CORS'));
		},
		credentials: true,
	}),
);

// Prometheus metrics middleware — measures request duration & counts
// Placed after CORS so timing covers the full request lifecycle.
app.use(prometheus.middleware);

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
	// Exempt analytics events from CSRF — write-only logging with no state-changing
	// side effects; endpoint uses optionalAuth and is designed for anonymous visitors
	if (req.path === '/api/analytics/events') {
		return next();
	}
	// Skip CSRF for API clients using Bearer token authentication
	// (Bearer tokens are not vulnerable to CSRF since they aren't auto-sent by browsers)
	const authHeader = req.headers.authorization || req.headers.Authorization;
	if (authHeader?.startsWith('Bearer ')) {
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

// GET /metrics — Prometheus scrape endpoint (no auth required)
app.get('/metrics', prometheus.metricsHandler);

// Apply CSRF protection to all subsequent state-changing routes
app.use(csrfProtection);

// Validate session secret before configuring session middleware
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
	throw new Error('SESSION_SECRET environment variable is required. Set a strong random string.');
}

app.set('trust proxy', 1);

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
			// Browsers drop a Secure cookie over plain HTTP, so hardcoding this
			// breaks every session outside production — including E2E, which runs
			// against http://localhost. Matches the CSRF cookie above.
			secure: process.env.NODE_ENV === 'production',
			httpOnly: true,
			maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
			sameSite: 'lax', // 'lax' required for OAuth callbacks (Google redirects back cross-site)
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

// API Routes - Email Queue (admin only)
const emailQueue = require('./lib/email-queue');
const { sendTemplatedEmail } = require('./lib/email-service');
const { authMiddleware } = require('./lib/auth');

app.get('/api/admin/email-queue', authMiddleware, async (req, res) => {
	if (req.user.role !== 'admin') {
		return res.status(403).json({ error: 'Admin access required' });
	}
	try {
		const stats = await emailQueue.getStats();
		res.json({ stats });
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get queue stats' });
	}
});

app.post('/api/admin/email-queue/retry', authMiddleware, async (req, res) => {
	if (req.user.role !== 'admin') {
		return res.status(403).json({ error: 'Admin access required' });
	}
	try {
		const retried = await emailQueue.retryFailed();
		res.json({ retried: retried.length });
	} catch (_err) {
		res.status(500).json({ error: 'Failed to retry failed emails' });
	}
});

// Start email queue processor
emailQueue.startProcessor(async (email) => {
	try {
		await sendTemplatedEmail({
			to: email.to,
			template: email.metadata.template || 'custom',
			data: email.metadata,
		});
	} catch (err) {
		console.error('[email-queue-processor] Failed:', err.message);
		throw err;
	}
});

// API Routes - Admin
app.use('/api/admin', adminRoutes);

// API Routes - Email Tracking (must be before auth to allow pixel tracking without auth)
app.use('/api/email', require('./routes/email-tracking'));

// API Routes - Chat (Issue #114 — mounted BEFORE candidate/recruiter to intercept /api/candidate/conversations, /api/recruiter/conversations)
app.use('/api', chatRoutes.router);

// API Routes - Candidate side
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/interviews', interviewEventsRoutes); // Issue #127 — Calendar interview scheduling (mounted BEFORE mock routes)
app.use('/api/interviews', quickPracticeRoutes); // ISOLATED Quick Practice — must be BEFORE interview routes (#32717)
app.use('/api/interviews', interviewRoutes); // Mock Interview + video analysis (no practice routes)

// API Routes - Collaboration (Issue #128)
app.use('/api/collaboration', collaborationRoutes);

// API Routes - LiveKit Video Infrastructure (Issue #124)
app.use('/api/livekit', livekitRoutes);

// API Routes - Interview Recordings (Issue #126)
app.use('/api/interviews/recordings', recordingRoutes);

// API Routes - Interview Panels (Issue #125 — Multi-interviewer panel with scorecards and shared notes)
app.use('/api/panels', panelRoutes);
app.use('/api/omniscore', omniscoreRoutes);
app.use('/api/candidate/omniscore', omniscoreRoutes);
app.use('/api/recruiter/omniscore', omniscoreRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/candidate', fitScoreRoutes); // Issue #76 — Job Fit Score API
app.use('/api', profileEnhancementRoutes); // Issue #26 — Profile Enhancement Tools
app.use('/api/assessments', assessmentRoutes);
app.use('/api/career-coach', careerCoachRoutes); // Issue #121 — AI Career Coach

// API Routes - Recruiter/Company side
app.use('/api/company', auditRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/careers', require('./routes/careers'));
app.use('/api/trustscore', trustscoreRoutes);
app.use('/api/recruiter', recruiterRoutes);
app.use('/api/recruiter', recruiterImportRoutes); // Issue #141 — Bulk import
app.use('/api/recruiter', apiKeyRoutes); // Issue #140 — Public API key management

// API Routes - Public API v1 (Issue #140)
app.use('/api/v1', publicApiRoutes);


// API Routes - Matching Engine
app.use('/api/matching', matchingRoutes);
app.use('/api/candidate/company-matches', companyMatchRoutes); // Issue #27 — Company Matches
app.use('/api/recruiter-intros', recruiterIntroductionRoutes); // Issue #38 — Recruiter Introductions

// Issue #115: Candidate document management — mounted BEFORE /api/documents so /candidate/documents takes priority
app.use('/api/candidate/documents', candidateDocumentRoutes);
app.use('/api/recruiter/candidates', recruiterDocumentRoutes);

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
app.use('/api/proctoring', proctoringRoutes);
app.use('/api/screening', screeningRoutes);

// API Routes - AI Recruiter Screener (Issue #112)
app.use('/api', aiScreenerRoutes);

// API Routes - Aptitude Test Engine (Issue #111)
app.use('/api/aptitude', aptitudeRoutes);

// API Routes - Screening Questionnaire (Issue #110)
app.use('/api/questionnaire', questionnaireRoutes);

// API Routes - Settings (profile, notifications, privacy, avatar)
app.use('/api/settings', settingsRoutes);

// API Routes - E-Signature Engine
app.use('/api/signatures', signatureRoutes);

// Issue #3 — Candidate Search API (mounted BEFORE verification to take priority for /search and /:id/preview)
app.use('/api/candidates', candidateSearchRoutes);

// API Routes - Identity Verification
app.use('/api/candidates', verificationRoutes);

// Issue #133 — Background Check (employment/education verification, discrepancy detection, reference checks)
app.use('/api/candidates', backgroundCheckRoutes.candidateRouter);
app.use('/api', backgroundCheckRoutes.router);

const identityVerificationRoutes = require('./routes/identity-verification'); // Issue #135 — Aadhaar/PAN verification
app.use('/api/identity-verification', identityVerificationRoutes);

const voiceRoutes = require('./routes/voice');
const ttsRoutes = require('./routes/tts');
const aptitudeRoutes = require('./routes/aptitude');
app.use('/api/voice', voiceRoutes);
app.use('/api/tts', ttsRoutes);

// API Routes - Calendar Integration (Google + Outlook)
const calendarRoutes = require('./routes/calendar');
app.use('/api/calendar', calendarRoutes);

// API Routes - Code Sandbox (Issue #117 — self-hosted Judge0 execution engine)
app.use('/api/sandbox', sandboxRoutes);

// API Routes - Coding Templates & Submissions (Issue #119 — technical test templates & auto-grading)
app.use('/api/coding-templates', codingTemplateRoutes);
app.use('/api/coding-submissions', codingSubmissionRoutes);

// Comprehensive Monitoring Metrics — protected by admin auth
app.get('/api/admin/metrics', requireAdmin, async (_req, res) => {
	try {
		const { getAllMetrics } = require('./lib/metrics-collector');
		const metrics = await getAllMetrics();
		res.json(metrics);
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get metrics' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get activity log' });
	}
});

// OpenAI Token Budget — protected by admin auth
app.get('/api/admin/token-usage', requireAdmin, (_req, res) => {
	try {
		const tokenBudget = require('./lib/token-budget');
		res.json(tokenBudget.getStatus());
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get token usage' });
	}
});

// AI Provider Health — protected by admin auth
app.get('/api/ai-health', requireAdmin, (_req, res) => {
	try {
		const { aiProvider } = require('./lib/polsia-ai');
		res.json(aiProvider.getHealth());
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get AI health status' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to reset circuit breakers' });
	}
});

// POST /api/ai-health/verify — run real API calls to verify ALL providers across ALL modalities
app.post('/api/ai-health/verify', requireAdmin, async (_req, res) => {
	try {
		const { aiProvider } = require('./lib/polsia-ai');
		const result = await aiProvider.verifyModels();
		res.json(result);
	} catch (_err) {
		res.status(500).json({ error: 'Model verification failed' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get verify status' });
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

// ─── Interview Reminder Cron: process reminders every 5 minutes ─────────────
(function startReminderProcessor() {
	const REMINDER_INTERVAL = 5 * 60 * 1000; // 5 minutes

	setInterval(async () => {
		try {
			const { processInterviewReminders } = require('./lib/email-service');
			await processInterviewReminders();
		} catch (err) {
			console.error('[reminder-cron] Failed to process reminders:', err.message);
		}
	}, REMINDER_INTERVAL);

	console.log('[reminder-cron] Interview reminder processor started (5min interval)');
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get usage' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get budget' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get logs' });
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
			res.status(500).json({ error: 'Failed to get daily breakdown' });
		}
	}
});

// GET /api/ai-health/models — per-model performance metrics
app.get('/api/ai-health/models', requireAdmin, (_req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		res.json(aiCallLogger.getModelMetrics());
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get model metrics' });
	}
});

// GET /api/ai-health/failover-stats — failover analytics
app.get('/api/ai-health/failover-stats', requireAdmin, (_req, res) => {
	try {
		const aiCallLogger = require('./lib/ai-call-logger');
		res.json(aiCallLogger.getFailoverStats());
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get failover stats' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get predictions' });
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
		res.status(500).json({ error: 'Failed to get prompts' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get prompt' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to save prompt' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to update prompt' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to rollback' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to start A/B test' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to end test' });
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
	} catch (_err) {
		res.status(500).json({ error: 'Query failed' });
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
		res.status(500).json({ error: 'Failed to get module metrics' });
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
			{ file: 'routes/trustscore.js', domain: 'TrustScore', endpoints: 13 },
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
	} catch (_err) {
		res.status(500).json({ error: 'Failed to get route metrics' });
	}
});

// ─── SEO Routes ─────────────────────────────────────────────────────────
app.get('/robots.txt', (_req, res) => {
	res.type('text/plain');
	res.send(
		`User-agent: *\n` +
		`Allow: /\n` +
		`Disallow: /admin\n` +
		`Disallow: /api\n` +
		`Disallow: /debug\n` +
		`Disallow: /settings\n` +
		`Disallow: /recruiter/\n` +
		`Sitemap: https://rekrutai.co/sitemap.xml\n`,
	);
});

app.get('/sitemap.xml', (_req, res) => {
	const today = new Date().toISOString().split('T')[0];
	const urls = [
		{ loc: 'https://rekrutai.co/', lastmod: today, changefreq: 'weekly', priority: '1.0' },
		{ loc: 'https://rekrutai.co/jobs', lastmod: today, changefreq: 'daily', priority: '0.9' },
		{ loc: 'https://rekrutai.co/pricing', lastmod: today, changefreq: 'weekly', priority: '0.8' },
		{ loc: 'https://rekrutai.co/about', lastmod: today, changefreq: 'monthly', priority: '0.7' },
		{ loc: 'https://rekrutai.co/contact', lastmod: today, changefreq: 'monthly', priority: '0.7' },
		{ loc: 'https://rekrutai.co/blog', lastmod: today, changefreq: 'weekly', priority: '0.8' },
		{ loc: 'https://rekrutai.co/privacy', lastmod: today, changefreq: 'yearly', priority: '0.3' },
		{ loc: 'https://rekrutai.co/terms', lastmod: today, changefreq: 'yearly', priority: '0.3' },
	];

	const xml =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		urls
			.map(
				(u) =>
					`  <url>\n` +
					`    <loc>${u.loc}</loc>\n` +
					`    <lastmod>${u.lastmod}</lastmod>\n` +
					`    <changefreq>${u.changefreq}</changefreq>\n` +
					`    <priority>${u.priority}</priority>\n` +
					`  </url>\n`,
			)
			.join('') +
		`</urlset>\n`;

	res.type('application/xml');
	res.send(xml);
});

// Serve React SPA — this is the only frontend
const possibleBuildPaths = [
	path.join(__dirname, 'client', 'dist'),
	path.join(__dirname, 'client', 'build'),
];

function findReactBuildPath() {
	for (const p of possibleBuildPaths) {
		if (fs.existsSync(path.join(p, 'index.html'))) {
			return p;
		}
	}
	return possibleBuildPaths[0]; // default to dist even if not found yet
}

const reactBuildPath = findReactBuildPath();
const publicAssetsPath = path.join(__dirname, 'public');

// Cache the React SPA index.html in memory to avoid filesystem race conditions
let indexHtml = null;
function loadIndexHtml() {
	const indexPath = path.join(reactBuildPath, 'index.html');
	try {
		if (fs.existsSync(indexPath)) {
			indexHtml = fs.readFileSync(indexPath, 'utf8');
			return true;
		}
	} catch (err) {
		console.error('[server] Error reading React build:', err.message);
	}
	return false;
}
loadIndexHtml(); // initial load at startup

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

// ─── Known SPA routes (Issue #106) ─────────────────────────────────────────
// Pre-compiled regex patterns for all valid SPA routes (extracted from client/src/App.tsx)
const KNOWN_ROUTES = [
	// Public routes
	'^/$',
	'^/(login|register|forgot-password|reset-password)$',
	'^/(test-camera|pricing|payment-success)$',
	'^/screening/[^/]+$',
	'^/blog(/[^/]+)?$',
	'^/(about|contact|privacy|terms)$',
	'^/company/[^/]+$',
	'^/careers/[^/]+$',
	'^/(recruiter-register|employee-payroll)$',
	'^/dashboard$',

	// Candidate routes
	'^/candidate$',
	'^/candidate/jobs$',
	'^/candidate/jobs/[^/]+$',
	'^/candidate/(applications|profile)$',
	'^/candidate/assessments$',
	'^/candidate/assessments/[^/]+/take$',
	'^/candidate/assessments/[^/]+/results$',
	'^/candidate/assessment-results$',
	'^/candidate/job-assessment/[^/]+$',
	'^/candidate/(interviews|ai-coaching|career-coach|omniscore)$',
	'^/candidate/(documents|interview-practice)$',
	'^/candidate/(video-interview|interview-analysis|history)$',
	'^/candidate/(feedback|saved-jobs|top-matches)$',
	'^/candidate/(company-matches|ai-search|cv-review)$',
	'^/candidate/(linkedin-optimizer|career-diagnosis)$',
	'^/candidate/offers/manage$',
	'^/candidate/company-profile$',
	'^/candidate/interview$',
	'^/candidate/(chat|offers|onboarding)$',
	'^/candidate/(payroll|settings)$',

	// Recruiter pending approval
	'^/recruiter/pending-approval$',

	'^/candidate/proctoring/[^/]+$',
	'^/candidate/proctoring/[^/]+/consent$',
	// Recruiter routes
	'^/recruiter$',
	'^/recruiter/jobs$',
	'^/recruiter/jobs/new$',
	'^/recruiter/jobs/[^/]+/applicants$',
	'^/recruiter/jobs/[^/]+/edit$',
	'^/recruiter/jobs/[^/]+$',
	'^/recruiter/jobs/[^/]+/assessment$',
	'^/recruiter/(applications|assessments|candidates)$',
	'^/recruiter/(screening|chat|career-page)$',
	'^/recruiter/(interviews|offers|onboarding)$',
	'^/recruiter/(analytics|communications|trustscore)$',
	'^/recruiter/(onboarding-ai|onboarding-docs|company)$',
	'^/recruiter/team$',
	'^/recruiter/team/join-requests$',
	'^/recruiter/profile$',
	'^/recruiter/payroll$',
	'^/recruiter/payroll-dashboard$',
	'^/recruiter/payroll-run/[^/]+$',
	'^/recruiter/job-create$',
	'^/recruiter/omniscore$',
	'^/recruiter/post-hire-feedback$',
	'^/recruiter/compliance$',
	'^/recruiter/proctoring$',
	'^/recruiter/proctoring/[^/]+$',

	// Settings
	'^/settings$',

	// Signature
	'^/signature/[^/]+/[^/]+$',

	// Debug
	'^/debug/mock-interview$',

	// Admin routes
	'^/(admin/login|admin-login)$',
	'^/admin$',
	'^/admin/(dashboard|revenue|ai-health)$',
	'^/admin/(agents|compliance|eu-ai-act)$',
	'^/admin/(agent-dashboard|analytics|email-queue)$',
].map((pattern) => new RegExp(pattern));

function isKnownSpaRoute(routePath) {
	return KNOWN_ROUTES.some((regex) => regex.test(routePath));
}

// SPA fallback — serve React index.html for all non-API routes that don't match a file
app.get('*', (req, res) => {
	if (!req.path.startsWith('/api/') && req.path !== '/api') {
		// Check if the requested file exists as a static asset in the build
		const assetPath = path.join(reactBuildPath, req.path);
		if (req.path !== '/' && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
			res.sendFile(assetPath);
			return;
		}

		// If cached index is missing, try to reload it dynamically
		// (handles case where server started before build completed)
		if (!indexHtml) {
			loadIndexHtml();
		}

		if (indexHtml) {
			const statusCode = isKnownSpaRoute(req.path) ? 200 : 404;
			res.status(statusCode).send(indexHtml);
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

// Sentry error handler — captures exceptions and sends to Sentry
// Must be registered BEFORE the global error handler but AFTER all routes
if (process.env.SENTRY_DSN) {
	app.use(Sentry.Handlers.errorHandler());
}

// Global error handler — return JSON for API routes, HTML for everything else
app.use((err, _req, res, _next) => {
	console.error('[error]', err.stack || err.message || err);
	if (res.headersSent) return;
	// If the request is for an API endpoint or static asset, return JSON
	if (_req.path.startsWith('/api/') || _req.path.startsWith('/assets/')) {
		return res.status(500).json({ error: 'Internal server error' });
	}
	res.status(500).json({ error: 'Internal server error' });
});

// Only start the server if not in test mode (prevents port binding during integration tests)
const server =
	process.env.NODE_ENV !== 'test'
		? app.listen(PORT, () => {
				console.log(`Rekrut AI running on port ${PORT}`);

				// Issue #143: Install query profiler for slow query logging
				queryProfiler.install();
				console.log('[analytics] Query profiler installed (threshold: 2000ms)');

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
// Deploy trigger: 2026-06-12T20:55:29Z
// Deploy test marker: 2026-08-10T01:31:22Z
