/**
 * #1179 (reopened) — routes/interviews.js transcript log sites + the
 * repo-wide class guard. #1494 — guard widening (names + forms) and
 * claim narrowing.
 *
 * The original #1179 sweep (PR #1491) missed routes/interviews.js
 * entirely: the issue inventory, the STOP 1 re-derivation, and Lead's
 * cross-check (which grep'd only `substring(0, 80)`) all looked at the
 * named files. The independent reviewer's final BLOCK (PR #1491
 * comment 6283731396) found 4 live sites here: two ENTIRE-transcript
 * hallucination logs and two 100-char substring logs.
 *
 * Two layers:
 * 1. Source pins for the 4 sites (counts-only form).
 * 2. A CLASS GUARD over routes/ + lib/ + services/ + server/ (details
 *    and exact claim in the guard's own describe block below).
 *    (Data fields like response_preview are not log statements
 *    and are out of this guard's scope by design.)
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'routes', 'interviews.js'), 'utf8');

describe('#1179 routes/interviews.js transcript logs are counts-only', () => {
	test('no console line interpolates transcribedText except as a .length count (template-interpolation form)', () => {
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

// ─── #1494 class guard ───────────────────────────────────────────────
//
// EXACT CLAIM (narrowed in #1494 — this replaces PR #1493's broader
// "the defect cannot silently survive in another file again"):
//   In every .js file under routes/ + lib/ + services/ + server/ +
//   server.js, no LOG STATEMENT may reference a listed
//   transcript-carrying variable other than as a count (a property
//   chain ending in `.length`). A "log statement" is a call to
//   console.<method>(...), to a logger named `logger` / `*Logger`
//   (e.g. `logger.info(...)`, `reqLogger.warn(...)`), or to a
//   standalone `log.<method>(...)`. The reference may appear in ANY
//   syntactic form inside the statement — template interpolation,
//   direct/bare argument, string concatenation, `.substring(...)` /
//   `.slice(...)` of the variable, or `String(x).substring(...)` —
//   the guard scans the whole statement text, not just `${...}`.
//   Statements are extracted by balanced-paren scanning that is
//   string/template/comment aware, so an inner `);` (e.g. from
//   `String(x)`) no longer truncates the statement (pre-#1494 bug).
//   SIMPLE TAINT: a variable assigned (same file, `=` or `+=`) a
//   STRING-BUILDING expression over a listed variable — a template
//   or concatenation built before the log call, a substring/slice
//   of it, or a plain alias assignment — is itself treated as
//   transcript-carrying for later log statements in that file.
//   A variable merely DERIVED from a transcript (e.g. a function's
//   return value) is not tainted: function returns are the
//   uncovered path below, and tainting derived values cascades
//   false positives through generic names (probed in #1494).
//
// NOT COVERED (documented in #1494 — cannot be guarded statically
// without false positives or a data-flow analysis this name-based
// guard does not do):
//   - transcript content reaching a log through a function call's
//     return value, an aliased property, or a renamed binding the
//     guard's name list does not know;
//   - logging a whole object that happens to hold transcript text
//     under an unlisted field name;
//   - loggers bound to names outside the set above (e.g. a logger
//     variable called `out`), and dynamically constructed calls.
//   Those paths are covered behaviourally, not statically: the
//   canary tests in log-redaction-1179.test.js assert a unique
//   transcript string never appears in emitted logs on the real
//   code paths they exercise.
describe('#1494 class guard — no log statement references transcript content', () => {
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

	// Transcript-carrying names: the #1179 list plus the #1494
	// additions live in today's tree (routes/interviews.js,
	// lib/qp-ai.js, lib/polsia-ai.js — all counts-only today).
	const TRANSCRIPT_VARS = [
		'transcribedText',
		'candidateText',
		'whisperText',
		'transcript',
		'result\\.text',
		'asrResult\\.text',
		// #1494 additions:
		'clientTranscript',
		'finalTranscription',
		'whisperResult\\.text',
		'allCandidateText',
	];
	const VAR_RE = new RegExp(`(?<![\\w$])(${TRANSCRIPT_VARS.join('|')})(?![\\w$])`, 'g');

	// Index just past the end of a call whose '(' is at openIdx,
	// tracking strings, template literals (incl. ${...}), and
	// comments so parens inside them do not end the statement early.
	const callEnd = (src, openIdx) => {
		let depth = 0;
		const stack = [];
		let i = openIdx;
		while (i < src.length) {
			const c = src[i];
			const n = src[i + 1] || '';
			const top = stack[stack.length - 1];
			if (top === 'sq' || top === 'dq') {
				if (c === '\\') i++;
				else if (c === (top === 'sq' ? "'" : '"')) stack.pop();
				i++;
				continue;
			}
			if (top === 'tpl') {
				if (c === '\\') { i += 2; continue; }
				if (c === '`') { stack.pop(); i++; continue; }
				if (c === '$' && n === '{') { stack.push({ expr: true, braces: 0 }); i += 2; continue; }
				i++;
				continue;
			}
			if (top === 'lc') { if (c === '\n') stack.pop(); i++; continue; }
			if (top === 'bc') { if (c === '*' && n === '/') { stack.pop(); i += 2; continue; } i++; continue; }
			if (c === '/' && n === '/') { stack.push('lc'); i += 2; continue; }
			if (c === '/' && n === '*') { stack.push('bc'); i += 2; continue; }
			if (c === "'") { stack.push('sq'); i++; continue; }
			if (c === '"') { stack.push('dq'); i++; continue; }
			if (c === '`') { stack.push('tpl'); i++; continue; }
			if (top && top.expr) {
				if (c === '{') { top.braces++; i++; continue; }
				if (c === '}') {
					if (top.braces === 0) { stack.pop(); i++; continue; }
					top.braces--; i++; continue;
				}
			}
			if (c === '(') depth++;
			else if (c === ')') { depth--; if (depth === 0) return i; }
			i++;
		}
		return src.length - 1;
	};

	const LOG_CALL_RE =
		/(?:console|[\w$]*[Ll]ogger)\.(?:log|warn|error|info|debug|trace)\s*\(|(?<![\w$.])log\.(?:log|warn|error|info|debug|trace)\s*\(/g;

	const logStatements = (src) => {
		const out = [];
		LOG_CALL_RE.lastIndex = 0;
		let m;
		while ((m = LOG_CALL_RE.exec(src)) !== null) {
			const openIdx = m.index + m[0].length - 1;
			const end = callEnd(src, openIdx);
			out.push(src.slice(m.index, end + 1));
			LOG_CALL_RE.lastIndex = end + 1;
		}
		return out;
	};

	// Mask literal text: contents of '...' / "..." strings and the
	// raw parts of template literals become spaces (delimiters and
	// ${...} code are kept). Prose in a log label ("...full
	// transcript...") is not a reference and must never be flagged;
	// masking also keeps parens inside labels out of callEnd.
	const maskLiterals = (src) => {
		const out = src.split('');
		const stack = [];
		let i = 0;
		while (i < src.length) {
			const c = src[i];
			const n = src[i + 1] || '';
			const top = stack[stack.length - 1];
			if (top === 'sq' || top === 'dq') {
				out[i] = ' ';
				if (c === '\\') { if (i + 1 < src.length) out[i + 1] = ' '; i += 2; continue; }
				if (c === (top === 'sq' ? "'" : '"')) { out[i] = c; stack.pop(); }
				i++;
				continue;
			}
			if (top === 'tpl') {
				if (c === '\\') { out[i] = ' '; if (i + 1 < src.length) out[i + 1] = ' '; i += 2; continue; }
				if (c === '`') { stack.pop(); i++; continue; }
				if (c === '$' && n === '{') { stack.push({ expr: true, braces: 0 }); i += 2; continue; }
				out[i] = ' ';
				i++;
				continue;
			}
			if (top === 'lc') { if (c === '\n') stack.pop(); i++; continue; }
			if (top === 'bc') { i++; continue; }
			if (c === '/' && n === '/') { stack.push('lc'); i += 2; continue; }
			if (c === '/' && n === '*') { stack.push('bc'); i += 2; continue; }
			if (c === "'") { stack.push('sq'); i++; continue; }
			if (c === '"') { stack.push('dq'); i++; continue; }
			if (c === '`') { stack.push('tpl'); i++; continue; }
			if (top && top.expr) {
				if (c === '{') top.braces++;
				else if (c === '}') {
					if (top.braces === 0) { stack.pop(); i++; continue; }
					top.braces--;
				}
			}
			i++;
		}
		return out.join('');
	};

	// Is the reference ending at idx used as a COUNT — i.e. does its
	// value flow into a `.length`? Handles the direct chain
	// (`x.length`, `x.split(' ').length`), a parenthesised/fallback
	// wrap (`(x || '').length`), and plain chains ending elsewhere
	// (`x.substring(0, 9)`, `x.trim()`, bare `x` → not counts).
	// Operates on masked text (literal contents are spaces).
	const isCountRef = (src, idx) => {
		let i = idx;
		for (;;) {
			const prop = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(src.slice(i));
			if (prop) {
				if (prop[1] === 'length') return true;
				i += prop[0].length;
				let j = i;
				while (j < src.length && /\s/.test(src[j])) j++;
				if (src[j] === '(') i = callEnd(src, j) + 1;
				continue;
			}
			let j = i;
			while (j < src.length && /\s/.test(src[j])) j++;
			if (src[j] === ')') { i = j + 1; continue; }
			if (src.startsWith('||', j) || src.startsWith('??', j)) {
				let k = j + 2;
				while (k < src.length && /\s/.test(src[k])) k++;
				if (src[k] === '(') k = callEnd(src, k) + 1;
				else if (src[k] === "'" || src[k] === '"') {
					const q = src[k];
					k++;
					while (k < src.length && src[k] !== q) k++;
					k++;
				} else {
					const tok = /^[\w$.]+/.exec(src.slice(k));
					if (tok) {
						k += tok[0].length;
						let l = k;
						while (l < src.length && /\s/.test(src[l])) l++;
						if (src[l] === '(') k = callEnd(src, l) + 1;
					}
				}
				i = k;
				continue;
			}
			return false;
		}
	};

	// All content (non-count) references to any name in nameRes,
	// in masked text. Returns [{name, index}].
	const contentRefs = (text, nameRes) => {
		const hits = [];
		for (const re of nameRes) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(text)) !== null) {
				if (!isCountRef(text, m.index + m[0].length)) hits.push({ name: m[0], index: m.index });
			}
		}
		return hits;
	};

	// Does a reference at `index` in masked RHS text take part in a
	// STRING-BUILDING form? (template ${...}, concatenation,
	// substring/slice chain, or the RHS is the reference itself —
	// an alias). A reference passed only as a function-call
	// argument (`countWords(transcribedText)`) does NOT taint:
	// function returns are the documented uncovered path, and
	// tainting derived values cascades false positives through
	// generic names (response / data / err) — probed live in #1494.
	const refBuildsString = (rhs, hit) => {
		const before = rhs.slice(0, hit.index);
		if (before.lastIndexOf('${') > before.lastIndexOf('}')) return true; // inside ${...}
		if (/\+(?![+=])/.test(rhs)) return true; // concatenation present
		// substring/slice chain on the reference itself
		let i = hit.index + hit.name.length;
		for (;;) {
			const prop = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(rhs.slice(i));
			if (!prop) break;
			if (['substring', 'slice', 'substr'].includes(prop[1])) return true;
			i += prop[0].length;
			let j = i;
			while (j < rhs.length && /\s/.test(rhs[j])) j++;
			if (rhs[j] === '(') i = callEnd(rhs, j) + 1;
			else break;
		}
		// alias: RHS (after optional '(') starts with the reference
		const trimmed = rhs.replace(/^\s*\(?\s*/, '');
		return trimmed.startsWith(hit.name);
	};

	// Simple same-file taint: `x = <expr>;` / `x += <expr>;` taints
	// x only when a content reference in <expr> builds a string
	// (above); a clean `=` assignment untaints x.
	const taintedNames = (src) => {
		const masked = maskLiterals(src);
		const tainted = new Set();
		const assignRe = /(?:^|[;\n}])\s*(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*(\+?=)(?![=>])\s*/g;
		let m;
		while ((m = assignRe.exec(masked)) !== null) {
			const rhsStart = m.index + m[0].length;
			const semi = masked.indexOf(';', rhsStart);
			const rhs = masked.slice(rhsStart, semi === -1 ? rhsStart + 400 : semi);
			const res = [VAR_RE, ...[...tainted].map((t) => new RegExp(`(?<![\\w$])${t}(?![\\w$])`, 'g'))];
			const builds = contentRefs(rhs, res).some((h) => refBuildsString(rhs, h));
			if (builds) tainted.add(m[1]);
			else if (m[2] === '=') tainted.delete(m[1]);
		}
		return tainted;
	};

	const findOffences = (src) => {
		const tainted = taintedNames(src);
		const res = [VAR_RE, ...[...tainted].map((t) => new RegExp(`(?<![\\w$])${t}(?![\\w$])`, 'g'))];
		const offences = [];
		for (const stmt of logStatements(src)) {
			const hits = contentRefs(maskLiterals(stmt), res);
			if (hits.length) offences.push(`${hits.map((h) => h.name).join(', ')} :: ${stmt.replace(/\s+/g, ' ').slice(0, 110)}`);
		}
		return offences;
	};

	test('guard corpus is non-trivial (scanning the real tree)', () => {
		expect(FILES.length).toBeGreaterThan(100);
	});

	test('no log statement in the corpus references a listed transcript variable except as a count', () => {
		const offenders = [];
		for (const file of FILES) {
			const src = fs.readFileSync(file, 'utf8');
			for (const o of findOffences(src)) offenders.push(`${path.relative(ROOT, file)}: ${o}`);
		}
		expect(offenders).toEqual([]);
	});

	// Planted mutants as strings — each leaked on the pre-#1494 guard
	// (verified live against planted files in lib/, PR evidence) and
	// must be caught now. These are the guard's regression check.
	test.each([
		['new name: clientTranscript interpolation', 'console.log(`ct: ${clientTranscript}`);'],
		['new name: finalTranscription interpolation', 'console.log(`ft: ${finalTranscription}`);'],
		['new name: whisperResult.text interpolation', 'console.log(`wr: ${whisperResult.text}`);'],
		['new name: allCandidateText interpolation', 'console.log(`act: ${allCandidateText}`);'],
		['direct argument', "console.log('transcript:', transcribedText);"],
		['bare argument', 'console.warn(transcribedText);'],
		['string concatenation', "console.log('heard: ' + transcribedText);"],
		['String(x).substring(...) argument', 'console.log(String(transcribedText).substring(0, 50));'],
		['direct substring argument', 'console.log(transcribedText.substring(0, 50));'],
		['guarded substring argument (inner parens before the reference)', "console.log('x', (transcribedText || '').substring(0, 30));"],
		['template built into a variable first', 'const msg = `heard: ${transcribedText}`;\nconsole.log(msg);'],
		['concatenation built into a variable first', "let msg = 'heard: ' + candidateText;\nconsole.info(msg);"],
		['alias assignment built before the log call', 'const alias = transcribedText;\nconsole.log(alias);'],
		['non-console logger: interpolation', 'logger.info(`heard: ${transcribedText}`);'],
		['non-console logger: direct argument', "logger.error('candidate said', candidateText);"],
		['standalone log: interpolation', 'log.debug(`wr: ${whisperText}`);'],
	])('detector catches mutant — %s', (_name, src) => {
		expect(findOffences(src).length).toBeGreaterThan(0);
	});

	// Counts-only forms must NOT be flagged (false positives would
	// teach developers to delete the guard).
	test.each([
		['counts-only interpolation', 'console.log(`t: ${transcribedText.length} chars`);'],
		['counts-only new name', 'console.log(`ct: ${clientTranscript.length} chars`);'],
		['count chain ending in .length', "console.log(allCandidateText.split(' ').length);"],
		['tainted variable logged as count only', 'const msg = `heard: ${transcribedText}`;\nconsole.log(msg.length);'],
		['unrelated log', "console.log('server up', port);"],
		['transcript variable used outside a log statement', 'const n = transcribedText.length;\nfoo(transcribedText);'],
		['parenthesised fallback count', "console.log(`${(result.text || '').length} chars`);"],
		['prose label mentioning a transcript word', "console.log('Running analysis on full transcript...');"],
		['derived value (function return) is not tainted', 'const n = countWords(transcribedText);\nconsole.log(n);'],
	])('detector allows clean form — %s', (_name, src) => {
		expect(findOffences(src)).toEqual([]);
	});
});
