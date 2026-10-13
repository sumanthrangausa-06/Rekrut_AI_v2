/**
 * observerDormancy — Gate A (S-085 #787), Quinn protocol §3 + T5/T6/T13/T14.
 *
 * The Dormancy Evidence Pack centrepiece, in jest form: the REAL worker
 * runs against a mock SFU. With the flag OFF (or malformed), a session
 * with OFFERED media must produce exactly ZERO capture side effects —
 * no subscriptions, no handlers, no streams, no DB rows, no storage
 * calls, no DEK rows, empty workdir — while presence (join + report
 * flush) is unchanged. The pack generator (scripts/gate-a-evidence-pack.js)
 * runs these same scenarios and writes the Rung-1 evidence files.
 */
jest.setTimeout(40000);

const fs = require('node:fs');
const { Readable } = require('node:stream');

// ── Mock SFU ────────────────────────────────────────────────────────────────
const mockSfu = { streamsConstructed: 0, framesDelivered: 0 };
class FakeAudioStream {
	constructor(track) { mockSfu.streamsConstructed++; this.track = track; }
	getReader() {
		const track = this.track;
		return {
			read: async () => {
				if (track.deliverIndex < track.deliverQueue.length) {
					if (track.frameDelayMs) await new Promise((r) => setTimeout(r, track.frameDelayMs));
					mockSfu.framesDelivered++;
					return { done: false, value: track.deliverQueue[track.deliverIndex++] };
				}
				return { done: true, value: undefined };
			},
			releaseLock: () => {},
		};
	}
}
class FakeTrack {
	constructor(kind, { offered = 0, frames = [], frameDelayMs = 0 } = {}) {
		this.kind = kind; this.framesOffered = offered;
		this.deliverQueue = frames; this.deliverIndex = 0; this.frameDelayMs = frameDelayMs;
	}
}
class FakePublication {
	constructor(kind, track, participant) { this.kind = kind; this.track = track; this.participant = participant; this.setSubscribedCalls = []; }
	async setSubscribed(v) {
		this.setSubscribedCalls.push(v);
		if (v && this.track && this.room) this.room._emitSubscribed(this.track, this, this.participant);
	}
}
class FakeParticipant {
	constructor(identity, pubs = []) {
		this.identity = identity; this.metadata = {};
		this.trackPublications = new Map(pubs.map((p, i) => [`sid-${identity}-${i}`, p]));
		for (const p of pubs) p.participant = this;
	}
}
class FakeRoom {
	constructor(opts) {
		this.opts = opts; this.remoteParticipants = new Map(); this.handlers = {}; this.disconnected = false;
		this._connectGate = new Promise((res) => { this._releaseConnect = res; });
		FakeRoom.instances.push(this);
	}
	async connect() { await this._connectGate; }
	async disconnect() { this.disconnected = true; }
	on(event, fn) { (this.handlers[event] ||= []).push(fn); }
	_emitSubscribed(track, pub, participant) { for (const fn of this.handlers.trackSubscribed || []) fn(track, pub, participant); }
	async emitPublished(pub, participant) { for (const fn of this.handlers.trackPublished || []) await fn(pub, participant); }
}
FakeRoom.instances = [];

jest.mock('@livekit/rtc-node', () => ({
	Room: FakeRoom,
	RoomEvent: { TrackSubscribed: 'trackSubscribed', TrackPublished: 'trackPublished' },
	AudioStream: FakeAudioStream,
	TrackKind: { KIND_AUDIO: 1, KIND_VIDEO: 2 },
}));

// ── Transactional in-memory PG fake ─────────────────────────────────────────
const mockState = {
	recordingObjects: new Map(), chunks: [], measurements: new Map(), outcomes: new Map(),
	jobs: new Map(), sessions: new Map(), receipts: [], ledger: [], dekRows: new Map(), registryInserts: 0,
};
function revive(st) {
	for (const row of st.dekRows.values()) if (row.dek_encrypted && !Buffer.isBuffer(row.dek_encrypted)) row.dek_encrypted = Buffer.from(row.dek_encrypted);
	for (const row of st.measurements.values()) if (row.measurements_envelope && !Buffer.isBuffer(row.measurements_envelope)) row.measurements_envelope = Buffer.from(row.measurements_envelope);
	return st;
}
function route(st, sql, params = []) {
	if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
	if (sql.includes('INSERT INTO candidate_data_keys')) {
		if (!st.dekRows.has(params[0])) st.dekRows.set(params[0], { dek_encrypted: params[1], destroyed_at: null });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('SELECT dek_encrypted, destroyed_at FROM candidate_data_keys')) {
		const r = st.dekRows.get(params[0]); return { rows: r ? [r] : [] };
	}
	if (sql.includes('UPDATE candidate_data_keys')) {
		const r = st.dekRows.get(params[0]); if (!r) return { rows: [], rowCount: 0 };
		r.destroyed_at = new Date(); r.dek_encrypted = params[1]; return { rows: [], rowCount: 1 };
	}
	if (sql.includes('SELECT destroyed_at FROM candidate_data_keys')) {
		const r = st.dekRows.get(params[0]); return { rows: r ? [{ destroyed_at: r.destroyed_at }] : [] };
	}
	if (sql.includes('INSERT INTO recording_objects')) {
		st.registryInserts++;
		st.recordingObjects.set(params[0], { object_key: params[0], interview_id: params[1], candidate_id: params[2], object_type: 'observer_audio', registration_state: 'pending', created_at: new Date(), deleted_at: null });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('INSERT INTO observer_audio_chunks')) {
		st.chunks.push({ interview_session_id: params[0], candidate_id: params[1], chunk_index: params[2], object_key: params[3], byte_size: null, sample_rate: params[4], is_test: params[5], captured_at: new Date() });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('FROM observer_jobs')) { const j = st.jobs.get(params[0]); return { rows: j ? [j] : [] }; }
	if (sql.includes('FROM interview_sessions')) { const s = st.sessions.get(params[0]); return { rows: s ? [s] : [] }; }
	if (sql.includes('FROM consent_receipts')) {
		if (sql.includes("consent_type = 'biometric'")) {
			const rows = st.receipts.filter((r) => r.interview_session_id === params[0] && r.consent_type === 'biometric');
			return { rows: rows.length ? [rows[rows.length - 1]] : [] };
		}
		if (sql.includes("consent_type IN ('observer_capture', 'biometric')")) {
			const withChunks = new Set(st.chunks.map((c) => c.interview_session_id));
			const seen = new Map();
			for (const r of st.receipts) if (r.withdrawn_at && withChunks.has(r.interview_session_id)) seen.set(r.interview_session_id, { interview_session_id: r.interview_session_id, candidate_id: r.candidate_id });
			return { rows: [...seen.values()] };
		}
		return { rows: [] };
	}
	if (sql.includes("registration_state = 'confirmed'")) {
		const row = st.recordingObjects.get(params[0]);
		if (row) { row.registration_state = 'confirmed'; st.recordingObjects.delete(params[0]); row.object_key = params[1]; st.recordingObjects.set(params[1], row); }
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (sql.includes('UPDATE observer_audio_chunks SET byte_size')) {
		const row = st.chunks.find((c) => c.object_key === params[0]);
		if (row) { row.byte_size = params[1]; row.object_key = params[2]; }
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (sql.includes('INSERT INTO observer_speech_measurements')) {
		st.measurements.set(params[0], { interview_session_id: params[0], candidate_id: params[1], measurements_envelope: params[2], method_version: params[3], state: params[4], is_test: params[5], created_at: new Date() });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('INSERT INTO observer_capture_outcomes')) {
		st.outcomes.set(params[0], { interview_session_id: params[0], candidate_id: params[1], scope: params[2], chunks_persisted: params[3], chunks_dropped: params[4], audio_seconds_captured: params[5], stop_reason: params[6], started_at: params[7] });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes("registration_state = 'pending'") && sql.includes('SELECT object_key, candidate_id')) {
		return { rows: [...st.recordingObjects.values()].filter((r) => r.registration_state === 'pending' && !r.deleted_at && r.created_at < params[0]) };
	}
	if (sql.includes('SELECT id FROM pending_storage_deletions')) return { rows: st.ledger.filter((l) => l.file_url === params[0] && l.status === 'pending') };
	if (sql.includes('INSERT INTO pending_storage_deletions')) {
		st.ledger.push({ user_id: params[0], file_url: params[1], storage_type: 'r2', status: 'pending', source_family: 'observer_audio' });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('DELETE FROM observer_audio_chunks WHERE object_key')) {
		const n = st.chunks.length; st.chunks = st.chunks.filter((c) => c.object_key !== params[0]);
		return { rows: [], rowCount: n - st.chunks.length };
	}
	if (sql.includes('DELETE FROM recording_objects WHERE object_key')) {
		const row = st.recordingObjects.get(params[0]);
		if (row && row.registration_state === 'pending') st.recordingObjects.delete(params[0]);
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (sql.includes('SELECT object_key FROM observer_audio_chunks WHERE interview_session_id')) {
		return { rows: st.chunks.filter((c) => c.interview_session_id === params[0]) };
	}
	if (sql.includes('DELETE FROM observer_audio_chunks WHERE interview_session_id')) {
		const n = st.chunks.length; st.chunks = st.chunks.filter((c) => c.interview_session_id !== params[0]);
		return { rows: [], rowCount: n - st.chunks.length };
	}
	if (sql.includes('DELETE FROM observer_speech_measurements WHERE interview_session_id')) {
		return { rows: [], rowCount: st.measurements.delete(params[0]) ? 1 : 0 };
	}
	if (sql.includes('UPDATE recording_objects SET deleted_at') && sql.includes('WHERE interview_id')) {
		let n = 0; for (const row of st.recordingObjects.values()) if (row.interview_id === params[0] && !row.deleted_at) { row.deleted_at = new Date(); n++; }
		return { rows: [], rowCount: n };
	}
	throw new Error('unstubbed SQL: ' + sql.slice(0, 80));
}
const mockPool = {
	query: async (sql, params) => route(mockState, sql, params),
	connect: async () => {
		let tx = null;
		return {
			query: async (sql, params) => {
				if (sql === 'BEGIN') { tx = revive(structuredClone(mockState)); return { rows: [] }; }
				if (sql === 'COMMIT') {
					const newState = revive(tx);
					for (const k of Object.keys(mockState)) mockState[k] = newState[k];
					tx = null; return { rows: [] };
				}
				if (sql === 'ROLLBACK') { tx = null; return { rows: [] }; }
				return route(tx || mockState, sql, params);
			},
			release: () => {},
		};
	},
};
jest.mock('../../../lib/db', () => mockPool);
jest.mock('../../../lib/biometricAudit', () => ({ logAccess: jest.fn(async () => {}) }));

const mockObjects = new Map();
const mockStorageCalls = { put: 0, get: 0, delete: 0 };
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(async ({ buffer, objectKey }) => {
		mockStorageCalls.put++;
		const key = `r2/${objectKey}`;
		mockObjects.set(key, Buffer.from(buffer));
		return { key, url: `/api/files/${encodeURIComponent(key)}`, provider: 'r2' };
	}),
	getFile: jest.fn(async (key) => {
		mockStorageCalls.get++;
		if (!mockObjects.has(key)) { const e = new Error('nf'); e.code = 'NOT_FOUND'; throw e; }
		return { stream: Readable.from([mockObjects.get(key)]) };
	}),
	deleteStorageObject: jest.fn(async (key) => { mockStorageCalls.delete++; mockObjects.delete(key); return { deleted: true }; }),
	deleteFile: jest.fn(async () => ({ deleted: true })),
}));

const mockJobCalls = { cancel: [], flush: 0 };
jest.mock('../../../lib/observerJobs', () => ({
	enqueue: jest.fn(), claim: jest.fn(async () => null), heartbeat: jest.fn(async () => {}),
	markObserving: jest.fn(async () => {}), markFlushing: jest.fn(async () => 1),
	complete: jest.fn(async () => 1), cancel: jest.fn(async (id, reason) => { mockJobCalls.cancel.push({ id, reason }); return 1; }),
	fail: jest.fn(async () => 1), recoverStale: jest.fn(async () => 0), getStatus: jest.fn(async () => null),
}));
jest.mock('../../../lib/observerReportWriter', () => ({ flushReport: jest.fn(async () => { mockJobCalls.flush++; return { written: true }; }) }));
jest.mock('../../../server/services/livekit', () => ({ createObserverToken: jest.fn(async () => 'test-token') }));

process.env.BIOMETRIC_ENCRYPTION_KEY = 'f'.repeat(64);
process.env.RENDER_SERVICE_NAME = 'rekrutai-staging';
delete process.env.REKRUT_ENV_IDENTITY;

const worker = require('../../../workers/ai-observer/index');
const observerCapture = require('../../../lib/observerCapture');
const observerSpeech = require('../../../lib/observerSpeech');
const testDecrypt = require('../../../lib/observerAudioTestDecrypt');
const biometricCrypto = require('../../../lib/biometricCrypto');
const { unpackEnvelope } = require('../../../lib/r2FrameStore');
const { measurementAAD } = require('../../../lib/r2ObserverAudioStore');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs, label) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) { if (pred()) return; await sleep(50); }
	throw new Error('waitFor timeout: ' + label);
}
function toneFrames(seconds, freq = 120, sr = 48000) {
	const frames = [];
	for (let s = 0; s < seconds; s++) {
		const data = new Int16Array(sr);
		for (let i = 0; i < sr; i++) data[i] = Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * freq * ((s * sr + i) / sr)));
		frames.push({ data, sampleRate: sr, channels: 1, samplesPerChannel: sr });
	}
	return frames;
}
function seedSession(id, { testMarker = false, origin = 'staging' } = {}) {
	mockState.sessions.set(id, {
		id, candidate_id: 7, company_id: 99, status: 'in_progress',
		config: { biometric_collection: true, livekit_room: `room-${id}`, ...(testMarker ? { observer_capture_test: true } : {}) },
	});
	mockState.jobs.set(id, { id: 900 + id, interview_session_id: id, origin_env: origin });
	return { id: 900 + id, interview_session_id: id, origin_env: origin };
}
function standardParticipants({ audioFrames = [], audioDelayMs = 0 } = {}) {
	const candAudio = new FakePublication(1, new FakeTrack(1, { offered: 120, frames: audioFrames, frameDelayMs: audioDelayMs }), null);
	const candVideo = new FakePublication(2, new FakeTrack(2, { offered: 120 }), null);
	const intAudio = new FakePublication(1, new FakeTrack(1, { offered: 60 }), null);
	const candidate = new FakeParticipant('candidate-7', [candAudio, candVideo]);
	const interviewer = new FakeParticipant('interviewer-9', [intAudio]);
	return { candidate, interviewer, candAudio, candVideo, intAudio };
}
async function runJob(job, participants, pubs) {
	const before = FakeRoom.instances.length;
	const p = worker.processJob(job);
	await waitFor(() => FakeRoom.instances.length > before, 3000, 'room created');
	const room = FakeRoom.instances[FakeRoom.instances.length - 1];
	for (const part of participants) room.remoteParticipants.set(part.identity, part);
	for (const pub of pubs) pub.room = room;
	room._releaseConnect();
	await p;
	return room;
}
const pubsOf = (parts) => [parts.candAudio, parts.candVideo, parts.intAudio];
const totalSubs = (parts) => [parts.candAudio, parts.candVideo, parts.intAudio].reduce((n, p) => n + p.setSubscribedCalls.length, 0);
async function decryptMeasurements(sessionId, candidateId = 7) {
	const row = mockState.measurements.get(sessionId);
	if (!row) return null;
	const { iv, tag, ciphertext } = unpackEnvelope(row.measurements_envelope);
	const plain = await biometricCrypto.decryptWithExistingDEK(ciphertext, iv, tag, candidateId, measurementAAD(candidateId, sessionId));
	return JSON.parse(plain.toString('utf8'));
}

beforeEach(() => {
	mockState.recordingObjects = new Map(); mockState.chunks = []; mockState.measurements = new Map();
	mockState.outcomes = new Map(); mockState.jobs = new Map(); mockState.sessions = new Map();
	mockState.receipts = []; mockState.ledger = []; mockState.dekRows = new Map(); mockState.registryInserts = 0;
	mockObjects.clear();
	mockStorageCalls.put = 0; mockStorageCalls.get = 0; mockStorageCalls.delete = 0;
	mockSfu.streamsConstructed = 0; mockSfu.framesDelivered = 0;
	mockJobCalls.cancel = []; mockJobCalls.flush = 0;
	FakeRoom.instances = [];
	delete process.env.OBSERVER_AUDIO_CAPTURE_ENABLED;
});

describe('DORMANCY (Quinn §3)', () => {
	test('T1: flag OFF full synthetic session ⇒ ALL §8.1 counters and side effects exactly zero, presence intact', async () => {
		const job = seedSession(101);
		const parts = standardParticipants({});
		const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
		await sleep(400);
		// Non-vacuous: the SFU had media to take
		expect(parts.candAudio.track.framesOffered).toBeGreaterThan(0);
		expect(totalSubs(parts)).toBe(0);
		expect(Object.keys(room.handlers)).toHaveLength(0);
		expect(mockSfu.streamsConstructed).toBe(0);
		expect(mockSfu.framesDelivered).toBe(0);
		expect(mockState.recordingObjects.size).toBe(0);
		expect(mockState.chunks).toHaveLength(0);
		expect(mockState.measurements.size).toBe(0);
		expect(mockState.outcomes.size).toBe(0);
		expect(mockState.dekRows.size).toBe(0); // zero NEW candidate_data_keys rows
		expect(mockState.ledger).toHaveLength(0);
		expect(mockStorageCalls.put).toBe(0);
		expect(mockObjects.size).toBe(0);
		const workdir = observerSpeech.CAPTURE_WORKDIR;
		expect(fs.existsSync(workdir) ? fs.readdirSync(workdir) : []).toHaveLength(0);
		// Presence unchanged: completion still flushes the S-049a report
		mockState.sessions.get(101).status = 'completed';
		await waitFor(() => mockJobCalls.flush >= 1, 9000, 'presence flush');
		expect(mockJobCalls.flush).toBeGreaterThanOrEqual(1);
	});

	test("T2: flag value 'TRUE' (malformed) ⇒ dormant", async () => {
		process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'TRUE';
		const job = seedSession(102);
		const parts = standardParticipants({});
		const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
		await sleep(300);
		expect(totalSubs(parts)).toBe(0);
		expect(Object.keys(room.handlers)).toHaveLength(0);
		expect(mockState.chunks).toHaveLength(0);
	});

	test('T14: production-stamped job + staging worker + flag ON ⇒ dormant, CAPTURE_ENV_MISMATCH logged', async () => {
		process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
		const lines = [];
		observerCapture._setLogSink((l) => lines.push(l));
		const job = seedSession(107, { testMarker: true, origin: 'production' });
		const parts = standardParticipants({});
		await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
		await sleep(300);
		expect(totalSubs(parts)).toBe(0);
		const decision = lines.filter((l) => l.event === 'capture_decision' && l.session_id === 107).pop();
		expect(decision.gate_code).toBe('CAPTURE_ENV_MISMATCH');
		observerCapture._setLogSink(null);
	});
});

describe('CAPTURING (test scope)', () => {
	beforeEach(() => { process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true'; });

	test('T3: candidate audio ONLY, encrypted chunks, ground-truth measurements, session_end outcome', async () => {
		const job = seedSession(103, { testMarker: true });
		const parts = standardParticipants({ audioFrames: toneFrames(35) });
		await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
		expect(parts.candAudio.setSubscribedCalls).toEqual([true]);
		expect(parts.candVideo.setSubscribedCalls).toHaveLength(0);
		expect(parts.intAudio.setSubscribedCalls).toHaveLength(0);
		await waitFor(() => mockState.chunks.some((c) => c.interview_session_id === 103 && c.byte_size != null), 8000, 'first chunk');
		mockState.sessions.get(103).status = 'completed';
		await waitFor(() => mockState.outcomes.has(103), 10000, 'outcome');
		const chunks = mockState.chunks.filter((c) => c.interview_session_id === 103);
		expect(chunks).toHaveLength(2); // 30 s + 5 s partial
		expect(mockState.outcomes.get(103).stop_reason).toBe('session_end');
		const meas = await decryptMeasurements(103);
		expect(Math.abs(meas.speaking_time_sec.value - 35)).toBeLessThanOrEqual(1.5);
		expect(Math.abs(meas.pitch_median_hz.value - 120)).toBeLessThanOrEqual(3);
		expect(meas.speech_rate_wpm.reason).toBe('ASR_UNAVAILABLE'); // no whisper on this machine — honest
		expect(meas.response_latency_ms.reason).toBe('NOT_VALIDATED');
		// Stored chunk decrypts (test path) to ground-truth PCM
		const chunk0 = chunks.find((c) => c.chunk_index === 0);
		const pcm = await testDecrypt.decryptTestChunk(chunk0.object_key, 7, 103, 0);
		const verify = await observerSpeech.computeSpeechMeasurements(pcm, 48000, { transcript: { text: '' } });
		expect(Math.abs(verify.pitch_median_hz.value - 120)).toBeLessThanOrEqual(3);
	});

	test('T5: flag OFF mid-capture ⇒ teardown ≤2 s, flag_off outcome, CAPTURE_INCOMPLETE measurements', async () => {
		const job = seedSession(104, { testMarker: true });
		const parts = standardParticipants({ audioFrames: toneFrames(90), audioDelayMs: 15 });
		await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
		await sleep(600);
		expect(worker._getActiveCapture()?.sessionId).toBe(104);
		const flipAt = Date.now();
		delete process.env.OBSERVER_AUDIO_CAPTURE_ENABLED;
		await waitFor(() => mockState.outcomes.has(104), 4000, 'flag_off outcome');
		expect(Date.now() - flipAt).toBeLessThanOrEqual(2000);
		expect(mockState.outcomes.get(104).stop_reason).toBe('flag_off');
		const meas = await decryptMeasurements(104);
		expect(meas.speaking_time_sec.reason).toBe('CAPTURE_INCOMPLETE');
		expect(worker._getActiveCapture()).toBeNull();
	});

	test('T6: withdrawal mid-capture ⇒ stop, NO measurements, sweeper queues artefacts, DEK survives', async () => {
		const job = seedSession(105, { testMarker: true });
		const parts = standardParticipants({ audioFrames: toneFrames(35) });
		await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
		await waitFor(() => mockState.chunks.some((c) => c.interview_session_id === 105 && c.byte_size != null), 8000, 'chunk');
		mockState.sessions.get(105).config.biometric_collection = false;
		mockState.receipts.push({ interview_session_id: 105, candidate_id: 7, consent_type: 'biometric', granted_at: new Date(Date.now() - 60000), withdrawn_at: new Date(), consent_text_version: '1.0' });
		await waitFor(() => mockState.outcomes.has(105), 6000, 'withdrawn outcome');
		expect(mockState.outcomes.get(105).stop_reason).toBe('consent_withdrawn');
		expect(mockState.measurements.has(105)).toBe(false);
		const sweep = await observerCapture.sweepWithdrawnCaptureArtefacts({ pool: mockPool });
		expect(sweep.chunksQueued).toBeGreaterThanOrEqual(1);
		expect(mockState.chunks.filter((c) => c.interview_session_id === 105)).toHaveLength(0);
		expect(mockState.dekRows.get(7).destroyed_at).toBeNull();
	});

	test('T13: a second candidate identity publishing mid-capture ⇒ role_flip teardown', async () => {
		const job = seedSession(106, { testMarker: true });
		const parts = standardParticipants({});
		const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
		expect(worker._getActiveCapture()?.sessionId).toBe(106);
		const intruder = new FakeParticipant('candidate-999', []);
		const pub = new FakePublication(1, new FakeTrack(1, { offered: 10 }), intruder);
		pub.room = room;
		await room.emitPublished(pub, intruder);
		await waitFor(() => mockState.outcomes.has(106), 4000, 'role_flip outcome');
		expect(mockState.outcomes.get(106).stop_reason).toBe('role_flip');
	});

	test('concurrency cap: second capturing-eligible session stays dormant with a concurrency_cap outcome', async () => {
		const jobA = seedSession(108, { testMarker: true });
		const partsA = standardParticipants({});
		await runJob(jobA, [partsA.candidate, partsA.interviewer], pubsOf(partsA));
		expect(worker._getActiveCapture()?.sessionId).toBe(108);
		const jobB = seedSession(109, { testMarker: true });
		const partsB = standardParticipants({});
		await runJob(jobB, [partsB.candidate, partsB.interviewer], pubsOf(partsB));
		await sleep(200);
		expect(totalSubs(partsB)).toBe(0);
		expect(mockState.outcomes.get(109)?.stop_reason).toBe('concurrency_cap');
		mockState.sessions.get(108).status = 'completed';
		await waitFor(() => mockState.outcomes.has(108), 10000, 'A completes');
	});
});
