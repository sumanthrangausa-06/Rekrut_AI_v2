// Migration: Add user_settings table for unified settings endpoint
// Fixes: GitHub issue #18 — Settings notifications API missing

async function up(client) {
	await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        notifications JSONB NOT NULL DEFAULT '{
          "email_jobs": true,
          "email_applications": true,
          "email_messages": true,
          "email_marketing": false,
          "push_jobs": true,
          "push_messages": true,
          "push_reminders": true
        }',
        privacy JSONB NOT NULL DEFAULT '{
          "profile_visible": true,
          "allow_messages": true,
          "share_analytics": false
        }',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

	// Add updated_at trigger
	await client.query(`
      CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

	await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'user_settings_updated_at'
        ) THEN
          CREATE TRIGGER user_settings_updated_at
            BEFORE UPDATE ON user_settings
            FOR EACH ROW
            EXECUTE FUNCTION update_user_settings_updated_at();
        END IF;
      END $$;
    `);

	console.log('[migration 060] user_settings table created');
}

async function down(client) {
	await client.query('DROP TABLE IF EXISTS user_settings CASCADE');
	console.log('[migration 060] user_settings table dropped');
}

module.exports = { up, down };
