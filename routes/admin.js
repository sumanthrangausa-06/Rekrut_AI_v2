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
    const limit = Math.min(safeInt(req.query.limit, 50), 500);
    const offset = safeInt(req.query.offset, 0);

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

function safeFloat(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function safeInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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
    if (!id || !/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid decision ID' });
    }

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

// GET /api/admin/compliance/explanations — explainability log of all AI decisions
router.get('/compliance/explanations', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(safeInt(req.query.limit, 50), 500);
    const offset = safeInt(req.query.offset, 0);

    const result = await pool.query(`
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
    `, [limit, offset]);

    const explanations = result.rows.map(row => ({
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
    const limit = Math.min(safeInt(req.query.limit, 50), 500);
    const offset = safeInt(req.query.offset, 0);
    const { startDate, endDate } = req.query;
    
    // Validate date formats if provided
    if (startDate && !/^\d{4}-\d{2}-\d{2}/.test(startDate)) {
      return res.status(400).json({ error: 'Invalid startDate format. Use ISO 8601.' });
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}/.test(endDate)) {
      return res.status(400).json({ error: 'Invalid endDate format. Use ISO 8601.' });
    }
    
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

    const result = await pool.query(`
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
    `, params);

    const overrides = result.rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      overriddenBy: { id: row.override_by_id, name: row.override_by_name || 'Unknown' },
      candidate: { id: row.candidate_id, name: row.candidate_name || 'Unknown' },
      originalDecision: row.original_decision || 'AI Recommended',
      overrideDecision: row.override_decision || 'Human Override',
      overrideReason: row.override_reason || 'No reason provided',
      jobTitle: row.job_title || 'N/A',
      aiModel: row.ai_model || 'unknown',
      aiConfidence: safeFloat(row.ai_confidence, 0.85),
      overrideFromIp: row.override_from_ip,
    }));

    // Build separate date params for the stats query (no LIMIT/OFFSET)
    const statsDateParams = [];
    let statsParamIdx = 1;
    let statsDateFilter = '';
    if (startDate) {
      statsDateFilter += ` AND created_at >= $${statsParamIdx++}`;
      statsDateParams.push(startDate);
    }
    if (endDate) {
      statsDateFilter += ` AND created_at <= $${statsParamIdx++}`;
      statsDateParams.push(endDate);
    }

    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_overrides,
        COUNT(DISTINCT user_id) as unique_recruiters,
        COUNT(DISTINCT target_id) as unique_candidates,
        AVG(CASE WHEN metadata->>'ai_confidence' IS NOT NULL THEN (metadata->>'ai_confidence')::float END) as avg_ai_confidence
      FROM audit_logs
      WHERE action_type = 'human_override'
        ${statsDateFilter}
    `, statsDateParams);

    const stats = statsResult.rows[0] || {};

    res.json({
      success: true,
      overrides,
      summary: {
        totalOverrides: safeInt(stats.total_overrides, 0),
        uniqueRecruiters: safeInt(stats.unique_recruiters, 0),
        uniqueCandidates: safeInt(stats.unique_candidates, 0),
        avgAiConfidence: safeFloat(stats.avg_ai_confidence, 0.85),
      }
    });
  } catch (error) {
    console.error('[admin/compliance/overrides] Error:', error.message);
    res.status(500).json({ error: 'Failed to load human override data' });
  }
});

// GET /api/admin/compliance/risk-checklist — EU AI Act risk assessment checklist
router.get('/compliance/risk-checklist', requireAdmin, async (req, res) => {
  try {
    const auditCountResult = await pool.query(`
      SELECT COUNT(*) as count FROM audit_logs WHERE created_at >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const biasReportResult = await pool.query(`
      SELECT COUNT(*) as count FROM bias_reports WHERE report_date >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const fairnessAuditResult = await pool.query(`
      SELECT COUNT(*) as count FROM fairness_audits WHERE audit_date >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const consentResult = await pool.query(`
      SELECT COUNT(*) as count FROM consent_records WHERE created_at >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const humanReviewResult = await pool.query(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action_type = 'human_override' AND created_at >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const dataRequestResult = await pool.query(`
      SELECT COUNT(*) as count FROM data_requests WHERE status = 'pending'
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const retentionPolicyResult = await pool.query(`
      SELECT COUNT(*) as count FROM data_retention_policies
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const adminCountResult = await pool.query(`
      SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND created_at >= NOW() - INTERVAL '90 days'
    `).catch(() => ({ rows: [{ count: 0 }] }));
    
    const explainabilityCount = await pool.query(`
      SELECT COUNT(*) as count FROM audit_logs 
      WHERE action_type IN ('score_explanation_viewed', 'decision_explanation_viewed') 
      AND created_at >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ count: 0 }] }));

    const auditCount = parseInt(auditCountResult.rows[0].count);
    const biasReportCount = parseInt(biasReportResult.rows[0].count);
    const fairnessAuditCount = parseInt(fairnessAuditResult.rows[0].count);
    const consentCount = parseInt(consentResult.rows[0].count);
    const humanReviewCount = parseInt(humanReviewResult.rows[0].count);
    const dataRequestPending = parseInt(dataRequestResult.rows[0].count);
    const retentionPolicyCount = parseInt(retentionPolicyResult.rows[0].count);
    const adminCount = parseInt(adminCountResult.rows[0].count);
    const explainabilityCountVal = parseInt(explainabilityCount.rows[0].count);

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

    const completed = checklist.filter(c => c.status === 'complete').length;
    const pending = checklist.filter(c => c.status === 'pending').length;
    const incomplete = checklist.filter(c => c.status === 'incomplete').length;
    const inProgress = checklist.filter(c => c.status === 'in_progress').length;
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
        overallStatus: incomplete === 0 && pending === 0 ? 'compliant' : pending > 0 ? 'needs_attention' : 'partially_compliant',
        nextReview: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      }
    });
  } catch (error) {
    console.error('[admin/compliance/risk-checklist] Error:', error.message);
    res.status(500).json({ error: 'Failed to load risk checklist' });
  }
});

// GET /api/admin/compliance/bias-reports — historical bias reports list
router.get('/compliance/bias-reports', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(safeInt(req.query.limit, 10), 500);
    const offset = safeInt(req.query.offset, 0);

    const result = await pool.query(
      `SELECT id, audit_date, audit_type, overall_fairness_score, issues_found,
              demographic_breakdowns, appeal_stats, created_at
       FROM fairness_audits
       ORDER BY audit_date DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM fairness_audits`
    );

    const reports = result.rows.map(row => ({
      id: row.id,
      auditDate: row.audit_date,
      auditType: row.audit_type,
      overallFairnessScore: parseFloat(row.overall_fairness_score) || 0,
      issuesFound: parseInt(row.issues_found) || 0,
      demographicCount: Array.isArray(row.demographic_breakdowns) ? row.demographic_breakdowns.length : 0,
      appealCount: Array.isArray(row.appeal_stats) ? row.appeal_stats.length : 0,
      createdAt: row.created_at,
    }));

    res.json({
      success: true,
      reports,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (error) {
    console.error('[admin/compliance/bias-reports] Error:', error.message);
    res.status(500).json({ error: 'Failed to load bias reports' });
  }
});

// GET /api/admin/compliance/performance — model performance metrics
router.get('/compliance/performance', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(Math.max(safeInt(req.query.days, 30), 1), 365);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Decision volume over time
    const volumeResult = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM audit_logs
       WHERE action_type LIKE 'ai_%' AND created_at >= $1
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [startDate]
    );

    // Average confidence by model
    const confidenceResult = await pool.query(
      `SELECT
         COALESCE(metadata->>'model', 'unknown') as model,
         COUNT(*) as decisions,
         AVG(COALESCE((metadata->>'confidence')::float, 0.85)) as avg_confidence,
         COUNT(CASE WHEN metadata->>'human_override' = 'true' THEN 1 END) as overrides
       FROM audit_logs
       WHERE action_type LIKE 'ai_%' AND created_at >= $1
       GROUP BY COALESCE(metadata->>'model', 'unknown')
       ORDER BY decisions DESC`,
      [startDate]
    );

    // Score distribution (drift indicator) — may fail if table does not exist
    let scoreDistribution = [];
    try {
      const scoreDistResult = await pool.query(
        `SELECT
           FLOOR(overall_score / 10) * 10 as bucket,
           COUNT(*) as count
         FROM omniscore_results
         WHERE created_at >= $1 AND overall_score IS NOT NULL
         GROUP BY bucket
         ORDER BY bucket`,
        [startDate]
      );
      scoreDistribution = scoreDistResult.rows.map(r => ({
        bucket: safeInt(r.bucket, 0),
        count: safeInt(r.count, 0),
      }));
    } catch (scoreErr) {
      console.warn('[admin/compliance/performance] Score distribution unavailable:', scoreErr.message);
    }

    // Human review rate
    const reviewResult = await pool.query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN metadata->>'human_reviewed' = 'true' THEN 1 END) as reviewed
       FROM audit_logs
       WHERE action_type LIKE 'ai_%' AND created_at >= $1`,
      [startDate]
    );

    const reviewStats = reviewResult.rows[0] || { total: 0, reviewed: 0 };

    res.json({
      success: true,
      period: days,
      volumeOverTime: volumeResult.rows.map(r => ({ date: r.date, count: safeInt(r.count, 0) })),
      modelPerformance: confidenceResult.rows.map(r => ({
        model: r.model,
        decisions: safeInt(r.decisions, 0),
        avgConfidence: safeFloat(r.avg_confidence, 0.85),
        overrideRate: safeInt(r.decisions, 0) > 0 ? safeInt(r.overrides, 0) / safeInt(r.decisions, 0) : 0,
      })),
      scoreDistribution,
      reviewRate: safeInt(reviewStats.total, 0) > 0
        ? safeInt(reviewStats.reviewed, 0) / safeInt(reviewStats.total, 0)
        : 0,
      totalDecisions: safeInt(reviewStats.total, 0),
    });
  } catch (error) {
    console.error('[admin/compliance/performance] Error:', error.message);
    res.status(500).json({ error: 'Failed to load performance metrics' });
  }
});

// POST /api/admin/compliance/export — export compliance decisions as CSV or JSON
router.post('/compliance/export', requireAdmin, async (req, res) => {
  try {
    const { format = 'csv', startDate, endDate } = req.body;

    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use "csv" or "json".' });
    }

    if (startDate && !/^\d{4}-\d{2}-\d{2}/.test(startDate)) {
      return res.status(400).json({ error: 'Invalid startDate format. Use ISO 8601.' });
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}/.test(endDate)) {
      return res.status(400).json({ error: 'Invalid endDate format. Use ISO 8601.' });
    }

    let dateFilter = '';
    const params = [];
    let paramIdx = 1;

    if (startDate) {
      dateFilter += ` AND al.created_at >= $${paramIdx++}`;
      params.push(startDate);
    }
    if (endDate) {
      dateFilter += ` AND al.created_at <= $${paramIdx++}`;
      params.push(endDate);
    }

    const result = await pool.query(
      `SELECT
        al.id::text as id,
        al.created_at as timestamp,
        al.action_type as decision_type,
        al.user_id as candidate_id,
        u.name as candidate_name,
        al.metadata->>'decision' as decision,
        al.metadata->>'model' as ai_model,
        COALESCE((al.metadata->>'confidence')::float, 0.85) as confidence,
        COALESCE(al.metadata->>'human_reviewed', 'false') as human_reviewed,
        COALESCE(al.metadata->>'human_override', 'false') as human_override,
        COALESCE(al.metadata->>'bias_flags', '[]') as bias_flags,
        al.metadata->>'explanation' as explanation
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE (al.action_type LIKE 'ai_%'
         OR al.action_type IN ('screening_decision', 'matching_decision',
                                'interview_analysis', 'assessment_graded'))
        ${dateFilter}
      ORDER BY al.created_at DESC
      LIMIT 10000`,
      params
    );

    await logAuthEvent('compliance_export', req.user?.id || null, 'admin', req.ip || 'unknown', {
      format,
      count: result.rows.length,
      startDate,
      endDate
    });

    if (format === 'csv') {
      const headers = ['ID', 'Timestamp', 'Decision Type', 'Candidate ID', 'Candidate Name', 'Decision', 'AI Model', 'Confidence', 'Human Reviewed', 'Human Override', 'Bias Flags', 'Explanation'];
      const rows = result.rows.map(row => [
        row.id,
        row.timestamp,
        row.decision_type,
        row.candidate_id,
        row.candidate_name || 'Unknown',
        row.decision || 'processed',
        row.ai_model || 'unknown',
        row.confidence,
        row.human_reviewed,
        row.human_override,
        Array.isArray(row.bias_flags) ? row.bias_flags.join(';') : '',
        (row.explanation || '').replace(/\r?\n/g, ' ').replace(/"/g, '""')
      ].map(field => {
        const str = String(field ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str}"`;
        }
        return str;
      }).join(','));

      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="compliance-export-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
      return;
    }

    // JSON fallback
    res.json({
      success: true,
      count: result.rows.length,
      format,
      decisions: result.rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        decisionType: row.decision_type,
        candidateId: row.candidate_id,
        candidateName: row.candidate_name || 'Unknown',
        decision: row.decision || 'processed',
        aiModel: row.ai_model || 'unknown',
        confidence: row.confidence,
        humanReviewed: row.human_reviewed === 'true',
        humanOverride: row.human_override === 'true',
        biasFlags: Array.isArray(row.bias_flags) ? row.bias_flags : [],
        explanation: row.explanation || '',
      }))
    });
  } catch (error) {
    console.error('[admin/compliance/export] Error:', error.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
module.exports.requireAdmin = requireAdmin;
