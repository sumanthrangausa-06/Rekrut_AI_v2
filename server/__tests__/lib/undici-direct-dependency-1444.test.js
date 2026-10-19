/**
 * #1444 — undici must be a DIRECT dependency.
 *
 * PR #1443 (for #1419) installs an undici ProxyAgent as the global
 * dispatcher in lib/ai-provider.js via a lazy, nested-guarded
 * `require('undici')`. undici was only present TRANSITIVELY
 * (isomorphic-dompurify → jsdom tree). If that tree changes, the require
 * degrades silently to direct fetch (by design — never crashes) and
 * proxied raw-fetch AI paths would quietly stop routing through
 * HTTPS_PROXY on proxy-egress hosts.
 *
 * Pins:
 *  - package.json declares undici in `dependencies`, at exactly the
 *    version locked for node_modules/undici in package-lock.json
 *  - package-lock.json's root package records undici as a direct
 *    dependency (not only a transitive node_modules entry)
 *  - the dispatcher install path resolves: from lib/, `require('undici')`
 *    resolves and exposes the exact exports lib/ai-provider.js
 *    destructures (ProxyAgent, setGlobalDispatcher)
 *
 * No network, no DB. This pin + the neighbouring ai-provider proxy
 * suites are the proportionate gate for a dependency-declaration-only
 * change (see PR body for the Quinn E2E note).
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const pkg = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
);
const lock = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'),
);

describe('#1444 undici is a direct dependency', () => {
	test('package.json declares undici in dependencies at the locked version', () => {
		const locked = lock.packages['node_modules/undici'];
		expect(locked).toBeDefined();
		expect(pkg.dependencies).toBeDefined();
		expect(pkg.dependencies.undici).toBe(locked.version);
	});

	test('package-lock root package records undici as a direct dependency', () => {
		const root = lock.packages[''];
		const locked = lock.packages['node_modules/undici'];
		expect(root).toBeDefined();
		expect(root.dependencies).toBeDefined();
		// Compared against the locked version (not pkg.dependencies.undici)
		// so this pin cannot pass vacuously while both are undefined.
		expect(root.dependencies.undici).toBe(locked.version);
		expect(root.dependencies.undici).toBe(pkg.dependencies.undici);
	});

	test('dispatcher install path resolves undici with the exports ai-provider uses', () => {
		const libDir = path.join(REPO_ROOT, 'lib');
		const resolved = require.resolve('undici', { paths: [libDir] });
		expect(typeof resolved).toBe('string');
		const undici = require(resolved);
		expect(typeof undici.ProxyAgent).toBe('function');
		expect(typeof undici.setGlobalDispatcher).toBe('function');
	});
});
