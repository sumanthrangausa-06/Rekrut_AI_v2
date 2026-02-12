const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();

let logAuthEvent;
try {
  logAuthEvent = require('../lib/activity-logger').logAuthEvent;
} catch (e) {
  logAuthEvent = () => {}; // Fallback no-op
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
// Generate a default password if not set in env
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
  if (req.session && req.session.isAdmin) {
    return next();
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
  if (req.session && req.session.isAdmin) {
    return res.json({
      authenticated: true,
      user: {
        username: ADMIN_USERNAME,
        role: 'admin',
        loginAt: req.session.adminLoginAt,
      },
    });
  }
  return res.status(401).json({ authenticated: false });
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
