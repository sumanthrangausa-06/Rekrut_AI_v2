const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'hireloop-jwt-secret-change-in-prod';
const ACCESS_TOKEN_EXPIRY = '15m';  // Short-lived access token
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

// Generate access token (short-lived)
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

// Generate long-lived token for backwards compatibility
function generateLongToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Verify access token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Generate refresh token
async function generateRefreshToken(userId) {
  const token = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const familyId = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY);

  await pool.query(`
    INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
    VALUES ($1, $2, $3, $4)
  `, [userId, tokenHash, familyId, expiresAt]);

  return { token, familyId };
}

// Validate and rotate refresh token
async function rotateRefreshToken(refreshToken) {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // Find the token
  const result = await pool.query(`
    SELECT rt.*, u.email, u.role, u.name
    FROM refresh_tokens rt
    JOIN users u ON rt.user_id = u.id
    WHERE rt.token_hash = $1
  `, [tokenHash]);

  if (result.rows.length === 0) {
    return { error: 'Invalid refresh token' };
  }

  const storedToken = result.rows[0];

  // Check if revoked
  if (storedToken.is_revoked) {
    // Token reuse detected - revoke entire family
    await pool.query(
      'UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1',
      [storedToken.family_id]
    );
    return { error: 'Token reuse detected - all tokens revoked' };
  }

  // Check expiration
  if (new Date(storedToken.expires_at) < new Date()) {
    return { error: 'Refresh token expired' };
  }

  // Revoke old token
  await pool.query(
    'UPDATE refresh_tokens SET is_revoked = true, last_used_at = NOW() WHERE id = $1',
    [storedToken.id]
  );

  // Generate new tokens in same family
  const newToken = crypto.randomBytes(40).toString('hex');
  const newTokenHash = crypto.createHash('sha256').update(newToken).digest('hex');
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY);

  await pool.query(`
    INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
    VALUES ($1, $2, $3, $4)
  `, [storedToken.user_id, newTokenHash, storedToken.family_id, newExpiresAt]);

  // Generate new access token
  const user = {
    id: storedToken.user_id,
    email: storedToken.email,
    role: storedToken.role,
    name: storedToken.name
  };
  const accessToken = generateToken(user);

  return {
    accessToken,
    refreshToken: newToken,
    user
  };
}

// Revoke all refresh tokens for a user (logout everywhere)
async function revokeAllTokens(userId) {
  await pool.query(
    'UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1',
    [userId]
  );
}

// Auth middleware with refresh token support
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.session?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_EXPIRED' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication error' });
  }
}

async function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.session?.token;

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
        if (result.rows.length > 0) {
          req.user = result.rows[0];
        }
      } catch (err) {
        console.error('Optional auth error:', err);
      }
    }
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = {
  generateToken,
  generateLongToken,
  verifyToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeAllTokens,
  authMiddleware,
  optionalAuth,
  requireRole,
  JWT_SECRET
};
