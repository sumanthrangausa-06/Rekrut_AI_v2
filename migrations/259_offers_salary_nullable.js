// =============================================================================
// Migration 259: offers.salary nullable (#1123 GAP-D, PR-gate fix P-1)
// =============================================================================
//
// Migration 014 defined offers.salary as DECIMAL(10,2) NOT NULL and no
// later migration relaxed it. The ruled #1123 Q6 offers skeleton
// (redact-to-skeleton in lib/erasureService.js) sets salary = NULL —
// on a real database that UPDATE violates the NOT NULL constraint and,
// because both erasure callers wrap erasePersonalData in
// BEGIN/ROLLBACK, aborts the candidate's ENTIRE erasure. This migration
// relaxes exactly that one constraint so the ruled skeleton can
// execute. DROP NOT NULL is idempotent in Postgres (no-op when the
// column is already nullable; migration-130 pattern).
//
// The ruled skeleton NULL set is unchanged — no sentinel value, no
// scope change. Nothing else is altered by this migration.
// =============================================================================

module.exports = {
	name: '259_offers_salary_nullable',
	async up(client) {
		await client.query(`ALTER TABLE offers ALTER COLUMN salary DROP NOT NULL;`);

		console.log('Migration 259: offers.salary is now nullable');
	},
};
