/**
 * OpenAI Token Budget Service
 *
 * Tracks OpenAI token usage across all modalities (LLM, TTS, ASR, Vision, Embedding).
 * When daily budget (100K tokens) is exhausted, signals the AI provider to skip OpenAI
 * and route directly to NIM providers.
 *
 * Token estimation:
 * - LLM: uses response.usage.total_tokens when available, estimates from text length otherwise
 * - TTS: ~1 token per 4 characters of input text
 * - ASR: ~1 token per second of audio (Whisper pricing model)
 * - Vision: ~85 tokens per image + prompt tokens
 * - Embedding: ~1 token per 4 characters
 */

const DAILY_BUDGET = parseInt(process.env.OPENAI_DAILY_TOKEN_BUDGET, 10) || 100000;

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
    this.exhaustedAt = null;   // Timestamp when budget was exhausted
    this.resetAt = null;       // Next reset time

    this._updateResetTime();
    this._startMidnightReset();

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
    // Save yesterday's usage to history
    this.history.push({
      date: this.currentDay,
      tokensUsed: this.tokensUsed,
      budget: this.dailyBudget,
      breakdown: { ...this.modalityBreakdown },
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
    this._updateResetTime();

    console.log(`[token-budget] Daily reset. New day: ${newDay}. Previous budget ${wasExhausted ? 'was exhausted' : 'had remaining tokens'}.`);
    if (wasExhausted) {
      console.log('[token-budget] OpenAI is now available again after budget reset.');
    }
  }

  /**
   * Record token usage for an OpenAI call.
   * @param {string} modality - 'llm', 'tts', 'asr', 'vision', 'embedding'
   * @param {number} tokens - Number of tokens used
   */
  recordUsage(modality, tokens) {
    // Check if day rolled over
    const today = this._getUTCDay();
    if (today !== this.currentDay) {
      this._performReset(today);
    }

    this.tokensUsed += tokens;
    const bucket = this.modalityBreakdown[modality] !== undefined ? modality : 'other';
    this.modalityBreakdown[bucket] += tokens;

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
      history: [...this.history],
      routingStatus: this.budgetExhausted ? 'nim_only' : 'openai_primary',
    };
  }

  destroy() {
    if (this._resetInterval) {
      clearInterval(this._resetInterval);
    }
  }
}

// Singleton
const tokenBudget = new TokenBudgetService();
module.exports = tokenBudget;
