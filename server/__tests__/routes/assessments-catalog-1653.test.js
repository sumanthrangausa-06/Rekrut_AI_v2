/**
 * Issue #1653 — #1603 Phase C story C1: catalogue API + dual-read.
 *
 * Pins (design architecture-assessments-phase-c.md §4.1, §4.4, §4.6,
 * §6 step 3, §7; STOP 1 rulings R1/R2/R5 + §2.3 correction):
 *  - GET /assessments/catalog serves subjects/topics from the C0 tables
 *    with availability folded from APPROVED bank rows only; bands
 *    easy {1,2} / medium {2,3,4} / hard {4,5} overlap deliberately (a
 *    shared-level row counts in each band it belongs to, once per config);
 *    mixed = mcq + short_answer per band, coding never a member.
 *  - available := best (format, band) servable >= 10 (R1); maxCount is
 *    always reported; zero-availability active topics are present with
 *    available:false (R2); inactive topics excluded; topic-less active
 *    subjects (DSA/OOP) return topics: []; inactive Aptitude is absent.
 *  - GET /assessments/available keeps its EXACT frozen shape, re-read
 *    over the tables (catalogue order = subjects.sort_order, skill match
 *    case-insensitive via the default topic's legacy_skill_name), with
 *    the SKILL_CATALOG constant as dual-read fallback ONLY when the
 *    subjects query returns zero rows (R5) — a thrown DB error is the
 *    generic 500, never the fallback.
 *  - can_retake is computed from the last COMPLETED attempt only (§2.3
 *    pinning): an abandoned session / unsubmitted verification row does
 *    not move it, and the displayed value equals the /start gate's input.
 *    progress.lastScore is the LATEST completed attempt's score
 *    (DISTINCT ON ... completed_at DESC), never MAX(score).
 *  - Progress is scoped to req.user.id: user B's data never appears in
 *    user A's payload. Neither response may contain question-content
 *    keys (question_text / correct_answer / explanation / options)
 *    anywhere — counts only, explicit field allowlists (R4).
 *
 * Mock note: lib/db is mocked by server/test/setup.js; this file replaces
 * db.query with a dispatcher that EMULATES the SQL semantics (active
 * filters, the approved-only grouped count computed from raw bank rows,
 * completed-only progress) and captures every SQL string so the tests
 * can also pin the query shapes themselves.
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
};

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

// ── Fixtures ────────────────────────────────────────────────────────────────
let FX;
function freshFixtures() {
	const bank = [];
	const addBank = (topic_id, format, difficulty_level, review_status, count) => {
		for (let i = 0; i < count; i++)
			bank.push({ topic_id, format, difficulty_level, review_status });
	};
	// Python topic (20): approved supply designed so that —
	//   mcq easy = 6 (level 2 only), mcq medium = 10 (level 2 + level 3)
	//   short easy = 3, short medium = 3, short hard = 2 (level 5)
	//   coding easy = 7, coding medium = 7 (must never enter mixed)
	//   mixed easy = 9, mixed medium = 13, mixed hard = 2 → maxCount 13
	addBank(20, 'mcq', 2, 'approved', 6);
	addBank(20, 'mcq', 3, 'approved', 4);
	addBank(20, 'short_answer', 2, 'approved', 3);
	addBank(20, 'short_answer', 5, 'approved', 2);
	addBank(20, 'coding', 2, 'approved', 7);
	// Invisible supply: pending/rejected must never be counted.
	addBank(20, 'mcq', 2, 'pending', 5);
	addBank(20, 'mcq', 2, 'rejected', 4);
	// JavaScript topic (10): ONLY pending/rejected rows → honest zero.
	addBank(10, 'mcq', 2, 'pending', 3);
	addBank(10, 'short_answer', 1, 'rejected', 2);
	// SQL topic (30): 9 approved mcq at level 3 → maxCount 9 (< floor 10).
	addBank(30, 'mcq', 3, 'approved', 9);

	return {
		subjectsError: false,
		queries: [],
		subjects: [
			{
				id: 1,
				slug: 'javascript',
				name: 'JavaScript',
				category: 'technical',
				icon: 'JS',
				description: 'Core JS',
				sort_order: 1,
				is_active: true,
			},
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
			{
				id: 8,
				slug: 'html-css',
				name: 'HTML/CSS',
				category: 'technical',
				icon: 'CSS',
				description: 'Flexbox, Grid',
				sort_order: 8,
				is_active: true,
			},
			{
				id: 17,
				slug: 'dsa',
				name: 'DSA',
				category: 'technical',
				icon: 'DSA',
				description: 'Data structures',
				sort_order: 17,
				is_active: true,
			},
			{
				id: 18,
				slug: 'oop',
				name: 'OOP',
				category: 'technical',
				icon: 'OOP',
				description: 'OOP principles',
				sort_order: 18,
				is_active: true,
			},
			{
				id: 19,
				slug: 'aptitude',
				name: 'Aptitude',
				category: 'analytical',
				icon: 'APT',
				description: 'Aptitude',
				sort_order: 19,
				is_active: false,
			},
		],
		topics: [
			{
				id: 10,
				subject_id: 1,
				slug: 'general',
				name: 'JavaScript — General',
				description: 'JS general',
				legacy_skill_name: 'JavaScript',
				sort_order: 0,
				is_active: true,
			},
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
				id: 21,
				subject_id: 2,
				slug: 'dead',
				name: 'Python — Retired',
				description: 'retired',
				legacy_skill_name: null,
				sort_order: 1,
				is_active: false,
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
			{
				id: 80,
				subject_id: 8,
				slug: 'general',
				name: 'HTML/CSS — General',
				description: 'HTML/CSS general',
				legacy_skill_name: 'CSS & HTML',
				sort_order: 0,
				is_active: true,
			},
		],
		bank,
		// New progress query rows (DISTINCT ON shape; keyed by user id).
		// User 7 narrative for the can_retake pin: SQL has ONE completed
		// attempt 40 days ago (outside the 30-day lockout) PLUS an
		// abandoned session and an unsubmitted (completed_at NULL)
		// skill_verification row in the DB — the completed-only progress
		// emulation below excludes both, so attempts stays 1.
		progressByUser: {
			7: [
				{
					skill_id: 50,
					skill_name: 'Python',
					category: 'technical',
					is_verified: true,
					verified_score: 88,
					assessment_count: 3,
					best_score: 88,
					last_score: 70,
					last_completed_at: daysAgo(2),
				},
				{
					skill_id: 51,
					skill_name: 'JavaScript',
					category: 'technical',
					is_verified: false,
					verified_score: null,
					assessment_count: 0,
					best_score: null,
					last_score: null,
					last_completed_at: null,
				},
				{
					skill_id: 53,
					skill_name: 'SQL',
					category: 'technical',
					is_verified: false,
					verified_score: null,
					assessment_count: 1,
					best_score: 55,
					last_score: 55,
					last_completed_at: daysAgo(40),
				},
				{
					skill_id: 52,
					skill_name: 'css & html',
					category: 'technical',
					is_verified: false,
					verified_score: null,
					assessment_count: 2,
					best_score: 66,
					last_score: 60,
					last_completed_at: daysAgo(100),
				},
				{
					skill_id: 60,
					skill_name: 'Rust',
					category: 'technical',
					is_verified: false,
					verified_score: null,
					assessment_count: 1,
					best_score: 77,
					last_score: 77,
					last_completed_at: daysAgo(40),
				},
			],
			9: [
				{
					skill_id: 99,
					skill_name: 'Python',
					category: 'technical',
					is_verified: true,
					verified_score: 95,
					assessment_count: 5,
					best_score: 95,
					last_score: 91,
					last_completed_at: daysAgo(40),
				},
			],
		},
		// Legacy /available query rows (fallback path shape; keyed by user id).
		fallbackSkillsByUser: {
			7: [
				{
					id: 50,
					skill_name: 'Python',
					category: 'technical',
					level: 3,
					is_verified: true,
					verified_score: 88,
					assessment_count: '3',
					best_score: 88,
					last_attempted: daysAgo(2),
				},
				{
					id: 60,
					skill_name: 'Rust',
					category: 'technical',
					level: 1,
					is_verified: false,
					verified_score: null,
					assessment_count: '1',
					best_score: 77,
					last_attempted: daysAgo(40),
				},
			],
			9: [],
		},
	};
}

const db = require('../../../lib/db');
db.query.mockImplementation(async (sql, params = []) => {
	const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');
	FX.queries.push(normalized);
	const userId = params[0];

	if (normalized.includes('from assessment_subjects')) {
		if (FX.subjectsError) throw new Error('simulated database failure');
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
		// Emulate: WHERE review_status='approved' AND topic_id IS NOT NULL,
		// GROUP BY topic_id, format, difficulty_level.
		const groups = new Map();
		for (const r of FX.bank) {
			if (r.review_status !== 'approved') continue;
			const key = `${r.topic_id}|${r.format}|${r.difficulty_level}`;
			groups.set(key, (groups.get(key) || 0) + 1);
		}
		const rows = [...groups.entries()].map(([key, n]) => {
			const [topic_id, format, difficulty_level] = key.split('|');
			return {
				topic_id: parseInt(topic_id, 10),
				format,
				difficulty_level: parseInt(difficulty_level, 10),
				n,
			};
		});
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('distinct on')) {
		const rows = FX.progressByUser[userId] || [];
		return { rows, rowCount: rows.length };
	}
	if (normalized.includes('from candidate_skills')) {
		const rows = FX.fallbackSkillsByUser[userId] || [];
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

function allKeys(value, acc = new Set()) {
	if (Array.isArray(value)) for (const v of value) allKeys(v, acc);
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			acc.add(k);
			allKeys(v, acc);
		}
	}
	return acc;
}

beforeEach(() => {
	FX = freshFixtures();
});

describe('#1653 C1 — GET /catalog', () => {
	it('mixed is the exact mcq + short_answer sum per band; coding never a member', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		expect(res.status).toBe(200);
		const python = res.body.subjects.find((s) => s.slug === 'python');
		const topic = python.topics.find((t) => t.id === 20);
		expect(topic.availability.formats.mcq).toEqual({ easy: 6, medium: 10, hard: 0 });
		expect(topic.availability.formats.short_answer).toEqual({ easy: 3, medium: 3, hard: 2 });
		expect(topic.availability.formats.coding).toEqual({ easy: 7, medium: 7, hard: 0 });
		// If coding leaked into mixed, easy would be 16 and medium 20.
		expect(topic.availability.formats.mixed).toEqual({ easy: 9, medium: 13, hard: 2 });
	});

	it('band overlap: a level-2 row counts in easy AND medium, exactly once within a config', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const topic = res.body.subjects.find((s) => s.slug === 'python').topics[0];
		// easy mcq (6) comes solely from the six level-2 rows; medium mcq
		// (10) is those same six plus the four level-3 rows — counted in
		// both bands, but never twice inside one band.
		expect(topic.availability.formats.mcq.easy).toBe(6);
		expect(topic.availability.formats.mcq.medium).toBe(10);
	});

	it('approved-only: pending/rejected rows are invisible', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const python = res.body.subjects.find((s) => s.slug === 'python').topics[0];
		// 6 approved level-2 mcq; +5 pending +4 rejected would read 15.
		expect(python.availability.formats.mcq.easy).toBe(6);
		const js = res.body.subjects.find((s) => s.slug === 'javascript').topics[0];
		expect(js.availability.formats.mcq).toEqual({ easy: 0, medium: 0, hard: 0 });
		expect(js.availability.maxCount).toBe(0);
	});

	it('available := best configuration >= 10 (R1); maxCount always reported', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const python = res.body.subjects.find((s) => s.slug === 'python').topics[0];
		expect(python.availability.maxCount).toBe(13);
		expect(python.availability.available).toBe(true);
		const sql = res.body.subjects.find((s) => s.slug === 'sql').topics[0];
		expect(sql.availability.maxCount).toBe(9);
		expect(sql.availability.available).toBe(false);
	});

	it('zero-availability active topic is present with available:false (R2)', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const js = res.body.subjects.find((s) => s.slug === 'javascript');
		expect(js.topics).toHaveLength(1);
		expect(js.topics[0].availability.available).toBe(false);
	});

	it('topic-less active subjects return topics: []; inactive subject/topic absent (R2)', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const slugs = res.body.subjects.map((s) => s.slug);
		expect(res.body.subjects.find((s) => s.slug === 'dsa').topics).toEqual([]);
		expect(res.body.subjects.find((s) => s.slug === 'oop').topics).toEqual([]);
		expect(slugs).not.toContain('aptitude');
		const pythonTopicIds = res.body.subjects
			.find((s) => s.slug === 'python')
			.topics.map((t) => t.id);
		expect(pythonTopicIds).not.toContain(21);
	});

	it('response shape is the §4.1 allowlist — no extra keys anywhere', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		expect(Object.keys(res.body)).toEqual(['subjects']);
		const subject = res.body.subjects[0];
		expect(Object.keys(subject).sort()).toEqual([
			'category',
			'description',
			'icon',
			'id',
			'name',
			'slug',
			'topics',
		]);
		const topic = res.body.subjects.find((s) => s.slug === 'python').topics[0];
		expect(Object.keys(topic).sort()).toEqual([
			'availability',
			'description',
			'id',
			'name',
			'progress',
			'slug',
		]);
		expect(Object.keys(topic.availability).sort()).toEqual(['available', 'formats', 'maxCount']);
		expect(Object.keys(topic.availability.formats).sort()).toEqual([
			'coding',
			'mcq',
			'mixed',
			'short_answer',
		]);
		for (const f of Object.values(topic.availability.formats)) {
			expect(Object.keys(f).sort()).toEqual(['easy', 'hard', 'medium']);
		}
	});

	it('progress: latest score via completed_at (NOT MAX), best kept separate', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const python = res.body.subjects.find((s) => s.slug === 'python').topics[0];
		// best 88 (an earlier attempt) vs latest 70 — a MAX() read would
		// silently duplicate 88 into lastScore (§2.4 pitfall).
		// #1656 (C3, §3.7): progress gained canRetake, computed from the
		// last COMPLETED attempt — user 7's latest is 2 days ago, inside
		// the 30-day lockout, so false.
		expect(python.progress).toEqual({
			attempts: 3,
			bestScore: 88,
			lastScore: 70,
			lastAttempted: FX.progressByUser[7][0].last_completed_at,
			canRetake: false,
		});
		const js = res.body.subjects.find((s) => s.slug === 'javascript').topics[0];
		expect(js.progress).toBeNull();
	});

	it('progress isolation: user B never sees user A data and vice versa', async () => {
		const resB = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '9');
		const pythonB = resB.body.subjects.find((s) => s.slug === 'python').topics[0];
		// #1656: user 9's last completion is 40 days ago — outside the
		// lockout, so canRetake is true.
		expect(pythonB.progress).toEqual({
			attempts: 5,
			bestScore: 95,
			lastScore: 91,
			lastAttempted: FX.progressByUser[9][0].last_completed_at,
			canRetake: true,
		});
		const raw = JSON.stringify(resB.body);
		expect(raw).not.toContain('"attempts":3');
		const progressSql = FX.queries.find((q) => q.includes('distinct on'));
		expect(progressSql).toContain('user_id');
	});

	it('payload denylist: no question-content keys in /catalog (R4)', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		const keys = allKeys(res.body);
		for (const banned of ['question_text', 'correct_answer', 'explanation', 'options']) {
			expect(keys.has(banned)).toBe(false);
		}
		const countsSql = FX.queries.find((q) => q.includes('from assessment_questions'));
		expect(countsSql).toContain("review_status = 'approved'");
		for (const banned of ['question_text', 'correct_answer', 'explanation', 'options']) {
			expect(countsSql).not.toContain(banned);
		}
	});

	it('requires authentication', async () => {
		const res = await request(buildApp()).get('/api/assessments/catalog');
		expect(res.status).toBe(401);
	});
});

describe('#1653 C1 — GET /available over tables (§4.4 frozen shape)', () => {
	it('catalogue order follows subjects.sort_order; shape is exactly the frozen keys', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/available')
			.set('x-test-user-id', '7');
		expect(res.status).toBe(200);
		expect(res.body.skills.map((s) => s.catalog_name)).toEqual([
			'JavaScript',
			'Python',
			'SQL',
			'HTML/CSS',
			'DSA',
			'OOP',
			'Rust',
		]);
		const python = res.body.skills.find((s) => s.catalog_name === 'Python');
		expect(Object.keys(python).sort()).toEqual([
			'assessment_count',
			'best_score',
			'can_retake',
			'catalog_name',
			'category',
			'description',
			'difficulty',
			'icon',
			'is_verified',
			'last_attempted',
			'skill_id',
			'verified_score',
		]);
		expect(python.skill_id).toBe(50);
		expect(python.assessment_count).toBe(3);
		expect(python.best_score).toBe(88);
		expect(python.is_verified).toBe(true);
	});

	it('case-insensitive skill matching via legacy name (HTML/CSS ← "css & html")', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/available')
			.set('x-test-user-id', '7');
		const html = res.body.skills.find((s) => s.catalog_name === 'HTML/CSS');
		expect(html.skill_id).toBe(52);
		expect(html.assessment_count).toBe(2);
		expect(html.best_score).toBe(66);
		// And the matched skill is not ALSO appended as a custom skill.
		expect(res.body.skills.filter((s) => s.skill_id === 52)).toHaveLength(1);
	});

	it('non-catalogue user skills are appended with the legacy custom semantics', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/available')
			.set('x-test-user-id', '7');
		const rust = res.body.skills[res.body.skills.length - 1];
		expect(rust.catalog_name).toBe('Rust');
		expect(rust.icon).toBe('RU');
		expect(rust.description).toBe('Custom skill: Rust');
		expect(rust.difficulty).toBe('Adaptive');
		expect(rust.skill_id).toBe(60);
	});

	it('can_retake pinning (§2.3): abandoned session + unsubmitted row do not move it; display == gate input', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/available')
			.set('x-test-user-id', '7');
		const sqlEntry = res.body.skills.find((s) => s.catalog_name === 'SQL');
		// One completed attempt 40 days ago → gate allows; the abandoned
		// session / unsubmitted verification row must not lock or count.
		expect(sqlEntry.assessment_count).toBe(1);
		expect(sqlEntry.can_retake).toBe(true);
		expect(sqlEntry.last_attempted).toBe(FX.progressByUser[7][2].last_completed_at);
		const python = res.body.skills.find((s) => s.catalog_name === 'Python');
		expect(python.can_retake).toBe(false); // completed 2 days ago
		expect(python.last_attempted).toBe(FX.progressByUser[7][0].last_completed_at);
		// The progress read itself: completed-only, latest by completed_at
		// DESC via DISTINCT ON, internal alias last_completed_at.
		const progressSql = FX.queries.find((q) => q.includes('distinct on'));
		expect(progressSql).toContain('completed_at is not null');
		expect(progressSql).toContain('completed_at desc');
		expect(progressSql).toContain('last_completed_at');
	});

	it('payload denylist: no question-content keys in /available (R4)', async () => {
		const res = await request(buildApp())
			.get('/api/assessments/available')
			.set('x-test-user-id', '7');
		const keys = allKeys(res.body);
		for (const banned of ['question_text', 'correct_answer', 'explanation', 'options']) {
			expect(keys.has(banned)).toBe(false);
		}
	});
});

describe('#1653 C1 — dual-read fallback (R5, §6 step 3)', () => {
	it('zero subjects rows → SKILL_CATALOG constant path, unchanged shape/semantics', async () => {
		FX.subjects = [];
		FX.topics = [];
		const res = await request(buildApp())
			.get('/api/assessments/available')
			.set('x-test-user-id', '7');
		expect(res.status).toBe(200);
		// 16 constant entries + Rust appended; table-only subjects absent.
		expect(res.body.skills).toHaveLength(17);
		expect(res.body.skills[0].catalog_name).toBe('JavaScript');
		expect(res.body.skills.map((s) => s.catalog_name)).toContain('CSS & HTML');
		expect(res.body.skills.map((s) => s.catalog_name)).not.toContain('DSA');
		const python = res.body.skills.find((s) => s.catalog_name === 'Python');
		expect(python.skill_id).toBe(50);
		expect(python.assessment_count).toBe(3);
		expect(python.can_retake).toBe(false);
	});

	it('subjects query throws → generic 500, NEVER the constant fallback', async () => {
		FX.subjectsError = true;
		const resA = await request(buildApp())
			.get('/api/assessments/available')
			.set('x-test-user-id', '7');
		expect(resA.status).toBe(500);
		expect(resA.body).toEqual({ error: 'Failed to fetch assessments' });
		const resC = await request(buildApp())
			.get('/api/assessments/catalog')
			.set('x-test-user-id', '7');
		expect(resC.status).toBe(500);
		expect(JSON.stringify(resC.body)).not.toContain('JavaScript');
	});
});
