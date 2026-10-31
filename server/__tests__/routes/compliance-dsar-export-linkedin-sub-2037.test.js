/**
 * #2037 [FOLLOW-UP #2036 review M-1]: POST /gdpr/export must not leak
 * the subject's LinkedIn member identifier nested inside the imported
 * `linkedin_data` payload.
 *
 * On pre-fix code `toExportSafeUser` passes `row.linkedin_data`
 * through verbatim. The writer (routes/candidate.js
 * mergeLinkedInProfile) stores JSON.stringify(linkedinProfile._raw),
 * and `_raw.userinfo.sub` is the SAME value stored as
 * `users.linkedin_id` — the field #2035's STOP 1 excluded from the
 * bundle as external authenticator link material. `_raw.me.id` (the
 * LinkedIn v2/me payload) carries the same member identifier. The
 * #2035 suite seeds `linkedin_data` as a flat {headline, source}
 * object, so it cannot catch the nested leak; this suite seeds the
 * production `_raw` shape.
 *
 * Fix contract (STOP 1 on #2037): the projection deep-copies
 * `linkedin_data` and deletes `userinfo.sub` and `me.id` from the
 * copy. The stored row is never mutated; the rest of the imported
 * payload (profile fields, positions, educations, skills) survives.
 *
 * Harness follows the #2035 suite: the REAL route runs; only the
 * pool boundary (and auth) is mocked. The HL-003 real-DB journey is
 * the post-review gate; it is not replaced here.
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

// The two nested locations of the LinkedIn member identifier in the
// production `_raw` shape. Distinct sentinels so a partial strip
// (one location only) still fails.
const SUB_SENTINEL = 'SENTINEL2037_LINKEDIN_SUB_q1';
const ME_ID_SENTINEL = 'SENTINEL2037_LINKEDIN_ME_ID_q2';

// linkedin_data exactly as mergeLinkedInProfile stores it:
// JSON.parse(JSON.stringify(linkedinProfile._raw)).
function realShapeLinkedInData() {
	return {
		userinfo: {
			sub: SUB_SENTINEL,
			name: 'Subject Two Zero Three Seven',
			given_name: 'Subject',
			family_name: 'Two Zero Three Seven',
			email: 'subject2037@example.com',
			picture: 'https://example.com/li-2037.png',
		},
		me: {
			id: ME_ID_SENTINEL,
			localizedFirstName: 'Subject',
			localizedLastName: 'Two Zero Three Seven',
		},
		positions: [{ title: 'Data Analyst', companyName: 'Subject Co' }],
		educations: [{ schoolName: 'Example University' }],
		skills: [{ name: 'SQL' }],
	};
}

const FULL_USER_ROW = {
	id: SUBJECT_ID,
	email: 'subject2037@example.com',
	name: 'Subject Two Zero Three Seven',
	role: 'candidate',
	title: 'Data Analyst',
	company_name: 'Subject Co',
	company_id: 42,
	github_username: 'subject-2037',
	avatar_url: 'https://example.com/avatar-2037.png',
	linkedin_data: realShapeLinkedInData(),
	is_paid: false,
	subscription_plan: null,
	subscription_status: null,
	suspended_at: null,
	deleted_at: null,
	created_at: '2026-10-01T00:00:00.000Z',
	updated_at: '2026-10-20T00:00:00.000Z',
};

const PROFILE_ROW = { id: 37, user_id: SUBJECT_ID, headline: 'Data Analyst' };

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		const s = sql.toLowerCase();
		if (s.includes('from users')) {
			return { rows: params[0] === SUBJECT_ID ? [FULL_USER_ROW] : [] };
		}
		if (s.includes('from candidate_profiles')) {
			return { rows: params[0] === SUBJECT_ID ? [PROFILE_ROW] : [] };
		}
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockCaller = 'subject';
	FULL_USER_ROW.linkedin_data = realShapeLinkedInData();
	installPoolMock();
});

describe('#2037 POST /gdpr/export — nested LinkedIn identifier strip', () => {
	test('sentinel: userinfo.sub and me.id appear nowhere in the serialised bundle (self export)', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		expect(serialised).not.toContain(SUB_SENTINEL);
		expect(serialised).not.toContain(ME_ID_SENTINEL);
	});

	test('sentinel: admin export of another user is stripped identically', async () => {
		mockCaller = 'admin';
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		expect(serialised).not.toContain(SUB_SENTINEL);
		expect(serialised).not.toContain(ME_ID_SENTINEL);
	});

	test('the rest of the imported payload survives the strip', async () => {
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const ld = res.body.data.user.linkedin_data;
		expect(ld.userinfo.name).toBe('Subject Two Zero Three Seven');
		expect(ld.userinfo.email).toBe('subject2037@example.com');
		expect(ld.userinfo).not.toHaveProperty('sub');
		expect(ld.me).not.toHaveProperty('id');
		expect(ld.me.localizedFirstName).toBe('Subject');
		expect(ld.positions).toEqual([{ title: 'Data Analyst', companyName: 'Subject Co' }]);
		expect(ld.educations).toEqual([{ schoolName: 'Example University' }]);
		expect(ld.skills).toEqual([{ name: 'SQL' }]);
	});

	test('the stored row object is not mutated by the projection', async () => {
		await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(FULL_USER_ROW.linkedin_data.userinfo.sub).toBe(SUB_SENTINEL);
		expect(FULL_USER_ROW.linkedin_data.me.id).toBe(ME_ID_SENTINEL);
	});

	test('review BLOCK-2: member URNs nested in the raw sub-collections are scrubbed too', async () => {
		// The writer stores the FULL LinkedIn API responses for
		// positions/educations/skills, so the member identifier can
		// ride inside URN strings there — bare or percent-encoded.
		FULL_USER_ROW.linkedin_data = {
			...realShapeLinkedInData(),
			positions: {
				elements: [{ title: 'Data Analyst', owner: `urn:li:person:${SUB_SENTINEL}` }],
				paging: {
					links: [
						{
							href: `https://api.linkedin.com/v2/positions?owner=urn%3Ali%3Aperson%3A${SUB_SENTINEL}`,
						},
					],
				},
			},
			skills: { elements: [{ name: 'SQL', owner: `urn:li:person:${ME_ID_SENTINEL}` }] },
		};
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		const serialised = JSON.stringify(res.body);
		expect(serialised).not.toContain(SUB_SENTINEL);
		expect(serialised).not.toContain(ME_ID_SENTINEL);
		expect(serialised).not.toContain('urn:li:person:');
		expect(serialised).not.toContain('urn%3Ali%3Aperson%3A');
		// The surrounding payload survives the scrub.
		expect(res.body.data.user.linkedin_data.positions.elements[0].title).toBe('Data Analyst');
		expect(res.body.data.user.linkedin_data.skills.elements[0].name).toBe('SQL');
	});

	test('non-object linkedin_data passes through untouched', async () => {
		FULL_USER_ROW.linkedin_data = null;
		const res = await request(makeApp())
			.post('/api/compliance/gdpr/export')
			.send({ userId: SUBJECT_ID });
		expect(res.status).toBe(200);
		expect(res.body.data.user.linkedin_data).toBeNull();
	});
});
