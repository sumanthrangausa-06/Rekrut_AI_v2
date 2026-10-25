// =============================================================================
// Migration 252: Persistent storage-deletion ledger + audit metadata (S-076)
// =============================================================================
//
// S-076 privacy-engineer review (Q3 BLOCKER): the two-phase erasure design
// (in-tx DB DELETEs → post-commit R2/B2 deletions) keeps storage keys only
// in process memory. A crash between COMMIT and Phase 2 orphans plaintext
// files forever — the S-077 purge cron cannot reconcile keys it can't read.
//
// Fix: pending_storage_deletions ledger. Phase 1 INSERTs pending rows in-tx;
// Phase 2 marks them deleted/failed post-commit; the S-077 cron sweeps
// un-marked entries.
//
// S-076 privacy-engineer review (Q4 MAJOR): the single summary audit entry
// (action='delete', dataType='storage_file') identifies no files. Adding a
// metadata JSONB column to biometric_audit_log so per-file audit entries can
// carry keys, counts, and failure lists (Art. 5(2) accountability).
//
// Safety:
//   - CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS (idempotent)
//   - CREATE INDEX IF NOT EXISTS (idempotent)
// =============================================================================

module.exports = {
	name: '252_pending_storage_deletions_ledger',
	up: async (client) => {
		await client.query(`
      CREATE TABLE IF NOT EXISTS pending_storage_deletions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        file_url TEXT NOT NULL,
        storage_type VARCHAR(20) NOT NULL DEFAULT 'r2'
          CHECK (storage_type IN ('r2', 'local')),
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'deleted', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_storage_deletions_status
      ON pending_storage_deletions(status)
    `);
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_storage_deletions_user
      ON pending_storage_deletions(user_id)
    `);

		// Q4: metadata column for per-file audit entries.
		await client.query(`
      ALTER TABLE biometric_audit_log
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'
    `);

		console.log('Migration 252: pending_storage_deletions + audit metadata done');
	},
	down: async (client) => {
		await client.query('DROP TABLE IF EXISTS pending_storage_deletions');
		await client.query('ALTER TABLE biometric_audit_log DROP COLUMN IF EXISTS metadata');
	},
};
