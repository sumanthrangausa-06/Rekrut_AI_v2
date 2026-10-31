/**
 * #2049 Slice B — POST /gdpr/export: Lex ruling on other-person PII
 * in non-*_id string keys (Lex ruling comment 6544914912 on #2049;
 * STOP 1 in this lane). Slice A (non-user *_id bookkeeping verbatim)
 * needs no code change and is pinned here as surviving.
 *
 * #2046 governed user-id keys, free text, and secret/storage classes
 * inside audit_logs.metadata, but person-contact string keys stayed
 * verbatim: a third party's target_email / target_name /
 * new_owner_email rode in someone else's export copy, and a bare
 * email-shaped value under any other key did too.
 *
 * Fix contract (Lex, Slice B — export copy ONLY; stored rows are
 * never mutated):
 *   1. Census person-contact keys (canonicalised): targetemail,
 *      newowneremail, targetname, newownername, plus any canonical
 *      key ending in `email`. Subject-relative keep: an email key is
 *      kept ONLY when its value, trimmed + case-insensitive, equals
 *      the subject's own email (users.email); a name key in this
 *      census ONLY when its value, trimmed + case-insensitive,
 *      equals the subject's own name (users.name). Otherwise the key
 *      is dropped at every depth and its name joins the removed-keys
 *      bundle note.
 *   2. Email-shape backstop: any string value under any key at any
 *      depth (including array elements, swept like the #2046 storage
 *      class) that IS an email address as a whole value and is not
 *      the subject's own email is dropped, key named in the note.
 *      Whole-value only — no substring redaction.
 *   3. Unchanged: generic `name` verbatim, `domain` verbatim, all
 *      Slice A bookkeeping verbatim.
 *
 * Harness follows the #2046 suite: the REAL route runs; only the
 * pool boundary (and auth) is mocked. The HL-003 real-DB journey is
 * the companion suite (compliance-gdpr-export-metadata-realdb-2049).
 */
const express = require('express');
const request = require('supertest');

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
const SUBJECT_EMAIL = 'subject2049@example.com';
const SUBJECT_NAME = 'Subject Two Zero Four Nine';

// Third-party person-contact values that must never reach the
// serialised bundle. (The subject's own email/name DO appear in the
// bundle's user section, so they are never in this list.)
const THIRD_PARTY_VALUES = [
	'third2049@example.com',
	'Third Party 2049',
	'newowner2049@example.com',
	'New Owner 2049',
	'someone2049@example.com',
	'bare2049@example.com',
	'listother2049@example.com',
	'nested2049@example.com',
	'Nested Third 2049',
	'nestedbare2049@example.com',
	'arraythird2049@example.com',
	'arraybare2049@example.com',
	'variant2049@example.com',
	'camel2049@example.com',
	'Variant Owner 2049',
	'filebare2049@example.com',
	'padded2049@example.com',
	'nestedlist2049@example.com',
];

const USER_ROW = {
	id: SUBJECT_ID,
	email: SUBJECT_EMAIL,
	name: SUBJECT_NAME,
	role: 'candidate',
};

const AUDIT_ROW_FOREIGN = {
	id: 61,
	action_type: 'recruiter_suspended',
	user_id: SUBJECT_ID,
	target_type: 'user',
	target_id: 9001,
	metadata: {
		// Census keys carrying a THIRD party (company.js writers).
		target_email: 'third2049@example.com',
		target_name: 'Third Party 2049',
		new_owner_email: 'newowner2049@example.com',
		new_owner_name: 'New Owner 2049',
		// Any canonical key ending in `email` is in the census.
		email: 'third2049@example.com',
		contact_email: 'someone2049@example.com',
		// Canonical variants of census keys are the same class.
		'Target-Email': 'variant2049@example.com',
		targetEmail: 'camel2049@example.com',
		NEW_OWNER_NAME: 'Variant Owner 2049',
		// Email-shape backstop: a bare whole-value email under a key
		// no census names — including a file-name key whose value is
		// an email, and a whitespace-padded whole-value email.
		unrelated_key: 'bare2049@example.com',
		file_name: 'filebare2049@example.com',
		padded_key: '  padded2049@example.com ',
		// Whole-value only: an email as a SUBSTRING of a longer
		// bookkeeping string is NOT redacted or dropped.
		bookkeeping_text: 'reach substring2049@example.com please',
		// Array elements are swept like the storage class: the third
		// party's email drops, the plain entry and the subject's own
		// email survive.
		contact_list: ['listother2049@example.com', 'plain-entry', SUBJECT_EMAIL],
		// Array-in-array: the foreign email is swept at depth and the
		// OWNING key is named in the note (privacy review finding 1).
		contact_nested_list: [['nestedlist2049@example.com'], ['plain-entry']],
		nested: {
			target_email: 'nested2049@example.com',
			target_name: 'Nested Third 2049',
			deep_note: 'nestedbare2049@example.com',
			note_text: 'system bookkeeping',
		},
		// Residual (recorded, not governed by the ruling): a third
		// party's NAME under a non-census key (owner_name) has no
		// shape test and is outside Lex's writer census — it stays
		// verbatim, exactly like generic `name`, until Lex rules.
		owner_name: 'Owner Third 2049',
		// Explicitly unchanged by the ruling.
		name: 'A Search Label 2049',
		domain: 'example.com',
		// Slice A: non-user *_id bookkeeping verbatim.
		job_id: 4242,
		company_id: 42,
		new_status: 'interview',
	},
	ip_address: '203.0.113.49',
	user_agent: 'jest',
	created_at: '2026-10-20T00:00:00.000Z',
	company_id: 42,
	actor_id: SUBJECT_ID,
	action: null,
	reason: null,
};

const AUDIT_ROW_SELF = {
	id: 62,
	action_type: 'oauth_google_connected',
	user_id: SUBJECT_ID,
	target_type: 'user',
	target_id: SUBJECT_ID,
	metadata: {
		// Subject-relative keep: trimmed + case-insensitive equality
		// with the subject's own email / name keeps the ORIGINAL
		// value verbatim.
		target_email: '  Subject2049@Example.COM ',
		target_name: ' subject two zero four nine ',
		new_owner_email: SUBJECT_EMAIL,
		new_owner_name: SUBJECT_NAME,
		// The auth.js counterexample shape: the subject's own email
		// under bare `email` on their own login row.
		email: SUBJECT_EMAIL,
		provider: 'google',
		domain: 'example.com',
		name: 'My Own Search 2049',
		// The subject's own email, whitespace-padded, under an
		// unrelated key: the backstop keeps it (trimmed comparison).
		padded_own: ' subject2049@example.com ',
	},
	ip_address: '203.0.113.49',
	user_agent: 'jest',
	created_at: '2026-10-21T00:00:00.000Z',
	company_id: null,
	actor_id: SUBJECT_ID,
	action: null,
	reason: null,
};

const AUDIT_ROW_ARRAY_METADATA = {
	id: 63,
	action_type: 'array_metadata_probe_2049',
	user_id: SUBJECT_ID,
	target_type: 'user',
	target_id: SUBJECT_ID,
	metadata: [
		{ target_email: 'arraythird2049@example.com', new_status: 'screening' },
		'arraybare2049@example.com',
		'plain-entry',
		SUBJECT_EMAIL,
	],
	ip_address: '203.0.113.49',
	user_agent: 'jest',
	created_at: '2026-10-22T00:00:00.000Z',
	company_id: null,
	actor_id: SUBJECT_ID,
	action: null,
	reason: null,
};

const CONSENT_NOTE =
	'Consent record metadata is withheld in this copy because its contents are caller-supplied and unverified.';

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		const s = sql.toLowerCase();
		if (s.includes('from users')) {
			return { rows: params[0] === SUBJECT_ID ? [USER_ROW] : [] };
		}
		if (s.includes('from audit_logs')) {
			return {
				rows:
					params[0] === SUBJECT_ID
						? [AUDIT_ROW_FOREIGN, AUDIT_ROW_SELF, AUDIT_ROW_ARRAY_METADATA]
						: [],
			};
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockCaller = 'subject';
	installPoolMock();
});

describe('#2049 Slice B POST /gdpr/export — person-contact keys + email backstop (Lex)', () => {
	test('sentinel: no third-party person-contact value appears anywhere in the serialised bundle', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		for (const value of THIRD_PARTY_VALUES) {
			expect(serialised).not.toContain(value);
		}
		// The subject's own identity still appears (user section).
		expect(serialised).toContain(SUBJECT_EMAIL);
		expect(serialised).toContain(SUBJECT_NAME);
	});

	test('census keys: third party dropped at every depth; own email/name kept trimmed + case-insensitively', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const foreign = res.body.data.audit_trail[0].metadata;
		expect(foreign).not.toHaveProperty('target_email');
		expect(foreign).not.toHaveProperty('target_name');
		expect(foreign).not.toHaveProperty('new_owner_email');
		expect(foreign).not.toHaveProperty('new_owner_name');
		expect(foreign).not.toHaveProperty('email');
		expect(foreign).not.toHaveProperty('contact_email');
		expect(foreign).not.toHaveProperty('Target-Email');
		expect(foreign).not.toHaveProperty('targetEmail');
		expect(foreign).not.toHaveProperty('NEW_OWNER_NAME');
		expect(foreign.nested).not.toHaveProperty('target_email');
		expect(foreign.nested).not.toHaveProperty('target_name');
		expect(foreign.nested.note_text).toBe('system bookkeeping');

		const self = res.body.data.audit_trail[1].metadata;
		expect(self.target_email).toBe('  Subject2049@Example.COM ');
		expect(self.target_name).toBe(' subject two zero four nine ');
		expect(self.new_owner_email).toBe(SUBJECT_EMAIL);
		expect(self.new_owner_name).toBe(SUBJECT_NAME);
		expect(self.email).toBe(SUBJECT_EMAIL);
		expect(self.provider).toBe('google');
	});

	test('email-shape backstop: whole-value emails dropped under any key incl. arrays; substrings and own email survive', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const foreign = res.body.data.audit_trail[0].metadata;
		expect(foreign).not.toHaveProperty('unrelated_key');
		expect(foreign).not.toHaveProperty('file_name');
		expect(foreign).not.toHaveProperty('padded_key');
		expect(foreign.nested).not.toHaveProperty('deep_note');
		expect(foreign.contact_list).toEqual(['plain-entry', SUBJECT_EMAIL]);
		expect(foreign.contact_nested_list).toEqual([[], ['plain-entry']]);
		// Whole-value only — no substring redaction.
		expect(foreign.bookkeeping_text).toBe('reach substring2049@example.com please');
		// The subject's own padded email under an unrelated key is
		// kept by the same trimmed comparison.
		const self = res.body.data.audit_trail[1].metadata;
		expect(self.padded_own).toBe(' subject2049@example.com ');
	});

	test('explicitly unchanged: generic name, domain, and Slice A bookkeeping stay verbatim', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const foreign = res.body.data.audit_trail[0].metadata;
		expect(foreign.name).toBe('A Search Label 2049');
		// Residual pin (see fixture comment): non-census name keys
		// stay verbatim until Lex rules — deliberate, not silent.
		expect(foreign.owner_name).toBe('Owner Third 2049');
		expect(foreign.domain).toBe('example.com');
		expect(foreign.job_id).toBe(4242);
		expect(foreign.company_id).toBe(42);
		expect(foreign.new_status).toBe('interview');
		const self = res.body.data.audit_trail[1].metadata;
		expect(self.name).toBe('My Own Search 2049');
		expect(self.domain).toBe('example.com');
	});

	test('root-array metadata: census keys and email-shaped elements are swept', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const row = res.body.data.audit_trail.find(
			(r) => r.action_type === 'array_metadata_probe_2049',
		);
		expect(row.metadata).toEqual([
			{ new_status: 'screening' },
			'plain-entry',
			SUBJECT_EMAIL,
		]);
	});

	test('bundle note lists the removed key names (never values)', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const notes = res.body.data.notes;
		expect(notes[0]).toBe(CONSENT_NOTE);
		const auditNote = notes.find((n) => n.startsWith('Audit log metadata'));
		expect(auditNote).toBeDefined();
		for (const name of [
			'target_email',
			'target_name',
			'new_owner_email',
			'new_owner_name',
			'email',
			'contact_email',
			'unrelated_key',
			'contact_list',
			'deep_note',
			'Target-Email',
			'targetEmail',
			'NEW_OWNER_NAME',
			'file_name',
			'padded_key',
			'contact_nested_list',
		]) {
			expect(auditNote).toContain(name);
		}
		for (const value of THIRD_PARTY_VALUES) {
			expect(auditNote).not.toContain(value);
		}
	});

	test('stored rows are never mutated by the export projection', async () => {
		await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(AUDIT_ROW_FOREIGN.metadata.target_email).toBe('third2049@example.com');
		expect(AUDIT_ROW_FOREIGN.metadata.target_name).toBe('Third Party 2049');
		expect(AUDIT_ROW_FOREIGN.metadata.new_owner_email).toBe('newowner2049@example.com');
		expect(AUDIT_ROW_FOREIGN.metadata.unrelated_key).toBe('bare2049@example.com');
		expect(AUDIT_ROW_FOREIGN.metadata.contact_list).toEqual([
			'listother2049@example.com',
			'plain-entry',
			SUBJECT_EMAIL,
		]);
		expect(AUDIT_ROW_FOREIGN.metadata.nested.target_email).toBe('nested2049@example.com');
		expect(AUDIT_ROW_ARRAY_METADATA.metadata[0].target_email).toBe(
			'arraythird2049@example.com',
		);
		expect(AUDIT_ROW_ARRAY_METADATA.metadata[1]).toBe('arraybare2049@example.com');
	});
});
