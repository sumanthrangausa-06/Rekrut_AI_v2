/**
 * #1752 — explainMatch's on-demand branch calls
 * updateCandidateEmbedding(candidateId) and updateJobEmbedding(jobId)
 * UNGUARDED before findMatchingCandidates. When no 1536-dim embedding
 * leg is live, generateEmbedding throws (and a wrong-dimension upsert
 * can throw PG 22000), so GET /api/matching/explain/:candidateId/:jobId
 * 500s for every uncached pair and never reaches the honest no-match
 * fallback (#1748: weighted_score: null).
 *
 * Sibling code in the same file already tolerates embedding absence:
 * findMatchingCandidates wraps updateJobEmbedding and findMatchingJobs
 * wraps updateCandidateEmbedding in try/catch + console.warn and
 * continues with whatever embeddings exist. explainMatch must do the
 * same for BOTH refresh calls.
 *
 * Real-DB integration suite (mirrors the #1748 harness): gated behind
 * MATCHING1752_INTEGRATION_DB_URL so environments without a disposable
 * Postgres skip gracefully. The test database is throwaway: the suite
 * drops and recreates the minimal table set the matching engine reads,
 * with `match_results` carrying migration 008's exact column shape.
 *
 * The ONLY mock is the external embedding API (lib/ai-provider): its
 * generateEmbedding REJECTS, simulating the no-provider state that
 * triggers #1752. Everything else — explainMatch, both embedding
 * updaters, findMatchingCandidates, all SQL, scoring and persistence —
 * is the real production code path against the real database.
 *
 * Both candidates have a FULL profile (headline + skills), so
 * updateCandidateEmbedding builds non-empty profile text and actually
 * calls generateEmbedding — unlike #1748's bare-row geometry, where
 * the refresh skipped generation and the throw was unreachable.
 *
 * Example:
 *   MATCHING1752_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55448/rekrut_1752_test' \
 *     npx jest server/__tests__/services/matching-engine-explainmatch-embedding-guard-1752.test.js --forceExit
 */
jest.unmock('../../../lib/db');
jest.mock('../../../lib/ai-provider', () => ({
	generateEmbedding: async () => {
		throw new Error('No embedding provider available for 1536-dim embeddings');
	},
}));

const DB_URL = process.env.MATCHING1752_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const COMP_UNMEASURED = 175201; // no trust_scores row at all
const JOB_ID = 1752001;
const CAND_MATCHED = 1752103; // pre-seeded embedding, measured OmniScore 600
const CAND_NO_MATCH = 1752101; // full profile, NO embedding row

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

describeIfDb('#1752 explainMatch embedding-refresh guard (real DB, provider down)', () => {
	let pool;
	let engine;

	async function seedFullProfileCandidate(userId, { withEmbedding = false, omni = null } = {}) {
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
		if (withEmbedding) {
			await pool.query(
				`INSERT INTO candidate_embeddings (user_id, embedding, profile_text, skills_summary, experience_summary)
				 VALUES ($1, $2::vector, 'Engineer JavaScript', 'JavaScript', 'Engineer')`,
				[userId, VECTOR],
			);
		}
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

	test('uncached pair, embedding provider down: explainMatch does NOT throw — honest no-match fallback (weighted_score null)', async () => {
		// Full profile, no embedding row: the refresh is attempted, the
		// provider throws, and findMatchingCandidates can never return
		// this candidate (INNER JOIN candidate_embeddings).
		await seedFullProfileCandidate(CAND_NO_MATCH);

		const result = await engine.explainMatch(CAND_NO_MATCH, JOB_ID);

		expect(result.match_level).toBe('none');
		expect(result.weighted_score).toBeNull();
		expect(result.explanation.reason).toContain('does not meet minimum requirements');
	});

	test('uncached pair, embedding provider down, pre-existing embedding: explainMatch still computes the measured match', async () => {
		// The refresh fails but an embedding row already exists, so the
		// guard must continue with whatever embeddings exist — the same
		// geometry as #1748/#1724: similarity 1, skills 100, omni 600,
		// trust unmeasured -> (0.45 + 0.20 + 0.6*0.25) / 0.90 * 100 = 88.89
		await seedFullProfileCandidate(CAND_MATCHED, { withEmbedding: true, omni: 600 });

		const result = await engine.explainMatch(CAND_MATCHED, JOB_ID);

		expect(result.weighted_score).toBe(88.89);
		expect(result.omniscore).toBe(600);
		expect(result.omniscore_status).toBe('measured');
		expect(result.trustscore).toBeNull();
		expect(result.trustscore_status).toBe('insufficient_data');
	});
});
