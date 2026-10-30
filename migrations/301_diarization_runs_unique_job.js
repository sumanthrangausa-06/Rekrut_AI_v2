// =============================================================================
// Migration 301: UNIQUE(job_id) on diarization_runs — #1931 item 1
// =============================================================================
//
// Epic #1900 follow-up #1931 (from PR #1930 reviews). Design context:
// Rex Architecture §3.6.4 (run row is the verbatim, once-only record of
// one diarization job's engine output).
//
// WHAT (expand-only — nothing renamed, narrowed, backfilled, or removed):
//   One partial-by-NULL-semantics unique index:
//     ux_diarization_runs_job_id ON diarization_runs(job_id)
//   Postgres UNIQUE treats NULLs as distinct, so the index enforces
//   exactly the intended rule: AT MOST ONE run per non-null job, while
//   any number of job_id IS NULL rows (provenance-less rows) stay legal.
//   A table-level ADD CONSTRAINT UNIQUE would have identical NULL
//   semantics but cannot be created with IF NOT EXISTS; the unique
//   index is the idempotent-safe form in this repo's migration style
//   (migration 296: CREATE INDEX IF NOT EXISTS throughout) and is
//   enforcement-equivalent for INSERT/UPDATE.
//
// WHY: until now the no-duplicate guarantee was application-level only —
// lib/transcriptStitch.js persistStitch checks
// `SELECT 1 FROM diarization_runs WHERE job_id = $1` inside its
// job-locked transaction ("idempotency backstop"). Any future writer
// that bypasses persistStitch could insert a second run for the same
// job. The schema now closes that hole for every writer (proven
// red-first: on the pre-301 schema a direct duplicate INSERT succeeds;
// after this migration it fails with SQLSTATE 23505 — build log,
// docs/sdlc/rekrut-ai-v2/04-implementation/speaker-labelled-transcripts/
// 1931-runs-unique-lockfirst-build-log.md).
//
// EXISTING DUPLICATES: a pre-flight check (database-reviewer MAJOR on
// #1931) fails the migration loudly NAMING every offending job_id and
// its count, before any index build is attempted — diagnosable, not a
// raw duplicate-key error. Deduplicating retained audit output is a
// data decision for a human gate, never something a migration may do
// silently; after that gate, this idempotent migration re-runs clean.
//
// EXECUTION GATE: like migration 296, this executes on the shared Neon
// database only in dev → staging → main promotion order after the
// Nov 1 unfreeze, sequenced by Lead. This file authorizes no live
// execution. DIARIZATION_ENABLED stays OFF.
//
// down(): migrations never un-apply on the shared database (rollback
// is by forward fix only), so down() is intentionally a no-op that
// logs — reversal, if ever needed, is its own approved forward
// migration.
// =============================================================================

module.exports = {
	name: '301_diarization_runs_unique_job',
	up: async (client) => {
		// Pre-flight (database-reviewer MAJOR on #1931): name any
		// pre-existing duplicate non-null job_ids and fail loud BEFORE
		// the index build — remediation is a separate data gate.
		const dups = await client.query(
			`SELECT job_id, COUNT(*)::int AS n FROM diarization_runs
			 WHERE job_id IS NOT NULL
			 GROUP BY job_id HAVING COUNT(*) > 1
			 ORDER BY job_id`,
		);
		if (dups.rows.length > 0) {
			throw new Error(
				`Migration 301 pre-flight failed: diarization_runs already holds duplicate runs for job_id(s) ${dups.rows.map((r) => `${r.job_id} (x${r.n})`).join(', ')} — deduplication is a separate approved data gate; this migration deletes nothing`,
			);
		}

		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS ux_diarization_runs_job_id
			ON diarization_runs(job_id)
		`);

		// Post-state assertion (fail loud, migration 296 pattern;
		// catalogue per database-reviewer MINOR on #1931): a standalone
		// unique index creates no pg_constraint row, so uniqueness is
		// proven on pg_index — indisunique, non-partial, key column
		// exactly job_id — supplemented by the pg_indexes definition.
		const idx = await client.query(
			`SELECT i.indisunique, i.indpred IS NULL AS non_partial, a.attname AS key_column
			 FROM pg_index i
			 JOIN pg_class ic ON ic.oid = i.indexrelid
			 JOIN pg_class tc ON tc.oid = i.indrelid
			 JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(i.indkey)
			 WHERE ic.relname = 'ux_diarization_runs_job_id'
			   AND tc.relname = 'diarization_runs'`,
		);
		if (
			idx.rows.length !== 1 ||
			idx.rows[0].indisunique !== true ||
			idx.rows[0].non_partial !== true ||
			idx.rows[0].key_column !== 'job_id'
		) {
			throw new Error(
				`Migration 301 post-state assertion failed: ux_diarization_runs_job_id unique index on diarization_runs(job_id) not present as expected: ${JSON.stringify(idx.rows)}`,
			);
		}

		console.log(
			'Mig 301: ux_diarization_runs_job_id UNIQUE index added on diarization_runs(job_id) (#1931) — at most one run per non-null job; NULL job_id rows unaffected; expand-only, no rows touched',
		);
	},
	down: async (client) => {
		// No-op by design: migrations never un-apply on the shared DB.
		// Reversal is a separate approved forward migration.
		console.log(
			'Mig 301 down(): no-op — reversal, if needed, is a forward migration (shared-DB rule)',
		);
	},
};
