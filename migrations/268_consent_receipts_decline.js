// =============================================================================
// Migration 268: consent_receipts ordering CHECK — allow recorded declines (#1315)
// =============================================================================
//
// Root cause (#1306 / #1315): migration 244 created the consent_receipts
// ordering CHECK as
//   CHECK (withdrawn_at IS NULL OR (granted_at IS NOT NULL AND withdrawn_at >= granted_at))
// which requires granted_at NOT NULL whenever withdrawn_at is set.
// lib/consentService.js recordConsent writes a DECLINE honestly as
// granted_at NULL / withdrawn_at = now (a decline is not a grant, so no
// grant timestamp may be fabricated) — so a decline could never be stored
// at all. Quinn's E2E-on-dev run on #1306/#1315 proved it live: every
// decline insert violated the CHECK, leaving a compliance evidence hole —
// the audit trail had no record of candidates who said no.
//
// Sumanth ruled Option 1 on #1306 (2026-10-17): declines are recorded just
// like consents — relax this CHECK by migration; the falsified-granted_at
// code-only workaround was refused.
//
// Semantics of a decline row: granted_at NULL + withdrawn_at = the decline
// instant. It is an honest record of a refusal, never a fabricated grant,
// and reader logic (granted = granted_at set AND withdrawn_at unset) is
// unchanged.
//
// Fix, widen-only: find the ordering CHECK on consent_receipts BY ITS
// DEFINITION via pg_constraint / pg_get_constraintdef — it is the CHECK
// whose definition contains both 'withdrawn_at' and 'granted_at' AND '>='
// (that '>=' distinguishes it from the companion check
// (granted_at IS NOT NULL OR withdrawn_at IS NOT NULL), which contains
// both column names but no '>=', and which must stay untouched) — drop it
// if found, then re-add it so a decline (granted_at NULL) is admissible
// while every nonsense state stays blocked: (NULL, NULL) is still
// rejected by the untouched companion check, and withdrawn_at earlier
// than granted_at is still rejected here. No table/column drops, no data
// change. Idempotent: re-running drops the (possibly already widened)
// CHECK — it still matches the definition pattern — and re-adds the
// same constraint. Fresh installs: migrate.js runs files in lexical
// order, so 268 runs after 244 (table creation).
//
// Hardening (#1318, ecc/database-reviewer on PR #1316): discover-by-
// definition was fail-SILENT — pg_get_constraintdef renders the stored
// expression tree and does not canonicalise comparison direction, so a
// logically identical re-spelling (e.g. granted_at <= withdrawn_at)
// matches 0 rows, nothing was dropped, the widened ADD succeeded
// alongside the old CHECK, and the migration recorded as applied while
// declines still failed. Now fail-LOUD, in three layers:
//   1. Loop-drop EVERY constraint matching the discovery pattern (a
//      single SELECT INTO silently picks an arbitrary row when the
//      duplicate state it should prevent is already present).
//   2. RAISE if zero ordering CHECKs matched — keyed on "none at all",
//      never on old-vs-new shape (the widened def also matches the
//      pattern, so re-runs stay idempotent).
//   3. Post-ADD assertion on final state: among consent_receipts CHECKs
//      naming both columns AND carrying a comparison operator (broader
//      than discovery — spelling-agnostic), exactly one may exist and it
//      must be the widened shape (its def contains 'granted_at IS NULL',
//      which the old shape's 'granted_at IS NOT NULL' does not contain
//      as a substring). migrate.js wraps up() + the _migrations insert
//      in one transaction, so a RAISE rolls back and records nothing.
// Migration 269 repairs DBs that already ran the pre-hardening 268.
// =============================================================================

module.exports = {
	name: '268_consent_receipts_decline',
	up: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
        found INT := 0;
      BEGIN
        -- Match the ordering CHECK by its definition: only this constraint
        -- on consent_receipts contains 'withdrawn_at', 'granted_at' AND
        -- '>=' (the companion NOT-NULL check has no '>=').
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'consent_receipts'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%withdrawn_at%'
            AND pg_get_constraintdef(oid) LIKE '%granted_at%'
            AND pg_get_constraintdef(oid) LIKE '%>=%'
        LOOP
          EXECUTE format('ALTER TABLE consent_receipts DROP CONSTRAINT %I', r.conname);
          found := found + 1;
        END LOOP;
        -- Fail loud (#1318): zero matches means the live definition does
        -- not render as expected — abort instead of adding the widened
        -- CHECK alongside an undropped old one.
        IF found = 0 THEN
          RAISE EXCEPTION '268_consent_receipts_decline: no consent_receipts ordering CHECK matched the discovery pattern (withdrawn_at + granted_at + >=) — definition drift suspected, aborting';
        END IF;
      END
      $$;
    `);

		await client.query(`
      ALTER TABLE consent_receipts
        ADD CONSTRAINT consent_receipts_withdrawn_after_grant
        CHECK (withdrawn_at IS NULL OR granted_at IS NULL OR withdrawn_at >= granted_at)
    `);

		await client.query(`
      DO $$
      DECLARE
        widened INT;
        old_shape INT;
      BEGIN
        -- Post-state assertion (#1318): exactly one ordering CHECK, and it
        -- must be the widened shape. The operator filter (any of >, <)
        -- is deliberately broader than the discovery pattern so a
        -- re-spelled old CHECK cannot survive unnoticed; the companion
        -- NOT-NULL check carries no operator and is excluded.
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
          RAISE EXCEPTION '268_consent_receipts_decline post-state: expected exactly 1 widened ordering CHECK and 0 old-shape, got widened=% old_shape=%', widened, old_shape;
        END IF;
      END
      $$;
    `);

		console.log(
			'Migration 268: consent_receipts ordering CHECK now allows recorded declines (granted_at NULL, withdrawn_at set) (#1315)',
		);
	},
};
