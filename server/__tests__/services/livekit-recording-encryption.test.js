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
const sharedEncryption = require('../../../services/encryption');
const { MAX_PLAINTEXT_BYTES } = require('../../../lib/r2RecordingStore');

// ─── In-memory stores ─────────────────────────────────────────────────────
const recordings = new Map();
const sessions = new Map();
const events = new Map();
const deks = new Map(); // candidateId -> { dek_encrypted, destroyed_at }
const registry = []; // recording_objects rows
const ledger = []; // pending_storage_deletions rows
let nextId = 1;

// Gate-fix-round concurrency hooks (C1): fired inside the mock DB at the
// exact statement where a concurrent erasure could land, so the atomic
// guards in the statements themselves are what the tests exercise.
const hooks = { beforeRepoint: null, onRegister: null };

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
	if (n.startsWith('select') && n.includes('from candidate_data_keys')) {
		// SELECT-only: the repoint UPDATE also names candidate_data_keys
		// (its NOT EXISTS guard) and must fall through to the UPDATE branch.
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
		if (hooks.onRegister) hooks.onRegister();
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
		// C1 atomic guards, evaluated at statement time like a real DB:
		// the repoint concurrency hook fires first (a concurrent erasure
		// landing between the destroyed re-check and the repoint).
		if (row && n.includes("status = 'completed'") && n.includes('encryption_key_id') && hooks.beforeRepoint) {
			hooks.beforeRepoint();
		}
		if (row && n.includes("status not in ('deleted','completed')") && ['deleted', 'completed'].includes(row.status)) {
			return { rows: [], rowCount: 0 };
		}
		if (row && n.includes('not exists') && n.includes('candidate_data_keys')) {
			const dek = deks.get(Number(params[params.length - 1]));
			if (dek?.destroyed_at) return { rows: [], rowCount: 0 };
		}
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
	hooks.beforeRepoint = null;
	hooks.onRegister = null;
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

	test('re-run after a PARTIAL attempt resumes (no orphan second .enc); re-run after completion hits the already-completed short-circuit', async () => {
		// Partial attempt: delete-verify fails once → quarantined/failed,
		// then the retry resumes on the same deterministic .enc.
		s3.fail.deleteLeavesObject = true;
		const rec = seedRecording();
		const partial = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);
		expect(partial.completed).toBe(false);
		s3.fail.deleteLeavesObject = false;
		const resumed = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);
		expect(resumed.completed).toBe(true);
		expect(recordings.get(rec.id).status).toBe('completed');
		expect(registry).toHaveLength(1);
		expect([...s3.objects.keys()].filter((k) => k.endsWith('.enc'))).toHaveLength(1);

		// Hazard fix (#1130): a completed + DEK-marked row re-invoked
		// hits the entry short-circuit and returns the already-completed
		// result having touched NOTHING — no ledger insert (the pre-fix
		// path escalated via the C1 repoint guard into quarantine and
		// ledgered the LIVE .enc for Phase-2 deletion), no storage call,
		// no row mutation.
		const rowBefore = recordings.get(rec.id);
		const snapshot = {
			...rowBefore,
			storage_path: rowBefore.storage_path
				? Buffer.from(rowBefore.storage_path)
				: rowBefore.storage_path,
		};
		const ledgerBefore = ledger.length;
		const countsBefore = { ...s3.counts };
		const result2 = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);
		expect(result2.completed).toBe(true);
		expect(ledger).toHaveLength(ledgerBefore);
		expect(s3.counts).toEqual(countsBefore);
		expect(recordings.get(rec.id)).toEqual(snapshot);
		expect(recordings.get(rec.id).status).toBe('completed');
		expect(registry).toHaveLength(1);
		expect([...s3.objects.keys()].filter((k) => k.endsWith('.enc'))).toHaveLength(1);
	});

	test('already-completed row marked ONLY by its .enc pointer → short-circuit: success, zero ledger inserts, zero storage calls, row byte-identical', async () => {
		const rec = seedRecording({
			status: 'completed',
			encryption_key_id: 'default',
			storage_path: sharedEncryption.encrypt(Buffer.from(ENC_LOC)),
			duration_seconds: 120,
			file_size_bytes: PLAIN.length,
		});
		const rowBefore = recordings.get(rec.id);
		const snapshot = {
			...rowBefore,
			storage_path: Buffer.from(rowBefore.storage_path),
		};
		const countsBefore = { ...s3.counts };

		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result).toEqual({ completed: true });
		expect(ledger).toHaveLength(0);
		expect(registry).toHaveLength(0);
		expect(s3.counts).toEqual(countsBefore);
		expect(recordings.get(rec.id)).toEqual(snapshot);
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
		// G1: BOTH objects are ledgered — the surviving plaintext AND the
		// uploaded .enc (the .enc row is inserted independent of the
		// plaintext-ledger skip).
		expect(ledger).toHaveLength(2);
		expect(ledger.map((l) => l.file_url).sort()).toEqual([ENC_LOC, LOC].sort());
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

describe('gate fix round — C1 atomic guards / G1 .enc ledger / G2 pointer / N3', () => {
	test('C1: row concurrently set deleted at repoint → 0-row guard → quarantine, NOT completed:true; fail-marking cannot flip it either', async () => {
		const rec = seedRecording();
		hooks.beforeRepoint = () => {
			recordings.get(rec.id).status = 'deleted';
		};
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		expect(result.quarantined).toBe(true);
		// The concurrent 'deleted' state is terminal — neither the repoint
		// nor the quarantine fail-marking may move it.
		expect(recordings.get(rec.id).status).toBe('deleted');
		// G1/N3: plaintext was verified-deleted (no plaintext ledger row),
		// but the uploaded .enc IS ledgered for the Phase-2 drain.
		expect(ledger).toHaveLength(1);
		expect(ledger[0].file_url).toBe(ENC_LOC);
		expect(ledger[0].user_id).toBe(7);
	});

	test('C1: DEK destroyed at repoint → NOT EXISTS guard → 0 rows → quarantine, NOT completed:true', async () => {
		await biometricCrypto.getOrCreateDEK(7);
		const rec = seedRecording();
		hooks.beforeRepoint = () => {
			deks.get(7).destroyed_at = new Date();
		};
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		expect(result.quarantined).toBe(true);
		expect(recordings.get(rec.id).status).toBe('failed');
		expect(ledger.map((l) => l.file_url)).toEqual([ENC_LOC]);
	});

	test('C1: failRecordingRecord cannot flip a deleted or completed row (terminal guard), still fails a live row', async () => {
		const deleted = seedRecording({ status: 'deleted' });
		const completed = seedRecording({ status: 'completed' });
		const live = seedRecording({ status: 'recording' });

		await livekitService.failRecordingRecord(deleted.id, 'x');
		await livekitService.failRecordingRecord(completed.id, 'x');
		await livekitService.failRecordingRecord(live.id, 'x');

		expect(recordings.get(deleted.id).status).toBe('deleted');
		expect(recordings.get(completed.id).status).toBe('completed');
		expect(recordings.get(live.id).status).toBe('failed');
	});

	test('G1+G2+N3: DEK destroyed after verified delete (deviation-1 branch) → .enc ledgered, plaintext NOT re-ledgered, failed row carries the plaintext pointer', async () => {
		await biometricCrypto.getOrCreateDEK(7);
		const rec = seedRecording();
		hooks.onRegister = () => {
			deks.get(7).destroyed_at = new Date();
		};
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		const row = recordings.get(rec.id);
		expect(row.status).toBe('failed');
		// Plaintext really is gone (verified delete happened)…
		expect(s3.objects.has(PLAIN_KEY)).toBe(false);
		// …so NO plaintext ledger row (N3), but the .enc IS ledgered (G1).
		expect(ledger).toHaveLength(1);
		expect(ledger[0].file_url).toBe(ENC_LOC);
		expect(ledger[0].user_id).toBe(7);
		// G2: the failed row carries the shared-key-encrypted PLAIN
		// pointer, so GAP-A enumeration reaches it by construction.
		expect(livekitService.decryptStoragePath(row)).toBe(LOC);
	});

	test('G2: delete-verify-failure quarantine → failed row carries the plaintext pointer', async () => {
		s3.fail.deleteLeavesObject = true;
		const rec = seedRecording();
		const result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);

		expect(result.completed).toBe(false);
		const row = recordings.get(rec.id);
		expect(row.status).toBe('failed');
		expect(livekitService.decryptStoragePath(row)).toBe(LOC);
	});
});

describe('privacy delta re-gate — cross-attempt flag accumulation (#1130)', () => {
	test('attempt 1 uploads .enc then fails retryably on delete-verify; attempts 2-3 fail pre-upload on download → quarantine ledgers BOTH plaintext and .enc, uploads == 1', async () => {
		const rec = seedRecording();
		const origDownload = sessionRecordingStore.downloadRecordingObject;
		const origDeleteVerified = sessionRecordingStore.deleteRecordingObjectVerified;
		let downloadCalls = 0;
		sessionRecordingStore.downloadRecordingObject = async (...args) => {
			downloadCalls++;
			if (downloadCalls > 1) {
				const e = new Error('transient download boom');
				e.code = 'DOWNLOAD_TRANSIENT';
				throw e;
			}
			return origDownload(...args);
		};
		sessionRecordingStore.deleteRecordingObjectVerified = async () => {
			const e = new Error('object still exists after delete');
			e.code = 'DELETE_VERIFY_FAILED';
			throw e;
		};
		let result;
		try {
			result = await livekitService.completeRecordingRecord(rec.id, LOC, 120, PLAIN.length);
		} finally {
			sessionRecordingStore.downloadRecordingObject = origDownload;
			sessionRecordingStore.deleteRecordingObjectVerified = origDeleteVerified;
		}

		expect(result.completed).toBe(false);
		expect(result.quarantined).toBe(true);
		// Exactly one .enc upload happened (attempt 1 only).
		expect(s3.counts.put).toBe(1);
		expect(downloadCalls).toBe(3);
		// The quarantining (final) attempt carries encUploaded=false on its
		// own — the invocation-scoped monotonic accumulator must still
		// ledger the .enc uploaded by attempt 1, alongside the plaintext
		// (which was never deleted).
		expect(ledger).toHaveLength(2);
		expect(ledger.map((l) => l.file_url).sort()).toEqual([ENC_LOC, LOC].sort());
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
