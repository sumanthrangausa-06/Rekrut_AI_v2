/**
 * Migration 039: AI Health Monitoring — Call Logs, Prompt Registry, Model Metrics
 *
 * Creates tables for:
 * 1. ai_call_log — Every AI call with full metadata (latency, tokens, cost, module)
 * 2. ai_prompts — Prompt registry with version control
 * 3. ai_prompt_versions — Version history for each prompt
 * 4. ai_ab_tests — A/B test configurations for prompts
 */

module.exports = {
  name: '039_ai_health_monitoring',
  async up(client) {
    // ─── AI Call Log — comprehensive per-call tracking ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_call_log (
        id SERIAL PRIMARY KEY,
        module VARCHAR(100) NOT NULL,
        feature VARCHAR(200),
        modality VARCHAR(50) NOT NULL,
        provider VARCHAR(100) NOT NULL,
        model VARCHAR(200),
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        success BOOLEAN DEFAULT true,
        error_message TEXT,
        cost_estimate DECIMAL(10, 6) DEFAULT 0,
        fallback_chain JSONB,
        user_id INTEGER,
        prompt_id INTEGER,
        prompt_version INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_call_log_created ON ai_call_log (created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_call_log_module ON ai_call_log (module)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_call_log_provider ON ai_call_log (provider)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_call_log_modality ON ai_call_log (modality)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_call_log_success ON ai_call_log (success)`);

    // ─── AI Prompts — central registry ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_prompts (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(200) UNIQUE NOT NULL,
        name VARCHAR(300) NOT NULL,
        module VARCHAR(100) NOT NULL,
        feature VARCHAR(200),
        description TEXT,
        current_version INTEGER DEFAULT 1,
        model VARCHAR(200),
        avg_tokens DECIMAL(10, 1) DEFAULT 0,
        avg_latency_ms DECIMAL(10, 1) DEFAULT 0,
        success_rate DECIMAL(5, 2) DEFAULT 100,
        total_calls INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // ─── AI Prompt Versions — version history ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_prompt_versions (
        id SERIAL PRIMARY KEY,
        prompt_id INTEGER REFERENCES ai_prompts(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        system_prompt TEXT,
        user_template TEXT,
        temperature DECIMAL(3, 2) DEFAULT 0.7,
        max_tokens INTEGER DEFAULT 8192,
        model VARCHAR(200),
        change_note TEXT,
        performance_score DECIMAL(5, 2),
        total_calls INTEGER DEFAULT 0,
        avg_tokens DECIMAL(10, 1) DEFAULT 0,
        avg_latency_ms DECIMAL(10, 1) DEFAULT 0,
        success_rate DECIMAL(5, 2) DEFAULT 100,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(prompt_id, version)
      )
    `);

    // ─── AI A/B Tests ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_ab_tests (
        id SERIAL PRIMARY KEY,
        prompt_id INTEGER REFERENCES ai_prompts(id) ON DELETE CASCADE,
        name VARCHAR(300) NOT NULL,
        version_a INTEGER NOT NULL,
        version_b INTEGER NOT NULL,
        traffic_split DECIMAL(3, 2) DEFAULT 0.5,
        status VARCHAR(50) DEFAULT 'active',
        calls_a INTEGER DEFAULT 0,
        calls_b INTEGER DEFAULT 0,
        success_a INTEGER DEFAULT 0,
        success_b INTEGER DEFAULT 0,
        avg_tokens_a DECIMAL(10, 1) DEFAULT 0,
        avg_tokens_b DECIMAL(10, 1) DEFAULT 0,
        avg_latency_a DECIMAL(10, 1) DEFAULT 0,
        avg_latency_b DECIMAL(10, 1) DEFAULT 0,
        winner VARCHAR(10),
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ended_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    console.log('[migration-039] AI health monitoring tables created');
  }
};
