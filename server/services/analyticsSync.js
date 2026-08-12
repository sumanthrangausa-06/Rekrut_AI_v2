const pool = require('../../lib/db');
const clickhouse = require('../../lib/clickhouse');
const { features } = require('../config/features');

/**
 * Analytics Sync Service
 *
 * Batches candidate test results, OmniScore data, and analytics events
 * from PostgreSQL into ClickHouse for fast OLAP queries.
 *
 * Design:
 * - Reads from PostgreSQL in configurable batch sizes
 * - Inserts into ClickHouse via @clickhouse/client
 * - Tracks last sync timestamp in PostgreSQL sync_state table
 * - Graceful fallback: if ClickHouse is down, skips and retries next run
 * - Idempotent: ClickHouse inserts are append-only; duplicates handled by query-time dedup
 */

const DEFAULT_BATCH_SIZE = parseInt(process.env.ANALYTICS_SYNC_BATCH_SIZE, 10) || 500;
const SYNC_INTERVAL_MS = parseInt(process.env.ANALYTICS_SYNC_INTERVAL_MS, 10) || 5 * 60 * 1000; // 5 min

/**
 * Get the last sync timestamp for a given table.
 */
async function getLastSync(tableName) {
	try {
		const result = await pool.query(
			'SELECT last_synced_at FROM sync_state WHERE table_name = $1',
			[tableName],
		);
		return result.rows[0]?.last_synced_at || new Date(0).toISOString();
	} catch (err) {
		console.error(`[analyticsSync] Failed to get last sync for ${tableName}:`, err.message);
		return new Date(0).toISOString();
	}
}

/**
 * Update the last sync timestamp for a given table.
 */
async function updateLastSync(tableName, syncedAt, rowsSynced = 0, error = null) {
	try {
		await pool.query(
			`
        INSERT INTO sync_state (table_name, last_synced_at, rows_synced, last_error, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          last_synced_at = EXCLUDED.last_synced_at,
          rows_synced = EXCLUDED.rows_synced,
          last_error = EXCLUDED.last_error,
          updated_at = NOW()
      `,
			[tableName, syncedAt, rowsSynced, error],
		);
	} catch (err) {
		console.error(`[analyticsSync] Failed to update sync state for ${tableName}:`, err.message);
	}
}

/**
 * Sync aptitude test attempts from PostgreSQL to ClickHouse.
 */
async function syncTestAttempts(batchSize = DEFAULT_BATCH_SIZE) {
	const tableName = 'test_attempts';
	const lastSync = await getLastSync(tableName);

	if (!(await clickhouse.isHealthy())) {
		console.warn('[analyticsSync] ClickHouse unavailable, skipping test_attempts sync');
		await updateLastSync(tableName, lastSync, 0, 'ClickHouse unavailable');
		return { synced: 0, table: tableName };
	}

	try {
		const result = await pool.query(
			`
        SELECT
          id as attempt_id,
          candidate_id,
          test_id,
          started_at,
          completed_at,
          score,
          max_score,
          percentile,
          anti_cheat_score,
          time_spent_seconds,
          COALESCE(tab_switches, 0) as tab_switches,
          COALESCE(copy_paste_attempts, 0) as copy_paste_attempts,
          COALESCE(time_anomalies, 0) as time_anomalies,
          status
        FROM aptitude_test_attempts
        WHERE (updated_at > $1 OR created_at > $1)
          AND status IN ('completed', 'timed_out')
        ORDER BY updated_at ASC
        LIMIT $2
      `,
			[lastSync, batchSize],
		);

		if (result.rows.length === 0) {
			return { synced: 0, table: tableName };
		}

		const rows = result.rows.map((r) => ({
			attempt_id: r.attempt_id,
			candidate_id: r.candidate_id,
			test_id: r.test_id,
			started_at: r.started_at ? new Date(r.started_at).toISOString().slice(0, 19) : null,
			completed_at: r.completed_at
				? new Date(r.completed_at).toISOString().slice(0, 19)
				: null,
			score: r.score,
			max_score: r.max_score,
			percentile: r.percentile ? parseFloat(r.percentile) : null,
			anti_cheat_score: r.anti_cheat_score,
			time_spent_seconds: r.time_spent_seconds,
			tab_switches: r.tab_switches,
			copy_paste_attempts: r.copy_paste_attempts,
			time_anomalies: r.time_anomalies,
			flags: JSON.stringify({}), // reserved for future anti-cheat flags
			status: r.status,
			synced_at: new Date().toISOString().slice(0, 19),
		}));

		const insertResult = await clickhouse.insert(tableName, rows);
		if (!insertResult.success) {
			await updateLastSync(tableName, lastSync, 0, insertResult.error);
			return { synced: 0, table: tableName, error: insertResult.error };
		}

		const newestUpdatedAt = result.rows[result.rows.length - 1].updated_at;
		await updateLastSync(tableName, newestUpdatedAt, rows.length, null);

		console.log(`[analyticsSync] Synced ${rows.length} test_attempts to ClickHouse`);
		return { synced: rows.length, table: tableName };
	} catch (err) {
		console.error('[analyticsSync] Error syncing test_attempts:', err.message);
		await updateLastSync(tableName, lastSync, 0, err.message);
		return { synced: 0, table: tableName, error: err.message };
	}
}

/**
 * Sync OmniScore data from PostgreSQL to ClickHouse.
 */
async function syncOmniScores(batchSize = DEFAULT_BATCH_SIZE) {
	const tableName = 'candidate_scores';
	const lastSync = await getLastSync(tableName);

	if (!(await clickhouse.isHealthy())) {
		console.warn('[analyticsSync] ClickHouse unavailable, skipping candidate_scores sync');
		await updateLastSync(tableName, lastSync, 0, 'ClickHouse unavailable');
		return { synced: 0, table: tableName };
	}

	try {
		// Sync omni_scores as 'omniscore' score_type
		const result = await pool.query(
			`
        SELECT
          os.user_id as candidate_id,
          NULL::int as job_id,
          NULL::int as company_id,
          'omniscore' as score_type,
          os.total_score as score_value,
          NULL::numeric as percentile,
          os.updated_at as created_at
        FROM omni_scores os
        WHERE os.updated_at > $1
        ORDER BY os.updated_at ASC
        LIMIT $2
      `,
			[lastSync, batchSize],
		);

		// Also sync score_history entries
		const historyResult = await pool.query(
			`
        SELECT
          sh.user_id as candidate_id,
          NULL::int as job_id,
          NULL::int as company_id,
          CASE
            WHEN sh.component_type = 'interview' THEN 'interview_score'
            WHEN sh.component_type = 'technical' THEN 'technical_score'
            WHEN sh.component_type = 'resume' THEN 'resume_score'
            WHEN sh.component_type = 'behavior' THEN 'behavior_score'
            ELSE sh.component_type
          END as score_type,
          sh.new_score as score_value,
          NULL::numeric as percentile,
          sh.created_at
        FROM score_history sh
        WHERE sh.created_at > $1
        ORDER BY sh.created_at ASC
        LIMIT $2
      `,
			[lastSync, batchSize],
		);

		const combinedRows = [
			...result.rows.map((r) => ({
				candidate_id: r.candidate_id,
				job_id: r.job_id,
				company_id: r.company_id,
				score_type: r.score_type,
				score_value: r.score_value ? parseFloat(r.score_value) : null,
				percentile: r.percentile ? parseFloat(r.percentile) : null,
				created_at: r.created_at
					? new Date(r.created_at).toISOString().slice(0, 19)
					: new Date().toISOString().slice(0, 19),
			})),
			...historyResult.rows.map((r) => ({
				candidate_id: r.candidate_id,
				job_id: r.job_id,
				company_id: r.company_id,
				score_type: r.score_type,
				score_value: r.score_value ? parseFloat(r.score_value) : null,
				percentile: r.percentile ? parseFloat(r.percentile) : null,
				created_at: r.created_at
					? new Date(r.created_at).toISOString().slice(0, 19)
					: new Date().toISOString().slice(0, 19),
			})),
		];

		if (combinedRows.length === 0) {
			return { synced: 0, table: tableName };
		}

		const insertResult = await clickhouse.insert(tableName, combinedRows);
		if (!insertResult.success) {
			await updateLastSync(tableName, lastSync, 0, insertResult.error);
			return { synced: 0, table: tableName, error: insertResult.error };
		}

		// Use the later of the two timestamps
		const newestUpdatedAt =
			result.rows.length > 0
				? result.rows[result.rows.length - 1].created_at
				: historyResult.rows.length > 0
					? historyResult.rows[historyResult.rows.length - 1].created_at
					: lastSync;

		await updateLastSync(tableName, newestUpdatedAt, combinedRows.length, null);

		console.log(`[analyticsSync] Synced ${combinedRows.length} candidate_scores to ClickHouse`);
		return { synced: combinedRows.length, table: tableName };
	} catch (err) {
		console.error('[analyticsSync] Error syncing candidate_scores:', err.message);
		await updateLastSync(tableName, lastSync, 0, err.message);
		return { synced: 0, table: tableName, error: err.message };
	}
}

/**
 * Sync analytics events from PostgreSQL events table to ClickHouse.
 */
async function syncAnalyticsEvents(batchSize = DEFAULT_BATCH_SIZE) {
	const tableName = 'analytics_events';
	const lastSync = await getLastSync(tableName);

	if (!(await clickhouse.isHealthy())) {
		console.warn('[analyticsSync] ClickHouse unavailable, skipping analytics_events sync');
		await updateLastSync(tableName, lastSync, 0, 'ClickHouse unavailable');
		return { synced: 0, table: tableName };
	}

	try {
		const result = await pool.query(
			`
        SELECT
          event_type,
          user_id,
          NULL::int as company_id,
          session_id,
          metadata,
          created_at
        FROM events
        WHERE created_at > $1
        ORDER BY created_at ASC
        LIMIT $2
      `,
			[lastSync, batchSize],
		);

		if (result.rows.length === 0) {
			return { synced: 0, table: tableName };
		}

		const rows = result.rows.map((r) => ({
			event_type: r.event_type,
			user_id: r.user_id,
			company_id: r.company_id,
			session_id: r.session_id,
			metadata:
				typeof r.metadata === 'string'
					? r.metadata
					: JSON.stringify(r.metadata || {}),
			created_at: r.created_at
				? new Date(r.created_at).toISOString().slice(0, 19)
				: new Date().toISOString().slice(0, 19),
		}));

		const insertResult = await clickhouse.insert(tableName, rows);
		if (!insertResult.success) {
			await updateLastSync(tableName, lastSync, 0, insertResult.error);
			return { synced: 0, table: tableName, error: insertResult.error };
		}

		const newestCreatedAt = result.rows[result.rows.length - 1].created_at;
		await updateLastSync(tableName, newestCreatedAt, rows.length, null);

		console.log(`[analyticsSync] Synced ${rows.length} analytics_events to ClickHouse`);
		return { synced: rows.length, table: tableName };
	} catch (err) {
		console.error('[analyticsSync] Error syncing analytics_events:', err.message);
		await updateLastSync(tableName, lastSync, 0, err.message);
		return { synced: 0, table: tableName, error: err.message };
	}
}

/**
 * Run a full sync of all analytics tables.
 * Called on schedule or on-demand.
 */
async function runFullSync(batchSize = DEFAULT_BATCH_SIZE) {
	if (!features.useClickHouseAnalytics) {
		console.log('[analyticsSync] ClickHouse analytics disabled (useClickHouseAnalytics=false)');
		return { enabled: false, results: [] };
	}

	console.log('[analyticsSync] Starting full sync...');
	const results = await Promise.all([
		syncTestAttempts(batchSize),
		syncOmniScores(batchSize),
		syncAnalyticsEvents(batchSize),
	]);

	const totalSynced = results.reduce((sum, r) => sum + (r.synced || 0), 0);
	console.log(`[analyticsSync] Full sync complete. Total rows synced: ${totalSynced}`);
	return { enabled: true, results, totalSynced };
}

/**
 * Start a background sync interval.
 * Returns the interval handle so it can be stopped.
 */
function startScheduledSync(intervalMs = SYNC_INTERVAL_MS, batchSize = DEFAULT_BATCH_SIZE) {
	if (!features.useClickHouseAnalytics) {
		console.log('[analyticsSync] Scheduled sync disabled — feature flag off');
		return null;
	}

	console.log(`[analyticsSync] Scheduled sync starting (interval: ${intervalMs}ms, batch: ${batchSize})`);

	// Run immediately on startup
	setTimeout(() => runFullSync(batchSize), 5000);

	// Then on interval
	const handle = setInterval(() => runFullSync(batchSize), intervalMs);
	return handle;
}

/**
 * Get current sync status for all tables.
 */
async function getSyncStatus() {
	try {
		const result = await pool.query(
			'SELECT table_name, last_synced_at, rows_synced, last_error, updated_at FROM sync_state ORDER BY table_name',
		);
		return result.rows;
	} catch (err) {
		console.error('[analyticsSync] Failed to get sync status:', err.message);
		return [];
	}
}

module.exports = {
	syncTestAttempts,
	syncOmniScores,
	syncAnalyticsEvents,
	runFullSync,
	startScheduledSync,
	getSyncStatus,
	DEFAULT_BATCH_SIZE,
	SYNC_INTERVAL_MS,
};
