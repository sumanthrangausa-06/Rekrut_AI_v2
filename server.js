const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'rekrutai-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback for client-side routing
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Rekrut AI running on port ${PORT}`);
});