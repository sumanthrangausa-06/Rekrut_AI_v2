/**
 * #1533 (Story G of #1152): DSAR export R7 — POST /gdpr/export re-sources
 * its `omniscore` section from the live omni_scores family.
 *
 * Lex ruling on #1528 (2026-10-21T03:54Z, binding): the top-level bundle
 * key stays `omniscore`, REPLACED in place (never supplemented), structured
 * by source table:
 *   omniscore: {
 *     score:           { …the omni_scores row, raw… } | null,
 *     score_history:   [ …rows… ],
 *     score_snapshots: [ …rows… ],
 *     scale_note:      "total 300-850, factors 0-100",
 *   }
 * Raw/native values, column names intact, NO normalisation. NULL
 * total_score exports as null, never 0. No row → score:null + empty
 * arrays (honest absence, #1517 guards preserved). Erasure/retention
 * untouched; broader DSAR completeness is out of scope.
 *
 * Harness follows the #1522/#1523 suites: the REAL route runs; only the
 * pool boundary is mocked. The mock routes on the LIVE table names, so on
 * pre-fix code (which queries the never-written omniscore_results) the
 * bundle stays `omniscore: []` — that is the red state.
 * The HL-003 dev E2E (real DB, real HTTP) is Quinn's gate after
 * independent review; it is not replaced here.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

const mockAuditLog = jest.fn(async () => {});
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: {
		log: (...args) => mockAuditLog(...args),
		query: jest.fn(async () => []),
		exportLogs: jest.fn(async () => []),
	},
	logEvent: jest.fn(async () => ({})),
	getAuditTrail: jest.fn(async () => ({ rows: [] })),
	getCandidateDecisions: jest.fn(async () => []),
	verifyChain: jest.fn(async () => ({})),
	exportForRegulator: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision', STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

jest.mock('../../../services/euComplianceService', () => ({}));

const pool = require('../../../lib/db');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

const USER_ROW = { id: 7, email: 'subject@example.com', role: 'candidate' };

// A row exactly as held in omni_scores (migrations 001 + 077): native
// total on the 300–850 scale, factor columns + factor_scores JSONB native
// 0–100. Known total 612 is the Rex §3.2 anchor value.
const SCORE_ROW = {
	id: 42,
	user_id: 7,
	total_score: 612,
	interview_score: 70,
	technical_score: 80,
	resume_score: 65,
	behavior_score: 85,
	score_tier: 'good',
	factor_scores: { verified_skills: 80, interview_performance: 60 },
	peer_percentile: 73,
	fraud_signals: [],
	version: 2,
	last_updated: new Date('2026-10-19T00:00:00Z'),
	created_at: new Date('2026-10-01T00:00:00Z'),
};
const NULL_TOTAL_ROW = { ...SCORE_ROW, total_score: null };

const HISTORY_ROWS = [
	{
		id: 11,
		user_id: 7,
		previous_score: 580,
		new_score: 612,
		change_amount: 32,
		change_reason: 'coding_assessment',
		component_type: 'technical',
		created_at: new Date('2026-10-18T00:00:00Z'),
	},
	{
		id: 12,
		user_id: 7,
		previous_score: 601,
		new_score: 580,
		change_amount: -21,
		change_reason: 'decay',
		component_type: 'interview',
		created_at: new Date('2026-10-11T00:00:00Z'),
	},
];

const SNAPSHOT_ROWS = [
	{
		id: 21,
		user_id: 7,
		total_score: 612,
		factor_scores: { verified_skills: 80, interview_performance: 60 },
		peer_percentile: 73,
		snapshot_week: '2026-10-19',
		created_at: new Date('2026-10-19T00:00:00Z'),
	},
];

// scenario: 'populated' | 'empty' | 'null-total'
let scenario = 'populated';
const seenSql = [];

function installPoolMock() {
	pool.query.mockImplementation(async (sql) => {
		seenSql.push(sql);
		const s = sql.toLowerCase();
		if (s.includes('from omni_scores')) {
			if (scenario === 'empty') return { rows: [] };
			if (scenario === 'null-total') return { rows: [NULL_TOTAL_ROW] };
			return { rows: [SCORE_ROW] };
		}
		if (s.includes('from score_history')) {
			return { rows: scenario === 'empty' ? [] : HISTORY_ROWS };
		}
		if (s.includes('from score_snapshots')) {
			return { rows: scenario === 'empty' ? [] : SNAPSHOT_ROWS };
		}
		if (s.includes('from users')) return { rows: [USER_ROW] };
		// Pre-fix code reads omniscore_results: no route above matches it,
		// so it lands here with [] — the red state.
		return { rows: [] };
	});
}

const asJson = (v) => JSON.parse(JSON.stringify(v));

beforeEach(() => {
	jest.clearAllMocks();
	scenario = 'populated';
	seenSql.length = 0;
	installPoolMock();
});

describe('#1533 POST /gdpr/export — omniscore re-sourced from the live family (Lex #1528)', () => {
	test('reads omni_scores/score_history/score_snapshots, never the dead omniscore_results table', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		expect(seenSql.some((q) => /from omni_scores/i.test(q))).toBe(true);
		expect(seenSql.some((q) => /from score_history/i.test(q))).toBe(true);
		expect(seenSql.some((q) => /from score_snapshots/i.test(q))).toBe(true);
		expect(seenSql.some((q) => /omniscore_results/i.test(q))).toBe(false);
	});

	test('populated user: omniscore is the structured object with the raw row, history and snapshots intact', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const omni = res.body.data.omniscore;
		expect(Array.isArray(omni)).toBe(false);
		expect(omni.score).toEqual(asJson(SCORE_ROW));
		expect(omni.score.total_score).toBe(612);
		expect(omni.score_history).toEqual(asJson(HISTORY_ROWS));
		expect(omni.score_snapshots).toEqual(asJson(SNAPSHOT_ROWS));
	});

	test('scale_note is present and states total 300-850, factors 0-100', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.body.data.omniscore.scale_note).toBe('total 300-850, factors 0-100');
	});

	test('empty user: score is null with empty arrays and no fabricated values', async () => {
		scenario = 'empty';
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const omni = res.body.data.omniscore;
		expect(omni.score).toBeNull();
		expect(omni.score_history).toEqual([]);
		expect(omni.score_snapshots).toEqual([]);
		expect(omni.scale_note).toBe('total 300-850, factors 0-100');
	});

	test('NULL total_score exports as null, never 0', async () => {
		scenario = 'null-total';
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		expect(res.body.data.omniscore.score).not.toBeNull();
		expect(res.body.data.omniscore.score.total_score).toBeNull();
	});

	test('auth gate preserved: exporting another user is still 403', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 999 });
		expect(res.status).toBe(403);
	});
});
