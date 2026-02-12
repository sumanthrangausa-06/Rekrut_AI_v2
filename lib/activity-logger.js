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
 * Route-to-event mapping: translates API routes into meaningful business events.
 * Format: { pattern: RegExp, method: string, eventType: string, category: string }
 */
const ROUTE_EVENT_MAP = [
  // ─── Auth Events ───
  { pattern: /^\/api\/auth\/login$/, method: 'POST', type: 'user_login', category: 'auth' },
  { pattern: /^\/api\/auth\/register$/, method: 'POST', type: 'user_registered', category: 'auth' },
  { pattern: /^\/api\/auth\/logout/, method: 'POST', type: 'user_logout', category: 'auth' },
  { pattern: /^\/api\/auth\/google\/callback/, method: 'GET', type: 'oauth_google_login', category: 'auth' },
  { pattern: /^\/api\/auth\/linkedin\/callback/, method: 'GET', type: 'oauth_linkedin_login', category: 'auth' },

  // ─── Candidate / Application Events ───
  { pattern: /^\/api\/candidate\/jobs\/\d+\/apply$/, method: 'POST', type: 'application_submitted', category: 'user' },
  { pattern: /^\/api\/candidate\/applications\/\d+\/withdraw$/, method: 'PUT', type: 'application_withdrawn', category: 'user' },
  { pattern: /^\/api\/candidate\/profile$/, method: 'PUT', type: 'profile_updated', category: 'user' },
  { pattern: /^\/api\/candidate\/resume/, method: 'POST', type: 'resume_uploaded', category: 'user' },
  { pattern: /^\/api\/candidate\/coaching$/, method: 'POST', type: 'coaching_session', category: 'user' },
  { pattern: /^\/api\/candidate\/jobs\/\d+\/save$/, method: 'POST', type: 'job_saved', category: 'user' },

  // ─── Interview Events ───
  { pattern: /^\/api\/interviews\/start$/, method: 'POST', type: 'interview_started', category: 'interview' },
  { pattern: /^\/api\/interviews\/\d+\/complete$/, method: 'POST', type: 'interview_completed', category: 'interview' },
  { pattern: /^\/api\/interviews\/\d+\/respond$/, method: 'POST', type: 'interview_response', category: 'interview' },
  { pattern: /^\/api\/interviews\/practice\/submit/, method: 'POST', type: 'practice_submitted', category: 'interview' },
  { pattern: /^\/api\/interviews\/mock\/start$/, method: 'POST', type: 'mock_interview_started', category: 'interview' },
  { pattern: /^\/api\/interviews\/mock\/[^/]+\/end$/, method: 'POST', type: 'mock_interview_ended', category: 'interview' },
  { pattern: /^\/api\/interviews\/mock\/[^/]+\/respond$/, method: 'POST', type: 'mock_interview_response', category: 'interview' },
  { pattern: /^\/api\/interviews\/mock\/[^/]+\/voice-respond$/, method: 'POST', type: 'mock_voice_response', category: 'interview' },
  { pattern: /^\/api\/interviews\/save-analysis$/, method: 'POST', type: 'interview_analysis_saved', category: 'interview' },

  // ─── Recruiter Events ───
  { pattern: /^\/api\/recruiter\/jobs$/, method: 'POST', type: 'job_posted', category: 'recruiter' },
  { pattern: /^\/api\/recruiter\/applications\/\d+\/status$/, method: 'PUT', type: 'application_status_changed', category: 'recruiter' },
  { pattern: /^\/api\/recruiter\/applications\/\d+$/, method: 'PUT', type: 'application_reviewed', category: 'recruiter' },
  { pattern: /^\/api\/recruiter\/interviews\/schedule$/, method: 'POST', type: 'interview_scheduled', category: 'recruiter' },
  { pattern: /^\/api\/recruiter\/interviews$/, method: 'POST', type: 'interview_created', category: 'recruiter' },
  { pattern: /^\/api\/recruiter\/jobs\/\d+\/analyze-candidate$/, method: 'POST', type: 'candidate_analyzed', category: 'recruiter' },

  // ─── Offer Events ───
  { pattern: /^\/api\/onboarding\/offers$/, method: 'POST', type: 'offer_created', category: 'recruiter' },
  { pattern: /^\/api\/onboarding\/offers\/\d+\/send$/, method: 'POST', type: 'offer_sent', category: 'recruiter' },
  { pattern: /^\/api\/onboarding\/offers\/\d+\/accept$/, method: 'POST', type: 'offer_accepted', category: 'user' },
  { pattern: /^\/api\/onboarding\/offers\/\d+\/decline$/, method: 'POST', type: 'offer_declined', category: 'user' },
  { pattern: /^\/api\/onboarding\/offers\/\d+\/withdraw$/, method: 'POST', type: 'offer_withdrawn', category: 'recruiter' },
  { pattern: /^\/api\/onboarding\/offers\/\d+\/generate-letter$/, method: 'POST', type: 'offer_letter_generated', category: 'recruiter' },

  // ─── Onboarding Events ───
  { pattern: /^\/api\/onboarding\/wizard\/save-step$/, method: 'POST', type: 'onboarding_step_completed', category: 'onboarding' },
  { pattern: /^\/api\/onboarding\/wizard\/generate-documents$/, method: 'POST', type: 'onboarding_docs_generated', category: 'onboarding' },
  { pattern: /^\/api\/onboarding\/wizard\/sign-document$/, method: 'POST', type: 'document_signed', category: 'onboarding' },
  { pattern: /^\/api\/onboarding\/wizard\/sign-all$/, method: 'POST', type: 'all_documents_signed', category: 'onboarding' },
  { pattern: /^\/api\/onboarding\/checklists\/\d+\/complete$/, method: 'POST', type: 'checklist_completed', category: 'onboarding' },
  { pattern: /^\/api\/onboarding\/documents$/, method: 'POST', type: 'document_uploaded', category: 'onboarding' },
  { pattern: /^\/api\/onboarding\/assistant\/chat$/, method: 'POST', type: 'onboarding_assistant_chat', category: 'onboarding' },
  { pattern: /^\/api\/onboarding\/feedback\/\d+\/submit$/, method: 'POST', type: 'feedback_submitted', category: 'onboarding' },

  // ─── Assessment Events ───
  { pattern: /^\/api\/assessments\/start$/, method: 'POST', type: 'assessment_started', category: 'user' },
  { pattern: /^\/api\/assessments\/answer$/, method: 'POST', type: 'assessment_answer', category: 'user' },
  { pattern: /^\/api\/assessments\/event$/, method: 'POST', type: 'assessment_event', category: 'user' },
  { pattern: /^\/api\/candidate\/assessments\/start$/, method: 'POST', type: 'assessment_started', category: 'user' },
  { pattern: /^\/api\/candidate\/assessments\/\d+\/submit$/, method: 'POST', type: 'assessment_submitted', category: 'user' },

  // ─── Job Events ───
  { pattern: /^\/api\/jobs$/, method: 'POST', type: 'job_created', category: 'recruiter' },
  { pattern: /^\/api\/jobs\/\d+$/, method: 'PUT', type: 'job_updated', category: 'recruiter' },
  { pattern: /^\/api\/jobs\/\d+$/, method: 'DELETE', type: 'job_deleted', category: 'recruiter' },

  // ─── AI / Admin Events ───
  { pattern: /^\/api\/ai-health\/reset$/, method: 'POST', type: 'ai_health_reset', category: 'system' },
  { pattern: /^\/api\/admin\/login$/, method: 'POST', type: 'admin_login', category: 'auth' },
  { pattern: /^\/api\/admin\/logout$/, method: 'POST', type: 'admin_logout', category: 'auth' },
];

/**
 * Match a request to a business event.
 * Returns { type, category } or null if no match (falls back to generic).
 */
function matchRouteEvent(method, path) {
  for (const route of ROUTE_EVENT_MAP) {
    if (route.method === method && route.pattern.test(path)) {
      return { type: route.type, category: route.category };
    }
  }
  return null;
}

/**
 * Express middleware that logs every API request as a meaningful business event.
 * Maps route patterns to descriptive event types (e.g., 'application_submitted' instead of 'api_request').
 * Attach after auth middleware so req.user is available.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  // Log on response finish
  res.on('finish', () => {
    // Skip health checks, static files, and admin polling endpoints
    if (req.path === '/health' || !req.path.startsWith('/api')) return;
    // Skip noisy admin polling (metrics, activity, modules, ai-health GET)
    if (req.method === 'GET' && (
      req.path === '/api/admin/metrics' ||
      req.path === '/api/admin/activity' ||
      req.path === '/api/admin/modules' ||
      req.path === '/api/ai-health'
    )) return;

    const duration = Date.now() - start;
    const isError = res.statusCode >= 400;
    const matched = matchRouteEvent(req.method, req.path);

    // Use matched event or fall back to generic
    const eventType = isError ? (matched ? `${matched.type}_failed` : 'api_error') : (matched ? matched.type : 'api_request');
    const category = isError ? 'error' : (matched ? matched.category : 'system');

    logActivity({
      type: eventType,
      category,
      severity: res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warning' : 'info'),
      userId: req.user?.id,
      userEmail: req.user?.email,
      details: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        ...(matched ? {} : {}), // matched events already have descriptive type
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
