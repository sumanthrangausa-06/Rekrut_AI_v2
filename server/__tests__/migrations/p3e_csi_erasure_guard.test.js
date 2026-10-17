/**
 * Issue #1163: candidate_search_index row resurrects after erasure —
 * static content validation, following the 266 pattern.
 *
 * The real-DB red/green proof (erasure sequence resurrects a tombstone CSI
 * row before p3e, none after; live candidates still sync) was run by Nova
 * on a local scratch Postgres and is recorded on issue #1163 / the PR;
 * this test guards the migration file itself against regression (e.g.
 * losing the deleted_at guard, moving the fix into an earlier-sorting
 * filename that p3b would overwrite — the #1282 trap — or re-upserting
 * instead of deleting).
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'migrations');
const MIGRATION_PATH = path.join(MIGRATIONS_DIR, 'p3e_csi_erasure_guard.js');

describe('p3e_csi_erasure_guard migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports name and up function (migrate.js contract)', () => {
		expect(migration.name).toBe('p3e_csi_erasure_guard');
		expect(typeof migration.up).toBe('function');
	});

	test('sorts after p3d and before p4 in migrate.js lexical order (the #1282 trap)', () => {
		const files = fs.readdirSync(MIGRATIONS_DIR).sort();
		const p3d = files.indexOf('p3d_fix_users_trigger_user_id.js');
		const p3e = files.indexOf('p3e_csi_erasure_guard.js');
		const p4 = files.indexOf('p4_application_status_stages.js');
		expect(p3d).toBeGreaterThanOrEqual(0);
		expect(p3e).toBeGreaterThan(p3d);
		expect(p4).toBeGreaterThan(p3e);
		// A numbered migration would sort before p3b and be overwritten by it.
		expect('p3e_csi_erasure_guard.js' > 'p3b_candidate_search.js').toBe(true);
	});

	test('replaces sync_candidate_search_index (CREATE OR REPLACE, idempotent)', () => {
		expect(src).toMatch(
			/CREATE OR REPLACE FUNCTION sync_candidate_search_index\(p_user_id INTEGER\)/i,
		);
	});

	test('guards on users.deleted_at: deletes any CSI row and returns, before any upsert', () => {
		expect(src).toMatch(/deleted_at IS NOT NULL/i);
		expect(src).toMatch(/DELETE FROM candidate_search_index WHERE user_id = p_user_id/i);
		const guardIdx = src.search(/deleted_at IS NOT NULL/i);
		const deleteIdx = src.search(/DELETE FROM candidate_search_index/i);
		const upsertIdx = src.search(/INSERT INTO candidate_search_index/i);
		expect(deleteIdx).toBeGreaterThan(guardIdx);
		expect(upsertIdx).toBeGreaterThan(deleteIdx);
	});

	test('keeps the full p3b upsert body (live candidates still sync)', () => {
		expect(src).toMatch(/INSERT INTO candidate_search_index/i);
		expect(src).toMatch(/ON CONFLICT \(user_id\) DO UPDATE SET/i);
		expect(src).toMatch(/FROM candidate_skills cs/i);
		expect(src).toMatch(/FROM omni_scores os/i);
		expect(src).toMatch(/FROM candidate_embeddings ce/i);
	});

	test('cleanup (privacy N1): up() emits a DELETE removing pre-existing resurrected CSI rows for tombstoned users', () => {
		expect(src).toMatch(
			/DELETE FROM candidate_search_index\s+WHERE user_id IN \(SELECT id FROM users WHERE deleted_at IS NOT NULL\)/i,
		);
		// The cleanup targets tombstones (deleted_at IS NOT NULL), not all rows.
		const cleanupIdx = src.search(
			/DELETE FROM candidate_search_index\s+WHERE user_id IN/i,
		);
		expect(cleanupIdx).toBeGreaterThan(0);
		expect(src.slice(cleanupIdx)).toMatch(/deleted_at IS NOT NULL/i);
		// It runs after the guard function is (re)created, in its own query.
		const fnIdx = src.search(/CREATE OR REPLACE FUNCTION sync_candidate_search_index/i);
		expect(cleanupIdx).toBeGreaterThan(fnIdx);
		const queryCalls = src.match(/client\.query/g) || [];
		expect(queryCalls.length).toBeGreaterThanOrEqual(2);
		// The deleted count is logged (rowCount) for the #1163 live-DB record.
		expect(src).toMatch(/cleanup\.rowCount/);
	});

	test('touches nothing else: no drop, no trigger changes, no data rewrite outside the guard', () => {
		expect(src).not.toMatch(/DROP TABLE/i);
		expect(src).not.toMatch(/CREATE TRIGGER/i);
		expect(src).not.toMatch(/DROP TRIGGER/i);
		expect(src).not.toMatch(/ALTER TABLE/i);
	});
});
