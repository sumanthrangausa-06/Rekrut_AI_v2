/**
 * #1477 — parsing_status 'uploaded' is unwritable.
 *
 * The fresh-install CHECK `chk_parsed_resumes_status` (migration 047 /
 * p2_schema_hardening.sql) allows ONLY: pending / processing / completed /
 * failed. The ≤50-chars branch of parseResumeRecord used to UPDATE the row
 * to 'uploaded' — a value the CHECK rejects — so on a real DB the UPDATE
 * threw, the helper's catch ran, and the row arrived at 'failed' only via
 * the exception path (with a spurious "Resume parsing failed" log).
 *
 * Decision (STOP 1 on #1477, Nova): retire 'uploaded' from the code — NO
 * migration. There is no legal distinct terminal status for insufficient
 * text in the allowed set ('completed' would fabricate parsed_data;
 * 'pending'/'processing' are non-terminal; 'processing_failed' does not
 * exist anywhere in the repo and would violate the same CHECK). The ≤50
 * branch therefore writes the honest terminal status 'failed' DIRECTLY.
 *
 * Unlike the #1471 suite, this DB mock EMULATES the CHECK constraint: an
 * UPDATE naming a status outside the allowed set throws a check-violation
 * error, exactly like a fresh-install Postgres. The pin is not only the
 * terminal state (old code also ended at 'failed', via the catch) but
 * that NO 'uploaded' UPDATE is ever attempted.
 *
 * These unit tests do NOT satisfy the Quinn E2E-on-dev gate for #1477.
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

const mockParseResume = jest.fn();
const mockChat = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	chat: (...args) => mockChat(...args),
	safeParseJSON: (text) => {
		if (!text || typeof text !== 'string') return null;
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	},
	parseResume: (...args) => mockParseResume(...args),
	generateSkillAssessment: jest.fn(),
	evaluateSkillAssessment: jest.fn(),
	generateJobMatchScore: jest.fn(),
	generateInterviewCoaching: jest.fn(),
}));

jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(async () => ({ url: 'https://files.example.test/resumes/cv.pdf' })),
	checkB2Health: jest.fn(async () => ({ healthy: true })),
}));

const mockPdfParse = jest.fn();
jest.mock('pdf-parse', () => (...args) => mockPdfParse(...args));
jest.mock('mammoth', () => ({
	extractRawText: jest.fn(async () => ({ value: '' })),
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

const PDF_BUFFER = Buffer.from('%PDF-1.4 fixture resume content');
// The exact fresh-install allowed set (migration 047).
const ALLOWED = ['pending', 'processing', 'completed', 'failed'];

let resumeRow;
let attemptedStatuses;

function installDb() {
	resumeRow = null;
	attemptedStatuses = [];
	mockQuery.mockImplementation(async (sql, params = []) => {
		if (/INSERT INTO parsed_resumes/i.test(sql)) {
			resumeRow = {
				id: 501,
				user_id: 42,
				parsing_status: 'processing',
				parsed_data: null,
				created_at: new Date(),
			};
			return { rows: [{ id: 501 }] };
		}
		if (/UPDATE parsed_resumes/i.test(sql)) {
			const m = /parsing_status\s*=\s*'([a-z_]+)'/i.exec(sql);
			if (m) {
				attemptedStatuses.push(m[1]);
				if (!ALLOWED.includes(m[1])) {
					// Emulate chk_parsed_resumes_status on a fresh install.
					const err = new Error(
						`new row for relation "parsed_resumes" violates check constraint "chk_parsed_resumes_status"`,
					);
					err.code = '23514';
					throw err;
				}
				if (resumeRow) {
					if (/AND parsing_status = 'processing'/i.test(sql)) {
						if (resumeRow.parsing_status === 'processing') resumeRow.parsing_status = m[1];
					} else {
						resumeRow.parsing_status = m[1];
						if (m[1] === 'completed') resumeRow.parsed_data = JSON.parse(params[0]);
					}
				}
			}
			return { rows: [], rowCount: 1 };
		}
		if (/SELECT stripe_subscription_id FROM users/i.test(sql)) {
			return { rows: [{ stripe_subscription_id: null }] };
		}
		if (/FROM parsed_resumes/i.test(sql)) {
			return resumeRow ? { rows: [{ ...resumeRow }] } : { rows: [] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	installDb();
	mockPdfParse.mockResolvedValue({ text: 'Too short' });
	mockParseResume.mockResolvedValue({});
	mockChat.mockResolvedValue('{}');
});

describe('#1477 ≤50-char extracted text — no unwritable status attempted', () => {
	test('POST /profile/resume: 200, row ends failed DIRECTLY, no uploaded UPDATE attempted', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/profile/resume')
			.attach('resume', PDF_BUFFER, { filename: 'cv.pdf', contentType: 'application/pdf' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		// Terminal status is the schema-legal honest one, in body and row.
		expect(res.body.parsing_status).toBe('failed');
		expect(resumeRow.parsing_status).toBe('failed');
		expect(resumeRow.parsed_data).toBeNull();
		// The pin: 'uploaded' (and any other illegal status) is never attempted.
		expect(attemptedStatuses).not.toContain('uploaded');
		expect(attemptedStatuses).toEqual(['failed']);
		expect(mockParseResume).not.toHaveBeenCalled();
	});

	test('POST /resume/upload: row ends failed DIRECTLY, no uploaded UPDATE attempted', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/resume/upload')
			.attach('resume', PDF_BUFFER, { filename: 'cv.pdf', contentType: 'application/pdf' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(resumeRow.parsing_status).toBe('failed');
		expect(attemptedStatuses).not.toContain('uploaded');
		expect(attemptedStatuses).toEqual(['failed']);
		expect(mockParseResume).not.toHaveBeenCalled();
	});
});
