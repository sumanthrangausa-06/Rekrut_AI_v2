/**
 * #1386 — POST /cv/analyze must run a REAL provider-backed analysis.
 *
 * Before this fix the route inserted a 'pending' cv_analyses row and a
 * setImmediate completed it with generateMockAnalysis() — five section
 * scores from Math.random (55–90) persisted as a 'completed' analysis.
 * Fabricated scores violate the no-fake-scores rule.
 *
 * Contract under test (STOP 1 on #1386):
 *  - generateMockAnalysis() is deleted; no Math.random score path survives.
 *  - Analysis runs synchronously via lib/polsia-ai chat() + safeParseJSON,
 *    prompt built from the latest parsed_resumes.parsed_data.
 *  - Success → row UPDATE'd to 'completed' with the provider's (validated,
 *    clamped) values; response { success:true, analysis_id, status:'completed' }.
 *  - Provider failure / unparseable / invalid output → pending row DELETED
 *    (zero persisted scores) and 503 { error, retryable:true } — the
 *    #1352/#1357 honest-failure shape.
 *
 * Mocking note: only the polsia-ai module boundary is stubbed (the input
 * condition), plus db/auth/subscription like neighbouring candidate-route
 * tests. safeParseJSON is reproduced faithfully for the inputs used here
 * (valid JSON parses; anything else returns null — its real contract), NOT
 * stubbed to a fixed value, so the parse-failure path stays distinguishable
 * from the provider-throw path. These unit tests do NOT satisfy the Quinn
 * E2E-on-dev gate (real provider, real DB) for #1386.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const express = require('express');

// ─── Auth bypass ────────────────────────────────────────────────────────────
jest.mock('../../../lib/auth', () => {
	const passthrough = (req, res, next) => next();
	const authMiddleware = jest.fn((req, res, next) => {
		req.user = { id: 42, role: 'candidate', company_id: null };
		return next();
	});
	return { authMiddleware, requireRole: () => passthrough };
});

// ─── Subscription gate: allowed ─────────────────────────────────────────────
jest.mock('../../../lib/subscription', () => ({
	checkFeatureAccess: jest.fn(async () => ({ allowed: true })),
	incrementUsage: jest.fn(async () => ({})),
}));

// ─── AI boundary (stubbed input condition) ──────────────────────────────────
const mockChat = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	chat: (...args) => mockChat(...args),
	safeParseJSON: (text) => {
		if (!text || typeof text !== 'string') return null;
		const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
		const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
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

// ─── DB mock ────────────────────────────────────────────────────────────────
const mockQuery = jest.fn();
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
}));

const candidateRoutes = require('../../../routes/candidate');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', candidateRoutes);
	return app;
}

const PARSED_RESUME = {
	contact: { name: 'Fixture Person' },
	skills: [{ name: 'PostgreSQL', category: 'technical', level: 4 }],
	experience: [{ company: 'ExampleCo', title: 'Data Analyst', achievements: ['Cut report time 30%'] }],
	education: [{ institution: 'Example University', degree: 'BS', field: 'Statistics' }],
};

// MED-2 (ai-engineer review): overall_score (72) is deliberately NOT the
// mean of the section scores (80+74+61+69+66 = 350, mean 70), so a
// regression that recomputes overall from the sections instead of
// persisting the provider's value verbatim would fail the success test.
const VALID_ANALYSIS = {
	overall_score: 72,
	section_scores: [
		{ name: 'Experience', score: 80, impact: 'Highest', recommendations: ['Quantify outcomes'] },
		{ name: 'Skills', score: 74, impact: 'Medium', recommendations: ['Group skills by category'] },
		{
			name: 'ATS & Recruiter Optimization',
			score: 61,
			impact: 'Highest',
			recommendations: ['Add job keywords naturally'],
		},
		{ name: 'Formatting & Layout', score: 69, impact: 'Low', recommendations: ['Align dates'] },
		{ name: 'Education', score: 66, impact: 'Low', recommendations: ['Add honours'] },
	],
	recommendations: [
		{ section: 'Experience', impact: 'Highest', text: 'Quantify outcomes' },
		{ section: 'Skills', impact: 'Medium', text: 'Group skills by category' },
	],
};

function callsMatching(re) {
	return mockQuery.mock.calls.filter(([sql]) => re.test(sql));
}

beforeEach(() => {
	jest.clearAllMocks();
	mockQuery.mockImplementation(async (sql) => {
		if (/FROM parsed_resumes/i.test(sql)) {
			return { rows: [{ id: 99, parsed_data: PARSED_RESUME }] };
		}
		if (/INSERT INTO cv_analyses/i.test(sql)) {
			return { rows: [{ id: 7 }] };
		}
		return { rows: [] };
	});
	mockChat.mockResolvedValue(JSON.stringify(VALID_ANALYSIS));
});

describe('#1386 source: mock generator is gone', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../../routes/candidate.js'), 'utf8');

	test('no generateMockAnalysis anywhere in routes/candidate.js', () => {
		expect(src).not.toContain('generateMockAnalysis');
	});

	test('no Math.random anywhere in routes/candidate.js', () => {
		expect(src).not.toContain('Math.random');
	});
});

describe('#1386 POST /cv/analyze — success path', () => {
	test('runs the provider synchronously and persists its exact scores as completed', async () => {
		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true, analysis_id: 7, status: 'completed' });

		// Provider was called with the parsed resume content in the prompt.
		expect(mockChat).toHaveBeenCalledTimes(1);
		const [prompt, opts] = mockChat.mock.calls[0];
		expect(prompt).toContain('PostgreSQL');
		expect(opts).toMatchObject({ module: 'candidate', feature: 'cv_review' });

		// The completed UPDATE carries the provider's values, not dice.
		const updates = callsMatching(/UPDATE cv_analyses/i).filter(([sql]) =>
			/completed/i.test(sql),
		);
		expect(updates).toHaveLength(1);
		const [, params] = updates[0];
		expect(params[0]).toBe(7);
		// Provider's overall verbatim: 72, NOT the sections' mean (70).
		expect(params[1]).toBe(72);
		const sections = JSON.parse(params[2]);
		expect(sections.map((s) => s.name)).toEqual([
			'Experience',
			'Skills',
			'ATS & Recruiter Optimization',
			'Formatting & Layout',
			'Education',
		]);
		expect(sections.map((s) => s.score)).toEqual([80, 74, 61, 69, 66]);
		expect(sections.reduce((sum, s) => sum + s.score, 0) / sections.length).toBe(70);
		const recs = JSON.parse(params[3]);
		expect(recs).toEqual(VALID_ANALYSIS.recommendations);
	});

	test('out-of-range provider scores are clamped to 0–100 before persisting', async () => {
		const wild = JSON.parse(JSON.stringify(VALID_ANALYSIS));
		wild.overall_score = 250;
		wild.section_scores[0].score = -5;
		wild.section_scores[1].score = 140;
		mockChat.mockResolvedValue(JSON.stringify(wild));

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(200);
		const updates = callsMatching(/UPDATE cv_analyses/i);
		expect(updates).toHaveLength(1);
		const [, params] = updates[0];
		expect(params[1]).toBe(100);
		const sections = JSON.parse(params[2]);
		expect(sections[0].score).toBe(0);
		expect(sections[1].score).toBe(100);
	});
});

describe('#1386 POST /cv/analyze — honest failure path', () => {
	test.each([
		['provider cascade throws', () => mockChat.mockRejectedValue(new Error('All llm providers failed'))],
		['provider returns unparseable text', () => mockChat.mockResolvedValue('not json at all')],
		[
			'provider returns JSON missing the five sections',
			() => mockChat.mockResolvedValue(JSON.stringify({ overall_score: 50, section_scores: [] })),
		],
		[
			'provider returns a non-numeric section score',
			() => {
				const bad = JSON.parse(JSON.stringify(VALID_ANALYSIS));
				bad.section_scores[2].score = 'N/A';
				mockChat.mockResolvedValue(JSON.stringify(bad));
			},
		],
	])('%s → 503 retryable and the pending row is deleted, never completed', async (_label, arrange) => {
		arrange();

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: 'CV analysis is temporarily unavailable. Please try again in a moment.',
			retryable: true,
		});

		const deletes = callsMatching(/DELETE FROM cv_analyses/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7]);
		expect(callsMatching(/UPDATE cv_analyses/i)).toHaveLength(0);
	});

	test('provider succeeds but the completed-UPDATE rejects → row deleted, 503 retryable', async () => {
		// MED-2: pins the inner-catch path the ai-engineer confirmed — a DB
		// failure while persisting a REAL analysis must not leave a dangling
		// 'pending' row behind, and the client gets the retryable 503.
		mockQuery.mockImplementation(async (sql) => {
			if (/FROM parsed_resumes/i.test(sql)) {
				return { rows: [{ id: 99, parsed_data: PARSED_RESUME }] };
			}
			if (/INSERT INTO cv_analyses/i.test(sql)) {
				return { rows: [{ id: 7 }] };
			}
			if (/UPDATE cv_analyses/i.test(sql)) {
				throw new Error('db write failed');
			}
			return { rows: [] };
		});

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: 'CV analysis is temporarily unavailable. Please try again in a moment.',
			retryable: true,
		});
		expect(mockChat).toHaveBeenCalledTimes(1);
		const deletes = callsMatching(/DELETE FROM cv_analyses/i);
		expect(deletes).toHaveLength(1);
		expect(deletes[0][1]).toEqual([7]);
	});

	test('empty parsed_data → 400 EMPTY_DOCUMENT, provider never called, nothing persisted', async () => {
		// MED-2: the branch mirroring /cv-review's EMPTY_DOCUMENT precedent
		// was untested — an uploaded-but-unparsed document must not reach
		// the provider or persist any score row.
		mockQuery.mockImplementation(async (sql) => {
			if (/FROM parsed_resumes/i.test(sql)) {
				return { rows: [{ id: 99, parsed_data: {} }] };
			}
			return { rows: [] };
		});

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('EMPTY_DOCUMENT');
		expect(mockChat).not.toHaveBeenCalled();
		expect(callsMatching(/INSERT INTO cv_analyses/i)).toHaveLength(0);
		expect(callsMatching(/UPDATE cv_analyses/i)).toHaveLength(0);
	});

	test('no uploaded document → 400 NO_DOCUMENT, provider never called, no row inserted', async () => {
		mockQuery.mockImplementation(async (sql) => {
			if (/FROM parsed_resumes/i.test(sql)) return { rows: [] };
			return { rows: [] };
		});

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('NO_DOCUMENT');
		expect(mockChat).not.toHaveBeenCalled();
		expect(callsMatching(/INSERT INTO cv_analyses/i)).toHaveLength(0);
	});
});
