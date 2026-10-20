/**
 * #1179 (reopened) — routes/interviews.js transcript log sites + the
 * repo-wide class guard.
 *
 * The original #1179 sweep (PR #1491) missed routes/interviews.js
 * entirely: the issue inventory, the STOP 1 re-derivation, and Lead's
 * cross-check (which grep'd only `substring(0, 80)`) all looked at the
 * named files. The independent reviewer's final BLOCK (PR #1491
 * comment 6283731396) found 4 live sites here: two ENTIRE-transcript
 * hallucination logs and two 100-char substring logs.
 *
 * Two layers:
 * 1. Source pins for the 4 sites (counts-only form, no interpolation
 *    of the transcript variable in any console statement).
 * 2. A CLASS GUARD over routes/ + lib/ + services/ + server/: no
 *    console.* statement may interpolate a transcript-shaped variable
 *    (transcribedText / candidateText / whisperText / transcript /
 *    result.text / asrResult.text) — bare or substring'd, ANY length.
 *    This is the guard the original sweep lacked; it fails if this
 *    defect class reappears in any file, not just the known ones.
 *    (Data fields like response_preview are not console statements
 *    and are out of this guard's scope by design.)
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'routes', 'interviews.js'), 'utf8');

describe('#1179 routes/interviews.js transcript logs are counts-only', () => {
	test('no console statement interpolates transcribedText (any form)', () => {
		const consoleLines = SRC.split('\n').filter((l) => /console\.(log|warn|error|info|debug)/.test(l));
		const offenders = consoleLines.filter((l) => /\$\{[^}]*transcribedText/.test(l) && !/\$\{\s*transcribedText\.length\s*\}/.test(l));
		expect(offenders).toEqual([]);
	});

	test('both hallucination logs use the counts-only form', () => {
		expect(SRC).toMatch(/\[voice-respond\] Filtered Whisper hallucination: \$\{transcribedText\.length\} chars \(content not logged\)/);
		expect(SRC).toMatch(/\[screening-voice\] Filtered Whisper hallucination: \$\{transcribedText\.length\} chars \(content not logged\)/);
	});

	test('ASR + fallback logs report char counts', () => {
		expect(SRC).toMatch(/\[voice-respond\] ASR transcription: \$\{transcribedText\.length\} chars/);
		expect(SRC).toMatch(/\[voice-respond\] Using client SpeechRecognition fallback: \$\{transcribedText\.length\} chars/);
	});
});

describe('#1179 class guard — no console line anywhere interpolates transcript text', () => {
	const DIRS = ['routes', 'lib', 'services', 'server'];
	const FILES = [];
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name === 'node_modules' || e.name === '__tests__') continue;
				walk(p);
			} else if (e.name.endsWith('.js')) FILES.push(p);
		}
	};
	for (const d of DIRS) walk(path.join(ROOT, d));
	FILES.push(path.join(ROOT, 'server.js'));

	// A transcript interpolation inside a console statement: the
	// variable appears inside ${...} NOT as a bare `.length` count.
	// Console statements can span multiple lines (template literal
	// opened on the console line, interpolation on the next), so each
	// file is scanned per console-statement block (console.* up to the
	// closing `);`).
	const TRANSCRIPT_VARS =
		/\$\{[^}]*\b(transcribedText|candidateText|whisperText|transcript|result\.text|asrResult\.text)\b(?!\.length\s*\})/;

	test('guard corpus is non-trivial (scanning the real tree)', () => {
		expect(FILES.length).toBeGreaterThan(100);
	});

	test('no console statement interpolates a transcript variable (bare or substring, any length)', () => {
		const offenders = [];
		for (const file of FILES) {
			const src = fs.readFileSync(file, 'utf8');
			const blocks = src.split(/(?=console\.(?:log|warn|error|info|debug)\()/);
			for (const block of blocks) {
				if (!/^console\./.test(block)) continue;
				const stmt = block.slice(0, block.indexOf(');') + 2 || undefined);
				// Lines that only REPORT a length are the fixed form.
				const bad = stmt.split('\n').filter((l) => TRANSCRIPT_VARS.test(l) && !/\.length\}?\s*(chars|%|\)|;|,|$)/.test(l) && !/\$\{[^}]*\.length\s*\}/.test(l));
				if (bad.length) offenders.push(`${path.relative(ROOT, file)}: ${bad[0].trim().slice(0, 110)}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
