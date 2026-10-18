/**
 * #1145: compliance_audit_trail writes from routes/ai-screener.js must be
 * candidate-anchored and must not fail silently.
 *
 * Defects pinned here (STOP 1 on #1145):
 *  1. HUMAN_OVERRIDE: the screening lookup selected only job_id, so
 *     entityId was always null — and compliance_audit_trail.entity_id is
 *     NOT NULL (migration 129), so the write failed every time and the
 *     catch block swallowed it. The db mock below emulates real column
 *     projection: a SELECT returns only the columns it names, exactly
 *     like Postgres, so the anchor assertion exercises the real handler
 *     code, not a stubbed result shape.
 *  2. All three logEvent sites (single AI_DECISION, batch AI_DECISION,
 *     HUMAN_OVERRIDE) caught failures with console-only logging: no
 *     retry, no durable marker, no caller-visible signal.
 *
 * Fixed behaviour: one retry, then a durable dead-letter marker in
 * ai_screening_audit_logs (action 'compliance_audit_failed') plus a
 * `compliance_audit_pending: true` flag on the response. The user flow
 * itself never hard-fails on an audit-write fault.
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
}));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = (_req, _res, next) => next();
	return { rateLimits: { ai: passthrough, strict: passthrough, admin: passthrough } };
});

const pool = require('../../../lib/db');
const auditLogService = require('../../../services/auditLogService');
const screener = require('../../../lib/recruiter-screener');
const router = require('../../../routes/ai-screener');

const CANDIDATE_ID = 42;
const JOB_ID = 10;
const SCREENING_ID = 7;

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 99, role: 'recruiter', company_id: 5 };
		next();
	});
	app.use('/api', router);
	return app;
}

// Emulates Postgres column projection for the ai_screenings lookup and
// answers every other statement the two handlers issue.
function installDbMock() {
	pool.query.mockImplementation(async (sql, params = []) => {
		const s = sql.replace(/\s+/g, ' ');
		if (s.includes('FROM ai_screenings WHERE id =')) {
			const row = { job_id: JOB_ID };
			if (/candidate_id/.test(s.split('FROM ai_screenings')[0])) row.candidate_id = CANDIDATE_ID;
			return { rows: [row], rowCount: 1 };
		}
		if (s.includes('FROM jobs j') && s.includes('JOIN users u')) {
			return { rows: [{ id: JOB_ID, company_id: 5, user_company_id: 5 }], rowCount: 1 };
		}
		if (s.includes('SELECT 1 FROM jobs WHERE id =')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
		if (s.includes('INSERT INTO ai_screening_human_reviews')) {
			return {
				rows: [{ id: 1, screening_id: SCREENING_ID, reviewer_id: 99, decision: params[2], reason: params[3] }],
				rowCount: 1,
			};
		}
		if (s.includes('UPDATE ai_screenings SET human_review_status')) return { rows: [], rowCount: 1 };
		if (s.includes('INSERT INTO ai_screening_audit_logs')) return { rows: [{ id: 1 }], rowCount: 1 };
		// Single-screening path helpers
		if (s.includes("u.role = 'candidate'")) {
			return { rows: [{ id: CANDIDATE_ID, name: 'Casey Candidate', email: 'c@example.com' }], rowCount: 1 };
		}
		if (s.includes('SELECT * FROM jobs WHERE id =')) {
			return { rows: [{ id: JOB_ID, title: 'Analyst', company_id: 5 }], rowCount: 1 };
		}
		if (s.includes('SELECT id FROM job_applications')) return { rows: [{ id: 3 }], rowCount: 1 };
		if (s.includes('INSERT INTO ai_screenings')) return { rows: [{ id: SCREENING_ID }], rowCount: 1 };
		if (s.includes('INSERT INTO screening_logs')) return { rows: [], rowCount: 1 };
		return { rows: [], rowCount: 0 };
	});
}

function deadLetterInserts() {
	return pool.query.mock.calls.filter(
		([sql, params]) =>
			sql.replace(/\s+/g, ' ').includes('INSERT INTO ai_screening_audit_logs') &&
			params &&
			params[1] === 'compliance_audit_failed',
	);
}

beforeEach(() => {
	jest.clearAllMocks();
	installDbMock();
	auditLogService.logEvent.mockResolvedValue({ id: 'audit-1' });
	screener.screenCandidate.mockResolvedValue({
		fit_score: 80,
		recommendation: 'interview',
		recommendation_reason: 'strong fit',
		matched_skills: ['sql'],
		missing_skills: [],
	});
	jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => console.error.mockRestore());

describe('#1145 human-review compliance audit', () => {
	test('HUMAN_OVERRIDE is anchored to the screening candidate_id', async () => {
		const res = await request(makeApp())
			.post(`/api/screenings/${SCREENING_ID}/human-review`)
			.send({ decision: 'interview', reason: 'strong portfolio' });
		expect(res.status).toBe(200);
		expect(auditLogService.logEvent).toHaveBeenCalledTimes(1);
		const arg = auditLogService.logEvent.mock.calls[0][0];
		expect(arg.eventType).toBe('human_override');
		expect(arg.entityId).toBe(CANDIDATE_ID);
		expect(arg.jobId).toBe(JOB_ID);
	});

	test('a failed trail write leaves a durable dead-letter marker, not just a console line', async () => {
		auditLogService.logEvent.mockRejectedValue(new Error('db down'));
		const res = await request(makeApp())
			.post(`/api/screenings/${SCREENING_ID}/human-review`)
			.send({ decision: 'reject', reason: 'not a fit' });
		// User flow is not hard-failed...
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		// ...but the failure is durable and caller-visible.
		expect(deadLetterInserts().length).toBe(1);
		const markerParams = deadLetterInserts()[0][1];
		const metadata = JSON.parse(markerParams[5]);
		expect(metadata.event_type).toBe('human_override');
		expect(metadata.entity_id).toBe(CANDIDATE_ID);
		expect(res.body.compliance_audit_pending).toBe(true);
	});

	test('a transient trail failure is retried and needs no dead letter', async () => {
		auditLogService.logEvent.mockRejectedValueOnce(new Error('hash collision')).mockResolvedValue({ id: 'a2' });
		const res = await request(makeApp())
			.post(`/api/screenings/${SCREENING_ID}/human-review`)
			.send({ decision: 'hold', reason: 'waiting on panel' });
		expect(res.status).toBe(200);
		expect(auditLogService.logEvent).toHaveBeenCalledTimes(2);
		expect(deadLetterInserts().length).toBe(0);
		expect(res.body.compliance_audit_pending).toBeUndefined();
	});
});

describe('#1145 batch-screening compliance audit', () => {
	test('a failed batch AI_DECISION trail write leaves a dead-letter marker and flags the batch response', async () => {
		screener.screenCandidatesBatch.mockResolvedValue([
			{ fit_score: 71, recommendation: 'interview', recommendation_reason: 'ok', matched_skills: [], missing_skills: [] },
		]);
		auditLogService.logEvent.mockRejectedValue(new Error('db down'));
		const res = await request(makeApp())
			.post(`/api/jobs/${JOB_ID}/screen-batch`)
			.send({ candidate_ids: [CANDIDATE_ID] });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.compliance_audit_pending).toBe(true);
		expect(deadLetterInserts().length).toBe(1);
		const metadata = JSON.parse(deadLetterInserts()[0][1][5]);
		expect(metadata.event_type).toBe('ai_decision');
		expect(metadata.entity_id).toBe(CANDIDATE_ID);
	});
});

describe('#1145 single-screening compliance audit', () => {
	test('a failed AI_DECISION trail write leaves a durable dead-letter marker', async () => {
		auditLogService.logEvent.mockRejectedValue(new Error('db down'));
		const res = await request(makeApp()).post(`/api/jobs/${JOB_ID}/screen/${CANDIDATE_ID}`).send({});
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(deadLetterInserts().length).toBe(1);
		const metadata = JSON.parse(deadLetterInserts()[0][1][5]);
		expect(metadata.event_type).toBe('ai_decision');
		expect(metadata.entity_id).toBe(CANDIDATE_ID);
		expect(res.body.compliance_audit_pending).toBe(true);
	});
});
