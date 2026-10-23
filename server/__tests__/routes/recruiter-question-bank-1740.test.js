/**
 * #1740 — POST /recruiter/question-bank contract mismatch.
 *
 * The live client (client/src/pages/recruiter/job-form.tsx saveQuestionsToBank)
 * POSTs ONE question per call with body
 *   { question_text, question_type: q.type, category, options }
 * (q.type ∈ text/yes_no/select), but the handler required
 *   { questions: [...] }
 * and returned 400 'questions array required' for anything else. Its
 * per-item insert also read q.type (never q.question_type), so a
 * question_type sent by any caller was silently dropped to 'text'.
 *
 * Canonical contract (STOP 1 on #1740): the handler accepts BOTH shapes —
 * (a) { questions: [...] } (existing) and (b) the single-question body —
 * normalises per item as
 *   text = q.question || q.question_text
 *   type = q.question_type || q.type || 'text'
 *   category default 'general', options default []
 * rejects with 400 when no usable question text exists, and keeps the
 * response { success: true, questions: [saved rows] } for both shapes.
 *
 * Mock note: only module boundaries are stubbed (auth, rbac, side-effect
 * services, db) following the repo's recruiter route-test pattern
 * (recruiter-override-confidence-1613). Express routing and the handler
 * run for real; the fake DB echoes the exact INSERT params the handler
 * sends, so the suite proves the normalisation, not just payload shape.
 * The Quinn HL-003 gate (real PG, real HTTP) provides fresh-install proof.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const passthrough = (_req, _res, next) => next();
	const authMiddleware = jest.fn((req, _res, next) => {
		req.user = { id: 99, role: 'recruiter', company_id: 5 };
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
jest.mock('../../../services/trustscore', () => ({
	updateHiringRatioScore: jest.fn().mockResolvedValue(true),
	calculateTrustScore: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
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
	logEvent: jest.fn().mockResolvedValue(undefined),
	AuditLogger: { log: jest.fn().mockResolvedValue(undefined) },
}));

const pool = require('../../../lib/db');
const recruiterRouter = require('../../../routes/recruiter');

// Every INSERT INTO question_bank the handler issues, as [sql, params].
let inserts = [];

function installDbMock() {
	pool.query.mockImplementation(async (sql, params) => {
		const s = String(sql).replace(/\s+/g, ' ');
		if (s.includes('INSERT INTO question_bank')) {
			inserts.push([s, params]);
			// Echo the row Postgres would return for this INSERT.
			return {
				rows: [
					{
						id: inserts.length,
						recruiter_id: params[0],
						question_text: params[1],
						category: params[2],
						question_type: params[3],
						options: JSON.parse(params[4]),
					},
				],
				rowCount: 1,
			};
		}
		return { rows: [], rowCount: 0 };
	});
}

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/recruiter', recruiterRouter);
	return app;
}

function postBank(body) {
	return request(makeApp()).post('/api/recruiter/question-bank').send(body);
}

beforeAll(() => {
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
beforeEach(() => {
	jest.clearAllMocks();
	inserts = [];
	installDbMock();
});

describe('#1740 POST /recruiter/question-bank — single-question shape (live client)', () => {
	test('accepts the client single shape and preserves question_type=yes_no', async () => {
		const res = await postBank({
			question_text: 'Are you authorized to work in the US?',
			question_type: 'yes_no',
			category: 'work_authorization',
			options: [],
		});
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.questions).toHaveLength(1);
		expect(res.body.questions[0].question_text).toBe('Are you authorized to work in the US?');
		expect(res.body.questions[0].question_type).toBe('yes_no');
		expect(res.body.questions[0].category).toBe('work_authorization');
		// The INSERT itself must carry the preserved type (params $4).
		expect(inserts).toHaveLength(1);
		expect(inserts[0][1][1]).toBe('Are you authorized to work in the US?');
		expect(inserts[0][1][3]).toBe('yes_no');
	});

	test('preserves question_type=select and its options', async () => {
		const res = await postBank({
			question_text: 'Which shift can you work?',
			question_type: 'select',
			category: 'availability',
			options: ['Day', 'Night'],
		});
		expect(res.status).toBe(200);
		expect(res.body.questions[0].question_type).toBe('select');
		expect(res.body.questions[0].options).toEqual(['Day', 'Night']);
	});

	test('single shape with only question_text gets honest defaults (text/general/[])', async () => {
		const res = await postBank({ question_text: 'Tell us about yourself' });
		expect(res.status).toBe(200);
		expect(res.body.questions[0].question_type).toBe('text');
		expect(res.body.questions[0].category).toBe('general');
		expect(res.body.questions[0].options).toEqual([]);
	});
});

describe('#1740 POST /recruiter/question-bank — array shape (existing contract)', () => {
	test('array shape still works and normalises both field spellings', async () => {
		const res = await postBank({
			questions: [
				{ question: 'Legacy spelling question', type: 'select', category: 'technical', options: ['A', 'B'] },
				{ question_text: 'Client spelling question', question_type: 'yes_no', category: 'culture', options: [] },
			],
		});
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.questions).toHaveLength(2);
		expect(res.body.questions[0].question_text).toBe('Legacy spelling question');
		expect(res.body.questions[0].question_type).toBe('select');
		expect(res.body.questions[1].question_text).toBe('Client spelling question');
		// question_type must NOT be silently dropped to 'text'.
		expect(res.body.questions[1].question_type).toBe('yes_no');
		expect(inserts).toHaveLength(2);
		expect(inserts[1][1][3]).toBe('yes_no');
	});

	test('question_type wins over type when both are present', async () => {
		const res = await postBank({
			questions: [{ question_text: 'Both spellings', question_type: 'select', type: 'text', options: ['X'] }],
		});
		expect(res.status).toBe(200);
		expect(res.body.questions[0].question_type).toBe('select');
	});
});

describe('#1740 POST /recruiter/question-bank — 400 on no usable question text', () => {
	test('empty body → 400 and no INSERT', async () => {
		const res = await postBank({});
		expect(res.status).toBe(400);
		expect(inserts).toHaveLength(0);
	});

	test('single shape with blank text → 400 and no INSERT', async () => {
		const res = await postBank({ question_text: '   ', question_type: 'text' });
		expect(res.status).toBe(400);
		expect(inserts).toHaveLength(0);
	});

	test('array item with no text in either spelling → 400 and no INSERT', async () => {
		const res = await postBank({ questions: [{ question_type: 'text', category: 'general' }] });
		expect(res.status).toBe(400);
		expect(inserts).toHaveLength(0);
	});

	test('empty questions array → 400 and no INSERT', async () => {
		const res = await postBank({ questions: [] });
		expect(res.status).toBe(400);
		expect(inserts).toHaveLength(0);
	});
});
