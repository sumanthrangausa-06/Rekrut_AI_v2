#!/usr/bin/env node
/**
 * API contract audit — finds frontend apiCall() paths with no matching
 * backend route. Catches the "built but never wired" class of bugs
 * (e.g. LinkedIn Optimizer calling /profile-enhancement/linkedin-tips,
 * which doesn't exist).
 *
 * Usage: node scripts/check-api-contract.js [--json]
 * Exits 1 when mismatches are found.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');

// ── 1. Collect frontend apiCall paths ──────────────────────────────────
// Matches: apiCall('/path'), apiCall(`/path/${var}`), apiCall("/path")
const APICALL_RE = /apiCall(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g;

function listFiles(dir, exts, out = []) {
	const skip = new Set(['node_modules', 'dist', '__tests__']);
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (skip.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) listFiles(full, exts, out);
		else if (exts.includes(path.extname(entry.name))) out.push(full);
	}
	return out;
}

function normalizeFrontendPath(p) {
	// Strip query string, replace ${...} template slots with :param
	return p
		.split('?')[0]
		.replace(/\$\{[^}]+\}/g, ':param')
		.replace(/\/+$/, '');
}

const frontendCalls = new Map(); // normalized path -> [files]
for (const f of listFiles(CLIENT_SRC, ['.ts', '.tsx'])) {
	const src = fs.readFileSync(f, 'utf8');
	APICALL_RE.lastIndex = 0;
	let m;
	while ((m = APICALL_RE.exec(src)) !== null) {
		const raw = m[1];
		// Skip absolute URLs and non-path strings
		if (!raw.startsWith('/')) continue;
		const norm = normalizeFrontendPath(raw);
		if (!norm) continue;
		const rel = path.relative(ROOT, f);
		if (!frontendCalls.has(norm)) frontendCalls.set(norm, new Set());
		frontendCalls.get(norm).add(rel);
	}
}

// ── 2. Collect backend routes ──────────────────────────────────────────
// server.js: app.use('/prefix', xxxRoutes)  +  require('./routes/xxx')
// routes/*.js: router.get('/path', ...) etc.
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const mountMap = new Map(); // routes/xxx.js -> [mount prefixes]
const useRe = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)(?:\.\w+)?\s*\)/g;
const requireRe = /const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g;
const varToFile = new Map();
{
	let m;
	while ((m = requireRe.exec(serverSrc)) !== null) varToFile.set(m[1], m[2]);
}
{
	let m;
	while ((m = useRe.exec(serverSrc)) !== null) {
		const file = varToFile.get(m[2]);
		if (file) {
			if (!mountMap.has(file)) mountMap.set(file, []);
			mountMap.get(file).push(m[1]);
		}
	}
}

// Also handle inline: app.use('/api/x', require('./routes/y'))
const inlineRe = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g;
{
	let m;
	while ((m = inlineRe.exec(serverSrc)) !== null) {
		if (!mountMap.has(m[2])) mountMap.set(m[2], []);
		mountMap.get(m[2]).push(m[1]);
	}
}

const ROUTE_RE = /router\.(get|post|put|delete|patch|all)\(\s*['"`]([^'"`]+)['"`]/g;

function normalizeBackendPath(p) {
	return p
		.split('?')[0]
		.replace(/:[^/]+/g, ':param')
		.replace(/\/+$/, '');
}

const backendRoutes = new Set();
for (const [file, prefixes] of mountMap) {
	const fp = path.join(ROOT, 'routes', file + '.js');
	if (!fs.existsSync(fp)) continue;
	const src = fs.readFileSync(fp, 'utf8');
	ROUTE_RE.lastIndex = 0;
	let m;
	while ((m = ROUTE_RE.exec(src)) !== null) {
		for (const prefix of prefixes) {
			const full = normalizeBackendPath(prefix + m[2]);
			backendRoutes.add(`${m[1].toUpperCase()} ${full}`);
			backendRoutes.add(full); // path-only for method-agnostic matching
		}
	}
}

// server.js direct routes: app.get('/path', ...), etc.
const APP_ROUTE_RE = /app\.(get|post|put|delete|patch|all)\(\s*['"`]([^'"`]+)['"`]/g;
{
	let m;
	while ((m = APP_ROUTE_RE.exec(serverSrc)) !== null) {
		if (m[2].includes('*') || m[2].includes(':')) continue;
		const full = normalizeBackendPath(m[2]);
		backendRoutes.add(`${m[1].toUpperCase()} ${full}`);
		backendRoutes.add(full);
	}
}

// ── 3. apiCall prefixes /api — account for it ──────────────────────────
function backendHas(frontPath) {
	// apiCall('/x') hits /api/x (check lib/api.ts base behavior via convention)
	const candidates = [frontPath, '/api' + frontPath];
	return candidates.some((c) => backendRoutes.has(c));
}

// ── 4. Report mismatches ───────────────────────────────────────────────
const mismatches = [];
for (const [fpath, files] of [...frontendCalls.entries()].sort()) {
	if (!backendHas(fpath)) {
		mismatches.push({ path: fpath, files: [...files].sort() });
	}
}

const asJson = process.argv.includes('--json');
if (asJson) {
	console.log(JSON.stringify({ mismatches }, null, 2));
} else if (mismatches.length === 0) {
	console.log('✓ All frontend API calls match a backend route.');
} else {
	console.log(`✗ Found ${mismatches.length} frontend API path(s) with no backend route:\n`);
	for (const m of mismatches) {
		console.log(`  ${m.path}`);
		for (const f of m.files.slice(0, 4)) console.log(`      ← ${f}`);
		if (m.files.length > 4) console.log(`      … +${m.files.length - 4} more`);
	}
}
process.exit(mismatches.length === 0 ? 0 : 1);
