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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

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
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
  console.log(`HireLoop running on port ${PORT}`);
});
