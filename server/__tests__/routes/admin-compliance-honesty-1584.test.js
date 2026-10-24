/**
 * #1584 item 4 — routes/admin.js compliance readers fabricate defaults
 * for `ai_%` audit events that lack metadata:
 *   COALESCE(confidence, 0.85), COALESCE(decision, 'processed'),
 *   COALESCE(explanation, 'AI processed this record')
 * plus the same invented 0.85 in the explanations reader, the
 * performance AVG, and the human-override reader.
 *
 * Honest behaviour: a value that was never recorded surfaces as null
 * (confidence) or 'not recorded' (decision/explanation) — never an
 * invented 0.85 / 'processed' / 'AI processed this record'.
 *
 * The fabrication lives in the SQL text itself, so — per the #1526
 * admin test pattern — the DB mock captures the SQL sent to the pool
 * and returns pg-shaped rows representing what the HONEST query yields
 * for an event with no confidence/decision/explanation metadata
 * (NULLs). Red on pristine dev: the SQL contains the invented defaults
 * and a null ai_confidence is rendered as 0.85.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const role = req.headers['x-test-role'];
		if (!role) return res.status(401).json({ error: 'Authentication required' });
		req.user = { id: 1, role, company_id: null };
		return next();
	});
	const requireRole = (...roles) => (req, res, next) => {
		if (!req.user) return res.status(401).json({ error: 'Authentication required' });
		if (!roles.includes(req.user.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}
		return next();
	};
	return {
		authMiddleware,
		requireRole,
		optionalAuth: jest.fn((_req, _res, next) => next()),
		verifyToken: () => null,
		hashPassword: jest.fn(async () => 'hash'),
	};
});

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/distributed-rate-limiter', () => {
	const passthrough = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: { strict: passthrough, admin: passthrough },
		distributedRateLimiter: { checkLimit: jest.fn() },
	};
});
jest.mock('../../../lib/activity-logger', () => ({ logAuthEvent: jest.fn() }));
jest.mock('../../../lib/email-queue', () => ({
	getStats: jest.fn(async () => ({ pending: 0, sent: 0, failed: 0 })),
	retryFailed: jest.fn(async () => []),
}));

const pool = require('../../../lib/db');
const adminRoutes = require('../../../routes/admin');

function sessionStub(req, _res, next) {
	if (req.headers['x-test-admin-session'] === 'valid') {
		req.session = {
			isAdmin: true,
			adminLoginAt: new Date().toISOString(),
			lastAdminActivity: new Date().toISOString(),
		};
	} else {
		req.session = {};
	}
	next();
}

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use(sessionStub);
	app.use('/api/admin', adminRoutes);
	return app;
}

function adminGet(path) {
	return request(makeApp())
		.get(path)
		.set('x-test-role', 'admin')
		.set('x-test-admin-session', 'valid');
}

// One ai_% audit event with NO confidence/decision/explanation metadata,
// as the honest (post-fix) SQL returns it.
const BARE_AI_ROW = {
	id: '42',
	timestamp: new Date('2026-10-01T00:00:00Z'),
	decision_type: 'ai_screening',
	candidate_id: 7,
	candidate_name: 'Asha Candidate',
	job_id: null,
	job_title: null,
	ai_model: 'unknown',
	confidence: null,
	decision: 'not recorded',
	explanation: 'not recorded',
	human_reviewed: false,
	human_reviewer: null,
	human_override: false,
	bias_flags: [],
	data_retention: '7 years',
	audit_hash: 'deadbeef',
};

let capturedSql = [];

beforeEach(() => {
	capturedSql = [];
	pool.query.mockReset();
	pool.query.mockImplementation(async (sql) => {
		const text = String(sql);
		capturedSql.push(text);
		const normalized = text.toLowerCase().replace(/\s+/g, ' ');

		// compliance/decisions + compliance/export share the reader shape.
		if (normalized.includes('as decision_type')) {
			return { rows: [BARE_AI_ROW], rowCount: 1 };
		}
		// compliance/explanations — event with no recorded confidence.
		if (normalized.includes('as explanation_type')) {
			return {
				rows: [
					{
						id: '43',
						timestamp: new Date('2026-10-01T00:00:00Z'),
						action_type: 'ai_explanation_generated',
						admin_user_id: 1,
						admin_user_name: 'Admin',
						candidate_id: 7,
						candidate_name: 'Asha Candidate',
						target_type: 'user',
						explanation_type: 'answer_evaluation',
						explanation_summary: 'Explanation viewed',
						model_version: 'adaptive-assessment-v1',
						confidence: null,
						viewed_from_ip: null,
					},
				],
				rowCount: 1,
			};
		}
		// compliance/overrides — override of an event with no ai_confidence.
		if (normalized.includes('as original_decision')) {
			return {
				rows: [
					{
						id: '44',
						timestamp: new Date('2026-10-01T00:00:00Z'),
						override_by_id: 2,
						override_by_name: 'Rita Recruiter',
						candidate_id: 7,
						candidate_name: 'Asha Candidate',
						original_decision: null,
						override_decision: null,
						override_reason: null,
						job_title: null,
						ai_model: null,
						ai_confidence: null,
						override_from_ip: null,
					},
				],
				rowCount: 1,
			};
		}
		if (normalized.includes('as total_overrides')) {
			return {
				rows: [
					{
						total_overrides: '1',
						unique_recruiters: '1',
						unique_candidates: '1',
						avg_ai_confidence: null,
					},
				],
				rowCount: 1,
			};
		}
		// compliance/performance — volume / model / summary queries.
		if (normalized.includes('group by date(created_at)')) {
			return { rows: [], rowCount: 0 };
		}
		if (normalized.includes('as avg_confidence')) {
			return {
				rows: [{ model: 'unknown', decisions: '3', avg_confidence: null, override_rate: 0 }],
				rowCount: 1,
			};
		}
		if (normalized.includes('from omni_scores')) {
			return { rows: [], rowCount: 0 };
		}
		if (normalized.includes('as total_decisions')) {
			return { rows: [{ total_decisions: '3', reviewed_count: '0' }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function allSql() {
	return capturedSql.join('\n');
}

describe('admin compliance readers — no invented AI-decision defaults (#1584 item 4)', () => {
	it('decisions: SQL invents no confidence/decision/explanation; bare event renders honestly', async () => {
		const res = await adminGet('/api/admin/compliance/decisions');
		expect(res.status).toBe(200);
		expect(allSql()).not.toMatch(/0\.85/);
		expect(allSql()).not.toContain("'processed'");
		expect(allSql()).not.toContain('AI processed this record');

		expect(res.body.decisions).toHaveLength(1);
		const d = res.body.decisions[0];
		expect(d.confidence).toBeNull();
		expect(d.decision).toBe('not recorded');
		expect(d.explanation).toBe('not recorded');
	});

	it('export: the CSV reader carries the same honesty (no invented defaults in its SQL)', async () => {
		const res = await request(makeApp())
			.post('/api/admin/compliance/export')
			.set('x-test-role', 'admin')
			.set('x-test-admin-session', 'valid')
			.send({});
		expect(res.status).toBe(200);
		expect(allSql()).not.toMatch(/0\.85/);
		expect(allSql()).not.toContain("'processed'");
		expect(allSql()).not.toContain('AI processed this record');
		expect(res.body.csv).not.toContain('0.85');
		expect(res.body.csv).toContain('not recorded');
	});

	it('explanations: no invented 0.85 confidence; unrecorded confidence renders null', async () => {
		const res = await adminGet('/api/admin/compliance/explanations');
		expect(res.status).toBe(200);
		expect(allSql()).not.toMatch(/0\.85/);
		expect(res.body.explanations).toHaveLength(1);
		expect(res.body.explanations[0].confidence).toBeNull();
	});

	it('overrides: missing ai_confidence renders null, and an average of nothing is null — never 0.85', async () => {
		const res = await adminGet('/api/admin/compliance/overrides');
		expect(res.status).toBe(200);
		expect(res.body.overrides).toHaveLength(1);
		expect(res.body.overrides[0].aiConfidence).toBeNull();
		expect(res.body.summary.avgAiConfidence).toBeNull();
	});

	it('performance: avg confidence is averaged over recorded values only (no 0.85 filler in SQL)', async () => {
		const res = await adminGet('/api/admin/compliance/performance');
		expect(res.status).toBe(200);
		expect(allSql()).not.toMatch(/0\.85/);
		const list = res.body.modelPerformance?.modelPerformance || [];
		expect(list).toHaveLength(1);
		expect(list[0].avgConfidence).toBeNull();
	});
});
