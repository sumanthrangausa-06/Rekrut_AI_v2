/**
 * Metrics Collector — Comprehensive infrastructure monitoring.
 *
 * Collects: server metrics (CPU, memory, uptime, active connections),
 * database metrics (size, pool, query stats, slow queries),
 * API metrics (request counts, error rates, latency percentiles, req/min),
 * user/interview session metrics (practice/mock, completed/abandoned).
 *
 * Exposed via /api/admin/metrics endpoint.
 */

const os = require('os');
const pool = require('./db');
const { SERVER_START_TIME } = require('./activity-logger');

// ─── Active HTTP Connection Tracking ─────────────────────────
let activeHttpConnections = 0;

function trackConnection(socket) {
  activeHttpConnections++;
  socket.on('close', () => { activeHttpConnections--; });
}

function setHttpServer(server) {
  server.on('connection', trackConnection);
}

// ─── Request Metrics (in-memory, rolling window) ───────────────
const REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window

class RequestMetrics {
  constructor() {
    this.requests = [];       // { timestamp, method, path, status, duration }
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.endpointCounts = {};  // { path: { total, errors, durations[] } }
  }

  record(method, path, status, duration) {
    const now = Date.now();
    this.requests.push({ timestamp: now, method, path, status, duration });
    this.totalRequests++;
    if (status >= 400) this.totalErrors++;

    // Per-endpoint tracking
    const key = `${method} ${path}`;
    if (!this.endpointCounts[key]) {
      this.endpointCounts[key] = { total: 0, errors: 0, durations: [] };
    }
    this.endpointCounts[key].total++;
    if (status >= 400) this.endpointCounts[key].errors++;
    this.endpointCounts[key].durations.push(duration);

    // Keep only last 1000 durations per endpoint
    if (this.endpointCounts[key].durations.length > 1000) {
      this.endpointCounts[key].durations = this.endpointCounts[key].durations.slice(-500);
    }

    // Prune old entries every 100 requests
    if (this.requests.length % 100 === 0) {
      this._prune(now);
    }
  }

  _prune(now) {
    const cutoff = now - REQUEST_WINDOW_MS;
    this.requests = this.requests.filter(r => r.timestamp >= cutoff);
  }

  getPercentile(durations, pct) {
    if (durations.length === 0) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getSummary() {
    const now = Date.now();
    this._prune(now);

    // Requests in last hour
    const recentRequests = this.requests;
    const recentErrors = recentRequests.filter(r => r.status >= 400);
    const durations = recentRequests.map(r => r.duration).filter(d => d != null);

    // Requests per minute (last 60 seconds)
    const oneMinuteAgo = now - 60000;
    const lastMinuteRequests = recentRequests.filter(r => r.timestamp >= oneMinuteAgo);

    // Top endpoints by traffic
    const topEndpoints = Object.entries(this.endpointCounts)
      .map(([path, data]) => ({
        path,
        total: data.total,
        errors: data.errors,
        errorRate: data.total > 0 ? ((data.errors / data.total) * 100).toFixed(1) : '0.0',
        p50: this.getPercentile(data.durations, 50),
        p95: this.getPercentile(data.durations, 95),
        p99: this.getPercentile(data.durations, 99),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    return {
      hourly: {
        requests: recentRequests.length,
        errors: recentErrors.length,
        errorRate: recentRequests.length > 0
          ? ((recentErrors.length / recentRequests.length) * 100).toFixed(1)
          : '0.0',
      },
      cumulative: {
        totalRequests: this.totalRequests,
        totalErrors: this.totalErrors,
        errorRate: this.totalRequests > 0
          ? ((this.totalErrors / this.totalRequests) * 100).toFixed(1)
          : '0.0',
      },
      latency: {
        p50: this.getPercentile(durations, 50),
        p95: this.getPercentile(durations, 95),
        p99: this.getPercentile(durations, 99),
        avg: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      },
      requestsPerMinute: lastMinuteRequests.length,
      topEndpoints,
    };
  }
}

const requestMetrics = new RequestMetrics();

// ─── Metrics Collection Functions ─────────────────────────────

/**
 * Get server metrics (CPU, memory, uptime, active connections).
 */
function getServerMetrics() {
  const uptime = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();

  // Calculate CPU usage from cpus
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  const cpuUsage = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  return {
    uptime,
    uptimeFormatted: formatUptime(uptime),
    activeConnections: activeHttpConnections,
    cpu: {
      usage: parseFloat(cpuUsage),
      cores: cpus.length,
      model: cpus[0]?.model || 'unknown',
    },
    memory: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      systemTotal: totalMem,
      systemFree: freeMem,
      systemUsedPct: ((1 - freeMem / totalMem) * 100).toFixed(1),
    },
    platform: {
      node: process.version,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      hostname: os.hostname(),
    },
  };
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Get database metrics (size, connections, pool, query stats).
 */
async function getDatabaseMetrics() {
  try {
    const queryStats = pool.getQueryStats ? pool.getQueryStats() : { totalQueries: 0, slowQueries: 0, queriesPerMinute: 0 };

    const [sizeResult, connResult, tableResult] = await Promise.all([
      pool.query("SELECT pg_database_size(current_database()) as size"),
      pool.query("SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'"),
      pool.query(`
        SELECT relname as table_name, n_live_tup as row_count
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 15
      `),
    ]);

    const dbSizeBytes = parseInt(sizeResult.rows[0]?.size || 0, 10);
    const activeConns = parseInt(connResult.rows[0]?.count || 0, 10);
    const poolTotal = pool.totalCount || 0;
    const poolIdle = pool.idleCount || 0;
    const poolWaiting = pool.waitingCount || 0;
    const poolActive = poolTotal - poolIdle;

    return {
      sizeBytes: dbSizeBytes,
      sizeMB: (dbSizeBytes / 1024 / 1024).toFixed(1),
      activeConnections: activeConns,
      poolTotal,
      poolIdle,
      poolWaiting,
      poolUtilization: poolTotal > 0 ? ((poolActive / poolTotal) * 100).toFixed(1) : '0.0',
      totalQueries: queryStats.totalQueries,
      slowQueries: queryStats.slowQueries,
      queriesPerMinute: queryStats.queriesPerMinute,
      tables: tableResult.rows.map(r => ({
        name: r.table_name,
        rows: parseInt(r.row_count, 10),
      })),
    };
  } catch (err) {
    console.error('[metrics] Database metrics error:', err.message);
    return { error: err.message };
  }
}

/**
 * Get user and interview metrics (with practice/mock + completed/abandoned breakdown).
 */
async function getUserMetrics() {
  try {
    const [
      usersResult,
      activeResult,
      interviewsResult,
      interviewsTodayResult,
      activeSessionsResult,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE role = 'candidate') as candidates,
          COUNT(*) FILTER (WHERE role = 'recruiter') as recruiters
        FROM users
      `),
      pool.query(`
        SELECT COUNT(DISTINCT user_id) as active_today
        FROM activity_log
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND user_id IS NOT NULL
      `).catch(() => ({ rows: [{ active_today: 0 }] })),
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status IN ('in-progress', 'pending')) as active,
          COUNT(*) FILTER (WHERE status IN ('abandoned', 'cancelled')) as abandoned,
          COUNT(*) FILTER (WHERE interview_type = 'practice') as practice,
          COUNT(*) FILTER (WHERE interview_type = 'mock') as mock
        FROM interviews
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM interviews
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `),
      pool.query(`
        SELECT COUNT(*) as count FROM user_sessions WHERE expire > NOW()
      `).catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const users = usersResult.rows[0];
    const interviews = interviewsResult.rows[0];

    return {
      users: {
        total: parseInt(users.total, 10),
        candidates: parseInt(users.candidates, 10),
        recruiters: parseInt(users.recruiters, 10),
        activeToday: parseInt(activeResult.rows[0]?.active_today || 0, 10),
      },
      interviews: {
        total: parseInt(interviews.total, 10),
        completed: parseInt(interviews.completed || 0, 10),
        active: parseInt(interviews.active || 0, 10),
        today: parseInt(interviewsTodayResult.rows[0]?.count || 0, 10),
        abandoned: parseInt(interviews.abandoned || 0, 10),
        practice: parseInt(interviews.practice || 0, 10),
        mock: parseInt(interviews.mock || 0, 10),
      },
      activeSessions: parseInt(activeSessionsResult.rows[0]?.count || 0, 10),
    };
  } catch (err) {
    console.error('[metrics] User metrics error:', err.message);
    return { error: err.message };
  }
}

/**
 * Get all metrics in one call (for dashboard).
 */
async function getAllMetrics() {
  const [server, db, users] = await Promise.all([
    getServerMetrics(),
    getDatabaseMetrics(),
    getUserMetrics(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    server,
    database: db,
    api: requestMetrics.getSummary(),
    users: users.users || {},
    interviews: users.interviews || {},
    activeSessions: users.activeSessions || 0,
  };
}

/**
 * Express middleware to record request metrics.
 * Should be placed early in the middleware chain.
 */
function metricsMiddleware(req, res, next) {
  if (req.path === '/health' || !req.path.startsWith('/api')) {
    return next();
  }

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Normalize path: replace IDs with :id
    const normalizedPath = req.path.replace(/\/\d+/g, '/:id');
    requestMetrics.record(req.method, normalizedPath, res.statusCode, duration);
  });
  next();
}

module.exports = {
  getAllMetrics,
  getServerMetrics,
  getDatabaseMetrics,
  getUserMetrics,
  requestMetrics,
  metricsMiddleware,
  setHttpServer,
};
