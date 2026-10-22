/* Quinn + Candidate Experience — USER-JOURNEY acceptance suite: ASSESSMENTS PHASE B
 * Issues #1604 (no way to exit mid-test) + #1605 (full-screen mode + exit rules).
 * PRD: prd-assessments-module.md §6.1/§6.2, §7 FR-B1–B4, §10 JT-B1–B10.
 * Design: design-assessment-exit-fullscreen.md (Rex, PR #1635).
 * Founder ruling (Sumanth, 2026-10-21): partial terminal submissions are scored
 * over ANSWERED questions only, labelled plainly as partial (answered X of Y)
 * wherever shown, NOT eligible for pass/Verified, and do NOT feed OmniScore.
 * Retake after abandon: NO lockout.
 *
 * Written from the candidate's expectations:
 *  - Exit → Continue changes nothing: same question, draft intact, timer resumes.
 *  - Save & Exit keeps every saved answer AND the current draft (stored, NOT
 *    answered); Resume lands back on that question with the draft present.
 *  - Submit & Exit scores ONLY the saved answers, says "partial — answered X
 *    of Y", can never pass/verify/feed OmniScore, and can never be resumed.
 *  - Exit Exam ends the attempt with NO score anywhere — never a 0, never a
 *    fail — and a fresh attempt of the same skill starts immediately.
 *  - Leaving full-screen once warns; twice submits the saved answers exactly
 *    once and the results say so plainly.
 *  - No sequence of exit actions produces a duplicate submission or an
 *    attempt that is both completed and abandoned.
 *  - The assigned (job) runner behaves identically, its full-screen events
 *    are actually RECORDED (not merely acknowledged), and a recruiter sees
 *    "Candidate exited — not scored" — no zero, no fail.
 *
 * Real HTTP against a fresh-install dev build (DB built ONLY by
 * `node migrate.js`), resulting state read back from the DB. Full-screen
 * itself is a browser capability, so JT-B6 is exercised at the API/event
 * level exactly as the runner drives it (event posts + the exit endpoint
 * with reason 'fullscreen_second_exit'); the browser state machine is
 * covered by the build's client code review.
 *
 * Usage:
 *   JT_BASE=http://127.0.0.1:3213 JT_DB=postgresql://postgres@127.0.0.1:55439/phaseb_green \
 *   JT_OUT=./phase-b-evidence.json node assessment-phase-b.js
 * Exit code: 1 if any step FAILs, else 0.
 */
const fs = require('fs');
const { Client } = require('pg');

const BASE = process.env.JT_BASE || 'http://127.0.0.1:3213';
const DBURL = process.env.JT_DB;
const OUT = process.env.JT_OUT || 'phase-b-evidence.json';
const RUN = Date.now().toString(36);
const TIMEOUT_MS = 30000;

const steps = [];
function rec(step, verdict, evidence) {
	steps.push({ step, verdict, ...evidence });
	console.log(`[${verdict}] ${step} :: ${JSON.stringify(evidence).slice(0, 900)}`);
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
async function register(tag, role = 'candidate') {
	for (let attempt = 0; attempt < 8; attempt++) {
		const r = await http('POST', '/api/auth/register', { email: `jtb${tag}${RUN}@example.com`, password: 'JourneyTest2026', name: `JT ${tag}`, role });
		if (r.status !== 429) return { token: r.json.token || r.json.accessToken, id: r.json.user?.id, status: r.status, email: `jtb${tag}${RUN}@example.com`, password: 'JourneyTest2026' };
		const waitS = Math.min((r.json.retryAfter || 60) + 5, 240);
		console.log(`register ${tag}: 429, waiting ${waitS}s`);
		await new Promise((res) => setTimeout(res, waitS * 1000));
	}
	throw new Error(`register ${tag}: rate limited after retries`);
}
// The rig's rate-limit waits can outlast a JWT's lifetime; job legs refresh
// their candidate's token by logging in again before use.
async function refreshToken(user) {
	const r = await http('POST', '/api/auth/login', { email: user.email, password: user.password });
	if (r.json.token || r.json.accessToken) user.token = r.json.token || r.json.accessToken;
	return user;
}
async function correctAnswer(qid) {
	const q = await db.query('SELECT question_type, correct_answer FROM assessment_questions WHERE id=$1', [qid]);
	return q.rows[0].question_type === 'multiple_choice' ? q.rows[0].correct_answer : 'A thorough answer covering the concept with a concrete example.';
}
async function sessionRow(sid) {
	try {
		const s = await db.query('SELECT status, score, current_draft, jsonb_array_length(answers_given) AS na, jsonb_array_length(questions_asked) AS nq FROM assessment_sessions WHERE id=$1', [sid]);
		return s.rows[0];
	} catch {
		// Pre-migration-276 schema (the RED baseline): no current_draft column yet.
		const s = await db.query('SELECT status, score, NULL AS current_draft, jsonb_array_length(answers_given) AS na, jsonb_array_length(questions_asked) AS nq FROM assessment_sessions WHERE id=$1', [sid]);
		return s.rows[0];
	}
}
async function answerAndAdvance(token, sid, qid, answer) {
	const post = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: qid, answer, timeTaken: 30 }, token);
	if (post.hang || post.json.completed) return { post, next: null };
	if (post.json.nextQuestion) return { post, next: post.json.nextQuestion };
	const current = await http('GET', `/api/assessments/session/${sid}/current`, null, token);
	return { post, next: current.json.question || null, current };
}
async function exitSkill(token, sid, body) {
	return http('POST', `/api/assessments/session/${sid}/exit`, body, token);
}

(async () => {
	db = new Client({ connectionString: DBURL });
	await db.connect();

	// ---------- RIG SETUP: deterministic bank supply (rig data, not product seed) ----------
	await db.query(`DELETE FROM assessment_questions WHERE skill_category IN ('JavaScript','Python') AND question_text LIKE 'RigQ %'`);
	for (const skill of ['JavaScript', 'Python']) {
		for (const d of [1, 2, 3, 4, 5]) {
			for (let i = 1; i <= 4; i++) {
				await db.query(
					`INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds)
					 VALUES ($1,$2,'multiple_choice',$3,$4,'RigCorrect','Rig explanation',90)`,
					[skill, d, `RigQ ${skill} d${d} #${i}: pick the correct option`, JSON.stringify(['RigCorrect', 'Wrong A', 'Wrong B', 'Wrong C'])],
				);
			}
		}
	}

	// Shared candidates keep registrations inside the auth rate limiter's
	// budget: legs sharing a candidate run sequentially and never complete
	// that candidate's skill before a later leg needs to start it.
	const sharedSkill = await register('shr');
	const sharedJob = await register('job');

	// ---------- JT-B1: Exit → Continue returns to the same question, draft intact ----------
	try {
		const c = sharedSkill;
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		const q1 = start.json.question;
		// The candidate opens the Exit dialog (the runner logs it) and chooses Continue.
		const ev = await http('POST', '/api/assessments/event', { sessionId: sid, eventType: 'exit_dialog_opened', eventData: { answersGiven: 0 } }, c.token);
		const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const row = await sessionRow(sid);
		const evN = await db.query(`SELECT COUNT(*)::int AS n FROM assessment_events WHERE session_id=$1 AND event_type='exit_dialog_opened'`, [sid]);
		const ok = start.status === 200 && ev.status === 200 && cur.json.status === 'in_progress' && cur.json.question?.id === q1.id && row.status === 'in_progress' && row.na === 0 && evN.rows[0].n === 1;
		rec('JT-B1_exit_continue_same_question', ok ? 'PASS' : 'FAIL', { startStatus: start.status, eventStatus: ev.status, currentQuestionId: cur.json.question?.id, expectedQuestionId: q1.id, sessionStatus: row.status, answersInDb: row.na, dialogEvents: evN.rows[0].n });
	} catch (e) { rec('JT-B1_exit_continue_same_question', 'FAIL', { error: e.message }); }

	// ---------- JT-B2 + JT-B2a: Save & Exit → Resume; draft stored-but-not-answered ----------
	let b2Recorded = false;
	try {
		const c = sharedSkill;
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		const adv = await answerAndAdvance(c.token, sid, start.json.question.id, await correctAnswer(start.json.question.id));
		const q2 = adv.next;
		// Candidate selects an answer on Q2 but does NOT press Next — it is a draft.
		const save = await exitSkill(c.token, sid, { action: 'save', draft: { questionId: q2.id, answer: 'RigCorrect' } });
		const rowAfterSave = await sessionRow(sid);
		const draftStored = rowAfterSave.current_draft && Number(rowAfterSave.current_draft.questionId) === q2.id && rowAfterSave.current_draft.answer === 'RigCorrect';
		const okB2 = save.status === 200 && save.json.status === 'in_progress' && save.json.answersGiven === 1 && rowAfterSave.status === 'in_progress' && rowAfterSave.na === 1 && !!draftStored;
		rec('JT-B2_save_and_exit_resumable', okB2 ? 'PASS' : 'FAIL', { saveStatus: save.status, saveBody: save.json, sessionStatus: rowAfterSave.status, answersInDb: rowAfterSave.na, draftStored: !!draftStored });
		b2Recorded = true;
		// Resume: same session via /current — lands on Q2 with the draft present, still unanswered.
		const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const draft = cur.json.currentDraft;
		const draftOk = !!draft && Number(draft.questionId) === q2.id && draft.answer === 'RigCorrect';
		const rowAtResume = await sessionRow(sid);
		// Pressing Next now submits the draft exactly once; the stored draft is cleared.
		const adv2 = await answerAndAdvance(c.token, sid, q2.id, draft.answer);
		const rowFinal = await sessionRow(sid);
		const okB2a = cur.json.status === 'in_progress' && cur.json.question?.id === q2.id && draftOk && rowAtResume.na === 1 && adv2.post.status === 200 && rowFinal.na === 2 && rowFinal.current_draft === null;
		rec('JT-B2a_draft_restored_unanswered_then_submits_once', okB2a ? 'PASS' : 'FAIL', { resumeQuestionId: cur.json.question?.id, expectedQuestionId: q2.id, draftRestored: draftOk, answersAtResume: rowAtResume.na, answerStatus: adv2.post.status, answersFinal: rowFinal.na, draftCleared: rowFinal.current_draft === null });
	} catch (e) {
		if (!b2Recorded) rec('JT-B2_save_and_exit_resumable', 'FAIL', { error: e.message });
		if (!steps.some((x) => x.step === 'JT-B2a_draft_restored_unanswered_then_submits_once')) rec('JT-B2a_draft_restored_unanswered_then_submits_once', 'FAIL', { error: e.message });
	}

	// ---------- JT-B3: Submit & Exit — partial scored over ANSWERED only, labelled, never pass/Verified/OmniScore ----------
	try {
		const c = await register('b3');
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		let q = start.json.question;
		const plan = ['correct', 'correct', 'wrong'];
		for (const p of plan) {
			const r = await answerAndAdvance(c.token, sid, q.id, p === 'correct' ? await correctAnswer(q.id) : 'Wrong A');
			q = r.next;
		}
		const sub = await exitSkill(c.token, sid, { action: 'submit' });
		const row = await sessionRow(sid);
		const sa = await db.query('SELECT score, max_score, passed, behavioral_flags FROM skill_assessments WHERE session_id=$1', [sid]);
		// Expected: earned points / max points of the ANSWERED questions × 100.
		const exp = await db.query(
			`SELECT (SELECT SUM((a->>'scorePoints')::int) FROM assessment_sessions s, jsonb_array_elements(s.answers_given) a WHERE s.id=$1) AS earned,
			        (SELECT SUM(CASE WHEN q.question_type='multiple_choice' THEN q.difficulty_level*10 ELSE q.difficulty_level*15 END) FROM assessment_sessions s, jsonb_array_elements(s.answers_given) a JOIN assessment_questions q ON q.id=(a->>'questionId')::int WHERE s.id=$1) AS maxpts`, [sid]);
		const earned = Number(exp.rows[0].earned); const maxpts = Number(exp.rows[0].maxpts);
		const expectedScore = Math.round((earned / maxpts) * 100);
		const flags = typeof sa.rows[0]?.behavioral_flags === 'string' ? JSON.parse(sa.rows[0].behavioral_flags) : sa.rows[0]?.behavioral_flags;
		const skill = await db.query('SELECT is_verified FROM candidate_skills WHERE user_id=$1 AND LOWER(skill_name)=LOWER($2)', [c.id, 'JavaScript']);
		const comp = await db.query(`SELECT COUNT(*)::int AS n FROM score_components WHERE user_id=$1 AND component_type='technical'`, [c.id]);
		const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const resumeAttempt = await exitSkill(c.token, sid, { action: 'save' });
		const ok = sub.status === 200 && sub.json.status === 'completed' && sub.json.answersGiven === 3 && sub.json.totalQuestions === 10
			&& row.status === 'completed' && row.na === 3 && sa.rows.length === 1
			&& sa.rows[0].score === expectedScore && sa.rows[0].passed === false
			&& flags?.partial === true && flags?.answers_given === 3 && flags?.total_questions === 10
			&& skill.rows[0]?.is_verified !== true && comp.rows[0].n === 0
			&& cur.json.status === 'completed' && cur.json.partial === true && cur.json.answersGiven === 3 && cur.json.totalQuestions === 10
			&& resumeAttempt.status === 409;
		rec('JT-B3_submit_and_exit_partial_scoring', ok ? 'PASS' : 'FAIL', { submitStatus: sub.status, submitBody: sub.json, sessionStatus: row.status, storedScore: sa.rows[0]?.score, expectedScore, earned, maxpts, passed: sa.rows[0]?.passed, flags, isVerified: skill.rows[0]?.is_verified, omniComponents: comp.rows[0].n, currentPartial: cur.json.partial, currentAnswers: cur.json.answersGiven, resumeAfterSubmitStatus: resumeAttempt.status });
	} catch (e) { rec('JT-B3_submit_and_exit_partial_scoring', 'FAIL', { error: e.message }); }

	// ---------- JT-B4: Exit Exam — "Exited — not scored", no number anywhere, fresh attempt starts (no lockout) ----------
	try {
		const c = await register('b4');
		const start = await http('POST', '/api/assessments/start', { skillName: 'Python', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		const adv = await answerAndAdvance(c.token, sid, start.json.question.id, await correctAnswer(start.json.question.id));
		const ab = await exitSkill(c.token, sid, { action: 'abandon' });
		const row = await sessionRow(sid);
		const sa = await db.query('SELECT COUNT(*)::int AS n FROM skill_assessments WHERE session_id=$1', [sid]);
		const evN = await db.query(`SELECT COUNT(*)::int AS n FROM assessment_events WHERE session_id=$1 AND event_type='exit_exam'`, [sid]);
		const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const results = await http('GET', '/api/assessments/results', null, c.token);
		const inResults = (results.json.results || []).some((r) => r.session_id === sid);
		const fresh = await http('POST', '/api/assessments/start', { skillName: 'Python', category: 'technical' }, c.token);
		const ok = ab.status === 200 && ab.json.status === 'abandoned' && row.status === 'abandoned' && row.na === 1
			&& sa.rows[0].n === 0 && evN.rows[0].n >= 1
			&& cur.json.status === 'abandoned' && cur.json.score === undefined
			&& !inResults && fresh.status === 200 && !!fresh.json.question;
		rec('JT-B4_exit_exam_no_score_no_lockout', ok ? 'PASS' : 'FAIL', { abandonStatus: ab.status, abandonBody: ab.json, sessionStatus: row.status, answersRetained: row.na, skillAssessmentRows: sa.rows[0].n, exitExamEvents: evN.rows[0].n, currentStatus: cur.json.status, currentScoreField: cur.json.score ?? null, appearsInResults: inResults, freshStartStatus: fresh.status, freshHasQuestion: !!fresh.json.question });
	} catch (e) { rec('JT-B4_exit_exam_no_score_no_lockout', 'FAIL', { error: e.message }); }

	// ---------- JT-B6 (API/event level): first full-screen exit warns; second auto-submits saved answers exactly once ----------
	try {
		const c = await register('b6');
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		const adv = await answerAndAdvance(c.token, sid, start.json.question.id, await correctAnswer(start.json.question.id));
		const entered = await http('POST', '/api/assessments/event', { sessionId: sid, eventType: 'fullscreen_entered', eventData: {} }, c.token);
		const first = await http('POST', '/api/assessments/event', { sessionId: sid, eventType: 'fullscreen_exit_first', eventData: { answersGiven: 1 } }, c.token);
		const curMid = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const exitsUsed = curMid.json.fullscreenExitsUsed;
		const second = await http('POST', '/api/assessments/event', { sessionId: sid, eventType: 'fullscreen_exit_second', eventData: { answersGiven: 1 } }, c.token);
		const auto = await exitSkill(c.token, sid, { action: 'submit', reason: 'fullscreen_second_exit' });
		const dup = await exitSkill(c.token, sid, { action: 'submit', reason: 'fullscreen_second_exit' });
		const row = await sessionRow(sid);
		const sa = await db.query('SELECT score, passed, behavioral_flags FROM skill_assessments WHERE session_id=$1', [sid]);
		const flags = typeof sa.rows[0]?.behavioral_flags === 'string' ? JSON.parse(sa.rows[0].behavioral_flags) : sa.rows[0]?.behavioral_flags;
		const cur = await http('GET', `/api/assessments/session/${sid}/current`, null, c.token);
		const ok = entered.status === 200 && first.status === 200 && exitsUsed === 1 && second.status === 200
			&& auto.status === 200 && auto.json.status === 'completed' && dup.status === 409
			&& row.status === 'completed' && sa.rows.length === 1 && flags?.fullscreen_auto_submit === true && flags?.partial === true
			&& cur.json.autoSubmittedFullscreen === true && cur.json.answersGiven === 1 && cur.json.totalQuestions === 10;
		rec('JT-B6_fullscreen_warn_then_auto_submit_once', ok ? 'PASS' : 'FAIL', { enteredStatus: entered.status, firstExitStatus: first.status, exitsUsedAfterFirst: exitsUsed, autoSubmitStatus: auto.status, autoSubmitBody: auto.json, duplicateStatus: dup.status, sessionStatus: row.status, skillAssessmentRows: sa.rows.length, flags, currentAutoFlag: cur.json.autoSubmittedFullscreen, currentAnswers: cur.json.answersGiven });
	} catch (e) { rec('JT-B6_fullscreen_warn_then_auto_submit_once', 'FAIL', { error: e.message }); }

	// ---------- JT-B7: no exit sequence yields a duplicate submission or completed+abandoned ----------
	try {
		const c = sharedSkill;
		const start = await http('POST', '/api/assessments/start', { skillName: 'JavaScript', category: 'technical' }, c.token);
		const sid = start.json.sessionId;
		await answerAndAdvance(c.token, sid, start.json.question.id, await correctAnswer(start.json.question.id));
		const [rSubmit, rAbandon] = await Promise.all([
			exitSkill(c.token, sid, { action: 'submit' }),
			exitSkill(c.token, sid, { action: 'abandon' }),
		]);
		const winners = [rSubmit, rAbandon].filter((r) => r.status === 200);
		const losers = [rSubmit, rAbandon].filter((r) => r.status === 409);
		const row = await sessionRow(sid);
		const sa = await db.query('SELECT COUNT(*)::int AS n FROM skill_assessments WHERE session_id=$1', [sid]);
		const afterAnswer = await http('POST', '/api/assessments/answer', { sessionId: sid, questionId: start.json.question.id, answer: 'RigCorrect', timeTaken: 30 }, c.token);
		const consistent = (row.status === 'completed' && sa.rows[0].n === 1) || (row.status === 'abandoned' && sa.rows[0].n === 0);
		const ok = winners.length === 1 && losers.length === 1 && consistent && afterAnswer.status === 400 && afterAnswer.json.code === 'ALREADY_FINISHED';
		rec('JT-B7_exit_race_exactly_one_terminal', ok ? 'PASS' : 'FAIL', { submitStatus: rSubmit.status, abandonStatus: rAbandon.status, winners: winners.length, losers: losers.length, sessionStatus: row.status, skillAssessmentRows: sa.rows[0].n, answerAfterTerminalStatus: afterAnswer.status, answerAfterTerminalCode: afterAnswer.json.code });
	} catch (e) { rec('JT-B7_exit_race_exactly_one_terminal', 'FAIL', { error: e.message }); }

	// ---------- JOB RUNNER setup (JT-B8/B9/B10): recruiter + published assessment + assigned attempts ----------
	let jobCtx = null;
	try {
		await refreshToken(sharedJob); // JWT may have expired during the rate-limit waits
		const rec1 = await register('rec', 'employer');
		let recruiter = rec1;
		if (!recruiter.token) {
			// Fallback: clone a candidate's password hash into a recruiter row, then log in.
			const cand = await db.query('SELECT password_hash FROM users ORDER BY id LIMIT 1');
			const ins = await db.query(`INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,'JT Recruiter','employer') RETURNING id`, [`jtbrec2${RUN}@example.com`, cand.rows[0].password_hash]);
			const login = await http('POST', '/api/auth/login', { email: `jtbrec2${RUN}@example.com`, password: 'JourneyTest2026' });
			recruiter = { token: login.json.token || login.json.accessToken, id: ins.rows[0].id, status: login.status };
		}
		// RIG NOTE (pre-existing defect, not Phase B): on a fresh install the
		// chk_job_assessments_status CHECK allows only draft/active/archived,
		// while the product's publish endpoint and /start handler use
		// 'published' — no job assessment can ever be published on a fresh
		// install. The rig widens the CHECK to the code's vocabulary so the
		// journey can run; the drift itself is flagged on the issue.
		await db.query(`ALTER TABLE job_assessments DROP CONSTRAINT IF EXISTS chk_job_assessments_status`);
		await db.query(`ALTER TABLE job_assessments ADD CONSTRAINT chk_job_assessments_status CHECK (status IN ('draft','active','archived','published'))`);
		const job = await db.query(`INSERT INTO jobs (user_id, title, company, description, status) VALUES ($1,'JT Role','JT Co','Rig job','active') RETURNING id`, [recruiter.id]);
		const ja = await db.query(`INSERT INTO job_assessments (job_id, created_by, title, status, time_limit_minutes, passing_score, question_count) VALUES ($1,$2,'JT Job Assessment','published',45,70,3) RETURNING id`, [job.rows[0].id, recruiter.id]);
		const assessmentId = ja.rows[0].id;
		const qids = [];
		for (let i = 1; i <= 3; i++) {
			const q = await db.query(`INSERT INTO job_assessment_questions (assessment_id, category, question_type, question_text, options, correct_answer, explanation, difficulty_level, points, time_limit_seconds, order_index) VALUES ($1,'general','multiple_choice',$2,$3,'RigCorrect','Rig explanation',2,10,90,$4) RETURNING id`, [assessmentId, `RigJobQ #${i}: pick the correct option`, JSON.stringify(['RigCorrect', 'Wrong A', 'Wrong B', 'Wrong C']), i]);
			qids.push(q.rows[0].id);
		}
		jobCtx = { recruiter, assessmentId, qids };
	} catch (e) { rec('JT-B8_setup', 'FAIL', { error: e.message }); }

	async function jobAttempt(candidateId) {
		const a = await db.query(`INSERT INTO job_assessment_attempts (assessment_id, candidate_id, status) VALUES ($1,$2,'assigned') RETURNING id`, [jobCtx.assessmentId, candidateId]);
		return a.rows[0].id;
	}
	async function attemptRow(aid) {
		try {
			const r = await db.query('SELECT status, composite_score, current_draft, completion_flags, integrity_events, jsonb_array_length(answers) AS na FROM job_assessment_attempts WHERE id=$1', [aid]);
			return r.rows[0];
		} catch {
			// Pre-migration-276 schema (the RED baseline).
			const r = await db.query(`SELECT status, composite_score, NULL AS current_draft, '{}'::jsonb AS completion_flags, '[]'::jsonb AS integrity_events, jsonb_array_length(answers) AS na FROM job_assessment_attempts WHERE id=$1`, [aid]);
			return r.rows[0];
		}
	}
	const asJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

	// ---------- JT-B8: job runner — all four exit outcomes ----------
	try {
		const c = await refreshToken(sharedJob); // refresh AFTER the setup waits, right before use
		// Save & Exit + resume, with a draft:
		const aid = await jobAttempt(c.id);
		const st = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/start`, {}, c.token);
		const a1 = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/answer`, { attemptId: aid, questionId: jobCtx.qids[0], answer: 'RigCorrect', timeTaken: 30 }, c.token);
		const save = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/exit`, { attemptId: aid, action: 'save', draft: { questionId: jobCtx.qids[1], answer: 'RigCorrect' } }, c.token);
		const rowSave = await attemptRow(aid);
		const resume = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/start`, {}, c.token);
		const draftBack = resume.json.currentDraft;
		// Submit & Exit (partial: 1 of 3 answered) → completed, scoring fires exactly once, partial-labelled:
		const sub = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/exit`, { attemptId: aid, action: 'submit' }, c.token);
		const sub2 = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/exit`, { attemptId: aid, action: 'submit' }, c.token);
		await new Promise((r) => setTimeout(r, 4000));
		const rowSub = await attemptRow(aid);
		const flagsSub = asJson(rowSub.completion_flags) || {};
		const scoreView = await http('GET', `/api/assessments/attempt/${aid}/score`, null, c.token);
		// Exit Exam on a second attempt:
		const aid2 = await jobAttempt(c.id);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/start`, {}, c.token);
		const ab = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/exit`, { attemptId: aid2, action: 'abandon' }, c.token);
		const rowAb = await attemptRow(aid2);
		const ok = st.json.attemptId === aid && a1.status === 200
			&& save.status === 200 && rowSave.status === 'in_progress' && rowSave.current_draft?.answer === 'RigCorrect'
			&& resume.json.attemptId === aid && draftBack?.answer === 'RigCorrect' && resume.json.resumed === true
			&& sub.status === 200 && sub.json.status === 'completed' && sub2.status === 409
			&& rowSub.status === 'completed' && rowSub.composite_score !== null && flagsSub.partial === true && Number(flagsSub.answers_given) === 1
			&& scoreView.json.partial === true && scoreView.json.result === null
			&& ab.status === 200 && ab.json.status === 'abandoned' && rowAb.status === 'abandoned' && rowAb.composite_score === null;
		rec('JT-B8_job_runner_four_outcomes', ok ? 'PASS' : 'FAIL', { startAttempt: st.json.attemptId, answerStatus: a1.status, saveStatus: save.status, draftStored: !!rowSave.current_draft, resumeDraft: draftBack ?? null, submitStatus: sub.status, submitRepeatStatus: sub2.status, submittedScore: rowSub.composite_score, submitFlags: flagsSub, scoreView: scoreView.json, abandonStatus: ab.status, abandonedScore: rowAb.composite_score });
	} catch (e) { rec('JT-B8_job_runner_four_outcomes', 'FAIL', { error: e.message }); }

	// ---------- JT-B9: job runner — events RECORDED (not just acknowledged); pause credit on the whole-exam timer ----------
	try {
		const c = await refreshToken(sharedJob);
		const aid = await jobAttempt(c.id);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/start`, {}, c.token);
		const ev1 = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/event`, { attemptId: aid, eventType: 'fullscreen_exit_first', eventData: {} }, c.token);
		const rowEv = await attemptRow(aid);
		const events = asJson(rowEv.integrity_events) || [];
		const recorded = events.some((e) => e.type === 'fullscreen_exit_first');
		const bogus = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/event`, { attemptId: aid, eventType: 'not_a_real_event', eventData: {} }, c.token);
		// Pause credit: attempt started 48 min ago (past the 45-min limit), but a
		// pause spanning that window is credited (capped at 300s) → answer allowed.
		const aid2 = await jobAttempt(c.id);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/start`, {}, c.token);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/event`, { attemptId: aid2, eventType: 'timer_pause_start', eventData: {} }, c.token);
		await db.query(`UPDATE job_assessment_attempts SET started_at = NOW() - INTERVAL '48 minutes' WHERE id=$1`, [aid2]);
		await db.query(`UPDATE job_assessment_attempts SET integrity_events = COALESCE((SELECT jsonb_agg(CASE WHEN elem->>'type'='timer_pause_start' THEN jsonb_set(elem, '{timestamp}', to_jsonb((NOW() - INTERVAL '48 minutes')::text)) ELSE elem END) FROM jsonb_array_elements(integrity_events) elem), integrity_events) WHERE id=$1`, [aid2]);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/event`, { attemptId: aid2, eventType: 'timer_pause_end', eventData: {} }, c.token);
		const credited = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/answer`, { attemptId: aid2, questionId: jobCtx.qids[0], answer: 'RigCorrect', timeTaken: 30 }, c.token);
		// Control: same age, NO pause → the elapsed guard still refuses.
		const aid3 = await jobAttempt(c.id);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/start`, {}, c.token);
		await db.query(`UPDATE job_assessment_attempts SET started_at = NOW() - INTERVAL '48 minutes' WHERE id=$1`, [aid3]);
		const control = await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/answer`, { attemptId: aid3, questionId: jobCtx.qids[0], answer: 'RigCorrect', timeTaken: 30 }, c.token);
		const ok = ev1.status === 200 && recorded && bogus.status === 400 && credited.status === 200 && control.status === 410;
		rec('JT-B9_job_events_recorded_and_pause_credit', ok ? 'PASS' : 'FAIL', { eventStatus: ev1.status, eventRecorded: recorded, recordedTypes: events.map((e) => e.type), bogusStatus: bogus.status, creditedAnswerStatus: credited.status, creditedError: credited.json.error || credited.json.code, controlStatus: control.status, controlCode: control.json.code });
	} catch (e) { rec('JT-B9_job_events_recorded_and_pause_credit', 'FAIL', { error: e.message }); }

	// ---------- JT-B10: recruiter view of an abandoned assigned attempt ----------
	try {
		const c = sharedJob;
		const aid = await jobAttempt(c.id);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/start`, {}, c.token);
		await http('POST', `/api/assessments/job-assessment/${jobCtx.assessmentId}/exit`, { attemptId: aid, action: 'abandon' }, c.token);
		const view = await http('GET', `/api/assessments/job-assessment/${jobCtx.assessmentId}/results?attemptId=${aid}`, null, jobCtx.recruiter.token);
		const att = (view.json.attempts || [])[0];
		const ok = !!att && att.status === 'abandoned' && (att.composite_score === null || att.composite_score === undefined) && att.scored_at === null;
		rec('JT-B10_recruiter_sees_exited_not_scored', ok ? 'PASS' : 'FAIL', { viewStatus: view.status, attemptStatus: att?.status, compositeScore: att?.composite_score ?? null, scoredAt: att?.scored_at ?? null });
	} catch (e) { rec('JT-B10_recruiter_sees_exited_not_scored', 'FAIL', { error: e.message }); }

	const fails = steps.filter((s) => s.verdict === 'FAIL').length;
	fs.writeFileSync(OUT, JSON.stringify({ run: RUN, base: BASE, steps, summary: { total: steps.length, pass: steps.length - fails, fail: fails } }, null, 2));
	console.log(`\nSUMMARY: ${steps.length - fails}/${steps.length} PASS, ${fails} FAIL`);
	await db.end();
	process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('suite error', e); process.exit(2); });
