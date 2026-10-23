/**
 * Issue #1678 — verifiedEligible must actually be SENT by the server.
 *
 * The candidate completion view (client assessment-take.tsx, GAP-4 /
 * #1654) renders "Passed · Verified ✓" ONLY when a server payload says
 * verifiedEligible === true, but no payload sent the field, so the
 * Verified label could never render for a genuinely verified pass.
 *
 * Canonical source (STOP 1, Lead): the PER-ATTEMPT stored decision.
 * completeAssessment computes
 *   passed = !isPartial && score >= 60 && antiCheat >= 50
 * and sets candidate_skills.is_verified exactly then, so
 *   verifiedEligible = THIS attempt's passed === true && partial !== true.
 * It must NEVER be read off candidate_skills.is_verified — that flag is
 * cumulative across attempts and stays true after a later failed attempt
 * (the discriminator case 4 below).
 *
 * Payloads pinned here:
 *  A. GET /session/:sessionId/current — stored-completion branch
 *  B. GET /session/:sessionId/current — Phase A recovery-completion
 *     branch (session still in_progress, all answers recorded; /current
 *     runs completeAssessmentTx and returns the doneResult payload)
 *  C. POST /session/:sessionId/exit action:'submit' — the Submit & Exit
 *     completion payload built from `completion`
 *
 * Real-DB integration suite (1728b pattern): the route runs against a
 * throwaway Postgres behind VE1678_INTEGRATION_DB_URL. Only auth / AI /
 * omniscore / audit / rate-limit / notify boundaries are mocked; every
 * query, the completion transaction and the payload assembly run for
 * real against the fixture schema (mirrors migrations 004 + 006 plus
 * the 276/280 session columns the routes read).
 *
 * Example:
 *   VE1678_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/rekrut_1678_test' \
 *     npx jest server/__tests__/routes/assessments-verified-eligible-1678.test.js --forceExit
 */
jest.unmock('../../../lib/db');

jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = {
			id: parseInt(req.headers['x-test-user-id'] || '7', 10),
			role: 'candidate',
			company_id: null,
		};
		return next();
	});
	const passthrough = (_req, _res, next) => next();
	return {
		authMiddleware,
		requireRole: () => passthrough,
		requireApprovedRecruiter: passthrough,
		requireNotSuspended: passthrough,
	};
});
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async () => '{}'),
	handleAIError: jest.fn((res) => res.status(500).json({ error: 'AI unavailable' })),
	safeParseJSON: (text) => {
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	},
}));
jest.mock('../../../services/omniscore', () => ({
	calculateScore: jest.fn(async () => ({})),
	addTechnicalComponent: jest.fn(async () => ({})),
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => ({})) },
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const mw = (_req, _res, next) => next();
	return { rateLimits: { strict: mw, standard: mw, lenient: mw, ai: mw } };
});
jest.mock('../../../lib/notify', () => ({ notifyUser: jest.fn(async () => ({})) }));

const request = require('supertest');
const express = require('express');

const DB_URL = process.env.VE1678_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

// Fixture schema: the columns migrations 004/006 (+276 current_draft,
// +280 total_questions/format/difficulty_band/topic_id/set_id) define
// for the tables these routes touch, with the same types.
const SCHEMA_SQL = `
DROP TABLE IF EXISTS assessment_events, skill_assessments, assessment_sessions,
  assessment_questions, candidate_skills CASCADE;
CREATE TABLE candidate_skills (id INTEGER PRIMARY KEY, user_id INTEGER, skill_name TEXT,
  category TEXT, is_verified BOOLEAN DEFAULT false, verified_at TIMESTAMP, verified_score INTEGER);
CREATE TABLE assessment_questions (id INTEGER PRIMARY KEY, skill_category TEXT,
  difficulty_level INTEGER DEFAULT 2, question_type TEXT, question_text TEXT,
  options JSONB, correct_answer TEXT, explanation TEXT, time_limit_seconds INTEGER DEFAULT 120);
CREATE TABLE assessment_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, skill_id INTEGER,
  status TEXT DEFAULT 'in_progress', current_question_index INTEGER DEFAULT 0,
  current_difficulty INTEGER DEFAULT 2, questions_asked JSONB DEFAULT '[]',
  answers_given JSONB DEFAULT '[]', score INTEGER DEFAULT 0,
  max_difficulty_reached INTEGER DEFAULT 2, tab_switches INTEGER DEFAULT 0,
  copy_paste_attempts INTEGER DEFAULT 0, time_anomalies INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(), completed_at TIMESTAMP,
  current_draft JSONB, total_questions INTEGER, format TEXT, difficulty_band TEXT,
  topic_id INTEGER, set_id INTEGER);
CREATE TABLE skill_assessments (id SERIAL PRIMARY KEY, user_id INTEGER, skill_id INTEGER,
  session_id INTEGER, assessment_type TEXT, title TEXT, score INTEGER, max_score INTEGER,
  passed BOOLEAN DEFAULT false, anti_cheat_score INTEGER, behavioral_flags JSONB,
  duration_seconds INTEGER, started_at TIMESTAMP, completed_at TIMESTAMP DEFAULT NOW());
CREATE TABLE assessment_events (id SERIAL PRIMARY KEY, session_id INTEGER,
  event_type TEXT, event_data JSONB, timestamp TIMESTAMP DEFAULT NOW());
`;

const USER_ID = 7;
const SKILL_ID = 3;
// Difficulty 2 multiple-choice: max points per question = 2 * 10 = 20.
const FULL = { questionId: 101, isCorrect: true, scorePoints: 20 };
const WRONG = { questionId: 102, isCorrect: false, scorePoints: 0 };

describeIfDb('#1678 — verifiedEligible on the completion payloads (real DB)', () => {
	let pool;
	let app;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = require('../../../lib/db');
		await pool.query(SCHEMA_SQL);
		await pool.query(
			`INSERT INTO assessment_questions (id, skill_category, difficulty_level, question_type, question_text)
       VALUES (101, 'JavaScript', 2, 'multiple_choice', 'Q101'), (102, 'JavaScript', 2, 'multiple_choice', 'Q102')`,
		);
		app = express();
		app.use(express.json());
		app.use('/api/assessments', require('../../../routes/assessments'));
	});

	afterAll(async () => {
		if (pool) await pool.end();
	});

	beforeEach(async () => {
		await pool.query(
			'TRUNCATE assessment_events, skill_assessments, assessment_sessions, candidate_skills RESTART IDENTITY CASCADE',
		);
	});

	async function seedSkill(isVerified) {
		await pool.query(
			`INSERT INTO candidate_skills (id, user_id, skill_name, category, is_verified, verified_score)
       VALUES ($1, $2, 'JavaScript', 'technical', $3, $4)`,
			[SKILL_ID, USER_ID, isVerified, isVerified ? 85 : null],
		);
	}

	// A finished attempt: session completed + its stored skill_assessments
	// row — exactly the state the stored-completion branch reads back.
	async function seedCompleted({ sessionId, passed, score, flags }) {
		await pool.query(
			`INSERT INTO assessment_sessions (id, user_id, skill_id, status, score, total_questions, started_at, completed_at)
       VALUES ($1, $2, $3, 'completed', $4, 2, NOW() - INTERVAL '10 minutes', NOW())`,
			[sessionId, USER_ID, SKILL_ID, score],
		);
		await pool.query(
			`INSERT INTO skill_assessments (user_id, skill_id, session_id, assessment_type, title, score, max_score, passed, anti_cheat_score, behavioral_flags, duration_seconds, started_at, completed_at)
       VALUES ($1, $2, $3, 'dynamic', 'JavaScript Assessment', $4, 100, $5, 100, $6::jsonb, 300, NOW() - INTERVAL '10 minutes', NOW())`,
			[USER_ID, SKILL_ID, sessionId, score, passed, JSON.stringify(flags)],
		);
	}

	async function seedInProgress({ sessionId, answers, totalQuestions = 2 }) {
		await pool.query(
			`INSERT INTO assessment_sessions (id, user_id, skill_id, status, answers_given, total_questions, tab_switches, copy_paste_attempts, time_anomalies, started_at)
       VALUES ($1, $2, $3, 'in_progress', $4::jsonb, $5, 0, 0, 0, NOW() - INTERVAL '10 minutes')`,
			[sessionId, USER_ID, SKILL_ID, JSON.stringify(answers), totalQuestions],
		);
	}

	const getCurrent = (sessionId) =>
		request(app).get(`/api/assessments/session/${sessionId}/current`).set('x-test-user-id', String(USER_ID));

	// ── A. Stored-completion branch ───────────────────────────────────
	test('A1 passed full attempt → verifiedEligible === true', async () => {
		await seedSkill(false);
		await seedCompleted({ sessionId: 501, passed: true, score: 80, flags: { correct_count: 2 } });
		const res = await getCurrent(501);
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('completed');
		expect(res.body.passed).toBe(true);
		expect(res.body.partial).toBe(false);
		expect(res.body.verifiedEligible).toBe(true);
	});

	test('A2 failed attempt → verifiedEligible === false', async () => {
		await seedSkill(false);
		await seedCompleted({ sessionId: 502, passed: false, score: 30, flags: { correct_count: 0 } });
		const res = await getCurrent(502);
		expect(res.status).toBe(200);
		expect(res.body.passed).toBe(false);
		expect(res.body.verifiedEligible).toBe(false);
	});

	test('A3 partial attempt (flags partial:true, passed false) → verifiedEligible === false', async () => {
		await seedSkill(false);
		await seedCompleted({
			sessionId: 503,
			passed: false,
			score: 100, // answered-only score — still never Verified
			flags: { partial: true, answers_given: 1, total_questions: 2, correct_count: 1 },
		});
		const res = await getCurrent(503);
		expect(res.status).toBe(200);
		expect(res.body.partial).toBe(true);
		expect(res.body.verifiedEligible).toBe(false);
	});

	test('A4 DISCRIMINATOR: skill already verified by an earlier pass, THIS attempt failed → verifiedEligible === false', async () => {
		await seedSkill(true); // candidate_skills.is_verified = true (cumulative)
		await seedCompleted({ sessionId: 504, passed: false, score: 20, flags: { correct_count: 0 } });
		const res = await getCurrent(504);
		expect(res.status).toBe(200);
		expect(res.body.passed).toBe(false);
		expect(res.body.verifiedEligible).toBe(false);
	});

	test('A5 passed=true but partial (flags partial:true) → verifiedEligible === false', async () => {
		await seedSkill(false);
		await seedCompleted({
			sessionId: 509,
			passed: true,
			score: 100, // answered-only score — a partial attempt is never Verified
			flags: { partial: true, answers_given: 1, total_questions: 2 },
		});
		const res = await getCurrent(509);
		expect(res.status).toBe(200);
		expect(res.body.passed).toBe(true);
		expect(res.body.partial).toBe(true);
		expect(res.body.verifiedEligible).toBe(false);
	});

	// ── B. Phase A recovery-completion branch ─────────────────────────
	test('B1 in_progress with all answers correct → /current completes it, verifiedEligible === true, completion is real', async () => {
		await seedSkill(false);
		await seedInProgress({ sessionId: 505, answers: [FULL, { ...FULL, questionId: 102 }] });
		const res = await getCurrent(505);
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('completed');
		expect(res.body.passed).toBe(true);
		expect(res.body.verifiedEligible).toBe(true);
		// The recovery completion really landed in the DB.
		const sa = await pool.query('SELECT passed FROM skill_assessments WHERE session_id = 505');
		expect(sa.rows).toHaveLength(1);
		expect(sa.rows[0].passed).toBe(true);
		const cs = await pool.query('SELECT is_verified FROM candidate_skills WHERE id = $1', [SKILL_ID]);
		expect(cs.rows[0].is_verified).toBe(true);
	});

	test('B2 in_progress with all answers wrong → /current completes it, verifiedEligible === false', async () => {
		await seedSkill(false);
		await seedInProgress({ sessionId: 506, answers: [WRONG, { ...WRONG, questionId: 101 }] });
		const res = await getCurrent(506);
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('completed');
		expect(res.body.passed).toBe(false);
		expect(res.body.verifiedEligible).toBe(false);
		const cs = await pool.query('SELECT is_verified FROM candidate_skills WHERE id = $1', [SKILL_ID]);
		expect(cs.rows[0].is_verified).toBe(false);
	});

	// ── C. Submit & Exit submit response ──────────────────────────────
	test('C1 Submit & Exit, full pass → verifiedEligible === true', async () => {
		await seedSkill(false);
		await seedInProgress({ sessionId: 507, answers: [FULL, { ...FULL, questionId: 102 }] });
		const res = await request(app)
			.post('/api/assessments/session/507/exit')
			.set('x-test-user-id', String(USER_ID))
			.send({ action: 'submit' });
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('completed');
		expect(res.body.passed).toBe(true);
		expect(res.body.partial).toBe(false);
		expect(res.body.verifiedEligible).toBe(true);
	});

	test('C2 Submit & Exit, partial (1 of 2 answered) → verifiedEligible === false', async () => {
		await seedSkill(false);
		await seedInProgress({ sessionId: 508, answers: [FULL] });
		const res = await request(app)
			.post('/api/assessments/session/508/exit')
			.set('x-test-user-id', String(USER_ID))
			.send({ action: 'submit' });
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('completed');
		expect(res.body.partial).toBe(true);
		expect(res.body.passed).toBe(false);
		expect(res.body.verifiedEligible).toBe(false);
	});
});
