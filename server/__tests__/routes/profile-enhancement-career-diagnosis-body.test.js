/**
 * #1268: POST /api/career-diagnosis body contract — fail loudly, never tolerate
 * a double-encoded / string body.
 *
 * Background: #1261's client bug (double-stringified body) was masked because
 * a malformed body never surfaced as a clear contract error. On current dev
 * there is no explicit double-parse in the handler; a double-encoded wire
 * body dies in body-parser (strict mode) with an opaque HTML 400 in a bare
 * harness / a generic 500 via the app's global error handler, and a string
 * body delivered by any non-strict parser would be destructured silently.
 *
 * Contract after this fix:
 *  - plain JSON object body { quizAnswers: [...] }        → 200 (unchanged)
 *  - double-encoded wire body (JSON string of JSON text)  → 400 JSON
 *    { error: 'Request body must be valid JSON' } via the path-scoped
 *    body-parse error handler mounted in server.js
 *  - a string body that reaches the handler (any parser
 *    configuration)                                       → 400 JSON
 *    { error: 'Request body must be a JSON object' } — never re-parsed
 *  - wrong field { answers: [...] }                       → 400
 *    'Quiz answers are required' (existing contract, unchanged)
 * No request body contents are logged anywhere in this path.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(async () => ({ url: 'https://example.invalid/x' })),
}));

const pool = require('../../../lib/db');
const profileEnhancement = require('../../../routes/profile-enhancement');
const router = profileEnhancement;

const ANSWERS = [{ question: 'How do you prefer to solve problems?', answer: 'Analyze data' }];

function buildApp({ strict = true, withParseErrorHandler = true } = {}) {
	const app = express();
	app.use(express.json({ limit: '50mb', strict }));
	if (withParseErrorHandler && typeof profileEnhancement.careerDiagnosisBodyParseError === 'function') {
		app.use(profileEnhancement.careerDiagnosisBodyParseError);
	}
	app.use('/api', router);
	return app;
}

describe('POST /api/career-diagnosis body contract (#1268)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		pool.query.mockImplementation(async (sql) => {
			if (sql.includes('INSERT INTO career_diagnoses')) return { rows: [{ id: 1 }] };
			return { rows: [] };
		});
	});

	it('control: plain object body with quizAnswers → 200', async () => {
		const res = await request(buildApp()).post('/api/career-diagnosis').send({ quizAnswers: ANSWERS });
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it('double-encoded wire body → clear 400 JSON contract error, not opaque parser 400/500', async () => {
		expect(typeof profileEnhancement.careerDiagnosisBodyParseError).toBe('function');
		const wire = JSON.stringify(JSON.stringify({ quizAnswers: ANSWERS }));
		const res = await request(buildApp())
			.post('/api/career-diagnosis')
			.set('Content-Type', 'application/json')
			.send(wire);
		expect(res.status).toBe(400);
		expect(res.headers['content-type']).toMatch(/application\/json/);
		expect(res.body).toEqual({ error: 'Request body must be valid JSON' });
	});

	it('string body reaching the handler is rejected, never re-parsed → 400 contract error', async () => {
		// strict:false simulates any parser configuration that delivers a
		// parsed JSON string as req.body; the handler must not JSON.parse it.
		const wire = JSON.stringify(JSON.stringify({ quizAnswers: ANSWERS }));
		const res = await request(buildApp({ strict: false, withParseErrorHandler: false }))
			.post('/api/career-diagnosis')
			.set('Content-Type', 'application/json')
			.send(wire);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'Request body must be a JSON object' });
		// The tolerant outcome would have inserted a diagnosis; it must not.
		const inserts = pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO career_diagnoses'));
		expect(inserts).toHaveLength(0);
	});

	it('wrong field { answers } → existing 400 contract error unchanged', async () => {
		const res = await request(buildApp()).post('/api/career-diagnosis').send({ answers: ANSWERS });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'Quiz answers are required' });
	});
});
