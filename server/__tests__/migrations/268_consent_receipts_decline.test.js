/**
 * #1318 — real-DB integration test for migration 268's discover-by-definition
 * hardening (and the 269 repair it pairs with).
 *
 * Bug: 268 discovers the consent_receipts ordering CHECK via
 * pg_get_constraintdef LIKE '%withdrawn_at%' AND '%granted_at%' AND '%>=%'.
 * pg_get_constraintdef renders the stored expression tree and does NOT
 * canonicalise comparison direction, so a logically identical re-spelling
 * (granted_at <= withdrawn_at) renders with '<=', matches 0 rows, nothing
 * is dropped, the widened ADD succeeds alongside the old CHECK, migrate.js
 * records 268 as applied, and declines still violate a CHECK — silently.
 *
 * This suite drives the REAL runner (node migrate.js as a subprocess,
 * exactly like a staging promotion) against a real Postgres whose schema
 * is built by migrate.js itself — no hand-built schemas, no mocked layer.
 *
 * Gated behind MIG268_INTEGRATION_DB_URL so CI (no DB) skips gracefully.
 * The URL must point at a scratch database the suite may reset
 * (DROP SCHEMA public CASCADE) between cases.
 * Example:
 *   MIG268_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55493/rekrut_1318_it' \
 *     npx jest server/__tests__/migrations/268_consent_receipts_decline.test.js --forceExit
 */
const { execFile } = require('node:child_process');
const path = require('node:path');

const DB_URL = process.env.MIG268_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REVERSED_CHECK = 'consent_receipts_ordering_reversed';

describeIfDb('migration 268/269 consent_receipts ordering CHECK (#1318, real DB)', () => {
	let pool;

	function runMigrate() {
		return new Promise((resolve) => {
			execFile(
				process.execPath,
				['migrate.js'],
				{
					cwd: REPO_ROOT,
					env: { ...process.env, DATABASE_URL: DB_URL, NODE_ENV: 'test' },
					maxBuffer: 64 * 1024 * 1024,
					timeout: 300000,
				},
				(err, stdout, stderr) => {
					resolve({
						code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
						out: `${stdout || ''}\n${stderr || ''}`,
					});
				},
			);
		});
	}

	async function resetSchema() {
		await pool.query('DROP SCHEMA public CASCADE');
		await pool.query('CREATE SCHEMA public');
	}

	// Ordering CHECKs = CHECKs on consent_receipts naming both timestamp
	// columns AND carrying a comparison operator. The companion
	// (granted_at IS NOT NULL OR withdrawn_at IS NOT NULL) check names both
	// columns but has no operator, so it is excluded — as in the migrations.
	async function orderingChecks() {
		const { rows } = await pool.query(`
			SELECT conname, pg_get_constraintdef(oid) AS def
			FROM pg_constraint
			WHERE conrelid = 'consent_receipts'::regclass AND contype = 'c'
			ORDER BY conname`);
		return rows
			.filter(
				(r) =>
					r.def.includes('withdrawn_at') &&
					r.def.includes('granted_at') &&
					(/>=|<=|>|</.test(r.def)),
			)
			.map((r) => ({ ...r, widened: r.def.includes('granted_at IS NULL') }));
	}

	async function swapWidenedForReversed() {
		await pool.query(
			'ALTER TABLE consent_receipts DROP CONSTRAINT consent_receipts_withdrawn_after_grant',
		);
		await pool.query(`
			ALTER TABLE consent_receipts ADD CONSTRAINT ${REVERSED_CHECK}
			CHECK (withdrawn_at IS NULL OR (granted_at IS NOT NULL AND granted_at <= withdrawn_at))`);
	}

	async function addReversedAlongside() {
		await pool.query(`
			ALTER TABLE consent_receipts ADD CONSTRAINT ${REVERSED_CHECK}
			CHECK (withdrawn_at IS NULL OR (granted_at IS NOT NULL AND granted_at <= withdrawn_at))`);
	}

	async function deleteMigrationRow(name) {
		await pool.query('DELETE FROM _migrations WHERE name = $1', [name]);
	}

	async function migrationRecorded(name) {
		const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [name]);
		return rows.length > 0;
	}

	// The exact user-visible behaviour at stake: recording a decline
	// (granted_at NULL, withdrawn_at = now) must be storable.
	async function declineInsertError() {
		const { rows } = await pool.query('INSERT INTO interview_sessions DEFAULT VALUES RETURNING id');
		try {
			await pool.query(
				`INSERT INTO consent_receipts
				   (interview_session_id, candidate_id, consent_type, consent_text_version, consent_text_hash, granted_at, withdrawn_at)
				 VALUES ($1, 7, 'recording', '1.0', 'hash', NULL, NOW())`,
				[rows[0].id],
			);
			return null;
		} catch (e) {
			return e;
		}
	}

	beforeAll(async () => {
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
	}, 30000);

	afterAll(async () => {
		await pool.end();
	});

	test(
		'fresh migrate.js build: exactly one widened ordering CHECK, decline insert succeeds',
		async () => {
			await resetSchema();
			const run = await runMigrate();
			expect(run.code).toBe(0);
			const checks = await orderingChecks();
			expect(checks).toHaveLength(1);
			expect(checks[0].widened).toBe(true);
			expect(await declineInsertError()).toBeNull();
		},
		300000,
	);

	test(
		'RED/GREEN: reversed rendering makes 268 fail loud (non-zero exit, nothing recorded), not silently pass',
		async () => {
			await resetSchema();
			expect((await runMigrate()).code).toBe(0);
			await swapWidenedForReversed();
			await deleteMigrationRow('268_consent_receipts_decline');
			await deleteMigrationRow('269_consent_receipts_decline_repair');

			const run = await runMigrate();
			// Loud failure: the promotion gate stops instead of certifying a
			// DB where declines cannot be recorded.
			expect(run.code).not.toBe(0);
			expect(run.out).toMatch(/268/);
			expect(await migrationRecorded('268_consent_receipts_decline')).toBe(false);
			// Rolled back, not half-applied: the reversed CHECK is still the
			// only ordering CHECK, and the failure is visible, not healed over.
			const checks = await orderingChecks();
			expect(checks.map((c) => c.conname)).toEqual([REVERSED_CHECK]);
			expect(await declineInsertError()).not.toBeNull();
		},
		300000,
	);

	test(
		'269 repairs a silently-failed DB (old-shape + widened both present, 268 recorded)',
		async () => {
			await resetSchema();
			expect((await runMigrate()).code).toBe(0);
			// Reconstruct the silent-failure post-state: the widened CHECK was
			// added but the old-shape (reversed) CHECK was never dropped.
			await addReversedAlongside();
			await deleteMigrationRow('269_consent_receipts_decline_repair');
			expect(await orderingChecks()).toHaveLength(2);
			expect(await declineInsertError()).not.toBeNull();

			const run = await runMigrate();
			expect(run.code).toBe(0);
			const checks = await orderingChecks();
			expect(checks).toHaveLength(1);
			expect(checks[0].widened).toBe(true);
			expect(await declineInsertError()).toBeNull();
		},
		300000,
	);

	test(
		'healthy DB: 268 re-run (row deleted) is idempotent — widened CHECK matches discovery, no false raise',
		async () => {
			await resetSchema();
			expect((await runMigrate()).code).toBe(0);
			await deleteMigrationRow('268_consent_receipts_decline');
			await deleteMigrationRow('269_consent_receipts_decline_repair');

			const run = await runMigrate();
			expect(run.code).toBe(0);
			const checks = await orderingChecks();
			expect(checks).toHaveLength(1);
			expect(checks[0].widened).toBe(true);
			expect(await declineInsertError()).toBeNull();
		},
		300000,
	);
});
