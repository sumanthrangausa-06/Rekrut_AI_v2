/**
 * #1748 — explainMatch's on-demand no-match fallback returns
 * `weighted_score: 0` — a producer-side invented score. Nothing was
 * measured for that candidate/job pair (the candidate was not among the
 * matches findMatchingCandidates computed), so the honest value is
 * `weighted_score: null` — the same honest-null pattern #1717/#1724
 * shipped for OmniScore/TrustScore and #1731 Lane 3 relies on when it
 * records this value as the audit log's `confidence`
 * (measuredConfidenceValue: null -> confidence null; 0 -> confidence 0,
 * a measured-looking zero written into the compliance record).
 *
 * Scope (STOP 1 on #1748): only the no-match fallback changes. A
 * measured weighted_score from the engine's renormalised calculations
 * — including any legitimate measured value on the on-demand matched
 * branch and the cached match_results branch — must flow unchanged.
 *
 * Real-DB integration suite (mirrors the #1724 harness): gated behind
 * MATCHING1748_INTEGRATION_DB_URL so environments without a disposable
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
 * scoring layer — and nothing about explainMatch itself — is mocked.
 *
 * No-match geometry: the target candidate is a bare `users` row with no
 * profile, no skills and no candidate_embeddings row.
 * updateCandidateEmbedding therefore finds an empty profile text and
 * skips the upsert, so findMatchingCandidates (INNER JOIN
 * candidate_embeddings) can never return the target — explainMatch
 * reaches its no-match fallback by the real code path.
 *
 * Example:
 *   MATCHING1748_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55448/rekrut_1748_test' \
 *     npx jest server/__tests__/services/matching-engine-explainmatch-null-1748.test.js --forceExit
 */
jest.unmock('../../../lib/db');
jest.mock('../../../lib/ai-provider', () => ({
	generateEmbedding: async () => [1, ...Array(1535).fill(0)],
}));

const DB_URL = process.env.MATCHING1748_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const COMP_UNMEASURED = 174801; // no trust_scores row at all
const JOB_ID = 1748001;
const CAND_MATCHED = 1748103; // measured OmniScore 600, full profile
const CAND_NO_MATCH = 1748101; // bare users row — never matchable

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

describeIfDb('#1748 explainMatch no-match fallback honesty (real DB)', () => {
	let pool;
	let engine;

	async function seedMatchedCandidate(userId, omni) {
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
		await pool.query(`INSERT INTO companies (id, name) VALUES ($1, 'Unmeasured Co')`, [
			COMP_UNMEASURED,
		]);
		// COMP_UNMEASURED deliberately gets NO trust_scores row.
		await seedJob(JOB_ID, COMP_UNMEASURED);
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

	test('no-match fallback: weighted_score is null (nothing measured), never invented 0', async () => {
		// Bare users row only: no profile, no skills, no embedding — the
		// on-demand calculation cannot return this candidate as a match.
		await pool.query(`INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, 'candidate')`, [
			CAND_NO_MATCH,
			`Candidate ${CAND_NO_MATCH}`,
			`c${CAND_NO_MATCH}@example.com`,
		]);

		const result = await engine.explainMatch(CAND_NO_MATCH, JOB_ID);

		expect(result.match_level).toBe('none');
		expect(result.weighted_score).toBeNull();
		expect(result.explanation.reason).toContain('does not meet minimum requirements');
	});

	test('on-demand matched branch unchanged: measured weighted_score flows exactly as before', async () => {
		await seedMatchedCandidate(CAND_MATCHED, 600);

		const result = await engine.explainMatch(CAND_MATCHED, JOB_ID);

		// Same geometry as #1724: similarity 1, skills 100, omni 600,
		// trust unmeasured -> (0.45 + 0.20 + 0.6*0.25) / 0.90 * 100 = 88.89
		expect(result.weighted_score).toBe(88.89);
		expect(result.omniscore).toBe(600);
		expect(result.omniscore_status).toBe('measured');
		expect(result.trustscore).toBeNull();
		expect(result.trustscore_status).toBe('insufficient_data');
	});
});
