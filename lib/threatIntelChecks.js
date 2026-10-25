/**
 * threatIntelChecks — dark threat-intel check pipeline (#807, S-090).
 *
 * WHAT THIS IS: the chassis only. A lib-only pipeline that can record
 * one check observation per job application, with provenance, into
 * threat_intel_checks (migration 260). There is NO read path: this
 * module exports recordCheck, and — since #815 (S-095) —
 * fingerprintFor, the pure HMAC compute function (no access to
 * stored rows) shared with lib/applicationIpCapture.js. No lookup,
 * verify, or compare-by-fingerprint export exists, so the stored
 * fingerprint can never be used as a guessing oracle from inside the
 * codebase (security C6). No route mounts it, no surface reads it,
 * and the dark flag (lib/threatIntelFlag.js — the flag's only reader)
 * is OFF by default: with the flag OFF, recordCheck refuses before
 * anything else happens and writes nothing.
 *
 * FINGERPRINT HONESTY (security C7 / privacy C2 — read before
 * touching this code):
 *   - The subject fingerprint is PSEUDONYMISATION, not
 *     de-identification. The row remains personal data. For
 *     low-entropy kinds (an IPv4 address above all), anyone holding
 *     the fingerprint secret can reverse a fingerprint by
 *     recomputation — guessing candidate values per company until
 *     one matches. The silo guarantee is only this: without the
 *     secret, the same value fingerprinted under two companies
 *     produces unrelated outputs, and no cross-company comparison
 *     function exists.
 *   - Rotating the fingerprint secret orphans ALL existing
 *     fingerprints: no recompute path exists or should be built.
 *     That is accepted for a dark chassis with no production rows;
 *     rotation once real subjects exist requires revisiting this.
 *   - Within one company, fingerprints deliberately link that
 *     candidate's checks across applications (the future signal's
 *     purpose) — the store is linkable inside the silo by design.
 *
 * #788 GATE (privacy C5): rows recorded before the #788 CRA
 * determination is obtained are NEVER surfaced to any employer. Any
 * future release covers only post-determination checks recorded
 * after the determination's required notice/consent sequence exists,
 * absent counsel's written clearance of retroactive use. Enabling
 * this chassis in any production environment is additionally blocked
 * until #788 closes.
 *
 * PROVIDERS: the registry is config shape only and EMPTY by default —
 * no shipped provider performs any network call, file read, or
 * external lookup. Callers (tests) may inject providers shaped
 * { key, run(ctx) -> observation }. The `source` of a recorded check
 * must be a key of the injected registry, and every entry of the
 * observation's sources_checked / sources_failed must be one too.
 *
 * ERRORS: every refusal is a coded Error (err.code). Error messages
 * carry codes and static text only — never a subject value, a
 * fingerprint, or a payload (security C6). This module logs nothing.
 */

const crypto = require('node:crypto');
const { isThreatIntelEnabled } = require('./threatIntelFlag');

// Config-only plug shape: no provider is enabled by default.
const PROVIDER_REGISTRY = Object.freeze({});

const KIND_PATTERN = /^[a-z][a-z0-9_-]*$/;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MIN_SECRET_LENGTH = 32;

// Raw-identifier key denylist for the payload contract (security C4 /
// privacy C1) — token-based so variants (ip_address, contact_email,
// emailAddress, date_of_birth) are caught; errs wide by design.
const DENIED_KEY_TOKENS = new Set([
	'ip',
	'email',
	'phone',
	'name',
	'ssn',
	'address',
	'dob',
	'birth',
	'passport',
	'license',
	'licence',
	'card',
	'iban',
	'subject',
	'value',
	'username',
	'password',
]);

function codedError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

/**
 * The fingerprint secret is read LAZILY, here and nowhere else
 * (security C2): never at module load, so importing this module in a
 * deployment without the secret set is harmless, and the flag-OFF
 * refusal in recordCheck happens before this function can run.
 * Fail-closed (r2FrameStore pattern): unset or under-length is a
 * coded CONFIG_ERROR in every environment — there is no fallback.
 */
function fingerprintFor(companyId, kind, normalisedValue) {
	const secret = process.env.THREAT_INTEL_HMAC_SECRET;
	if (!secret || secret.length < MIN_SECRET_LENGTH) {
		throw codedError(
			'CONFIG_ERROR',
			'threatIntelChecks: fingerprint secret is not configured',
		);
	}
	const companyKey = crypto
		.createHmac('sha256', secret)
		.update('threat-intel:v1:company:' + companyId)
		.digest();
	return crypto
		.createHmac('sha256', companyKey)
		.update(kind + ':' + normalisedValue)
		.digest('hex');
}

function isPlainObject(value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function keyTokens(key) {
	return String(key)
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

function keyIsDenied(key) {
	if (/ssn|social_security/i.test(String(key))) return true;
	return keyTokens(key).some((token) => DENIED_KEY_TOKENS.has(token));
}

function scanPayloadValue(value, rawSubjectValues) {
	if (typeof value === 'string') {
		if (rawSubjectValues.includes(value)) {
			throw codedError(
				'PAYLOAD_REJECTED',
				'threatIntelChecks: payload carries the raw subject value',
			);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) scanPayloadValue(item, rawSubjectValues);
		return;
	}
	if (isPlainObject(value)) {
		for (const [key, child] of Object.entries(value)) {
			if (keyIsDenied(key)) {
				throw codedError(
					'PAYLOAD_REJECTED',
					'threatIntelChecks: payload carries a raw-identifier key',
				);
			}
			scanPayloadValue(child, rawSubjectValues);
		}
	}
}

function validatePayload(payload, rawSubjectValues) {
	if (!isPlainObject(payload)) {
		throw codedError('PAYLOAD_REJECTED', 'threatIntelChecks: payload must be a plain object');
	}
	let serialised;
	try {
		serialised = JSON.stringify(payload);
	} catch {
		throw codedError('PAYLOAD_REJECTED', 'threatIntelChecks: payload is not serialisable');
	}
	if (Buffer.byteLength(serialised, 'utf8') > MAX_PAYLOAD_BYTES) {
		throw codedError('PAYLOAD_REJECTED', 'threatIntelChecks: payload exceeds the size bound');
	}
	scanPayloadValue(payload, rawSubjectValues);
}

/**
 * Record one threat-intel check for an application.
 *
 * @param {object} input
 * @param {number} input.applicationId — the job application checked.
 * @param {string} [input.source] — provider key; must exist in the
 *   injected registry (defaults to the registry's sole key, if any).
 * @param {string} [input.severity] — only 'info' is accepted.
 * @param {{kind: string, value: *}} [input.subject] — typed subject
 *   to fingerprint under the application's company silo. The raw
 *   value is never stored, logged, or returned.
 * @param {object} [input.payload] — observation payload when the
 *   provider returns none; validated by the same contract.
 * @param {object} [options]
 * @param {object} [options.client] — pg-like client (defaults to
 *   lib/db). The application row is read on this client and
 *   company_id is taken from THAT row — a caller-supplied company
 *   is never read, so no caller can mint a fingerprint under
 *   another company's key (security C8).
 * @param {object} [options.providers] — provider registry override
 *   (the chassis default is the empty frozen registry above).
 * @returns {Promise<{id, checked_at, companyId, siloed}>}
 */
async function recordCheck(input = {}, options = {}) {
	// 1. Dark-flag refusal FIRST (security C2): before any secret
	// access, any provider work, and any database access.
	if (!isThreatIntelEnabled()) {
		throw codedError('THREAT_INTEL_DISABLED', 'threatIntelChecks: checks are disabled');
	}

	// 2. Severity cap (app layer; the DB equality CHECK is the second
	// line of defence). Anything but 'info' refuses.
	const severity = input.severity === undefined ? 'info' : input.severity;
	if (severity !== 'info') {
		throw codedError('INVALID_SEVERITY', 'threatIntelChecks: severity is capped at info');
	}

	// 3. Subject shape + kind grammar (security C5): the kind prefixes
	// the fingerprint input, so it is restricted to a grammar with no
	// separator and no uppercase — two distinct (kind, value) pairs
	// can never collide on one fingerprint input string.
	const subject = input.subject === undefined ? null : input.subject;
	let normalisedValue = null;
	if (subject !== null) {
		if (
			typeof subject !== 'object' ||
			typeof subject.kind !== 'string' ||
			!KIND_PATTERN.test(subject.kind)
		) {
			throw codedError('INVALID_SUBJECT_KIND', 'threatIntelChecks: subject kind is invalid');
		}
		if (subject.value === undefined || subject.value === null || String(subject.value).trim() === '') {
			throw codedError('INVALID_SUBJECT', 'threatIntelChecks: subject value is required');
		}
		normalisedValue = String(subject.value).trim().toLowerCase();
	}

	// 4. The application row is the only source of company scope.
	const client = options.client || require('./db');
	const { rows } = await client.query(
		'SELECT id, company_id FROM job_applications WHERE id = $1',
		[input.applicationId],
	);
	if (!rows || rows.length === 0) {
		throw codedError('APPLICATION_NOT_FOUND', 'threatIntelChecks: application not found');
	}
	const companyId = rows[0].company_id ?? null;

	// 5. Privacy C3 (fail-closed): a subject that cannot be siloed is
	// never recorded — not with a NULL fingerprint, not at all.
	// (A subject-less provenance row may still record, with a NULL
	// fingerprint, on a NULL-company application.)
	if (subject !== null && companyId === null) {
		throw codedError(
			'UNSILOED_SUBJECT',
			'threatIntelChecks: subject cannot be siloed for this application',
		);
	}

	// 6. Provider resolution: the source must be a registry key, and
	// every provenance entry the provider reports must be one too
	// (security C4).
	const registry = options.providers || PROVIDER_REGISTRY;
	const providerKeys = Object.keys(registry);
	let sourceKey = input.source === undefined ? null : input.source;
	if (sourceKey === null) {
		sourceKey = providerKeys.length === 1 ? providerKeys[0] : null;
	}
	if (sourceKey === null || !Object.prototype.hasOwnProperty.call(registry, sourceKey)) {
		throw codedError('UNKNOWN_SOURCE', 'threatIntelChecks: source is not a registered provider');
	}
	const provider = registry[sourceKey];
	let observation = {};
	if (provider && typeof provider.run === 'function') {
		observation =
			(await provider.run({
				applicationId: input.applicationId,
				companyId,
				subjectKind: subject ? subject.kind : null,
			})) || {};
	}
	const payload =
		observation.payload !== undefined
			? observation.payload
			: input.payload !== undefined
				? input.payload
				: {};
	const sourcesChecked =
		observation.sources_checked !== undefined ? observation.sources_checked : [sourceKey];
	const sourcesFailed =
		observation.sources_failed !== undefined ? observation.sources_failed : [];
	if (
		!Array.isArray(sourcesChecked) ||
		!Array.isArray(sourcesFailed) ||
		[...sourcesChecked, ...sourcesFailed].some((entry) => !providerKeys.includes(entry))
	) {
		throw codedError('UNKNOWN_SOURCE', 'threatIntelChecks: provenance names an unregistered provider');
	}

	// 7. Payload contract (security C4 / privacy C1), enforced before
	// anything is written — and before the fingerprint is computed,
	// so a refused payload never touches the secret either.
	validatePayload(payload, subject ? [String(subject.value), normalisedValue] : []);

	// 8. Fingerprint (lazy secret read, inside fingerprintFor only).
	const fingerprint = subject ? fingerprintFor(companyId, subject.kind, normalisedValue) : null;

	// 9. One INSERT with provenance. `source` is the provider that
	// produced this observation; sources_checked / sources_failed
	// list every provider consulted for it (a one-provider chassis
	// normally has source === sources_checked[0]).
	const { rows: inserted } = await client.query(
		`INSERT INTO threat_intel_checks
		   (job_application_id, company_id, source, severity, subject_fingerprint, signal_payload, sources_checked, sources_failed)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id, checked_at`,
		[
			input.applicationId,
			companyId,
			sourceKey,
			'info',
			fingerprint,
			JSON.stringify(payload),
			sourcesChecked,
			sourcesFailed,
		],
	);
	const row = inserted && inserted[0] ? inserted[0] : {};
	return {
		id: row.id,
		checked_at: row.checked_at,
		companyId,
		siloed: fingerprint !== null,
	};
}

// #815 (S-095): fingerprintFor is additionally exported for the
// application-time IP capture module (lib/applicationIpCapture.js),
// which mints siloed fingerprints under a different kind through this
// one secret-reading path — the secret stays read here and nowhere
// else. No behaviour change to recordCheck.
module.exports = { recordCheck, fingerprintFor };
