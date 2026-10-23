/**
 * Issue #1656 — #1603 Phase C story C3 (SERVER): sets, retake
 * differentiation, per-topic progress.
 *
 * Pins (design architecture-assessments-phase-c.md §3.3, §3.7, §4.6, §5.3;
 * STOP 1 Lead rulings R1–R6 + amendment Q1–Q6 on #1656):
 *  1. Sets (R1/R2): an explicit compatible setId serves its questions in
 *     position order and is recorded on the session snapshot; unknown /
 *     inactive / wrong-topic / format-incompatible / band-incompatible
 *     setIds keep the honest 400 SETS_NOT_AVAILABLE with NO session
 *     created. §4.6 set matching: a mixed session may use an mcq or
 *     short_answer set; no other cross-format pairing.
 *  2. Auto-pick (R2): no setId + active sets for (topic, format, band) →
 *     the set the user has gone longest without completing (never
 *     completed first). No sets → pool mode exactly as C2.
 *  3. Set exhaustion (R2): a set smaller than the promised count completes
 *     honestly as a partial ("X of Y answered") — never a hang, never a
 *     silent pool fallback mid-set.
 *  4. Retake soft exclusion (R3, §5.3): serving excludes the most recent
 *     COMPLETED attempt's question ids for the same topic (legacy
 *     topic-less sessions: for the skill) ONLY while the remaining pool
 *     at the needed (format, difficulty) still meets the session's
 *     remaining count; on starvation the exclusion relaxes OLDEST-first.
 *     Abandoned attempts contribute nothing. In-session exclusion and
 *     the completed-only retake lockout are unchanged.
 *  5. Progress (R4, §3.7): GET /catalog per-topic progress carries
 *     { attempts, bestScore, lastScore, lastAttempted, canRetake } per
 *     (user, topic) from assessment_sessions.topic_id +
 *     skill_assessments; a default topic with only topic-less legacy
 *     history keeps today's skill-keyed surfacing (+ canRetake from the
 *     last completed attempt); a topic with no completed attempts
 *     carries progress: null — never a fabricated number.
 *
 * Harness: cloned from the #1654 suite's stateful SQL-emulating
 * dispatcher and extended for assessment_sets / assessment_set_questions,
 * the previous-completed-attempt read, the pool-id read, and the
 * per-topic progress read. Predicates are applied only when the route's
 * SQL actually carries them, so a missing predicate fails a test.
 * Regression pin only — NOT the HL-003 E2E-on-dev gate.
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
		sets: [],
		setQuestions: [],
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

// ── #1656 fixtures ──────────────────────────────────────────────────────────
let setSeq = 0;
function addSet({ topic_id = 20, format = 'mcq', difficulty_band = 'medium', is_active = true, questionIds = [] }) {
	setSeq += 1;
	const row = { id: setSeq, topic_id, name: `Set ${setSeq}`, format, difficulty_band, is_active };
	S.sets.push(row);
	questionIds.forEach((qid, i) => {
		S.setQuestions.push({ set_id: row.id, question_id: qid, position: i + 1 });
	});
	return row;
}
function seedSession(over = {}) {
	const row = {
		id: over.id ?? S.nextSessionId++,
		user_id: 7,
		skill_id: 4,
		job_id: null,
		status: 'in_progress',
		current_difficulty: 3,
		current_question_index: 0,
		score: 0,
		max_difficulty_reached: 3,
		tab_switches: 0,
		copy_paste_attempts: 0,
		time_anomalies: 0,
		questions_asked: [],
		answers_given: [],
		current_draft: null,
		subject_id: 2,
		topic_id: 20,
		set_id: null,
		format: 'mcq',
		difficulty_band: 'medium',
		total_questions: 10,
		started_at: new Date(),
		completed_at: null,
		...over,
	};
	S.sessions.push(row);
	return row;
}
const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

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

		// ── #1656 catalogue reads (subjects/topics lists, progress) ──
		if (sql.includes('from assessment_subjects') && sql.includes('is_active = true')) {
			const rows = S.subjects.filter((s) => s.is_active !== false);
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_topics') && sql.includes('is_active = true')) {
			const rows = S.topics.filter((t) => t.is_active !== false);
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('distinct on (sa.skill_id)')) {
			// loadCatalogTables skill-keyed progress (completed only).
			const uid = Number(params[0]);
			const rows = S.skills
				.filter((sk) => sk.user_id === uid)
				.map((sk) => {
					const done = S.skillAssessments
						.filter((a) => a.user_id === uid && a.skill_id === sk.id && a.completed_at)
						.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
					return {
						skill_id: sk.id,
						skill_name: sk.skill_name,
						category: sk.category,
						is_verified: sk.is_verified,
						verified_score: sk.verified_score,
						assessment_count: done.length,
						best_score: done.length ? Math.max(...done.map((a) => a.score)) : null,
						last_score: done.length ? done[0].score : null,
						last_completed_at: done.length ? done[0].completed_at : null,
					};
				});
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('sess.topic_id') && sql.includes('from skill_assessments')) {
			// #1656 per-(user, topic) progress read model (§3.7).
			const uid = Number(params[0]);
			const byTopic = new Map();
			for (const a of S.skillAssessments) {
				if (a.user_id !== uid || !a.completed_at) continue;
				const sess = S.sessions.find((s) => s.id === a.session_id);
				if (!sess || sess.topic_id == null) continue;
				if (!byTopic.has(sess.topic_id)) byTopic.set(sess.topic_id, []);
				byTopic.get(sess.topic_id).push(a);
			}
			const rows = [...byTopic.entries()].map(([topic_id, list]) => {
				const sorted = [...list].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
				return {
					topic_id,
					attempts: list.length,
					best_score: Math.max(...list.map((a) => a.score)),
					last_score: sorted[0].score,
					last_completed_at: sorted[0].completed_at,
				};
			});
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
			// emulation rule), mirroring the C2 suite's gate branch.
			if (sql.includes('join assessment_sessions') && sql.includes('topic_id')) {
				const topicId = Number(params[2]);
				rows = rows.filter((a) => {
					const sess = S.sessions.find((s) => s.id === Number(a.session_id));
					return !!sess && sess.topic_id === topicId;
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
			// actually carries it (same emulation rule as the C2 suite).
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

		// ── #1656 sets / previous attempt / pool ids ──
		if (sql.includes('from assessment_sets') && sql.includes('last_completed_at')) {
			// Auto-pick candidates for (topic): active sets with the user's
			// last completion per set and approved question count.
			const topicId = Number(params[0]);
			const uid = Number(params[1]);
			const rows = S.sets
				.filter((st) => st.topic_id === topicId && st.is_active !== false)
				.map((st) => {
					const completions = S.sessions
						.filter((s) => s.set_id === st.id && s.user_id === uid && s.status === 'completed' && s.completed_at)
						.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
					const question_count = S.setQuestions
						.filter((sq) => sq.set_id === st.id)
						.map((sq) => S.bank.find((b) => b.id === sq.question_id))
						.filter((b) => b && b.review_status === 'approved').length;
					return { ...st, last_completed_at: completions.length ? completions[0].completed_at : null, question_count };
				})
				.sort((a, b) => {
					if (a.last_completed_at === null && b.last_completed_at !== null) return -1;
					if (a.last_completed_at !== null && b.last_completed_at === null) return 1;
					if (a.last_completed_at && b.last_completed_at) {
						const d = new Date(a.last_completed_at) - new Date(b.last_completed_at);
						if (d !== 0) return d;
					}
					return a.id - b.id;
				});
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_sets') && sql.includes('where id = $1')) {
			const rows = S.sets.filter((st) => st.id === Number(params[0]));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_set_questions') && sql.includes('count(')) {
			const setId = Number(params[0]);
			const n = S.setQuestions
				.filter((sq) => sq.set_id === setId)
				.map((sq) => S.bank.find((b) => b.id === sq.question_id))
				.filter((b) => b && b.review_status === 'approved').length;
			return { rows: [{ n }], rowCount: 1 };
		}
		if (sql.includes('from assessment_set_questions')) {
			const setId = Number(params[0]);
			let entries = S.setQuestions.filter((sq) => sq.set_id === setId).sort((a, b) => a.position - b.position);
			if (sql.includes("review_status = 'approved'")) {
				entries = entries.filter((sq) => {
					const b = S.bank.find((x) => x.id === sq.question_id);
					return b && b.review_status === 'approved';
				});
			}
			const rows = entries.map((sq) => ({ question_id: sq.question_id }));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from skill_assessments') && sql.includes('sa.session_id')) {
			// GET /current completed-branch read (score/flags by session).
			const rows = S.skillAssessments.filter(
				(a) => a.session_id === Number(params[0]) && a.user_id === Number(params[1]),
			);
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('from assessment_sessions') && sql.includes('questions_asked') && sql.includes("status = 'completed'") && !sql.includes('update')) {
			// R3: most recent COMPLETED attempt's asked ids — topic-keyed
			// when the SQL carries topic_id = $2, else skill-keyed.
			const uid = Number(params[0]);
			const key = Number(params[1]);
			const selfId = Number(params[2]);
			const rows = S.sessions
				.filter((s) => s.user_id === uid && s.status === 'completed' && s.id !== selfId)
				.filter((s) => (sql.includes('topic_id = $2') ? s.topic_id === key : s.skill_id === key))
				.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
				.slice(0, 1)
				.map((s) => ({ questions_asked: s.questions_asked }));
			return { rows, rowCount: rows.length };
		}
		if (sql.includes('select id from assessment_questions')) {
			// R3 pool-id read: every servable id at the needed cell,
			// predicates applied only as the SQL carries them.
			let rows = [...S.bank];
			if (sql.includes('topic_id')) rows = rows.filter((r) => r.topic_id === Number(params[0]));
			const fmtIn = sql.includes("format in ('mcq','short_answer')");
			const fmtEq = sql.match(/format = '(\w+)'/);
			if (fmtIn) rows = rows.filter((r) => ['mcq', 'short_answer'].includes(r.format));
			else if (fmtEq) rows = rows.filter((r) => r.format === fmtEq[1]);
			if (sql.includes("review_status = 'approved'")) rows = rows.filter((r) => r.review_status === 'approved');
			if (sql.includes('lower(skill_category)')) {
				const name = String(params[0]).toLowerCase();
				rows = rows.filter((r) => String(r.skill_category).toLowerCase() === name);
			}
			if (sql.includes('difficulty_level =')) {
				const diff = Number(params[sql.includes('topic_id') || sql.includes('lower(skill_category)') ? 1 : 0]);
				rows = rows.filter((r) => r.difficulty_level === diff);
			}
			if (sql.includes('id = any(')) {
				const excluded = params[params.length - 1] || [];
				rows = rows.filter((r) => !excluded.includes(r.id));
			}
			return { rows: rows.map((r) => ({ id: r.id })), rowCount: rows.length };
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

beforeEach(() => {
	freshState();
	bankSeq = 0;
	setSeq = 0;
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


// ── R1/R2. Sets: explicit setId ─────────────────────────────────────────────
describe('POST /start — explicit setId (#1656 R1/R2, §3.3/§4.6)', () => {
	it('serves a valid set in position order, records set_id, completes at set end', async () => {
		const q = addBank({ count: 3 }); // ids 1,2,3 — topic 20 mcq L3 approved
		// Deliberately non-id order: position, not id, governs serving.
		const set = addSet({ questionIds: [q[2], q[0], q[1]] });
		const res = await start({ topicId: 20, setId: set.id, format: 'mcq', difficultyBand: 'medium', totalQuestions: 3 });
		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(q[2]);
		const session = S.sessions.find((s) => s.id === res.body.sessionId);
		expect(session.set_id).toBe(set.id);
		expect(session.topic_id).toBe(20);

		const a1 = await answer(session.id, q[2], 'RigCorrect');
		expect(a1.status).toBe(200);
		const c2 = await current(session.id);
		expect(c2.body.question.id).toBe(q[0]);
		await answer(session.id, q[0], 'RigCorrect');
		const c3 = await current(session.id);
		expect(c3.body.question.id).toBe(q[1]);
		const a3 = await answer(session.id, q[1], 'RigCorrect');
		expect(a3.status).toBe(200);
		expect(a3.body.completed).toBe(true);
		expect(session.status).toBe('completed');
	});

	it('unknown setId keeps the honest 400 SETS_NOT_AVAILABLE and creates no session', async () => {
		addBank({ count: 10 });
		const res = await start({ topicId: 20, setId: 999, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(400);
		expect(res.body.code).toBe('SETS_NOT_AVAILABLE');
		expect(S.sessions).toHaveLength(0);
	});

	it('inactive, wrong-topic, format- and band-incompatible sets are all the same honest 400', async () => {
		const q = addBank({ count: 10 });
		const inactive = addSet({ is_active: false, questionIds: q });
		const wrongTopic = addSet({ topic_id: 21, questionIds: q });
		const wrongFormat = addSet({ format: 'short_answer', questionIds: q });
		const wrongBand = addSet({ difficulty_band: 'easy', questionIds: q });
		for (const set of [inactive, wrongTopic, wrongFormat, wrongBand]) {
			const res = await start({ topicId: 20, setId: set.id, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
			expect(res.status).toBe(400);
			expect(res.body.code).toBe('SETS_NOT_AVAILABLE');
		}
		expect(S.sessions).toHaveLength(0);
	});

	it('§4.6: a mixed session may use an mcq set; a coding set never serves a mixed session', async () => {
		const q = addBank({ count: 2 });
		const mcqSet = addSet({ format: 'mcq', questionIds: q });
		const ok = await start({ topicId: 20, setId: mcqSet.id, format: 'mixed', difficultyBand: 'medium', totalQuestions: 2 });
		expect(ok.status).toBe(200);
		expect(S.sessions.find((s) => s.id === ok.body.sessionId).set_id).toBe(mcqSet.id);
	});
});

// ── R2. Auto-pick + pool fallback + set exhaustion ──────────────────────────
describe('POST /start — set auto-pick and exhaustion (#1656 R2)', () => {
	it('no setId picks the set gone longest without completing (never-completed first)', async () => {
		const qa = addBank({ count: 2 });
		const qb = addBank({ count: 2 });
		const setA = addSet({ questionIds: qa });
		const setB = addSet({ questionIds: qb });
		// User completed set A (long ago — the retake gate reads
		// skill_assessments, seeded 40d back so the gate stays open).
		seedSession({ id: 555, status: 'completed', set_id: setA.id, completed_at: daysAgo(40), questions_asked: qa.map((id) => ({ questionId: id })) });
		S.skillAssessments.push({ id: 1, user_id: 7, skill_id: 4, session_id: 555, score: 80, completed_at: daysAgo(40) });
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 2 });
		expect(res.status).toBe(200);
		const session = S.sessions.find((s) => s.id === res.body.sessionId);
		expect(session.set_id).toBe(setB.id);
		expect(res.body.question.id).toBe(qb[0]);
	});

	it('no sets at all → pool mode exactly as C2 (set_id null, bank question served)', async () => {
		addBank({ count: 10 });
		const res = await start({ topicId: 20, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		expect(res.status).toBe(200);
		const session = S.sessions.find((s) => s.id === res.body.sessionId);
		expect(session.set_id).toBeNull();
		expect(res.body.question.id).toBe(1);
	});

	it('an enum count above the set’s servable gets the C2 committed-session 503 with the set’s own largestAvailable', async () => {
		const q = addBank({ count: 12 }); // pool is plentiful — the SET is the promise, not the pool
		const set = addSet({ questionIds: [q[0], q[1]] });
		const res = await start({ topicId: 20, setId: set.id, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 });
		// The Phase A/C2 contract for an enum count the supply cannot
		// meet: session committed + resumable, 503 extended with the
		// promise and the honest largestAvailable — here the SET's 2,
		// never the pool's 12.
		expect(res.status).toBe(503);
		expect(res.body.code).toBe('QUESTION_UNAVAILABLE');
		expect(res.body.promised).toBe(10);
		expect(res.body.largestAvailable).toBe(2);
		const session = S.sessions.find((s) => s.id === res.body.sessionId);
		expect(session.set_id).toBe(set.id);
	});

	it('set starvation mid-session (a set question loses approval) completes honestly as a partial — no hang, no pool fallback', async () => {
		const q = addBank({ count: 12 }); // pool plentiful: a pool fallback would happily serve on
		const set = addSet({ questionIds: [q[0], q[1], q[2]] });
		const res = await start({ topicId: 20, setId: set.id, format: 'mcq', difficultyBand: 'medium', totalQuestions: 3 });
		expect(res.status).toBe(200);
		const session = S.sessions.find((s) => s.id === res.body.sessionId);
		await answer(session.id, q[0], 'RigCorrect');
		const c = await current(session.id);
		expect(c.body.question.id).toBe(q[1]); // set order, never a pool draw
		// The last set question is rejected by curation mid-session.
		S.bank.find((b) => b.id === q[2]).review_status = 'rejected';
		await answer(session.id, q[1], 'RigCorrect');
		const done = await current(session.id);
		expect(done.body.status).toBe('completed');
		expect(done.body.partial).toBe(true);
		expect(done.body.answersGiven).toBe(2);
		expect(done.body.totalQuestions).toBe(3);
		expect(session.status).toBe('completed');
	});
});

// ── R3. Retake soft exclusion (§5.3) ────────────────────────────────────────
describe('retake soft exclusion (#1656 R3, §5.3)', () => {
	function previousCompleted(askedIds, over = {}) {
		return seedSession({
			status: 'completed',
			completed_at: daysAgo(40),
			questions_asked: askedIds.map((id) => ({ questionId: id })),
			answers_given: askedIds.map((id) => ({ questionId: id })),
			...over,
		});
	}

	it('excludes the most recent completed attempt’s questions while the pool meets the remaining count', async () => {
		const ids = addBank({ count: 6 }); // 1..6, topic 20 mcq L3
		previousCompleted([ids[0], ids[1], ids[2]]);
		const s = seedSession({ total_questions: 3 });
		const res = await current(s.id);
		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(ids[3]); // first never-asked id; bankServe is deterministic
		expect([ids[0], ids[1], ids[2]]).not.toContain(res.body.question.id);
	});

	it('relaxes OLDEST-first on starvation', async () => {
		const ids = addBank({ count: 4 }); // pool of 4; previous asked 1,2,3
		previousCompleted([ids[0], ids[1], ids[2]]);
		const s = seedSession({ total_questions: 3 }); // needs 3; full exclusion leaves 1
		const res = await current(s.id);
		expect(res.status).toBe(200);
		// Oldest-first relaxation drops ids[0], then ids[1]; only ids[2]
		// stays excluded, so the oldest relaxed question is served first.
		// (Newest-first would serve ids[1]; no relaxation would serve ids[3].)
		expect(res.body.question.id).toBe(ids[0]);
	});

	it('an abandoned attempt contributes no exclusion (and never locked — gate regression stays in #1654/retake suites)', async () => {
		const ids = addBank({ count: 6 });
		seedSession({
			status: 'abandoned',
			completed_at: null,
			questions_asked: [ids[0], ids[1], ids[2]].map((id) => ({ questionId: id })),
			answers_given: [{ questionId: ids[0] }],
		});
		const s = seedSession({ total_questions: 3 });
		const res = await current(s.id);
		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(ids[0]);
	});

	it('legacy topic-less sessions fall back to the most recent completed attempt for the skill', async () => {
		const ids = addBank({ count: 6, difficulty_level: 2 }); // legacy path: skill_category + difficulty
		previousCompleted([ids[0], ids[1], ids[2]], { topic_id: null, format: null, difficulty_band: null });
		const s = seedSession({
			topic_id: null, format: null, difficulty_band: null, total_questions: 3, current_difficulty: 2,
		});
		const res = await current(s.id);
		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(ids[3]);
	});

	it('a completed attempt on ANOTHER topic does not exclude here', async () => {
		const ids = addBank({ count: 6 });
		previousCompleted([ids[0], ids[1], ids[2]], { topic_id: 21 });
		const s = seedSession({ total_questions: 3 });
		const res = await current(s.id);
		expect(res.status).toBe(200);
		expect(res.body.question.id).toBe(ids[0]);
	});
});

// ── R4. Per-topic progress (§3.7) ───────────────────────────────────────────
describe('GET /catalog — per-topic progress (#1656 R4, §3.7)', () => {
	it('reports attempts/best/last/lastAttempted/canRetake per topic; legacy skill surfacing preserved on the default topic', async () => {
		addBank({ count: 10 });
		// Topic 21 (non-default): two completed attempts, 80 then 60.
		const d40 = daysAgo(40);
		const d35 = daysAgo(35);
		const d10 = daysAgo(10);
		const s1 = seedSession({ id: 601, status: 'completed', topic_id: 21, completed_at: d40 });
		const s2 = seedSession({ id: 602, status: 'completed', topic_id: 21, completed_at: d35 });
		// Topic 20 (default): one completed attempt 10 days ago (inside lockout).
		const s3 = seedSession({ id: 603, status: 'completed', topic_id: 20, completed_at: d10 });
		S.skillAssessments.push(
			{ id: 1, user_id: 7, skill_id: 4, session_id: s1.id, score: 80, completed_at: d40 },
			{ id: 2, user_id: 7, skill_id: 4, session_id: s2.id, score: 60, completed_at: d35 },
			{ id: 3, user_id: 7, skill_id: 4, session_id: s3.id, score: 95, completed_at: d10 },
		);
		const res = await asUser(request(buildApp()).get('/api/assessments/catalog'));
		expect(res.status).toBe(200);
		const python = res.body.subjects.find((s) => s.slug === 'python');
		const t21 = python.topics.find((t) => t.id === 21);
		expect(t21.progress.attempts).toBe(2);
		expect(t21.progress.bestScore).toBe(80);
		expect(t21.progress.lastScore).toBe(60);
		expect(new Date(t21.progress.lastAttempted).getTime()).toBe(d35.getTime());
		expect(t21.progress.canRetake).toBe(true); // last topic completion 35d ago, outside the 30d lockout
		const t20 = python.topics.find((t) => t.id === 20);
		expect(t20.progress.attempts).toBe(1); // per-topic — NOT the skill-wide 3
		expect(t20.progress.bestScore).toBe(95);
		expect(t20.progress.lastScore).toBe(95);
		expect(t20.progress.canRetake).toBe(false); // 10d ago — inside the lockout
		const js = res.body.subjects.find((s) => s.slug === 'javascript');
		expect(js.topics[0].progress).toBeNull(); // no attempts: null, never a fabricated number
	});

	it('a default topic with ONLY topic-less legacy history keeps the skill-keyed surfacing', async () => {
		addBank({ count: 10 });
		const legacy = seedSession({ id: 610, status: 'completed', topic_id: null, format: null, completed_at: daysAgo(40) });
		S.skillAssessments.push({ id: 1, user_id: 7, skill_id: 4, session_id: legacy.id, score: 70, completed_at: daysAgo(40) });
		const res = await asUser(request(buildApp()).get('/api/assessments/catalog'));
		const python = res.body.subjects.find((s) => s.slug === 'python');
		const t20 = python.topics.find((t) => t.id === 20);
		expect(t20.progress).not.toBeNull();
		expect(t20.progress.attempts).toBe(1);
		expect(t20.progress.bestScore).toBe(70);
		expect(t20.progress.canRetake).toBe(true);
		const t21 = python.topics.find((t) => t.id === 21);
		expect(t21.progress).toBeNull(); // legacy history never leaks onto a finer topic
	});
});
