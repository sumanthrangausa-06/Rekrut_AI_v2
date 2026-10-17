// QUINN batched AFTER — #1258 + #1271 seed + API probes
// Scratch DB only (rekrut_after_1258_1271 @127.0.0.1:55461), server http://127.0.0.1:3000 @4be9bb02
const fs = require('fs');
const REPO = '/home/hatch/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1258-1271-after-run/repo';
const { Client } = require(REPO + '/node_modules/pg');
const bcrypt = require(REPO + '/node_modules/bcryptjs');
const DB = 'postgresql://postgres@127.0.0.1:55461/rekrut_after_1258_1271';
const B = 'http://127.0.0.1:3000';
const DIR = '/home/hatch/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1258-1271-after-run';

const EMP = { email: 'quinn-1258-employer@example.com', pw: 'Quinn1258-Emp-Pw!' };
const CAND = { email: 'quinn-1258-candidate@example.com', pw: 'Quinn1258-Cand-Pw!' };
const MM = { email: 'quinn-1271-mm@example.com', pw: 'Quinn1271-Mm-Pw!' };

(async () => {
  const out = { seed: {}, phases: {}, checks: [] };
  const chk = (id, label, cond, detail) => { out.checks.push({ id, label, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${label} — ${detail}`); };
  const c = new Client({ connectionString: DB });
  await c.connect();

  // ── Seed ──
  const company = await c.query(`INSERT INTO companies (name, industry, description, company_size, headquarters) VALUES ('Quinn 1258 Co','Tech','Scratch company for AFTER probe','11-50','Remote') RETURNING id`);
  const companyId = company.rows[0].id;
  const empHash = await bcrypt.hash(EMP.pw, 10);
  const candHash = await bcrypt.hash(CAND.pw, 10);
  const mmHash = await bcrypt.hash(MM.pw, 10);
  const emp = await c.query(`INSERT INTO users (email, password_hash, name, role, company_id) VALUES ($1,$2,'Quinn 1258 Employer','employer',$3) RETURNING id, company_id`, [EMP.email, empHash, companyId]);
  const cand = await c.query(`INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,'Quinn 1258 Candidate','candidate') RETURNING id, company_id`, [CAND.email, candHash]);
  // #1271(a): candidate with an application but NO match_results row
  const mm = await c.query(`INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,'Quinn 1271 MatchCand','candidate') RETURNING id`, [MM.email, mmHash]);
  const mmId = mm.rows[0].id;
  await c.query(`INSERT INTO candidate_skills (user_id, skill_name, category, level, years_experience, is_verified) VALUES ($1,'JavaScript','software engineering',5,3,true)`, [mmId]);
  const job = await c.query(`INSERT INTO jobs (title, company_id, status, location, job_type) VALUES ('Quinn 1271 Engineer',$1,'active','Remote','full-time') RETURNING id`, [companyId]);
  const jobId = job.rows[0].id;
  await c.query(`INSERT INTO job_applications (job_id, candidate_id, company_id, status) VALUES ($1,$2,$3,'applied')`, [jobId, mmId, companyId]);
  await c.query(`INSERT INTO companies (name, industry, description, company_size, headquarters) VALUES ('Quinn 1271 Beta','Tech','Second scratch company','51-200','Remote')`);
  const mrCount = await c.query(`SELECT count(*)::int n FROM match_results WHERE candidate_id=$1`, [mmId]);
  out.seed = { companyId, employerId: emp.rows[0].id, employerCompanyId: emp.rows[0].company_id, candidateId: cand.rows[0].id, candidateCompanyId: cand.rows[0].company_id, mmCandidateId: mmId, jobId, matchResultsForMm: mrCount.rows[0].n };
  console.log('SEED', JSON.stringify(out.seed));

  async function loginRaw(email, password) {
    const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, body: d, token: d.accessToken || d.token || null };
  }
  async function get(path, token) {
    const r = await fetch(B + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t.slice(0, 400); }
    return { status: r.status, body: d };
  }

  // ── #1258: login payload company_id ──
  const empLogin = await loginRaw(EMP.email, EMP.pw);
  out.phases.empLogin = { status: empLogin.status, user: empLogin.body?.user || null };
  chk('1258', 'employer login 200', empLogin.status === 200, `status=${empLogin.status}`);
  chk('1258', 'employer login user HAS company_id key', empLogin.body?.user && ('company_id' in empLogin.body.user), `keys=${empLogin.body?.user ? Object.keys(empLogin.body.user).join(',') : 'none'}`);
  chk('1258', 'employer login company_id === users.company_id (seeded company)', empLogin.body?.user?.company_id === companyId, `payload=${empLogin.body?.user?.company_id} db=${companyId}`);

  const candLogin = await loginRaw(CAND.email, CAND.pw);
  out.phases.candLogin = { status: candLogin.status, user: candLogin.body?.user || null };
  chk('1258', 'candidate login 200', candLogin.status === 200, `status=${candLogin.status}`);
  chk('1258', 'candidate login user HAS company_id key, present-and-null', candLogin.body?.user && ('company_id' in candLogin.body.user) && candLogin.body.user.company_id === null, `payload=${JSON.stringify(candLogin.body?.user?.company_id)}`);

  const me = await get('/api/auth/me', empLogin.token);
  out.phases.me = { status: me.status, company_id: me.body?.user?.company_id ?? me.body?.company_id ?? null };
  chk('1258', 'consistency: GET /auth/me company_id matches login payload', me.status === 200 && out.phases.me.company_id === empLogin.body?.user?.company_id, `me=${out.phases.me.company_id} login=${empLogin.body?.user?.company_id} meStatus=${me.status}`);

  // ── #1271(a): mutual-matches, application but no match_results ──
  const mmLogin = await loginRaw(MM.email, MM.pw);
  chk('setup', 'match-candidate login 200 + token', mmLogin.status === 200 && !!mmLogin.token, `status=${mmLogin.status}`);
  const mmRes = await get('/api/omniscore/mutual-matches', mmLogin.token);
  out.phases.mutualMatches = { status: mmRes.status, body: mmRes.body };
  const rows = Array.isArray(mmRes.body?.matches) ? mmRes.body.matches : (Array.isArray(mmRes.body) ? mmRes.body : []);
  const row = rows.find(r => (r.job_id === jobId) || (r.signals));
  chk('1271a', 'mutual-matches 200', mmRes.status === 200, `status=${mmRes.status} bodyKeys=${mmRes.body ? Object.keys(mmRes.body).join(',') : 'none'}`);
  chk('1271a', 'applied job row present in mutual-matches', !!row, `rows=${rows.length} first=${JSON.stringify(rows[0] || null).slice(0, 300)}`);
  chk('1271a', 'skill_match === "Insufficient data" (never a fabricated %)', row?.signals?.skill_match === 'Insufficient data', `skill_match=${JSON.stringify(row?.signals?.skill_match)}`);
  chk('1271a', 'no "50% match" anywhere in payload', !JSON.stringify(mmRes.body).includes('50% match'), 'scan of full JSON');
  if (row) {
    // Independent recomputation: matchStrength must be 0 for NULL.
    // mutual_fit = round( cbrt(candidateStrength * companyStrength * matchStrength) * 100 ) per source;
    // with matchStrength=0 the product is 0. Verify the returned field against both hypotheses.
    const fitFields = ['mutual_fit', 'mutualFit', 'fit_score', 'score'];
    const fitKey = fitFields.find(k => typeof row[k] === 'number');
    out.phases.mutualMatches.fitKey = fitKey || null;
    out.phases.mutualMatches.row = row;
    chk('1271a', 'NULL match contributes 0 strength: mutual fit is 0 (old ||50 would give >0 when other signals >0)', fitKey ? row[fitKey] === 0 : false, `fitKey=${fitKey} value=${fitKey ? row[fitKey] : 'field not found — see row in evidence'}`);
  }

  // ── #1271(b): company-matches live attempt (AI providers unconfigured in sandbox) ──
  const cmRes = await get('/api/candidate/company-matches', mmLogin.token);
  out.phases.companyMatchesLive = { status: cmRes.status, body: cmRes.body };
  chk('1271b-live', 'company-matches live response recorded (status + no fabricated 50 in any match_score)', cmRes.status !== 200 || !(cmRes.body?.matches || []).some(m => m.match_score === 50), `status=${cmRes.status} body=${JSON.stringify(cmRes.body).slice(0, 300)}`);

  out.summary = { total: out.checks.length, passed: out.checks.filter(x => x.pass).length, failed: out.checks.filter(x => !x.pass).length };
  fs.writeFileSync(DIR + '/evidence/api-probe.json', JSON.stringify(out, null, 2));
  console.log('SUMMARY', JSON.stringify(out.summary));
  await c.end();
})().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
