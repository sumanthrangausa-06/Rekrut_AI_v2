// Guard for #1574: chat must never fabricate a "typing" presence signal.
// Fails if the demo simulation (or any resurrection of its state) is present
// in the shared chat component. Run: node scripts/check-no-simulated-typing.js
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'client', 'src', 'components', 'domain', 'chat.tsx');
const src = fs.readFileSync(file, 'utf8');
const banned = ['Simulate typing indicator', 'Math.random() > 0.7', 'setTypingUsers', 'typingUsers'];
let fail = 0;
for (const pat of banned) {
  if (src.includes(pat)) { console.error(`FAIL: found '${pat}' in chat.tsx`); fail = 1; }
}
if (!fail) console.log('PASS: no simulated typing indicator in chat.tsx');
process.exit(fail);
