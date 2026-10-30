/**
 * diarizationFence-1916.test.js — S-D14 (#1916) presentation-only fence,
 * AC-1: dependency direction (Architecture §6.2 way 2, PRD FR-D14, Lex BR-12).
 *
 * Diarization output is PRESENTATION ONLY: it must never become a scoring
 * input. That is enforced mechanically here, not by promise — within the
 * narrowed guarantee stated at the end of this header (#1945):
 *
 *   1. No OmniScore / Trust Score / matching / screening module (set S)
 *      imports a diarization module (set D).
 *   2. No diarization module imports a scoring module (the reverse edge
 *      would let labels flow back just as surely).
 *   3. Repo-wide backstop: NO non-test source file outside the explicit
 *      allowlist may import a diarization module at all — so a scoring
 *      file created tomorrow, not yet listed in set S, is still caught.
 *      The scan covers every shipped source tree: lib, routes, server,
 *      services, middleware, shared, agents, workers, scripts, client,
 *      and repo-root files (PR #1942 review F-1: services/ holds real
 *      scoring modules — services/omniscore.js above all — and an
 *      unscanned tree is a hole in the fence, not a detail).
 *   4. Set-completeness: a NEW file in a module tree whose name marks it
 *      as a diarization or scoring/matching/screening/evaluation module
 *      must join the sets below (or the explicit presentation/non-scoring
 *      lists) — the fence cannot silently vacate by rename or addition.
 *   5. No set-S or set-D file may use a dynamic or computed import form
 *      at all (#1945, probes P1–P3): `import(...)` is banned outright in
 *      those files, and `require(...)` is allowed only with a single
 *      plain string-literal argument (a static template literal with no
 *      interpolation counts as literal). Concatenated, interpolated, or
 *      computed specifiers (e.g. `require(path.join(...))`) are
 *      violations, so an edge the specifier scan cannot resolve cannot
 *      hide inside a fence-side file.
 *
 * What is actually guaranteed (#1945 — narrowed claim, read before
 * citing this fence): the current tree's static edges, and realistic
 * accidental coupling, are caught. This is NOT a guarantee against
 * deliberately obfuscated imports: dynamic/computed forms are now
 * banned outright in set-S/set-D files (check 5), but a NEW module
 * named with a synonym the completeness vocabulary does not contain
 * (probe P5, e.g. `lib/speakerLabels.js`) remains a named residual —
 * it is caught only if another check (the repo-wide allowlist scan,
 * when it imports a known diarization module) happens to see the edge.
 *
 * Two disclosures the fence does NOT cover:
 *   - Segment-level speaking share IS derivable: transcript segments
 *     carry speaker_number / start_time_ms / end_time_ms, so a viewer's
 *     per-speaker speaking share is computable by summing segment
 *     durations. The fence (and the way-3 shape suite) ban stored or
 *     displayed per-speaker quantities; they do not — and cannot —
 *     make share mathematically underivable from segment timings a
 *     viewer legitimately receives.
 *   - The fence-shape suite exercises only GET /:id/transcript and
 *     GET /:id/speakers. The PUT /:id/speakers/mapping response shape
 *     (server/routes/recordings.js) is NOT exercised by it.
 *
 * Static import-specifier scan in the style of diarizationPinning-1907:
 * every require()/import/export-from specifier in the file (single-,
 * double-, or backtick-quoted — a static template literal resolves the
 * same way, PR #1942 review F-2) is resolved against the repo tree the
 * way Node resolves it (extension- and index-normalised) and compared
 * by canonical path. This suite itself is a test file and is excluded
 * from the repo-wide scan by design; it names the forbidden modules to
 * forbid them.
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
	// S-D19 (#1956): genuine diarization module (imports diarizationJobs/
	// Flag/Gate); found as pre-existing fence debt at the #1945 baseline —
	// it was in neither set D nor the allowlist, so the fence was red on dev.
	'lib/diarizationEnqueue.js',
	'lib/speakerMapping.js',
	'lib/transcriptStitch.js',
	'workers/diarization/index.js',
	'workers/diarization/engine-child.mjs',
];

// ── Set S: OmniScore / Trust Score / matching / screening modules ───────
// Server computation (routes + services + lib) and the client surfaces
// that present scores, matches, and screening (PR #1942 review F-1/F-3:
// the fence question is "could diarization output become a scoring
// input or a scored display" — services/omniscore.js computes the
// score, so it belongs here exactly as routes/omniscore.js does).
const SCORING_MODULES = [
	'routes/omniscore.js',
	'routes/trustscore.js',
	'routes/matching.js',
	'routes/fitScore.js',
	'routes/candidate-company-matches.js',
	'routes/screening.js',
	'routes/ai-screener.js',
	'services/omniscore.js',
	'services/trustscore.js',
	'services/trustscore-standalone.js',
	'services/matching-engine.js',
	'services/fitScore.js',
	'services/scoreExplainer.js',
	'services/interview-ai.js',
	'lib/recruiter-screener.js',
	'lib/job-alert-matcher.js',
	'client/src/pages/candidate/omniscore.tsx',
	'client/src/pages/candidate/company-matches.tsx',
	'client/src/pages/candidate/top-matches.tsx',
	'client/src/pages/candidate/screening.tsx',
	'client/src/pages/candidate/ai-screening.tsx',
	'client/src/pages/candidate/voice-screening.tsx',
	'client/src/pages/candidate/screening-questionnaire.tsx',
	'client/src/pages/recruiter/omniscore.tsx',
	'client/src/pages/recruiter-trustscore.tsx',
	'client/src/pages/recruiter/screening.tsx',
	'client/src/pages/recruiter/screening-monitor.tsx',
	'client/src/components/domain/match-explanation.tsx',
	'client/src/components/domain/omniscore-ring.tsx',
	// Renders a numeric score ring, used with matchScore — a scored display surface (#1945 widened vocabulary).
	'client/src/components/domain/score-ring.tsx',
	// Weighted interview-evaluation criteria config — an evaluation surface (#1945 widened vocabulary).
	'client/src/pages/recruiter/panel-scorecard-criteria.tsx',
];

// ── The only non-test files allowed to import a diarization module ──────
// D-internal edges, the S-D09/S-D10 presentation composition surface,
// and the S-D06 long-recording proof harness (scripts/). Anything
// else — above all anything in set S — is a fence violation.
const DIARIZATION_IMPORTER_ALLOWLIST = [
	...DIARIZATION_MODULES,
	'server/routes/recordings.js',
	'scripts/diarization-long-proof.js',
];

// Client presentation surfaces that legitimately render diarization
// labels (S-D09/S-D12) — presentation is their job; they are neither
// diarization-owned modules nor scoring modules, and the repo-wide
// importer scan still governs what they may import (they import no
// server module at all). Listed so the completeness check can tell a
// new presentation surface from a new diarization module.
const CLIENT_DIARIZATION_PRESENTATION = [
	'client/src/pages/recruiter/recording-playback.tsx',
	'client/src/pages/recruiter/recordings.tsx',
];

// Basenames that match the completeness name patterns but are NOT
// scoring/matching/screening modules (name collisions, reviewed at
// PR #1942): fullscreen UI and consent screens are not screening.
const NON_SCORING_NAME_COLLISIONS = [
	'client/src/components/assessments/exit-fullscreen.tsx',
	'client/src/pages/consent-screens.tsx',
	'client/check-screens.mjs',
];

const canonical = (rel) =>
	rel.replace(/\.(js|mjs|cjs|ts|tsx|json)$/, '').replace(/\/index$/, '');

const DIARIZATION_CANON = new Set(DIARIZATION_MODULES.map(canonical));
const SCORING_CANON = new Set(SCORING_MODULES.map(canonical));
const ALLOW_CANON = new Set(DIARIZATION_IMPORTER_ALLOWLIST.map(canonical));
const KNOWN_NON_D = new Set(
	[...CLIENT_DIARIZATION_PRESENTATION, ...NON_SCORING_NAME_COLLISIONS].map(canonical),
);

// Single, double, AND backtick quotes: require(`../lib/x`) with a static
// template literal is a real Node resolution and must be seen (F-2).
const SPECIFIER_RE =
	/(?:require\s*\(\s*|(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?)['"`]([^'"`]+)['"`]/g;

/**
 * Dynamic / non-literal import forms in one file (#1945, check 5).
 * `import(...)` is banned outright in fence-side files. `require(...)`
 * is allowed only as require('<one plain literal>') — a static template
 * literal with no interpolation is literal; a concatenated, interpolated
 * or computed argument (next char after '(' is not a quote, or the char
 * after the closing quote is not ')') is a violation. Small on purpose:
 * it does not parse JS, it only refuses forms the specifier scan above
 * cannot resolve exactly.
 */
function nonLiteralImports(relFile) {
	const text = fs.readFileSync(path.join(REPO, relFile), 'utf8');
	const violations = [];
	for (const match of text.matchAll(/\b(require|import)\s*\(/g)) {
		let i = match.index + match[0].length;
		while (i < text.length && /\s/.test(text[i])) i += 1;
		if (match[1] === 'import') {
			violations.push(`${relFile}: dynamic import()`);
			continue;
		}
		const quote = text[i];
		if (quote !== "'" && quote !== '"' && quote !== '`') {
			violations.push(`${relFile}: non-literal require() argument`);
			continue;
		}
		let interpolated = false;
		let closing = -1;
		for (let j = i + 1; j < text.length; j += 1) {
			if (text[j] === '\\') j += 1;
			else if (quote === '`' && text[j] === '$' && text[j + 1] === '{') interpolated = true;
			else if (text[j] === quote) {
				closing = j;
				break;
			}
		}
		let k = closing + 1;
		while (k < text.length && /\s/.test(text[k])) k += 1;
		if (closing === -1 || interpolated || text[k] !== ')') {
			violations.push(`${relFile}: non-literal require() argument`);
		}
	}
	return violations;
}

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

// Every shipped source tree (F-1). Non-source top-level dirs (docs,
// migrations, e2e, evidence-*, public, templates, …) hold no importable
// application modules and are out of scope by construction.
const SCAN_ROOTS = [
	'lib',
	'routes',
	'server',
	'services',
	'middleware',
	'shared',
	'agents',
	'workers',
	'scripts',
	'client',
];
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

	it('no scoring or diarization module uses a dynamic or non-literal import (#1945)', () => {
		const violations = [];
		for (const rel of [...SCORING_MODULES, ...DIARIZATION_MODULES]) {
			violations.push(...nonLiteralImports(rel));
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

	it('set completeness: module names that mark a fence side are all accounted for', () => {
		const unlisted = [];
		// Module trees only — scripts/ holds one-off harnesses (the proof
		// script is an allowlisted importer, not a fence-side module).
		const moduleFiles = allSourceFiles().filter((f) => !f.startsWith('scripts/'));
		for (const rel of moduleFiles) {
			if (KNOWN_NON_D.has(canonical(rel))) continue;
			const base = path.posix.basename(rel);
			if (/diarization|transcriptstitch|speakermapping/i.test(base)) {
				if (!DIARIZATION_CANON.has(canonical(rel))) unlisted.push(`diarization?: ${rel}`);
			}
			if (/omniscore|trustscore|matching|match|fitScore|screener|matcher|screen|score|evaluat|rank/i.test(base)) {
				if (!SCORING_CANON.has(canonical(rel))) unlisted.push(`scoring?: ${rel}`);
			}
		}
		expect(unlisted).toEqual([]);
	});
});
