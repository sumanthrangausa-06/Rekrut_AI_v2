/**
 * Migration 043: AI Health Persistence — Survive Deploys
 *
 * Creates tables to persist AI health dashboard state that was previously in-memory only:
 * 1. ai_provider_verification — Last verification results per provider
 * 2. ai_token_budget_daily — Daily token usage snapshots (replaces in-memory history)
 * 3. ai_provider_stats — Cumulative provider call stats
 */

module.exports = {
  name: '043_ai_health_persistence',
  async up(client) {
    // ─── Provider Verification Results — persist verify results across deploys ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_verification (
        id SERIAL PRIMARY KEY,
        provider_key VARCHAR(100) NOT NULL,
        modality VARCHAR(50) NOT NULL,
        model VARCHAR(200),
        status VARCHAR(20) NOT NULL,
        latency_ms INTEGER DEFAULT 0,
        note TEXT,
        error_message TEXT,
        verified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(provider_key, modality)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_pv_verified ON ai_provider_verification (verified_at)`);

    // ─── Token Budget Daily — persist daily token usage history ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_token_budget_daily (
        id SERIAL PRIMARY KEY,
        date VARCHAR(10) NOT NULL UNIQUE,
        tokens_used INTEGER DEFAULT 0,
        daily_budget INTEGER DEFAULT 100000,
        budget_exhausted BOOLEAN DEFAULT false,
        exhausted_at TIMESTAMP WITH TIME ZONE,
        breakdown_llm INTEGER DEFAULT 0,
        breakdown_tts INTEGER DEFAULT 0,
        breakdown_asr INTEGER DEFAULT 0,
        breakdown_vision INTEGER DEFAULT 0,
        breakdown_embedding INTEGER DEFAULT 0,
        breakdown_other INTEGER DEFAULT 0,
        provider_openai INTEGER DEFAULT 0,
        provider_nim INTEGER DEFAULT 0,
        provider_other INTEGER DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // ─── Provider Stats — persist cumulative call stats ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_provider_stats (
        id SERIAL PRIMARY KEY,
        stat_key VARCHAR(50) NOT NULL UNIQUE,
        stat_value BIGINT DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // ─── Verification metadata — when was last full verify run ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_verification_meta (
        id SERIAL PRIMARY KEY,
        total_tested INTEGER DEFAULT 0,
        total_working INTEGER DEFAULT 0,
        total_dead INTEGER DEFAULT 0,
        verified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    console.log('[migration-043] AI health persistence tables created');
  }
};
