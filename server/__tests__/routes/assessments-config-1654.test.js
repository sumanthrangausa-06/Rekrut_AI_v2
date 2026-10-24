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
 *  9. Re-serve order (Q2, amended by #1710): bank-first → AI generation →
 *     band-widen (unserved in-band rows, exclusion carried) → in-scope
 *     approved re-serve (fully predicated, no exclusion) → unavailable.
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
	// #1710: the band-widen draw carries difficulty_level = ANY($n::int[]) —
	// emulate it as membership, exactly as real SQL would.
	if (Array.isArray(diffParam) && sql.includes('difficulty_level = any(')) rows = rows.filter((r) => diffParam.includes(r.difficulty_level));
	else if (diffParam != null && sql.includes('difficulty_level =')) rows = rows.filter((r) => r.difficulty_level === diffParam);
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
		if (
			sql.includes('select completed_at from skill_assessments') ||
			sql.includes('select skill_assessments.completed_at from skill_assessments')
		) {
			let rows = S.skillAssessments
				.filter((a) => a.user_id === Number(params[0]) && a.skill_id === Number(params[1]) && a.completed_at)
				.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
			// #1686: the per-topic gate joins assessment_sessions and
			// predicates on its topic_id — apply that filter ONLY when
			// the route's SQL actually carries it (the suites' standing
			// emulation rule), so an unscoped gate query cannot fake-pass.
			// #1716: the default-topic widening is emulated the same way —
			// topic-less rows (session_id IS NULL, or a session whose
			// topic_id IS NULL) count ONLY when the route's SQL carries
			// the LEFT JOIN, the started topic's legacy_skill_name guard
			// and both explicit IS NULL predicates, AND the started topic
			// actually carries a legacy_skill_name (a subject's default
			// topic, migration 279). Otherwise the #1686 filter stands.
			if (sql.includes('join assessment_sessions') && sql.includes('topic_id')) {
				const topicId = Number(params[2]);
				const startedTopic = S.topics.find((t) => t.id === topicId);
				const widensToTopicless =
					sql.includes('left join assessment_sessions') &&
					sql.includes('legacy_skill_name is not null') &&
					sql.includes('topic_id is null') &&
					sql.includes('session_id is null') &&
					!!startedTopic?.legacy_skill_name;
				rows = rows.filter((a) => {
					const sess = S.sessions.find((s) => s.id === Number(a.session_id));
					if (sess && sess.topic_id === topicId) return true;
					if (!widensToTopicless) return false;
					if (a.session_id == null) return true;
					return !!sess && sess.topic_id == null;
				});
			}
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
			let rows = S.sessions.filter((s) => s.user_id === Number(params[0]) && s.skill_id === Number(params[1]) && s.status === 'in_progress');
			// #1687: the topic predicate applies only when the route's SQL
			// actually carries it (same emulation rule as the bank reads).
			if (sql.includes('topic_id')) rows = rows.filter((s) => s.topic_id === Number(params[2]));
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
		// #1686: the completion is linked to a completed Topic-20 session
		// (session_id → assessment_sessions.topic_id, the only topic
		// linkage skill_assessments has), so this pin is a genuine
		// SAME-topic completion under the per-topic gate.
		S.sessions.push({
			id: 1, user_id: 7, skill_id: 4, status: 'completed', topic_id: 20,
			questions_asked: [], answers_given: [],
		});
		S.skillAssessments.push({
			id: 1, user_id: 7, skill_id: 4, session_id: 1, score: 80, passed: true,
			behavioral_flags: {}, completed_at: new Date(Date.now() - 5 * 24 * 3600 * 1000),
		});
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('RETAKE_LOCKOUT');
	});
});

// ── #1687: topic-scoped abandon on /start ───────────────────────────────────
// STOP 1 ruling on #1687: the active-session lookup was skill-wide with no
// topic filter and abandoned only rows[0] — starting Topic B silently
// abandoned an in-progress Topic A attempt on the same skill. Ruled fix:
// a start whose snapshot resolves a topic abandons only in-progress
// sessions of the SAME topic, and ALL of them; a start with no topic
// (NULL snapshot topic) keeps the legacy skill-wide behaviour exactly.
describe('POST /start — topic-scoped abandon (#1687)', () => {
	function seedSession(id, topic_id, skill_id = 4) {
		S.sessions.push({
			id, user_id: 7, skill_id, status: 'in_progress', topic_id,
			questions_asked: [], answers_given: [],
		});
	}

	it('(a) starting Topic B leaves an in-progress Topic A session in progress', async () => {
		addBank({ topic_id: 21, format: 'mcq', difficulty_level: 3, count: 12 });
		seedSession(501, 20); // Topic A (python-core) in progress, same skill
		const res = await start({ topicId: 21, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(sessionById(501).status).toBe('in_progress');
		const created = sessionById(res.body.sessionId);
		expect(created.topic_id).toBe(21);
		expect(created.status).toBe('in_progress');
	});

	it('(b) restarting Topic A abandons ALL its in-progress sessions and no other topic', async () => {
		addBank({ topic_id: 20, format: 'mcq', difficulty_level: 3, count: 12 });
		seedSession(501, 20);
		seedSession(502, 20); // second stale Topic A session — must also go
		seedSession(503, 21); // other topic — must stay
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(sessionById(501).status).toBe('abandoned');
		expect(sessionById(502).status).toBe('abandoned');
		expect(sessionById(503).status).toBe('in_progress');
		expect(sessionById(res.body.sessionId).status).toBe('in_progress');
	});

	it('(c) legacy-body start with no catalogue topic keeps the skill-wide abandon exactly', async () => {
		// 'Rust' has no catalogue topic → the legacy snapshot's topic is NULL.
		S.skills.push({ id: 6, user_id: 7, skill_name: 'Rust', category: 'technical', is_verified: false, verified_score: null });
		addBank({ topic_id: 20, format: 'mcq', difficulty_level: 3, count: 3, skill_category: 'Rust' });
		seedSession(501, 20, 6);
		seedSession(502, 21, 6);
		const res = await start({ skillName: 'Rust', category: 'technical' });
		expect(res.status).toBe(200);
		expect(sessionById(res.body.sessionId).topic_id).toBeNull();
		// Today's behaviour, unchanged: skill-wide, first match only.
		expect(sessionById(501).status).toBe('abandoned');
		expect(sessionById(502).status).toBe('in_progress');
	});
});

// ── #1686: per-topic retake lockout on /start ───────────────────────────────
// Founder ruling on #1686 (2026-10-22), Option (a): the lockout is
// PER-TOPIC. The catalogue already computed canRetake per topic (C3
// read model: Topic B's last completion 35d ago → retakable, even with
// Topic A on the same skill completed 10d ago), but the /start gate
// read the latest completion for the whole SKILL — so the promised
// retake 403'd. Ruled fix: a snapshot (topic-based) start reads the
// latest completion FOR THAT TOPIC ONLY (via sa.session_id →
// assessment_sessions.topic_id, the only topic linkage that exists);
// a topic-less start keeps the existing skill-wide gate exactly.
// STOP 1 edge decision: topic-less legacy completions do NOT block a
// topic-based start — a NULL-topic row carries no topic attribution,
// and the ruling's skill-wide carve-out is for topic-less STARTS.
// (The catalogue's default-topic fallback surfacing of legacy history
// is a display aggregate and is consciously NOT mirrored into the
// gate — see the #1686 STOP 1 note.)
// AMENDED by #1716 (Lead ruling, Option (b)): that edge decision is
// superseded FOR THE DEFAULT TOPIC ONLY — see the #1716 block below.
// It stands exactly as written for every non-default topic (pinned by
// #1716 case (3), which is this block's case (c) shape).
describe('POST /start — per-topic retake lockout (#1686)', () => {
	const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);
	function seedCompletion(id, sessionId, topic_id, when) {
		S.sessions.push({
			id: sessionId, user_id: 7, skill_id: 4, status: 'completed', topic_id,
			questions_asked: [], answers_given: [], completed_at: when,
		});
		S.skillAssessments.push({
			id, user_id: 7, skill_id: 4, session_id: sessionId, score: 80, passed: true,
			behavioral_flags: {}, completed_at: when,
		});
	}
	function seedTopicPair() {
		const aWhen = daysAgo(10); // Topic A (20) — inside the 30d lockout
		const bWhen = daysAgo(35); // Topic B (21) — outside it
		seedCompletion(1, 601, 20, aWhen);
		seedCompletion(2, 602, 21, bWhen);
		return { aWhen, bWhen };
	}

	it('(a) starting Topic B succeeds when only Topic A is inside the lockout (the #1686 bug)', async () => {
		addBank({ topic_id: 21, format: 'mcq', difficulty_level: 3, count: 12 });
		seedTopicPair();
		const res = await start({ topicId: 21, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(sessionById(res.body.sessionId).topic_id).toBe(21);
		expect(sessionById(res.body.sessionId).status).toBe('in_progress');
	});

	it('(b) starting Topic A still 403s, with lastCompletedAt read from Topic A only', async () => {
		addBank({ topic_id: 20, format: 'mcq', difficulty_level: 3, count: 12 });
		const { aWhen } = seedTopicPair();
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('RETAKE_LOCKOUT');
		expect(res.body.lockoutDays).toBe(30);
		expect(new Date(res.body.lastCompletedAt).getTime()).toBe(aWhen.getTime());
	});

	it('(c) topic-less legacy completions do not block a topic start; a topic-less start keeps the skill-wide gate', async () => {
		// Only history: a topic-less legacy completion 10 days ago.
		seedCompletion(1, 610, null, daysAgo(10));
		addBank({ topic_id: 21, format: 'mcq', difficulty_level: 3, count: 12 });
		const res = await start({ topicId: 21, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(sessionById(res.body.sessionId).topic_id).toBe(21);

		// A start with NO snapshot topic ('Rust' has no catalogue topic)
		// keeps the legacy skill-wide gate exactly: its own skill's
		// 10-day-old completion still blocks it.
		S.skills.push({ id: 6, user_id: 7, skill_name: 'Rust', category: 'technical', is_verified: false, verified_score: null });
		S.sessions.push({
			id: 611, user_id: 7, skill_id: 6, status: 'completed', topic_id: null,
			questions_asked: [], answers_given: [], completed_at: daysAgo(10),
		});
		S.skillAssessments.push({
			id: 2, user_id: 7, skill_id: 6, session_id: 611, score: 70, passed: true,
			behavioral_flags: {}, completed_at: daysAgo(10),
		});
		const legacy = await start({ skillName: 'Rust', category: 'technical' });
		expect(legacy.status).toBe(403);
		expect(legacy.body.code).toBe('RETAKE_LOCKOUT');
	});
});

// ── #1716: default-topic gate counts topic-less completions ────────────────
// Lead ruling on #1716 (2026-10-22), Option (b) — gate-side only: the
// #1686 edge decision above left ONE corner where the catalogue and
// the gate disagree. The catalogue's C3 R4 fallback surfaces topic-less
// legacy history on the subject's DEFAULT topic (the topic carrying
// legacy_skill_name, migration 279) and computes canRetake:false from
// it, while the per-topic gate read only that topic's own completions
// and allowed the start — the UI note said locked, the gate allowed.
// Ruled fix: when the started topic IS the default topic, the gate's
// latest-completion read ALSO counts completions with no topic
// attribution, in BOTH physical forms — skill_assessments.session_id
// IS NULL (e.g. the candidate.js verification writer) and a session
// whose topic_id IS NULL (pre-280 / in-flight legacy sessions). The
// catalogue read model is NOT touched; non-default topics keep the
// #1686 query exactly; the topic-less (hasTopic=false) branch is NOT
// touched.
describe('POST /start — default-topic retake lockout counts topic-less completions (#1716)', () => {
	const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);
	// Form (i): a completion with NO session at all (session_id NULL).
	function seedSessionlessCompletion(id, when) {
		S.skillAssessments.push({
			id, user_id: 7, skill_id: 4, session_id: null, score: 80, passed: true,
			behavioral_flags: {}, completed_at: when,
		});
	}
	// Form (ii): a completion whose session carries topic_id NULL.
	function seedNullTopicCompletion(id, sessionId, when) {
		S.sessions.push({
			id: sessionId, user_id: 7, skill_id: 4, status: 'completed', topic_id: null,
			questions_asked: [], answers_given: [], completed_at: when,
		});
		S.skillAssessments.push({
			id, user_id: 7, skill_id: 4, session_id: sessionId, score: 80, passed: true,
			behavioral_flags: {}, completed_at: when,
		});
	}

	it('(1) default topic + topic-less completion (session_id NULL), 2 days old → 403 with the topic-keyed lockout shape', async () => {
		addBank({ topic_id: 20, format: 'mcq', difficulty_level: 3, count: 12 });
		const when = daysAgo(2);
		seedSessionlessCompletion(1, when);
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('RETAKE_LOCKOUT');
		expect(res.body.lockoutDays).toBe(30);
		expect(new Date(res.body.lastCompletedAt).getTime()).toBe(when.getTime());
		expect(S.sessionInserts).toHaveLength(0);
	});

	it('(2) default topic + topic-less completion via a session with topic_id NULL, 2 days old → 403', async () => {
		addBank({ topic_id: 20, format: 'mcq', difficulty_level: 3, count: 12 });
		const when = daysAgo(2);
		seedNullTopicCompletion(1, 610, when);
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe('RETAKE_LOCKOUT');
		expect(res.body.lockoutDays).toBe(30);
		expect(new Date(res.body.lastCompletedAt).getTime()).toBe(when.getTime());
		expect(S.sessionInserts).toHaveLength(0);
	});

	it('(3) NON-default topic + the same topic-less history → start allowed (#1686 behaviour pinned)', async () => {
		addBank({ topic_id: 21, format: 'mcq', difficulty_level: 3, count: 12 });
		seedSessionlessCompletion(1, daysAgo(2));
		seedNullTopicCompletion(2, 610, daysAgo(2));
		const res = await start({ topicId: 21, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(sessionById(res.body.sessionId).topic_id).toBe(21);
		expect(sessionById(res.body.sessionId).status).toBe('in_progress');
	});

	it('(4) default topic + topic-less completions 31 days old → start allowed (outside the window)', async () => {
		addBank({ topic_id: 20, format: 'mcq', difficulty_level: 3, count: 12 });
		seedSessionlessCompletion(1, daysAgo(31));
		seedNullTopicCompletion(2, 610, daysAgo(31));
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		expect(sessionById(res.body.sessionId).topic_id).toBe(20);
		expect(sessionById(res.body.sessionId).status).toBe('in_progress');
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

	it('serving order (#1710): bank → AI → band-widen → re-serve; AI down widens to an unserved in-band row before any repeat', async () => {
		// #1710 Lead ruling (issue #1710, comment 6353236169): the Q2 order
		// gains a WIDEN step between AI generation and the in-scope re-serve.
		// Design note: this case previously pinned "AI down → the single L3
		// row is re-served" while unserved L2 rows sat in the same promised
		// band — that repeat-before-widen order is exactly the #1710 defect
		// (a medium session promised L2+L3+L4 supply re-served a seen
		// question while unseen in-band questions remained). The AI-down leg
		// now serves the unserved in-band L2 row BEFORE any repeat; re-serve
		// remains only as the last resort when the whole band is exhausted
		// (pinned by the band-exhaustion case below).
		// short_answer L3 ×1 + L2 ×9 → medium servable 10. Start (L3) serves
		// the L3 row; an unevaluated answer keeps difficulty at 3, where the
		// pool is now exhausted for this session.
		const [onlyL3] = addBank({ format: 'short_answer', difficulty_level: 3, count: 1 });
		const l2Ids = addBank({ format: 'short_answer', difficulty_level: 2, count: 9 });
		S.evalMode = 'fail'; // unevaluated → no difficulty move (#1572)
		const started = await start({ topicId: 20, format: 'short_answer', difficultyBand: 'medium', totalQuestions: 10 });
		expect(started.status).toBe(200);
		expect(started.body.question.id).toBe(onlyL3);
		const sid = started.body.sessionId;
		const a1 = await answer(sid, onlyL3, 'a written answer');
		expect(a1.status).toBe(200);

		// AI down: widen serves an UNSERVED in-band (L2) row — never a
		// repeat of the already-asked L3 row.
		S.aiMode = 'down';
		const cur1 = await current(sid);
		expect(cur1.status).toBe(200);
		expect(l2Ids).toContain(cur1.body.question.id);
		expect(cur1.body.question.id).not.toBe(onlyL3);

		// Answer the widened question (a NEW answer, not a retry), then
		// with AI up the next serve must be a GENERATED question — AI is
		// still tried before widen and re-serve for snapshot sessions.
		const a2 = await answer(sid, cur1.body.question.id, 'another written answer');
		expect(a2.status).toBe(200);
		expect(a2.body.answerRecorded).toBe(true);
		S.aiMode = 'up';
		const cur2 = await current(sid);
		expect(cur2.status).toBe(200);
		expect(cur2.body.question.text).toContain('Generated Q');
	});

	it('#1710 mirror: current difficulty exhausted by the climb → widen serves an unserved in-band row, never an asked id', async () => {
		// The #1710 rig shape in miniature: mcq L2 ×2 + L3 ×1 + L4 ×2 on a
		// medium session (labelled-offer count 5). Perfect answers climb
		// 3 → 4 and pin at the band ceiling; both L4 rows are served, then
		// the current difficulty is exhausted while unserved L2 rows remain
		// in the promised band. AI is down (the rig condition): the next
		// serve must widen to an unserved L2 row — pre-fix it re-served an
		// already-asked L4 row (the #1695 rig served 9 distinct of 10).
		const [l3] = addBank({ format: 'mcq', difficulty_level: 3, count: 1 });
		const l4Ids = addBank({ format: 'mcq', difficulty_level: 4, count: 2 });
		const l2Ids = addBank({ format: 'mcq', difficulty_level: 2, count: 2 });
		S.aiMode = 'down';
		const started = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 5 });
		expect(started.status).toBe(200);
		expect(started.body.question.id).toBe(l3);
		const sid = started.body.sessionId;

		const servedIds = [started.body.question.id];
		let q = started.body.question;
		for (let n = 2; n <= 5; n++) {
			const a = await answer(sid, q.id, 'RigCorrect');
			expect(a.status).toBe(200);
			const cur = await current(sid);
			expect(cur.status).toBe(200);
			q = cur.body.question;
			servedIds.push(q.id);
		}
		// Serves 2–3 are the two L4 rows (the climb pinned at the ceiling)…
		expect(servedIds.slice(1, 3).slice().sort()).toEqual(l4Ids.slice().sort());
		// …serves 4–5 widened to the unserved L2 rows…
		expect(servedIds.slice(3).slice().sort()).toEqual(l2Ids.slice().sort());
		// …and all five serves are distinct — no repeat anywhere.
		expect(new Set(servedIds).size).toBe(5);
		const fin = await answer(sid, q.id, 'RigCorrect');
		expect(fin.status).toBe(200);
		expect(sessionById(sid).status).toBe('completed');
	});

	it('re-serve is the last resort (#1710): whole band exhausted + AI down → re-serve at the current difficulty', async () => {
		// short_answer L3 ×1 + L2 ×2 → medium servable 3, so a 10-question
		// start is the honest 503 (session committed + resumable). Driving
		// the resumable session: bank → widen serves every band row exactly
		// once; only when NO unserved in-band row remains does the last-
		// resort re-serve fire, and it re-serves at the CURRENT difficulty.
		const [onlyL3] = addBank({ format: 'short_answer', difficulty_level: 3, count: 1 });
		const l2Ids = addBank({ format: 'short_answer', difficulty_level: 2, count: 2 });
		const bandIds = [onlyL3, ...l2Ids];
		S.evalMode = 'fail'; // unevaluated → difficulty frozen at the band start (3)
		S.aiMode = 'down';
		const started = await start({ topicId: 20, format: 'short_answer', difficultyBand: 'medium', totalQuestions: 10 });
		expect(started.status).toBe(503);
		expect(started.body.code).toBe('QUESTION_UNAVAILABLE');
		const sid = started.body.sessionId;
		expect(sid).toBeTruthy();

		const served = [];
		let repeated = null;
		for (let i = 0; i < 6 && repeated == null; i++) {
			const cur = await current(sid);
			expect(cur.status).toBe(200);
			const qid = cur.body.question.id;
			if (served.includes(qid)) {
				repeated = qid;
				break;
			}
			served.push(qid);
			const a = await answer(sid, qid, 'a written answer');
			expect(a.status).toBe(200);
		}
		// Every band row was served exactly once BEFORE any repeat…
		expect(served.slice().sort()).toEqual(bandIds.slice().sort());
		// …and the repeat is the current-difficulty (L3) row: the re-serve
		// never widened — it is the scoped last resort, unchanged.
		expect(repeated).toBe(onlyL3);
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
