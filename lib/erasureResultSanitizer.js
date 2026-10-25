/**
 * erasureResultSanitizer — #1128 GAP-I (K-2, D-8b).
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
 * never mutated):
 *   - `storageKeys` (any depth)            → `storageKeysCount`
 *   - `nonPatternStorageUrls` (any depth)  → `nonPatternStorageUrlCount`
 *     (covers gapC.nonPatternStorageUrls and gapD.nonPatternStorageUrls,
 *     the two nested carriers in the result assembly)
 *   - stray `file_url` / `fileUrl` / `object_key` / `objectKey` values
 *     are dropped outright (defence in depth for future sub-objects)
 * Everything else — counts, booleans, table-name lists, held-detail
 * {table,id,reason} records, the auto-apply consent tombstone — passes
 * through unchanged; those fields carry no storage keys (verified
 * against the erasePersonalData result assembly + per-family objects).
 *
 * Privacy red line (STOP 1 R-3(c)): NO hash of any key or identifier is
 * ever substituted — counts only. A hash of a storage key is a stable
 * identifier for the object and is not minimisation.
 *
 * Standalone module (no requires) so both routes and erasureService can
 * share it without coupling to erasureService's mocked surface in route
 * suites; erasureService re-exports it for discoverability.
 */
function sanitizeErasureResult(result) {
	if (!result || typeof result !== 'object') return result;
	// The result object is JSON-safe by construction (counts, booleans,
	// strings, plain sub-objects) — a JSON round-trip is the cheapest
	// correct deep copy and guarantees the input is never mutated.
	const copy = JSON.parse(JSON.stringify(result));
	const walk = (node) => {
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		if (!node || typeof node !== 'object') return;
		for (const key of Object.keys(node)) {
			if (key === 'storageKeys' && Array.isArray(node[key])) {
				node.storageKeysCount = node[key].length;
				delete node[key];
			} else if (key === 'nonPatternStorageUrls' && Array.isArray(node[key])) {
				node.nonPatternStorageUrlCount = node[key].length;
				delete node[key];
			} else if (key === 'file_url' || key === 'fileUrl' || key === 'object_key' || key === 'objectKey') {
				delete node[key];
			} else {
				walk(node[key]);
			}
		}
	};
	walk(copy);
	return copy;
}

module.exports = { sanitizeErasureResult };
