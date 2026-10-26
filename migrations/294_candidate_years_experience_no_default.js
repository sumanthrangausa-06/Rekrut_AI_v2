// =============================================================================
// Migration 294: DROP DEFAULT on candidate_profiles.years_experience (#1631)
// =============================================================================
//
// WHAT: removes the column DEFAULT 0 (migration 004) from
// candidate_profiles.years_experience, so an INSERT that omits the column
// stores NULL (honest "unanswered") instead of a 0 nobody gave.
//
// WHY: Sumanth's no-fake-numbers standard + founder semantics on #1631
// (2026-10-26): a field the candidate never touched is UNANSWERED — it
// earns no profile-completion credit and stays in the completion nudge.
// Explicit 0 = 'No experience' is a REAL answer that counts. The 12-field
// completion formula (client/src/lib/profile-completion.ts + its server
// mirror in GET /candidate/dashboard/stats) already counts
// `years_experience != null` — correct once the data is honest. The defect
// was the manufactured value: every side-door INSERT that omits the
// column (routes/candidate.js photo/resume, routes/settings.js,
// routes/candidate-preferences.js) silently wrote 0.
//
// SCOPE LIMITS:
// - NO EXISTING ROWS ARE TOUCHED. DROP DEFAULT changes only what future
//   INSERTs that omit the column will store; it rewrites no data. Rows
//   already carrying a manufactured 0 stay 0 — healing them is a
//   separate, unapproved data gate, NOT included here.
// - DROP DEFAULT is not a column drop: the column, its type and all
//   stored values survive unchanged.
//
// down(): restores the original DEFAULT 0 (migration 004). migrate.js
// never calls down(); manual only. Restoring the default re-manufactures
// 0s for future omitted INSERTs — it changes no existing rows either.
// =============================================================================

module.exports = {
	name: '294_candidate_years_experience_no_default',
	up: async (client) => {
		await client.query(
			'ALTER TABLE candidate_profiles ALTER COLUMN years_experience DROP DEFAULT;',
		);

		// Post-state assertion (migration 290 pattern): the column exists
		// and carries no default, so this migration cannot record success
		// over a schema that still manufactures 0.
		const check = await client.query(
			`SELECT column_default FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'candidate_profiles'
			   AND column_name = 'years_experience'`,
		);
		if (check.rows.length !== 1 || check.rows[0].column_default !== null) {
			throw new Error(
				`Migration 294 post-state assertion failed: candidate_profiles.years_experience column_default is ${check.rows[0]?.column_default ?? '<missing column>'}, expected NULL`,
			);
		}

		console.log(
			'Migration 294: DROP DEFAULT applied to candidate_profiles.years_experience (#1631); post-state verified — column_default is NULL, no existing rows touched',
		);
	},
	down: async (client) => {
		await client.query(
			'ALTER TABLE candidate_profiles ALTER COLUMN years_experience SET DEFAULT 0;',
		);
		console.log(
			'Migration 294 down(): candidate_profiles.years_experience DEFAULT 0 restored (migration 004 state)',
		);
	},
};
