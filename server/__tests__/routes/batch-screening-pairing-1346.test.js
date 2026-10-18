/**
 * #1346: both batch screening routes paired the SORTED results of
 * screenCandidatesBatch() back to candidates by array index, so any
 * batch whose scores differed attributed each result to the wrong
 * candidate — and routes/ai-screener.js then persisted the result and
 * wrote audit/compliance events under that wrong candidate.
 *
 * Fixed behaviour: both routes pair by result.candidate_id.
 *
 * The screener mock below returns results in sorted (reordered) order
 * WITH candidate_id, exactly as the fixed lib produces them: input
 * order is Low(11) then High(22); sorted order is High(95), Low(20).
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((_req, _res, next) => next()),
}));
jest.mock('../../../lib/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../../lib/recruiter-screener', () => ({
	screenCandidate: jest.fn(),
	screenCandidatesBatch: jest.fn(),
}));
jest.mock('../../../services/auditLogService', () => ({
	EVENT_TYPES: {
		AI_DECISION: 'ai_decision',
		HUMAN_OVERRIDE: 'human_override',
		DATA_ACCESS: 'data_access',
		VERIFICATION: 'verification',
		SIGNATURE: 'signature',
		STATUS_CHANGE: 'status_change',
	},
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job', COMPANY: 'company', USER: 'user' },
	logEvent: jest.fn(),
	AuditLogger: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = (_req, _res, next) => next();
	return { rateLimits: { ai: passthrough, strict: passthrough, admin: passthrough } };
});

const pool = require('../../../lib/db');
const auditLogService = require('../../../services/auditLogService');
const screener = require('../../../lib/recruiter-screener');
const aiScreenerRouter = require('../../../routes/ai-screener');
const screeningRouter = require('../../../routes/screening');

const JOB_ID = 10;
const LOW = { id: 11, name: 'Low', omni_score: 400 };
const HIGH = { id: 22, name: 'High', omni_score: 800 };

// Sorted descending, as screenCandidatesBatch returns them.
const SORTED_RESULTS = [
	{ candidate_id: 22, fit_score: 95, recommendation: 'interview', matched_skills: [], missing_skills: [] },
	{ candidate_id: 11, fit_score: 20, recommendation: 'reject', matched_skills: [], missing_skills: [] },
];

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 99, role: 'recruiter', company_id: 5 };
		next();
	});
	app.use('/api', aiScreenerRouter);
	app.use('/api/screening', screeningRouter);
	return app;
}

function installDbMock() {
	pool.query.mockImplementation(async (sql, params = []) => {
		const s = sql.replace(/\s+/g, ' ');
		// routes/screening.js batch: job ownership check
		if (s.includes('company_id = (SELECT company_id FROM users')) {
			return { rows: [{ id: JOB_ID, title: 'Analyst', company_id: 5 }], rowCount: 1 };
		}
		// routes/screening.js batch: applicants for the job (input order Low, High)
		if (s.includes('FROM job_applications ja')) {
			return {
				rows: [
					{ ...LOW, years_experience: 1, skills: [], application_id: 101 },
					{ ...HIGH, years_experience: 9, skills: [], application_id: 102 },
				],
				rowCount: 2,
			};
		}
		// ai-screener: verifyRecruiterOwnsJob
		if (s.includes('FROM jobs j') && s.includes('JOIN users u')) {
			return { rows: [{ id: JOB_ID, company_id: 5, user_company_id: 5 }], rowCount: 1 };
		}
		if (s.includes('SELECT 1 FROM jobs WHERE id =')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
		// ai-screener: getCandidateFullProfile — one row per requested id
		if (s.includes("u.role = 'candidate'")) {
			const row = [LOW, HIGH].find((c) => c.id === params[0]);
			return { rows: row ? [{ ...row, email: `${row.name}@example.com` }] : [], rowCount: row ? 1 : 0 };
		}
		// ai-screener: getJobForScreening
		if (s.includes('SELECT * FROM jobs WHERE id =')) {
			return { rows: [{ id: JOB_ID, title: 'Analyst', company_id: 5 }], rowCount: 1 };
		}
		if (s.includes('SELECT id FROM job_applications')) return { rows: [{ id: 301 }], rowCount: 1 };
		// ai-screener: storeScreeningResult — screening id encodes candidate (params[1])
		if (s.includes('INSERT INTO ai_screenings')) {
			return { rows: [{ id: 1000 + params[1] }], rowCount: 1 };
		}
		if (s.includes('INSERT INTO ai_screening_audit_logs')) return { rows: [{ id: 1 }], rowCount: 1 };
		return { rows: [], rowCount: 0 };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	installDbMock();
	auditLogService.logEvent.mockResolvedValue({ id: 'audit-1' });
	screener.screenCandidatesBatch.mockResolvedValue(SORTED_RESULTS);
	jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => console.error.mockRestore());

describe('#1346 POST /api/jobs/:jobId/screen-batch (routes/ai-screener.js)', () => {
	test('stores and returns each sorted result under its own candidate', async () => {
		const res = await request(makeApp())
			.post(`/api/jobs/${JOB_ID}/screen-batch`)
			.send({ candidate_ids: [LOW.id, HIGH.id] });

		expect(res.status).toBe(200);
		// Response pairing: 95 belongs to High(22), 20 to Low(11).
		const byScore = Object.fromEntries(res.body.screenings.map((s) => [s.fit_score, s.candidate.id]));
		expect(byScore).toEqual({ 95: 22, 20: 11 });

		// Persistence pairing: every ai_screenings insert (params $2=candidate_id,
		// $4=fit_score) carries the score its own candidate earned.
		const inserts = pool.query.mock.calls.filter(([sql]) =>
			sql.replace(/\s+/g, ' ').includes('INSERT INTO ai_screenings'),
		);
		expect(inserts).toHaveLength(2);
		const storedByCandidate = Object.fromEntries(inserts.map(([, p]) => [p[1], p[3]]));
		expect(storedByCandidate).toEqual({ 22: 95, 11: 20 });

		// Compliance events are anchored to the same (correct) candidate.
		const entityByScore = Object.fromEntries(
			auditLogService.logEvent.mock.calls.map(([arg]) => [arg.payload.outputs.fit_score, arg.entityId]),
		);
		expect(entityByScore).toEqual({ 95: 22, 20: 11 });
	});

	test('a result naming an unknown candidate_id is skipped, never misattributed', async () => {
		screener.screenCandidatesBatch.mockResolvedValue([
			...SORTED_RESULTS,
			{ candidate_id: 999, fit_score: 77, recommendation: 'interview', matched_skills: [], missing_skills: [] },
		]);

		const res = await request(makeApp())
			.post(`/api/jobs/${JOB_ID}/screen-batch`)
			.send({ candidate_ids: [LOW.id, HIGH.id] });

		expect(res.status).toBe(200);
		expect(res.body.screenings).toHaveLength(2);
		expect(res.body.screenings.map((s) => s.fit_score)).not.toContain(77);
		const inserts = pool.query.mock.calls.filter(([sql]) =>
			sql.replace(/\s+/g, ' ').includes('INSERT INTO ai_screenings'),
		);
		expect(inserts.map(([, p]) => p[1])).not.toContain(999);
	});
});

describe('#1346 POST /api/screening/batch (routes/screening.js)', () => {
	test('combines each sorted result with its own candidate info', async () => {
		const res = await request(makeApp()).post('/api/screening/batch').send({ job_id: JOB_ID });

		expect(res.status).toBe(200);
		expect(res.body.screenings).toHaveLength(2);
		const byScore = Object.fromEntries(
			res.body.screenings.map((s) => [s.fit_score, { id: s.candidate.id, name: s.candidate.name }]),
		);
		expect(byScore).toEqual({
			95: { id: 22, name: 'High' },
			20: { id: 11, name: 'Low' },
		});
	});

	test('a result naming an unknown candidate_id is dropped, never misattributed', async () => {
		screener.screenCandidatesBatch.mockResolvedValue([
			...SORTED_RESULTS,
			{ candidate_id: 999, fit_score: 77, recommendation: 'interview', matched_skills: [], missing_skills: [] },
		]);

		const res = await request(makeApp()).post('/api/screening/batch').send({ job_id: JOB_ID });

		expect(res.status).toBe(200);
		expect(res.body.screenings).toHaveLength(2);
		expect(res.body.screenings.map((s) => s.fit_score)).not.toContain(77);
	});
});
