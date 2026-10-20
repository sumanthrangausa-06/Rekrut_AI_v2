/**
 * #1179 — routes/interview-sessions.js hallucination log redaction.
 *
 * The /respond handler used to log the ENTIRE candidate transcript when
 * the Whisper hallucination filter fired:
 *   Filtered Whisper hallucination: "${candidateText}"
 * Fix contract (STOP 1 on #1179): char count only — no transcript text,
 * no substring of it, in any log line.
 *
 * Harness mirrors server/__tests__/routes/interview-sessions.test.js
 * (supertest + mocked lib/db session store + mocked AI boundaries),
 * trimmed to the create → start → respond-with-audio path. The mocked
 * ASR returns a known hallucination phrase ("Thank you for watching.",
 * lib/transcription.js) carrying a unique CANARY suffix — on pristine
 * code the canary lands in the log; after the fix it must not.
 *
 * This unit test does NOT satisfy the E2E-on-dev gate (HL-003).
 */
const request = require('supertest');
const express = require('express');

// ─── Auth bypass (same pattern as interview-sessions.test.js) ────────────
jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	const authMiddleware = jest.fn((req, res, next) => {
		if (req.headers['x-test-user-id']) {
			const userId = parseInt(req.headers['x-test-user-id'], 10);
			const user = global.__testUsers?.[userId];
			if (user) {
				req.user = user;
				return next();
			}
		}
		return res.status(401).json({ error: 'Unauthorized' });
	});
	return { ...actual, authMiddleware };
});

// ─── AI boundaries ────────────────────────────────────────────────────────
const mockConductTurn = jest.fn();
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: (...args) => mockConductTurn(...args),
	selectQuestionSource: jest.fn((s) =>
		s?.config?.question_source === 'personalized' ? 'personalized' : 'template',
	),
	TURN_TIMEOUT_MS: 20000,
}));

const mockGenerateReport = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateReport(...args),
}));

const mockTranscribeAudio = jest.fn();
jest.mock('../../../lib/ai-provider', () => ({
	transcribeAudio: (...args) => mockTranscribeAudio(...args),
}));

const mockTextToSpeech = jest.fn();
jest.mock('../../../lib/polsia-ai', () => ({
	textToSpeech: (...args) => mockTextToSpeech(...args),
}));

const mockEgressClient = {
	startRoomCompositeEgress: jest.fn(),
	stopEgress: jest.fn(async (egressId) => ({ egressId, status: 'EGRESS_COMPLETE' })),
	listEgress: jest.fn(async () => []),
};
jest.mock('livekit-server-sdk', () => {
	const actual = jest.requireActual('livekit-server-sdk');
	return { ...actual, EgressClient: jest.fn(() => mockEgressClient) };
});
process.env.LIVEKIT_API_KEY = 'test-livekit-key';
process.env.LIVEKIT_API_SECRET = 'test-livekit-secret';
process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

const mockNotifyUser = jest.fn();
jest.mock('../../../lib/notify', () => ({
	notifyUser: (...args) => mockNotifyUser(...args),
}));

const mockInsertAuditLog = jest.fn(async () => ({}));
jest.mock('../../../routes/audit', () => ({
	insertAuditLog: (...args) => mockInsertAuditLog(...args),
}));

// ─── In-memory interview_sessions store (extends the global mocked db) ───
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const sessions = new Map();
let nextSessionId = 1;

function maybeParse(v) {
	if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	}
	return v;
}

db.query.mockImplementation(async (sql, params) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	if (normalized.startsWith('insert into interview_sessions')) {
		const row = {
			id: nextSessionId++,
			type: params[0],
			job_id: params[1],
			application_id: params[2],
			candidate_id: params[3],
			company_id: params[4],
			triggered_by: params[5],
			invite_token: params[6],
			status: 'invited',
			config: maybeParse(params[7]),
			conversation: maybeParse(params[8]),
			frame_analysis: null,
			started_at: null,
			completed_at: null,
			created_at: new Date().toISOString(),
		};
		sessions.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized.includes('from interview_sessions where id =')) {
		const row = sessions.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('update interview_sessions set')) {
		const setPart = normalized.split(/\bset\b/)[1].split(/\bwhere\b/)[0];
		const id = Number(params[params.length - 1]);
		const row = sessions.get(id);
		if (!row) return { rows: [], rowCount: 0 };
		for (const assignment of setPart.split(',')) {
			const trimmed = assignment.trim();
			const mergeMatch = trimmed.match(/^(\w+)\s*=\s*\1\s*\|\|\s*\$(\d+)(::\w+)?$/);
			if (mergeMatch) {
				const delta = maybeParse(params[Number(mergeMatch[2]) - 1]) || {};
				row[mergeMatch[1]] = { ...(row[mergeMatch[1]] || {}), ...delta };
				continue;
			}
			const paramMatch = trimmed.match(/^(\w+)\s*=\s*\$(\d+)$/);
			if (paramMatch) {
				row[paramMatch[1]] = maybeParse(params[Number(paramMatch[2]) - 1]);
				continue;
			}
			const literalMatch = trimmed.match(/^(\w+)\s*=\s*'([^']*)'$/);
			if (literalMatch) {
				row[literalMatch[1]] = literalMatch[2];
			}
		}
		return { rows: [{ ...row }], rowCount: 1 };
	}
	return baseQueryImpl(sql, params);
});

// ─── App under test ───────────────────────────────────────────────────────
const interviewSessionRoutes = require('../../../routes/interview-sessions');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewSessionRoutes);
	return app;
}

const CANDIDATE = { id: 1, email: 'cand@test.com', role: 'candidate' };
const CANARY = 'CANARY-TRANSCRIPT-1179 secret candidate answer';
const HALLUCINATION_TEXT = `Thank you for watching. ${CANARY}`;

let logSpy;
let errorSpy;
beforeEach(() => {
	sessions.clear();
	nextSessionId = 1;
	global.__testUsers = { 1: CANDIDATE };
	mockConductTurn.mockReset();
	mockGenerateReport.mockReset();
	mockTranscribeAudio.mockReset();
	mockNotifyUser.mockReset();
	mockTextToSpeech.mockReset();
	mockTextToSpeech.mockResolvedValue(Buffer.from('fake-mp3-bytes'));
	mockConductTurn.mockResolvedValue({
		ai_message: 'Next question?',
		phase: 'background',
		is_complete: false,
	});
	logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
	errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	jest.restoreAllMocks();
});

const logOutput = () =>
	logSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');

describe('#1179 POST /respond — filtered hallucination is logged as a count, never as text', () => {
	it('canary transcript is absent from logs; char count is logged; turn is rejected as too short', async () => {
		const app = buildApp();
		const created = await request(app)
			.post('/api/interviews/interview-sessions')
			.set('x-test-user-id', '1')
			.send({
				type: 'screening',
				job_id: 10,
				application_id: 20,
				candidate_id: 1,
				company_id: 5,
				config: {
					question_source: 'template',
					job: { title: 'Backend Engineer', description: 'Node.js APIs', company_name: 'Acme' },
					template: { topics: ['experience'], questions: [] },
					current_phase: 'intro',
				},
			});
		expect(created.status).toBe(201);
		const id = created.body.session.id;

		const started = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/start`)
			.set('x-test-user-id', '1');
		expect(started.status).toBe(200);
		// /start itself calls the engine for the opening question; only
		// calls from the /respond turn count from here.
		mockConductTurn.mockClear();

		mockTranscribeAudio.mockResolvedValue({ text: HALLUCINATION_TEXT });

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${id}/respond`)
			.set('x-test-user-id', '1')
			.attach('audio', Buffer.from('fake-audio-bytes'), {
				filename: 'answer.webm',
				contentType: 'audio/webm',
			});

		// Hallucination filtered → candidate text cleared → too-short 400.
		// Behaviour unchanged by the log fix. (mockConductTurn IS called
		// during session create/start with an empty answer — the pin is
		// that the filtered hallucination text never reaches it.)
		expect(res.status).toBe(400);
		for (const call of mockConductTurn.mock.calls) {
			expect(String(call[1] ?? '')).not.toContain(CANARY);
			expect(String(call[1] ?? '')).not.toContain(HALLUCINATION_TEXT);
		}

		const logs = logOutput();
		expect(logs).toContain('[interview-sessions] Filtered Whisper hallucination');
		expect(logs).toContain(`${HALLUCINATION_TEXT.length} chars`);
		expect(logs).not.toContain(CANARY);
		expect(logs).not.toContain(HALLUCINATION_TEXT);
	});
});
