/**
 * GAP-A2 (#1130) STOP 1 R-5 — session finalize gating.
 *
 * The session flow's unconditional `UPDATE interview_recordings
 * SET status='completed'` (routes/interview-sessions.js) must be gated on
 * the encrypt-at-completion result: when completeRecordingRecord reports
 * { completed: false } (quarantined), the recording row must NOT be
 * marked completed by the finalize path. MOCKED suite, modeled on
 * interview-sessions-observer.test.js.
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
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: jest.fn(),
	selectQuestionSource: jest.fn(() => 'template'),
	TURN_TIMEOUT_MS: 20000,
}));
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: jest.fn(async () => ({ overall_score: 80, recommendation: 'advance' })),
	runMultiEvaluation: jest.fn(async () => ({})),
}));
jest.mock('../../../lib/ai-provider', () => ({ transcribeAudio: jest.fn() }));
jest.mock('../../../lib/polsia-ai', () => ({ textToSpeech: jest.fn() }));
jest.mock('../../../lib/notify', () => ({ notifyUser: jest.fn() }));
jest.mock('../../../routes/audit', () => ({ insertAuditLog: jest.fn(async () => ({})) }));

const mockFindRecordingBySessionId = jest.fn();
const mockStopSessionEgress = jest.fn();
const mockCompleteRecordingRecord = jest.fn();
jest.mock('../../services/livekit', () => ({
	findRecordingBySessionId: (...a) => mockFindRecordingBySessionId(...a),
	hasActiveConsent: jest.fn(async () => true),
	dispatchVoiceAgent: jest.fn(),
	startSessionEgress: jest.fn(),
	stopSessionEgress: (...a) => mockStopSessionEgress(...a),
	completeRecordingRecord: (...a) => mockCompleteRecordingRecord(...a),
	getRecordingRetentionDate: () => new Date('2026-04-01T00:00:00Z'),
}));
jest.mock('../../../services/qa-extraction', () => ({
	extractQAPairs: jest.fn(async () => []),
	analyzeObserverSession: jest.fn(async () => ({})),
}));

const mockSessions = new Map();
const capturedSql = [];
jest.mock('../../../lib/db', () => ({
	query: jest.fn(async (sql, params = []) => {
		capturedSql.push(sql.replace(/\s+/g, ' '));
		const n = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		if (n.startsWith('select * from interview_sessions where id =')) {
			const row = mockSessions.get(Number(params[0]));
			return { rows: row ? [{ ...row }] : [] };
		}
		if (n.startsWith("update interview_sessions") && n.includes("status = 'completed'")) {
			const row = mockSessions.get(Number(params[2]));
			if (row) row.status = 'completed';
			return { rows: row ? [{ ...row }] : [] };
		}
		return { rows: [] };
	}),
}));

const router = require('../../../routes/interview-sessions');
const app = express();
app.use(express.json());
app.use(router);

global.__testUsers = {
	1: { id: 1, role: 'recruiter', company_id: 2, email: 'r@x.com' },
	4: { id: 4, role: 'candidate', company_id: null, email: 'c@x.com' },
};
const as = (id) => ({ 'x-test-user-id': String(id) });

function seedSession() {
	const id = mockSessions.size + 1;
	const row = {
		id,
		type: 'human',
		job_id: 11,
		application_id: null,
		candidate_id: 4,
		company_id: 2,
		status: 'in_progress',
		config: {},
		conversation: [],
	};
	mockSessions.set(id, row);
	return row;
}

const recordingCompletedUpdates = () =>
	capturedSql.filter(
		(s) => /update interview_recordings/i.test(s) && s.includes("status = 'completed'"),
	);

beforeEach(() => {
	mockSessions.clear();
	capturedSql.length = 0;
	jest.clearAllMocks();
	mockFindRecordingBySessionId.mockResolvedValue({ id: 55 });
	mockStopSessionEgress.mockResolvedValue({
		egressId: 'EG_1',
		status: 'EGRESS_COMPLETE',
		fileLocation: 's3://test-bucket/rekrut-recordings/interview-1-1.mp4',
		durationSeconds: 30,
		fileSizeBytes: 1234,
	});
});

describe('POST /interview-sessions/:id/complete — recording finalize gate (R-5)', () => {
	test('quarantined completion ({completed:false}) → recording is NOT marked completed by finalize', async () => {
		mockCompleteRecordingRecord.mockResolvedValue({ completed: false, quarantined: true });
		const s = seedSession();

		const res = await request(app).post(`/interview-sessions/${s.id}/complete`).set(as(1));

		expect(res.status).toBe(200);
		expect(mockCompleteRecordingRecord).toHaveBeenCalled();
		expect(recordingCompletedUpdates()).toHaveLength(0);
	});

	test('successful encrypted completion ({completed:true}) → finalize retention UPDATE still runs', async () => {
		mockCompleteRecordingRecord.mockResolvedValue({ completed: true });
		const s = seedSession();

		const res = await request(app).post(`/interview-sessions/${s.id}/complete`).set(as(1));

		expect(res.status).toBe(200);
		expect(recordingCompletedUpdates().length).toBeGreaterThan(0);
	});
});
