/**
 * #2028 item 4 — POST /gdpr/export gains a `biometric` section so the
 * biometric-policy §5 promise ("a complete copy of your biometric
 * data") is honoured by the product (STOP 1 on #2028, panel: Lex +
 * privacy + Rex; comment 6540273741).
 *
 * Scope pinned by the STOP 1:
 *   biometric: {
 *     speech_measurements: [ meta rows + decrypted `measurements`
 *                            (envelope bytes NEVER in the bundle;
 *                            per-row measurements:null + note when
 *                            decryption is impossible) ],
 *     recordings:          [ recording METADATA only — never
 *                            storage_path, never encryption_key_id ],
 *     speaker_labels:      [ interview_transcripts rows for those
 *                            recordings ],
 *     speaker_mappings:    [ rows with participant_user_id /
 *                            updated_by kept ONLY when === subject,
 *                            else null; participant_role kept ],
 *     speaker_label_audit: [ audit rows involving the subject;
 *                            from/to/actor IDs nulled unless subject ],
 *     labelling_consents:  [ event_labelling_consent rows ],
 *     note:                annotation (scale_note pattern),
 *   }
 * diarization_jobs / diarization_runs / diarization_metrics_daily are
 * system records of processing (panel ruling) and are NEVER read.
 *
 * #2034 SUPERSESSION (STOP 1 on #2034, comment 6541315686): Lex's
 * FULL specification — which arrived after #2032 merged — includes
 * sanitised diarization_runs and diarization_jobs metadata in the
 * bundle, plus consent_receipts and observer siblings, existing-DEK
 * decryption, and a migration-296 guard. The assertions below that
 * pinned the old exclusion (exact key list, no-diarization-tables
 * SQL hygiene, decryptWithDEK stub) are updated to the #2034 shape;
 * diarization_metrics_daily remains never read.
 *
 * Harness follows the #1533 suite: the REAL route runs; only the pool
 * boundary is mocked. biometricCrypto.decryptWithDEK is stubbed HERE
 * ONLY (the real crypto path is covered by the fresh-install real-DB
 * journey suite compliance-gdpr-export-biometric-realdb-2028); the
 * envelope itself is built with the REAL packEnvelope so the
 * envelope-absence assertions run over real envelope bytes.
 */
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

// Stubbed crypto for THIS unit suite only (see header). decryptMode
// flips between 'ok' and 'fail' per scenario.
let mockDecryptMode = 'ok';
const mockMeasurements = { pitch_mean_hz: 182.5, speech_rate_wpm: 141, filler_word_rate: 2.4 };
jest.mock('../../../lib/biometricCrypto', () => ({
	encryptWithDEK: jest.fn(async () => ({ ciphertext: Buffer.alloc(0), iv: Buffer.alloc(12), tag: Buffer.alloc(16) })),
	decryptWithDEK: jest.fn(async () => {
		if (mockDecryptMode === 'fail') throw new Error('DEK destroyed (crypto-shredded)');
		return Buffer.from(JSON.stringify(mockMeasurements), 'utf8');
	}),
	// #2034 item 1: the export decrypts via the existing-DEK primitive.
	decryptWithExistingDEK: jest.fn(async () => {
		if (mockDecryptMode === 'fail') throw new Error('DEK destroyed (crypto-shredded)');
		return Buffer.from(JSON.stringify(mockMeasurements), 'utf8');
	}),
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
	id: 501,
	interview_session_id: 601,
	candidate_id: 7,
	method_version: 1,
	state: 'recorded',
	is_test: false,
	created_at: new Date('2026-10-20T00:00:00Z'),
	updated_at: new Date('2026-10-20T00:00:00Z'),
};
const RECORDING_ROW = {
	id: 701,
	interview_event_id: 801,
	status: 'completed',
	diarization_status: 'complete',
	diarization_updated_at: new Date('2026-10-21T00:00:00Z'),
	started_at: new Date('2026-10-20T10:00:00Z'),
	stopped_at: new Date('2026-10-20T10:30:00Z'),
	duration_seconds: 1800,
	file_format: 'mp4',
	file_size_bytes: 123456,
	retention_expires_at: new Date('2027-01-18T00:00:00Z'),
	created_at: new Date('2026-10-20T10:30:00Z'),
};
const TRANSCRIPT_ROW = {
	id: 901,
	recording_id: 701,
	speaker_identity: 'Speaker 1',
	speaker_number: 1,
	text: 'Hello, tell me about yourself.',
	start_time_ms: 0,
	end_time_ms: 4000,
	confidence: 0.98,
	created_at: new Date('2026-10-20T10:31:00Z'),
};
const MAPPING_ROWS = [
	{
		id: 1001,
		recording_id: 701,
		speaker_number: 1,
		participant_user_id: 7,
		participant_role: 'candidate',
		state: 'confirmed',
		updated_by: 7,
		created_at: new Date('2026-10-21T00:00:00Z'),
		updated_at: new Date('2026-10-21T00:00:00Z'),
	},
	{
		id: 1002,
		recording_id: 701,
		speaker_number: 2,
		participant_user_id: OTHER_ID,
		participant_role: 'interviewer',
		state: 'confirmed',
		updated_by: OTHER_ID,
		created_at: new Date('2026-10-21T00:00:00Z'),
		updated_at: new Date('2026-10-21T00:00:00Z'),
	},
];
const AUDIT_ROWS = [
	{
		id: 1101,
		recording_id: 701,
		speaker_number: 2,
		from_user_id: OTHER_ID,
		to_user_id: 7,
		actor_user_id: OTHER_ID,
		action: 'correct',
		created_at: new Date('2026-10-21T00:00:00Z'),
	},
];
const LABELLING_CONSENT_ROW = {
	id: 1201,
	interview_event_id: 801,
	user_id: 7,
	decision: 'granted',
	notice_version: 'v1',
	decided_at: new Date('2026-10-20T09:59:00Z'),
	ip_address: null,
	user_agent_hash: 'abc123',
	created_at: new Date('2026-10-20T09:59:00Z'),
};

// scenario: 'populated' | 'empty'
let scenario = 'populated';
const seenSql = [];
const seenCalls = [];

function installPoolMock() {
	pool.query.mockImplementation(async (sql, params) => {
		seenSql.push(sql);
		seenCalls.push({ sql, params });
		const s = sql.toLowerCase();
		const pop = scenario === 'populated';
		if (s.includes('from observer_speech_measurements')) {
			if (s.includes('measurements_envelope')) {
				return { rows: pop ? [{ id: 501, measurements_envelope: ENVELOPE }] : [] };
			}
			return { rows: pop ? [SPEECH_META_ROW] : [] };
		}
		if (s.includes('from interview_recordings')) return { rows: pop ? [RECORDING_ROW] : [] };
		if (s.includes('from interview_transcripts')) return { rows: pop ? [TRANSCRIPT_ROW] : [] };
		if (s.includes('from recording_speaker_mappings')) return { rows: pop ? MAPPING_ROWS : [] };
		if (s.includes('from transcript_speaker_audit')) return { rows: pop ? AUDIT_ROWS : [] };
		if (s.includes('from event_labelling_consent')) return { rows: pop ? [LABELLING_CONSENT_ROW] : [] };
		if (s.includes('from candidate_profiles')) return { rows: [PROFILE_ROW] };
		if (s.includes('from users')) return { rows: [USER_ROW] };
		return { rows: [] };
	});
}

beforeEach(() => {
	jest.clearAllMocks();
	scenario = 'populated';
	mockDecryptMode = 'ok';
	seenSql.length = 0;
	seenCalls.length = 0;
	installPoolMock();
});

describe('#2028 item 4 POST /gdpr/export — biometric section', () => {
	test('bundle contains a biometric section with the pinned shape and note', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const bio = res.body.data.biometric;
		expect(bio).toBeDefined();
		expect(Object.keys(bio).sort()).toEqual([
			'consent_receipts',
			'diarization_jobs',
			'diarization_runs',
			'labelling_consents',
			'note',
			'observer_audio_chunks',
			'observer_capture_outcomes',
			'recordings',
			'speaker_label_audit',
			'speaker_labels',
			'speaker_mappings',
			'speech_measurements',
		]);
		expect(typeof bio.note).toBe('string');
		expect(bio.note.length).toBeGreaterThan(0);
		expect(bio.recordings).toEqual(JSON.parse(JSON.stringify([RECORDING_ROW])));
		expect(bio.speaker_labels).toEqual(JSON.parse(JSON.stringify([TRANSCRIPT_ROW])));
		expect(bio.labelling_consents).toEqual(JSON.parse(JSON.stringify([LABELLING_CONSENT_ROW])));
	});

	test('decrypted measurements are present when decryption succeeds', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const row = res.body.data.biometric.speech_measurements[0];
		expect(row.id).toBe(501);
		expect(row.candidate_id).toBe(7);
		expect(row.measurements).toEqual(mockMeasurements);
		expect(row.measurements_envelope).toBeUndefined();
	});

	test('envelope bytes appear NOWHERE in the JSON response', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const text = JSON.stringify(res.body);
		expect(text).not.toContain(ENVELOPE.toString('base64'));
		expect(text).not.toContain(Buffer.from('raw-ciphertext-bytes-never-export').toString('base64'));
		expect(text).not.toContain('measurements_envelope');
	});

	test('decrypt failure → measurements null + per-row note, export still 200', async () => {
		mockDecryptMode = 'fail';
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const row = res.body.data.biometric.speech_measurements[0];
		expect(row.id).toBe(501);
		expect(row.measurements).toBeNull();
		expect(typeof row.note).toBe('string');
		expect(row.note.length).toBeGreaterThan(0);
	});

	test("another participant's mapping exports with participant_user_id null and role kept", async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const [own, other] = res.body.data.biometric.speaker_mappings;
		expect(own.participant_user_id).toBe(7);
		expect(own.updated_by).toBe(7);
		expect(other.participant_user_id).toBeNull();
		expect(other.updated_by).toBeNull();
		expect(other.participant_role).toBe('interviewer');
	});

	test('audit rows: third-party from/actor IDs nulled, subject to_user_id kept', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const row = res.body.data.biometric.speaker_label_audit[0];
		expect(row.from_user_id).toBeNull();
		expect(row.actor_user_id).toBeNull();
		expect(row.to_user_id).toBe(7);
		expect(row.action).toBe('correct');
	});

	test('empty state: section present with all arrays empty', async () => {
		scenario = 'empty';
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		const bio = res.body.data.biometric;
		expect(bio.speech_measurements).toEqual([]);
		expect(bio.recordings).toEqual([]);
		expect(bio.speaker_labels).toEqual([]);
		expect(bio.speaker_mappings).toEqual([]);
		expect(bio.speaker_label_audit).toEqual([]);
		expect(bio.labelling_consents).toEqual([]);
		expect(typeof bio.note).toBe('string');
	});

	test('SQL hygiene: no storage_path / encryption_key_id selected, diarization_metrics_daily never read (#2034: runs/jobs read sanitised — snapshot and object_key never selected), metadata query never selects the envelope', async () => {
		const res = await request(makeApp()).post('/api/compliance/gdpr/export').send({ userId: 7 });
		expect(res.status).toBe(200);
		for (const q of seenSql) {
			expect(q).not.toMatch(/storage_path/i);
			expect(q).not.toMatch(/encryption_key_id/i);
			expect(q).not.toMatch(/diarization_metrics_daily/i);
			expect(q).not.toMatch(/panel_consent_snapshot/i);
			expect(q).not.toMatch(/object_key/i);
		}
		const metaQuery = seenCalls.find(
			(c) => /from observer_speech_measurements/i.test(c.sql) && !/measurements_envelope/i.test(c.sql),
		);
		expect(metaQuery).toBeDefined();
		expect(metaQuery.params).toEqual([7]);
		const recordingsQuery = seenCalls.find((c) => /from interview_recordings/i.test(c.sql));
		expect(recordingsQuery).toBeDefined();
		expect(recordingsQuery.sql).toMatch(/interview_events/i);
		expect(recordingsQuery.sql).toMatch(/candidate_id\s*=\s*\$\d/i);
	});
});
