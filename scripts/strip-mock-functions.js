/**
 * Script to create qp-ai.js by stripping Mock Interview functions from polsia-ai.js
 * Task #32717: Decouple Quick Practice from Mock Interview
 */
const fs = require('fs');

let code = fs.readFileSync('lib/polsia-ai.js', 'utf8');

// Step 1: Replace the ai-provider import
code = code.replace(
  "// AI Provider Fallback Service — auto-switches providers on failure\nconst aiProvider = require('./ai-provider');",
  "// ISOLATED Quick Practice AI Provider — decoupled from Mock Interview (#32717)\n// Changes to polsia-ai.js or ai-provider.js will NOT affect Quick Practice.\nconst aiProvider = require('./qp-provider');"
);

// Step 2: Find all top-level function boundaries
const funcPattern = /^(?:async )?function (\w+)\(/;
const codeLines = code.split('\n');
const topLevelEntities = [];

for (let i = 0; i < codeLines.length; i++) {
  const match = codeLines[i].match(funcPattern);
  if (match) {
    // Find the comment block start for this function
    let commentStart = i;
    while (commentStart > 0) {
      const prevLine = codeLines[commentStart - 1].trim();
      if (prevLine === '' || prevLine.startsWith('//') || prevLine.startsWith('*') || prevLine.startsWith('/**') || prevLine === '*/') {
        commentStart--;
      } else {
        break;
      }
    }
    topLevelEntities.push({ name: match[1], lineNum: i, blockStart: commentStart });
  }
}
// Add module.exports as the final boundary
for (let i = 0; i < codeLines.length; i++) {
  if (codeLines[i].startsWith('module.exports')) {
    let commentStart = i;
    while (commentStart > 0) {
      const prevLine = codeLines[commentStart - 1].trim();
      if (prevLine === '' || prevLine.startsWith('//') || prevLine.startsWith('*') || prevLine.startsWith('/**')) {
        commentStart--;
      } else {
        break;
      }
    }
    topLevelEntities.push({ name: '__exports__', lineNum: i, blockStart: commentStart });
    break;
  }
}

console.log('Top-level entities:');
topLevelEntities.forEach(e => console.log(`  ${e.name}: func=L${e.lineNum + 1}, block=L${e.blockStart + 1}`));

// Step 3: Functions to REMOVE
const removeFunctions = new Set([
  'generateInterviewQuestions',
  'generateOverallFeedback',
  'parseResume',
  'generateSkillAssessment',
  'evaluateSkillAssessment',
  'generateJobMatchScore',
  'generateQuestionBank',
  'conductInterviewTurn',
  'generateSessionFeedback',
  'textToSpeech',
]);

// Step 4: Build line ranges to remove
// Each function's range: from its own blockStart to the NEXT entity's blockStart
const removeRanges = [];
for (let idx = 0; idx < topLevelEntities.length; idx++) {
  const entity = topLevelEntities[idx];
  if (!removeFunctions.has(entity.name)) continue;

  const startLine = entity.blockStart;
  const nextEntity = topLevelEntities[idx + 1];
  // End at the next entity's comment block start (not its function line)
  const endLine = nextEntity ? nextEntity.blockStart : codeLines.length;

  removeRanges.push({ name: entity.name, startLine, endLine });
  console.log(`Remove ${entity.name}: lines ${startLine + 1}-${endLine} (${endLine - startLine} lines)`);
}

// Step 5: Remove from bottom to top
removeRanges.sort((a, b) => b.startLine - a.startLine);
for (const range of removeRanges) {
  const replacement = `// [REMOVED] ${range.name} — not used by Quick Practice (lives in polsia-ai.js)\n`;
  codeLines.splice(range.startLine, range.endLine - range.startLine, replacement);
}

code = codeLines.join('\n');

// Step 6: Replace exports
code = code.replace(
  /module\.exports = \{[\s\S]*?\};/,
  `// ─── QUICK PRACTICE EXPORTS ONLY ───────────────────────────────
// This module is ISOLATED from Mock Interview. Only export functions
// that Quick Practice actually uses. Mock Interview functions removed.
module.exports = {
  chat,
  analyzeInterviewResponse,
  generateInterviewCoaching,
  analyzeVideoPresentation,
  analyzeSpeechPatterns,
  transcribeAudioWithWhisper,
  analyzeVoiceQuality,
  analyzeVideoInterviewResponse,
  uploadFrameToR2,
  safeParseJSON,
  handleAIError,
  aiProvider,
};`
);

fs.writeFileSync('lib/qp-ai.js', code);
const origLines = fs.readFileSync('lib/polsia-ai.js', 'utf8').split('\n').length;
const newLines = code.split('\n').length;
console.log(`\nDone! Original: ${origLines} lines → QP fork: ${newLines} lines (removed ${origLines - newLines})`);
