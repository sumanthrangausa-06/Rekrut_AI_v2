const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { generateToken, authMiddleware } = require('../lib/auth');

const router = express.Router();

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
    const token = generateToken(user);

    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
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
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    req.session.token = token;

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_paid: user.is_paid
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
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
      company_name: req.user.company_name,
      is_paid: req.user.is_paid,
      created_at: req.user.created_at
    }
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

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