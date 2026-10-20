/**
 * erasureResultSanitizer — #1128 GAP-I (K-2, D-8b); hardened #1177.
 *
 * erasePersonalData's return is a transient in-process operator object:
 * it legitimately carries the raw storage keys Phase 2 needs. It must
 * NEVER be persisted or returned to a client as-is — before #1128 the
 * admin DSAR path wrote the full object (storageKeys[] + nested
 * gapC/gapD.nonPatternStorageUrls) into audit_logs.metadata and returned
 * it in the HTTP response, and the self-serve path stripped only the
 * top-level storageKeys.
 *
 * sanitizeErasureResult(result) returns a sanitised COPY (the input is
 * never mutated). Keys are matched CANONICALLY (#1177): lowercase with
 * `_`/`-`/`.` stripped, so casing/separator variants cannot slip a
 * carrier past the sanitiser into persisted audit metadata:
 *   - `storagekeys` / `nonpatternstorageurls` (any depth, any variant)
 *     are LIST carriers → `storageKeysCount` /
 *     `nonPatternStorageUrlCount`. Type-agnostic: array → length,
 *     string → 1, plain object → own-key count, other non-null scalar
 *     → 1, null/undefined → 0 (count still emitted).
 *   - `fileurl` / `objectkey` are SINGLE carriers: dropped outright at
 *     any type/depth; their contents are never walked.
 *   - Any other canonical key containing `storagekey` or `storageurl`
 *     (e.g. `storageKey`, `presignedStorageUrl`) is dropped outright,
 *     never counted. Count-output names are exempt: a count field with
 *     no sibling carrier present is left as-is, but a present carrier
 *     always overwrites a spoofed sibling count, in any key order.
 *   - Bounded value sweep: a string value (scalar field, or element of
 *     a non-carrier array) matching an ANCHORED storage pattern —
 *     `s3://` / `gs://` prefixes, `http(s)://` on amazonaws.com /
 *     cloudflarestorage.com / storage.googleapis.com /
 *     blob.core.windows.net hosts, or `/api/files/` / `/uploads/`
 *     prefixes — is dropped/removed. No other patterns: held-detail
 *     {table,id,reason} records, ISO dates, tombstone values and plain
 *     strings must survive.
 *   - Fail-closed copy: if the input cannot be JSON-serialised
 *     (BigInt / circular producer bug), return {} — never throw,
 *     never pass the raw object through.
 * Everything else — counts, booleans, table-name lists, held-detail
 * records, the auto-apply consent tombstone — passes through
 * unchanged.
 *
 * Privacy red line (STOP 1 R-3(c)): NO hash of any key or identifier is
 * ever substituted — counts only. A hash of a storage key is a stable
 * identifier for the object and is not minimisation.
 *
 * Standalone module (no requires) so both routes and erasureService can
 * share it without coupling to erasureService's mocked surface in route
 * suites; erasureService re-exports it for discoverability.
 */
const LIST_CARRIERS = {
	storagekeys: 'storageKeysCount',
	nonpatternstorageurls: 'nonPatternStorageUrlCount',
};
const COUNT_FIELDS = {
	storagekeyscount: 'storagekeys',
	nonpatternstorageurlcount: 'nonpatternstorageurls',
};
const SINGLE_CARRIERS = new Set(['fileurl', 'objectkey']);
const STORAGE_HOSTS = [
	'amazonaws.com',
	'cloudflarestorage.com',
	'storage.googleapis.com',
	'blob.core.windows.net',
];

const canonical = (key) => key.toLowerCase().replace(/[_\-.]/g, '');

function isStorageValue(value) {
	if (value.startsWith('s3://') || value.startsWith('gs://')) return true;
	if (value.startsWith('/api/files/') || value.startsWith('/uploads/')) return true;
	const match = /^https?:\/\/([^/?#:]+)/i.exec(value);
	if (!match) return false;
	const host = match[1].toLowerCase();
	return STORAGE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function carrierCount(value) {
	if (value === null || value === undefined) return 0;
	if (Array.isArray(value)) return value.length;
	if (typeof value === 'string') return 1;
	if (typeof value === 'object') return Object.keys(value).length;
	return 1;
}

// Deep clone that preserves undefined-valued keys (a JSON round-trip
// would drop them, and an undefined list carrier must still emit 0).
// Only called after JSON.stringify has succeeded, so the graph is
// acyclic and BigInt-free.
function clone(node) {
	if (Array.isArray(node)) return node.map(clone);
	if (node && typeof node === 'object') {
		const out = {};
		for (const key of Object.keys(node)) {
			// defineProperty, not assignment: an own `__proto__` key must
			// stay an own property, not rewrite `out`'s prototype (S-35).
			Object.defineProperty(out, key, {
				value: clone(node[key]),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return out;
	}
	return node;
}

// Own-property lookup only: `canon in TABLE` would also match
// Object.prototype members (a `constructor` key canonicalises to
// 'constructor'), corrupting an ordinary field into a carrier (S-35).
const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

function sanitizeErasureResult(result) {
	if (!result || typeof result !== 'object') return result;
	let copy;
	try {
		// Fail-closed gate: BigInt / circular input throws here.
		JSON.stringify(result);
		copy = clone(result);
	} catch {
		return {};
	}
	const walk = (node) => {
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) {
				if (typeof node[i] === 'string' && isStorageValue(node[i])) node.splice(i, 1);
				else walk(node[i]);
			}
			return;
		}
		if (!node || typeof node !== 'object') return;
		const keys = Object.keys(node);
		const computed = {};
		for (const key of keys) {
			const canon = canonical(key);
			if (has(LIST_CARRIERS, canon)) computed[canon] = carrierCount(node[key]);
		}
		for (const key of keys) {
			const canon = canonical(key);
			if (has(LIST_CARRIERS, canon) || SINGLE_CARRIERS.has(canon)) {
				delete node[key];
			} else if (has(COUNT_FIELDS, canon)) {
				// Spoofed count with a present carrier loses (canonical
				// count is emitted below); with no carrier, left as-is.
				if (has(computed, COUNT_FIELDS[canon])) delete node[key];
			} else if (canon.includes('storagekey') || canon.includes('storageurl')) {
				delete node[key];
			} else if (typeof node[key] === 'string' && isStorageValue(node[key])) {
				delete node[key];
			} else {
				walk(node[key]);
			}
		}
		for (const canon of Object.keys(computed)) node[LIST_CARRIERS[canon]] = computed[canon];
	};
	walk(copy);
	return copy;
}

module.exports = { sanitizeErasureResult };
