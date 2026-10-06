/**
 * Task 4 — session-linked recordings, consent & retention (issue #322).
 *
 * Supertest against the interview-sessions router (recording row lifecycle)
 * and the recordings router (consent for session-linked recordings).
 * Same mocked-DB strategy as Task 3's test: the repo's standard mocked lib/db
 * (server/test/setup.js) extended here with in-memory interview-domain stores.
 * AI boundaries are mocked; the SQL the implementation issues is asserted via
 * the in-memory stores.
 *
 * RED/GREEN: every test below fails before the Task 4 implementation
 * (no recording row on start, consent 403s for session recordings,
 * 'withdrawn' rejected by validation, no transcript writes on complete).
 */

const request = require('supertest');
const express = require('express');

// ─── Auth bypass (same pattern as interview-sessions.test.js) ───────────────
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

// ─── AI boundaries ──────────────────────────────────────────────────────────
const mockConductTurn = jest.fn();
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: (...args) => mockConductTurn(...args),
	selectQuestionSource: jest.fn(),
	TURN_TIMEOUT_MS: 20000,
}));

const mockGenerateReport = jest.fn();
jest.mock('../../../services/interview-ai', () => ({
	generateScreeningReport: (...args) => mockGenerateReport(...args),
}));

jest.mock('../../../lib/ai-provider', () => ({
	transcribeAudio: jest.fn(),
}));

jest.mock('../../../lib/polsia-ai', () => ({
	textToSpeech: jest.fn(),
	transcribeAudioWithWhisper: jest.fn(),
}));

// ─── In-memory interview-domain stores ──────────────────────────────────────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const CANDIDATE = { id: 1, email: 'cand@test.com', role: 'candidate', company_id: null };
const RECRUITER = { id: 2, email: 'rec@test.com', role: 'recruiter', company_id: 100 };

const sessions = new Map();
let nextSessionId = 1;
const recordings = new Map();
let nextRecordingId = 1;
const consents = new Map(); // `${recordingId}:${userId}` -> row
const transcripts = [];
let nextTranscriptId = 1;

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

function resetStores() {
	sessions.clear();
	recordings.clear();
	consents.clear();
	transcripts.length = 0;
	nextSessionId = 1;
	nextRecordingId = 1;
	nextTranscriptId = 1;
	global.__testUsers = { 1: CANDIDATE, 2: RECRUITER };
	mockConductTurn.mockReset();
	mockGenerateReport.mockReset();
	mockConductTurn.mockImplementation(async () => ({
		ai_message: 'Tell me about yourself.',
		phase: 'intro',
		is_complete: false,
	}));
	mockGenerateReport.mockImplementation(async () => ({ overall_score: 82 }));
}

function seedSession(overrides = {}) {
	const row = {
		id: nextSessionId++,
		type: 'screening',
		job_id: 10,
		application_id: 7,
		candidate_id: 1,
		company_id: 100,
		triggered_by: 2,
		invite_token: `tok-${nextSessionId}`,
		status: 'invited',
		config: { question_source: 'template', template: { questions: [] }, current_phase: 'intro' },
		conversation: [],
		frame_analysis: null,
		started_at: null,
		completed_at: null,
		created_at: new Date().toISOString(),
		...overrides,
	};
	sessions.set(row.id, row);
	return row;
}

db.query.mockImplementation(async (text, params = []) => {
	const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

	// ── interview_sessions ──
	if (normalized.startsWith('insert into interview_sessions')) {
		const row = seedSession({
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
		});
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized === 'select * from interview_sessions where id = $1') {
		const row = sessions.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('update interview_sessions set frame_analysis = $1 where id = $2')) {
		const row = sessions.get(Number(params[1]));
		if (row) row.frame_analysis = maybeParse(params[0]);
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith('update interview_sessions')) {
		// start / respond / complete shapes — apply conversation/config/status updates
		const id = Number(params[params.length - 1]);
		const row = sessions.get(id);
		if (row) {
			if (normalized.includes('set conversation = $1, config = $2')) {
				row.conversation = maybeParse(params[0]);
				row.config = maybeParse(params[1]);
			} else if (normalized.includes('set conversation = $1 where')) {
				row.conversation = maybeParse(params[0]);
			}
			if (normalized.includes("status = 'in_progress'")) {
				row.status = 'in_progress';
				row.started_at = new Date().toISOString();
			}
			if (normalized.includes("status = 'completed'")) {
				row.status = 'completed';
				row.completed_at = new Date().toISOString();
			}
		}
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}

	// ── interview_recordings ──
	if (normalized.startsWith('insert into interview_recordings')) {
		const row = {
			id: nextRecordingId++,
			interview_event_id: params[0],
			room_id: params[1],
			interview_session_id: params[2],
			livekit_egress_id: params[3],
			status: params[4],
			started_at: new Date().toISOString(),
			stopped_at: null,
			retention_expires_at: params[5],
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		recordings.set(row.id, row);
		return { rows: [{ ...row }], rowCount: 1 };
	}
	if (normalized === 'select * from interview_recordings where id = $1') {
		const row = recordings.get(Number(params[0]));
		return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
	}
	if (normalized.includes('from interview_recordings where interview_session_id = $1')) {
		const rows = [...recordings.values()].filter(
			(r) => Number(r.interview_session_id) === Number(params[0]),
		);
		return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
	}
	if (normalized.startsWith("update interview_recordings set status = 'completed'")) {
		const row = recordings.get(Number(params[0]));
		if (row) {
			row.status = 'completed';
			row.stopped_at = new Date().toISOString();
		}
		return { rows: [], rowCount: row ? 1 : 0 };
	}
	if (normalized.startsWith("update interview_recordings set status = 'deleted'")) {
		let count = 0;
		const now = new Date();
		for (const row of recordings.values()) {
			if (row.status !== 'deleted' && new Date(row.retention_expires_at) < now) {
				row.status = 'deleted';
				row.updated_at = new Date().toISOString();
				count++;
			}
		}
		return { rows: [], rowCount: count };
	}
	if (normalized.includes('set retention_expires_at = $1')) {
		const expiresAt = params[0];
		const applicationId = Number(params[1]);
		let count = 0;
		for (const row of recordings.values()) {
			const sess = sessions.get(Number(row.interview_session_id));
			if (sess && Number(sess.application_id) === applicationId) {
				row.retention_expires_at = expiresAt;
				count++;
			}
		}
		return { rows: [], rowCount: count };
	}

	// ── recording_consent ──
	if (normalized.startsWith('insert into recording_consent')) {
		const key = `${params[0]}:${params[1]}`;
		const row = {
			recording_id: params[0],
			user_id: params[1],
			consented_at: new Date().toISOString(),
			consent_type: params[2],
			ip_address: params[3],
			user_agent: params[4],
		};
		consents.set(key, row);
		return { rows: [], rowCount: 1 };
	}
	if (normalized.startsWith('select consent_type from recording_consent where recording_id = $1')) {
		const row = consents.get(`${params[0]}:${params[1]}`);
		return { rows: row ? [{ consent_type: row.consent_type }] : [], rowCount: row ? 1 : 0 };
	}

	// ── interview_transcripts ──
	if (normalized.startsWith('insert into interview_transcripts')) {
		const row = {
			id: nextTranscriptId++,
			recording_id: params[0],
			speaker_identity: params[1],
			text: params[2],
			start_time_ms: params[3],
			end_time_ms: params[4],
			confidence: params[5],
			created_at: new Date().toISOString(),
		};
		transcripts.push(row);
		return { rows: [{ ...row }], rowCount: 1 };
	}

	return baseQueryImpl(text, params);
});

const interviewSessionsRouter = require('../../../routes/interview-sessions');
const recordingsRouter = require('../../../server/routes/recordings');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', interviewSessionsRouter);
	app.use('/api/interviews/recordings', recordingsRouter);
	return app;
}

beforeEach(resetStores);

// ─── Session start creates the recording row ────────────────────────────────
describe('POST /api/interviews/interview-sessions/:id/start — recording row', () => {
	it('creates an interview_recordings row linked to the session', async () => {
		const app = buildApp();
		const session = seedSession();

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		const rows = [...recordings.values()].filter(
			(r) => Number(r.interview_session_id) === session.id,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('pending');
		expect(rows[0].interview_event_id).toBeNull();
		expect(rows[0].room_id).toBeNull();
		expect(res.body.recording).toMatchObject({
			interview_session_id: session.id,
			status: 'pending',
		});
	});

	it('does not duplicate the recording row on idempotent re-start', async () => {
		const app = buildApp();
		const session = seedSession();

		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');

		expect(res.body.already_started).toBe(true);
		const rows = [...recordings.values()].filter(
			(r) => Number(r.interview_session_id) === session.id,
		);
		expect(rows).toHaveLength(1);
	});
});

// ─── Consent for session-linked recordings ──────────────────────────────────
describe('POST /api/interviews/recordings/:id/consent — session recordings', () => {
	it('writes recording_consent for a session-linked recording', async () => {
		const app = buildApp();
		const session = seedSession();
		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		const recording = [...recordings.values()].find(
			(r) => Number(r.interview_session_id) === session.id,
		);

		const res = await request(app)
			.post(`/api/interviews/recordings/${recording.id}/consent`)
			.set('x-test-user-id', '1')
			.send({ consent_type: 'explicit' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		const consent = consents.get(`${recording.id}:1`);
		expect(consent).toBeDefined();
		expect(consent.consent_type).toBe('explicit');
	});

	it('accepts consent withdrawal', async () => {
		const app = buildApp();
		const session = seedSession();
		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		const recording = [...recordings.values()].find(
			(r) => Number(r.interview_session_id) === session.id,
		);

		const res = await request(app)
			.post(`/api/interviews/recordings/${recording.id}/consent`)
			.set('x-test-user-id', '1')
			.send({ consent_type: 'withdrawn' });

		expect(res.status).toBe(200);
		expect(consents.get(`${recording.id}:1`).consent_type).toBe('withdrawn');
	});

	it('blocks frame capture after consent is withdrawn', async () => {
		const app = buildApp();
		const session = seedSession();
		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		const recording = [...recordings.values()].find(
			(r) => Number(r.interview_session_id) === session.id,
		);
		await request(app)
			.post(`/api/interviews/recordings/${recording.id}/consent`)
			.set('x-test-user-id', '1')
			.send({ consent_type: 'withdrawn' });

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'My answer with video on.', frames: ['frame-bytes-1'] });

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
	});

	it('still allows text-only respond after consent is withdrawn', async () => {
		const app = buildApp();
		const session = seedSession();
		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		const recording = [...recordings.values()].find(
			(r) => Number(r.interview_session_id) === session.id,
		);
		await request(app)
			.post(`/api/interviews/recordings/${recording.id}/consent`)
			.set('x-test-user-id', '1')
			.send({ consent_type: 'withdrawn' });

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'My answer without video.' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it('blocks frame capture when no consent row exists', async () => {
		const app = buildApp();
		const session = seedSession();
		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		// No consent written at all — capture must not proceed.

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'My answer with video on.', frames: ['frame-bytes-1'] });

		expect(res.status).toBe(403);
		expect(res.body.code).toBe('CONSENT_REQUIRED');
	});

	it('still allows text-only respond when no consent row exists', async () => {
		const app = buildApp();
		const session = seedSession();
		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		// No consent written at all.

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/respond`)
			.set('x-test-user-id', '1')
			.send({ text: 'My answer without video.' });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});
});

// ─── Complete writes transcripts + frame analysis ───────────────────────────
describe('POST /api/interviews/interview-sessions/:id/complete — transcripts', () => {
	it('writes transcript segments linked to the session recording', async () => {
		const app = buildApp();
		const session = seedSession();
		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/start`)
			.set('x-test-user-id', '1');
		const recording = [...recordings.values()].find(
			(r) => Number(r.interview_session_id) === session.id,
		);
		expect(recording).toBeDefined();
		const s = sessions.get(session.id);
		s.conversation = [
			{ role: 'interviewer', text: 'Tell me about yourself.', timestamp: new Date().toISOString() },
			{ role: 'candidate', text: 'I am a data analyst.', timestamp: new Date().toISOString() },
		];

		const res = await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/complete`)
			.set('x-test-user-id', '1');

		expect(res.status).toBe(200);
		const segs = transcripts.filter((t) => Number(t.recording_id) === recording.id);
		expect(segs.length).toBe(2);
		expect(segs[0]).toMatchObject({
			speaker_identity: 'interviewer',
			text: 'Tell me about yourself.',
		});
		expect(segs[1]).toMatchObject({ speaker_identity: 'candidate', text: 'I am a data analyst.' });
		expect(recordings.get(recording.id).status).toBe('completed');
	});

	it('aggregates per-turn frame indicators into frame_analysis', async () => {
		const app = buildApp();
		const session = seedSession({ status: 'in_progress' });
		const s = sessions.get(session.id);
		s.conversation = [
			{
				role: 'candidate',
				text: 'Answer one.',
				timestamp: new Date().toISOString(),
				frame_indicators: { eye_contact: 'good', confidence: 'fair' },
			},
		];

		await request(app)
			.post(`/api/interviews/interview-sessions/${session.id}/complete`)
			.set('x-test-user-id', '1');

		const updated = sessions.get(session.id);
		expect(updated.frame_analysis).toBeTruthy();
		expect(updated.frame_analysis.per_turn).toHaveLength(1);
		expect(updated.frame_analysis.per_turn[0]).toMatchObject({ eye_contact: 'good' });
	});
});

// ─── Retention ──────────────────────────────────────────────────────────────
describe('retention', () => {
	it('purgeExpiredRecordings soft-deletes recordings past retention_expires_at', async () => {
		const EuComplianceService = require('../../../services/euComplianceService');
		recordings.set(1, {
			id: 1,
			interview_session_id: 9,
			status: 'completed',
			retention_expires_at: new Date(Date.now() - 1000).toISOString(),
		});
		recordings.set(2, {
			id: 2,
			interview_session_id: 10,
			status: 'completed',
			retention_expires_at: new Date(Date.now() + 86400000).toISOString(),
		});
		nextRecordingId = 3;

		const result = await EuComplianceService.purgeExpiredRecordings();

		expect(result.deletedCount).toBe(1);
		expect(recordings.get(1).status).toBe('deleted');
		expect(recordings.get(2).status).toBe('completed');
	});

	it('setSessionRecordingsRetentionAfterDecision sets decision + 30 days', async () => {
		const livekitService = require('../../../server/services/livekit');
		const session = seedSession({ application_id: 42 });
		recordings.set(1, {
			id: 1,
			interview_session_id: session.id,
			status: 'completed',
			retention_expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
		});
		nextRecordingId = 2;

		const before = new Date(recordings.get(1).retention_expires_at).getTime();
		await livekitService.setSessionRecordingsRetentionAfterDecision(42);
		const after = new Date(recordings.get(1).retention_expires_at).getTime();

		expect(after).toBeLessThan(before);
		// ~30 days from now (within a 1-minute tolerance for test execution time)
		expect(after).toBeGreaterThan(Date.now() + 29 * 86400000);
		expect(after).toBeLessThan(Date.now() + 31 * 86400000);
	});
});
