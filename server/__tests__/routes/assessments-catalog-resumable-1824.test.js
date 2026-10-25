/**
 * Issue #1824 — Save & Exit promises resume from the Assessments page,
 * but the catalogue carried no resumable-session flag for topic sessions.
 *
 * Pins:
 *  - GET /assessments/catalog returns per-topic `resumable: { sessionId }`
 *    for the requesting user's latest in_progress session on that topic,
 *    and `resumable: null` otherwise.
 *  - Another user's in-progress session never appears.
 *  - The resumable read is scoped in SQL itself: user_id = $1,
 *    status = 'in_progress', topic_id IS NOT NULL, DISTINCT ON (topic_id)
 *    with id DESC (latest session per topic wins).
 *
 * Mock note: lib/db is mocked by server/test/setup.js; this file replaces
 * db.query with a dispatcher that emulates the SQL semantics and captures
 * every SQL string so the query shape itself is pinned (same pattern as
 * assessments-catalog-1653.test.js).
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

jest.mock('../../../lib/distributed-rate-limiter', () => {
	const rateLimitMiddleware = jest.fn((_req, _res, next) => next());
	return {
		rateLimits: {
			strict: rateLimitMiddleware,
			standard: rateLimitMiddleware,
			lenient: rateLimitMiddleware,
			ai: rateLimitMiddleware,
		},
	};
});

global.__testUsers = {
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate' },
	9: { id: 9, role: 'candidate', company_id: null, name: 'Ben Candidate' },
	11: { id: 11, role: 'candidate', company_id: null, name: 'No Session Candidate' },
};

let FX;
function freshFixtures() {
	return {
		queries: [],
		subjects: [
			{
				id: 2,
				slug: 'python',
				name: 'Python',
				category: 'technical',
				icon: 'PY',
				description: 'Core Python',
				sort_order: 2,
				is_active: true,
			},
			{
				id: 5,
				slug: 'sql',
				name: 'SQL',
				category: 'technical',
				icon: 'SQL',
				description: 'Queries',
				sort_order: 5,
				is_active: true,
			},
		],
		topics: [
			{
				id: 20,
				subject_id: 2,
				slug: 'general',
				name: 'Python — General',
				description: 'Python general',
				legacy_skill_name: 'Python',
				sort_order: 0,
				is_active: true,
			},
			{
				id: 30,
				subject_id: 5,
				slug: 'general',
				name: 'SQL — General',
				description: 'SQL general',
				legacy_skill_name: 'SQL',
				sort_order: 0,
				is_active: true,
			},
		],
		bank: [],
		progressByUser: { 7: [], 9: [], 11: [] },
		// Post-filter rows the DISTINCT ON resumable query would return:
		// latest in_progress session per topic for that user only.
		resumableByUser: {
			7: [{ session_id: 555, topic_id: 20 }],
			9: [{ session_id: 999, topic_id: 20 }],
			11: [],
		},
	};
}

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');
	FX.queries.push(normalized);
	const userId = params[0];

	// #1824 resumable read — must be matched BEFORE the progress
	// DISTINCT ON branch (both use DISTINCT ON).
	if (
		normalized.includes('from assessment_sessions') &&
		normalized.includes("status = 'in_progress'")
	) {
		const rows = FX.resumableByUser[userId] || [];
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('from assessment_subjects')) {
		const rows = FX.subjects
			.filter((s) => s.is_active)
			.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
			.map(({ is_active, ...rest }) => rest);
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('from assessment_topics')) {
		const rows = FX.topics
			.filter((t) => t.is_active)
			.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
			.map(({ is_active, ...rest }) => rest);
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('from assessment_questions') && normalized.includes('group by')) {
		return { rows: [], rowCount: 0 };
	}
	if (normalized.includes('distinct on')) {
		const rows = FX.progressByUser[userId] || [];
		return { rows, rowCount: rows.length };
	}
	return { rows: [], rowCount: 0 };
});

const assessmentsRouter = require('../../../routes/assessments');
function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}

function topicById(body, id) {
	for (const s of body.subjects) {
		const t = s.topics.find((x) => x.id === id);
		if (t) return t;
	}
	return undefined;
}

beforeEach(() => {
	FX = freshFixtures();
});

describe('#1824 — GET /catalog resumable session per topic', () => {
	it('returns resumable {sessionId} for the owning user in-progress topic, null for other topics', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		expect(res.status).toBe(200);
		expect(topicById(res.body, 20).resumable).toEqual({ sessionId: 555 });
		expect(topicById(res.body, 30).resumable).toBeNull();
	});

	it('never surfaces another user session', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		expect(JSON.stringify(res.body)).not.toContain('999');
		const resB = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '9');
		expect(topicById(resB.body, 20).resumable).toEqual({ sessionId: 999 });
		expect(JSON.stringify(resB.body)).not.toContain('555');
	});

	it('a user with no in-progress session gets resumable null on every topic', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '11');
		expect(res.status).toBe(200);
		expect(topicById(res.body, 20).resumable).toBeNull();
		expect(topicById(res.body, 30).resumable).toBeNull();
	});

	it('topic shape includes resumable in the allowlist', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const topic = topicById(res.body, 20);
		expect(Object.keys(topic).sort()).toEqual([
			'availability',
			'description',
			'id',
			'name',
			'progress',
			'resumable',
			'slug',
		]);
	});

	it('resumable SQL is user-scoped, in_progress-only, topic-keyed, latest-first', async () => {
		await request(buildApp()).get('/api/assessments/catalog').set('x-test-user-id', '7');
		const sql = FX.queries.find(
			(q) => q.includes('from assessment_sessions') && q.includes("status = 'in_progress'"),
		);
		expect(sql).toBeDefined();
		expect(sql).toContain('user_id = $1');
		expect(sql).toContain('topic_id is not null');
		expect(sql).toContain('distinct on (topic_id)');
		expect(sql).toContain('id desc');
		// Explicit allowlist — never session content / draft.
		expect(sql).not.toContain('current_draft');
		expect(sql).not.toContain('select *');
	});
});
