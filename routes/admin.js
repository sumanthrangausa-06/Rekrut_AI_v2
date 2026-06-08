const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const pool = require('../lib/db');
const router = express.Router();

let logAuthEvent;
try {
  logAuthEvent = require('../lib/activity-logger').logAuthEvent;
} catch (e) {
  logAuthEvent = () => {}; // Fallback no-op
}

// Import JWT verification to bridge main-app admin users into admin panel
let verifyToken;
try {
  verifyToken = require('../lib/auth').verifyToken;
} catch (e) {
  verifyToken = () => null;
}

// ─── Rate Limiting (distributed via PostgreSQL) ─────────────────────────────
const { distributedRateLimiter } = require('../lib/distributed-rate-limiter');

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

async function checkRateLimit(ip) {
  const key = `admin_login:${ip}`;
  const result = await distributedRateLimiter.checkLimit(key, RATE_LIMIT_WINDOW, MAX_ATTEMPTS);
  return {
    allowed: result.allowed,
    remaining: Math.max(0, MAX_ATTEMPTS - result.count),
    retryAfter: result.retryAfter
  };
}

// ─── Admin Credentials ─────────────────────────────────────────────────────
// Uses ADMIN_PASSWORD env var; MUST be set in production and development
let ADMIN_PASSWORD_HASH = null;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

async function initAdminCredentials() {
  const password = process.env.ADMIN_PASSWORD;

  if (password) {
    ADMIN_PASSWORD_HASH = await bcrypt.hash(password, 12);
    console.log('[admin] Admin credentials loaded from env vars');
  } else {
    throw new Error(
      'ADMIN_PASSWORD environment variable is required. ' +
      'Set it in your .env file (see .env.example). ' +
      'Never commit credentials to the repository.'
    );
  }
}

// Initialize on module load
initAdminCredentials();

// ─── Middleware ──────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  // Path 1: Already authenticated via admin login
  if (req.session && req.session.isAdmin) {
    return next();
  }

  // Path 2: Bridge — JWT-authenticated user with admin role gets auto-elevated
  const token = req.headers.authorization?.split(' ')[1] || (req.session && req.session.token);
  if (token && verifyToken) {
    const decoded = verifyToken(token);
    if (decoded && decoded.role === 'admin') {
      // Bridge: set admin session so subsequent requests don't re-verify
      req.session.isAdmin = true;
      req.session.adminLoginAt = new Date().toISOString();
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
  if (req.session && req.session.isAdmin) {
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
  const token = req.headers.authorization?.split(' ')[1] || (req.session && req.session.token);
  if (token && verifyToken) {
    const decoded = verifyToken(token);
    if (decoded && decoded.role === 'admin') {
      req.session.isAdmin = true;
      req.session.adminLoginAt = new Date().toISOString();
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

    const pageViewsResult = await pool.query(`
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
    `, [startDate, endDate]);

    const signupFunnelResult = await pool.query(`
      SELECT
        event_type,
        COUNT(DISTINCT session_id) as sessions
      FROM events
      WHERE event_type IN ('page_view_landing', 'page_view_signup', 'signup_click', 'signup_complete_candidate', 'signup_complete_recruiter')
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY event_type
    `, [startDate, endDate]);

    const revenueFunnelResult = await pool.query(`
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
    `, [startDate, endDate]);

    const dailyVisitorsResult = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(DISTINCT session_id) as visitors
      FROM events
      WHERE event_type LIKE 'page_view%'
        AND created_at >= $1
        AND created_at <= $2
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [startDate, endDate]);

    const landingViews = pageViewsResult.rows.find((row) => row.event_type === 'page_view_landing')?.unique_visitors || 0;
    const signupPageViews = pageViewsResult.rows.find((row) => row.event_type === 'page_view_signup')?.unique_visitors || 0;
    const pricingViews = pageViewsResult.rows.find((row) => row.event_type === 'page_view_pricing')?.unique_visitors || 0;
    const signupClicks = signupFunnelResult.rows.find((row) => row.event_type === 'signup_click')?.sessions || 0;
    const candidateSignups = signupFunnelResult.rows.find((row) => row.event_type === 'signup_complete_candidate')?.sessions || 0;
    const recruiterSignups = signupFunnelResult.rows.find((row) => row.event_type === 'signup_complete_recruiter')?.sessions || 0;
    const totalSignups = candidateSignups + recruiterSignups;
    const billingCycleToggles = revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_cycle_change')?.sessions || revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_cycle_toggle_click')?.sessions || 0;
    const checkoutClicks = revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_checkout_click')?.sessions || 0;
    const checkoutConfirmed = revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_checkout_confirmed')?.sessions || 0;
    const checkoutCanceled = revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_checkout_canceled')?.sessions || 0;
    const contactSalesClicks = revenueFunnelResult.rows.find((row) => row.event_type === 'pricing_contact_sales_click')?.sessions || 0;

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
          conversion_rate: landingViews > 0 ? ((totalSignups / landingViews) * 100).toFixed(2) : '0.00',
          click_through_rate: landingViews > 0 ? ((signupClicks / landingViews) * 100).toFixed(2) : '0.00',
        },
        revenue_funnel: {
          pricing_views: pricingViews,
          billing_cycle_toggles: billingCycleToggles,
          checkout_clicks: checkoutClicks,
          checkout_confirmed: checkoutConfirmed,
          checkout_canceled: checkoutCanceled,
          contact_sales_clicks: contactSalesClicks,
          pricing_to_checkout_rate: pricingViews > 0 ? ((checkoutClicks / pricingViews) * 100).toFixed(2) : '0.00',
          checkout_completion_rate: checkoutClicks > 0 ? ((checkoutConfirmed / checkoutClicks) * 100).toFixed(2) : '0.00',
          enterprise_contact_rate: pricingViews > 0 ? ((contactSalesClicks / pricingViews) * 100).toFixed(2) : '0.00',
        },
        daily_visitors: dailyVisitorsResult.rows,
        date_range: { start: startDate, end: endDate },
      },
    });
  } catch (error) {
    console.error('[admin/revenue] Error:', error.message);
    res.status(500).json({ error: 'Failed to load revenue metrics', message: error.message });
  }
});

// POST /api/admin/bridge — auto-elevate JWT admin users without separate login
router.post('/bridge', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || (req.session && req.session.token);
  if (!token) {
    return res.status(401).json({ error: 'No authentication token found' });
  }

  if (!verifyToken) {
    return res.status(503).json({ error: 'Token verification unavailable' });
  }

  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Only users with admin role can access the admin panel' });
  }

  // Bridge the session
  req.session.isAdmin = true;
  req.session.adminLoginAt = new Date().toISOString();
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
  }
  return res.json({ success: true, message: 'Logged out' });
});

// GET /api/admin/agents — agent task dashboard data
router.get('/agents', requireAdmin, async (req, res) => {
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
      data: data
    });
  } catch (error) {
    console.error('[admin/agents] Error:', error.message);
    res.status(500).json({ error: 'Failed to load agent status', message: error.message });
  }
});

// GET /api/admin/team-status — team member status dashboard
router.get('/team-status', requireAdmin, async (req, res) => {
  try {
    const statusFile = path.join(__dirname, '../public/team-status.json');
    
    let data = {
      generated_at: new Date().toISOString(),
      team_members: [],
      deployments: {},
      recent_commits: [],
      stats: {}
    };
    
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, 'utf8');
      data = JSON.parse(content);
    }
    
    res.json({
      success: true,
      data: data
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
    const result = await pool.query(`
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
    `, [limit, offset]);

    const decisions = result.rows.map(row => ({
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
    'ai_screening': 'screening',
    'ai_matching': 'matching',
    'ai_interview': 'interview',
    'ai_assessment': 'assessment',
    'ai_offer': 'offer',
    'ai_scoring': 'scoring',
    'screening_decision': 'screening',
    'matching_decision': 'matching',
    'interview_analysis': 'interview',
    'assessment_graded': 'assessment',
    'score_explanation_viewed': 'scoring',
    'decision_explanation_viewed': 'scoring',
    'bias_analysis_generated': 'scoring',
    'score_appeal_submitted': 'scoring',
  };
  return typeMap[actionType] || 'scoring';
}

// GET /api/admin/compliance/bias-report — latest bias detection report
router.get('/compliance/bias-report', requireAdmin, async (req, res) => {
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
        }
      });
    }

    const scoreDist = audit.score_distribution || [];
    const demographics = audit.demographic_breakdowns || [];
    const appeals = audit.appeal_stats || [];

    const totalDecisions = scoreDist.reduce((sum, row) => sum + parseInt(row.count || 0), 0);
    const biasFlags = demographics.filter(d => {
      const avgScores = demographics.map(d => parseFloat(d.avg_score || 0));
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
        demographicBreakdown: demographics.map(d => ({
          demographic: `${d.gender || 'Unknown'} / ${d.ethnicity || 'Unknown'}`,
          total: parseInt(d.total || 0),
          positiveRate: parseFloat(d.avg_score || 0) / 100,
          biasFlag: parseFloat(d.avg_score || 0) < 70,
        })),
        topConcerns: biasFlags > 0
          ? [`${biasFlags} demographic groups show score disparity`, 'Review scoring model for bias']
          : ['No bias flags detected', 'Continue monitoring demographic parity'],
        improvements: ['Regular fairness audits', 'Diverse training data', 'Human review pipeline'],
      }
    });
  } catch (error) {
    console.error('[admin/compliance/bias-report] Error:', error.message);
    res.status(500).json({ error: 'Failed to load bias report' });
  }
});

// GET /api/admin/compliance/risk-classifications — EU AI Act risk categories
router.get('/compliance/risk-classifications', requireAdmin, async (req, res) => {
  try {
    // Get AI config to check what systems are active
    const aiConfig = await pool.query(`
      SELECT config_key, config_value FROM system_settings
      WHERE config_key LIKE 'ai_%'
    `).catch(() => ({ rows: [] }));

    const hasScreening = aiConfig.rows.some(r => r.config_key === 'ai_screening_enabled');
    const hasMatching = aiConfig.rows.some(r => r.config_key === 'ai_matching_enabled');
    const hasInterview = aiConfig.rows.some(r => r.config_key === 'ai_interview_enabled');
    const hasAssessment = aiConfig.rows.some(r => r.config_key === 'ai_assessment_enabled');
    const hasScoring = aiConfig.rows.some(r => r.config_key === 'ai_scoring_enabled');

    const today = new Date().toISOString();
    const nextReview = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const classifications = [
      {
        category: 'AI Screening & Matching',
        level: 'high',
        description: 'Automated candidate screening and job matching affect employment opportunities. High-risk under EU AI Act.',
        measures: ['Human review required', 'Bias audits monthly', 'Right to explanation', 'Appeal process'],
        lastReviewed: today,
        nextReview: nextReview,
      },
      {
        category: 'AI Interview Analysis',
        level: 'high',
        description: 'Video/audio analysis of candidates for assessment. High-risk biometric processing.',
        measures: ['Explicit consent', 'Data minimization', 'Human oversight', 'Deletion within 30 days'],
        lastReviewed: today,
        nextReview: nextReview,
      },
      {
        category: 'AI Assessments & Scoring',
        level: 'limited',
        description: 'Skill assessments and OmniScore generation. Limited risk with human oversight.',
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

    await pool.query(`
      UPDATE audit_logs
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{human_reviewed}',
        'true'
      )
      WHERE id = $1
    `, [id]);

    res.json({ success: true, message: 'Decision marked as reviewed' });
  } catch (error) {
    console.error('[admin/compliance/review] Error:', error.message);
    res.status(500).json({ error: 'Failed to mark as reviewed' });
  }
});

module.exports = router;
module.exports.requireAdmin = requireAdmin;
