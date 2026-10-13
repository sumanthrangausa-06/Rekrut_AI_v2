/**
 * legalHold — platform legal-hold mechanism (G-1, #799).
 *
 * Rex's verified design (issue #799, 2026-10-13T17:07Z): the hold seam
 * already exists in lib/observerCapture.js (isLegalHoldActive, formerly
 * a stub returning false). This module is the ONE canonical hold
 * service behind that seam:
 *
 *   - legal_holds table (migration 258): subject user and/or company,
 *     reason, set_by/set_at, released_by/released_at. A hold is active
 *     while released_at IS NULL.
 *   - isHeld({userId, companyId, sessionId}) — consulted per row,
 *     before delete, by every purge/deletion path (there is no choke
 *     point: ≥6 independent purge functions + erasureService + the
 *     pending_storage_deletions ledger drain).
 *   - FAIL-CLOSED: a hold-check error returns TRUE (treat as held).
 *     A purge that cannot verify hold status must not delete.
 *   - placeHold / releaseHold — admin-only at the route layer
 *     (routes/admin.js, requireAdmin); every placement/release is
 *     written to compliance_audit_trail via auditLogService.
 *
 * DEK note: crypto-shredding is deletion. erasePersonalData consults
 * isHeld at its entry, BEFORE destroyDEK, and throws LegalHoldError —
 * the DSAR route maps it to 409 (GDPR Art. 17(3)(e): the conflict is
 * surfaced and recorded, never a silent proceed or silent refusal).
 */
const db = require('./db');

class LegalHoldError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = 'LegalHoldError';
		this.code = 'LEGAL_HOLD';
		this.status = 409;
		this.details = details;
	}
}

// ─── Compliance audit (compliance_audit_trail via auditLogService) ─────────
// Best-effort-but-loud: placing a hold is the protective action — if the
// audit write fails, the hold must still stand (a missing hold deletes
// evidence; a missing audit row is recoverable from legal_holds itself,
// which carries set_by/set_at/released_by/released_at). The failure is
// logged, never silent. Injectable for tests (observerCapture _setLogSink
// precedent).
let auditWriter = null;
function _setAuditWriter(fn) {
	auditWriter = typeof fn === 'function' ? fn : null;
}

async function writeAudit(entry) {
	const writer = auditWriter || (async (e) => require('../services/auditLogService').logEvent(e));
	try {
		await writer(entry);
	} catch (err) {
		console.error('[legalHold] compliance audit write failed:', err.message);
	}
}

function auditEntryFor(row, action, actorLabel) {
	const isCompanyOnly = row.user_id == null && row.company_id != null;
	return {
		eventType: 'status_change',
		entityType: isCompanyOnly ? 'company' : 'user',
		entityId: row.user_id ?? row.company_id,
		actorId:
			Number.isInteger(Number(actorLabel)) && String(actorLabel).trim() !== ''
				? Number(actorLabel)
				: null,
		actorRole: 'admin',
		companyId: row.company_id ?? null,
		payload: {
			action,
			holdId: row.id,
			userId: row.user_id ?? null,
			companyId: row.company_id ?? null,
			reason: row.reason,
			actor: String(actorLabel),
		},
	};
}

// ─── Hold check ─────────────────────────────────────────────────────────────

/**
 * Is there an ACTIVE (unreleased) hold covering this subject?
 * Matches: a user hold on the subject; a company hold on the given
 * company; a company hold on the subject's own company (users.company_id).
 * A sessionId (with no userId) resolves candidate + company from
 * interview_sessions first.
 *
 * FAIL-CLOSED: any error → true.
 *
 * @param {{ userId?: number, candidateId?: number, companyId?: number, sessionId?: number }} subject
 * @param {object} [queryable] pg pool/client (defaults to lib/db)
 * @returns {Promise<boolean>}
 */
async function isHeld({ userId, candidateId, companyId, sessionId } = {}, queryable = db) {
	let uid = userId ?? candidateId ?? null;
	let cid = companyId ?? null;
	try {
		if (sessionId != null && uid == null) {
			const { rows } = await queryable.query(
				`SELECT candidate_id, company_id FROM interview_sessions WHERE id = $1`,
				[sessionId],
			);
			if (rows[0]) {
				uid = rows[0].candidate_id ?? null;
				if (cid == null) cid = rows[0].company_id ?? null;
			}
		}
		if (uid == null && cid == null) return false;
		const { rows } = await queryable.query(
			`SELECT id FROM legal_holds
			 WHERE released_at IS NULL
			   AND (
			     (user_id IS NOT NULL AND user_id = $1)
			     OR (company_id IS NOT NULL AND company_id = $2)
			     OR (company_id IS NOT NULL AND $1 IS NOT NULL
			         AND company_id = (SELECT company_id FROM users WHERE id = $1))
			   )
			 LIMIT 1`,
			[uid, cid],
		);
		return rows.length > 0;
	} catch (err) {
		console.error(
			'[legalHold] hold check failed — failing closed (treating subject as held):',
			err.message,
		);
		return true;
	}
}

/**
 * Is ANY hold active? For purge branches whose rows cannot be
 * attributed to a subject (biometric_templates: no identity column by
 * design, migration 246). Fail-closed on error, like isHeld.
 */
async function anyHoldActive(queryable = db) {
	try {
		const { rows } = await queryable.query(
			`SELECT id FROM legal_holds WHERE released_at IS NULL LIMIT 1`,
		);
		return rows.length > 0;
	} catch (err) {
		console.error(
			'[legalHold] any-hold check failed — failing closed (treating as held):',
			err.message,
		);
		return true;
	}
}

// ─── SQL predicates for bulk purge branches ─────────────────────────────────
// For DELETE/UPDATE/COUNT statements over a table whose rows carry a
// user-id expression (e.g. 'audit_logs.user_id'). Company coverage comes
// through the subject's users.company_id, mirroring isHeld.
function heldPredicate(userExpr) {
	return `EXISTS (SELECT 1 FROM legal_holds lh
		WHERE lh.released_at IS NULL
		  AND (lh.user_id = ${userExpr}
		       OR lh.company_id = (SELECT u_lh.company_id FROM users u_lh WHERE u_lh.id = ${userExpr})))`;
}
function notHeldPredicate(userExpr) {
	return `NOT ${heldPredicate(userExpr)}`;
}

// ─── Place / release / list ─────────────────────────────────────────────────

async function placeHold({ userId, companyId, reason, setBy } = {}, queryable = db) {
	if (userId == null && companyId == null) {
		throw new Error('legalHold.placeHold: a subject (userId and/or companyId) is required');
	}
	if (!reason || !String(reason).trim()) {
		throw new Error('legalHold.placeHold: reason is required');
	}
	if (setBy == null || String(setBy).trim() === '') {
		throw new Error('legalHold.placeHold: setBy (actor) is required');
	}
	const { rows } = await queryable.query(
		`INSERT INTO legal_holds (user_id, company_id, reason, set_by)
		 VALUES ($1, $2, $3, $4)
		 RETURNING *`,
		[userId ?? null, companyId ?? null, String(reason), String(setBy)],
	);
	const row = rows[0];
	await writeAudit(auditEntryFor(row, 'legal_hold_placed', setBy));
	return row;
}

async function releaseHold({ holdId, releasedBy } = {}, queryable = db) {
	if (holdId == null) throw new Error('legalHold.releaseHold: holdId is required');
	if (releasedBy == null || String(releasedBy).trim() === '') {
		throw new Error('legalHold.releaseHold: releasedBy (actor) is required');
	}
	const { rows } = await queryable.query(
		`UPDATE legal_holds
		 SET released_at = NOW(), released_by = $1
		 WHERE id = $2 AND released_at IS NULL
		 RETURNING *`,
		[String(releasedBy), holdId],
	);
	const row = rows[0] || null;
	if (row) await writeAudit(auditEntryFor(row, 'legal_hold_released', releasedBy));
	return row;
}

async function listHolds({ activeOnly = false } = {}, queryable = db) {
	const { rows } = await queryable.query(
		`SELECT * FROM legal_holds
		 ${activeOnly ? 'WHERE released_at IS NULL' : ''}
		 ORDER BY set_at DESC`,
	);
	return rows;
}

module.exports = {
	LegalHoldError,
	isHeld,
	anyHoldActive,
	heldPredicate,
	notHeldPredicate,
	placeHold,
	releaseHold,
	listHolds,
	_setAuditWriter,
};
