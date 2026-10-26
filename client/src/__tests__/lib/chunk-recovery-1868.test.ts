/**
 * #1868 — chunk-load recovery.
 *
 * After a deploy, an open session's lazy import requests a chunk name
 * from the previous build, which no longer exists. Browsers surface
 * that as (wording varies by engine):
 *   - Safari:  "Importing a module script failed."
 *   - Chrome:  "Failed to fetch dynamically imported module: ..."
 *   - Firefox: "error loading dynamically imported module"
 *   - webpack-style: name "ChunkLoadError"
 * The recovery is exactly ONE full reload (to fetch the new shell),
 * guarded by a sessionStorage timestamp so a still-broken build can
 * never reload-loop.
 *
 * These are unit pins for the matcher + guard logic; they do NOT
 * satisfy the Quinn journey gate (load build A, deploy build B,
 * navigate without manual refresh), which is recorded on #1868.
 */
import { describe, expect, it, vi } from 'vitest';

import { isChunkLoadError, tryChunkReload } from '../../lib/chunk-recovery';

function fakeStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => {
			map.set(k, v);
		},
		map,
	};
}

describe('isChunkLoadError (#1868)', () => {
	it('matches the founder’s Safari failure verbatim', () => {
		expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
	});

	it('matches Chrome / Firefox dynamic-import failures', () => {
		expect(
			isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js')),
		).toBe(true);
		expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
	});

	it('matches ChunkLoadError by name', () => {
		const err = new Error('Loading chunk 42 failed');
		err.name = 'ChunkLoadError';
		expect(isChunkLoadError(err)).toBe(true);
	});

	it('does not match ordinary errors', () => {
		expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
		expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
		expect(isChunkLoadError(null)).toBe(false);
		expect(isChunkLoadError(undefined)).toBe(false);
	});
});

describe('tryChunkReload guard (#1868)', () => {
	it('reloads once and stamps sessionStorage', () => {
		const storage = fakeStorage();
		const reload = vi.fn();
		expect(tryChunkReload({ storage, reload, now: () => 100_000 })).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
		expect([...storage.map.values()]).toEqual(['100000']);
	});

	it('refuses a second reload inside the 30s window (no loop)', () => {
		const storage = fakeStorage();
		const reload = vi.fn();
		expect(tryChunkReload({ storage, reload, now: () => 100_000 })).toBe(true);
		expect(tryChunkReload({ storage, reload, now: () => 110_000 })).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('allows a reload again after the 30s window', () => {
		const storage = fakeStorage();
		const reload = vi.fn();
		expect(tryChunkReload({ storage, reload, now: () => 100_000 })).toBe(true);
		expect(tryChunkReload({ storage, reload, now: () => 131_000 })).toBe(true);
		expect(reload).toHaveBeenCalledTimes(2);
	});
});
