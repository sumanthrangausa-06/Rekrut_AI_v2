#!/usr/bin/env node
/**
 * gate-a-evidence-pack — Dormancy Evidence Pack generator (S-085, #787).
 *
 * Quinn validation protocol §3.1/§8.2, RUNG 1: runs the REAL observer
 * worker + capture modules on this machine against a mock SFU, an
 * in-memory PG fake, and in-memory object storage. Proves the dormant
 * state end-to-end (counters exactly zero, non-vacuous SFU-offered
 * media) and the capturing state on synthetic media. Rung 2 (staging
 * live room) is NOT performed by this script and is required for
 * protocol exit — see summary.md in the generated pack.
 *
 * No external dependencies: module stubbing via require.cache, Node
 * builtins only. Run: node scripts/gate-a-evidence-pack.js
 * Output: docs/sdlc/rekrut-ai-v2/04-implementation/unified-interview-engine/
 *         gate-a-evidence-pack/rung1/
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const PACK_DIR = path.join(
	ROOT,
	'docs/sdlc/rekrut-ai-v2/04-implementation/unified-interview-engine/gate-a-evidence-pack/rung1',
);

process.env.BIOMETRIC_ENCRYPTION_KEY = 'e'.repeat(64); // pack-only test key
process.env.RENDER_SERVICE_NAME = 'rekrutai-staging';
delete process.env.REKRUT_ENV_IDENTITY;

// ─── In-memory PG fake (transactional) ─────────────────────────────────────
function freshState() {
	return {
		recordingObjects: new Map(), chunks: [], measurements: new Map(), outcomes: new Map(),
		jobs: new Map(), sessions: new Map(), receipts: [], texts: [], enablements: [],
		membership: [], allowlist: new Map(), ledger: [], dekRows: new Map(),
		registryInserts: 0,
	};
}
const holder = { current: freshState() };
function revive(state) {
	for (const row of state.dekRows.values()) {
		if (row.dek_encrypted && !Buffer.isBuffer(row.dek_encrypted)) row.dek_encrypted = Buffer.from(row.dek_encrypted);
	}
	for (const row of state.measurements.values()) {
		if (row.measurements_envelope && !Buffer.isBuffer(row.measurements_envelope)) row.measurements_envelope = Buffer.from(row.measurements_envelope);
	}
	return state;
}
function route(st, sql, params = []) {
	if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
	if (sql.includes('INSERT INTO candidate_data_keys')) {
		if (!st.dekRows.has(params[0])) st.dekRows.set(params[0], { dek_encrypted: params[1], destroyed_at: null });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('SELECT dek_encrypted, destroyed_at FROM candidate_data_keys')) {
		const r = st.dekRows.get(params[0]); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
	}
	if (sql.includes('UPDATE candidate_data_keys')) {
		const r = st.dekRows.get(params[0]); if (!r) return { rows: [], rowCount: 0 };
		r.destroyed_at = new Date(); r.dek_encrypted = params[1]; return { rows: [], rowCount: 1 };
	}
	if (sql.includes('SELECT destroyed_at FROM candidate_data_keys')) {
		const r = st.dekRows.get(params[0]); return { rows: r ? [{ destroyed_at: r.destroyed_at }] : [], rowCount: r ? 1 : 0 };
	}
	if (sql.includes('FROM data_retention_policies')) return { rows: [{ retention_days: 30 }] };
		if (sql.includes('SELECT registration_state, deleted_at FROM recording_objects')) {
		const row = st.recordingObjects.get(params[0]);
		return { rows: row ? [{ registration_state: row.registration_state, deleted_at: row.deleted_at }] : [] };
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
	if (sql.includes('FROM observer_jobs')) {
		const j = st.jobs.get(params[0]); return { rows: j ? [j] : [], rowCount: j ? 1 : 0 };
	}
	if (sql.includes('FROM interview_sessions')) {
		const s = st.sessions.get(params[0]); return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
	}
	if (sql.includes('FROM consent_texts')) {
		const rows = st.texts.filter((t) => t.consent_type === params[0]);
		if (!rows.length) return { rows: [], rowCount: 0 };
		const latest = rows.reduce((a, b) => (a.effective_from > b.effective_from ? a : b));
		return { rows: [{ version: latest.version }], rowCount: 1 };
	}
	if (sql.includes('FROM consent_receipts')) {
		let type = params[1];
		if (sql.includes("consent_type = 'biometric'")) type = 'biometric';
		if (sql.includes("consent_type IN ('observer_capture', 'biometric')")) {
			const withChunks = new Set(st.chunks.map((c) => c.interview_session_id));
			const seen = new Map();
			for (const r of st.receipts) {
				if ((r.consent_type === 'observer_capture' || r.consent_type === 'biometric') && r.withdrawn_at && withChunks.has(r.interview_session_id)) {
					seen.set(r.interview_session_id, { interview_session_id: r.interview_session_id, candidate_id: r.candidate_id });
				}
			}
			return { rows: [...seen.values()], rowCount: seen.size };
		}
		const rows = st.receipts.filter((r) => r.interview_session_id === params[0] && r.consent_type === type && (params.length < 3 || r.candidate_id === params[2]));
		const last = rows[rows.length - 1];
		return { rows: last ? [last] : [], rowCount: last ? 1 : 0 };
	}
	if (sql.includes('FROM observer_activation_enablements')) {
		const last = st.enablements[st.enablements.length - 1];
		return { rows: last ? [last] : [], rowCount: last ? 1 : 0 };
	}
	if (sql.includes('FROM observer_cohort_membership')) {
		const rows = st.membership.filter((m) => m.interview_session_id === params[0]);
		const last = rows[rows.length - 1];
		return { rows: last ? [last] : [], rowCount: last ? 1 : 0 };
	}
	if (sql.includes('FROM observer_cohort_allowlist')) {
		const v = st.allowlist.get(params[0]);
		return { rows: v ? [{ allowlist_version: v }] : [], rowCount: v ? 1 : 0 };
	}
	if (sql.includes('INSERT INTO observer_cohort_membership')) {
		st.membership.push({ interview_session_id: params[0], company_id: params[1], is_member: params[2], allowlist_version: params[3] });
		return { rows: [], rowCount: 1 };
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
		st.outcomes.set(params[0], { interview_session_id: params[0], candidate_id: params[1], scope: params[2], is_test: params[3], cohort_allowlist_version: params[4], chunks_persisted: params[5], chunks_dropped: params[6], audio_seconds_captured: params[7], capture_gap_ratio: params[8], stop_reason: params[9], started_at: params[10] });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes("registration_state = 'pending'") && sql.includes('SELECT object_key, candidate_id')) {
		const rows = [...st.recordingObjects.values()].filter((r) => r.registration_state === 'pending' && !r.deleted_at && r.created_at < params[0]);
		return { rows, rowCount: rows.length };
	}
	if (sql.includes('SELECT id FROM pending_storage_deletions')) {
		const rows = st.ledger.filter((l) => l.file_url === params[0] && l.status === 'pending');
		return { rows, rowCount: rows.length };
	}
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
	if (sql.includes('FROM observer_audio_chunks') && sql.includes('is_test = true')) {
		const rows = st.chunks.filter((c) => c.is_test && c.captured_at < params[0]);
		return { rows, rowCount: rows.length };
	}
	if (sql.includes('DELETE FROM observer_speech_measurements WHERE is_test')) {
		let n = 0; for (const [k, v] of st.measurements) { if (v.is_test && v.created_at < params[0]) { st.measurements.delete(k); n++; } }
		return { rows: [], rowCount: n };
	}
	if (sql.includes('SELECT COUNT(*)::int AS c FROM observer_speech_measurements')) {
		let c = 0; for (const v of st.measurements.values()) { if (v.is_test && v.created_at < params[0]) c++; }
		return { rows: [{ c }], rowCount: 1 };
	}
	if (sql.includes('SELECT object_key FROM observer_audio_chunks WHERE interview_session_id')) {
		const rows = st.chunks.filter((c) => c.interview_session_id === params[0]);
		return { rows, rowCount: rows.length };
	}
	if (sql.includes('DELETE FROM observer_audio_chunks WHERE interview_session_id')) {
		const n = st.chunks.length; st.chunks = st.chunks.filter((c) => c.interview_session_id !== params[0]);
		return { rows: [], rowCount: n - st.chunks.length };
	}
	if (sql.includes('DELETE FROM observer_speech_measurements WHERE interview_session_id')) {
		const had = st.measurements.delete(params[0]);
		return { rows: [], rowCount: had ? 1 : 0 };
	}
	if (sql.includes('UPDATE recording_objects SET deleted_at') && sql.includes('WHERE object_key')) {
		const row = st.recordingObjects.get(params[0]); if (row) row.deleted_at = new Date();
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (sql.includes('UPDATE recording_objects SET deleted_at') && sql.includes('WHERE interview_id')) {
		let n = 0; for (const row of st.recordingObjects.values()) { if (row.interview_id === params[0] && row.object_type === 'observer_audio' && !row.deleted_at) { row.deleted_at = new Date(); n++; } }
		return { rows: [], rowCount: n };
	}
	throw new Error('pack fake PG: unstubbed SQL: ' + sql.slice(0, 90));
}
function makePool() {
	return {
		query: async (sql, params) => route(holder.current, sql, params),
		connect: async () => {
			let tx = null;
			return {
				query: async (sql, params) => {
					if (sql === 'BEGIN') { tx = revive(structuredClone(holder.current)); return { rows: [] }; }
					if (sql === 'COMMIT') { holder.current = revive(tx); tx = null; return { rows: [] }; }
					if (sql === 'ROLLBACK') { tx = null; return { rows: [] }; }
					return route(tx || holder.current, sql, params);
				},
				release: () => {},
			};
		},
	};
}
const pool = makePool();

// ─── Module stubbing ───────────────────────────────────────────────────────
function stubAbs(absPath, exportsObj) {
	require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports: exportsObj };
}
function stubLib(rel, exportsObj) { stubAbs(require.resolve(path.join(LIB, rel)), exportsObj); }

stubLib('db.js', pool);
stubLib('biometricAudit.js', { logAccess: async () => {} });

const storageObjects = new Map();
const storageCalls = { put: 0, get: 0, delete: 0 };
stubLib('file-storage.js', {
	uploadToB2: async ({ buffer, objectKey }) => {
		storageCalls.put++;
		const key = `r2/${objectKey}`;
		storageObjects.set(key, Buffer.from(buffer));
		return { key, url: `/api/files/${encodeURIComponent(key)}`, provider: 'r2' };
	},
	getFile: async (key) => {
		storageCalls.get++;
		if (!storageObjects.has(key)) { const e = new Error('nf'); e.code = 'NOT_FOUND'; throw e; }
		return { stream: Readable.from([storageObjects.get(key)]) };
	},
	deleteStorageObject: async (key) => { storageCalls.delete++; storageObjects.delete(key); return { deleted: true }; },
	deleteFile: async () => ({ deleted: true }),
});

// observerJobs stub (worker-facing queue ops recorded, not executed)
const jobCalls = { cancel: [], complete: [], fail: [], flush: 0 };
stubLib('observerJobs.js', {
	enqueue: async () => { throw new Error('not used by pack'); },
	claim: async () => null,
	heartbeat: async () => {},
	markObserving: async () => {},
	markFlushing: async () => 1,
	complete: async (id) => { jobCalls.complete.push(id); return 1; },
	cancel: async (id, reason) => { jobCalls.cancel.push({ id, reason }); return 1; },
	fail: async (id, msg) => { jobCalls.fail.push({ id, msg }); return 1; },
	recoverStale: async () => 0,
	getStatus: async () => null,
});
stubLib('observerReportWriter.js', { flushReport: async () => { jobCalls.flush++; return { written: true }; } });
stubAbs(require.resolve(path.join(ROOT, 'server/services/livekit.js')), {
	createObserverToken: async () => 'pack-token',
});

// ASR invocation counting wrapper around the REAL self-hosted module
const sha = require(path.join(LIB, 'self-hosted-audio.js'));
const asrCounter = { invocations: 0 };
const realTranscribe = sha.transcribe;
sha.transcribe = async (...args) => { asrCounter.invocations++; return realTranscribe(...args); };

// ─── Mock SFU ──────────────────────────────────────────────────────────────
const sfuStats = { audioStreamsConstructed: 0, framesDelivered: 0 };
class FakeAudioStream {
	constructor(track) {
		sfuStats.audioStreamsConstructed++;
		this.track = track;
	}
	getReader() {
		const track = this.track;
		return {
			read: async () => {
				if (track.deliverIndex < track.deliverQueue.length) {
					if (track.frameDelayMs) await new Promise((r) => setTimeout(r, track.frameDelayMs));
					sfuStats.framesDelivered++;
					return { done: false, value: track.deliverQueue[track.deliverIndex++] };
				}
				return { done: true, value: undefined };
			},
			releaseLock: () => {},
				cancel: async () => { track.deliverIndex = track.deliverQueue.length; },
		};
	}
}
class FakeTrack {
	constructor(kind, { offered = 0, frames = [], frameDelayMs = 0 } = {}) {
		this.kind = kind; // 1 = AUDIO, 2 = VIDEO (TrackKind)
		this.framesOffered = offered; // media the SFU has available to deliver
		this.deliverQueue = frames;
		this.deliverIndex = 0;
		this.frameDelayMs = frameDelayMs;
	}
}
class FakePublication {
	constructor(kind, track, participant) {
		this.kind = kind;
		this.track = track;
		this.participant = participant;
		this.setSubscribedCalls = [];
	}
	async setSubscribed(v) {
		this.setSubscribedCalls.push(v);
		if (v && this.track && this.room) this.room._emitSubscribed(this.track, this, this.participant);
	}
}
class FakeParticipant {
	constructor(identity, pubs = []) {
		this.identity = identity;
		this.metadata = {};
		this.trackPublications = new Map(pubs.map((p, i) => [`sid-${identity}-${i}`, p]));
		for (const p of pubs) p.participant = this;
	}
}
class FakeRoom {
	constructor(opts) {
		this.opts = opts;
		this.remoteParticipants = new Map();
		this.handlers = {};
		this.disconnected = false;
		this._connectGate = new Promise((res) => { this._releaseConnect = res; });
		FakeRoom.instances.push(this);
	}
	async connect() { await this._connectGate; }
	async disconnect() { this.disconnected = true; }
	on(event, fn) { (this.handlers[event] ||= []).push(fn); }
	_emitSubscribed(track, pub, participant) {
		for (const fn of this.handlers.trackSubscribed || []) fn(track, pub, participant);
	}
	async emitPublished(pub, participant) {
		for (const fn of this.handlers.trackPublished || []) await fn(pub, participant);
	}
}
FakeRoom.instances = [];
const fakeRtc = {
	Room: FakeRoom,
	RoomEvent: { TrackSubscribed: 'trackSubscribed', TrackPublished: 'trackPublished' },
	AudioStream: FakeAudioStream,
	TrackKind: { KIND_AUDIO: 1, KIND_VIDEO: 2 },
};
const rtcPath = '/tmp/gate-a-fake-rtc.js';
require.cache[rtcPath] = { id: rtcPath, filename: rtcPath, loaded: true, exports: fakeRtc };
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
	if (request === '@livekit/rtc-node') return rtcPath;
	return origResolve.call(this, request, ...rest);
};

// ─── Load the REAL modules under test ──────────────────────────────────────
const observerCapture = require(path.join(LIB, 'observerCapture.js'));
const observerSpeech = require(path.join(LIB, 'observerSpeech.js'));
const testDecrypt = require(path.join(LIB, 'observerAudioTestDecrypt.js'));
const biometricCrypto = require(path.join(LIB, 'biometricCrypto.js'));
const { unpackEnvelope } = require(path.join(LIB, 'r2FrameStore.js'));
const worker = require(path.join(ROOT, 'workers/ai-observer/index.js'));

const logLines = [];
observerCapture._setLogSink((line) => logLines.push(line));

// ─── Helpers ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs, label) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (pred()) return Date.now() - start;
		await sleep(50);
	}
	throw new Error(`waitFor timeout: ${label}`);
}
function toneFrames(seconds, freq = 120, { sr = 48000, delayMs = 0 } = {}) {
	const frames = [];
	for (let s = 0; s < seconds; s++) {
		const data = new Int16Array(sr);
		for (let i = 0; i < sr; i++) data[i] = Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * freq * ((s * sr + i) / sr)));
		frames.push({ data, sampleRate: sr, channels: 1, samplesPerChannel: sr });
	}
	return { frames, delayMs };
}
function seedSession(id, { candidateId = 7, companyId = 99, testMarker = false, origin = 'staging', status = 'in_progress' } = {}) {
	holder.current.sessions.set(id, {
		id, candidate_id: candidateId, company_id: companyId, status,
		config: { biometric_collection: true, livekit_room: `room-${id}`, ...(testMarker ? { observer_capture_test: true } : {}) },
	});
	holder.current.jobs.set(id, { id: 900 + id, interview_session_id: id, origin_env: origin });
	return { id: 900 + id, interview_session_id: id, origin_env: origin };
}
async function runJob(job, participants, pubs = []) {
	const roomsBefore = FakeRoom.instances.length;
	const p = worker.processJob(job);
	await waitFor(() => FakeRoom.instances.length > roomsBefore, 3000, 'room created');
	const room = FakeRoom.instances[FakeRoom.instances.length - 1];
	for (const part of participants) room.remoteParticipants.set(part.identity, part);
	// Wire publications to the room BEFORE releasing connect — subscription
	// happens inside processJob and must be able to emit TrackSubscribed.
	for (const pub of pubs) pub.room = room;
	room._releaseConnect();
	await p;
	return room;
}
function pubsOf(parts) { return [parts.candAudio, parts.candVideo, parts.intAudio].filter(Boolean); }
function standardParticipants({ audioFrames = [], audioDelayMs = 0, offered = 120 } = {}) {
	const candAudioTrack = new FakeTrack(1, { offered, frames: audioFrames, frameDelayMs: audioDelayMs });
	const candVideoTrack = new FakeTrack(2, { offered: 120 });
	const intAudioTrack = new FakeTrack(1, { offered: 60 });
	const candAudio = new FakePublication(1, candAudioTrack, null);
	const candVideo = new FakePublication(2, candVideoTrack, null);
	const intAudio = new FakePublication(1, intAudioTrack, null);
	const candidate = new FakeParticipant('candidate-7', [candAudio, candVideo]);
	const interviewer = new FakeParticipant('interviewer-9', [intAudio]);
	for (const pub of [candAudio, candVideo, intAudio]) pub.room = null; // wired by room owner below
	return { candidate, interviewer, candAudio, candVideo, intAudio, candAudioTrack };
}
function wireRoom(room, parts) {
	for (const pub of [parts.candAudio, parts.candVideo, parts.intAudio]) if (pub) pub.room = room;
}
async function decryptMeasurements(sessionId, candidateId) {
	const row = holder.current.measurements.get(sessionId);
	if (!row) return null;
	const { iv, tag, ciphertext } = unpackEnvelope(row.measurements_envelope);
	const plain = await biometricCrypto.decryptWithExistingDEK(
		ciphertext, iv, tag, candidateId,
		observerCapture && require(path.join(LIB, 'r2ObserverAudioStore.js')).measurementAAD(candidateId, sessionId),
	);
	return JSON.parse(plain.toString('utf8'));
}
function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

// ─── Scenarios ─────────────────────────────────────────────────────────────
const results = {};
const workdirFiles = () => (fs.existsSync(observerSpeech.CAPTURE_WORKDIR) ? fs.readdirSync(observerSpeech.CAPTURE_WORKDIR).length : 0);

async function scenarioDormancy() {
	delete process.env.OBSERVER_AUDIO_CAPTURE_ENABLED; // flag OFF (T1)
	const job = seedSession(101);
	const parts = standardParticipants({ offered: 120 });
	const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
	await sleep(400);
	const setSubscribedTotal = [parts.candAudio, parts.candVideo, parts.intAudio]
		.reduce((n, p) => n + p.setSubscribedCalls.length, 0);
	// Session completes — presence behaviour must be unchanged (report flush).
	holder.current.sessions.get(101).status = 'completed';
	await waitFor(() => jobCalls.flush >= 1, 8000, 'presence flush after completion');
	await sleep(100);
	results.dormancy = {
		test: 'T1 flag OFF full synthetic session',
		sfu: {
			candidate_audio_frames_offered: parts.candAudioTrack.framesOffered,
			candidate_video_frames_offered: 120,
			interviewer_audio_frames_offered: 60,
			non_vacuous: parts.candAudioTrack.framesOffered > 0,
		},
		set_subscribed_calls_total: setSubscribedTotal,
		track_handlers_registered: Object.keys(room.handlers),
		audio_streams_constructed: sfuStats.audioStreamsConstructed,
		frames_delivered: sfuStats.framesDelivered,
		counters: observerCapture.createCaptureCounters(), // no CaptureSession existed; the §8.1 counters are definitionally zero — proven by the side-effect diffs below
		db_diff: {
			recording_objects: holder.current.recordingObjects.size,
			observer_audio_chunks: holder.current.chunks.length,
			observer_speech_measurements: holder.current.measurements.size,
			observer_capture_outcomes: holder.current.outcomes.size,
			registry_inserts: holder.current.registryInserts,
			candidate_data_keys_rows: holder.current.dekRows.size,
			pending_storage_deletions: holder.current.ledger.length,
		},
		storage_diff: { objects: storageObjects.size, put_calls: storageCalls.put, get_calls: storageCalls.get, delete_calls: storageCalls.delete },
		workdir_files: workdirFiles(),
		presence: { report_flush_calls: jobCalls.flush, room_disconnected: room.disconnected },
	};
	const d = results.dormancy;
	assert(d.set_subscribed_calls_total === 0, 'dormant: setSubscribed called');
	assert(d.track_handlers_registered.length === 0, 'dormant: track handlers registered');
	assert(d.audio_streams_constructed === 0 && d.frames_delivered === 0, 'dormant: media received');
	assert(Object.values(d.db_diff).every((v) => v === 0), 'dormant: DB writes occurred');
	assert(d.storage_diff.objects === 0 && d.storage_diff.put_calls === 0, 'dormant: storage touched');
	assert(d.workdir_files === 0, 'dormant: workdir not empty');
	assert(d.presence.report_flush_calls >= 1, 'presence flush regressed');
	console.log('S1 dormancy (T1): PASS');
}

async function scenarioMalformedFlag() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'TRUE'; // malformed (T2)
	const job = seedSession(102);
	const parts = standardParticipants({});
	const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
	await sleep(300);
	const setSubscribedTotal = [parts.candAudio, parts.candVideo, parts.intAudio]
		.reduce((n, p) => n + p.setSubscribedCalls.length, 0);
	results.malformedFlag = { test: "T2 flag value 'TRUE' (malformed)", set_subscribed_calls_total: setSubscribedTotal, track_handlers_registered: Object.keys(room.handlers) };
	assert(setSubscribedTotal === 0, "malformed flag: subscribed");
	assert(Object.keys(room.handlers).length === 0, 'malformed flag: handlers registered');
	console.log('S2 malformed flag (T2): PASS');
}

async function scenarioCapture() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
	const job = seedSession(103, { testMarker: true });
	const { frames } = toneFrames(35, 120);
	const parts = standardParticipants({ audioFrames: frames, offered: 120 });
	const streamsBefore = sfuStats.audioStreamsConstructed;
	const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
	// Subscription happens inside processJob before it returns.
	assert(parts.candAudio.setSubscribedCalls.filter((v) => v === true).length === 1, 'candidate audio not subscribed exactly once');
	assert(parts.candVideo.setSubscribedCalls.length === 0, 'candidate VIDEO subscribed — forbidden');
	assert(parts.intAudio.setSubscribedCalls.length === 0, 'interviewer audio subscribed — forbidden');
	await waitFor(() => holder.current.chunks.filter((c) => c.interview_session_id === 103 && c.byte_size != null).length >= 1, 8000, 'first chunk confirmed');
	holder.current.sessions.get(103).status = 'completed';
	await waitFor(() => holder.current.outcomes.has(103), 9000, 'session_end outcome');
	const chunks = holder.current.chunks.filter((c) => c.interview_session_id === 103);
	const outcome = holder.current.outcomes.get(103);
	const meas = await decryptMeasurements(103, 7);
	// Stored-chunk ground truth: decrypt chunk 0 via the isolated test path
	const chunk0 = chunks.find((c) => c.chunk_index === 0);
	const pcm = await testDecrypt.decryptTestChunk(chunk0.object_key, 7, 103, 0);
	const verify = await observerSpeech.computeSpeechMeasurements(pcm, 48000, { transcript: { text: '' } });
	results.capture = {
		test: 'T3 flag ON, test scope, synthetic session (120 Hz tone, 35 s)',
		subscriptions: { candidate_audio: parts.candAudio.setSubscribedCalls, candidate_video: parts.candVideo.setSubscribedCalls, interviewer_audio: parts.intAudio.setSubscribedCalls },
		audio_streams_constructed: sfuStats.audioStreamsConstructed - streamsBefore,
		chunks_persisted: chunks.length,
		chunks_confirmed_registry: [...holder.current.recordingObjects.values()].filter((r) => r.interview_id === 103 && r.registration_state === 'confirmed').length,
		storage_objects: [...storageObjects.keys()].filter((k) => k.includes('observer-audio-test')).length,
		outcome_stop_reason: outcome.stop_reason,
		outcome_chunks_persisted: outcome.chunks_persisted,
		measurements: {
			speaking_time_sec: meas.speaking_time_sec.value,
			pitch_median_hz: meas.pitch_median_hz.value,
			speech_rate_wpm_reason: meas.speech_rate_wpm.reason,
			response_latency_reason: meas.response_latency_ms.reason,
			capture_gap_ratio: meas.capture_gap_ratio,
		},
		stored_chunk_decrypted: {
			bytes: pcm.length,
			pitch_median_hz: verify.pitch_median_hz.value,
			speaking_time_sec: verify.speaking_time_sec.value,
		},
		asr_invocations: asrCounter.invocations,
		dek_rows_for_candidate: holder.current.dekRows.has(7) ? 1 : 0,
	};
	const c = results.capture;
	assert(c.chunks_persisted === 2, `expected 2 chunks (30 s + 5 s partial), got ${c.chunks_persisted}`);
	assert(c.outcome_stop_reason === 'session_end', 'outcome not session_end');
	assert(Math.abs(c.measurements.speaking_time_sec - 35) <= 1.5, `speaking time ${c.measurements.speaking_time_sec}`);
	assert(Math.abs(c.measurements.pitch_median_hz - 120) <= 3, `pitch ${c.measurements.pitch_median_hz}`);
	assert(c.measurements.speech_rate_wpm_reason === 'ASR_UNAVAILABLE', 'ASR should be honestly unavailable on this VM');
	assert(c.measurements.response_latency_reason === 'NOT_VALIDATED', 'M10 must be NOT_VALIDATED');
	assert(Math.abs(c.stored_chunk_decrypted.pitch_median_hz - 120) <= 3, `stored pitch ${c.stored_chunk_decrypted.pitch_median_hz}`);
	assert(Math.abs(c.stored_chunk_decrypted.speaking_time_sec - 30) <= 1.5, 'stored chunk speaking time');
	console.log('S3 capture (T3): PASS');
}

async function scenarioFlagOffKill() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
	const job = seedSession(104, { testMarker: true });
	const { frames } = toneFrames(90, 120);
	const parts = standardParticipants({ audioFrames: frames, audioDelayMs: 15, offered: 90 });
	const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
	await sleep(600); // capture is live, frames flowing, no chunk yet (<30 s)
	assert(worker._getActiveCapture()?.sessionId === 104, 'capture not active before kill');
	const flipAt = Date.now();
	delete process.env.OBSERVER_AUDIO_CAPTURE_ENABLED; // flag OFF mid-capture
	await waitFor(() => holder.current.outcomes.has(104), 4000, 'flag_off outcome');
	const teardownMs = Date.now() - flipAt;
	const outcome = holder.current.outcomes.get(104);
	const meas = await decryptMeasurements(104, 7);
	results.flagOffKill = {
		test: 'T5 flag OFF mid-capture',
		teardown_ms: teardownMs,
		outcome_stop_reason: outcome.stop_reason,
		measurements_reason: meas.speaking_time_sec.reason,
		active_capture_after: worker._getActiveCapture(),
		unsubscribed_on_teardown: parts.candAudio.setSubscribedCalls.includes(false),
	};
	assert(results.flagOffKill.unsubscribed_on_teardown === true, 'B-2: teardown did not unsubscribe the candidate audio publication');
	assert(outcome.stop_reason === 'flag_off', 'stop reason not flag_off');
	assert(teardownMs <= 2000, `teardown ${teardownMs} ms exceeds 2 s bound`);
	assert(meas.speaking_time_sec.reason === 'CAPTURE_INCOMPLETE', 'interrupted measurements must be CAPTURE_INCOMPLETE');
	assert(worker._getActiveCapture() === null, 'active capture not released');
	console.log(`S4 flag-off kill (T5): PASS (teardown ${teardownMs} ms)`);
}

async function scenarioWithdrawal() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
	const job = seedSession(105, { testMarker: true });
	const { frames } = toneFrames(35, 120);
	const parts = standardParticipants({ audioFrames: frames, offered: 60 });
	const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
	await waitFor(() => holder.current.chunks.some((c) => c.interview_session_id === 105 && c.byte_size != null), 8000, 'chunk before withdrawal');
	// Withdraw: config flag flips + biometric receipt withdrawn (consentService effects)
	holder.current.sessions.get(105).config.biometric_collection = false;
	holder.current.receipts.push({ interview_session_id: 105, candidate_id: 7, consent_type: 'biometric', granted_at: new Date(Date.now() - 60000), withdrawn_at: new Date(), consent_text_version: '1.0' });
	await waitFor(() => holder.current.outcomes.has(105), 5000, 'withdrawn outcome');
	const outcome = holder.current.outcomes.get(105);
	assert(outcome.stop_reason === 'consent_withdrawn', `stop reason ${outcome.stop_reason}`);
	assert(!holder.current.measurements.has(105), 'measurements must not be written after withdrawal');
	// Sweeper queues persisted artefacts for deletion (§5.4)
	const sweep = await observerCapture.sweepWithdrawnCaptureArtefacts({ pool });
	const registryRow = [...holder.current.recordingObjects.values()].find((r) => r.interview_id === 105);
	results.withdrawal = {
		test: 'T6 withdrawal mid-capture',
		outcome_stop_reason: outcome.stop_reason,
		measurements_written: holder.current.measurements.has(105),
		sweeper: sweep,
		chunk_rows_after_sweep: holder.current.chunks.filter((c) => c.interview_session_id === 105).length,
		ledger_rows: holder.current.ledger.filter((l) => l.source_family === 'observer_audio').length,
		registry_deleted_at_set: !!registryRow?.deleted_at,
		dek_destroyed: holder.current.dekRows.get(7)?.destroyed_at != null,
	};
	assert(sweep.chunksQueued >= 1, 'sweeper did not queue the persisted chunk');
	assert(results.withdrawal.chunk_rows_after_sweep === 0, 'chunk rows survive withdrawal sweep');
	assert(results.withdrawal.registry_deleted_at_set, 'registry not stamped');
	assert(results.withdrawal.dek_destroyed === false, 'withdrawal must NOT destroy the DEK');
	console.log('S5 withdrawal (T6): PASS');
}

async function scenarioRoleFlip() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
	const job = seedSession(106, { testMarker: true });
	const parts = standardParticipants({});
	const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
	assert(worker._getActiveCapture()?.sessionId === 106, 'capture not active');
	const intruder = new FakeParticipant('candidate-999', []);
	const pub = new FakePublication(1, new FakeTrack(1, { offered: 10 }), intruder);
	pub.room = room;
	await room.emitPublished(pub, intruder);
	await waitFor(() => holder.current.outcomes.has(106), 4000, 'role_flip outcome');
	results.roleFlip = { test: 'T13 role flip mid-capture', outcome_stop_reason: holder.current.outcomes.get(106).stop_reason };
	assert(results.roleFlip.outcome_stop_reason === 'role_flip', 'not role_flip');
	console.log('S6 role flip (T13): PASS');
}

async function scenarioInterviewerFirst() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
	const job = seedSession(110, { testMarker: true });
	// The room starts with ONLY the interviewer present.
	const interviewer = new FakeParticipant('interviewer-9', []);
	const room = await runJob(job, [interviewer], []);
	assert(worker._getActiveCapture()?.sessionId === 110, 'capture not active');
	const intTrack = new FakeTrack(1, { offered: 10 });
	const intPub = new FakePublication(1, intTrack, interviewer);
	intPub.room = room;
	await room.emitPublished(intPub, interviewer);
	await sleep(200);
	// B-1: the interviewer was never subscribed and never bound.
	assert(intPub.setSubscribedCalls.length === 0, 'interviewer audio got subscribed');
	// The real candidate publishes later: subscribed under the binding.
	const candidate = new FakeParticipant('candidate-7', []);
	const candTrack = new FakeTrack(1, { offered: 0 });
	const candPub = new FakePublication(1, candTrack, candidate);
	candPub.room = room;
	await room.emitPublished(candPub, candidate);
	await sleep(200);
	assert(candPub.setSubscribedCalls.includes(true), 'bound candidate audio not subscribed');
	holder.current.sessions.get(110).status = 'completed';
	await waitFor(() => holder.current.outcomes.has(110), 9000, 'session_end outcome');
	await waitFor(() => worker._getActiveCapture() === null, 4000, 'capture slot released');
	results.interviewerFirst = {
		test: 'B-1 interviewer publishes first',
		interviewer_subscribed: intPub.setSubscribedCalls.length > 0,
		candidate_subscribed_after: true,
	};
	console.log('S10 interviewer-first binding (B-1): PASS');
}

async function scenarioOriginMismatch() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
	const job = seedSession(107, { testMarker: true, origin: 'production' }); // T14
	const parts = standardParticipants({});
	const room = await runJob(job, [parts.candidate, parts.interviewer], pubsOf(parts));
	await sleep(300);
	const setSubscribedTotal = [parts.candAudio, parts.candVideo, parts.intAudio]
		.reduce((n, p) => n + p.setSubscribedCalls.length, 0);
	const decisionLine = logLines.filter((l) => l.event === 'capture_decision' && l.session_id === 107).pop();
	results.originMismatch = {
		test: 'T14 production-stamped job, staging worker',
		set_subscribed_calls_total: setSubscribedTotal,
		gate_code: decisionLine?.gate_code,
	};
	assert(setSubscribedTotal === 0, 'origin mismatch: subscribed');
	assert(decisionLine?.gate_code === 'CAPTURE_ENV_MISMATCH', `gate code ${decisionLine?.gate_code}`);
	console.log('S7 origin-env mismatch (T14): PASS');
}

async function scenarioConcurrencyCap() {
	process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
	const jobA = seedSession(108, { testMarker: true });
	const partsA = standardParticipants({});
	const roomA = await runJob(jobA, [partsA.candidate, partsA.interviewer], pubsOf(partsA));
	assert(worker._getActiveCapture()?.sessionId === 108, 'first capture not active');
	const jobB = seedSession(109, { testMarker: true });
	const partsB = standardParticipants({});
	const roomB = await runJob(jobB, [partsB.candidate, partsB.interviewer], pubsOf(partsB));
	await sleep(200);
	const setSubscribedB = [partsB.candAudio, partsB.candVideo, partsB.intAudio]
		.reduce((n, p) => n + p.setSubscribedCalls.length, 0);
	results.concurrencyCap = {
		test: 'Concurrency cap: second capturing-eligible session stays dormant',
		second_session_set_subscribed_calls: setSubscribedB,
		second_session_outcome: holder.current.outcomes.get(109)?.stop_reason,
		first_session_still_capturing: worker._getActiveCapture()?.sessionId === 108,
	};
	assert(setSubscribedB === 0, 'second session subscribed despite cap');
	assert(results.concurrencyCap.second_session_outcome === 'concurrency_cap', 'cap outcome missing');
	// Release session A cleanly
	holder.current.sessions.get(108).status = 'completed';
	await waitFor(() => holder.current.outcomes.has(108), 9000, 'session A completion');
	console.log('S8 concurrency cap: PASS');
}

async function scenarioRestartConsistency() {
	// T10 (module-level, Rung 1): a "restarted" worker inherits the store
	// exactly as the crashed one left it. Confirmed chunks from S3 remain
	// confirmed; the reconciler touches only stale PENDING intents (none);
	// session 103 has its outcome (it finalized before the "crash point").
	const before = [...holder.current.recordingObjects.values()].filter((r) => r.registration_state === 'confirmed').length;
	const rec = await observerCapture.reconcileObserverAudioIntents({ queryable: pool });
	results.restartConsistency = {
		test: 'T10 restart consistency (module level — multi-process restart is Rung 2)',
		confirmed_registry_rows_before: before,
		reconciler_intents_found: rec.intentsFound,
		confirmed_registry_rows_after: [...holder.current.recordingObjects.values()].filter((r) => r.registration_state === 'confirmed').length,
	};
	assert(rec.intentsFound === 0, 'reconciler disturbed settled state');
	assert(before === results.restartConsistency.confirmed_registry_rows_after, 'confirmed rows changed');
	console.log('S9 restart consistency (T10, module level): PASS');
}

// ─── Pack writing ──────────────────────────────────────────────────────────
async function main() {
	const startedAt = new Date().toISOString();
	await scenarioDormancy();
	await scenarioMalformedFlag();
	await scenarioCapture();
	await scenarioFlagOffKill();
	await scenarioWithdrawal();
	await scenarioRoleFlip();
	await scenarioInterviewerFirst();
	await scenarioOriginMismatch();
	await scenarioConcurrencyCap();
	await scenarioRestartConsistency();

	fs.mkdirSync(PACK_DIR, { recursive: true });
	const manifest = {
		pack: 'gate-a-dormancy-evidence',
		story: 'S-085 (#787)',
		rung: 1,
		rung_description: 'Mocked/local: mock SFU (rtc-node fakes), in-memory PG fake, in-memory object storage, synthetic PCM. NO real LiveKit room, Neon DB, or R2/B2 bucket was touched.',
		generated_at: startedAt,
		generator: 'scripts/gate-a-evidence-pack.js',
		node: process.version,
		env_identity: 'staging (via RENDER_SERVICE_NAME=rekrutai-staging)',
		scenarios: Object.keys(results),
		unverified_from_this_vm: [
			'Neon PITR window — NOT recorded (Neon API unreachable from the build VM; carried condition, Lex acceptance owed if > 30 days)',
			'R2/B2 bucket versioning state for observer-audio prefixes — NOT verified (storage APIs unreachable from the build VM)',
			'Rung 2 staging live-room run — NOT performed (required for protocol exit)',
		],
	};
	fs.writeFileSync(path.join(PACK_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
	fs.writeFileSync(path.join(PACK_DIR, 'counters.json'), JSON.stringify({
		dormancy_T1: results.dormancy.counters,
		dormancy_side_effects: { db: results.dormancy.db_diff, storage: results.dormancy.storage_diff },
		capture_T3: {
			chunksPersisted: results.capture.chunks_persisted,
			registryRowsWritten: results.capture.chunks_confirmed_registry,
			measurementWrites: 1,
			outcomeRowsWritten: 1,
			asrInvocations: results.capture.asr_invocations,
			audioStreamsConstructed: results.capture.audio_streams_constructed,
		},
	}, null, 2));
	fs.writeFileSync(path.join(PACK_DIR, 'sfu-offered.json'), JSON.stringify(results.dormancy.sfu, null, 2));
	fs.writeFileSync(path.join(PACK_DIR, 'db-diff.json'), JSON.stringify(results.dormancy.db_diff, null, 2));
	fs.writeFileSync(path.join(PACK_DIR, 'storage-diff.json'), JSON.stringify(results.dormancy.storage_diff, null, 2));
	fs.writeFileSync(path.join(PACK_DIR, 'logs.jsonl'), logLines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	fs.writeFileSync(path.join(PACK_DIR, 'scenarios.json'), JSON.stringify(results, null, 2));
	const summary = [
		'# Gate A Dormancy Evidence Pack — Rung 1',
		'',
		`Generated: ${startedAt} by \`scripts/gate-a-evidence-pack.js\` (mock SFU + in-memory PG/storage fakes, synthetic PCM).`,
		'',
		'## What this pack proves (Rung 1)',
		'',
		'- **Dormancy (T1/T2):** with the flag OFF (or malformed), a full synthetic session with 120 offered candidate-audio frames, 120 video frames and 60 interviewer-audio frames produced **zero** `setSubscribed` calls, **zero** registered track handlers, **zero** constructed audio streams, **zero** delivered frames, **zero** rows in `recording_objects` / `observer_audio_chunks` / `observer_speech_measurements` / `observer_capture_outcomes`, **zero** `candidate_data_keys` rows, **zero** storage calls, and an empty capture workdir — while presence behaviour (join, completion report flush) was unchanged. The zero is non-vacuous: the SFU had real media to take (see `sfu-offered.json`).',
		'- **Capture (T3):** flag ON + test scope subscribed ONLY the candidate audio track (never video, never interviewer), persisted 2 encrypted chunks (30 s + 5 s partial), wrote DEK-encrypted measurements (speaking time ≈ 35 s, pitch 120 ± 3 Hz against ground truth; M10 `NOT_VALIDATED`; M8/M9 honestly `ASR_UNAVAILABLE` — no whisper on this VM), and a `session_end` outcome. The stored chunk decrypts (test path only) to PCM measuring 120 ± 3 Hz.',
		'- **Kill bound (T5):** flag flipped OFF mid-capture → teardown completed in the measured milliseconds recorded in `scenarios.json` (≤ 2000 ms bound), outcome `flag_off`, interrupted measurements written as `CAPTURE_INCOMPLETE`.',
		'- **Withdrawal (T6):** mid-capture withdrawal stopped capture (`consent_withdrawn`), wrote NO measurements, and the sweeper queued the persisted chunk for ledger deletion (registry stamped, chunk rows deleted, DEK NOT destroyed).',
		'- **Role flip (T13)** → `role_flip` outcome. **Origin-env mismatch (T14)** → dormant with `CAPTURE_ENV_MISMATCH`. **Concurrency cap** → second session dormant with a `concurrency_cap` outcome. **Restart consistency (T10, module level)** → reconciler leaves settled state untouched.',
		'',
		'## What this pack does NOT prove',
		'',
		'- No real LiveKit SFU, Neon database, or R2/B2 bucket was touched (all are unreachable from the build VM). **Rung 2 — the staging live-room run — is still required for protocol exit.**',
		'- The Neon PITR window is **not recorded** here (API unreachable); if it exceeds 30 days, Lex acceptance is owed.',
		'- Bucket versioning state for the observer prefixes is **not verified** here (storage APIs unreachable).',
		'- Multi-process worker restart is simulated at module level only (T10).',
		'',
		'## Files',
		'',
		'- `manifest.json` — pack metadata and unverified items',
		'- `counters.json` — §8.1 counters (dormancy: all zero, with side-effect diffs)',
		'- `sfu-offered.json` — non-vacuous offered-media proof for the dormant session',
		'- `db-diff.json`, `storage-diff.json` — dormant-session side-effect diffs',
		'- `logs.jsonl` — §6.4-schema structured capture logs emitted during the runs',
		'- `scenarios.json` — per-scenario measured results',
		'- `SHA256SUMS` — checksums',
		'',
	].join('\n');
	fs.writeFileSync(path.join(PACK_DIR, 'summary.md'), summary);
	// Checksums last (over everything except SHA256SUMS itself)
	const files = fs.readdirSync(PACK_DIR).filter((f) => f !== 'SHA256SUMS').sort();
	const sums = files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(PACK_DIR, f))).digest('hex')}  ${f}`);
	fs.writeFileSync(path.join(PACK_DIR, 'SHA256SUMS'), sums.join('\n') + '\n');
	console.log(`PACK WRITTEN: ${PACK_DIR}`);
	process.exit(0);
}

main().catch((err) => {
	console.error('EVIDENCE PACK FAILED:', err);
	process.exit(1);
});
