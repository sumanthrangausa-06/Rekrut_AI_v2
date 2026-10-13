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
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: {
		query: (...args) => mockAuditQuery(...args),
		exportLogs: (...args) => mockAuditExportLogs(...args),
		log: (...args) => mockAuditLog(...args),
	},
	logEvent: (...args) => mockLogEvent(...args),
	getAuditTrail: jest.fn(async () => ({ rows: [] })),
	getCandidateDecisions: jest.fn(async () => ({ rows: [] })),
	verifyChain: jest.fn(async () => ({})),
	exportForRegulator: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision', STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

const mockExplainDecisionForJob = jest.fn();
const mockGetConsentHistory = jest.fn();
jest.mock('../../../services/euComplianceService', () => ({
	explainDecisionForJob: (...args) => mockExplainDecisionForJob(...args),
	getConsentHistory: (...args) => mockGetConsentHistory(...args),
	classifyJobRisk: jest.fn(),
	getJobRiskClassification: jest.fn(),
	listJobRiskClassifications: jest.fn(async () => ({ rows: [] })),
	calculateBiasMetricsForJob: jest.fn(async () => []),
	getBiasMetricsForJob: jest.fn(async () => []),
	listFlaggedBiasMetrics: jest.fn(async () => ({ rows: [] })),
	recordHumanOverride: jest.fn(),
	getOverridesForJob: jest.fn(async () => ({ rows: [] })),
	getOverrideById: jest.fn(),
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
	calculateFourFifthsRule: jest.fn(async () => ({})),
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
const jobs = new Map([[50, { id: 50, company_id: COMPANY_A }]]);

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
