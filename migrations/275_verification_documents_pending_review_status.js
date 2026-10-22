// =============================================================================
// Migration 275: allow 'pending_review' in the verification_documents
// status CHECKs (#1610)
// =============================================================================
//
// Root cause (#1610; Lead filing + Nova STOP 1 verification on dev
// f77dba9b7): services/document-verification.js verifyDocument has written
//   const documentStatus = fraudRisk === 'low' ? 'verified' : 'pending_review';
// since issue #134 — every medium/high-risk verification (and every
// analysis-unavailable one, #1569) UPDATEs verification_documents.status to
// 'pending_review'. But TWO CHECK constraints forbid that value:
//
//   1. chk_verification_documents_status — migrations/047_p2_schema_hardening.js
//      CHECK (status IN ('pending','verified','rejected','expired'))
//   2. chk_verification_docs_status — migrations/p2_schema_hardening.sql:3029
//      CHECK (status IS NULL OR status IN ('pending','verified','rejected','expired'))
//
// Migration 134's section 3 ("Add pending_review status support to
// verification_documents") is a comment only — it never altered either
// constraint, and no later migration widens them (grep-verified across
// migrations/). Nova's RED reproduction on a migrate-only DB built from
// pristine dev proved it live: verifyDocument's exact UPDATE with
// 'pending_review' violates chk_verification_docs_status (the p2 one
// fires), while the 'verified' control succeeds. Readers already treat
// 'pending_review' as a real category — routes/documents.js stats count
// it (:706) and the resubmit lookup queries it (:94) — the schema is the
// only side of the contract that is wrong.
//
// Full vocabulary audit (STOP 1 on #1610): the values ever WRITTEN to
// verification_documents.status are 'pending' (upload INSERTs + resubmit
// UPDATE), 'verified'/'pending_review' (verifyDocument), 'verified'/
// 'rejected' (resolveReview). 'expired' has no writer but is already in
// both CHECKs and counted by candidate stats — it stays. 'flagged'
// (routes/documents.js:179) is an email-template display string only,
// never a DB write, and migration 010 deliberately mapped the old
// 'flagged' DB value to 'rejected' — it is NOT added.
//
// Fix (268/271 pattern, Rex precedent for this defect class): widen-only.
// Find EVERY CHECK on verification_documents whose definition carries the
// status vocabulary (mentions 'status', 'pending' and 'expired') via
// pg_constraint / pg_get_constraintdef, drop each by its real name, then
// re-add ONE canonical constraint with the old list plus 'pending_review'.
// Dropping only 047's named constraint would leave the p2 constraint in
// force and the defect live — the by-definition sweep is the fix, and it
// also converges the duplicate-constraint drift: after 275, exactly one
// status CHECK exists.
//
// Canonical NAME — load-bearing, not cosmetic (this lane's first GREEN
// run proved it): migrate.js sorts migration files lexically, so every
// numbered migration runs BEFORE migrations/p2_schema_hardening.sql.
// p2's verification-documents block is guarded by
//   IF NOT EXISTS (constraint_name = 'chk_verification_docs_status')
// and re-adds its NARROW check whenever that name is absent. The widened
// constraint must therefore carry p2's name — exactly as migration 271
// carries chk_evaluations_evaluator_type, the name p2's evaluator block
// guards on — so on a fresh install p2 sees the name present and skips,
// instead of re-forbidding 'pending_review' behind 275's back. 047's
// name (chk_verification_documents_status) is retired by this migration;
// nothing in code references constraint names.
//
// State-agnostic, idempotent:
//   - State A (both old CHECKs present): both found and dropped.
//   - State B (either/both absent — 047's addConstraint swallows ADD
//     failures, and p2's block is existence-guarded, so live state is
//     unknowable from code): the loop finds what exists; missing ones are
//     a no-op, not an error.
//   - Re-run (record removed): the loop finds the widened CHECK itself
//     (its definition carries the same vocabulary markers) and re-adds an
//     identical one — a safe no-op in effect.
// Both live states converge to exactly one canonical constraint.
//
// Loudness (hard requirement — the swallows that hid this class must NOT
// be repeated): this migration contains NO exception handler anywhere —
// no EXCEPTION block, no try/catch. Any failure propagates through
// migrate.js's per-file transaction: ROLLBACK, exit 1, and the
// _migrations row is NOT written, so the migration is retried on the
// next run instead of being recorded as applied-but-not.
//
// Rollback: migrations never un-apply. Reversing this widening, if ever
// ruled, is a forward-fix migration (276+) — and once verifyDocument has
// run post-275, 'pending_review' rows exist, so in practice that means
// dropping the CHECK entirely or keeping the widened list. A failed 275
// needs no rollback: its transaction already rolled back.
// =============================================================================

module.exports = {
	name: '275_verification_documents_pending_review_status',
	up: async (client) => {
		// 1. Drop every existing status-vocabulary CHECK on
		//    verification_documents, found by definition (migration
		//    268/271 pattern) — never by assumed name or assumed presence.
		//    Both historical constraints match: 047's
		//    chk_verification_documents_status and p2's
		//    chk_verification_docs_status.
		await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'verification_documents'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%status%'
            AND pg_get_constraintdef(oid) LIKE '%pending%'
            AND pg_get_constraintdef(oid) LIKE '%expired%'
        LOOP
          EXECUTE format('ALTER TABLE verification_documents DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END
      $$;
    `);

		// 2. Add the canonical widened constraint: the full pre-existing
		//    list plus 'pending_review'. Expand-only — no value removed.
		//    The name is p2's (chk_verification_docs_status), NOT 047's:
		//    p2 runs after every numbered migration and its
		//    IF NOT EXISTS guard keys on this name (see header).
		await client.query(`
      ALTER TABLE verification_documents
      ADD CONSTRAINT chk_verification_docs_status
      CHECK (status IN ('pending', 'verified', 'rejected', 'expired', 'pending_review'))
    `);
	},
};
