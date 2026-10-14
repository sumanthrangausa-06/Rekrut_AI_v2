/**
 * GAP-A (#1120, P1): erasure — interview content, session-linked
 * transcripts, and recording objects (E-3/E-4).
 *
 * RED-first suite, MOCKED jest only (this VM cannot reach a real DB;
 * no live-DB verification is claimed — PR #1119 evidence posture).
 *
 * Covered, per STOP 1 §3 as ruled (Sumanth, 2026-10-14):
 *  (a) interview_sessions content strip: whole-column resets
 *      (conversation, frame_analysis, invite_token) + config ALLOWLIST
 *      reset keeping ONLY biometric_collection (consent fact, Art. 7(1)).
 *  (b) transcript DELETE reaches session-linked recordings (mig 130 XOR:
 *      session-linked rows have interview_event_id IS NULL).
 *  (c) interview_recordings enumerated via BOTH attributions; storage
 *      objects ledgered in-tx (source_family='livekit_recording'); rows
 *      keep-redacted (status='deleted', storage_path=NULL — hard delete
 *      would CASCADE recording_consent, mig 128). recording_objects
 *      type='frame' rows ledgered (observer-audio encoding) + stamped.
 *  Legal hold: per-row isHeld consult at every new site, fail-closed;
 *  held rows preserved, counted, disclosed — never silently skipped.
 *  Phase 2: the existing drain deletes ledgered recording objects.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
}));
jest.mock('../../../lib/biometricAudit', () => ({
	logAccess: jest.fn(async () => {}),
}));
jest.mock('../../../lib/file-storage', () => ({
	deleteFile: jest.fn(async () => ({ deleted: true })),
	deleteStorageObject: jest.fn(async () => ({ deleted: true })),
	getProviders: jest.fn(() => [{ name: 'r2', bucket: 'test-bucket' }]),
}));
jest.mock('../../../services/encryption', () => ({
	deleteEncryptedFile: jest.fn(),
	// Test double for the shared-key pointer encryption used by
	// completeRecordingRecord: storage_path buffers are `enc:<plaintext>`.
	decrypt: jest.fn((buf) => {
		const s = Buffer.from(buf).toString('utf-8');
		if (!s.startsWith('enc:')) throw new Error('bad pointer format');
		return Buffer.from(s.slice(4));
	}),
}));

process.env.BIOMETRIC_ENCRYPTION_KEY =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const db = require('../../../lib/db');
const { deleteFile, deleteStorageObject } = require('../../../lib/file-storage');
const { erasePersonalData, deleteErasedStorageFiles } = require('../../../lib/erasureService');

const enc = (plain) => Buffer.from(`enc:${plain}`);
const LOC_A = 's3://test-bucket/rekrut-recordings/room-a-1.mp4';
const LOC_B = 's3://test-bucket/rekrut-recordings/room-b-2.mp4';
const FRAME_A = 'r2/frames/video-frame-aa.bin';
const FRAME_B = 'r2/frames/video-frame-bb.bin';

// Session companies: session 11 → company 99, session 12 → company 55.
// The held variant arms a hold on company 55 that the PER-ROW consult
// catches (session-scoped param $3) — e.g. a hold placed after the
// whole-erasure entry gate ran. The consult, not the gate, is under test.
const SESSION_COMPANY = { 11: 99, 12: 55 };
let state;

function freshState() {
	return {
		calls: [],
		ledger: [],
		sessions: [{ id: 11 }, { id: 12 }],
		recordings: [
			{ id: 21, interview_event_id: 31, interview_session_id: null, storage_path: enc(LOC_A) },
			{ id: 22, interview_event_id: null, interview_session_id: 11, storage_path: enc(LOC_B) },
		],
		frames: [
			{ id: 41, object_key: FRAME_A, interview_id: null },
			{ id: 42, object_key: FRAME_B, interview_id: 11 },
		],
		heldSessionCompany: null,
		transcriptRowCount: 2,
	};
}

async function route(sql, params = []) {
	state.calls.push({ sql, params });
	// Legal-hold queries first: the legal_holds query itself contains an
	// interview_sessions subquery (candidate company attribution, #915).
	if (sql.includes('FROM legal_holds')) {
		if (state.heldSessionCompany != null && params[2] === state.heldSessionCompany) {
			return { rows: [{ id: 900, user_id: null, company_id: state.heldSessionCompany }], rowCount: 1 };
		}
		return { rows: [], rowCount: 0 };
	}
	if (sql.includes('SELECT candidate_id, company_id FROM interview_sessions WHERE id')) {
		const company = SESSION_COMPANY[params[0]];
		return company == null
			? { rows: [], rowCount: 0 }
			: { rows: [{ candidate_id: 7, company_id: company }], rowCount: 1 };
	}
	if (sql.includes('DELETE FROM interview_transcripts')) {
		return { rows: [], rowCount: state.transcriptRowCount };
	}
	// Recordings BEFORE sessions: the recordings SELECT contains the
	// session-select as a subquery (session attribution branch).
	if (sql.includes('FROM interview_recordings')) {
		return { rows: state.recordings, rowCount: state.recordings.length };
	}
	if (sql.includes('SELECT id FROM interview_sessions WHERE candidate_id')) {
		return { rows: state.sessions, rowCount: state.sessions.length };
	}
	if (sql.includes('INSERT INTO pending_storage_deletions')) {
		state.ledger.push({ sql, params });
		return { rows: [], rowCount: 1 };
	}
	if (sql.includes("object_type = 'frame'") && sql.includes('FROM recording_objects')) {
		return { rows: state.frames, rowCount: state.frames.length };
	}
	if (sql.includes('UPDATE recording_objects') && sql.includes("object_type = 'frame'")) {
		return { rows: [], rowCount: state.frames.length };
	}
	if (sql.includes('UPDATE interview_sessions')) {
		return { rows: [], rowCount: Array.isArray(params[1]) ? params[1].length : 1 };
	}
	if (sql.includes('UPDATE interview_recordings')) {
		return { rows: [], rowCount: Array.isArray(params[0]) ? params[0].length : 1 };
	}
	if (sql.includes('DELETE FROM')) return { rows: [], rowCount: 1 };
	if (sql.includes('UPDATE')) return { rows: [], rowCount: 1 };
	if (sql.includes('INSERT INTO')) return { rows: [], rowCount: 1 };
	if (sql.includes('SELECT')) return { rows: [], rowCount: 0 };
	return { rows: [], rowCount: 0 };
}

const findCall = (re) => state.calls.find((c) => re.test(c.sql));
// source_family is a SQL literal in the INSERT (the shipped pattern —
// cf. observer_audio inserts), so family matching reads the SQL text;
// params are [userId, fileUrl].
const ledgerFor = (family) =>
	state.ledger.filter((l) => l.sql.includes(`'${family}'`)).map((l) => l.params);

beforeEach(() => {
	jest.clearAllMocks();
	state = freshState();
	deleteFile.mockResolvedValue({ deleted: true });
	deleteStorageObject.mockResolvedValue({ deleted: true });
});

describe('GAP-A (a): session content strip', () => {
	test('resets conversation/frame_analysis/invite_token and allowlist-resets config', async () => {
		const client = { query: jest.fn(route) };
		const result = await erasePersonalData(7, { client });

		const strip = findCall(/UPDATE interview_sessions/i);
		expect(strip).toBeDefined();
		expect(strip.sql).toMatch(/conversation = '\[\]'::jsonb/);
		expect(strip.sql).toMatch(/frame_analysis = '\{\}'::jsonb/);
		expect(strip.sql).toMatch(/invite_token = NULL/);
		// Allowlist, NOT a deny-list: config is REBUILT from the one kept key.
		expect(strip.sql).toMatch(/jsonb_build_object\('biometric_collection'/);
		expect(strip.sql).not.toMatch(/config - 'observer_transcript'/);
		expect(strip.params[0]).toBe(7);
		expect(strip.params[1]).toEqual(expect.arrayContaining([11, 12]));
		expect(result.sessionsStripped).toBe(2);
		expect(result.interviewSessionsStripped).toBe(true);
	});
});

describe('GAP-A (b): transcript repair', () => {
	test('DELETE contains the session branch alongside the event branch', async () => {
		const client = { query: jest.fn(route) };
		const result = await erasePersonalData(7, { client });

		const del = findCall(/DELETE FROM interview_transcripts/i);
		expect(del).toBeDefined();
		expect(del.sql).toMatch(/interview_event_id/);
		expect(del.sql).toMatch(/interview_session_id IN \(\s*SELECT id FROM interview_sessions WHERE candidate_id = \$1\s*\)/i);
		expect(result.transcriptsDeleted).toBe(2);
		expect(result.interviewTranscriptsDeleted).toBe(true);
	});
});

describe('GAP-A (c): recording objects + frames', () => {
	test('recordings enumerated via both attributions, ledgered livekit_recording, rows keep-redacted', async () => {
		const client = { query: jest.fn(route) };
		const result = await erasePersonalData(7, { client });

		const sel = findCall(/FROM interview_recordings/i);
		expect(sel).toBeDefined();
		expect(sel.sql).toMatch(/interview_events/);
		expect(sel.sql).toMatch(/interview_session_id IN/);

		const recLedger = ledgerFor('livekit_recording');
		expect(recLedger).toHaveLength(2);
		expect(recLedger.map((p) => p[1])).toEqual(expect.arrayContaining([LOC_A, LOC_B]));

		const redact = findCall(/UPDATE interview_recordings/i);
		expect(redact).toBeDefined();
		expect(redact.sql).toMatch(/status = 'deleted'/);
		expect(redact.sql).toMatch(/storage_path = NULL/);
		expect(redact.sql).not.toMatch(/DELETE FROM interview_recordings/i);
		expect(redact.params[0]).toEqual(expect.arrayContaining([21, 22]));
		expect(result.recordingsLedgered).toBe(2);
		expect(result.recordingsRedacted).toBe(2);
		// Ledgered locations ride the Phase-2 key list too.
		expect(result.storageKeys).toEqual(expect.arrayContaining([LOC_A, LOC_B]));
	});

	test('frames ledgered with the observer-audio /api/files encoding and stamped, not row-deleted', async () => {
		const client = { query: jest.fn(route) };
		const result = await erasePersonalData(7, { client });

		const frameLedger = ledgerFor('frame');
		expect(frameLedger).toHaveLength(2);
		expect(frameLedger.map((p) => p[1])).toEqual(
			expect.arrayContaining([
				`/api/files/${encodeURIComponent(FRAME_A)}`,
				`/api/files/${encodeURIComponent(FRAME_B)}`,
			]),
		);
		const stamp = state.calls.find(
			(c) => /UPDATE recording_objects/i.test(c.sql) && /deleted_at = NOW\(\)/.test(c.sql) && /object_type = 'frame'/.test(c.sql),
		);
		expect(stamp).toBeDefined();
		expect(state.calls.some((c) => /DELETE FROM recording_objects/i.test(c.sql))).toBe(false);
		expect(result.framesLedgered).toBe(2);
		expect(result.recordingFramesLedgered).toBe(true);
	});

	test('undecryptable pointer fails closed: row preserved (not redacted, not ledgered), counted + disclosed', async () => {
		state.recordings.push({
			id: 24,
			interview_event_id: 32,
			interview_session_id: null,
			storage_path: Buffer.from('not-an-encrypted-pointer'),
		});
		const client = { query: jest.fn(route) };
		const result = await erasePersonalData(7, { client });

		expect(result.recordingsUndecryptable).toBe(1);
		const redact = findCall(/UPDATE interview_recordings/i);
		expect(redact.params[0]).not.toContain(24);
		expect(result.recordingsLedgered).toBe(2);
	});

	test('held recording + its session are preserved, not ledgered/redacted/stripped, and disclosed', async () => {
		state.heldSessionCompany = 55;
		state.recordings.push({
			id: 23,
			interview_event_id: null,
			interview_session_id: 12,
			storage_path: enc('s3://test-bucket/rekrut-recordings/room-c-3.mp4'),
		});
		const client = { query: jest.fn(route) };
		const result = await erasePersonalData(7, { client });

		// Held recording: no ledger entry, not in the redact set.
		expect(ledgerFor('livekit_recording').map((p) => p[1])).not.toContain(
			's3://test-bucket/rekrut-recordings/room-c-3.mp4',
		);
		const redact = findCall(/UPDATE interview_recordings/i);
		expect(redact.params[0]).not.toContain(23);
		// Held session 12 is not stripped; session 11 is.
		const strip = findCall(/UPDATE interview_sessions/i);
		expect(strip.params[1]).toEqual([11]);
		// Disclosed, counted — never silently skipped.
		expect(result.gapAHeldSkips).toBeGreaterThanOrEqual(2);
		expect(result.recordingsHeld).toBe(1);
		expect(result.sessionsHeld).toBe(1);
		expect(result.recordingsLedgered).toBe(2);
	});
});

describe('GAP-A Phase 2: drain deletes ledgered recording objects', () => {
	function routePhase2(entries) {
		return jest.fn(async (sql) => {
			if (sql.includes('FROM legal_holds')) return { rows: [], rowCount: 0 };
			if (sql.includes('FROM pending_storage_deletions')) return { rows: entries, rowCount: entries.length };
			return { rows: [], rowCount: 1 };
		});
	}

	test('livekit_recording entry: bucket-matched provider → deleteStorageObject(raw key)', async () => {
		db.query.mockImplementation(
			routePhase2([
				{ id: 61, file_url: LOC_B, storage_type: 'r2', source_family: 'livekit_recording' },
				{ id: 62, file_url: `/api/files/${encodeURIComponent(FRAME_A)}`, storage_type: 'r2', source_family: 'frame' },
			]),
		);
		const res = await deleteErasedStorageFiles(7, {});
		expect(deleteStorageObject).toHaveBeenCalledWith('r2/rekrut-recordings/room-b-2.mp4');
		expect(deleteFile).toHaveBeenCalledWith(`/api/files/${encodeURIComponent(FRAME_A)}`);
		expect(res.deleted).toBe(2);
		expect(res.failed).toBe(0);
	});

	test('egress bucket that is NOT a configured file-storage provider ⇒ visible failure, no invented primitive', async () => {
		db.query.mockImplementation(
			routePhase2([
				{ id: 63, file_url: 's3://someone-elses-bucket/rekrut-recordings/x.mp4', storage_type: 'r2', source_family: 'livekit_recording' },
			]),
		);
		const res = await deleteErasedStorageFiles(7, {});
		expect(deleteStorageObject).not.toHaveBeenCalled();
		expect(res.deleted).toBe(0);
		expect(res.failed).toBe(1);
		expect(res.failures).toContain('s3://someone-elses-bucket/rekrut-recordings/x.mp4');
	});
});
