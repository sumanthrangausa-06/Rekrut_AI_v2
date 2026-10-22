/* Quinn + Candidate Experience — USER-JOURNEY acceptance harness:
 * ASSESSMENTS PHASE C story C2 (#1654, epic #1603).
 * PRD: prd-assessments-module.md §10 JT-C1 / JT-C4.
 * Design: architecture-assessments-phase-c.md §3.6, §4.1, §4.2, §5, §9 C2.
 * Client under test: client/src/pages/candidate/assessment-configure.tsx
 * (configure → pre-flight → instructions → start). This harness exercises
 * the EXACT HTTP payloads that client sends and the response handling it
 * depends on, against a real server + real DB (HL-003). The browser-level
 * rendering proof remains Quinn's Playwright capture on the same rig.
 *
 * Written from the candidate's expectations:
 *  - Choosing topic + format + band + count serves exactly that: the
 *    session snapshot in the DB records the chosen configuration and the
 *    first question is served at the band's start difficulty.
 *  - A configuration the bank cannot promise says so BEFORE start
 *    (pre-flight reason + largestAvailable), and a start that still asks
 *    for it returns the honest 503 with { promised, largestAvailable }
 *    while the session stays committed and resumable — never a silently
 *    shortened test.
 *  - The smaller count works ONLY when the candidate explicitly sends it
 *    (the labelled offer): start accepts a non-enum count iff it equals
 *    the configuration's current servable.
 *  - Coding with the flag OFF and a setId both fail honestly
 *    (503 QUESTION_UNAVAILABLE / 400 SETS_NOT_AVAILABLE).
 *
 * Usage:
 *   JT_BASE=http://127.0.0.1:3212 JT_DB=postgresql://postgres@127.0.0.1:55461/phasec \
 *   JT_OUT=./c2-config-evidence.json node assessment-c2-config.js
 * Exit code: 1 if any step FAILs, else 0. BLOCKED steps (bank state made
 * a leg unexercisable) are reported, never fake-passed.
 */
const fs = require('fs');
const { Client } = require('pg');

const BASE = process.env.JT_BASE || 'http://127.0.0.1:3212';
const DBURL = process.env.JT_DB;
const OUT = process.env.JT_OUT || 'c2-config-evidence.json';
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
	for (let attempt = 0; attempt < 8; attempt++) {
		const r = await http('POST', '/api/auth/register', { email: `jtc2${tag}${RUN}@example.com`, password: 'JourneyTest2026', name: `JT C2 ${tag}`, role: 'candidate' });
		if (r.status !== 429) return { token: r.json.token || r.json.accessToken, id: r.json.user?.id, status: r.status };
		const waitS = Math.min((r.json.retryAfter || 60) + 5, 240);
		console.log(`register ${tag}: 429, waiting ${waitS}s (attempt ${attempt + 1})`);
		await new Promise((res) => setTimeout(res, waitS * 1000));
	}
	throw new Error(`register ${tag}: rate limited after retries`);
}

(async () => {
	db = new Client({ connectionString: DBURL });
	await db.connect();

	// ---------- RIG SETUP: deterministic supply on the Git default topic ----------
	// 12 approved MCQ rows at difficulty 3 (inside the medium band {2,3,4}).
	// Product seed supply may add more; every expectation below is derived
	// from the pre-flight's own servable figure, never assumed to be 12.
	await db.query(`DELETE FROM assessment_questions WHERE skill_category = 'Git' AND question_text LIKE 'RigC2 %'`);
	for (let i = 1; i <= 12; i++) {
		await db.query(
			`INSERT INTO assessment_questions (skill_category, difficulty_level, question_type, question_text, options, correct_answer, explanation, time_limit_seconds, topic_id, format, review_status)
			 VALUES ('Git',3,'multiple_choice',$1,$2,'RigCorrect','Rig explanation',90,(SELECT id FROM assessment_topics WHERE legacy_skill_name = 'Git'),'mcq','approved')`,
			[`RigC2 Git d3 #${i}: pick the correct option`, JSON.stringify(['RigCorrect', 'Wrong A', 'Wrong B', 'Wrong C'])],
		);
	}
	const topicRow = await db.query(`SELECT id FROM assessment_topics WHERE legacy_skill_name = 'Git'`);
	const topicId = topicRow.rows[0]?.id;
	if (!topicId) {
		rec('rig-setup', 'FAIL', { error: 'Git default topic missing — catalogue migrations 279/280 not applied on this DB' });
		fs.writeFileSync(OUT, JSON.stringify({ run: RUN, steps }, null, 2));
		process.exit(1);
	}

	// ---------- JT-C1: catalogue → pre-flight → configured start → snapshot read-back ----------
	try {
		const c = await registerCandidate('c1');
		const catalog = await http('GET', '/api/assessments/catalog', null, c.token);
		const subject = (catalog.json.subjects || []).find((s) => s.name === 'Git');
		const topic = subject?.topics?.find((t) => t.id === topicId);
		if (!topic) throw new Error(`Git topic ${topicId} absent from /catalog`);
		const flight = await http('GET', `/api/assessments/catalog/${topicId}/availability?format=mcq&band=medium&count=10`, null, c.token);
		if (flight.status !== 200 || flight.json.promised !== 10 || flight.json.servable < 10 || flight.json.reason !== null) {
			throw new Error(`pre-flight mismatch: ${JSON.stringify(flight.json)}`);
		}
		const start = await http('POST', '/api/assessments/start', { topicId, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 }, c.token);
		if (start.status !== 200 || !start.json.sessionId || !start.json.question) {
			throw new Error(`configured start failed: ${start.status} ${JSON.stringify(start.json).slice(0, 200)}`);
		}
		const s = await db.query(
			'SELECT topic_id, format, difficulty_band, total_questions, current_difficulty, status FROM assessment_sessions WHERE id=$1',
			[start.json.sessionId],
		);
		const row = s.rows[0];
		const ok = row.topic_id === topicId && row.format === 'mcq' && row.difficulty_band === 'medium' && row.total_questions === 10 && row.current_difficulty === 3 && row.status === 'in_progress';
		rec('JT-C1 configured start serves exactly the chosen configuration (snapshot read back from DB)', ok ? 'PASS' : 'FAIL', { flight: flight.json, session: row });
	} catch (e) {
		rec('JT-C1 configured start serves exactly the chosen configuration (snapshot read back from DB)', 'FAIL', { error: e.message });
	}

	// ---------- JT-C4a: unservable count is honest before AND at start; session stays resumable ----------
	let servable = null;
	try {
		const c = await registerCandidate('c4a');
		const flight = await http('GET', `/api/assessments/catalog/${topicId}/availability?format=mcq&band=medium&count=100`, null, c.token);
		servable = flight.json.servable;
		if (flight.status !== 200 || servable >= 100 || !flight.json.reason || flight.json.largestAvailable !== servable) {
			throw new Error(`pre-flight for 100 not honest: ${JSON.stringify(flight.json)}`);
		}
		const start = await http('POST', '/api/assessments/start', { topicId, format: 'mcq', difficultyBand: 'medium', totalQuestions: 100 }, c.token);
		if (start.status !== 503 || start.json.code !== 'QUESTION_UNAVAILABLE' || start.json.promised !== 100 || start.json.largestAvailable !== servable || !start.json.sessionId) {
			throw new Error(`start-100 contract mismatch: ${start.status} ${JSON.stringify(start.json).slice(0, 200)}`);
		}
		const s = await db.query('SELECT status FROM assessment_sessions WHERE id=$1', [start.json.sessionId]);
		rec('JT-C4a unservable count: pre-flight reason + 503 {promised, largestAvailable} + resumable session', s.rows[0]?.status === 'in_progress' ? 'PASS' : 'FAIL', { flight: flight.json, startStatus: start.status, sessionStatus: s.rows[0]?.status });
	} catch (e) {
		rec('JT-C4a unservable count: pre-flight reason + 503 {promised, largestAvailable} + resumable session', 'FAIL', { error: e.message });
	}

	// ---------- JT-C4b: the labelled largestAvailable offer works ONLY when explicitly sent ----------
	try {
		if (servable == null || servable === 0 || [10, 25, 50, 100].includes(servable)) {
			rec('JT-C4b labelled largestAvailable acceptance', 'BLOCKED', { reason: `servable=${servable} is zero or an enum count on this bank — non-enum acceptance not exercisable` });
		} else {
			const c = await registerCandidate('c4b');
			const start = await http('POST', '/api/assessments/start', { topicId, format: 'mcq', difficultyBand: 'medium', totalQuestions: servable }, c.token);
			const s = start.json.sessionId ? await db.query('SELECT total_questions FROM assessment_sessions WHERE id=$1', [start.json.sessionId]) : { rows: [] };
			rec('JT-C4b labelled largestAvailable acceptance', start.status === 200 && s.rows[0]?.total_questions === servable ? 'PASS' : 'FAIL', { servable, startStatus: start.status, snapshotTotal: s.rows[0]?.total_questions ?? null });
		}
	} catch (e) {
		rec('JT-C4b labelled largestAvailable acceptance', 'FAIL', { error: e.message });
	}

	// ---------- JT-C4c: coding (flag off) and setId fail honestly ----------
	try {
		const c = await registerCandidate('c4c');
		const flight = await http('GET', `/api/assessments/catalog/${topicId}/availability?format=coding&band=medium&count=10`, null, c.token);
		const codingStart = await http('POST', '/api/assessments/start', { topicId, format: 'coding', difficultyBand: 'medium', totalQuestions: 10 }, c.token);
		const setStart = await http('POST', '/api/assessments/start', { topicId, setId: 1, format: 'mcq', difficultyBand: 'medium', totalQuestions: 10 }, c.token);
		const ok = flight.json.servable === 0 && !!flight.json.reason
			&& codingStart.status === 503 && codingStart.json.code === 'QUESTION_UNAVAILABLE'
			&& setStart.status === 400 && setStart.json.code === 'SETS_NOT_AVAILABLE';
		rec('JT-C4c coding-flag-off 503 + setId 400 SETS_NOT_AVAILABLE', ok ? 'PASS' : 'FAIL', { flight: flight.json, codingStatus: codingStart.status, setStatus: setStart.status, setCode: setStart.json.code });
	} catch (e) {
		rec('JT-C4c coding-flag-off 503 + setId 400 SETS_NOT_AVAILABLE', 'FAIL', { error: e.message });
	}

	await db.end();
	fs.writeFileSync(OUT, JSON.stringify({ run: RUN, steps }, null, 2));
	const fails = steps.filter((s) => s.verdict === 'FAIL').length;
	console.log(`\n${steps.length - fails}/${steps.length} legs PASS/BLOCKED, ${fails} FAIL — evidence: ${OUT}`);
	process.exit(fails ? 1 : 0);
})().catch(async (e) => {
	console.error('harness error:', e.message);
	try { await db.end(); } catch { /* noop */ }
	process.exit(1);
});
