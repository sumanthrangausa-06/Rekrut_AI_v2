/**
 * Guard for Issue #1172: sweepPendingStorageDeletions (lib/erasureService.js)
 * shipped with NO production caller — crash-orphaned `pending` rows in the
 * pending_storage_deletions ledger were only re-drained if the same user was
 * erased again, so erased users' storage files could persist forever.
 *
 * The production caller is the existing 24h recording-retention interval in
 * server.js (startRecordingRetention) — the same tick that already calls the
 * sibling ledger function purgeDrainedStorageDeletions (#1128). This test is
 * source-based on purpose (same precedent as spa-known-routes-guard.test.js):
 * it pins the wiring so the sweep cannot silently become dead code again,
 * without needing a server boot or a DB in the unit suite. The behavioural
 * proof (tick invocation on a real migrate.js-built DB drains a pending row
 * and writes the 'system' audit row) is the E2E-on-dev gate evidence on
 * #1172, not this guard.
 */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..', '..');
const serverSrc = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

function retentionTickBlock(src) {
	const start = src.indexOf('(function startRecordingRetention()');
	if (start === -1) throw new Error('startRecordingRetention not found in server.js');
	const end = src.indexOf('// ─── AI Observer worker', start);
	if (end === -1) throw new Error('retention block terminator not found in server.js');
	return src.slice(start, end);
}

describe('#1172 storage-deletion sweep wiring', () => {
	test('the retention tick requires and calls sweepPendingStorageDeletions', () => {
		const block = retentionTickBlock(serverSrc);
		expect(block).toMatch(/require\(['"]\.\/lib\/erasureService['"]\)/);
		expect(block).toMatch(/sweepPendingStorageDeletions\s*\(/);
		expect(block).toMatch(/await\s+sweepPendingStorageDeletions\s*\(/);
	});

	test('the sweep call sits inside the interval callback, ungated and uncommented', () => {
		const block = retentionTickBlock(serverSrc);
		const intervalIdx = block.indexOf('setInterval(async () => {');
		const sweepIdx = block.indexOf('await sweepPendingStorageDeletions(');
		expect(intervalIdx).toBeGreaterThan(-1);
		expect(sweepIdx).toBeGreaterThan(intervalIdx);
		// The statement carrying the call (from the previous ';' to the
		// call) must not gate it behind the retention dry-run/live flags —
		// the ungated erasure-completion decision at the call site — and
		// must not be a comment.
		const stmtStart = block.lastIndexOf(';', sweepIdx) + 1;
		const stmt = block.slice(stmtStart, sweepIdx);
		expect(stmt).not.toMatch(/dryRun|LIVE_PURGE/);
		expect(stmt).not.toMatch(/\/\/|\/\*/);
	});

	test('the sweep runs in the same tick as its sibling ledger purge', () => {
		const block = retentionTickBlock(serverSrc);
		const sweepIdx = block.indexOf('await sweepPendingStorageDeletions(');
		const purgeIdx = block.indexOf('await purgeDrainedStorageDeletions(');
		expect(sweepIdx).toBeGreaterThan(-1);
		expect(purgeIdx).toBeGreaterThan(-1);
		// Drain pending rows first; the terminal purge then folds rows that
		// are already 'deleted' past the grace window.
		expect(sweepIdx).toBeLessThan(purgeIdx);
	});
});
