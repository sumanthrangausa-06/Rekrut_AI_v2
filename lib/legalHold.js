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
 *     before delete, by the automated retention purges and erasure
 *     paths wired in #799 (there is no choke point: ≥6 independent
 *     purge functions + erasureService + the pending_storage_deletions
 *     ledger drain).
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

function defaultAuditWriter() {
	return async (e) => require('../services/auditLogService').logEvent(e);
}

async function writeAudit(entry) {
	const writer = auditWriter || defaultAuditWriter();
	try {
		await writer(entry);
	} catch (err) {
		console.error('[legalHold] compliance audit write failed:', err.message);
	}
}

/**
 * Record a legal-hold CONFLICT (an erasure refused because a hold is
 * active) in compliance_audit_trail — Lex F-1 (PR gate, #915).
 *
 * Unlike place/release audit (writeAudit above, best-effort-but-loud:
 * the legal_holds row itself is the durable record there), the conflict
 * has NO other durable record: the DSAR request stays pending and the
 * self-serve account stays untouched, so this audit entry IS the
 * evidence that an erasure was requested and refused, and why. It
 * therefore THROWS on write failure — callers must fail closed (not
 * claim the conflict was recorded, not proceed as if it were).
 *
 * @param {{ holdId?: number|null, actor?: *, actorRole?: string,
 *   requestId?: number|null, subjectUserId?: number|null,
 *   companyId?: number|null, source: string }} details
 *   source: 'dsar_fulfillment' | 'self_serve_delete_account'
 */
async function recordLegalHoldConflict({
	holdId = null,
	actor = null,
	actorRole = 'admin',
	requestId = null,
	subjectUserId = null,
	companyId = null,
	source,
} = {}) {
	if (!source) throw new Error('legalHold.recordLegalHoldConflict: source is required');
	const entry = {
		eventType: 'status_change',
		entityType: subjectUserId != null ? 'user' : 'company',
		entityId: subjectUserId ?? companyId ?? requestId,
		actorId:
			actor != null && Number.isInteger(Number(actor)) && String(actor).trim() !== ''
				? Number(actor)
				: null,
		actorRole,
		companyId: companyId ?? null,
		payload: {
			action: 'legal_hold_conflict',
			holdId: holdId ?? null,
			actor: actor != null ? String(actor) : null,
			requestId: requestId ?? null,
			subjectUserId: subjectUserId ?? null,
			source,
		},
	};
	const writer = auditWriter || defaultAuditWriter();
	await writer(entry);
	return entry;
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
 * Resolve the ACTIVE (unreleased) hold covering this subject, or null.
 * THROWS on any lookup error — including a session-resolution miss
 * (privacy F-6, PR gate #915: a supplied sessionId whose row is gone
 * must NOT read as not-held). Callers choose their failure posture:
 * isHeld converts a throw to `true` (fail-closed); the erasure gate
 * converts it to a LegalHoldError with holdId null.
 *
 * Company attribution (privacy F-1, PR gate #915 — BLOCKER fix):
 * candidates carry NO users.company_id (only employer signup sets it),
 * so a company hold reaches a candidate ONLY through interview_sessions.
 * Therefore:
 *   - when a sessionId is present, the session is ALWAYS resolved and
 *     its company merged into the check — regardless of whether a
 *     userId was also passed (every seam call site passes both; the
 *     old code resolved the session only when no userId was given, so
 *     company-only holds silently failed at those sites);
 *   - the hold query ALSO matches a company hold against any company
 *     on the subject's own interview_sessions (candidate_id = subject)
 *     — this is what attributes a company hold to a candidate at the
 *     sites that carry no session (candidate erasure, bulk predicate).
 *
 * Per-row precision (D-1, delta re-review on PR #915): the any-session
 * branch fires ONLY when NO sessionId was supplied. When a sessionId
 * IS present, the row is judged by that session's company alone ($3),
 * plus the direct user hold, an explicit companyId, and the subject's
 * own users.company_id — a hold on ANOTHER company the candidate also
 * has sessions with must not retain this row past its purge schedule
 * (over-retention). The session-less shape is unchanged: candidate
 * erasure is all-or-nothing for the person, so any-session attribution
 * remains the correct conservative read there.
 *
 * @param {{ userId?: number, candidateId?: number, companyId?: number, sessionId?: number }} subject
 * @param {object} [queryable] pg pool/client (defaults to lib/db)
 * @returns {Promise<object|null>} the matching legal_holds row ({id, user_id, company_id}) or null
 */
async function findActiveHold({ userId, candidateId, companyId, sessionId } = {}, queryable = db) {
	let uid = userId ?? candidateId ?? null;
	const explicitCid = companyId ?? null;
	let sessionCid = null;
	if (sessionId != null) {
		const { rows } = await queryable.query(
			`SELECT candidate_id, company_id FROM interview_sessions WHERE id = $1`,
			[sessionId],
		);
		if (!rows[0]) {
			// F-6: a session that cannot be resolved cannot be cleared —
			// fail closed rather than reading the miss as "not held".
			throw new Error(
				`legalHold: interview_session ${sessionId} not found — cannot verify hold status`,
			);
		}
		if (uid == null) uid = rows[0].candidate_id ?? null;
		sessionCid = rows[0].company_id ?? null;
	}
	if (uid == null && explicitCid == null && sessionCid == null) return null;
	// D-1: the any-session branch is included ONLY for session-less
	// subjects; with a sessionId the SQL below is the session-scoped
	// check and nothing else (see the doc comment above).
	const anySessionBranch =
		sessionId == null
			? `
		     OR (company_id IS NOT NULL AND $1 IS NOT NULL
		         AND company_id IN (SELECT company_id FROM interview_sessions WHERE candidate_id = $1))`
			: '';
	const { rows } = await queryable.query(
		`SELECT id, user_id, company_id FROM legal_holds
		 WHERE released_at IS NULL
		   AND (
		     (user_id IS NOT NULL AND user_id = $1)
		     OR (company_id IS NOT NULL AND company_id = $2)
		     OR (company_id IS NOT NULL AND company_id = $3)
		     OR (company_id IS NOT NULL AND $1 IS NOT NULL
		         AND company_id = (SELECT company_id FROM users WHERE id = $1))${anySessionBranch}
		   )
		 LIMIT 1`,
		[uid, explicitCid, sessionCid],
	);
	return rows[0] || null;
}

/**
 * Is there an ACTIVE (unreleased) hold covering this subject?
 * Matches: a user hold on the subject; a company hold on the given
 * company; a company hold on the subject's own company
 * (users.company_id — employer users); a company hold on the GIVEN
 * session's company when a sessionId is supplied, or — session-less
 * subjects only — on any company the subject has interview_sessions
 * with (candidates — see findActiveHold for the F-1 attribution
 * rationale and the D-1 per-row precision rule).
 *
 * FAIL-CLOSED: any error (including a session-resolution miss) → true.
 *
 * @param {{ userId?: number, candidateId?: number, companyId?: number, sessionId?: number }} subject
 * @param {object} [queryable] pg pool/client (defaults to lib/db)
 * @returns {Promise<boolean>}
 */
async function isHeld(subject = {}, queryable = db) {
	try {
		return (await findActiveHold(subject, queryable)) != null;
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
// through the subject's users.company_id (employer users) AND through
// the subject's interview_sessions companies (candidates, whose
// users.company_id is NULL) — mirroring isHeld (privacy F-1, #915).
//
// D-1 parity with findActiveHold: callers whose rows ALSO carry a
// session id pass { sessionIdExpr } (a SQL expression for the row's
// interview_sessions id); the predicate then keys company coverage on
// THAT session's company alone and the any-session branch does not
// fire. Without sessionIdExpr the predicate is the session-less shape,
// unchanged — any-session attribution, mirroring the session-less
// single check exactly.
function heldPredicate(userExpr, { sessionIdExpr } = {}) {
	const sessionBranch =
		sessionIdExpr != null
			? `lh.company_id = (SELECT s_lh.company_id FROM interview_sessions s_lh WHERE s_lh.id = ${sessionIdExpr})`
			: `lh.company_id IN (SELECT s_lh.company_id FROM interview_sessions s_lh WHERE s_lh.candidate_id = ${userExpr})`;
	return `EXISTS (SELECT 1 FROM legal_holds lh
		WHERE lh.released_at IS NULL
		  AND (lh.user_id = ${userExpr}
		       OR lh.company_id = (SELECT u_lh.company_id FROM users u_lh WHERE u_lh.id = ${userExpr})
		       OR ${sessionBranch}))`;
}
function notHeldPredicate(userExpr, options) {
	return `NOT ${heldPredicate(userExpr, options)}`;
}

// ─── #1981: skeleton_event_swept audit rows ─────────────────────────────────
// sweepPanelSkeletonEvents (lib/erasureService.js) writes these rows
// with audit_logs.user_id = NULL; the subject linkage lives ONLY in
// metadata.tombstone_user_id, so heldPredicate('audit_logs.user_id')
// can never match a hold for this class (Lex position on #1979:
// until a metadata-keyed check exists, NO expiry deletion runs on
// this class). These predicates are for statements over audit_logs
// gated on action_type = 'skeleton_event_swept' ONLY.
//
// Subject expression: a CASE-guarded cast — the digit cap keeps the
// bigint comparison safe, and a missing / non-numeric / out-of-int4
// tombstone id yields NULL, which the held predicate treats as HELD
// (fail-closed: an unattributable receipt is never expiry-deleted).
// Derived-company coverage mirrors heldPredicate (the tombstone
// user's users.company_id + any interview_sessions company for the
// subject) PLUS the sweep's job-application branch keyed via
// target_id → interview_events.job_application_id. Honesty note:
// the sweep deletes that event, so the job-application branch
// normally cannot fire for swept rows; it covers rows whose event
// still exists and any future writer of this class.
const SKELETON_AUDIT_SUBJECT_EXPR = `(CASE WHEN audit_logs.metadata->>'tombstone_user_id' ~ '^[0-9]{1,10}$'
	AND (audit_logs.metadata->>'tombstone_user_id')::bigint <= 2147483647
	THEN (audit_logs.metadata->>'tombstone_user_id')::int END)`;
function skeletonAuditHeldPredicate() {
	return `(${SKELETON_AUDIT_SUBJECT_EXPR} IS NULL OR ${heldPredicate(SKELETON_AUDIT_SUBJECT_EXPR)}
		OR EXISTS (SELECT 1 FROM legal_holds lh_skel
			WHERE lh_skel.released_at IS NULL
			  AND lh_skel.company_id IS NOT NULL
			  AND lh_skel.company_id = (SELECT ja_skel.company_id FROM job_applications ja_skel
					JOIN interview_events ie_skel ON ie_skel.job_application_id = ja_skel.id
					WHERE ie_skel.id = audit_logs.target_id)))`;
}
function skeletonAuditNotHeldPredicate() {
	return `NOT ${skeletonAuditHeldPredicate()}`;
}

// ─── Place / release / list ─────────────────────────────────────────────────

// #918 (Lex F-5): a subject that does not exist is a HARD error, never a
// silent success — a hold on a transposed id protects nobody while the
// operator believes the data is preserved. Plain Error per this file's
// placeHold validation convention, carrying code/status so the admin
// route can surface it as a 404 instead of a buried generic 500.
function subjectNotFoundError(kind, id) {
	const err = new Error(`legalHold.placeHold: subject ${kind} ${id} does not exist`);
	err.code = 'SUBJECT_NOT_FOUND';
	err.status = 404;
	return err;
}

// #1404: a non-integer subject id is the caller's error, like a missing
// subject — without this check it reaches the #918 existence lookup and
// Postgres raises 22P02, which the admin route buries as a generic 500.
// Typed 400, thrown BEFORE any DB query; integer-shaped strings ("7")
// are normalised to numbers, everything else is rejected.
// #1409: the bound is the Postgres int4 range — subject id columns are
// INTEGER (e.g. legal_holds.user_id/company_id, migration 258), so an
// integer outside [-2147483648, 2147483647] is not a valid id either and
// gets the same typed 400 instead of depending on pg parameter typing
// at the existence query.
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

function invalidSubjectIdError(field, value) {
	const err = new Error(
		`legalHold.placeHold: ${field} must be an integer id (received ${JSON.stringify(value)})`,
	);
	err.code = 'INVALID_SUBJECT_ID';
	err.status = 400;
	return err;
}

function integerId(field, value, makeError) {
	if (
		(typeof value !== 'number' && typeof value !== 'string') ||
		(typeof value === 'string' && value.trim() === '')
	) {
		throw makeError(field, value);
	}
	const n = Number(value);
	if (!Number.isInteger(n) || n < INT4_MIN || n > INT4_MAX) throw makeError(field, value);
	return n;
}

function integerSubjectId(field, value) {
	return integerId(field, value, invalidSubjectIdError);
}

// #1416: releaseHold's holdId had NO normalisation — the release route's
// parseInt guard passes 2147483648, which reaches `WHERE id = $2` against
// the SERIAL (int4) legal_holds.id and Postgres raises 22P02, buried as a
// generic 500. Same typed-400 convention as placeHold above: thrown
// BEFORE any DB query; integer-shaped strings ("7") are normalised.
function invalidHoldIdError(field, value) {
	const err = new Error(
		`legalHold.releaseHold: ${field} must be an integer id (received ${JSON.stringify(value)})`,
	);
	err.code = 'INVALID_HOLD_ID';
	err.status = 400;
	return err;
}

function integerHoldId(value) {
	return integerId('holdId', value, invalidHoldIdError);
}

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
	// #1404: integer-shape validation before the existence lookups below.
	if (userId != null) userId = integerSubjectId('userId', userId);
	if (companyId != null) companyId = integerSubjectId('companyId', companyId);
	// #918: verify EVERY supplied subject exists BEFORE inserting — when
	// both are supplied, a missing half still under-protects. legal_holds
	// has no FKs by design (migration 258), so this check is the only
	// guard. No hold row is written when it fails.
	if (userId != null) {
		const { rows } = await queryable.query(`SELECT id FROM users WHERE id = $1`, [userId]);
		if (!rows[0]) throw subjectNotFoundError('user', userId);
	}
	if (companyId != null) {
		const { rows } = await queryable.query(`SELECT id FROM companies WHERE id = $1`, [companyId]);
		if (!rows[0]) throw subjectNotFoundError('company', companyId);
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
	// #1416: int4/integer-shape validation before the UPDATE below.
	holdId = integerHoldId(holdId);
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
	findActiveHold,
	recordLegalHoldConflict,
	anyHoldActive,
	heldPredicate,
	notHeldPredicate,
	skeletonAuditHeldPredicate,
	skeletonAuditNotHeldPredicate,
	placeHold,
	releaseHold,
	listHolds,
	_setAuditWriter,
};
