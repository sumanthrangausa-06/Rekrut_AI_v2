/**
 * Migration 254 — PG18 not-null pseudo-CHECK regression (#1329).
 *
 * Sibling of #1155 (migration 257, PR #1331). Root cause: on
 * PostgreSQL 18 a NOT NULL constraint is a first-class catalog
 * constraint (pg_constraint contype 'n'), and the SQL standard treats
 * not-null as a check constraint, so information_schema views surface
 * it with constraint_type 'CHECK'. Its default name is
 * <table>_<column>_not_null — migration 129 defines entity_type as a
 * NOT NULL column on compliance_audit_trail, so the old lookup
 *   SELECT ... FROM information_schema.table_constraints
 *   WHERE constraint_type='CHECK' AND constraint_name LIKE '%entity_type%'
 *   LIMIT 1            -- no ORDER BY: either matching row may win
 * can select compliance_audit_trail_entity_type_not_null, drop the
 * NOT NULL itself, and then collide on the re-add of the genuine
 * CHECK (compliance_audit_trail_entity_type_check already exists).
 *
 * The genuine-CHECK discriminator is pg_constraint.contype = 'c'.
 *
 * HOW THIS TEST WORKS: same method as the 257 regression test — it
 * runs the REAL migration up() against a recording mock client,
 * captures the actual lookup SQL the migration emits, and evaluates
 * that SQL's selection rule over a PG18-shaped catalog fixture
 * (pseudo-CHECK first — the adverse order). If the lookup ever
 * regresses to the information_schema/LIKE-only rule, the captured
 * SQL changes, the emulation selects the pseudo-CHECK, and this
 * test fails.
 *
 * LIVE PROOF (Nova, 2026-10-17, real PostgreSQL 18.6 server, full
 * transcript on #1329 / the PR): with a predecessor schema whose
 * NOT NULL column predates the genuine CHECK (added later via
 * ALTER), the OLD helper's verbatim SELECT returns
 * compliance_audit_trail_entity_type_not_null and the OLD up()
 * fails with: constraint "compliance_audit_trail_entity_type_check"
 * for relation "compliance_audit_trail" already exists — and the
 * NOT NULL is gone (attnotnull=false, NULL insert accepted). The
 * NEW up() succeeds on the same schema and on the real 129→254
 * segment: 'retention_purge' is accepted, NULL and bogus values
 * are rejected, and entity_type stays NOT NULL.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'254_compliance_audit_retention_purge.js',
);

// PG18-shaped catalog: genuine CHECK (contype 'c') + NOT NULL
// pseudo-CHECK (contype 'n') whose name contains the LIKE fragment.
const CATALOG = {
	compliance_audit_trail: [
		{ conname: 'compliance_audit_trail_entity_type_not_null', contype: 'n' },
		{ conname: 'compliance_audit_trail_entity_type_check', contype: 'c' },
		{ conname: 'compliance_audit_trail_pkey', contype: 'p' },
	],
};

/**
 * Evaluate the selection rule expressed by one captured DO block over
 * the fixture catalog, the way PostgreSQL would:
 * - information_schema.table_constraints with constraint_type='CHECK'
 *   on PG18 returns contype 'c' AND 'n' rows (see header).
 * - pg_constraint filtered by contype='c' returns only genuine CHECKs.
 * LIKE '%frag%' + LIMIT 1 (no ORDER BY) => first matching row wins.
 */
function selectConstraint(doSql) {
	const table = doSql.match(/ALTER TABLE (\w+) DROP CONSTRAINT/)?.[1]
		|| doSql.match(/table_name = '(\w+)'/)?.[1]
		|| doSql.match(/relname = '(\w+)'/)?.[1];
	const fragment = doSql.match(/LIKE '%([^%]*)%'/)?.[1];
	const rows = CATALOG[table];
	if (!rows || !fragment) return { table, fragment, selected: null };

	let candidates;
	if (/pg_constraint/.test(doSql) && /contype\s*=\s*'c'/.test(doSql)) {
		candidates = rows.filter((r) => r.contype === 'c');
	} else if (/information_schema\.table_constraints/.test(doSql)) {
		// PG18 information_schema 'CHECK' view: 'c' and 'n' both surface.
		candidates = rows.filter((r) => r.contype === 'c' || r.contype === 'n');
	} else {
		candidates = rows;
	}
	const hit = candidates.find((r) => r.conname.includes(fragment));
	return { table, fragment, selected: hit ? hit.conname : null };
}

describe('254 constraint lookup — PG18 not-null pseudo-CHECK (#1329)', () => {
	let src;
	let migration;
	let doBlocks;

	beforeAll(async () => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
		const queries = [];
		const client = {
			query: jest.fn(async (sql) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 0 };
			}),
		};
		await migration.up(client);
		doBlocks = queries.filter((q) => q.includes('DROP CONSTRAINT'));
	});

	test('lookup queries pg_constraint restricted to genuine CHECKs (contype = \'c\'), not information_schema', () => {
		expect(src).toMatch(/pg_constraint/);
		expect(src).toMatch(/contype\s*=\s*'c'/);
		// Scoped to up(): the header comment legitimately mentions
		// information_schema when explaining the defect (#1329).
		const upBody = src.slice(src.indexOf('async function up'));
		expect(upBody).not.toMatch(/information_schema/);
	});

	test('up() emits exactly 1 drop-by-name block, restricted to genuine CHECKs', () => {
		expect(doBlocks).toHaveLength(1);
		expect(doBlocks[0]).toMatch(/pg_constraint/);
		expect(doBlocks[0]).toMatch(/contype\s*=\s*'c'/);
	});

	test('selection picks the genuine CHECK, never the PG18 not-null pseudo-CHECK', () => {
		const { selected } = selectConstraint(doBlocks[0]);
		expect(selected).toBe('compliance_audit_trail_entity_type_check');
		expect(selected).not.toMatch(/_not_null$/);
	});
});
