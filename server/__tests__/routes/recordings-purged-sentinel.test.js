/**
 * #802 — `[purged]` transcript sentinel leaks into user-facing recordings API.
 *
 * After retention purge, interview_transcripts.text is '[purged]' in storage
 * (services/euComplianceService.js). User-facing responses must render purged
 * content as ABSENCE: excluded from the transcript segment list and from the
 * recording-detail segment_count. Storage is untouched.
 *
 * RED on pristine dev: GET /:id/transcript returns the '[purged]' segment
 * verbatim; GET /:id counts it. Mocked suite mirroring
 * recordings-transcribe-claim.test.js; behavioural proof is the Quinn
 * fresh-install HTTP gate.
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

jest.mock('../../../lib/polsia-ai', () => ({
	transcribeAudioWithWhisper: jest.fn(),
}));

process.env.JWT_SECRET = 'test-secret';
process.env.RECORDING_STORAGE_ENDPOINT = 'https://ep.local';
process.env.RECORDING_STORAGE_BUCKET = 'bkt';

const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

// Fixture segments: two real, one purged tombstone.
const SEGMENTS = [
	{ id: 1, speaker_identity: 'candidate', text: 'real answer one', start_time_ms: 0, end_time_ms: 1000, confidence: 0.9, created_at: new Date() },
	{ id: 2, speaker_identity: 'candidate', text: '[purged]', start_time_ms: 1000, end_time_ms: 2000, confidence: 0.9, created_at: new Date() },
	{ id: 3, speaker_identity: 'recruiter', text: 'real question two', start_time_ms: 2000, end_time_ms: 3000, confidence: 0.9, created_at: new Date() },
];
let segmentsFixture = SEGMENTS;
let lastCountSql = null;

db.query.mockImplementation(async (sql, params) => {
	const n = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (n.includes('from interview_sessions') && n.includes('where id')) {
		return { rows: [{ id: 10, candidate_id: 7, company_id: 99 }], rowCount: 1 };
	}
	if (n.includes('count(*) as segment_count')) {
		lastCountSql = sql;
		// Simulate real SQL semantics against the fixture: a query carrying
		// the purged-exclusion predicate counts only visible segments.
		const excludesPurged = sql.includes('[purged]');
		const visible = excludesPurged ? segmentsFixture.filter((s) => s.text !== '[purged]') : segmentsFixture;
		return { rows: [{ segment_count: String(visible.length), last_transcript_at: null }], rowCount: 1 };
	}
	if (n.includes('from interview_transcripts') && n.includes('where recording_id')) {
		// Segment-list SELECT: simulate SQL semantics the same way.
		const excludesPurged = sql.includes('[purged]');
		const rows = excludesPurged ? segmentsFixture.filter((s) => s.text !== '[purged]') : segmentsFixture;
		return { rows, rowCount: rows.length };
	}
	if (n.includes('count(*) as highlight_count')) {
		return { rows: [{ highlight_count: '0' }], rowCount: 1 };
	}
	if (n.includes('from transcript_highlights')) {
		return { rows: [], rowCount: 0 };
	}
	return baseQueryImpl(sql, params);
});

const router = require('../../routes/recordings');
const app = express();
app.use(express.json());
app.use('/recordings', router);

global.__testUsers = {
	9: { id: 9, role: 'recruiter', company_id: 99 },
	7: { id: 7, role: 'candidate', company_id: null },
	8: { id: 8, role: 'recruiter', company_id: 55 },
};
const as = (id) => ({ 'x-test-user-id': String(id) });

beforeEach(() => {
	jest.clearAllMocks();
	segmentsFixture = SEGMENTS;
	lastCountSql = null;
	mockLivekit.findRecordingById.mockResolvedValue({
		id: 5,
		status: 'completed',
		interview_session_id: 10,
		interview_event_id: null,
		storage_path: Buffer.from('pointer'),
		duration_seconds: 60,
	});
});

describe('GET /recordings/:id/transcript — purged sentinel (#802)', () => {
	test('purged segment is absent; real segments intact; count reflects visible only', async () => {
		const res = await request(app).get('/recordings/5/transcript').set(as(9));
		expect(res.status).toBe(200);
		const segs = res.body.transcript.segments;
		expect(segs.map((s) => s.text)).toEqual(['real answer one', 'real question two']);
		expect(JSON.stringify(res.body)).not.toContain('[purged]');
		expect(res.body.transcript.segment_count).toBe(2);
	});

	test('all-purged recording renders as no transcript (empty list, count 0)', async () => {
		segmentsFixture = [SEGMENTS[1]];
		const res = await request(app).get('/recordings/5/transcript').set(as(9));
		expect(res.status).toBe(200);
		expect(res.body.transcript.segments).toEqual([]);
		expect(res.body.transcript.segment_count).toBe(0);
	});

	test('candidate owner sees the same purged-absent shape', async () => {
		const res = await request(app).get('/recordings/5/transcript').set(as(7));
		expect(res.status).toBe(200);
		expect(JSON.stringify(res.body)).not.toContain('[purged]');
	});

	test('non-owner still 403', async () => {
		const res = await request(app).get('/recordings/5/transcript').set(as(8));
		expect(res.status).toBe(403);
	});
});

describe('GET /recordings/:id — detail segment_count (#802)', () => {
	test('segment_count excludes purged segments', async () => {
		const res = await request(app).get('/recordings/5').set(as(9));
		expect(res.status).toBe(200);
		expect(res.body.recording.transcript.segment_count).toBe(2);
		expect(lastCountSql).toContain('[purged]');
	});
});
