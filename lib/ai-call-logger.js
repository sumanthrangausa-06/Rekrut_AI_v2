/**
 * AI Call Logger — Comprehensive per-call logging for all AI operations.
 *
 * Tracks: module, feature, modality, provider, model, tokens, latency,
 * success/failure, cost estimate, fallback chain.
 *
 * In-memory buffer for real-time dashboard + async DB writes.
 */

const pool = require('./db');

// ─── Cost estimation ($ per 1K tokens, approximate) ──────────────────
const COST_PER_1K = {
  // OpenAI via Polsia proxy
  'openai': { input: 0.00015, output: 0.0006 },      // GPT-4o-mini
  'openai_vision': { input: 0.0025, output: 0.01 },   // GPT-4o
  'openai_tts': { input: 0.015, output: 0 },           // TTS-1
  'openai_whisper': { input: 0.006, output: 0 },       // Whisper
  'openai_embed': { input: 0.00002, output: 0 },       // text-embedding-3-small
  'anthropic': { input: 0.003, output: 0.015 },        // Claude
  // NIM models (much cheaper or free tier)
  'nim': { input: 0.0001, output: 0.0004 },
};

// ─── In-memory metrics for real-time dashboard ──────────────────────
const callBuffer = [];
const MAX_BUFFER = 500;
const modelMetrics = {};    // { model: { calls, tokens, latency, successes, failures } }
const moduleMetrics = {};   // { module: { calls, tokens, cost } }
const hourlyBuckets = {};   // { 'YYYY-MM-DD-HH': { calls, tokens, cost } }

// Budget prediction state
let burnRatePerMinute = 0;
let lastBurnCalcTime = Date.now();
let burnRateSamples = [];

/**
 * Log an AI call with full metadata.
 */
async function logCall({
  module = 'unknown',
  feature = '',
  modality,
  provider,
  model = '',
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  latencyMs = 0,
  success = true,
  errorMessage = '',
  fallbackChain = null,
  userId = null,
  promptId = null,
  promptVersion = null,
}) {
  const costRate = COST_PER_1K[provider] || COST_PER_1K[provider?.startsWith('nim') ? 'nim' : 'openai'] || { input: 0.0001, output: 0.0004 };
  const costEstimate = ((promptTokens * costRate.input) + (completionTokens * costRate.output)) / 1000;

  const entry = {
    id: Date.now() + Math.random(),
    module,
    feature,
    modality,
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens: totalTokens || (promptTokens + completionTokens),
    latencyMs,
    success,
    errorMessage,
    costEstimate,
    fallbackChain,
    userId,
    promptId,
    promptVersion,
    createdAt: new Date().toISOString(),
  };

  // Add to in-memory buffer
  callBuffer.push(entry);
  if (callBuffer.length > MAX_BUFFER) callBuffer.shift();

  // Update model metrics
  const modelKey = model || provider;
  if (!modelMetrics[modelKey]) {
    modelMetrics[modelKey] = { calls: 0, totalTokens: 0, totalLatency: 0, successes: 0, failures: 0, cost: 0, lastUsed: null };
  }
  const mm = modelMetrics[modelKey];
  mm.calls++;
  mm.totalTokens += entry.totalTokens;
  mm.totalLatency += latencyMs;
  mm.cost += costEstimate;
  mm.lastUsed = entry.createdAt;
  if (success) mm.successes++;
  else mm.failures++;

  // Update module metrics
  if (!moduleMetrics[module]) {
    moduleMetrics[module] = { calls: 0, totalTokens: 0, cost: 0, failures: 0 };
  }
  const modm = moduleMetrics[module];
  modm.calls++;
  modm.totalTokens += entry.totalTokens;
  modm.cost += costEstimate;
  if (!success) modm.failures++;

  // Update hourly bucket for burn rate calculation
  const hourKey = new Date().toISOString().substring(0, 13); // YYYY-MM-DDTHH
  if (!hourlyBuckets[hourKey]) {
    hourlyBuckets[hourKey] = { calls: 0, tokens: 0, cost: 0 };
    // Prune old buckets (keep last 48 hours)
    const keys = Object.keys(hourlyBuckets).sort();
    while (keys.length > 48) {
      delete hourlyBuckets[keys.shift()];
    }
  }
  hourlyBuckets[hourKey].calls++;
  hourlyBuckets[hourKey].tokens += entry.totalTokens;
  hourlyBuckets[hourKey].cost += costEstimate;

  // Update burn rate
  _updateBurnRate(entry.totalTokens);

  // Async DB write (non-blocking)
  _writeToDb(entry).catch(err => {
    console.warn('[ai-call-logger] DB write failed:', err.message);
  });

  return entry;
}

function _updateBurnRate(tokens) {
  const now = Date.now();
  burnRateSamples.push({ time: now, tokens });
  // Keep last 5 minutes of samples
  const fiveMinAgo = now - 5 * 60 * 1000;
  burnRateSamples = burnRateSamples.filter(s => s.time > fiveMinAgo);

  if (burnRateSamples.length >= 2) {
    const totalTokens = burnRateSamples.reduce((sum, s) => sum + s.tokens, 0);
    const windowMs = now - burnRateSamples[0].time;
    burnRatePerMinute = windowMs > 0 ? (totalTokens / windowMs) * 60000 : 0;
    lastBurnCalcTime = now;
  }
}

async function _writeToDb(entry) {
  try {
    await pool.query(
      `INSERT INTO ai_call_log (module, feature, modality, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, success, error_message, cost_estimate, fallback_chain, user_id, prompt_id, prompt_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        entry.module, entry.feature, entry.modality, entry.provider, entry.model,
        entry.promptTokens, entry.completionTokens, entry.totalTokens,
        entry.latencyMs, entry.success, entry.errorMessage || null,
        entry.costEstimate, entry.fallbackChain ? JSON.stringify(entry.fallbackChain) : null,
        entry.userId, entry.promptId, entry.promptVersion,
      ]
    );
  } catch (err) {
    // Table might not exist yet on first deploy — that's fine
    if (!err.message.includes('does not exist')) {
      throw err;
    }
  }
}

/**
 * Get recent calls from in-memory buffer.
 */
function getRecentCalls({ module, modality, provider, success, limit = 50 } = {}) {
  let calls = [...callBuffer];
  if (module) calls = calls.filter(c => c.module === module);
  if (modality) calls = calls.filter(c => c.modality === modality);
  if (provider) calls = calls.filter(c => c.provider === provider);
  if (success !== undefined) calls = calls.filter(c => c.success === success);
  return calls.slice(-limit).reverse();
}

/**
 * Get model performance metrics.
 */
function getModelMetrics() {
  const result = {};
  for (const [model, m] of Object.entries(modelMetrics)) {
    result[model] = {
      calls: m.calls,
      totalTokens: m.totalTokens,
      avgTokens: m.calls > 0 ? Math.round(m.totalTokens / m.calls) : 0,
      avgLatencyMs: m.calls > 0 ? Math.round(m.totalLatency / m.calls) : 0,
      successRate: m.calls > 0 ? Math.round((m.successes / m.calls) * 100 * 10) / 10 : 100,
      failures: m.failures,
      cost: Math.round(m.cost * 10000) / 10000,
      lastUsed: m.lastUsed,
    };
  }
  return result;
}

/**
 * Get module-level cost breakdown.
 */
function getModuleBreakdown() {
  const result = {};
  for (const [mod, m] of Object.entries(moduleMetrics)) {
    result[mod] = {
      calls: m.calls,
      totalTokens: m.totalTokens,
      cost: Math.round(m.cost * 10000) / 10000,
      failures: m.failures,
    };
  }
  return result;
}

/**
 * Get budget prediction — when will the daily budget be exhausted?
 */
function getBudgetPrediction(tokenBudgetStatus) {
  const { tokensUsed, dailyBudget, budgetExhausted } = tokenBudgetStatus;
  const tokensRemaining = dailyBudget - tokensUsed;

  if (budgetExhausted) {
    return {
      exhausted: true,
      burnRatePerMinute: Math.round(burnRatePerMinute),
      prediction: 'Budget already exhausted — routing to NIM providers',
      exhaustsAt: null,
      minutesRemaining: 0,
    };
  }

  if (burnRatePerMinute <= 0 || burnRateSamples.length < 2) {
    return {
      exhausted: false,
      burnRatePerMinute: 0,
      prediction: 'Insufficient data — need more AI calls to predict',
      exhaustsAt: null,
      minutesRemaining: null,
    };
  }

  const minutesRemaining = tokensRemaining / burnRatePerMinute;
  const exhaustsAt = new Date(Date.now() + minutesRemaining * 60000);

  // Format prediction string
  const hours = Math.floor(minutesRemaining / 60);
  const mins = Math.round(minutesRemaining % 60);
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const exhaustsAtStr = exhaustsAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  return {
    exhausted: false,
    burnRatePerMinute: Math.round(burnRatePerMinute),
    prediction: `At current pace, budget exhausts in ${timeStr} (~${exhaustsAtStr})`,
    exhaustsAt: exhaustsAt.toISOString(),
    minutesRemaining: Math.round(minutesRemaining),
  };
}

/**
 * Get hourly usage breakdown (last 24h).
 */
function getHourlyUsage() {
  const hours = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = d.toISOString().substring(0, 13);
    const bucket = hourlyBuckets[key] || { calls: 0, tokens: 0, cost: 0 };
    hours.push({
      hour: key,
      label: d.toLocaleTimeString('en-US', { hour: '2-digit', hour12: true }),
      ...bucket,
    });
  }
  return hours;
}

/**
 * Query AI call logs from database with filters.
 */
async function queryCallLogs({ module, modality, provider, success, startDate, endDate, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (module) { conditions.push(`module = $${paramIdx++}`); params.push(module); }
  if (modality) { conditions.push(`modality = $${paramIdx++}`); params.push(modality); }
  if (provider) { conditions.push(`provider = $${paramIdx++}`); params.push(provider); }
  if (success !== undefined) { conditions.push(`success = $${paramIdx++}`); params.push(success); }
  if (startDate) { conditions.push(`created_at >= $${paramIdx++}`); params.push(startDate); }
  if (endDate) { conditions.push(`created_at <= $${paramIdx++}`); params.push(endDate); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [logsResult, countResult] = await Promise.all([
      pool.query(`SELECT * FROM ai_call_log ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) as total FROM ai_call_log ${where}`, params),
    ]);
    return { logs: logsResult.rows, total: parseInt(countResult.rows[0].total, 10) };
  } catch (err) {
    // Table doesn't exist yet
    if (err.message.includes('does not exist')) {
      return { logs: getRecentCalls({ module, modality, provider, success, limit }), total: callBuffer.length };
    }
    throw err;
  }
}

/**
 * Get failover statistics.
 */
function getFailoverStats() {
  const failovers = callBuffer.filter(c => c.fallbackChain && c.fallbackChain.length > 1);
  const failoversByModality = {};
  const failoversByProvider = {};

  for (const call of failovers) {
    // Count per modality
    if (!failoversByModality[call.modality]) failoversByModality[call.modality] = 0;
    failoversByModality[call.modality]++;

    // Count per provider (which providers triggered failover)
    if (call.fallbackChain) {
      for (const p of call.fallbackChain) {
        if (!failoversByProvider[p]) failoversByProvider[p] = { triggered: 0, served: 0 };
        failoversByProvider[p].triggered++;
      }
      // The last provider in chain is the one that served
      const served = call.provider;
      if (!failoversByProvider[served]) failoversByProvider[served] = { triggered: 0, served: 0 };
      failoversByProvider[served].served++;
    }
  }

  return {
    totalFailovers: failovers.length,
    totalCalls: callBuffer.length,
    failoverRate: callBuffer.length > 0 ? Math.round((failovers.length / callBuffer.length) * 100 * 10) / 10 : 0,
    byModality: failoversByModality,
    byProvider: failoversByProvider,
  };
}

/**
 * Get usage summary for the API.
 */
function getUsageSummary() {
  const totalCalls = callBuffer.length;
  const totalTokens = callBuffer.reduce((s, c) => s + c.totalTokens, 0);
  const totalCost = callBuffer.reduce((s, c) => s + c.costEstimate, 0);
  const avgLatency = totalCalls > 0 ? Math.round(callBuffer.reduce((s, c) => s + c.latencyMs, 0) / totalCalls) : 0;
  const failures = callBuffer.filter(c => !c.success).length;

  return {
    totalCalls,
    totalTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
    avgLatency,
    failures,
    successRate: totalCalls > 0 ? Math.round(((totalCalls - failures) / totalCalls) * 100 * 10) / 10 : 100,
  };
}

// ─── Priority-based throttling ──────────────────────────────────────
// Critical features get budget priority over nice-to-haves
const MODULE_PRIORITY = {
  // Critical — never throttled
  'mock_interview': 'critical',
  'mock-interview': 'critical',  // legacy alias
  'assessments': 'critical',
  'resume_parsing': 'critical',
  'resume-parsing': 'critical',  // legacy alias
  'safety': 'critical',
  // High — throttled only at 90%+
  'matching': 'high',
  'job-matching': 'high',  // legacy alias
  'coaching': 'high',
  'omniscore': 'high',
  'recruiter_tools': 'high',
  // Medium — throttled at 80%+
  'onboarding': 'medium',
  'resume_tools': 'medium',
  'screening': 'medium',
  'communication_hub': 'medium',
  'smart_search': 'medium',
  'application_review': 'medium',
  'offer-management': 'medium',
  // Low — throttled first
  'job_optimizer': 'low',
  'admin': 'low',
  'health_verify': 'low',
  'scheduling': 'low',
  'payroll': 'low',
  'profile': 'low',
};

/**
 * Check if a module should be throttled based on budget usage.
 * Returns true if the module should be throttled (non-critical + budget > 80%).
 */
function shouldThrottle(module, tokenBudgetStatus) {
  const { percentUsed, budgetExhausted } = tokenBudgetStatus;
  const priority = MODULE_PRIORITY[module] || 'low';

  // Never throttle critical modules
  if (priority === 'critical') return false;

  // Budget exhausted — throttle everything except critical
  if (budgetExhausted) return true;

  // >90% — throttle low priority
  if (percentUsed >= 90 && priority === 'low') return true;

  // >80% — throttle low + medium
  if (percentUsed >= 80 && (priority === 'low' || priority === 'medium')) return true;

  return false;
}

module.exports = {
  logCall,
  getRecentCalls,
  getModelMetrics,
  getModuleBreakdown,
  getBudgetPrediction,
  getHourlyUsage,
  queryCallLogs,
  getFailoverStats,
  getUsageSummary,
  shouldThrottle,
  MODULE_PRIORITY,
};
