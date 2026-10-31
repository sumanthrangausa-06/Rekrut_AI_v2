/**
 * #2034 (corrective for #2032) — POST /gdpr/export biometric section
 * completes Lex's FULL specification (STOP 1 on #2034, comment
 * 6541315686):
 *   1. decryption via decryptWithExistingDEK (never decryptWithDEK —
 *      an export read must never create key material);
 *   2. recordings scoped by erasure's dual branch (interview_events
 *      join OR interview_session_id → interview_sessions.candidate_id);
 *   3. subject's consent_receipts (biometric / observer_capture types)
 *      in the bundle;
 *   4. sanitised diarization_runs (proposed_mapping pseudonymised
 *      entry-by-entry; panel_consent_snapshot NEVER selected) +
 *      diarization_jobs metadata only;
 *   5. observer_capture_outcomes + observer_audio_chunks metadata
 *      (captured_at / byte_size) — never object_key;
 *   6. is_test=true speech rows excluded in SQL, exclusion stated in
 *      the bundle note;
 *   7. biometric-policy §5 wording verbatim (Lex-drafted);
 *   8+11. AuditLogger metadata (biometric included + decrypted count)
 *      AND a biometric_audit_log 'export' entry; no values logged;
 *  10. to_regclass guard around the migration-296 family — absent
 *      family degrades to empty arrays + honest note, never a 500.
 *
 * Harness follows the #2028 unit suite: real route, pool boundary
 * mocked, crypto stubbed here only (real crypto is covered by the
 * real-DB journey suite compliance-gdpr-export-biometric-realdb-2034).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../../../lib/auth', () => ({
	authMiddleware: jest.fn((req, _res, next) => {
		req.user = { id: 7, role: 'candidate' };
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

let mockDecryptMode = 'ok';
const mockMeasurements = { pitch_mean_hz: 182.5, speech_rate_wpm: 141 };
const mockDecryptWithDEK = jest.fn(async () => {
	throw new Error('decryptWithDEK must never be used by the export (#2034 item 1)');
});
const mockDecryptWithExistingDEK = jest.fn(async () => {
	if (mockDecryptMode === 'fail') throw new Error('DEK destroyed (crypto-shredded)');
	return Buffer.from(JSON.stringify(mockMeasurements), 'utf8');
});
jest.mock('../../../lib/biometricCrypto', () => ({
	encryptWithDEK: jest.fn(async () => ({ ciphertext: Buffer.alloc(0), iv: Buffer.alloc(12), tag: Buffer.alloc(16) })),
	decryptWithDEK: (...a) => mockDecryptWithDEK(...a),
	decryptWithExistingDEK: (...a) => mockDecryptWithExistingDEK(...a),
}));

const pool = require('../../../lib/db');
const { packEnvelope } = require('../../../lib/r2FrameStore');
const complianceRoutes = require('../../../routes/compliance');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/compliance', complianceRoutes);
	return app;
}

const USER_ROW = { id: 7, email: 'subject@example.com', role: 'candidate' };
const PROFILE_ROW = { id: 31, user_id: 7, headline: 'Data Analyst' };
const OTHER_ID = 99;

const ENVELOPE = packEnvelope({
	iv: Buffer.alloc(12, 0x11),
	tag: Buffer.alloc(16, 0x22),
	ciphertext: Buffer.from('raw-ciphertext-bytes-never-export', 'utf8'),
});

const SPEECH_META_ROW = {
	id: 501, interview_session_id: 601, candidate_id: 7, method_version: 1,
	state: 'recorded', is_test: false,
	created_at: new Date('2026-10-20T00:00:00Z'), updated_at: new Date('2026-10-20T00:00:00Z'),
};
const RECORDING_ROW = {
	id: 701, interview_event_id: 801, status: 'completed', diarization_status: 'complete',
	diarization_updated_at: new Date('2026-10-21T00:00:00Z'),
	started_at: new Date('2026-10-20T10:00:00Z'), stopped_at: new Date('2026-10-20T10:30:00Z'),
	duration_seconds: 1800, file_format: 'mp4', file_size_bytes: 123456,
	retention_expires_at: new Date('2027-01-18T00:00:00Z'), created_at: new Date('2026-10-20T10:30:00Z'),
};
const TRANSCRIPT_ROW = {
	id: 901, recording_id: 701, speaker_identity: 'Speaker 1', speaker_number: 1,
	text: 'Hello, tell me about yourself.', start_time_ms: 0, end_time_ms: 4000,
	confidence: 0.98, created_at: new Date('2026-10-20T10:31:00Z'),
};
const MAPPING_ROWS = [
	{ id: 1001, recording_id: 701, speaker_number: 1, participant_user_id: 7, participant_role: 'candidate', state: 'confirmed', updated_by: 7, created_at: new Date(), updated_at: new Date() },
	{ id: 1002, recording_id: 701, speaker_number: 2, participant_user_id: OTHER_ID, participant_role: 'interviewer', state: 'confirmed', updated_by: OTHER_ID, created_at: new Date(), updated_at: new Date() },
];
const AUDIT_ROWS = [
	{ id: 1101, recording_id: 701, speaker_number: 2, from_user_id: OTHER_ID, to_user_id: 7, actor_user_id: OTHER_ID, action: 'correct', created_at: new Date() },
];
const LABELLING_CONSENT_ROW = {
	id: 1201, interview_event_id: 801, user_id: 7, decision: 'granted', notice_version: 'v1',
	decided_at: new Date(), ip_address: null, user_agent_hash: 'abc123', created_at: new Date(),
};
const RECEIPT_ROWS = [
	{ id: 1301, interview_session_id: 601, candidate_id: 7, consent_type: 'biometric', consent_text_version: 'v1.3', consent_text_hash: 'h1', granted_at: new Date(), withdrawn_at: null },
	{ id: 1302, interview_session_id: 601, candidate_id: 7, consent_type: 'observer_capture', consent_text_version: 'v1', consent_text_hash: 'h2', granted_at: new Date(), withdrawn_at: null },
];
const RUN_ROW = {
	id: 1401, recording_id: 701, job_id: 1501, engine_package: '@desert-ant-labs/who',
	sdk_version: '4.2.1', model_version: 'v0.3.4', speaker_count: 2,
	turns: [{ speaker: 1, start_ms: 0, end_ms: 4000 }],
	proposed_mapping: {
		1: { participant_user_id: 7, participant_role: 'candidate' },
		2: { participant_user_id: OTHER_ID, participant_role: 'interviewer' },
		3: null,
	},
	coverage_end_ms: 1800000, created_at: new Date(),
	panel_consent_snapshot: { SECRET: 'SNAPSHOT-SENTINEL-2034' },
};
const JOB_ROW = {
	id: 1501, recording_id: 701, status: 'complete', attempt_count: 1,
	created_at: new Date(), updated_at: new Date(), claimed_at: new Date(), last_heartbeat: new Date(),
	worker_id: 'WORKER-SENTINEL-2034', error_message: 'ERR-SENTINEL-2034',
	error_class: 'x', cancel_reason: null, consent_receipt_id: 1301,
	panel_consent_snapshot: { SECRET: 'SNAPSHOT-SENTINEL-2034' },
};
const OUTCOME_ROW = {
	interview_session_id: 601, candidate_id: 7, scope: 'activation', is_test: false,
	cohort_allowlist_version: 1, chunks_persisted: 3, chunks_dropped: 0,
	audio_seconds_captured: '90.0', capture_gap_ratio: '0.01', stop_reason: 'session_end',
	started_at: new Date(), stopped_at: new Date(),
};
const CHUNK_ROWS = [
	{ id: 1601, interview_session_id: 601, candidate_id: 7, chunk_index: 0, object_key: 'OBJECT-KEY-SENTINEL-2034', byte_size: 48000, sample_rate: 48000, captured_at: new Date(), is_test: false },
];

let guardFamily = true;
const seenSql = [];
const seenCalls = [];

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		seenSql.push(sql);
		seenCalls.push({ sql, params });
		const s = sql.toLowerCase();
		if (s.includes('to_regclass')) {
			return { rows: [{ runs: guardFamily, jobs: guardFamily, mappings: guardFamily, audit: guardFamily, labelling: guardFamily, speaker_number: guardFamily }] };
		}
		if (s.includes('from observer_speech_measurements')) {
			if (s.includes('measurements_envelope')) return { rows: [{ id: 501, measurements_envelope: ENVELOPE }] };
			return { rows: [SPEECH_META_ROW] };
		}
		if (s.includes('from interview_recordings')) return { rows: [RECORDING_ROW] };
		if (s.includes('from interview_transcripts')) return { rows: [TRANSCRIPT_ROW] };
		if (s.includes('from recording_speaker_mappings')) return { rows: MAPPING_ROWS };
		if (s.includes('from transcript_speaker_audit')) return { rows: AUDIT_ROWS };
		if (s.includes('from event_labelling_consent')) return { rows: [LABELLING_CONSENT_ROW] };
		if (s.includes('from consent_receipts')) return { rows: RECEIPT_ROWS };
		if (s.includes('from diarization_runs')) return { rows: [RUN_ROW] };
		if (s.includes('from diarization_jobs')) return { rows: [JOB_ROW] };
		if (s.includes('from observer_capture_outcomes')) return { rows: [OUTCOME_ROW] };
		if (s.includes('from observer_audio_chunks')) return { rows: CHUNK_ROWS };
		if (s.includes('from candidate_profiles')) return { rows: [PROFILE_ROW] };
		if (s.includes('from users')) return { rows: [USER_ROW] };
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	mockDecryptMode = 'ok';
	guardFamily = true;
	seenSql.length = 0;
	seenCalls.length = 0;
	installPoolMock();
});

describe('#2034 POST /gdpr/export — biometric corrective', () => {
	test('item 1: decrypts via decryptWithExistingDEK only; decryptWithDEK never called', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		expect(mockDecryptWithExistingDEK).toHaveBeenCalled();
		expect(mockDecryptWithDEK).not.toHaveBeenCalled();
		expect(res.body.data.biometric.speech_measurements[0].measurements).toEqual(mockMeasurements);
	});

	test('item 2: recordings SQL uses erasure dual-branch scope (events join OR session-linked)', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const q = seenCalls.find((c) => /from interview_recordings/i.test(c.sql));
		expect(q).toBeDefined();
		expect(q.sql).toMatch(/interview_events/i);
		expect(q.sql).toMatch(/interview_session_id/i);
		expect(q.sql).toMatch(/interview_sessions/i);
	});

	test('item 3: consent_receipts for biometric/observer types are in the bundle', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const bio = res.body.data.biometric;
		expect(bio.consent_receipts).toHaveLength(2);
		expect(bio.consent_receipts.map((r) => r.consent_type).sort()).toEqual(['biometric', 'observer_capture']);
		const q = seenCalls.find((c) => /from consent_receipts/i.test(c.sql));
		expect(q.sql).toMatch(/candidate_id\s*=\s*\$/);
		expect(q.sql).toMatch(/biometric/);
		expect(q.sql).toMatch(/observer_capture/);
	});

	test('item 4: runs sanitised — proposed_mapping pseudonymised, snapshot never present; jobs metadata only', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const bio = res.body.data.biometric;
		expect(bio.diarization_runs).toHaveLength(1);
		const run = bio.diarization_runs[0];
		expect(run.engine_package).toBe('@desert-ant-labs/who');
		expect(run.speaker_count).toBe(2);
		expect(run.coverage_end_ms).toBe(1800000);
		expect(run.proposed_mapping['1']).toEqual({ participant_user_id: 7, participant_role: 'candidate' });
		expect(run.proposed_mapping['2']).toEqual({ participant_user_id: null, participant_role: 'interviewer' });
		expect(run.proposed_mapping['3']).toBeNull();
		expect(run).not.toHaveProperty('panel_consent_snapshot');
		expect(bio.diarization_jobs).toHaveLength(1);
		const job = bio.diarization_jobs[0];
		expect(job.status).toBe('complete');
		expect(job.attempt_count).toBe(1);
		for (const k of ['worker_id', 'error_message', 'error_class', 'cancel_reason', 'consent_receipt_id', 'panel_consent_snapshot']) {
			expect(job).not.toHaveProperty(k);
		}
		const text = JSON.stringify(res.body);
		expect(text).not.toContain('SNAPSHOT-SENTINEL-2034');
		expect(text).not.toContain('WORKER-SENTINEL-2034');
		expect(text).not.toContain('ERR-SENTINEL-2034');
		for (const q of seenSql) {
			expect(q).not.toMatch(/panel_consent_snapshot/i);
			expect(q).not.toMatch(/storage_path/i);
			expect(q).not.toMatch(/encryption_key_id/i);
		}
	});

	test('item 5: observer outcomes present; chunks carry captured_at/byte_size and never object_key', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const bio = res.body.data.biometric;
		expect(bio.observer_capture_outcomes).toHaveLength(1);
		expect(bio.observer_capture_outcomes[0].chunks_persisted).toBe(3);
		expect(bio.observer_audio_chunks).toHaveLength(1);
		expect(bio.observer_audio_chunks[0].byte_size).toBe(48000);
		expect(bio.observer_audio_chunks[0]).not.toHaveProperty('object_key');
		expect(JSON.stringify(res.body)).not.toContain('OBJECT-KEY-SENTINEL-2034');
		for (const q of seenSql) expect(q).not.toMatch(/object_key/i);
	});

	test('item 6: speech queries exclude is_test rows in SQL and the bundle note states it', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const speechQs = seenCalls.filter((c) => /from observer_speech_measurements/i.test(c.sql));
		expect(speechQs.length).toBeGreaterThanOrEqual(2);
		for (const q of speechQs) expect(q.sql).toMatch(/is_test\s*(=\s*false|is\s+not\s+true)/i);
		expect(res.body.data.biometric.note).toMatch(/test/i);
	});

	test('items 8+11: AuditLogger metadata carries biometric inclusion + decrypted count; biometric_audit_log export entry written; no measurement values in any log call', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const call = mockAuditLog.mock.calls.map((c) => c[0]).find((a) => a && a.actionType === 'gdpr_data_export');
		expect(call).toBeDefined();
		expect(call.metadata.biometric_included).toBe(true);
		expect(call.metadata.biometric_decrypted_rows).toBe(1);
		expect(seenSql.some((q) => /insert into biometric_audit_log/i.test(q))).toBe(true);
		const balCall = seenCalls.find((c) => /insert into biometric_audit_log/i.test(c.sql));
		expect(balCall.params).toContain('export');
		const logged =
			JSON.stringify(mockAuditLog.mock.calls.map((c) => (c[0] ? c[0].metadata : null))) +
			JSON.stringify(balCall.params);
		expect(logged).not.toContain('182.5');
		expect(logged).not.toContain('pitch_mean_hz');
	});

	test('item 10: pre-296 guard — family absent degrades to empty arrays + honest note, export still 200', async () => {
		guardFamily = false;
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const bio = res.body.data.biometric;
		expect(bio.speaker_labels).toEqual([]);
		expect(bio.speaker_mappings).toEqual([]);
		expect(bio.speaker_label_audit).toEqual([]);
		expect(bio.diarization_runs).toEqual([]);
		expect(bio.diarization_jobs).toEqual([]);
		expect(bio.labelling_consents).toEqual([]);
		expect(bio.note).toMatch(/speaker labelling/i);
		// Non-296 sections still export.
		expect(bio.recordings).toHaveLength(1);
		expect(bio.speech_measurements).toHaveLength(1);
		expect(bio.consent_receipts).toHaveLength(2);
	});

	test('decrypt failure still degrades per-row (existing-DEK path)', async () => {
		mockDecryptMode = 'fail';
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const row = res.body.data.biometric.speech_measurements[0];
		expect(row.measurements).toBeNull();
		expect(typeof row.note).toBe('string');
		const call = mockAuditLog.mock.calls.map((c) => c[0]).find((a) => a && a.actionType === 'gdpr_data_export');
		expect(call.metadata.biometric_decrypted_rows).toBe(0);
	});
});

describe('#2034 item 7 — biometric-policy §5 wording (Lex verbatim)', () => {
	test('policy page carries the exact §5 export sentence', () => {
		const tsx = fs.readFileSync(
			path.join(__dirname, '../../../client/src/pages/biometric-policy.tsx'),
			'utf8',
		);
		expect(tsx).toContain(
			'Request a complete copy of your biometric data (data export), including your session recording details, any Observer speech measurements held about you (provided in readable form, not as encrypted data), and the speaker labels and label-correction history for your recordings. Where a record also refers to another participant, that person is identified by role only (for example, "interviewer"), never by name or account ID.',
		);
	});
});
