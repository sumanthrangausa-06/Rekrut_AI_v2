/**
 * #1492 — qp-ai / polsia-ai raw model-output parse-failure logs.
 *
 * lib/qp-ai.js logged the raw LLM response (substring 500/300) on parse
 * failures at 4 sites. The prompts embed the candidate's transcription /
 * response, so model output can quote candidate speech verbatim into
 * application logs — the surface #1179 closed for direct transcript logs.
 * The STOP 1 sweep found the identical 3 sites in lib/polsia-ai.js
 * (the parent module qp-ai was split from); class-first, both files are
 * pinned here.
 *
 * Treatment: type + char count only ("content not logged"). No behaviour
 * change: parse failure still throws / falls back exactly as before.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const QP = fs.readFileSync(path.join(ROOT, 'lib', 'qp-ai.js'), 'utf8');
const POLSIA = fs.readFileSync(path.join(ROOT, 'lib', 'polsia-ai.js'), 'utf8');

const RAW_PATTERNS = [
	/Raw LLM response:/,
	/could not be parsed\. Raw \(first \d+ chars\)/,
	/Failed to parse response\. First \d+ chars/,
	/String\(result\)\.substring\(0, \d+\)/,
	/rawVision\.substring\(0, \d+\)/,
	/text\.substring\(0, 300\)/,
];

describe('#1492 no raw model output in parse-failure logs', () => {
	test.each([
		['lib/qp-ai.js', QP],
		['lib/polsia-ai.js', POLSIA],
	])('%s contains no raw-output log pattern', (_name, src) => {
		for (const re of RAW_PATTERNS) {
			expect(src).not.toMatch(re);
		}
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
});
