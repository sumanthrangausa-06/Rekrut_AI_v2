/**
 * Migration p3d: Fix trg_sync_csi_users trigger — use NEW.id not NEW.user_id
 *
 * The trigger_sync_candidate_search_index() function references NEW.user_id,
 * which is correct for the omni_scores table but wrong for the users table
 * (which has `id`, not `user_id`). Any UPDATE to users (e.g. Google OAuth
 * profile sync) fires the trigger and PostgreSQL throws 42703:
 *   record "new" has no field "user_id"
 *
 * This creates a dedicated trigger function for the users table.
 */

module.exports = {
	name: 'p3d_fix_users_trigger_user_id',
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

		console.log('Migration p3d completed: users search-index trigger uses NEW.id');
	},
};
