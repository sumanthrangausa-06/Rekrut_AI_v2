/**
 * applicationIpCapture — application-time IP capture + consent gate
 * (#815, S-095).
 *
 * WHAT THIS IS: at MANUAL application time only (wired solely in the
 * POST /jobs/:jobId/apply route — never in the shared submitApplication
 * helper, never in the auto-apply routes), when the candidate has
 * explicitly consented, this module records ONE row in
 * application_ip_captures (migration 261): a company-siloed
 * pseudonymised fingerprint of the request IP, the server-resolved
 * consent text version, and a receipt hash binding the grant. It is
 * part of the #807 dark chassis family: the same dark flag gates it,
 * the same fingerprint function silos it, and there is NO read path —
 * nothing in this story reads the table back, and no surface may show
 * a capture (#788 quarantine: never surfaced; purge-not-migrate).
 *
 * FAIL-CLOSED ORDER (every early exit is a refusal, never a write):
 *   (a) dark flag OFF → { captured:false, reason:'disabled' } before
 *       anything else — no queries, no fingerprint work. The flag is
 *       read through its sole-reader module (lib/threatIntelFlag.js);
 *       this module never reads the flag env var directly.
 *   (b) consentGiven !== true → { captured:false, reason:'no_consent' }
 *       — the fingerprint is NOT computed for a non-consent.
 *   (c) request IP missing/'unknown' after normalisation →
 *       { captured:false, reason:'no_ip' }.
 *   (d) no current 'application_ip' consent text → coded
 *       NO_CONSENT_TEXT throw (the route catches all capture errors;
 *       there is nothing lawful to consent TO without the text).
 *   (e) companyId null → coded UNSILOED_SUBJECT throw (mirrors
 *       recordCheck C3): a fingerprint minted outside a company silo
 *       would be cross-company comparable, so it is never minted.
 *       The fingerprint secret is read only inside fingerprintFor
 *       (lib/threatIntelChecks.js) — a missing/short secret propagates
 *       as its coded CONFIG_ERROR.
 *
 * HONEST LIMITS (privacy, STOP 1): the fingerprint is
 * PSEUDONYMISATION only — the row remains personal data; nothing
 * here de-identifies anyone. For a low-entropy subject like an IPv4 address, any holder
 * of the fingerprint secret can reverse a fingerprint by
 * recomputation within a company silo. The raw IP itself is never
 * stored, logged, or returned, and the fingerprint is never
 * returned. This module logs nothing.
 *
 * RETENTION: retention_expires_at = captured_at + 12 months is
 * stamped at insert (SQL-side). The row also dies with candidate
 * erasure (explicit counted DELETE in lib/erasureService.js, keyed
 * by the #780 unheld application set; legally-held applications'
 * rows survive and are counted).
 */

const crypto = require('node:crypto');
const { isThreatIntelEnabled } = require('./threatIntelFlag');
const { fingerprintFor } = require('./threatIntelChecks');

const CONSENT_TYPE = 'application_ip';
const FINGERPRINT_KIND = 'application_ip';

function codedError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

// Request-IP normalisation (mirrors the chassis normalisation in
// recordCheck, plus the IPv4-mapped-IPv6 prefix strip): trim,
// lowercase, strip a leading '::ffff:' so '::ffff:192.0.2.10' and
// '192.0.2.10' are the same subject.
function normaliseIp(reqIp) {
	if (reqIp === undefined || reqIp === null) return '';
	let ip = String(reqIp).trim().toLowerCase();
	if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);
	return ip;
}

/**
 * Capture one application-time IP fingerprint.
 *
 * @param {object} input
 * @param {number} input.applicationId — the job application created.
 * @param {number} input.candidateId — the applying candidate.
 * @param {number} input.companyId — the job's company (the silo);
 *   taken from the job row by the route, never from the request body.
 * @param {string} [input.reqIp] — the request IP (req.ip at the route).
 * @param {boolean} input.consentGiven — must be exactly true.
 * @param {object} [options]
 * @param {object} [options.client] — pg-like client (defaults to lib/db).
 * @returns {Promise<{captured:true, id}|{captured:false, reason:string}>}
 * @throws coded NO_CONSENT_TEXT / UNSILOED_SUBJECT / CONFIG_ERROR —
 *   the caller (route) catches all of these; the application response
 *   is never affected by a capture failure.
 */
async function captureApplicationIp(input = {}, options = {}) {
	// (a) Dark-flag refusal FIRST: before consent handling, any query,
	// and any fingerprint work.
	if (!isThreatIntelEnabled()) {
		return { captured: false, reason: 'disabled' };
	}

	// (b) Consent gate: only an explicit boolean true consents. The
	// fingerprint is not computed on this path.
	if (input.consentGiven !== true) {
		return { captured: false, reason: 'no_consent' };
	}

	// (c) Subject normalisation: no usable IP → nothing to capture.
	const normalisedIp = normaliseIp(input.reqIp);
	if (normalisedIp === '' || normalisedIp === 'unknown') {
		return { captured: false, reason: 'no_ip' };
	}

	const client = options.client || require('./db');

	// (d) Consent text version resolved server-side (MAX(effective_from),
	// consentService.getCurrentTextVersion pattern) — never from the
	// request. No text ⇒ fail closed with a coded throw.
	const { rows: textRows } = await client.query(
		`SELECT version FROM consent_texts
		 WHERE consent_type = $1
		   AND effective_from = (SELECT MAX(effective_from) FROM consent_texts WHERE consent_type = $1)`,
		[CONSENT_TYPE],
	);
	if (!textRows || textRows.length === 0) {
		throw codedError(
			'NO_CONSENT_TEXT',
			'applicationIpCapture: no consent text is configured for application-time IP capture',
		);
	}
	const consentTextVersion = Number.parseInt(textRows[0].version, 10);
	if (!Number.isFinite(consentTextVersion)) {
		throw codedError(
			'NO_CONSENT_TEXT',
			'applicationIpCapture: no consent text is configured for application-time IP capture',
		);
	}

	// (e) Silo gate (recordCheck C3 mirror): no company → no mint.
	if (input.companyId === undefined || input.companyId === null) {
		throw codedError(
			'UNSILOED_SUBJECT',
			'applicationIpCapture: subject cannot be siloed without a company',
		);
	}

	// (f) Fingerprint (secret read lazily inside fingerprintFor only)
	// + receipt hash binding candidate + application + grant instant.
	const fingerprint = fingerprintFor(input.companyId, FINGERPRINT_KIND, normalisedIp);
	const consentGrantedAt = new Date().toISOString();
	const receiptHash = crypto
		.createHash('sha256')
		.update(`application_ip:${input.candidateId}:${input.applicationId}:${consentGrantedAt}:true`)
		.digest('hex');

	// (g) One INSERT; the UNIQUE(job_application_id) + ON CONFLICT DO
	// NOTHING makes a re-apply race a counted no-op, not an error.
	// Retention is computed in SQL from the insert instant.
	const { rows: inserted } = await client.query(
		`INSERT INTO application_ip_captures
		   (job_application_id, candidate_id, company_id, ip_fingerprint, consent_text_version, consent_granted_at, receipt_hash, retention_expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '12 months')
		 ON CONFLICT (job_application_id) DO NOTHING
		 RETURNING id`,
		[
			input.applicationId,
			input.candidateId,
			input.companyId,
			fingerprint,
			consentTextVersion,
			consentGrantedAt,
			receiptHash,
		],
	);
	if (!inserted || inserted.length === 0) {
		return { captured: false, reason: 'duplicate' };
	}
	return { captured: true, id: inserted[0].id };
}

module.exports = { captureApplicationIp };
