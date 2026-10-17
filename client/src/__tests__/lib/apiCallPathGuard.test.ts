/**
 * #1306 — client-wide guard for the double-/api bug class (same class as #1040).
 *
 * lib/api.ts apiCall() prepends '/api' to its path argument itself, so any
 * call site passing a path that already starts with '/api/' produces
 * '/api/api/…' and 404s. QPBiometricConsent shipped exactly that, and its
 * component test mocked apiCall and asserted the wrong path as correct.
 *
 * This guard scans every non-test client source file for an apiCall path
 * argument starting with '/api/' and fails if one appears — the class
 * cannot recur silently.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(__dirname, '..', '..');
const FORBIDDEN = /apiCall\s*(?:<[\s\S]*?>)?\s*\(\s*['"`]\/api\//g;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === '__tests__' || entry === 'node_modules') continue;
			collectSourceFiles(full, out);
		} else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\.(ts|tsx|js|jsx)$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe('apiCall path guard pattern — positive controls (#1306 review)', () => {
	const BAD = [
		"await apiCall('/api/consent/record', { method: 'POST' })",
		'const d = await apiCall<ResultResponse>(`/api/questionnaire/result/${rid}`)',
		"const d = await apiCall<ScreeningResponseData>(\n\t\t\t`/api/questionnaire/response-by-application/${id}`,\n\t\t)",
		"await apiCall<Array<Array<Row>>>('/api/nested', {})",
		'await apiCall<Todo[]>("/api/doubled", {})',
	];
	const GOOD = [
		"await apiCall('/consent/record', { method: 'POST' })",
		'const d = await apiCall<ResultResponse>(`/questionnaire/result/${rid}`)',
		"await fetch('/api/consent/record', { method: 'POST' })", // raw fetch: '/api' is correct there
		"await apiCall(url, { method: 'POST' })", // non-literal path: not this guard's claim
	];
	it.each(BAD)('catches: %s', (snippet) => {
		expect(snippet.match(new RegExp(FORBIDDEN.source, 'g'))).not.toBeNull();
	});
	it.each(GOOD)('allows: %s', (snippet) => {
		expect(snippet.match(new RegExp(FORBIDDEN.source, 'g'))).toBeNull();
	});
});

describe('apiCall path guard (#1306)', () => {
	it("no client source file calls apiCall with an '/api/'-prefixed path", () => {
		const offenders: string[] = [];
		for (const file of collectSourceFiles(SRC_ROOT)) {
			const content = readFileSync(file, 'utf8');
			for (const match of content.matchAll(FORBIDDEN)) {
				const line = content.slice(0, match.index).split('\n').length;
				offenders.push(`${relative(SRC_ROOT, file)}:${line}: ${match[0]}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
