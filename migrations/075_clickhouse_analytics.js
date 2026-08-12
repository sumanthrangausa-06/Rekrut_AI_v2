/**
 * Migration 075: ClickHouse Analytics Schema (Issue #143)
 *
 * Creates the ClickHouse analytics tables and the PostgreSQL sync_state tracking table.
 * ClickHouse is optional — if CLICKHOUSE_URL is not set, the migration logs a warning
 * and only creates the PostgreSQL sync_state table.
 */

const clickhouse = require('../lib/clickhouse');

exports.name = 'clickhouse_analytics_schema';

exports.up = async (client) => {
	console.log('[migration] Setting up ClickHouse analytics schema...');

	// ─── PostgreSQL: sync_state table ───
	// Tracks last successful sync timestamps for each analytics table.
	await client.query(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id SERIAL PRIMARY KEY,
      table_name VARCHAR(100) UNIQUE NOT NULL,
      last_synced_at TIMESTAMPTZ,
      rows_synced INTEGER DEFAULT 0,
      last_error TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

	await client.query(`
    CREATE INDEX IF NOT EXISTS idx_sync_state_table ON sync_state(table_name)
  `);

	console.log('[migration] sync_state table ready in PostgreSQL');

	// ─── ClickHouse: analytics tables ───
	const chHealthy = await clickhouse.isHealthy();
	if (!chHealthy) {
		console.warn(
			'[migration] ClickHouse is not configured or unreachable. Skipping ClickHouse schema creation.',
		);
		console.warn('[migration] Run this migration again after setting CLICKHOUSE_URL.');
		return;
	}

	// candidate_scores — aggregated candidate scoring data
	await clickhouse.exec(`
    CREATE TABLE IF NOT EXISTS candidate_scores (
      candidate_id Int32,
      job_id Int32,
      company_id Int32,
      score_type LowCardinality(String),
      score_value Float32,
      percentile Float32,
      created_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(created_at)
    ORDER BY (candidate_id, score_type, created_at)
    TTL created_at + INTERVAL 2 YEAR
    SETTINGS index_granularity = 8192
  `);

	// test_attempts — test/assessment attempt analytics
	await clickhouse.exec(`
    CREATE TABLE IF NOT EXISTS test_attempts (
      attempt_id Int32,
      candidate_id Int32,
      test_id Int32,
      started_at DateTime,
      completed_at Nullable(DateTime),
      score Nullable(Int32),
      max_score Nullable(Int32),
      percentile Nullable(Float32),
      anti_cheat_score Nullable(Int32),
      time_spent_seconds Nullable(Int32),
      tab_switches Int32 DEFAULT 0,
      copy_paste_attempts Int32 DEFAULT 0,
      time_anomalies Int32 DEFAULT 0,
      flags String DEFAULT '{}',
      status LowCardinality(String) DEFAULT 'completed',
      synced_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(synced_at)
    ORDER BY (candidate_id, test_id, synced_at)
    TTL synced_at + INTERVAL 2 YEAR
    SETTINGS index_granularity = 8192
  `);

	// analytics_events — general event stream
	await clickhouse.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      event_type LowCardinality(String),
      user_id Nullable(Int32),
      company_id Nullable(Int32),
      session_id Nullable(String),
      metadata String DEFAULT '{}',
      created_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree()
    PARTITION BY toYYYYMM(created_at)
    ORDER BY (event_type, created_at, user_id)
    TTL created_at + INTERVAL 1 YEAR
    SETTINGS index_granularity = 8192
  `);

	console.log('[migration] ClickHouse analytics tables created');
};
