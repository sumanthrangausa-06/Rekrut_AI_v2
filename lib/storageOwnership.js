/**
 * storageOwnership — #1137: ownership binding for ledgered storage
 * deletions.
 *
 * The erasure storage ledger (pending_storage_deletions) historically
 * proved only that a URL is *shaped* like an app storage URL
 * (/api/files/…); deleteFile deletes whatever the shape names. Several
 * ledgered URL fields are client-supplied (onboarding_documents
 * .document_url, offers.signature_url, portfolio_projects.image_url,
 * documents.url), so a planted URL could name another tenant's object.
 *
 * Real object keys carry NO tenant id (verified across every upload
 * caller, STOP 1 on #1137): keys are
 *   /api/files/<provider>/<family-prefix>/<timestamp>-<random>-<name>
 * with family prefixes shared by all tenants — so ownership cannot be
 * read off the key. It is proven negatively instead: an object is
 * deletable at a candidate's erasure only when NO surviving database
 * row still references it. The erasing user's own referencing rows
 * are deleted/redacted in Phase 1 (or the entry is legal-hold-skipped
 * before this check runs), so any reference that survives to the
 * Phase-2 drain belongs to another tenant, a company, or a retained
 * joint record — the object is contested and must NOT be deleted.
 *
 * Matching is exact equality only (never LIKE — URLs contain %/_ and
 * unicode, and a wildcard false positive in either direction is a
 * security bug here), against ALL spellings of the object: the raw
 * stored file_url, the canonical fully-decoded form, and the
 * whole-key encodeURIComponent'd form. The encoded form is the
 * DOMINANT real writer spelling (uploadFile returns
 * /api/files/<encodeURIComponent(key)> and that value is stored
 * verbatim into cv_uploads / parsed_resumes / profiles / messages),
 * while client-supplied fields store whatever the client sent —
 * plain included. Comparing only raw+decoded misses a plain plant
 * against an encoded victim reference (independent review C-1 on
 * #1137, reproduced first-hand). Real keys are ASCII-unreserved
 * after uploadFile's filename sanitiser, so {plain, whole-encoded}
 * is the complete real-writer spelling set; partial encodings in a
 * ledger entry collapse to the canonical form on decode.
 */

const FILES_PREFIX = '/api/files/';

/**
 * Normalise a ledgered /api/files/ URL into its comparison forms.
 *
 * @param {string} fileUrl
 * @returns {null | { raw: string, canonicalUrl: string, encodedUrl: string, decodedKey: string, bareObjectKey: string }}
 *   null when the value is not an /api/files/ URL or cannot be decoded
 *   (not addressable by this check — the caller decides fail-closed
 *   handling by context).
 */
function storageUrlForms(fileUrl) {
	if (typeof fileUrl !== 'string' || !fileUrl.startsWith(FILES_PREFIX)) return null;
	let decodedKey;
	try {
		decodedKey = decodeURIComponent(fileUrl.slice(FILES_PREFIX.length));
	} catch (_e) {
		return null;
	}
	// deleteFile's routing floor: a provider prefix must exist.
	const slashIdx = decodedKey.indexOf('/');
	if (slashIdx === -1 || slashIdx === decodedKey.length - 1) return null;
	return {
		raw: fileUrl,
		canonicalUrl: `${FILES_PREFIX}${decodedKey}`,
		encodedUrl: `${FILES_PREFIX}${encodeURIComponent(decodedKey)}`,
		decodedKey,
		bareObjectKey: decodedKey.slice(slashIdx + 1),
	};
}

// Every column that can hold a reference to a storage object, swept
// from migrations + writers (STOP 1 §4, Scout-verified; files.documents
// / share_link columns are false positives — provenance hashes and
// public token links, not storage URLs). documents.url is attributed
// (user_id <> erasing user) because that table is not itself erased;
// job_applications.resume_url survives only on retained/redacted rows
// (unheld rows are nulled in Phase 1); recording_objects is matched on
// its raw key forms and only for live (not already-stamped) rows.
const SURVIVING_REFERENCE_SQL = `
	SELECT (
		EXISTS (SELECT 1 FROM cv_uploads WHERE file_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM parsed_resumes WHERE file_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM candidate_profiles WHERE resume_url IN ($1, $2, $3) OR photo_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM users WHERE avatar_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM verification_documents WHERE file_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM messages WHERE file_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM onboarding_documents WHERE document_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM offers WHERE signature_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM signature_documents WHERE file_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM portfolio_projects WHERE image_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM job_applications WHERE resume_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM companies WHERE logo_url IN ($1, $2, $3))
		OR EXISTS (SELECT 1 FROM recording_objects WHERE object_key IN ($4, $5) AND deleted_at IS NULL)
		OR EXISTS (
			SELECT 1 FROM interviews
			WHERE jsonb_typeof(video_urls) = 'array'
			  AND EXISTS (
				SELECT 1 FROM jsonb_array_elements(video_urls) AS e(v)
				WHERE e.v = to_jsonb($1::text)
				   OR e.v = to_jsonb($2::text)
				   OR e.v = to_jsonb($3::text)
				   OR (jsonb_typeof(e.v) = 'object' AND e.v ->> 'url' IN ($1, $2, $3))
			  )
		)
	) AS still_referenced`;

/**
 * Does any surviving database row still reference this ledgered
 * object? Throws on query failure — the caller MUST fail closed
 * (an unverifiable ownership is a skip, never a delete).
 *
 * @param {{ query: Function }} queryable
 * @param {{ userId: number, forms: object }} args — forms from storageUrlForms()
 * @returns {Promise<boolean>}
 */
// documents is NOT created by any migration — routes/candidate.js
// creates it lazily at runtime (CREATE TABLE IF NOT EXISTS), so on a
// fresh install the table may not exist and a hard reference would
// throw on every drain (caught first-hand by the #1137 Quinn gate on
// a migrate.js-only DB). It is therefore checked separately, guarded
// by to_regclass. It is attributed (user_id <> erasing user) because
// that table is not itself erased.
const DOCUMENTS_REFERENCE_SQL = `
	SELECT EXISTS (
		SELECT 1 FROM documents WHERE url IN ($1, $2, $3) AND user_id <> $4
	) AS still_referenced`;

async function hasSurvivingStorageReference(queryable, { userId, forms }) {
	const { rows } = await queryable.query(SURVIVING_REFERENCE_SQL, [
		forms.raw,
		forms.canonicalUrl,
		forms.encodedUrl,
		forms.decodedKey,
		forms.bareObjectKey,
	]);
	if (rows?.[0]?.still_referenced === true) return true;
	const { rows: regRows } = await queryable.query(
		`SELECT to_regclass('public.documents') AS reg`,
	);
	if (!regRows?.[0]?.reg) return false;
	const { rows: docRows } = await queryable.query(DOCUMENTS_REFERENCE_SQL, [
		forms.raw,
		forms.canonicalUrl,
		forms.encodedUrl,
		userId,
	]);
	return docRows?.[0]?.still_referenced === true;
}

// Source families whose object keys are server-generated and whose
// ledger rows originate from candidate-keyed catalogue rows
// (recording_objects.candidate_id; decrypted interview_recordings
// pointers) — ownership is proven by that catalogue attribution, and
// no client write path can plant a key into them. Exemption is by
// SOURCE, never by URL shape (privacy-engineer condition, STOP 1 §6).
const CATALOGUE_SOURCE_FAMILIES = new Set(['frame', 'observer_audio', 'livekit_recording']);

module.exports = {
	storageUrlForms,
	hasSurvivingStorageReference,
	SURVIVING_REFERENCE_SQL,
	CATALOGUE_SOURCE_FAMILIES,
};
