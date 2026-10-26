// =============================================================================
// Migration 295: DROP DEFAULT on candidate_profiles preference columns (#1889)
// =============================================================================
//
// WHAT: removes the column DEFAULTs (migration 004) from
// candidate_profiles.availability ('immediately'),
// candidate_profiles.remote_preference ('hybrid') and
// candidate_profiles.preferred_job_types ('["full-time"]'), so an INSERT
// that omits a column stores NULL (honest "unanswered") instead of an
// answer nobody gave.
//
// WHY: Sumanth's no-fake-numbers standard + the founder semantics ruled
// on #1631 (2026-10-26): a field the candidate never touched is
// UNANSWERED. These three are the non-completion members of the #1631
// class sweep (filed as #1889): every side-door INSERT that omits them
// (routes/settings.js, routes/candidate.js photo/resume paths,
// routes/candidate-preferences.js) silently wrote an invented
// availability / work-style / job-type preference, which then rendered
// as the candidate's own choice on the profile page, filtered their job
// board (client/src/pages/candidate/jobs.tsx preference filter) and fed
// fit scoring. The invented availability value 'immediately' is not
// even in the profile page's availability vocabulary
// (open / actively_looking / not_looking / available_soon) — the header
// badge rendered the raw invented word.
//
// KEPT BY DECISION (STOP 1 on #1889): preferred_locations keeps its
// DEFAULT '[]' — an empty set renders as nothing and is never presented
// as a candidate's choice, so it does not violate the standard.
//
// SCOPE LIMITS:
// - NO EXISTING ROWS ARE TOUCHED. DROP DEFAULT changes only what future
//   INSERTs that omit the columns will store; it rewrites no data. Rows
//   already carrying invented values stay as they are — healing them is
//   a separate, unapproved data gate, NOT included here.
// - DROP DEFAULT is not a column drop: the columns, their types and all
//   stored values survive unchanged.
//
// down(): restores the original migration-004 defaults. migrate.js never
// calls down(); manual only. Restoring the defaults re-manufactures
// answers for future omitted INSERTs — it changes no existing rows.
// =============================================================================

module.exports = {
	name: '295_candidate_profile_preferences_no_default',
	up: async (client) => {
		await client.query(
			'ALTER TABLE candidate_profiles ALTER COLUMN availability DROP DEFAULT;',
		);
		await client.query(
			'ALTER TABLE candidate_profiles ALTER COLUMN remote_preference DROP DEFAULT;',
		);
		await client.query(
			'ALTER TABLE candidate_profiles ALTER COLUMN preferred_job_types DROP DEFAULT;',
		);

		// Post-state assertion (migration 294 pattern): every column
		// exists and carries no default, so this migration cannot record
		// success over a schema that still manufactures answers.
		const check = await client.query(
			`SELECT column_name, column_default FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'candidate_profiles'
			   AND column_name IN ('availability', 'remote_preference', 'preferred_job_types')`,
		);
		const byName = new Map(check.rows.map((r) => [r.column_name, r.column_default]));
		for (const col of ['availability', 'remote_preference', 'preferred_job_types']) {
			if (!byName.has(col) || byName.get(col) !== null) {
				throw new Error(
					`Migration 295 post-state assertion failed: candidate_profiles.${col} column_default is ${byName.get(col) ?? '<missing column>'}, expected NULL`,
				);
			}
		}

		console.log(
			'Migration 295: DROP DEFAULT applied to candidate_profiles.availability, remote_preference, preferred_job_types (#1889); post-state verified — column_defaults are NULL, no existing rows touched',
		);
	},
	down: async (client) => {
		await client.query(
			"ALTER TABLE candidate_profiles ALTER COLUMN availability SET DEFAULT 'immediately';",
		);
		await client.query(
			"ALTER TABLE candidate_profiles ALTER COLUMN remote_preference SET DEFAULT 'hybrid';",
		);
		await client.query(
			'ALTER TABLE candidate_profiles ALTER COLUMN preferred_job_types SET DEFAULT \'["full-time"]\'::jsonb;',
		);
		console.log(
			'Migration 295 down(): candidate_profiles preference defaults restored (migration 004 state)',
		);
	},
};
