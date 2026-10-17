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
// =============================================================================

module.exports = {
	name: '268_consent_receipts_decline',
	up: async (client) => {
		await client.query(`
      DO $$
      DECLARE
        chk_name TEXT;
      BEGIN
        -- Match the ordering CHECK by its definition: only this constraint
        -- on consent_receipts contains 'withdrawn_at', 'granted_at' AND
        -- '>=' (the companion NOT-NULL check has no '>=').
        SELECT conname INTO chk_name
        FROM pg_constraint
        WHERE conrelid = 'consent_receipts'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%withdrawn_at%'
          AND pg_get_constraintdef(oid) LIKE '%granted_at%'
          AND pg_get_constraintdef(oid) LIKE '%>=%';
        IF chk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE consent_receipts DROP CONSTRAINT %I', chk_name);
        END IF;
      END
      $$;
    `);

		await client.query(`
      ALTER TABLE consent_receipts
        ADD CONSTRAINT consent_receipts_withdrawn_after_grant
        CHECK (withdrawn_at IS NULL OR granted_at IS NULL OR withdrawn_at >= granted_at)
    `);

		console.log(
			'Migration 268: consent_receipts ordering CHECK now allows recorded declines (granted_at NULL, withdrawn_at set) (#1315)',
		);
	},
};
