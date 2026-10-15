/**
 * GAP-A3 (#1131) — plaintext LiveKit recording migration TOOLING.
 *
 * RED-first, LOCAL FIXTURES ONLY (boundary: never a real bucket/DB):
 * lib/db is the repo's mocked pool (server/test/setup.js) extended here
 * with in-memory stores for every table the tool touches; the S3
 * boundary (@aws-sdk/client-s3) is an in-memory fake addressed by the
 * RECORDING_STORAGE_* config — the same pattern as #1130's suite.
 * biometricCrypto + services/encryption + sessionRecordingStore run
 * REAL, so envelopes and pointer encryption are genuinely exercised.
 * The tool receives the mocked pool + (optionally wrapped) storage as
 * injectable adapters, so dry-run and live share one code path here.
 */

jest.mock('@aws-sdk/client-s3', () => {
	const { Readable } = require('node:stream');
	const state = {
		objects: new Map(),
		fail: {},
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
const tool = require('../../../scripts/gap-a3-plaintext-recording-migration');
const livekitService = require('../../services/livekit');
const sessionRecordingStore = require('../../../lib/sessionRecordingStore');
const biometricCrypto = require('../../../lib/biometricCrypto');
const sharedEncryption = require('../../../services/encryption');

// ─── In-memory stores ─────────────────────────────────────────────────────
const recordings = new Map();
const sessions = new Map(); // id -> {id, candidate_id, company_id}
const events = new Map(); // id -> {id, candidate_id, job_application_id}
const applications = new Map(); // id -> {id, company_id}
const deks = new Map(); // candidateId -> {dek_encrypted, destroyed_at}
const registry = []; // recording_objects rows
const ledger = []; // pending_storage_deletions rows
const holds = []; // legal_holds rows {id, user_id, company_id, released_at}
const usersCompany = new Map();
const writeLog = []; // every non-SELECT statement (dry-run zero-writes proof)
let nextLedgerId = 1;
const lockState = { available: true, attempts: 0 };
const failHoldUids = new Set();
const failLedgerFor = new Set(); // file_url values whose ledger INSERT throws
const hooks = { onRegistryInsert: null, onLedgerInsert: null };

function buffersEqual(a, b) {
	if (a == null || b == null) return a == null && b == null;
	return Buffer.from(a).equals(Buffer.from(b));
}

function routeSql(sql, params = []) {
	const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();

	if (n.includes('pg_try_advisory_lock')) {
		lockState.attempts++;
		return { rows: [{ locked: lockState.available, pg_try_advisory_lock: lockState.available }], rowCount: 1 };
	}
	if (n.includes('pg_advisory_unlock')) {
		return { rows: [{ locked: true, pg_advisory_unlock: true }], rowCount: 1 };
	}

	// interview_recordings — side-count scans
	if (n.includes('count(') && n.includes('from interview_recordings')) {
		let c = 0;
		for (const r of recordings.values()) {
			if (n.includes("status = 'deleted'")) {
				if (r.status === 'deleted' && r.storage_path != null) c++;
			} else if (n.includes("'pending'")) {
				if (['pending', 'recording', 'processing'].includes(r.status) && r.storage_path != null) c++;
			} else if (n.includes('storage_path is null')) {
				if (r.storage_path == null) c++;
			}
		}
		return { rows: [{ count: c }], rowCount: 1 };
	}
	// enumeration: ids only
	if (n.startsWith('select id from interview_recordings')) {
		const rows = [...recordings.values()]
			.filter((r) => r.storage_path != null && ['completed', 'failed'].includes(r.status))
			.sort((a, b) => a.id - b.id)
			.map((r) => ({ id: r.id }));
		return { rows, rowCount: rows.length };
	}
	// fresh re-read by id
	if (n.startsWith('select * from interview_recordings where id')) {
		const row = recordings.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	// recovery join scan: all recordings
	if (n.startsWith('select * from interview_recordings')) {
		const rows = [...recordings.values()].map((r) => ({ ...r }));
		return { rows, rowCount: rows.length };
	}
	// CAS repoint
	if (n.startsWith('update interview_recordings')) {
		const [encPointer, id, oldPointer, candidateId] = params;
		const row = recordings.get(Number(id));
		const dek = deks.get(Number(candidateId));
		const ok =
			row &&
			['completed', 'failed'].includes(row.status) &&
			buffersEqual(row.storage_path, oldPointer) &&
			row.encryption_key_id !== 'candidate-dek:v1' &&
			!(dek && dek.destroyed_at != null);
		if (!ok) return { rows: [], rowCount: 0 };
		row.storage_path = Buffer.from(encPointer);
		row.encryption_key_id = 'candidate-dek:v1';
		return { rows: [{ ...row }], rowCount: 1 };
	}

	// legal holds — faithful findActiveHold semantics (D-1 precision).
	// Routed BEFORE the interview_sessions patterns: the session-less
	// hold SQL itself contains an interview_sessions subquery.
	if (n.includes('from legal_holds')) {
		const [uid, explicitCid, sessionCid] = params;
		if (failHoldUids.has(Number(uid))) throw new Error('hold lookup boom');
		const anySessionBranch = n.includes('where candidate_id = $1');
		const userCompany = uid != null ? usersCompany.get(Number(uid)) ?? null : null;
		const candidateCompanies = new Set(
			[...sessions.values()]
				.filter((s) => s.candidate_id === Number(uid) && s.company_id != null)
				.map((s) => s.company_id),
		);
		const match = holds
			.filter((h) => h.released_at == null)
			.find(
				(h) =>
					(h.user_id != null && h.user_id === Number(uid)) ||
					(h.company_id != null && explicitCid != null && h.company_id === Number(explicitCid)) ||
					(h.company_id != null && sessionCid != null && h.company_id === Number(sessionCid)) ||
					(h.company_id != null && userCompany != null && h.company_id === userCompany) ||
					(anySessionBranch && h.company_id != null && candidateCompanies.has(h.company_id)),
			);
		return { rows: match ? [{ id: match.id, user_id: match.user_id, company_id: match.company_id }] : [], rowCount: match ? 1 : 0 };
	}

	// interview_sessions (findActiveHold resolution / existence / attribution)
	if (n.includes('from interview_sessions') && n.includes('candidate_id') && n.includes('company_id')) {
		const s = sessions.get(Number(params[0]));
		return {
			rows: s ? [{ candidate_id: s.candidate_id, company_id: s.company_id }] : [],
			rowCount: s ? 1 : 0,
		};
	}
	if (n.startsWith('select id from interview_sessions')) {
		const s = sessions.get(Number(params[0]));
		return { rows: s ? [{ id: s.id }] : [], rowCount: s ? 1 : 0 };
	}
	if (n.includes('from interview_sessions') && n.includes('candidate_id')) {
		const s = sessions.get(Number(params[0]));
		return { rows: s ? [{ candidate_id: s.candidate_id }] : [], rowCount: s ? 1 : 0 };
	}

	// company derivation: interview_events -> job_applications.company_id
	if (n.includes('job_applications') && n.includes('interview_events')) {
		const ev = events.get(Number(params[0]));
		if (!ev || ev.job_application_id == null) return { rows: [], rowCount: 0 };
		const app = applications.get(ev.job_application_id);
		if (!app) return { rows: [], rowCount: 0 };
		return { rows: [{ company_id: app.company_id }], rowCount: 1 };
	}
	if (n.includes('from interview_events') && n.includes('candidate_id')) {
		const e = events.get(Number(params[0]));
		return { rows: e ? [{ candidate_id: e.candidate_id }] : [], rowCount: e ? 1 : 0 };
	}

	// candidate_data_keys (biometricCrypto getDEK / getOrCreateDEK, _dekState)
	if (n.startsWith('select') && n.includes('from candidate_data_keys')) {
		const row = deks.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (n.startsWith('insert into candidate_data_keys')) {
		if (!deks.has(Number(params[0]))) {
			deks.set(Number(params[0]), { dek_encrypted: params[1], destroyed_at: null });
		}
		return { rows: [], rowCount: 1 };
	}

	// recording_objects registry
	if (n.startsWith('select') && n.includes('from recording_objects')) {
		const row = registry.find((r) => r.object_key === params[0]);
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (n.startsWith('insert into recording_objects')) {
		if (hooks.onRegistryInsert) hooks.onRegistryInsert(params);
		if (!registry.some((r) => r.object_key === params[0])) {
			registry.push({
				object_key: params[0],
				candidate_id: params[1],
				object_type: 'recording',
				expires_at: params[2],
				deleted_at: null,
			});
			return { rows: [], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}

	// pending_storage_deletions ledger
	if (n.startsWith('select') && n.includes('from pending_storage_deletions') && n.includes('user_id > 0')) {
		const rows = ledger
			.filter((l) => l.source_family === 'livekit_recording' && ['pending', 'failed'].includes(l.status) && l.user_id > 0)
			.map((l) => ({ ...l }));
		return { rows, rowCount: rows.length };
	}
	if (n.startsWith('select') && n.includes('from pending_storage_deletions')) {
		const row = ledger.find(
			(l) =>
				l.user_id === Number(params[0]) &&
				l.file_url === params[1] &&
				l.storage_type === 'r2' &&
				l.source_family === 'livekit_recording' &&
				['pending', 'failed'].includes(l.status),
		);
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (n.startsWith('insert into pending_storage_deletions')) {
		if (failLedgerFor.has(params[1])) throw new Error('ledger insert boom');
		if (hooks.onLedgerInsert) hooks.onLedgerInsert(params);
		const row = {
			id: nextLedgerId++,
			user_id: params[0],
			file_url: params[1],
			storage_type: 'r2',
			status: 'pending',
			source_family: 'livekit_recording',
			attempts: 0,
			last_error: null,
		};
		ledger.push(row);
		return { rows: [{ id: row.id }], rowCount: 1 };
	}
	if (n.startsWith('update pending_storage_deletions')) {
		if (n.includes("status = 'deleted'")) {
			const row = ledger.find((l) => l.id === Number(params[0]));
			if (row) row.status = 'deleted';
			return { rows: [], rowCount: row ? 1 : 0 };
		}
		if (n.includes("status = 'failed'")) {
			const row = ledger.find((l) => l.id === Number(params[1]));
			if (row) {
				row.status = 'failed';
				row.last_error = params[0];
				row.attempts = (row.attempts || 0) + 1;
			}
			return { rows: [], rowCount: row ? 1 : 0 };
		}
		return { rows: [], rowCount: 0 };
	}

	return null;
}

db.query.mockImplementation(async (sql, params) => {
	const norm = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (!norm.startsWith('select')) writeLog.push({ sql: norm });
	const handled = routeSql(sql, params || []);
	if (handled) return handled;
	return baseQueryImpl(sql, params);
});

// ─── Seed helpers ─────────────────────────────────────────────────────────
const locFor = (id) => `s3://test-bucket/rekrut-recordings/rec-${id}.mp4`;
const keyFor = (id) => `rekrut-recordings/rec-${id}.mp4`;
const plainFor = (id) => Buffer.from(`PLAIN-${id}`);

function seedRow({
	id,
	session = null,
	event = null,
	status = 'completed',
	marker = 'default',
	plain = true,
	pointerLoc = null,
	rawPointer = false,
	retentionPast = false,
	fileSize = null,
}) {
	const loc = pointerLoc || locFor(id);
	const storage_path = rawPointer
		? Buffer.from('garbage-pointer-bytes-that-will-not-decrypt-0123456789')
		: sharedEncryption.encrypt(Buffer.from(loc));
	const row = {
		id,
		interview_event_id: event,
		interview_session_id: session,
		room_id: null,
		livekit_egress_id: 'EG_X',
		status,
		storage_path,
		encryption_key_id: marker,
		file_size_bytes: fileSize,
		duration_seconds: null,
		retention_expires_at: retentionPast
			? new Date(Date.now() - 864e5)
			: new Date(Date.now() + 90 * 864e5),
	};
	recordings.set(id, row);
	if (plain) s3.objects.set(keyFor(id), plainFor(id));
	return row;
}

async function ensureDek(candidateId) {
	await biometricCrypto.getOrCreateDEK(candidateId);
}
function destroyDek(candidateId) {
	const d = deks.get(candidateId);
	d.destroyed_at = new Date();
	d.dek_encrypted = Buffer.alloc(0);
}
function seedLedger(userId, fileUrl, status = 'pending') {
	const row = {
		id: nextLedgerId++,
		user_id: userId,
		file_url: fileUrl,
		storage_type: 'r2',
		status,
		source_family: 'livekit_recording',
		attempts: 0,
		last_error: null,
	};
	ledger.push(row);
	return row;
}

function baseWorld() {
	sessions.set(10, { id: 10, candidate_id: 7, company_id: 501 });
	sessions.set(11, { id: 11, candidate_id: 8, company_id: 502 });
	sessions.set(12, { id: 12, candidate_id: 13, company_id: 503 });
	sessions.set(14, { id: 14, candidate_id: 14, company_id: 504 });
	sessions.set(15, { id: 15, candidate_id: 17, company_id: 506 });
	sessions.set(16, { id: 16, candidate_id: 18, company_id: 507 });
	sessions.set(17, { id: 17, candidate_id: 19, company_id: 508 });
	sessions.set(18, { id: 18, candidate_id: 20, company_id: 509 });
	events.set(31, { id: 31, candidate_id: 8, job_application_id: 900 });
	events.set(33, { id: 33, candidate_id: 15, job_application_id: 902 });
	events.set(34, { id: 34, candidate_id: 16, job_application_id: 903 });
	applications.set(900, { id: 900, company_id: 502 });
	applications.set(902, { id: 902, company_id: 505 });
	applications.set(903, { id: 903, company_id: null });
}

/** The full dry-run fixture matrix (see #1131 consolidated STOP 1). */
async function seedMatrix() {
	baseWorld();
	await ensureDek(7);
	await ensureDek(8);
	await ensureDek(16);
	await ensureDek(20);
	await ensureDek(18);
	destroyDek(18);

	seedRow({ id: 1001, session: 10 }); // B session migratable
	seedRow({ id: 1002, event: 31 }); // B event migratable
	seedRow({ id: 1003, session: 10, marker: 'candidate-dek:v1', pointerLoc: `${locFor(1003)}.enc`, plain: false }); // already migrated
	seedRow({ id: 1004, session: 10, status: 'failed' }); // C1
	seedLedger(7, locFor(1004));
	seedRow({ id: 1005, session: 11, status: 'failed', plain: false, fileSize: plainFor(1005).length }); // C2 resume
	s3.objects.set(`${keyFor(1005)}.enc`, Buffer.from('enc-dummy-1005'));
	seedLedger(8, locFor(1005));
	seedRow({ id: 1006, session: 10, rawPointer: true, plain: false }); // undecryptable
	seedRow({ id: 1007 }); // unresolvable: both FKs null
	seedRow({ id: 1008, session: 9999 }); // unresolvable: dangling session
	seedRow({ id: 1009, session: 12 }); // session-held (user hold on 13)
	holds.push({ id: 1, user_id: 13, company_id: null, released_at: null });
	seedRow({ id: 1010, session: 14 }); // company-held via session (company 504)
	holds.push({ id: 2, user_id: null, company_id: 504, released_at: null });
	seedRow({ id: 1011, event: 33 }); // event-held via derived company 505
	holds.push({ id: 3, user_id: null, company_id: 505, released_at: null });
	seedRow({ id: 1012, event: 34 }); // derivation NULL, migratable (candidate 16)
	failHoldUids.add(17);
	seedRow({ id: 1013, session: 15 }); // hold lookup failure
	seedRow({ id: 1014, session: 16 }); // destroyed DEK (candidate 18)
	seedRow({ id: 1015, session: 17 }); // absent DEK (candidate 19)
	seedRow({ id: 1016, session: 10, retentionPast: true }); // expired
	seedRow({ id: 1017, session: 10, status: 'deleted' }); // side: deleted_pointer_retained
	seedRow({ id: 1018, session: 10, status: 'recording' }); // side: excluded_active
	seedRow({ id: 1019, session: 10, status: 'completed', plain: false }); // side: no_object
	recordings.get(1019).storage_path = null;
	seedRow({ id: 1020, session: 10, marker: 'legacy-x' }); // unknown marker
	seedRow({ id: 1021, session: 10 }); // live-stage registry conflict (other candidate)
	registry.push({ object_key: `${locFor(1021)}.enc`, candidate_id: 999, object_type: 'recording', expires_at: new Date(), deleted_at: null });
	seedRow({ id: 1022, session: 11 }); // live-stage registry conflict (deleted_at)
	registry.push({ object_key: `${locFor(1022)}.enc`, candidate_id: 8, object_type: 'recording', expires_at: new Date(), deleted_at: new Date() });
	seedRow({ id: 1023, session: 10 }); // oversized at live stage
	seedRow({ id: 1024, session: 10 }); // verify-tamper at live stage
	seedRow({ id: 1025, session: 18 }); // mid-run DEK destruction at live stage
	seedRow({ id: 1026, session: 10 }); // concurrent change at live stage
	seedRow({ id: 1027, session: 10, plain: false }); // not_found (both gone)
	seedRow({ id: 1028, session: 10 }); // plaintext-pending at live stage
	seedRow({ id: 1029, session: 10, marker: 'candidate-dek:v1', pointerLoc: `${locFor(1029)}.enc` }); // recovery seed: repointed, plaintext remains
	seedLedger(7, locFor(1029));
	seedRow({ id: 1030, session: 10 }); // ledger_error at live stage
}

beforeEach(() => {
	recordings.clear();
	sessions.clear();
	events.clear();
	applications.clear();
	deks.clear();
	registry.length = 0;
	ledger.length = 0;
	holds.length = 0;
	usersCompany.clear();
	writeLog.length = 0;
	nextLedgerId = 1;
	lockState.available = true;
	lockState.attempts = 0;
	failHoldUids.clear();
	failLedgerFor.clear();
	hooks.onRegistryInsert = null;
	hooks.onLedgerInsert = null;
	s3.reset();
	sessionRecordingStore._clearClient();
});

const run = (opts = {}, deps = {}) =>
	tool.runMigration({ live: false, pass: 'main', ...opts }, { pool: db, ...deps });

// ─── CLI / refusal ────────────────────────────────────────────────────────
describe('CLI parsing + live refusal', () => {
	test('no flags = dry-run; --approved-by alone never enables live', () => {
		expect(tool.parseArgs([])).toMatchObject({ live: false, pass: 'main' });
		expect(tool.parseArgs(['--approved-by', 'Some Name']).live).toBe(false);
		expect(tool.parseArgs(['--live', '--approved-by', 'Some Name'])).toMatchObject({
			live: true,
			approvedBy: 'Some Name',
		});
		expect(tool.validateOptions(tool.parseArgs(['--live']))).not.toBeNull();
		expect(tool.validateOptions(tool.parseArgs(['--live', '--approved-by', 'x']))).toBeNull();
		expect(tool.validateOptions(tool.parseArgs(['--pass', 'bogus']))).not.toBeNull();
	});

	test('live without --approved-by refuses with exit 1 BEFORE any DB/storage connection', async () => {
		const pool = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
		const storage = {
			_clearClient: jest.fn(),
			getRecordingStorageConfig: jest.fn(),
			downloadRecordingObject: jest.fn(),
			recordingObjectExists: jest.fn(),
			uploadEncryptedObject: jest.fn(),
			deleteRecordingObjectVerified: jest.fn(),
			encryptSessionRecording: jest.fn(),
			decryptSessionRecording: jest.fn(),
			encLocationFor: jest.fn(),
		};
		const res = await tool.runMigration({ live: true, pass: 'main' }, { pool, storage });
		expect(res.exitCode).toBe(1);
		expect(pool.query).not.toHaveBeenCalled();
		expect(storage.getRecordingStorageConfig).not.toHaveBeenCalled();
		expect(storage._clearClient).not.toHaveBeenCalled();
	});

	test('advisory lock held → exit 1, no storage ops, no writes', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1001, session: 10 });
		writeLog.length = 0;
		lockState.available = false;
		const res = await run({});
		expect(res.exitCode).toBe(1);
		expect(s3.counts).toEqual({ get: 0, put: 0, delete: 0, head: 0 });
		expect(writeLog).toHaveLength(0);
	});

	test('advisory lock is taken + unlocked on a dedicated pool.connect() client, not the pool, and released (SEC B-2)', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1001, session: 10 });
		const makeClient = () => ({
			query: jest.fn(async (sql, params) => {
				const handled = routeSql(sql, params || []);
				if (handled) return handled;
				return baseQueryImpl(sql, params);
			}),
			release: jest.fn(),
		});
		const originalConnect = db.connect;
		try {
			db.query.mockClear();
			const client = makeClient();
			db.connect = jest.fn(async () => client);
			const res = await run({});
			expect(res.exitCode).toBe(0);
			const clientSql = client.query.mock.calls.map(([sql]) => sql);
			expect(clientSql.some((s) => s.includes('pg_try_advisory_lock'))).toBe(true);
			expect(clientSql.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
			expect(client.release).toHaveBeenCalledTimes(1);
			const poolLockCalls = db.query.mock.calls.filter(
				([sql]) =>
					sql.includes('pg_try_advisory_lock') || sql.includes('pg_advisory_unlock'),
			);
			expect(poolLockCalls).toHaveLength(0);

			// Held-lock refusal on the dedicated client still exits 1
			// and still releases that client.
			lockState.available = false;
			const client2 = makeClient();
			db.connect = jest.fn(async () => client2);
			const res2 = await run({});
			expect(res2.exitCode).toBe(1);
			expect(
				client2.query.mock.calls.some(([sql]) => sql.includes('pg_try_advisory_lock')),
			).toBe(true);
			expect(client2.release).toHaveBeenCalledTimes(1);
		} finally {
			db.connect = originalConnect;
		}
	});
});

// ─── Dry-run ──────────────────────────────────────────────────────────────
describe('dry-run classification (full fixture matrix)', () => {
	test('classifies every class, splits migratable, side counts, self-checks — with ZERO writes', async () => {
		await seedMatrix();
		const deksBefore = deks.size;
		writeLog.length = 0;

		const res = await run({});
		const r = res.report;

		expect(res.exitCode).toBe(0);
		expect(r.mode).toBe('dry-run');
		expect(r.population.total).toBe(27);
		expect(r.population.byClass).toMatchObject({
			migratable: 13,
			already_migrated: 2,
			skipped_held: 3,
			hold_lookup_failed: 1,
			unknown_marker: 1,
			undecryptable_pointer: 1,
			unresolvable: 2,
			dek_destroyed: 1,
			absent_dek: 1,
			expired_excluded: 1,
			not_found: 1,
		});
		const sum = Object.values(r.population.byClass).reduce((a, b) => a + b, 0);
		expect(sum).toBe(r.population.total);
		expect(r.population.migratable).toMatchObject({
			total: 13,
			resume_enc: 1,
			ledger_preexisting: 2,
			by_status: { completed: 11, failed: 2 },
			by_attribution: { session: 11, event: 2 },
		});
		expect(r.population.side_counts).toEqual({
			deleted_pointer_retained: 1,
			excluded_active: 1,
			no_object: 1,
		});
		expect(r.outcomes.company_derivation_failed).toBe(1);
		expect(r.reconciliation.ok).toBe(true);
		// Privacy C1: plaintext_remaining includes unknown_marker +
		// undecryptable_pointer (both plaintext not shown gone).
		expect(r.plaintext_remaining.breakdown).toMatchObject({
			unknown_marker: 1,
			undecryptable_pointer: 1,
		});
		expect(r.plaintext_remaining.total).toBe(12);
		expect(r.plaintext_remaining.basis).toContain('unknown_marker');
		expect(r.plaintext_remaining.basis).toContain('undecryptable_pointer');
		expect(r.plaintext_remaining.basis).toContain('migrated_plaintext_pending');
		expect(r.plaintext_remaining.basis).toContain('deleted_pointer_retained');
		expect(
			r.scope_limits.some(
				(s) => s.includes('not_found') && s.includes('checked bucket'),
			),
		).toBe(true);

		// ZERO writes of any kind: no S3 put/delete/get, no DB writes, no DEK rows created.
		expect(s3.counts.put).toBe(0);
		expect(s3.counts.delete).toBe(0);
		expect(s3.counts.get).toBe(0);
		expect(writeLog).toHaveLength(0);
		expect(deks.size).toBe(deksBefore);
		// Ledger-recovery must NOT run in dry-run: recovery seed untouched.
		expect(s3.objects.has(keyFor(1029))).toBe(true);
		expect(ledger.find((l) => l.file_url === locFor(1029)).status).toBe('pending');
	});

	test('Tier 1 carries NO ids, NO storage keys/locations, NO hashes; Tier 2 manifest lists exception ids only', async () => {
		await seedMatrix();
		const res = await run({});
		const tier1 = JSON.stringify(res.report);
		expect(tier1).not.toContain('rekrut-recordings');
		expect(tier1).not.toContain('s3://');
		expect(tier1).not.toContain('1001');
		expect(tier1).not.toContain('1027');
		const man = res.manifest;
		const allIds = Object.values(man.exceptions).flat().map((e) => (typeof e === 'object' ? e.recording_id : e));
		expect(allIds).toContain(1009); // held
		expect(allIds).toContain(1013); // lookup failed
		expect(allIds).toContain(1014); // dek destroyed
		expect(allIds).toContain(1015); // absent dek
		expect(allIds).toContain(1027); // not found
		expect(allIds).not.toContain(1001); // migrated class: counts only, no per-row list
		expect(allIds).not.toContain(1004);
		// Privacy C2: candidate_id only for per-candidate-disposition
		// classes; every other exception entry is recording_id only.
		const heldEntry = (man.exceptions.skipped_held || []).find((e) => e.recording_id === 1009);
		expect(heldEntry).toBeDefined();
		expect(heldEntry.candidate_id).toBe(13);
		const notFoundEntry = (man.exceptions.not_found || []).find((e) => e.recording_id === 1027);
		expect(notFoundEntry).toBeDefined();
		expect(notFoundEntry).not.toHaveProperty('candidate_id');
		const unknownEntry = (man.exceptions.unknown_marker || []).find((e) => e.recording_id === 1020);
		expect(unknownEntry).toBeDefined();
		expect(unknownEntry).not.toHaveProperty('candidate_id');
	});
});

// ─── Live: happy paths ────────────────────────────────────────────────────
describe('live main pass — migration sequence', () => {
	test('B session + B event + C1 migrate fully: repoint, verbatim registry expiry, ledger reuse, decrypt round-trip, exit 0', async () => {
		baseWorld();
		await ensureDek(7);
		await ensureDek(8);
		const r1 = seedRow({ id: 1001, session: 10 });
		const r2 = seedRow({ id: 1002, event: 31 });
		const r4 = seedRow({ id: 1004, session: 10, status: 'failed' });
		const preLedger = seedLedger(7, locFor(1004));
		const exp1 = r1.retention_expires_at;

		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.exitCode).toBe(0);
		expect(res.report.outcomes.migrated).toBe(3);
		expect(res.report.reconciliation.ok).toBe(true);

		for (const [id, cand] of [[1001, 7], [1002, 8], [1004, 7]]) {
			const row = recordings.get(id);
			expect(row.encryption_key_id).toBe('candidate-dek:v1');
			expect(livekitService.decryptStoragePath(row)).toBe(`${locFor(id)}.enc`);
			expect(s3.objects.has(keyFor(id))).toBe(false);
			expect(s3.objects.has(`${keyFor(id)}.enc`)).toBe(true);
			const plain = await livekitService.fetchDecryptedRecording(row);
			expect(plain.equals(plainFor(id))).toBe(true);
			const reg = registry.find((x) => x.object_key === `${locFor(id)}.enc`);
			expect(reg.candidate_id).toBe(cand);
		}
		// Registry expiry copies the row's retention_expires_at VERBATIM (privacy §6a).
		const reg1 = registry.find((x) => x.object_key === `${locFor(1001)}.enc`);
		expect(new Date(reg1.expires_at).getTime()).toBe(new Date(exp1).getTime());
		// C1: the pre-existing ledger row is REUSED (no duplicate) and marked deleted.
		const rows1004 = ledger.filter((l) => l.file_url === locFor(1004));
		expect(rows1004).toHaveLength(1);
		expect(rows1004[0].id).toBe(preLedger.id);
		expect(rows1004[0].status).toBe('deleted');
		expect(r2.id).toBe(1002);
		expect(r4.id).toBe(1004);
	});

	test('C2/resume: plaintext gone + .enc present migrates via resume path, counted migrated + resumed', async () => {
		baseWorld();
		await ensureDek(8);
		const plain = plainFor(1005);
		const envelope = await sessionRecordingStore.encryptSessionRecording(plain, 8, 1005);
		seedRow({ id: 1005, session: 11, status: 'failed', plain: false, fileSize: plain.length });
		s3.objects.set(`${keyFor(1005)}.enc`, envelope);
		seedLedger(8, locFor(1005));

		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.exitCode).toBe(0);
		expect(res.report.outcomes.migrated).toBe(1);
		expect(res.report.outcomes.migrated_resumed).toBe(1);
		const row = recordings.get(1005);
		expect(row.encryption_key_id).toBe('candidate-dek:v1');
		expect(livekitService.decryptStoragePath(row)).toBe(`${locFor(1005)}.enc`);
		expect(ledger.filter((l) => l.file_url === locFor(1005))).toHaveLength(1);
		expect(ledger[0].status).toBe('deleted');
	});

	test('ledger-recovery phase: repointed row with surviving plaintext + pending ledger is recovered, not re-migrated', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1029, session: 10, marker: 'candidate-dek:v1', pointerLoc: `${locFor(1029)}.enc` });
		s3.objects.set(`${keyFor(1029)}.enc`, Buffer.from('enc-1029'));
		seedLedger(7, locFor(1029));

		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.exitCode).toBe(0);
		expect(res.report.outcomes.recovered_deletions).toBe(1);
		expect(res.report.outcomes.migrated).toBe(0);
		expect(s3.objects.has(keyFor(1029))).toBe(false);
		expect(ledger[0].status).toBe('deleted');
	});

	test('ledger-recovery verified delete failure → recovery_failed: 1 (Tier 1 outcome) and exit 2 (SEC B-1)', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1029, session: 10, marker: 'candidate-dek:v1', pointerLoc: `${locFor(1029)}.enc` });
		s3.objects.set(`${keyFor(1029)}.enc`, Buffer.from('enc-1029'));
		seedLedger(7, locFor(1029));
		const real = sessionRecordingStore;
		const failingDelete = {
			...real,
			deleteRecordingObjectVerified: async (loc) => {
				if (loc === locFor(1029)) {
					const e = new Error('still exists');
					e.code = 'DELETE_VERIFY_FAILED';
					throw e;
				}
				return real.deleteRecordingObjectVerified(loc);
			},
		};
		const res = await run({ live: true, approvedBy: 'Tester' }, { storage: failingDelete });
		expect(res.exitCode).toBe(2);
		expect(res.report.outcomes.recovery_failed).toBe(1);
		expect(res.report.outcomes.recovered_deletions).toBe(0);
		expect(s3.objects.has(keyFor(1029))).toBe(true);
		expect(ledger[0].status).toBe('pending');
	});
});

// ─── Live: non-migratable classes are untouched ───────────────────────────
describe('live main pass — skip classes', () => {
	test('held / lookup-failed / destroyed / absent / expired / not-found / undecryptable / unresolvable / unknown / already-migrated: zero writes to those objects, exit 0', async () => {
		baseWorld();
		await ensureDek(7);
		await ensureDek(8);
		await ensureDek(18);
		destroyDek(18);
		seedRow({ id: 1009, session: 12 });
		holds.push({ id: 1, user_id: 13, company_id: null, released_at: null });
		failHoldUids.add(17);
		seedRow({ id: 1013, session: 15 });
		seedRow({ id: 1014, session: 16 });
		seedRow({ id: 1015, session: 17 });
		seedRow({ id: 1016, session: 10, retentionPast: true });
		seedRow({ id: 1027, session: 10, plain: false });
		seedRow({ id: 1006, session: 10, rawPointer: true, plain: false });
		seedRow({ id: 1007 });
		seedRow({ id: 1008, session: 9999 });
		seedRow({ id: 1020, session: 10, marker: 'legacy-x' });
		seedRow({ id: 1003, session: 10, marker: 'candidate-dek:v1', pointerLoc: `${locFor(1003)}.enc`, plain: false });

		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.exitCode).toBe(0);
		expect(res.report.outcomes).toMatchObject({
			migrated: 0,
			skipped_held: 1,
			hold_lookup_failed: 1,
			dek_destroyed: 1,
			absent_dek: 1,
			expired_excluded: 1,
			not_found: 1,
			undecryptable_pointer: 1,
			unresolvable: 2,
			unknown_marker: 1,
			already_migrated: 1,
		});
		for (const id of [1009, 1013, 1014, 1015, 1016, 1007, 1008, 1020]) {
			expect(s3.objects.has(keyFor(id))).toBe(true); // plaintext untouched
			expect(recordings.get(id).encryption_key_id).not.toBe('candidate-dek:v1');
		}
		expect(deks.has(19)).toBe(false); // main pass never mints
	});

	test('absent-dek pass migrates absent-DEK rows only, counts dek_minted, leaves existing-DEK rows for the main pass', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1015, session: 17 }); // candidate 19, absent DEK
		seedRow({ id: 1001, session: 10 }); // candidate 7, existing DEK

		const res = await run({ live: true, approvedBy: 'Tester', pass: 'absent-dek' });
		expect(res.exitCode).toBe(0);
		expect(res.report.outcomes.migrated).toBe(1);
		expect(res.report.outcomes.dek_minted).toBe(1);
		expect(deks.has(19)).toBe(true);
		expect(recordings.get(1015).encryption_key_id).toBe('candidate-dek:v1');
		expect(s3.objects.has(keyFor(1015))).toBe(false);
		// Existing-DEK row is out of this pass's scope — untouched.
		expect(recordings.get(1001).encryption_key_id).toBe('default');
		expect(s3.objects.has(keyFor(1001))).toBe(true);
	});
});

// ─── Live: failure classes ────────────────────────────────────────────────
describe('live main pass — failure + race classes', () => {
	test('registry conflict (different candidate) → registry_conflict, recording + plaintext untouched', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1021, session: 10 });
		registry.push({ object_key: `${locFor(1021)}.enc`, candidate_id: 999, object_type: 'recording', expires_at: new Date(), deleted_at: null });
		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.report.outcomes.registry_conflict).toBe(1);
		expect(res.report.outcomes.migrated).toBe(0);
		expect(recordings.get(1021).encryption_key_id).toBe('default');
		expect(s3.objects.has(keyFor(1021))).toBe(true);
	});

	test('registry conflict (registry row deleted_at set) → registry_conflict', async () => {
		baseWorld();
		await ensureDek(8);
		seedRow({ id: 1022, session: 11 });
		registry.push({ object_key: `${locFor(1022)}.enc`, candidate_id: 8, object_type: 'recording', expires_at: new Date(), deleted_at: new Date() });
		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.report.outcomes.registry_conflict).toBe(1);
		expect(recordings.get(1022).encryption_key_id).toBe('default');
		expect(s3.objects.has(keyFor(1022))).toBe(true);
	});

	test('oversized object → RECORDING_TOO_LARGE quarantine on attempt 1, plaintext NOT deleted, exit 2 (remainder)', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1023, session: 10, plain: false });
		s3.objects.set(keyFor(1023), Buffer.alloc(sessionRecordingStore.MAX_SESSION_RECORDING_BYTES + 1, 1));
		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.report.outcomes.quarantined).toBe(1);
		expect(res.report.error_class_counts.RECORDING_TOO_LARGE).toBe(1);
		expect(res.exitCode).toBe(2);
		expect(s3.objects.has(keyFor(1023))).toBe(true);
		expect(recordings.get(1023).encryption_key_id).toBe('default');
	});

	test('verify tamper (.enc corrupted after upload) → verify fails, quarantined, plaintext untouched, no repoint', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1024, session: 10 });
		const real = sessionRecordingStore;
		const tampering = {
			...real,
			uploadEncryptedObject: async (loc, env) => {
				const out = await real.uploadEncryptedObject(loc, env);
				const buf = s3.objects.get(`${keyFor(1024)}.enc`);
				buf[buf.length - 1] ^= 0xff;
				return out;
			},
		};
		const res = await run({ live: true, approvedBy: 'Tester' }, { storage: tampering });
		expect(res.report.outcomes.quarantined).toBe(1);
		expect(res.report.outcomes.migrated).toBe(0);
		expect(s3.counts.put).toBeGreaterThan(1); // retried, bounded
		expect(s3.objects.has(keyFor(1024))).toBe(true);
		expect(recordings.get(1024).encryption_key_id).toBe('default');
		expect(ledger.filter((l) => l.file_url === locFor(1024))).toHaveLength(0); // no ledger intent before verify
	});

	test('DEK destroyed between upload and verify → quarantined with DEK_DESTROYED (not Error), plaintext present, no repoint, no ledger intent, no DEK resurrection (CRYPTO C-1)', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1031, session: 10 });
		const real = sessionRecordingStore;
		const destroyingUpload = {
			...real,
			uploadEncryptedObject: async (loc, env) => {
				const out = await real.uploadEncryptedObject(loc, env);
				destroyDek(7);
				return out;
			},
		};
		const res = await run({ live: true, approvedBy: 'Tester' }, { storage: destroyingUpload });
		expect(res.exitCode).toBe(2);
		expect(res.report.outcomes.quarantined).toBe(1);
		expect(res.report.outcomes.migrated).toBe(0);
		expect(res.report.error_class_counts.DEK_DESTROYED).toBe(1);
		expect(res.report.error_class_counts.Error).toBeUndefined();
		expect(s3.objects.has(keyFor(1031))).toBe(true);
		expect(recordings.get(1031).encryption_key_id).toBe('default');
		expect(ledger.filter((l) => l.file_url === locFor(1031))).toHaveLength(0);
		expect(deks.has(7)).toBe(true);
		expect(deks.get(7).destroyed_at).not.toBeNull();
	});

	test('mid-run DEK destruction (after verify/ledger intent, before repoint) → destroyed_mid_migration, .enc ledgered, plaintext untouched, no repoint', async () => {
		baseWorld();
		await ensureDek(20);
		seedRow({ id: 1025, session: 18 });
		// Destruction lands in the window the re-check guards: after
		// VERIFY (which legitimately needs the live DEK to decrypt) and
		// the ledger intent, before the repoint. The hook fires on the
		// PLAINTEXT ledger intent insert only (the .enc ledger insert
		// inside the destroyed branch must not re-fire it).
		hooks.onLedgerInsert = (params) => {
			if (params[1] === locFor(1025)) destroyDek(20);
		};
		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.exitCode).toBe(2);
		expect(res.report.outcomes.destroyed_mid_migration).toBe(1);
		expect(res.report.outcomes.migrated).toBe(0);
		expect(recordings.get(1025).encryption_key_id).toBe('default');
		expect(s3.objects.has(keyFor(1025))).toBe(true);
		const encLedger = ledger.filter((l) => l.file_url === `${locFor(1025)}.enc`);
		expect(encLedger).toHaveLength(1);
		expect(encLedger[0].status).toBe('pending');
	});

	test('concurrent change (pointer mutated after classification, before repoint) → CAS 0 rows → concurrent_change, plaintext NOT deleted', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1026, session: 10 });
		hooks.onLedgerInsert = (params) => {
			if (params[1] === locFor(1026)) {
				recordings.get(1026).storage_path = sharedEncryption.encrypt(Buffer.from(locFor(9999)));
			}
		};
		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.report.outcomes.concurrent_change).toBe(1);
		expect(res.report.outcomes.migrated).toBe(0);
		expect(s3.objects.has(keyFor(1026))).toBe(true);
	});

	test('ledger intent failure → ledger_error, abort object, NO repoint, NO delete', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1030, session: 10 });
		failLedgerFor.add(locFor(1030));
		const res = await run({ live: true, approvedBy: 'Tester' });
		expect(res.report.outcomes.ledger_error).toBe(1);
		expect(res.report.outcomes.migrated).toBe(0);
		expect(recordings.get(1030).encryption_key_id).toBe('default');
		expect(s3.objects.has(keyFor(1030))).toBe(true);
	});

	test('delete failure after repoint → migrated_plaintext_pending (ledger stays pending); NEXT live run recovers the deletion', async () => {
		baseWorld();
		await ensureDek(7);
		seedRow({ id: 1028, session: 10 });
		const real = sessionRecordingStore;
		const failingDelete = {
			...real,
			deleteRecordingObjectVerified: async (loc) => {
				if (loc === locFor(1028)) {
					const e = new Error('still exists');
					e.code = 'DELETE_VERIFY_FAILED';
					throw e;
				}
				return real.deleteRecordingObjectVerified(loc);
			},
		};
		const res1 = await run({ live: true, approvedBy: 'Tester' }, { storage: failingDelete });
		expect(res1.exitCode).toBe(2);
		expect(res1.report.outcomes.migrated_plaintext_pending).toBe(1);
		expect(res1.report.outcomes.migrated).toBe(0);
		expect(recordings.get(1028).encryption_key_id).toBe('candidate-dek:v1'); // repoint DID happen
		expect(s3.objects.has(keyFor(1028))).toBe(true); // plaintext survived
		expect(ledger.find((l) => l.file_url === locFor(1028)).status).toBe('pending');

		const res2 = await run({ live: true, approvedBy: 'Tester' });
		expect(res2.report.outcomes.recovered_deletions).toBe(1);
		expect(s3.objects.has(keyFor(1028))).toBe(false);
		expect(ledger.find((l) => l.file_url === locFor(1028)).status).toBe('deleted');
	});
});
