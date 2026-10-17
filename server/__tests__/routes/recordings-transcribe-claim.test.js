/**
 * #1202 — Transcription claim rowCount unchecked.
 *
 * The transcribe claim is the atomic UPDATE … SET status='processing'
 * WHERE id=$1 AND status='completed'. If a concurrent transcribe already
 * claimed the recording, this UPDATE matches 0 rows. The handler must bail
 * (409) at that point — it must NOT download/decrypt the audio, call
 * Whisper, or INSERT a (duplicate) transcript.
 *
 * RED on pristine dev: claim rowCount 0 still proceeded to a 200 + INSERT.
 * Mocked suite mirroring recordings-encryption.test.js.
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

process.env.JWT_SECRET = 'test-secret-1202';
process.env.RECORDING_STORAGE_ENDPOINT = 'https://ep.local';
process.env.RECORDING_STORAGE_BUCKET = 'bkt';

const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

let claimRowCount;
let transcriptInserts;

db.query.mockImplementation(async (sql, params) => {
	const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (n.includes('from interview_sessions') && n.includes('where id')) {
		return { rows: [{ id: 10, candidate_id: 7, company_id: 99 }], rowCount: 1 };
	}
	if (n.startsWith('update interview_recordings')) {
		// The claim is the only UPDATE scoped FROM 'completed'; the resets
		// and completion updates are scoped FROM 'processing'.
		if (n.includes("set status = 'processing'")) {
			return { rows: [], rowCount: claimRowCount };
		}
		return { rows: [], rowCount: 1 };
	}
	if (n.startsWith('insert into interview_transcripts')) {
		transcriptInserts += 1;
		return { rows: [], rowCount: 1 };
	}
	return baseQueryImpl(sql, params);
});

const router = require('../../routes/recordings');
const app = express();
app.use(express.json());
app.use('/recordings', router);

global.__testUsers = {
	9: { id: 9, role: 'recruiter', company_id: 99 },
};
const as = (id) => ({ 'x-test-user-id': String(id) });

beforeEach(() => {
	jest.clearAllMocks();
	transcriptInserts = 0;
	claimRowCount = 1;
	mockLivekit.findRecordingById.mockResolvedValue({
		id: 5,
		status: 'completed',
		interview_session_id: 10,
		interview_event_id: null,
		storage_path: Buffer.from('pointer'),
		duration_seconds: 60,
	});
	mockLivekit.isEncryptedRecording.mockReturnValue(false);
	mockLivekit.decryptStoragePath.mockReturnValue('rekrut-recordings/legacy.mp4');
	mockLivekit.downloadRecordingAudio.mockResolvedValue(Buffer.from('AUDIO-BYTES'));
	mockWhisper.mockResolvedValue({ text: 'hello world', confidence: 0.9 });
});

describe('POST /recordings/:id/transcribe — claim rowCount (#1202)', () => {
	test('claim matched 0 rows (concurrent transcribe won) → 409, no download, no Whisper, no transcript INSERT', async () => {
		claimRowCount = 0;

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(409);
		expect(mockLivekit.downloadRecordingAudio).not.toHaveBeenCalled();
		expect(mockLivekit.fetchDecryptedRecording).not.toHaveBeenCalled();
		expect(mockWhisper).not.toHaveBeenCalled();
		expect(transcriptInserts).toBe(0);
	});

	test('claim matched 1 row → transcription proceeds and stores one transcript', async () => {
		claimRowCount = 1;

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(200);
		expect(res.body.transcript.text).toBe('hello world');
		expect(mockWhisper).toHaveBeenCalledTimes(1);
		expect(transcriptInserts).toBe(1);
	});
});
