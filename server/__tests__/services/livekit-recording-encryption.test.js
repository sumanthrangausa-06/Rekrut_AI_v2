/**
 * GAP-A2 (#1130) — encrypt-at-completion for new LiveKit recordings.
 *
 * RED-first, MOCKED suite (no real DB, no real bucket): lib/db is the
 * repo's mocked pool (server/test/setup.js) extended here with in-memory
 * interview-recording / DEK / registry / ledger stores; the S3 boundary
 * (@aws-sdk/client-s3) is an in-memory fake addressed by the
 * RECORDING_STORAGE_* config. biometricCrypto + services/encryption run
 * REAL, so envelopes and pointer encryption are genuinely exercised.
 *
 * Contract (STOP 1 on #1130, Lead rulings R-1…R-8):
 *  - completeRecordingRecord() is the choke point: a recording may reach
 *    status='completed' ONLY via download → DEK-preflight → encrypt
 *    (new AAD namespace binding candidate + recording id) → upload .enc →
 *    register in recording_objects (candidate_id + 90d expires_at) →
 *    verified plaintext delete → repoint (shared-key pointer format,
 *    .enc key + encryption_key_id marker) → completed.
 *  - Failure (download/encrypt/delete/no-candidate/destroyed-DEK/over-cap)
 *    → bounded retries, then quarantine: non-completed + failed, plaintext
 *    key ledgered into pending_storage_deletions
 *    (source_family='livekit_recording'), plaintext NOT deleted by the
 *    encrypt path in the over-cap case.
 *  - Absent DEK (candidate resolved, no tombstone) mints; destroyed DEK
 *    NEVER re-mints.
 */

jest.mock('@aws-sdk/client-s3', () => {
	const { Readable } = require('node:stream');
	const state = {
		objects: new Map(), // key -> Buffer
		fail: {}, // get|put|delete|head -> true; deleteLeavesObject -> true
		counts: { get: 0, put: 0, delete: 0, head: 0 },
		reset() {
			this.objects.clear();
			this.fail = {};
			this.counts = { get: 0, put: 0, delete: 0, head: 0 };
		},
	};
	class Cmd {
		constructor(input) {
			this.input = input;
		}
	}
	class GetObjectCommand extends Cmd {}
	class PutObjectCommand extends Cmd {}
	class DeleteObjectCommand extends Cmd {}
	class HeadObjectCommand extends Cmd {}
	const notFound = (name) => {
		const e = new Error(name);
		e.name = name;
		e.$metadata = { httpStatusCode: 404 };
		return e;
	};
	class S3Client {
		async send(cmd) {
			const input = cmd.input || {};
			if (cmd instanceof GetObjectCommand) {
				state.counts.get++;
				if (state.fail.get) throw new Error('s3 get boom');
				const buf = state.objects.get(input.Key);
				if (!buf) throw notFound('NoSuchKey');
				return { Body: Readable.from([buf]), ContentLength: buf.length };
			}
			if (cmd instanceof PutObjectCommand) {
				state.counts.put++;
				if (state.fail.put) throw new Error('s3 put boom');
				state.objects.set(input.Key, Buffer.from(input.Body));
				return {};
			}
			if (cmd instanceof DeleteObjectCommand) {
				state.counts.delete++;
				if (state.fail.delete) throw new Error('s3 delete boom');
				if (!state.fail.deleteLeavesObject) state.objects.delete(input.Key);
				return {};
			}
			if (cmd instanceof HeadObjectCommand) {
				state.counts.head++;
				if (state.fail.head) throw new Error('s3 head boom');
				if (!state.objects.has(input.Key)) throw notFound('NotFound');
				return {};
			}
			throw new Error('unknown command');
		}
	}
	return { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, __state: state };
});

process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
process.env.RECORDING_STORAGE_BUCKET = 'test-bucket';
process.env.RECORDING_STORAGE_REGION = 'auto';
process.env.RECORDING_STORAGE_ENDPOINT = 'https://test.r2.local';
process.env.RECORDING_STORAGE_ACCESS_KEY = 'test-access';
process.env.RECORDING_STORAGE_SECRET_KEY = 'test-secret-key';
process.env.ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.BIOMETRIC_ENCRYPTION_KEY =
	'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

const s3 = require('@aws-sdk/client-s3').__state;
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();
const livekitService = require('../../services/livekit');
const sessionRecordingStore = require('../../../lib/sessionRecordingStore');
const biometricCrypto = require('../../../lib/biometricCrypto');
const { MAX_PLAINTEXT_BYTES } = require('../../../lib/r2RecordingStore');

// ─── In-memory stores ─────────────────────────────────────────────────────
const recordings = new Map();
const sessions = new Map();
const events = new Map();
const deks = new Map(); // candidateId -> { dek_encrypted, destroyed_at }
const registry = []; // recording_objects rows
const ledger = []; // pending_storage_deletions rows
let nextId = 1;

const PLAIN_KEY = 'rekrut-recordings/interview-10-123.mp4';
const LOC = `s3://test-bucket/${PLAIN_KEY}`;
const ENC_LOC = `${LOC}.enc`;
const PLAIN = Buffer.from('FAKE-MP4-PLAINTEXT-BYTES');

function seedRecording(overrides = {}) {
	const row = {
		id: nextId++,
		interview_event_id: null,
		interview_session_id: 10,
		room_id: null,
		livekit_egress_id: 'EG_1',
		status: 'recording',
		storage_path: null,
		encryption_key_id: 'default',
		file_size_bytes: null,
		duration_seconds: null,
		retention_expires_at: new Date(Date.now() + 90 * 864e5),
		...overrides,
	};
	recordings.set(row.id, row);
	return row;
}

function routeSql(sql, params = []) {
	const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (n.includes('from candidate_data_keys')) {
		const row = deks.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (n.startsWith('insert into candidate_data_keys')) {
		if (!deks.has(Number(params[0]))) {
			deks.set(Number(params[0]), { dek_encrypted: params[1], destroyed_at: null });
		}
		return { rows: [], rowCount: 1 };
	}
	if (n.includes('from interview_recordings') && n.includes('where id')) {
		const row = recordings.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (n.includes('from interview_sessions') && n.includes('candidate_id')) {
		const s = sessions.get(Number(params[0]));
		return { rows: s ? [{ candidate_id: s.candidate_id }] : [], rowCount: s ? 1 : 0 };
	}
	if (n.includes('from interview_events') && n.includes('candidate_id')) {
		const e = events.get(Number(params[0]));
		return { rows: e ? [{ candidate_id: e.candidate_id }] : [], rowCount: e ? 1 : 0 };
	}
	if (n.startsWith('insert into recording_objects')) {
		if (!registry.some((r) => r.object_key === params[0])) {
			registry.push({ object_key: params[0], candidate_id: params[1], expires_at: params[2] });
		}
		return { rows: [], rowCount: 1 };
	}
	if (n.startsWith('insert into pending_storage_deletions')) {
		ledger.push({ user_id: params[0], file_url: params[1], sql });
		return { rows: [], rowCount: 1 };
	}
	if (n.startsWith('update interview_recordings')) {
		const idParam = [...params].reverse().find((p) => recordings.has(Number(p)));
		const row = recordings.get(Number(idParam));
		if (row) {
			if (n.includes("status = 'completed'")) row.status = 'completed';
			if (n.includes("status = 'failed'")) row.status = 'failed';
			const buf = params.find((p) => Buffer.isBuffer(p));
			if (buf) row.storage_path = buf;
			if (params.includes(sessionRecordingStore.ENCRYPTION_KEY_ID)) {
				row.encryption_key_id = sessionRecordingStore.ENCRYPTION_KEY_ID;
			}
		}
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	return null;
}

db.query.mockImplementation(async (sql, params) => {
	const handled = routeSql(sql, params || []);
	if (handled) return handled;
	return baseQueryImpl(sql, params);
});

beforeEach(() => {
	recordings.clear();
	sessions.clear();
	events.clear();
	deks.clear();
	registry.length = 0;
	ledger.length = 0;
	nextId = 1;
	s3.reset();
	sessions.set(10, { id: 10, candidate_id: 7 });
	events.set(31, { id: 31, candidate_id: 8 });
	s3.objects.set(PLAIN_KEY, Buffer.from(PLAIN));
});

describe('sessionRecordingStore AAD (new namespace, integer-validated)', () => {
	test('binds candidate + recording id in its own namespace', () => {
		expect(sessionRecordingStore.sessionRecordingAAD(7, 3)).toBe(
			'r2sessionrecording:v1:candidate:7:recording:3',
		);
	});
	test('rejects non-integer AAD components', () => {
		expect(() => sessionRecordingStore.sessionRecordingAAD('7;drop', 3)).toThrow();
		expect(() => sessionRecordingStore.sessionRecordingAAD(7, 1.5)).toThrow();
	});
	test('shared MAX cap is the existing decrypt-path cap class (50MB)', () => {
		expect(sessionRecordingStore.MAX_SESSION_RECORDING_BYTES).toBe(MAX_PLAINTEXT_BYTES);
	});
});

describe('completeRecordingRecord — happy paths', () => {
	test('session-flow: completes only via encrypted path; absent DEK mints; plaintext deleted; registry + marker set', async () => {
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(true);
		const row = recordings.get(rec.id);
		expect(row.status).toBe('completed');
		expect(row.encryption_key_id).toBe(sessionRecordingStore.ENCRYPTION_KEY_ID);
		// Pointer keeps the EXISTING shared-key format and points at the .enc
		expect(livekitService.decryptStoragePath(row)).toBe(ENC_LOC);
		// Plaintext gone, envelope present in the egress bucket
		expect(s3.objects.has(PLAIN_KEY)).toBe(false);
		expect(s3.objects.has(`${PLAIN_KEY}.enc`)).toBe(true);
		// Registry: candidate-keyed with ~90d expiry
		expect(registry).toHaveLength(1);
		expect(registry[0].candidate_id).toBe(7);
		expect(registry[0].object_key).toBe(ENC_LOC);
		const expDays = (new Date(registry[0].expires_at).getTime() - Date.now()) / 864e5;
		expect(expDays).toBeGreaterThan(89);
		expect(expDays).toBeLessThan(91);
		// DEK was minted for the candidate (absent → mint, R-1)
		expect(deks.has(7)).toBe(true);
		// And the envelope genuinely decrypts back to the plaintext
		const plain = await livekitService.fetchDecryptedRecording(row);
		expect(plain.equals(PLAIN)).toBe(true);
	});

	test('event-flow: candidate via interview_events.candidate_id; existing DEK reused (no re-mint)', async () => {
		await biometricCrypto.getOrCreateDEK(8);
		const wrappedBefore = deks.get(8).dek_encrypted;
		const rec = seedRecording({ interview_session_id: null, interview_event_id: 31 });

		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 60, PLAIN.length);

		expect(result.completed).toBe(true);
		expect(recordings.get(rec.id).status).toBe('completed');
		expect(deks.get(8).dek_encrypted).toBe(wrappedBefore);
		expect(registry[0].candidate_id).toBe(8);
	});

	test('idempotent re-run: second completion does not orphan a second .enc or fail on missing plaintext', async () => {
		const rec = seedRecording();
		await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);
		const result2 = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result2.completed).toBe(true);
		expect(recordings.get(rec.id).status).toBe('completed');
		expect(registry).toHaveLength(1);
		expect([...s3.objects.keys()].filter((k) => k.endsWith('.enc'))).toHaveLength(1);
	});
});

describe('completeRecordingRecord — fail-closed quarantine', () => {
	test('no resolvable candidate → escalate: non-completed, failed, ledgered, plaintext kept, no .enc', async () => {
		sessions.set(10, { id: 10, candidate_id: null });
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		expect(recordings.get(rec.id).status).toBe('failed');
		expect(s3.objects.has(PLAIN_KEY)).toBe(true);
		expect([...s3.objects.keys()].some((k) => k.endsWith('.enc'))).toBe(false);
		expect(ledger).toHaveLength(1);
		expect(ledger[0].file_url).toBe(LOC);
		expect(ledger[0].sql).toMatch(/livekit_recording/);
	});

	test('destroyed DEK → escalate with ZERO re-mint: non-completed, ledgered, DEK row untouched', async () => {
		await biometricCrypto.getOrCreateDEK(7);
		deks.get(7).destroyed_at = new Date();
		deks.get(7).dek_encrypted = Buffer.alloc(0);
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		expect(recordings.get(rec.id).status).toBe('failed');
		expect(deks.get(7).dek_encrypted).toEqual(Buffer.alloc(0));
		expect(deks.get(7).destroyed_at).toBeTruthy();
		expect(ledger).toHaveLength(1);
		expect(s3.objects.has(PLAIN_KEY)).toBe(true);
	});

	test('download failure → bounded retries, then non-completed + ledgered + unplayable', async () => {
		s3.fail.get = true;
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		expect(s3.counts.get).toBeGreaterThanOrEqual(2); // retried
		expect(s3.counts.get).toBeLessThanOrEqual(5); // bounded
		expect(recordings.get(rec.id).status).toBe('failed');
		expect(ledger).toHaveLength(1);
	});

	test('plaintext delete failure → non-completed (never completed while plaintext survives), ledgered', async () => {
		s3.fail.deleteLeavesObject = true;
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		expect(recordings.get(rec.id).status).toBe('failed');
		expect(recordings.get(rec.id).storage_path == null || !String(recordings.get(rec.id).storage_path).includes('.enc')).toBe(true);
		expect(ledger).toHaveLength(1);
	});

	test('over-cap (egress-reported size) → quarantine BEFORE download; plaintext NOT deleted by encrypt path', async () => {
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(
			rec.id, LOC, 120, MAX_PLAINTEXT_BYTES + 1,
		);

		expect(result.completed).toBe(false);
		expect(s3.counts.get).toBe(0);
		expect(recordings.get(rec.id).status).toBe('failed');
		expect(s3.objects.has(PLAIN_KEY)).toBe(true);
		expect(ledger).toHaveLength(1);
	});

	test('unknown size → counting stream aborts over the cap; quarantine, plaintext kept', async () => {
		s3.objects.set(PLAIN_KEY, Buffer.alloc(MAX_PLAINTEXT_BYTES + 1, 1));
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, null);

		expect(result.completed).toBe(false);
		expect(recordings.get(rec.id).status).toBe('failed');
		expect(s3.objects.has(PLAIN_KEY)).toBe(true);
		expect(ledger).toHaveLength(1);
	});
});

describe('fetchDecryptedRecording (playback/transcription decrypt)', () => {
	test('destroyed DEK after completion → decrypt throws (never mint-on-read)', async () => {
		const rec = seedRecording();
		await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);
		deks.get(7).destroyed_at = new Date();
		deks.get(7).dek_encrypted = Buffer.alloc(0);

		await expect(livekitService.fetchDecryptedRecording(recordings.get(rec.id))).rejects.toThrow();
		// No new DEK material was created by the read
		expect(deks.get(7).dek_encrypted).toEqual(Buffer.alloc(0));
	});
});
