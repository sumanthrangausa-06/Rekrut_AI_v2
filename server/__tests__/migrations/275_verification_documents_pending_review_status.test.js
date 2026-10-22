/**
 * #1610 — migration 275: verification_documents 'pending_review' CHECK widening.
 *
 * Two layers, labelled as what they are:
 *
 * 1. Static contract tests (always run, 271-style): guard the migration
 *    file itself — house export shape, the exact widened value set, the
 *    find-by-definition drop covering BOTH historical constraints (047's
 *    chk_verification_documents_status and p2_schema_hardening.sql's
 *    chk_verification_docs_status), and the hard loudness requirement:
 *    NO exception swallow anywhere (no EXCEPTION block, no try/catch).
 *
 * 2. Real-DB integration tests (gated behind MIG275_INTEGRATION_DB_URL,
 *    271-style): drive the REAL runner (node migrate.js as a subprocess)
 *    against a real Postgres built by migrate.js itself. They assert
 *    275's behaviour on the fresh build (both old CHECKs present),
 *    converging to exactly one canonical widened CHECK; state A (both
 *    old CHECKs restored) and state B (CHECK absent) re-runs converging
 *    the same way; and verifyDocument's exact UPDATE shape
 *    (services/document-verification.js:886) succeeding with
 *    'pending_review' while an out-of-set value is still rejected.
 *    This is a migration-correctness test, not the HL-003 journey proof;
 *    Quinn's layered proof is separate.
 *
 * Example:
 *   MIG275_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55471/nova1610_test' \
 *     npx jest server/__tests__/migrations/275_verification_documents_pending_review_status.test.js --forceExit
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'275_verification_documents_pending_review_status.js',
);
const MIGRATION_NAME = '275_verification_documents_pending_review_status';
const WIDENED_VALUES = ['pending', 'verified', 'rejected', 'expired', 'pending_review'];

describe('275_verification_documents_pending_review_status migration (static contract)', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports name and up function (migrate.js contract)', () => {
		expect(migration.name).toBe(MIGRATION_NAME);
		expect(typeof migration.up).toBe('function');
	});

	test('adds the canonical constraint with the exact widened value set', () => {
		expect(src).toMatch(/ADD CONSTRAINT chk_verification_docs_status\b/i);
		for (const v of WIDENED_VALUES) {
			expect(src).toContain(`'${v}'`);
		}
		expect(src).toMatch(
			/CHECK\s*\(\s*status IN \('pending', 'verified', 'rejected', 'expired', 'pending_review'\)\s*\)/i,
		);
	});

	test("does NOT add 'flagged' (email display string only; mig 010 mapped it to 'rejected')", () => {
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//'))
			.join('\n');
		expect(code).not.toContain("'flagged'");
	});

	test('drops existing CHECKs by definition via pg_constraint (268/271 pattern)', () => {
		expect(src).toMatch(/FROM pg_constraint/i);
		expect(src).toMatch(/conrelid = 'verification_documents'::regclass/i);
		expect(src).toMatch(/contype = 'c'/i);
		expect(src).toMatch(/pg_get_constraintdef\(oid\) LIKE '%status%'/i);
		expect(src).toMatch(/pg_get_constraintdef\(oid\) LIKE '%pending%'/i);
		expect(src).toMatch(/pg_get_constraintdef\(oid\) LIKE '%expired%'/i);
		expect(src).toMatch(/DROP CONSTRAINT %I/i);
	});

	test('LOUD: no exception swallow anywhere — no EXCEPTION block, no try/catch', () => {
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//'))
			.join('\n');
		expect(code).not.toMatch(/EXCEPTION/i);
		expect(code).not.toMatch(/\btry\s*\{/);
		expect(code).not.toMatch(/\bcatch\b/);
	});

	test('touches nothing else: no data writes, no column change, no table drop', () => {
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//'))
			.join('\n');
		expect(code).not.toMatch(/INSERT INTO|UPDATE verification_documents SET|DELETE FROM/i);
		expect(code).not.toMatch(/ALTER COLUMN status/i);
		expect(code).not.toMatch(/DROP TABLE|DROP COLUMN/i);
	});
});

// ---------------------------------------------------------------------------
// Real-DB integration (gated)
// ---------------------------------------------------------------------------
const DB_URL = process.env.MIG275_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

describeIfDb('migration 275 pending_review CHECK (#1610, real DB)', () => {
	let pool;
	let userId;
	let docId;

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

	// Every CHECK on verification_documents whose definition carries the
	// status vocabulary — the set migration 275 owns.
	async function statusChecks() {
		const { rows } = await pool.query(`
			SELECT conname, pg_get_constraintdef(oid) AS def
			FROM pg_constraint
			WHERE conrelid = 'verification_documents'::regclass AND contype = 'c'
			ORDER BY conname`);
		return rows.filter(
			(r) => r.def.includes('status') && r.def.includes('pending') && r.def.includes('expired'),
		);
	}

	async function deleteMigrationRow() {
		await pool.query('DELETE FROM _migrations WHERE name = $1', [MIGRATION_NAME]);
	}

	async function migrationRecorded() {
		const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [
			MIGRATION_NAME,
		]);
		return rows.length > 0;
	}

	// verifyDocument's exact UPDATE shape (services/document-verification.js:886):
	// same columns, $5 = the computed documentStatus.
	async function verifyUpdate(status) {
		try {
			await pool.query(
				`UPDATE verification_documents
         SET extracted_text = $1, extracted_data = $2, authenticity_score = $3,
             fraud_flags = $4, status = $5, processed_at = NOW(), updated_at = NOW()
         WHERE id = $6`,
				['extracted', JSON.stringify({}), 55, JSON.stringify([]), status, docId],
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

	test('fresh migrate.js build: exactly one widened CHECK; verifyDocument UPDATE lands pending_review, bogus rejected', async () => {
		await resetSchema();
		const run = await runMigrate();
		expect(run.code).toBe(0);
		expect(await migrationRecorded()).toBe(true);

		const checks = await statusChecks();
		expect(checks).toHaveLength(1);
		expect(checks[0].conname).toBe('chk_verification_docs_status');
		for (const v of WIDENED_VALUES) {
			expect(checks[0].def).toContain(v);
		}

		const { rows: u } = await pool.query(
			`INSERT INTO users (email, password_hash, name, role)
       VALUES ('mig275@example.com', 'x', 'Mig 275', 'candidate') RETURNING id`,
		);
		userId = u[0].id;
		const { rows: d } = await pool.query(
			`INSERT INTO verification_documents (user_id, document_type, original_filename, file_url, file_size, mime_type, status)
       VALUES ($1, 'education_certificate', 'cert.pdf', 'https://example.invalid/cert.pdf', 1234, 'application/pdf', 'pending')
       RETURNING id`,
			[userId],
		);
		docId = d[0].id;

		// The defect case: medium/high-risk (and analysis-unavailable) path.
		expect(await verifyUpdate('pending_review')).toBeNull();
		const { rows: back } = await pool.query('SELECT status FROM verification_documents WHERE id = $1', [docId]);
		expect(back[0].status).toBe('pending_review');

		// Every pre-existing value still admissible; low-risk still 'verified'.
		for (const v of ['verified', 'rejected', 'expired', 'pending']) {
			expect(await verifyUpdate(v)).toBeNull();
		}
		const bogusErr = await verifyUpdate('bogus_status');
		expect(bogusErr).not.toBeNull();
		expect(bogusErr.code).toBe('23514');
	}, 300000);

	test('state A (BOTH old CHECKs restored): re-running 275 via migrate.js converges to the one widened CHECK', async () => {
		await pool.query('ALTER TABLE verification_documents DROP CONSTRAINT chk_verification_docs_status');
		await pool.query(
			`ALTER TABLE verification_documents ADD CONSTRAINT chk_verification_documents_status
       CHECK (status IN ('pending', 'verified', 'rejected', 'expired'))`,
		);
		await pool.query(
			`ALTER TABLE verification_documents ADD CONSTRAINT chk_verification_docs_status
       CHECK (status IS NULL OR status IN ('pending', 'verified', 'rejected', 'expired'))`,
		);
		expect(await statusChecks()).toHaveLength(2);
		// The defect itself, in this state: pending_review is rejected.
		// (Reset the row first: it currently holds a value the old CHECKs
		// forbid only on write; UPDATE to a legal value, then attempt.)
		await pool.query("UPDATE verification_documents SET status = 'pending' WHERE id = $1", [docId]);
		expect(await verifyUpdate('pending_review')).not.toBeNull();

		await deleteMigrationRow();
		const run = await runMigrate();
		expect(run.code).toBe(0);
		const checks = await statusChecks();
		expect(checks).toHaveLength(1);
		expect(checks[0].conname).toBe('chk_verification_docs_status');
		expect(checks[0].def).toContain('pending_review');
		expect(await verifyUpdate('pending_review')).toBeNull();
	}, 300000);

	test('state B (CHECK absent): re-running 275 via migrate.js installs the widened CHECK (drop is a no-op)', async () => {
		await pool.query('ALTER TABLE verification_documents DROP CONSTRAINT chk_verification_docs_status');
		expect(await statusChecks()).toHaveLength(0);

		await deleteMigrationRow();
		const run = await runMigrate();
		expect(run.code).toBe(0);
		const checks = await statusChecks();
		expect(checks).toHaveLength(1);
		expect(checks[0].conname).toBe('chk_verification_docs_status');
		expect(await verifyUpdate('pending_review')).toBeNull();
	}, 300000);
});
