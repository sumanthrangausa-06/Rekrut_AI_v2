// =============================================================================
// Migration 260: threat_intel_checks (#807, S-090 threat-intel chassis)
// =============================================================================
//
// The dark chassis store: one row per threat-intel check recorded
// against a job application, with provenance. Nothing reads this
// table in this story — there is no route, no read API, and no
// recruiter- or candidate-facing surface (recruiter visibility for
// ANY signal is gated on the #788 determination). The pipeline is
// lib/threatIntelChecks.js; the dark flag is OFF by default.
//
// Tier split (STOP 1 §3a — the classification exists so a future
// counsel-set metadata period can be implemented as a behaviour
// change with NO schema change):
//   PAYLOAD tier (the observation itself; dies at erasure):
//     subject_fingerprint, signal_payload
//   AUDIT-METADATA tier (what was checked, when, by which source):
//     id, source, checked_at, sources_checked, sources_failed,
//     severity, company_id, job_application_id, created_at
// Retention default (Lex consult, #807 — CONFIRMED): the WHOLE row,
// both tiers together, follows the parent application's lifecycle.
// Erasure is the explicit, counted DELETE in erasePersonalData()
// (lib/erasureService.js, #813 C2 position, keyed by the #780 unheld
// application set). No separate retention period is adopted and no
// purge is built.
//
// Column notes:
//   - job_application_id: FK with NO cascade action, deliberately.
//     The parent job_applications row is retained as a skeleton
//     (#780), so a cascade could never fire — and an uncounted
//     cascade would be an unprovable erasure. The explicit counted
//     DELETE is the only erasure branch.
//   - company_id: denormalised from the application row at record
//     time (never caller-asserted) — it scopes the row and keys the
//     fingerprint silo. Nullable because legacy application rows can
//     carry a NULL company: a subject-bearing check on such an
//     application is REFUSED at the app layer (privacy C3), while a
//     subject-less provenance row may still record with a NULL
//     company_id and a NULL fingerprint.
//   - severity: equality CHECK (severity = 'info') — the S-084
//     interim guardrail encoded, not assumed. Raising the cap
//     requires a migration, never an app/config change alone.
//   - subject_fingerprint: company-siloed HMAC-SHA256 hex (see
//     lib/threatIntelChecks.js header for the honest limits: this is
//     pseudonymisation — the value remains personal data, and
//     low-entropy subjects can be reversed by recomputation by any
//     holder of the fingerprint secret). The format CHECK makes a
//     raw identifier in this column impossible at the DB layer, not
//     merely unplanned (security C3). Never a raw identifier: there
//     are no email / IP / phone / name columns anywhere in this
//     table.
//   - source vs sources_checked: `source` is the provider that
//     produced this observation; sources_checked / sources_failed
//     list every provider consulted for it (app-validated against
//     the provider registry — the registry ships empty).
//   - checked_at vs created_at: checked_at is the provenance instant
//     the check ran; created_at is the row's creation instant. In
//     this synchronous lib pipeline they coincide; they are kept
//     distinct because a future asynchronous provider's check time
//     and record time can differ, and provenance must name the
//     check, not the insert.
//
// Idempotent (IF NOT EXISTS throughout) and run inside migrate.js's
// per-migration transaction, per house pattern.
// =============================================================================

module.exports = {
	name: '260_threat_intel_checks',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS threat_intel_checks (
				id                 SERIAL PRIMARY KEY,
				job_application_id INTEGER NOT NULL REFERENCES job_applications(id),
				company_id         INTEGER,
				source             TEXT NOT NULL,
				checked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				severity           TEXT NOT NULL DEFAULT 'info' CHECK (severity = 'info'),
				subject_fingerprint TEXT NULL CHECK (subject_fingerprint IS NULL OR subject_fingerprint ~ '^[0-9a-f]{64}$'),
				signal_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
				sources_checked    TEXT[] NOT NULL DEFAULT '{}',
				sources_failed     TEXT[] NOT NULL DEFAULT '{}',
				created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_threat_intel_checks_application
			ON threat_intel_checks(job_application_id);
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_threat_intel_checks_company_fingerprint
			ON threat_intel_checks(company_id, subject_fingerprint);
		`);

		console.log('Migration 260: threat_intel_checks created (dark chassis, #807)');
	},
};
