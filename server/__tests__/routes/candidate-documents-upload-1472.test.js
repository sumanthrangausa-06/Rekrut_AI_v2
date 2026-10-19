/**
 * Issue #1472 — POST /api/candidate/documents/upload multipart branch.
 *
 * Before this fix the winning handler in routes/candidate.js was JSON-only:
 * a multipart upload hit `if (!name || !url) 400 "Name and URL are required"`
 * because req.body carries form fields, not {name,url}. The Documents page
 * therefore could never store a file.
 *
 * Contract under test (Lead STOP 1 on #1472):
 *  - multipart/form-data (field name `file`, matching documents.tsx) →
 *    file stored via the existing uploadToB2 plumbing, a row INSERTed into
 *    the SAME `documents` table GET /documents reads, and the created
 *    document returned in the shape the client list expects.
 *  - JSON {name,url,...} → today's behaviour unchanged, including the 400
 *    when name/url are missing.
 *
 * Mocking note: only module boundaries are stubbed — db (a stateful fake of
 * the `documents` table, so POST → GET is a real read-back through the
 * handlers), auth, subscription, polsia-ai, and file-storage's uploadToB2
 * (the storage provider boundary; its return value is the input condition).
 * Multer, Express routing and the handlers themselves run for real.
 * These unit tests do NOT satisfy the Quinn browser E2E-on-dev gate.
 */
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

// ─── AI boundary (routes/candidate.js requires it at load) ─────────────────
jest.mock('../../../lib/polsia-ai', () => ({
	parseResume: jest.fn(),
	generateSkillAssessment: jest.fn(),
	evaluateSkillAssessment: jest.fn(),
	generateJobMatchScore: jest.fn(),
	generateInterviewCoaching: jest.fn(),
}));

// ─── Storage boundary ───────────────────────────────────────────────────────
const mockUploadToB2 = jest.fn();
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: (...args) => mockUploadToB2(...args),
	checkB2Health: jest.fn(async () => ({ ok: true })),
}));

// ─── DB: stateful fake of the `documents` table ─────────────────────────────
const docRows = [];
let nextDocId = 1;
const mockQuery = jest.fn(async (sql, params = []) => {
	if (/CREATE TABLE IF NOT EXISTS documents/i.test(sql)) return { rows: [] };
	if (/INSERT INTO documents/i.test(sql)) {
		const [user_id, name, type, url, size] = params;
		const row = {
			id: nextDocId++,
			user_id,
			name,
			type,
			url,
			size,
			status: 'pending',
			created_at: new Date(),
		};
		docRows.push(row);
		return { rows: [row] };
	}
	if (/FROM documents/i.test(sql)) {
		const rows = docRows
			.filter((r) => r.user_id === params[0])
			.map((r) => ({
				id: r.id,
				name: r.name,
				type: r.type,
				url: r.url,
				size: r.size,
				status: r.status,
				fraudscore: null,
				ocrtext: null,
				ocrconfidence: null,
				documentscore: null,
				verificationdetails: null,
				uploadedat: r.created_at,
			}));
		return { rows };
	}
	return { rows: [] };
});
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

beforeEach(() => {
	jest.clearAllMocks();
	docRows.length = 0;
	nextDocId = 1;
	mockUploadToB2.mockResolvedValue({
		url: 'https://storage.example/documents/resume.pdf',
		key: 'documents/resume.pdf',
		provider: 'r2',
	});
});

describe('POST /api/candidate/documents/upload — multipart branch (#1472)', () => {
	test('stores the file, inserts a documents row, and GET list returns it', async () => {
		const app = makeApp();
		const res = await request(app)
			.post('/api/candidate/documents/upload')
			.field('type', 'other')
			.attach('file', Buffer.from('%PDF-1.4 fake'), {
				filename: 'resume.pdf',
				contentType: 'application/pdf',
			});

		expect(res.status).toBe(200);
		expect(mockUploadToB2).toHaveBeenCalledTimes(1);
		expect(mockUploadToB2.mock.calls[0][0]).toMatchObject({
			mimetype: 'application/pdf',
			filename: 'resume.pdf',
		});
		expect(res.body.document).toMatchObject({
			name: 'resume.pdf',
			type: 'other',
			url: 'https://storage.example/documents/resume.pdf',
			status: 'pending',
		});
		expect(res.body.document.size).toBeGreaterThan(0);

		const list = await request(app).get('/api/candidate/documents');
		expect(list.status).toBe(200);
		expect(list.body.documents).toHaveLength(1);
		expect(list.body.documents[0]).toMatchObject({
			name: 'resume.pdf',
			url: 'https://storage.example/documents/resume.pdf',
		});
	});

	test('multipart request with no file is a 400, not a stored row', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/documents/upload')
			.field('type', 'other');
		expect(res.status).toBe(400);
		expect(mockUploadToB2).not.toHaveBeenCalled();
		expect(docRows).toHaveLength(0);
	});
});

describe('POST /api/candidate/documents/upload — JSON branch unchanged (#1472)', () => {
	test('JSON {name,url} still creates a document', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/documents/upload')
			.send({ name: 'cert.pdf', type: 'certificate', url: 'https://x/cert.pdf', size: 123 });
		expect(res.status).toBe(200);
		expect(mockUploadToB2).not.toHaveBeenCalled();
		expect(res.body.document).toMatchObject({
			name: 'cert.pdf',
			type: 'certificate',
			url: 'https://x/cert.pdf',
			size: 123,
			status: 'pending',
		});
	});

	test('JSON without name/url still 400s with the original message', async () => {
		const res = await request(makeApp()).post('/api/candidate/documents/upload').send({});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('Name and URL are required');
	});
});
