/**
 * Activity Logger — Centralized event logging for the admin activity feed.
 *
 * Captures ALL platform events: user actions, AI calls, auth events, system events,
 * recruiter actions, interview events, onboarding events.
 *
 * Events are written to the activity_log DB table AND kept in an in-memory buffer
 * for fast real-time streaming to the admin dashboard.
 *
 * Categories: user, ai, auth, system, recruiter, interview, onboarding, error
 */

const pool = require('./db');

// In-memory buffer for real-time feed (last 200 events)
const recentEvents = [];
const MAX_BUFFER = 200;

// Server start time for uptime tracking
const SERVER_START_TIME = Date.now();

/**
 * Log an activity event.
 * @param {Object} event
 * @param {string} event.type - Event type (e.g., 'user_login', 'ai_llm_call', 'interview_started')
 * @param {string} event.category - Category: user, ai, auth, system, recruiter, interview, onboarding, error
 * @param {string} [event.severity] - Severity: info, warning, error (default: info)
 * @param {number} [event.userId] - User ID if applicable
 * @param {string} [event.userEmail] - User email for display
 * @param {Object} [event.details] - Additional event details (JSON)
 * @param {string} [event.ip] - IP address
 */
async function logActivity(event) {
  const entry = {
    id: Date.now(),  // Temporary ID for in-memory buffer
    event_type: event.type,
    category: event.category || 'system',
    severity: event.severity || 'info',
    user_id: event.userId || null,
    user_email: event.userEmail || null,
    details: event.details || {},
    ip_address: event.ip || null,
    created_at: new Date().toISOString(),
  };

  // Add to in-memory buffer (non-blocking for UI)
  recentEvents.push(entry);
  if (recentEvents.length > MAX_BUFFER) {
    recentEvents.shift();
  }

  // Write to DB asynchronously (non-blocking)
  try {
    await pool.query(
      `INSERT INTO activity_log (event_type, category, severity, user_id, user_email, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.event_type,
        entry.category,
        entry.severity,
        entry.user_id,
        entry.user_email,
        JSON.stringify(entry.details),
        entry.ip_address,
      ]
    );
  } catch (err) {
    // Don't crash on logging failures — just warn
    console.warn('[activity-logger] DB write failed:', err.message);
  }
}

/**
 * Get recent events from the in-memory buffer (for real-time feed).
 * @param {Object} [filters]
 * @param {string} [filters.category] - Filter by category
 * @param {string} [filters.eventType] - Filter by event type
 * @param {number} [filters.limit] - Max events to return (default: 50)
 * @returns {Array} Recent events
 */
function getRecentEvents(filters = {}) {
  let events = [...recentEvents];

  if (filters.category) {
    events = events.filter(e => e.category === filters.category);
  }
  if (filters.eventType) {
    events = events.filter(e => e.event_type === filters.eventType);
  }

  const limit = filters.limit || 50;
  return events.slice(-limit).reverse(); // Most recent first
}

/**
 * Query events from the database (for historical queries).
 * @param {Object} filters
 * @param {string} [filters.category]
 * @param {string} [filters.eventType]
 * @param {number} [filters.userId]
 * @param {string} [filters.search]
 * @param {string} [filters.startDate]
 * @param {string} [filters.endDate]
 * @param {number} [filters.limit] - Default 50
 * @param {number} [filters.offset] - Default 0
 * @returns {Promise<{events: Array, total: number}>}
 */
async function queryEvents(filters = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (filters.category) {
    conditions.push(`category = $${paramIdx++}`);
    params.push(filters.category);
  }
  if (filters.eventType) {
    conditions.push(`event_type = $${paramIdx++}`);
    params.push(filters.eventType);
  }
  if (filters.userId) {
    conditions.push(`user_id = $${paramIdx++}`);
    params.push(filters.userId);
  }
  if (filters.search) {
    conditions.push(`(event_type ILIKE $${paramIdx} OR details::text ILIKE $${paramIdx} OR user_email ILIKE $${paramIdx})`);
    params.push(`%${filters.search}%`);
    paramIdx++;
  }
  if (filters.startDate) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(filters.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  try {
    const [eventsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM activity_log ${where}`,
        params
      ),
    ]);

    return {
      events: eventsResult.rows,
      total: parseInt(countResult.rows[0].total, 10),
    };
  } catch (err) {
    console.error('[activity-logger] Query failed:', err.message);
    // Fallback to in-memory buffer
    return {
      events: getRecentEvents(filters),
      total: recentEvents.length,
    };
  }
}

/**
 * Express middleware that logs every API request.
 * Attach after auth middleware so req.user is available.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  // Log on response finish
  res.on('finish', () => {
    // Skip health checks and static files
    if (req.path === '/health' || !req.path.startsWith('/api')) return;

    const duration = Date.now() - start;
    const isError = res.statusCode >= 400;

    logActivity({
      type: isError ? 'api_error' : 'api_request',
      category: isError ? 'error' : 'system',
      severity: res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warning' : 'info'),
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
      },
      ip: req.ip,
    });
  });

  next();
}

/**
 * Log an AI provider call event.
 */
function logAICall(modality, provider, tokens, module, success = true) {
  logActivity({
    type: success ? 'ai_call_success' : 'ai_call_failure',
    category: 'ai',
    severity: success ? 'info' : 'warning',
    details: { modality, provider, tokens, module },
  });
}

/**
 * Log a failover event.
 */
function logFailover(modality, fromProvider, toProvider, error) {
  logActivity({
    type: 'ai_failover',
    category: 'ai',
    severity: 'warning',
    details: { modality, from: fromProvider, to: toProvider, error },
  });
}

/**
 * Log a budget exhaustion event.
 */
function logBudgetExhausted(tokensUsed, budget) {
  logActivity({
    type: 'openai_budget_exhausted',
    category: 'ai',
    severity: 'warning',
    details: { tokensUsed, budget, message: 'All requests now routing to NIM providers' },
  });
}

/**
 * Log an auth event.
 */
function logAuthEvent(type, userId, userEmail, ip, details = {}) {
  logActivity({
    type,
    category: 'auth',
    severity: type.includes('fail') ? 'warning' : 'info',
    userId,
    userEmail,
    ip,
    details,
  });
}

module.exports = {
  logActivity,
  getRecentEvents,
  queryEvents,
  requestLogger,
  logAICall,
  logFailover,
  logBudgetExhausted,
  logAuthEvent,
  SERVER_START_TIME,
};
