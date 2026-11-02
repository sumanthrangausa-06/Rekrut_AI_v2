/**
 * #1382: routes/screening.js POST /compare lacked the company-ownership
 * check + 400 validation its siblings (/analyze, /batch, and /questions
 * after #1379) have.
 * Parity expectations:
 *  - missing candidate1_id/candidate2_id/job_id -> 400
 *    'candidate1_id, candidate2_id and job_id are required'
 *    (multi-field validation shape from /analyze, adapted to /compare's
 *    own field names)
 *  - ownership query empty (cross-company or nonexistent job) -> 403
 *    'You do not have access to this job' (byte-identical to siblings)
 *  - own-company -> passes to handler logic (200)
 * Drives the REAL route + REAL compareCandidates; only db / polsia-ai /
 * auth mocked. The db mock simulates the ownership predicate: it returns
 * the job row only when (job_id, user) match the seeded owner mapping,
 * and returns the other-company job only on the legacy unscoped query,
 * so a revert of the fix turns this suite red.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((_req, _res, next) => next()),
}));
jest.mock('../../../lib/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async () =>
		JSON.stringify({
			recommended: 'candidate1',
			comparison: {
				skills: { winner: 'candidate1', reason: 'More React depth' },
				experience: { winner: 'candidate1', reason: 'More years' },
				reliability: { winner: 'candidate1', reason: 'Higher OmniScore' },
			},
			summary: 'Candidate One is the stronger fit.',
			interview_both: false,
		}),
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
const CAND1_ID = 42;
const CAND2_ID = 43;
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

function candidateRow(id, name) {
	return {
		id,
		name,
		email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
		years_experience: 5,
		omni_score: 700,
		skills: [{ name: 'React' }],
	};
}
const CAND1 = candidateRow(CAND1_ID, 'Candidate One');
const CAND2 = candidateRow(CAND2_ID, 'Candidate Two');

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
	// chat mock is cleared by clearAllMocks; restore its implementation
	chat.mockImplementation(async () =>
		JSON.stringify({
			recommended: 'candidate1',
			comparison: {
				skills: { winner: 'candidate1', reason: 'More React depth' },
				experience: { winner: 'candidate1', reason: 'More years' },
				reliability: { winner: 'candidate1', reason: 'Higher OmniScore' },
			},
			summary: 'Candidate One is the stronger fit.',
			interview_both: false,
		}),
	);
	pool.query.mockImplementation(async (sql, params) => {
		const s = sql.replace(/\s+/g, ' ');
		// #1391 visibility predicate: this suite's candidates are public.
		if (s.includes('FROM user_settings')) {
			return { rows: [{ visible: true, is_applicant: false }], rowCount: 1 };
		}
		// Ownership predicate (sibling query) — must be checked FIRST,
		// because its SQL also starts with the unscoped prefix.
		if (s.includes('FROM jobs WHERE id = $1 AND company_id =')) {
			const [jobId, userId] = params;
			if (userId !== RECRUITER_ID) return { rows: [], rowCount: 0 };
			if (jobId === OWN_JOB_ID) return { rows: [RAW_JOB], rowCount: 1 };
			return { rows: [], rowCount: 0 }; // other company or nonexistent
		}
		// Candidate fetch for /compare (users LEFT JOIN candidate_profiles)
		if (s.includes('FROM users u LEFT JOIN candidate_profiles cp')) {
			if (params[0] === CAND1_ID) return { rows: [CAND1], rowCount: 1 };
			if (params[0] === CAND2_ID) return { rows: [CAND2], rowCount: 1 };
			return { rows: [], rowCount: 0 };
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

describe('#1382 POST /api/screening/compare ownership + validation parity', () => {
	test('cross-company job_id -> 403, generator not called', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate1_id: CAND1_ID, candidate2_id: CAND2_ID, job_id: OTHER_JOB_ID });
		expect(res.status).toBe(403);
		expect(res.body.error).toBe('You do not have access to this job');
		expect(chat).not.toHaveBeenCalled();
	});

	test('nonexistent job_id -> 403 (sibling behaviour)', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate1_id: CAND1_ID, candidate2_id: CAND2_ID, job_id: 9999 });
		expect(res.status).toBe(403);
		expect(res.body.error).toBe('You do not have access to this job');
		expect(chat).not.toHaveBeenCalled();
	});

	test('missing job_id -> 400', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate1_id: CAND1_ID, candidate2_id: CAND2_ID });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('candidate1_id, candidate2_id and job_id are required');
		expect(chat).not.toHaveBeenCalled();
	});

	test('missing candidate1_id -> 400', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate2_id: CAND2_ID, job_id: OWN_JOB_ID });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('candidate1_id, candidate2_id and job_id are required');
		expect(chat).not.toHaveBeenCalled();
	});

	test('missing candidate2_id -> 400', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate1_id: CAND1_ID, job_id: OWN_JOB_ID });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('candidate1_id, candidate2_id and job_id are required');
		expect(chat).not.toHaveBeenCalled();
	});

	test('ownership query runs before candidate fetches (reviewer hardening)', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate1_id: CAND1_ID, candidate2_id: CAND2_ID, job_id: OWN_JOB_ID });
		expect(res.status).toBe(200);
		const sqls = pool.query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
		const ownershipIdx = sqls.findIndex((s) => s.includes('FROM jobs WHERE id = $1 AND company_id ='));
		const candidateIdx = sqls.findIndex((s) => s.includes('FROM users u LEFT JOIN candidate_profiles cp'));
		expect(ownershipIdx).toBeGreaterThanOrEqual(0);
		expect(candidateIdx).toBeGreaterThan(ownershipIdx);
	});

	test('empty body -> 400', async () => {
		const res = await request(makeApp()).post('/api/screening/compare').send({});
		expect(res.status).toBe(400);
		expect(chat).not.toHaveBeenCalled();
	});

	test('own-company job + existing candidates -> 200 (passes gate to handler)', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate1_id: CAND1_ID, candidate2_id: CAND2_ID, job_id: OWN_JOB_ID });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.comparison.recommended).toBe('candidate1');
		expect(res.body.comparison.summary).toBe('Candidate One is the stronger fit.');
		expect(chat).toHaveBeenCalledTimes(1);
		// Correct pairing: the generator prompt names the OWN job and both candidates
		const prompt = chat.mock.calls[0][0];
		expect(prompt).toContain('Frontend Engineer');
		expect(prompt).toContain('Candidate One');
		expect(prompt).toContain('Candidate Two');
	});

	test('sibling oracle: /compare cross-company rejection matches /analyze exactly', async () => {
		const app = makeApp();
		const analyzeCross = await request(app)
			.post('/api/screening/analyze')
			.send({ candidate_id: CAND1_ID, job_id: OTHER_JOB_ID });
		const compareCross = await request(app)
			.post('/api/screening/compare')
			.send({ candidate1_id: CAND1_ID, candidate2_id: CAND2_ID, job_id: OTHER_JOB_ID });
		expect(compareCross.status).toBe(analyzeCross.status);
		expect(compareCross.body).toEqual(analyzeCross.body);
	});

	test('own-company job + missing candidate -> 404 preserved', async () => {
		const res = await request(makeApp())
			.post('/api/screening/compare')
			.send({ candidate1_id: 777, candidate2_id: CAND2_ID, job_id: OWN_JOB_ID });
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('Candidate(s) or job not found');
		expect(chat).not.toHaveBeenCalled();
	});
});
