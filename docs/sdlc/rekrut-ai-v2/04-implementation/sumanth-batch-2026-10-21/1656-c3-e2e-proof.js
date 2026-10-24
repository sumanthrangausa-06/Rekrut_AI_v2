/* HL-003 real-DB E2E proof for #1656 (C3) — NOT part of the commit.
 * Real HTTP (supertest) against the real routes/assessments.js mounted
 * on Express, backed by a FRESH local Postgres (migrations run clean
 * from empty via migrate.js). No mocks anywhere on the request path. */
process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:55434/rekrut_1656';
process.env.JWT_SECRET = 'e2e-1656-secret';
process.chdir('/home/hatch/workspace/wt-1656');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('/home/hatch/workspace/wt-1656/lib/db');
const { createAssessmentSet } = require('/home/hatch/workspace/wt-1656/scripts/create-assessment-set');
const router = require('/home/hatch/workspace/wt-1656/routes/assessments');

const PY_TOPIC = 2; // default topic, legacy_skill_name 'Python'
const JS_TOPIC = 1; // default topic, legacy_skill_name 'JavaScript'
let failures = 0;
function check(name, cond, extra = '') {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
	if (!cond) failures += 1;
}

async function seedQuestions(topicId, skillCategory, count, difficulty = 3) {
	const ids = [];
	for (let i = 0; i < count; i++) {
		const r = await pool.query(
			`INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds, topic_id, format, source, review_status)
       VALUES ($1, $2, 'multiple_choice', $3, '["RigCorrect","Wrong A","Wrong B","Wrong C"]', 'RigCorrect', 'expl', 90, $4, 'mcq', 'seed', 'approved') RETURNING id`,
			[skillCategory, difficulty, `${skillCategory} E2E Q${i + 1}`, topicId],
		);
		ids.push(r.rows[0].id);
	}
	return ids;
}

async function main() {
	const app = express();
	app.use(express.json());
	app.use('/api/assessments', router);

	const user = await pool.query(
		`INSERT INTO users (email, name, role) VALUES ('e2e1656@example.com', 'E2E Candidate', 'candidate') RETURNING id`,
	);
	const userId = user.rows[0].id;
	const token = jwt.sign({ id: userId, email: 'e2e1656@example.com', role: 'candidate' }, process.env.JWT_SECRET);
	const auth = (r) => r.set('Authorization', `Bearer ${token}`);

	// ── Sets: creation path + explicit setId serving in position order ──
	const pyQ = await seedQuestions(PY_TOPIC, 'Python', 6);
	const set = await createAssessmentSet(pool, {
		topicId: PY_TOPIC,
		name: 'E2E Python Set A',
		format: 'mcq',
		difficultyBand: 'medium',
		questionIds: [pyQ[2], pyQ[0], pyQ[1]],
	});
	check('createAssessmentSet returns counts', set.questionCount === 3 && set.approvedCount === 3, JSON.stringify(set));

	const start = await auth(request(app).post('/api/assessments/start')).send({
		topicId: PY_TOPIC, setId: set.setId, format: 'mcq', difficultyBand: 'medium', totalQuestions: 3,
	});
	check('explicit setId start 200', start.status === 200, `status=${start.status} body=${JSON.stringify(start.body).slice(0, 200)}`);
	check('first served is position 1 (not lowest id)', start.body.question?.id === pyQ[2], `got ${start.body.question?.id}, want ${pyQ[2]}`);
	const sid = start.body.sessionId;
	const sessRow = await pool.query('SELECT set_id, topic_id FROM assessment_sessions WHERE id = $1', [sid]);
	check('session snapshot records set_id', sessRow.rows[0].set_id === set.setId);

	const a1 = await auth(request(app).post('/api/assessments/answer')).send({ sessionId: sid, questionId: pyQ[2], answer: 'RigCorrect', timeTaken: 30 });
	check('answer 1 recorded', a1.status === 200 && a1.body.answerRecorded === true, JSON.stringify(a1.body).slice(0, 160));
	const c2 = await auth(request(app).get(`/api/assessments/session/${sid}/current`));
	check('second served is position 2', c2.body.question?.id === pyQ[0], `got ${c2.body.question?.id}`);
	await auth(request(app).post('/api/assessments/answer')).send({ sessionId: sid, questionId: pyQ[0], answer: 'RigCorrect', timeTaken: 30 });
	const c3 = await auth(request(app).get(`/api/assessments/session/${sid}/current`));
	check('third served is position 3', c3.body.question?.id === pyQ[1], `got ${c3.body.question?.id}`);
	const a3 = await auth(request(app).post('/api/assessments/answer')).send({ sessionId: sid, questionId: pyQ[1], answer: 'RigCorrect', timeTaken: 30 });
	check('set session completes at set end', a3.body.completed === true, JSON.stringify(a3.body).slice(0, 160));

	// ── Unknown setId: honest 400, no session ──
	const sessionsBefore = (await pool.query('SELECT COUNT(*)::int AS n FROM assessment_sessions')).rows[0].n;
	const bad = await auth(request(app).post('/api/assessments/start')).send({
		topicId: PY_TOPIC, setId: 999999, format: 'mcq', difficultyBand: 'medium', totalQuestions: 3,
	});
	check('unknown setId → 400 SETS_NOT_AVAILABLE', bad.status === 400 && bad.body.code === 'SETS_NOT_AVAILABLE', `status=${bad.status}`);
	const sessionsAfter = (await pool.query('SELECT COUNT(*)::int AS n FROM assessment_sessions')).rows[0].n;
	check('no session created for unknown setId', sessionsAfter === sessionsBefore);

	// ── Progress (§3.7) read back from the real completion ──
	const catalog = await auth(request(app).get('/api/assessments/catalog'));
	const py = catalog.body.subjects.find((s) => s.slug === 'python');
	const pyTopic = py.topics.find((t) => t.id === PY_TOPIC);
	check('catalog progress attempts=1', pyTopic.progress?.attempts === 1, JSON.stringify(pyTopic.progress));
	check('catalog progress bestScore=100 lastScore=100', pyTopic.progress?.bestScore === 100 && pyTopic.progress?.lastScore === 100);
	check('catalog progress canRetake=false (just completed)', pyTopic.progress?.canRetake === false);
	check('catalog progress lastAttempted set', !!pyTopic.progress?.lastAttempted);

	// ── Retake soft exclusion (pool mode, JavaScript topic: no sets) ──
	const jsQ = await seedQuestions(JS_TOPIC, 'JavaScript', 13);
	// A completed JS attempt 40 days ago that asked jsQ[0..2]; backdate
	// BOTH the session and its skill_assessments row so the retake gate
	// (30d, reads skill_assessments) is open.
	const skill = await pool.query(
		`INSERT INTO candidate_skills (user_id, skill_name, category, level) VALUES ($1, 'JavaScript', 'technical', 1) RETURNING id`,
		[userId],
	);
	const prev = await pool.query(
		`INSERT INTO assessment_sessions (user_id, skill_id, status, current_difficulty, current_question_index, score, max_difficulty_reached, tab_switches, copy_paste_attempts, time_anomalies, questions_asked, answers_given, started_at, completed_at, subject_id, topic_id, format, difficulty_band, total_questions)
     VALUES ($1, $2, 'completed', 3, 3, 90, 3, 0, 0, 0, $3, $4, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days', 1, $5, 'mcq', 'medium', 10) RETURNING id`,
		[userId, skill.rows[0].id, JSON.stringify(jsQ.slice(0, 3).map((id) => ({ questionId: id, difficulty: 3 }))), JSON.stringify(jsQ.slice(0, 3).map((id) => ({ questionId: id }))), JS_TOPIC],
	);
	await pool.query(
		`INSERT INTO skill_assessments (user_id, skill_id, session_id, assessment_type, title, score, max_score, passed, anti_cheat_score, behavioral_flags, duration_seconds, started_at, completed_at)
     VALUES ($1, $2, $3, 'dynamic', 'JavaScript Assessment', 90, 100, true, 100, '{}', 300, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days')`,
		[userId, skill.rows[0].id, prev.rows[0].id],
	);
	const retake = await auth(request(app).post('/api/assessments/start')).send({
		topicId: JS_TOPIC, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10,
	});
	check('retake start 200 (gate open: last completion 40d ago)', retake.status === 200, `status=${retake.status} body=${JSON.stringify(retake.body).slice(0, 200)}`);
	check(
		'retake serves a question the previous attempt did NOT ask',
		retake.body.question && !jsQ.slice(0, 3).includes(retake.body.question.id) && jsQ.slice(3).includes(retake.body.question.id),
		`served ${retake.body.question?.id}, previous asked ${jsQ.slice(0, 3).join(',')}`,
	);
	const retakeSess = await pool.query('SELECT set_id FROM assessment_sessions WHERE id = $1', [retake.body.sessionId]);
	check('pool-mode retake has set_id NULL (no sets exist for JS)', retakeSess.rows[0].set_id === null);

	// ── Auto-pick: Python start with no setId picks the existing set ──
	await pool.query(`UPDATE skill_assessments SET completed_at = NOW() - INTERVAL '40 days' WHERE user_id = $1`, [userId]);
	await pool.query(`UPDATE assessment_sessions SET completed_at = NOW() - INTERVAL '40 days' WHERE id = $1`, [sid]);
	const auto = await auth(request(app).post('/api/assessments/start')).send({
		topicId: PY_TOPIC, format: 'mcq', difficultyBand: 'medium', totalQuestions: 3,
	});
	check('auto-pick start 200', auto.status === 200, `status=${auto.status} body=${JSON.stringify(auto.body).slice(0, 200)}`);
	const autoSess = await pool.query('SELECT set_id FROM assessment_sessions WHERE id = $1', [auto.body.sessionId]);
	check('auto-pick recorded the only compatible set', autoSess.rows[0].set_id === set.setId, `set_id=${autoSess.rows[0].set_id}, want ${set.setId}`);
	check('auto-pick serves set position 1', auto.body.question?.id === pyQ[2], `got ${auto.body.question?.id}`);

	console.log(failures === 0 ? '\nE2E RESULT: ALL CHECKS PASSED' : `\nE2E RESULT: ${failures} CHECK(S) FAILED`);
	await pool.end();
	process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
	console.error('E2E crashed:', e);
	await pool.end().catch(() => {});
	process.exit(2);
});
