/**
 * Migration 265: Fix trg_sync_csi_users trigger — use NEW.id not NEW.user_id (#1282)
 *
 * Regression history: p3d_fix_users_trigger_user_id already fixed this once by
 * creating trigger_sync_candidate_search_index_users() (NEW.id) and pointing
 * trg_sync_csi_users at it. 262_schema_drift_class_fix §6 then re-created the
 * generic trigger_sync_candidate_search_index() (NEW.user_id) verbatim AND
 * re-pointed trg_sync_csi_users back at it. On the live DB p3d is already
 * recorded in _migrations, so it never re-runs and the live trigger stays
 * broken: any candidate UPDATE of name/avatar_url — including the
 * delete-account tombstone update in routes/auth.js — aborts with PG 42703
 * (record "new" has no field "user_id").
 *
 * This forward-fix mirrors p3d exactly and is idempotent:
 * - Live DB: 265 is the only unapplied migration, so it repairs the schema
 *   through the normal dev -> staging path.
 * - Fresh install: migrate.js runs files in lexical order, so 265 runs before
 *   p3b/p3d; p3d later re-applies the identical fix last. Final state is
 *   correct either way.
 *
 * The generic trigger_sync_candidate_search_index() is NOT changed: it is
 * correct for candidate_profiles / candidate_skills / candidate_embeddings /
 * omni_scores, whose rows carry user_id.
 */

module.exports = {
	name: '265_fix_users_search_trigger',
	up: async (client) => {
		// Dedicated trigger function for the users table (uses NEW.id)
		await client.query(`
      CREATE OR REPLACE FUNCTION trigger_sync_candidate_search_index_users()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM sync_candidate_search_index(NEW.id);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

		// Re-point the users trigger at the correct function
		await client.query(`
      DROP TRIGGER IF EXISTS trg_sync_csi_users ON users;
      CREATE TRIGGER trg_sync_csi_users
        AFTER UPDATE OF name, avatar_url ON users
        FOR EACH ROW
        WHEN (NEW.role = 'candidate')
        EXECUTE FUNCTION trigger_sync_candidate_search_index_users();
    `);

		console.log('Migration 265 completed: users search-index trigger uses NEW.id');
	},
};
