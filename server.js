const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pool = require('./lib/db');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const interviewRoutes = require('./routes/interviews');
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

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Render runs behind a reverse proxy)
app.set('trust proxy', 1);

// Health check — MUST be first, before all middleware
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));

// Explicitly allow camera and microphone access (prevents CDN/proxy stripping)
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true, // Auto-creates table on first run
  }),
  secret: process.env.SESSION_SECRET || 'rekrutai-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Allow cookies over HTTP (Render terminates TLS at proxy)
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
}));

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
app.use('/api/interviews', interviewRoutes);
app.use('/api/omniscore', omniscoreRoutes);
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

// Comprehensive Monitoring Metrics — protected by admin auth
app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
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
    const { category, event_type, user_id, search, start_date, end_date, limit, offset, realtime } = req.query;

    // Real-time mode: return from in-memory buffer (fast, no DB)
    if (realtime === 'true') {
      const events = getRecentEvents({ category, eventType: event_type, limit: parseInt(limit, 10) || 50 });
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
app.get('/api/admin/token-usage', requireAdmin, (req, res) => {
  try {
    const tokenBudget = require('./lib/token-budget');
    res.json(tokenBudget.getStatus());
  } catch (err) {
    res.status(500).json({ error: 'Failed to get token usage', message: err.message });
  }
});

// AI Provider Health — protected by admin auth
app.get('/api/ai-health', requireAdmin, (req, res) => {
  try {
    const { aiProvider } = require('./lib/polsia-ai');
    res.json(aiProvider.getHealth());
  } catch (err) {
    res.status(500).json({ error: 'Failed to get AI health status', message: err.message });
  }
});

// Reset AI provider circuit breakers — protected by admin auth
app.post('/api/ai-health/reset', requireAdmin, (req, res) => {
  try {
    const { aiProvider } = require('./lib/polsia-ai');
    aiProvider.resetCircuitBreakers();
    res.json({ success: true, message: 'All circuit breakers reset', health: aiProvider.getHealth() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset circuit breakers', message: err.message });
  }
});

// ─── Comprehensive Module Metrics — ALL platform modules ────────────────────
app.get('/api/admin/modules', requireAdmin, async (req, res) => {
  try {
    const safeQuery = async (sql, fallback = {}) => {
      try { const r = await pool.query(sql); return r.rows[0] || fallback; }
      catch { return fallback; }
    };
    const safeQueryRows = async (sql, fallback = []) => {
      try { const r = await pool.query(sql); return r.rows || fallback; }
      catch { return fallback; }
    };

    const [
      apps, appRecent,
      jobs,
      offers,
      payrollRuns, paychecks,
      interviews, practiceCount, mockCount,
      onboardingDocs, onboardingData,
      assessments,
      profiles, recruiterCount,
      companies,
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
          COUNT(*) FILTER (WHERE type = 'practice') as practice,
          COUNT(*) FILTER (WHERE type = 'mock') as mock,
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
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      applications: {
        total: parseInt(apps.total || 0),
        pending: parseInt(apps.pending || 0),
        reviewing: parseInt(apps.reviewing || 0),
        accepted: parseInt(apps.accepted || 0),
        rejected: parseInt(apps.rejected || 0),
        withdrawn: parseInt(apps.withdrawn || 0),
        today: parseInt(apps.today || 0),
        thisWeek: parseInt(apps.this_week || 0),
        recent: appRecent,
      },
      recruiter: {
        activeRecruiters: parseInt(recruiterCount.total || 0),
        totalJobs: parseInt(jobs.total || 0),
        activeJobs: parseInt(jobs.active || 0),
        closedJobs: parseInt(jobs.closed || 0),
        draftJobs: parseInt(jobs.draft || 0),
        jobsPostedThisWeek: parseInt(jobs.posted_this_week || 0),
        totalCompanies: parseInt(companies.total || 0),
      },
      offers: {
        total: parseInt(offers.total || 0),
        pending: parseInt(offers.pending || 0),
        accepted: parseInt(offers.accepted || 0),
        rejected: parseInt(offers.rejected || 0),
        expired: parseInt(offers.expired || 0),
        thisWeek: parseInt(offers.this_week || 0),
      },
      payroll: {
        totalRuns: parseInt(payrollRuns.total_runs || 0),
        processed: parseInt(payrollRuns.processed || 0),
        pending: parseInt(payrollRuns.pending || 0),
        errors: parseInt(payrollRuns.errors || 0),
        totalGross: parseFloat(payrollRuns.total_gross || 0),
        totalNet: parseFloat(payrollRuns.total_net || 0),
        totalPaychecks: parseInt(paychecks.total || 0),
      },
      interviews: {
        total: parseInt(interviews.total || 0),
        completed: parseInt(interviews.completed || 0),
        active: parseInt(interviews.active || 0),
        abandoned: parseInt(interviews.abandoned || 0),
        practice: parseInt(interviews.practice || 0),
        mock: parseInt(interviews.mock || 0),
        today: parseInt(interviews.today || 0),
        thisWeek: parseInt(interviews.this_week || 0),
        practiceSessions: parseInt(practiceCount.total || 0),
        mockSessions: parseInt(mockCount.total || 0),
      },
      onboarding: {
        totalSessions: parseInt(onboardingData.total || 0),
        completed: parseInt(onboardingData.completed || 0),
        inProgress: parseInt(onboardingData.in_progress || 0),
        notStarted: parseInt(onboardingData.not_started || 0),
        totalDocuments: parseInt(onboardingDocs.total_docs || 0),
        completedDocuments: parseInt(onboardingDocs.completed_docs || 0),
        pendingDocuments: parseInt(onboardingDocs.pending_docs || 0),
        aiGenerated: parseInt(onboardingDocs.ai_generated || 0),
      },
      assessments: {
        total: parseInt(assessments.total || 0),
        completed: parseInt(assessments.completed || 0),
        inProgress: parseInt(assessments.in_progress || 0),
        abandoned: parseInt(assessments.abandoned || 0),
        avgScore: assessments.avg_score ? parseFloat(assessments.avg_score) : null,
        thisWeek: parseInt(assessments.this_week || 0),
      },
      profiles: {
        totalCandidateProfiles: parseInt(profiles.total || 0),
        withHeadline: parseInt(profiles.with_headline || 0),
        withResume: parseInt(profiles.with_resume || 0),
        withLinkedIn: parseInt(profiles.with_linkedin || 0),
        completenessRate: parseInt(profiles.total || 0) > 0
          ? Math.round(((parseInt(profiles.with_headline || 0) + parseInt(profiles.with_resume || 0)) / (parseInt(profiles.total || 0) * 2)) * 100)
          : 0,
      },
    });
  } catch (err) {
    console.error('[admin/modules] Error:', err.message);
    res.status(500).json({ error: 'Failed to get module metrics', message: err.message });
  }
});

// Determine which frontend to serve
const reactBuildPath = path.join(__dirname, 'client', 'dist');
const legacyPublicPath = path.join(__dirname, 'public');
const useReactApp = fs.existsSync(path.join(reactBuildPath, 'index.html'));

if (useReactApp) {
  console.log('[server] Serving React SPA from client/dist');
  app.use(express.static(reactBuildPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(reactBuildPath, 'index.html'));
    }
  });
} else {
  console.log('[server] React build not found, serving legacy public/');
  app.use(express.static(legacyPublicPath));

  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(legacyPublicPath, 'index.html'));
    }
  });
}

const server = app.listen(PORT, () => {
  console.log(`Rekrut AI running on port ${PORT}`);
});

// Wire up active HTTP connection tracking for the metrics dashboard
try {
  const { setHttpServer } = require('./lib/metrics-collector');
  setHttpServer(server);
} catch (err) {
  console.warn('[server] Could not wire HTTP connection tracking:', err.message);
}
