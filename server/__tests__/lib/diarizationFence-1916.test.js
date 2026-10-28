/**
 * diarizationFence-1916.test.js — S-D14 (#1916) presentation-only fence,
 * AC-1: dependency direction (Architecture §6.2 way 2, PRD FR-D14, Lex BR-12).
 *
 * Diarization output is PRESENTATION ONLY: it must never become a scoring
 * input. That is enforced mechanically here, not by promise:
 *
 *   1. No OmniScore / Trust Score / matching / screening module (set S)
 *      imports a diarization module (set D).
 *   2. No diarization module imports a scoring module (the reverse edge
 *      would let labels flow back just as surely).
 *   3. Repo-wide backstop: NO non-test source file outside the explicit
 *      allowlist may import a diarization module at all — so a scoring
 *      file created tomorrow, not yet listed in set S, is still caught.
 *   4. Set-completeness: a NEW file whose name marks it as a diarization
 *      or scoring/matching/screening module must be added to the sets
 *      below — the fence cannot silently vacate by rename or addition.
 *
 * Static import-specifier scan in the style of diarizationPinning-1907:
 * every require()/import/export-from specifier in the file is resolved
 * against the repo tree the way Node resolves it (extension- and
 * index-normalised) and compared by canonical path. This suite itself
 * is a test file and is excluded from the repo-wide scan by design; it
 * names the forbidden modules to forbid them.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..', '..');
const toPosix = (p) => p.split(path.sep).join('/');

// ── Set D: diarization-owned modules ────────────────────────────────────
// lib/transcription.js is deliberately NOT here: it is the shared,
// pre-existing ASR module that predates this feature.
const DIARIZATION_MODULES = [
	'lib/diarizationEngine.js',
	'lib/diarizationJobs.js',
	'lib/diarizationGate.js',
	'lib/diarizationFlag.js',
	'lib/speakerMapping.js',
	'lib/transcriptStitch.js',
	'workers/diarization/index.js',
	'workers/diarization/engine-child.mjs',
];

// ── Set S: OmniScore / Trust Score / matching / screening modules ───────
const SCORING_MODULES = [
	'routes/omniscore.js',
	'routes/trustscore.js',
	'routes/matching.js',
	'routes/fitScore.js',
	'routes/candidate-company-matches.js',
	'routes/screening.js',
	'routes/ai-screener.js',
	'lib/recruiter-screener.js',
	'lib/job-alert-matcher.js',
];

// ── The only non-test files allowed to import a diarization module ──────
// D-internal edges, the S-D09/S-D10 presentation composition surface,
// and the S-D06 long-recording proof harness. Anything else — above all
// anything in set S — is a fence violation.
const DIARIZATION_IMPORTER_ALLOWLIST = [
	...DIARIZATION_MODULES,
	'server/routes/recordings.js',
	'scripts/diarization-long-proof.js',
];

const canonical = (rel) =>
	rel.replace(/\.(js|mjs|cjs|ts|tsx|json)$/, '').replace(/\/index$/, '');

const DIARIZATION_CANON = new Set(DIARIZATION_MODULES.map(canonical));
const SCORING_CANON = new Set(SCORING_MODULES.map(canonical));
const ALLOW_CANON = new Set(DIARIZATION_IMPORTER_ALLOWLIST.map(canonical));

const SPECIFIER_RE =
	/(?:require\s*\(\s*|(?:import|export)\s+(?:[^'"]*?\s+from\s+)?)['"]([^'"]+)['"]/g;

/** All module targets a file imports, as canonical repo-relative paths. */
function importedTargets(relFile) {
	const text = fs.readFileSync(path.join(REPO, relFile), 'utf8');
	const dir = path.posix.dirname(relFile);
	const targets = new Set();
	for (const match of text.matchAll(SPECIFIER_RE)) {
		const spec = match[1];
		if (!spec.startsWith('.')) continue; // package import — never a repo module
		targets.add(canonical(path.posix.normalize(path.posix.join(dir, spec))));
	}
	return targets;
}

const SCAN_ROOTS = ['lib', 'routes', 'server', 'workers', 'agents', 'scripts'];
const SCAN_EXT = /\.(js|mjs|cjs|ts|tsx)$/;
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIR.has(entry.name)) walk(path.join(dir, entry.name), out);
		} else if (SCAN_EXT.test(entry.name)) {
			out.push(toPosix(path.relative(REPO, path.join(dir, entry.name))));
		}
	}
	return out;
}

function allSourceFiles() {
	const files = [];
	for (const root of SCAN_ROOTS) {
		const abs = path.join(REPO, root);
		if (fs.existsSync(abs)) walk(abs, files);
	}
	for (const entry of fs.readdirSync(REPO, { withFileTypes: true })) {
		if (entry.isFile() && SCAN_EXT.test(entry.name)) files.push(entry.name);
	}
	// Test files legitimately import diarization modules to test them;
	// the fence governs shipped source only.
	return files.filter(
		(f) => !f.includes('__tests__') && !/\.(test|spec)\.(js|mjs|cjs|ts|tsx)$/.test(f),
	);
}

describe('S-D14 (#1916) presentation-only fence — dependency direction (AC-1)', () => {
	it('both sets name files that exist (the fence cannot vacate by rename)', () => {
		for (const rel of [...DIARIZATION_MODULES, ...SCORING_MODULES]) {
			expect({ file: rel, exists: fs.existsSync(path.join(REPO, rel)) }).toEqual({
				file: rel,
				exists: true,
			});
		}
	});

	it('no scoring/matching/screening module imports a diarization module', () => {
		const violations = [];
		for (const rel of SCORING_MODULES) {
			for (const target of importedTargets(rel)) {
				if (DIARIZATION_CANON.has(target)) violations.push(`${rel} -> ${target}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('no diarization module imports a scoring/matching/screening module', () => {
		const violations = [];
		for (const rel of DIARIZATION_MODULES) {
			for (const target of importedTargets(rel)) {
				if (SCORING_CANON.has(target)) violations.push(`${rel} -> ${target}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('repo-wide: only the allowlist imports diarization modules', () => {
		const violations = [];
		for (const rel of allSourceFiles()) {
			if (ALLOW_CANON.has(canonical(rel))) continue;
			for (const target of importedTargets(rel)) {
				if (DIARIZATION_CANON.has(target)) violations.push(`${rel} -> ${target}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('set completeness: module names that mark a fence side are all in the sets', () => {
		const unlisted = [];
		// Module trees only — scripts/ holds one-off harnesses (the proof
		// script is an allowlisted importer, not a fence-side module).
		const moduleFiles = allSourceFiles().filter((f) => !f.startsWith('scripts/'));
		for (const rel of moduleFiles) {
			const base = path.posix.basename(rel);
			if (/diarization|transcriptstitch|speakermapping/i.test(base)) {
				if (!DIARIZATION_CANON.has(canonical(rel))) unlisted.push(`diarization?: ${rel}`);
			}
			if (/omniscore|trustscore|matching|fitScore|screener|matcher/i.test(base)) {
				if (!SCORING_CANON.has(canonical(rel))) unlisted.push(`scoring?: ${rel}`);
			}
			if (/^screening/i.test(base) && !SCORING_CANON.has(canonical(rel))) {
				unlisted.push(`scoring?: ${rel}`);
			}
		}
		expect(unlisted).toEqual([]);
	});
});
