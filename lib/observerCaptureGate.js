/**
 * observerCaptureGate — the §3.2 capture gate (Gate A, S-085 #787).
 *
 * The gate is the ONLY path from presence to capturing. Every condition is
 * fail-closed; any check that cannot be positively verified resolves to
 * DORMANT. Evaluated once, at Gate 2, by evaluateCaptureDecision(); the
 * cheap conditions are re-checked by recheckCaptureGate() at every chunk
 * persist, at measurement persist, and on the 1 s watchdog.
 *
 * Conditions (design §3.2):
 *   G-FLAG       OBSERVER_AUDIO_CAPTURE_ENABLED exactly 'true' (fresh read
 *                via lib/observerCaptureFlag.js — the flag's only reader).
 *   G-SCOPE      test | activation | none. A production worker rejects
 *                test scope outright; test scope requires the harness-set
 *                session marker (config.observer_capture_test === true) —
 *                no production code path sets that marker.
 *   G-PRESENCE   biometric_collection === true (lib/observerConsentGate).
 *                Necessary, never sufficient.
 *   G-ACTIVATION (activation scope) a consent_receipts row of the DISTINCT
 *                type 'observer_capture': granted, not withdrawn, text
 *                version == the current artefact version, granted_at
 *                strictly after the latest activation enablement.
 *                January's biometric_collection consent can never satisfy
 *                this — different type, different artefact. This build
 *                ships NO consent_texts artefact for the type, so in
 *                practice every activation evaluation ends at
 *                CAPTURE_CONSENT_MISSING until counsel's wording lands.
 *   G-COHORT     (activation scope) latest observer_cohort_membership
 *                snapshot says member; resolved from the named-employer
 *                allow-list (D-2: the list IS the cap) and snapshotted at
 *                decision time.
 *   G-ENV        observer_jobs.origin_env == this process's env identity
 *                (lib/observerEnvIdentity.js). 'unknown' never matches.
 *
 * All reads are LIVE (never cached) — withdrawal must propagate at the
 * next re-check, per the consentService precedent.
 */
const db = require('./db');
const { readCaptureFlag } = require('./observerCaptureFlag');
const { resolveEnvIdentity } = require('./observerEnvIdentity');
const { canEnableObserver } = require('./observerConsentGate');

const CAPTURE_CONSENT_TYPE = 'observer_capture';
const TEST_MARKER_KEY = 'observer_capture_test';
// The production service name is platform-injected by Render. It is an
// ABSOLUTE veto for test scope, independent of the resolved identity: an
// explicit REKRUT_ENV_IDENTITY / NODE_ENV claim must never be able to
// re-point the production service into test-scope eligibility (privacy
// delta review P-3 — the env surface that carries the capture flag must
// not also be able to forge the identity that unlocks it).
const PRODUCTION_SERVICE_NAME = 'rekrutai-prod';

const GATE_CODES = Object.freeze({
	ENV_UNKNOWN: 'CAPTURE_ENV_UNKNOWN',
	ENV_MISMATCH: 'CAPTURE_ENV_MISMATCH',
	TEST_ON_PRODUCTION: 'CAPTURE_TEST_SCOPE_ON_PRODUCTION',
	CONSENT_MISSING: 'CAPTURE_CONSENT_MISSING',
	CONSENT_STALE_VERSION: 'CAPTURE_CONSENT_STALE_VERSION',
	CONSENT_BEFORE_ENABLEMENT: 'CAPTURE_CONSENT_BEFORE_ENABLEMENT',
	CONSENT_WITHDRAWN: 'CAPTURE_CONSENT_WITHDRAWN',
	NOT_IN_COHORT: 'CAPTURE_NOT_IN_COHORT',
});

function isTestSession(session) {
	return session?.config?.[TEST_MARKER_KEY] === true;
}

async function getCaptureReceipt(sessionId, candidateId, queryable) {
	const { rows } = await queryable.query(
		`SELECT granted_at, withdrawn_at, consent_text_version
		 FROM consent_receipts
		 WHERE interview_session_id = $1 AND consent_type = $2 AND candidate_id = $3
		 ORDER BY id DESC LIMIT 1`,
		[sessionId, CAPTURE_CONSENT_TYPE, candidateId],
	);
	return rows[0] || null;
}

async function getCurrentArtefactVersion(queryable) {
	const { rows } = await queryable.query(
		`SELECT version FROM consent_texts
		 WHERE consent_type = $1
		   AND effective_from = (SELECT MAX(effective_from) FROM consent_texts WHERE consent_type = $1)`,
		[CAPTURE_CONSENT_TYPE],
	);
	return rows[0]?.version ?? null;
}

async function getLatestEnablement(queryable, companyId) {
	// Per-employer (§3.2(d), §9 item 8, DB review M1): enablements are
	// keyed by company — the consent must postdate THE EMPLOYER'S
	// enablement, never a global latest row.
	const { rows } = await queryable.query(
		`SELECT enabled_at FROM observer_activation_enablements
		 WHERE company_id = $1
		 ORDER BY enabled_at DESC LIMIT 1`,
		[companyId],
	);
	return rows[0] || null;
}

/**
 * Cohort membership for the decision: the LATEST snapshot row wins
 * (§3.3 corrections are appended rows). When no snapshot exists, resolve
 * from the allow-list and write the snapshot the decision used.
 */
async function resolveCohortMembership(session, queryable) {
	const { rows } = await queryable.query(
		// Activation decisions never trust a harness-sourced snapshot
		// (privacy review A-11): the latest NON-harness row wins.
		`SELECT is_member, allowlist_version FROM observer_cohort_membership
		 WHERE interview_session_id = $1 AND source <> 'test_harness'
		 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
		[session.id],
	);
	if (rows[0]) {
		return { isMember: rows[0].is_member === true, allowlistVersion: rows[0].allowlist_version, source: 'snapshot' };
	}
	const companyId = session.company_id ?? null;
	let isMember = false;
	let allowlistVersion = null;
	if (companyId != null) {
		const { rows: allowRows } = await queryable.query(
			`SELECT allowlist_version FROM observer_cohort_allowlist WHERE company_id = $1`,
			[companyId],
		);
		if (allowRows[0]) {
			isMember = true;
			allowlistVersion = allowRows[0].allowlist_version;
		}
	}
	await queryable.query(
		`INSERT INTO observer_cohort_membership
		   (interview_session_id, company_id, is_member, allowlist_version, source)
		 VALUES ($1, $2, $3, $4, 'allowlist')`,
		[session.id, companyId, isMember, allowlistVersion],
	);
	return { isMember, allowlistVersion, source: 'allowlist' };
}

/**
 * The one-time capture decision at Gate 2.
 *
 * @param {object} args
 * @param {object} args.session interview_sessions row ({id, candidate_id, company_id, config})
 * @param {object} args.job observer_jobs row ({id, origin_env})
 * @param {object} args.presence canEnableObserver() result for the session
 * @param {object} [args.queryable] db pool/client (tests)
 * @param {object} [args.env] environment (tests)
 * @returns {Promise<{decision:'capturing'|'dormant', scope:'test'|'activation'|'none',
 *   gateCode:string|null, envIdentity:string}>}
 */
async function evaluateCaptureDecision({ session, job, presence, queryable = db, env = process.env }) {
	const envIdentity = resolveEnvIdentity(env);
	const dormant = (scope, gateCode) => ({ decision: 'dormant', scope, gateCode, envIdentity });

	// G-FLAG — fresh read; OFF means dormant regardless of anything else.
	if (!readCaptureFlag(env)) return dormant('none', null);

	// G-ENV — an unidentifiable environment captures nothing, and a job is
	// only ever captured by the environment that created it.
	if (envIdentity === 'unknown') return dormant('none', GATE_CODES.ENV_UNKNOWN);
	if (!job || job.origin_env !== envIdentity) return dormant('none', GATE_CODES.ENV_MISMATCH);

	// G-SCOPE — test marker + production rejection.
	if (isTestSession(session)) {
		if (envIdentity === 'production' || env.RENDER_SERVICE_NAME === PRODUCTION_SERVICE_NAME) {
			return dormant('none', GATE_CODES.TEST_ON_PRODUCTION);
		}
		// G-PRESENCE applies in test scope too.
		if (!presence?.allowed) return dormant('test', presence?.code || 'BIOMETRIC_CONSENT_UNKNOWN');
		return { decision: 'capturing', scope: 'test', gateCode: null, envIdentity };
	}

	// Activation scope.
	// G-PRESENCE — necessary, never sufficient.
	if (!presence?.allowed) return dormant('activation', presence?.code || 'BIOMETRIC_CONSENT_UNKNOWN');

	// G-ACTIVATION — the distinct artefact model.
	const currentVersion = await getCurrentArtefactVersion(queryable);
	const receipt = await getCaptureReceipt(session.id, session.candidate_id, queryable);
	if (!receipt || !receipt.granted_at || currentVersion == null) {
		return dormant('activation', GATE_CODES.CONSENT_MISSING);
	}
	if (receipt.withdrawn_at) return dormant('activation', GATE_CODES.CONSENT_WITHDRAWN);
	if (receipt.consent_text_version !== currentVersion) {
		return dormant('activation', GATE_CODES.CONSENT_STALE_VERSION);
	}
	const enablement = await getLatestEnablement(queryable, session.company_id);
	if (!enablement || !(new Date(receipt.granted_at) > new Date(enablement.enabled_at))) {
		return dormant('activation', GATE_CODES.CONSENT_BEFORE_ENABLEMENT);
	}

	// G-COHORT — the named allow-list is the cap (D-2).
	const membership = await resolveCohortMembership(session, queryable);
	if (!membership.isMember) return dormant('activation', GATE_CODES.NOT_IN_COHORT);

	return {
		decision: 'capturing', scope: 'activation', gateCode: null, envIdentity,
		cohortAllowlistVersion: membership.allowlistVersion ?? null,
	};
}

/**
 * Cheap re-check used at chunk persist, measurement persist, and by the
 * 1 s watchdog. Returns { ok:true } or { ok:false, kind, gateCode } where
 * kind ∈ 'flag_off' | 'withdrawn' | 'check_failed' | 'env' maps onto the
 * outcome stop_reason at teardown.
 */
async function recheckCaptureGate({ sessionId, candidateId, scope, jobOriginEnv, queryable = db, env = process.env }) {
	// G-FLAG, fresh.
	if (!readCaptureFlag(env)) return { ok: false, kind: 'flag_off', gateCode: 'CAPTURE_FLAG_OFF' };

	// G-ENV.
	const envIdentity = resolveEnvIdentity(env);
	if (envIdentity === 'unknown' || jobOriginEnv !== envIdentity) {
		return { ok: false, kind: 'env', gateCode: GATE_CODES.ENV_MISMATCH };
	}
	// Production-service veto for test scope, re-checked (P-3).
	if (scope === 'test' && env.RENDER_SERVICE_NAME === PRODUCTION_SERVICE_NAME) {
		return { ok: false, kind: 'env', gateCode: GATE_CODES.TEST_ON_PRODUCTION };
	}

	// G-PRESENCE (live read of the session config).
	let session;
	try {
		const { rows } = await queryable.query(
			`SELECT id, config FROM interview_sessions WHERE id = $1`,
			[sessionId],
		);
		session = rows[0];
	} catch {
		return { ok: false, kind: 'check_failed', gateCode: 'CAPTURE_CHECK_FAILED' };
	}
	if (!session) return { ok: false, kind: 'check_failed', gateCode: 'CAPTURE_JOB_GONE' };
	const presence = canEnableObserver(session);
	if (!presence.allowed) {
		// Distinguish withdrawal from other presence failures where the
		// artefacts allow it: an activation receipt now withdrawn, or (test
		// scope) a biometric receipt withdrawn mid-session. The session
		// config flag only flips via the consent lifecycle, so a flip from
		// the capture-start state is treated as withdrawal.
		try {
			if (scope === 'activation') {
				const receipt = await getCaptureReceipt(sessionId, candidateId, queryable);
				if (receipt?.withdrawn_at) return { ok: false, kind: 'withdrawn', gateCode: GATE_CODES.CONSENT_WITHDRAWN };
			} else {
				const { rows } = await queryable.query(
					`SELECT withdrawn_at FROM consent_receipts
					 WHERE interview_session_id = $1 AND consent_type = 'biometric' AND candidate_id = $2
					 ORDER BY id DESC LIMIT 1`,
					[sessionId, candidateId],
				);
				if (rows[0]?.withdrawn_at) return { ok: false, kind: 'withdrawn', gateCode: GATE_CODES.CONSENT_WITHDRAWN };
			}
		} catch {
			/* fall through to check_failed */
		}
		return { ok: false, kind: 'withdrawn', gateCode: presence.code || GATE_CODES.CONSENT_WITHDRAWN };
	}

	// G-ACTIVATION liveness for activation scope: receipt must still be
	// valid (not withdrawn, version still current).
	if (scope === 'activation') {
		try {
			const currentVersion = await getCurrentArtefactVersion(queryable);
			const receipt = await getCaptureReceipt(sessionId, candidateId, queryable);
			if (!receipt || !receipt.granted_at || currentVersion == null) {
				return { ok: false, kind: 'check_failed', gateCode: GATE_CODES.CONSENT_MISSING };
			}
			if (receipt.withdrawn_at) return { ok: false, kind: 'withdrawn', gateCode: GATE_CODES.CONSENT_WITHDRAWN };
			if (receipt.consent_text_version !== currentVersion) {
				return { ok: false, kind: 'check_failed', gateCode: GATE_CODES.CONSENT_STALE_VERSION };
			}
		} catch {
			return { ok: false, kind: 'check_failed', gateCode: 'CAPTURE_CHECK_FAILED' };
		}
	}

	return { ok: true, gateCode: null };
}

module.exports = {
	CAPTURE_CONSENT_TYPE,
	TEST_MARKER_KEY,
	GATE_CODES,
	isTestSession,
	evaluateCaptureDecision,
	recheckCaptureGate,
	// exported for tests
	_getCaptureReceipt: getCaptureReceipt,
	_getCurrentArtefactVersion: getCurrentArtefactVersion,
	_resolveCohortMembership: resolveCohortMembership,
};
