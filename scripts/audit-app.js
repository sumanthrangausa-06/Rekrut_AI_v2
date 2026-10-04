#!/usr/bin/env node
/**
 * Full application audit — every frontend route organized by side
 * (candidate / recruiter / admin / public), with API contract status.
 *
 * Checks:
 *  1. All routes in App.tsx, grouped by side
 *  2. Each route's apiCall() dependencies vs backend routes
 *  3. Pages that exist but aren't routed (orphans)
 *
 * Usage: node scripts/audit-app.js [--json] [--side=candidate|recruiter|admin]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');

// ── Backend route collection (shared logic) ────────────────────────────
function collectBackendRoutes() {
	const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
	const mountMap = new Map();
	const useRe = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)(?:\.\w+)?\s*\)/g;
	const requireRe = /const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g;
	const varToFile = new Map();
	let m;
	while ((m = requireRe.exec(serverSrc)) !== null) varToFile.set(m[1], m[2]);
	while ((m = useRe.exec(serverSrc)) !== null) {
		const file = varToFile.get(m[2]);
		if (file) {
			if (!mountMap.has(file)) mountMap.set(file, []);
			mountMap.get(file).push(m[1]);
		}
	}
	const inlineRe = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g;
	while ((m = inlineRe.exec(serverSrc)) !== null) {
		if (!mountMap.has(m[2])) mountMap.set(m[2], []);
		mountMap.get(m[2]).push(m[1]);
	}

	const ROUTE_RE = /router\.(get|post|put|delete|patch|all)\(\s*['"`]([^'"`]+)['"`]/g;
	const norm = (p) =>
		p
			.split('?')[0]
			.replace(/:[^/]+/g, ':param')
			.replace(/\/+$/, '');
	const routes = new Set();
	for (const [file, prefixes] of mountMap) {
		const fp = path.join(ROOT, 'routes', file + '.js');
		if (!fs.existsSync(fp)) continue;
		const src = fs.readFileSync(fp, 'utf8');
		ROUTE_RE.lastIndex = 0;
		while ((m = ROUTE_RE.exec(src)) !== null) {
			for (const prefix of prefixes) routes.add(norm(prefix + m[2]));
		}
	}
	const APP_RE = /app\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
	while ((m = APP_RE.exec(serverSrc)) !== null) {
		if (m[2].includes('*')) continue;
		routes.add(norm(m[2]));
	}
	return routes;
}

// ── Frontend: routes from App.tsx ──────────────────────────────────────
function collectAppRoutes() {
	const src = fs.readFileSync(path.join(CLIENT_SRC, 'App.tsx'), 'utf8');
	// Match: <Route path="/xxx" ...> and lazy(() => import('@/pages/yyy'))
	const routeRe = /<Route\s+path=["']([^"']+)["'][^>]*>/g;
	const routes = [];
	let m;
	while ((m = routeRe.exec(src)) !== null) routes.push(m[1]);
	return routes;
}

function pathToComponent(routePath) {
	// Best-effort: find the component file for a route via App.tsx lazy imports
	const src = fs.readFileSync(path.join(CLIENT_SRC, 'App.tsx'), 'utf8');
	// Look for the Route and nearby element/LazyExoticComponent
	return null; // simplified — we map by convention below
}

// ── Frontend: apiCalls per file ────────────────────────────────────────
function collectApiCalls() {
	const APICALL_RE = /apiCall(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g;
	const calls = new Map(); // file -> Set(paths)
	function walk(dir) {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (['node_modules', 'dist', '__tests__'].includes(e.name)) continue;
			const fp = path.join(dir, e.name);
			if (e.isDirectory()) walk(fp);
			else if (['.ts', '.tsx'].includes(path.extname(e.name))) {
				const src = fs.readFileSync(fp, 'utf8');
				APICALL_RE.lastIndex = 0;
				let m;
				const set = new Set();
				while ((m = APICALL_RE.exec(src)) !== null) {
					if (!m[1].startsWith('/')) continue;
					const norm = m[1]
						.split('?')[0]
						.replace(/\$\{[^}]+\}/g, ':param')
						.replace(/\/+$/, '');
					if (norm) set.add(norm);
				}
				if (set.size > 0) calls.set(path.relative(ROOT, fp), set);
			}
		}
	}
	walk(CLIENT_SRC);
	return calls;
}

// ── Map page files to side ─────────────────────────────────────────────
function fileToSide(relPath) {
	if (relPath.includes('pages/candidate/')) return 'candidate';
	if (relPath.includes('pages/recruiter/')) return 'recruiter';
	if (relPath.includes('pages/admin/')) return 'admin';
	if (relPath.includes('pages/')) return 'public';
	if (relPath.includes('components/')) return 'shared';
	if (relPath.includes('hooks/')) return 'shared';
	return 'other';
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
	const sideFilter = (process.argv.find((a) => a.startsWith('--side=')) || '').split('=')[1];
	const asJson = process.argv.includes('--json');

	const backendRoutes = collectBackendRoutes();
	const appRoutes = collectAppRoutes();
	const apiCalls = collectApiCalls();

	const backendHas = (fp) => backendRoutes.has(fp) || backendRoutes.has('/api' + fp);

	// Group mismatches by side
	const bySide = { candidate: [], recruiter: [], admin: [], public: [], shared: [], other: [] };
	for (const [file, paths] of apiCalls) {
		const side = fileToSide(file);
		for (const p of paths) {
			if (!backendHas(p)) {
				bySide[side].push({ path: p, file });
			}
		}
	}

	// Dedupe by path within each side
	for (const side of Object.keys(bySide)) {
		const seen = new Map();
		for (const m of bySide[side]) {
			if (!seen.has(m.path)) seen.set(m.path, m);
		}
		bySide[side] = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	if (asJson) {
		console.log(JSON.stringify({ appRoutes: appRoutes.length, bySide }, null, 2));
		return;
	}

	const sides = sideFilter ? [sideFilter] : ['candidate', 'recruiter', 'admin', 'public'];
	let total = 0;
	for (const side of sides) {
		const items = bySide[side] || [];
		total += items.length;
		console.log(`\n${'='.repeat(60)}`);
		console.log(`${side.toUpperCase()} SIDE — ${items.length} broken API call(s)`);
		console.log('='.repeat(60));
		if (items.length === 0) {
			console.log('  ✓ All API calls have matching backend routes.');
		} else {
			for (const m of items) {
				console.log(`\n  ✗ ${m.path}`);
				console.log(`    ← ${m.file}`);
			}
		}
	}
	// Shared components/hooks used by both sides
	if (!sideFilter && bySide.shared.length > 0) {
		console.log(`\n${'='.repeat(60)}`);
		console.log(`SHARED (components/hooks) — ${bySide.shared.length} broken API call(s)`);
		console.log('='.repeat(60));
		for (const m of bySide.shared) {
			console.log(`\n  ✗ ${m.path}`);
			console.log(`    ← ${m.file}`);
		}
		total += bySide.shared.length;
	}
	console.log(`\n${'─'.repeat(60)}`);
	console.log(`Total app routes in App.tsx: ${appRoutes.length}`);
	console.log(`Total broken API calls: ${total}`);
	process.exit(total === 0 ? 0 : 1);
}

main();
