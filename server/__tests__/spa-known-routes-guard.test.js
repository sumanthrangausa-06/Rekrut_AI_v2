/**
 * Guard for Issue #1225: KNOWN_ROUTES in server.js must cover every route
 * defined in the client router (client/src/App.tsx).
 *
 * The SPA fallback serves index.html with 200 for known routes and 404 for
 * unknown ones (Issue #106). KNOWN_ROUTES is a hand-maintained allowlist that
 * drifted from the router (27 routes missing when this guard was added).
 * This test extracts the real client routes from App.tsx and asserts each
 * one is matched by a KNOWN_ROUTES pattern, so the list cannot silently
 * drift again. It is source-based on purpose: no server boot, no DB, and no
 * client build are needed, so it runs in any environment the unit suite runs.
 *
 * The check is one-directional: KNOWN_ROUTES may contain extra legacy
 * patterns with no current client route (e.g. /candidate/video-interview,
 * asserted by spa-routes.test.js); those are not failures.
 *
 * Known limitation (reviewer note, #1225): the extractor assumes layout
 * (parent) routes are non-self-closing tags and that child paths are
 * relative or standalone-absolute — true for every route in App.tsx today
 * (141 routes extracted; extractor fixtures below pin the supported
 * shapes). A future route shape outside those fixtures fails the sanity
 * floor or the coverage assertion — fail-closed, never silently green.
 *
 * Load-bearing conventions (reviewer note, #1225): the extractor only
 * recognises double-quoted path="..." attributes — the style used by
 * every route in App.tsx today (path={'...'} or path='...' would be
 * silently skipped, and a single such route would not trip the sanity
 * floor). The brace-depth walk ignores braces inside string literals,
 * and extractKnownRouteRegexes treats any single-quoted string in the
 * KNOWN_ROUTES block as a pattern, so comments there must not contain
 * apostrophes. If App.tsx or server.js changes these conventions, update
 * the extractor and its fixtures in the same change.
 */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const appTsxPath = path.join(repoRoot, 'client', 'src', 'App.tsx');
const serverJsPath = path.join(repoRoot, 'server.js');

/**
 * Extract the KNOWN_ROUTES regexes from server.js source.
 * The list is a literal array of pattern strings ending in `].map(`.
 */
function extractKnownRouteRegexes(serverSrc) {
	const start = serverSrc.indexOf('const KNOWN_ROUTES = [');
	if (start === -1) throw new Error('KNOWN_ROUTES declaration not found in server.js');
	const end = serverSrc.indexOf('].map(', start);
	if (end === -1) throw new Error('KNOWN_ROUTES array terminator "].map(" not found in server.js');
	const block = serverSrc.slice(start, end);
	const patterns = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
	if (patterns.length === 0) throw new Error('No patterns extracted from KNOWN_ROUTES');
	return patterns.map((p) => new RegExp(p));
}

/**
 * Extract full client route paths from App.tsx.
 * Scans for `<Route ...>` tags with a brace-depth walk (so `>` inside
 * element={...} expressions does not end a tag early), keeps a stack of
 * parent paths for the few non-self-closing layout routes, and resolves
 * relative child paths and `index` routes against their parent.
 * `<Routes>` and `<RouteErrorBoundary>` are ignored via a word-boundary
 * check on the character after `<Route`.
 */
function extractClientRoutes(src) {
	const routes = [];
	const stack = [];
	let i = 0;
	while (i < src.length) {
		const openIdx = src.indexOf('<Route', i);
		const closeIdx = src.indexOf('</Route>', i);
		if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
			stack.pop();
			i = closeIdx + '</Route>'.length;
			continue;
		}
		if (openIdx === -1) break;
		if (!/[\s/>]/.test(src[openIdx + '<Route'.length])) {
			i = openIdx + '<Route'.length;
			continue;
		}
		let depth = 0;
		let j = openIdx + '<Route'.length;
		for (; j < src.length; j++) {
			const c = src[j];
			if (c === '{') depth++;
			else if (c === '}') depth--;
			else if (c === '>' && depth === 0) break;
		}
		const tagText = src.slice(openIdx, j + 1);
		const selfClosing = src[j - 1] === '/';
		const parent = stack.length ? stack[stack.length - 1] : '';
		const pathMatch = tagText.match(/path="([^"]+)"/);
		let full = null;
		if (pathMatch && pathMatch[1] !== '*') {
			full = pathMatch[1].startsWith('/')
				? pathMatch[1]
				: `${parent}/${pathMatch[1]}`;
		} else if (!pathMatch && /\bindex\b/.test(tagText.split('element')[0])) {
			full = parent || '/';
		}
		if (full) routes.push(full);
		if (!selfClosing) stack.push(full !== null ? full : parent);
		i = j + 1;
	}
	return [...new Set(routes)];
}

const samplePath = (route, token = '42') => route.replace(/:[^/]+/g, token);

// A parameterised route is sampled with two different tokens so a pattern
// hard-coded to one literal sample segment cannot mask a missing route.
const samplesFor = (route) =>
	route.includes(':') ? [samplePath(route), samplePath(route, 'guardsample')] : [route];

describe('SPA KNOWN_ROUTES guard (Issue #1225)', () => {
	const appSrc = fs.readFileSync(appTsxPath, 'utf8');
	const serverSrc = fs.readFileSync(serverJsPath, 'utf8');
	const clientRoutes = extractClientRoutes(appSrc);
	const knownRegexes = extractKnownRouteRegexes(serverSrc);

	it('extracts the client router (sanity: parser cannot silently pass)', () => {
		expect(clientRoutes.length).toBeGreaterThanOrEqual(100);
		// Anchors: one nested candidate route, one nested recruiter route,
		// one absolute admin route — proves nesting resolution works.
		expect(clientRoutes).toContain('/candidate/identity-verification');
		expect(clientRoutes).toContain('/recruiter/session-room');
		expect(clientRoutes).toContain('/admin/biometric-audit');
		expect(clientRoutes).toContain('/');
	});

	it('every client route is covered by KNOWN_ROUTES', () => {
		const missing = clientRoutes.filter((route) =>
			samplesFor(route).some(
				(sample) => !knownRegexes.some((re) => re.test(sample)),
			),
		);
		if (missing.length > 0) {
			throw new Error(
				`Client routes missing from KNOWN_ROUTES in server.js (${missing.length}):\n` +
					missing.map((r) => `  ${r} (sample ${samplePath(r)})`).join('\n') +
					'\nAdd patterns for them to KNOWN_ROUTES so the SPA fallback returns 200.',
			);
		}
	});

	it('extractor fixtures: supported App.tsx shapes parse exactly', () => {
		const fixture = `
<RouteErrorBoundary>{children}</RouteErrorBoundary>
<Routes>
	<Route path="/parent" element={<Layout />}>
		<Route index element={<Home />} />
		<Route path="child" element={<Child />} />
		<Route path="deep/:id" element={<Deep />} />
	</Route>
	<Route
		path="/multi"
		element={
			<Layout />
		}
	>
		<Route path="kid" element={<Kid />} />
	</Route>
	<Route path="/solo/:token" element={<Solo />} />
	<Route path="*" element={<NotFound />} />
</Routes>`;
		const extracted = extractClientRoutes(fixture);
		expect(extracted).toEqual(
			expect.arrayContaining([
				'/parent',
				'/parent/child',
				'/parent/deep/:id',
				'/multi',
				'/multi/kid',
				'/solo/:token',
			]),
		);
		// No catch-all, no <Routes>/<RouteErrorBoundary> artefacts.
		expect(extracted).toHaveLength(6);
	});

	it('unknown routes are still NOT matched (preserves #106 404 behaviour)', () => {
		const unknown = [
			'/this-does-not-exist',
			'/candidate/nonexistent',
			'/recruiter/nonexistent',
			'/admin/nonexistent',
			'/candidate/scores/extra',
			'/compare/extra',
			// Bogus suffixes on the parameterised routes added for #1225:
			// the [^/]+ segments must not swallow extra path parts.
			'/recruiter/aptitude-tests/42/bogus',
			'/aptitude-tests/42/bogus',
			'/candidate/screening/42/extra',
			'/recruiter/jobs/42/panel-criteria/extra',
			'/r/42/extra',
			'/admin/biometric-audit/extra',
		];
		for (const p of unknown) {
			expect(knownRegexes.some((re) => re.test(p))).toBe(false);
		}
	});
});
