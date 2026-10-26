// #1868 — recovery from stale-chunk failures after a deploy.
//
// Every page is a lazily loaded, build-hashed chunk. A deploy renames
// the chunks and the old files disappear, so an open session's first
// visit to a not-yet-loaded page requests a chunk that no longer
// exists and the dynamic import fails. One full reload fetches the
// new shell; the sessionStorage timestamp guard makes sure a build
// that is still broken can never turn that into a reload loop.

const RELOAD_KEY = 'chunk-reload-attempted-at';
const RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR_PATTERNS = [
	'importing a module script failed',
	'failed to fetch dynamically imported module',
	'error loading dynamically imported module',
	'chunkloaderror',
];

/** True when `error` is a dynamic-import / chunk-load failure. */
export function isChunkLoadError(error: unknown): boolean {
	if (!error) return false;
	const err = error as { name?: unknown; message?: unknown };
	const text = `${typeof err.name === 'string' ? err.name : ''} ${typeof err.message === 'string' ? err.message : String(error)}`.toLowerCase();
	return CHUNK_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

interface ChunkReloadDeps {
	storage?: Pick<Storage, 'getItem' | 'setItem'>;
	reload?: () => void;
	now?: () => number;
}

/**
 * Attempt the one guarded reload. Returns true when a reload was
 * triggered, false when one was already attempted inside the window
 * (or the guard storage is unavailable — fail safe, never loop).
 * Callers fall through to their normal error UI on false.
 */
export function tryChunkReload(deps: ChunkReloadDeps = {}): boolean {
	const storage = deps.storage ?? window.sessionStorage;
	const reload = deps.reload ?? (() => window.location.reload());
	const now = deps.now ?? Date.now;
	try {
		const last = Number(storage.getItem(RELOAD_KEY));
		if (Number.isFinite(last) && last > 0 && now() - last < RELOAD_WINDOW_MS) {
			return false;
		}
		storage.setItem(RELOAD_KEY, String(now()));
	} catch {
		return false;
	}
	reload();
	return true;
}
