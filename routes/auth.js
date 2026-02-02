const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
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

    if (!email || !password) {
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

module.exports = router;
