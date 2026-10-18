// =============================================================================
// Migration 269: repair DBs where the pre-hardening 268 silently failed (#1318)
// =============================================================================
//
// Migration 268 originally discovered the consent_receipts ordering CHECK
// by its pg_get_constraintdef rendering ('%withdrawn_at%' + '%granted_at%'
// + '%>=%'). If the live definition was spelled differently (e.g. the
// logically identical granted_at <= withdrawn_at), the match found 0
// rows, nothing was dropped, the widened CHECK was added alongside the
// old one, and 268 recorded as applied — declines still violated a CHECK,
// silently. 268 is now hardened in place (fail-loud), but DBs that
// already ran the original 268 (local / QA) never re-run it.
//
// This migration verifies and repairs that post-state. It is asymmetric
// to 268 by design:
//   - NO raise on zero old-shape matches: zero is the healthy state.
//   - Loop-drop only OLD-SHAPE ordering CHECKs (both timestamp columns +
//     a comparison operator + NOT the widened shape).
//   - Add the widened CHECK only if absent (healthy DB = pure no-op).
//   - Same post-state assertion as hardened 268: exactly one ordering
//     CHECK and it must be the widened shape (def contains
//     'granted_at IS NULL'). The companion check
//     (granted_at IS NOT NULL OR withdrawn_at IS NOT NULL) carries no
//     comparison operator and is never touched.
// On staging/production, hardened 268 runs first in the same migrate.js
// pass; if its assertion raises, the run aborts before 269 ever executes.
// =============================================================================

module.exports = {
	name: '269_consent_receipts_decline_repair',
	up: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        -- Drop old-shape ordering CHECKs only: the widened shape is
        -- identified by 'granted_at IS NULL' in its definition (absent
        -- from the old shape, whose 'granted_at IS NOT NULL' does not
        -- contain that substring).
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'consent_receipts'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%withdrawn_at%'
            AND pg_get_constraintdef(oid) LIKE '%granted_at%'
            AND (pg_get_constraintdef(oid) LIKE '%>%' OR pg_get_constraintdef(oid) LIKE '%<%')
            AND pg_get_constraintdef(oid) NOT LIKE '%granted_at IS NULL%'
        LOOP
          EXECUTE format('ALTER TABLE consent_receipts DROP CONSTRAINT %I', r.conname);
        END LOOP;

        -- Add the widened CHECK only if no widened ordering CHECK exists.
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'consent_receipts'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%withdrawn_at%'
            AND pg_get_constraintdef(oid) LIKE '%granted_at%'
            AND pg_get_constraintdef(oid) LIKE '%granted_at IS NULL%'
        ) THEN
          ALTER TABLE consent_receipts
            ADD CONSTRAINT consent_receipts_withdrawn_after_grant
            CHECK (withdrawn_at IS NULL OR granted_at IS NULL OR withdrawn_at >= granted_at);
        END IF;
      END
      $$;
    `);

		await client.query(`
      DO $$
      DECLARE
        widened INT;
        old_shape INT;
      BEGIN
        SELECT
          count(*) FILTER (WHERE def LIKE '%granted_at IS NULL%'),
          count(*) FILTER (WHERE def NOT LIKE '%granted_at IS NULL%')
        INTO widened, old_shape
        FROM (
          SELECT pg_get_constraintdef(oid) AS def
          FROM pg_constraint
          WHERE conrelid = 'consent_receipts'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%withdrawn_at%'
            AND pg_get_constraintdef(oid) LIKE '%granted_at%'
            AND (pg_get_constraintdef(oid) LIKE '%>%' OR pg_get_constraintdef(oid) LIKE '%<%')
        ) s;
        IF widened <> 1 OR old_shape <> 0 THEN
          RAISE EXCEPTION '269_consent_receipts_decline_repair post-state: expected exactly 1 widened ordering CHECK and 0 old-shape, got widened=% old_shape=%', widened, old_shape;
        END IF;
      END
      $$;
    `);

		console.log(
			'Migration 269: consent_receipts ordering CHECK post-state verified/repaired (#1318)',
		);
	},
};
