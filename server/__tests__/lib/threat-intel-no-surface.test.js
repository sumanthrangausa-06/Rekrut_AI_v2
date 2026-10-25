/**
 * #807 (S-090): threat-intel chassis — no-surface census.
 *
 * STOP 1 §3g suite 6: nothing built in this story is reachable by any
 * recruiter- or candidate-facing surface. No route file, no server.js
 * reference, no client code may mention threat_intel / threatIntel;
 * the new lib modules contain no logging at all (security C6 — the
 * simplest compliant state), so no log line or error can carry a
 * subject value, a fingerprint, or a payload.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '../../..');
const NEEDLE = /threat_intel|threatIntel/i;

function walk(dir, acc = []) {
	if (!fs.existsSync(dir)) return acc;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'build') continue;
			walk(full, acc);
		} else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
			acc.push(full);
		}
	}
	return acc;
}

describe('#807 no-surface census', () => {
	test('no reference to threat intel in routes/, server.js, or client/', () => {
		const files = [
			...walk(path.join(REPO_ROOT, 'routes')),
			...walk(path.join(REPO_ROOT, 'client')),
		];
		const serverJs = path.join(REPO_ROOT, 'server.js');
		if (fs.existsSync(serverJs)) files.push(serverJs);
		const offenders = files.filter((f) => NEEDLE.test(fs.readFileSync(f, 'utf8')));
		expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
	});

	test('no new route file exists for threat intel', () => {
		const routeDir = path.join(REPO_ROOT, 'routes');
		const names = fs.readdirSync(routeDir).filter((n) => /threat/i.test(n));
		expect(names).toEqual([]);
	});

	test('security C6: the new lib modules contain no logging calls at all', () => {
		for (const rel of ['lib/threatIntelChecks.js', 'lib/threatIntelFlag.js']) {
			const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
			expect(src).not.toMatch(/console\./);
		}
	});

	test('privacy C2: the fingerprint is never described with banned words in the new code/docs', () => {
		const targets = [
			'lib/threatIntelChecks.js',
			'lib/threatIntelFlag.js',
			'migrations/260_threat_intel_checks.js',
		];
		for (const rel of targets) {
			const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
			expect(src).not.toMatch(/anonymis/i);
			expect(src).not.toMatch(/irreversib/i);
		}
	});
});
