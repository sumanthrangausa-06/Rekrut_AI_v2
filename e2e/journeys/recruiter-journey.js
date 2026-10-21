/* Quinn — USER-JOURNEY acceptance suite: RECRUITER CHAIN (issue #1589)
 * Sumanth directive 2026-10-21: think like a user. One continuous journey,
 * in the order a real recruiter lives it. Assertions target USER-VISIBLE
 * outcomes (what the recruiter sees / receives / can do, honest empty and
 * failure states) — never implementation internals.
 *
 * Real HTTP against a fresh-install dev build whose DB was built ONLY by
 * `node migrate.js`. Resulting state is read back from the DB.
 * Steps that need a live AI provider are recorded BLOCKED (provider-key
 * MAJOR) when the provider fails — never skipped, never fake-passed.
 *
 * Usage:
 *   JOURNEY_BASE_URL=http://127.0.0.1:3211 \
 *   JOURNEY_DB_URL=postgresql://postgres@127.0.0.1:55461/journeybaseline \
 *   JOURNEY_OUT=./recruiter-evidence.json node recruiter-journey.js
 * Exit code: 1 if any step FAILs, else 0 (BLOCKED does not fail the run).
 */
const fs = require('fs');
const { Client } = require('pg');

const BASE = process.env.JOURNEY_BASE_URL || 'http://127.0.0.1:3211';
const DBURL = process.env.JOURNEY_DB_URL;
const OUT = process.env.JOURNEY_OUT || 'recruiter-evidence.json';
const RUN = Date.now().toString(36) + 'r';

const steps = [];
function rec(step, verdict, evidence) {
  steps.push({ step, verdict, ...evidence });
  console.log(`[${verdict}] ${step} :: ${JSON.stringify(evidence).slice(0, 700)}`);
}
async function http(method, path, body, token) {
  // Auth endpoints carry a strict rate limit; a real user who hits it waits
  // and retries. Retry 429s with a pause instead of failing the journey.
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    if (r.status !== 429 || attempt === 3) return { status: r.status, json };
    await new Promise((res) => setTimeout(res, 70000));
  }
}

(async () => {
  const db = new Client({ connectionString: DBURL });
  await db.connect();
  const S = {};

  // ---------- 1. SIGN UP ----------
  try {
    const health = await http('GET', '/health');
    S.healthCommit = health.json.commit;
    const reg = await http('POST', '/api/auth/register', { email: `journey.rec${RUN}@journey${RUN}.com`, password: 'JourneyTest2026', name: 'Journey Recruiter', role: 'recruiter', company_name: `JourneyCorp${RUN}` });
    S.rToken = reg.json.token || reg.json.accessToken;
    S.recruiterId = reg.json.user?.id;
    S.companyId = reg.json.user?.company_id;
    const login = await http('POST', '/api/auth/login', { email: `journey.rec${RUN}@journey${RUN}.com`, password: 'JourneyTest2026' });
    if (login.json.token) S.rToken = login.json.token;
    const me = await http('GET', '/api/auth/me', null, S.rToken);
    const ok = !!S.rToken && !!S.companyId && login.status === 200 && me.status === 200;
    rec('1_signup_with_company_and_signin', ok ? 'PASS' : 'FAIL', { registerStatus: reg.status, recruiterId: S.recruiterId, companyId: S.companyId, loginStatus: login.status, meStatus: me.status, meRole: me.json.user?.role });
  } catch (e) { rec('1_signup_with_company_and_signin', 'FAIL', { error: e.message }); }

  // ---------- 2. COMPANY SETUP ----------
  try {
    const before = await http('GET', '/api/company/profile', null, S.rToken);
    const put = await http('PUT', '/api/company/profile', { description: 'JourneyCorp builds data teams.', website: 'https://example.com', industry: 'Technology' }, S.rToken);
    const after = await http('GET', '/api/company/profile', null, S.rToken);
    const prof = after.json.company || after.json.profile || after.json;
    const desc = prof.description || prof.about || null;
    const ok = after.status === 200 && !!prof && desc === 'JourneyCorp builds data teams.';
    rec('2_company_setup_reads_back', ok ? 'PASS' : 'FAIL', { beforeStatus: before.status, putStatus: put.status, putBody: put.json, afterStatus: after.status, companyName: prof.name || null, descriptionReadBack: desc });
  } catch (e) { rec('2_company_setup_reads_back', 'FAIL', { error: e.message }); }

  // ---------- 3. POST A JOB ----------
  try {
    const create = await http('POST', '/api/recruiter/jobs', { title: 'Data Analyst', description: 'Analyse product data and build dashboards for the hiring team using SQL and BI tools.', requirements: 'SQL, dashboards, stakeholder communication', location: 'Remote', job_type: 'full-time', salary_range: '80000-100000' }, S.rToken);
    S.jobId = create.json.job?.id || create.json.id;
    const list = await http('GET', '/api/recruiter/jobs', null, S.rToken);
    const jobs = list.json.jobs || list.json.data || [];
    const mine = Array.isArray(jobs) && jobs.some((j) => j.id === S.jobId);
    const row = S.jobId ? (await db.query('SELECT id, title, status FROM jobs WHERE id=$1', [S.jobId])).rows[0] : null;
    const ok = (create.status === 200 || create.status === 201) && !!S.jobId && mine && !!row;
    rec('3_post_job_visible', ok ? 'PASS' : 'FAIL', { createStatus: create.status, jobId: S.jobId, listStatus: list.status, visibleInRecruiterList: mine, dbRow: row || null, createBodySnippet: JSON.stringify(create.json).slice(0, 250) });
  } catch (e) { rec('3_post_job_visible', 'FAIL', { error: e.message }); }

  // ---------- SETUP APPLICANT (the person whose application the recruiter reviews) ----------
  try {
    const reg = await http('POST', '/api/auth/register', { email: `journey.cand${RUN}@example.com`, password: 'JourneyTest2026', name: 'Journey Candidate', role: 'candidate' });
    S.cToken = reg.json.token || reg.json.accessToken;
    S.candidateId = reg.json.user?.id;
    const apply = await http('POST', `/api/candidate/jobs/${S.jobId}/apply`, {}, S.cToken);
    const row = (await db.query('SELECT id, status FROM job_applications WHERE job_id=$1 AND candidate_id=$2', [S.jobId, S.candidateId])).rows[0];
    S.applicationId = row?.id;
    rec('setup_applicant_applies', row ? 'PASS' : 'FAIL', { candidateRegisterStatus: reg.status, applyStatus: apply.status, applicationId: S.applicationId || null });
  } catch (e) { rec('setup_applicant_applies', 'FAIL', { error: e.message }); }

  // ---------- 4. REVIEW APPLICANTS ----------
  try {
    const byJob = await http('GET', `/api/recruiter/jobs/${S.jobId}/applications`, null, S.rToken);
    const all = await http('GET', '/api/recruiter/applications', null, S.rToken);
    const fromJob = byJob.json.applications || byJob.json.data || [];
    const fromAll = all.json.applications || all.json.data || [];
    const seen = (Array.isArray(fromJob) && fromJob.some((a) => a.id === S.applicationId || a.candidate_id === S.candidateId)) ||
                 (Array.isArray(fromAll) && fromAll.some((a) => a.id === S.applicationId || a.candidate_id === S.candidateId));
    rec('4_review_applicants_sees_the_applicant', seen ? 'PASS' : 'FAIL', { byJobStatus: byJob.status, byJobCount: Array.isArray(fromJob) ? fromJob.length : null, allStatus: all.status, allCount: Array.isArray(fromAll) ? fromAll.length : null, applicantVisible: seen });
  } catch (e) { rec('4_review_applicants_sees_the_applicant', 'FAIL', { error: e.message }); }

  // ---------- 5. MOVE PIPELINE STAGES ----------
  try {
    const toScreening = await http('PUT', `/api/recruiter/applications/${S.applicationId}/status`, { status: 'screening' }, S.rToken);
    const midRow = (await db.query('SELECT status FROM job_applications WHERE id=$1', [S.applicationId])).rows[0];
    const toShortlisted = await http('PUT', `/api/recruiter/applications/${S.applicationId}/status`, { status: 'shortlisted' }, S.rToken);
    const endRow = (await db.query('SELECT status FROM job_applications WHERE id=$1', [S.applicationId])).rows[0];
    const pipeline = await http('GET', `/api/recruiter/pipeline/${S.jobId}`, null, S.rToken);
    const ok = toScreening.status === 200 && midRow?.status === 'screening' && toShortlisted.status === 200 && endRow?.status === 'shortlisted';
    rec('5_move_pipeline_stages_read_back', ok ? 'PASS' : 'FAIL', { toScreeningStatus: toScreening.status, statusAfterScreening: midRow?.status || null, toShortlistedStatus: toShortlisted.status, statusAfterShortlist: endRow?.status || null, pipelineViewStatus: pipeline.status });
  } catch (e) { rec('5_move_pipeline_stages_read_back', 'FAIL', { error: e.message }); }

  // ---------- 6. INTERVIEW ----------
  try {
    const sess = await http('POST', '/api/interviews/sessions', { type: 'human', job_id: S.jobId, application_id: S.applicationId, candidate_id: S.candidateId }, S.rToken);
    S.sessionId = sess.json.session?.id;
    const row = S.sessionId ? (await db.query('SELECT id, candidate_id, status FROM interview_sessions WHERE id=$1', [S.sessionId])).rows[0] : null;
    const list = await http('GET', '/api/recruiter/interviews', null, S.rToken);
    const ok = sess.status === 201 && !!row && Number(row.candidate_id) === Number(S.candidateId);
    rec('6_interview_created_for_candidate', ok ? 'PASS' : 'FAIL', { createStatus: sess.status, sessionId: S.sessionId || null, createBody: sess.json, dbRow: row || null, recruiterInterviewListStatus: list.status });
  } catch (e) { rec('6_interview_created_for_candidate', 'FAIL', { error: e.message }); }

  // ---------- 7. DECISION (offer, visible to the candidate) ----------
  try {
    const toOffered = await http('PUT', `/api/recruiter/applications/${S.applicationId}/status`, { status: 'offered' }, S.rToken);
    const offer = await http('POST', '/api/recruiter/offers', { candidate_id: S.candidateId, job_id: S.jobId, title: 'Data Analyst', salary: 95000, employment_type: 'full-time', location: 'Remote' }, S.rToken);
    S.offerId = offer.json.offer?.id || offer.json.id;
    const send = S.offerId ? await http('PUT', `/api/recruiter/offers/${S.offerId}/send`, {}, S.rToken) : { status: 0, json: {} };
    const candOffers = await http('GET', '/api/candidate/offers', null, S.cToken);
    const offers = candOffers.json.offers || candOffers.json.data || [];
    const candidateSees = Array.isArray(offers) && offers.some((o) => o.id === S.offerId || o.job_id === S.jobId);
    const appRow = (await db.query('SELECT status FROM job_applications WHERE id=$1', [S.applicationId])).rows[0];
    const offerRow = S.offerId ? (await db.query('SELECT id, status FROM offers WHERE id=$1', [S.offerId])).rows[0] : null;
    const ok = toOffered.status === 200 && appRow?.status === 'offered' && !!S.offerId && candidateSees;
    rec('7_decision_offer_reaches_candidate', ok ? 'PASS' : 'FAIL', { toOfferedStatus: toOffered.status, applicationStatus: appRow?.status || null, offerCreateStatus: offer.status, offerId: S.offerId || null, offerDbRow: offerRow || null, sendStatus: send.status, candidateOffersStatus: candOffers.status, candidateSeesOffer: candidateSees });
  } catch (e) { rec('7_decision_offer_reaches_candidate', 'FAIL', { error: e.message }); }

  const summary = {
    suite: 'recruiter-chain', issue: 1589, base: BASE, commit: S.healthCommit || null, run: RUN,
    counts: { PASS: steps.filter((s) => s.verdict === 'PASS').length, FAIL: steps.filter((s) => s.verdict === 'FAIL').length, BLOCKED: steps.filter((s) => s.verdict === 'BLOCKED').length },
    steps,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('SUMMARY', JSON.stringify(summary.counts));
  await db.end();
  process.exit(summary.counts.FAIL > 0 ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(2); });
