// #1760 — career-coach prompt must never render the literal string "null"
// for unmeasured OmniScore compat columns (honestly null since #1596).
// Evaluates the actual "OmniScore breakdown" template segment from
// lib/career-coach-ai.js against mock candidates. Run: node scripts/check-1760-career-coach-null.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'career-coach-ai.js'), 'utf8');
const line = src.split('\n').find((l) => l.includes('OmniScore breakdown:'));
assert.ok(line, 'breakdown line not found in lib/career-coach-ai.js');
const segment = line.slice(line.indexOf('OmniScore breakdown:') + 'OmniScore breakdown:'.length).trim();
const render = new Function('candidate', `return \`${segment}\`;`);

// 1. Unmeasured: all four compat columns honestly null (#1596 state)
const unmeasured = render({
	omniscore: { interview_score: null, technical_score: null, resume_score: null, behavior_score: null },
});
assert.ok(!unmeasured.includes('null'), `unmeasured scores rendered "null": ${unmeasured}`);
assert.ok(!unmeasured.includes('undefined'), `unmeasured scores rendered "undefined": ${unmeasured}`);
assert.strictEqual((unmeasured.match(/N\/A/g) || []).length, 4, `expected 4x N/A, got: ${unmeasured}`);

// 2. No omni_scores row at all: omniscore is null, optional chain yields undefined
const noRow = render({ omniscore: null });
assert.ok(!noRow.includes('null') && !noRow.includes('undefined'), `missing row rendered bare: ${noRow}`);
assert.strictEqual((noRow.match(/N\/A/g) || []).length, 4, `expected 4x N/A, got: ${noRow}`);

// 3. Measured values pass through untouched — including a real 0 (?? must not eat it)
const measured = render({
	omniscore: { interview_score: 0, technical_score: 65, resume_score: 80, behavior_score: 58 },
});
assert.ok(measured.includes('Interview 0'), `measured 0 not preserved: ${measured}`);
assert.ok(measured.includes('Technical 65') && measured.includes('Resume 80') && measured.includes('Behavior 58'), `measured scores altered: ${measured}`);

console.log('PASS #1760: breakdown renders N/A for null/undefined scores, measured values (incl. 0) preserved');
console.log(`  unmeasured ->${unmeasured}`);
console.log(`  no row     ->${noRow}`);
console.log(`  measured   ->${measured}`);
