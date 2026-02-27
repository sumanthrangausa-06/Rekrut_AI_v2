const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const nodemailer = require('nodemailer');
const pool = require('../lib/db');
const {
  generateToken,
  generateLongToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeAllTokens,
  authMiddleware
} = require('../lib/auth');

const router = express.Router();

function logAuth(message) {
  try {
    // append to a file in project root (no nested directory required)
    fs.appendFileSync('auth.log', message + '\n');
  } catch (e) {
    console.error('Failed to write auth log', e);
  }
}

// Email transporter (SMTP)
let emailTransporter = null;

function initializeEmailTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      emailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        // Gmail/Outlook specific settings
        tls: {
          rejectUnauthorized: false // For development/testing
        }
      });

      console.log('[email] SMTP transporter initialized');
    } catch (err) {
      console.error('[email] Failed to initialize SMTP transporter:', err.message);
      emailTransporter = null;
    }
  } else {
    console.warn('[email] SMTP credentials not configured. Email sending will be disabled.');
  }
}

// Initialize email transporter on module load
initializeEmailTransporter();

async function sendEmail(to, subject, text, html) {
  if (!emailTransporter) {
    throw new Error('Email service not configured. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env');
  }

  const mailOptions = {
    // default sender address should be a no-reply address so personal email isn't exposed
    from: process.env.SMTP_FROM || 'no-reply@rekrutai.co',
    to,
    subject,
    text,
    html
  };

  return await emailTransporter.sendMail(mailOptions);
}

// ============= EMAIL/PASSWORD AUTH =============

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role = 'candidate', company_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, company_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, company_name, created_at`,
      [email, password_hash, name, role, company_name]
    );

    const user = result.rows[0];

    // Auto-create company for recruiter/employer roles
    const recruiterRoles = ['employer', 'recruiter', 'hiring_manager', 'admin'];
    if (recruiterRoles.includes(role) && company_name) {
      try {
        const slug = company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
        const companyResult = await pool.query(
          `INSERT INTO companies (owner_id, name, slug)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [user.id, company_name, slug + '-' + user.id]
        );

        if (companyResult.rows.length > 0) {
          const companyId = companyResult.rows[0].id;
          await pool.query(
            'UPDATE users SET company_id = $1 WHERE id = $2',
            [companyId, user.id]
          );
          user.company_id = companyId;
        }
      } catch (companyErr) {
        console.error('Auto-create company error (non-blocking):', companyErr.message);
      }
    }

    const accessToken = generateToken(user);
    const { token: refreshToken } = await generateRefreshToken(user.id);

    // Track signup completion
    try {
      await pool.query(
        'INSERT INTO events (event_type, user_id, metadata) VALUES ($1, $2, $3)',
        [`signup_complete_${role}`, user.id, JSON.stringify({ email: user.email, role: role })]
      );
    } catch (e) {
      console.error('Failed to log signup event:', e);
    }

    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, company_id: user.company_id },
      token: accessToken,
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Registration error:', err);

    if (err.code === '23505') {
      return res.status(400).json({ error: 'This email is already registered' });
    }
    if (err.code === '42703') {
      return res.status(500).json({ error: 'Database schema error. Please try again in a few minutes.' });
    }

    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const logMsg = `[auth] login attempt email=${email} password=${password}`;
    console.log(logMsg);
    logAuth(logMsg);

    if (!email || !password) {
      const logMsg = '[auth] missing email or password';
      console.log(logMsg);
      logAuth(logMsg);
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check if user has password (might be OAuth-only user)
    if (!user.password_hash) {
      return res.status(401).json({
        error: 'This account uses social login. Please sign in with Google or LinkedIn.',
        oauth_only: true
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      const logMsg = `[auth] password mismatch for ${email}`;
      console.log(logMsg);
      logAuth(logMsg);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateToken(user);
    const { token: refreshToken } = await generateRefreshToken(user.id);
    req.session.token = accessToken;

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_paid: user.is_paid
      },
      token: accessToken,
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const result = await rotateRefreshToken(refreshToken);

    if (result.error) {
      return res.status(401).json({ error: result.error });
    }

    res.json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      company_id: req.user.company_id,
      company_name: req.user.company_name,
      is_paid: req.user.is_paid,
      google_id: req.user.google_id,
      linkedin_id: req.user.linkedin_id,
      created_at: req.user.created_at
    }
  });
});

// Logout (revoke all tokens)
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await revokeAllTokens(req.user.id);
    req.session.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    req.session.destroy();
    res.json({ success: true });
  }
});

// Logout from all devices
router.post('/logout-all', authMiddleware, async (req, res) => {
  try {
    await revokeAllTokens(req.user.id);
    res.json({ success: true, message: 'Logged out from all devices' });
  } catch (err) {
    console.error('Logout all error:', err);
    res.status(500).json({ error: 'Failed to logout from all devices' });
  }
});

// ============= OAUTH: GOOGLE =============

// Get Google OAuth URL
router.get('/google/url', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

  if (!clientId) {
    return res.status(503).json({
      error: 'Google OAuth not configured',
      configured: false
    });
  }

  const scope = encodeURIComponent('openid email profile');
  const state = crypto.randomBytes(16).toString('hex');

  // Store state in session for validation
  req.session.oauth_state = state;

  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&state=${state}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.json({ url, configured: true });
});

// Google OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`/login.html?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return res.redirect('/login.html?error=No authorization code received');
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error('Google token error:', tokens);
      return res.redirect('/login.html?error=Failed to authenticate with Google');
    }

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    const googleUser = await userInfoResponse.json();

    if (!googleUser.email) {
      return res.redirect('/login.html?error=Could not retrieve email from Google');
    }

    // Find or create user
    let user;
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [googleUser.id, googleUser.email]
    );

    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      // Update Google ID if not set
      if (!user.google_id) {
        await pool.query(
          'UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2) WHERE id = $3',
          [googleUser.id, googleUser.picture, user.id]
        );
      }
    } else {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (email, name, google_id, avatar_url, oauth_provider, role)
         VALUES ($1, $2, $3, $4, 'google', 'candidate')
         RETURNING *`,
        [googleUser.email, googleUser.name, googleUser.id, googleUser.picture]
      );
      user = result.rows[0];
    }

    // Store OAuth connection
    await pool.query(`
      INSERT INTO oauth_connections (user_id, provider, provider_user_id, access_token, refresh_token, profile_data)
      VALUES ($1, 'google', $2, $3, $4, $5)
      ON CONFLICT (provider, provider_user_id) DO UPDATE SET
        access_token = $3, refresh_token = $4, profile_data = $5, updated_at = NOW()
    `, [user.id, googleUser.id, tokens.access_token, tokens.refresh_token, JSON.stringify(googleUser)]);

    // Generate tokens
    const accessToken = generateToken(user);
    const { token: refreshToken } = await generateRefreshToken(user.id);

    // Redirect with tokens
    const redirectUrl = user.role === 'recruiter' ? '/recruiter-dashboard.html' : '/candidate-dashboard.html';
    res.redirect(`${redirectUrl}?token=${accessToken}&refresh=${refreshToken}`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect('/login.html?error=Authentication failed');
  }
});

// ============= OAUTH: LINKEDIN =============

// Get LinkedIn OAuth URL
router.get('/linkedin/url', (req, res) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/linkedin/callback`;

  if (!clientId) {
    return res.status(503).json({
      error: 'LinkedIn OAuth not configured',
      configured: false
    });
  }

  const scope = encodeURIComponent('openid profile email');
  const state = crypto.randomBytes(16).toString('hex');

  req.session.oauth_state = state;

  const url = `https://www.linkedin.com/oauth/v2/authorization?` +
    `response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=${scope}`;

  res.json({ url, configured: true });
});

// LinkedIn OAuth callback
router.get('/linkedin/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.redirect(`/login.html?error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code) {
      return res.redirect('/login.html?error=No authorization code received');
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
        redirect_uri: process.env.LINKEDIN_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/linkedin/callback`
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error('LinkedIn token error:', tokens);
      return res.redirect('/login.html?error=Failed to authenticate with LinkedIn');
    }

    // Get user info using OpenID Connect userinfo endpoint
    const userInfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    const linkedinUser = await userInfoResponse.json();

    if (!linkedinUser.email) {
      return res.redirect('/login.html?error=Could not retrieve email from LinkedIn');
    }

    // Find or create user
    let user;
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE linkedin_id = $1 OR email = $2',
      [linkedinUser.sub, linkedinUser.email]
    );

    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      // Update LinkedIn ID if not set
      if (!user.linkedin_id) {
        await pool.query(
          'UPDATE users SET linkedin_id = $1, avatar_url = COALESCE(avatar_url, $2) WHERE id = $3',
          [linkedinUser.sub, linkedinUser.picture, user.id]
        );
      }
    } else {
      // Create new user
      const fullName = linkedinUser.name || `${linkedinUser.given_name || ''} ${linkedinUser.family_name || ''}`.trim();
      const result = await pool.query(
        `INSERT INTO users (email, name, linkedin_id, avatar_url, oauth_provider, role)
         VALUES ($1, $2, $3, $4, 'linkedin', 'candidate')
         RETURNING *`,
        [linkedinUser.email, fullName, linkedinUser.sub, linkedinUser.picture]
      );
      user = result.rows[0];
    }

    // Store OAuth connection
    await pool.query(`
      INSERT INTO oauth_connections (user_id, provider, provider_user_id, access_token, profile_data)
      VALUES ($1, 'linkedin', $2, $3, $4)
      ON CONFLICT (provider, provider_user_id) DO UPDATE SET
        access_token = $3, profile_data = $4, updated_at = NOW()
    `, [user.id, linkedinUser.sub, tokens.access_token, JSON.stringify(linkedinUser)]);

    // Generate tokens
    const accessToken = generateToken(user);
    const { token: refreshToken } = await generateRefreshToken(user.id);

    // Redirect with tokens
    const redirectUrl = user.role === 'recruiter' ? '/recruiter-dashboard.html' : '/candidate-dashboard.html';
    res.redirect(`${redirectUrl}?token=${accessToken}&refresh=${refreshToken}`);
  } catch (err) {
    console.error('LinkedIn OAuth error:', err);
    res.redirect('/login.html?error=Authentication failed');
  }
});

// ============= OAUTH STATUS =============

// Get OAuth configuration status
router.get('/oauth/status', (req, res) => {
  res.json({
    google: {
      configured: !!process.env.GOOGLE_CLIENT_ID,
      name: 'Google'
    },
    linkedin: {
      configured: !!process.env.LINKEDIN_CLIENT_ID,
      name: 'LinkedIn'
    }
  });
});

// Get connected OAuth providers for current user
router.get('/oauth/connections', authMiddleware, async (req, res) => {
  try {
    const connections = await pool.query(
      'SELECT provider, created_at FROM oauth_connections WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      connections: connections.rows,
      has_password: !!req.user.password_hash
    });
  } catch (err) {
    console.error('Get OAuth connections error:', err);
    res.status(500).json({ error: 'Failed to get OAuth connections' });
  }
});

// ============= PAYMENT =============

// Payment verification
router.get('/verify-payment', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    // Verify with Polsia
    const response = await fetch(
      `${process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai'}/api/company-payments/verify?session_id=${sessionId}`,
      { headers: { 'Authorization': `Bearer ${process.env.POLSIA_API_KEY}` } }
    );
    const { verified, payment } = await response.json();

    if (verified) {
      await pool.query(
        'UPDATE users SET is_paid = true, stripe_subscription_id = $1 WHERE id = $2',
        [payment.subscription_id || sessionId, req.user.id]
      );
      res.json({ success: true, verified: true });
    } else {
      res.json({ success: false, verified: false });
    }
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ============= PASSWORD RESET =============

// Forgot password - send reset email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const result = await pool.query('SELECT id, name FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    const user = result.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store token in database
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, expiresAt]
    );

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    const emailSubject = 'Reset your Rekrut.AI password';
    const emailText = `Hi ${user.name},\n\nYou requested a password reset for your Rekrut.AI account.\n\nClick this link to reset your password:\n${resetUrl}\n\nThis link will expire in 15 minutes.\n\nIf you didn't request this reset, please ignore this email.\n\nBest,\nThe Rekrut.AI Team`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Reset your Rekrut.AI password</h2>
        <p>Hi ${user.name},</p>
        <p>You requested a password reset for your Rekrut.AI account.</p>
        <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
        <p>This link will expire in 15 minutes.</p>
        <p>If you didn't request this reset, please ignore this email.</p>
        <p>Best,<br>The Rekrut.AI Team</p>
      </div>
    `;

    try {
      await sendEmail(email, emailSubject, emailText, emailHtml);
      console.log(`[email] Password reset email sent to ${email}`);
    } catch (emailErr) {
      console.error('Failed to send reset email:', emailErr);
      // Don't fail the request, just log the error
    }

    res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Find valid token
    const tokenResult = await pool.query(
      'SELECT user_id FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL',
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const userId = tokenResult.rows[0].user_id;

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user password
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    console.log(`[password-reset] User ID ${userId} password updated successfully`);

    // Mark token as used
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1', [token]);
    console.log(`[password-reset] Token marked as used for user ID ${userId}`);

    // Revoke all existing refresh tokens for security
    await revokeAllTokens(userId);
    console.log(`[password-reset] All refresh tokens revoked for user ID ${userId}`);

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
