/**
 * #1123 GAP-D (E-12): Erasure completeness — BGV & onboarding documents
 * (highest sensitivity: SSN/bank/I-9-class platform copies).
 *
 * erasePersonalData() previously had ZERO references to this family:
 * account deletion tombstones the users row, so the migrations'
 * ON DELETE CASCADEs never fire and every row below survived erasure.
 * STOP 1 (issue #1123, comment 6162816772) + Sumanth's gate ruling
 * (2026-10-14) scoped the build:
 *
 *   Q4 outcome-fact = keep NOTHING · Q5 referees = hard-delete ·
 *   Q6 offers = redact-to-skeleton · Q7 payroll boundary confirmed
 *   (employees/paychecks/payroll_configs/tax_documents OUT of scope)
 *
 *   HARD DELETE: candidate_onboarding_data, bg_verification_requests
 *   (incl. the live response_token), education_history,
 *   employment_history, discrepancies (explicitly, by parent ids,
 *   FIRST), reference_checks, onboarding_checklists,
 *   onboarding_documents, onboarding_plans, onboarding_tasks
 *   (plan-scoped), onboarding_chats, verified_credentials,
 *   candidate-as-party signature_requests, candidate-scoped
 *   signature_documents (+ their document_hash_records and
 *   signature_audit_events, explicitly).
 *   REDACT: offers (skeleton); signing_parties rows that touch a
 *   surviving company document (email/full_name/phone + user linkage).
 *   NEVER REWRITTEN: signature_audit_events on surviving documents —
 *   residual actor_email is a NAMED RESIDUAL, counted in the result
 *   as a LOWER BOUND (actor-linked events only; PR-gate P-2).
 *   MIGRATION 259 (PR-gate fix P-1): offers.salary was NOT NULL
 *   (migration 014), so the ruled skeleton's salary = NULL aborted
 *   the whole erasure on a real DB; migration 259 drops that one
 *   constraint — the skeleton UPDATE itself is unchanged.
 *   STORAGE: onboarding_documents.document_url, offers.signature_url,
 *   signature_documents.file_url → in-tx pending_storage_deletions
 *   ledger → Phase 2, but ONLY for /api/files/ URLs; any other URL is
 *   named explicitly in gapD.nonPatternStorageUrls, never skipped
 *   silently.
 *   LEGAL HOLD: whole-erasure gate first (shipped), then a per-row
 *   findActiveHold consult before each family's delete/redact/ledger,
 *   fail-closed on lookup error. Per-row consults pass the row's OWN
 *   company_id where one exists (offers/onboarding_documents/
 *   signature_documents/onboarding_plans) — an onboarding-only
 *   candidate may have NO interview_sessions, so the shipped
 *   session-based attribution cannot reach them.
 *   FK ORDERING: verified_credentials.document_id →
 *   verification_documents(id) has NO ON DELETE action (mig 009), so
 *   credentials are deleted BEFORE the shipped S-076
 *   verification_documents DELETE in the same transaction.
 *
 * FIXTURE HYGIENE (hard rule for this family): synthetic data only —
 * never real-format SSN/bank/account numbers anywhere in this file.
 * Sensitive-column fixtures use obviously-fake placeholders
 * (ENC:TEST-…) and are only ever carried as opaque URL/id values; the
 * mocked client never returns column content at all.
 *
 * Modelled on job-applications-erasure.test.js (SQL-routing fake).
 * Environment limit: this VM cannot reach a real DB, so this mocked
 * suite is the evidence producible here (labelled mocked); real-DB
 * verification is staging-QA-carried (STOP 1 §4).
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn().mockResolvedValue({ deleted: true }),
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

const db = require('../../../lib/db');
const { deleteFile } = require('../../../lib/file-storage');
const erasureService = require('../../../lib/erasureService');
const { LegalHoldError } = require('../../../lib/legalHold');

// ─── Scenario-driven SQL router ─────────────────────────────────────────────
// The pre-#1123 erasure sequence is answered generically; legal_holds
// and every GAP-D query are answered from the per-test scenario.
function makeClient(scenario = {}) {
	const s = {
		credentials: [],
		cod: [],
		docs: [],
		checklists: [],
		chats: [],
		plans: [],
		tasks: [],
		bg: [],
		discrepancies: [],
		edu: [],
		emp: [],
		refs: [],
		offers: [],
		parties: [],
		requests: [],
		docRequests: [],
		sigDocs: [],
		auditResidual: 0,
		heldCompanies: new Set(),
		errorCompanies: new Set(),
		gateHeld: false,
		deleteCounts: {},
		...scenario,
	};
	const client = { query: jest.fn() };
	client.query.mockImplementation(async (sql, params = []) => {
		// Legal holds: entry gate + per-row consults land here.
		// findActiveHold params: [uid, explicitCompanyId, sessionCompanyId].
		if (/FROM legal_holds/i.test(sql)) {
			if (s.gateHeld) {
				return { rows: [{ id: 42, user_id: 7, company_id: null }], rowCount: 1 };
			}
			const companyId = params[1];
			if (companyId != null) {
				if (s.errorCompanies.has(companyId)) {
					throw new Error('legal-hold lookup unavailable');
				}
				if (s.heldCompanies.has(companyId)) {
					return { rows: [{ id: 99, user_id: null, company_id: companyId }], rowCount: 1 };
				}
			}
			return { rows: [], rowCount: 0 };
		}
		// Signature audit residual count (surviving documents only).
		if (/COUNT/i.test(sql) && /FROM signature_audit_events/i.test(sql)) {
			return { rows: [{ c: s.auditResidual }], rowCount: 1 };
		}
		// GAP-D selects (order matters: joined selects carry other tables'
		// names in JOIN clauses, so match the driving FROM first).
		if (/FROM candidate_onboarding_data/i.test(sql)) return { rows: s.cod, rowCount: s.cod.length };
		if (/FROM onboarding_chats/i.test(sql)) return { rows: s.chats, rowCount: s.chats.length };
		if (/FROM onboarding_documents/i.test(sql)) return { rows: s.docs, rowCount: s.docs.length };
		if (/FROM onboarding_checklists/i.test(sql)) return { rows: s.checklists, rowCount: s.checklists.length };
		if (/FROM onboarding_tasks/i.test(sql)) return { rows: s.tasks, rowCount: s.tasks.length };
		if (/FROM onboarding_plans/i.test(sql)) return { rows: s.plans, rowCount: s.plans.length };
		if (/FROM verified_credentials/i.test(sql)) return { rows: s.credentials, rowCount: s.credentials.length };
		if (/FROM bg_verification_requests/i.test(sql)) return { rows: s.bg, rowCount: s.bg.length };
		if (/FROM discrepancies/i.test(sql)) return { rows: s.discrepancies, rowCount: s.discrepancies.length };
		if (/FROM education_history/i.test(sql)) return { rows: s.edu, rowCount: s.edu.length };
		if (/FROM employment_history/i.test(sql)) return { rows: s.emp, rowCount: s.emp.length };
		if (/FROM reference_checks/i.test(sql)) return { rows: s.refs, rowCount: s.refs.length };
		if (/FROM offers/i.test(sql)) return { rows: s.offers, rowCount: s.offers.length };
		if (/FROM signing_parties/i.test(sql)) return { rows: s.parties, rowCount: s.parties.length };
		if (/FROM signature_requests/i.test(sql)) {
			if (/document_id = ANY/i.test(sql)) return { rows: s.docRequests, rowCount: s.docRequests.length };
			return { rows: s.requests, rowCount: s.requests.length };
		}
		if (/FROM signature_documents/i.test(sql)) return { rows: s.sigDocs, rowCount: s.sigDocs.length };
		// GAP-D deletes / updates: rowCount = ids addressed, unless the
		// scenario pins an explicit count (e.g. discrepancies).
		const writeMatch = sql.match(/(?:DELETE FROM|UPDATE)\s+(\w+)/i);
		if (writeMatch) {
			const table = writeMatch[1];
			if (s.deleteCounts[table] != null) return { rows: [], rowCount: s.deleteCounts[table] };
			const arr = params.find((p) => Array.isArray(p));
			return { rows: [], rowCount: arr ? arr.length : 1 };
		}
		// Everything else in the pre-#1123 sequence: generic success
		// (destroyDEK's UPDATE reports rowCount 1 → shredded).
		return { rows: [], rowCount: 1 };
	});
	return client;
}

function callsMatching(client, re) {
	return client.query.mock.calls.filter(([sql]) => re.test(sql));
}
function callIndex(client, re) {
	return client.query.mock.calls.findIndex(([sql]) => re.test(sql));
}

const PATTERN_DOC_URL = '/api/files/r2/onboarding/ENC-TEST-doc.pdf';
const PATTERN_OFFER_URL = '/api/files/r2/offers/ENC-TEST-signature.png';
const PATTERN_SIGDOC_URL = '/api/files/r2/signatures/ENC-TEST-doc.pdf';
const EXTERNAL_URL = 'https://external.example/ENC-TEST-doc.pdf';

function fullScenario() {
	return {
		credentials: [{ id: 71 }],
		cod: [{ id: 11, company_id: 3 }],
		docs: [{ id: 21, company_id: 3, document_url: PATTERN_DOC_URL }],
		checklists: [{ id: 31, company_id: 3 }],
		chats: [{ id: 41, company_id: 3 }],
		plans: [{ id: 51, company_id: 3 }],
		tasks: [{ id: 61, plan_id: 51 }],
		bg: [{ id: 81 }, { id: 82 }],
		discrepancies: [
			{ id: 91, verification_request_id: 81 },
			{ id: 92, verification_request_id: 82 },
		],
		deleteCounts: { discrepancies: 2 },
		edu: [{ id: 85 }],
		emp: [{ id: 86 }],
		refs: [{ id: 87 }],
		offers: [{ id: 95, company_id: 3, signature_url: PATTERN_OFFER_URL }],
		parties: [{ id: 201, company_id: 3 }],
		requests: [{ id: 211, document_id: 301, party_id: 201 }],
		docRequests: [{ document_id: 301, party_id: 201 }],
		sigDocs: [{ id: 301, company_id: 3, created_by: 7, file_url: PATTERN_SIGDOC_URL }],
		deleteCountsExtra: null,
	};
}

describe('#1123 GAP-D erasePersonalData — BGV & onboarding family', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('hard-deletes every ruled table, keyed by candidate, with per-table counts in gapD', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		for (const table of [
			'candidate_onboarding_data',
			'onboarding_documents',
			'onboarding_checklists',
			'onboarding_chats',
			'onboarding_plans',
			'onboarding_tasks',
			'bg_verification_requests',
			'discrepancies',
			'education_history',
			'employment_history',
			'reference_checks',
			'verified_credentials',
			'signature_requests',
			'signature_documents',
			'document_hash_records',
		]) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(1);
		}
		expect(result.gapD).toMatchObject({
			candidateOnboardingData: 1,
			onboardingDocuments: 1,
			onboardingChecklists: 1,
			onboardingChats: 1,
			onboardingPlans: 1,
			onboardingTasks: 1,
			bgVerificationRequests: 2,
			discrepancies: 2,
			educationHistory: 1,
			employmentHistory: 1,
			referenceChecks: 1,
			verifiedCredentials: 1,
			signatureRequests: 1,
			signatureDocuments: 1,
			documentHashRecords: 1,
			signingPartiesDeleted: 1,
			rowsHeld: 0,
		});
		// Out of scope (Q7): never touched.
		for (const table of ['employees', 'paychecks', 'payroll_configs', 'tax_documents', 'post_hire_feedback', 'offer_templates', 'company_policies']) {
			expect(callsMatching(client, new RegExp(`(DELETE FROM|UPDATE) ${table}`, 'i'))).toHaveLength(0);
		}
	});

	test('delete ORDER: onboarding data + documents before checklists; tasks before plans; discrepancies before BGV requests', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const cod = callIndex(client, /DELETE FROM candidate_onboarding_data/i);
		const docs = callIndex(client, /DELETE FROM onboarding_documents/i);
		const checklists = callIndex(client, /DELETE FROM onboarding_checklists/i);
		const tasks = callIndex(client, /DELETE FROM onboarding_tasks/i);
		const plans = callIndex(client, /DELETE FROM onboarding_plans/i);
		const disc = callIndex(client, /DELETE FROM discrepancies/i);
		const bg = callIndex(client, /DELETE FROM bg_verification_requests/i);
		expect(cod).toBeGreaterThan(-1);
		expect(cod).toBeLessThan(checklists);
		expect(docs).toBeLessThan(checklists);
		expect(tasks).toBeLessThan(plans);
		expect(disc).toBeLessThan(bg);
		// Explicit, by parent ids — never cascade-assumed.
		const discCall = callsMatching(client, /DELETE FROM discrepancies/i)[0];
		expect(discCall[0]).toMatch(/verification_request_id = ANY/i);
		expect(discCall[1]).toEqual([[81, 82]]);
	});

	test('FK ordering: verified_credentials is deleted BEFORE the shipped verification_documents DELETE', async () => {
		const client = makeClient(fullScenario());
		await erasureService.erasePersonalData(7, { client });

		const vc = callIndex(client, /DELETE FROM verified_credentials/i);
		const vd = callIndex(client, /DELETE FROM verification_documents/i);
		expect(vc).toBeGreaterThan(-1);
		expect(vd).toBeGreaterThan(-1);
		expect(vc).toBeLessThan(vd);
		const vcCall = callsMatching(client, /DELETE FROM verified_credentials/i)[0];
		expect(vcCall[0]).toMatch(/user_id = \$1/);
		expect(vcCall[1]).toEqual([7, [71]]);
	});

	test('offers: redact-to-skeleton with exactly the ruled NULL set; row never DELETEd; signature_url ledgered', async () => {
		const client = makeClient(fullScenario());
		const result = await erasureService.erasePersonalData(7, { client });

		expect(callsMatching(client, /DELETE FROM offers/i)).toHaveLength(0);
		const updates = callsMatching(client, /UPDATE offers/i);
		expect(updates).toHaveLength(1);
		const [sql, params] = updates[0];
		expect(sql).toMatch(/candidate_id = \$1/);
		expect(sql).toMatch(/id = ANY\(\$2\)/);
		expect(params).toEqual([7, [95]]);
		const setClause = sql.slice(sql.search(/SET/i) + 3, sql.search(/WHERE/i));
		const assignments = setClause.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).sort();
		expect(assignments).toEqual(
			[
				'salary = NULL',
				'benefits = NULL',
				'template_data = NULL',
				'offer_letter_html = NULL',
				'candidate_signature = NULL',
				'candidate_signed_at = NULL',
				'candidate_sign_ip = NULL',
				'decline_reason = NULL',
				'signature_url = NULL',
				'updated_at = NOW()',
			].sort(),
		);
		expect(result.gapD.offersRedacted).toBe(1);
		expect(result.storageKeys).toContain(PATTERN_OFFER_URL);
	});

	test('storage: all three URL families ledgered in-tx; non-/api/files/ document_url named explicitly, never silently skipped', async () => {
		const scenario = fullScenario();
		scenario.docs = [
			{ id: 21, company_id: 3, document_url: PATTERN_DOC_URL },
			{ id: 22, company_id: 3, document_url: EXTERNAL_URL },
		];
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		const ledger = callsMatching(client, /INSERT INTO pending_storage_deletions/i);
		const ledgeredUrls = ledger.map(([, p]) => p[1]);
		expect(ledgeredUrls).toEqual(
			expect.arrayContaining([PATTERN_DOC_URL, PATTERN_OFFER_URL, PATTERN_SIGDOC_URL]),
		);
		expect(ledgeredUrls).not.toContain(EXTERNAL_URL);
		// The external-URL row itself is still deleted (inline copies die
		// with it); only the unaddressable object is named in the result.
		expect(result.gapD.onboardingDocuments).toBe(2);
		expect(result.gapD.nonPatternStorageUrls).toEqual([EXTERNAL_URL]);
		expect(result.gapD.storageLedgered).toBe(ledgeredUrls.filter((u) =>
			[PATTERN_DOC_URL, PATTERN_OFFER_URL, PATTERN_SIGDOC_URL].includes(u),
		).length);
		expect(result.storageKeys).toEqual(
			expect.arrayContaining([PATTERN_DOC_URL, PATTERN_OFFER_URL, PATTERN_SIGDOC_URL]),
		);
	});

	test('whole-erasure gate: an active hold aborts before any GAP-D statement (LegalHoldError, zero deletes)', async () => {
		const client = makeClient({ ...fullScenario(), gateHeld: true });
		const err = await erasureService.erasePersonalData(7, { client }).catch((e) => e);
		expect(err).toBeInstanceOf(LegalHoldError);
		expect(callsMatching(client, /DELETE FROM/i)).toHaveLength(0);
		expect(callsMatching(client, /UPDATE offers/i)).toHaveLength(0);
		expect(callsMatching(client, /INSERT INTO pending_storage_deletions/i)).toHaveLength(0);
	});

	test('NAMED TEST — company hold via the row’s own company_id preserves rows for a candidate with NO interview_sessions', async () => {
		// This candidate has no sessions anywhere in the scenario (the
		// fake models none): the shipped session-based attribution
		// cannot reach them, and the entry gate (user/session shape)
		// passes. Only the per-row company_id consult can hold them.
		const scenario = fullScenario();
		scenario.offers = [
			{ id: 95, company_id: 99, signature_url: PATTERN_OFFER_URL },
			{ id: 96, company_id: 3, signature_url: null },
		];
		scenario.docs = [{ id: 21, company_id: 99, document_url: PATTERN_DOC_URL }];
		scenario.sigDocs = [{ id: 301, company_id: 99, created_by: 7, file_url: PATTERN_SIGDOC_URL }];
		const client = makeClient({ ...scenario, heldCompanies: new Set([99]) });

		const result = await erasureService.erasePersonalData(7, { client });

		// A per-row consult carried the row's own company_id.
		const holdCalls = callsMatching(client, /FROM legal_holds/i);
		expect(holdCalls.some(([, p]) => p[0] === 7 && p[1] === 99)).toBe(true);

		// Held offer excluded from the redaction; unheld offer redacted.
		const updates = callsMatching(client, /UPDATE offers/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][1]).toEqual([7, [96]]);
		// Held document row preserved; its URL never ledgered.
		expect(callsMatching(client, /DELETE FROM onboarding_documents/i)).toHaveLength(0);
		expect(result.storageKeys).not.toContain(PATTERN_DOC_URL);
		// Held signature document preserved entirely: no doc delete, no
		// request delete for it, and its file never ledgered.
		expect(callsMatching(client, /DELETE FROM signature_documents/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM signature_requests/i)).toHaveLength(0);
		expect(result.storageKeys).not.toContain(PATTERN_SIGDOC_URL);
		expect(result.gapD.rowsHeld).toBeGreaterThanOrEqual(3);
		expect(result.gapD.heldTables).toEqual(
			expect.arrayContaining(['offers', 'onboarding_documents', 'signature_documents']),
		);
	});

	test('per-row hold-lookup failure fails closed: the row is skipped + counted, erasure does not throw', async () => {
		const scenario = fullScenario();
		scenario.offers = [
			{ id: 95, company_id: 4, signature_url: PATTERN_OFFER_URL },
			{ id: 96, company_id: 3, signature_url: null },
		];
		const client = makeClient({ ...scenario, errorCompanies: new Set([4]) });

		const result = await erasureService.erasePersonalData(7, { client });

		const updates = callsMatching(client, /UPDATE offers/i);
		expect(updates).toHaveLength(1);
		expect(updates[0][1]).toEqual([7, [96]]);
		expect(result.gapD.rowsHeld).toBeGreaterThanOrEqual(1);
		expect(result.storageKeys).not.toContain(PATTERN_OFFER_URL);
	});

	test('signature split: surviving company document — candidate request deleted, party redacted (not deleted), audit chain untouched + residual counted', async () => {
		const scenario = fullScenario();
		// Doc 301: candidate-created, candidate sole party → deleted.
		// Doc 302: company document, candidate + another party → survives.
		scenario.sigDocs = [
			{ id: 301, company_id: 3, created_by: 7, file_url: PATTERN_SIGDOC_URL },
			{ id: 302, company_id: 3, created_by: 99, file_url: '/api/files/r2/signatures/company-doc.pdf' },
		];
		scenario.requests = [
			{ id: 211, document_id: 301, party_id: 201 },
			{ id: 212, document_id: 302, party_id: 201 },
		];
		scenario.docRequests = [
			{ document_id: 301, party_id: 201 },
			{ document_id: 302, party_id: 201 },
			{ document_id: 302, party_id: 202 },
		];
		scenario.auditResidual = 2;
		const client = makeClient(scenario);
		const result = await erasureService.erasePersonalData(7, { client });

		// Only the candidate-scoped document is deleted; its hash records
		// and audit events are deleted EXPLICITLY, before it.
		const docDeletes = callsMatching(client, /DELETE FROM signature_documents/i);
		expect(docDeletes).toHaveLength(1);
		expect(docDeletes[0][1]).toEqual([[301]]);
		const hashIdx = callIndex(client, /DELETE FROM document_hash_records/i);
		const auditIdx = callIndex(client, /DELETE FROM signature_audit_events/i);
		const docIdx = callIndex(client, /DELETE FROM signature_documents/i);
		expect(hashIdx).toBeGreaterThan(-1);
		expect(hashIdx).toBeLessThan(docIdx);
		expect(auditIdx).toBeGreaterThan(-1);
		expect(auditIdx).toBeLessThan(docIdx);
		expect(callsMatching(client, /DELETE FROM signature_audit_events/i)[0][1]).toEqual([[301]]);
		// The surviving document's file is NOT ledgered; the deleted
		// document's file IS.
		expect(result.storageKeys).toContain(PATTERN_SIGDOC_URL);
		expect(result.storageKeys).not.toContain('/api/files/r2/signatures/company-doc.pdf');

		// Candidate-as-party requests die on BOTH documents (blob+metadata).
		const reqDeletes = callsMatching(client, /DELETE FROM signature_requests/i);
		expect(reqDeletes).toHaveLength(1);
		expect(reqDeletes[0][1]).toEqual([[211, 212]]);

		// The party row touches a surviving document → REDACT, never delete.
		expect(callsMatching(client, /DELETE FROM signing_parties/i)).toHaveLength(0);
		const redactions = callsMatching(client, /UPDATE signing_parties/i);
		expect(redactions).toHaveLength(1);
		expect(redactions[0][0]).toMatch(/email = \$1/);
		expect(redactions[0][0]).toMatch(/full_name = \$2/);
		expect(redactions[0][0]).toMatch(/phone = NULL/);
		expect(redactions[0][0]).toMatch(/user_id = NULL/);
		// Privacy-review fix: job_title + the unclassified metadata
		// JSONB are cleared too — they are re-identification vectors.
		expect(redactions[0][0]).toMatch(/job_title = NULL/);
		expect(redactions[0][0]).toMatch(/metadata = '\{\}'::jsonb/);
		expect(redactions[0][1]).toEqual(['erased-party-201@deleted.local', 'Erased Party', 201]);
		expect(result.gapD.signingPartiesRedacted).toBe(1);
		expect(result.gapD.signingPartiesDeleted).toBe(0);

		// Audit events are never UPDATEd/rewritten; residual actor_email
		// on the surviving document is counted + disclosed, not erased.
		expect(callsMatching(client, /UPDATE signature_audit_events/i)).toHaveLength(0);
		expect(result.gapD.signatureAuditResidual).toBe(2);
	});

	test('candidate with no GAP-D rows: no GAP-D writes, all counts zero, no ledger inserts', async () => {
		const client = makeClient({});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.gapD.rowsHeld).toBe(0);
		expect(result.gapD.storageLedgered).toBe(0);
		expect(result.gapD.nonPatternStorageUrls).toEqual([]);
		expect(result.gapD.signatureAuditResidual).toBe(0);
		for (const table of ['candidate_onboarding_data', 'bg_verification_requests', 'verified_credentials', 'signature_documents']) {
			expect(callsMatching(client, new RegExp(`DELETE FROM ${table}`, 'i'))).toHaveLength(0);
		}
		expect(callsMatching(client, /UPDATE offers/i)).toHaveLength(0);
	});
});

describe('#1123 GAP-D PR-gate fix P-1 — migration 259 makes the ruled offers skeleton executable', () => {
	test('migration 259 exists, contains exactly the one ALTER, and the skeleton UPDATE is unchanged', async () => {
		const fs = require('fs');
		const path = require('path');
		const migrationPath = path.join(__dirname, '../../../migrations/259_offers_salary_nullable.js');
		expect(fs.existsSync(migrationPath)).toBe(true);
		const source = fs.readFileSync(migrationPath, 'utf8');
		// The exact ruled ALTER — and no other schema statement in the file.
		expect(source).toContain('ALTER TABLE offers ALTER COLUMN salary DROP NOT NULL;');
		expect(source.match(/ALTER TABLE/g)).toHaveLength(1);
		expect(source).not.toMatch(/CREATE TABLE|ADD COLUMN|DROP TABLE|DROP COLUMN/);

		// Runner contract (migrate.js): a named module exporting up();
		// up() issues exactly the one statement.
		const migration = require(migrationPath);
		expect(migration.name).toBe('259_offers_salary_nullable');
		expect(typeof migration.up).toBe('function');
		const queries = [];
		await migration.up({ query: async (sql) => { queries.push(sql); return { rows: [], rowCount: 0 }; } });
		expect(queries).toHaveLength(1);
		expect(queries[0].trim()).toBe('ALTER TABLE offers ALTER COLUMN salary DROP NOT NULL;');

		// The skeleton UPDATE is unchanged — salary still goes to NULL
		// (no sentinel); migration 259 is what makes it executable.
		const erasureSource = fs.readFileSync(path.join(__dirname, '../../../lib/erasureService.js'), 'utf8');
		expect(erasureSource).toMatch(/UPDATE offers\s+SET salary = NULL,/);
	});
});

describe('#1123 GAP-D Phase 2 — ledger drain re-consults legal hold per entry (shipped pattern intact)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('held ledger entry (incl. a GAP-D URL shape) is skipped, left pending, and counted', async () => {
		const entry = { id: 55, file_url: PATTERN_DOC_URL, storage_type: 'r2' };
		db.query.mockImplementation(async (sql) => {
			if (/FROM legal_holds/i.test(sql)) {
				return { rows: [{ id: 9, user_id: 7, company_id: null }], rowCount: 1 };
			}
			if (/FROM pending_storage_deletions/i.test(sql)) return { rows: [entry], rowCount: 1 };
			return { rows: [], rowCount: 1 };
		});
		const res = await erasureService.deleteErasedStorageFiles(7, {});
		expect(res.deleted).toBe(0);
		expect(res.heldSkips).toBe(1);
		expect(deleteFile).not.toHaveBeenCalled();
	});
});
