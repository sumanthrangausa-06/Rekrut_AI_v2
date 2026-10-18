/**
 * #1337: compliance_audit_failed dead-letter markers must be drained
 * (replayed into compliance_audit_trail) before the #813 D-1 sweep
 * deletes ai_screening_audit_logs at candidate erasure — otherwise a
 * failed trail write is permanently lost, unreplayed and unreviewed.
 *
 * Design (STOP 1 on #1337, Nova with Lex consulted): drain inside
 * erasePersonalData's C2 block, immediately before the D-1 child
 * DELETEs, unheld partition only, via the erasure transaction client;
 * replayed payload capped at the original callsites' shared fields and
 * provenance-labelled; any drain failure throws
 * ComplianceAuditDrainError so both (transaction-wrapped) callers roll
 * the whole erasure back — fail-closed, nothing deleted.
 *
 * SQL-routing fake modelled on application-keyed-erasure.test.js.
 * Mocked evidence only here; the real-DB proof is recorded in the PR.
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
const { computeHash } = require('../../../services/auditLogService');

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
		// #1337 knobs
		markers: [],
		screeningDetails: new Map(),
		humanReviewRows: [],
		trailInserts: [],
		trailInsertError: false,
		existingReplayMarkerIds: new Set(),
		...scenario,
	};
	const client = { query: jest.fn(), _s: s };
	client.query.mockImplementation(async (sql, params = []) => {
		// ── compliance_audit_trail (drain target) ──
		if (/compliance_audit_trail/i.test(sql)) {
			if (/INSERT INTO compliance_audit_trail/i.test(sql)) {
				if (s.trailInsertError) {
					const err = new Error('trail unavailable');
					err.code = '57P01';
					throw err;
				}
				s.trailInserts.push({ sql, params });
				s.chainHead = params[9]; // current_hash of the row just written
				return { rows: [{ id: 900 + s.trailInserts.length }], rowCount: 1 };
			}
			if (/dead_letter_marker_id/i.test(sql)) {
				return s.existingReplayMarkerIds.has(String(params[0]))
					? { rows: [{ id: 901 }], rowCount: 1 }
					: { rows: [], rowCount: 0 };
			}
			if (/current_hash/i.test(sql)) {
				return { rows: [{ current_hash: s.chainHead || 'prevhash' }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
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
		if (/FROM screening_questionnaires/i.test(sql)) {
			const row = s.questionnaireJob.get(params[0]);
			return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		if (/FROM jobs/i.test(sql) && /^\s*SELECT/i.test(sql)) {
			if (s.walkErrorJobs.has(params[0])) throw new Error('jobs walk unavailable');
			if (!s.jobCompany.has(params[0])) return { rows: [], rowCount: 0 };
			return { rows: [{ company_id: s.jobCompany.get(params[0]) }], rowCount: 1 };
		}
		// ── #1337 drain queries ──
		if (/FROM ai_screening_audit_logs/i.test(sql) && /^\s*SELECT/i.test(sql)) {
			const ids = Array.isArray(params[0]) ? params[0] : [];
			const rows = s.markers.filter((m) => ids.includes(m.screening_id));
			return { rows, rowCount: rows.length };
		}
		if (/FROM ai_screening_human_reviews/i.test(sql) && /^\s*SELECT/i.test(sql)) {
			const rows = s.humanReviewRows.filter(
				(r) => r.screening_id === params[0] && (params[1] == null || r.reviewer_id === params[1]),
			);
			return { rows, rowCount: rows.length };
		}
		if (/FROM ai_screenings/i.test(sql) && /fit_score/i.test(sql)) {
			const row = s.screeningDetails.get(params[0]);
			return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
		}
		// Five-table SELECTs.
		if (/FROM screening_responses/i.test(sql)) return { rows: s.screeningResponses, rowCount: s.screeningResponses.length };
		if (/FROM job_application_screenings/i.test(sql)) return { rows: s.jobApplicationScreenings, rowCount: s.jobApplicationScreenings.length };
		if (/FROM ai_screenings/i.test(sql)) return { rows: s.aiScreenings, rowCount: s.aiScreenings.length };
		if (/FROM outreach_attempts/i.test(sql)) return { rows: s.outreachAttempts, rowCount: s.outreachAttempts.length };
		if (/FROM auto_apply_profiles/i.test(sql)) return { rows: s.autoApplyRows, rowCount: s.autoApplyRows.length };
		// D-1 explicit child DELETEs.
		if (/DELETE FROM ai_screening_audit_logs/i.test(sql)) return { rows: [], rowCount: s.auditLogCount };
		if (/DELETE FROM ai_screening_human_reviews/i.test(sql)) return { rows: [], rowCount: s.humanReviewCount };
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

const AI_MARKER = {
	id: 41,
	screening_id: 23,
	actor_id: 9,
	metadata: { event_type: 'ai_decision', entity_id: 7, error: '57P01' },
	created_at: '2026-10-01T10:00:00.000Z',
};

const SCREENING_DETAIL = {
	id: 23,
	job_id: 51,
	candidate_id: 7,
	fit_score: 82,
	recommendation: 'interview',
	recommendation_reason: 'strong match',
	matched_skills: ['sql'],
	missing_skills: ['python'],
};

describe('#1337 erasePersonalData — dead-letter drain before D-1 delete', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('(a) ai_decision marker is replayed into the trail (provenance-labelled) before the marker table is deleted', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			auditLogCount: 1,
			markers: [AI_MARKER],
			screeningDetails: new Map([[23, SCREENING_DETAIL]]),
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.complianceAuditMarkersDrained).toBe(1);
		expect(client._s.trailInserts).toHaveLength(1);
		const p = client._s.trailInserts[0].params;
		expect(p[0]).toBe('ai_decision');
		expect(p[1]).toBe('candidate');
		expect(p[2]).toBe(7); // entity_id from the marker
		expect(p[3]).toBe(9); // actor_id from the marker
		expect(p[4]).toBeNull(); // actor_role unrecoverable — never re-read
		expect(p[5]).toBe(51); // job_id reconstructed from ai_screenings
		expect(p[6]).toBeNull(); // company_id unrecoverable — never re-read
		const payload = JSON.parse(p[7]);
		expect(payload.screening_id).toBe(23);
		expect(payload.outputs).toEqual({ fit_score: 82, recommendation: 'interview' });
		expect(payload.replayed_from_dead_letter).toBe(true);
		expect(payload.dead_letter_marker_id).toBe(41);
		expect(payload.original_event_failed_at).toBe('2026-10-01T10:00:00.000Z');
		expect(payload.original_payload_stored).toBe(false);
		expect(payload.fields_missing).toEqual(expect.arrayContaining(['actor_role', 'company_id']));
		// Reviewer note N1: the indeterminate single-vs-batch flag is named.
		expect(payload.fields_missing).toContain('batch');
		// Reviewer note N2: hash chain is genuinely constructed — previous
		// hash is the chain head the fake served, current hash recomputes
		// exactly via auditLogService.computeHash over the inserted
		// values, and created_at is the replay time (never backdated to
		// the marker's failure time).
		expect(p[8]).toBe('prevhash');
		expect(p[9]).toBe(computeHash(p[8], p[0], p[2], p[3], payload, p[10]));
		expect(p[10]).not.toBe('2026-10-01T10:00:00.000Z');
		expect(Date.parse(p[10])).toBeGreaterThan(Date.parse('2026-10-01T10:00:00.000Z'));
		// Drain happens BEFORE the D-1 delete of the marker table.
		const sqls = client.query.mock.calls.map(([s]) => s);
		const insertIdx = sqls.findIndex((s) => /INSERT INTO compliance_audit_trail/i.test(s));
		const deleteIdx = sqls.findIndex((s) => /DELETE FROM ai_screening_audit_logs/i.test(s));
		expect(insertIdx).toBeGreaterThan(-1);
		expect(deleteIdx).toBeGreaterThan(insertIdx);
		expect(result.aiScreeningsDeleted).toBe(true);
	});

	test('(b) human_override marker reconstructs decision + reason from the human review row', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			auditLogCount: 1,
			humanReviewCount: 1,
			markers: [
				{
					id: 42,
					screening_id: 23,
					actor_id: 9,
					metadata: { event_type: 'human_override', entity_id: 7, error: '42P01' },
					created_at: '2026-10-02T10:00:00.000Z',
				},
			],
			screeningDetails: new Map([[23, SCREENING_DETAIL]]),
			humanReviewRows: [
				{ screening_id: 23, reviewer_id: 9, decision: 'interview', reason: 'strong portfolio' },
			],
		});
		const result = await erasureService.erasePersonalData(7, { client });

		expect(result.complianceAuditMarkersDrained).toBe(1);
		const payload = JSON.parse(client._s.trailInserts[0].params[7]);
		expect(client._s.trailInserts[0].params[0]).toBe('human_override');
		expect(payload.override_decision).toBe('interview');
		expect(payload.reason).toBe('strong portfolio');
		expect(payload.replayed_from_dead_letter).toBe(true);
	});

	test('(c) trail write failure at drain aborts the erasure BEFORE any D-1 delete (fail-closed)', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			auditLogCount: 1,
			markers: [AI_MARKER],
			screeningDetails: new Map([[23, SCREENING_DETAIL]]),
			trailInsertError: true,
		});
		await expect(erasureService.erasePersonalData(7, { client })).rejects.toMatchObject({
			name: 'ComplianceAuditDrainError',
		});
		expect(callsMatching(client, /DELETE FROM ai_screening_audit_logs/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM ai_screenings/i)).toHaveLength(0);
	});

	test('(d) no markers: no trail insert, drained count 0, erasure proceeds as before', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			auditLogCount: 2,
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result.complianceAuditMarkersDrained).toBe(0);
		expect(client._s.trailInserts).toHaveLength(0);
		expect(result.aiScreeningsDeleted).toBe(true);
	});

	test('(e) marker on a HELD screening is neither drained nor deleted', async () => {
		const client = makeClient({
			appRows: APPS,
			heldCompanies: new Set([4]), // application 12 held
			aiScreenings: [{ id: 23, application_id: 12, job_id: 52 }],
			markers: [AI_MARKER],
			screeningDetails: new Map([[23, SCREENING_DETAIL]]),
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result.complianceAuditMarkersDrained).toBe(0);
		expect(client._s.trailInserts).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM ai_screening_audit_logs/i)).toHaveLength(0);
		expect(callsMatching(client, /DELETE FROM ai_screenings/i)).toHaveLength(0);
	});

	test('(f) already-replayed marker (dedup hit) is not written twice but still clears', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			auditLogCount: 1,
			markers: [AI_MARKER],
			screeningDetails: new Map([[23, SCREENING_DETAIL]]),
			existingReplayMarkerIds: new Set(['41']),
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result.complianceAuditMarkersDrained).toBe(1);
		expect(client._s.trailInserts).toHaveLength(0);
		expect(result.aiScreeningsDeleted).toBe(true);
	});

	test('(h) two markers drain sequentially: the second replay chains onto the first', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [
				{ id: 23, application_id: 11, job_id: 51 },
				{ id: 24, application_id: 11, job_id: 52 },
			],
			auditLogCount: 2,
			markers: [
				AI_MARKER,
				{
					id: 44,
					screening_id: 24,
					actor_id: 9,
					metadata: { event_type: 'ai_decision', entity_id: 7, error: '57P01' },
					created_at: '2026-10-03T10:00:00.000Z',
				},
			],
			screeningDetails: new Map([
				[23, SCREENING_DETAIL],
				[24, { ...SCREENING_DETAIL, id: 24, job_id: 52, fit_score: 40, recommendation: 'hold' }],
			]),
		});
		const result = await erasureService.erasePersonalData(7, { client });
		expect(result.complianceAuditMarkersDrained).toBe(2);
		expect(client._s.trailInserts).toHaveLength(2);
		const [first, second] = client._s.trailInserts;
		expect(first.params[8]).toBe('prevhash');
		// Marker 2's previous_hash is marker 1's current_hash — the
		// drain re-reads the chain head per marker inside the tx.
		expect(second.params[8]).toBe(first.params[9]);
		expect(JSON.parse(second.params[7]).dead_letter_marker_id).toBe(44);
	});

	test('(g) human_override marker with no surviving review row aborts fail-closed (cannot reconstruct faithfully)', async () => {
		const client = makeClient({
			appRows: APPS,
			aiScreenings: [{ id: 23, application_id: 11, job_id: 51 }],
			markers: [
				{
					id: 43,
					screening_id: 23,
					actor_id: 9,
					metadata: { event_type: 'human_override', entity_id: 7, error: '42P01' },
					created_at: '2026-10-02T10:00:00.000Z',
				},
			],
			screeningDetails: new Map([[23, SCREENING_DETAIL]]),
			humanReviewRows: [],
		});
		await expect(erasureService.erasePersonalData(7, { client })).rejects.toMatchObject({
			name: 'ComplianceAuditDrainError',
		});
		expect(callsMatching(client, /DELETE FROM ai_screening_audit_logs/i)).toHaveLength(0);
	});
});
