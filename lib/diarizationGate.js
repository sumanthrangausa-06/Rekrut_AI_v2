/**
 * diarizationGate — the diarization consent gate (S-D04, #1906;
 * Architecture §3.4 step 1–3, §6.1 BR-2/BR-3).
 *
 * One evaluation, used at BOTH claim time and write time by the
 * diarization worker: each call re-resolves everything live, so the
 * value that governs is always the value at the moment of the call
 * (AC-5 — never enqueue-time, never a cache, never a client field).
 *
 * Two resolution paths (Architecture §3.4 as reconciled by #1925):
 *
 * A. Session-linked recordings (the S-D04 path, unchanged):
 *   1. Recording → interview_session_id. No link (or no recording, or
 *      no session row) → NO_SESSION: no verifiable consent, the same
 *      default-deny as canEnableObserver on a null session.
 *   2. consentService.checkConsentState(sessionId, 'biometric',
 *      candidateId) — live DB. Candidate resolution follows the house
 *      pattern (livekitService.resolveRecordingCandidateId):
 *      interview_sessions.candidate_id for session-linked recordings,
 *      falling back to interview_events.candidate_id when the session
 *      carries none (candidate-binding is the IDOR guard inside
 *      consentService). No resolvable candidate → NO_SESSION.
 *      Anything other than granted-and-current blocks: missing (which
 *      is also how consentService surfaces a decline — a decline is
 *      recorded as never-granted), withdrawn, version-stale. A throwing
 *      check blocks too (CONSENT_UNVERIFIABLE) — fail-closed.
 *   3. canEnableObserver(session) — the session-config projection of
 *      the same consent (S-070 propagation) as a second, independent
 *      check, so diarization and the Observer can never disagree about
 *      a candidate's biometric posture. Tier 0 objection (config false)
 *      and Tier 1+2 posture (config unset) block here by construction
 *      even if a DB receipt were somehow valid.
 *
 * B. Event-linked recordings — the event→session bridge (ADR-D06,
 *    #1925; event-session-bridge-design.md §5). Migration 130's XOR
 *    makes human-interview recordings event-linked; each event has its
 *    OWN governing session (lib/governingSession.js), created for that
 *    event, and consent for THAT interview is captured against it.
 *    No consent is ever borrowed from a sibling session. Steps:
 *   1. Event row missing → NO_SESSION (as before).
 *   2. Event has no governing session → NO_GOVERNING_SESSION.
 *   3. Governing session row gone → NO_GOVERNING_SESSION.
 *   4. Binding checks (server-derived ids only): governing session's
 *      candidate + application must equal the event's, and the job
 *      application's candidate must equal the event's; a NULL
 *      job_application_id or any mismatch → SESSION_BINDING_MISMATCH
 *      (checkConsentState is not called).
 *   5. checkConsentState(governing, 'biometric', event.candidate_id),
 *      states mapped exactly as path A. Temporal precedence: the
 *      governing receipt (the same latest row checkConsentState
 *      judged) must satisfy granted_at <= recording.started_at —
 *      a later grant → CONSENT_AFTER_RECORDING; a recording with no
 *      started_at (precedence unprovable) → CONSENT_UNVERIFIABLE.
 *   6. canEnableObserver(governing session) — same second check.
 *   7. Allow returns { allowed, sessionId, candidateId,
 *      via: 'event_bridge', eventId, consentReceiptId } — the worker
 *      persists the provenance on the job at claim and on the run at
 *      persistStitch, and compares the governing session at write
 *      against claim-time.
 *
 * SCHEMA NOTE (deviation flagged on #1906 — CLOSED by #1925): the
 * deviation recorded here in S-D04 (event-linked recordings always
 * landing on NO_SESSION because no event→session bridge existed) is
 * resolved by the governing-session bridge (ADR-D06, migration 298).
 * Event-linked recordings now resolve via path B; unbridged events
 * still block fail-closed (NO_GOVERNING_SESSION).
 *
 * Panel leg (BR-7, S-D19 #1956; br7-panel-notice-design.md §7, ADR-D07):
 * path B gains a third leg, evaluated AFTER the candidate legs (steps
 * 5–6) and before the allow — candidate codes keep precedence and the
 * panel leg is never evaluated when a candidate leg blocks. The
 * session path (A) is byte-for-byte unchanged. The leg reads ONLY the
 * recording's frozen expected set (panel_expected_user_ids /
 * panel_expected_hash, frozen at recording creation by S-D18) — never
 * the live event roster (security C-1, test T8) — and each expected
 * user's LATEST event_labelling_consent row (greatest id) for the
 * recording's event: missing / declined / withdrawn / stale (notice
 * version ≠ versionInForce(recording.started_at), privacy C-7) /
 * decided-after-start all block with PANEL_AGREEMENT_* codes; an
 * unfrozen set blocks PANEL_SET_UNRESOLVABLE; an unreadable decision
 * blocks PANEL_AGREEMENT_UNVERIFIABLE. Speaking presence is never
 * consulted (P4). On allow the leg returns panelSnapshot (frozen set
 * + hash + the grant records the decision rested on) — the worker
 * persists it write-once on the job at claim and on the run at
 * persistStitch, and compares it at write (P5/P6).
 */
const db = require('./db');
const consentService = require('./consentService');
const { canEnableObserver } = require('./observerConsentGate');
const { versionInForce } = require('./panelLabelling');

const STATE_TO_CODE = {
	missing: 'CONSENT_MISSING',
	withdrawn: 'CONSENT_WITHDRAWN',
	stale: 'CONSENT_VERSION_STALE',
};

/**
 * @param {number} recordingId - interview_recordings.id
 * @returns {Promise<{allowed: true, sessionId: number, candidateId: number}
 *   | {allowed: true, sessionId: number, candidateId: number,
 *      via: 'event_bridge', eventId: number, consentReceiptId: number}
 *   | {allowed: false, code: string}>}
 */
async function evaluateDiarizationGate(recordingId) {
	const recRes = await db.query(
		`SELECT interview_session_id, interview_event_id, started_at, panel_expected_user_ids, panel_expected_hash FROM interview_recordings WHERE id = $1`,
		[recordingId],
	);
	const recording = recRes.rows[0];
	if (!recording) {
		return { allowed: false, code: 'NO_SESSION' };
	}
	if (!recording.interview_session_id) {
		// Event-linked (bridge path B) — or no link at all.
		if (!recording.interview_event_id) {
			return { allowed: false, code: 'NO_SESSION' };
		}
		return evaluateEventBridge(recordingId, recording);
	}
	const sessionId = recording.interview_session_id;

	const sessRes = await db.query(
		`SELECT id, config, candidate_id FROM interview_sessions WHERE id = $1`,
		[sessionId],
	);
	const session = sessRes.rows[0];
	if (!session) {
		return { allowed: false, code: 'NO_SESSION' };
	}

	let candidateId = session.candidate_id ?? null;
	if (candidateId == null && recording.interview_event_id) {
		const evRes = await db.query(
			`SELECT candidate_id FROM interview_events WHERE id = $1`,
			[recording.interview_event_id],
		);
		candidateId = evRes.rows[0]?.candidate_id ?? null;
	}
	if (candidateId == null) {
		return { allowed: false, code: 'NO_SESSION' };
	}

	let state;
	try {
		state = await consentService.checkConsentState(sessionId, 'biometric', candidateId);
	} catch {
		// Fail-closed: consent that cannot be verified is not consent.
		return { allowed: false, code: 'CONSENT_UNVERIFIABLE' };
	}
	if (state.state !== 'valid') {
		return { allowed: false, code: STATE_TO_CODE[state.state] || 'CONSENT_UNVERIFIABLE' };
	}

	const observerGate = canEnableObserver(session);
	if (!observerGate.allowed) {
		return { allowed: false, code: observerGate.code };
	}

	return { allowed: true, sessionId, candidateId };
}

/**
 * Path B — event-linked recordings via the event's governing session
 * (ADR-D06 §5 steps 1–7, in order, all before any audio).
 */
async function evaluateEventBridge(recordingId, recording) {
	const eventId = recording.interview_event_id;

	// Step 1: the event row.
	const evRes = await db.query(
		`SELECT id, candidate_id, job_application_id, interview_session_id FROM interview_events WHERE id = $1`,
		[eventId],
	);
	const event = evRes.rows[0];
	if (!event) {
		return { allowed: false, code: 'NO_SESSION' };
	}

	// Step 2: the event must have been bridged.
	if (!event.interview_session_id) {
		return { allowed: false, code: 'NO_GOVERNING_SESSION' };
	}
	const governingSessionId = event.interview_session_id;

	// Step 3: the governing session row.
	const sessRes = await db.query(
		`SELECT id, config, candidate_id, application_id FROM interview_sessions WHERE id = $1`,
		[governingSessionId],
	);
	const session = sessRes.rows[0];
	if (!session) {
		return { allowed: false, code: 'NO_GOVERNING_SESSION' };
	}

	// Step 4: binding checks — server-derived ids only; nothing from a
	// request, payload, or metadata is consulted.
	if (
		event.job_application_id == null ||
		session.candidate_id !== event.candidate_id ||
		session.application_id !== event.job_application_id
	) {
		return { allowed: false, code: 'SESSION_BINDING_MISMATCH' };
	}
	const jaRes = await db.query(
		`SELECT candidate_id FROM job_applications WHERE id = $1`,
		[event.job_application_id],
	);
	if (!jaRes.rows[0] || jaRes.rows[0].candidate_id !== event.candidate_id) {
		return { allowed: false, code: 'SESSION_BINDING_MISMATCH' };
	}

	// Step 5: consent state on the governing session only — live,
	// candidate-bound, uncached (the S-011 fix applies as-is).
	let state;
	try {
		state = await consentService.checkConsentState(
			governingSessionId,
			'biometric',
			event.candidate_id,
		);
	} catch {
		return { allowed: false, code: 'CONSENT_UNVERIFIABLE' };
	}
	if (state.state !== 'valid') {
		return { allowed: false, code: STATE_TO_CODE[state.state] || 'CONSENT_UNVERIFIABLE' };
	}

	// Step 5 (temporal precedence + provenance): read the governing
	// receipt row — the same latest row checkConsentState judged — for
	// its id and granted_at only; the state decision stays with
	// checkConsentState, never re-implemented here.
	const receiptRes = await db.query(
		`SELECT id, granted_at FROM consent_receipts
		 WHERE interview_session_id = $1 AND consent_type = 'biometric' AND candidate_id = $2
		 ORDER BY id DESC LIMIT 1`,
		[governingSessionId, event.candidate_id],
	);
	const receipt = receiptRes.rows[0];
	if (!receipt || !receipt.granted_at) {
		return { allowed: false, code: 'CONSENT_UNVERIFIABLE' };
	}
	if (!recording.started_at) {
		// Precedence unprovable — fail-closed.
		return { allowed: false, code: 'CONSENT_UNVERIFIABLE' };
	}
	if (new Date(receipt.granted_at) > new Date(recording.started_at)) {
		return { allowed: false, code: 'CONSENT_AFTER_RECORDING' };
	}

	// Step 6: second check, same session — the observer gate.
	const observerGate = canEnableObserver(session);
	if (!observerGate.allowed) {
		return { allowed: false, code: observerGate.code };
	}

	// Panel leg (§7 P1–P5): only now that the candidate legs have
	// passed — a candidate block above returns its own code and the
	// panel rows are never read (precedence + independence, T10).
	const panel = await panelLegForRecording(db, recording);
	if (!panel.allowed) {
		return { allowed: false, code: panel.code };
	}

	// Step 7: allow, with provenance for the worker to persist.
	return {
		allowed: true,
		sessionId: governingSessionId,
		candidateId: event.candidate_id,
		via: 'event_bridge',
		eventId,
		consentReceiptId: receipt.id,
		panelSnapshot: panel.panelSnapshot,
	};
}

/**
 * The panel leg itself (§7 P1–P5), against a caller-supplied queryable
 * (the pool normally; the worker's claim transaction client for the
 * P5 re-check under the per-event advisory lock). `recording` must
 * carry interview_event_id, started_at, panel_expected_user_ids and
 * panel_expected_hash. Exported standalone as evaluatePanelLeg so the
 * enqueue path (§7.2) can evaluate the panel leg on its own.
 */
async function panelLegForRecording(queryable, recording) {
	// P1 — expected set from the recording's freeze ONLY.
	const expected = recording.panel_expected_user_ids;
	if (!Array.isArray(expected) || expected.length === 0) {
		return { allowed: false, code: 'PANEL_SET_UNRESOLVABLE' };
	}
	const expectedSorted = [...expected].map(Number).sort((a, b) => a - b);

	// P2 — latest decision per expected user (greatest id — database
	// identity, never timestamp ordering). Fail-closed on any throw.
	let rows;
	try {
		rows = [];
		for (const userId of expectedSorted) {
			const res = await queryable.query(
				`SELECT id, decision, notice_version, decided_at FROM event_labelling_consent
				 WHERE interview_event_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`,
				[recording.interview_event_id, userId],
			);
			rows.push({ userId, row: res.rows[0] || null });
		}
	} catch {
		return { allowed: false, code: 'PANEL_AGREEMENT_UNVERIFIABLE' };
	}

	// P3 — per-user judgement, in set order; first failing posture blocks.
	const inForce = versionInForce(recording.started_at);
	for (const { row } of rows) {
		if (!row) {
			return { allowed: false, code: 'PANEL_AGREEMENT_MISSING' };
		}
		if (row.decision === 'declined') {
			return { allowed: false, code: 'PANEL_AGREEMENT_DECLINED' };
		}
		if (row.decision === 'withdrawn') {
			return { allowed: false, code: 'PANEL_AGREEMENT_WITHDRAWN' };
		}
		if (row.decision !== 'granted') {
			return { allowed: false, code: 'PANEL_AGREEMENT_UNVERIFIABLE' };
		}
		if (!recording.started_at) {
			// Precedence unprovable (normally the candidate leg's
			// CONSENT_UNVERIFIABLE fires first; kept here so the leg is
			// fail-closed standalone too).
			return { allowed: false, code: 'PANEL_AGREEMENT_UNVERIFIABLE' };
		}
		if (row.notice_version !== inForce) {
			// C-7: stale judged against the version in force at the
			// recording's start — never at gate time. versionInForce
			// returns null before the first version existed (minor-6
			// fix), which no notice_version can equal → STALE.
			return { allowed: false, code: 'PANEL_AGREEMENT_STALE' };
		}
		if (new Date(row.decided_at) > new Date(recording.started_at)) {
			return { allowed: false, code: 'PANEL_AGREEMENT_AFTER_RECORDING' };
		}
	}

	// P4 is structural: speaking presence is never read above.
	// P5 — allow + snapshot (the evidence record, privacy C-2).
	return {
		allowed: true,
		panelSnapshot: {
			expected_user_ids: expectedSorted,
			expected_hash: recording.panel_expected_hash ?? null,
			decisions: rows.map(({ userId, row }) => ({
				user_id: userId,
				record_id: row.id,
				decision: row.decision,
				notice_version: row.notice_version,
				decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null,
			})),
		},
	};
}

/**
 * Standalone panel-leg evaluation for one recording (§7.2 enqueue
 * suppression + the worker's claim-transaction re-check). A recording
 * with no event link has no panel leg — allowed with a null snapshot
 * (the full gate still governs claim/write for such recordings).
 */
async function evaluatePanelLeg(recordingId, queryable = db) {
	const recRes = await queryable.query(
		`SELECT interview_event_id, started_at, panel_expected_user_ids, panel_expected_hash
		 FROM interview_recordings WHERE id = $1`,
		[recordingId],
	);
	const recording = recRes.rows[0];
	if (!recording || !recording.interview_event_id) {
		return { allowed: true, panelSnapshot: null };
	}
	return panelLegForRecording(queryable, recording);
}

/** Deep-compare two panel snapshots (P6 write-time comparison). */
function panelSnapshotsEqual(a, b) {
	if (!a || !b) return a === b;
	return JSON.stringify(normalizePanelSnapshot(a)) === JSON.stringify(normalizePanelSnapshot(b));
}

function normalizePanelSnapshot(snap) {
	if (!snap) return null;
	const decisions = [...(snap.decisions || [])]
		.map((d) => ({
			user_id: d.user_id,
			record_id: d.record_id,
			decision: d.decision,
			notice_version: d.notice_version,
			decided_at: d.decided_at ? new Date(d.decided_at).toISOString() : null,
		}))
		.sort((x, y) => x.user_id - y.user_id);
	return {
		expected_user_ids: [...(snap.expected_user_ids || [])].map(Number).sort((x, y) => x - y),
		expected_hash: snap.expected_hash ?? null,
		decisions,
	};
}

module.exports = {
	evaluateDiarizationGate,
	evaluatePanelLeg,
	panelLegForRecording,
	panelSnapshotsEqual,
	normalizePanelSnapshot,
};
