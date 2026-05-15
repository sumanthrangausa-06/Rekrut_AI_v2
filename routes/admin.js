const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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

// ─── Rate Limiting (in-memory) ──────────────────────────────────────────────
const loginAttempts = new Map(); // ip -> { count, firstAttempt }
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || (now - record.firstAttempt) > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - record.firstAttempt)) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  return { allowed: true, remaining: MAX_ATTEMPTS - record.count };
}

// Clean up old rate limit entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if ((now - record.firstAttempt) > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(ip);
    }
  }
}, 30 * 60 * 1000);

// ─── Admin Credentials ─────────────────────────────────────────────────────
// Uses ADMIN_PASSWORD env var; generates random default if not set
let ADMIN_PASSWORD_HASH = null;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

async function initAdminCredentials() {
  const password = process.env.ADMIN_PASSWORD;

  if (password) {
    ADMIN_PASSWORD_HASH = await bcrypt.hash(password, 12);
    console.log('[admin] Admin credentials loaded from env vars');
  } else {
    // Generate a strong default password
    const defaultPassword = crypto.randomBytes(16).toString('base64url');
    ADMIN_PASSWORD_HASH = await bcrypt.hash(defaultPassword, 12);
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    ADMIN CREDENTIALS                         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Username: ${ADMIN_USERNAME.padEnd(48)}║`);
    console.log(`║  Password: ${defaultPassword.padEnd(48)}║`);
    console.log('║                                                              ║');
    console.log('║  Set ADMIN_PASSWORD env var to use your own password.        ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
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
  const rateCheck = checkRateLimit(ip);

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

  // Reset rate limiter on success
  loginAttempts.delete(ip);

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

module.exports = router;
module.exports.requireAdmin = requireAdmin;
