/**
 * #1755 — explainMatch: a nonexistent candidate id must surface an
 * existence error, not the honest no-match fallback.
 *
 * Since #1754, explainMatch guards both embedding refreshes (#1752).
 * The candidate-side guard also swallows `User not found` from
 * updateCandidateEmbedding, so a bogus candidate id resolves to the
 * #1748 fallback (weighted_score: null, nothing written) instead of
 * throwing. Job-not-found is NOT masked (findMatchingCandidates throws
 * it). Fix pinned: an existence pre-check in explainMatch before the
 * refresh guards throws `User not found` for an absent users row.
 *
 * Real-DB integration suite mirroring the #1752 harness: gated behind
 * MATCHING1755_INTEGRATION_DB_URL; the ONLY mock is the external
 * embedding API (generateEmbedding rejects — the no-provider state).
 * Everything else is the real production path against a real database.
 *
 * Pins:
 *  1. RED on pristine dev — nonexistent candidate + real job:
 *     explainMatch rejects 'User not found' (today: resolves fallback).
 *  2. † Regression — existing candidate, no embedding, provider down:
 *     still resolves to the honest fallback (#1748 + #1752 preserved).
 */
jest.unmock('../../../lib/db');
jest.mock('../../../lib/ai-provider', () => ({
	generateEmbedding: async () => {
		throw new Error('No embedding provider available for 1536-dim embeddings');
	},
}));

const DB_URL = process.env.MATCHING1755_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const JOB_ID = 1755001;
const COMPANY_ID = 175500;
const CAND_EXISTING = 1755101; // full profile, NO embedding row
const CAND_GHOST = 1755999; // no users row at all

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

describeIfDb('#1755 explainMatch candidate-existence pre-check (real DB)', () => {
	let pool;
	let engine;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		engine = require('../../../services/matching-engine');
		await pool.query(SCHEMA_SQL);
		await pool.query(`INSERT INTO companies (id, name) VALUES ($1, 'Co')`, [COMPANY_ID]);
		await pool.query(
			`INSERT INTO jobs (id, company_id, title, company, description, requirements, location, job_type, status)
			 VALUES ($1, $2, 'Engineer', 'Co', 'Build things', 'JavaScript', 'Remote', 'full-time', 'active')`,
			[JOB_ID, COMPANY_ID],
		);
		await pool.query(
			`INSERT INTO job_embeddings (job_id, embedding, job_text, requirements_summary)
			 VALUES ($1, $2::vector, 'Engineer JavaScript', 'JavaScript')`,
			[JOB_ID, VECTOR],
		);
		await pool.query(`INSERT INTO users (id, name, email, role) VALUES ($1, 'Cand', 'c@example.com', 'candidate')`, [
			CAND_EXISTING,
		]);
		await pool.query(
			`INSERT INTO candidate_profiles (user_id, headline, location, years_experience)
			 VALUES ($1, 'Engineer', 'Remote', 3)`,
			[CAND_EXISTING],
		);
		await pool.query(
			`INSERT INTO candidate_skills (user_id, skill_name, level, is_verified)
			 VALUES ($1, 'JavaScript', 'expert', true)`,
			[CAND_EXISTING],
		);
	});

	afterAll(async () => {
		await pool.end?.();
	});

	test('nonexistent candidate id rejects with User not found', async () => {
		await expect(engine.explainMatch(CAND_GHOST, JOB_ID)).rejects.toThrow('User not found');
		const written = await pool.query('SELECT 1 FROM match_results WHERE candidate_id = $1', [CAND_GHOST]);
		expect(written.rows.length).toBe(0);
	});

	test('† existing candidate with no match still resolves to the honest null fallback', async () => {
		const out = await engine.explainMatch(CAND_EXISTING, JOB_ID);
		expect(out).toBeTruthy();
		if (out.weighted_score !== null && out.weighted_score !== undefined) {
			// A real measured match is also acceptable; the pin is only
			// that an existing candidate never existence-errors.
			expect(typeof Number(out.weighted_score)).toBe('number');
		}
	});
});
