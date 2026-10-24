/**
 * Issue #1688 — Results view groups attempts by topic (design §4.5
 * remainder, STOP 1 comment 6356181525).
 *
 * GET /assessments/results must carry the session snapshot fields
 * (topic_id, topic_name, format, difficulty_band) so the candidate
 * My Results tab can label and group attempts by topic.
 *
 * Harness: stateful SQL-dispatcher in the neighbouring assessments
 * suites' style (#1654/#1656). The dispatcher DISCRIMINATES: the
 * snapshot fields are only materialised when the route's SQL actually
 * selects them, and topic_name only when the SQL actually LEFT JOINs
 * assessment_topics — a missing JOIN/select fails, never passes
 * vacuously. An INNER (non-LEFT) topics join drops legacy rows in the
 * emulation exactly as it would in Postgres.
 * Regression pins only — NOT the HL-003 E2E-on-dev gate.
 *
 * #1723 M1 tightening: the user filter and the DESC sort are ALSO
 * SQL-keyed now — the dispatcher applies the sa.user_id filter ONLY
 * when the SQL text carries `sa.user_id = $1`, and sorts by
 * completed_at DESC ONLY when the SQL text carries
 * `order by sa.completed_at desc`. This mirrors the stricter
 * neighbouring suites' pattern of keying behaviour on the SQL text —
 * e.g. assessments-retake-lockout.test.js only materialises its
 * last-completed row when the SQL includes
 * 'order by completed_at desc', and assessments-deadlines.test.js /
 * assessments-start-enforce.test.js gate their assigned-attempt rows
 * on 'order by created_at'. Before this tightening the mock filtered
 * and sorted unconditionally, so a route that dropped its WHERE
 * user filter or its ORDER BY still passed T3 vacuously. Mutation
 * proof (drop WHERE / drop ORDER BY → T3 red, each) is recorded in
 * the #1723 build log.
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
	const mw = jest.fn((_req, _res, next) => next());
	return { rateLimits: { strict: mw, standard: mw, lenient: mw, ai: mw } };
});

jest.mock('../../../lib/polsia-ai', () => ({
	chat: jest.fn(),
	handleAIError: jest.fn((res) => res.status(500).json({ error: 'AI unavailable' })),
	safeParseJSON: (text) => {
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	},
}));

jest.mock('../../../services/auditLogService', () => ({
	AuditLogger: { log: jest.fn(async () => ({})) },
}));

jest.mock('../../../services/omniscore', () => ({
	calculateScore: jest.fn(async () => ({})),
	addTechnicalComponent: jest.fn(async () => ({})),
}));

global.__testUsers = {
	7: { id: 7, role: 'candidate', company_id: null, name: 'Asha Candidate' },
	9: { id: 9, role: 'candidate', company_id: null, name: 'Ben Candidate' },
};

let S;
function freshState() {
	S = {
		skills: [
			{ id: 4, user_id: 7, skill_name: 'Python', category: 'technical' },
			{ id: 5, user_id: 9, skill_name: 'Python', category: 'technical' },
		],
		topics: [
			{ id: 20, subject_id: 2, slug: 'comprehensions', name: 'Comprehensions' },
			{ id: 21, subject_id: 2, slug: 'decorators', name: 'Decorators' },
		],
		sessions: [],
		skillAssessments: [],
	};
}
let sessSeq = 900;
function seedSession(over = {}) {
	const row = {
		id: over.id ?? ++sessSeq,
		user_id: 7,
		skill_id: 4,
		tab_switches: 1,
		copy_paste_attempts: 0,
		time_anomalies: 0,
		max_difficulty_reached: 3,
		answers_given: [{ questionId: 1 }],
		topic_id: 20,
		format: 'mcq',
		difficulty_band: 'medium',
		...over,
	};
	S.sessions.push(row);
	return row;
}
let saSeq = 0;
function seedAssessment(over = {}) {
	saSeq += 1;
	const row = {
		id: over.id ?? saSeq,
		user_id: 7,
		skill_id: 4,
		session_id: null,
		assessment_type: 'skill',
		title: 'Python assessment',
		score: 80,
		max_score: 100,
		passed: true,
		anti_cheat_score: 95,
		duration_seconds: 600,
		completed_at: new Date('2026-10-20T10:00:00Z'),
		...over,
	};
	S.skillAssessments.push(row);
	return row;
}
const at = (iso) => new Date(iso);

const db = require('../../../lib/db');
function installDbMock() {
	db.query.mockImplementation(async (sqlRaw, params = []) => {
		const sql = String(sqlRaw).toLowerCase().replace(/\s+/g, ' ').trim();
		// GET /results is the only query this suite exercises.
		if (sql.includes('from skill_assessments sa') && sql.includes('completed_at is not null')) {
			const uid = Number(params[0]);
			const hasTopicsJoin = sql.includes('join assessment_topics');
			const hasTopicsLeftJoin = sql.includes('left join assessment_topics');
			// #1723 M1: the user filter and the DESC sort are applied
			// ONLY when the route's SQL actually carries them — a route
			// that drops `sa.user_id = $1` leaks other users' rows into
			// the emulation exactly as it would in Postgres, and a route
			// that drops `ORDER BY sa.completed_at DESC` returns rows in
			// seed (insertion) order. T3 discriminates both.
			const hasUserFilter = sql.includes('sa.user_id = $1');
			const hasDescOrder = sql.includes('order by sa.completed_at desc');
			let pool = S.skillAssessments.filter((a) => a.completed_at);
			if (hasUserFilter) pool = pool.filter((a) => a.user_id === uid);
			if (hasDescOrder)
				pool = [...pool].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
			let rows = pool
				.map((a) => {
					const skill = S.skills.find((s) => s.id === a.skill_id);
					const sess = a.session_id != null ? S.sessions.find((s) => s.id === a.session_id) : undefined;
					const row = {
						id: a.id,
						user_id: a.user_id,
						skill_id: a.skill_id,
						session_id: a.session_id,
						assessment_type: a.assessment_type,
						title: a.title,
						score: a.score,
						max_score: a.max_score,
						passed: a.passed,
						anti_cheat_score: a.anti_cheat_score,
						duration_seconds: a.duration_seconds,
						completed_at: a.completed_at,
						skill_name: skill ? skill.skill_name : null,
						category: skill ? skill.category : null,
						tab_switches: sess ? sess.tab_switches : null,
						copy_paste_attempts: sess ? sess.copy_paste_attempts : null,
						time_anomalies: sess ? sess.time_anomalies : null,
						max_difficulty_reached: sess ? sess.max_difficulty_reached : null,
						answers_given: sess ? sess.answers_given : null,
					};
					// Discriminating snapshot emulation: a field reaches the
					// row ONLY when the route's SQL actually selects it.
					if (sql.includes('topic_id')) row.topic_id = sess ? sess.topic_id : null;
					if (/ass\.format/.test(sql)) row.format = sess ? sess.format : null;
					if (sql.includes('difficulty_band')) row.difficulty_band = sess ? sess.difficulty_band : null;
					if (sql.includes('topic_name')) {
						const topic =
							hasTopicsJoin && sess && sess.topic_id != null
								? S.topics.find((t) => t.id === sess.topic_id)
								: undefined;
						row.topic_name = topic ? topic.name : null;
					}
					return { row, sess };
				});
			// An INNER topics join would drop topic-less rows, as in PG.
			if (hasTopicsJoin && !hasTopicsLeftJoin) {
				rows = rows.filter(({ sess }) => sess && sess.topic_id != null);
			}
			return { rows: rows.map(({ row }) => row), rowCount: rows.length };
		}
		return { rows: [], rowCount: 0 };
	});
}

const assessmentsRouter = require('../../../routes/assessments');
function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}
function getResults(uid = '7') {
	return request(buildApp()).get('/api/assessments/results').set('x-test-user-id', uid);
}

beforeEach(() => {
	freshState();
	sessSeq = 900;
	saSeq = 0;
	installDbMock();
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('GET /results — topic snapshot (#1688 T1–T4)', () => {
	it('T1: each row carries its own session topic_id, topic_name, format and difficulty_band', async () => {
		const sA = seedSession({ topic_id: 20, format: 'mcq', difficulty_band: 'medium' });
		const sB = seedSession({ topic_id: 21, format: 'short_answer', difficulty_band: 'hard' });
		seedAssessment({ session_id: sA.id, completed_at: at('2026-10-20T10:00:00Z') });
		seedAssessment({ session_id: sB.id, completed_at: at('2026-10-19T10:00:00Z') });
		const res = await getResults();
		expect(res.status).toBe(200);
		expect(res.body.results).toHaveLength(2);
		const [first, second] = res.body.results;
		expect(first.topic_id).toBe(20);
		expect(first.topic_name).toBe('Comprehensions');
		expect(first.format).toBe('mcq');
		expect(first.difficulty_band).toBe('medium');
		expect(second.topic_id).toBe(21);
		expect(second.topic_name).toBe('Decorators');
		expect(second.format).toBe('short_answer');
		expect(second.difficulty_band).toBe('hard');
	});

	it('T2: legacy attempts return the snapshot keys present with null values — no 500, no invented name', async () => {
		const legacy = seedSession({ topic_id: null, format: null, difficulty_band: null });
		seedAssessment({ session_id: legacy.id, completed_at: at('2026-10-20T10:00:00Z') });
		seedAssessment({ session_id: null, completed_at: at('2026-10-19T10:00:00Z') });
		const res = await getResults();
		expect(res.status).toBe(200);
		expect(res.body.results).toHaveLength(2);
		for (const row of res.body.results) {
			expect(row).toHaveProperty('topic_id', null);
			expect(row).toHaveProperty('topic_name', null);
			expect(row).toHaveProperty('format', null);
			expect(row).toHaveProperty('difficulty_band', null);
		}
	});

	it('T3: other users never appear, ordering stays completed_at DESC, existing fields unchanged', async () => {
		const sA = seedSession({ topic_id: 20 });
		const sOther = seedSession({ user_id: 9, skill_id: 5, topic_id: 21 });
		seedAssessment({ session_id: sA.id, score: 70, completed_at: at('2026-10-18T10:00:00Z') });
		seedAssessment({ session_id: sA.id, score: 90, completed_at: at('2026-10-20T10:00:00Z') });
		seedAssessment({
			user_id: 9,
			skill_id: 5,
			session_id: sOther.id,
			completed_at: at('2026-10-21T10:00:00Z'),
		});
		const res = await getResults();
		expect(res.status).toBe(200);
		expect(res.body.results).toHaveLength(2);
		expect(res.body.results.map((r) => r.score)).toEqual([90, 70]);
		for (const row of res.body.results) {
			expect(row.skill_name).toBe('Python');
			expect(row.passed).toBe(true);
			expect(row.anti_cheat_score).toBe(95);
			expect(row.answers_given).toEqual([{ questionId: 1 }]);
			expect(row.tab_switches).toBe(1);
		}
	});

	it('T4: no row carries question content keys (C1 denylist discipline)', async () => {
		const sA = seedSession({ topic_id: 20 });
		seedAssessment({ session_id: sA.id });
		const res = await getResults();
		expect(res.status).toBe(200);
		expect(res.body.results).toHaveLength(1);
		for (const key of ['question_text', 'correct_answer', 'explanation', 'options']) {
			expect(res.body.results[0]).not.toHaveProperty(key);
		}
	});
});
