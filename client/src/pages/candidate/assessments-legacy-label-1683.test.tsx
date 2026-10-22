/**
 * Issue #1683 — legacy label contract pin (STOP 1 ruling, comment
 * 6353032006: option (b) — pin the contract, change no behaviour).
 *
 * The legacy skill card on the candidate assessments page states the
 * real default a NEW legacy-body start will snapshot:
 *   "Mixed · Medium (levels 2–4)"   (assessments.tsx, #1679 item 7)
 *
 * That sentence is a cross-side contract. Its truth lives server-side
 * in routes/assessments.js:
 *   - the legacy /start snapshot defaults (§4.2/§8): format 'mixed',
 *     difficultyBand 'medium', totalQuestions 10;
 *   - the band definitions: BAND_START medium = 3 and
 *     BAND_RANGE medium = [2, 4] — the "levels 2–4" in the label.
 *
 * Neither side is exported (the defaults are literals inside the
 * /start handler; the band consts are module-private), so — exactly
 * as the #1699/#1707 take-page pins do — this suite pins the SOURCE
 * literals, scoped to the block that owns them, and derives the
 * expected client label FROM the parsed server band so a drift on
 * EITHER side fails here:
 *   - server default medium→hard        → snapshot pin fails;
 *   - server band medium [2,4]→[2,5]    → derived label ≠ client label;
 *   - client label edited               → label pins fail.
 *
 * Source pins only — regression pins, NOT the HL-003 E2E-on-dev gate.
 * The render-level pin for this label already lives in
 * assessment-configure-1654.test.tsx (#1679 item 7).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, '../../../../routes/assessments.js'), 'utf8');
const clientSrc = readFileSync(join(here, 'assessments.tsx'), 'utf8');

const countIn = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// The legacy snapshot block: from its §4.2/§8 comment marker through
// the snapshot object literal's close. Scoping matters — 'medium'
// literals exist elsewhere in the file (e.g. the /generate heuristic)
// and must neither satisfy nor break this pin.
function legacySnapshotBlock(src: string): string {
	const marker = src.indexOf('// §4.2/§8 recorded defaults');
	expect(marker).toBeGreaterThan(-1);
	const snapStart = src.indexOf('snapshot = {', marker);
	expect(snapStart).toBeGreaterThan(-1);
	const snapEnd = src.indexOf('};', snapStart);
	expect(snapEnd).toBeGreaterThan(snapStart);
	return src.slice(snapStart, snapEnd);
}

// Parse one band's [lo, hi] range out of the BAND_RANGE literal.
function bandRange(src: string, band: string): [number, number] {
	const m = src.match(new RegExp(`const BAND_RANGE = \\{[^}]*${band}: \\[(\\d+), (\\d+)\\]`));
	expect(m, `BAND_RANGE.${band} literal not found`).not.toBeNull();
	return [Number(m![1]), Number(m![2])];
}

describe('#1683 — legacy label contract pin (server defaults ↔ client label)', () => {
	test('server: legacy /start snapshot defaults are mixed / medium / 10', () => {
		const block = legacySnapshotBlock(serverSrc);
		expect(block).toContain("format: 'mixed'");
		expect(block).toContain("difficultyBand: 'medium'");
		expect(block).toContain('totalQuestions: 10');
	});

	test('server: band definitions — BAND_START medium is 3, BAND_RANGE medium spans levels 2–4', () => {
		expect(serverSrc).toContain('const BAND_START = { easy: 1, medium: 3, hard: 4 };');
		expect(serverSrc).toContain(
			'const BAND_RANGE = { easy: [1, 2], medium: [2, 4], hard: [4, 5] };',
		);
		expect(bandRange(serverSrc, 'medium')).toEqual([2, 4]);
	});

	test('client: legacy card label is exactly "Mixed · Medium (levels 2–4)", once', () => {
		expect(countIn(clientSrc, 'Mixed · Medium (levels 2–4)')).toBe(1);
	});

	test('contract: the client label is the label the SERVER band implies', () => {
		const [lo, hi] = bandRange(serverSrc, 'medium');
		const block = legacySnapshotBlock(serverSrc);
		// The label names the snapshot's own band — derive the band from
		// the snapshot literal, not from a second hard-coded copy.
		const band = block.match(/difficultyBand: '(\w+)'/)?.[1];
		expect(band).toBe('medium');
		const [blo, bhi] = bandRange(serverSrc, band!);
		expect([blo, bhi]).toEqual([lo, hi]);
		const expectedLabel = `Mixed · Medium (levels ${blo}–${bhi})`;
		expect(countIn(clientSrc, expectedLabel)).toBe(1);
	});
});
