/**
 * #813 (S-094): Erasure completeness — application-keyed tables sweep (C2).
 *
 * erasePersonalData() previously had zero references to the five tables:
 * screening_responses, job_application_screenings, ai_screenings,
 * outreach_attempts, auto_apply_profiles (account deletion tombstones the
 * users row, so their CASCADEs never fire).
 *
 * Panel rulings built to (issue #813, comment 6167202482, 2026-10-14):
 *  - Whole-row DELETEs for the five, partitioned by the #1115/#780
 *    per-application hold set (applicationRows / unheldApplicationIds).
 *  - D-1: ai_screening_audit_logs + ai_screening_human_reviews die by
 *    EXPLICIT counted DELETE before the parent ai_screenings DELETE
 *    (never CASCADE), counts in the return metadata.
 *  - D-2 (Sumanth): auto_apply_profiles whole-row DELETE + consent
 *    tombstone {profile existed, gdpr_consent, consent_date} captured
 *    pre-delete into the return — never profile_data.
 *  - D-3 (tightened): NULL application_id rows get a per-row job-walk
 *    (exact-match on the row's own job_id + candidate_id, in-tx, no
 *    linkage survives); resolved NULL-company proceeds under the entry
 *    gate; failed resolution OR hold-consult error = fail-closed skip
 *    of that row only, counted in applicationKeyedRowsHeld and named
 *    in applicationKeyedHeldDetails; never aborts the erasure.
 *  - D-1 Condition 1 (SURVIVAL PROOF): a candidate WITH a human review
 *    whose compliance_audit_trail entry must SURVIVE erasure (#920
 *    guard). If this test fails, the D-1 ruling suspends itself.
 *
 * The four screening cascade children (screening_question_evaluations,
 * screening_overrides) are NOT explicitly deleted — they die via the
 * parent screening_responses DELETE's CASCADE (case g).
 *
 * Modelled on job-applications-erasure.test.js (SQL-routing fake).
 * Mocked evidence only here; the mandatory real-DB dry run is recorded
 * in the PR / build log (local PG16 scratch cluster).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(),
	deleteStorageObject: jest.fn(),
	getProviders: jest.fn(() => []),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
	decrypt: jest.fn((buf) => Buffer.from(buf)),
}));
jest.mock('@aws-sdk/client-s3', () => ({
	S3Client: jest.fn(),
	PutObjectCommand: jest.fn(),
	GetObjectCommand: jest.fn(),
	DeleteObjectCommand: jest.fn(),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const erasureService = require('../../../lib/erasureService');

// Scenario knobs:
//   appRows          — SELECT id, company_id FROM job_applications
//   heldCompanies    — company_ids whose hold consult returns a hold
//   errorCompanies   — company_ids whose hold consult throws
//   screeningResponses / jobApplicationScreenings / aiScreenings /
//   outreachAttempts / autoApplyRows — the five tables' rows
//   jobCompany       — Map job_id -> company_id (null allowed); missing = no row
//   questionnaireJob — Map questionnaire_id -> {job_id, company_id}
//   appByJob         — Map job_id -> {id, company_id} (exact-match walk)
//   walkErrorJobs    — job_ids whose jobs-walk query throws
//   auditLogCount / humanReviewCount — rowCounts for the D-1 child DELETEs
//   complianceTrail  — in-memory compliance_audit_trail rows (survival proof)
function makeClient(scenario = {}) {
	const s = {
		appRows: [],
		heldCompanies: new Set(),
		errorCompanies: new Set(),
		screeningResponses: [],
		jobApplicationScreenings: [],
		aiScreenings: [],
		outreachAttempts: [],
		autoApplyRows: [],
		jobCompany: new Map(),
		questionnaireJob: new Map(),
		appByJob: new Map(),
		walkErrorJobs: new Set(),
		auditLogCount: 0,
		humanReviewCount: 0,
		complianceTrail: [],
		...scenario,
	};
	const client = { query: jest.fn(), _s: s };
	client.query.mockImplementation(async (sql, params = []) => {
		if (/compliance_audit_trail/i.test(sql)) {
			// Any erasure write against the trail would mutate the proof
			// fixture — the survival test asserts this never happens.
			if (/DELETE|UPDATE|INSERT/i.test(sql)) {
				s.complianceTrail.length = 0;
			}
			return { rows: s.complianceTrail, rowCount: s.complianceTrail.length };
		}
		if (/FROM legal_holds/i.test(sql)) {
			const companyId = params[1];
			if (companyId != null) {
				if (s.errorCompanies.has(companyId)) throw new Error('legal-hold lookup unavailable');
				if (s.heldCompanies.has(companyId)) {
					return { rows: [{ id: 99, user_id: null, company_id: companyId }], rowCount: 1 };
				}
			}
			return { rows: [], rowCount: 0 };
		}
		// D-3 exact-match application walk (before the plain app SELECT).
		if (/FROM job_applications/i.test(sql) && /job_id = \$1/i.test(sql)) {
			const row = s.appByJob.get(params[0]);
			return row && params[1] === 7
				? { rows: [row], rowCount: 1 }
				: { rows: [], rowCount: 0 };
		}
		if (/FROM job_applications/i.test(sql) && /^\s*SELECT/i.test(sql)) {
			return { rows: s.appRows, rowCount: s.appRows.length };
		}
		if (/UPDATE job_applications/i.test(sql)) {
			return { rows: [], rowCount: params[1] ? params[1].length : 0 };
		}
		// D-3 walks.
		if (/FROM screening_questionnaires/i.test(sql)) {
			const row = s.questionnaireJob.get(params[0]);
			return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		if (/FROM jobs/i.test(sql) && /^\s*SELECT/i.test(sql)) {
			if (s.walkErrorJobs.has(params[0])) throw new Error('jobs walk unavailable');
			if (!s.jobCompany.has(params[0])) return { rows: [], rowCount: 0 };
			return { rows: [{ company_id: s.jobCompany.get(params[0]) }], rowCount: 1 };
		}
		// Five-table SELECTs.
		if (/FROM screening_responses/i.test(sql)) return { rows: s.screeningResponses, rowCount: s.screeningResponses.length };
		if (/FROM job_application_screenings/i.test(sql)) return { rows: s.jobApplicationScreenings, rowCount: s.jobApplicationScreenings.length };
		if (/FROM ai_screenings/i.test(sql)) return { rows: s.aiScreenings, rowCount: s.aiScreenings.length };
		if (/FROM outreach_attempts/i.test(sql)) return { rows: s.outreachAttempts, rowCount: s.outreachAttempts.length };
		if (/FROM auto_apply_profiles/i.test(sql)) return { rows: s.autoApplyRows, rowCount: s.autoApplyRows.length };
		// D-1 explicit child DELETEs (before parent — order asserted by test).
		if (/DELETE FROM ai_screening_audit_logs/i.test(sql)) return { rows: [], rowCount: s.auditLogCount };
		if (/DELETE FROM ai_screening_human_reviews/i.test(sql)) return { rows: [], rowCount: s.humanReviewCount };
		// Five-table DELETEs: rowCount = number of ids targeted.
		if (/DELETE FROM (screening_responses|job_application_screenings|ai_screenings|outreach_attempts)/i.test(sql)) {
			const ids = Array.isArray(params[1]) ? params[1] : [];
			return { rows: [], rowCount: ids.length };
		}
		if (/DELETE FROM auto_apply_profiles/i.test(sql)) {
			return { rows: [], rowCount: s.autoApplyRows.length };
		}
		// Everything else in the pre-existing sequence: generic success.
		return { rows: [], rowCount: 1 };
	});
	return client;
}

function callsMatching(client, re) {
	return client.query.mock.calls.filter(([sql]) => re.test(sql));
}

const APPS = [
	{ id: 11, company_id: 3 },
	{ id: 12, company_id: 4 },
];

describe('#813 erasePersonalData — application-keyed sweep (C2)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('(a) DELETEs exist for all five tables, keyed as ruled; job_applications never DELETEd', async () => {
		const client = makeClient({
			appRows: APPS,
			screeningResponses: [{ id: 21, application_id: 11, questionnaire_id: 31 }],
			jobApplicationScreenings: [{ id: 22, application_id: 11, job_id: 51 }],
			aiScreenings: [{ id: 23, application_id: 12, job_id: 52 }],
			outreachAttempts: [{ id: 24, application_id: 11 }],
			autoApplyRows: [{ id: 25, gdpr_consent: true, consent_date: '2026-01-02T00:00:00Z' }],
			auditLogCount: 2,
			humanReviewCount: 1,
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM screening_responses/i)[0][1]).toEqual([7, [21]]);
		expect(callsMatching(client, /DELETE FROM job_application_screenings/i)[0][1]).toEqual([7, [22]]);
		expect(callsMatching(client, /DELETE FROM ai_screenings/i)[0][1]).toEqual([7, [23]]);
		expect(callsMatching(client, /DELETE FROM outreach_attempts/i)[0][1]).toEqual([7, [24]]);
		expect(callsMatching(client, /DELETE FROM auto_apply_profiles/i)[0][1]).toEqual([7]);
		expect(callsMatching(client, /DELETE FROM job_applications/i)).toHaveLength(0);
		expect(result.screeningResponsesDeleted).toBe(true);
		expect(result.jobApplicationScreeningsDeleted).toBe(true);
		expect(result.aiScreeningsDeleted).toBe(true);
		expect(result.outreachAttemptsDeleted).toBe(true);
		expect(result.autoApplyProfileDeleted).toBe(true);
		expect(result.applicationKeyedRowsHeld).toBe(0);
	});

	test('(b) rows under a held application are excluded from every DELETE and counted', async () => {
		const client = makeClient({
			appRows: APPS,
			heldCompanies: new Set([4]), // application 12 held
			screeningResponses: [
				{ id: 21, application_id: 11, questionnaire_id: 31 },
				{ id: 26, application_id: 12, questionnaire_id: 32 },
			],
			jobApplicationScreenings: [{ id: 22, application_id: 12, job_id: 52 }],
			aiScreenings: [{ id: 23, application_id: 12, job_id: 52 }],
			outreachAttempts: [{ id: 24, application_id: 12 }],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM screening_responses/i)[0][1]).toEqual([7, [21]]);
		expect(callsMatching(client, /DELETE FROM job_application_screenings/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM ai_screenings/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM outreach_attempts/i)).toHaveLength(0);
		// Held rows' D-1 children must NOT be deleted either.
		expect(callsMatching(client, /DELETE FROM ai_screening_audit_logs/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM ai_screening_human_reviews/i)).toHaveLength(0);
		expect(result.applicationKeyedRowsHeld).toBe(4);
		expect(result.applicationKeyedHeldDetails.map((d) => d.table).sort()).toEqual(
			['ai_screenings', 'job_application_screenings', 'outreach_attempts', 'screening_responses'].sort(),
		);
	});

	test('(c) auto_apply_profiles deleted by user_id even with no applications; D-2 tombstone captured, no profile_data', async () => {
		const client = makeClient({
			appRows: [],
			autoApplyRows: [{ id: 25, gdpr_consent: false, consent_date: null }],
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM auto_apply_profiles/i)).toHaveLength(1);
		expect(result.autoApplyProfileDeleted).toBe(true);
		expect(result.autoApplyConsentTombstone).toEqual({
			profileExisted: true,
			gdprConsent: false,
			consentDate: null,
		});
		expect(JSON.stringify(result.autoApplyConsentTombstone)).not.toMatch(/profile_data/);
	});

	test('(d1) D-3: NULL-application row, walk resolves to unheld company ⇒ deleted', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: null, job_id: 52 }],
			jobCompany: new Map([[52, 3]]),
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM ai_screenings/i)[0][1]).toEqual([7, [23]]);
		expect(result.aiScreeningsDeleted).toBe(true);
		expect(result.applicationKeyedRowsHeld).toBe(0);
	});

	test('(d2) D-3: NULL-application row, walk resolves NULL company ⇒ deleted under entry gate', async () => {
		const client = makeClient({
			appRows: APPS,
			jobApplicationScreenings: [{ id: 22, application_id: null, job_id: 53 }],
			jobCompany: new Map([[53, null]]),
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM job_application_screenings/i)[0][1]).toEqual([7, [22]]);
		expect(result.applicationKeyedRowsHeld).toBe(0);
	});

	test('(d3) D-3: walk lookup throws ⇒ row skipped + counted, erasure does not abort', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: null, job_id: 54 }],
			walkErrorJobs: new Set([54]),
			autoApplyRows: [{ id: 25, gdpr_consent: true, consent_date: '2026-01-02T00:00:00Z' }],
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM ai_screenings/i)).toHaveLength(0);
		expect(result.applicationKeyedRowsHeld).toBe(1);
		expect(result.applicationKeyedHeldDetails).toEqual([
			expect.objectContaining({ table: 'ai_screenings', id: 23 }),
		]);
		expect(result.autoApplyProfileDeleted).toBe(true); // rest of erasure proceeded
	});

	test('(d4) D-3: NULL-application row whose exact-match application is held ⇒ follows the hold', async () => {
		const client = makeClient({
			appRows: APPS,
			heldCompanies: new Set([4]),
			aiScreenings: [{ id: 23, application_id: null, job_id: 52 }],
			jobCompany: new Map([[52, 4]]),
			appByJob: new Map([[52, { id: 12, company_id: 4 }]]),
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM ai_screenings/i)).toHaveLength(0);
		expect(result.applicationKeyedRowsHeld).toBe(1);
	});

	test('(d5) D-3: NULL-application screening_responses row walks via questionnaire job ⇒ deleted', async () => {
		const client = makeClient({
			appRows: APPS,
			screeningResponses: [{ id: 21, application_id: null, questionnaire_id: 31 }],
			questionnaireJob: new Map([[31, { job_id: 51, company_id: 3 }]]),
		});
		await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM screening_responses/i)[0][1]).toEqual([7, [21]]);
	});

	test('(e) each *Deleted flag is true only when its DELETE actually removed rows', async () => {
		const client = makeClient({
			appRows: APPS,
			screeningResponses: [{ id: 21, application_id: 11, questionnaire_id: 31 }],
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result.screeningResponsesDeleted).toBe(true);
		expect(result.jobApplicationScreeningsDeleted).toBe(false);
		expect(result.aiScreeningsDeleted).toBe(false);
		expect(result.outreachAttemptsDeleted).toBe(false);
		expect(result.autoApplyProfileDeleted).toBe(false);
		expect(result.autoApplyConsentTombstone).toBeNull();
	});

	test('(f) no-rows candidate: no error, all flags false, held count 0, no DELETEs on the five', async () => {
		const client = makeClient({ appRows: [] });
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result.screeningResponsesDeleted).toBe(false);
		expect(result.jobApplicationScreeningsDeleted).toBe(false);
		expect(result.aiScreeningsDeleted).toBe(false);
		expect(result.outreachAttemptsDeleted).toBe(false);
		expect(result.autoApplyProfileDeleted).toBe(false);
		expect(result.applicationKeyedRowsHeld).toBe(0);
		expect(result.aiScreeningAuditLogsDeleted).toBe(0);
		expect(result.aiScreeningHumanReviewsDeleted).toBe(0);
		for (const t of ['screening_responses', 'job_application_screenings', 'ai_screenings', 'outreach_attempts', 'auto_apply_profiles']) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${t}`, 'i'))).toHaveLength(0);
		}
	});

	test('(g) no explicit DELETE against screening cascade children; D-1 children ARE explicit and precede the parent', async () => {
		const client = makeClient({
			appRows: APPS,
			screeningResponses: [{ id: 21, application_id: 11, questionnaire_id: 31 }],
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			auditLogCount: 3,
			humanReviewCount: 1,
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(callsMatching(client, /DELETE FROM screening_question_evaluations/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM screening_overrides/i)).toHaveLength(0);
		const sqls = client.query.mock.calls.map(([s]) => s);
		const auditIdx = sqls.findIndex((s) => /DELETE FROM ai_screening_audit_logs/i.test(s));
		const reviewIdx = sqls.findIndex((s) => /DELETE FROM ai_screening_human_reviews/i.test(s));
		const parentIdx = sqls.findIndex((s) => /DELETE FROM ai_screenings/i.test(s));
		expect(auditIdx).toBeGreaterThan(-1);
		expect(reviewIdx).toBeGreaterThan(-1);
		expect(parentIdx).toBeGreaterThan(auditIdx);
		expect(parentIdx).toBeGreaterThan(reviewIdx);
		expect(callsMatching(client, /DELETE FROM ai_screening_audit_logs/i)[0][1]).toEqual([[23]]);
		expect(callsMatching(client, /DELETE FROM ai_screening_human_reviews/i)[0][1]).toEqual([[23]]);
		expect(result.aiScreeningAuditLogsDeleted).toBe(3);
		expect(result.aiScreeningHumanReviewsDeleted).toBe(1);
	});

	test('(h) SURVIVAL PROOF (D-1 Condition 1): compliance_audit_trail human-review entry survives erasure', async () => {
		const trailEntry = {
			id: 501,
			event_type: 'HUMAN_OVERRIDE',
			entity_type: 'user',
			entity_id: 7,
			payload: { screening_id: 23, decision: 'interview', reason: 'strong portfolio' },
		};
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			auditLogCount: 1,
			humanReviewCount: 1, // the candidate HAS a human review being erased from the screening tables
			complianceTrail: [trailEntry],
		});
		const result = await erasureService.erasePersonalData(7, { client });
		// The screening-side review is gone (counted)…
		expect(result.aiScreeningHumanReviewsDeleted).toBe(1);
		expect(result.aiScreeningsDeleted).toBe(true);
		// …but the parallel compliance trail entry is untouched: no
		// DELETE/UPDATE/INSERT against compliance_audit_trail was issued
		// and the fixture row still stands.
		expect(
			client.query.mock.calls.filter(
				([sql]) => /compliance_audit_trail/i.test(sql) && /DELETE|UPDATE|INSERT/i.test(sql),
			),
		).toHaveLength(0);
		expect(client._s.complianceTrail).toEqual([trailEntry]);
	});
});
