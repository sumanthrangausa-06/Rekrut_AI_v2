/**
 * OpenAI Token Budget Service
 *
 * Tracks OpenAI token usage across all modalities (LLM, TTS, ASR, Vision, Embedding).
 * When daily budget (100K tokens) is exhausted, signals the AI provider to skip OpenAI
 * and route directly to NIM providers.
 *
 * PERSISTENCE: Token budget state is now persisted to the ai_token_budget_daily DB table
 * so that dashboard data survives server restarts/deploys.
 *
 * Token estimation:
 * - LLM: uses response.usage.total_tokens when available, estimates from text length otherwise
 * - TTS: ~1 token per 4 characters of input text
 * - ASR: ~1 token per second of audio (Whisper pricing model)
 * - Vision: ~85 tokens per image + prompt tokens
 * - Embedding: ~1 token per 4 characters
 */

const DAILY_BUDGET = parseInt(process.env.OPENAI_DAILY_TOKEN_BUDGET, 10) || 100000;
const pool = require('./db');

class TokenBudgetService {
  constructor() {
    this.dailyBudget = DAILY_BUDGET;
    this.tokensUsed = 0;
    this.budgetExhausted = false;
    this.currentDay = this._getUTCDay();
    this.history = [];         // Last 7 days of usage
    this.modalityBreakdown = { // Per-modality tracking
      llm: 0,
      tts: 0,
      asr: 0,
      vision: 0,
      embedding: 0,
      other: 0,
    };
    this.providerBreakdown = { // Per-provider tracking (OpenAI vs NIM)
      openai: 0,
      nim: 0,
      other: 0,
    };
    this.exhaustedAt = null;   // Timestamp when budget was exhausted
    this.resetAt = null;       // Next reset time
    this._persistCounter = 0;  // Debounce DB writes

    this._updateResetTime();
    this._startMidnightReset();

    // Load persisted state from DB (non-blocking)
    this._loadFromDb();

    console.log(`[token-budget] Initialized. Daily budget: ${this.dailyBudget.toLocaleString()} tokens`);
  }

  _getUTCDay() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }

  _updateResetTime() {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 0, 0
    ));
    this.resetAt = tomorrow.toISOString();
  }

  _startMidnightReset() {
    // Check every 60 seconds if the day has changed
    this._resetInterval = setInterval(() => {
      const today = this._getUTCDay();
      if (today !== this.currentDay) {
        this._performReset(today);
      }
    }, 60 * 1000);
  }

  _performReset(newDay) {
    // Save yesterday's usage to DB before resetting
    this._persistToDb().catch(() => {});

    // Save yesterday's usage to history
    this.history.push({
      date: this.currentDay,
      tokensUsed: this.tokensUsed,
      budget: this.dailyBudget,
      breakdown: { ...this.modalityBreakdown },
      providerBreakdown: { ...this.providerBreakdown },
      exhaustedAt: this.exhaustedAt,
    });

    // Keep only last 7 days
    if (this.history.length > 7) {
      this.history.shift();
    }

    // Reset counters
    const wasExhausted = this.budgetExhausted;
    this.tokensUsed = 0;
    this.budgetExhausted = false;
    this.exhaustedAt = null;
    this.currentDay = newDay;
    this.modalityBreakdown = { llm: 0, tts: 0, asr: 0, vision: 0, embedding: 0, other: 0 };
    this.providerBreakdown = { openai: 0, nim: 0, other: 0 };
    this._updateResetTime();

    console.log(`[token-budget] Daily reset. New day: ${newDay}. Previous budget ${wasExhausted ? 'was exhausted' : 'had remaining tokens'}.`);
    if (wasExhausted) {
      console.log('[token-budget] OpenAI is now available again after budget reset.');
    }
  }

  /**
   * Record token usage for an AI call.
   * @param {string} modality - 'llm', 'tts', 'asr', 'vision', 'embedding'
   * @param {number} tokens - Number of tokens used
   * @param {string} [provider] - 'openai', 'nim', etc. (default: 'openai')
   */
  recordUsage(modality, tokens, provider = 'openai') {
    // Check if day rolled over
    const today = this._getUTCDay();
    if (today !== this.currentDay) {
      this._performReset(today);
    }

    this.tokensUsed += tokens;
    const bucket = this.modalityBreakdown[modality] !== undefined ? modality : 'other';
    this.modalityBreakdown[bucket] += tokens;
    const provBucket = this.providerBreakdown[provider] !== undefined ? provider : 'other';
    this.providerBreakdown[provBucket] += tokens;

    // Check if budget is now exhausted
    if (!this.budgetExhausted && this.tokensUsed >= this.dailyBudget) {
      this.budgetExhausted = true;
      this.exhaustedAt = new Date().toISOString();
      console.log(`[token-budget] BUDGET EXHAUSTED at ${this.tokensUsed.toLocaleString()} tokens. Routing to NIM providers.`);
      // Log to activity feed
      try {
        const { logBudgetExhausted } = require('./activity-logger');
        logBudgetExhausted(this.tokensUsed, this.dailyBudget);
      } catch (e) { /* activity logger not loaded yet */ }
    }

    // Persist to DB every 20 calls (debounced)
    this._persistCounter++;
    if (this._persistCounter >= 20) {
      this._persistCounter = 0;
      this._persistToDb().catch(() => {});
    }
  }

  /**
   * Check if OpenAI should be skipped due to budget exhaustion.
   * @returns {boolean} true if OpenAI budget is exhausted
   */
  isOpenAIBudgetExhausted() {
    // Check if day rolled over
    const today = this._getUTCDay();
    if (today !== this.currentDay) {
      this._performReset(today);
    }
    return this.budgetExhausted;
  }

  /**
   * Estimate token count from text content.
   * Uses rough heuristic: ~4 chars per token for English text.
   */
  estimateTokensFromText(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate tokens for a TTS request.
   * OpenAI charges ~1 token per 4 characters for TTS.
   */
  estimateTTSTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate tokens for an ASR request.
   * Whisper charges ~$0.006/min, roughly ~100 tokens per minute.
   * We estimate from audio buffer size: ~16KB per second at 16kHz mono.
   */
  estimateASRTokens(audioBufferSize) {
    if (!audioBufferSize) return 100; // Minimum estimate
    const estimatedSeconds = audioBufferSize / 16000;
    return Math.ceil(estimatedSeconds * (100 / 60)); // ~100 tokens per minute
  }

  /**
   * Estimate tokens for a vision request.
   * GPT-4o vision: ~85 tokens per low-detail image + prompt tokens.
   */
  estimateVisionTokens(imageCount, promptLength) {
    const imageTokens = (imageCount || 1) * 85;
    const promptTokens = Math.ceil((promptLength || 0) / 4);
    return imageTokens + promptTokens;
  }

  /**
   * Get current budget status for the admin dashboard.
   */
  getStatus() {
    return {
      dailyBudget: this.dailyBudget,
      tokensUsed: this.tokensUsed,
      tokensRemaining: Math.max(0, this.dailyBudget - this.tokensUsed),
      percentUsed: Math.min(100, Math.round((this.tokensUsed / this.dailyBudget) * 100 * 10) / 10),
      budgetExhausted: this.budgetExhausted,
      exhaustedAt: this.exhaustedAt,
      currentDay: this.currentDay,
      resetAt: this.resetAt,
      breakdown: { ...this.modalityBreakdown },
      providerBreakdown: { ...this.providerBreakdown },
      history: [...this.history],
      routingStatus: this.budgetExhausted ? 'nim_only' : 'openai_primary',
    };
  }

  // ─── DB Persistence ─────────────────────────────────────────────

  async _persistToDb() {
    try {
      await pool.query(
        `INSERT INTO ai_token_budget_daily (date, tokens_used, daily_budget, budget_exhausted, exhausted_at,
          breakdown_llm, breakdown_tts, breakdown_asr, breakdown_vision, breakdown_embedding, breakdown_other,
          provider_openai, provider_nim, provider_other, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
         ON CONFLICT (date) DO UPDATE SET
          tokens_used = $2, daily_budget = $3, budget_exhausted = $4, exhausted_at = $5,
          breakdown_llm = $6, breakdown_tts = $7, breakdown_asr = $8, breakdown_vision = $9,
          breakdown_embedding = $10, breakdown_other = $11,
          provider_openai = $12, provider_nim = $13, provider_other = $14, updated_at = NOW()`,
        [
          this.currentDay, this.tokensUsed, this.dailyBudget, this.budgetExhausted, this.exhaustedAt,
          this.modalityBreakdown.llm, this.modalityBreakdown.tts, this.modalityBreakdown.asr,
          this.modalityBreakdown.vision, this.modalityBreakdown.embedding, this.modalityBreakdown.other,
          this.providerBreakdown.openai, this.providerBreakdown.nim, this.providerBreakdown.other,
        ]
      );
    } catch (err) {
      if (!err.message.includes('does not exist')) {
        console.warn('[token-budget] DB persist failed:', err.message);
      }
    }
  }

  async _loadFromDb() {
    try {
      // Load today's data
      const todayResult = await pool.query(
        `SELECT * FROM ai_token_budget_daily WHERE date = $1`,
        [this.currentDay]
      );

      if (todayResult.rows.length > 0) {
        const row = todayResult.rows[0];
        this.tokensUsed = row.tokens_used || 0;
        this.budgetExhausted = row.budget_exhausted || false;
        this.exhaustedAt = row.exhausted_at || null;
        this.modalityBreakdown = {
          llm: row.breakdown_llm || 0,
          tts: row.breakdown_tts || 0,
          asr: row.breakdown_asr || 0,
          vision: row.breakdown_vision || 0,
          embedding: row.breakdown_embedding || 0,
          other: row.breakdown_other || 0,
        };
        this.providerBreakdown = {
          openai: row.provider_openai || 0,
          nim: row.provider_nim || 0,
          other: row.provider_other || 0,
        };
        console.log(`[token-budget] Loaded today's data from DB: ${this.tokensUsed} tokens used`);
      }

      // Load last 7 days of history
      const historyResult = await pool.query(
        `SELECT * FROM ai_token_budget_daily WHERE date < $1 ORDER BY date DESC LIMIT 7`,
        [this.currentDay]
      );

      this.history = historyResult.rows.map(row => ({
        date: row.date,
        tokensUsed: row.tokens_used || 0,
        budget: row.daily_budget || DAILY_BUDGET,
        breakdown: {
          llm: row.breakdown_llm || 0,
          tts: row.breakdown_tts || 0,
          asr: row.breakdown_asr || 0,
          vision: row.breakdown_vision || 0,
          embedding: row.breakdown_embedding || 0,
          other: row.breakdown_other || 0,
        },
        providerBreakdown: {
          openai: row.provider_openai || 0,
          nim: row.provider_nim || 0,
          other: row.provider_other || 0,
        },
        exhaustedAt: row.exhausted_at || null,
      })).reverse(); // Oldest first

      if (this.history.length > 0) {
        console.log(`[token-budget] Loaded ${this.history.length} days of history from DB`);
      }
    } catch (err) {
      if (!err.message.includes('does not exist')) {
        console.warn('[token-budget] DB load failed:', err.message);
      }
    }
  }

  destroy() {
    // Persist final state before shutdown
    this._persistToDb().catch(() => {});
    if (this._resetInterval) {
      clearInterval(this._resetInterval);
    }
  }
}

// Singleton
const tokenBudget = new TokenBudgetService();
module.exports = tokenBudget;
