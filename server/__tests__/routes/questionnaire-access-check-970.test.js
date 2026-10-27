/**
 * #970 / FS-038 — GET /response-by-application/:application_id carries a
 * dead access-check clause.
 *
 * Defect (verified): routes/questionnaire.js, in
 * GET /response-by-application/:application_id:
 *   if (app.company_id !== userCompanyId && app.user_id !== req.user.id)
 * `app` is a job_applications row (SELECT ja.*, j.company_id). The
 * job_applications table has NO user_id column (migration 002 defines
 * candidate_id), so app.user_id is always undefined, `undefined !==
 * req.user.id` is always true, and the second clause can never change
 * the outcome — the company check is the only live predicate, and the
 * dead clause falsely implies a per-user ownership check exists.
 *
 * Fix: remove `&& app.user_id !== req.user.id` — one line, nothing else.
 * Behaviour for every real row is unchanged (the clause never fired).
 *
 * Tests:
 *  (1) Static contract: the questionnaire router source must NOT
 *      reference `app.user_id` — RED on pristine dev, GREEN after.
 *  (2) Real-DB journey block (HL-003): fresh-install Postgres built ONLY
 *      by `node migrate.js`; real HTTP via supertest against the real
 *      questionnaire router + real lib/db; only auth is mocked
 *      (req.user injection, the #1787 pattern):
 *        (a) same-company recruiter → 200 with the response body
 *        (b) other-company recruiter → 403
 *        (c) application with no screening response, same-company → 404
 *      Without QUESTIONNAIRE970_INTEGRATION_DB_URL the real-DB describe
 *      is skipped and only the static contract test runs.
 */
jest.unmock('../../../lib/db');

const mockCurrentUser = { id: 970101, role: 'recruiter', company_id: 970001 };
jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { ...mockCurrentUser };
		return next();
	});
	return { ...actual, authMiddleware };
});
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async () => ''),
	safeParseJSON: (text) => {
		if (!text || typeof text !== 'string') return null;
		const match = text.match(/\{[\s\S]*\}/);
		if (!match) return null;
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	},
	parseResume: jest.fn(),
	generateSkillAssessment: jest.fn(),
	evaluateSkillAssessment: jest.fn(),
	generateJobMatchScore: jest.fn(),
	generateInterviewCoaching: jest.fn(),
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => ({})) },
}));

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DB_URL = process.env.QUESTIONNAIRE970_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const COMPANY_A = 970001;
const COMPANY_B = 970002;
const RECRUITER_A = 970101;
const RECRUITER_B = 970102;
const CANDIDATE = 970103;
const CANDIDATE2 = 970104;
const JOB_ID = 970201;
const APP_WITH_RESPONSE = 970301;
const APP_NO_RESPONSE = 970302;
const QUESTIONNAIRE_ID = 970401;
const RESPONSE_ID = 970501;

const seedPool = DB_URL ? new Pool({ connectionString: DB_URL }) : null;

async function cleanup() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q('DELETE FROM screening_responses WHERE id = $1', [RESPONSE_ID]);
	await q('DELETE FROM screening_questionnaires WHERE id = $1', [QUESTIONNAIRE_ID]);
	await q('DELETE FROM job_applications WHERE id = ANY($1)', [[APP_WITH_RESPONSE, APP_NO_RESPONSE]]);
	await q('DELETE FROM jobs WHERE id = $1', [JOB_ID]);
	await q('DELETE FROM users WHERE id = ANY($1)', [[RECRUITER_A, RECRUITER_B, CANDIDATE, CANDIDATE2]]);
	await q('DELETE FROM companies WHERE id = ANY($1)', [[COMPANY_A, COMPANY_B]]);
}

async function seed() {
	const q = (sql, params) => seedPool.query(sql, params);
	await cleanup();
	await q('INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)', [
		COMPANY_A,
		'Nova 970 Company A',
		COMPANY_B,
		'Nova 970 Company B',
	]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		 ($1, 'nova970-rec-a@test.local', 'Nova 970 Recruiter A', 'recruiter', $5),
		 ($2, 'nova970-rec-b@test.local', 'Nova 970 Recruiter B', 'recruiter', $6),
		 ($3, 'nova970-candidate@test.local', 'Nova 970 Candidate', 'candidate', NULL),
		 ($4, 'nova970-candidate2@test.local', 'Nova 970 Candidate 2', 'candidate', NULL)`,
		[RECRUITER_A, RECRUITER_B, CANDIDATE, CANDIDATE2, COMPANY_A, COMPANY_B],
	);
	await q('INSERT INTO jobs (id, user_id, title, company_id) VALUES ($1, $2, $3, $4)', [
		JOB_ID,
		RECRUITER_A,
		'Nova 970 Analyst',
		COMPANY_A,
	]);
	await q(
		`INSERT INTO job_applications (id, job_id, candidate_id, company_id, status) VALUES
		 ($1, $3, $4, $6, 'applied'),
		 ($2, $3, $5, $6, 'applied')`,
		[APP_WITH_RESPONSE, APP_NO_RESPONSE, JOB_ID, CANDIDATE, CANDIDATE2, COMPANY_A],
	);
	await q('INSERT INTO screening_questionnaires (id, job_id, pass_threshold) VALUES ($1, $2, 70)', [
		QUESTIONNAIRE_ID,
		JOB_ID,
	]);
	await q(
		`INSERT INTO screening_responses (id, application_id, candidate_id, questionnaire_id, answers, status)
		 VALUES ($1, $2, $3, $4, $5, 'completed')`,
		[RESPONSE_ID, APP_WITH_RESPONSE, CANDIDATE, QUESTIONNAIRE_ID, JSON.stringify({ 1: 'Yes' })],
	);
}

describe('#970 static contract — no dead user_id clause', () => {
	test('response-by-application handler source must NOT reference app.user_id', () => {
		const src = read('routes/questionnaire.js');
		expect(src).not.toMatch(/app\.user_id/);
	});

	test('the live company predicate remains, standing alone', () => {
		const src = read('routes/questionnaire.js');
		expect(src).toMatch(/if \(app\.company_id !== userCompanyId\)/);
	});
});

describeIfDb('#970 response-by-application access check — real DB', () => {
	let app;

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		await seed();
		const questionnaireRouter = require('../../../routes/questionnaire');
		app = express();
		app.use(express.json());
		app.use('/api/questionnaire', questionnaireRouter);
	});

	afterAll(async () => {
		if (seedPool) {
			await cleanup();
			await seedPool.end();
		}
	});

	test('(a) same-company recruiter GET response-by-application → 200 with the response body', async () => {
		mockCurrentUser.id = RECRUITER_A;
		mockCurrentUser.company_id = COMPANY_A;
		const res = await request(app).get(
			`/api/questionnaire/response-by-application/${APP_WITH_RESPONSE}`,
		);
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.response.id).toBe(RESPONSE_ID);
		expect(res.body.response.application_id).toBe(APP_WITH_RESPONSE);
		expect(res.body.response.candidate_id).toBe(CANDIDATE);
		expect(res.body.response.questionnaire_id).toBe(QUESTIONNAIRE_ID);
		expect(res.body.response.status).toBe('completed');
	});

	test('(b) other-company recruiter GET response-by-application → 403', async () => {
		mockCurrentUser.id = RECRUITER_B;
		mockCurrentUser.company_id = COMPANY_B;
		const res = await request(app).get(
			`/api/questionnaire/response-by-application/${APP_WITH_RESPONSE}`,
		);
		expect(res.status).toBe(403);
		expect(res.body.error).toBe('Access denied');
	});

	test('(c) application with no screening response, same-company → 404', async () => {
		mockCurrentUser.id = RECRUITER_A;
		mockCurrentUser.company_id = COMPANY_A;
		const res = await request(app).get(
			`/api/questionnaire/response-by-application/${APP_NO_RESPONSE}`,
		);
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('No screening response found for this application');
	});
});
