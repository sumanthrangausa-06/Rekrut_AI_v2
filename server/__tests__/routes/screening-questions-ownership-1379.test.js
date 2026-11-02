/**
 * #1379: routes/screening.js POST /questions lacked the company-ownership
 * check + 400 validation its siblings (/analyze, /batch) have.
 * Parity expectations (from /analyze, the two-field sibling):
 *  - missing candidate_id/job_id -> 400 'candidate_id and job_id are required'
 *  - ownership query empty (cross-company or nonexistent job) -> 403
 *    'You do not have access to this job'
 *  - own-company -> passes to handler logic (200)
 * Drives the REAL route + REAL generator; only db / polsia-ai / auth mocked.
 * The db mock simulates the ownership predicate: it returns the job row
 * only when (job_id, user) match the seeded owner mapping.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((_req, _res, next) => next()),
}));
jest.mock('../../../lib/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async () =>
		JSON.stringify([
			{
				question: 'How have you used React in production?',
				category: 'technical',
				purpose: 'Assess React depth',
				follow_ups: [],
				good_answer_signals: [],
				bad_answer_signals: [],
			},
		]),
	),
	safeParseJSON: (text) => {
		if (!text || typeof text !== 'string') return null;
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	},
}));
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn().mockResolvedValue(undefined) },
}));

const pool = require('../../../lib/db');
const { chat } = require('../../../lib/polsia-ai');
const screeningRouter = require('../../../routes/screening');

const OWN_JOB_ID = 10;
const OTHER_JOB_ID = 20;
const CANDIDATE_ID = 42;
const RECRUITER_ID = 99; // belongs to company 5

const RAW_JOB = {
	id: OWN_JOB_ID,
	title: 'Frontend Engineer',
	company_id: 5,
	description: 'Build the candidate-facing web app.',
	skills_required: ['React', 'GraphQL'],
	preferred_skills: [],
	min_years_experience: 7,
};
const OTHER_JOB = { ...RAW_JOB, id: OTHER_JOB_ID, company_id: 9, title: 'Other Co Job' };
const RAW_CANDIDATE_PROFILE = {
	id: 7,
	user_id: CANDIDATE_ID,
	headline: 'Frontend developer',
	years_experience: 2,
};

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: RECRUITER_ID, role: 'recruiter', company_id: 5 };
		next();
	});
	app.use('/api/screening', screeningRouter);
	return app;
}

beforeEach(() => {
	jest.clearAllMocks();
	pool.query.mockImplementation(async (sql, params) => {
		const s = sql.replace(/\s+/g, ' ');
		// #1391 visibility predicate: this suite's candidate is public.
		if (s.includes('FROM user_settings')) {
			return { rows: [{ visible: true, is_applicant: false }], rowCount: 1 };
		}
		// Ownership predicate (sibling query): job visible only to its company.
		if (s.includes('FROM jobs WHERE id = $1 AND company_id =')) {
			const [jobId, userId] = params;
			if (userId !== RECRUITER_ID) return { rows: [], rowCount: 0 };
			if (jobId === OWN_JOB_ID) return { rows: [RAW_JOB], rowCount: 1 };
			if (jobId === OTHER_JOB_ID) return { rows: [], rowCount: 0 }; // other company
			return { rows: [], rowCount: 0 };
		}
		if (s.includes('SELECT * FROM candidate_profiles WHERE user_id = $1')) {
			return params[0] === CANDIDATE_ID
				? { rows: [RAW_CANDIDATE_PROFILE], rowCount: 1 }
				: { rows: [], rowCount: 0 };
		}
		// Legacy unscoped job fetch (pre-fix path)
		if (s.includes('SELECT * FROM jobs WHERE id = $1')) {
			if (params[0] === OWN_JOB_ID) return { rows: [RAW_JOB], rowCount: 1 };
			if (params[0] === OTHER_JOB_ID) return { rows: [OTHER_JOB], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		}
		return { rows: [], rowCount: 0 };
	});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	console.error.mockRestore();
	console.warn.mockRestore();
});

describe('#1379 POST /api/screening/questions ownership + validation parity', () => {
	test('cross-company job_id -> 403, generator not called', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID, job_id: OTHER_JOB_ID });
		expect(res.status).toBe(403);
		expect(res.body.error).toBe('You do not have access to this job');
		expect(chat).not.toHaveBeenCalled();
	});

	test('nonexistent job_id -> 403 (sibling behaviour)', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID, job_id: 9999 });
		expect(res.status).toBe(403);
		expect(chat).not.toHaveBeenCalled();
	});

	test('missing job_id -> 400', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('candidate_id and job_id are required');
		expect(chat).not.toHaveBeenCalled();
	});

	test('missing candidate_id -> 400', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ job_id: OWN_JOB_ID });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('candidate_id and job_id are required');
	});

	test('empty body -> 400', async () => {
		const res = await request(makeApp()).post('/api/screening/questions').send({});
		expect(res.status).toBe(400);
	});

	test('own-company job + existing candidate -> 200 (passes gate to handler)', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID, job_id: OWN_JOB_ID });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.questions).toHaveLength(1);
		expect(chat).toHaveBeenCalledTimes(1);
	});

	test('sibling oracle: /questions rejection matches /analyze exactly (cross-company + missing fields)', async () => {
		const app = makeApp();
		const analyzeCross = await request(app)
			.post('/api/screening/analyze')
			.send({ candidate_id: CANDIDATE_ID, job_id: OTHER_JOB_ID });
		const questionsCross = await request(app)
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID, job_id: OTHER_JOB_ID });
		expect(questionsCross.status).toBe(analyzeCross.status);
		expect(questionsCross.body).toEqual(analyzeCross.body);

		const analyzeMissing = await request(app)
			.post('/api/screening/analyze')
			.send({ candidate_id: CANDIDATE_ID });
		const questionsMissing = await request(app)
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID });
		expect(questionsMissing.status).toBe(analyzeMissing.status);
		expect(questionsMissing.body).toEqual(analyzeMissing.body);
	});

	test('own-company job + missing candidate -> 404 preserved', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: 777, job_id: OWN_JOB_ID });
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Candidate or job not found');
	});
});
