/**
 * Task 1 (#323) — session-linked LiveKit rooms + token endpoint.
 *
 * Supertest against the livekit router's NEW session-model endpoints. The old
 * interview_events endpoints are untouched. There is no live Postgres in this
 * environment (and the shared Neon DB is off-limits), so the DB layer is the
 * repo's standard mocked lib/db (server/test/setup.js) extended here with
 * in-memory interview_sessions + interview_rooms stores. The LiveKit SDK is
 * mocked (no network in jest): generateToken/createRoom are overridden, the
 * rest of the service module is real.
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

// ─── LiveKit SDK boundary ───────────────────────────────────────────────────
// The service module's internal findOrCreateSessionRoom closes over the real
// createRoom (network), so the factory re-wires it onto the stubbed createRoom
// while keeping the REAL findActiveRoomBySessionId + createSessionRoomRecord
// (the SQL/naming/idempotency surface under test).
const mockGenerateToken = jest.fn(async () => 'mock-jwt-token');
const mockCreateRoom = jest.fn(async (roomName) => ({ name: roomName, sid: 'RM_mock' }));
jest.mock('../../services/livekit', () => {
	const actual = jest.requireActual('../../services/livekit');
	const findOrCreateSessionRoom = async (sessionId) => {
		const existing = await actual.findActiveRoomBySessionId(sessionId);
		if (existing) return existing;
		const roomName = `interview-${sessionId}`;
		const livekitRoom = await mockCreateRoom(roomName, {
			emptyTimeout: 600,
			maxParticipants: 10,
		});
		return actual.createSessionRoomRecord({
			sessionId,
			roomName: livekitRoom.name,
			livekitRoomId: livekitRoom.sid,
		});
	};
	return {
		...actual,
		generateToken: (...args) => mockGenerateToken(...args),
		createRoom: (...args) => mockCreateRoom(...args),
		findOrCreateSessionRoom,
		// Real dispatchVoiceAgent closes over the real (network) createRoom, so
		// the route tests drive the real SDK-only dispatchAgentToRoom behind the
		// same stubbed room lookup the Task 1 tests use.
		dispatchVoiceAgent: async (sessionId, mode = 'interviewer') => {
			const room = await findOrCreateSessionRoom(sessionId);
			return actual.dispatchAgentToRoom(room, sessionId, mode);
		},
	};
});

// ─── LiveKit Agent Dispatch SDK boundary ────────────────────────────────────
// dispatchVoiceAgent builds an AgentDispatchClient from livekit-server-sdk;
// the constructor is stubbed so no network happens in jest. listDispatch /
// createDispatch are per-test configured below.
const mockAgentDispatchClient = {
	listDispatch: jest.fn(),
	createDispatch: jest.fn(),
};
jest.mock('livekit-server-sdk', () => {
	const actual = jest.requireActual('livekit-server-sdk');
	return {
		...actual,
		AgentDispatchClient: jest.fn(() => mockAgentDispatchClient),
	};
});

// Hermetic LiveKit config for the dispatch tests (SDK is mocked; these values
// never leave the process).
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

// ─── In-memory stores (extends the global mocked lib/db) ────────────────────
const db = require('../../../lib/db');
const baseQueryImpl = db.query.getMockImplementation();

const sessions = new Map();
const rooms = new Map();
let nextRoomId = 1;

function seed() {
	sessions.clear();
	rooms.clear();
	nextRoomId = 1;
	mockGenerateToken.mockClear();
	mockCreateRoom.mockClear();
	// Session 10: candidate 1, company 100, recruiter 2's company.
	sessions.set(10, {
		id: 10,
		type: 'screening',
		status: 'invited',
		job_id: 5,
		company_id: 100,
		candidate_id: 1,
		invite_token: 'inv-test-10',
		config: {},
		conversation: [],
	});
}

function handleSql(normalized, params) {
	if (normalized.includes('from interview_sessions where id =')) {
		const s = sessions.get(Number(params[0]));
		return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
	}
	if (normalized.startsWith('insert into interview_rooms')) {
		const row = {
			id: nextRoomId++,
			interview_event_id: null,
			interview_session_id: Number(params[0]),
			room_name: params[1],
			livekit_room_id: params[2],
			status: 'active',
			created_at: new Date().toISOString(),
			closed_at: null,
		};
		rooms.set(row.id, row);
		return { rows: [row], rowCount: 1 };
	}
	if (normalized.includes('from interview_rooms') && normalized.includes('interview_session_id')) {
		const found = [...rooms.values()].find(
			(r) => Number(r.interview_session_id) === Number(params[0]) && r.status === 'active',
		);
		return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
	}
	return null;
}

db.query.mockImplementation(async (sql, params) => {
	const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
	const handled = handleSql(normalized, params || []);
	if (handled) return handled;
	return baseQueryImpl(sql, params);
});

// ─── App under test ─────────────────────────────────────────────────────────
const livekitRoutes = require('../../routes/livekit');
const app = express();
app.use(express.json());
app.use('/api/livekit', livekitRoutes);

global.__testUsers = {
	1: { id: 1, email: 'cand@test.local', name: 'Cand', role: 'candidate', company_id: null },
	2: { id: 2, email: 'rec-a@test.local', name: 'RecA', role: 'recruiter', company_id: 100 },
	3: { id: 3, email: 'rec-b@test.local', name: 'RecB', role: 'recruiter', company_id: 200 },
	4: { id: 4, email: 'admin@test.local', name: 'Admin', role: 'admin', company_id: null },
};

const as = (userId) => ({ 'x-test-user-id': String(userId) });

beforeEach(seed);

describe('POST /api/livekit/session-rooms/:sessionId/token', () => {
	test('candidate of the session gets 200 + JWT + roomName', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/token')
			.set(as(1))
			.send({ name: 'Cand' });
		expect(res.status).toBe(200);
		expect(res.body.token).toBe('mock-jwt-token');
		expect(res.body.roomName).toBe('interview-10');
		expect(mockGenerateToken).toHaveBeenCalledWith(
			expect.objectContaining({
				roomName: 'interview-10',
				grants: expect.objectContaining({ canPublish: true, canSubscribe: true }),
			}),
		);
	});

	test('cross-company recruiter gets 403', async () => {
		const res = await request(app).post('/api/livekit/session-rooms/10/token').set(as(3)).send({});
		expect(res.status).toBe(403);
	});

	test('unauthenticated request gets 401', async () => {
		const res = await request(app).post('/api/livekit/session-rooms/10/token').send({});
		expect(res.status).toBe(401);
	});

	test('unknown session gets 404', async () => {
		const res = await request(app).post('/api/livekit/session-rooms/999/token').set(as(1)).send({});
		expect(res.status).toBe(404);
	});

	test('recruiter can request observer mode and gets subscribe-only grants', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/token')
			.set(as(2))
			.send({ mode: 'observer' });
		expect(res.status).toBe(200);
		expect(mockGenerateToken).toHaveBeenCalledWith(
			expect.objectContaining({
				grants: expect.objectContaining({ canPublish: false, canSubscribe: true }),
			}),
		);
	});

	test('candidate cannot request observer mode (must be able to speak)', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/token')
			.set(as(1))
			.send({ mode: 'observer' });
		expect(res.status).toBe(403);
	});
});

describe('POST /api/livekit/session-rooms', () => {
	test('creates a room for the session and is idempotent', async () => {
		const first = await request(app)
			.post('/api/livekit/session-rooms')
			.set(as(2))
			.send({ session_id: 10 });
		expect(first.status).toBe(200);
		expect(first.body.room.room_name).toBe('interview-10');
		expect(first.body.room.interview_session_id).toBe(10);
		expect(mockCreateRoom).toHaveBeenCalledTimes(1);

		const second = await request(app)
			.post('/api/livekit/session-rooms')
			.set(as(2))
			.send({ session_id: 10 });
		expect(second.status).toBe(200);
		expect(second.body.room.id).toBe(first.body.room.id);
		expect(mockCreateRoom).toHaveBeenCalledTimes(1); // no second LiveKit call
	});

	test('cross-company recruiter gets 403', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms')
			.set(as(3))
			.send({ session_id: 10 });
		expect(res.status).toBe(403);
	});

	test('candidate can create the room for their own session', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms')
			.set(as(1))
			.send({ session_id: 10 });
		expect(res.status).toBe(200);
		expect(res.body.room.room_name).toBe('interview-10');
	});
});

describe('POST /api/livekit/session-rooms/:sessionId/dispatch', () => {
	beforeEach(() => {
		mockAgentDispatchClient.listDispatch.mockReset().mockResolvedValue([]);
		mockAgentDispatchClient.createDispatch
			.mockReset()
			.mockImplementation(async (roomName, agentName, options) => ({
				id: 'D_mock1',
				agentName,
				room: roomName,
				metadata: options?.metadata || '',
			}));
	});

	const existingDispatch = (mode) => ({
		id: 'D_existing',
		agentName: 'rekrut-interviewer',
		room: 'interview-10',
		metadata: JSON.stringify({ interview_session_id: 10, mode }),
		state: {},
	});

	test('recruiter dispatch returns 200 + dispatched:true and targets the session room', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(2))
			.send({});
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.dispatched).toBe(true);
		expect(res.body.dispatch_id).toBe('D_mock1');
		expect(res.body.room.room_name).toBe('interview-10');
		expect(mockAgentDispatchClient.createDispatch).toHaveBeenCalledTimes(1);
		expect(mockAgentDispatchClient.createDispatch).toHaveBeenCalledWith(
			'interview-10',
			'rekrut-interviewer',
			expect.objectContaining({
				metadata: JSON.stringify({ interview_session_id: 10, mode: 'interviewer' }),
			}),
		);
	});

	test('second dispatch with the same mode returns already_dispatched:true without a new dispatch', async () => {
		mockAgentDispatchClient.listDispatch.mockResolvedValue([existingDispatch('interviewer')]);
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(2))
			.send({});
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.already_dispatched).toBe(true);
		expect(res.body.dispatched).toBeUndefined();
		expect(mockAgentDispatchClient.createDispatch).not.toHaveBeenCalled();
	});

	test('observer mode passes mode through to dispatch metadata', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(2))
			.send({ mode: 'observer' });
		expect(res.status).toBe(200);
		expect(res.body.dispatched).toBe(true);
		expect(mockAgentDispatchClient.createDispatch).toHaveBeenCalledWith(
			'interview-10',
			'rekrut-interviewer',
			expect.objectContaining({
				metadata: JSON.stringify({ interview_session_id: 10, mode: 'observer' }),
			}),
		);
	});

	test('a different mode is not treated as already dispatched', async () => {
		mockAgentDispatchClient.listDispatch.mockResolvedValue([existingDispatch('interviewer')]);
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(2))
			.send({ mode: 'observer' });
		expect(res.status).toBe(200);
		expect(res.body.dispatched).toBe(true);
		expect(mockAgentDispatchClient.createDispatch).toHaveBeenCalledTimes(1);
	});

	test('a deleted dispatch is not treated as already dispatched', async () => {
		mockAgentDispatchClient.listDispatch.mockResolvedValue([
			{ ...existingDispatch('interviewer'), state: { deletedAt: '1700000000' } },
		]);
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(2))
			.send({});
		expect(res.status).toBe(200);
		expect(res.body.dispatched).toBe(true);
		expect(mockAgentDispatchClient.createDispatch).toHaveBeenCalledTimes(1);
	});

	test('candidate gets 403 (hiring team only)', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(1))
			.send({});
		expect(res.status).toBe(403);
		expect(mockAgentDispatchClient.createDispatch).not.toHaveBeenCalled();
	});

	test('cross-company recruiter gets 403', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(3))
			.send({});
		expect(res.status).toBe(403);
		expect(mockAgentDispatchClient.createDispatch).not.toHaveBeenCalled();
	});

	test('unauthenticated request gets 401', async () => {
		const res = await request(app).post('/api/livekit/session-rooms/10/dispatch').send({});
		expect(res.status).toBe(401);
	});

	test('unknown session gets 404', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/999/dispatch')
			.set(as(2))
			.send({});
		expect(res.status).toBe(404);
	});

	test('invalid mode gets 400', async () => {
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(2))
			.send({ mode: 'teleport' });
		expect(res.status).toBe(400);
		expect(mockAgentDispatchClient.createDispatch).not.toHaveBeenCalled();
	});

	test('LiveKit API failure returns 502 with a clear error (no crash)', async () => {
		mockAgentDispatchClient.listDispatch.mockRejectedValue(new Error('connection refused'));
		const res = await request(app)
			.post('/api/livekit/session-rooms/10/dispatch')
			.set(as(2))
			.send({});
		expect(res.status).toBe(502);
		expect(res.body.error).toMatch(/dispatch/i);
	});
});
