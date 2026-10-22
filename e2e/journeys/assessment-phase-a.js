/* Quinn + Candidate Experience — USER-JOURNEY acceptance suite: ASSESSMENTS PHASE A
 * Issues #1602 (submission hangs / answer loss), #1606 (assessments not opening),
 * #1612 (passing-leg completion deadlock). PRD: prd-assessments-module.md §10 JT-A1–A4 (+A5 start leg).
 *
 * Written from the candidate's expectations:
 *  - Next/Finish always resolves: advance, complete, or stay-with-answer + plain reason + retry.
 *  - A recorded answer is NEVER lost because the NEXT question could not be produced.
 *  - Timer expiry submits current input (or '(no answer)') and its outcome is never a bare error.
 *  - Finish happens exactly once, however many times it is pressed.
 *  - A passing candidate actually finishes: results + graded audit record exist.
 *  - An assessment that cannot produce questions says so honestly at start and stays resumable.
 *
 * Real HTTP against a fresh-install dev build (DB built ONLY by `node migrate.js`),
 * resulting state read back from the DB. The rig runs with the AI provider FORCED
 * to fail (no provider keys in the server env) — the exact condition under which
 * #1602/#1606 hurt real candidates — while the question bank is rig-seeded so
 * bank-served steps are deterministic. Provider failure is a server config, NOT
 * a mocked fetch layer.
 *
 * Usage:
 *   JT_BASE=http://127.0.0.1:3212 JT_DB=postgresql://postgres@127.0.0.1:55461/phasea \
 *   JT_OUT=./phase-a-evidence.json node assessment-phase-a.js
 * Exit code: 1 if any step FAILs, else 0.
 */
const fs = require('fs');
const { Client } = require('pg');

const BASE = process.env.JT_BASE || 'http://127.0.0.1:3212';
const DBURL = process.env.JT_DB;
const OUT = process.env.JT_OUT || 'phase-a-evidence.json';
const RUN = Date.now().toString(36);
const TIMEOUT_MS = 30000;

const steps = [];
function rec(step, verdict, evidence) {
	steps.push({ step, verdict, ...evidence });
	console.log(`[${verdict}] ${step} :: ${JSON.stringify(evidence).slice(0, 800)}`);
}

async function http(method, path, body, token, timeoutMs = TIMEOUT_MS) {
	const ctl = new AbortController();
	const t = setTimeout(() => ctl.abort(), timeoutMs);
	const started = Date.now();
	try {
		const r = await fetch(BASE + path, {
			method,
			headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: body ? JSON.stringify(body) : undefined,
			signal: ctl.signal,
		});
		const text = await r.text();
		let json;
		try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
		return { status: r.status, json, ms: Date.now() - started };
	} catch (e) {
		return { status: 0, json: { error: e.name === 'AbortError' ? 'CLIENT_TIMEOUT_HANG' : e.message }, ms: Date.now() - started, hang: e.name === 'AbortError' };
	} finally { clearTimeout(t); }
}

let db;
async function registerCandidate(tag) {
	// The auth rate limiter is strict (a real user who hits it waits and
	// retries — the baseline suites do the same). Honour its retryAfter.
	for (let attempt = 0; attempt < 8; attempt++) {
		const r = await http('POST', '/api/auth/register', { email: `jt${tag}${RUN}@example.com`, password: 'JourneyTest2026', name: `JT ${tag}`, role: 'candidate' });
		if (r.status !== 429) return { token: r.json.token || r.json.accessToken, id: r.json.user?.id, status: r.status };
		const waitS = Math.min((r.json.retryAfter || 60) + 5, 240);
		console.log(`register ${tag}: 429, waiting ${waitS}s (attempt ${attempt + 1})`);
		await new Promise((res) => setTimeout(res, waitS * 1000));
	}
	throw new Error(`register ${tag}: rate limited after retries`);
}
async function correctAnswer(qid) {
	const q = await db.query('SELECT question_type, correct_answer FROM assessment_questions WHERE id=$1', [qid]);
	return q.rows[0].question_type === 'multiple_choice' ? q.rows[0].correct_answer : 'A thorough answer covering the concept with a concrete example.';
}
async function sessionRow(sid) {
	const s = await db.query('SELECT status, score, current_question_index, jsonb_array_length(answers_given) AS na, jsonb_array_length(questions_asked) AS nq FROM assessment_sessions WHERE id=$1', [sid]);
	return s.rows[0];
}
/* The runner's flow after the Phase A decoupling: POST the answer, then GET
 * /session/:id/current to see the next question (the same request a refresh or
 * a retry makes). On pre-fix code /answer returns nextQuestion inline and
 * /current re-serves it — this helper accepts either shape. */
async function answerAndAdvance(token, sid, qid, answer) {
	const post = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: qid, answer, timeTaken: 30 }, token);
	if (post.hang || post.json.completed) return { post, next: null, current: null };
	if (post.json.nextQuestion) return { post, next: post.json.nextQuestion, current: null };
	const current = await http('GET', `/api/assessments/session/${sid}/current`, null, token);
	return { post, next: current.json.question || null, current };
}

(async () => {
	db = new Client({ connectionString: DBURL });
	await db.connect();

	// ---------- RIG SETUP: deterministic bank supply (rig data, not product seed) ----------
	// JavaScript: full coverage d1..d5. Python: d3 only beyond the seeded d2 (so a
	// correct-correct path reaches an UNCOVERED d4 cell where generation must fail).
	await db.query(`DELETE FROM assessment_questions WHERE skill_category IN ('JavaScript','Python') AND question_text LIKE 'RigQ %'`);
	for (const [skill, diffs] of [['JavaScript', [1, 2, 3, 4, 5]], ['Python', [3]]]) {
		for (const d of diffs) {
			for (let i = 1; i <= 4; i++) {
				await db.query(
					`INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
					 VALUES ($1,$2,'multiple_choice',$3,$4,'RigCorrect','Rig explanation',90)`,
					[skill, d, `RigQ ${skill} d${d} #${i}: pick the correct option`, JSON.stringify(['RigCorrect', 'Wrong A', 'Wrong B', 'Wrong C'])],
				);
			}
		}
	}

	// One shared candidate for the non-completing legs (A1/A3/A4/A5 use
	// different skills or never finish, so no retake lockout interferes);
	// each completing leg gets its own candidate. Keeps registrations
	// inside the auth rate limiter's budget.
	const shared = await registerCandidate('shared');

	// ---------- JT-A1: Next advances; resume shows the session at question 2 ----------
	try {
		const c = shared;
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		const a1 = await correctAnswer(start.json.question.id);
		const adv = await answerAndAdvance(c.token, sid, start.json.question.id, a1);
		const row = await sessionRow(sid);
		const qnumFromAnswer = adv.post.json.nextQuestion?.questionNumber;
		const qnumFromCurrent = adv.next?.questionNumber;
		const ok = adv.post.status === 200 && !!adv.next && row.na === 1 && (qnumFromCurrent === 2) && (qnumFromAnswer === undefined || qnumFromAnswer === 2);
		rec('JT-A1_next_advances_and_resume_at_question_2', ok ? 'PASS' : 'FAIL', { startStatus: start.status, answerStatus: adv.post.status, answersInDb: row.na, qnumFromAnswer, qnumFromCurrent, error: adv.post.json.error || adv.current?.json.error });
	} catch (e) { rec('JT-A1_next_advances_and_resume_at_question_2', 'FAIL', { error: e.message }); }

	// ---------- JT-A4: next-question generation failure NEVER loses a recorded answer ----------
	try {
		const c = shared;
		const start = await http('POST', '/api/assessments/start', { skillName: 'Python', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		const adv1 = await answerAndAdvance(c.token, sid, start.json.question.id, await correctAnswer(start.json.question.id));
		const q2 = adv1.next;
		const adv2post = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: q2.id, answer: await correctAnswer(q2.id), timeTaken: 30 }, c.token);
		const rowAfter = await sessionRow(sid);
		// The candidate's second answer must be recorded even though question 3 cannot be produced.
		const recorded = rowAfter.na === 2;
		// The outcome must be a navigation/retry outcome, never a bare failure that discards the answer.
		const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const honestNav = adv2post.status !== 500 && (adv2post.json.answerRecorded === true || adv2post.status === 200 || adv2post.status === 503);
		// Recovery: once a d4 question exists, resume serves question 3 and the answer count is still exactly 2.
		await db.query(`INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds) VALUES ('Python',4,'multiple_choice','RigQ Python d4 recovery: pick the correct option','["RigCorrect","Wrong A","Wrong B","Wrong C"]','RigCorrect','Rig explanation',90)`);
		const cur2 = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const rowFinal = await sessionRow(sid);
		const recovered = !!cur2.json.question && rowFinal.na === 2;
		const ok = start.status === 200 && adv1.post.status === 200 && recorded && honestNav && recovered;
		rec('JT-A4_answer_preserved_when_next_question_generation_fails', ok ? 'PASS' : 'FAIL', { answer2Status: adv2post.status, answer2Error: adv2post.json.error, answersInDbAfterFailure: rowAfter.na, currentStatus: cur.status, currentError: cur.json.error || cur.json.code, recoveredQuestion: cur2.json.question?.id || null, answersInDbFinal: rowFinal.na });
	} catch (e) { rec('JT-A4_answer_preserved_when_next_question_generation_fails', 'FAIL', { error: e.message }); }

	// ---------- JT-A3: timer expiry submits and advances/completes — never a bare error ----------
	try {
		const c = shared;
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		// Expiry with NO input: the client sends '(no answer)'.
		const adv1 = await answerAndAdvance(c.token, sid, start.json.question.id, '(no answer)');
		const row1 = await sessionRow(sid);
		const expiryRecorded = row1.na === 1 && adv1.post.status === 200 && !!adv1.next;
		// Expiry WITH input selected: the client sends the current selection.
		const adv2 = await answerAndAdvance(c.token, sid, adv1.next.id, await correctAnswer(adv1.next.id));
		const row2 = await sessionRow(sid);
		const ok = start.status === 200 && expiryRecorded && adv2.post.status === 200 && row2.na === 2 && !!adv2.next;
		rec('JT-A3_timer_expiry_submits_and_advances', ok ? 'PASS' : 'FAIL', { startStatus: start.status, startError: start.json.error, expiryNoInputStatus: adv1.post.status, expiryNoInputError: adv1.post.json.error, answersAfterExpiry: row1.na, expiryWithInputStatus: adv2.post.status, answersFinal: row2.na });
	} catch (e) { rec('JT-A3_timer_expiry_submits_and_advances', 'FAIL', { error: e.message }); }

	// ---------- JT-A2 (failing leg): Finish completes exactly once; repeats are refused ----------
	try {
		const c = await registerCandidate('a2f');
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		let q = start.json.question; let lastPost = null; let answers = 0;
		while (q && answers < 12) {
			const r = await answerAndAdvance(c.token, sid, q.id, 'Wrong A');
			lastPost = r.post; answers++;
			if (r.post.json.completed) break;
			// Trap guard: being told "already recorded" for the question we
			// were just served means the journey can never advance.
			if (r.post.json.feedback === 'Answer already recorded' && r.next && r.next.id === q.id) break;
			q = r.next;
		}
		const row = await sessionRow(sid);
		const dup = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: q?.id || 1, answer: 'Wrong A', timeTaken: 30 }, c.token);
		const sa = await db.query('SELECT COUNT(*)::int AS n FROM skill_assessments WHERE session_id=$1', [sid]);
		const ok = lastPost?.json.completed === true && row.status === 'completed' && sa.rows[0].n === 1 && dup.status === 400;
		rec('JT-A2_finish_exactly_once_failing_leg', ok ? 'PASS' : 'FAIL', { answersSent: answers, completed: lastPost?.json.completed, sessionStatus: row.status, skillAssessments: sa.rows[0].n, duplicateStatus: dup.status, duplicateError: dup.json.error });
	} catch (e) { rec('JT-A2_finish_exactly_once_failing_leg', 'FAIL', { error: e.message }); }

	// ---------- JT-A2 + #1612 (passing leg): a PASSING candidate actually finishes ----------
	try {
		const c = await registerCandidate('a2p');
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		let q = start.json.question; let lastPost = null; let answers = 0; let hang = false;
		while (q && answers < 12) {
			const r = await answerAndAdvance(c.token, sid, q.id, await correctAnswer(q.id));
			lastPost = r.post; answers++;
			if (r.post.hang) { hang = true; break; }
			if (r.post.json.completed) break;
			if (r.post.json.feedback === 'Answer already recorded' && r.next && r.next.id === q.id) break;
			q = r.next;
		}
		let blocked = null;
		if (hang) {
			const act = await db.query(`SELECT pid, wait_event_type, wait_event, LEFT(query,120) AS query FROM pg_stat_activity WHERE state='active' AND query ILIKE '%omni_scores%' OR query ILIKE '%candidate_skills%'`).catch(() => ({ rows: [] }));
			blocked = act.rows;
			// Release the deadlocked backends so later legs can proceed.
			await db.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid <> pg_backend_pid()`).catch(() => {});
		}
		const row = await sessionRow(sid);
		const sa = await db.query('SELECT COUNT(*)::int AS n, BOOL_OR(passed) AS passed FROM skill_assessments WHERE session_id=$1', [sid]);
		const audit = await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action_type='assessment_graded' AND metadata->>'session_id'=$1`, [String(sid)]);
		const comp = await db.query(`SELECT COUNT(*)::int AS n FROM score_components WHERE user_id=$1 AND component_type='technical'`, [c.id]);
		const skill = await db.query('SELECT is_verified FROM candidate_skills WHERE user_id=$1 AND LOWER(skill_name)=LOWER($2)', [c.id, 'JavaScript']);
		const ok = !hang && lastPost?.json.completed === true && row.status === 'completed' && sa.rows[0].n === 1 && sa.rows[0].passed === true && audit.rows[0].n === 1 && comp.rows[0].n === 1 && skill.rows[0]?.is_verified === true;
		rec('JT-A2_passing_leg_completes_1612', ok ? 'PASS' : 'FAIL', { hang, answersSent: answers, finalStatus: lastPost?.status, completed: lastPost?.json.completed, sessionStatus: row.status, skillAssessments: sa.rows[0].n, passed: sa.rows[0].passed, gradedAuditRows: audit.rows[0].n, omniComponents: comp.rows[0].n, isVerified: skill.rows[0]?.is_verified, blockedBackends: blocked });
	} catch (e) { rec('JT-A2_passing_leg_completes_1612', 'FAIL', { error: e.message }); }

	// ---------- JT-A2b: concurrent double-Finish cannot double-complete or double-score ----------
	try {
		const c = await registerCandidate('a2b');
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		let q = start.json.question; let answers = 0; let completedEarly = false;
		while (q && answers < 9) {
			const r = await answerAndAdvance(c.token, sid, q.id, await correctAnswer(q.id));
			answers++;
			if (r.post.json.completed) { completedEarly = true; break; }
			q = r.next;
		}
		// The runner normally serves question 10 next; fetch it the way a refresh would.
		if (!q && !completedEarly) { const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token); q = cur.json.question; }
		if (completedEarly || !q) {
			const rowEarly = await sessionRow(sid);
			rec('JT-A2b_concurrent_double_finish_exactly_once', 'FAIL', { reason: 'session completed before 10 answers were served', answersAtCompletion: answers, answersInDb: rowEarly.na, sessionStatus: rowEarly.status });
			throw new Error('completed-early handled');
		}
		const finalAnswer = await correctAnswer(q.id);
		const [r1, r2] = await Promise.all([
			http('POST', '/api/assessments/answer', { sessionId: sid, questionId: q.id, answer: finalAnswer, timeTaken: 30 }, c.token),
			http('POST', '/api/assessments/answer', { sessionId: sid, questionId: q.id, answer: finalAnswer, timeTaken: 30 }, c.token),
		]);
		const sa = await db.query('SELECT COUNT(*)::int AS n FROM skill_assessments WHERE session_id=$1', [sid]);
		const row = await sessionRow(sid);
		const completedCount = [r1, r2].filter((r) => r.json.completed === true).length;
		const ok = sa.rows[0].n === 1 && row.status === 'completed' && row.na === 10 && completedCount >= 1 && !r1.hang && !r2.hang;
		rec('JT-A2b_concurrent_double_finish_exactly_once', ok ? 'PASS' : 'FAIL', { r1: { status: r1.status, completed: r1.json.completed, error: r1.json.error, hang: !!r1.hang }, r2: { status: r2.status, completed: r2.json.completed, error: r2.json.error, hang: !!r2.hang }, skillAssessments: sa.rows[0].n, answersInDb: row.na, sessionStatus: row.status });
	} catch (e) { if (e.message !== 'completed-early handled') rec('JT-A2b_concurrent_double_finish_exactly_once', 'FAIL', { error: e.message }); }

	// ---------- JT-A5/A7: an assessment that cannot produce questions fails honestly at start and stays resumable ----------
	try {
		const c = shared;
		const start = await http('POST', '/api/assessments/start', { skillName: 'SQL', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		let sessionExists = false; let resumed = false;
		if (sid) {
			const row = await sessionRow(sid).catch(() => null);
			sessionExists = !!row && row.status === 'in_progress';
			await db.query(`INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds) VALUES ('SQL',2,'multiple_choice','RigQ SQL d2 recovery: pick the correct option','["RigCorrect","Wrong A","Wrong B","Wrong C"]','RigCorrect','Rig explanation',90)`);
			const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
			resumed = !!cur.json.question;
		}
		const honest = start.status === 503 && start.json.code === 'QUESTION_UNAVAILABLE' && !!start.json.error && !/Request failed/i.test(start.json.error);
		const ok = honest && sessionExists && resumed;
		rec('JT-A5_start_fails_honestly_and_session_resumable', ok ? 'PASS' : 'FAIL', { startStatus: start.status, startError: start.json.error, startCode: start.json.code, sessionId: sid || null, sessionExists, resumed });
	} catch (e) { rec('JT-A5_start_fails_honestly_and_session_resumable', 'FAIL', { error: e.message }); }

	// ---------- JT-A6 (review round): only the outstanding question can be answered ----------
	try {
		const c = shared;
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		const other = await db.query('SELECT id FROM assessment_questions WHERE id <> $1 ORDER BY id LIMIT 1', [start.json.question.id]);
		const forged = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: other.rows[0].id, answer: 'RigCorrect', timeTaken: 30 }, c.token);
		const rowAfterForged = await sessionRow(sid);
		// Answer the real question, then re-submit it with the id as a STRING:
		// the duplicate guard must still recognise it (no double record).
		const real = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: start.json.question.id, answer: await correctAnswer(start.json.question.id), timeTaken: 30 }, c.token);
		const dupString = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: String(start.json.question.id), answer: await correctAnswer(start.json.question.id), timeTaken: 30 }, c.token);
		const rowFinal = await sessionRow(sid);
		const ok = start.status === 200 && forged.status === 400 && forged.json.code === 'QUESTION_NOT_CURRENT' && rowAfterForged.na === 0 && real.status === 200 && rowFinal.na === 1;
		rec('JT-A6_only_the_outstanding_question_can_be_answered', ok ? 'PASS' : 'FAIL', { forgedStatus: forged.status, forgedCode: forged.json.code, answersAfterForged: rowAfterForged.na, realStatus: real.status, dupStringStatus: dupString.status, dupStringFeedback: dupString.json.feedback, answersFinal: rowFinal.na });
	} catch (e) { rec('JT-A6_only_the_outstanding_question_can_be_answered', 'FAIL', { error: e.message }); }

	const fails = steps.filter((s) => s.verdict === 'FAIL').length;
	fs.writeFileSync(OUT, JSON.stringify({ run: RUN, base: BASE, steps, summary: { total: steps.length, pass: steps.length - fails, fail: fails } }, null, 2));
	console.log(`\nSUMMARY: ${steps.length - fails}/${steps.length} PASS, ${fails} FAIL`);
	await db.end();
	process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('suite error', e); process.exit(2); });
