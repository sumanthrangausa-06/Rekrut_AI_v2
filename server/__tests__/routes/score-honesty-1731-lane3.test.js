/**
 * #1731 Lane 3 (S-8/S-9/S-10/S-11) — score honesty, real-DB suite.
 *
 *  S-8 routes/matching.js audit-log confidence (:80, :130, :215):
 *      `m.final_score || m.score || 0` / `explanation?.score || … || 0.5`
 *      read fields the matching producers never carry (they carry
 *      `weighted_score`), so compliance audit records fabricate
 *      confidence 0 for every real match set and an invented 0.5 for
 *      explanations. Honest: record the measured `weighted_score`
 *      (max across the set); `confidence: null` when nothing measured.
 *  S-9 routes/memory.js GET /match-breakdown:
 *      `overall_score: match.weighted_score || 0`, skills `: 50`
 *      fallback, OmniScore components `|| 0` ×4 — a candidate with no
 *      match row / NULL components is shown invented numbers in the
 *      same object whose total is already `?? null`. Honest:
 *      guard-NULL with the file's own `available:` pattern.
 *  S-10 lib/career-coach-ai.js generateCompanyBrief prompt:
 *      TrustScore components `|| 0` ×5 tell the AI a company was
 *      measured at 0 when it was never measured. Honest: 'N/A' per
 *      component (measured 0 still renders 0).
 *  S-11 routes/recruiter-introductions.js cached branches (:159, :172):
 *      `Math.round(cachedMatch.rows[0].weighted_score || 0)` — a NULL
 *      cached score is judged as a measured 0 at the Top-5 gate.
 *      Honest: NULL = no evidence — fitScore stays null, gate fails
 *      with the existing 403, nothing persisted.
 *
 * Real-DB integration suite (Lane 1/2 pattern): routes/services run
 * against a throwaway Postgres behind SCORE1731_LANE3_INTEGRATION_DB_URL.
 * Only auth / rbac / subscription / email / side-effect services and the
 * matching-engine PRODUCER (S-8/S-11 upstream) are mocked; the
 * AuditLogger mock is a capture (the assertion target is the metadata
 * the route hands it — the honesty behaviour lives in the route).
 *
 * Example:
 *   SCORE1731_LANE3_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55434/rekrut_1731_lane3_test' \
 *     npx jest server/__tests__/routes/score-honesty-1731-lane3.test.js --forceExit
 */
jest.unmock('../../../lib/db');

jest.mock('../../../lib/auth', () => {
	const passthrough = (_req, _res, next) => next();
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = {
			id: parseInt(req.headers['x-test-user-id'] || '11', 10),
			role: req.headers['x-test-role'] || 'candidate',
			company_id: req.headers['x-test-company-id']
				? parseInt(req.headers['x-test-company-id'], 10)
				: null,
		};
		return next();
	});
	return {
		authMiddleware,
		requireRole: () => passthrough,
		requireApprovedRecruiter: passthrough,
		requireNotSuspended: passthrough,
		requireEmployer: passthrough,
		optionalAuth: passthrough,
	};
});
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../../../lib/subscription', () => ({
	requireFeature: () => (_req, _res, next) => next(),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/memory-service', () => ({}));
jest.mock('../../../services/autofill-service', () => ({}));

// Audit capture — S-8 asserts on the metadata the route records.
const auditLogCalls = [];
jest.mock('../../../services/auditLogService', () => ({
	EVENT_TYPES: {},
	ENTITY_TYPES: {},
	logEvent: jest.fn().mockResolvedValue(undefined),
	AuditLogger: {
		log: jest.fn(async (entry) => {
			auditLogCalls.push(entry);
		}),
	},
}));

// Matching-engine producer — controlled per test (S-8 inputs; S-11
// availability). The expressions under test live in the routes.
const engineState = {
	mode: 'ok', // 'ok' | 'throw' | 'absent'
	jobs: [],
	candidates: [],
	explanation: null,
};
jest.mock('../../../services/matching-engine', () => ({
	findMatchingJobs: jest.fn(async () => {
		if (engineState.mode === 'throw') throw new Error('engine down');
		return engineState.jobs;
	}),
	findMatchingCandidates: jest.fn(async () => {
		if (engineState.mode === 'throw') throw new Error('engine down');
		return engineState.candidates;
	}),
	explainMatch: jest.fn(async () => engineState.explanation),
	updateCandidateEmbedding: jest.fn().mockResolvedValue(undefined),
	updateJobEmbedding: jest.fn().mockResolvedValue(undefined),
}));

// Career-coach AI transport — capture the prompt (S-10 assertion target
// is the prompt text the lib builds, not the provider).
const chatCalls = [];
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async (messages) => {
		chatCalls.push(messages);
		return { content: '{"summary":"ok"}' };
	}),
	safeParseJSON: (text, fallback) => {
		try {
			return JSON.parse(text);
		} catch {
			return fallback;
		}
	},
	withTimeout: (p) => p,
}));

const request = require('supertest');
const express = require('express');

const DB_URL = process.env.SCORE1731_LANE3_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

// matching_skills/missing_skills are TEXT here: routes/memory.js
// JSON.parse()s them (its assumed contract; the live JSONB shape is
// exercised separately by the assembled-app journey gate).
const SCHEMA_SQL = `
DROP TABLE IF EXISTS user_notifications, recruiter_introductions, candidate_intro_quota,
  assessment_sessions, interviews, match_results, omni_scores, candidate_skills,
  work_experience, education, portfolio_projects, candidate_feedback, trust_scores,
  candidate_profiles, jobs, companies, users CASCADE;
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT, company_id INTEGER);
CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT, industry TEXT, company_size TEXT,
  headquarters TEXT, description TEXT, is_verified BOOLEAN);
CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, user_id INTEGER, company_id INTEGER,
  status TEXT, min_experience INTEGER, location TEXT);
CREATE TABLE candidate_profiles (user_id INTEGER PRIMARY KEY, years_experience INTEGER,
  location TEXT, phone TEXT, headline TEXT, bio TEXT, resume_url TEXT, linkedin_url TEXT);
CREATE TABLE candidate_skills (user_id INTEGER, skill_name TEXT, level INTEGER, category TEXT,
  years_experience INTEGER, is_verified BOOLEAN);
CREATE TABLE work_experience (user_id INTEGER, title TEXT, company_name TEXT,
  start_date DATE, end_date DATE, is_current BOOLEAN, description TEXT, skills_used TEXT);
CREATE TABLE education (user_id INTEGER, degree TEXT, field_of_study TEXT, institution TEXT, end_date DATE);
CREATE TABLE portfolio_projects (user_id INTEGER, title TEXT, technologies TEXT, highlights TEXT, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE omni_scores (user_id INTEGER PRIMARY KEY, total_score INTEGER, score_tier TEXT,
  interview_score INTEGER, technical_score INTEGER, resume_score INTEGER, behavior_score INTEGER);
CREATE TABLE match_results (candidate_id INTEGER, job_id INTEGER, weighted_score DECIMAL(5,2),
  omniscore_at_match INTEGER, trustscore_at_match INTEGER,
  similarity_score DECIMAL(5,4), match_level TEXT, matching_skills TEXT, missing_skills TEXT);
CREATE TABLE interviews (user_id INTEGER, overall_score NUMERIC);
CREATE TABLE assessment_sessions (user_id INTEGER, score NUMERIC, status TEXT);
CREATE TABLE candidate_intro_quota (candidate_id INTEGER PRIMARY KEY, week_start DATE,
  used_count INTEGER, max_count INTEGER, updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE recruiter_introductions (id SERIAL PRIMARY KEY, candidate_id INTEGER, job_id INTEGER,
  recruiter_id INTEGER, company_id INTEGER, status TEXT, fit_score_at_request NUMERIC,
  rank_at_request INTEGER, request_message TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE user_notifications (user_id INTEGER, type TEXT, title TEXT, message TEXT, metadata TEXT, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE trust_scores (company_id INTEGER PRIMARY KEY, total_score INTEGER,
  verification_score INTEGER, job_authenticity_score INTEGER, hiring_ratio_score INTEGER,
  feedback_score INTEGER, behavior_score INTEGER);
CREATE TABLE candidate_feedback (company_id INTEGER, rating NUMERIC);
`;

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/matching', require('../../../routes/matching'));
	app.use('/api/memory', require('../../../routes/memory'));
	app.use('/api/recruiter-intros', require('../../../routes/recruiter-introductions'));
	return app;
}

describeIfDb('#1731 Lane 3 — score honesty (S-8/S-9/S-10/S-11)', () => {
	let pool;
	let app;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		await pool.query(SCHEMA_SQL);
		app = buildApp();
	});

	afterAll(async () => {
		if (pool) await pool.end();
	});

	beforeEach(async () => {
		auditLogCalls.length = 0;
		chatCalls.length = 0;
		engineState.mode = 'ok';
		engineState.jobs = [];
		engineState.candidates = [];
		engineState.explanation = null;
		await pool.query(
			'TRUNCATE user_notifications, recruiter_introductions, candidate_intro_quota, match_results, omni_scores, candidate_profiles, jobs, companies, users, trust_scores, candidate_feedback RESTART IDENTITY CASCADE',
		);
		await pool.query(
			`INSERT INTO users (id, name, email, role, company_id) VALUES
       (11, 'Cand One', 'c1@example.com', 'candidate', NULL),
       (12, 'Cand Two', 'c2@example.com', 'candidate', NULL),
       (21, 'Rec One', 'r1@example.com', 'recruiter', 5)`,
		);
		await pool.query(
			`INSERT INTO companies (id, name) VALUES (5, 'Acme'), (6, 'OtherCo')`,
		);
		await pool.query(
			`INSERT INTO jobs (id, title, user_id, company_id, status, min_experience, location)
       VALUES (31, 'Engineer', 21, 5, 'active', 0, 'Remote')`,
		);
	});

	// ── S-8: audit-log confidence ─────────────────────────────────────
	test('S-8a recommendations: confidence is the measured weighted_score, not fabricated 0', async () => {
		engineState.jobs = [{ weighted_score: 0.62 }, { weighted_score: 0.87 }];
		const res = await request(app)
			.get('/api/matching/recommendations')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		const call = auditLogCalls.find((c) => c.actionType === 'matching_decision');
		expect(call).toBeTruthy();
		expect(call.metadata.confidence).toBe(0.87);
	});

	test('S-8b recommendations: empty match set records confidence null, not 0', async () => {
		engineState.jobs = [];
		const res = await request(app)
			.get('/api/matching/recommendations')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		const call = auditLogCalls.find((c) => c.actionType === 'matching_decision');
		expect(call.metadata.confidence).toBeNull();
	});

	test('S-8c candidates-for-job: confidence is the measured weighted_score', async () => {
		engineState.candidates = [{ weighted_score: 0.42 }, { weighted_score: 0.71 }];
		const res = await request(app)
			.get('/api/matching/candidates/31')
			.set('x-test-user-id', '21')
			.set('x-test-role', 'recruiter');
		expect(res.status).toBe(200);
		const call = auditLogCalls.find((c) => c.actionType === 'matching_decision');
		expect(call.metadata.confidence).toBe(0.71);
	});

	test('S-8d explain: measured weighted_score recorded; no-score explanation records null, never invented 0.5', async () => {
		engineState.explanation = { weighted_score: 0.66, match_level: 'good' };
		let res = await request(app)
			.get('/api/matching/explain/11/31')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		let call = auditLogCalls.find((c) => c.actionType === 'ai_explanation_generated');
		expect(call.metadata.confidence).toBe(0.66);

		auditLogCalls.length = 0;
		engineState.explanation = { match_level: 'none', explanation: { reason: 'no match' } };
		res = await request(app)
			.get('/api/matching/explain/11/31')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		call = auditLogCalls.find((c) => c.actionType === 'ai_explanation_generated');
		expect(call.metadata.confidence).toBeNull();
	});

	test('S-8e explain (F-1): cached-row STRING weighted_score is recorded as the measured value, not null', async () => {
		// explainMatch's cached path returns the raw match_results row —
		// weighted_score is DECIMAL(5,2), which node-pg returns as a
		// string. The audit record must carry the measured value.
		engineState.explanation = { weighted_score: '0.66', match_level: 'good' };
		let res = await request(app)
			.get('/api/matching/explain/11/31')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		let call = auditLogCalls.find((c) => c.actionType === 'ai_explanation_generated');
		expect(call.metadata.confidence).toBe(0.66);

		auditLogCalls.length = 0;
		engineState.explanation = { weighted_score: '0.00', match_level: 'none' };
		res = await request(app)
			.get('/api/matching/explain/11/31')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		call = auditLogCalls.find((c) => c.actionType === 'ai_explanation_generated');
		expect(call.metadata.confidence).toBe(0);
	});

	test('S-8f recommendations: a measured-0 match set records confidence 0, not null', async () => {
		engineState.jobs = [{ weighted_score: 0 }];
		const res = await request(app)
			.get('/api/matching/recommendations')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		const call = auditLogCalls.find((c) => c.actionType === 'matching_decision');
		expect(call.metadata.confidence).toBe(0);
	});

	// ── S-9: match-breakdown display ──────────────────────────────────
	test('S-9a no match row + NULL omni components: overall null, skills null/unavailable, components null', async () => {
		await pool.query(
			`INSERT INTO candidate_profiles (user_id, years_experience, location) VALUES (11, 3, 'Remote')`,
		);
		await pool.query(
			`INSERT INTO omni_scores (user_id, total_score, score_tier, interview_score, technical_score, resume_score, behavior_score)
       VALUES (11, NULL, NULL, NULL, NULL, NULL, NULL)`,
		);
		const res = await request(app)
			.get('/api/memory/match-breakdown/11/31')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		const b = res.body.breakdown || res.body;
		expect(b.overall_score).toBeNull();
		expect(b.dimensions.skills.score).toBeNull();
		expect(b.dimensions.skills.available).toBe(false);
		expect(b.omniscore.total).toBeNull();
		expect(b.omniscore.interview).toBeNull();
		expect(b.omniscore.technical).toBeNull();
		expect(b.omniscore.resume).toBeNull();
		expect(b.omniscore.behavior).toBeNull();
	});

	test('S-9b measured-0 match row: overall 0 survives, skills computed from ratio, measured-0 omni component survives', async () => {
		await pool.query(
			`INSERT INTO candidate_profiles (user_id, years_experience, location) VALUES (11, 3, 'Remote')`,
		);
		await pool.query(
			`INSERT INTO match_results (candidate_id, job_id, weighted_score, match_level, matching_skills, missing_skills)
       VALUES (11, 31, 0, 'none', '["a"]', '["b"]')`,
		);
		await pool.query(
			`INSERT INTO omni_scores (user_id, total_score, score_tier, interview_score, technical_score, resume_score, behavior_score)
       VALUES (11, 400, 'developing', 0, 55, NULL, 70)`,
		);
		const res = await request(app)
			.get('/api/memory/match-breakdown/11/31')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate');
		expect(res.status).toBe(200);
		const b = res.body.breakdown || res.body;
		// weighted_score is DECIMAL(5,2) in the live schema — pg returns
		// it as a string; assert the measured value, not the wire type.
		expect(Number(b.overall_score)).toBe(0);
		expect(b.dimensions.skills.score).toBe(50); // 1 of 2 skills matched — computed, not the fallback
		expect(b.dimensions.skills.available).toBe(true);
		expect(b.omniscore.interview).toBe(0);
		expect(b.omniscore.technical).toBe(55);
		expect(b.omniscore.resume).toBeNull();
	});

	// ── S-10: company-brief prompt ────────────────────────────────────
	test('S-10 NULL TrustScore components render N/A in the brief prompt; measured 0 renders 0', async () => {
		const { generateCompanyBrief } = require('../../../lib/career-coach-ai');
		await pool.query(
			`INSERT INTO candidate_profiles (user_id, years_experience, location) VALUES (11, 3, 'Remote')`,
		);
		await pool.query(
			`INSERT INTO trust_scores (company_id, total_score, verification_score, job_authenticity_score, hiring_ratio_score, feedback_score, behavior_score)
       VALUES (5, 720, NULL, 0, NULL, 40, NULL)`,
		);
		await generateCompanyBrief(11, { companyId: 5 });
		expect(chatCalls.length).toBe(1);
		const prompt = chatCalls[0][0].content;
		expect(prompt).toContain('Verification: N/A');
		expect(prompt).toContain('Job Authenticity: 0');
		expect(prompt).toContain('Hiring Ratio: N/A');
		expect(prompt).toContain('Feedback: 40');
		expect(prompt).toContain('Behavior: N/A');
		expect(prompt).not.toContain('Verification: 0');
	});

	// ── S-11: introduction gate cached branches ───────────────────────
	test('S-11a engine unavailable + NULL cached score: 403 NOT_TOP_FIVE, nothing persisted', async () => {
		// Engine throws — the catch branch (:159) exercises the cached
		// read. The engine-unavailable else branch (:172) carries the
		// identical expression and is fixed symmetrically in this lane.
		engineState.mode = 'throw';
		await pool.query(
			`INSERT INTO match_results (candidate_id, job_id, weighted_score) VALUES (11, 31, NULL)`,
		);
		const res = await request(app)
			.post('/api/recruiter-intros/request')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate')
			.send({ job_id: 31 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('NOT_TOP_FIVE');
		const rows = await pool.query('SELECT * FROM recruiter_introductions');
		expect(rows.rows.length).toBe(0);
	});

	test('S-11b engine throws + measured cached 80: gate passes, fit_score_at_request persisted as measured 80', async () => {
		engineState.mode = 'throw';
		// #1728b: the row must be FULLY measured (both at-match columns
		// non-NULL) — a weighted_score with a NULL at-match basis is a
		// renormalised score and the fallback gate now refuses it.
		await pool.query(
			`INSERT INTO match_results (candidate_id, job_id, weighted_score, omniscore_at_match, trustscore_at_match) VALUES (11, 31, 80, 600, 700)`,
		);
		const res = await request(app)
			.post('/api/recruiter-intros/request')
			.set('x-test-user-id', '11')
			.set('x-test-role', 'candidate')
			.send({ job_id: 31 });
		expect(res.status).toBe(201);
		const rows = await pool.query('SELECT * FROM recruiter_introductions');
		expect(rows.rows.length).toBe(1);
		expect(Number(rows.rows[0].fit_score_at_request)).toBe(80);
	});
});
