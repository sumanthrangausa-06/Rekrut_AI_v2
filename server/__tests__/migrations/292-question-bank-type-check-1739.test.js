/**
 * #1739 — real-DB integration test for migration 292
 * (chk_question_bank_type widened to the union of the two real taxonomies).
 *
 * Root cause: migrations/p2_schema_hardening.sql:2979 adds
 *   chk_question_bank_type CHECK (question_type IN
 *     ('behavioral','technical','situational','competency','role_specific'))
 * — the AI question taxonomy only (writers: routes/interviews.js). But
 * question_bank is shared: the recruiter writers
 *   - routes/memory.js    POST /question-bank (INSERT ~L173)
 *   - routes/recruiter.js POST /question-bank (INSERT ~L3162)
 * save screening questions whose question_type is an ANSWER FORMAT
 * ('text' default in both writers; client screening type is
 * 'text' | 'yes_no' | 'select' — client/src/pages/recruiter/job-form.tsx:59;
 * routes/questionnaire.js:224 validates
 * ['single_choice','multiple_choice','short_text','yes_no','numeric']).
 * Post-291 (role nullable), every such INSERT still failed 23514 on
 * chk_question_bank_type — proven by the fresh-check probe in the 291
 * round. Lead's ruling on #1739 (comment 6358430497): migration 292
 * widens the CHECK to the union of observed real values. Writers and
 * client code are unchanged.
 *
 * HOW THIS TEST WORKS: builds the REAL post-291 schema — the real
 * creating migrations 031 + 036, migration 291's real up(), then the
 * chk_question_bank_type constraint added with the verbatim guarded DO
 * block from migrations/p2_schema_hardening.sql (L2973-2983) — then
 * drives migration 292's real up()/down() against it. No mocked layer.
 *
 * Gated behind MIG292_INTEGRATION_DB_URL so CI (no DB) skips the real-DB
 * suite gracefully. The URL must point at a scratch database the suite
 * may reset. Example:
 *   MIG292_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/rekrut_1739_292' \
 *     npx jest server/__tests__/migrations/292-question-bank-type-check-1739.test.js --forceExit
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'migrations');
const MIGRATION_PATH = path.join(
	MIGRATIONS_DIR,
	'292_question_bank_type_check_widen.js',
);

const WIDENED_TYPES = [
	'behavioral',
	'technical',
	'situational',
	'competency',
	'role_specific',
	'text',
	'select',
	'yes_no',
	'single_choice',
	'multiple_choice',
	'short_text',
	'numeric',
];

// ---------------------------------------------------------------------------
// Static contract (always runs; also what makes the suite RED while the
// migration file does not exist yet — require() throws in beforeAll).
// ---------------------------------------------------------------------------
describe('292_question_bank_type_check_widen migration — static contract (#1739)', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports name, up and down (migrate.js contract)', () => {
		expect(migration.name).toBe('292_question_bank_type_check_widen');
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('header cites #1739 and both taxonomies', () => {
		expect(src).toMatch(/#1739/);
		expect(src).toMatch(/routes\/interviews\.js/);
		expect(src).toMatch(/routes\/memory\.js/);
		expect(src).toMatch(/routes\/recruiter\.js/);
	});

	test('up widens chk_question_bank_type to exactly the ruled union', () => {
		for (const t of WIDENED_TYPES) {
			expect(src).toContain(`'${t}'`);
		}
		expect(src).toMatch(/DROP CONSTRAINT IF EXISTS chk_question_bank_type/i);
		expect(src).toMatch(/ADD CONSTRAINT chk_question_bank_type/i);
		// No data rewrite, no column/table drop, no writer-side change.
		expect(src).not.toMatch(/UPDATE question_bank/i);
		expect(src).not.toMatch(/DELETE FROM question_bank/i);
		expect(src).not.toMatch(/DROP TABLE/i);
		expect(src).not.toMatch(/DROP COLUMN/i);
	});
});

// ---------------------------------------------------------------------------
// Real-DB suite
// ---------------------------------------------------------------------------
const DB_URL = process.env.MIG292_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

// routes/memory.js POST /question-bank — verbatim INSERT (L173), params
// [question_text, question_type, category, JSON.stringify(options),
// req.user.id]; usage_count literal 0.
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
// params [req.user.id, q.question, q.category || 'general', q.type,
// JSON.stringify(q.options || [])].
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

// The chk_question_bank_type block from migrations/p2_schema_hardening.sql
// (L2973-2983), verbatim — this is how a fresh install gets the constraint.
const P2_TYPE_CHECK_BLOCK = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'question_bank' AND constraint_name = 'chk_question_bank_type'
  ) THEN
    ALTER TABLE question_bank ADD CONSTRAINT chk_question_bank_type CHECK (question_type IN ('behavioral', 'technical', 'situational', 'competency', 'role_specific'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add constraint: %', SQLERRM;
END $$;
`;

describeIfDb('migration 292 chk_question_bank_type widen (#1739, real DB)', () => {
	let pool;
	let migration291;
	let migration292;

	async function constraintDef() {
		const { rows } = await pool.query(
			`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
			 WHERE conname = 'chk_question_bank_type'
			   AND conrelid = 'question_bank'::regclass`,
		);
		return rows.length === 1 ? rows[0].def : null;
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
		migration291 = require(path.join(MIGRATIONS_DIR, '291_question_bank_role_nullable.js'));
		migration292 = require(MIGRATION_PATH);
		const mig031 = require(path.join(MIGRATIONS_DIR, '031_question_bank.js'));
		const mig036 = require(path.join(MIGRATIONS_DIR, '036_smart_data_reuse.js'));

		// Reset, then build the post-291 schema from the real creating
		// migrations + 291, then add the CHECK exactly as a fresh install
		// does (p2_schema_hardening.sql). users/candidate_profiles stubbed
		// as in the 291 suite (036's FK / ALTER targets).
		await pool.query('DROP TABLE IF EXISTS question_bank CASCADE');
		await pool.query('DROP TABLE IF EXISTS mock_interview_sessions CASCADE');
		await pool.query('DROP TABLE IF EXISTS users CASCADE');
		await pool.query(
			'CREATE TABLE IF NOT EXISTS candidate_profiles (id SERIAL PRIMARY KEY, user_id INTEGER)',
		);
		await pool.query(
			'CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255), name VARCHAR(255), role VARCHAR(50))',
		);
		await pool.query("INSERT INTO users (id, email, name, role) VALUES (7, 'recruiter@example.test', 'Recruiter', 'recruiter')");
		await mig031.up(pool);
		await mig036.up(pool);
		await migration291.up(pool);
		await pool.query(P2_TYPE_CHECK_BLOCK);
	}, 60000);

	afterAll(async () => {
		await pool.end();
	});

	test('(a) RED pre-292 (post-291 schema): recruiter writer INSERT with question_type text fails 23514 on chk_question_bank_type', async () => {
		const def = await constraintDef();
		expect(def).not.toBeNull();
		expect(def).toContain("'behavioral'");
		expect(def).not.toContain("'text'");

		const mem = await tryInsert(MEMORY_WRITER_SQL, [
			'Are you authorised to work in the US?',
			'text',
			'work_authorization',
			JSON.stringify([]),
			7,
		]);
		expect(mem.err).not.toBeNull();
		expect(mem.err.code).toBe('23514');
		expect(mem.err.constraint).toBe('chk_question_bank_type');
	});

	test('(b) GREEN post-292: answer-format types succeed for both recruiter writer shapes; AI shape still succeeds', async () => {
		await migration292.up(pool);
		const def = await constraintDef();
		for (const t of WIDENED_TYPES) {
			expect(def).toContain(`'${t}'`);
		}

		const mem = await tryInsert(MEMORY_WRITER_SQL, [
			'Are you authorised to work in the US?',
			'text',
			'work_authorization',
			JSON.stringify([]),
			7,
		]);
		expect(mem.err).toBeNull();
		expect(mem.row.question_type).toBe('text');
		expect(mem.row.role).toBeNull();

		const rec = await tryInsert(RECRUITER_WRITER_SQL, [
			7,
			'Can you start within two weeks?',
			'availability',
			'yes_no',
			JSON.stringify([]),
		]);
		expect(rec.err).toBeNull();
		expect(rec.row.question_type).toBe('yes_no');

		const mc = await tryInsert(RECRUITER_WRITER_SQL, [
			7,
			'Which shifts can you cover?',
			'availability',
			'multiple_choice',
			JSON.stringify(['day', 'night']),
		]);
		expect(mc.err).toBeNull();
		expect(mc.row.question_type).toBe('multiple_choice');

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
		const { rows } = await pool.query('SELECT role, question_type FROM question_bank WHERE id = $1', [ai.row.id]);
		expect(rows[0].role).toBe('Software Engineer');
		expect(rows[0].question_type).toBe('behavioral');
	});

	test('(c) guard preserved: a garbage question_type still fails 23514 post-292', async () => {
		const bad = await tryInsert(MEMORY_WRITER_SQL, [
			'Bogus typed question',
			'nonsense_type',
			'general',
			JSON.stringify([]),
			7,
		]);
		expect(bad.err).not.toBeNull();
		expect(bad.err.code).toBe('23514');
		expect(bad.err.constraint).toBe('chk_question_bank_type');
	});

	test('(d) up() is idempotent — second run succeeds, constraint still the widened union', async () => {
		await migration292.up(pool);
		const def = await constraintDef();
		for (const t of WIDENED_TYPES) {
			expect(def).toContain(`'${t}'`);
		}
	});

	test('(e) down() honesty: no-op while newly-admitted rows exist; restores the original 5-value CHECK once none do', async () => {
		// Rows with 'text'/'yes_no'/'multiple_choice' exist from (b):
		// down must not fail and must not narrow the CHECK over them.
		await migration292.down(pool);
		let def = await constraintDef();
		expect(def).toContain("'text'");

		// Once no newly-admitted rows remain, down restores the original.
		await pool.query(
			`DELETE FROM question_bank WHERE question_type IN ('text','select','yes_no','single_choice','multiple_choice','short_text','numeric')`,
		);
		await migration292.down(pool);
		def = await constraintDef();
		expect(def).toContain("'behavioral'");
		expect(def).not.toContain("'text'");

		const mem = await tryInsert(MEMORY_WRITER_SQL, [
			'Post-down text question',
			'text',
			'general',
			JSON.stringify([]),
			7,
		]);
		expect(mem.err).not.toBeNull();
		expect(mem.err.code).toBe('23514');

		// Leave the scratch schema in the migrated state.
		await migration292.up(pool);
		def = await constraintDef();
		expect(def).toContain("'text'");
	});
});
