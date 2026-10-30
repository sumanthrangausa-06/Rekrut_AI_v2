/**
 * panelLabelling — ONE canonical helper for BR-7 panel labelling consent
 * (S-D18, #1955; design br7-panel-notice-design.md §§4.2/5/6).
 *
 * Used by: the capture endpoint (routes/interview-events.js), the LiveKit
 * token route (server/routes/livekit.js), and the recording freeze
 * (server/services/livekit.js createRecordingRecord). No other code may
 * re-implement the canonicalisation, the roster version, or the freeze.
 *
 * Security conditions (STOP 1 on #1955, binding):
 *  - roster_version is a KEYED HMAC-SHA256 (JWT_SECRET, domain-separated).
 *    An unkeyed hash over small integer ids is dictionary-reversible.
 *    It is an integrity pin for what the caller was shown — it is NOT
 *    anonymisation and must never be described as such.
 *  - panel_expected_hash stays a plain SHA-256 raw hex, DB-only: it is
 *    never returned by any API.
 *  - IP/UA are evidence-only: IP from req.ip only, UA stored only as a
 *    SHA-256 hash; neither is ever returned in an API response.
 */
const crypto = require('node:crypto');

// ─── Notice version registry (§5.3) ─────────────────────────────────────────
// Monotonic: a version string is issued once, never reused or rolled back;
// effective_from only moves forward. stale is judged against the version
// in force at a recording's started_at (privacy C-7) — S-D19's gate reads
// versionInForce(); capture/token use currentNoticeVersion().
const PANEL_LABELLING_NOTICE_VERSIONS = Object.freeze([
	Object.freeze({ version: 'br7-1', effective_from: '2026-10-29T08:00:00.000Z' }),
]);

function currentNoticeVersion() {
	return PANEL_LABELLING_NOTICE_VERSIONS[PANEL_LABELLING_NOTICE_VERSIONS.length - 1].version;
}

function versionInForce(at, registry = PANEL_LABELLING_NOTICE_VERSIONS) {
	// S-D19 (#1956) — S-D18 review minor 6 FIXED (STOP 1 on #1956): a
	// timestamp before the first version's effective_from has NO version
	// in force and returns null (the pre-fix code initialised to the
	// first entry and reported br7-1 for times before it existed). The
	// gate (P3) compares a decision's notice_version against this: null
	// matches nothing, so a pre-first-version recording blocks
	// PANEL_AGREEMENT_STALE — fail-closed, per privacy C-7.
	const t = at ? new Date(at).getTime() : NaN;
	if (Number.isNaN(t)) return null;
	let current = null;
	for (const entry of registry) {
		if (new Date(entry.effective_from).getTime() <= t) current = entry.version;
	}
	return current;
}

// ─── Canonicalisation (ONE helper — security condition) ─────────────────────
function canonicalRoster(event, noticeVersion) {
	const panel = [...new Set((event.panel_member_ids || []).map(Number))].sort((a, b) => a - b);
	return JSON.stringify({
		recruiter_id: Number(event.recruiter_id),
		panel_member_ids: panel,
		candidate_id: Number(event.candidate_id),
		notice_version: noticeVersion,
	});
}

/** Expected non-candidate speaker set: recruiter ∪ panel, minus candidate, deduped, sorted. */
function expectedUserIds(event) {
	const candidateId = Number(event.candidate_id);
	const ids = new Set([Number(event.recruiter_id), ...(event.panel_member_ids || []).map(Number)]);
	ids.delete(candidateId);
	return [...ids].sort((a, b) => a - b);
}

/** Plain SHA-256 raw hex over the roster triple — DB-only, never API-returned. */
function panelExpectedHash(event, noticeVersion = currentNoticeVersion()) {
	return crypto.createHash('sha256').update(canonicalRoster(event, noticeVersion)).digest('hex');
}

/** Keyed HMAC-SHA256 roster pin presented to / returned by the API. */
function rosterVersion(event, noticeVersion = currentNoticeVersion()) {
	const secret = process.env.JWT_SECRET;
	if (!secret) throw new Error('panelLabelling: JWT_SECRET is required for roster_version');
	const mac = crypto
		.createHmac('sha256', secret)
		.update(`panel-labelling-roster-v1:${canonicalRoster(event, noticeVersion)}`)
		.digest('hex');
	return `hmac-sha256:${mac}`;
}

/** The §6 freeze written at recording creation (event-linked recordings only). */
function computeFreeze(event, noticeVersion = currentNoticeVersion()) {
	return {
		panel_expected_user_ids: expectedUserIds(event),
		panel_expected_hash: panelExpectedHash(event, noticeVersion),
	};
}

// ─── Reads ───────────────────────────────────────────────────────────────────
/** Caller's own latest decision for an event (greatest id — DB identity, §5.1). */
async function getOwnDecision(queryable, eventId, userId) {
	const res = await queryable.query(
		`SELECT decision FROM event_labelling_consent
		 WHERE interview_event_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`,
		[eventId, userId],
	);
	return res.rows[0]?.decision ?? null;
}

/** §4.2 token field — caller's own state only. Throws on lookup failure;
 *  the token route converts a throw into own_decision:null (§8). */
async function buildLabellingNotice(queryable, event, userId) {
	const noticeVersion = currentNoticeVersion();
	return {
		event_id: Number(event.id),
		notice_version: noticeVersion,
		roster_version: rosterVersion(event, noticeVersion),
		own_decision: await getOwnDecision(queryable, event.id, userId),
		decision_scope: 'panel_leg_only',
	};
}

// ─── Audit (compliance_audit_trail, hash-chained, on a given queryable ──────
// so the capture path can write it INSIDE its transaction — STOP 1:
// insert + audit + notification in ONE transaction).
const { computeHash, GENESIS_HASH } = require('../services/auditLogService');

async function writePanelAudit(queryable, { eventId, actorId, actorRole, outcome, decision, deviceFlag }) {
	// #1961 items 4+5 — hash-chain serialisation + entity label.
	//
	// Item 4 (fork): the append is read-last-hash → compute → INSERT.
	// Without a lock, two concurrent appends read the SAME predecessor
	// and fork the chain (in practice they also collide on the UNIQUE
	// current_hash when payload+timestamp match). Serialise every
	// append on ONE advisory lock key. A caller-passed Client is
	// already inside its transaction (the capture path — the audit
	// must stay in that transaction for the rollback claim), so the
	// xact lock is taken on it directly. A Pool has no transaction:
	// check out a client and wrap read+insert in BEGIN/COMMIT so the
	// xact lock spans both statements (on the bare pool it would
	// release at statement end and protect nothing). Pool detection:
	// pg Pools expose `totalCount`; Clients do not.
	// Lock ordering: capture takes `panel-event:<id>` first, then this
	// chain lock; no path takes the chain lock and then a panel-event
	// lock, so no cycle is introduced. The chain lock is a LEAF lock
	// (security review, #1961): it is taken last, nothing else is
	// acquired after it, and it is held only to commit — any future
	// caller holding it must never then take a `panel-event:` lock.
	// PRECONDITION for the Client branch: the caller is already inside
	// a transaction (true of the one Client caller, the capture path);
	// a non-transactional Client would silently degrade the xact lock
	// to statement scope and protect nothing.
	// Discriminator note: pool-vs-client is decided by `totalCount`
	// (Pools expose it, Clients do not) rather than the `connect()`
	// presence check used by lib/panelWithdrawalPurge.js — purge has
	// no in-transaction caller, but this function does, and a Client
	// also exposes connect(), so that check cannot discriminate here.
	// INHERITED PATTERN (noted, not fixed here — #1961 scope):
	// services/auditLogService.logEvent does the same unlocked
	// read-then-insert on this table; a follow-up should take the
	// same 'compliance-audit-chain' lock key there so the two writers
	// serialise against each other.
	//
	// Item 5 (mislabel): entity_id has always been the EVENT id; the
	// row now says so — entity_type='interview_event' (DB CHECK widened
	// by migration 300, following 254's precedent; registered in
	// auditLogService ENTITY_TYPES). entity_type is not an input to
	// computeHash and verifyChain recomputes from event_type/entity_id
	// only, so existing rows still verify.
	const append = async (q) => {
		await q.query(`SELECT pg_advisory_xact_lock(hashtext('compliance-audit-chain'))`);
		const last = await q.query(
			`SELECT current_hash FROM compliance_audit_trail ORDER BY created_at DESC, id DESC LIMIT 1`,
		);
		const previousHash = last.rows[0]?.current_hash || GENESIS_HASH;
		const createdAt = new Date().toISOString();
		const payload = { kind: 'panel_labelling_capture', event_id: Number(eventId), outcome, decision: decision ?? null };
		// C-6d review signal (not a block): multiple accounts, one device fingerprint.
		if (deviceFlag) payload.device_flag = true;
		const currentHash = computeHash(previousHash, 'data_access', Number(eventId), actorId, payload, createdAt);
		await q.query(
			`INSERT INTO compliance_audit_trail
			 (event_type, entity_type, entity_id, actor_id, actor_role, payload, previous_hash, current_hash, created_at)
			 VALUES ('data_access', 'interview_event', $1, $2, $3, $4, $5, $6, $7)`,
			[Number(eventId), actorId, actorRole ?? null, JSON.stringify(payload), previousHash, currentHash, createdAt],
		);
	};
	if (typeof queryable.totalCount === 'number' && typeof queryable.connect === 'function') {
		const client = await queryable.connect();
		try {
			await client.query('BEGIN');
			// Bound the lock wait in the pool branch (security review):
			// a contended chain lock fails this best-effort audit write
			// instead of queueing on pooled clients. The Client branch
			// sets no local timeout — there a lock failure correctly
			// fails the whole capture transaction (fail-closed).
			await client.query(`SET LOCAL lock_timeout = '2s'`);
			await append(client);
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			throw err;
		} finally {
			client.release();
		}
		return;
	}
	await append(queryable);
}

function hashUserAgent(userAgent) {
	if (!userAgent) return null;
	return crypto.createHash('sha256').update(String(userAgent)).digest('hex');
}

module.exports = {
	PANEL_LABELLING_NOTICE_VERSIONS,
	currentNoticeVersion,
	versionInForce,
	canonicalRoster,
	expectedUserIds,
	panelExpectedHash,
	rosterVersion,
	computeFreeze,
	getOwnDecision,
	buildLabellingNotice,
	writePanelAudit,
	hashUserAgent,
};
