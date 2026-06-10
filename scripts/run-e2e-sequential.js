#!/usr/bin/env node
/**
 * Sequential E2E Test Runner — Per-File Execution Workaround
 *
 * Problem: Running the full Playwright suite in one invocation causes
 * SIGKILL due to browser resource accumulation across ~30 test files,
 * even with workers=1 and fullyParallel=false.
 *
 * Workaround: Run each .spec.ts file in a separate Playwright invocation.
 * This ensures the browser process is fully torn down and restarted
 * between files, capping concurrent memory to one browser context.
 *
 * Flow:
 *   1. Run auth.setup.ts once (generates e2e/.auth/*.json storage state)
 *   2. For each spec file: npx playwright test --no-deps <file>
 *      (skip re-running setup dependency on every file)
 *   3. Kill orphaned chrome processes between files
 *   4. Report pass/fail summary
 *
 * Usage:
 *   node scripts/run-e2e-sequential.js
 *   CI=true node scripts/run-e2e-sequential.js
 *   node scripts/run-e2e-sequential.js --mobile
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const E2E_DIR = path.join(__dirname, '..', 'e2e');
const ROOT_DIR = path.join(__dirname, '..');

const IGNORED_PATTERNS = ['auth.setup.ts', 'global-teardown.ts', 'helpers.ts'];

const MOBILE_PROJECT = process.argv.includes('--mobile') ? 'mobile-chromium' : 'chromium';

function getSpecFiles() {
	return fs
		.readdirSync(E2E_DIR)
		.filter((f) => f.endsWith('.spec.ts') && !IGNORED_PATTERNS.includes(f))
		.sort();
}

function runPlaywright(args, timeoutMs = 180000) {
	const result = spawnSync('npx', ['playwright', 'test', ...args], {
		cwd: ROOT_DIR,
		timeout: timeoutMs,
		stdio: 'inherit',
		shell: false,
		env: {
			...process.env,
			// Force single worker even if config is overridden
			PLAYWRIGHT_WORKERS: '1',
		},
	});
	return result.status ?? 1;
}

function killOrphanedBrowsers() {
	try {
		spawnSync('pkill', ['-f', 'chrome-headless-shell'], { stdio: 'ignore' });
		spawnSync('pkill', ['-f', 'Chromium'], { stdio: 'ignore' });
	} catch {
		// ignore
	}
}

function main() {
	const specFiles = getSpecFiles();

	if (specFiles.length === 0) {
		console.error('No .spec.ts files found in', E2E_DIR);
		process.exit(1);
	}

	console.log('═'.repeat(60));
	console.log('Sequential E2E Runner — Per-File Execution');
	console.log('═'.repeat(60));
	console.log(`Project  : ${MOBILE_PROJECT}`);
	console.log(`Specs    : ${specFiles.length} files`);
	console.log(`Workdir  : ${ROOT_DIR}`);
	console.log('─'.repeat(60));

	// ── Step 1: Run auth setup once ─────────────────────────────
	// Delete any stale auth files so Playwright is forced to regenerate
	// fresh tokens (JWTs expire in 15 min; old files must not be reused).
	const authFiles = [
		path.join(ROOT_DIR, 'e2e', '.auth', 'candidate.json'),
		path.join(ROOT_DIR, 'e2e', '.auth', 'recruiter.json'),
		path.join(ROOT_DIR, 'e2e', '.auth', 'admin.json'),
	];
	authFiles.forEach((fp) => {
		if (fs.existsSync(fp)) {
			fs.unlinkSync(fp);
			console.log(`  🗑️  Deleted stale auth file: ${path.relative(ROOT_DIR, fp)}`);
		}
	});

	console.log('\n▶ Running auth.setup.ts (one-time)…');
	const setupPath = path.join(E2E_DIR, 'auth.setup.ts');
	const setupStatus = runPlaywright(['--project=setup', setupPath], 120000);

	if (setupStatus !== 0) {
		console.error('\n❌ Auth setup failed — aborting sequential run.');
		process.exit(1);
	}
	console.log('✅ Auth setup complete.');

	// ── Step 2: Run each spec file individually ─────────────────
	const results = [];
	let passed = 0;
	let failed = 0;

	for (const file of specFiles) {
		// Clean up any lingering browser processes before spawning the next
		killOrphanedBrowsers();

		const specPath = path.join(E2E_DIR, file);
		console.log(`\n▶ Running ${file}…`);

		const start = Date.now();
		const status = runPlaywright(
			[
				`--project=${MOBILE_PROJECT}`,
				'--no-deps', // skip re-running auth.setup.ts for every file
				specPath,
			],
			180000,
		);
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);

		const result = { file, status: status === 0 ? 'PASS' : 'FAIL', elapsed };
		results.push(result);

		if (result.status === 'PASS') {
			passed++;
			console.log(`✅ ${file} — ${elapsed}s`);
		} else {
			failed++;
			console.log(`❌ ${file} — ${elapsed}s`);
		}
	}

	// Final cleanup
	killOrphanedBrowsers();

	// ── Summary ─────────────────────────────────────────────────
	console.log(`\n${'═'.repeat(60)}`);
	console.log('Results Summary');
	console.log('═'.repeat(60));
	for (const r of results) {
		const icon = r.status === 'PASS' ? '✅' : '❌';
		console.log(`${icon} ${r.file.padEnd(40)} ${r.status}  ${r.elapsed}s`);
	}
	console.log('─'.repeat(60));
	console.log(`Total: ${specFiles.length} | Passed: ${passed} | Failed: ${failed}`);
	console.log('═'.repeat(60));

	if (failed > 0) {
		console.log('\n⚠️  Some tests failed. See output above for details.');
		process.exit(1);
	} else {
		console.log('\n🎉 All tests passed!');
		process.exit(0);
	}
}

main();
