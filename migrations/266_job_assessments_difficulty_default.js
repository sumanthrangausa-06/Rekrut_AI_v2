// =============================================================================
// Migration 266: job_assessments.difficulty_level default 'auto' -> 'medium' (#1164)
// =============================================================================
//
// Migration 042 created the column as VARCHAR(20) DEFAULT 'auto' (type later
// widened to text by p2 hardening, default unchanged), and migration 047
// added chk_job_assessments_difficulty CHECK (difficulty_level IN
// ('easy','medium','mid','hard')). Postgres does not validate a DEFAULT
// against a CHECK at DDL time, so the schema builds — but any INSERT that
// omits difficulty_level materialises 'auto' and fails the CHECK. The
// column's own default is un-insertable.
//
// Which side is wrong was decided by a full code read (STOP 1, issue #1164):
// - The only INSERT INTO job_assessments (routes/assessments.js) always
//   supplies difficulty_level explicitly, mapped at the call site with the
//   comment "Map experience level to valid difficulty_level for DB
//   constraint (easy/medium/mid/hard)":
//   { junior: 'easy', mid: 'medium', senior: 'hard' }[targetLevel] || 'medium'.
//   It never writes 'auto' and never relies on the default.
// - No reader (server or client), seed, or AI generation path writes,
//   expects, or branches on 'auto'; the only 'auto' tied to this column in
//   the source tree is the 042 default itself. 'auto' is not a product
//   state, so the CHECK is NOT widened — the default is the wrong side.
//
// New default 'medium': CHECK-valid, the writer's own fallback
// (|| 'medium'), and the neutral middle — matching the neighbouring
// middle defaults job_assessment_questions.difficulty_level DEFAULT 3 and
// job_assessment_attempts.current_difficulty DEFAULT 3 (of 1-5).
//
// Existing rows need no data fix: with the CHECK in place, no 'auto' row
// can exist. SET DEFAULT is idempotent (re-running sets the same default)
// and mirrors migration 259's one-statement style.
// =============================================================================

module.exports = {
	name: '266_job_assessments_difficulty_default',
	async up(client) {
		await client.query(
			`ALTER TABLE job_assessments ALTER COLUMN difficulty_level SET DEFAULT 'medium';`,
		);

		console.log(
			"Migration 266: job_assessments.difficulty_level default is now 'medium' (was 'auto', which violated chk_job_assessments_difficulty)",
		);
	},
};
