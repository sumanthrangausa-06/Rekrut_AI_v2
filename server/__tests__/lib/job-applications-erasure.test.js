/**
 * #780: Erasure completeness — job_applications (GDPR Art. 17).
 *
 * erasePersonalData() previously had zero references to job_applications:
 * the whole application row survived erasure (account deletion tombstones
 * the users row, so the migration-002 CASCADE never fires). STOP 1 (gate-
 * approved by Sumanth, 2026-10-13) scoped the fix:
 *
 *   §2 The row is RETAINED as the joint candidate/company skeleton
 *      (Art. 17(3)(e), conversations precedent) and the candidate-linked
 *      content is REDACTED in place, in one UPDATE:
 *        cover_letter → NULL, screening_answers → '{}'::jsonb,
 *        resume_url → NULL, match_score → NULL, omniscore_at_apply → NULL,
 *        screening_score → NULL, assessment_score → NULL,
 *        assessment_result → NULL, recruiter_notes → NULL
 *        (recruiter_notes = REDACT per Sumanth's gate ruling),
 *        updated_at → NOW() (honest modification stamp).
 *   §3 Per-row legal-hold consult BEFORE redacting (findActiveHold with
 *      the row's explicit company_id): held rows are excluded from the
 *      UPDATE and counted; a hold-lookup error on a row reads as held
 *      (fail-closed skip). lib/legalHold.js is NOT modified.
 *   §4 Return additions: jobApplicationsRedacted (true only when rows
 *      were actually redacted) + jobApplicationRowsHeld (count).
 *
 * Modelled on server/__tests__/lib/erasure-medium-tables.test.js (same
 * jest.mock pattern). The fake client routes by SQL: the pre-#780 erasure
 * sequence is answered generically; legal_holds and job_applications
 * queries are answered from the per-test scenario.
 *
 * Environment limit: this VM cannot reach Neon and has no local Postgres,
 * so this mocked suite is the evidence producible here; real-DB
 * verification is staging-QA-carried (STOP 1 §5).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
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

// Scenario knobs (reset per test):
//   appRows        — rows returned by SELECT id, company_id FROM job_applications
//   heldCompanies  — company_ids whose per-row hold consult returns a hold
//   errorCompanies — company_ids whose per-row hold consult throws
//   updateRowCount — rowCount reported by the redaction UPDATE
function makeClient(scenario = {}) {
	const {
		appRows = [],
		heldCompanies = new Set(),
		errorCompanies = new Set(),
		updateRowCount = 0,
	} = scenario;
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql, params = []) => {
		// Legal-hold lookups (entry gate + per-row consults both land here;
		// findActiveHold params are [uid, explicitCompanyId, sessionCompanyId]).
		if (/FROM legal_holds/i.test(sql)) {
			const companyId = params[1];
			if (companyId != null) {
				if (errorCompanies.has(companyId)) {
					throw new Error('legal-hold lookup unavailable');
				}
				if (heldCompanies.has(companyId)) {
					return {
						rows: [{ id: 99, user_id: null, company_id: companyId }],
						rowCount: 1,
					};
				}
			}
			return { rows: [], rowCount: 0 }; // entry gate: no hold on the user
		}
		if (/FROM job_applications/i.test(sql) && /^\s*SELECT/i.test(sql)) {
			return { rows: appRows, rowCount: appRows.length };
		}
		if (/UPDATE job_applications/i.test(sql)) {
			return { rows: [], rowCount: updateRowCount };
		}
		// Everything else in the pre-#780 sequence: generic success.
		// (destroyDEK's UPDATE reports rowCount 1 → shredded, no tombstone.)
		return { rows: [], rowCount: 1 };
	});
	return client;
}

function callsMatching(client, re) {
	return client.query.mock.calls.filter(([sql]) => re.test(sql));
}

describe('#780 erasePersonalData — job_applications redaction', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('(a) UPDATE exists, keyed by candidate_id, sets exactly the §2 redact set incl. recruiter_notes', async () => {
		const client = makeClient({
			appRows: [
				{ id: 11, company_id: 3 },
				{ id: 12, company_id: 4 },
			],
			updateRowCount: 2,
		});

		const result = await erasureService.erasePersonalData(7, { client });

		// The candidate's rows are selected first, keyed by candidate_id.
		const selectCalls = callsMatching(client, /SELECT[\s\S]*FROM job_applications/i);
		expect(selectCalls).toHaveLength(1);
		expect(selectCalls[0][0]).toMatch(/candidate_id = \$1/);
		expect(selectCalls[0][1]).toEqual([7]);

		// One redaction UPDATE over the unheld ids only.
		const updateCalls = callsMatching(client, /UPDATE job_applications/i);
		expect(updateCalls).toHaveLength(1);
		const [sql, params] = updateCalls[0];
		expect(sql).toMatch(/candidate_id = \$1/);
		expect(sql).toMatch(/id = ANY\(\$2\)/);
		expect(params).toEqual([7, [11, 12]]);

		// Exactly the §2 set — no more, no less (skeleton columns untouched).
		const setClause = sql.slice(sql.search(/SET/i) + 3, sql.search(/WHERE/i));
		const assignments = setClause
			.split(',')
			.map((s) => s.replace(/\s+/g, ' ').trim())
			.sort();
		expect(assignments).toEqual(
			[
				'cover_letter = NULL',
				"screening_answers = '{}'::jsonb",
				'resume_url = NULL',
				'match_score = NULL',
				'omniscore_at_apply = NULL',
				'screening_score = NULL',
				'assessment_score = NULL',
				'assessment_result = NULL',
				'recruiter_notes = NULL', // Sumanth's gate ruling: REDACT
				'updated_at = NOW()',
			].sort(),
		);

		// SELECT precedes the UPDATE in the issued sequence.
		const sqls = client.query.mock.calls.map(([s]) => s);
		const selIdx = sqls.findIndex((s) => /FROM job_applications/i.test(s));
		const updIdx = sqls.findIndex((s) => /UPDATE job_applications/i.test(s));
		expect(selIdx).toBeGreaterThan(-1);
		expect(updIdx).toBeGreaterThan(selIdx);

		expect(result.jobApplicationsRedacted).toBe(true);
		expect(result.jobApplicationRowsHeld).toBe(0);
	});

	test('(b) the application row is never DELETEd — skeleton retained', async () => {
		const client = makeClient({
			appRows: [{ id: 11, company_id: 3 }],
			updateRowCount: 1,
		});

		await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM job_applications/i)).toHaveLength(0);
		expect(callsMatching(client, /UPDATE job_applications/i)).toHaveLength(1);
	});

	test('(c) a per-row held application is excluded from the UPDATE and counted', async () => {
		const client = makeClient({
			appRows: [
				{ id: 11, company_id: 3 },
				{ id: 12, company_id: 4 },
			],
			heldCompanies: new Set([4]),
			updateRowCount: 1,
		});

		const result = await erasureService.erasePersonalData(7, { client });

		// Each row was consulted individually with its explicit company.
		const holdCalls = callsMatching(client, /FROM legal_holds/i);
		expect(holdCalls.some(([, p]) => p[0] === 7 && p[1] === 3)).toBe(true);
		expect(holdCalls.some(([, p]) => p[0] === 7 && p[1] === 4)).toBe(true);

		const updateCalls = callsMatching(client, /UPDATE job_applications/i);
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0][1]).toEqual([7, [11]]); // held row 12 excluded

		expect(result.jobApplicationRowsHeld).toBe(1);
		expect(result.jobApplicationsRedacted).toBe(true);
	});

	test('(d) a hold-lookup error on a row reads as held (fail-closed skip)', async () => {
		const client = makeClient({
			appRows: [
				{ id: 11, company_id: 3 },
				{ id: 12, company_id: 4 },
			],
			errorCompanies: new Set([4]),
			updateRowCount: 1,
		});

		// Erasure as a whole must not throw for a per-row lookup error.
		const result = await erasureService.erasePersonalData(7, { client });

		const updateCalls = callsMatching(client, /UPDATE job_applications/i);
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0][1]).toEqual([7, [11]]); // row 12 skipped, not redacted
		expect(result.jobApplicationRowsHeld).toBe(1);
		expect(result.jobApplicationsRedacted).toBe(true);
	});

	test('(e) jobApplicationsRedacted is true only when rows were actually redacted', async () => {
		// All rows held → no UPDATE issued at all, flag false.
		const allHeld = makeClient({
			appRows: [{ id: 11, company_id: 3 }],
			heldCompanies: new Set([3]),
		});
		const heldResult = await erasureService.erasePersonalData(7, { client: allHeld });
		expect(callsMatching(allHeld, /UPDATE job_applications/i)).toHaveLength(0);
		expect(heldResult.jobApplicationsRedacted).toBe(false);
		expect(heldResult.jobApplicationRowsHeld).toBe(1);

		// UPDATE issued but reports 0 rows → flag false.
		const zeroRows = makeClient({
			appRows: [{ id: 11, company_id: 3 }],
			updateRowCount: 0,
		});
		const zeroResult = await erasureService.erasePersonalData(7, { client: zeroRows });
		expect(callsMatching(zeroRows, /UPDATE job_applications/i)).toHaveLength(1);
		expect(zeroResult.jobApplicationsRedacted).toBe(false);
		expect(zeroResult.jobApplicationRowsHeld).toBe(0);
	});

	test('(f) candidate with no applications: no error, flag false, no UPDATE', async () => {
		const client = makeClient({ appRows: [] });

		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.jobApplicationsRedacted).toBe(false);
		expect(result.jobApplicationRowsHeld).toBe(0);
		expect(callsMatching(client, /UPDATE job_applications/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM job_applications/i)).toHaveLength(0);
		// Only the entry-gate hold lookup ran — no per-row consults.
		expect(callsMatching(client, /FROM legal_holds/i)).toHaveLength(1);
	});
});
