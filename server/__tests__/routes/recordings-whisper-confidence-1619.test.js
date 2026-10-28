/**
 * #1619 — server/routes/recordings.js stamps a fabricated Whisper
 * confidence 0.85 when none was recorded (2 sites):
 *   L700  INSERT INTO interview_transcripts ... confidence param
 *   L715  transcribe response body transcript.confidence
 *
 * Same fabrication class as #1584/#1613. Honest behaviour: an unrecorded
 * confidence is written/returned as null, and a recorded value in (0, 1]
 * passes through unchanged. Reviewer BLOCK on PR #1623 narrowed the
 * #1613 `?? null` shape for THIS field: several provider writers stamp
 * `confidence: 0` as their "not reported" default (Cartesia, NIM,
 * Deepgram path), so 0 — like >1, negative, or NaN — is provider
 * garbage, not a measurement, and must also become null (storing it
 * would mint a fake measured 0.000 and violate the column CHECK for
 * out-of-range values). interview_transcripts.confidence is nullable
 * (migrations 128/129: DECIMAL(4,3) CHECK 0..1, no NOT NULL).
 *
 * Mocked suite mirroring recordings-transcribe-claim.test.js: the mocked
 * layer is the DB/Whisper boundary; the fabrication lives in the values
 * the handler hands to the pool and to the response, asserted here.
 * The real-DB proof is the Quinn HL-003 E2E (see issue #1619).
 *
 * Red on pristine dev: unrecorded confidence arrives as 0.85 at both
 * sites, and a measured 0 is also destroyed to 0.85 by `||`.
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
// #1904 (S-D02): the handler now calls with requireSegments, so a successful
// Whisper result carries segments (S-D01 contract) — the mocks here do too.
	transcribeAudioWithWhisper: (...a) => mockWhisper(...a),
}));

process.env.JWT_SECRET = 'test-secret';
process.env.RECORDING_STORAGE_ENDPOINT = 'https://ep.local';
process.env.RECORDING_STORAGE_BUCKET = 'bkt';

const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

let insertParams;
let insertCount;

db.query.mockImplementation(async (sql, params) => {
	const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (n.includes('from interview_sessions') && n.includes('where id')) {
		return { rows: [{ id: 10, candidate_id: 7, company_id: 99 }], rowCount: 1 };
	}
	if (n.startsWith('update interview_recordings')) {
		return { rows: [], rowCount: 1 };
	}
	if (n.startsWith('insert into interview_transcripts')) {
		insertCount += 1;
		insertParams = params;
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
	insertParams = null;
	insertCount = 0;
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
});

describe('POST /recordings/:id/transcribe — whisper confidence honesty (#1619)', () => {
	test('unrecorded confidence (Whisper result has no confidence field) → DB null + response null, never 0.85', async () => {
		mockWhisper.mockResolvedValue({ text: 'hello world', segments: [{ start_s: 0, end_s: 60, text: 'hello world' }] });

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(200);
		expect(insertCount).toBe(1);
		// INSERT params: [recording_id, speaker, text, start_ms, end_ms, confidence]
		expect(insertParams[5]).toBeNull();
		expect(res.body.transcript).toHaveProperty('confidence');
		expect(res.body.transcript.confidence).toBeNull();
	});

	test('provider confidence 0 → null at both sites (0 is the providers\' "not reported" default, not a measurement — reviewer BLOCK, PR #1623)', async () => {
		mockWhisper.mockResolvedValue({ text: 'hello world', confidence: 0, segments: [{ start_s: 0, end_s: 60, text: 'hello world' }] });

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(200);
		expect(insertParams[5]).toBeNull();
		expect(res.body.transcript.confidence).toBeNull();
	});

	test.each([
		['above range', 1.7],
		['negative', -0.2],
		['NaN', NaN],
	])('provider confidence %s (%s) → null at both sites, never stored', async (_label, bad) => {
		mockWhisper.mockResolvedValue({ text: 'hello world', confidence: bad, segments: [{ start_s: 0, end_s: 60, text: 'hello world' }] });

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(200);
		expect(insertParams[5]).toBeNull();
		expect(res.body.transcript.confidence).toBeNull();
	});

	test('recorded confidence 0.42 → passes through unchanged at both sites', async () => {
		mockWhisper.mockResolvedValue({ text: 'hello world', confidence: 0.42, segments: [{ start_s: 0, end_s: 60, text: 'hello world' }] });

		const res = await request(app).post('/recordings/5/transcribe').set(as(9));

		expect(res.status).toBe(200);
		expect(insertParams[5]).toBe(0.42);
		expect(res.body.transcript.confidence).toBe(0.42);
	});
});
