/**
 * #1611 — document stats endpoints fabricate an average authenticity of 0.
 *
 * routes/documents.js GET /stats/summary and routes/candidate-documents.js
 * GET /stats both used `COALESCE(AVG(dv.authenticity_score), 0)`.
 * Postgres AVG ignores NULLs and returns NULL when no measured (non-NULL)
 * score exists — the honest unmeasured state after #1569/#1586 — so the
 * COALESCE turned "never measured" into a measured-looking 0.
 * Fix: plain AVG(...) — null when unmeasured, true average when measured.
 *
 * Mocking note: only module boundaries are stubbed (db, auth, storage,
 * email, crypto, virus scanner, verification service). The fake DB
 * reproduces the exact Postgres semantics of the expression under test:
 * AVG over the seeded scores ignoring NULLs, NULL when none are measured,
 * and a wrapping COALESCE(AVG(...), 0) — if present in the SQL the handler
 * actually sends — converting that NULL to 0. Express routing and both
 * handlers run for real. The Quinn HL-003 gate (real PG, real HTTP)
 * provides the fresh-install proof; this suite is the red/green lane test.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: (req, res, next) => {
		req.user = { id: 42, role: 'candidate', company_id: null };
		return next();
	},
	requireRole: () => (req, res, next) => next(),
}));

// Seeded authenticity scores for the fake document_verifications join.
// null = a verification row whose score was never measured (#1569 state).
let seededScores = [];

const mockQuery = jest.fn(async (sql) => {
	const q = String(sql);
	if (/AVG\(dv\.authenticity_score\)/i.test(q)) {
		const measured = seededScores.filter((s) => s !== null);
		const avg = measured.length
			? measured.reduce((a, b) => a + b, 0) / measured.length
			: null;
		// Postgres: COALESCE(AVG(...), 0) converts the unmeasured NULL to 0.
		const coalesced = /COALESCE\(\s*AVG\(dv\.authenticity_score\)\s*,\s*0\s*\)/i.test(q);
		return {
			rows: [
				{
					total_documents: String(seededScores.length),
					verified_documents: '0',
					flagged_documents: '0',
					rejected_documents: '0',
					pending_documents: '0',
					pending_review_documents: '0',
					expired_documents: '0',
					verified_credentials: '0',
					total_score_impact: '0',
					avg_authenticity_score: avg === null ? (coalesced ? '0' : null) : String(avg),
				},
			],
		};
	}
	return { rows: [] };
});
jest.mock('../../../lib/db', () => ({
	query: (...args) => mockQuery(...args),
	connect: async () => ({ query: (...args) => mockQuery(...args), release: jest.fn() }),
}));

jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(async () => ({ url: 'https://example.invalid/f' })),
	checkB2Health: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../../lib/email-service', () => ({}));
jest.mock('../../../lib/document-crypto', () => ({
	encryptBuffer: (b) => b,
	decryptBuffer: (b) => b,
}));
jest.mock('../../../lib/virus-scanner', () => ({
	scanFile: jest.fn(async () => ({ clean: true })),
	logScanEvent: jest.fn(async () => {}),
}));
jest.mock('../../../services/document-verification', () => ({
	verifyDocument: jest.fn(async () => ({})),
	applyDocumentScoresToOmniScore: jest.fn(async () => {}),
	logDocumentAccess: jest.fn(async () => {}),
}));

const documentsRouter = require('../../../routes/documents');
const candidateDocumentsRouter = require('../../../routes/candidate-documents');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/documents', documentsRouter);
	app.use('/api/candidate/documents', candidateDocumentsRouter);
	return app;
}

beforeAll(() => {
	jest.spyOn(console, 'log').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => jest.clearAllMocks());

describe.each([
	['GET /api/documents/stats/summary', '/api/documents/stats/summary'],
	['GET /api/candidate/documents/stats', '/api/candidate/documents/stats'],
])('#1611 %s', (_name, path) => {
	test('all documents unmeasured (NULL scores) → avg_authenticity_score is null, not 0', async () => {
		seededScores = [null, null];
		const res = await request(buildApp()).get(path);
		expect(res.status).toBe(200);
		expect(res.body.stats.avg_authenticity_score).toBeNull();
	});

	test('no documents at all → avg_authenticity_score is null, not 0', async () => {
		seededScores = [];
		const res = await request(buildApp()).get(path);
		expect(res.status).toBe(200);
		expect(res.body.stats.avg_authenticity_score).toBeNull();
	});

	test('measured scores → real average returned unchanged (80, 90 → 85)', async () => {
		seededScores = [80, 90, null];
		const res = await request(buildApp()).get(path);
		expect(res.status).toBe(200);
		expect(Number(res.body.stats.avg_authenticity_score)).toBe(85);
	});
});
