/**
 * Remove Quick Practice routes from interviews.js
 * Task #32717: Routes moved to routes/quick-practice.js
 */
const fs = require('fs');

const lines = fs.readFileSync('routes/interviews.js', 'utf8').split('\n');

// Find the start: "// =============== QUICK PRACTICE ROUTES — MOVED"
let startLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('QUICK PRACTICE ROUTES') || lines[i].includes('INTERVIEW PRACTICE & COACHING')) {
    startLine = i;
    break;
  }
}

// Find the end: "// =============== VIDEO ANALYSIS ==============="
let endLine = -1;
for (let i = startLine + 1; i < lines.length; i++) {
  if (lines[i].includes('=============== VIDEO ANALYSIS ===============')) {
    endLine = i;
    break;
  }
}

if (startLine === -1 || endLine === -1) {
  console.error('Could not find practice section boundaries');
  console.log('startLine:', startLine, 'endLine:', endLine);
  process.exit(1);
}

console.log(`Practice section: lines ${startLine + 1}-${endLine} (${endLine - startLine} lines)`);

// Replace the entire section with a comment
const replacement = [
  '// =============== QUICK PRACTICE — MOVED TO routes/quick-practice.js (#32717) ===============',
  '// All /practice/* routes have been decoupled from this file.',
  '// They now live in routes/quick-practice.js with their own AI pipeline (lib/qp-ai.js).',
  '// Changes to THIS file will NOT affect Quick Practice. That was the whole point.',
  '',
];

lines.splice(startLine, endLine - startLine, ...replacement);

fs.writeFileSync('routes/interviews.js', lines.join('\n'));
console.log(`Removed ${endLine - startLine} lines, replaced with ${replacement.length} lines`);
console.log(`interviews.js: ${lines.length} lines`);
