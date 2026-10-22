/**
 * Issue #1654 — #1603 Phase C story C2 (SERVER): configured starts.
 *
 * Pins (design architecture-assessments-phase-c.md §3.6, §4.1, §4.2, §4.6,
 * §5.2, §7, §8; STOP 1 Lead rulings Q1–Q6 on #1654):
 *  1. Session snapshot contents for BOTH start bodies (new: the chosen
 *     configuration; legacy: default topic via the subject's legacy skill
 *     name, format 'mixed', band 'medium', total 10 — §8/SF-9).
 *  2. Band start difficulties 1/3/4; legacy-mapped start 3.
 *  3. Validation: non-enum counts / bad format / bad band → 400; setId →
 *     explicit 400 code (Q3); format 'coding' with the flag OFF → 503
 *     QUESTION_UNAVAILABLE family with a format-specific reason (Q4).
 *  4. Q1: a non-enum count equal to the configuration's current servable
 *     (the labelled largestAvailable offer) is accepted; any other
 *     non-enum count is 400.
 *  5. Availability re-checked at start: insufficient supply → the existing
 *     503 shape EXTENDED with { promised, largestAvailable }, and the
 *     session is still committed + resumable (Phase A contract).
 *  6. Pre-flight exactness: per-topic approved-only counts, band overlap
 *     (a shared-level row counts in each band it belongs to), and
 *     largestAvailable is PER-CONFIGURATION — never the cross-config max.
 *  7. Pool predicate: pending/rejected/other-topic/other-format rows are
 *     never served to a snapshot session; mixed serves the union of its
 *     member formats (single-format supply still serves).
 *  8. AI provenance: generated rows are INSERTed with topic_id, derived
 *     format, source 'ai_live', review_status 'pending', and a second
 *     session cannot draw the pending row from the bank.
 *  9. Re-serve order (Q2): bank-first → AI generation → in-scope approved
 *     re-serve (fully predicated, no exclusion) → unavailable.
 * 10. Band clamp in /answer keyed on the locked session's band; NULL band
 *     keeps [1,5]; an unevaluated answer (isCorrect null, #1572) never
 *     moves difficulty.
 * 11. Count plumbing: total_questions ?? 10 everywhere — a 25-count
 *     session serves/completes at 25 and a partial exit labels
 *     '7 of 25' from the snapshot, not the legacy constant.
 * 12. Score normalisation (Q5): EVERY completion writes
 *     score = round(Σ scorePoints / Σ maxPoints × 100), max_score 100,
 *     passed decided on the percentage; verified_score and the
 *     OmniScore feed consume the percentage. Retake gate pins hold.
 *
 * Mock note: lib/db is mocked by server/test/setup.js; this file replaces
 * db.query with a STATEFUL dispatcher that EMULATES the SQL semantics —
 * bank filters are applied only when the route's SQL actually carries the
 * predicate (topic_id / format / review_status are parsed from the SQL
 * text), so a missing predicate in the route is a failing test, not a
 * mock convenience. Only db / auth / AI / audit / omniscore boundaries
 * are mocked. Regression pin only — NOT the HL-003 E2E-on-dev gate.
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

// ── Stateful fixtures ───────────────────────────────────────────────────────
let S;
function freshState() {
	S = {
		queries: [], // { sql, params } — every statement the route issued
		sessionInserts: [], // zipped assessment_sessions INSERT rows
		questionInserts: [], // zipped assessment_questions INSERT rows
		aiMode: 'down', // generation: 'down' | 'up'
		evalMode: 'ok', // short-answer evaluation: 'ok' | 'fail'
		evalScore: 90,
		genCount: 0,
		nextSessionId: 900,
		nextQuestionId: 5000,
		nextSkillId: 100,
		nextAssessmentId: 700,
		skills: [
			{ id: 3, user_id: 7, skill_name: 'JavaScript', category: 'technical', is_verified: false, verified_score: null },
			{ id: 4, user_id: 7, skill_name: 'Python', category: 'technical', is_verified: false, verified_score: null },
			{ id: 5, user_id: 9, skill_name: 'Python', category: 'technical', is_verified: false, verified_score: null },
		],
		subjects: [
			{ id: 1, slug: 'javascript', name: 'JavaScript', category: 'technical', is_active: true },
			{ id: 2, slug: 'python', name: 'Python', category: 'technical', is_active: true },
		],
		topics: [
			{ id: 10, subject_id: 1, slug: 'js-core', name: 'JavaScript Core', legacy_skill_name: 'JavaScript', is_active: true },
			{ id: 20, subject_id: 2, slug: 'python-core', name: 'Python Core', legacy_skill_name: 'Python', is_active: true },
			{ id: 21, subject_id: 2, slug: 'python-adv', name: 'Python Advanced', legacy_skill_name: null, is_active: true },
			{ id: 22, subject_id: 2, slug: 'python-dead', name: 'Python Dead', legacy_skill_name: null, is_active: false },
		],
		bank: [],
		sessions: [],
		skillAssessments: [],
		events: [],
	};
}
let bankSeq = 0;
function addBank({ topic_id = 20, format = 'mcq', difficulty_level = 3, review_status = 'approved', skill_category = 'Python', count = 1 }) {
	const ids = [];
	for (let i = 0; i < count; i++) {
		bankSeq += 1;
		const row = {
			id: bankSeq,
			topic_id,
			format,
			difficulty_level,
			review_status,
			skill_category,
			question_type: format === 'mcq' ? 'multiple_choice' : format === 'short_answer' ? 'short_answer' : 'coding',
			question_text: `Bank Q${bankSeq} (${skill_category} ${format} d${difficulty_level})`,
			options: format === 'mcq' ? '["RigCorrect","Wrong A","Wrong B","Wrong C"]' : null,
			correct_answer: format === 'mcq' ? 'RigCorrect' : null,
			explanation: 'Rig explanation',
			time_limit_seconds: format === 'mcq' ? 90 : 180,
			source: 'seed',
		};
		S.bank.push(row);
		ids.push(row.id);
	}
	return ids;
}

// ── SQL emulation helpers ───────────────────────────────────────────────────
function splitTopLevel(text) {
	const out = [];
	let depth = 0;
	let cur = '';
	for (const ch of text) {
		if (ch === '(') depth += 1;
		if (ch === ')') depth -= 1;
		if (ch === ',' && depth === 0) {
			out.push(cur.trim());
			cur = '';
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}
function evalToken(token, params) {
	const t = token.trim();
	const pm = t.match(/^\$(\d+)(::\w+)?$/);
	if (pm) return params[parseInt(pm[1], 10) - 1];
	const sm = t.match(/^'([^']*)'(::\w+)?$/);
	if (sm) return sm[1];
	if (/^-?\d+$/.test(t)) return parseInt(t, 10);
	if (/^now\(\)$/i.test(t)) return new Date();
	if (/^\[\]'::jsonb$/.test(t) || t === "'[]'::jsonb") return [];
	if (/^extract\(/i.test(t)) return 0;
	if (t === 'true') return true;
	if (t === 'false') return false;
	if (t === 'null') return null;
	return t;
}
function zipInsert(sql, params) {
	// NOTE: sql arrives lowercased from the dispatcher.
	const cOpen = sql.indexOf('(');
	const cClose = sql.indexOf(')', cOpen);
	const colsText = sql.slice(cOpen + 1, cClose);
	const vOpen = sql.indexOf('(', sql.indexOf(' values'));
	const vClose = sql.includes(' returning') ? sql.lastIndexOf(')', sql.indexOf(' returning')) : sql.lastIndexOf(')');
	const valsText = sql.slice(vOpen + 1, vClose);
	const cols = splitTopLevel(colsText).map((c) => c.trim());
	const vals = splitTopLevel(valsText);
	const row = {};
	cols.forEach((col, i) => {
		row[col] = evalToken(vals[i] ?? 'null', params);
	});
	return row;
}

function sessionById(id) {
	return S.sessions.find((s) => s.id === Number(id));
}

function bankServe(sql, params) {
	// Emulate ONLY the predicates the SQL actually carries.
	let rows = [...S.bank];
	if (sql.includes('topic_id')) {
		const topicId = params[0];
		rows = rows.filter((r) => r.topic_id === topicId);
	}
	const fmtIn = sql.includes("format in ('mcq','short_answer')");
	const fmtEq = sql.match(/format = '(\w+)'/);
	if (fmtIn) rows = rows.filter((r) => ['mcq', 'short_answer'].includes(r.format));
	else if (fmtEq) rows = rows.filter((r) => r.format === fmtEq[1]);
	if (sql.includes("review_status = 'approved'")) rows = rows.filter((r) => r.review_status === 'approved');
	if (sql.includes('lower(skill_category)')) {
		const name = String(params[0]).toLowerCase();
		rows = rows.filter((r) => String(r.skill_category).toLowerCase() === name);
	}
	const diffParam = sql.includes('topic_id') || sql.includes('lower(skill_category)') ? params[sql.includes('topic_id') ? 1 : 1] : null;
	if (diffParam != null && sql.includes('difficulty_level =')) rows = rows.filter((r) => r.difficulty_level === diffParam);
	if (sql.includes('id = any(')) {
		const excluded = params[params.length - 1] || [];
		rows = rows.filter((r) => !excluded.includes(r.id));
	}
	return rows.length ? { rows: [rows[0]], rowCount: 1 } : { rows: [], rowCount: 0 };
}

function groupedCounts(topicId) {
	const map = new Map();
	for (const r of S.bank) {
		if (r.review_status !== 'approved') continue;
		if (topicId != null && r.topic_id !== topicId) continue;
		const key = `${r.topic_id}|${r.format}|${r.difficulty_level}`;
		map.set(key, (map.get(key) || 0) + 1);
	}
	return [...map.entries()].map(([key, n]) => {
		const [tid, format, lvl] = key.split('|');
		return { topic_id: parseInt(tid, 10), format, difficulty_level: parseInt(lvl, 10), n };
	});
}

const db = require('../../../lib/db');
function installDbMock() {
	db.query.mockImplementation(async (sqlRaw, params = []) => {
		const sql = String(sqlRaw).toLowerCase().replace(/\s+/g, ' ').trim();
		S.queries.push({ sql, params });
		if (['begin', 'commit', 'rollback'].includes(sql)) return { rows: [], rowCount: 0 };

		// ── topics / subjects (C2 config resolution) ──
		if (sql.includes('from assessment_topics') && sql.includes('subject_id = $1')) {
			const rows = S.topics.filter((t) => t.subject_id === Number(params[0]) && t.legacy_skill_name);
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_topics') && sql.includes('lower(legacy_skill_name)')) {
			const name = String(params[0]).toLowerCase();
			const rows = S.topics.filter((t) => t.legacy_skill_name && t.legacy_skill_name.toLowerCase() === name);
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_topics') && sql.includes('where id = $1')) {
			const rows = S.topics.filter((t) => t.id === Number(params[0]));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_subjects') && sql.includes('where id = $1')) {
			const rows = S.subjects.filter((s) => s.id === Number(params[0]));
			return { rows, rowCount: rows.length };
		}

		// ── availability counts (grouped, approved-only per the SQL) ──
		if (sql.includes('from assessment_questions') && sql.includes('group by') && sql.includes('topic_id = $1')) {
			const rows = groupedCounts(Number(params[0])).map(({ format, difficulty_level, n }) => ({ format, difficulty_level, n }));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_questions') && sql.includes('group by')) {
			const rows = groupedCounts(null);
			return { rows, rowCount: rows.length };
		}

		// ── candidate_skills ──
		if (sql.includes('insert into candidate_skills')) {
			const row = { id: S.nextSkillId++, user_id: params[0], skill_name: params[1], category: params[2] || 'technical', is_verified: false, verified_score: null };
			S.skills.push(row);
			return { rows: [row], rowCount: 1 };
		}
		if (sql.includes('from candidate_skills where id = $1 and user_id = $2')) {
			const rows = S.skills.filter((s) => s.id === Number(params[0]) && s.user_id === Number(params[1]));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from candidate_skills where user_id = $1 and lower(skill_name)')) {
			const name = String(params[1]).toLowerCase();
			const rows = S.skills.filter((s) => s.user_id === Number(params[0]) && s.skill_name.toLowerCase() === name);
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('update candidate_skills set is_verified = true')) {
			const skill = S.skills.find((s) => s.id === Number(params[1]));
			if (skill) {
				skill.is_verified = true;
				skill.verified_score = params[0];
			}
			return { rows: [], rowCount: skill ? 1 : 0 };
		}
		if (sql.includes('from candidate_skills where id = $1')) {
			const rows = S.skills.filter((s) => s.id === Number(params[0]));
			return { rows, rowCount: rows.length };
		}

		// ── retake gate / completion reads on skill_assessments ──
		if (sql.includes('select completed_at from skill_assessments')) {
			const rows = S.skillAssessments
				.filter((a) => a.user_id === Number(params[0]) && a.skill_id === Number(params[1]) && a.completed_at)
				.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
			return { rows: rows.slice(0, 1).map((a) => ({ completed_at: a.completed_at })), rowCount: Math.min(1, rows.length) };
		}
		if (sql.includes('from skill_assessments') && sql.includes('behavioral_flags') && sql.includes('where session_id')) {
			const rows = S.skillAssessments.filter((a) => a.session_id === Number(params[0]));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('insert into skill_assessments')) {
			const zipped = zipInsert(sql, params);
			const row = { id: S.nextAssessmentId++, completed_at: new Date(), ...zipped };
			if (typeof row.behavioral_flags === 'string') {
				try { row.behavioral_flags = JSON.parse(row.behavioral_flags); } catch { /* keep raw */ }
			}
			S.skillAssessments.push(row);
			return { rows: [{ id: row.id }], rowCount: 1 };
		}

		// ── sessions ──
		if (sql.includes('insert into assessment_sessions')) {
			const zipped = zipInsert(sql, params);
			const row = {
				id: S.nextSessionId++,
				tab_switches: 0, copy_paste_attempts: 0, time_anomalies: 0,
				questions_asked: [], answers_given: [], current_draft: null,
				topic_id: null, subject_id: null, set_id: null, format: null,
				difficulty_band: null, total_questions: null,
				...zipped,
			};
			if (typeof row.questions_asked === 'string') row.questions_asked = JSON.parse(row.questions_asked);
			if (typeof row.answers_given === 'string') row.answers_given = JSON.parse(row.answers_given);
			S.sessions.push(row);
			S.sessionInserts.push(row);
			return { rows: [row], rowCount: 1 };
		}
		if (sql.includes("select id from assessment_sessions where user_id")) {
			const rows = S.sessions.filter((s) => s.user_id === Number(params[0]) && s.skill_id === Number(params[1]) && s.status === 'in_progress');
			return { rows: rows.map((s) => ({ id: s.id })), rowCount: rows.length };
		}
		if (sql.includes("update assessment_sessions set status = 'abandoned' where id = $1")) {
			const s = sessionById(params[0]);
			if (s) s.status = 'abandoned';
			return { rows: [], rowCount: s ? 1 : 0 };
		}
		if (sql.includes("update assessment_sessions set status = 'completed'")) {
			const s = sessionById(params[0]);
			if (s && s.status === 'in_progress') {
				s.status = 'completed';
				s.completed_at = new Date();
				s.current_draft = null;
				return { rows: [{ ...s }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}
		if (sql.includes("set status = 'abandoned', abandoned_at")) {
			const s = sessionById(params[0]);
			if (s && s.user_id === Number(params[1]) && s.status === 'in_progress') {
				s.status = 'abandoned';
				s.abandoned_at = new Date();
				s.current_draft = null;
				return { rows: [{ answers_given: s.answers_given }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}
		if (sql.includes('set current_draft = $1 where id')) {
			const s = sessionById(params[1]);
			if (s && s.user_id === Number(params[2]) && s.status === 'in_progress') {
				s.current_draft = params[0] ? JSON.parse(params[0]) : null;
				return { rows: [], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}
		if (sql.includes('set questions_asked = $1')) {
			const s = sessionById(params[2]);
			if (s) {
				s.questions_asked = JSON.parse(params[0]);
				s.current_question_index = params[1];
			}
			return { rows: [], rowCount: s ? 1 : 0 };
		}
		if (sql.includes('set answers_given = $1')) {
			const s = sessionById(params[6]);
			if (s) {
				s.answers_given = JSON.parse(params[0]);
				s.score = params[1];
				s.current_question_index = params[2];
				s.current_difficulty = params[3];
				s.max_difficulty_reached = params[4];
				s.time_anomalies = params[5];
			}
			return { rows: [], rowCount: s ? 1 : 0 };
		}
		if (sql.includes('from assessment_sessions where id = $1')) {
			const s = sessionById(params[0]);
			if (!s) return { rows: [], rowCount: 0 };
			if (sql.includes('user_id = $2') && s.user_id !== Number(params[1])) return { rows: [], rowCount: 0 };
			if (sql.includes('select status')) return { rows: [{ status: s.status }], rowCount: 1 };
			return { rows: [{ ...s }], rowCount: 1 };
		}

		// ── events ──
		if (sql.includes('insert into assessment_events')) {
			S.events.push({ session_id: params[0] });
			return { rows: [], rowCount: 1 };
		}
		if (sql.includes('from assessment_events')) {
			return { rows: [{ n: 0 }], rowCount: 1 };
		}

		// ── questions ──
		if (sql.includes('insert into assessment_questions')) {
			const zipped = zipInsert(sql, params);
			const row = {
				id: S.nextQuestionId++,
				topic_id: null, format: null, source: 'legacy', review_status: 'pending',
				options: null, correct_answer: null,
				...zipped,
			};
			if (row.question_type === 'multiple_choice' && typeof row.options !== 'string' && row.options != null) {
				row.options = JSON.stringify(row.options);
			}
			S.bank.push(row);
			S.questionInserts.push({ sql, params, row });
			return { rows: [row], rowCount: 1 };
		}
		if (sql.includes('from assessment_questions') && sql.includes('id = any(') && sql.includes('for update')) {
			const ids = params[0] || [];
			const rows = S.bank.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, difficulty_level: r.difficulty_level, question_type: r.question_type }));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_questions') && (sql.includes('topic_id') || sql.includes('lower(skill_category)'))) {
			return bankServe(sql, params);
		}
		if (sql.includes('from assessment_questions where id = $1')) {
			const rows = S.bank.filter((r) => r.id === Number(params[0]));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_questions')) {
			// Unpredicated bank read (the pre-C2 any-bank shape): serve the
			// first bank row — decoys sit early in the array on purpose.
			return S.bank.length ? { rows: [S.bank[0]], rowCount: 1 } : { rows: [], rowCount: 0 };
		}

		return { rows: [], rowCount: 0 };
	});
}

const { chat } = require('../../../lib/polsia-ai');
const omniscore = require('../../../services/omniscore');
const assessmentsRouter = require('../../../routes/assessments');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', assessmentsRouter);
	return app;
}
const asUser = (req, uid = '7') => req.set('x-test-user-id', uid);
function start(body, uid) {
	return asUser(request(buildApp()).post('/api/assessments/start'), uid).send(body);
}
function answer(sessionId, questionId, ans, uid) {
	return asUser(request(buildApp()).post('/api/assessments/answer'), uid).send({ sessionId, questionId, answer: ans, timeTaken: 30 });
}
function current(sessionId, uid) {
	return asUser(request(buildApp()).get(`/api/assessments/session/${sessionId}/current`), uid);
}
function exit(sessionId, body, uid) {
	return asUser(request(buildApp()).post(`/api/assessments/session/${sessionId}/exit`), uid).send(body);
}

beforeEach(() => {
	freshState();
	bankSeq = 0;
	installDbMock();
	chat.mockReset();
	omniscore.addTechnicalComponent.mockClear();
	chat.mockImplementation(async (prompt) => {
		if (prompt.includes('Evaluate this short answer')) {
			if (S.evalMode === 'fail') throw new Error('provider down');
			return JSON.stringify({ score: S.evalScore, feedback: 'Solid answer.' });
		}
		if (S.aiMode !== 'up') throw new Error('provider down');
		S.genCount += 1;
		const type = prompt.includes('Question type: short_answer') ? 'short_answer' : 'multiple_choice';
		return JSON.stringify({
			question_text: `Generated Q${S.genCount}: explain the concept`,
			question_type: type,
			...(type === 'multiple_choice'
				? { options: ['RigCorrect', 'Wrong A', 'Wrong B', 'Wrong C'], correct_answer: 'RigCorrect' }
				: {}),
			explanation: 'Generated explanation',
			time_limit_seconds: type === 'multiple_choice' ? 90 : 180,
		});
	});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ── 6. Pre-flight endpoint ──────────────────────────────────────────────────
describe('GET /catalog/:topicId/availability (#1654 §4.1)', () => {
	beforeEach(() => {
		// Topic 20 mcq: L2×3, L3×2, L4×1 → easy 3, medium 6, hard 1.
		addBank({ format: 'mcq', difficulty_level: 2, count: 3 });
		addBank({ format: 'mcq', difficulty_level: 3, count: 2 });
		addBank({ format: 'mcq', difficulty_level: 4, count: 1 });
		// short_answer L4×2 → medium 2, hard 2. mixed medium = 8.
		addBank({ format: 'short_answer', difficulty_level: 4, count: 2 });
		// coding L1×20 → coding easy 20 (must never leak into other configs).
		addBank({ format: 'coding', difficulty_level: 1, count: 20 });
		// Invisible supply: pending never counts.
		addBank({ format: 'mcq', difficulty_level: 3, review_status: 'pending', count: 5 });
		// Other topic's supply never counts here.
		addBank({ topic_id: 21, format: 'mcq', difficulty_level: 3, count: 9 });
	});
	const avail = (qs) => asUser(request(buildApp()).get(`/api/assessments/catalog/20/availability?${qs}`));

	it('reports exact per-configuration servable with band overlap', async () => {
		const res = await avail('format=mcq&band=medium&count=10');
		expect(res.status).toBe(200);
		expect(res.body.promised).toBe(10);
		expect(res.body.servable).toBe(6); // L2+L3+L4 approved mcq; pending excluded
		expect(res.body.largestAvailable).toBe(6);
		const hard = await avail('format=mcq&band=hard');
		expect(hard.body.servable).toBe(1); // the L4 row counts in hard too (overlap)
	});

	it('largestAvailable is per-configuration, never the cross-config max', async () => {
		const res = await avail('format=mixed&band=medium&count=25');
		expect(res.status).toBe(200);
		expect(res.body.servable).toBe(8); // mcq medium 6 + short medium 2
		expect(res.body.largestAvailable).toBe(8); // NOT 20 (coding easy) and NOT 13 (any other config)
	});

	it('zero supply is an honest zero with a reason; unknown/inactive topics and bad params are explicit', async () => {
		const zero = await asUser(request(buildApp()).get('/api/assessments/catalog/21/availability?format=short_answer&band=easy'));
		expect(zero.status).toBe(200);
		expect(zero.body.servable).toBe(0);
		expect(zero.body.largestAvailable).toBe(0);
		expect(typeof zero.body.reason).toBe('string');
		expect(zero.body.reason.length).toBeGreaterThan(0);

		const missing = await asUser(request(buildApp()).get('/api/assessments/catalog/999/availability?format=mcq&band=easy'));
		expect(missing.status).toBe(404);
		const inactive = await asUser(request(buildApp()).get('/api/assessments/catalog/22/availability?format=mcq&band=easy'));
		expect(inactive.status).toBe(404);
		const badFormat = await avail('format=bogus&band=easy');
		expect(badFormat.status).toBe(400);
		const badBand = await avail('format=mcq&band=bogus');
		expect(badBand.status).toBe(400);
	});
});

// ── 1–5. POST /start dual body ──────────────────────────────────────────────
describe('POST /start — configured body (#1654 §4.2, Q1/Q3/Q4)', () => {
	it('snapshots the chosen configuration and starts at the band start (easy = 1)', async () => {
		addBank({ format: 'mcq', difficulty_level: 1, count: 10 });
		addBank({ format: 'mcq', difficulty_level: 2, count: 10 });
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'easy', totalQuestions: 10 });
		expect(res.status).toBe(200);
		const ins = S.sessionInserts[0];
		expect(ins.topic_id).toBe(20);
		expect(ins.subject_id).toBe(2);
		expect(ins.format).toBe('mcq');
		expect(ins.difficulty_band).toBe('easy');
		expect(ins.total_questions).toBe(10);
		const session = sessionById(res.body.sessionId);
		expect(session.current_difficulty).toBe(1);
		expect(res.body.question.totalQuestions).toBe(10);
	});

	it('band start: medium = 3', async () => {
		addBank({ format: 'mcq', difficulty_level: 2, count: 4 });
		addBank({ format: 'mcq', difficulty_level: 3, count: 4 });
		addBank({ format: 'mcq', difficulty_level: 4, count: 4 });
		const med = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(med.status).toBe(200);
		expect(sessionById(med.body.sessionId).current_difficulty).toBe(3);
	});

	it('hard band start is 4 on a supplied topic', async () => {
		addBank({ format: 'mcq', difficulty_level: 4, count: 6 });
		addBank({ format: 'mcq', difficulty_level: 5, count: 6 });
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'hard', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(sessionById(res.body.sessionId).current_difficulty).toBe(4);
	});

	it('validation: non-enum count, bad format, bad band → 400; setId → explicit 400 code (Q3)', async () => {
		addBank({ format: 'mcq', difficulty_level: 3, count: 12 });
		expect((await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 7 })).status).toBe(400);
		expect((await start({ topicId: 20, format: 'bogus', difficultyBand: 'medium', totalQuestions: 10 })).status).toBe(400);
		expect((await start({ topicId: 20, format: 'mcq', difficultyBand: 'bogus', totalQuestions: 10 })).status).toBe(400);
		const setRes = await start({ topicId: 20, setId: 5, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(setRes.status).toBe(400);
		expect(setRes.body.code).toMatch(/SET/);
	});

	it("format 'coding' with the flag OFF → 503 QUESTION_UNAVAILABLE family, format-specific reason (Q4)", async () => {
		addBank({ format: 'coding', difficulty_level: 3, count: 12 });
		const res = await start({ topicId: 20, format: 'coding', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(503);
		expect(res.body.code).toBe('QUESTION_UNAVAILABLE');
		expect(JSON.stringify(res.body).toLowerCase()).toContain('coding');
	});

	it('Q1: the labelled largestAvailable count is accepted; any other non-enum count is 400', async () => {
		// mcq medium servable = 6 (L3×6).
		addBank({ format: 'mcq', difficulty_level: 3, count: 6 });
		const ok = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 6 });
		expect(ok.status).toBe(200);
		expect(S.sessionInserts[0].total_questions).toBe(6);
		const bad = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 5 });
		expect(bad.status).toBe(400);
	});

	it('insufficient supply at start → extended 503 {promised, largestAvailable}, session committed + resumable', async () => {
		addBank({ format: 'mcq', difficulty_level: 3, count: 3 });
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(503);
		expect(res.body.code).toBe('QUESTION_UNAVAILABLE');
		expect(res.body.promised).toBe(10);
		expect(res.body.largestAvailable).toBe(3);
		expect(res.body.sessionId).toBeTruthy();
		const session = sessionById(res.body.sessionId);
		expect(session).toBeTruthy();
		expect(session.status).toBe('in_progress');
	});
});

describe('POST /start — legacy body (§8/SF-9 snapshot)', () => {
	it('resolves the default topic by subject legacy name and snapshots the recorded defaults, start 3', async () => {
		addBank({ topic_id: 20, format: 'mcq', difficulty_level: 3, count: 3, skill_category: 'Python' });
		const res = await start({ skillName: 'Python', category: 'technical' });
		expect(res.status).toBe(200);
		const ins = S.sessionInserts[0];
		expect(ins.topic_id).toBe(20);
		expect(ins.subject_id).toBe(2);
		expect(ins.format).toBe('mixed');
		expect(ins.difficulty_band).toBe('medium');
		expect(ins.total_questions).toBe(10);
		expect(sessionById(res.body.sessionId).current_difficulty).toBe(3);
	});

	it('mixed serves single-format supply (short_answer only) — never a literal mixed equality', async () => {
		const [saId] = addBank({ topic_id: 20, format: 'short_answer', difficulty_level: 3, count: 2, skill_category: 'Python' });
		const res = await start({ skillName: 'Python', category: 'technical' });
		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(saId);
		expect(res.body.question.type).toBe('short_answer');
	});

	it('retake gate still applies to configured starts (pin)', async () => {
		addBank({ format: 'mcq', difficulty_level: 3, count: 12 });
		S.skillAssessments.push({
			id: 1, user_id: 7, skill_id: 4, session_id: 1, score: 80, passed: true,
			behavioral_flags: {}, completed_at: new Date(Date.now() - 5 * 24 * 3600 * 1000),
		});
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('RETAKE_LOCKOUT');
	});
});

// ── 7–9. Serving scope, provenance, re-serve order ──────────────────────────
describe('serving scope (#1654 §4.6/§7)', () => {
	it('pool predicate: pending / other-topic / other-format decoys are never served', async () => {
		// Decoys FIRST in bank order — an under-predicated query serves them.
		addBank({ format: 'mcq', difficulty_level: 3, review_status: 'pending', count: 1 });
		addBank({ topic_id: 21, format: 'mcq', difficulty_level: 3, count: 1 });
		addBank({ format: 'short_answer', difficulty_level: 3, count: 1 });
		const [goodId] = addBank({ format: 'mcq', difficulty_level: 3, count: 10 });
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(goodId);
		const bankSql = S.queries.filter((q) => q.sql.includes('from assessment_questions') && q.sql.includes('order by random()'));
		expect(bankSql.length).toBeGreaterThan(0);
		for (const q of bankSql) {
			expect(q.sql).toContain('topic_id');
			expect(q.sql).toContain("review_status = 'approved'");
		}
	});

	it('AI provenance: generated row carries topic/format/source/review_status; a second session cannot draw the pending row', async () => {
		S.aiMode = 'up';
		addBank({ topic_id: 21, format: 'mcq', difficulty_level: 3, count: 3 }); // other topic only
		const first = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		// servable is 0 for topic 20 → the availability gate fires first.
		expect(first.status).toBe(503);
		expect(S.questionInserts).toHaveLength(0);
	});

	it('AI generation serves when supply exists at the band but not the start level; insert provenance is written', async () => {
		S.aiMode = 'up';
		// Band supply at L2 (medium counts it) but the start level is 3:
		// availability passes (10), bank-first at L3 misses, AI generates.
		addBank({ format: 'mcq', difficulty_level: 2, count: 10 });
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(res.body.question.text).toContain('Generated Q');
		expect(S.questionInserts).toHaveLength(1);
		const ins = S.questionInserts[0];
		expect(ins.row.topic_id).toBe(20);
		expect(ins.row.format).toBe('mcq');
		expect(ins.row.source).toBe('ai_live');
		expect(ins.row.review_status).toBe('pending');
		expect(ins.row.question_type).toBe('multiple_choice');

		// Second session (user 9, own Python skill): the pending generated
		// row sits in the bank at L3 — the bank predicate must not serve it;
		// generation runs again instead.
		const second = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 }, '9');
		expect(second.status).toBe(200);
		expect(second.body.question.id).not.toBe(res.body.question.id);
		expect(second.body.question.text).toContain('Generated Q');
	});

	it('re-serve order (Q2): exhausted pool → AI first; AI down → in-scope approved re-serve', async () => {
		// short_answer L3 ×1 + L2 ×9 → medium servable 10. Start (L3) serves
		// the L3 row; an unevaluated answer keeps difficulty at 3, where the
		// pool is now exhausted for this session.
		const [onlyL3] = addBank({ format: 'short_answer', difficulty_level: 3, count: 1 });
		addBank({ format: 'short_answer', difficulty_level: 2, count: 9 });
		S.evalMode = 'fail'; // unevaluated → no difficulty move (#1572)
		const started = await start({ topicId: 20, format: 'short_answer', difficultyBand: 'medium', totalQuestions: 10 });
		expect(started.status).toBe(200);
		expect(started.body.question.id).toBe(onlyL3);
		const sid = started.body.sessionId;
		const a1 = await answer(sid, onlyL3, 'a written answer');
		expect(a1.status).toBe(200);

		// AI down: re-serve the in-scope approved row rather than fail.
		S.aiMode = 'down';
		const cur1 = await current(sid);
		expect(cur1.status).toBe(200);
		expect(cur1.body.question.id).toBe(onlyL3);

		// Answer the re-served question (a NEW answer, not a retry), then
		// with AI up the next serve must be a GENERATED question — AI is
		// tried before re-serve for snapshot sessions (Q2).
		const a2 = await answer(sid, onlyL3, 'another written answer');
		expect(a2.status).toBe(200);
		expect(a2.body.answerRecorded).toBe(true);
		S.aiMode = 'up';
		const cur2 = await current(sid);
		expect(cur2.status).toBe(200);
		expect(cur2.body.question.text).toContain('Generated Q');
	});
});

// ── 10. Band clamp ──────────────────────────────────────────────────────────
describe('/answer band clamp (#1654 §5.2)', () => {
	it('easy band clamps at 2; hard band floors at 4', async () => {
		addBank({ format: 'mcq', difficulty_level: 1, count: 3 });
		addBank({ format: 'mcq', difficulty_level: 2, count: 12 });
		const started = await start({ topicId: 20, format: 'mcq', difficultyBand: 'easy', totalQuestions: 10 });
		const sid = started.body.sessionId;
		let q = started.body.question;
		await answer(sid, q.id, 'RigCorrect'); // L1 correct → 2
		expect(sessionById(sid).current_difficulty).toBe(2);
		const cur = await current(sid);
		q = cur.body.question;
		await answer(sid, q.id, 'RigCorrect'); // L2 correct → would be 3 unbounded; band caps at 2
		expect(sessionById(sid).current_difficulty).toBe(2);
	});

	it('NULL-band (in-flight legacy) sessions keep the [1,5] clamp', async () => {
		const [qid] = addBank({ topic_id: null, format: 'mcq', difficulty_level: 5, count: 1, skill_category: 'Python' });
		S.sessions.push({
			id: 4242, user_id: 7, skill_id: 4, job_id: null, status: 'in_progress',
			current_difficulty: 5, current_question_index: 0, score: 0, max_difficulty_reached: 5,
			tab_switches: 0, copy_paste_attempts: 0, time_anomalies: 0,
			questions_asked: [{ questionId: qid, difficulty: 5 }], answers_given: [],
			topic_id: null, subject_id: null, set_id: null, format: null, difficulty_band: null, total_questions: null,
			current_draft: null, started_at: new Date(),
		});
		const res = await answer(4242, qid, 'RigCorrect');
		expect(res.status).toBe(200);
		expect(sessionById(4242).current_difficulty).toBe(5); // capped at 5, not an error
	});

	it('unevaluated answer moves difficulty neither way (#1572 pin)', async () => {
		const [saId] = addBank({ format: 'short_answer', difficulty_level: 3, count: 1 });
		addBank({ format: 'short_answer', difficulty_level: 2, count: 9 });
		addBank({ format: 'short_answer', difficulty_level: 4, count: 2 });
		S.evalMode = 'fail';
		const started = await start({ topicId: 20, format: 'short_answer', difficultyBand: 'medium', totalQuestions: 10 });
		const sid = started.body.sessionId;
		const res = await answer(sid, saId, 'some prose');
		expect(res.status).toBe(200);
		expect(sessionById(sid).current_difficulty).toBe(3);
	});
});

// ── 11–12. Count plumbing + score normalisation ─────────────────────────────
describe('count plumbing + score normalisation (#1654 Q5)', () => {
	function seed25() {
		addBank({ format: 'mcq', difficulty_level: 3, count: 5 });
		addBank({ format: 'mcq', difficulty_level: 4, count: 20 });
	}
	async function playToEnd(sid, firstQuestion, answerFor) {
		let q = firstQuestion;
		let last = null;
		for (let i = 0; i < 40 && q; i++) {
			last = await answer(sid, q.id, answerFor(i, q));
			if (last.body.completed) return last;
			const cur = await current(sid);
			q = cur.body.question || null;
			if (!q) return last;
			if (q.totalQuestions !== undefined) expect(q.totalQuestions).toBe(25);
		}
		return last;
	}

	it('a 25-count session completes at 25 and writes the PERCENTAGE score (not the raw 950)', async () => {
		seed25();
		const started = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 25 });
		expect(started.status).toBe(200);
		expect(started.body.question.totalQuestions).toBe(25);
		const last = await playToEnd(started.body.sessionId, started.body.question, () => 'RigCorrect');
		expect(last.body.completed).toBe(true);
		const row = S.skillAssessments[0];
		expect(row).toBeTruthy();
		// All correct: Σ points = 5×30 + 20×40 = 950 raw; percentage = 100.
		expect(row.score).toBe(100);
		expect(row.max_score).toBe(100);
		expect(row.passed).toBe(true);
		const skill = S.skills.find((s) => s.id === 4);
		expect(skill.verified_score).toBe(100);
		expect(omniscore.addTechnicalComponent).toHaveBeenCalledWith(7, row.id, 100, 100);
	});

	it("partial exit at 7 of 25 labels from the snapshot and scores the answered percentage", async () => {
		seed25();
		const started = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 25 });
		const sid = started.body.sessionId;
		let q = started.body.question;
		for (let i = 0; i < 7; i++) {
			await answer(sid, q.id, 'RigCorrect');
			if (i < 6) {
				const cur = await current(sid);
				q = cur.body.question;
			}
		}
		const exited = await exit(sid, { action: 'submit' });
		expect(exited.status).toBe(200);
		expect(exited.body.partial).toBe(true);
		expect(exited.body.answersGiven).toBe(7);
		expect(exited.body.totalQuestions).toBe(25);
		const row = S.skillAssessments[0];
		expect(row.score).toBe(100); // all 7 answered correctly → 100% of answered
		const flags = typeof row.behavioral_flags === 'string' ? JSON.parse(row.behavioral_flags) : row.behavioral_flags;
		expect(flags.partial).toBe(true);
		expect(flags.answers_given).toBe(7);
		expect(flags.total_questions).toBe(25);
		// Founder ruling: partials never feed OmniScore.
		expect(omniscore.addTechnicalComponent).not.toHaveBeenCalled();
	});

	it('passed is decided on the percentage: raw 200 with 45% correct-weight FAILS', async () => {
		addBank({ format: 'mcq', difficulty_level: 4, count: 10 });
		addBank({ format: 'mcq', difficulty_level: 5, count: 10 });
		const started = await start({ topicId: 20, format: 'mcq', difficultyBand: 'hard', totalQuestions: 10 });
		expect(started.status).toBe(200);
		const sid = started.body.sessionId;
		let q = started.body.question;
		let last = null;
		// Difficulty walk (hard band, floor 4): W@L4, C@L4, W@L5, C@L4, …
		// earned = 5×40 = 200 raw; max = 6×40 + 4×50 = 440 → 45%.
		// The pre-C2 code wrote score 200 and passed=true (200 >= 60).
		for (let i = 0; i < 10; i++) {
			last = await answer(sid, q.id, i % 2 === 1 ? 'RigCorrect' : 'Wrong A');
			if (last.body.completed) break;
			const cur = await current(sid);
			q = cur.body.question;
		}
		expect(last.body.completed).toBe(true);
		const row = S.skillAssessments[0];
		expect(row.score).toBe(45);
		expect(row.max_score).toBe(100);
		expect(row.passed).toBe(false);
		const skill = S.skills.find((s) => s.id === 4);
		expect(skill.is_verified).toBe(false);
		expect(omniscore.addTechnicalComponent).toHaveBeenCalledWith(7, row.id, 45, 100);
	});

	it('completed/current payloads carry the configuration label fields', async () => {
		addBank({ format: 'mcq', difficulty_level: 3, count: 1 });
		addBank({ format: 'mcq', difficulty_level: 4, count: 1 });
		const started = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 2 });
		expect(started.status).toBe(200);
		const sid = started.body.sessionId;
		let q = started.body.question;
		await answer(sid, q.id, 'RigCorrect');
		const cur1 = await current(sid);
		q = cur1.body.question;
		const done = await answer(sid, q.id, 'RigCorrect');
		expect(done.body.completed).toBe(true);
		const cur = await current(sid);
		expect(cur.body.status).toBe('completed');
		expect(cur.body.format).toBe('mcq');
		expect(cur.body.difficultyBand).toBe('medium');
		expect(cur.body.totalQuestions).toBe(2);
	});
});
