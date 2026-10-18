/**
 * Migration 257 — PG18 not-null pseudo-CHECK regression (#1155).
 *
 * Root cause: on PostgreSQL 18 a NOT NULL constraint is a first-class
 * catalog constraint (pg_constraint contype 'n'), and the SQL standard
 * treats not-null as a check constraint, so information_schema views
 * surface it with constraint_type 'CHECK' (PG18 docs, information_schema
 * check_constraints: "notnull constraints are also included here").
 * Its default name is <table>_<column>_not_null — for migration 257's
 * call sites the column IS the LIKE fragment (object_type is a NOT NULL
 * column on recording_objects; consent_type likewise on consent_texts /
 * consent_receipts), so the old helper
 *   SELECT ... FROM information_schema.table_constraints
 *   WHERE constraint_type='CHECK' AND constraint_name LIKE '%<fragment>%'
 *   LIMIT 1            -- no ORDER BY: either matching row may win
 * can select the pseudo-CHECK and drop / halt on the wrong constraint
 * (observed halting the fresh chain on PG 18.6, PR #1153 gate dry-run).
 *
 * The genuine-CHECK discriminator is pg_constraint.contype = 'c'.
 *
 * HOW THIS TEST WORKS: it runs the REAL migration up() against a
 * recording mock client, captures the actual dropCheckByName SQL the
 * migration emits, and evaluates that SQL's selection rule over a
 * PG18-shaped catalog fixture (rows below, pseudo-CHECK first — the
 * adverse order). If the helper ever regresses to the
 * information_schema/LIKE-only rule, the captured SQL changes, the
 * emulation selects the pseudo-CHECK, and this test fails.
 *
 * LIVE PROOF (Nova, 2026-10-17, real PostgreSQL 18.6 server, full
 * transcript on #1155 / the PR): with predecessor tables whose NOT NULL
 * column predates the genuine CHECK (added later via ALTER), the OLD
 * helper's verbatim SELECT returns consent_texts_consent_type_not_null
 * and the OLD up() fails with: constraint
 * "recording_objects_object_type_check" for relation
 * "recording_objects" already exists. The NEW up() succeeds on the
 * same schema, the widened CHECK accepts 'observer_capture', and
 * consent_type stays NOT NULL. With the CHECK created inline the old
 * code happened to pick the genuine row — the bug is unordered
 * selection, not a guaranteed halt. A full fresh-chain run on PG18.6
 * remains a Quinn gate item (sibling #1141 also gates fresh-DB exit-0).
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'257_observer_capture.js',
);

// PG18-shaped catalog: genuine CHECK (contype 'c') + NOT NULL
// pseudo-CHECK (contype 'n') whose name contains the LIKE fragment.
const CATALOG = {
	recording_objects: [
		{ conname: 'recording_objects_object_type_not_null', contype: 'n' },
		{ conname: 'recording_objects_object_type_check', contype: 'c' },
		{ conname: 'recording_objects_pkey', contype: 'p' },
	],
	consent_texts: [
		{ conname: 'consent_texts_consent_type_not_null', contype: 'n' },
		{ conname: 'consent_texts_consent_type_check', contype: 'c' },
		{ conname: 'consent_texts_pkey', contype: 'p' },
	],
	consent_receipts: [
		{ conname: 'consent_receipts_consent_type_not_null', contype: 'n' },
		{ conname: 'consent_receipts_consent_type_check', contype: 'c' },
		{ conname: 'consent_receipts_pkey', contype: 'p' },
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

describe('257 dropCheckByName — PG18 not-null pseudo-CHECK (#1155)', () => {
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

	test('helper queries pg_constraint restricted to genuine CHECKs (contype = \'c\'), not information_schema', () => {
		expect(src).toMatch(/pg_constraint/);
		expect(src).toMatch(/contype\s*=\s*'c'/);
		const helper = src.slice(src.indexOf('async function dropCheckByName'), src.indexOf('async function up'));
		expect(helper).not.toMatch(/information_schema/);
	});

	test('up() emits exactly 3 drop-by-name blocks (recording_objects, consent_texts, consent_receipts)', () => {
		expect(doBlocks).toHaveLength(3);
		for (const block of doBlocks) {
			expect(block).toMatch(/pg_constraint/);
			expect(block).toMatch(/contype\s*=\s*'c'/);
		}
	});

	test.each([
		['recording_objects', 'recording_objects_object_type_check'],
		['consent_texts', 'consent_texts_consent_type_check'],
		['consent_receipts', 'consent_receipts_consent_type_check'],
	])('selection for %s picks the genuine CHECK, never the PG18 not-null pseudo-CHECK', (table, genuine) => {
		const block = doBlocks.find((b) => b.includes(table));
		expect(block).toBeDefined();
		const { selected } = selectConstraint(block);
		expect(selected).toBe(genuine);
		expect(selected).not.toMatch(/_not_null$/);
	});
});
