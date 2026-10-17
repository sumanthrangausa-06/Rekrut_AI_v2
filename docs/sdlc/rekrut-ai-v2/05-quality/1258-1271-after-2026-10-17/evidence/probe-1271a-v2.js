// Follow-up: #1271(a) re-probe with correct response key (mutual_matches)
const fs = require('fs');
const B = 'http://127.0.0.1:3000';
const DIR = '/home/hatch/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1258-1271-after-run';
const MM = { email: 'quinn-1271-mm@example.com', pw: 'Quinn1271-Mm-Pw!' };
(async () => {
  const out = { checks: [] };
  const chk = (id, label, cond, detail) => { out.checks.push({ id, label, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${label} — ${detail}`); };
  const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: MM.email, password: MM.pw }) });
  const ld = await lr.json();
  const token = ld.accessToken || ld.token;
  chk('setup', 'login 200 + token', lr.status === 200 && !!token, `status=${lr.status}`);
  const r = await fetch(B + '/api/omniscore/mutual-matches', { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  out.status = r.status; out.body = body;
  const rows = body.mutual_matches || [];
  chk('1271a', 'mutual-matches 200', r.status === 200, `status=${r.status}`);
  chk('1271a', 'applied job row present (candidate applied, NO match_results row)', rows.length >= 1, `rows=${rows.length}`);
  const row = rows[0];
  if (row) {
    out.row = row;
    chk('1271a', 'skill_match === "Insufficient data"', row.signals?.skill_match === 'Insufficient data', `skill_match=${JSON.stringify(row.signals?.skill_match)}`);
    chk('1271a', 'no fabricated "50% match" in payload', !JSON.stringify(body).includes('50% match'), 'full JSON scan');
    const fitKeys = Object.keys(row).filter(k => typeof row[k] === 'number');
    out.numericFields = Object.fromEntries(fitKeys.map(k => [k, row[k]]));
    const fitKey = ['mutual_fit_score', 'mutual_fit', 'mutualFit', 'fit_score', 'mutual_score'].find(k => typeof row[k] === 'number');
    out.note = 'mutual_fit_score=0 is consistent with 0-strength NULL contribution, but NOT discriminating in this seed: company trust is also NULL (companyStrength=0), so the geometric mean is 0 under old code too. Discriminating live evidence = skill_match "Insufficient data" (old code printed "0% match" via ||0 in the label and used ||50 in strength). The strength math with non-zero other signals is covered by the merged unit suite omniscore-mutual-matches-1271.test.js run at this head (see evidence/jest-1271.log).';
    chk('1271a', 'NULL match contributes 0 strength -> mutual fit 0 (old ||50 would be >0 with candidate skill seeded)', fitKey ? row[fitKey] === 0 : false, `fitKey=${fitKey} value=${fitKey ? row[fitKey] : 'not found'} numericFields=${JSON.stringify(out.numericFields)}`);
  }
  out.summary = { total: out.checks.length, passed: out.checks.filter(x => x.pass).length, failed: out.checks.filter(x => !x.pass).length };
  fs.writeFileSync(DIR + '/evidence/api-probe-1271a-v2.json', JSON.stringify(out, null, 2));
  console.log('SUMMARY', JSON.stringify(out.summary));
})().catch(e => { console.error('ERR', e); process.exit(1); });
