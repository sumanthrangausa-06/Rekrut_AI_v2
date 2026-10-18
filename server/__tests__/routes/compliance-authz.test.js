/**
 * S-097 (#821): compliance router object-level authorisation.
 *
 * Root cause: routes/compliance.js authenticated but did not authorise per
 * object — the explain family and the legacy audit read/export endpoints
 * served any record to any authenticated user (live-proven IDOR: an
 * unrelated company-B recruiter read a company-A candidate's decision
 * explanation, including recruiter_notes, by enumerating sequential IDs).
 *
 * Desired behaviour (STOP 1 plan on #821 + Lead's ruling):
 * - GET /explain/decision/:applicationId — route guard BEFORE the service
 *   call (explainDecision re-throws on the phantom candidate_job_matches
 *   table, so authorisation must not depend on the service): admin, the
 *   candidate themself, or a hiring role whose company_id owns the
 *   application. Everyone else — and non-existent IDs — get the same 404
 *   (no existence oracle).
 * - Audience shaping: a candidate-self caller never receives
 *   decision.recruiter_notes (S-087 toCandidateSafeReport precedent —
 *   shape at the route boundary); recruiter-of-record / admin keep the
 *   full record unchanged. Fix round (privacy F1 / security F-3, Lead's
 *   ruling): shaping keys on the authorisation identity
 *   (`isCandidateSelf && !isAdmin`), not on `role === 'candidate'` — a
 *   self-applicant whose account role is no longer `candidate` is still
 *   the candidate audience; an admin (even if self) keeps the full record.
 * - GET /explain/omniscore/:userId — user-record shape, so the file's own
 *   canAccessUserRecord (self-or-admin) governs, extended only for hiring
 *   roles with a job_applications linkage to the caller's company.
 * - GET /explain/job/:jobId/candidate/:candidateId — candidate-self, admin,
 *   or a hiring role whose company owns the job; foreign jobs 404.
 *   Fix round (security F-1, Lead ruling option (a)): hiring roles must
 *   additionally have a job_applications candidate×company linkage —
 *   owning a job alone no longer suffices for an unlinked candidate;
 *   the denial is the endpoint's existing non-subject-candidate 403.
 * - GET /audit/logs + POST /audit/export — admin-only (Lead's ruling:
 *   audit_logs has no company_id, so company-scoping is not implementable;
 *   the company-scoped regulator export already exists at
 *   /audit-trail/export). Non-admin → 403, service never reached.
 * - Already-guarded siblings (gdpr consents, consent history) are the
 *   regression baseline: self reads unchanged, other-user reads still 403.
 *
 * Mock note: the DB mock honours the guard queries exactly as written
 * (application/job anchor loads + linkage SELECT), and the service mocks
 * record every call — a denied caller must never reach a service mock.
 */
const express = require('express');
const request = require('supertest');

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

const mockExplainDecision = jest.fn();
const mockExplainOmniScore = jest.fn();
jest.mock('../../../services/scoreExplainer', () => ({
	explainDecision: (...args) => mockExplainDecision(...args),
	explainOmniScore: (...args) => mockExplainOmniScore(...args),
	explainDecisionForJob: jest.fn(),
}));

const mockAuditQuery = jest.fn();
const mockAuditExportLogs = jest.fn();
const mockAuditLog = jest.fn(async () => {});
const mockLogEvent = jest.fn(async () => ({}));
const mockGetCandidateDecisions = jest.fn();
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: {
		query: (...args) => mockAuditQuery(...args),
		exportLogs: (...args) => mockAuditExportLogs(...args),
		log: (...args) => mockAuditLog(...args),
	},
	logEvent: (...args) => mockLogEvent(...args),
	getAuditTrail: jest.fn(async () => ({ rows: [] })),
	getCandidateDecisions: (...args) => mockGetCandidateDecisions(...args),
	verifyChain: jest.fn(async () => ({})),
	exportForRegulator: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision', STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

const mockExplainDecisionForJob = jest.fn();
const mockGetConsentHistory = jest.fn();
const mockGetBiasMetricsForJob = jest.fn();
const mockCalculateBiasMetricsForJob = jest.fn();
const mockCalculateFourFifthsRule = jest.fn();
const mockGetOverrideById = jest.fn();
jest.mock('../../../services/euComplianceService', () => ({
	explainDecisionForJob: (...args) => mockExplainDecisionForJob(...args),
	getConsentHistory: (...args) => mockGetConsentHistory(...args),
	classifyJobRisk: jest.fn(),
	getJobRiskClassification: jest.fn(),
	listJobRiskClassifications: jest.fn(async () => ({ rows: [] })),
	calculateBiasMetricsForJob: (...args) => mockCalculateBiasMetricsForJob(...args),
	getBiasMetricsForJob: (...args) => mockGetBiasMetricsForJob(...args),
	listFlaggedBiasMetrics: jest.fn(async () => ({ rows: [] })),
	recordHumanOverride: jest.fn(),
	getOverridesForJob: jest.fn(async () => ({ rows: [] })),
	getOverrideById: (...args) => mockGetOverrideById(...args),
	setRetentionPolicy: jest.fn(),
	executePurge: jest.fn(async () => []),
	recordConsent: jest.fn(),
	revokeConsent: jest.fn(),
	generateTransparencyReport: jest.fn(),
	getTransparencyReports: jest.fn(async () => ({ rows: [] })),
	finalizeTransparencyReport: jest.fn(),
}));

jest.mock('../../../services/biasDetection', () => ({
	generateReport: jest.fn(async () => ({
		reportId: 1,
		demographicAnalysis: { flaggedPatterns: [] },
		distributionAnalysis: { anomalies: [] },
	})),
	getReports: jest.fn(async () => []),
	calculateFourFifthsRule: (...args) => mockCalculateFourFifthsRule(...args),
}));

const db = require('../../../lib/db');

const COMPANY_A = 5;
const COMPANY_B = 6;

// application 100: candidate A applied to a company-A job (job 50).
// application 101: candidate B applied to a company-A job (job 50).
// application 102: the admin user (id 1) is the applicant (admin-even-if-self).
// application 103: user 23 is the applicant — their account role is now
// `recruiter` (converted account), so they are authorised as candidate-self
// by identity, not by role.
const applications = new Map([
	[100, { id: 100, candidate_id: 21, company_id: COMPANY_A, job_id: 50 }],
	[101, { id: 101, candidate_id: 22, company_id: COMPANY_A, job_id: 50 }],
	[102, { id: 102, candidate_id: 1, company_id: COMPANY_A, job_id: 50 }],
	[103, { id: 103, candidate_id: 23, company_id: COMPANY_A, job_id: 50 }],
]);
const jobs = new Map([
	[50, { id: 50, company_id: COMPANY_A }],
	[51, { id: 51, company_id: null }],
]);

// #920: candidate 21's compliance_audit_trail events span two companies —
// two events for company A (the linked company) and one for company B.
const AUDIT_EVENTS = [
	{ id: 1, entity_type: 'candidate', entity_id: 21, company_id: COMPANY_A, event_type: 'ai_decision' },
	{ id: 2, entity_type: 'candidate', entity_id: 21, company_id: COMPANY_B, event_type: 'ai_decision' },
	{ id: 3, entity_type: 'candidate', entity_id: 21, company_id: COMPANY_A, event_type: 'status_change' },
];

db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

	if (normalized.startsWith('select candidate_id, company_id from job_applications')) {
		const row = applications.get(Number(params[0]));
		return {
			rows: row ? [{ candidate_id: row.candidate_id, company_id: row.company_id }] : [],
			rowCount: row ? 1 : 0,
		};
	}
	if (normalized.startsWith('select 1 from job_applications')) {
		const linked = [...applications.values()].some(
			(a) =>
				Number(a.candidate_id) === Number(params[0]) && Number(a.company_id) === Number(params[1]),
		);
		return { rows: linked ? [{ '?column?': 1 }] : [], rowCount: linked ? 1 : 0 };
	}
	if (normalized.startsWith('select company_id from jobs')) {
		const row = jobs.get(Number(params[0]));
		return { rows: row ? [{ company_id: row.company_id }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from compliance_audit_trail')) {
		// #920: honours the actual service's queries exactly as written —
		// when (and only when) the SQL carries a company_id condition, the
		// next positional param is the company and the rows/total scope.
		let rows = AUDIT_EVENTS.filter((e) => Number(e.entity_id) === Number(params[1]));
		let idx = 2;
		if (normalized.includes('company_id =')) {
			const companyId = params[idx++];
			rows = rows.filter((e) => Number(e.company_id) === Number(companyId));
		}
		if (normalized.includes('count(*)')) {
			return { rows: [{ total: String(rows.length) }], rowCount: 1 };
		}
		const limit = params[idx++] ?? rows.length;
		const offset = params[idx++] ?? 0;
		const sliced = rows.slice(offset, offset + limit);
		return { rows: sliced, rowCount: sliced.length };
	}
	if (normalized.includes('from consent_records where user_id =')) {
		const rows =
			Number(params[0]) === 21
				? [{ id: 1, user_id: 21, consent_type: 'recording', consented: true }]
				: [];
		return { rows, rowCount: rows.length };
	}
	return { rows: [], rowCount: 0 };
});

const complianceRoutes = require('../../../routes/compliance');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}
const app = buildApp();

const ADMIN = { id: 1, email: 'admin@test.com', role: 'admin', company_id: null };
const RECRUITER_A = { id: 10, email: 'ra@test.com', role: 'recruiter', company_id: COMPANY_A };
const RECRUITER_B = { id: 11, email: 'rb@test.com', role: 'recruiter', company_id: COMPANY_B };
const EMPLOYER_A = { id: 12, email: 'ea@test.com', role: 'employer', company_id: COMPANY_A };
const EMPLOYER_B = { id: 13, email: 'eb@test.com', role: 'employer', company_id: COMPANY_B };
const CANDIDATE_A = { id: 21, email: 'ca@test.com', role: 'candidate', company_id: null };
const CANDIDATE_B = { id: 22, email: 'cb@test.com', role: 'candidate', company_id: null };
const HIRING_MANAGER_A = {
	id: 14,
	email: 'hma@test.com',
	role: 'hiring_manager',
	company_id: COMPANY_A,
};
const HIRING_MANAGER_B = {
	id: 15,
	email: 'hmb@test.com',
	role: 'hiring_manager',
	company_id: COMPANY_B,
};
// Converted account: applied as a candidate (application 103), account
// role is now `recruiter` at a different company — self by identity only.
const CONVERTED_RECRUITER = {
	id: 23,
	email: 'conv@test.com',
	role: 'recruiter',
	company_id: COMPANY_B,
};
const RECRUITER_NO_COMPANY = {
	id: 16,
	email: 'rnc@test.com',
	role: 'recruiter',
	company_id: null,
};

const FULL_EXPLANATION = {
	application_id: 100,
	candidate: { name: 'Candidate A', email: 'ca@test.com' },
	job: { title: 'Engineer' },
	decision: {
		status: 'rejected',
		decided_at: '2026-10-01T00:00:00.000Z',
		recruiter_notes: 'SECRET_RECRUITER_NOTES',
	},
	factors: [],
};

beforeEach(() => {
	global.__testUsers = {
		1: ADMIN,
		10: RECRUITER_A,
		11: RECRUITER_B,
		12: EMPLOYER_A,
		13: EMPLOYER_B,
		14: HIRING_MANAGER_A,
		15: HIRING_MANAGER_B,
		16: RECRUITER_NO_COMPANY,
		21: CANDIDATE_A,
		22: CANDIDATE_B,
		23: CONVERTED_RECRUITER,
	};
	jest.clearAllMocks();
	mockExplainDecision.mockResolvedValue(JSON.parse(JSON.stringify(FULL_EXPLANATION)));
	mockExplainOmniScore.mockResolvedValue({ overall_score: 72, score_breakdown: {} });
	mockExplainDecisionForJob.mockResolvedValue({ user_id: 21, job_id: 50, factor_breakdowns: [] });
	mockAuditQuery.mockResolvedValue([{ id: 1, action_type: 'login' }]);
	mockAuditExportLogs.mockResolvedValue([{ id: 1, action_type: 'login' }]);
	mockGetConsentHistory.mockResolvedValue({ history: [{ id: 1 }], total: 1 });
	mockGetBiasMetricsForJob.mockResolvedValue([
		{ job_id: 50, metric_type: 'selection_rate', flagged: false },
	]);
	mockCalculateFourFifthsRule.mockResolvedValue({ job_id: 50, four_fifths_results: [] });
	mockCalculateBiasMetricsForJob.mockResolvedValue([]);
	// #1113: override 200 is about candidate 21, on job 50 (company A),
	// recorded by recruiter A. Override 201 is on the same company-A job
	// but was recorded by recruiter B (actor-self case).
	const overrides = new Map([
		[200, { id: 200, application_id: 100, user_id: 21, job_id: 50, overridden_by: 10, reason: 'OVERRIDE_REASON_INTERNAL' }],
		[201, { id: 201, application_id: 100, user_id: 21, job_id: 50, overridden_by: 11, reason: 'OVERRIDE_REASON_INTERNAL' }],
	]);
	mockGetOverrideById.mockImplementation(async (id) => overrides.get(Number(id)) || null);
	// #920 service-contract mock: an honest implementation of the ruled
	// contract — when the caller passes a companyId the service returns
	// only that company's events and the scoped total; otherwise the
	// candidate's full (unscoped) trail. If the route fails to pass
	// companyId, a company caller visibly receives the global trail.
	mockGetCandidateDecisions.mockImplementation(async (_candidateId, options = {}) => {
		const scoped =
			options?.companyId != null
				? AUDIT_EVENTS.filter((e) => e.company_id === options.companyId)
				: AUDIT_EVENTS;
		return { rows: scoped.map((r) => ({ ...r })), total: scoped.length };
	});
});

const as = (userId) => ({ 'x-test-user-id': String(userId) });

describe('GET /explain/decision/:applicationId — object-level authz', () => {
	test('unrelated recruiter (company B) → 404, no record fields, service never reached', async () => {
		const res = await request(app).get('/api/compliance/explain/decision/100').set(as(11));
		expect(res.status).toBe(404);
		const body = JSON.stringify(res.body);
		expect(body).not.toContain('SECRET_RECRUITER_NOTES');
		expect(body).not.toContain('recruiter_notes');
		expect(body).not.toContain('Candidate A');
		expect(body).not.toContain('ca@test.com');
		expect(mockExplainDecision).not.toHaveBeenCalled();
	});

	test('unrelated candidate → 404, service never reached', async () => {
		const res = await request(app).get('/api/compliance/explain/decision/100').set(as(22));
		expect(res.status).toBe(404);
		expect(mockExplainDecision).not.toHaveBeenCalled();
	});

	test('non-existent application → same 404 shape as a foreign one (no existence oracle)', async () => {
		const foreign = await request(app).get('/api/compliance/explain/decision/100').set(as(11));
		const missing = await request(app).get('/api/compliance/explain/decision/9999').set(as(10));
		expect(missing.status).toBe(404);
		expect(missing.body).toEqual(foreign.body);
		expect(mockExplainDecision).not.toHaveBeenCalled();
	});

	test('candidate-self → 200 WITHOUT recruiter_notes (audience shaping)', async () => {
		const res = await request(app).get('/api/compliance/explain/decision/100').set(as(21));
		expect(res.status).toBe(200);
		expect(mockExplainDecision).toHaveBeenCalledWith(100);
		const body = JSON.stringify(res.body);
		expect(body).not.toContain('SECRET_RECRUITER_NOTES');
		expect(body).not.toContain('recruiter_notes');
		// The rest of the candidate's own explanation is intact.
		expect(res.body.explanation.decision.status).toBe('rejected');
		expect(res.body.explanation.candidate.name).toBe('Candidate A');
	});

	test('self-applicant whose account role is recruiter (converted account) → 200 WITHOUT recruiter_notes (shaping keys on identity, not role)', async () => {
		const res = await request(app).get('/api/compliance/explain/decision/103').set(as(23));
		expect(res.status).toBe(200);
		expect(mockExplainDecision).toHaveBeenCalledWith(103);
		const body = JSON.stringify(res.body);
		expect(body).not.toContain('SECRET_RECRUITER_NOTES');
		expect(body).not.toContain('recruiter_notes');
		expect(res.body.explanation.decision.status).toBe('rejected');
	});

	test('admin who is also the applicant (admin-even-if-self) → 200 with the full record incl. recruiter_notes', async () => {
		const res = await request(app).get('/api/compliance/explain/decision/102').set(as(1));
		expect(res.status).toBe(200);
		expect(res.body.explanation.decision.recruiter_notes).toBe('SECRET_RECRUITER_NOTES');
	});

	test('shaping does not mutate the service result object — same object then serves a recruiter-of-record the full record', async () => {
		const shared = JSON.parse(JSON.stringify(FULL_EXPLANATION));
		mockExplainDecision.mockResolvedValue(shared);

		const shaped = await request(app).get('/api/compliance/explain/decision/100').set(as(21));
		expect(shaped.status).toBe(200);
		expect(JSON.stringify(shaped.body)).not.toContain('recruiter_notes');
		// The service's own object is untouched by the shaped response.
		expect(shared.decision.recruiter_notes).toBe('SECRET_RECRUITER_NOTES');

		const full = await request(app).get('/api/compliance/explain/decision/100').set(as(10));
		expect(full.status).toBe(200);
		expect(full.body.explanation.decision.recruiter_notes).toBe('SECRET_RECRUITER_NOTES');
		expect(shared.decision.recruiter_notes).toBe('SECRET_RECRUITER_NOTES');
	});

	test('hiring_manager of the owning company → 200 full record; foreign hiring_manager → 404', async () => {
		const own = await request(app).get('/api/compliance/explain/decision/100').set(as(14));
		expect(own.status).toBe(200);
		expect(own.body.explanation.decision.recruiter_notes).toBe('SECRET_RECRUITER_NOTES');
		const foreign = await request(app).get('/api/compliance/explain/decision/100').set(as(15));
		expect(foreign.status).toBe(404);
	});

	test('recruiter-of-record (owning company) → 200 with the full record incl. recruiter_notes', async () => {
		const res = await request(app).get('/api/compliance/explain/decision/100').set(as(10));
		expect(res.status).toBe(200);
		expect(res.body.explanation.decision.recruiter_notes).toBe('SECRET_RECRUITER_NOTES');
	});

	test('employer of the owning company → 200 full record; foreign employer → 404', async () => {
		const own = await request(app).get('/api/compliance/explain/decision/100').set(as(12));
		expect(own.status).toBe(200);
		expect(own.body.explanation.decision.recruiter_notes).toBe('SECRET_RECRUITER_NOTES');
		const foreign = await request(app).get('/api/compliance/explain/decision/100').set(as(13));
		expect(foreign.status).toBe(404);
	});

	test('admin → 200 full record unchanged', async () => {
		const res = await request(app).get('/api/compliance/explain/decision/100').set(as(1));
		expect(res.status).toBe(200);
		expect(res.body.explanation).toEqual(FULL_EXPLANATION);
	});
});

describe('GET /explain/omniscore/:userId — canAccessUserRecord + company linkage', () => {
	test('unrelated candidate → 403, service never reached', async () => {
		const res = await request(app).get('/api/compliance/explain/omniscore/21').set(as(22));
		expect(res.status).toBe(403);
		expect(mockExplainOmniScore).not.toHaveBeenCalled();
	});

	test('unrelated recruiter (no application linkage to their company) → 403', async () => {
		const res = await request(app).get('/api/compliance/explain/omniscore/21').set(as(11));
		expect(res.status).toBe(403);
		expect(mockExplainOmniScore).not.toHaveBeenCalled();
	});

	test('self → 200 own score explanation', async () => {
		const res = await request(app).get('/api/compliance/explain/omniscore/21').set(as(21));
		expect(res.status).toBe(200);
		expect(mockExplainOmniScore).toHaveBeenCalledWith(21);
	});

	test('recruiter-of-record (candidate applied to their company) → 200', async () => {
		const res = await request(app).get('/api/compliance/explain/omniscore/21').set(as(10));
		expect(res.status).toBe(200);
		expect(mockExplainOmniScore).toHaveBeenCalledWith(21);
	});

	test('admin → 200', async () => {
		const res = await request(app).get('/api/compliance/explain/omniscore/21').set(as(1));
		expect(res.status).toBe(200);
	});

	test('hiring_manager-of-record (candidate applied to their company) → 200; unlinked hiring_manager → 403, service never reached', async () => {
		const own = await request(app).get('/api/compliance/explain/omniscore/21').set(as(14));
		expect(own.status).toBe(200);
		expect(mockExplainOmniScore).toHaveBeenCalledWith(21);
		jest.clearAllMocks();
		const foreign = await request(app).get('/api/compliance/explain/omniscore/21').set(as(15));
		expect(foreign.status).toBe(403);
		expect(mockExplainOmniScore).not.toHaveBeenCalled();
	});

	test('invalid user ID → 400 (helper shape), service never reached', async () => {
		const res = await request(app).get('/api/compliance/explain/omniscore/abc').set(as(1));
		expect(res.status).toBe(400);
		expect(mockExplainOmniScore).not.toHaveBeenCalled();
	});
});

describe('GET /explain/job/:jobId/candidate/:candidateId — job ownership', () => {
	test('recruiter from another company → 404, service never reached', async () => {
		const res = await request(app).get('/api/compliance/explain/job/50/candidate/21').set(as(11));
		expect(res.status).toBe(404);
		expect(mockExplainDecisionForJob).not.toHaveBeenCalled();
	});

	test('candidate who is not the subject → 403 (existing role-gate shape)', async () => {
		const res = await request(app).get('/api/compliance/explain/job/50/candidate/21').set(as(22));
		expect(res.status).toBe(403);
		expect(mockExplainDecisionForJob).not.toHaveBeenCalled();
	});

	test('candidate-self → 200', async () => {
		const res = await request(app).get('/api/compliance/explain/job/50/candidate/21').set(as(21));
		expect(res.status).toBe(200);
		expect(mockExplainDecisionForJob).toHaveBeenCalledWith({ userId: 21, jobId: 50 });
	});

	test('recruiter of the owning company → 200', async () => {
		const res = await request(app).get('/api/compliance/explain/job/50/candidate/21').set(as(10));
		expect(res.status).toBe(200);
	});

	test('admin → 200', async () => {
		const res = await request(app).get('/api/compliance/explain/job/50/candidate/21').set(as(1));
		expect(res.status).toBe(200);
	});

	test('hiring user + own job + candidate who never applied to their company → 403, service never reached (F-1 linkage)', async () => {
		// Candidate 99 has no job_applications row at all.
		const res = await request(app).get('/api/compliance/explain/job/50/candidate/99').set(as(10));
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'Access denied' });
		expect(mockExplainDecisionForJob).not.toHaveBeenCalled();
	});

	test('hiring user + own job + candidate who applied to their company → 200 unchanged (F-1 linkage)', async () => {
		const res = await request(app).get('/api/compliance/explain/job/50/candidate/21').set(as(10));
		expect(res.status).toBe(200);
		expect(mockExplainDecisionForJob).toHaveBeenCalledWith({ userId: 21, jobId: 50 });
	});

	test('hiring_manager of the owning company + applied candidate → 200; foreign hiring_manager → 404; owning hiring_manager + unlinked candidate → 403', async () => {
		const own = await request(app).get('/api/compliance/explain/job/50/candidate/21').set(as(14));
		expect(own.status).toBe(200);
		const foreign = await request(app)
			.get('/api/compliance/explain/job/50/candidate/21')
			.set(as(15));
		expect(foreign.status).toBe(404);
		jest.clearAllMocks();
		const unlinked = await request(app)
			.get('/api/compliance/explain/job/50/candidate/99')
			.set(as(14));
		expect(unlinked.status).toBe(403);
		expect(mockExplainDecisionForJob).not.toHaveBeenCalled();
	});

	test('owning-company recruiter on a non-existent job → 404', async () => {
		const res = await request(app).get('/api/compliance/explain/job/9999/candidate/21').set(as(10));
		expect(res.status).toBe(404);
		expect(mockExplainDecisionForJob).not.toHaveBeenCalled();
	});
});

describe('legacy audit endpoints — admin-only gate (Lead ruling on #821)', () => {
	test('GET /audit/logs: candidate → 403, service never reached', async () => {
		const res = await request(app).get('/api/compliance/audit/logs').set(as(21));
		expect(res.status).toBe(403);
		expect(mockAuditQuery).not.toHaveBeenCalled();
	});

	test('GET /audit/logs: recruiter and employer → 403 (no non-admin audience)', async () => {
		for (const uid of [10, 12]) {
			const res = await request(app).get('/api/compliance/audit/logs').set(as(uid));
			expect(res.status).toBe(403);
		}
		expect(mockAuditQuery).not.toHaveBeenCalled();
	});

	test('GET /audit/logs: admin → 200 unchanged', async () => {
		const res = await request(app).get('/api/compliance/audit/logs').set(as(1));
		expect(res.status).toBe(200);
		expect(res.body.logs).toEqual([{ id: 1, action_type: 'login' }]);
		expect(mockAuditQuery).toHaveBeenCalled();
	});

	test('POST /audit/export: non-admin → 403, export never reached', async () => {
		for (const uid of [21, 10, 12]) {
			const res = await request(app)
				.post('/api/compliance/audit/export')
				.set(as(uid))
				.send({ startDate: '2026-01-01', endDate: '2026-02-01' });
			expect(res.status).toBe(403);
		}
		expect(mockAuditExportLogs).not.toHaveBeenCalled();
	});

	test('POST /audit/export: admin → 200 unchanged; admin without dates → 400 unchanged', async () => {
		const ok = await request(app)
			.post('/api/compliance/audit/export')
			.set(as(1))
			.send({ startDate: '2026-01-01', endDate: '2026-02-01' });
		expect(ok.status).toBe(200);
		expect(mockAuditExportLogs).toHaveBeenCalled();

		const bad = await request(app).post('/api/compliance/audit/export').set(as(1)).send({});
		expect(bad.status).toBe(400);
	});
});

describe('regression baseline — already-guarded siblings unchanged', () => {
	test('GET /gdpr/consents/:userId: self → 200, other user → 403', async () => {
		const own = await request(app).get('/api/compliance/gdpr/consents/21').set(as(21));
		expect(own.status).toBe(200);
		expect(own.body.consents).toHaveLength(1);

		const other = await request(app).get('/api/compliance/gdpr/consents/21').set(as(22));
		expect(other.status).toBe(403);
	});

	test('GET /consent/history/:userId: self → 200, other user → 403', async () => {
		const own = await request(app).get('/api/compliance/consent/history/21').set(as(21));
		expect(own.status).toBe(200);
		expect(mockGetConsentHistory).toHaveBeenCalled();

		jest.clearAllMocks();
		const other = await request(app).get('/api/compliance/consent/history/21').set(as(22));
		expect(other.status).toBe(403);
		expect(mockGetConsentHistory).not.toHaveBeenCalled();
	});
});

describe('GET /audit-trail/candidate/:candidateId — candidate↔company linkage (#920)', () => {
	const url = '/api/compliance/audit-trail/candidate/21';

	test.each([
		['recruiter', 11],
		['employer', 13],
		['hiring_manager', 15],
	])('unlinked %s (company B, no application from candidate 21) → 403, service never called', async (_label, uid) => {
		const res = await request(app).get(url).set(as(uid));
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'Access denied' });
		expect(mockGetCandidateDecisions).not.toHaveBeenCalled();
	});

	test.each([
		['recruiter', 10],
		['employer', 12],
		['hiring_manager', 14],
	])('linked %s (company A, candidate 21 applied there) → 200, service called with the candidate ID', async (_label, uid) => {
		const res = await request(app).get(url).set(as(uid));
		expect(res.status).toBe(200);
		expect(mockGetCandidateDecisions).toHaveBeenCalledTimes(1);
		expect(mockGetCandidateDecisions.mock.calls[0][0]).toBe(21);
	});

	test('candidate-self → 200 unchanged', async () => {
		const res = await request(app).get(url).set(as(21));
		expect(res.status).toBe(200);
		expect(mockGetCandidateDecisions).toHaveBeenCalledTimes(1);
		expect(mockGetCandidateDecisions.mock.calls[0][0]).toBe(21);
	});

	test('a different candidate → 403, service never called', async () => {
		const res = await request(app).get(url).set(as(22));
		expect(res.status).toBe(403);
		expect(mockGetCandidateDecisions).not.toHaveBeenCalled();
	});

	test('admin → 200 unchanged', async () => {
		const res = await request(app).get(url).set(as(1));
		expect(res.status).toBe(200);
		expect(mockGetCandidateDecisions).toHaveBeenCalledTimes(1);
	});

	test('hiring role with company_id = null → 403 fail-closed, service never called', async () => {
		const res = await request(app).get(url).set(as(16));
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'Access denied' });
		expect(mockGetCandidateDecisions).not.toHaveBeenCalled();
	});

	test('non-integer candidate ID → 400, service never called', async () => {
		const res = await request(app).get('/api/compliance/audit-trail/candidate/abc').set(as(10));
		expect(res.status).toBe(400);
		expect(mockGetCandidateDecisions).not.toHaveBeenCalled();
	});
});

describe('GET /audit-trail/candidate/:candidateId — payload company-scoping (#920, Sumanth ruling)', () => {
	const url = '/api/compliance/audit-trail/candidate/21';

	test("linked recruiter's response contains ONLY their company's events; other companies' events are absent", async () => {
		const res = await request(app).get(url).set(as(10));
		expect(res.status).toBe(200);
		expect(res.body.rows).toHaveLength(2);
		expect(res.body.rows.every((r) => r.company_id === COMPANY_A)).toBe(true);
		expect(res.body.rows.map((r) => r.id)).toEqual([1, 3]);
		expect(JSON.stringify(res.body)).not.toContain('"company_id":6');
		// The route passed the caller's company into the service.
		expect(mockGetCandidateDecisions.mock.calls[0][1]).toMatchObject({ companyId: COMPANY_A });
	});

	test('total equals the scoped count, not the global count', async () => {
		const res = await request(app).get(url).set(as(10));
		expect(res.status).toBe(200);
		expect(res.body.total).toBe(2);
		expect(res.body.total).not.toBe(AUDIT_EVENTS.length);
	});

	test('candidate-self response remains UNSCOPED (all companies present, no company filter passed)', async () => {
		const res = await request(app).get(url).set(as(21));
		expect(res.status).toBe(200);
		expect(res.body.rows).toHaveLength(AUDIT_EVENTS.length);
		expect(res.body.total).toBe(AUDIT_EVENTS.length);
		expect(res.body.rows.some((r) => r.company_id === COMPANY_B)).toBe(true);
		expect(mockGetCandidateDecisions.mock.calls[0][1]?.companyId).toBeUndefined();
	});

	test('admin response remains UNSCOPED (all companies present, no company filter passed)', async () => {
		const res = await request(app).get(url).set(as(1));
		expect(res.status).toBe(200);
		expect(res.body.rows).toHaveLength(AUDIT_EVENTS.length);
		expect(res.body.total).toBe(AUDIT_EVENTS.length);
		expect(res.body.rows.some((r) => r.company_id === COMPANY_B)).toBe(true);
		expect(mockGetCandidateDecisions.mock.calls[0][1]?.companyId).toBeUndefined();
	});
});

describe('services/auditLogService.getCandidateDecisions (actual module) — companyId filters BOTH queries (#920)', () => {
	const actualAuditLogService = jest.requireActual('../../../services/auditLogService');

	test('with companyId: rows and total are scoped to that company only', async () => {
		const res = await actualAuditLogService.getCandidateDecisions(21, {
			companyId: COMPANY_A,
			limit: 500,
			offset: 0,
		});
		expect(res.total).toBe(2);
		expect(res.rows.map((r) => r.id)).toEqual([1, 3]);
		expect(res.rows.every((r) => r.company_id === COMPANY_A)).toBe(true);
	});

	test('with the other companyId: only that company’s single event', async () => {
		const res = await actualAuditLogService.getCandidateDecisions(21, {
			companyId: COMPANY_B,
			limit: 500,
			offset: 0,
		});
		expect(res.total).toBe(1);
		expect(res.rows.map((r) => r.id)).toEqual([2]);
	});

	test('without companyId: unscoped — all events and the global total (pre-#920 behaviour)', async () => {
		const res = await actualAuditLogService.getCandidateDecisions(21, { limit: 500, offset: 0 });
		expect(res.total).toBe(AUDIT_EVENTS.length);
		expect(res.rows.map((r) => r.id)).toEqual([1, 2, 3]);
	});
});

describe('bias endpoints — job↔company authorisation (#1112)', () => {
	const metricsUrl = '/api/compliance/bias/metrics/50';
	const fourFifthsUrl = '/api/compliance/bias/four-fifths/50';

	test.each([
		['recruiter', 11],
		['employer', 13],
		['hiring_manager', 15],
	])('GET /bias/metrics/:jobId: foreign-company %s → 403, service never reached', async (_l, uid) => {
		const res = await request(app).get(metricsUrl).set(as(uid));
		expect(res.status).toBe(403);
		expect(mockGetBiasMetricsForJob).not.toHaveBeenCalled();
	});

	test.each([
		['recruiter', 11],
		['employer', 13],
		['hiring_manager', 15],
	])('GET /bias/four-fifths/:jobId: foreign-company %s → 403, service never reached', async (_l, uid) => {
		const res = await request(app).get(fourFifthsUrl).set(as(uid));
		expect(res.status).toBe(403);
		expect(mockCalculateFourFifthsRule).not.toHaveBeenCalled();
	});

	test('candidate → 403 on both endpoints, services never reached', async () => {
		expect((await request(app).get(metricsUrl).set(as(21))).status).toBe(403);
		expect((await request(app).get(fourFifthsUrl).set(as(21))).status).toBe(403);
		expect(mockGetBiasMetricsForJob).not.toHaveBeenCalled();
		expect(mockCalculateFourFifthsRule).not.toHaveBeenCalled();
	});

	test('hiring role with company_id = null → 403 fail-closed on both endpoints', async () => {
		expect((await request(app).get(metricsUrl).set(as(16))).status).toBe(403);
		expect((await request(app).get(fourFifthsUrl).set(as(16))).status).toBe(403);
		expect(mockGetBiasMetricsForJob).not.toHaveBeenCalled();
		expect(mockCalculateFourFifthsRule).not.toHaveBeenCalled();
	});

	test('job with company_id = null → 403 fail-closed (explicit null guard), services never reached', async () => {
		expect((await request(app).get('/api/compliance/bias/metrics/51').set(as(10))).status).toBe(403);
		expect((await request(app).get('/api/compliance/bias/four-fifths/51').set(as(10))).status).toBe(403);
		expect(mockGetBiasMetricsForJob).not.toHaveBeenCalled();
		expect(mockCalculateFourFifthsRule).not.toHaveBeenCalled();
	});

	test('non-existent job → 403 for a non-admin (fail-closed), services never reached', async () => {
		expect((await request(app).get('/api/compliance/bias/metrics/9999').set(as(10))).status).toBe(403);
		expect((await request(app).get('/api/compliance/bias/four-fifths/9999').set(as(10))).status).toBe(403);
		expect(mockGetBiasMetricsForJob).not.toHaveBeenCalled();
		expect(mockCalculateFourFifthsRule).not.toHaveBeenCalled();
	});

	test('owning-company recruiter → 200 on both endpoints', async () => {
		const metrics = await request(app).get(metricsUrl).set(as(10));
		expect(metrics.status).toBe(200);
		expect(metrics.body.metrics).toHaveLength(1);
		expect(mockGetBiasMetricsForJob).toHaveBeenCalledWith(50);
		const ff = await request(app).get(fourFifthsUrl).set(as(10));
		expect(ff.status).toBe(200);
		expect(ff.body.job_id).toBe(50);
		expect(mockCalculateFourFifthsRule).toHaveBeenCalledWith(50, expect.any(Array));
	});

	test('owning-company hiring_manager → 200; admin → 200 on both endpoints (not job-scoped)', async () => {
		expect((await request(app).get(metricsUrl).set(as(14))).status).toBe(200);
		expect((await request(app).get(fourFifthsUrl).set(as(14))).status).toBe(200);
		expect((await request(app).get(metricsUrl).set(as(1))).status).toBe(200);
		expect((await request(app).get(fourFifthsUrl).set(as(1))).status).toBe(200);
	});

	test('unauthenticated → 401 on both endpoints', async () => {
		expect((await request(app).get(metricsUrl)).status).toBe(401);
		expect((await request(app).get(fourFifthsUrl)).status).toBe(401);
	});
});

describe('POST /bias/analyze/:jobId — same ownership gate (security-reviewer HIGH residual on #1112)', () => {
	const url = '/api/compliance/bias/analyze/50';
	test('foreign-company recruiter → 403, calculate service never reached', async () => {
		const res = await request(app).post(url).set(as(11)).send({});
		expect(res.status).toBe(403);
		expect(mockCalculateBiasMetricsForJob).not.toHaveBeenCalled();
	});
	test('owning-company recruiter → 200, service reached; admin → 200', async () => {
		const own = await request(app).post(url).set(as(10)).send({});
		expect(own.status).toBe(200);
		expect(mockCalculateBiasMetricsForJob).toHaveBeenCalledWith(50, expect.any(Object));
		expect((await request(app).post(url).set(as(1)).send({})).status).toBe(200);
	});
	test('candidate → 403 (existing role gate), service never reached', async () => {
		const res = await request(app).post(url).set(as(21)).send({});
		expect(res.status).toBe(403);
		expect(mockCalculateBiasMetricsForJob).not.toHaveBeenCalled();
	});
});

describe('GET /overrides/:id — company linkage authorisation (#1113)', () => {
	const url = '/api/compliance/overrides/200';

	test.each([
		['recruiter', 11],
		['employer', 13],
		['hiring_manager', 15],
	])('unrelated-company %s → 403, no override fields in response', async (_l, uid) => {
		const res = await request(app).get(url).set(as(uid));
		expect(res.status).toBe(403);
		expect(JSON.stringify(res.body)).not.toContain('OVERRIDE_REASON_INTERNAL');
	});

	test('candidate the override is about → 403 (internal hiring record, no shaped variant)', async () => {
		const res = await request(app).get(url).set(as(21));
		expect(res.status).toBe(403);
		expect(JSON.stringify(res.body)).not.toContain('OVERRIDE_REASON_INTERNAL');
	});

	test('hiring role with company_id = null → 403 fail-closed', async () => {
		const res = await request(app).get(url).set(as(16));
		expect(res.status).toBe(403);
	});

	test('owning-company recruiter → 200 with the override', async () => {
		const res = await request(app).get(url).set(as(10));
		expect(res.status).toBe(200);
		expect(res.body.override.id).toBe(200);
		expect(res.body.override.reason).toBe('OVERRIDE_REASON_INTERNAL');
	});

	test('owning-company hiring_manager → 200; admin → 200', async () => {
		expect((await request(app).get(url).set(as(14))).status).toBe(200);
		expect((await request(app).get(url).set(as(1))).status).toBe(200);
	});

	test("the override's own actor (overridden_by) → 200 even from another company (record self)", async () => {
		const res = await request(app).get('/api/compliance/overrides/201').set(as(11));
		expect(res.status).toBe(200);
		expect(res.body.override.id).toBe(201);
	});

	test('non-existent override → 404 unchanged', async () => {
		const res = await request(app).get('/api/compliance/overrides/9999').set(as(10));
		expect(res.status).toBe(404);
	});

	test('unauthenticated → 401', async () => {
		expect((await request(app).get(url)).status).toBe(401);
	});
});
