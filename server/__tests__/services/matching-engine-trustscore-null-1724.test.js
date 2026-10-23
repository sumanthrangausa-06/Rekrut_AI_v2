/**
 * #1724 — reader-side `trustscore || 500` fabricates a 500 TrustScore for
 * every unmeasured company (and silently promotes a measured 0 to 500).
 *
 * Panel position (panel-1724/PANEL.md §0–§2, §5.1; STOP 1 on #1724):
 *  - Site A (findMatchingCandidates): TrustScore weight is 0.10 in THIS
 *    function (similarity .45 / skills .20 / OmniScore .25 / trust .10).
 *    When the company's TrustScore is NULL (no trust_scores row, or a row
 *    whose total_score is NULL), exclude the trust term and renormalize
 *    over measured components only: trust-only missing ÷0.90, omni-only
 *    missing ÷0.75 (as #1717 shipped), both missing ÷0.65. Return
 *    `trustscore: null` + `trustscore_status: 'insufficient_data'`;
 *    the explanation must carry no fabricated number; persist
 *    `match_results.trustscore_at_match = NULL` (nullable — migration
 *    008_matching_engine.js declares `trustscore_at_match INTEGER`
 *    with no NOT NULL, re-verified at build time).
 *  - Site B (findMatchingJobs): TrustScore weight is 0.25 in THIS
 *    function (similarity .45 / skills .20 / trust .25 / OmniScore .10).
 *    Same treatment: trust-only missing ÷0.75, omni-only missing ÷0.90
 *    (as #1717 shipped), both missing ÷0.65. `trust_tier` stays whatever
 *    the query returned (NULL when no row) — never an invented 'new'.
 *  - A genuinely measured TrustScore — including a measured 0 — flows
 *    exactly as before (explicit null/undefined test, never `||`).
 *  - explainMatch's on-demand return carries omniscore/omniscore_status
 *    and trustscore/trustscore_status (panel §2.2). The cached branch
 *    returns the match_results row, whose *_at_match NULLs are the
 *    insufficient-data signal there.
 *
 * Real-DB integration suite (mirrors the #1717 harness): gated behind
 * MATCHING1724_INTEGRATION_DB_URL so environments without a disposable
 * Postgres skip gracefully. The test database is throwaway: the suite
 * drops and recreates the minimal table set the matching engine reads,
 * with `match_results` carrying migration 008's exact column shape.
 *
 * The ONLY mock is the external embedding API (lib/ai-provider): no AI
 * provider is reachable from the test rig, and explainMatch's on-demand
 * branch calls the embedding refresh unguarded, so without this stub
 * that branch is unreachable. The stub returns the exact seeded unit
 * vector, so every embedding row keeps similarity 1 and all SQL,
 * scoring, renormalisation and persistence under test are the real
 * production code paths against the real database. Nothing about the
 * scoring layer is mocked.
 *
 * Example:
 *   MATCHING1724_INTEGRATION_DB_URL='postgresql://root@/rekrut_1724_test?host=/var/run/postgresql' \
 *     npx jest server/__tests__/services/matching-engine-trustscore-null-1724.test.js --forceExit
 *
 * Fixture geometry (every expected score computed from the code's
 * actual weights at origin/dev a004071d2 and pinned):
 *   candidate embedding == job embedding  → similarity_score = 1
 *   candidate skill 'JavaScript', job requirements 'JavaScript'
 *                                       → skill_match_pct = 100
 *   candidate OmniScore 600 (measured)  → omniNormalized = 0.6
 * Site A (sim .45 / skills .20 / omni .25 / trust .10):
 *   trust missing, omni 600: (0.45+0.20+0.6*0.25)/0.90*100        = 88.89
 *   both missing:            (0.45+0.20)/0.65*100                  = 100
 *   trust measured 0, omni 600: (0.45+0.20+0.15+0)*100             = 80
 *   trust measured 800, omni 600: (0.45+0.20+0.15+0.08)*100        = 88
 *   omni missing, trust 800: (0.45+0.20+0.08)/0.75*100             = 97.33
 * Site B (sim .45 / skills .20 / trust .25 / omni .10):
 *   trust missing, omni 600: (0.45+0.20+0.6*0.10)/0.75*100         = 94.67
 *   both missing:            (0.45+0.20)/0.65*100                  = 100
 *   trust measured 0, omni 600: (0.45+0.20+0+0.06)*100             = 71
 *   trust measured 800, omni 600: (0.45+0.20+0.20+0.06)*100        = 91
 *   omni missing, trust 800: (0.45+0.20+0.20)/0.90*100             = 94.44
 * (Panel §5.1's 88.89 / 94.67 for the trust-missing omni-600 fixtures
 * recompute exactly from the code's weights — no divergence.)
 */
jest.unmock('../../../lib/db');
jest.mock('../../../lib/ai-provider', () => ({
	generateEmbedding: async () => [1, ...Array(1535).fill(0)],
}));

const DB_URL = process.env.MATCHING1724_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const COMP_UNMEASURED = 172401; // no trust_scores row at all
const COMP_NULL_TOTAL = 172402; // trust_scores row, total_score NULL
const COMP_ZERO = 172403; // measured 0
const COMP_800 = 172404; // measured 800

const JOB_UNMEASURED = 1724001;
const JOB_NULL_TOTAL = 1724002;
const JOB_ZERO = 1724003;
const JOB_800 = 1724004;

const CAND_600 = 1724103; // measured OmniScore 600
const CAND_NONE = 1724101; // no omni_scores row

const VECTOR = `[${[1, ...Array(1535).fill(0)].join(',')}]`;

const SCHEMA_SQL = `
DROP TABLE IF EXISTS match_results, job_recommendations, candidate_embeddings,
  job_embeddings, candidate_skills, candidate_profiles, omni_scores,
  trust_scores, work_experience, education, jobs, companies, users CASCADE;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, avatar_url TEXT, company_id INTEGER);
CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT, logo_url TEXT);
CREATE TABLE jobs (id INTEGER PRIMARY KEY, company_id INTEGER, title TEXT, company TEXT,
  description TEXT, requirements TEXT, location TEXT, salary_range TEXT, job_type TEXT,
  status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE trust_scores (company_id INTEGER PRIMARY KEY, total_score INTEGER, score_tier TEXT);
CREATE TABLE omni_scores (user_id INTEGER PRIMARY KEY, total_score INTEGER, score_tier TEXT);
CREATE TABLE candidate_profiles (user_id INTEGER PRIMARY KEY, headline TEXT, location TEXT, years_experience INTEGER);
CREATE TABLE candidate_skills (user_id INTEGER, skill_name TEXT, level TEXT, is_verified BOOLEAN);
CREATE TABLE work_experience (user_id INTEGER, title TEXT, company_name TEXT, company TEXT, description TEXT, skills_used TEXT[], start_date DATE);
CREATE TABLE education (user_id INTEGER, degree TEXT, field_of_study TEXT, institution TEXT);
CREATE TABLE candidate_embeddings (user_id INTEGER PRIMARY KEY, embedding vector(1536),
  profile_text TEXT, skills_summary TEXT, experience_summary TEXT, last_updated TIMESTAMP DEFAULT NOW());
CREATE TABLE job_embeddings (job_id INTEGER PRIMARY KEY, embedding vector(1536),
  job_text TEXT, requirements_summary TEXT, last_updated TIMESTAMP DEFAULT NOW());
-- match_results / job_recommendations: migration 008 column shape (FKs omitted
-- in the throwaway DB; trustscore_at_match INTEGER is nullable, as in 008).
CREATE TABLE match_results (
  id SERIAL PRIMARY KEY, candidate_id INTEGER, job_id INTEGER,
  similarity_score DECIMAL(5,4), weighted_score DECIMAL(5,2),
  omniscore_at_match INTEGER, trustscore_at_match INTEGER,
  matching_skills JSONB DEFAULT '[]', missing_skills JSONB DEFAULT '[]',
  match_explanation JSONB, match_level VARCHAR(50),
  calculated_at TIMESTAMP DEFAULT NOW(), UNIQUE(candidate_id, job_id));
CREATE TABLE job_recommendations (
  id SERIAL PRIMARY KEY, user_id INTEGER, job_id INTEGER,
  match_score DECIMAL(5,2), recommendation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_id, job_id));
`;

describeIfDb('#1724 matching-engine TrustScore NULL honesty (real DB)', () => {
	let pool;
	let engine;

	async function seedCandidate(userId, omni) {
		await pool.query(`INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, 'candidate')`, [
			userId,
			`Candidate ${userId}`,
			`c${userId}@example.com`,
		]);
		await pool.query(
			`INSERT INTO candidate_profiles (user_id, headline, location, years_experience)
			 VALUES ($1, 'Engineer', 'Remote', 3)`,
			[userId],
		);
		await pool.query(
			`INSERT INTO candidate_skills (user_id, skill_name, level, is_verified)
			 VALUES ($1, 'JavaScript', 'expert', true)`,
			[userId],
		);
		await pool.query(
			`INSERT INTO candidate_embeddings (user_id, embedding, profile_text, skills_summary, experience_summary)
			 VALUES ($1, $2::vector, 'Engineer JavaScript', 'JavaScript', 'Engineer')`,
			[userId, VECTOR],
		);
		if (typeof omni === 'number') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, $2, 'some_tier')`,
				[userId, omni],
			);
		}
	}

	async function seedJob(jobId, companyId) {
		await pool.query(
			`INSERT INTO jobs (id, company_id, title, company, description, requirements, location, job_type, status)
			 VALUES ($1, $2, 'Engineer', 'Co', 'Build things', 'JavaScript', 'Remote', 'full-time', 'active')`,
			[jobId, companyId],
		);
		await pool.query(
			`INSERT INTO job_embeddings (job_id, embedding, job_text, requirements_summary)
			 VALUES ($1, $2::vector, 'Engineer JavaScript', 'JavaScript')`,
			[jobId, VECTOR],
		);
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		engine = require('../../../services/matching-engine');
		await pool.query(SCHEMA_SQL);
		for (const [id, name] of [
			[COMP_UNMEASURED, 'Unmeasured Co'],
			[COMP_NULL_TOTAL, 'NullTotal Co'],
			[COMP_ZERO, 'Zero Co'],
			[COMP_800, 'Measured Co'],
		]) {
			await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [id, name]);
		}
		// COMP_UNMEASURED deliberately gets NO trust_scores row.
		await pool.query(
			`INSERT INTO trust_scores (company_id, total_score, score_tier) VALUES ($1, NULL, NULL)`,
			[COMP_NULL_TOTAL],
		);
		await pool.query(
			`INSERT INTO trust_scores (company_id, total_score, score_tier) VALUES ($1, 0, 'bronze'), ($2, 800, 'gold')`,
			[COMP_ZERO, COMP_800],
		);
		await seedJob(JOB_UNMEASURED, COMP_UNMEASURED);
		await seedJob(JOB_NULL_TOTAL, COMP_NULL_TOTAL);
		await seedJob(JOB_ZERO, COMP_ZERO);
		await seedJob(JOB_800, COMP_800);
	}, 30000);

	afterAll(async () => {
		await pool.end();
	});

	beforeEach(async () => {
		await pool.query(`DELETE FROM match_results`);
		await pool.query(`DELETE FROM job_recommendations`);
		await pool.query(`DELETE FROM omni_scores`);
		await pool.query(`DELETE FROM candidate_embeddings`);
		await pool.query(`DELETE FROM candidate_skills`);
		await pool.query(`DELETE FROM candidate_profiles`);
		await pool.query(`DELETE FROM users`);
	});

	describe('Site A — findMatchingCandidates', () => {
		test('unmeasured company → trustscore null + marker, renormalized ÷0.90, persisted NULL', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingCandidates(JOB_UNMEASURED, {
				limit: 20,
				minScore: 0.5,
			});
			const m = matches.find((x) => x.candidate_id === CAND_600);
			expect(m).toBeTruthy();
			expect(m.trustscore).toBeNull();
			expect(m.trustscore_status).toBe('insufficient_data');
			expect(m.omniscore).toBe(600);
			expect(m.omniscore_status).toBe('measured');
			// (0.45 + 0.20 + 0.6*0.25) / 0.90 * 100 — no trust term counted.
			expect(m.weighted_score).toBe(88.89);
			expect(m.explanation.company_trustscore).not.toMatch(/\d/);
			expect(m.explanation.company_trustscore).toMatch(/insufficient data/i);
			const persisted = await pool.query(
				`SELECT omniscore_at_match, trustscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_600, JOB_UNMEASURED],
			);
			expect(persisted.rows).toHaveLength(1);
			expect(persisted.rows[0].trustscore_at_match).toBeNull();
			expect(persisted.rows[0].omniscore_at_match).toBe(600);
		});

		test('NULL-total trust_scores row → same honest treatment as no row', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingCandidates(JOB_NULL_TOTAL, {
				limit: 20,
				minScore: 0.5,
			});
			const m = matches.find((x) => x.candidate_id === CAND_600);
			expect(m).toBeTruthy();
			expect(m.trustscore).toBeNull();
			expect(m.trustscore_status).toBe('insufficient_data');
			expect(m.weighted_score).toBe(88.89);
			const persisted = await pool.query(
				`SELECT trustscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_600, JOB_NULL_TOTAL],
			);
			expect(persisted.rows[0].trustscore_at_match).toBeNull();
		});

		test('both missing in one mixed list → ÷0.65 for the no-OmniScore candidate, ÷0.90 for the measured one', async () => {
			await seedCandidate(CAND_600, 600);
			await seedCandidate(CAND_NONE, 'no-row');
			const matches = await engine.findMatchingCandidates(JOB_UNMEASURED, {
				limit: 20,
				minScore: 0.5,
			});
			const m600 = matches.find((x) => x.candidate_id === CAND_600);
			const mNone = matches.find((x) => x.candidate_id === CAND_NONE);
			expect(m600.weighted_score).toBe(88.89);
			expect(mNone).toBeTruthy();
			expect(mNone.trustscore).toBeNull();
			expect(mNone.trustscore_status).toBe('insufficient_data');
			expect(mNone.omniscore).toBeNull();
			expect(mNone.omniscore_status).toBe('insufficient_data');
			// (0.45 + 0.20) / 0.65 * 100 — neither score term counted.
			expect(mNone.weighted_score).toBe(100);
			const persisted = await pool.query(
				`SELECT omniscore_at_match, trustscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_NONE, JOB_UNMEASURED],
			);
			expect(persisted.rows[0].omniscore_at_match).toBeNull();
			expect(persisted.rows[0].trustscore_at_match).toBeNull();
		});

		test('control: measured 0 TrustScore is a real 0, never promoted to 500', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingCandidates(JOB_ZERO, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.candidate_id === CAND_600);
			expect(m.trustscore).toBe(0);
			expect(m.trustscore_status).toBe('measured');
			// (0.45 + 0.20 + 0.15 + 0*0.10) * 100 = 80
			expect(m.weighted_score).toBe(80);
			expect(m.explanation.company_trustscore).toContain('TrustScore 0');
			const persisted = await pool.query(
				`SELECT trustscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_600, JOB_ZERO],
			);
			expect(persisted.rows[0].trustscore_at_match).toBe(0);
		});

		test('control: measured 800 flows exactly as before', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingCandidates(JOB_800, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.candidate_id === CAND_600);
			expect(m.trustscore).toBe(800);
			expect(m.trustscore_status).toBe('measured');
			// (0.45 + 0.20 + 0.15 + 0.8*0.10) * 100 = 88
			expect(m.weighted_score).toBe(88);
			expect(m.explanation.company_trustscore).toContain('800');
			const persisted = await pool.query(
				`SELECT trustscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_600, JOB_800],
			);
			expect(persisted.rows[0].trustscore_at_match).toBe(800);
		});

		test('omni-only missing keeps the #1717 ÷0.75 divisor with trust measured', async () => {
			await seedCandidate(CAND_NONE, 'no-row');
			const matches = await engine.findMatchingCandidates(JOB_800, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.candidate_id === CAND_NONE);
			expect(m.trustscore).toBe(800);
			expect(m.trustscore_status).toBe('measured');
			expect(m.omniscore_status).toBe('insufficient_data');
			// (0.45 + 0.20 + 0.8*0.10) / 0.75 * 100 = 97.33
			expect(m.weighted_score).toBe(97.33);
		});
	});

	describe('Site B — findMatchingJobs', () => {
		test('unmeasured company → trustscore null + marker, renormalized ÷0.75, honest explanation', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingJobs(CAND_600, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.job_id === JOB_UNMEASURED);
			expect(m).toBeTruthy();
			expect(m.trustscore).toBeNull();
			expect(m.trustscore_status).toBe('insufficient_data');
			expect(m.trust_tier).toBeNull();
			// (0.45 + 0.20 + 0.6*0.10) / 0.75 * 100 — no trust term counted.
			expect(m.weighted_score).toBe(94.67);
			expect(m.explanation.company_quality).not.toMatch(/\d/);
			expect(m.explanation.company_quality).toMatch(/insufficient data/i);
		});

		test('both missing → divisor 0.65, both status fields insufficient_data', async () => {
			await seedCandidate(CAND_NONE, 'no-row');
			const matches = await engine.findMatchingJobs(CAND_NONE, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.job_id === JOB_UNMEASURED);
			expect(m).toBeTruthy();
			expect(m.trustscore).toBeNull();
			expect(m.trustscore_status).toBe('insufficient_data');
			expect(m.omniscore).toBeNull();
			expect(m.omniscore_status).toBe('insufficient_data');
			// (0.45 + 0.20) / 0.65 * 100 = 100
			expect(m.weighted_score).toBe(100);
		});

		test('control: measured 0 TrustScore is a real 0, never promoted to 500', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingJobs(CAND_600, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.job_id === JOB_ZERO);
			expect(m.trustscore).toBe(0);
			expect(m.trustscore_status).toBe('measured');
			// (0.45 + 0.20 + 0*0.25 + 0.6*0.10) * 100 = 71
			expect(m.weighted_score).toBe(71);
		});

		test('control: measured 800 flows exactly as before, tier from the row', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingJobs(CAND_600, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.job_id === JOB_800);
			expect(m.trustscore).toBe(800);
			expect(m.trustscore_status).toBe('measured');
			expect(m.trust_tier).toBe('gold');
			// (0.45 + 0.20 + 0.8*0.25 + 0.6*0.10) * 100 = 91
			expect(m.weighted_score).toBe(91);
			expect(m.explanation.company_quality).toBe('Company TrustScore 800 (gold tier)');
		});

		test('omni-only missing keeps the #1717 ÷0.90 divisor with trust measured', async () => {
			await seedCandidate(CAND_NONE, 'no-row');
			const matches = await engine.findMatchingJobs(CAND_NONE, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.job_id === JOB_800);
			expect(m.trustscore).toBe(800);
			expect(m.trustscore_status).toBe('measured');
			expect(m.omniscore_status).toBe('insufficient_data');
			// (0.45 + 0.20 + 0.8*0.25) / 0.90 * 100 = 94.44
			expect(m.weighted_score).toBe(94.44);
		});
	});

	describe('explainMatch', () => {
		test('on-demand return carries both score fields and both status fields', async () => {
			await seedCandidate(CAND_600, 600);
			const result = await engine.explainMatch(CAND_600, JOB_UNMEASURED);
			expect(result.trustscore).toBeNull();
			expect(result.trustscore_status).toBe('insufficient_data');
			expect(result.omniscore).toBe(600);
			expect(result.omniscore_status).toBe('measured');
			expect(result.weighted_score).toBe(88.89);
		});

		test('cached branch returns the persisted row with trustscore_at_match NULL', async () => {
			await seedCandidate(CAND_600, 600);
			await engine.findMatchingCandidates(JOB_UNMEASURED, { limit: 20, minScore: 0.5 });
			const result = await engine.explainMatch(CAND_600, JOB_UNMEASURED);
			expect(result.trustscore_at_match).toBeNull();
			expect(result.omniscore_at_match).toBe(600);
		});
	});
});
