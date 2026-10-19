/**
 * #1407 — CV analysis pending-row hygiene.
 *
 * Filed by the ai-engineer review of PR #1405 (MED-1 + LOW-1), #1386 lane:
 *  1. POST /cv/analyze inserts a 'pending' row before the synchronous
 *     provider call. If the process dies mid-call, the row dangles
 *     'pending' forever and the client's poll (no timeout) spins forever.
 *     Fix: stale pending rows (age > 5 min — the LLM cascade caps at 12s,
 *     so a legitimately in-flight row can never be that old) are flipped
 *     to the truthful terminal 'failed' state when read (GET single +
 *     list), with NO scores written. The client poll is also capped.
 *  2. LOW-1: validateCvAnalysis silently inherited a missing per-
 *     recommendation impact from the parent section. Everywhere else the
 *     validator fails closed — a missing/invalid recommendation impact
 *     must invalidate the analysis (503 + pending row deleted).
 *
 * Mocking note (same as #1386 suite): only the polsia-ai boundary, db,
 * auth and subscription are stubbed. The db mock is STATEFUL for the
 * cv_analyses row so the stale-sweep behaviour is tested through the
 * real read path, not by asserting SQL text alone.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const passthrough = (req, res, next) => next();
	const authMiddleware = jest.fn((req, res, next) => {
		req.user = { id: 42, role: 'candidate', company_id: null };
		return next();
	});
	return { authMiddleware, requireRole: () => passthrough };
});

jest.mock('../../../lib/subscription', () => ({
	checkFeatureAccess: jest.fn(async () => ({ allowed: true })),
	incrementUsage: jest.fn(async () => ({})),
}));

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

// Stateful cv_analyses row for the read-path (sweep) tests.
let row;
function installStatefulDb({ ageMinutes }) {
	row = {
		id: 7,
		user_id: 42,
		document_id: 99,
		status: 'pending',
		overall_score: null,
		section_scores: null,
		recommendations: null,
		created_at: new Date(Date.now() - ageMinutes * 60000),
		updated_at: new Date(Date.now() - ageMinutes * 60000),
	};
	mockQuery.mockImplementation(async (sql) => {
		// The stale sweep: an UPDATE that targets 'failed' for old pending rows.
		// The mock honours the age guard semantically (ageMinutes drives it),
		// mirroring the SQL's created_at threshold.
		if (/UPDATE cv_analyses/i.test(sql) && /failed/i.test(sql)) {
			if (row.status === 'pending' && ageMinutes > 5) {
				row = { ...row, status: 'failed', updated_at: new Date() };
				return { rows: [{ id: row.id }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}
		if (/SELECT[\s\S]*FROM cv_analyses/i.test(sql) && /WHERE id = \$1/i.test(sql)) {
			return { rows: [{ ...row }] };
		}
		if (/SELECT COUNT/i.test(sql)) {
			return { rows: [{ total: '1' }] };
		}
		if (/SELECT[\s\S]*FROM cv_analyses/i.test(sql)) {
			return { rows: [{ ...row }] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockChat.mockResolvedValue(JSON.stringify(VALID_ANALYSIS));
});

describe('#1407 stale pending sweep — GET /cv/analysis/:id', () => {
	test('a pending row older than the stale threshold is returned as failed, with no scores', async () => {
		installStatefulDb({ ageMinutes: 10 });

		const res = await request(makeApp()).get('/api/candidate/cv/analysis/7');

		expect(res.status).toBe(200);
		expect(res.body.analysis.status).toBe('failed');
		// Truthful state only — the sweep must never invent a score.
		expect(res.body.analysis.overall_score).toBeNull();
		expect(callsMatching(/UPDATE cv_analyses/i).some(([sql]) => /failed/i.test(sql))).toBe(true);
	});

	test('a fresh pending row (in-flight) is left pending', async () => {
		installStatefulDb({ ageMinutes: 0 });

		const res = await request(makeApp()).get('/api/candidate/cv/analysis/7');

		expect(res.status).toBe(200);
		expect(res.body.analysis.status).toBe('pending');
		expect(row.status).toBe('pending');
	});
});

describe('#1407 stale pending sweep — GET /cv/analyses (list)', () => {
	test('list read also resolves a stale pending row to failed', async () => {
		installStatefulDb({ ageMinutes: 60 });

		const res = await request(makeApp()).get('/api/candidate/cv/analyses');

		expect(res.status).toBe(200);
		expect(res.body.analyses).toHaveLength(1);
		expect(res.body.analyses[0].status).toBe('failed');
	});
});

describe('#1407 LOW-1 — recommendation impact fails closed', () => {
	function installAnalyzeDb() {
		mockQuery.mockImplementation(async (sql) => {
			if (/FROM parsed_resumes/i.test(sql)) {
				return { rows: [{ id: 99, parsed_data: PARSED_RESUME }] };
			}
			if (/INSERT INTO cv_analyses/i.test(sql)) {
				return { rows: [{ id: 7 }] };
			}
			return { rows: [] };
		});
	}

	test.each([
		[
			'missing impact',
			(a) => {
				delete a.recommendations[0].impact;
			},
		],
		[
			'invalid impact value',
			(a) => {
				a.recommendations[0].impact = 'Critical';
			},
		],
	])('recommendation with %s → 503 retryable, pending row deleted, never completed', async (_l, mutate) => {
		installAnalyzeDb();
		const bad = JSON.parse(JSON.stringify(VALID_ANALYSIS));
		mutate(bad);
		mockChat.mockResolvedValue(JSON.stringify(bad));

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(503);
		expect(res.body.retryable).toBe(true);
		expect(callsMatching(/DELETE FROM cv_analyses/i)).toHaveLength(1);
		expect(
			callsMatching(/UPDATE cv_analyses/i).filter(([sql]) => /completed/i.test(sql)),
		).toHaveLength(0);
	});

	test('valid recommendation impacts still complete (guard)', async () => {
		installAnalyzeDb();

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true, analysis_id: 7, status: 'completed' });
	});
});
