/**
 * #1471 — Profile resume upload never parses.
 *
 * The UI's upload endpoint (POST /candidate/profile/resume) INSERTed a
 * parsed_resumes row at parsing_status='processing' and never extracted,
 * never parsed, never advanced it — so POST /cv/analyze read NULL
 * parsed_data from the latest row and returned a deterministic 400
 * EMPTY_DOCUMENT for every real UI upload.
 *
 * Contract under test (STOP 1 on #1471 — Lead + Rex, Scout evidence):
 *  - The parse lifecycle (extract → subscription lookup → parseResume
 *    with the 30s race → terminal-status UPDATEs) lives in ONE helper,
 *    parseResumeRecord, used by BOTH upload handlers. It returns
 *    { status, parsedData } and never throws: every path lands
 *    'completed' / 'uploaded' (text ≤50 chars) / 'failed' (exception).
 *  - /profile/resume calls the helper after its INSERT. Parse failure is
 *    NON-FATAL to the upload: response stays 200 with the row in a
 *    terminal status. Response keeps { success, resume_url,
 *    resume_filename } and may add parsing_status. NO auto-apply here.
 *  - /resume/upload is refactored onto the helper preserving behaviour:
 *    auto-apply still runs after the 'completed' UPDATE and still
 *    mutates parsedData._applySummary AFTER the DB write.
 *  - /cv/analyze on a latest row that is 'processing' with NULL
 *    parsed_data: older than 5 minutes → row flipped to 'failed'
 *    (UPDATE guarded by parsing_status='processing'), 400
 *    RESUME_NOT_PARSED with re-upload copy; younger → 400
 *    RESUME_NOT_PARSED with still-processing copy, row untouched.
 *    Other statuses keep the existing EMPTY_DOCUMENT behaviour.
 *
 * Mocking note (same as neighbouring candidate-route suites): only the
 * module boundaries are stubbed — db, auth, subscription, polsia-ai
 * (parseResume/chat), file-storage (uploadToB2) and pdf-parse. The db
 * mock is STATEFUL for the parsed_resumes row so terminal-status
 * behaviour is tested through the real route, not SQL text alone.
 * These unit tests do NOT satisfy the Quinn E2E-on-dev gate for #1471.
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

// ─── AI boundary (stubbed input condition) ──────────────────────────────────
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

// ─── Storage boundary ───────────────────────────────────────────────────────
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(async () => ({ url: 'https://files.example.test/resumes/cv.pdf' })),
	checkB2Health: jest.fn(async () => ({ healthy: true })),
}));

// ─── PDF extraction boundary ────────────────────────────────────────────────
const mockPdfParse = jest.fn();
jest.mock('pdf-parse', () => (...args) => mockPdfParse(...args));
jest.mock('mammoth', () => ({
	extractRawText: jest.fn(async () => ({ value: '' })),
}));

// ─── DB mock (stateful for parsed_resumes) ──────────────────────────────────
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

const LONG_TEXT =
	'Fixture Person — Data Analyst with eight years of experience in SQL, ' +
	'Python, dashboards and stakeholder reporting across large datasets.';
const PARSED = {
	contact: { name: 'Fixture Person' },
	skills: [{ name: 'PostgreSQL', category: 'technical', level: 4 }],
	experience: [],
	education: [],
};
const PDF_BUFFER = Buffer.from('%PDF-1.4 fixture resume content');

let resumeRow;

function installUploadDb() {
	resumeRow = null;
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
			if (!resumeRow) return { rows: [], rowCount: 0 };
			if (/parsing_status = 'completed'/i.test(sql)) {
				resumeRow.parsing_status = 'completed';
				// Snapshot exactly what was written to the DB at write time.
				resumeRow.parsed_data = JSON.parse(params[0]);
			} else if (/parsing_status = 'uploaded'/i.test(sql)) {
				resumeRow.parsing_status = 'uploaded';
			} else if (/parsing_status = 'failed'/i.test(sql)) {
				if (/AND parsing_status = 'processing'/i.test(sql)) {
					if (resumeRow.parsing_status === 'processing') resumeRow.parsing_status = 'failed';
				} else {
					resumeRow.parsing_status = 'failed';
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

function installAnalyzeDb({ status, ageMinutes, parsedData = null }) {
	resumeRow = {
		id: 99,
		user_id: 42,
		parsing_status: status,
		parsed_data: parsedData,
		created_at: new Date(Date.now() - ageMinutes * 60000),
	};
	mockQuery.mockImplementation(async (sql) => {
		if (/UPDATE parsed_resumes/i.test(sql) && /parsing_status = 'failed'/i.test(sql)) {
			if (resumeRow.parsing_status === 'processing') resumeRow.parsing_status = 'failed';
			return { rows: [], rowCount: 1 };
		}
		if (/FROM parsed_resumes/i.test(sql)) {
			return { rows: [{ ...resumeRow }] };
		}
		if (/INSERT INTO cv_analyses/i.test(sql)) {
			return { rows: [{ id: 7 }] };
		}
		return { rows: [] };
	});
}

function callsMatching(re) {
	return mockQuery.mock.calls.filter(([sql]) => re.test(sql));
}

beforeEach(() => {
	jest.clearAllMocks();
	installUploadDb();
	mockPdfParse.mockResolvedValue({ text: LONG_TEXT });
	mockParseResume.mockResolvedValue(JSON.parse(JSON.stringify(PARSED)));
	mockChat.mockResolvedValue('{}');
});

describe('#1471 POST /profile/resume — parses via the shared lifecycle', () => {
	test('valid text-extractable PDF → 200 and row ends completed with parsed_data populated', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/profile/resume')
			.attach('resume', PDF_BUFFER, { filename: 'cv.pdf', contentType: 'application/pdf' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.resume_url).toBe('https://files.example.test/resumes/cv.pdf');
		expect(res.body.resume_filename).toBe('cv.pdf');
		expect(res.body.parsing_status).toBe('completed');

		expect(mockParseResume).toHaveBeenCalledTimes(1);
		expect(mockParseResume.mock.calls[0][0]).toContain('Fixture Person');
		expect(resumeRow.parsing_status).toBe('completed');
		expect(resumeRow.parsed_data).toEqual(PARSED);
	});

	test('extraction yields ≤50 chars → still 200, row terminal uploaded, never processing', async () => {
		mockPdfParse.mockResolvedValue({ text: 'Too short' });

		const res = await request(makeApp())
			.post('/api/candidate/profile/resume')
			.attach('resume', PDF_BUFFER, { filename: 'cv.pdf', contentType: 'application/pdf' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.parsing_status).toBe('uploaded');
		expect(resumeRow.parsing_status).toBe('uploaded');
		expect(mockParseResume).not.toHaveBeenCalled();
	});

	test('parse throws → still 200, row terminal failed, never processing', async () => {
		mockParseResume.mockRejectedValue(new Error('AI provider down'));

		const res = await request(makeApp())
			.post('/api/candidate/profile/resume')
			.attach('resume', PDF_BUFFER, { filename: 'cv.pdf', contentType: 'application/pdf' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.parsing_status).toBe('failed');
		expect(resumeRow.parsing_status).toBe('failed');
	});

	test('extraction throws → still 200, row terminal failed, never processing', async () => {
		mockPdfParse.mockRejectedValue(new Error('corrupt pdf'));

		const res = await request(makeApp())
			.post('/api/candidate/profile/resume')
			.attach('resume', PDF_BUFFER, { filename: 'cv.pdf', contentType: 'application/pdf' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.parsing_status).toBe('failed');
		expect(resumeRow.parsing_status).toBe('failed');
	});
});

describe('#1471 POST /resume/upload — behaviour preserved on the helper', () => {
	test('still completes, and auto-apply summary mutates parsed_data only AFTER the DB write', async () => {
		const res = await request(makeApp())
			.post('/api/candidate/resume/upload')
			.attach('resume', PDF_BUFFER, { filename: 'cv.pdf', contentType: 'application/pdf' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.resume_id).toBe(501);
		expect(resumeRow.parsing_status).toBe('completed');

		// Auto-apply ran (contact present) and its summary is on the response…
		expect(res.body.parsed_data._applySummary).toEqual({
			profile: true,
			experience: 0,
			education: 0,
			skills: 1,
		});
		// …but the row was written BEFORE that mutation, so the persisted
		// parsed_data carries no _applySummary (today's exact ordering).
		expect(resumeRow.parsed_data).toEqual(PARSED);
		expect(resumeRow.parsed_data._applySummary).toBeUndefined();
	});
});

describe('#1471 POST /cv/analyze — stranded processing rows', () => {
	test('stale processing row (>5 min, NULL parsed_data) → 400 RESUME_NOT_PARSED and row flipped to failed', async () => {
		installAnalyzeDb({ status: 'processing', ageMinutes: 10 });

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('RESUME_NOT_PARSED');
		expect(res.body.error).toMatch(/upload/i);
		expect(resumeRow.parsing_status).toBe('failed');
		expect(mockChat).not.toHaveBeenCalled();
		expect(callsMatching(/INSERT INTO cv_analyses/i)).toHaveLength(0);
	});

	test('fresh processing row (<5 min) → 400 RESUME_NOT_PARSED still-processing copy, row untouched', async () => {
		installAnalyzeDb({ status: 'processing', ageMinutes: 1 });

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('RESUME_NOT_PARSED');
		expect(res.body.error).toContain('still processing');
		expect(resumeRow.parsing_status).toBe('processing');
		expect(callsMatching(/UPDATE parsed_resumes/i)).toHaveLength(0);
		expect(mockChat).not.toHaveBeenCalled();
	});

	test('non-processing status with empty parsed_data keeps EMPTY_DOCUMENT behaviour', async () => {
		installAnalyzeDb({ status: 'uploaded', ageMinutes: 60, parsedData: {} });

		const res = await request(makeApp()).post('/api/candidate/cv/analyze').send({});

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('EMPTY_DOCUMENT');
		expect(resumeRow.parsing_status).toBe('uploaded');
		expect(mockChat).not.toHaveBeenCalled();
	});
});
