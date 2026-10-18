/**
 * #929 — Status/withdraw UPDATEs lack a status predicate (TOCTOU).
 *
 * Origin: PR #928 security review F1. Both candidate UPDATEs in
 * routes/candidate.js did SELECT-then-UPDATE with no status predicate
 * in the UPDATE's WHERE clause, so a recruiter terminal transition
 * landing between the SELECT and the UPDATE could be overwritten
 * to 'withdrawn' by the candidate's write.
 *
 * Contract under test:
 *  - Both UPDATEs carry `AND status NOT IN ('withdrawn','hired','rejected')`.
 *  - A status flip to a terminal value between the handler's SELECT
 *    and its UPDATE → no overwrite, response 400 (same terminal-state
 *    refusal semantics as the pre-existing JS guard), stored row
 *    keeps the recruiter's terminal status.
 *  - No flip (non-terminal at write time) → withdraw still 200.
 *
 * Mocked tier: in-memory store behind the repo's mocked lib/db
 * (server/test/setup.js), same pattern as the #820 suite. Crucially
 * the mock honours the predicate exactly as Postgres would: if the
 * SQL contains the NOT IN predicate and the *current* stored status
 * is terminal, the UPDATE affects 0 rows; without the predicate it
 * overwrites unconditionally (the pre-fix behaviour, hence RED).
 * The real end-to-end proof against Postgres is in the PR's E2E
 * evidence — this file is the regression pin, not that proof.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const passthrough = (req, res, next) => next();
	const authMiddleware = jest.fn((req, res, next) => {
		const userId = parseInt(req.headers['x-test-user-id'], 10);
		const user = global.__testUsers?.[userId];
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		req.user = user;
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

jest.mock('../../../services/matching-engine', () => ({
	calculateDeterministicMatch: jest.fn(() => ({ match_score: 80 })),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../routes/chat', () => ({
	getOrCreateConversation: jest.fn().mockResolvedValue({ id: 1 }),
}));
jest.mock('../../../lib/subscription', () => ({
	checkFeatureAccess: jest.fn().mockResolvedValue({ allowed: true }),
	incrementUsage: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../../../services/trustscore', () => ({
	updateHiringRatioScore: jest.fn().mockResolvedValue(true),
	calculateTrustScore: jest.fn().mockResolvedValue(null),
}));

const db = require('../../../lib/db');

const TERMINAL = ['withdrawn', 'hired', 'rejected'];
const store = { applications: new Map() };
// When set, the next ownership SELECT returns its snapshot and then
// the stored row flips — simulating a recruiter write in the window
// between the handler's SELECT and its UPDATE.
let pendingFlip = null;

function seedApp(overrides = {}) {
	const row = {
		id: 1,
		job_id: 10,
		candidate_id: 1,
		company_id: 9,
		status: 'applied',
		resume_url: 'https://files.example/resume.pdf',
		cover_letter: 'My cover letter',
		omniscore_at_apply: 71,
		recruiter_notes: 'INTERNAL',
		screening_answers: {},
		screening_status: null,
		screening_score: 42.5,
		match_score: 80,
		assessment_score: 88,
		assessment_result: 'pass',
		is_auto_applied: false,
		applied_via: 'manual',
		applied_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-02T00:00:00.000Z',
		...overrides,
	};
	store.applications.set(row.id, row);
	return row;
}

function installDbMock() {
	db.query.mockImplementation(async (sql, params = []) => {
		const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();
		const hasPredicate = n.includes("status not in ('withdrawn','hired','rejected')");

		// Ownership/status lookup — returns the snapshot, THEN flips.
		if (n.includes('select id, status from job_applications')) {
			const row = store.applications.get(Number(params[0]));
			if (row && row.candidate_id === Number(params[1])) {
				const snapshot = { id: row.id, status: row.status };
				if (pendingFlip) {
					row.status = pendingFlip;
					pendingFlip = null;
				}
				return { rows: [snapshot], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}

		// Withdraw UPDATE (literal 'withdrawn')
		if (n.includes('update job_applications') && n.includes("status = 'withdrawn'")) {
			const row = store.applications.get(Number(params[0]));
			if (!row) return { rows: [], rowCount: 0 };
			if (hasPredicate && TERMINAL.includes(row.status)) return { rows: [], rowCount: 0 };
			row.status = 'withdrawn';
			return { rows: [row], rowCount: 1 };
		}

		// Candidate status UPDATE (SET status = $1)
		if (n.includes('update job_applications set status = $1')) {
			const row = store.applications.get(Number(params[1]));
			if (!row) return { rows: [], rowCount: 0 };
			if (hasPredicate && TERMINAL.includes(row.status)) return { rows: [], rowCount: 0 };
			row.status = params[0];
			return { rows: [row], rowCount: 1 };
		}

		return { rows: [], rowCount: 0 };
	});
}

const candidateRoutes = require('../../../routes/candidate');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', candidateRoutes);
	return app;
}

const asUser = (req, id) => req.set('x-test-user-id', String(id));

beforeAll(() => {
	global.__testUsers = {
		1: { id: 1, role: 'candidate', email: 'cand1@test.com' },
	};
});

beforeEach(() => {
	jest.clearAllMocks();
	store.applications.clear();
	pendingFlip = null;
	installDbMock();
});

describe('#929 TOCTOU — status flips between SELECT and UPDATE', () => {
	test.each([
		'rejected',
		'hired',
	])('PUT /status: flip to %s after SELECT → 400, row stays terminal (no overwrite to withdrawn)', async (flipped) => {
		seedApp({ status: 'applied' });
		pendingFlip = flipped;
		const res = await asUser(
			request(makeApp()).put('/api/candidate/applications/1/status'),
			1,
		).send({
			status: 'withdrawn',
		});
		expect(res.status).toBe(400);
		expect(store.applications.get(1).status).toBe(flipped);
	});

	test.each([
		'rejected',
		'hired',
	])('PUT /withdraw: flip to %s after SELECT → 400, row stays terminal (no overwrite to withdrawn)', async (flipped) => {
		seedApp({ status: 'screening' });
		pendingFlip = flipped;
		const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/withdraw'), 1);
		expect(res.status).toBe(400);
		expect(store.applications.get(1).status).toBe(flipped);
	});

	test('PUT /status: no flip, non-terminal → 200 and row becomes withdrawn', async () => {
		seedApp({ status: 'screening' });
		const res = await asUser(
			request(makeApp()).put('/api/candidate/applications/1/status'),
			1,
		).send({
			status: 'withdrawn',
		});
		expect(res.status).toBe(200);
		expect(store.applications.get(1).status).toBe('withdrawn');
	});

	test('PUT /withdraw: no flip, non-terminal → 200 and row becomes withdrawn', async () => {
		seedApp({ status: 'screening' });
		const res = await asUser(request(makeApp()).put('/api/candidate/applications/1/withdraw'), 1);
		expect(res.status).toBe(200);
		expect(store.applications.get(1).status).toBe('withdrawn');
	});
});
