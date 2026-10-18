/**
 * #1366: routes/screening.js POST /batch fed the scorer the RAW jobs row
 * (`SELECT * FROM jobs`), whose skill column is `skills_required` (JSONB)
 * and whose experience column is `min_years_experience`. The scorer
 * (lib/recruiter-screener.js) reads only the normalised names
 * `required_skills` / `min_years` — the normalisation that
 * routes/ai-screener.js getJobForScreening() and screening.js's own
 * single /analyze path both apply. The batch path therefore scored
 * skills-blind: required skills were [] for every candidate.
 *
 * This test drives the REAL route + REAL scorer. Only the outer
 * boundaries are mocked: lib/db (rows below are the raw DB shapes) and
 * lib/polsia-ai's chat(), which throws so screenCandidate falls back to
 * the deterministic calculateBasicFitScore — the skills logic under
 * test is the production code, not a mock. The two candidates are
 * identical on years_experience and omni_score, so any score difference
 * can only come through the skills path.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((_req, _res, next) => next()),
}));
jest.mock('../../../lib/db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(async () => {
		throw new Error('No available providers for llm (test)');
	}),
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
const screeningRouter = require('../../../routes/screening');

const JOB_ID = 10;
// Raw jobs row, exactly as `SELECT * FROM jobs` returns it: DB column
// names, NO required_skills / min_years properties.
const RAW_JOB = {
	id: JOB_ID,
	title: 'Frontend Engineer',
	company_id: 5,
	skills_required: ['React', 'GraphQL'],
	preferred_skills: [],
	min_years_experience: 2,
};

// Identical except for skills.
const UNSKILLED = {
	id: 11,
	name: 'Unskilled',
	email: 'unskilled@example.com',
	years_experience: 5,
	omni_score: 720,
	skills: [{ name: 'Python', level: 'advanced' }],
	application_id: 101,
};
const SKILLED = {
	id: 22,
	name: 'Skilled',
	email: 'skilled@example.com',
	years_experience: 5,
	omni_score: 720,
	skills: [
		{ name: 'React', level: 'advanced' },
		{ name: 'GraphQL', level: 'advanced' },
	],
	application_id: 102,
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
		if (s.includes('SELECT * FROM jobs WHERE id = $1 AND company_id')) {
			return { rows: [currentJob], rowCount: 1 };
		}
		if (s.includes('FROM job_applications ja')) {
			// Input order Unskilled, Skilled — sorting must not mis-pair.
			return { rows: [UNSKILLED, SKILLED], rowCount: 2 };
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

describe('#1366 POST /api/screening/batch (routes/screening.js) skills normalisation', () => {
	test('a skills-driven score difference flows through the batch path', async () => {
		const res = await request(makeApp()).post('/api/screening/batch').send({ job_id: JOB_ID });

		expect(res.status).toBe(200);
		expect(res.body.screenings).toHaveLength(2);

		const byCandidate = Object.fromEntries(
			res.body.screenings.map((s) => [s.candidate.id, s]),
		);
		const skilled = byCandidate[SKILLED.id];
		const unskilled = byCandidate[UNSKILLED.id];
		expect(skilled).toBeDefined();
		expect(unskilled).toBeDefined();

		// The job requires React+GraphQL: the candidate who has them must
		// outscore the otherwise-identical candidate who does not.
		expect(skilled.fit_score).toBeGreaterThan(unskilled.fit_score);
		expect(skilled.matched_skills).toEqual(expect.arrayContaining(['react', 'graphql']));
		expect(unskilled.missing_skills).toEqual(expect.arrayContaining(['react', 'graphql']));
	});

	test('min_years normalisation also flows through (min_years_experience is honoured)', async () => {
		// Job requires 10 years; both candidates have 5. With the raw row
		// (min_years undefined) the scorer's experience denominator is 1
		// and the contribution clamps at +15; normalised (min_years 10)
		// it is 5/10 * 10 = +5. Exact scores pin both fields at once:
		// skilled = 50 + 20 (skills) + 5 (exp) + 8 (OmniScore, rounded
		// from 7.6) = 83; unskilled = 50 + 0 + 5 + 8 = 63.
		currentJob = { ...RAW_JOB, min_years_experience: 10 };

		const res = await request(makeApp()).post('/api/screening/batch').send({ job_id: JOB_ID });

		expect(res.status).toBe(200);
		const byCandidate = Object.fromEntries(
			res.body.screenings.map((s) => [s.candidate.id, s]),
		);
		expect(byCandidate[SKILLED.id].fit_score).toBe(83);
		expect(byCandidate[UNSKILLED.id].fit_score).toBe(63);
	});
});
