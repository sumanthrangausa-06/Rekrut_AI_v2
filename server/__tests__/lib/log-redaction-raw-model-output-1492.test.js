/**
 * #1492 — qp-ai / polsia-ai raw model-output parse-failure logs.
 *
 * lib/qp-ai.js logged the raw LLM response (substring 500/300) on parse
 * failures at 4 sites. The prompts embed the candidate's transcription /
 * response, so model output can quote candidate speech verbatim into
 * application logs — the surface #1179 closed for direct transcript logs.
 * The STOP 1 sweep found the identical 3 sites in lib/polsia-ai.js
 * (the parent module qp-ai was split from); class-first, both files are
 * pinned here. The polsia TTS cache log (system-generated speech text,
 * substring 50) was dispositioned onto #1492 from #1179 and is fixed too.
 *
 * Treatment: type + char count only ("content not logged"). No behaviour
 * change: parse failure still throws / falls back exactly as before.
 *
 * Two layers:
 * 1. Source pins for the 8 fixed sites (counts-only form).
 * 2. A CLASS GUARD over lib/ + routes/ + services/ + server/ + server.js:
 *    no console.* statement block may log a `.substring(...)` of anything
 *    other than an error `.message`. (Re-review BLOCK on PR #1495: the
 *    first version pinned only the two known files, so the same defect
 *    in a new file passed — the guard is now repo-wide and
 *    statement-scoped, which also resolves the nit that a file-wide
 *    `text.substring` pin would false-positive on non-log code.)
 *    Baseline exceptions, verified by this guard's own run: the two
 *    self-hosted-audio warn lines substring `(e.message || '')` — an
 *    error message, not model output or candidate content.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const QP = fs.readFileSync(path.join(ROOT, 'lib', 'qp-ai.js'), 'utf8');
const POLSIA = fs.readFileSync(path.join(ROOT, 'lib', 'polsia-ai.js'), 'utf8');

describe('#1492 fixed sites are counts-only', () => {
	test.each([
		['lib/qp-ai.js', QP],
		['lib/polsia-ai.js', POLSIA],
	])('%s contains no raw-output log label', (_name, src) => {
		expect(src).not.toMatch(/Raw LLM response:/);
		expect(src).not.toMatch(/could not be parsed\. Raw \(first \d+ chars\)/);
		expect(src).not.toMatch(/Failed to parse response\. First \d+ chars/);
	});

	test('qp-ai analysis + coaching logs are counts-only', () => {
		expect(QP).toMatch(/\[analysis\] Content analysis parse failed\. Response \(content not logged\):/);
		expect(QP).toMatch(/\[coaching\] Coaching parse failed\. Response \(content not logged\):/);
	});

	test('polsia-ai analysis + coaching logs are counts-only', () => {
		expect(POLSIA).toMatch(/\[analysis\] Content analysis parse failed\. Response \(content not logged\):/);
		expect(POLSIA).toMatch(/\[coaching\] Coaching parse failed\. Response \(content not logged\):/);
	});

	test('vision parse-failure logs are counts-only in both files', () => {
		expect(QP).toMatch(/\[video-analysis\] Vision result could not be parsed \(content not logged\):/);
		expect(POLSIA).toMatch(/\[video-analysis\] Vision result could not be parsed \(content not logged\):/);
	});

	test('qp-ai voice-quality parse-failure log is counts-only', () => {
		expect(QP).toMatch(/\[voice-quality\] Failed to parse response \(content not logged\):/);
	});

	test('polsia TTS cache log is counts-only', () => {
		expect(POLSIA).toMatch(/\[tts\] Cached audio for: \$\{truncatedText\.length\} chars \(content not logged\)/);
		expect(POLSIA).not.toMatch(/Cached audio for:.*substring/);
	});
});

describe('#1492 class guard — no console statement logs a content substring', () => {
	const FILES = [path.join(ROOT, 'server.js')];
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name === 'node_modules' || e.name === '__tests__') continue;
				walk(p);
			} else if (e.name.endsWith('.js')) FILES.push(p);
		}
	};
	for (const d of ['lib', 'routes', 'services', 'server']) walk(path.join(ROOT, d));

	// Extract console.* statement blocks by paren matching from the call.
	const consoleBlocks = (src) => {
		const blocks = [];
		const re = /console\.(log|warn|error|info|debug)\s*\(/g;
		let m;
		while ((m = re.exec(src)) !== null) {
			let depth = 0;
			let i = m.index + m[0].length - 1;
			for (; i < src.length; i++) {
				if (src[i] === '(') depth++;
				else if (src[i] === ')') {
					depth--;
					if (depth === 0) break;
				}
			}
			blocks.push({ index: m.index, text: src.slice(m.index, i + 1) });
		}
		return blocks;
	};

	// A substring is allowed only when its receiver is an error message:
	// `….message.substring(…)` or `(e.message || '').substring(…)`.
	const isErrorMessageSubstring = (block, subIdx) => {
		const before = block.slice(Math.max(0, subIdx - 40), subIdx);
		return /\.message\s*$/.test(before) || /\|\|\s*['"]{2}\)\s*$/.test(before);
	};

	test('no console block in any scanned file substrings content', () => {
		const offenders = [];
		for (const f of FILES) {
			const src = fs.readFileSync(f, 'utf8');
			for (const b of consoleBlocks(src)) {
				if (/Raw LLM response|Raw \(first \d+ chars\)|First \d+ chars:/.test(b.text)) {
					offenders.push(`${path.relative(ROOT, f)}: raw-output label`);
					continue;
				}
				let idx = b.text.indexOf('.substring(');
				while (idx !== -1) {
					if (!isErrorMessageSubstring(b.text, idx)) {
						offenders.push(`${path.relative(ROOT, f)}: ${b.text.slice(0, 120).replace(/\s+/g, ' ')}`);
						break;
					}
					idx = b.text.indexOf('.substring(', idx + 1);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
