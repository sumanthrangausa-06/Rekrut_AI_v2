const jwt = require('jsonwebtoken');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'hireloop-jwt-secret-change-in-prod';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.session?.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
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
  verifyToken,
  authMiddleware,
  optionalAuth,
  requireRole,
  JWT_SECRET
};