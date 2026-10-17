/**
 * #815 (S-095): application-time IP capture — route wiring.
 *
 * The capture is wired ONLY in the manual apply route
 * (POST /candidate/jobs/:jobId/apply), at route level — never inside
 * the shared submitApplication helper (shared with both auto-apply
 * routes) and never in the auto-apply routes themselves.
 *
 * Modelled on candidate-autosend.test.js: supertest + the repo's
 * mocked lib/db (server/test/setup.js), extended with routing for
 * the consent_texts lookup and the application_ip_captures INSERT.
 * The fingerprint secret + flag are synthetic test env values only.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id']) {
			const userId = parseInt(req.headers['x-test-user-id'], 10);
			const user = global.__testUsers?.[userId];
			if (user) {
				req.user = user;
				return next();
			}
		}
		return res.status(401).json({ error: 'Unauthorized' });
	});
	return { ...actual, authMiddleware };
});

const mockCalculateMatch = jest.fn();
jest.mock('../../../services/matching-engine', () => ({
	calculateDeterministicMatch: (...args) => mockCalculateMatch(...args),
}));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../lib/notify', () => ({
	notifyUser: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../../routes/chat', () => ({
	getOrCreateConversation: jest.fn().mockResolvedValue({ id: 1 }),
}));

const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const TEST_SECRET = 'synthetic-route-test-secret-for-815-0123456789';
const { fingerprintFor } = require('../../../lib/threatIntelChecks');

const state = { captureInserts: [], consentTextQueries: 0, applications: [] };

function installDbMock() {
	state.captureInserts = [];
	state.consentTextQueries = 0;
	state.applications = [];
	db.query.mockImplementation(async (sql, params = []) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
		if (normalized.includes('from users u') && normalized.includes('left join candidate_profiles')) {
			return { rows: [{ id: 1, name: 'Test Candidate', email: 'candidate@test.com', omniscore: null }], rowCount: 1 };
		}
		if (normalized.includes('from candidate_skills where user_id')) {
			return { rows: [], rowCount: 0 };
		}
		if (normalized.startsWith('select * from jobs where id =')) {
			return {
				rows: [{ id: 10, title: 'Backend Engineer', company: 'Acme', company_id: 7, user_id: null, auto_send_on_apply: false }],
				rowCount: 1,
			};
		}
		if (normalized.includes('from job_applications where candidate_id =')) {
			return { rows: [], rowCount: 0 };
		}
		if (normalized.includes('select stripe_subscription_id from users where id =')) {
			return { rows: [{ stripe_subscription_id: null }], rowCount: 1 };
		}
		if (normalized.startsWith('insert into job_applications')) {
			const row = {
				id: 555,
				candidate_id: params[0],
				job_id: params[1],
				company_id: params[2],
				cover_letter: params[3],
				match_score: params[4],
				is_auto_applied: params[7],
				applied_via: params[8],
			};
			state.applications.push(row);
			return { rows: [{ ...row }], rowCount: 1 };
		}
		if (normalized.includes('from consent_texts')) {
			state.consentTextQueries += 1;
			return { rows: [{ version: '1' }], rowCount: 1 };
		}
		if (normalized.startsWith('insert into application_ip_captures')) {
			state.captureInserts.push({ sql, params });
			return { rows: [{ id: 99 }], rowCount: 1 };
		}
		if (baseQueryImpl) return baseQueryImpl(sql, params);
		return { rows: [], rowCount: 0 };
	});
}

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/candidate', require('../../../routes/candidate'));
	return app;
}

describe('#815 POST /api/candidate/jobs/:jobId/apply — IP capture wiring', () => {
	const savedEnv = { ...process.env };
	beforeEach(() => {
		jest.clearAllMocks();
		installDbMock();
		global.__testUsers = { 1: { id: 1, role: 'candidate', email: 'candidate@test.com' } };
		mockCalculateMatch.mockReturnValue({ match_score: 65 });
		process.env.THREAT_INTEL_ENABLED = 'true';
		process.env.THREAT_INTEL_HMAC_SECRET = TEST_SECRET;
	});
	afterEach(() => {
		process.env = { ...savedEnv };
	});

	test('flag ON + consent true → exactly one capture, siloed fingerprint, response carries no fingerprint', async () => {
		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({ cover_letter: 'hi', screening_answers: {}, ip_capture_consent: true });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		expect(state.captureInserts).toHaveLength(1);
		const params = state.captureInserts[0].params;
		expect(params[0]).toBe(555); // application id
		expect(params[1]).toBe(1); // candidate id
		expect(params[2]).toBe(7); // company id from the job row
		// supertest originates from 127.0.0.1 (possibly ::ffff:-mapped,
		// which the capture normalises away).
		expect(params[3]).toBe(fingerprintFor(7, 'application_ip', '127.0.0.1'));
		expect(JSON.stringify(res.body)).not.toContain(params[3]);
		expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
	});

	test('flag ON + consent absent → application succeeds, NO capture, NO consent-text query', async () => {
		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({ cover_letter: 'hi', screening_answers: {} });
		expect(res.status).toBe(200);
		expect(state.captureInserts).toHaveLength(0);
		expect(state.consentTextQueries).toBe(0);
	});

	test('flag OFF + consent true → application succeeds, NO capture', async () => {
		process.env.THREAT_INTEL_ENABLED = 'false';
		const res = await request(buildApp())
			.post('/api/candidate/jobs/10/apply')
			.set('x-test-user-id', '1')
			.send({ cover_letter: 'hi', screening_answers: {}, ip_capture_consent: true });
		expect(res.status).toBe(200);
		expect(state.captureInserts).toHaveLength(0);
		expect(state.consentTextQueries).toBe(0);
	});

	test('structural: exactly one capture call site in routes/candidate.js (the manual apply route)', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../../routes/candidate.js'), 'utf8');
		const callSites = src.match(/captureApplicationIp\(/g) || [];
		// One import + one invocation — and the invocation sits in the
		// /jobs/:jobId/apply handler, after submitApplication.
		expect(callSites).toHaveLength(1);
		const applyIdx = src.indexOf("router.post('/jobs/:jobId/apply'");
		const captureIdx = src.indexOf('captureApplicationIp(');
		const autoApplyIdx = src.indexOf("router.post('/applications/auto-apply'");
		expect(captureIdx).toBeGreaterThan(applyIdx);
		expect(captureIdx).toBeLessThan(autoApplyIdx);
	});
});
