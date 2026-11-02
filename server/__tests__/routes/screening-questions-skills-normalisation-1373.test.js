/**
 * #1373 (follow-up to #1366 / PR #1370): routes/screening.js POST
 * /questions fed the scorer the RAW jobs row (`SELECT * FROM jobs`),
 * whose skill column is `skills_required` (JSONB) and whose experience
 * column is `min_years_experience`. The question generator
 * (lib/recruiter-screener.js generateTailoredInterviewQuestions) reads
 * only the normalised names `required_skills` / `min_years` — the
 * normalisation that screening.js's own /analyze path and the fixed
 * /batch path both apply. The /questions path therefore generated
 * questions skills-blind: "Missing skills: None" and "0+ required" for
 * every job.
 *
 * This test drives the REAL route + REAL question generator. Only the
 * outer boundaries are mocked: lib/db (rows below are the raw DB
 * shapes) and lib/polsia-ai's chat(), which captures the exact prompt
 * the generator built and returns a fixed JSON question list — the
 * prompt is the production code's own evidence of which job fields it
 * received, not a mock of the logic under test.
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

const JOB_ID = 10;
const CANDIDATE_ID = 42;
// Raw jobs row, exactly as `SELECT * FROM jobs` returns it: DB column
// names, NO required_skills / min_years properties.
const RAW_JOB = {
	id: JOB_ID,
	title: 'Frontend Engineer',
	company_id: 5,
	description: 'Build the candidate-facing web app.',
	skills_required: ['React', 'GraphQL'],
	preferred_skills: [],
	min_years_experience: 7,
};
// Raw candidate_profiles row, exactly as the route's query returns it
// (that table has no skills column — the generator therefore treats
// every required skill as missing for this candidate).
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
		req.user = { id: 99, role: 'recruiter', company_id: 5 };
		next();
	});
	app.use('/api/screening', screeningRouter);
	return app;
}

let currentJob = RAW_JOB;

beforeEach(() => {
	jest.clearAllMocks();
	currentJob = RAW_JOB;
	pool.query.mockImplementation(async (sql) => {
		const s = sql.replace(/\s+/g, ' ');
		// #1391 visibility predicate: this suite's candidate is public.
		if (s.includes('FROM user_settings')) {
			return { rows: [{ visible: true, is_applicant: false }], rowCount: 1 };
		}
		if (s.includes('SELECT * FROM candidate_profiles WHERE user_id = $1')) {
			return { rows: [RAW_CANDIDATE_PROFILE], rowCount: 1 };
		}
		if (s.includes('SELECT * FROM jobs WHERE id = $1')) {
			return { rows: [currentJob], rowCount: 1 };
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

describe('#1373 POST /api/screening/questions (routes/screening.js) skills normalisation', () => {
	test('the generator prompt carries the job required skills as missing skills', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID, job_id: JOB_ID });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.questions).toHaveLength(1);

		expect(chat).toHaveBeenCalledTimes(1);
		const prompt = chat.mock.calls[0][0];
		// The candidate profile carries none of the required skills, so a
		// normalised job makes both appear as missing skills. On the raw
		// row this line reads "Missing skills: None".
		expect(prompt).toContain('Missing skills: React, GraphQL');
	});

	test('min_years normalisation also flows through (min_years_experience is honoured)', async () => {
		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID, job_id: JOB_ID });

		expect(res.status).toBe(200);
		expect(chat).toHaveBeenCalledTimes(1);
		const prompt = chat.mock.calls[0][0];
		// Candidate has 2 years; the job requires 7. On the raw row this
		// line reads "2 years vs 0+ required".
		expect(prompt).toContain('Experience level: 2 years vs 7+ required');
	});

	// #1380 (PR #1374 review LOW-1): pin the defaults branches of the
	// /questions normalisation — a jobs row whose DB columns are null
	// must normalise to required_skills [] and min_years 0
	// (routes/screening.js: `skills_required || []`,
	// `min_years_experience || 0`), not propagate null into the prompt.
	test('null skills_required / min_years_experience fall back to the [] / 0 defaults', async () => {
		currentJob = {
			...RAW_JOB,
			skills_required: null,
			preferred_skills: null,
			min_years_experience: null,
		};

		const res = await request(makeApp())
			.post('/api/screening/questions')
			.send({ candidate_id: CANDIDATE_ID, job_id: JOB_ID });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.questions).toHaveLength(1);

		expect(chat).toHaveBeenCalledTimes(1);
		const prompt = chat.mock.calls[0][0];
		// [] default: no required skills, so nothing can be missing.
		expect(prompt).toContain('Missing skills: None');
		expect(prompt).not.toContain('Missing skills: React, GraphQL');
		// 0 default: candidate's 2 years against no minimum.
		expect(prompt).toContain('Experience level: 2 years vs 0+ required');
		expect(prompt).not.toContain('7+ required');
	});
});
