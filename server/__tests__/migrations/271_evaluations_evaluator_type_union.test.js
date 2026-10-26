/**
 * #1508 — migration 271: interview_evaluations.evaluator_type union CHECK.
 *
 * Two layers, labelled as what they are:
 *
 * 1. Static contract tests (always run, 266-style): guard the migration
 *    file itself — house export shape, the exact union value set, the
 *    find-by-definition drop (migration 268 pattern), and the hard
 *    loudness requirement from Rex's design: NO exception swallow
 *    anywhere (no EXCEPTION block, no try/catch), because p2's
 *    EXCEPTION WHEN OTHERS THEN RAISE NOTICE is what hid this defect.
 *
 * 2. Real-DB integration tests (gated behind MIG271_INTEGRATION_DB_URL,
 *    268-style): drive the REAL runner (node migrate.js as a subprocess)
 *    against a real Postgres built by migrate.js itself. They assert
 *    271's behaviour on BOTH starting states — old CHECK present and
 *    CHECK absent — converging to the one union constraint, a second
 *    run being a no-op in effect, and the writer's exact INSERT shape
 *    (services/interview-ai.js runMultiEvaluation) succeeding for every
 *    union value while an out-of-set value is still rejected.
 *    This is a migration-correctness test, not the HL-003 journey proof;
 *    Quinn's layered proof is separate (Rex design, #1508 §3).
 *
 * Example:
 *   MIG271_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55434/nova1508_test' \
 *     npx jest server/__tests__/migrations/271_evaluations_evaluator_type_union.test.js --forceExit
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
	'271_evaluations_evaluator_type_union.js',
);
const MIGRATION_NAME = '271_evaluations_evaluator_type_union';
const UNION_VALUES = ['technical', 'culture', 'experience', 'ai', 'human', 'panel'];

describe('271_evaluations_evaluator_type_union migration (static contract)', () => {
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

	test('adds the canonical constraint with the exact union value set', () => {
		expect(src).toMatch(/ADD CONSTRAINT chk_evaluations_evaluator_type/i);
		for (const v of UNION_VALUES) {
			expect(src).toContain(`'${v}'`);
		}
		expect(src).toMatch(
			/CHECK\s*\(\s*evaluator_type IN \('technical', 'culture', 'experience', 'ai', 'human', 'panel'\)\s*\)/i,
		);
	});

	test('drops the existing CHECK by definition via pg_constraint (268 pattern)', () => {
		expect(src).toMatch(/FROM pg_constraint/i);
		expect(src).toMatch(/conrelid = 'interview_evaluations'::regclass/i);
		expect(src).toMatch(/contype = 'c'/i);
		expect(src).toMatch(/pg_get_constraintdef\(oid\) LIKE '%evaluator_type%'/i);
		expect(src).toMatch(/DROP CONSTRAINT %I/i);
	});

	test('LOUD: no exception swallow anywhere — no EXCEPTION block, no try/catch', () => {
		// Strip comments first: the header documents the p2 swallow it bans.
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('//'))
			.join('\n');
		expect(code).not.toMatch(/EXCEPTION/i);
		expect(code).not.toMatch(/\btry\s*\{/);
		expect(code).not.toMatch(/\bcatch\b/);
	});

	test('touches nothing else: no data writes, no column change, no writer edit', () => {
		expect(src).not.toMatch(/INSERT INTO|UPDATE interview_evaluations|DELETE FROM/i);
		expect(src).not.toMatch(/ALTER COLUMN evaluator_type/i);
		expect(src).not.toMatch(/DROP TABLE|DROP COLUMN/i);
	});
});

// ---------------------------------------------------------------------------
// Real-DB integration (gated)
// ---------------------------------------------------------------------------
const DB_URL = process.env.MIG271_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

describeIfDb('migration 271 evaluator_type union CHECK (#1508, real DB)', () => {
	let pool;
	let candidateId;

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

	async function evaluatorChecks() {
		const { rows } = await pool.query(`
			SELECT conname, pg_get_constraintdef(oid) AS def
			FROM pg_constraint
			WHERE conrelid = 'interview_evaluations'::regclass AND contype = 'c'
			ORDER BY conname`);
		return rows.filter((r) => r.def.includes('evaluator_type'));
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

	// The writer's exact INSERT (services/interview-ai.js runMultiEvaluation):
	// same column list, same parameter shape, $6 = evaluator_type.
	async function writerInsert(evaluatorType) {
		try {
			await pool.query(
				`INSERT INTO interview_evaluations
           (interview_id, screening_session_id, candidate_id, job_id, company_id, evaluator_type, score, max_score, breakdown, reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 100, $8, $9)`,
				[
					null,
					null,
					candidateId,
					null,
					null,
					evaluatorType,
					80,
					JSON.stringify({ domain_knowledge: 80 }),
					'test reasoning',
				],
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

	test('fresh migrate.js build: exactly one union CHECK; writer INSERT succeeds for all union values, bogus rejected', async () => {
		await resetSchema();
		const run = await runMigrate();
		expect(run.code).toBe(0);

		const checks = await evaluatorChecks();
		expect(checks).toHaveLength(1);
		expect(checks[0].conname).toBe('chk_evaluations_evaluator_type');
		for (const v of UNION_VALUES) {
			expect(checks[0].def).toContain(v);
		}

		const { rows } = await pool.query(
			`INSERT INTO users (email, password_hash, name, role)
         VALUES ('mig271@example.com', 'x', 'Mig 271', 'candidate') RETURNING id`,
		);
		candidateId = rows[0].id;

		for (const v of UNION_VALUES) {
			expect(await writerInsert(v)).toBeNull();
		}
		const bogusErr = await writerInsert('bogus');
		expect(bogusErr).not.toBeNull();
		expect(bogusErr.code).toBe('23514');

		const { rows: saved } = await pool.query(
			'SELECT evaluator_type FROM interview_evaluations ORDER BY evaluator_type',
		);
		expect(saved.map((r) => r.evaluator_type).sort()).toEqual([...UNION_VALUES].sort());
	}, 300000);

	test('state A (old CHECK present): re-running 271 via migrate.js converges to the union CHECK', async () => {
		// Reconstruct the pre-271 live state: old kind-only CHECK in place.
		// Rows go first — adding the old CHECK validates existing rows,
		// and the previous test's lens rows would (correctly) block it.
		await pool.query('DELETE FROM interview_evaluations');
		await pool.query(
			'ALTER TABLE interview_evaluations DROP CONSTRAINT chk_evaluations_evaluator_type',
		);
		await pool.query(
			`ALTER TABLE interview_evaluations ADD CONSTRAINT chk_evaluations_evaluator_type
         CHECK (evaluator_type IN ('ai', 'human', 'panel'))`,
		);
		// The defect itself: the writer's lens insert is rejected here.
		expect(await writerInsert('technical')).not.toBeNull();

		await deleteMigrationRow();
		const run = await runMigrate();
		expect(run.code).toBe(0);
		const checks = await evaluatorChecks();
		expect(checks).toHaveLength(1);
		for (const v of UNION_VALUES) {
			expect(checks[0].def).toContain(v);
		}
		expect(await writerInsert('technical')).toBeNull();
	}, 300000);

	test('state B (CHECK absent): re-running 271 via migrate.js installs the union CHECK (drop is a no-op)', async () => {
		await pool.query(
			'ALTER TABLE interview_evaluations DROP CONSTRAINT chk_evaluations_evaluator_type',
		);
		expect(await evaluatorChecks()).toHaveLength(0);

		await deleteMigrationRow();
		const run = await runMigrate();
		expect(run.code).toBe(0);
		const checks = await evaluatorChecks();
		expect(checks).toHaveLength(1);
		expect(checks[0].conname).toBe('chk_evaluations_evaluator_type');
		expect(await writerInsert('experience')).toBeNull();
	}, 300000);

	test('unexpected name: an evaluator CHECK under a non-canonical name is still found by definition and replaced', async () => {
		// Rows first (see state A): the old CHECK validates existing rows.
		await pool.query('DELETE FROM interview_evaluations');
		await pool.query(
			'ALTER TABLE interview_evaluations DROP CONSTRAINT chk_evaluations_evaluator_type',
		);
		await pool.query(
			`ALTER TABLE interview_evaluations ADD CONSTRAINT legacy_eval_type_guard
         CHECK (evaluator_type IN ('ai', 'human', 'panel'))`,
		);
		expect(await writerInsert('technical')).not.toBeNull();

		await deleteMigrationRow();
		const run = await runMigrate();
		expect(run.code).toBe(0);
		const checks = await evaluatorChecks();
		expect(checks).toHaveLength(1);
		expect(checks[0].conname).toBe('chk_evaluations_evaluator_type');
		for (const v of UNION_VALUES) {
			expect(checks[0].def).toContain(v);
		}
		expect(await writerInsert('technical')).toBeNull();
	}, 300000);

	test('loud failure: a pre-existing out-of-union row blocks the ADD — non-zero exit, nothing recorded, rolled back', async () => {
		await pool.query(
			'ALTER TABLE interview_evaluations DROP CONSTRAINT chk_evaluations_evaluator_type',
		);
		await pool.query(
			`INSERT INTO interview_evaluations (candidate_id, evaluator_type, score, reasoning)
       VALUES ($1, 'bogus', 10, 'out-of-union row')`,
			[candidateId],
		);

		await deleteMigrationRow();
		const run = await runMigrate();
		// The p2 swallow must NOT be repeated: the failure is loud, the
		// migration is not recorded as applied, and the DB is left as it was.
		expect(run.code).not.toBe(0);
		expect(await migrationRecorded()).toBe(false);
		expect(await evaluatorChecks()).toHaveLength(0);

		// Recovery is a retry after the data question is resolved — and it works.
		await pool.query("DELETE FROM interview_evaluations WHERE evaluator_type = 'bogus'");
		const retry = await runMigrate();
		expect(retry.code).toBe(0);
		expect(await migrationRecorded()).toBe(true);
		expect(await evaluatorChecks()).toHaveLength(1);
	}, 300000);

	test('healthy DB: 271 re-run (row deleted, union CHECK already present) is a no-op in effect', async () => {
		await deleteMigrationRow();
		const run = await runMigrate();
		expect(run.code).toBe(0);
		const checks = await evaluatorChecks();
		expect(checks).toHaveLength(1);
		for (const v of UNION_VALUES) {
			expect(checks[0].def).toContain(v);
		}
		expect(await writerInsert('culture')).toBeNull();
	}, 300000);
});
