#!/usr/bin/env node
/**
 * Orphaned-file detector (Issue #203).
 *
 * Finds source files that are not reachable from the application entry points
 * via transitive imports/requires. A naive "is it imported in App.tsx / server.js"
 * check produces false positives (e.g. the ai-coaching support files, which are
 * reached transitively through pages/candidate/ai-coaching.tsx) — so this script
 * follows the full import graph instead.
 *
 * Frontend: entry client/src/main.tsx, follows static + dynamic imports,
 *           resolves the `@/` alias and extensionless relative imports.
 * Backend:  entry server.js, follows require() calls.
 *           (migrations/ are loaded dynamically by migrate.js and are excluded.)
 *
 * Usage: node scripts/check-orphans.js [--json]
 * Exits 1 when orphaned files are found (suitable as a CI gate).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');

const FRONTEND_EXTS = ['.tsx', '.ts', '.jsx', '.js'];
const BACKEND_EXTS = ['.js', '.json'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.git']);
const SKIP_FILE_RES = [
	/\.test\.[jt]sx?$/,
	/\.spec\.[jt]sx?$/,
	/\.d\.ts$/,
	/vite-env\.d\.ts$/,
	/client\/src\/test\//, // vitest setup — referenced by config, not imports
];

// Known orphans pending triage (issue #203 follow-up). Each entry should be
// either wired up or deleted; remove from this list as they are resolved.
// New files NOT on this list will fail CI.
const ALLOWLIST = new Set([
	// Frontend components — triage needed (duplicates? future features?)
	'client/src/components/domain/ActivityFeed.tsx', // duplicate local impl in admin/ai-health.tsx
	'client/src/components/domain/CommentThread.tsx',
	'client/src/components/domain/SharedNotes.tsx',
	'client/src/components/domain/calendar-picker.tsx',
	'client/src/components/domain/data-table.tsx',
	'client/src/components/domain/file-upload.tsx',
	'client/src/components/domain/notification-center.tsx',
	'client/src/components/domain/omniscore-ring.tsx',
	'client/src/components/upgrade-cta.tsx',
	'client/src/components/voice-features.tsx',
	'client/src/pages/candidate/offer-management.tsx',
	// Backend routes — triage needed
	'routes/candidate-preferences.js', // Issue #81 Working Style Preferences — mount or delete?
	'routes/conversations.js', // Handled by PR #231 (delete); listed until merged
]);

// Static + dynamic imports, incl. `import type` / `export ... from`.
const IMPORT_RE =
	/(?:import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function listFiles(dir, exts, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			listFiles(full, exts, out);
		} else if (exts.includes(path.extname(entry.name))) {
			const rel = path.relative(ROOT, full);
			if (!SKIP_FILE_RES.some((re) => re.test(rel))) out.push(full);
		}
	}
	return out;
}

function resolveImport(spec, fromFile, baseDir, aliasMap, exts) {
	let candidate;
	if (aliasMap) {
		for (const [alias, target] of Object.entries(aliasMap)) {
			if (spec === alias || spec.startsWith(alias + '/')) {
				candidate = path.join(target, spec.slice(alias.length + 1));
				break;
			}
		}
	}
	if (candidate === undefined) {
		if (!spec.startsWith('.')) return null; // bare package import — not our code
		candidate = path.resolve(path.dirname(fromFile), spec);
	}
	// Exact file, or extensionless / directory index resolution.
	const tries = [candidate];
	for (const ext of exts) tries.push(candidate + ext);
	for (const ext of exts) tries.push(path.join(candidate, 'index' + ext));
	for (const t of tries) {
		if (fs.existsSync(t) && fs.statSync(t).isFile()) return t;
	}
	return null;
}

function reachable(entry, baseDir, aliasMap, exts, patternRes) {
	const seen = new Set();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (seen.has(file)) continue;
		seen.add(file);
		let src;
		try {
			src = fs.readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		for (const re of patternRes) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(src)) !== null) {
				const resolved = resolveImport(m[1], file, baseDir, aliasMap, exts);
				if (resolved && !seen.has(resolved)) queue.push(resolved);
			}
		}
	}
	return seen;
}

function main() {
	const asJson = process.argv.includes('--json');
	const orphans = { frontend: [], backend: [] };

	// ── Frontend ──────────────────────────────────────────────
	const feEntry = path.join(CLIENT_SRC, 'main.tsx');
	const feReachable = reachable(feEntry, CLIENT_SRC, { '@': CLIENT_SRC }, FRONTEND_EXTS, [
		IMPORT_RE,
	]);
	const feFiles = listFiles(CLIENT_SRC, FRONTEND_EXTS);
	for (const f of feFiles) {
		if (!feReachable.has(f)) orphans.frontend.push(path.relative(ROOT, f));
	}

	// ── Backend routes ────────────────────────────────────────
	const beEntry = path.join(ROOT, 'server.js');
	const beReachable = reachable(beEntry, ROOT, null, BACKEND_EXTS, [REQUIRE_RE]);
	const beFiles = listFiles(path.join(ROOT, 'routes'), BACKEND_EXTS);
	for (const f of beFiles) {
		if (!beReachable.has(f)) orphans.backend.push(path.relative(ROOT, f));
	}

	const total = orphans.frontend.length + orphans.backend.length;
	const newOrphans = [
		...orphans.frontend.map((f) => `[frontend] ${f}`),
		...orphans.backend.map((f) => `[backend]  ${f}`),
	].filter((line) => {
		const file = line.replace(/^\[(frontend|backend)\]\s+/, '');
		return !ALLOWLIST.has(file);
	});
	if (asJson) {
		console.log(JSON.stringify({ ...orphans, allowlisted: [...ALLOWLIST] }, null, 2));
	} else if (newOrphans.length === 0) {
		const allowlistedCount = total;
		console.log(
			`✓ No new orphaned files found.` +
				(allowlistedCount > 0
					? ` (${allowlistedCount} known orphan(s) on the triage allowlist, see issue #203.)`
					: ''),
		);
	} else {
		console.log(`✗ Found ${newOrphans.length} new orphaned file(s):`);
		for (const line of newOrphans) console.log(`  ${line}`);
		console.log(
			'\nEither wire each file up (import/require + route) or delete it. ' +
				'See issue #203.',
		);
	}
	process.exit(newOrphans.length === 0 ? 0 : 1);
}

main();
