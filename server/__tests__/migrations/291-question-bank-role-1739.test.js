/**
 * #1739 — real-DB integration test for migration 291
 * (question_bank.role NOT NULL -> nullable).
 *
 * Root cause: migration 031 created question_bank.role as NOT NULL (the
 * target job role for AI-generated questions). The two recruiter writers
 * never supply role and 500 on every save:
 *   - routes/memory.js    POST /question-bank (INSERT at ~L173)
 *   - routes/recruiter.js POST /question-bank (INSERT at ~L3162)
 * Migration 291 relaxes role to nullable; the writers are unchanged.
 * NULL role means "recruiter-saved, not role-keyed" — the AI writers in
 * routes/interviews.js keep supplying role explicitly.
 *
 * HOW THIS TEST WORKS: it builds the REAL pre-migration schema by running
 * the real creating migrations (031 creates the table, 036 adds the
 * recruiter columns + the partial unique index the writers' ON CONFLICT
 * clause targets), then drives migration 291's real up()/down() against
 * it — no hand-built schema for the column under test, no mocked layer.
 *
 * The INSERT statements below are the writers' SQL verbatim (column
 * lists, ON CONFLICT clauses and parameter order), with the writers'
 * own defaults applied (question_type 'text' — see note in (b)).
 *
 * NOTE on question_type 'text': both recruiter writers default
 * question_type to 'text' (memory.js destructuring default; recruiter.js
 * `q.type || 'text'`). A full fresh install ALSO carries
 * chk_question_bank_type from migrations/p2_schema_hardening.sql, which
 * does NOT admit 'text' — that is a separate, still-open defect verified
 * from migration sources and recorded on #1739; it is deliberately NOT
 * reproduced in this suite's schema (this suite isolates the role fix),
 * and NOT fixed by migration 291 (STOP 1 scope).
 *
 * Gated behind MIG291_INTEGRATION_DB_URL so CI (no DB) skips the real-DB
 * suite gracefully. The URL must point at a scratch database the suite
 * may reset. Example:
 *   MIG291_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/rekrut_1739_it' \
 *     npx jest server/__tests__/migrations/291-question-bank-role-1739.test.js --forceExit
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'291_question_bank_role_nullable.js',
);

// ---------------------------------------------------------------------------
// Static contract (always runs; also what makes the suite RED while the
// migration file does not exist yet — require() throws in beforeAll).
// ---------------------------------------------------------------------------
describe('291_question_bank_role_nullable migration — static contract (#1739)', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports name, up and down (migrate.js contract)', () => {
		expect(migration.name).toBe('291_question_bank_role_nullable');
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('header cites #1739 and the NULL semantics', () => {
		expect(src).toMatch(/#1739/);
		expect(src).toMatch(/recruiter-saved, not role-keyed/);
	});

	test('up drops the NOT NULL on question_bank.role and nothing else', () => {
		expect(src).toMatch(
			/ALTER TABLE question_bank ALTER COLUMN role DROP NOT NULL/i,
		);
		// No data rewrite, no column/table drop, no writer-side change.
		expect(src).not.toMatch(/UPDATE question_bank/i);
		expect(src).not.toMatch(/DELETE FROM/i);
		expect(src).not.toMatch(/DROP TABLE/i);
		expect(src).not.toMatch(/DROP COLUMN/i);
	});
});

// ---------------------------------------------------------------------------
// Real-DB suite
// ---------------------------------------------------------------------------
const DB_URL = process.env.MIG291_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

// routes/memory.js POST /question-bank — verbatim INSERT (L173), params
// [question_text, question_type='text' (route default), category,
// JSON.stringify(options), req.user.id]; usage_count literal 0.
const MEMORY_WRITER_SQL = `
      INSERT INTO question_bank (question_text, question_type, category, options, recruiter_id, usage_count)
      VALUES ($1, $2, $3, $4, $5, 0)
      ON CONFLICT (recruiter_id, question_text) WHERE recruiter_id IS NOT NULL
      DO UPDATE SET
        question_type = EXCLUDED.question_type,
        category = EXCLUDED.category,
        options = EXCLUDED.options
      RETURNING *
    `;

// routes/recruiter.js POST /question-bank — verbatim INSERT (L3162),
// params [req.user.id, q.question, q.category || 'general',
// q.type || 'text', JSON.stringify(q.options || [])].
const RECRUITER_WRITER_SQL = `
        INSERT INTO question_bank (recruiter_id, question_text, category, question_type, options)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (recruiter_id, question_text) WHERE recruiter_id IS NOT NULL
        DO UPDATE SET usage_count = question_bank.usage_count + 1
        RETURNING *
      `;

// routes/interviews.js AI writer — verbatim INSERT (L589), role supplied.
const AI_WRITER_SQL = `INSERT INTO question_bank (role, jd_hash, skills, question_text, question_type, difficulty, key_points)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`;

describeIfDb('migration 291 question_bank.role nullable (#1739, real DB)', () => {
	let pool;
	let migration291;

	async function roleIsNullable() {
		const { rows } = await pool.query(
			`SELECT is_nullable FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'question_bank' AND column_name = 'role'`,
		);
		return rows[0].is_nullable === 'YES';
	}

	async function tryInsert(sql, params) {
		try {
			const res = await pool.query(sql, params);
			return { row: res.rows[0], err: null };
		} catch (err) {
			return { row: null, err };
		}
	}

	beforeAll(async () => {
		const { Pool } = require('pg');
		pool = new Pool({ connectionString: DB_URL, ssl: false });
		migration291 = require(MIGRATION_PATH);
		const mig031 = require(path.join(__dirname, '..', '..', '..', 'migrations', '031_question_bank.js'));
		const mig036 = require(path.join(__dirname, '..', '..', '..', 'migrations', '036_smart_data_reuse.js'));

		// Reset, then build the pre-migration schema from the real
		// creating migrations. users is a minimal stub: only its PK is
		// load-bearing here (036 adds question_bank.recruiter_id REFERENCES
		// users(id), and the writer shapes insert recruiter_id 7).
		await pool.query('DROP TABLE IF EXISTS question_bank CASCADE');
		await pool.query('DROP TABLE IF EXISTS mock_interview_sessions CASCADE');
		await pool.query('DROP TABLE IF EXISTS users CASCADE');
		// migrate.js bootstrap creates candidate_profiles before migrations
		// run and 036 ALTERs it — stub it the same way.
		await pool.query(
			'CREATE TABLE IF NOT EXISTS candidate_profiles (id SERIAL PRIMARY KEY, user_id INTEGER)',
		);
		await pool.query(
			'CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255), name VARCHAR(255), role VARCHAR(50))',
		);
		await pool.query("INSERT INTO users (id, email, name, role) VALUES (7, 'recruiter@example.test', 'Recruiter', 'recruiter')");
		await mig031.up(pool);
		await mig036.up(pool);
	}, 60000);

	afterAll(async () => {
		await pool.end();
	});

	test('(a) RED pre-migration: both recruiter writer shapes fail on role NOT NULL (23502)', async () => {
		expect(await roleIsNullable()).toBe(false);

		const mem = await tryInsert(MEMORY_WRITER_SQL, [
			'Tell me about a difficult hire.',
			'text',
			'general',
			JSON.stringify([]),
			7,
		]);
		expect(mem.err).not.toBeNull();
		expect(mem.err.code).toBe('23502');
		expect(mem.err.column).toBe('role');

		const rec = await tryInsert(RECRUITER_WRITER_SQL, [
			7,
			'How do you source passive candidates?',
			'general',
			'text',
			JSON.stringify([]),
		]);
		expect(rec.err).not.toBeNull();
		expect(rec.err.code).toBe('23502');
		expect(rec.err.column).toBe('role');
	});

	test('(b) GREEN post-migration: both recruiter writer shapes succeed, role reads back NULL', async () => {
		await migration291.up(pool);
		expect(await roleIsNullable()).toBe(true);

		const mem = await tryInsert(MEMORY_WRITER_SQL, [
			'Tell me about a difficult hire.',
			'text',
			'general',
			JSON.stringify([]),
			7,
		]);
		expect(mem.err).toBeNull();
		expect(mem.row.role).toBeNull();

		const rec = await tryInsert(RECRUITER_WRITER_SQL, [
			7,
			'How do you source passive candidates?',
			'general',
			'text',
			JSON.stringify([]),
		]);
		expect(rec.err).toBeNull();
		expect(rec.row.role).toBeNull();

		const { rows } = await pool.query(
			'SELECT COUNT(*)::int AS n FROM question_bank WHERE recruiter_id = 7 AND role IS NULL',
		);
		expect(rows[0].n).toBe(2);
	});

	test('(c) AI writer shape (role supplied) still succeeds post-migration', async () => {
		const ai = await tryInsert(AI_WRITER_SQL, [
			'Software Engineer',
			null,
			['javascript'],
			'Explain the event loop.',
			'behavioral',
			'medium',
			['macrotasks'],
		]);
		expect(ai.err).toBeNull();
		const { rows } = await pool.query('SELECT role FROM question_bank WHERE id = $1', [ai.row.id]);
		expect(rows[0].role).toBe('Software Engineer');
	});

	test('(d) up() is idempotent — second run succeeds, role still nullable', async () => {
		await migration291.up(pool);
		expect(await roleIsNullable()).toBe(true);
	});

	test('(e) down() honesty: no-op while NULL-role rows exist; restores NOT NULL once none do', async () => {
		// NULL-role rows from (b) exist: down must not fail and must not
		// restore the NOT NULL over them.
		await migration291.down(pool);
		expect(await roleIsNullable()).toBe(true);

		// Once no NULL rows remain, down restores the 031 constraint.
		await pool.query('DELETE FROM question_bank WHERE role IS NULL');
		await migration291.down(pool);
		expect(await roleIsNullable()).toBe(false);

		// Leave the scratch schema in the migrated state.
		await migration291.up(pool);
		expect(await roleIsNullable()).toBe(true);
	});
});
