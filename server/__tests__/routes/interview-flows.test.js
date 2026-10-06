/**
 * Task 7 (#322): interview_flows CRUD endpoints.
 *
 * Focused in-memory mock of lib/db dispatching only interview_flows SQL.
 * Auth mock mirrors server/__tests__/routes/interview-sessions.test.js:
 * x-test-user-id header -> global.__testUsers entry.
 */
const express = require('express');
const request = require('supertest');

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

// The flows router imports conversation-engine (AI boundary) — keep it inert.
jest.mock('../../../services/conversation-engine', () => ({
	conductTurn: jest.fn(),
	selectQuestionSource: jest.fn(),
	TURN_TIMEOUT_MS: 20000,
}));

const db = require('../../../lib/db');

// ─── In-memory interview_flows store ─────────────────────────────────────────
const flows = new Map();
let nextFlowId = 1;

function toRow(f) {
	return { ...f };
}

db.query.mockImplementation(async (sql, params = []) => {
	const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

	if (normalized.startsWith('insert into interview_flows')) {
		const [
			company_id,
			job_id,
			created_by,
			name,
			type,
			description,
			phases,
			topics,
			questions,
			rubric_weights,
			triggers,
		] = params;
		const row = {
			id: nextFlowId++,
			company_id,
			job_id,
			created_by,
			name,
			type: type || 'screening',
			description: description || null,
			phases: JSON.parse(phases),
			topics: JSON.parse(topics),
			questions: JSON.parse(questions),
			rubric_weights: JSON.parse(rubric_weights),
			triggers: JSON.parse(triggers),
			status: 'active',
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		flows.set(row.id, row);
		return { rows: [toRow(row)], rowCount: 1 };
	}

	if (normalized.startsWith('select * from interview_flows where id =')) {
		const row = flows.get(Number(params[0]));
		return { rows: row ? [toRow(row)] : [], rowCount: row ? 1 : 0 };
	}

	if (normalized.startsWith('select * from interview_flows where')) {
		let rows = [...flows.values()];
		if (normalized.includes('job_id = $1')) {
			rows = rows.filter((f) => Number(f.job_id) === Number(params[0]));
		}
		if (normalized.includes("status = 'active'")) {
			rows = rows.filter((f) => f.status === 'active');
		}
		return { rows: rows.map(toRow), rowCount: rows.length };
	}

	if (normalized.startsWith('update interview_flows')) {
		// Router SQL: UPDATE interview_flows SET <assignments> WHERE id = $N RETURNING *.
		// The id is always the last param.
		const id = Number(params[params.length - 1]);
		const row = flows.get(id);
		if (!row) return { rows: [], rowCount: 0 };
		// Assignments are applied positionally by the router from a whitelist;
		// the mock applies them generically: extract SET column list from SQL.
		const setClause = sql.match(/set\s+([\s\S]*?)\s+where/i)[1];
		const cols = [...setClause.matchAll(/(\w+)\s*=\s*\$(\d+)/g)];
		for (const [, col, idx] of cols) {
			let v = params[Number(idx) - 1];
			if (['phases', 'topics', 'questions', 'rubric_weights', 'triggers'].includes(col)) {
				v = JSON.parse(v);
			}
			row[col] = v;
		}
		// Literal assignments (e.g. the archive path's status = 'archived').
		const literalStatus = setClause.match(/status\s*=\s*'([^']+)'/);
		if (literalStatus) row.status = literalStatus[1];
		row.updated_at = new Date().toISOString();
		return { rows: [toRow(row)], rowCount: 1 };
	}

	throw new Error(`unexpected SQL in interview-flows test mock: ${sql}`);
});

const flowsRouter = require('../../../routes/interview-sessions');

const RECRUITER = { id: 2, email: 'rec@test.com', role: 'recruiter', company_id: 7 };
const CANDIDATE = { id: 1, email: 'cand@test.com', role: 'candidate', company_id: null };

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/interviews', flowsRouter);
	return app;
}

beforeEach(() => {
	flows.clear();
	nextFlowId = 1;
	global.__testUsers = { 1: CANDIDATE, 2: RECRUITER };
});

describe('interview_flows CRUD', () => {
	const payload = {
		job_id: 10,
		name: 'Backend screening',
		type: 'screening',
		topics: ['Node.js', 'System design'],
		questions: [],
		rubric_weights: { technical: 60, communication: 40 },
		triggers: { manual: true, auto_send_threshold: 75 },
	};

	it('recruiter creates a flow with triggers (201)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.send(payload);

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.flow.name).toBe('Backend screening');
		expect(res.body.flow.triggers).toEqual({ manual: true, auto_send_threshold: 75 });
		expect(res.body.flow.rubric_weights).toEqual({ technical: 60, communication: 40 });
	});

	it('candidate cannot create a flow (403)', async () => {
		const app = buildApp();
		const res = await request(app)
			.post('/api/interviews/interview-flows')
			.set('x-test-user-id', '1')
			.send(payload);

		expect(res.status).toBe(403);
	});

	it('round-trips a flow: create -> read -> update -> archive', async () => {
		const app = buildApp();

		const created = await request(app)
			.post('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.send(payload);
		expect(created.status).toBe(201);
		const id = created.body.flow.id;

		const read = await request(app)
			.get(`/api/interviews/interview-flows/${id}`)
			.set('x-test-user-id', '2');
		expect(read.status).toBe(200);
		expect(read.body.flow.topics).toEqual(['Node.js', 'System design']);

		const updated = await request(app)
			.put(`/api/interviews/interview-flows/${id}`)
			.set('x-test-user-id', '2')
			.send({ triggers: { manual: true, auto_send_threshold: 60 } });
		expect(updated.status).toBe(200);
		expect(updated.body.flow.triggers).toEqual({ manual: true, auto_send_threshold: 60 });

		const archived = await request(app)
			.delete(`/api/interviews/interview-flows/${id}`)
			.set('x-test-user-id', '2');
		expect(archived.status).toBe(200);
		expect(archived.body.flow.status).toBe('archived');

		const listed = await request(app)
			.get('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.query({ job_id: 10 });
		expect(listed.status).toBe(200);
		expect(listed.body.flows).toHaveLength(0);
	});

	it('lists active flows by job_id', async () => {
		const app = buildApp();
		await request(app)
			.post('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.send(payload);
		await request(app)
			.post('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.send({ ...payload, job_id: 99, name: 'Other job flow' });

		const res = await request(app)
			.get('/api/interviews/interview-flows')
			.set('x-test-user-id', '2')
			.query({ job_id: 10 });

		expect(res.status).toBe(200);
		expect(res.body.flows).toHaveLength(1);
		expect(res.body.flows[0].name).toBe('Backend screening');
	});

	it('returns 404 for unknown flow', async () => {
		const app = buildApp();
		const res = await request(app)
			.get('/api/interviews/interview-flows/9999')
			.set('x-test-user-id', '2');

		expect(res.status).toBe(404);
	});
});
