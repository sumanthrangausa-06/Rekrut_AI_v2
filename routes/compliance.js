const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const auditLogService = require('../services/auditLogService');
const { AuditLogger } = auditLogService;
const BiasDetection = require('../services/biasDetection');
const { explainOmniScore, explainDecision } = require('../services/scoreExplainer');
const biometricCrypto = require('../lib/biometricCrypto');
const biometricAudit = require('../lib/biometricAudit');
const { unpackEnvelope } = require('../lib/r2FrameStore');
const r2ObserverAudioStore = require('../lib/r2ObserverAudioStore');

// #927: candidate-safe projection of a decision explanation (privacy
// seat, STOP 1 on #927; S-087 toCandidateSafeReport precedent). The
// candidate-self audience of GET /explain/decision receives ONLY the
// fields enumerated here, constructed key by key at every level —
// never a spread with deletions: explainDecision() is fed by
// `SELECT ja.*`, so under a denylist any future column or service
// field would reach candidates by default. The privacy seat owns
// this list at the PR gate. Two cautions for future editors:
// (1) this projection controls KEYS, not values — a new factor type
// or template that writes internal data into factors[].explanation
// free text needs privacy review before it ships; (2) fields are the
// candidate's own (name/email, the job applied to, the decision and
// its timing, their own OmniScores, and the explanation factors) —
// recruiter_notes and every other internal field stay server-side.
function toCandidateSafeDecisionExplanation(explanation) {
	const candidate = explanation.candidate || {};
	const job = explanation.job || {};
	const decision = explanation.decision || {};
	return {
		application_id: explanation.application_id,
		candidate: { name: candidate.name, email: candidate.email },
		job: { title: job.title },
		decision: { status: decision.status, decided_at: decision.decided_at },
		omniscore_at_apply: explanation.omniscore_at_apply,
		current_omniscore: explanation.current_omniscore,
		factors: Array.isArray(explanation.factors)
			? explanation.factors.map((f) => {
					const factor = f || {};
					return {
						factor: factor.factor,
						value: factor.value,
						impact: factor.impact,
						explanation: factor.explanation,
					};
				})
			: [],
	};
}

// #2035: DSAR-safe projection of a users row for POST /gdpr/export.
// Same discipline as the #927 projection above — the bundle's `user`
// section receives ONLY the fields enumerated here, constructed key
// by key, never a spread with deletions: the handler's row comes
// from an explicit-column SELECT (below), and this projection is the
// second layer, so a future users column reaches the bundle only by
// a deliberate edit to this list (the security/privacy gate).
// INCLUDED: the subject's own profile/account data a DSAR returns
// (identity, role, company link, imported LinkedIn payload, billing
// state, account-state and row timestamps).
// EXCLUDED — credential / external-key material, which serves no
// access/portability purpose: password_hash (credential verifier),
// google_id / linkedin_id / oauth_provider (external authenticator
// link block), stripe_subscription_id (opaque external billing key;
// the subject-facing billing facts — is_paid, subscription_plan,
// subscription_status — are included above).
// #2037: `linkedin_data` is the raw LinkedIn import payload
// (routes/candidate.js stores JSON.stringify(profile._raw)), and the
// member identifier excluded above as `linkedin_id` rides inside it
// at `userinfo.sub` (the OIDC subject the auth layer copies into
// users.linkedin_id) and at `me.id` (the v2/me payload). Strip both
// from a deep copy so the bundle honours the exclusion; the stored
// row is never mutated and the rest of the imported payload (profile
// fields, positions, educations, skills) is the subject's own data
// and stays.
function toExportSafeLinkedInData(linkedinData) {
	if (!linkedinData || typeof linkedinData !== 'object') return linkedinData;
	const copy = JSON.parse(JSON.stringify(linkedinData));
	// Collect the identifier values BEFORE stripping the keys: the
	// writer stores the full LinkedIn API responses for the
	// positions/educations/skills sub-collections, so the same values
	// can ride inside member-URN strings there (bare or
	// percent-encoded). Every occurrence of either value — and of
	// the `urn:li:person:<value>` forms built from it — is excised
	// from every string in the copy (review BLOCK-2 on #2037).
	const identifiers = [];
	if (copy.userinfo && typeof copy.userinfo === 'object') {
		if (typeof copy.userinfo.sub === 'string' && copy.userinfo.sub) {
			identifiers.push(copy.userinfo.sub);
		}
		delete copy.userinfo.sub;
	}
	if (copy.me && typeof copy.me === 'object') {
		if (typeof copy.me.id === 'string' && copy.me.id) identifiers.push(copy.me.id);
		delete copy.me.id;
	}
	if (identifiers.length === 0) return copy;
	const scrubString = (value) => {
		let out = value;
		for (const id of identifiers) {
			out = out.split(`urn:li:person:${id}`).join('');
			out = out
				.split(`urn%3Ali%3Aperson%3A${encodeURIComponent(id)}`)
				.join('');
			out = out.split(id).join('');
		}
		return out;
	};
	const scrub = (node) => {
		if (typeof node === 'string') return scrubString(node);
		if (Array.isArray(node)) return node.map(scrub);
		if (node && typeof node === 'object') {
			for (const key of Object.keys(node)) node[key] = scrub(node[key]);
		}
		return node;
	};
	return scrub(copy);
}

function toExportSafeUser(row) {
	if (!row) return null;
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		role: row.role,
		title: row.title,
		company_name: row.company_name,
		company_id: row.company_id,
		github_username: row.github_username,
		avatar_url: row.avatar_url,
		linkedin_data: toExportSafeLinkedInData(row.linkedin_data),
		is_paid: row.is_paid,
		subscription_plan: row.subscription_plan,
		subscription_status: row.subscription_status,
		suspended_at: row.suspended_at,
		deleted_at: row.deleted_at,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

// #2035: explicit column list for the export's users read — exactly
// the toExportSafeUser keys, so credential material never leaves the
// DB at all. Keep the two lists in step; the #2035 suite pins both.
const EXPORT_USER_COLUMNS =
	'id, email, name, role, title, company_name, company_id, github_username, avatar_url, linkedin_data, is_paid, subscription_plan, subscription_status, suspended_at, deleted_at, created_at, updated_at';

function canAccessUserRecord(req, userId) {
	const targetId = Number(userId);
	if (!Number.isInteger(targetId)) {
		return { ok: false, status: 400, error: 'Valid user ID required' };
	}

	if (req.user?.role === 'admin' || req.user?.id === targetId) {
		return { ok: true, targetId };
	}

	return { ok: false, status: 403, error: 'You can only access your own compliance data' };
}

// #1112: bias/adverse-impact results for a job are visible only to a
// platform admin or a hiring role whose company owns the job — the
// audience /bias/flagged and /bias/analyze already use in this router.
// Ownership uses the /explain/job lookup shape (jobs table, fail-closed
// on a null company_id or a missing job); the denial status is 403 per
// #1112's spec — identical for missing and foreign jobs, so neither
// endpoint is an existence oracle — and it fires before any bias
// service is reached.
async function canAccessJobBias(req, jobId) {
	if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
		return { ok: false, status: 403, error: 'Insufficient permissions' };
	}
	if (req.user?.role === 'admin') {
		return { ok: true };
	}
	const jobResult = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
	const job = jobResult.rows[0];
	if (
		!job ||
		job.company_id == null ||
		req.user?.company_id == null ||
		Number(req.user.company_id) !== Number(job.company_id)
	) {
		return { ok: false, status: 403, error: 'Access denied' };
	}
	return { ok: true };
}

/**
 * GDPR COMPLIANCE ENDPOINTS
 */

// Export user data (Right to portability)
router.post('/gdpr/export', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.body;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const targetUserId = access.targetId;

		// Gather all user data — #2035: explicit allowlist columns
		// only (see EXPORT_USER_COLUMNS / toExportSafeUser above); a
		// raw users row carries password_hash and must never be read
		// into, or placed in, the export bundle.
		const userData = await pool.query(
			`SELECT ${EXPORT_USER_COLUMNS} FROM users WHERE id = $1`,
			[targetUserId],
		);

		// #1548: no data subject = nothing to export. Without this check
		// an admin exporting a non-existent id built a user:null bundle
		// and then 500'd on the data_requests FK (audit_logs carries the
		// same FK, swallowed inside AuditLogger.log). The check sits
		// before AuditLogger.log and the insert so no audit/request rows
		// are attempted for absent targets. Non-admins never reach here
		// for foreign ids (canAccessUserRecord 403s first) — no oracle.
		if (userData.rows.length === 0) {
			return res.status(404).json({ error: 'User not found' });
		}
		// #1533 (R7, Lex ruling on #1528): the score section is re-sourced
		// from the live omni_scores family — omniscore_results was never
		// written, so the old read exported [] for every user. Rows are
		// exported raw/native (no normalisation): total_score stays on
		// its native 300-850 scale, factors on 0-100; a NULL total stays
		// null, and no row exports as score: null (honest absence).
		const omniScoreData = await pool.query('SELECT * FROM omni_scores WHERE user_id = $1', [
			targetUserId,
		]);
		const scoreHistoryData = await pool.query('SELECT * FROM score_history WHERE user_id = $1', [
			targetUserId,
		]);
		const scoreSnapshotsData = await pool.query(
			'SELECT * FROM score_snapshots WHERE user_id = $1',
			[targetUserId],
		);
		const interviewData = await pool.query('SELECT * FROM interviews WHERE user_id = $1', [
			targetUserId,
		]);
		const assessmentData = await pool.query('SELECT * FROM assessment_results WHERE user_id = $1', [
			targetUserId,
		]);
		const profileData = await pool.query('SELECT * FROM candidate_profiles WHERE user_id = $1', [
			targetUserId,
		]);
		const consentData = await pool.query('SELECT * FROM consent_records WHERE user_id = $1', [
			targetUserId,
		]);
		const auditData = await pool.query('SELECT * FROM audit_logs WHERE user_id = $1', [
			targetUserId,
		]);

		// #2028 item 4 (STOP 1 on #2028; panel: Lex + privacy + Rex):
		// the biometric-policy §5 promise ("a complete copy of your
		// biometric data") is honoured by extending this bundle with a
		// `biometric` section. #2034 (corrective; STOP 1 on #2034,
		// comment 6541315686) completes Lex's FULL specification where
		// the condensed panel deliveries had dropped or inverted it:
		// existing-DEK decryption, erasure's dual-branch recording
		// scope, consent receipts, sanitised diarization runs/jobs,
		// observer siblings, is_test exclusion, and a migration-296
		// existence guard. diarization_metrics_daily remains a system
		// aggregate (no subject linkage) and is never read here.
		//
		// Speech measurements: the non-envelope columns are selected
		// for the bundle; the envelope is fetched in a SEPARATE query
		// into a variable used only for decryption, so the envelope
		// bytes can never enter the bundle. Each row is decrypted with
		// the subject's own EXISTING DEK (#2034 item 1:
		// decryptWithExistingDEK — an export read must never create
		// key material; the writer's own path in lib/observerCapture.js
		// is encryptWithDEK + packEnvelope +
		// r2ObserverAudioStore.measurementAAD). A row that cannot be
		// decrypted (e.g. the DEK was crypto-shredded) exports its
		// metadata with measurements: null and a per-row note — one
		// bad row never fails the whole export, and raw ciphertext is
		// never exported as a fallback. #2034 item 6: is_test rows are
		// test captures, not the subject's biometric data — excluded
		// in SQL on both queries, and the exclusion is stated in the
		// bundle note.
		const speechMetaData = await pool.query(
			`SELECT id, interview_session_id, candidate_id, method_version, state, is_test, created_at, updated_at
       FROM observer_speech_measurements WHERE candidate_id = $1 AND is_test = false`,
			[targetUserId],
		);
		const speechEnvelopeData = await pool.query(
			'SELECT id, measurements_envelope FROM observer_speech_measurements WHERE candidate_id = $1 AND is_test = false',
			[targetUserId],
		);
		const envelopeById = new Map(
			speechEnvelopeData.rows.map((r) => [r.id, r.measurements_envelope]),
		);
		const speechMeasurements = [];
		let biometricDecryptedRows = 0;
		for (const row of speechMetaData.rows) {
			let measurements = null;
			let note = null;
			try {
				const { ciphertext, iv, tag } = unpackEnvelope(envelopeById.get(row.id));
				const plaintext = await biometricCrypto.decryptWithExistingDEK(
					ciphertext,
					iv,
					tag,
					targetUserId,
					r2ObserverAudioStore.measurementAAD(targetUserId, row.interview_session_id),
				);
				measurements = JSON.parse(plaintext.toString('utf8'));
				biometricDecryptedRows += 1;
			} catch {
				note =
					'Speech measurement values could not be decrypted (the encryption key for this record is unavailable, e.g. it was destroyed on erasure); the record metadata is exported without the values.';
			}
			speechMeasurements.push({ ...row, measurements, ...(note ? { note } : {}) });
		}

		// The subject's recordings (#2034 item 2): scoped EXACTLY as
		// erasure scopes them (lib/erasureService.js
		// diarizationRecordingScope) — the interview_events join OR
		// the session-linked branch (migration 130's XOR CHECK means
		// session-linked recordings have interview_event_id IS NULL,
		// so the event join alone could never reach them). Labels,
		// mappings, audit, runs and jobs below inherit this scope.
		// Metadata ONLY: storage_path (the encrypted storage
		// reference) and encryption_key_id are never selected.
		const recordingData = await pool.query(
			`SELECT r.id, r.interview_event_id, r.status, r.diarization_status, r.diarization_updated_at,
              r.started_at, r.stopped_at, r.duration_seconds, r.file_format, r.file_size_bytes,
              r.retention_expires_at, r.created_at
       FROM interview_recordings r
       WHERE r.id IN (
         SELECT ir.id FROM interview_recordings ir
         JOIN interview_events ie ON ie.id = ir.interview_event_id
         WHERE ie.candidate_id = $1
       ) OR r.id IN (
         SELECT ir2.id FROM interview_recordings ir2
         WHERE ir2.interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)
       )`,
			[targetUserId],
		);
		const recordingIds = recordingData.rows.map((r) => r.id);

		// #2034 item 10 (Rex promotion guard): the queries below read
		// the migration-296 family (diarization_runs / diarization_jobs
		// / recording_speaker_mappings / transcript_speaker_audit /
		// interview_transcripts.speaker_number) and migration 299's
		// event_labelling_consent. On a database where those migrations
		// have not yet executed, an unguarded query throws and the
		// handler's single catch would 500 the ENTIRE export —
		// regressing a working DSAR path. Guard with to_regclass: the
		// family degrades to empty arrays + an honest note in the
		// bundle instead. (A guard query that returns no row at all —
		// only possible under a test double — keeps the pre-guard
		// behaviour.)
		const guardData = await pool.query(
			`SELECT to_regclass('public.diarization_runs') IS NOT NULL AS runs,
              to_regclass('public.diarization_jobs') IS NOT NULL AS jobs,
              to_regclass('public.recording_speaker_mappings') IS NOT NULL AS mappings,
              to_regclass('public.transcript_speaker_audit') IS NOT NULL AS audit,
              to_regclass('public.event_labelling_consent') IS NOT NULL AS labelling,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'interview_transcripts' AND column_name = 'speaker_number') AS speaker_number`,
		);
		const guardRow = guardData.rows[0];
		const hasDiarizationFamily =
			!guardRow ||
			Boolean(
				guardRow.runs &&
					guardRow.jobs &&
					guardRow.mappings &&
					guardRow.audit &&
					guardRow.labelling &&
					guardRow.speaker_number,
			);

		const ownIdOrNull = (v) => (v != null && Number(v) === targetUserId ? v : null);

		let speakerLabelData = { rows: [] };
		let speakerMappings = [];
		let speakerLabelAudit = [];
		let diarizationRuns = [];
		let diarizationJobs = [];
		let labellingConsentData = { rows: [] };
		if (hasDiarizationFamily) {
			speakerLabelData = await pool.query(
				`SELECT id, recording_id, speaker_identity, speaker_number, text, start_time_ms, end_time_ms, confidence, created_at
       FROM interview_transcripts WHERE recording_id = ANY($1::int[])`,
				[recordingIds],
			);

			// Speaker mappings name the participants of the subject's
			// recordings — including OTHER people. A user ID is kept only
			// when it is the subject's own; anyone else's ID is exported
			// as null and only their participant_role is kept (privacy
			// seat: role, not identity).
			const speakerMappingData = await pool.query(
				`SELECT id, recording_id, speaker_number, participant_user_id, participant_role, state, updated_by, created_at, updated_at
       FROM recording_speaker_mappings WHERE recording_id = ANY($1::int[])`,
				[recordingIds],
			);
			speakerMappings = speakerMappingData.rows.map((row) => ({
				...row,
				participant_user_id: ownIdOrNull(row.participant_user_id),
				updated_by: ownIdOrNull(row.updated_by),
			}));

			// Label-correction audit rows are exported only where the
			// subject is a party (from or to); every user ID on the row —
			// from, to, and the actor — follows the same rule as the
			// mappings: kept only when it is the subject's own.
			const speakerAuditData = await pool.query(
				`SELECT id, recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action, created_at
       FROM transcript_speaker_audit
       WHERE recording_id = ANY($1::int[]) AND (from_user_id = $2 OR to_user_id = $2)`,
				[recordingIds, targetUserId],
			);
			speakerLabelAudit = speakerAuditData.rows.map((row) => ({
				...row,
				from_user_id: ownIdOrNull(row.from_user_id),
				to_user_id: ownIdOrNull(row.to_user_id),
				actor_user_id: ownIdOrNull(row.actor_user_id),
			}));

			// #2034 item 4 (Lex-full, reconciled at STOP 1 on #2034):
			// diarization runs for the subject's recordings — versions,
			// speaker_count, coverage_end_ms and turns, projected key by
			// key. proposed_mapping is pseudonymised entry-by-entry with
			// the same rule as the mappings above (the shipped shape is
			// { "<speaker>": { participant_user_id, participant_role } |
			// null } — IDs and roles only, never names): the subject's
			// own ID is kept, anyone else's becomes null with the role
			// kept. #2039: a proposed_mapping that is not a plain
			// (non-array) object fails closed to null — never raw.
			// panel_consent_snapshot is NEVER selected. Jobs export
			// metadata only (status, attempt_count, timestamps) — no
			// worker_id, error_message, snapshot or consent_receipt_id.
			const diarizationRunData = await pool.query(
				`SELECT id, recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, proposed_mapping, coverage_end_ms, created_at
       FROM diarization_runs WHERE recording_id = ANY($1::int[])`,
				[recordingIds],
			);
			diarizationRuns = diarizationRunData.rows.map((row) => ({
				id: row.id,
				recording_id: row.recording_id,
				job_id: row.job_id,
				engine_package: row.engine_package,
				sdk_version: row.sdk_version,
				model_version: row.model_version,
				speaker_count: row.speaker_count,
				turns: row.turns,
				proposed_mapping:
					row.proposed_mapping && typeof row.proposed_mapping === 'object' && !Array.isArray(row.proposed_mapping)
						? Object.fromEntries(
								Object.entries(row.proposed_mapping).map(([speaker, entry]) => [
									speaker,
									entry == null
										? null
										: {
												participant_user_id: ownIdOrNull(entry.participant_user_id),
												participant_role: entry.participant_role ?? null,
											},
								]),
							)
						: null,
				coverage_end_ms: row.coverage_end_ms,
				created_at: row.created_at,
			}));
			const diarizationJobData = await pool.query(
				`SELECT id, recording_id, status, attempt_count, claimed_at, last_heartbeat, created_at, updated_at
       FROM diarization_jobs WHERE recording_id = ANY($1::int[])`,
				[recordingIds],
			);
			diarizationJobs = diarizationJobData.rows.map((row) => ({
				id: row.id,
				recording_id: row.recording_id,
				status: row.status,
				attempt_count: row.attempt_count,
				claimed_at: row.claimed_at,
				last_heartbeat: row.last_heartbeat,
				created_at: row.created_at,
				updated_at: row.updated_at,
			}));

			// Labelling consents are keyed by user_id (migration 299 —
			// there is no candidate_id column on event_labelling_consent).
			labellingConsentData = await pool.query(
				`SELECT id, interview_event_id, user_id, decision, notice_version, decided_at, ip_address, user_agent_hash, created_at
       FROM event_labelling_consent WHERE user_id = $1`,
				[targetUserId],
			);
		}

		// #2034 item 3: the subject's own consent_receipts — that table
		// is the consent source of truth (lib/consentService.js:89,
		// migration 244). Biometric-family types only: 'biometric'
		// (speaker labelling rides this type, migration 297) and
		// 'observer_capture' (migration 257).
		const consentReceiptData = await pool.query(
			`SELECT id, interview_session_id, candidate_id, consent_type, consent_text_version, consent_text_hash, granted_at, withdrawn_at
       FROM consent_receipts
       WHERE candidate_id = $1 AND consent_type IN ('biometric', 'observer_capture')
       ORDER BY id`,
			[targetUserId],
		);

		// #2034 item 5: observer siblings. Capture outcomes are
		// counts/timing rows for the subject's sessions. Audio chunks
		// export count metadata only (captured_at, byte_size) —
		// object_key (the storage reference) is never selected.
		const observerOutcomeData = await pool.query(
			`SELECT interview_session_id, candidate_id, scope, is_test, cohort_allowlist_version, chunks_persisted, chunks_dropped, audio_seconds_captured, capture_gap_ratio, stop_reason, started_at, stopped_at
       FROM observer_capture_outcomes WHERE candidate_id = $1`,
			[targetUserId],
		);
		const observerChunkData = await pool.query(
			`SELECT interview_session_id, captured_at, byte_size
       FROM observer_audio_chunks WHERE candidate_id = $1 ORDER BY captured_at`,
			[targetUserId],
		);
		const observerAudioChunks = observerChunkData.rows.map((row) => ({
			interview_session_id: row.interview_session_id,
			captured_at: row.captured_at,
			byte_size: row.byte_size,
		}));

		const exportData = {
			// #1544: same ?? null hardening as profile (#1540) — an absent
			// row must export as explicit null, never a dropped key.
			user: toExportSafeUser(userData.rows[0]),
			// Replaced in place per Lex's #1528 ruling — never supplemented:
			// one score section, structured by source table, with the
			// scale_note annotation (annotation, not alteration).
			omniscore: {
				score: omniScoreData.rows[0] ?? null,
				score_history: scoreHistoryData.rows,
				score_snapshots: scoreSnapshotsData.rows,
				scale_note: 'total 300-850, factors 0-100',
			},
			interviews: interviewData.rows,
			assessments: assessmentData.rows,
			// #1540 (Lex ruling, Option 2): explicit null states "we hold no
			// profile for you" — an absent key would silently drop from the
			// JSON bundle and read as a gap in the subject's record.
			profile: profileData.rows[0] ?? null,
			consents: consentData.rows,
			// #2028 item 4: biometric section (see the queries above).
			// Present even when empty — all arrays empty states "we
			// hold no biometric data for you" explicitly (#1540
			// explicit-absence pattern), never a dropped key.
			biometric: {
				speech_measurements: speechMeasurements,
				recordings: recordingData.rows,
				speaker_labels: speakerLabelData.rows,
				speaker_mappings: speakerMappings,
				speaker_label_audit: speakerLabelAudit,
				labelling_consents: labellingConsentData.rows,
				consent_receipts: consentReceiptData.rows,
				diarization_runs: diarizationRuns,
				diarization_jobs: diarizationJobs,
				observer_capture_outcomes: observerOutcomeData.rows,
				observer_audio_chunks: observerAudioChunks,
				note:
					'Speech measurement values are decrypted with your own encryption key for this export; the encrypted envelope itself is never exported. A measurement whose key is unavailable exports as measurements: null with an explanation on that row. Recordings are exported as metadata only — no storage references or encryption key identifiers. Speaker mappings and label-correction rows concern everyone in your recordings: other participants are identified by role only, and their user IDs are exported as null. Test-capture speech measurements (is_test) are excluded from this export. Observer audio chunks are exported as metadata only (when each chunk was captured and its size) — the stored audio references are never exported.' +
					(hasDiarizationFamily
						? ''
						: ' Speaker labelling records are not available on this database yet (the speaker-labelling schema has not been applied), so the speaker label, speaker mapping, label-correction, diarization and labelling-consent sections are empty.'),
			},
			audit_trail: auditData.rows,
			exported_at: new Date().toISOString(),
		};

		// Log the data export request. #2034 items 8+11: the entry
		// records that the biometric section was included and how many
		// measurement rows were decrypted, and a biometric_audit_log
		// 'export' entry (migration 243 enum) makes the bulk biometric
		// export visible per-export, candidate-attributed, append-only.
		// NO measurement VALUES are logged anywhere in this path (the
		// observer modules' no-values log discipline) — counts only.
		// The biometric audit write is best-effort: its failure must
		// never fail the subject's export.
		await AuditLogger.log({
			actionType: 'gdpr_data_export',
			userId: targetUserId,
			targetType: 'user',
			targetId: targetUserId,
			metadata: {
				export_size: JSON.stringify(exportData).length,
				biometric_included: true,
				biometric_decrypted_rows: biometricDecryptedRows,
			},
			req,
		});
		try {
			await biometricAudit.logAccess({
				userId: req.user?.id ?? targetUserId,
				userRole: req.user?.role,
				action: 'export',
				dataType: 'gdpr_export_biometric',
				candidateId: targetUserId,
				ipAddress: req.ip || null,
				companyId: req.user?.company_id || null,
				metadata: { decrypted_rows: biometricDecryptedRows },
			});
		} catch (auditErr) {
			console.error('Biometric audit log for export failed:', auditErr.message);
		}

		// Create data request record
		await pool.query(
			`INSERT INTO data_requests (user_id, request_type, status, processed_at)
       VALUES ($1, 'export', 'completed', NOW())`,
			[targetUserId],
		);

		res.json({
			success: true,
			data: exportData,
		});
	} catch (error) {
		console.error('Data export failed:', error);
		res.status(500).json({ error: 'Export failed' });
	}
});

// Right to be forgotten
router.post('/gdpr/delete', authMiddleware, async (req, res) => {
	try {
		const { userId, confirmEmail } = req.body;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const targetUserId = access.targetId;

		if (!confirmEmail) {
			return res.status(400).json({ error: 'User ID and email confirmation required' });
		}

		// Verify email matches
		const userCheck = await pool.query('SELECT email FROM users WHERE id = $1', [targetUserId]);
		if (userCheck.rows.length === 0 || userCheck.rows[0].email !== confirmEmail) {
			return res.status(403).json({ error: 'Email confirmation failed' });
		}

		// Create deletion request (manual review required for compliance)
		const result = await pool.query(
			`INSERT INTO data_requests (user_id, request_type, status, notes)
       VALUES ($1, 'deletion', 'pending', 'Awaiting compliance review')
       RETURNING id`,
			[targetUserId],
		);

		await AuditLogger.log({
			actionType: 'gdpr_deletion_requested',
			userId: targetUserId,
			targetType: 'user',
			targetId: targetUserId,
			metadata: { request_id: result.rows[0].id },
			req,
		});

		res.json({
			success: true,
			message: 'Deletion request submitted for review',
			requestId: result.rows[0].id,
			note: 'Data will be anonymized within 30 days after compliance review',
		});
	} catch (error) {
		console.error('Deletion request failed:', error);
		res.status(500).json({ error: 'Request failed' });
	}
});

// Record consent
router.post('/gdpr/consent', authMiddleware, async (req, res) => {
	try {
		const { userId, consentType, consented } = req.body;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const targetUserId = access.targetId;

		if (!consentType || consented === undefined) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// #1550: no data subject = no consent to record. Without this
		// check an admin recording consent for a non-existent id 500'd
		// on the consent_records FK — and a consent record for a
		// non-existent subject must never be attempted at all. The
		// check sits before the insert and AuditLogger.log so no
		// consent/audit rows are attempted for absent targets.
		// Non-admins never reach here for foreign ids
		// (canAccessUserRecord 403s first) — no oracle.
		const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
		if (userCheck.rows.length === 0) {
			return res.status(404).json({ error: 'User not found' });
		}

		const result = await pool.query(
			`INSERT INTO consent_records (user_id, consent_type, consented, consented_at, ip_address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
			[targetUserId, consentType, consented, consented ? new Date() : null, req.ip],
		);

		await AuditLogger.log({
			actionType: 'consent_recorded',
			userId: targetUserId,
			targetType: 'consent',
			targetId: result.rows[0].id,
			metadata: { consent_type: consentType, consented },
			req,
		});

		res.json({ success: true, consentId: result.rows[0].id });
	} catch (error) {
		console.error('Consent recording failed:', error);
		res.status(500).json({ error: 'Failed to record consent' });
	}
});

// Get user consents
router.get('/gdpr/consents/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const result = await pool.query(
			`SELECT * FROM consent_records WHERE user_id = $1 ORDER BY created_at DESC`,
			[access.targetId],
		);

		res.json({ success: true, consents: result.rows });
	} catch (error) {
		console.error('Failed to fetch consents:', error);
		res.status(500).json({ error: 'Failed to fetch consents' });
	}
});

/**
 * BIAS DETECTION & FAIRNESS ENDPOINTS
 */

// Generate bias report
router.post('/bias/analyze', authMiddleware, async (req, res) => {
	try {
		const report = await BiasDetection.generateReport();

		// #1517: no scored candidates — no report was persisted, so there
		// is nothing to audit-log; return the insufficient-data result.
		if (report.insufficient_data) {
			return res.json({
				success: true,
				insufficient_data: true,
				report,
			});
		}

		await AuditLogger.log({
			actionType: 'bias_analysis_generated',
			userId: req.user?.id,
			targetType: 'bias_report',
			targetId: report.reportId,
			metadata: {
				flagged_patterns: report.demographicAnalysis.flaggedPatterns.length,
				anomalies: report.distributionAnalysis.anomalies.length,
			},
			req,
		});

		res.json({
			success: true,
			report,
		});
	} catch (error) {
		console.error('Bias analysis failed:', error);
		res.status(500).json({ error: 'Analysis failed' });
	}
});

// Get bias reports
router.get('/bias/reports', authMiddleware, async (req, res) => {
	try {
		const limit = parseInt(req.query.limit, 10) || 10;
		const offset = parseInt(req.query.offset, 10) || 0;

		const reports = await BiasDetection.getReports({ limit, offset });

		res.json({
			success: true,
			reports,
		});
	} catch (error) {
		console.error('Failed to fetch bias reports:', error);
		res.status(500).json({ error: 'Failed to fetch reports' });
	}
});

// Create fairness audit
router.post('/fairness/audit', authMiddleware, async (_req, res) => {
	try {
		const auditDate = new Date().toISOString().split('T')[0];

		// Get score distribution.
		// #1522 (Rex #1152 §3.2/§4 R8): repointed from the never-written
		// omniscore_results to live omni_scores. total_score is native
		// 300-850 (NULL = no data); buckets and averages run over the
		// normalised value (total_score - 300) / 5.5 AS overall_score_norm,
		// converted once at this SQL boundary, so bucket labels and the
		// fairnessScore formula below keep their 0-100 meaning (on native
		// totals, 100 - (max - min) would run to -450).
		const scoreDistribution = await pool.query(`
      SELECT
        FLOOR(((total_score - 300) / 5.5) / 10) * 10 as bucket,
        COUNT(*) as count,
        AVG((total_score - 300) / 5.5) as avg_score
      FROM omni_scores
      WHERE total_score IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `);

		// Get demographic breakdowns (avg_score is overall_score_norm, above)
		const demographics = await pool.query(`
      SELECT
        cd.gender,
        cd.ethnicity,
        COUNT(*) as total,
        AVG((os.total_score - 300) / 5.5) as avg_score
      FROM candidate_profiles cp
      LEFT JOIN candidate_demographics cd ON cd.user_id = cp.user_id
      LEFT JOIN omni_scores os ON os.user_id = cp.user_id
      WHERE os.total_score IS NOT NULL
      GROUP BY cd.gender, cd.ethnicity
    `);

		// Get appeal statistics
		const appeals = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        AVG(CASE WHEN new_score IS NOT NULL THEN new_score - original_score ELSE 0 END) as avg_adjustment
      FROM score_appeals
      GROUP BY status
    `);

		// #1517: zero scored candidates means there is nothing to audit.
		// Never persist a fairness_audits row carrying a score — return an
		// explicit insufficient-data result (no score, no issues count).
		if (demographics.rows.length === 0) {
			return res.json({
				success: true,
				insufficient_data: true,
				auditId: null,
				fairnessScore: null,
				issues_found: null,
				summary: {
					score_distribution: scoreDistribution.rows,
					demographics: demographics.rows,
					appeals: appeals.rows,
				},
			});
		}

		// Calculate overall fairness score (simplified metric)
		const avgScores = demographics.rows.map((r) => parseFloat(r.avg_score));
		const fairnessScore = 100 - (Math.max(...avgScores) - Math.min(...avgScores));

		const result = await pool.query(
			`INSERT INTO fairness_audits
       (audit_date, audit_type, score_distribution, demographic_breakdowns, appeal_stats, overall_fairness_score, issues_found)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
			[
				auditDate,
				'automated',
				JSON.stringify(scoreDistribution.rows),
				JSON.stringify(demographics.rows),
				JSON.stringify(appeals.rows),
				fairnessScore,
				0,
			],
		);

		res.json({
			success: true,
			auditId: result.rows[0].id,
			fairnessScore,
			summary: {
				score_distribution: scoreDistribution.rows,
				demographics: demographics.rows,
				appeals: appeals.rows,
			},
		});
	} catch (error) {
		console.error('Fairness audit failed:', error);
		res.status(500).json({ error: 'Audit failed' });
	}
});

// Get fairness audits
router.get('/fairness/audits', authMiddleware, async (req, res) => {
	try {
		const limit = parseInt(req.query.limit, 10) || 10;
		const offset = parseInt(req.query.offset, 10) || 0;

		const result = await pool.query(
			`SELECT * FROM fairness_audits
       ORDER BY audit_date DESC
       LIMIT $1 OFFSET $2`,
			[limit, offset],
		);

		res.json({
			success: true,
			audits: result.rows,
		});
	} catch (error) {
		console.error('Failed to fetch audits:', error);
		res.status(500).json({ error: 'Failed to fetch audits' });
	}
});

/**
 * SCORE APPEALS
 */

// Submit appeal
router.post('/appeal', authMiddleware, async (req, res) => {
	try {
		const { userId, scoreType, originalScore, appealReason } = req.body;

		if (!userId || !scoreType || !appealReason) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// #1111: same canAccessUserRecord guard as GET /appeal/:userId
		// below — an appeal is filed by (or for, by an admin) its subject,
		// never by an unrelated authenticated user supplying another ID.
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}
		const targetUserId = access.targetId;

		const result = await pool.query(
			`INSERT INTO score_appeals (user_id, score_type, original_score, appeal_reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
			[targetUserId, scoreType, originalScore, appealReason],
		);

		await AuditLogger.log({
			actionType: 'score_appeal_submitted',
			userId: targetUserId,
			targetType: 'appeal',
			targetId: result.rows[0].id,
			metadata: {
				score_type: scoreType,
				original_score: originalScore,
				// #1111 (security-reviewer LOW-1): an admin filing for
				// another user is recorded as the actor, so the audit row
				// is not indistinguishable from the subject filing.
				...(req.user?.id !== targetUserId ? { actor_id: req.user?.id } : {}),
			},
			req,
		});

		res.json({
			success: true,
			appealId: result.rows[0].id,
			message: 'Appeal submitted successfully',
		});
	} catch (error) {
		console.error('Appeal submission failed:', error);
		res.status(500).json({ error: 'Failed to submit appeal' });
	}
});

// Get user appeals
router.get('/appeal/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;
		const access = canAccessUserRecord(req, userId);

		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const result = await pool.query(
			`SELECT * FROM score_appeals WHERE user_id = $1 ORDER BY created_at DESC`,
			[access.targetId],
		);

		res.json({
			success: true,
			appeals: result.rows,
		});
	} catch (error) {
		console.error('Failed to fetch appeals:', error);
		res.status(500).json({ error: 'Failed to fetch appeals' });
	}
});

/**
 * AUDIT LOGS
 */

// Query audit logs
router.get('/audit/logs', authMiddleware, async (req, res) => {
	try {
		// S-097 (#821): admin-only. The legacy audit_logs table has no
		// company_id, so company-scoping is not implementable here — the
		// company-scoped regulator path already exists at /audit-trail/export.
		// Any non-admin audience for the unscoped log is precisely the leak.
		if (req.user?.role !== 'admin') {
			return res.status(403).json({ error: 'Admin access required' });
		}

		const { userId, actionType, startDate, endDate, limit, offset } = req.query;

		const logs = await AuditLogger.query({
			userId: userId ? parseInt(userId, 10) : undefined,
			actionType,
			startDate,
			endDate,
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({
			success: true,
			logs,
		});
	} catch (error) {
		console.error('Failed to query audit logs:', error);
		res.status(500).json({ error: 'Query failed' });
	}
});

// Export audit logs
router.post('/audit/export', authMiddleware, async (req, res) => {
	try {
		// S-097 (#821): admin-only, same ruling as GET /audit/logs above —
		// audit_logs cannot be company-scoped (no company_id column).
		if (req.user?.role !== 'admin') {
			return res.status(403).json({ error: 'Admin access required' });
		}

		const { startDate, endDate, format } = req.body;

		if (!startDate || !endDate) {
			return res.status(400).json({ error: 'Start and end dates required' });
		}

		const logs = await AuditLogger.exportLogs({
			startDate,
			endDate,
			format: format || 'json',
		});

		await AuditLogger.log({
			actionType: 'audit_logs_exported',
			userId: req.user?.id,
			targetType: 'audit_export',
			metadata: {
				start_date: startDate,
				end_date: endDate,
				format,
			},
			req,
		});

		if (format === 'csv') {
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename=audit-logs-${startDate}-to-${endDate}.csv`,
			);
			res.send(logs);
		} else {
			res.json({
				success: true,
				logs,
			});
		}
	} catch (error) {
		console.error('Audit export failed:', error);
		res.status(500).json({ error: 'Export failed' });
	}
});

/**
 * DATA RETENTION
 */

// Get retention policies
router.get('/retention/policies', authMiddleware, async (_req, res) => {
	try {
		const result = await pool.query('SELECT * FROM data_retention_policies ORDER BY data_type');

		res.json({
			success: true,
			policies: result.rows,
		});
	} catch (error) {
		console.error('Failed to fetch retention policies:', error);
		res.status(500).json({ error: 'Failed to fetch policies' });
	}
});

// Update retention policy (admin only)
router.put('/retention/policies/:id', authMiddleware, async (req, res) => {
	try {
		const { id } = req.params;
		const { retention_days, auto_delete } = req.body;

		await pool.query(
			`UPDATE data_retention_policies
       SET retention_days = $1, auto_delete = $2, updated_at = NOW()
       WHERE id = $3`,
			[retention_days, auto_delete, id],
		);

		await AuditLogger.log({
			actionType: 'retention_policy_updated',
			userId: req.user?.id,
			targetType: 'retention_policy',
			targetId: parseInt(id, 10),
			metadata: { retention_days, auto_delete },
			req,
		});

		res.json({ success: true });
	} catch (error) {
		console.error('Failed to update policy:', error);
		res.status(500).json({ error: 'Update failed' });
	}
});

/**
 * SCORE EXPLAINABILITY
 */

// Explain OmniScore
router.get('/explain/omniscore/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;

		// S-097 (#821): this is a user-record endpoint, so the file's own
		// canAccessUserRecord guard (self-or-admin, used by 8 siblings) is
		// the right shape — not a company-scoped query. One extension: a
		// hiring-side caller may read the score of a candidate who has an
		// application with their company (recruiter-of-record), proven by a
		// job_applications linkage row. Guard runs before the service call.
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			if (access.status !== 403) {
				return res.status(access.status).json({ error: access.error });
			}
			const isHiringRole = ['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role);
			let linked = false;
			if (isHiringRole && req.user?.company_id != null) {
				const linkage = await pool.query(
					'SELECT 1 FROM job_applications WHERE candidate_id = $1 AND company_id = $2 LIMIT 1',
					[parseInt(userId, 10), req.user.company_id],
				);
				linked = linkage.rows.length > 0;
			}
			if (!linked) {
				return res.status(access.status).json({ error: access.error });
			}
		}

		const explanation = await explainOmniScore(parseInt(userId, 10));

		await AuditLogger.log({
			actionType: 'score_explanation_viewed',
			userId: req.user?.id,
			targetType: 'user',
			targetId: parseInt(userId, 10),
			metadata: { explanation_type: 'omniscore' },
			req,
		});

		res.json({
			success: true,
			explanation,
		});
	} catch (error) {
		console.error('Score explanation failed:', error);
		res.status(500).json({ error: 'Failed to explain score' });
	}
});

// Explain application decision
router.get('/explain/decision/:applicationId', authMiddleware, async (req, res) => {
	try {
		const { applicationId } = req.params;
		const applicationIdInt = parseInt(applicationId, 10);

		// S-097 (#821): object-level authorisation BEFORE the service call.
		// The guard must live in the route: explainDecision re-throws on
		// error (it depends on the phantom candidate_job_matches table), so
		// a denied caller must never reach it. The resource is an
		// application, not a user record, so canAccessUserRecord does not
		// fit — load the application's own candidate/company anchors and
		// compare here (the scoped-load shape used across this codebase).
		// Allow: admin; the candidate themself; a hiring role whose
		// company owns the application (fail-closed on null company_id).
		// Everything else — including a non-existent ID — is the same 404,
		// so foreign IDs cannot be distinguished from missing ones.
		const appResult = Number.isInteger(applicationIdInt)
			? await pool.query('SELECT candidate_id, company_id FROM job_applications WHERE id = $1', [
					applicationIdInt,
				])
			: { rows: [] };
		const application = appResult.rows[0];
		const isAdmin = req.user?.role === 'admin';
		const isCandidateSelf = !!application && req.user?.id === application.candidate_id;
		const isOwningHiring =
			!!application &&
			['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role) &&
			req.user?.company_id != null &&
			Number(req.user.company_id) === Number(application.company_id);
		if (!application || (!isAdmin && !isCandidateSelf && !isOwningHiring)) {
			return res.status(404).json({ error: 'Application not found' });
		}

		const rawExplanation = await explainDecision(applicationIdInt);

		// Audience shaping (S-097, privacy seat; S-087 toCandidateSafeReport
		// precedent — shape at the route boundary): a candidate audience
		// receives only the allowlist projection in
		// toCandidateSafeDecisionExplanation (#927 — the previous denylist
		// deleted only recruiter_notes and let every other current and
		// future field ride). Fix round (privacy F1 / security F-3, Lead's
		// ruling): shape on the authorisation identity, not the role
		// string — a self-applicant whose account role is no longer
		// `candidate` (e.g. converted to recruiter) is still the candidate
		// audience for their own application. Recruiter/employer-of-record
		// and admin callers (an admin keeps the full record even when they
		// are the applicant) keep the full record unchanged.
		let explanation = rawExplanation;
		// #1457: shaping is unconditional for a candidate-self caller — it
		// must not depend on the service result carrying a `decision`
		// field (an allowlist that only sometimes applies is a leak).
		if (isCandidateSelf && !isAdmin) {
			explanation = toCandidateSafeDecisionExplanation(rawExplanation);
		}

		await AuditLogger.log({
			actionType: 'decision_explanation_viewed',
			userId: req.user?.id,
			targetType: 'job_application',
			targetId: parseInt(applicationId, 10),
			metadata: { explanation_type: 'decision' },
			req,
		});

		res.json({
			success: true,
			explanation,
		});
	} catch (error) {
		console.error('Decision explanation failed:', error);
		res.status(500).json({ error: 'Failed to explain decision' });
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE AUDIT TRAIL — Issue #136 (EU AI Act, tamper-evident, hash-chained)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/compliance/audit-log
 * Log an event to the compliance audit trail (internal/service-to-service use).
 * Any authenticated user can call this; the service validates event data.
 */
router.post('/audit-log', authMiddleware, async (req, res) => {
	try {
		const { eventType, entityType, entityId, actorId, actorRole, jobId, companyId, payload } =
			req.body;

		if (!eventType || !entityType || !entityId) {
			return res.status(400).json({ error: 'eventType, entityType, and entityId are required' });
		}

		const record = await auditLogService.logEvent({
			eventType,
			entityType,
			entityId: parseInt(entityId, 10),
			actorId: actorId ? parseInt(actorId, 10) : req.user?.id || null,
			actorRole: actorRole || req.user?.role || null,
			jobId: jobId ? parseInt(jobId, 10) : null,
			companyId: companyId ? parseInt(companyId, 10) : req.user?.company_id || null,
			payload: payload || {},
			req,
		});

		res.status(201).json({ success: true, record });
	} catch (error) {
		console.error('[compliance/audit-log] Failed to log event:', error.message);
		res.status(500).json({ error: 'Failed to log audit event' });
	}
});

/**
 * GET /api/compliance/audit-trail
 * Query the compliance audit trail. Admin or company owner only.
 */
router.get('/audit-trail', authMiddleware, async (req, res) => {
	try {
		// Access control: admin, employer (owner), or recruiter with company access
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or company access required' });
		}

		const { candidateId, jobId, recruiterId, startDate, endDate, eventType, limit, offset } =
			req.query;

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;

		const result = await auditLogService.getAuditTrail({
			candidateId: candidateId ? parseInt(candidateId, 10) : undefined,
			jobId: jobId ? parseInt(jobId, 10) : undefined,
			recruiterId: recruiterId ? parseInt(recruiterId, 10) : undefined,
			startDate,
			endDate,
			eventType,
			companyId,
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/audit-trail] Query failed:', error.message);
		res.status(500).json({ error: 'Failed to query audit trail' });
	}
});

/**
 * GET /api/compliance/audit-trail/candidate/:candidateId
 * Full record of decisions about a candidate. GDPR / right-to-explanation.
 * Candidate can view their own; admin can view any.
 */
router.get('/audit-trail/candidate/:candidateId', authMiddleware, async (req, res) => {
	try {
		const candidateId = parseInt(req.params.candidateId, 10);
		if (!Number.isInteger(candidateId)) {
			return res.status(400).json({ error: 'Valid candidate ID required' });
		}

		// Access control: candidate viewing own record, or admin/employer
		const isOwn = req.user?.role === 'candidate' && req.user?.id === candidateId;
		const isAdmin = req.user?.role === 'admin';
		let isCompanyUser = false;

		// #920: a company user may read a candidate's audit trail only when
		// the candidate is linked to their company by a job_applications
		// row — the same SELECT 1 … LIMIT 1 linkage idiom as the merged
		// #926 guards above (:584, :1119). Fail-closed when company_id is
		// null. Guard runs before the service call; denial is this
		// endpoint's existing 403, identical for foreign and non-existent
		// candidate IDs (no existence oracle). Self/admin paths unchanged.
		if (!isOwn && !isAdmin) {
			const isHiringRole = ['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role);
			if (!isHiringRole || req.user?.company_id == null) {
				return res.status(403).json({ error: 'Access denied' });
			}
			const linkage = await pool.query(
				'SELECT 1 FROM job_applications WHERE candidate_id = $1 AND company_id = $2 LIMIT 1',
				[candidateId, req.user.company_id],
			);
			if (linkage.rows.length === 0) {
				return res.status(403).json({ error: 'Access denied' });
			}
			isCompanyUser = true;
		}

		const { limit, offset } = req.query;
		const result = await auditLogService.getCandidateDecisions(candidateId, {
			limit: limit ? parseInt(limit, 10) : 500,
			offset: offset ? parseInt(offset, 10) : 0,
			// #920 (Sumanth ruling): company-user callers receive only
			// their own company's events; self/admin stay unscoped.
			...(isCompanyUser ? { companyId: req.user.company_id } : {}),
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/audit-trail/candidate] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch candidate audit trail' });
	}
});

/**
 * GET /api/compliance/audit-trail/verify
 * Verify hash chain integrity. Admin or company owner only.
 */
router.get('/audit-trail/verify', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const result = await auditLogService.verifyChain(companyId);

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/audit-trail/verify] Failed:', error.message);
		res.status(500).json({ error: 'Failed to verify audit chain' });
	}
});

/**
 * GET /api/compliance/audit-trail/export
 * Export regulator-ready report. Owner (employer) or admin only.
 */
router.get('/audit-trail/export', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { startDate, endDate, format } = req.query;

		if (!startDate || !endDate) {
			return res.status(400).json({ error: 'startDate and endDate are required' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const result = await auditLogService.exportForRegulator(
			companyId,
			startDate,
			endDate,
			format || 'json',
		);

		if (format === 'csv') {
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename=compliance-audit-${startDate}-to-${endDate}.csv`,
			);
			res.send(result);
		} else {
			res.json({ success: true, report: result });
		}
	} catch (error) {
		console.error('[compliance/audit-trail/export] Failed:', error.message);
		res.status(500).json({ error: 'Failed to export audit trail' });
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// EU AI ACT COMPLIANCE — Issue #142
// ═══════════════════════════════════════════════════════════════════════════════

const EuComplianceService = require('../services/euComplianceService');

// ── Risk Classification ──────────────────────────────────────────────────────

/**
 * POST /api/compliance/risk-classify
 * Classify or update a job posting's AI risk level under EU AI Act.
 */
router.post('/risk-classify', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const { jobId, riskLevel, riskFactors, justification } = req.body;
		if (!jobId || !riskLevel) {
			return res.status(400).json({ error: 'jobId and riskLevel are required' });
		}
		if (!['minimal', 'limited', 'high', 'unacceptable'].includes(riskLevel)) {
			return res.status(400).json({ error: 'Invalid riskLevel' });
		}

		const record = await EuComplianceService.classifyJobRisk({
			jobId: parseInt(jobId, 10),
			riskLevel,
			riskFactors: riskFactors || [],
			justification,
			assessedBy: req.user.id,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: auditLogService.ENTITY_TYPES.JOB,
			entityId: parseInt(jobId, 10),
			actorId: req.user.id,
			actorRole: req.user.role,
			jobId: parseInt(jobId, 10),
			companyId: req.user.company_id,
			payload: { risk_level: riskLevel, justification },
		});

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/risk-classify] Failed:', error.message);
		res.status(500).json({ error: 'Failed to classify job risk' });
	}
});

/**
 * GET /api/compliance/risk-classify/:jobId
 */
router.get('/risk-classify/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const record = await EuComplianceService.getJobRiskClassification(jobId);
		if (!record) {
			return res.status(404).json({ error: 'Risk classification not found' });
		}

		// Access control
		const isAdmin = req.user?.role === 'admin';
		const isCompanyUser =
			['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role) &&
			req.user?.company_id === record.company_id;
		if (!isAdmin && !isCompanyUser) {
			return res.status(403).json({ error: 'Access denied' });
		}

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/risk-classify/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch risk classification' });
	}
});

/**
 * GET /api/compliance/risk-classify
 * List risk classifications for a company.
 */
router.get('/risk-classify', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const { riskLevel, limit, offset } = req.query;
		const result = await EuComplianceService.listJobRiskClassifications({
			companyId,
			riskLevel,
			limit: limit ? parseInt(limit, 10) : 50,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/risk-classify] List failed:', error.message);
		res.status(500).json({ error: 'Failed to list risk classifications' });
	}
});

// ── Bias Detection Per Posting ───────────────────────────────────────────────

/**
 * POST /api/compliance/bias/analyze/:jobId
 * Calculate and store bias metrics for a specific job posting.
 */
router.post('/bias/analyze/:jobId', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		// #1112 (security-reviewer HIGH residual): this POST returns the
		// same bias metrics the gated GETs read back, so the ownership
		// gate applies here too — otherwise it bypasses them entirely.
		const access = await canAccessJobBias(req, jobId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const { selectionStatuses } = req.body;
		const metrics = await EuComplianceService.calculateBiasMetricsForJob(jobId, {
			selectionStatuses: Array.isArray(selectionStatuses) ? selectionStatuses : undefined,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.AI_DECISION,
			entityType: auditLogService.ENTITY_TYPES.JOB,
			entityId: jobId,
			actorId: req.user.id,
			actorRole: req.user.role,
			jobId,
			companyId: req.user.company_id,
			payload: { bias_metrics_count: metrics.length, flagged: metrics.some((m) => m.flagged) },
		});

		res.json({ success: true, metrics });
	} catch (error) {
		console.error('[compliance/bias/analyze/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to calculate bias metrics' });
	}
});

/**
 * GET /api/compliance/bias/metrics/:jobId
 * Retrieve stored bias metrics for a job posting.
 */
router.get('/bias/metrics/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const access = await canAccessJobBias(req, jobId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const metrics = await EuComplianceService.getBiasMetricsForJob(jobId);
		res.json({ success: true, metrics });
	} catch (error) {
		console.error('[compliance/bias/metrics/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch bias metrics' });
	}
});

/**
 * GET /api/compliance/bias/flagged
 * List all job postings flagged for adverse impact.
 */
router.get('/bias/flagged', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const { limit, offset } = req.query;
		const result = await EuComplianceService.listFlaggedBiasMetrics({
			companyId,
			limit: limit ? parseInt(limit, 10) : 50,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/bias/flagged] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch flagged bias metrics' });
	}
});

/**
 * GET /api/compliance/bias/four-fifths/:jobId
 * Calculate four-fifths rule on-demand for a job posting.
 */
router.get('/bias/four-fifths/:jobId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		const access = await canAccessJobBias(req, jobId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const { selectionStatuses } = req.query;
		const statuses = selectionStatuses
			? selectionStatuses.split(',').map((s) => s.trim())
			: ['interview', 'hired', 'offer_extended'];

		const result = await BiasDetection.calculateFourFifthsRule(jobId, statuses);
		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/bias/four-fifths/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to calculate four-fifths rule' });
	}
});

// ── Explainability ───────────────────────────────────────────────────────────

/**
 * GET /api/compliance/explain/job/:jobId/candidate/:candidateId
 * Return weighted factor breakdowns for a candidate-job pair.
 */
router.get('/explain/job/:jobId/candidate/:candidateId', authMiddleware, async (req, res) => {
	try {
		const jobId = parseInt(req.params.jobId, 10);
		const candidateId = parseInt(req.params.candidateId, 10);
		if (!Number.isInteger(jobId) || !Number.isInteger(candidateId)) {
			return res.status(400).json({ error: 'Valid job ID and candidate ID required' });
		}

		// Candidate can view their own explanation
		const isOwn = req.user?.role === 'candidate' && req.user?.id === candidateId;
		const isAdmin = req.user?.role === 'admin';
		const isHiringRole = ['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role);
		if (!isOwn && !isAdmin && !isHiringRole) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// S-097 (#821): a hiring role may only explain decisions for jobs
		// their own company owns. The resource here is the job, so the
		// job-company ownership check is the right shape (contrast the
		// user-record guard on /explain/omniscore above). Foreign and
		// non-existent jobs are the same 404, and the check runs before
		// the service call. Candidate-self and admin are not job-scoped.
		if (!isOwn && !isAdmin) {
			const jobResult = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
			const job = jobResult.rows[0];
			if (
				!job ||
				req.user?.company_id == null ||
				Number(req.user.company_id) !== Number(job.company_id)
			) {
				return res.status(404).json({ error: 'Job not found' });
			}

			// Fix round (security F-1, Lead ruling option (a)): owning a job
			// alone does not link the candidate to the caller's company, and
			// the service returns the candidate's global score data — so a
			// hiring role additionally needs a job_applications
			// candidate×company linkage, mirroring the read-only SELECT 1
			// linkage on /explain/omniscore above. Denial is this endpoint's
			// existing non-subject-candidate 403, before the service call.
			// Candidate-self and admin paths above are unchanged.
			const linkage = await pool.query(
				'SELECT 1 FROM job_applications WHERE candidate_id = $1 AND company_id = $2 LIMIT 1',
				[candidateId, req.user.company_id],
			);
			if (linkage.rows.length === 0) {
				return res.status(403).json({ error: 'Access denied' });
			}
		}

		const explanation = await EuComplianceService.explainDecisionForJob({
			userId: candidateId,
			jobId,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.AI_DECISION,
			entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
			entityId: candidateId,
			actorId: req.user?.id,
			actorRole: req.user?.role,
			jobId,
			companyId: req.user?.company_id,
			payload: { explanation_viewed: true },
		});

		res.json({ success: true, explanation });
	} catch (error) {
		console.error('[compliance/explain/job/:jobId/candidate/:candidateId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to generate explanation' });
	}
});

// ── Human Oversight ──────────────────────────────────────────────────────────

/**
 * POST /api/compliance/overrides
 * Record a human override of an AI recommendation.
 */
router.post('/overrides', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const {
			applicationId,
			userId,
			jobId,
			originalScore,
			newScore,
			originalStatus,
			newStatus,
			reason,
		} = req.body;

		if (!applicationId || !userId || !jobId || !reason) {
			return res
				.status(400)
				.json({ error: 'applicationId, userId, jobId, and reason are required' });
		}

		// Strict Number() coercion, mirroring canAccessUserRecord in this
		// file (security-reviewer LOW-1 on #1327): parseInt would silently
		// alias "100abc" / 100.9 / [100] to 100; Number() rejects those,
		// while a legitimate string "100" stays accepted (the #1111 LOW-3
		// coercion precedent).
		const applicationIdInt = Number(applicationId);
		const userIdInt = Number(userId);
		const jobIdInt = Number(jobId);
		if (
			!Number.isInteger(applicationIdInt) ||
			applicationIdInt <= 0 ||
			!Number.isInteger(userIdInt) ||
			userIdInt <= 0 ||
			!Number.isInteger(jobIdInt) ||
			jobIdInt <= 0
		) {
			return res
				.status(400)
				.json({ error: 'applicationId, userId, and jobId must be valid IDs' });
		}

		// #1327 (security-reviewer HIGH-R2 on #1113): write-side gate —
		// this handler previously trusted body IDs, so a foreign-company
		// hiring user could CREATE an override against another company's
		// candidate. Company gate first, reusing the exact #1113
		// GET /overrides/job shape: non-admin callers must be a hiring
		// role of the company that owns the job (fail-closed 403 on a
		// missing job or a null company_id on either side); admin is
		// not job-scoped, as in the sibling read gates.
		const isAdmin = req.user?.role === 'admin';
		const jobResult = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobIdInt]);
		const job = jobResult.rows[0];
		if (
			!isAdmin &&
			(!job ||
				job.company_id == null ||
				req.user?.company_id == null ||
				Number(req.user.company_id) !== Number(job.company_id))
		) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Consistency: the body IDs must describe one real application —
		// application.job_id === jobId, application.candidate_id ===
		// userId, and the application's company must agree with the
		// job's company where both are recorded. Missing and mismatched
		// applications are the same uniform 400 (no existence oracle),
		// and the check runs before the service call, so a denied or
		// inconsistent body never reaches the INSERT. This applies to
		// admin too: consistency is a data-integrity check, not a
		// company-scoping one.
		const appResult = await pool.query(
			'SELECT candidate_id, company_id, job_id FROM job_applications WHERE id = $1',
			[applicationIdInt],
		);
		const application = appResult.rows[0];
		if (
			!job ||
			!application ||
			Number(application.job_id) !== jobIdInt ||
			Number(application.candidate_id) !== userIdInt ||
			(application.company_id != null &&
				job?.company_id != null &&
				Number(application.company_id) !== Number(job.company_id))
		) {
			return res
				.status(400)
				.json({ error: 'applicationId, userId, and jobId are inconsistent' });
		}

		const override = await EuComplianceService.recordHumanOverride({
			applicationId: applicationIdInt,
			userId: userIdInt,
			jobId: jobIdInt,
			originalScore: originalScore !== undefined ? parseFloat(originalScore) : null,
			newScore: newScore !== undefined ? parseFloat(newScore) : null,
			originalStatus: originalStatus || null,
			newStatus: newStatus || null,
			reason,
			overriddenBy: req.user.id,
		});

		res.status(201).json({ success: true, override });
	} catch (error) {
		console.error('[compliance/overrides] Failed:', error.message);
		res.status(500).json({ error: 'Failed to record override' });
	}
});

/**
 * GET /api/compliance/overrides/job/:jobId
 */
router.get('/overrides/job/:jobId', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const jobId = parseInt(req.params.jobId, 10);
		if (!Number.isInteger(jobId)) {
			return res.status(400).json({ error: 'Valid job ID required' });
		}

		// #1113 (security-reviewer HIGH-R1): same company gate as
		// /overrides/:id — this list returns the same records in bulk, so
		// a foreign-company hiring user is denied before the service call.
		if (req.user?.role !== 'admin') {
			const jobResult = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
			const job = jobResult.rows[0];
			if (
				!job ||
				job.company_id == null ||
				req.user?.company_id == null ||
				Number(req.user.company_id) !== Number(job.company_id)
			) {
				return res.status(403).json({ error: 'Access denied' });
			}
		}

		const { limit, offset } = req.query;
		const result = await EuComplianceService.getOverridesForJob(jobId, {
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/overrides/job/:jobId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch overrides' });
	}
});

/**
 * GET /api/compliance/overrides/:id
 */
router.get('/overrides/:id', authMiddleware, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isInteger(id)) {
			return res.status(400).json({ error: 'Valid override ID required' });
		}

		const override = await EuComplianceService.getOverrideById(id);
		if (!override) {
			return res.status(404).json({ error: 'Override not found' });
		}

		// #1113: human_overrides has no company_id — its company linkage
		// runs through job_id → jobs.company_id. Load-then-check is the
		// /risk-classify/:jobId shape in this router: admin, or a hiring
		// role whose company owns the override's job (fail-closed on a
		// null company_id on either side, or a missing job). The
		// candidate the override is about is not an audience — the reason
		// is an internal hiring record with no shaped variant. An
		// actor-self (overridden_by) allowance was dropped at security
		// review (MEDIUM-1): its only reach beyond the owning-company
		// path was cross-company / changed-role access.
		const isAdmin = req.user?.role === 'admin';
		let isOwningHiring = false;
		if (!isAdmin) {
			if (
				['employer', 'recruiter', 'hiring_manager'].includes(req.user?.role) &&
				req.user?.company_id != null
			) {
				const jobResult = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [
					override.job_id,
				]);
				const job = jobResult.rows[0];
				isOwningHiring =
					!!job &&
					job.company_id != null &&
					Number(req.user.company_id) === Number(job.company_id);
			}
			if (!isOwningHiring) {
				return res.status(403).json({ error: 'Access denied' });
			}
		}

		res.json({ success: true, override });
	} catch (error) {
		console.error('[compliance/overrides/:id] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch override' });
	}
});

// ── Data Retention ───────────────────────────────────────────────────────────

/**
 * POST /api/compliance/retention/policies
 * Set or update a retention policy (supports per-company / per-job scope).
 */
router.post('/retention/policies', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { dataType, retentionDays, autoDelete, policyScope, scopeId, description } = req.body;
		if (!dataType || retentionDays === undefined) {
			return res.status(400).json({ error: 'dataType and retentionDays are required' });
		}

		const policy = await EuComplianceService.setRetentionPolicy({
			dataType,
			retentionDays: parseInt(retentionDays, 10),
			autoDelete: !!autoDelete,
			companyId: req.user.role === 'admin' ? req.body.companyId : req.user.company_id,
			policyScope: policyScope || 'global',
			scopeId: scopeId ? parseInt(scopeId, 10) : null,
			description,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: 'retention_policy',
			entityId: policy.id,
			actorId: req.user.id,
			actorRole: req.user.role,
			companyId: req.user.company_id,
			payload: { data_type: dataType, retention_days: retentionDays, auto_delete: autoDelete },
		});

		res.json({ success: true, policy });
	} catch (error) {
		console.error('[compliance/retention/policies] Failed:', error.message);
		res.status(500).json({ error: 'Failed to set retention policy' });
	}
});

/**
 * POST /api/compliance/retention/purge
 * Execute automated data purge based on retention policies.
 *
 * S-077 (#760): live deletion (dryRun: false) is gated behind
 * RETENTION_PURGE_LIVE — same gate as the scheduled cron. Per Sumanth's
 * standing rule, live storage deletion needs his explicit approval.
 * Dry-run is always available for preview.
 */
router.post('/retention/purge', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { dryRun = true, companyId } = req.body;
		const isLive = dryRun === false;

		if (isLive && process.env.RETENTION_PURGE_LIVE !== 'true') {
			return res.status(403).json({
				error: 'Live purge is disabled. Run with dryRun: true for preview, or set RETENTION_PURGE_LIVE=true (requires Sumanth approval).',
			});
		}

		// Staging guard: staging shares the production database. Live purge
		// is only allowed in production, even with the flag set.
		if (isLive && process.env.NODE_ENV !== 'production') {
			return res.status(403).json({
				error: 'Live purge is only allowed in production (staging shares the production database).',
			});
		}

		const targetCompanyId = req.user.role === 'admin' ? companyId : req.user.company_id;
		const summary = await EuComplianceService.executePurge({
			dryRun: !isLive,
			companyId: targetCompanyId,
		});

		await auditLogService.logEvent({
			eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
			entityType: 'retention_purge',
			entityId: 0,
			actorId: req.user.id,
			actorRole: req.user.role,
			companyId: targetCompanyId,
			payload: { dry_run: dryRun !== false, affected_policies: summary.length },
		});

		res.json({ success: true, dry_run: dryRun !== false, summary });
	} catch (error) {
		console.error('[compliance/retention/purge] Failed:', error.message);
		res.status(500).json({ error: 'Failed to execute purge' });
	}
});

// ── Candidate Consent Management ─────────────────────────────────────────────

/**
 * POST /api/compliance/consent
 * Record or update candidate consent with history tracking.
 */
router.post('/consent', authMiddleware, async (req, res) => {
	try {
		const { userId, consentType, consented, metadata } = req.body;
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		if (!consentType || consented === undefined) {
			return res.status(400).json({ error: 'consentType and consented are required' });
		}

		const record = await EuComplianceService.recordConsent({
			userId: access.targetId,
			consentType,
			consented: !!consented,
			ipAddress: req.ip,
			userAgent: req.headers['user-agent'],
			metadata,
			recordedBy: req.user?.id,
		});

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/consent] Failed:', error.message);
		res.status(500).json({ error: 'Failed to record consent' });
	}
});

/**
 * POST /api/compliance/consent/revoke
 * Revoke consent with history tracking.
 */
router.post('/consent/revoke', authMiddleware, async (req, res) => {
	try {
		const { consentId, reason } = req.body;
		if (!consentId || !reason) {
			return res.status(400).json({ error: 'consentId and reason are required' });
		}

		// Verify ownership
		const existing = await pool.query('SELECT user_id FROM consent_records WHERE id = $1', [
			consentId,
		]);
		if (existing.rows.length === 0) {
			return res.status(404).json({ error: 'Consent record not found' });
		}
		const userId = existing.rows[0].user_id;
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const record = await EuComplianceService.revokeConsent({
			consentId: parseInt(consentId, 10),
			reason,
			revokedBy: req.user?.id,
			ipAddress: req.ip,
			userAgent: req.headers['user-agent'],
		});

		res.json({ success: true, record });
	} catch (error) {
		console.error('[compliance/consent/revoke] Failed:', error.message);
		res.status(500).json({ error: error.message || 'Failed to revoke consent' });
	}
});

/**
 * GET /api/compliance/consent/history/:userId
 * Get full consent change history for a user.
 */
router.get('/consent/history/:userId', authMiddleware, async (req, res) => {
	try {
		const { userId } = req.params;
		const access = canAccessUserRecord(req, userId);
		if (!access.ok) {
			return res.status(access.status).json({ error: access.error });
		}

		const { consentType, limit, offset } = req.query;
		const result = await EuComplianceService.getConsentHistory(access.targetId, {
			consentType,
			limit: limit ? parseInt(limit, 10) : 100,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/consent/history/:userId] Failed:', error.message);
		res.status(500).json({ error: 'Failed to fetch consent history' });
	}
});

// ── Transparency Reports ─────────────────────────────────────────────────────

/**
 * POST /api/compliance/transparency-reports
 * Generate a regulator-ready transparency report.
 */
router.post('/transparency-reports', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const { periodStart, periodEnd, reportType, format } = req.body;
		if (!periodStart || !periodEnd) {
			return res.status(400).json({ error: 'periodStart and periodEnd are required' });
		}

		const companyId = req.user.role === 'admin' ? req.body.companyId : req.user.company_id;
		if (!companyId) {
			return res.status(400).json({ error: 'Company ID is required' });
		}

		const result = await EuComplianceService.generateTransparencyReport({
			companyId: parseInt(companyId, 10),
			periodStart,
			periodEnd,
			reportType: reportType || 'regulator',
			generatedBy: req.user.id,
			format: format || 'json',
		});

		res.status(201).json({ success: true, report: result.report, data: result.data });
	} catch (error) {
		console.error('[compliance/transparency-reports] Failed:', error.message);
		res.status(500).json({ error: 'Failed to generate transparency report' });
	}
});

/**
 * GET /api/compliance/transparency-reports
 * List generated transparency reports.
 */
router.get('/transparency-reports', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer', 'recruiter', 'hiring_manager'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Insufficient permissions' });
		}

		const companyId = req.user.role === 'admin' ? undefined : req.user.company_id;
		const { limit, offset } = req.query;
		const result = await EuComplianceService.getTransparencyReports({
			companyId,
			limit: limit ? parseInt(limit, 10) : 20,
			offset: offset ? parseInt(offset, 10) : 0,
		});

		res.json({ success: true, ...result });
	} catch (error) {
		console.error('[compliance/transparency-reports] List failed:', error.message);
		res.status(500).json({ error: 'Failed to list transparency reports' });
	}
});

/**
 * POST /api/compliance/transparency-reports/:id/finalize
 * Finalize a transparency report (immutable).
 */
router.post('/transparency-reports/:id/finalize', authMiddleware, async (req, res) => {
	try {
		if (!['admin', 'employer'].includes(req.user?.role)) {
			return res.status(403).json({ error: 'Admin or owner access required' });
		}

		const id = parseInt(req.params.id, 10);
		if (!Number.isInteger(id)) {
			return res.status(400).json({ error: 'Valid report ID required' });
		}

		const report = await EuComplianceService.finalizeTransparencyReport(id);
		if (!report) {
			return res.status(404).json({ error: 'Report not found' });
		}

		res.json({ success: true, report });
	} catch (error) {
		console.error('[compliance/transparency-reports/:id/finalize] Failed:', error.message);
		res.status(500).json({ error: 'Failed to finalize report' });
	}
});

module.exports = router;
