/**
 * Migration 253: recording_objects registry for retention lifecycle (S-077 #760).
 *
 * The unified interview engine's storage objects (.enc recordings, .bin frames)
 * had no expiry tracking — the #743 design spike found active Art. 5(1)(e)
 * exposure. This registry gives the purge cron an indexed expires_at sweep
 * instead of JSONB full-table scans.
 *
 * Also aligns data_retention_policies with enforced behavior (compliance-auditor
 * finding): interview_recordings was 730d in the policy table but 90d enforced.
 */
module.exports = {
	up: async (client) => {
		await client.query(`
      CREATE TABLE IF NOT EXISTS recording_objects (
        object_key TEXT PRIMARY KEY,
        interview_id INTEGER,
        candidate_id INTEGER,
        object_type VARCHAR(20) NOT NULL CHECK (object_type IN ('frame', 'recording')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        deleted_at TIMESTAMP WITH TIME ZONE
      )
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recording_objects_expires
      ON recording_objects (expires_at)
      WHERE deleted_at IS NULL
    `);

		// Single source of truth (compliance-auditor): align stale 730d policy
		// row with the 90d actually enforced by purgeExpiredRecordings().
		await client.query(`
      UPDATE data_retention_policies
      SET retention_days = 90,
          description = 'Delete interview recordings after 90 days (aligned with enforced retention_expires_at)',
          updated_at = NOW()
      WHERE data_type = 'interview_recordings' AND retention_days = 730
    `);

		// Policy rows for the registry-driven lifecycle.
		await client.query(`
      INSERT INTO data_retention_policies (data_type, retention_days, auto_delete, description)
      VALUES
        ('vision_frames', 30, true, 'Delete encrypted vision frames 30 days post-capture (S-077)'),
        ('unified_recordings', 90, true, 'Delete unified-engine recordings 90 days post-session (S-077)')
      ON CONFLICT (data_type) DO NOTHING
    `);
	},

	down: async (client) => {
		await client.query(`DROP INDEX IF EXISTS idx_recording_objects_expires`);
		await client.query(`DROP TABLE IF EXISTS recording_objects`);
		// Policy rows left in place on rollback (data fix, not schema).
	},
};
