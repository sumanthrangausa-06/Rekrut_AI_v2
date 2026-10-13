/**
 * observerCapture — Gate A (S-085 #787), Quinn T7/T9/T11 + §4.4/§5.4.
 * Runs against a transactional in-memory PG fake + in-memory storage:
 * the intent-first protocol, all four kill points, the withdrawal
 * sweeper, and the test-artefact purge.
 */
const { Readable } = require('node:stream');

// ── Shared fake state (mock-prefixed: jest.mock factories may close over it)
const mockState = {
	recordingObjects: new Map(), chunks: [], measurements: new Map(), outcomes: new Map(),
	jobs: new Map(), sessions: new Map(), receipts: [], ledger: [], dekRows: new Map(),
};
const mockObjects = new Map();
const mockFaults = { upload: null, deleteThrows: false };
let mockConnectCount = 0;
let mockConnectFailAt = -1;
let mockCommitFailArmed = false;

function revive(st) {
	for (const row of st.dekRows.values()) {
		if (row.dek_encrypted && !Buffer.isBuffer(row.dek_encrypted)) row.dek_encrypted = Buffer.from(row.dek_encrypted);
	}
	for (const row of st.measurements.values()) {
		if (row.measurements_envelope && !Buffer.isBuffer(row.measurements_envelope)) row.measurements_envelope = Buffer.from(row.measurements_envelope);
	}
	return st;
}

function route(st, sql, params = []) {
	if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
	// #799: legal-hold check (lib/legalHold.js) — this suite seeds no
	// holds; held behaviour is covered by legal-hold.test.js.
	if (sql.includes('FROM legal_holds')) return { rows: [], rowCount: 0 };
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
	if (sql.includes('FROM data_retention_policies')) return { rows: [{ retention_days: 30 }] };
		if (sql.includes('SELECT registration_state, deleted_at FROM recording_objects')) {
		const row = st.recordingObjects.get(params[0]);
		return { rows: row ? [{ registration_state: row.registration_state, deleted_at: row.deleted_at }] : [] };
	}
	if (sql.includes('INSERT INTO recording_objects')) {
		st.recordingObjects.set(params[0], { object_key: params[0], interview_id: params[1], candidate_id: params[2], object_type: 'observer_audio', registration_state: 'pending', created_at: new Date(), deleted_at: null });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('INSERT INTO observer_audio_chunks')) {
		st.chunks.push({ interview_session_id: params[0], candidate_id: params[1], chunk_index: params[2], object_key: params[3], byte_size: null, sample_rate: params[4], is_test: params[5], captured_at: new Date() });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes('FROM observer_jobs')) {
		const j = st.jobs.get(params[0]); return { rows: j ? [j] : [] };
	}
	if (sql.includes('SELECT id, config FROM interview_sessions')) {
		const s = st.sessions.get(params[0]); return { rows: s ? [s] : [] };
	}
	if (sql.includes('FROM consent_receipts')) {
		if (sql.includes("consent_type IN ('observer_capture', 'biometric')")) {
			const withChunks = new Set(st.chunks.map((c) => c.interview_session_id));
			const seen = new Map();
			for (const r of st.receipts) {
				if ((r.consent_type === 'observer_capture' || r.consent_type === 'biometric') && r.withdrawn_at && withChunks.has(r.interview_session_id)) {
					seen.set(r.interview_session_id, { interview_session_id: r.interview_session_id, candidate_id: r.candidate_id });
				}
			}
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
		st.outcomes.set(params[0], { interview_session_id: params[0], candidate_id: params[1], scope: params[2], is_test: params[3], cohort_allowlist_version: params[4], chunks_persisted: params[5], chunks_dropped: params[6], audio_seconds_captured: params[7], capture_gap_ratio: params[8], stop_reason: params[9], started_at: params[10] });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes("registration_state = 'pending'") && sql.includes('SELECT object_key, candidate_id')) {
		return { rows: [...st.recordingObjects.values()].filter((r) => r.registration_state === 'pending' && !r.deleted_at && r.created_at < params[0]) };
	}
	if (sql.includes('SELECT id FROM pending_storage_deletions')) {
		return { rows: st.ledger.filter((l) => l.file_url === params[0] && l.status === 'pending') };
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
		return { rows: st.chunks.filter((c) => c.is_test && c.captured_at < params[0]) };
	}
	if (sql.includes('DELETE FROM observer_speech_measurements WHERE is_test')) {
		let n = 0; for (const [k, v] of st.measurements) { if (v.is_test && v.created_at < params[0]) { st.measurements.delete(k); n++; } }
		return { rows: [], rowCount: n };
	}
	if (sql.includes('SELECT COUNT(*)::int AS c FROM observer_speech_measurements')) {
		let c = 0; for (const v of st.measurements.values()) { if (v.is_test && v.created_at < params[0]) c++; }
		return { rows: [{ c }] };
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
		let n = 0; for (const row of st.recordingObjects.values()) { if (row.interview_id === params[0] && !row.deleted_at) { row.deleted_at = new Date(); n++; } }
		return { rows: [], rowCount: n };
	}
	if (sql.includes('SELECT id, interview_session_id, candidate_id FROM observer_speech_measurements')) {
		return { rows: [...st.measurements.entries()].filter(([, v]) => v.is_test && v.created_at < params[0]).map(([k, v]) => ({ id: k, interview_session_id: v.interview_session_id, candidate_id: v.candidate_id })) };
	}
	if (sql.includes('DELETE FROM observer_speech_measurements WHERE id =')) {
		return { rows: [], rowCount: st.measurements.delete(params[0]) ? 1 : 0 };
	}
	if (sql.includes('SELECT interview_session_id, candidate_id FROM observer_capture_outcomes')) {
		return { rows: [...st.outcomes.values()].filter((v) => v.is_test && v.started_at < params[0]).map((v) => ({ interview_session_id: v.interview_session_id, candidate_id: v.candidate_id })) };
	}
	if (sql.includes('DELETE FROM observer_capture_outcomes WHERE interview_session_id')) {
		return { rows: [], rowCount: st.outcomes.delete(params[0]) ? 1 : 0 };
	}
	if (sql.includes('UPDATE recording_objects SET deleted_at') && sql.includes('WHERE object_key')) {
		// purgeTestObserverAudio stamps the registry row by key (fake gap
		// repaired #799 — the branch was missing, so the live purge test
		// could never complete a cold run).
		const row = st.recordingObjects.get(params[0]);
		if (row) row.deleted_at = new Date();
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	throw new Error('unstubbed SQL: ' + sql.slice(0, 80));
}

const mockPool = {
	query: async (sql, params) => route(mockState, sql, params),
	connect: async () => {
		mockConnectCount++;
		if (mockConnectFailAt === mockConnectCount) { mockConnectFailAt = -1; throw new Error('simulated crash: connect'); }
		let tx = null;
		return {
			query: async (sql, params) => {
				if (sql === 'BEGIN') { tx = revive(structuredClone(mockState)); return { rows: [] }; }
				if (sql === 'COMMIT') {
					if (mockCommitFailArmed) { mockCommitFailArmed = false; tx = null; throw new Error('simulated crash: commit'); }
					Object.assign(mockState, revive(tx));
					// structuredClone produces plain objects for Maps — restore class instances
					for (const k of Object.keys(mockState)) {
						if (tx[k] instanceof Map) mockState[k] = tx[k];
					}
					tx = null;
					return { rows: [] };
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
jest.mock('../../../lib/file-storage', () => ({
	uploadToB2: jest.fn(async ({ buffer, objectKey }) => {
		if (mockFaults.upload === 'throw') { const e = new Error('storage unavailable'); e.code = 'STORAGE_UNAVAILABLE'; throw e; }
		const key = `r2/${objectKey}`;
		mockObjects.set(key, Buffer.from(buffer));
		if (mockFaults.upload === 'store-then-throw') { mockFaults.upload = null; const e = new Error('crash during PUT'); e.code = 'STORAGE_UNAVAILABLE'; throw e; }
		return { key, url: `/api/files/${encodeURIComponent(key)}`, provider: 'r2' };
	}),
	getFile: jest.fn(async (key) => {
		if (!mockObjects.has(key)) { const e = new Error('nf'); e.code = 'NOT_FOUND'; throw e; }
		return { stream: require('node:stream').Readable.from([mockObjects.get(key)]) };
	}),
	deleteStorageObject: jest.fn(async (key) => {
		if (mockFaults.deleteThrows) throw new Error('storage unreachable');
		mockObjects.delete(key);
		return { deleted: true };
	}),
	deleteFile: jest.fn(async () => ({ deleted: true })),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY = 'b'.repeat(64);
process.env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'true';
process.env.RENDER_SERVICE_NAME = 'rekrutai-staging';

const cap = require('../../../lib/observerCapture');

function toneFrame(seconds, freq = 120, sr = 48000) {
	const n = Math.floor(seconds * sr);
	const buf = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * freq * (i / sr))), i * 2);
	return buf;
}
function seed(sessionId = 42, candidateId = 7) {
	mockState.jobs.set(sessionId, { id: 900 + sessionId, interview_session_id: sessionId, origin_env: 'staging' });
	mockState.sessions.set(sessionId, { id: sessionId, config: { biometric_collection: true } });
}
function reset() {
	mockState.recordingObjects = new Map(); mockState.chunks = []; mockState.measurements = new Map();
	mockState.outcomes = new Map(); mockState.jobs = new Map(); mockState.sessions = new Map();
	mockState.receipts = []; mockState.ledger = []; mockState.dekRows = new Map();
	mockObjects.clear();
	mockFaults.upload = null; mockFaults.deleteThrows = false;
	mockConnectCount = 0; mockConnectFailAt = -1; mockCommitFailArmed = false;
}
const persistArgs = (over = {}) => ({
	sessionId: 42, candidateId: 7, chunkIndex: 0, pcmBuffer: toneFrame(30), sampleRate: 48000,
	scope: 'test', isTest: true, jobOriginEnv: 'staging', counters: cap.createCaptureCounters(), pool: mockPool, ...over,
});
const future = () => new Date(Date.now() + 10 * 60 * 1000);

beforeEach(reset);

describe('persistChunk — intent-first protocol (§4.4)', () => {
	test('happy path: intent → PUT → confirmed registry + chunk byte_size', async () => {
		seed();
		const counters = cap.createCaptureCounters();
		const res = await cap.persistChunk(persistArgs({ counters }));
		expect(res.persisted).toBe(true);
		const reg = [...mockState.recordingObjects.values()];
		expect(reg).toHaveLength(1);
		expect(reg[0].registration_state).toBe('confirmed');
		expect(mockState.chunks[0].byte_size).toBe(toneFrame(30).length + 29);
		expect(counters).toMatchObject({ chunksPersisted: 1, registryRowsWritten: 1, chunksDropped: 0 });
	});

	test('intent failure ⇒ NO storage PUT ever happens', async () => {
		seed();
		const badPool = { query: mockPool.query, connect: async () => { throw new Error('db down'); } };
		const res = await cap.persistChunk(persistArgs({ pool: badPool }));
		expect(res).toMatchObject({ persisted: false, reason: 'intent_failed' });
		expect(mockObjects.size).toBe(0);
	});

	test('T8b composition: after erasure destroys the DEK, a capture attempt writes ZERO rows (pre-flight refusal)', async () => {
		seed();
		const biometricCrypto = require('../../../lib/biometricCrypto');
		const first = await cap.persistChunk(persistArgs());
		expect(first.persisted).toBe(true);
		await biometricCrypto.destroyDEK(7);
		const deksBefore = mockState.dekRows.size;
		const chunksBefore = mockState.chunks.length;
		const attempt = await cap.persistChunk(persistArgs({ chunkIndex: 1 }));
		expect(attempt).toMatchObject({ persisted: false, reason: 'dek_unavailable' });
		expect(mockState.dekRows.size).toBe(deksBefore); // never resurrected
		expect(mockState.chunks.length).toBe(chunksBefore); // zero new chunk rows
		expect(mockState.recordingObjects.size).toBe(1); // and zero new intents
	});
});

describe('T11 — kill at every injection point leaves zero unregistered objects, zero stuck intents', () => {
	test('(a) kill after intent, before PUT', async () => {
		seed();
		mockFaults.upload = 'throw';
		const res = await cap.persistChunk(persistArgs());
		expect(res.persisted).toBe(false);
		const rec = await cap.reconcileObserverAudioIntents({ queryable: mockPool, now: future() });
		expect(rec.rowsRetired).toBe(1);
		expect(mockState.recordingObjects.size).toBe(0);
		expect(mockState.chunks).toHaveLength(0);
		expect(mockObjects.size).toBe(0);
	});

	test('(b) kill DURING PUT (object stored, response lost)', async () => {
		seed();
		mockFaults.upload = 'store-then-throw';
		const res = await cap.persistChunk(persistArgs());
		expect(res.persisted).toBe(false);
		expect(mockObjects.size).toBe(1); // orphan exists pre-reconcile
		const rec = await cap.reconcileObserverAudioIntents({ queryable: mockPool, now: future() });
		expect(rec.objectsDeleted).toBe(1);
		expect(mockObjects.size).toBe(0);
		expect(mockState.recordingObjects.size).toBe(0);
	});

	test('(c) kill after PUT, before confirm: ledger carries the deletion', async () => {
		seed();
		mockConnectCount = 0;
		mockConnectFailAt = 2; // intent connect ok, confirm connect dies
		mockFaults.deleteThrows = true; // compensating delete cannot complete either
		const res = await cap.persistChunk(persistArgs());
		expect(res.persisted).toBe(false);
		expect(mockState.ledger).toHaveLength(1);
		expect(mockState.ledger[0].source_family).toBe('observer_audio');
		mockFaults.deleteThrows = false;
		await cap.reconcileObserverAudioIntents({ queryable: mockPool, now: future() });
		expect(mockState.recordingObjects.size).toBe(0);
		// Phase 2 processes the ledger → object removed
		for (const row of mockState.ledger) mockObjects.delete(decodeURIComponent(row.file_url.replace('/api/files/', '')));
		expect(mockObjects.size).toBe(0);
	});

	test('(d) kill DURING confirm (commit crashes → rollback; compensation deletes)', async () => {
		seed();
		// Arm the commit failure for the CONFIRM tx (second connect)
		let n = 0;
		const wrappedPool = {
			query: mockPool.query,
			connect: async () => {
				n++;
				const client = await mockPool.connect();
				if (n === 2) {
					const orig = client.query.bind(client);
					client.query = async (sql, p) => { if (sql === 'COMMIT') mockCommitFailArmed = true; return orig(sql, p); };
				}
				return client;
			},
		};
		const res = await cap.persistChunk(persistArgs({ pool: wrappedPool }));
		expect(res.persisted).toBe(false);
		expect([...mockState.recordingObjects.values()][0].registration_state).toBe('pending');
		expect(mockObjects.size).toBe(0); // compensating delete landed
		await cap.reconcileObserverAudioIntents({ queryable: mockPool, now: future() });
		expect(mockState.recordingObjects.size).toBe(0);
	});

	test('reconciler respects the 5-minute grace (young intents untouched)', async () => {
		seed();
		mockFaults.upload = 'throw';
		await cap.persistChunk(persistArgs({ pcmBuffer: toneFrame(1) }));
		const rec = await cap.reconcileObserverAudioIntents({ queryable: mockPool });
		expect(rec.intentsFound).toBe(0);
		expect(mockState.recordingObjects.size).toBe(1);
	});
});

describe('T7 — storage failure handling', () => {
	test('three consecutive failures stop capture with storage_failed; outcome + CAPTURE_INCOMPLETE measurements written', async () => {
		seed();
		mockFaults.upload = 'throw';
		const counters = cap.createCaptureCounters();
		const cs = new cap.CaptureSession({ sessionId: 42, candidateId: 7, jobId: 942, scope: 'test', isTest: true, jobOriginEnv: 'staging', counters, pool: mockPool });
		let stop = null;
		for (let s = 0; s < 95 && !stop; s++) {
			const r = await cs.onFrame(toneFrame(1), 48000);
			if (r.stop) stop = r.stop;
		}
		expect(stop).toBe('storage_failed');
		expect(counters.chunksDropped).toBe(3);
		await cs.finalize('storage_failed');
		expect(mockState.outcomes.get(42).stop_reason).toBe('storage_failed');
		expect(mockState.measurements.has(42)).toBe(true);
		expect(counters.measurementWrites).toBe(1);
		// Zero plaintext anywhere: storage holds nothing (every PUT failed)
		expect(mockObjects.size).toBe(0);
	});
});

describe('CaptureSession lifecycle', () => {
	test('65 s session ⇒ 3 chunks (30+30+5 partial), session_end outcome, one ASR invocation', async () => {
		seed();
		const counters = cap.createCaptureCounters();
		const cs = new cap.CaptureSession({ sessionId: 42, candidateId: 7, jobId: 942, scope: 'test', isTest: true, jobOriginEnv: 'staging', counters, pool: mockPool });
		for (let s = 0; s < 65; s++) await cs.onFrame(toneFrame(1), 48000);
		await cs.finalize('session_end');
		expect(counters.chunksPersisted).toBe(3);
		expect(mockState.outcomes.get(42)).toMatchObject({ stop_reason: 'session_end', chunks_persisted: 3 });
		expect(counters.asrInvocations).toBe(1);
		expect(mockObjects.size).toBe(3);
	});

	test('role-flip identity binding (§3.5)', () => {
		const cs = new cap.CaptureSession({ sessionId: 1, candidateId: 7, jobId: 1, scope: 'test', isTest: true, jobOriginEnv: 'staging', counters: cap.createCaptureCounters(), pool: mockPool });
		cs.bindIdentity('candidate-7');
		expect(cs.verifyIdentity('candidate-7')).toBe(true);
		expect(cs.verifyIdentity('candidate-8')).toBe(false);
	});

	test('resample 48k→16k preserves a constant signal at 3:1', () => {
		const buf = Buffer.alloc(4800 * 2);
		for (let i = 0; i < 4800; i++) buf.writeInt16LE(1000, i * 2);
		const out = cap.resamplePcm16(buf, 48000);
		expect(out.length).toBe(1600 * 2);
		expect(out.readInt16LE(0)).toBe(1000);
	});
});

describe('§5.4 withdrawal sweeper + §5.1 test purge', () => {
	test('sweeper queues artefacts via the ledger, deletes rows, stamps registry, leaves the DEK', async () => {
		seed();
		await cap.persistChunk(persistArgs());
		mockState.receipts.push({ interview_session_id: 42, candidate_id: 7, consent_type: 'biometric', granted_at: new Date(), withdrawn_at: new Date(), consent_text_version: '1.0' });
		const sweep = await cap.sweepWithdrawnCaptureArtefacts({ pool: mockPool });
		expect(sweep.chunksQueued).toBe(1);
		expect(mockState.chunks).toHaveLength(0);
		expect(mockState.ledger[0].source_family).toBe('observer_audio');
		expect(mockState.dekRows.get(7).destroyed_at).toBeNull();
	});

	test('T9-adjacent: test purge honours dry-run first, then deletes objects + rows', async () => {
		seed();
		await cap.persistChunk(persistArgs());
		mockState.chunks[0].captured_at = new Date(Date.now() - 8 * 24 * 3600 * 1000);
		let purge = await cap.purgeTestObserverAudio({ dryRun: true, queryable: mockPool });
		expect(purge.objectsDeleted).toBe(1);
		expect(mockObjects.size).toBe(1);
		purge = await cap.purgeTestObserverAudio({ dryRun: false, queryable: mockPool });
		expect(purge.objectsDeleted).toBe(1);
		expect(mockObjects.size).toBe(0);
		expect(mockState.chunks).toHaveLength(0);
	});
});

describe('log schema (§6.4 + D-3)', () => {
	test('emitLog whitelists fields and rejects unknown events', () => {
		const lines = [];
		cap._setLogSink((l) => lines.push(l));
		const line = cap.emitLog('chunk_persisted', { scope: 'test', session_id: 1, candidate_id: 7, object_key: 'r2/secret', transcript: 'hello' });
		for (const k of Object.keys(line)) expect(cap.PERMITTED_LOG_FIELDS).toContain(k);
		expect(line.candidate_id).toBeUndefined();
		expect(line.object_key).toBeUndefined();
		expect(() => cap.emitLog('not_an_event', {})).toThrow(/unknown event/);
		cap._setLogSink(null);
	});

	test('outcome writer enforces the frozen stop_reason enum', async () => {
		await expect(cap.writeCaptureOutcome({ sessionId: 1, candidateId: 1, scope: 'test', counters: cap.createCaptureCounters(), stopReason: 'made_up', startedAt: new Date(), queryable: mockPool })).rejects.toThrow(/unknown stop_reason/);
	});

	test('M5: outcome write takes the §5.2 lock and never resurrects an erased candidate', async () => {
		seed();
		const biometricCrypto = require('../../../lib/biometricCrypto');
		await biometricCrypto.getOrCreateDEK(7);
		await biometricCrypto.destroyDEK(7);
		const res = await cap.writeCaptureOutcome({ sessionId: 42, candidateId: 7, scope: 'test', isTest: true, counters: cap.createCaptureCounters(), stopReason: 'session_end', startedAt: new Date(), queryable: mockPool });
		expect(res).toMatchObject({ written: false, reason: 'candidate_erased' });
		expect(mockState.outcomes.has(42)).toBe(false);
	});
});
