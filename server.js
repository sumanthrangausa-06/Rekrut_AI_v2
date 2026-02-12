const express = require('express');
const session = require('express-session');
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

app.listen(PORT, () => {
  console.log(`Rekrut AI running on port ${PORT}`);
});
