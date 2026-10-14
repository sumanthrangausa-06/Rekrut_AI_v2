// =============================================================================
// Migration 258: legal holds (G-1, #799)
// =============================================================================
//
// Rex's verified design (issue #799, 2026-10-13T17:07Z): the hold seam
// already exists as a stub — isLegalHoldActive({candidateId, sessionId})
// in lib/observerCapture.js — already consulted per-artefact by the
// capture purges and two euComplianceService purges. This migration
// creates the table the real implementation (lib/legalHold.js) reads;
// the build replaces the stub body, it does not invent a second check.
//
// Shape (per the verified design): subject is a user and/or a company;
// set_by / reason / set_at; released_by / released_at. A hold is ACTIVE
// while released_at IS NULL. Release is a stamp, never a delete — the
// row is the audit evidence that the hold existed.
//
// Deliberately NO foreign keys: a hold is legal evidence and must not
// cascade away if a user/company row is ever removed, and erasure of a
// held subject is blocked by the hold itself (lib/erasureService.js
// entry guard), so no dangling-subject state can arise through the app.
//
// Safety: CREATE TABLE / INDEX IF NOT EXISTS (idempotent, 257 pattern).
// =============================================================================

async function up(client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS legal_holds (
			id SERIAL PRIMARY KEY,
			user_id INTEGER,
			company_id INTEGER,
			reason TEXT NOT NULL,
			set_by TEXT NOT NULL,
			set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			released_by TEXT,
			released_at TIMESTAMPTZ,
			CHECK (user_id IS NOT NULL OR company_id IS NOT NULL)
		)
	`);
	// Active-hold lookups are the hot path (every purge row consults
	// them); partial indexes cover exactly the unreleased rows.
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_legal_holds_active_user
		ON legal_holds(user_id) WHERE released_at IS NULL
	`);
	await client.query(`
		CREATE INDEX IF NOT EXISTS idx_legal_holds_active_company
		ON legal_holds(company_id) WHERE released_at IS NULL
	`);

	console.log('Migration 258: legal_holds table done');
}

async function down(client) {
	await client.query(`DROP TABLE IF EXISTS legal_holds`);
}

module.exports = { up, down };
