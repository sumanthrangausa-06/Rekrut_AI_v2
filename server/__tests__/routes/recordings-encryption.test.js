/**
 * GAP-A2 (#1130) — recordings routes: playback + transcription for
 * DEK-encrypted (.enc) LiveKit recordings. MOCKED suite: the livekit
 * service, auth, rbac, rate limiter and Whisper are test doubles; lib/db
 * is the repo mocked pool extended with the canAccessRecording queries.
 *
 * Contract (STOP 1 R-5/R-6):
 *  - Marked (.enc) recordings: decrypt-proxy is the SOLE playback path —
 *    no direct-URL/token JSON; canAccess BEFORE decrypt; in-memory
 *    streaming with Cache-Control: no-store; destroyed-DEK/tamper is an
 *    indistinct 403.
 *  - Legacy plaintext recordings: existing playback JSON unchanged.
 *  - Transcription .enc branch decrypts in memory via the same fetch —
 *    downloadRecordingAudio's constructed-URL fetch is NOT used — and
 *    status resets are scoped to status='processing' so a quarantined
 *    (failed) recording can never be resurrected to 'completed'.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const authMiddleware = jest.fn((req, res, next) => {
		const userId = parseInt(req.headers['x-test-user-id'], 10);
		const user = global.__testUsers?.[userId];
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		req.user = user;
		return next();
	});
	return { authMiddleware };
});
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../../../lib/distributed-rate-limiter', () => ({
	rateLimits: { standard: (req, res, next) => next(), ai: (req, res, next) => next() },
	createRateLimit: () => (req, res, next) => next(),
}));

const mockLivekit = {
	findRecordingById: jest.fn(),
	decryptStoragePath: jest.fn(),
	isEncryptedRecording: jest.fn(),
	fetchDecryptedRecording: jest.fn(),
	downloadRecordingAudio: jest.fn(),
	stopRoomRecording: jest.fn(),
	getEgressInfo: jest.fn(),
	completeRecordingRecord: jest.fn(),
	failRecordingRecord: jest.fn(),
	findRoomById: jest.fn(),
	findActiveRecordingByRoomId: jest.fn(),
	createRecordingRecord: jest.fn(),
	startRoomRecording: jest.fn(),
	listRecordingsByEventId: jest.fn(),
};
jest.mock('../../services/livekit', () => mockLivekit);

const mockWhisper = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	transcribeAudioWithWhisper: (...a) => mockWhisper(...a),
}));

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.RECORDING_STORAGE_ENDPOINT = 'https://ep.local';
process.env.RECORDING_STORAGE_BUCKET = 'bkt';

const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const ENC_LOC = 's3://test-bucket/rekrut-recordings/interview-10-123.mp4.enc';
const LEGACY_KEY = 'rekrut-recordings/legacy.mp4';
let recordingRow;
let capturedUpdates;

db.query.mockImplementation(async (sql, params) => {
	const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (n.includes('from interview_sessions') && n.includes('where id')) {
		return { rows: [{ id: 10, candidate_id: 7, company_id: 99 }], rowCount: 1 };
	}
	if (n.startsWith('update interview_recordings')) {
		capturedUpdates.push(sql.replace(/\s+/g, ' '));
		return { rows: [], rowCount: 1 };
	}
	if (n.startsWith('insert into interview_transcripts')) {
		return { rows: [], rowCount: 1 };
	}
	return baseQueryImpl(sql, params);
});

const router = require('../../routes/recordings');
const app = express();
app.use(express.json());
app.use('/recordings', router);

global.__testUsers = {
	7: { id: 7, role: 'candidate', company_id: null },
	9: { id: 9, role: 'recruiter', company_id: 99 },
	999: { id: 999, role: 'candidate', company_id: null },
};
const as = (id) => ({ 'x-test-user-id': String(id) });

beforeEach(() => {
	jest.clearAllMocks();
	capturedUpdates = [];
	recordingRow = {
		id: 5,
		status: 'completed',
		interview_session_id: 10,
		interview_event_id: null,
		encryption_key_id: 'candidate-dek:v1',
		storage_path: Buffer.from('pointer'),
		duration_seconds: 60,
	};
	mockLivekit.findRecordingById.mockResolvedValue(recordingRow);
	mockLivekit.isEncryptedRecording.mockReturnValue(true);
	mockLivekit.decryptStoragePath.mockReturnValue(ENC_LOC);
});

describe('GET /recordings/:id/playback — .enc recordings', () => {
	test('streams decrypted bytes via the proxy (no direct URL, no-store)', async () => {
		mockLivekit.fetchDecryptedRecording.mockResolvedValue(Buffer.from('PLAIN-VIDEO'));

		const res = await request(app).get('/recordings/5/playback').set(as(7));

		expect(res.status).toBe(200);
		expect(res.headers['cache-control']).toBe('no-store');
		expect(res.headers['content-type']).toMatch(/video\/mp4/);
		const bodyText = Buffer.isBuffer(res.body) ? res.body.toString() : res.text;
		expect(bodyText).toBe('PLAIN-VIDEO');
		expect(res.body.playback).toBeUndefined();
	});

	test('access is checked BEFORE decrypt: unauthorized user gets 403 and decrypt never runs', async () => {
		const res = await request(app).get('/recordings/5/playback').set(as(999));

		expect(res.status).toBe(403);
		expect(mockLivekit.fetchDecryptedRecording).not.toHaveBeenCalled();
	});

	test('destroyed DEK / tamper → indistinct 403, no URL leaked', async () => {
		mockLivekit.fetchDecryptedRecording.mockRejectedValue(new Error('DEK destroyed'));

		const res = await request(app).get('/recordings/5/playback').set(as(7));

		expect(res.status).toBe(403);
		expect(JSON.stringify(res.body)).not.toMatch(/test-bucket|http/);
	});
});

describe('GET /recordings/:id/playback — legacy plaintext unchanged', () => {
	test('returns the existing direct-URL + token JSON', async () => {
		mockLivekit.isEncryptedRecording.mockReturnValue(false);
		mockLivekit.decryptStoragePath.mockReturnValue(LEGACY_KEY);

		const res = await request(app).get('/recordings/5/playback').set(as(7));

		expect(res.status).toBe(200);
		expect(res.body.playback.url).toBe(`https://ep.local/bkt/${LEGACY_KEY}`);
		expect(res.body.playback.token).toBeTruthy();
		expect(mockLivekit.fetchDecryptedRecording).not.toHaveBeenCalled();
	});
});

describe('POST /recordings/:id/transcribe — .enc branch', () => {
	test('decrypts in memory, reuses Whisper, never uses downloadRecordingAudio', async () => {
		mockLivekit.fetchDecryptedRecording.mockResolvedValue(Buffer.from('AUDIO-BYTES'));
		mockWhisper.mockResolvedValue({ text: 'hello world', confidence: 0.9 });

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(200);
		expect(res.body.transcript.text).toBe('hello world');
		expect(mockLivekit.fetchDecryptedRecording).toHaveBeenCalled();
		expect(mockLivekit.downloadRecordingAudio).not.toHaveBeenCalled();
		const [b64] = mockWhisper.mock.calls[0];
		expect(Buffer.from(b64.split(',')[1], 'base64').toString()).toBe('AUDIO-BYTES');
		// Status machine is scoped: processing only from completed, resets
		// only from processing (a quarantined recording cannot resurrect).
		const processing = capturedUpdates.find((s) => s.includes("SET status = 'processing'"));
		expect(processing).toMatch(/WHERE[\s\S]*status = 'completed'/);
		const resets = capturedUpdates.filter((s) => s.includes("SET status = 'completed'"));
		expect(resets.length).toBeGreaterThan(0);
		for (const r of resets) expect(r).toMatch(/WHERE[\s\S]*status = 'processing'/);
	});

	test('whisper failure → 500 and the reset UPDATE is scoped to processing rows only', async () => {
		mockLivekit.fetchDecryptedRecording.mockResolvedValue(Buffer.from('AUDIO-BYTES'));
		mockWhisper.mockResolvedValue({});

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(500);
		const resets = capturedUpdates.filter((s) => s.includes("SET status = 'completed'"));
		expect(resets.length).toBeGreaterThan(0);
		for (const r of resets) expect(r).toMatch(/WHERE[\s\S]*status = 'processing'/);
	});

	test('legacy transcription still uses downloadRecordingAudio', async () => {
		mockLivekit.isEncryptedRecording.mockReturnValue(false);
		mockLivekit.decryptStoragePath.mockReturnValue(LEGACY_KEY);
		mockLivekit.downloadRecordingAudio.mockResolvedValue(Buffer.from('AUDIO-BYTES'));
		mockWhisper.mockResolvedValue({ text: 'legacy words', confidence: 0.8 });

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(200);
		expect(mockLivekit.downloadRecordingAudio).toHaveBeenCalledWith(LEGACY_KEY);
		expect(mockLivekit.fetchDecryptedRecording).not.toHaveBeenCalled();
	});
});
