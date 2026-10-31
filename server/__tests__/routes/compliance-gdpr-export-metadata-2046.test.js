/**
 * #2046 — POST /gdpr/export: Lex ruling on metadata JSONB content and
 * other-user FKs inside subject rows (Lex ruling comment 6544214655
 * on #2046; STOP 1 comment 6544330118).
 *
 * The #2041 lane gave every export section an explicit column list,
 * but column lists cannot govern what rides INSIDE three fields the
 * subject's copy legitimately includes. On base code the handler
 * places consent_records / audit_logs rows verbatim, so:
 *   - consent_records.metadata (client-supplied verbatim, no
 *     allowlist at write time) exports as-is;
 *   - audit_logs.metadata exports as-is — including a third party's
 *     candidate_id / actor_id, recruiter-authored recruiter_notes /
 *     override_reason, and any secret / storage-reference key;
 *   - consent_records.revocation_reason (revoker-authored free text)
 *     exports as-is;
 *   - consent_records.revoked_by and audit_logs.actor_id export the
 *     other person's user id.
 *
 * Fix contract (Lex): export-copy projection ONLY — stored rows are
 * never mutated.
 *   1. consent metadata -> {} in the copy, with a bundle note stating
 *      the field is withheld because its contents are caller-supplied
 *      and unverified.
 *   2. audit metadata sanitised key-by-key in the copy: secret /
 *      credential / storage-reference keys dropped (the #1128 class);
 *      user-identifier keys kept only when the value is the subject's
 *      own id, otherwise the key is dropped (census set + canonical
 *      *userid compounds); other-authored free text (recruiter_notes,
 *      override_reason, and — privacy review finding 3 — the same
 *      class as notes / reason) dropped; everything else verbatim.
 *      Removed key NAMES are listed in a bundle note.
 *   3. revocation_reason -> null in the copy.
 *   4. revoked_by / actor_id -> ownIdOrNull in the copy (the #2034
 *      pattern at routes/compliance.js:417): subject's own id kept,
 *      others null, NO admin exception.
 *
 * Ambiguities flagged at STOP 1 and kept at status quo in this lane
 * (Lex/Suga to confirm): non-user *_id bookkeeping keys in audit
 * metadata (job_id, company_id, ...) stay verbatim under rule (4);
 * other-person PII in non-*_id string keys (target_email, ...) stays
 * verbatim. This suite pins both so a later ruling changes them
 * deliberately, never silently.
 *
 * #2049 UPDATE (Lex ruling comment 6544914912 on #2049): Slice A
 * status quo STANDS (the *_id pin below is unchanged). Slice B is
 * now governed — a third party's target_email is DROPPED under the
 * subject-relative person-contact rule, so the Slice B pin below
 * flipped deliberately in the #2049 lane; the full Slice B contract
 * lives in compliance-gdpr-export-metadata-2049.test.js.
 *
 * Harness follows the #2035 suite: the REAL route runs; only the pool
 * boundary (and auth) is mocked. The HL-003 real-DB journey is the
 * companion suite (compliance-gdpr-export-metadata-realdb-2046).
 */
const express = require('express');
const request = require('supertest');

// Configurable caller: 'subject' | 'admin' | 'none'.
let mockCaller = 'subject';
jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, res, next) => {
		if (mockCaller === 'none') {
			return res.status(401).json({ error: 'Authentication required' });
		}
		req.user =
			mockCaller === 'admin' ? { id: 1, role: 'admin' } : { id: 7, role: 'candidate' };
		return next();
	}),
}));

jest.mock('../../../lib/db', () => ({ query: jest.fn() }));

const mockAuditLog = jest.fn(async () => {});
jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: {
		log: (...args) => mockAuditLog(...args),
		query: jest.fn(async () => []),
		exportLogs: jest.fn(async () => []),
	},
	logEvent: jest.fn(async () => ({})),
	getAuditTrail: jest.fn(async () => ({ rows: [] })),
	getCandidateDecisions: jest.fn(async () => []),
	verifyChain: jest.fn(async () => ({})),
	exportForRegulator: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision', STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

jest.mock('../../../services/euComplianceService', () => ({}));

jest.mock('../../../lib/biometricCrypto', () => ({
	encryptWithDEK: jest.fn(async () => ({})),
	decryptWithDEK: jest.fn(async () => Buffer.from('{}', 'utf8')),
	decryptWithExistingDEK: jest.fn(async () => Buffer.alloc(0)),
}));

const pool = require('../../../lib/db');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

const SUBJECT_ID = 7;
const OTHER_ID = 8;
const THIRD_ID = 9;

const SENTINELS = [
	'SENTINEL2046_CONSENT_META',
	'SENTINEL2046_REVOCATION_REASON',
	'SENTINEL2046_RECRUITER_NOTES',
	'SENTINEL2046_OVERRIDE_REASON',
	'SENTINEL2046_STORAGE_KEY',
	'SENTINEL2046_API_TOKEN',
	'SENTINEL2046_RESUME_REF',
	'SENTINEL2046_OBJECT_KEY',
	'SENTINEL2046_SELF_REVOKE_TEXT',
	'SENTINEL2046_PROCTORING_NOTES',
	'SENTINEL2046_SCREENING_REASON',
];

const USER_ROW = {
	id: SUBJECT_ID,
	email: 'subject2046@example.com',
	name: 'Subject Two Zero Four Six',
	role: 'candidate',
};

// Revoked BY someone else; metadata and revocation_reason carry
// sentinels that must never reach the serialised bundle.
const CONSENT_ROW_FOREIGN_REVOKER = {
	id: 51,
	user_id: SUBJECT_ID,
	consent_type: 'privacy_policy',
	consented: true,
	consented_at: '2026-10-01T00:00:00.000Z',
	ip_address: '203.0.113.46',
	metadata: { caller_supplied: 'SENTINEL2046_CONSENT_META', anything: 'caller text' },
	created_at: '2026-10-01T00:00:00.000Z',
	updated_at: '2026-10-20T00:00:00.000Z',
	revoked_at: '2026-10-20T00:00:00.000Z',
	revoked_by: OTHER_ID,
	revocation_reason: 'SENTINEL2046_REVOCATION_REASON',
};

// Self-revoked: own id is kept by ownIdOrNull; the reason is still
// revoker-authored free text in Lex's class and is nulled.
const CONSENT_ROW_SELF_REVOKER = {
	id: 52,
	user_id: SUBJECT_ID,
	consent_type: 'marketing',
	consented: false,
	consented_at: '2026-10-02T00:00:00.000Z',
	ip_address: '203.0.113.46',
	metadata: {},
	created_at: '2026-10-02T00:00:00.000Z',
	updated_at: '2026-10-21T00:00:00.000Z',
	revoked_at: '2026-10-21T00:00:00.000Z',
	revoked_by: SUBJECT_ID,
	revocation_reason: 'SENTINEL2046_SELF_REVOKE_TEXT',
};

const AUDIT_ROW_FOREIGN_ACTOR = {
	id: 61,
	action_type: 'human_override',
	user_id: SUBJECT_ID,
	target_type: 'job_application',
	target_id: 9001,
	metadata: {
		candidate_id: OTHER_ID,
		actor_id: OTHER_ID,
		user_id: SUBJECT_ID,
		// Privacy review findings 1+4: canonical variants and
		// compound user-id keys are the same class — all foreign, all
		// must drop. previous_owner_id is a numeric STRING.
		candidateId: OTHER_ID,
		'Candidate-Id': THIRD_ID,
		actor_user_id: OTHER_ID,
		previous_owner_id: String(OTHER_ID),
		job_id: 4242,
		new_status: 'interview',
		recruiter_notes: 'SENTINEL2046_RECRUITER_NOTES',
		override_reason: 'SENTINEL2046_OVERRIDE_REASON',
		// Privacy review finding 3: the same other-authored free-text
		// class under plainer names (proctoring review notes;
		// screening-override reason).
		notes: 'SENTINEL2046_PROCTORING_NOTES',
		reason: 'SENTINEL2046_SCREENING_REASON',
		storage_key: 'SENTINEL2046_STORAGE_KEY',
		api_token: 'SENTINEL2046_API_TOKEN',
		resume_ref: '/api/files/SENTINEL2046_RESUME_REF',
		export_size: 123,
		// #2049 Slice B: other-person PII in a non-*_id string key —
		// verbatim under #2046 pending Lex; DROPPED since the #2049
		// ruling (subject-relative person-contact rule).
		target_email: 'colleague2046@example.com',
		// Rule (4): non-user plural ids are bookkeeping, verbatim.
		application_ids: [101, 102],
		nested: {
			candidate_id: THIRD_ID,
			note_text: 'system bookkeeping',
			object_key: 'SENTINEL2046_OBJECT_KEY',
		},
	},
	ip_address: '203.0.113.46',
	user_agent: 'jest',
	created_at: '2026-10-20T00:00:00.000Z',
	company_id: 42,
	actor_id: OTHER_ID,
	action: null,
	reason: null,
};

const AUDIT_ROW_SELF_ACTOR = {
	id: 62,
	action_type: 'gdpr_data_export',
	user_id: SUBJECT_ID,
	target_type: 'user',
	target_id: SUBJECT_ID,
	metadata: {
		export_size: 456,
		biometric_included: true,
		// Own id as a numeric string and under a compound key: kept.
		user_id: String(SUBJECT_ID),
		actor_user_id: SUBJECT_ID,
	},
	ip_address: '203.0.113.46',
	user_agent: 'jest',
	created_at: '2026-10-21T00:00:00.000Z',
	company_id: null,
	actor_id: SUBJECT_ID,
	action: null,
	reason: null,
};

// Privacy review finding 2: a root-ARRAY metadata (no current writer
// produces one) must be walked, not passed through raw.
const AUDIT_ROW_ARRAY_METADATA = {
	id: 63,
	action_type: 'array_metadata_probe',
	user_id: SUBJECT_ID,
	target_type: 'user',
	target_id: SUBJECT_ID,
	metadata: [{ candidate_id: OTHER_ID, new_status: 'screening' }, 'plain-entry'],
	ip_address: '203.0.113.46',
	user_agent: 'jest',
	created_at: '2026-10-22T00:00:00.000Z',
	company_id: null,
	actor_id: SUBJECT_ID,
	action: null,
	reason: null,
};

const CONSENT_NOTE =
	'Consent record metadata is withheld in this copy because its contents are caller-supplied and unverified.';

// When set, replaces the audit rows the mock returns (negative-case
// test for the bundle audit note).
let auditRowsOverride = null;

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		const s = sql.toLowerCase();
		if (s.includes('from users')) {
			return { rows: params[0] === SUBJECT_ID ? [USER_ROW] : [] };
		}
		if (s.includes('from consent_records')) {
			return {
				rows:
					params[0] === SUBJECT_ID
						? [CONSENT_ROW_FOREIGN_REVOKER, CONSENT_ROW_SELF_REVOKER]
						: [],
			};
		}
		if (s.includes('from audit_logs')) {
			return {
				rows:
					params[0] === SUBJECT_ID
						? auditRowsOverride || [
								AUDIT_ROW_FOREIGN_ACTOR,
								AUDIT_ROW_SELF_ACTOR,
								AUDIT_ROW_ARRAY_METADATA,
							]
						: [],
			};
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockCaller = 'subject';
	auditRowsOverride = null;
	installPoolMock();
});

describe('#2046 POST /gdpr/export — metadata + FK ruling (Lex)', () => {
	test('sentinel: no ruled-out value appears anywhere in the serialised bundle', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		for (const sentinel of SENTINELS) {
			expect(serialised).not.toContain(sentinel);
		}
	});

	test('consents: metadata suppressed to {}, revocation_reason nulled, revoked_by ownIdOrNull', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const [foreign, self] = res.body.data.consents;
		expect(foreign.metadata).toEqual({});
		expect(foreign.revocation_reason).toBeNull();
		expect(foreign.revoked_by).toBeNull();
		// The revocation FACT and its timing stay in the subject's copy.
		expect(foreign.revoked_at).toBe('2026-10-20T00:00:00.000Z');
		expect(self.metadata).toEqual({});
		expect(self.revocation_reason).toBeNull();
		expect(self.revoked_by).toBe(SUBJECT_ID);
		// Row shape unchanged (the #2041 pin set).
		expect(Object.keys(foreign).sort()).toEqual(
			Object.keys(CONSENT_ROW_FOREIGN_REVOKER).sort(),
		);
	});

	test('audit_trail: actor_id ownIdOrNull — foreign null, own kept, no admin exception', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const [foreign, self] = res.body.data.audit_trail;
		expect(foreign.actor_id).toBeNull();
		expect(self.actor_id).toBe(SUBJECT_ID);

		mockCaller = 'admin';
		const adminRes = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(adminRes.status).toBe(200);
		expect(adminRes.body.data.audit_trail[0].actor_id).toBeNull();
		expect(adminRes.body.data.consents[0].revoked_by).toBeNull();
	});

	test('audit metadata: secret/storage dropped, user-id keys dropped unless own, free text dropped, bookkeeping verbatim', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const meta = res.body.data.audit_trail[0].metadata;
		// Identifier keys whose value is another user's id are DROPPED
		// (Lex rule 2 for metadata — dropped, not nulled).
		expect(meta).not.toHaveProperty('candidate_id');
		expect(meta).not.toHaveProperty('actor_id');
		// The subject's own id under an identifier key is kept.
		expect(meta.user_id).toBe(SUBJECT_ID);
		// Secret / credential / storage-reference keys dropped.
		expect(meta).not.toHaveProperty('storage_key');
		expect(meta).not.toHaveProperty('api_token');
		// A storage-reference VALUE under an innocent key is dropped.
		expect(meta).not.toHaveProperty('resume_ref');
		// Recruiter-authored free text dropped — including the same
		// class as `notes` / `reason` (privacy review finding 3).
		expect(meta).not.toHaveProperty('recruiter_notes');
		expect(meta).not.toHaveProperty('override_reason');
		expect(meta).not.toHaveProperty('notes');
		expect(meta).not.toHaveProperty('reason');
		// Canonical variants and compound user-id keys drop too
		// (privacy review findings 1+4); a numeric-string foreign id
		// is still foreign.
		expect(meta).not.toHaveProperty('candidateId');
		expect(meta).not.toHaveProperty('Candidate-Id');
		expect(meta).not.toHaveProperty('actor_user_id');
		expect(meta).not.toHaveProperty('previous_owner_id');
		// Rule (4): the subject's own scalar bookkeeping is verbatim,
		// including non-user *_id keys (STOP 1 ambiguity A, status quo).
		expect(meta.job_id).toBe(4242);
		expect(meta.new_status).toBe('interview');
		expect(meta.export_size).toBe(123);
		expect(meta.application_ids).toEqual([101, 102]);
		// #2049 Slice B pin (flipped deliberately per Lex ruling
		// 6544914912): a third party's target_email is dropped — it
		// is not the subject's own email.
		expect(meta).not.toHaveProperty('target_email');
		// Nested objects are sanitised with the same rules.
		expect(meta.nested).not.toHaveProperty('candidate_id');
		expect(meta.nested).not.toHaveProperty('object_key');
		expect(meta.nested.note_text).toBe('system bookkeeping');
		// The self-actor row: own ids kept, including the numeric
		// string and the compound key; nothing else changes.
		expect(res.body.data.audit_trail[1].metadata).toEqual({
			export_size: 456,
			biometric_included: true,
			user_id: String(SUBJECT_ID),
			actor_user_id: SUBJECT_ID,
		});
	});

	test('audit metadata: a root-array metadata is walked, not passed through raw (finding 2)', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const row = res.body.data.audit_trail.find((r) => r.action_type === 'array_metadata_probe');
		expect(row.metadata).toEqual([{ new_status: 'screening' }, 'plain-entry']);
	});

	test('bundle notes: consent note verbatim; audit note lists removed key names only', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const notes = res.body.data.notes;
		expect(Array.isArray(notes)).toBe(true);
		expect(notes[0]).toBe(CONSENT_NOTE);
		const auditNote = notes.find((n) => n.startsWith('Audit log metadata'));
		expect(auditNote).toBeDefined();
		for (const name of [
			'actor_id',
			'actor_user_id',
			'api_token',
			'candidate_id',
			'candidateId',
			'Candidate-Id',
			'notes',
			'object_key',
			'override_reason',
			'previous_owner_id',
			'reason',
			'recruiter_notes',
			'resume_ref',
			'storage_key',
			'target_email',
		]) {
			expect(auditNote).toContain(name);
		}
		for (const sentinel of SENTINELS) {
			expect(auditNote).not.toContain(sentinel);
		}
	});

	test('bundle notes: no audit note when no metadata keys were removed', async () => {
		auditRowsOverride = [AUDIT_ROW_SELF_ACTOR];
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		expect(res.body.data.notes).toEqual([CONSENT_NOTE]);
	});

	test('stored rows are never mutated by the export projection', async () => {
		await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(CONSENT_ROW_FOREIGN_REVOKER.metadata).toEqual({
			caller_supplied: 'SENTINEL2046_CONSENT_META',
			anything: 'caller text',
		});
		expect(CONSENT_ROW_FOREIGN_REVOKER.revocation_reason).toBe(
			'SENTINEL2046_REVOCATION_REASON',
		);
		expect(CONSENT_ROW_FOREIGN_REVOKER.revoked_by).toBe(OTHER_ID);
		expect(AUDIT_ROW_FOREIGN_ACTOR.actor_id).toBe(OTHER_ID);
		expect(AUDIT_ROW_FOREIGN_ACTOR.metadata.candidate_id).toBe(OTHER_ID);
		expect(AUDIT_ROW_FOREIGN_ACTOR.metadata.recruiter_notes).toBe(
			'SENTINEL2046_RECRUITER_NOTES',
		);
		// Nested objects are copies too, at every depth.
		expect(AUDIT_ROW_FOREIGN_ACTOR.metadata.nested.candidate_id).toBe(THIRD_ID);
		expect(AUDIT_ROW_FOREIGN_ACTOR.metadata.nested.object_key).toBe(
			'SENTINEL2046_OBJECT_KEY',
		);
		expect(AUDIT_ROW_ARRAY_METADATA.metadata[0].candidate_id).toBe(OTHER_ID);
	});
});
