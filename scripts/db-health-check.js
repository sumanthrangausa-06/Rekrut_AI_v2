const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000,
});

async function safeQuery(queryText, fallback) {
  try {
    const result = await pool.query(queryText);
    return result.rows;
  } catch (err) {
    return { error: err.message, fallback };
  }
}

async function runHealthCheck() {
  const results = {};

  try {
    // 1. Connection pool status
    results.poolStatus = await safeQuery(`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections,
        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    // Connection settings
    results.settings = await safeQuery(`
      SELECT name, setting, unit FROM pg_settings 
      WHERE name IN ('max_connections', 'shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem', 'random_page_cost', 'effective_io_concurrency')
    `);

    // 2. Slow queries (from pg_stat_statements if available)
    results.slowQueries = await safeQuery(`
      SELECT query, calls, mean_exec_time, total_exec_time, rows
      FROM pg_stat_statements
      WHERE mean_exec_time > 200
      ORDER BY mean_exec_time DESC
      LIMIT 20
    `, 'pg_stat_statements not available');

    // 3. Table sizes and bloat
    results.tableSizes = await safeQuery(`
      SELECT 
        schemaname,
        relname as table_name,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples,
        CASE WHEN n_live_tup > 0 THEN round(n_dead_tup::numeric / n_live_tup::numeric * 100, 2) ELSE 0 END as dead_tuple_ratio,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size,
        pg_size_pretty(pg_relation_size(relid)) as table_size,
        pg_size_pretty(pg_indexes_size(relid)) as indexes_size,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze,
        vacuum_count,
        autovacuum_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 50
    `);

    // 4. Index usage
    results.indexUsage = await safeQuery(`
      SELECT 
        schemaname,
        relname as table_name,
        indexrelname as index_name,
        idx_scan as index_scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      ORDER BY idx_scan DESC
      LIMIT 50
    `);

    // 5. Missing indexes (tables with high seq scans)
    results.missingIndexes = await safeQuery(`
      SELECT 
        schemaname,
        relname as table_name,
        seq_scan,
        seq_tup_read,
        idx_scan,
        n_live_tup as row_count,
        CASE WHEN seq_scan > 0 THEN round(idx_scan::numeric / seq_scan::numeric, 2) ELSE 0 END as idx_scan_ratio
      FROM pg_stat_user_tables
      WHERE schemaname = 'public' 
        AND seq_scan > 100
        AND (idx_scan IS NULL OR seq_scan > idx_scan * 10)
        AND n_live_tup > 1000
      ORDER BY seq_tup_read DESC
      LIMIT 20
    `);

    // 6. Unused indexes
    results.unusedIndexes = await safeQuery(`
      SELECT 
        schemaname,
        relname as table_name,
        indexrelname as index_name,
        idx_scan as index_scans,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public' AND idx_scan = 0
      ORDER BY pg_relation_size(indexrelid) DESC
      LIMIT 30
    `);

    // 7. Database size and age
    results.dbSize = await safeQuery(`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as database_size,
        pg_database_size(current_database()) as size_bytes,
        age(datfrozenxid) as xid_age,
        current_database() as database_name
      FROM pg_database
      WHERE datname = current_database()
    `);

    // 8. Long-running queries
    results.longRunningQueries = await safeQuery(`
      SELECT 
        pid,
        usename,
        application_name,
        client_addr,
        state,
        query_start,
        now() - query_start as query_duration,
        query
      FROM pg_stat_activity
      WHERE state = 'active' 
        AND query_start < now() - interval '30 seconds'
        AND query NOT LIKE '%pg_stat_activity%'
      ORDER BY query_start
    `);

    // 9. Lock waits
    results.lockWaits = await safeQuery(`
      SELECT 
        blocked_locks.pid as blocked_pid,
        blocked_activity.usename as blocked_user,
        blocking_locks.pid as blocking_pid,
        blocking_activity.usename as blocking_user,
        blocked_activity.query as blocked_query,
        blocking_activity.query as blocking_query
      FROM pg_catalog.pg_locks blocked_locks
      JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
      JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
        AND blocking_locks.relation = blocked_locks.relation
        AND blocking_locks.pid != blocked_locks.pid
      JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
      WHERE NOT blocked_locks.granted
    `);

    // 10. Duplicate indexes
    results.duplicateIndexes = await safeQuery(`
      SELECT 
        t.tablename,
        array_agg(i.indexname) as duplicate_indexes,
        pg_size_pretty(sum(pg_relation_size(i.indexname::regclass))) as wasted_size
      FROM pg_indexes i
      JOIN pg_indexes t ON t.tablename = i.tablename AND t.schemaname = i.schemaname
      WHERE i.schemaname = 'public'
      GROUP BY t.tablename, pg_get_indexdef(i.indexname::regclass)
      HAVING count(*) > 1
    `);

    // 11. FK constraints without indexes
    results.fkWithoutIndexes = await safeQuery(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_indexes pi
          WHERE pi.tablename = tc.table_name
            AND pi.indexdef LIKE '%(' || kcu.column_name || '%'
        )
      ORDER BY tc.table_name
    `);

    // 12. Schema overview - table list
    results.tables = await safeQuery(`
      SELECT 
        table_name,
        count(*) as column_count
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name
      ORDER BY table_name
    `);

    // 13. Constraint summary
    results.constraints = await safeQuery(`
      SELECT 
        tc.table_name,
        tc.constraint_type,
        count(*) as constraint_count
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
      GROUP BY tc.table_name, tc.constraint_type
      ORDER BY tc.table_name, tc.constraint_type
    `);

    // 14. Index summary
    results.indexSummary = await safeQuery(`
      SELECT 
        tablename,
        count(*) as index_count
      FROM pg_indexes
      WHERE schemaname = 'public'
      GROUP BY tablename
      ORDER BY tablename
    `);

    // 15. Check for tables without primary keys
    results.noPrimaryKey = await safeQuery(`
      SELECT tab.table_name
      FROM information_schema.tables tab
      LEFT JOIN information_schema.table_constraints tco 
        ON tab.table_name = tco.table_name 
        AND tco.constraint_type = 'PRIMARY KEY'
        AND tco.table_schema = 'public'
      WHERE tab.table_schema = 'public'
        AND tab.table_type = 'BASE TABLE'
        AND tco.constraint_name IS NULL
      ORDER BY tab.table_name
    `);

    console.log(JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Health check error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

runHealthCheck();
