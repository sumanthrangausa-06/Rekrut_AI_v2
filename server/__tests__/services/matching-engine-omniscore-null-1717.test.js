/**
 * #1717 — reader-side `omniscore || 300` re-fabricates a 300 OmniScore.
 *
 * Panel position (DISCUSSION.md §3, adopted verbatim at STOP 1):
 *  - Site A (findMatchingCandidates, matching-engine.js:478): when the
 *    candidate's OmniScore is NULL (no omni_scores row, or a row whose
 *    total_score is honestly NULL per #1192), exclude the OmniScore term
 *    and renormalize the remaining weights ÷0.75; return `omniscore: null`
 *    plus an `omniscore_status: 'insufficient_data'` marker; the
 *    explanation must carry no OmniScore number; persist
 *    `match_results.omniscore_at_match = NULL` (nullable, migration 008).
 *  - Site B (findMatchingJobs, matching-engine.js:611): same treatment
 *    with this function's weights (similarity 45 / skills 20 /
 *    TrustScore 25 / OmniScore 10 → renormalize ÷0.90); match levels and
 *    success prediction derive only from measured components; a
 *    brand-new candidate still gets recommendations.
 *  - A genuinely measured score — including a measured 0 — flows exactly
 *    as before (#1192: a measured 0 stays distinguishable from null).
 *
 * Real-DB integration suite (legal-hold-db precedent): gated behind
 * MATCHING1717_INTEGRATION_DB_URL so environments without a disposable
 * Postgres skip gracefully. The test database is throwaway: the suite
 * drops and recreates the minimal table set the matching engine reads,
 * with `match_results` carrying migration 008's exact column shape
 * (omniscore_at_match INTEGER, nullable).
 *
 * Example:
 *   MATCHING1717_INTEGRATION_DB_URL='postgresql://root@/rekrut_1717_test?host=/var/run/postgresql' \
 *     npx jest server/__tests__/services/matching-engine-omniscore-null-1717.test.js --forceExit
 *
 * Fixture geometry (chosen so every expected score is exact):
 *   candidate embedding == job embedding  → similarity_score = 1
 *   candidate skill 'JavaScript', job requirements 'JavaScript'
 *                                       → skill_match_pct = 100
 *   company TrustScore 1000 (measured)  → trustNormalized = 1
 * Site A measured formula:  (1*.45 + 1*.20 + omni/1000*.25 + 1*.10) * 100
 * Site A renormalized:      (1*.45 + 1*.20 + 1*.10) / 0.75 * 100 = 100
 * Site B measured formula:  (1*.45 + 1*.20 + 1*.25 + omni/1000*.10) * 100
 * Site B renormalized:      (1*.45 + 1*.20 + 1*.25) / 0.90 * 100 = 100
 */
jest.unmock('../../../lib/db');

const DB_URL = process.env.MATCHING1717_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const JOB_ID = 1717001;
const COMPANY_ID = 171701;
const CAND_NO_ROW = 1717101; // no omni_scores row at all
const CAND_NULL_TOTAL = 1717102; // omni_scores row, total_score NULL (#1192)
const CAND_600 = 1717103; // measured 600
const CAND_0 = 1717104; // measured 0

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
-- in the throwaway DB; omniscore_at_match INTEGER is nullable, as in 008).
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

describeIfDb('#1717 matching-engine OmniScore NULL honesty (real DB)', () => {
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
		if (omni === 'row-null') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, NULL, NULL)`,
				[userId],
			);
		} else if (typeof omni === 'number') {
			await pool.query(
				`INSERT INTO omni_scores (user_id, total_score, score_tier) VALUES ($1, $2, 'some_tier')`,
				[userId, omni],
			);
		}
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		// No AI providers configured → generateEmbedding fails fast and the
		// engine's non-blocking embedding refresh is skipped (seeded
		// embeddings below are the ones actually read).
		process.env.AI_KEYS_JSON = '{}';
		jest.resetModules();
		pool = require('../../../lib/db');
		engine = require('../../../services/matching-engine');
		await pool.query(SCHEMA_SQL);
		await pool.query(`INSERT INTO companies (id, name) VALUES ($1, 'Acme')`, [COMPANY_ID]);
		await pool.query(
			`INSERT INTO trust_scores (company_id, total_score, score_tier) VALUES ($1, 1000, 'elite')`,
			[COMPANY_ID],
		);
		await pool.query(
			`INSERT INTO jobs (id, company_id, title, company, description, requirements, location, job_type, status)
			 VALUES ($1, $2, 'Engineer', 'Acme', 'Build things', 'JavaScript', 'Remote', 'full-time', 'active')`,
			[JOB_ID, COMPANY_ID],
		);
		await pool.query(
			`INSERT INTO job_embeddings (job_id, embedding, job_text, requirements_summary)
			 VALUES ($1, $2::vector, 'Engineer JavaScript', 'JavaScript')`,
			[JOB_ID, VECTOR],
		);
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
		test('no omni_scores row → omniscore null + marker, renormalized score, persisted NULL', async () => {
			await seedCandidate(CAND_NO_ROW, 'no-row');
			const matches = await engine.findMatchingCandidates(JOB_ID, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.candidate_id === CAND_NO_ROW);
			expect(m).toBeTruthy();
			expect(m.omniscore).toBeNull();
			expect(m.omniscore_status).toBe('insufficient_data');
			// (0.45 + 0.20 + 0.10) / 0.75 * 100 — no OmniScore term counted.
			expect(m.weighted_score).toBe(100);
			expect(m.match_level).toBe('excellent');
			expect(m.explanation.omniscore_boost).not.toMatch(/\d/);
			expect(m.explanation.omniscore_boost).toMatch(/insufficient data/i);
			const persisted = await pool.query(
				`SELECT omniscore_at_match, weighted_score FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_NO_ROW, JOB_ID],
			);
			expect(persisted.rows).toHaveLength(1);
			expect(persisted.rows[0].omniscore_at_match).toBeNull();
			expect(Number(persisted.rows[0].weighted_score)).toBe(100);
		});

		test('NULL-total omni_scores row → same honest treatment as no row', async () => {
			await seedCandidate(CAND_NULL_TOTAL, 'row-null');
			const matches = await engine.findMatchingCandidates(JOB_ID, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.candidate_id === CAND_NULL_TOTAL);
			expect(m).toBeTruthy();
			expect(m.omniscore).toBeNull();
			expect(m.omniscore_status).toBe('insufficient_data');
			expect(m.weighted_score).toBe(100);
			expect(m.explanation.omniscore_boost).not.toMatch(/\d/);
			const persisted = await pool.query(
				`SELECT omniscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_NULL_TOTAL, JOB_ID],
			);
			expect(persisted.rows[0].omniscore_at_match).toBeNull();
		});

		test('control: measured 600 flows exactly as before', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingCandidates(JOB_ID, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.candidate_id === CAND_600);
			expect(m.omniscore).toBe(600);
			// (0.45 + 0.20 + 0.6*0.25 + 0.10) * 100 = 90
			expect(m.weighted_score).toBe(90);
			expect(m.explanation.omniscore_boost).toContain('600');
			const persisted = await pool.query(
				`SELECT omniscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_600, JOB_ID],
			);
			expect(persisted.rows[0].omniscore_at_match).toBe(600);
		});

		test('control: measured 0 is scored as a real 0, never skipped or rewritten', async () => {
			await seedCandidate(CAND_0, 0);
			const matches = await engine.findMatchingCandidates(JOB_ID, { limit: 20, minScore: 0.5 });
			const m = matches.find((x) => x.candidate_id === CAND_0);
			expect(m.omniscore).toBe(0);
			// (0.45 + 0.20 + 0*0.25 + 0.10) * 100 = 75
			expect(m.weighted_score).toBe(75);
			const persisted = await pool.query(
				`SELECT omniscore_at_match FROM match_results WHERE candidate_id = $1 AND job_id = $2`,
				[CAND_0, JOB_ID],
			);
			expect(persisted.rows[0].omniscore_at_match).toBe(0);
		});
	});

	describe('Site B — findMatchingJobs', () => {
		test('NULL candidate still gets recommendations, renormalized ÷0.90, no phantom term', async () => {
			await seedCandidate(CAND_NO_ROW, 'no-row');
			const matches = await engine.findMatchingJobs(CAND_NO_ROW, { limit: 20, minScore: 0.5 });
			expect(matches).toHaveLength(1);
			const m = matches[0];
			expect(m.job_id).toBe(JOB_ID);
			expect(m.omniscore).toBeNull();
			expect(m.omniscore_status).toBe('insufficient_data');
			// (0.45 + 0.20 + 0.25) / 0.90 * 100 = 100 — derived only from measured parts.
			expect(m.weighted_score).toBe(100);
			expect(m.match_level).toBe('excellent');
			expect(m.success_prediction).toBe('Very High');
			expect(m.explanation.your_strength).toMatch(/No OmniScore yet/i);
			const persisted = await pool.query(
				`SELECT match_score FROM job_recommendations WHERE user_id = $1 AND job_id = $2`,
				[CAND_NO_ROW, JOB_ID],
			);
			expect(persisted.rows).toHaveLength(1);
			expect(Number(persisted.rows[0].match_score)).toBe(100);
		});

		test('control: measured 600 candidate scores exactly as before', async () => {
			await seedCandidate(CAND_600, 600);
			const matches = await engine.findMatchingJobs(CAND_600, { limit: 20, minScore: 0.5 });
			expect(matches).toHaveLength(1);
			// (0.45 + 0.20 + 0.25 + 0.6*0.10) * 100 = 96
			expect(matches[0].weighted_score).toBe(96);
			expect(matches[0].explanation.your_strength).toBe(
				'Your OmniScore is solid for this position',
			);
		});

		test('control: measured 0 candidate is scored with a real 0 term', async () => {
			await seedCandidate(CAND_0, 0);
			const matches = await engine.findMatchingJobs(CAND_0, { limit: 20, minScore: 0.5 });
			expect(matches).toHaveLength(1);
			// (0.45 + 0.20 + 0.25 + 0*0.10) * 100 = 90
			expect(matches[0].weighted_score).toBe(90);
		});
	});
});
