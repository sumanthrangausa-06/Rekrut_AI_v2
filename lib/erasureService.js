/**
 * erasureService — shared personal-data erasure routine for DSAR/account deletion.
 *
 * S-067 (#720): crypto-shredding must happen on EVERY erasure path, not just
 * self-serve deletion. This module is the single choke point:
 *   - DELETE /delete-account (routes/auth.js) calls it inside the deletion tx
 *   - Compliance fulfillment of POST /api/compliance/gdpr/delete data_requests
 *     MUST call it too (follow-up issue — manual fulfillment currently bypasses
 *     code entirely; see #720 HIGH-1)
 *
 * S-075 (#752): rescoped from biometric-only to personal-data. Privacy-engineer
 * verdict (Rex's specialist review): candidate_embeddings is NOT biometric
 * (1536-dim text embedding of profile/resume text — zero BIPA exposure) but IS
 * personal data under GDPR Art. 4(1), and its plaintext survival past account
 * deletion is an active Art. 17 violation. Fix: hard-delete the row on erasure.
 * The embeddings row is a leaf table (user_id UNIQUE, no FKs pointing at it),
 * so hard-delete is safe; embeddings are independent of DEK existence.
 *
 * S-075 privacy review (CRITICAL finding): candidate_search_index holds a
 * SECOND copy of the 1536-dim embedding plus plaintext PII (name, bio,
 * job_title, location, skills, avatar_url) — same Art. 17 violation in the
 * same table family. Also a leaf table (user_id PK, no referencing FKs):
 * hard-deleted alongside. Note the users-table sync trigger
 * (trg_sync_csi_users, AFTER UPDATE OF name/avatar_url) fires during the
 * account-deletion UPDATE — but our DELETE runs after it in the same
 * transaction, so ordering is safe.
 *
 * S-076 (#759): resume/profile family erasure (GDPR Art. 17 HIGH priority).
 * Hard-deletes cv_uploads, parsed_resumes, candidate_profiles,
 * identity_verifications, cv_analyses, cv_reviews. The CV file objects are
 * PLAINTEXT in R2/B2 (lib/file-storage.js raw PutObjectCommand, no DEK) —
 * crypto-shredding does NOT cover them, so Phase 1 collects their file_urls
 * (RETURNING) and Phase 2 (deleteErasedStorageFiles, post-commit) deletes the
 * objects. R2 NEVER in-tx (distributed-transaction failure mode).
 *
 * #780: job_applications erasure completeness. The application row is the
 * joint candidate/company record (Art. 17(3)(e) skeleton, conversations
 * precedent) — it is RETAINED, never DELETEd, and the candidate-linked
 * content is redacted in place (cover_letter, screening_answers,
 * resume_url, the derived scores, and recruiter_notes — REDACT per
 * Sumanth's gate ruling on STOP 1). Because account deletion tombstones
 * the users row, the migration-002 CASCADE never fires, so without this
 * block the content survived erasure intact (S-088 dry-run verified).
 * Legal hold is consulted PER ROW (STOP 1 §3): the entry gate's
 * company attribution reaches candidates only via interview_sessions,
 * so a candidate who merely applied to a held company would otherwise
 * slip past it. Held rows are excluded from the redaction and counted;
 * a per-row hold-lookup error reads as held (fail-closed skip).
 *
 * GAP-A (#1120, E-3/E-4): interview content + recording objects.
 * (a) interview_sessions content strip: whole-column resets
 * (conversation/frame_analysis/invite_token) + config ALLOWLIST reset —
 * config writers merge arbitrary keys (flattened resume text, session
 * reports), so a deny-list is the mechanism that already failed; only the
 * biometric_collection consent FACT (Art. 7(1)) is rebuilt into config.
 * (b) Transcript DELETE repair: migration 130's XOR CHECK means
 * session-linked recordings have interview_event_id IS NULL and were
 * unreachable via the event join — the DELETE now carries a session
 * branch alongside it (code fix, no migration).
 * (c) interview_recordings objects: enumerated via BOTH attributions,
 * decrypted (shared-key pointer), ledgered in-tx with
 * source_family='livekit_recording' for the Phase-2 drain; rows are
 * keep-redacted (status='deleted', storage_path=NULL) — hard delete is
 * FORBIDDEN here: recording_consent.recording_id is ON DELETE CASCADE
 * (mig 128) and the consent fact must survive. Candidate-keyed
 * recording_objects type='frame' rows are ledgered the same way
 * (observer-audio /api/files encoding) and stamped deleted_at.
 * Legal hold is consulted PER ROW at every new site (isHeld, fail-closed);
 * held rows are preserved, counted, and disclosed in the result.
 * #1123 (GAP-D, E-12 — highest sensitivity): BGV & onboarding family.
 * erasePersonalData previously had ZERO references to these tables and
 * the migrations' ON DELETE CASCADEs never fire (account deletion
 * tombstones users), so SSN/bank/I-9-class platform copies, BGV
 * payloads, referee (third-party) PII, onboarding documents, offers and
 * signature records all survived erasure. Dispositions as ruled by
 * Sumanth (2026-10-14; STOP 1 on #1123): outcome-fact keeps NOTHING;
 * hard-delete candidate_onboarding_data, the BGV family
 * (discrepancies explicitly by parent ids FIRST, never
 * cascade-assumed), reference_checks, the operational onboarding
 * tables, verified_credentials, candidate-as-party signature_requests
 * and candidate-scoped signature_documents; offers redact-to-skeleton
 * (K-3 precedent); the signature family splits (see the GAP-D block
 * below) and signature_audit_events are NEVER rewritten — residual
 * actor_email on surviving company documents is a named residual,
 * counted in the result's gapD.signatureAuditResidual (a LOWER
 * BOUND: actor-linked events on surviving documents only — events
 * with actor_id NULL attributable via parties are not counted).
 * The offers skeleton's salary = NULL requires migration 259
 * (offers.salary was NOT NULL in migration 014; PR-gate fix P-1).
 * Storage objects
 * (onboarding_documents.document_url, offers.signature_url,
 * signature_documents.file_url) go through the same in-tx
 * pending_storage_deletions ledger → Phase 2, but only /api/files/
 * URLs are ledger-addressable: client-supplied URLs of any other shape
 * are named in gapD.nonPatternStorageUrls, never silently skipped.
 * Legal hold: per-row consult before every family's delete/redact/
 * ledger, fail-closed, passing the row's OWN company_id where one
 * exists — an onboarding-only candidate may have no interview_sessions
 * at all, so the shipped session attribution cannot reach them.
 * verified_credentials is deleted EARLY (before the S-076
 * verification_documents DELETE) because its document_id FK has no
 * ON DELETE action (migration 009) and would otherwise FK-block it.
 * Out of scope (Q7, confirmed): employees, paychecks, payroll_configs,
 * tax_documents, post_hire_feedback, offer_templates, company_policies.
 *
 * #1122 (GAP-C, E-13): scheduling & human-interview family.
 * erasePersonalData previously had ZERO DELETE/UPDATE references to
 * these tables and the migrations' ON DELETE CASCADEs never fire
 * (account deletion tombstones users), so scheduled interviews,
 * panels/scorecards, mock sessions, legacy interviews and scheduling
 * events all survived erasure. Dispositions as ruled by the Lex panel
 * (#1122, 2026-10-14): Q1 whole DELETE of recruiter-authored
 * feedback/panel content (no K-9 skeleton); Q2(b) refined —
 * interview_events are whole-DELETED when no interview_recordings
 * child survives, and REDACTED to the K-12 skeleton (five assignments:
 * notes/meeting_link/livekit_room_url/calendar_event_ids → NULL,
 * panel_member_ids → '{}'; all four NULL targets verified nullable in
 * migration 126) only where a recording child survives, because
 * mig 128's CASCADE + mig 130's XOR check forbid deleting the parent
 * of a kept recording/consent row. AMENDED (#1972, K-12 panel-consent
 * clause ruled on #1964): the whole-DELETE branch is further
 * partitioned — an event carrying event_labelling_consent rows but
 * no recording is likewise REDACTED (mig 299's ON DELETE RESTRICT
 * would otherwise abort the whole erasure), via a separate UPDATE
 * counted in gapC.interviewEventsKeptForPanelConsent, never as
 * deleted or as recording-redacted; Q3 interview_reminders and
 * event-linked interview_rooms (session-linked rooms are spine
 * territory, untouched) confirmed in scope. FIX ROUND (Lex ruling,
 * #1122 comment 6169043564, Option A): the interview_rooms DELETE is
 * partitioned by NOT EXISTS on interview_recordings.room_id (mig 128
 * CASCADE — a referenced room survives whole under amended K-12,
 * counted in gapC.interviewRoomsKeptForRecordings, never as deleted;
 * the recording row is never touched). Children are deleted
 * explicitly, counted, before their parents — never cascade-assumed —
 * and inherit their parent's hold partition. Legal hold: per-row
 * findActiveHold({userId, companyId}) via the GAP-D machinery,
 * fail-closed, passing the row's own company_id where one exists and
 * the derived company otherwise (interview_events via
 * job_application_id → job_applications.company_id, legacy interviews
 * via job_id → jobs.company_id; NULL derivation ⇒ {userId} only).
 * Storage: only legacy interviews.video_urls — /api/files/ entries are
 * ledgered in-tx with source_family='legacy_interview_video';
 * non-pattern entries are named in gapC.nonPatternStorageUrls, never
 * silently skipped.
 *
 * #1124 (GAP-E, E-11): profile-adjacent & career leftovers. Whole-row
 * DELETEs for the 19 tables erasure never touched, incl. special-category
 * candidate_demographics (handled FIRST, standalone — DELETE + rowCount
 * only; its values are never selected, never a join key): third-party
 * set (recruiter_feedback, shared_notes, skill_endorsements keyed
 * STRICTLY on candidate_id — never recruiter_id, candidate_invites incl.
 * the recruiter message), the candidate's own set
 * (portfolio_projects, career_coach_sessions + the mig-131 children by
 * their own user_id, career_recommendations, skill_gap_analyses,
 * learning_paths, company_research_briefs, salary_practice_sessions,
 * profile_tool_progress, candidate_job_actions, saved_jobs, job_alerts),
 * application_optimizations (originals AND AI-rewritten outputs die with
 * the row — no skeleton), and comments/comment_mentions via ONE recursive
 * scan (application branch via the candidate's application ids; reply
 * children via parent_id transitively) — partitioned per row by its
 * precomputed company, then comment_mentions DELETE by id set BEFORE
 * comments DELETE by id set. A mention naming the candidate on ANOTHER
 * comment is deleted row-only (host untouched) and inherits its parent
 * comment's partition exactly. NAMED RESIDUAL (#1124 steering, Scout
 * build-entry re-verification): comments with entity_type='candidate'
 * are NOT deleted — what entity_id denotes for that branch is
 * UNVERIFIABLE from the repo (migration 128 carries no FK/comment; the
 * sole writer is a branch-blind pass-through; no frontend/test/seed
 * ever creates one), and the users.id / candidate_profiles.id spaces
 * overlap, so a guessed join could erase another candidate's comments.
 * The subset is blocked pending a live-DB join check or a recorded
 * ruling adopting users.id as a decided interpretation. Legal hold: per-row consults fail-closed through a
 * GAP-E-LOCAL three-way partition (unheld / genuinely held /
 * lookup-failed — failures get their own counter and rows preserved
 * either way; heldTables names genuine-hold survivals only). Placement:
 * after the GAP-C block (mock-queue ordering is load-bearing).
 * Storage: portfolio_projects.image_url is a free-form client-supplied
 * URL (not storage-generated) — any /api/files/-shaped value on an
 * unheld row is ledgered in-tx with source_family='portfolio_project_image'.
 *
 * #1125 (GAP-F, E-15): communications & notifications family. Whole-row
 * DELETEs for the eight tables erasure never touched: communications
 * (by candidate_id, draft AND sent — Lex ruling at STOP 1: DELETE under
 * E-6/E-13, K-7 NOT extended; NEVER by recruiter_id) with the parent_id
 * ancestor closure (a retained row's ancestors are FK-blocked and
 * survive as held-blocked), sequence_enrollments (by candidate_id),
 * email_queue (by recipient = the candidate's PRE-TOMBSTONE email),
 * notification_queue / notification_logs (user_id OR email — bodies
 * ride in these rows), user_notifications, notification_preferences,
 * and notification_audio_cache (a derived copy of a notification body:
 * deleted explicitly by the UNHELD parent log ids BEFORE the logs
 * delete, cascade never assumed; NULL-log-id rows are unattributable —
 * NOT deleted, NOT counted, NOT claimed, residual R-F1). Per-row legal
 * hold consults fail-closed through a GAP-F-local three-way partition;
 * email-only rows (email_queue; NULL-user_id queue/log rows) take the
 * H1 degraded rule: candidate-level consult PLUS preservation whenever
 * anyHoldActive() is true. The send-time half of this story lives in
 * lib/email-queue.js processBatch and lib/email-service.js
 * processQueue (STOP 1 §5 guard).
 *
 * #1126 (GAP-G, E-16): account residuals & tokens. The tombstone
 * previously lived ONLY in routes/auth.js (self-serve); the admin
 * DSAR path applied none of it. GAP-G lands every write inside
 * erasePersonalData: whole-row DELETEs for calendar_connections,
 * oauth_exchange_codes (expired AND unexpired), refresh_tokens
 * (DELETE-at-erasure — named decision, STOP 1 §3), oauth_connections,
 * password_reset_tokens, user_settings, user_roles (subject's rows),
 * usage_limits, assessment_referrals (email = captured original OR
 * claimed_by_user_id OR created_by; company via job_assessment_id →
 * job_assessments → jobs.company_id), and api_keys (by created_by);
 * a severance UPDATE nulling user_roles.assigned_by on OTHER users'
 * rows (redaction, counted separately — those rows are NOT deleted);
 * and the users-row completion strip (linkedin_data / title /
 * github_username / company_name / suspended_at → NULL plus the
 * tombstone parity fields; company_id NULL for candidate subjects
 * only — employer-side company_id is a named residual counted in
 * gapG.companyIdResidual; K-6 billing fields untouched). The strip
 * runs AFTER all email-matched deletes and reuses the GAP-F captured
 * original email — never re-derived after stripping — and is
 * idempotent (an existing synthetic email is preserved). Per-row
 * legal-hold consults fail-closed through a GAP-G-local three-way
 * partition. §4.1: the gapG result carries counts only.
 *
 * #1127 (GAP-H, K-1): consent-fact redaction consistency.
 * erasePersonalData previously had ZERO references to consent_records
 * / consent_history and the migrations' ON DELETE CASCADEs never fire
 * (account deletion tombstones users), so the PII attached to the
 * consent FACT survived erasure while the sibling recording_consent
 * family redacted it (S-078). Dispositions as ruled at STOP 1 (Lex +
 * privacy engineer, #1127): REDACT in place, never DELETE — the fact
 * survives per K-1 and a consent_records DELETE would CASCADE
 * consent_history (mig 133). Field sets are PER TABLE (the filing's
 * symmetry was factually wrong): consent_records has NO user_agent
 * column (mig 013: ip_address + metadata JSONB; mig 133 adds
 * revoked_at / revoked_by / revocation_reason) — redact ip_address →
 * NULL, metadata → '{}'::jsonb, revocation_reason → NULL (the last
 * two ruled IN: caller-supplied / free-text PII, neither a named K-1
 * fact field); consent_history (mig 133) — ip_address / user_agent →
 * NULL. Every fact column is kept byte-identical (no NOW() churn).
 * NAMED RESIDUAL: the actor FKs revoked_by / changed_by are KEPT
 * (the actor's accountability data, not the subject's device
 * metadata; GAP-D actor_email precedent), named in
 * gapH.actorFkResidualColumns and counted in gapH.actorFkResidual.
 * Linkage (user_id / consent_record_id) stays by design — kept rows
 * remain LINKABLE personal data under K-1's clock (OPEN — counsel),
 * never anonymised. Legal hold: per-row findActiveHold({ userId })
 * consults at each new site (these tables carry no company_id; the
 * subject shape is the only derivation that exists), three-way
 * partition, fail-closed — NOT the recording_consent precedent's
 * entry-gate-only shape. Out of scope, untouched: consent_receipts
 * (hash/linkage-only, mig 244 family) and consent_texts (reference
 * data, no subject linkage). Write-time consent capture is NOT
 * changed (that is #1144 territory). §4.1: gapH carries counts only.
 *
 * #813 (S-094): C2 sweep — whole-row DELETEs for the five
 * application-keyed tables erasure never touched (screening_responses,
 * job_application_screenings, ai_screenings, outreach_attempts,
 * auto_apply_profiles), partitioned by the #780 per-application hold
 * set. D-1: ai_screening_audit_logs / ai_screening_human_reviews die by
 * explicit counted DELETE before the parent (never CASCADE).
 * D-2: auto_apply_profiles consent tombstone in the return metadata.
 * D-3: NULL-application rows get a per-row job-walk, fail-closed per row.
 * See the #813 block below for the full ruling text.
 *
 * #807 (S-090): threat_intel_checks — whole-row DELETE in the C2
 * position (immediately after the #813 block below), keyed by the
 * inherited #780 unheld application set; NO new hold consult is
 * introduced (the block inherits the contained set, so the #1167
 * lesson does not trigger). Held applications' rows survive whole
 * and are counted in threatIntelRowsHeld (one COUNT, only when the
 * held set is non-empty); the deleted count is
 * threatIntelChecksDeleted. Retention default (Lex consult, #807):
 * the whole row — payload tier and audit-metadata tier together —
 * follows the parent application's lifecycle; no separate period is
 * adopted and no purge exists. See the keep/erase table
 * (docs/sdlc/rekrut-ai-v2/00-relearn/data/erasure-keep-erase-table.md).
 *
 * #815 (S-095): application_ip_captures — whole-row DELETE in the
 * same position and shape as #807 (immediately after the #807 block),
 * keyed ONLY by the inherited #780 unheld application set; held
 * applications' rows survive whole and are counted in
 * applicationIpRowsHeld. NO candidate-keyed delete (it would erase
 * legally-held rows). The row additionally carries a 12-month
 * retention stamp (migration 261); erasure here is the
 * candidate-initiated branch and does not wait for that stamp.
 *
 * Semantics: destroy the candidate's DEK (renders all DEK-encrypted biometric
 * data unrecoverable) + hard-delete the candidate_embeddings row, audit the
 * destruction, skip cleanly when the user never had a DEK (DEKNotFound). Any
 * other error propagates → caller rolls back.
 */
const crypto = require('node:crypto');
const { destroyDEK } = require('./biometricCrypto');
const { deleteFile, deleteStorageObject, getProviders } = require('./file-storage');
const biometricAudit = require('./biometricAudit');
const { isHeld, findActiveHold, anyHoldActive, LegalHoldError, notHeldPredicate } = require('./legalHold');
const { sanitizeErasureResult } = require('./erasureResultSanitizer');
// #1137: storage-ledger ownership binding for the Phase-2 drain
// (lib/storageOwnership.js — surviving-reference proof, fail-closed).
const {
	storageUrlForms,
	hasSurvivingStorageReference,
	CATALOGUE_SOURCE_FAMILIES,
} = require('./storageOwnership');
// #1337: hash-chain helpers for the dead-letter drain's direct in-tx
// trail INSERT (auditLogService.logEvent itself uses the global pool
// and cannot ride the caller's erasure transaction — see the drain
// block in the #813 C2 sweep below).
const { computeHash: computeTrailHash, GENESIS_HASH } = require('../services/auditLogService');

/**
 * Erase a user's personal data as part of an erasure workflow.
 *
 * @param {number} userId — the erasing user (candidate_id == user.id)
 * @param {object} opts
 * @param {object} opts.client — a pg transaction client (pool.connect(),
 *   inside BEGIN…COMMIT); destruction + audit ride it. The global pool
 *   is NOT accepted (#1343): on the pool every statement autocommits and
 *   the fail-closed guarantees in this routine cannot roll back. The
 *   transaction state is verified at entry (#1396): a client that is
 *   not actually inside BEGIN…COMMIT is refused with the same typed
 *   ErasureTransactionRequiredError, before any data is touched.
 * @param {object} [opts.audit] — { userId, userRole, ipAddress, companyId } for
 *   the AC-3 audit entry (companyId = tenant attribution, S-065 C1)
 * @returns {Promise<{ shredded: boolean, embeddingsDeleted: boolean, searchIndexDeleted: boolean,
 *   cvUploadsDeleted: boolean, parsedResumesDeleted: boolean, candidateProfileDeleted: boolean,
 *   identityVerificationsDeleted: boolean, cvAnalysesDeleted: boolean, cvReviewsDeleted: boolean,
 *   verificationRequestsDeleted: boolean, verificationDocumentsDeleted: boolean,
 *   workExperienceDeleted: boolean, educationDeleted: boolean, candidateSkillsDeleted: boolean,
 *   linkedinProfileDeleted: boolean, careerDiagnosesDeleted: boolean,
 *   messagesDeleted: boolean, userMemoryDeleted: boolean, matchResultsDeleted: boolean,
 *   practiceSessionsDeleted: boolean, screeningSessionsDeleted: boolean,
 *   interviewTranscriptsDeleted: boolean, omniScoresDeleted: boolean, roleScoresDeleted: boolean,
 *   screeningAnswersDeleted: boolean, interviewEvaluationsDeleted: boolean,
 *   interviewCompositeScoresDeleted: boolean, scoreComponentsDeleted: boolean,
 *   scoreHistoryDeleted: boolean, jobRecommendationsDeleted: boolean,
 *   recordingConsentRedacted: boolean,
 *   jobApplicationsRedacted: boolean, jobApplicationRowsHeld: number,
 *   screeningResponsesDeleted: boolean, jobApplicationScreeningsDeleted: boolean,
 *   aiScreeningsDeleted: boolean, outreachAttemptsDeleted: boolean,
 *   autoApplyProfileDeleted: boolean,
 *   aiScreeningAuditLogsDeleted: number, aiScreeningHumanReviewsDeleted: number,
 *   complianceAuditMarkersDrained: number,
 *   applicationKeyedRowsHeld: number, applicationKeyedHeldDetails: object[],
 *   autoApplyConsentTombstone: object|null,
 *   threatIntelChecksDeleted: number, threatIntelRowsHeld: number,
 *   applicationIpCapturesDeleted: number, applicationIpRowsHeld: number,
 *   interviewSessionsStripped: boolean, sessionsStripped: number, sessionsHeld: number,
 *   transcriptsDeleted: number,
 *   diarizationJobsDeleted: number, diarizationRunsDeleted: number,
 *   crossRecordingMappingsNulled: number, crossRecordingAuditNulled: number,
 *   crossRecordingPanelPairsSwept: number, crossRecordingPanelJobsCancelled: number,
 *   crossRecordingProposedMappingsNulled: number,
 *   tombstonePanelPairsCleared: number,
 *   panelLabellingConsentDeleted: number, panelConsentSnapshotsRetained: number,
 *   speakerMappingsDeleted: number, speakerAuditDeleted: number,
 *   recordingsLedgered: number, recordingsRedacted: number, recordingsHeld: number,
 *   recordingsUndecryptable: number,
 *   recordingFramesLedgered: boolean, framesLedgered: number, framesHeld: number,
 *   gapAHeldSkips: number,
 *   storageKeys: string[] }>}
 *   gapB: object, gapD: object, gapH: object, storageKeys: string[] }>}
 *   shredded=false when no DEK existed; *Deleted false when no rows existed.
 *   storageKeys = deduped /api/files/... URLs for Phase 2 (deleteErasedStorageFiles,
 *   post-commit — R2 NEVER in-tx).
 */
async function erasePersonalData(userId, { client, audit, originalEmail } = {}) {
	// #1343 (follow-up of #1337 reviewer note N3): a transaction client is
	// REQUIRED — there is no pool fallback. The fail-closed guarantees in
	// this routine (the #1337 ComplianceAuditDrainError abort, the legal-
	// hold gate, the per-row hold partitions) only hold when a throw
	// rolls back the caller's BEGIN…COMMIT transaction. On the global
	// pool every statement autocommits, so a drain failure would leave a
	// partial erasure already committed instead of aborting atomically.
	// Refuse before touching any data. Both production callers already
	// pass a transactional client (routes/auth.js, routes/admin.js).
	// #1396 closes the gap this guard originally left open: presence/
	// interface alone does not prove the client is inside BEGIN…COMMIT
	// — that state is now verified by the probe immediately below.
	// The lib/db pool singleton itself is also rejected explicitly
	// (review HIGH, #1343): a Pool has .query, so shape alone would let
	// the autocommit void back in if a caller passed the pool as client.
	if (!client || typeof client.query !== 'function' || client === require('./db')) {
		const err = new Error(
			`erasePersonalData requires a transaction client (user ${userId}): ` +
				'callers must run it inside BEGIN…COMMIT so a failure rolls the whole erasure back',
		);
		err.name = 'ErasureTransactionRequiredError';
		err.code = 'ERASURE_TRANSACTION_REQUIRED';
		throw err;
	}
	// #1396 (follow-up of #1343 M2): presence/interface is not enough — a
	// real pg Client that never issued BEGIN still autocommits statement
	// by statement, so a mid-erasure fail-closed throw cannot roll back
	// earlier writes. Verify the client is actually inside a transaction
	// BEFORE the first data statement. Probe = SAVEPOINT: Postgres errors
	// 25P01 outside a transaction block and succeeds inside one (the same
	// semantics the #1167 containedConsult below already relies on).
	// pg_current_xact_id_if_assigned() is NOT a reliable probe here — a
	// transaction that has only just issued BEGIN may not have an XID
	// assigned yet, so it would false-refuse the production caller shape.
	// The probe writes nothing; on success the savepoint is released and
	// the caller's transaction is untouched. Only the SAVEPOINT
	// statement's outcome decides refusal: its 25P01 converts to the
	// typed error, any other SAVEPOINT error (e.g. 25P02, already-
	// aborted transaction) propagates — and a RELEASE failure after a
	// successful SAVEPOINT also propagates rather than being misread
	// as "no transaction" (review M1, #1396). Every non-success path is
	// fail-closed: the erasure never proceeds.
	try {
		await client.query('SAVEPOINT erasure_tx_guard_probe');
	} catch (probeErr) {
		if (probeErr && probeErr.code === '25P01') {
			const err = new Error(
				`erasePersonalData requires a transaction client (user ${userId}): ` +
					'the supplied client is not inside a BEGIN…COMMIT transaction, ' +
					'so a failure could not roll the whole erasure back',
			);
			err.name = 'ErasureTransactionRequiredError';
			err.code = 'ERASURE_TRANSACTION_REQUIRED';
			throw err;
		}
		throw probeErr;
	}
	await client.query('RELEASE SAVEPOINT erasure_tx_guard_probe');
	// #799 (G-1) legal-hold gate — the FIRST data statement, before the DEK is
	// touched: crypto-shredding is deletion, and a held subject's keys
	// must NOT be destroyed. The check is fail-closed (a lookup error
	// reads as held), so any doubt aborts the erasure with a typed
	// LegalHoldError. Callers surface it (the DSAR route maps it to 409,
	// GDPR Art. 17(3)(e)) — never a silent partial erase.
	// PR-gate fix round (#915): findActiveHold (not the boolean isHeld)
	// so the error carries the hold id — the DSAR/self-serve conflict
	// record in compliance_audit_trail needs it (Lex F-1). Company
	// attribution for candidates comes via their interview_sessions
	// (privacy F-1): a company-only hold blocks this erasure too.
	const queryable = client;
	// #1167 contained hold consult — one shared helper mirroring the
	// GAP-H dance (gapHPartition, #1127): both production callers run
	// erasePersonalData inside BEGIN…COMMIT on one client, so a genuine
	// PG error at a per-row consult ABORTS the caller's transaction —
	// every catch-and-continue partition then dies 25P02 on its next
	// statement and the caller rolls back wholesale (no counts, no
	// disclosure). Each consult therefore runs inside a SAVEPOINT on
	// the same queryable so the transaction can be de-poisoned and the
	// partition's own catch can count the row and CONTINUE.
	// No-surrounding-transaction callers (autocommit): SAVEPOINT itself
	// errors 25P01 — that code is the probe: the consult runs bare,
	// because in autocommit a throw cannot poison later statements.
	// Any other SAVEPOINT error propagates (the caller's transaction
	// was already aborted; fail-closed abort is preserved).
	// EXTENSION vs the GAP-H template (deliberate, #1167): GAP-H
	// releases without rollback on success because its consult throws
	// reliably. The consults contained here do NOT all throw reliably —
	// GAP-A's and GAP-F H1's consults self-catch inside legalHold.js,
	// so a swallowed PG error leaves the transaction aborted with NO
	// throw to trigger cleanup. The rollback-to is therefore
	// UNCONDITIONAL (success and failure alike): every consult/walk
	// contained here is read-only SELECTs, so rolling back to the
	// savepoint undoes nothing legitimate. If ROLLBACK TO / RELEASE
	// themselves throw, the transaction is genuinely dead — the error
	// propagates (fail-closed), exactly as GAP-H's nested catch
	// documents.
	const containedConsult = async (fn) => {
		try {
			await queryable.query('SAVEPOINT gap_hold_consult');
		} catch (spErr) {
			if (spErr.code !== '25P01') throw spErr;
			return fn();
		}
		let result;
		let fnErr = null;
		let fnThrew = false;
		try {
			result = await fn();
		} catch (err) {
			fnThrew = true;
			fnErr = err;
		}
		await queryable.query('ROLLBACK TO SAVEPOINT gap_hold_consult');
		await queryable.query('RELEASE SAVEPOINT gap_hold_consult');
		if (fnThrew) throw fnErr;
		return result;
	};
	let activeHold = null;
	let holdLookupFailed = false;
	try {
		activeHold = await findActiveHold({ userId }, queryable);
	} catch (holdErr) {
		console.error(
			'[erasureService] legal-hold check failed — failing closed (aborting erasure):',
			holdErr.message,
		);
		holdLookupFailed = true;
	}
	if (activeHold || holdLookupFailed) {
		throw new LegalHoldError(
			`Erasure blocked: user ${userId} is under an active legal hold`,
			{ userId, holdId: activeHold?.id ?? null },
		);
	}

	// #1123 (GAP-D) result + per-row hold machinery. One gapD object in
	// the result carries per-table DELETE/UPDATE counts, held-row
	// counts, ledger counts, the non-pattern storage URLs, and the
	// signature-audit residual (S-078/#780 result pattern).
	const gapD = {
		candidateOnboardingData: 0,
		onboardingDocuments: 0,
		onboardingChecklists: 0,
		onboardingChats: 0,
		onboardingPlans: 0,
		onboardingTasks: 0,
		bgVerificationRequests: 0,
		discrepancies: 0,
		educationHistory: 0,
		employmentHistory: 0,
		referenceChecks: 0,
		verifiedCredentials: 0,
		offersRedacted: 0,
		signatureRequests: 0,
		signingPartiesDeleted: 0,
		signingPartiesRedacted: 0,
		signatureDocuments: 0,
		documentHashRecords: 0,
		signatureAuditEvents: 0,
		rowsHeld: 0,
		heldTables: [],
		holdLookupFailed: 0,
		lookupFailedTables: [],
		storageLedgered: 0,
		nonPatternStorageUrls: [],
		// LOWER BOUND, not an exact count (PR-gate P-2): counts only
		// actor-linked (actor_id = userId) signature_audit_events on
		// surviving documents. Events with actor_id NULL that are
		// attributable to the candidate via their signing party are
		// NOT counted, so the true residual may be higher.
		signatureAuditResidual: 0,
	};
	const gapDHeldTables = new Set();
	const gapDLookupFailedTables = new Set();
	const gapDStorageKeys = [];
	// #1121 (GAP-B) result object — same shape discipline as gapD:
	// per-table DELETE counts (not booleans), held survivals counted in
	// rowsHeld and named in heldTables (#1116 disclosure).
	const gapB = {
		scoreSnapshots: 0,
		omniscoreResults: 0,
		scoreAppeals: 0,
		mutualMatches: 0,
		screeningLogs: 0,
		skillAssessments: 0,
		assessmentResults: 0,
		jobAssessmentAttempts: 0,
		assessmentConversations: 0,
		assessmentSessions: 0,
		assessmentEvents: 0,
		rowsHeld: 0,
		heldTables: [],
		holdLookupFailed: 0,
		lookupFailedTables: [],
	};
	// #1122 (GAP-C) result object — same shape discipline as gapD/gapB:
	// per-table DELETE counts (events split into redacted/deleted per
	// the Q2(b) ruling), held survivals counted in rowsHeld and named
	// in heldTables (#1116 disclosure).
	const gapC = {
		scheduledInterviews: 0,
		interviewReminders: 0,
		interviewFeedback: 0,
		candidateFeedback: 0,
		interviewPanels: 0,
		panelNotes: 0,
		panelMembers: 0,
		scorecards: 0,
		scorecardItems: 0,
		interviewEventsRedacted: 0,
		interviewEventsDeleted: 0,
		interviewEventsKeptForPanelConsent: 0,
		proposedSlots: 0,
		interviewRooms: 0,
		interviewRoomsKeptForRecordings: 0,
		mockInterviewSessions: 0,
		interviews: 0,
		interviewAnalysis: 0,
		humanInterviewRequests: 0,
		rowsHeld: 0,
		heldTables: [],
		holdLookupFailed: 0,
		lookupFailedTables: [],
		storageLedgered: 0,
		nonPatternStorageUrls: [],
	};
	const gapCHeldTables = new Set();
	const gapCLookupFailedTables = new Set();
	const gapCStorageKeys = [];
	const gapCNoteHeld = (table, held) => {
		if (held > 0) {
			gapC.rowsHeld += held;
			gapCHeldTables.add(table);
		}
	};
	const gapCNoteLookupFailed = (table, n) => {
		if (n > 0) {
			gapC.holdLookupFailed += n;
			gapCLookupFailedTables.add(table);
		}
	};
	// GAP-C family delete: same GAP-D machinery as gapBDeleteFamily
	// (SELECT → per-row hold partition → explicit counted DELETE).
	const gapCDeleteFamily = async (table, countKey, selectSql, deleteSql, opts = {}) => {
		const { rows } = await gapDQuery(selectSql, opts.selectParams || [userId]);
		const { unheld, held, lookupFailed } = await gapDPartition(rows, opts.companyOf);
		gapCNoteHeld(table, held);
		gapCNoteLookupFailed(table, lookupFailed);
		let deleted = 0;
		if (unheld.length > 0) {
			const ids = unheld.map((r) => r.id);
			const { rowCount } = await gapDQuery(
				deleteSql,
				opts.deleteParams ? opts.deleteParams(ids) : [userId, ids],
			);
			deleted = rowCount || 0;
		}
		gapC[countKey] = deleted;
		return { deleted, held, lookupFailed, unheldRows: unheld };
	};
	const gapBHeldTables = new Set();
	const gapBLookupFailedTables = new Set();
	const gapBNoteHeld = (table, held) => {
		if (held > 0) {
			gapB.rowsHeld += held;
			gapBHeldTables.add(table);
		}
	};
	const gapBNoteLookupFailed = (table, n) => {
		if (n > 0) {
			gapB.holdLookupFailed += n;
			gapBLookupFailedTables.add(table);
		}
	};
	// GAP-B family delete: SELECT the candidate's rows, partition via
	// the GAP-D per-row hold machinery above (row's own / derived
	// company_id aliased as company_id; fail-closed), DELETE the unheld
	// ids explicitly — cascades are never the mechanism.
	const gapBDeleteFamily = async (table, countKey, selectSql, deleteSql, opts = {}) => {
		const { rows } = await gapDQuery(selectSql, opts.selectParams || [userId]);
		const { unheld, held, lookupFailed } = await gapDPartition(rows, opts.companyOf);
		gapBNoteHeld(table, held);
		gapBNoteLookupFailed(table, lookupFailed);
		let deleted = 0;
		if (unheld.length > 0) {
			const ids = unheld.map((r) => r.id);
			const { rowCount } = await gapDQuery(
				deleteSql,
				opts.deleteParams ? opts.deleteParams(ids) : [userId, ids],
			);
			deleted = rowCount || 0;
		}
		gapB[countKey] = deleted;
		return { deleted, held, lookupFailed, unheldRows: unheld };
	};
	// Normalising wrapper for GAP-D queries only: several shipped mock
	// suites answer with { rowCount } and no rows array (or exhaust
	// their mock queue) — GAP-D reads must treat that as "no rows"
	// rather than crash an erasure that is otherwise complete.
	const gapDQuery = async (sql, params) => {
		const res = await queryable.query(sql, params);
		return { rows: res?.rows || [], rowCount: res?.rowCount || 0 };
	};
	// Per-row legal-hold consult (#1123, following the #780 pattern):
	// findActiveHold with the subject AND the row's own company_id
	// where the row carries one. THREE-WAY result (#1154, the GAP-E
	// #1124 contract unified into the shared helper): hold found ⇒
	// 'held'; null ⇒ 'unheld'; lookup ERROR ⇒ 'lookup-failed'. The
	// failure direction stays retention-safe (the row is skipped,
	// never erased), but it is counted as a lookup failure — never
	// as a legal hold: rowsHeld/heldTables state that a hold EXISTS,
	// and a failed lookup proves no such thing (audit truthfulness;
	// #813 per-row reasons + #1116 disclosure ride on this split).
	const gapDRowHoldCheck = async (companyId) => {
		try {
			return (
				(await containedConsult(() =>
					findActiveHold({ userId, companyId: companyId ?? null }, queryable),
				)) != null
					? 'held'
					: 'unheld'
			);
		} catch (holdErr) {
			console.error(
				'[erasureService] #1123 per-row legal-hold check failed — failing closed (skipping row, counted as lookup-failed #1154):',
				holdErr.message,
			);
			return 'lookup-failed';
		}
	};
	const gapDPartition = async (rows, companyOf = (r) => r.company_id ?? null) => {
		const unheld = [];
		const heldRows = [];
		const failedRows = [];
		for (const row of rows) {
			const status = await gapDRowHoldCheck(companyOf(row));
			if (status === 'held') heldRows.push(row);
			else if (status === 'lookup-failed') failedRows.push(row);
			else unheld.push(row);
		}
		return {
			unheld,
			heldRows,
			failedRows,
			held: heldRows.length,
			lookupFailed: failedRows.length,
		};
	};
	const gapDNoteHeld = (table, held) => {
		if (held > 0) {
			gapD.rowsHeld += held;
			gapDHeldTables.add(table);
		}
	};
	const gapDNoteLookupFailed = (table, n) => {
		if (n > 0) {
			gapD.holdLookupFailed += n;
			gapDLookupFailedTables.add(table);
		}
	};
	// SELECT a candidate-keyed family, consult per row, DELETE the
	// unheld ids explicitly (cascades are never the mechanism — the
	// users row is tombstoned, so they never fire).
	const gapDDeleteFamily = async (table, countKey, selectSql, deleteSql, opts = {}) => {
		const { rows } = await gapDQuery(selectSql, opts.selectParams || [userId]);
		const { unheld, held, lookupFailed } = await gapDPartition(rows, opts.companyOf);
		gapDNoteHeld(table, held);
		gapDNoteLookupFailed(table, lookupFailed);
		let deleted = 0;
		if (unheld.length > 0) {
			const ids = unheld.map((r) => r.id);
			const { rowCount } = await gapDQuery(
				deleteSql,
				opts.deleteParams ? opts.deleteParams(ids) : [userId, ids],
			);
			deleted = rowCount || 0;
		}
		gapD[countKey] = deleted;
		return { deleted, held, lookupFailed, unheldRows: unheld };
	};

	let shredded;
	try {
		await destroyDEK(userId, { client, audit });
		shredded = true;
	} catch (err) {
		if (err.code === 'DEKNotFound') {
			// Not every user has a DEK (recruiters, candidates with no video
			// data). Nothing to shred — not an error.
			shredded = false;
			// Gate A (S-085, security review M-4): leave a TOMBSTONE so a
			// stale in-flight capture/measurement/outcome write that lands
			// AFTER this erasure cannot mint a fresh DEK and resurrect
			// candidate-linked rows. getOrCreateDEK throws on a destroyed
			// row, and every Gate A write path checks destroyed_at first.
			// DO NOTHING: if a row raced into existence, it is not ours to
			// overwrite here.
			await client.query(
				`INSERT INTO candidate_data_keys (candidate_id, dek_encrypted, destroyed_at)
				 VALUES ($1, $2, NOW())
				 ON CONFLICT (candidate_id) DO NOTHING`,
				[userId, Buffer.alloc(0)],
			);
		} else {
			throw err;
		}
	}

	// S-075 (#752): hard-delete the candidate_embeddings row. Independent of
	// DEK existence — plaintext personal data, GDPR Art. 17 requires erasure
	// regardless. Leaf table (user_id UNIQUE, no referencing FKs): safe.
	// Privacy-review CRITICAL: candidate_search_index holds a second embedding
	// copy + plaintext PII — same violation, deleted alongside (also a leaf
	// table; the users sync trigger fires earlier in this transaction, so the
	// DELETE runs after any re-sync).
	const { rowCount: embeddingsRows } = await queryable.query(
		'DELETE FROM candidate_embeddings WHERE user_id = $1',
		[userId],
	);
	const { rowCount: searchIndexRows } = await queryable.query(
		'DELETE FROM candidate_search_index WHERE user_id = $1',
		[userId],
	);

	// #1123 (GAP-D): verified_credentials — deleted HERE, before the
	// S-076 verification_documents DELETE below, because
	// verified_credentials.document_id → verification_documents(id)
	// (migration 009) has NO ON DELETE action: a credential row
	// referencing a document would FK-block that shipped DELETE.
	// In-transaction ordering is the fix — no migration needed.
	await gapDDeleteFamily(
		'verified_credentials',
		'verifiedCredentials',
		'SELECT id FROM verified_credentials WHERE user_id = $1',
		'DELETE FROM verified_credentials WHERE user_id = $1 AND id = ANY($2)',
	);

	// S-076 (#759): resume/profile family. All tables have ON DELETE CASCADE
	// on user_id, but self-serve deletion is soft-delete so CASCADE never
	// fires — explicit DELETEs required. Independent of DEK existence
	// (S-075 precedent): plaintext personal data, Art. 17 requires erasure
	// regardless.
	//
	// Two-phase: file-bearing tables use RETURNING to collect storage keys;
	// keys are INSERTed into pending_storage_deletions IN-TX (Q3: crash-safe —
	// the S-077 cron reconciles un-marked entries); Phase 2
	// (deleteErasedStorageFiles, post-commit) deletes the objects. R2 NEVER in-tx.
	// Dedupe note: parsed_resumes.file_url and candidate_profiles.resume_url
	// are the SAME upload (routes/candidate.js sets both from one result.url).
	const { rows: cvUploadRows } = await queryable.query(
		'DELETE FROM cv_uploads WHERE user_id = $1 RETURNING file_url',
		[userId],
	);
	const { rows: parsedResumeRows } = await queryable.query(
		'DELETE FROM parsed_resumes WHERE user_id = $1 RETURNING file_url',
		[userId],
	);
	const { rows: profileRows } = await queryable.query(
		'DELETE FROM candidate_profiles WHERE user_id = $1 RETURNING resume_url, photo_url',
		[userId],
	);
	const { rowCount: verificationRows } = await queryable.query(
		'DELETE FROM identity_verifications WHERE user_id = $1',
		[userId],
	);
	// Rex's review: cv_analyses/cv_reviews have ON DELETE SET NULL FKs to
	// parsed_resumes — deleting parsed_resumes alone leaves derived PII
	// (section_scores, recommendations, review_data). Explicit DELETEs.
	const { rowCount: analysisRows } = await queryable.query(
		'DELETE FROM cv_analyses WHERE user_id = $1',
		[userId],
	);
	const { rowCount: reviewRows } = await queryable.query(
		'DELETE FROM cv_reviews WHERE user_id = $1',
		[userId],
	);
	// Privacy-engineer Q1 (blocker): additional resume/profile/identity
	// tables missed in the initial scope. verification_requests is keyed by
	// candidate_id (not user_id); its files are on LOCAL disk (not R2/B2).
	const { rows: verificationRequestRows } = await queryable.query(
		'DELETE FROM verification_requests WHERE candidate_id = $1 RETURNING id_document_encrypted_url, selfie_encrypted_url',
		[userId],
	);
	const { rows: verificationDocRows } = await queryable.query(
		'DELETE FROM verification_documents WHERE user_id = $1 RETURNING file_url',
		[userId],
	);
	const { rowCount: workExpRows } = await queryable.query(
		'DELETE FROM work_experience WHERE user_id = $1',
		[userId],
	);
	const { rowCount: educationRows } = await queryable.query(
		'DELETE FROM education WHERE user_id = $1',
		[userId],
	);
	const { rowCount: skillsRows } = await queryable.query(
		'DELETE FROM candidate_skills WHERE user_id = $1',
		[userId],
	);
	const { rowCount: linkedinRows } = await queryable.query(
		'DELETE FROM linkedin_profiles WHERE user_id = $1',
		[userId],
	);
	const { rowCount: diagnosisRows } = await queryable.query(
		'DELETE FROM career_diagnoses WHERE user_id = $1',
		[userId],
	);
	// Cosmetic: users.avatar_url dangles after candidate_profiles.photo_url's
	// object is deleted (same R2 object, routes/candidate.js:467). Clear it —
	// not PII per se, but avoids a broken image pointer.
	await queryable.query('UPDATE users SET avatar_url = NULL WHERE id = $1', [userId]);

	// S-078 (#756): MEDIUM family. Same Art. 17 exposure as HIGH — personal
	// data surviving erasure. Key mismatches (STOP 1): messages uses
	// sender_id (not user_id); match_results and screening_sessions use
	// candidate_id; interview_transcripts has no user key — deletes via
	// interview_recordings → interview_events.candidate_id join.
	// transcript_highlights cascades from interview_transcripts (ON DELETE
	// CASCADE). messages.file_url attachments follow the two-phase pattern:
	// RETURNING → pending_storage_deletions ledger → Phase 2 deletes.
	// conversations rows are intentionally NOT deleted: joint data (both
	// parties), retained under Art. 17(3)(e) (legal claims) — the row holds
	// no message content (last_message is never written; preview is computed).
	const { rows: messageRows } = await queryable.query(
		'DELETE FROM messages WHERE sender_id = $1 RETURNING file_url',
		[userId],
	);
	const { rowCount: userMemoryRows } = await queryable.query(
		'DELETE FROM user_memory WHERE user_id = $1',
		[userId],
	);
	const { rowCount: matchResultRows } = await queryable.query(
		'DELETE FROM match_results WHERE candidate_id = $1',
		[userId],
	);
	const { rowCount: practiceSessionRows } = await queryable.query(
		'DELETE FROM practice_sessions WHERE user_id = $1',
		[userId],
	);
	const { rowCount: screeningSessionRows } = await queryable.query(
		'DELETE FROM screening_sessions WHERE candidate_id = $1',
		[userId],
	);
	// GAP-A (b) (#1120): session branch added — migration 130's XOR CHECK
	// means session-linked recordings have interview_event_id IS NULL, so
	// the event join alone could never reach their transcripts.
	const { rowCount: transcriptRows } = await queryable.query(
		`DELETE FROM interview_transcripts WHERE recording_id IN (
			SELECT ir.id FROM interview_recordings ir
			JOIN interview_events ie ON ie.id = ir.interview_event_id
			WHERE ie.candidate_id = $1
		) OR recording_id IN (
			SELECT ir2.id FROM interview_recordings ir2
			WHERE ir2.interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)
		)`,
		[userId],
	);
	// S-D13 (#1915, BR-13 / FR-D18, Architecture §6.4): diarization
	// artefacts die with the transcripts — explicit E-3 entries using
	// the SAME dual-branch recording scope as the transcript DELETE
	// above (event join + session-linked GAP-A branch). The migration
	// 296 FK CASCADEs are only a backstop: erasure keep-redacts
	// interview_recordings (GAP-A (c) below), so no cascade ever fires
	// here. Delete order is FK-driven: diarization_runs.job_id
	// references diarization_jobs(id) with no cascade, so runs go
	// first. diarization_metrics_daily is deliberately NOT touched —
	// counts-only, no recording/user linkage (AC-3).
	const diarizationRecordingScope = `(
		SELECT ir.id FROM interview_recordings ir
		JOIN interview_events ie ON ie.id = ir.interview_event_id
		WHERE ie.candidate_id = $1
	) OR recording_id IN (
		SELECT ir2.id FROM interview_recordings ir2
		WHERE ir2.interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)
	)`;
	const { rowCount: diarizationRunRows } = await queryable.query(
		`DELETE FROM diarization_runs WHERE recording_id IN ${diarizationRecordingScope}`,
		[userId],
	);
	const { rowCount: speakerAuditRows } = await queryable.query(
		`DELETE FROM transcript_speaker_audit WHERE recording_id IN ${diarizationRecordingScope}`,
		[userId],
	);
	const { rowCount: speakerMappingRows } = await queryable.query(
		`DELETE FROM recording_speaker_mappings WHERE recording_id IN ${diarizationRecordingScope}`,
		[userId],
	);
	const { rowCount: diarizationJobRows } = await queryable.query(
		`DELETE FROM diarization_jobs WHERE recording_id IN ${diarizationRecordingScope}`,
		[userId],
	);
	// #1944 (F-2, Lex L-3/L-4): cross-recording residuals. The subject
	// may appear inside OTHER subjects' recordings as a mapping
	// participant / updated_by and as audit from/to/actor. Migration
	// 296 built those columns nullable with ON DELETE SET NULL intent,
	// but erasure tombstones the user row instead of deleting it, so
	// the SET NULL never fires — sweep explicitly here, in the same
	// transaction, AFTER the S-D13 deletes above (rows on the subject's
	// own recordings are already gone; what remains belongs to other
	// recordings). Mapping/audit ROWS survive: participant_role, action
	// and timestamps are the other recording's record, not the erased
	// user's identity. Counts are field-null operations.
	const { rowCount: crossMappingParticipantRows } = await queryable.query(
		'UPDATE recording_speaker_mappings SET participant_user_id = NULL WHERE participant_user_id = $1',
		[userId],
	);
	const { rowCount: crossMappingUpdatedByRows } = await queryable.query(
		'UPDATE recording_speaker_mappings SET updated_by = NULL WHERE updated_by = $1',
		[userId],
	);
	const { rowCount: crossAuditRows } = await queryable.query(
		`UPDATE transcript_speaker_audit
		 SET from_user_id = CASE WHEN from_user_id = $1 THEN NULL ELSE from_user_id END,
		     to_user_id = CASE WHEN to_user_id = $1 THEN NULL ELSE to_user_id END,
		     actor_user_id = CASE WHEN actor_user_id = $1 THEN NULL ELSE actor_user_id END
		 WHERE from_user_id = $1 OR to_user_id = $1 OR actor_user_id = $1`,
		[userId],
	);
	// #2014 (residuals II, panel STOP 1 2026-10-30): two more
	// cross-recording survivals of the erased user's id.
	// Item 1 — the FROZEN panel set on OTHER subjects' recordings
	// (migration 299): remove the erased id from
	// panel_expected_user_ids AND null panel_expected_hash in the
	// SAME update — the pair is indivisible. The hash is a SHA-256
	// over the event roster (lib/panelLabelling.js canonicalRoster),
	// never over the array, so it cannot be recomputed here; keeping
	// it beside a reduced array would leave a verifiable-looking
	// digest attesting a set that no longer exists. A NULL hash
	// assert-blocks the panel leg as PANEL_SET_UNRESOLVABLE
	// (lib/diarizationGate.js) — visible, never silent. The subject's
	// OWN recordings are excluded (dual attribution, mirroring
	// diarizationRecordingScope): GAP-A(c) below clears the pair on
	// the subject's own tombstones (item 3). Non-matching rows are
	// never rewritten.
	// #2019 (Lex full-report condition on #2014, dropped by the
	// condensed panel delivery): in-flight diarization jobs on the
	// recordings the sweep is about to touch are CANCELLED first, in
	// this same transaction — a pre-erasure frozen set must not
	// govern a post-erasure write, and cancelling removes the race
	// rather than relying on the claim/write snapshot comparison
	// catching it. Same recording predicate as the sweep below
	// (which needs the array intact, so this runs first).
	const { rowCount: crossPanelJobCancelRows } = await queryable.query(
		`UPDATE diarization_jobs
		 SET status = 'cancelled', updated_at = NOW()
		 WHERE status IN ('pending', 'claimed', 'processing')
		   AND recording_id IN (
		     SELECT id FROM interview_recordings
		     WHERE panel_expected_user_ids @> ARRAY[$1]::int[]
		       AND id NOT IN (
		         SELECT ir.id FROM interview_recordings ir
		         JOIN interview_events ie ON ie.id = ir.interview_event_id
		         WHERE ie.candidate_id = $1
		       )
		       AND id NOT IN (
		         SELECT ir2.id FROM interview_recordings ir2
		         WHERE ir2.interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)
		       )
		   )`,
		[userId],
	);
	const { rowCount: crossPanelSetRows } = await queryable.query(
		`UPDATE interview_recordings
		 SET panel_expected_user_ids = array_remove(panel_expected_user_ids, $1),
		     panel_expected_hash = NULL
		 WHERE panel_expected_user_ids @> ARRAY[$1]::int[]
		   AND id NOT IN (
		     SELECT ir.id FROM interview_recordings ir
		     JOIN interview_events ie ON ie.id = ir.interview_event_id
		     WHERE ie.candidate_id = $1
		   )
		   AND id NOT IN (
		     SELECT ir2.id FROM interview_recordings ir2
		     WHERE ir2.interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)
		   )`,
		[userId],
	);
	// Item 2 — diarization_runs.proposed_mapping on SURVIVING runs
	// (the subject's own runs were deleted above): entries naming
	// the erased user become JSON null — the exact unassigned shape
	// computeProposal emits (lib/speakerMapping.js); keys are never
	// deleted (a missing key would read as "never proposed"; null
	// reads as "no assignment", which is the truth after erasure).
	// JSONB surgery is JS-side inside this transaction: SQL cannot
	// key a match on a nested value. The text probe only narrows
	// the candidate rows — the JS check decides, and a run is only
	// rewritten when an entry actually matched. The
	// panel_consent_snapshot copies on jobs/runs are NEVER touched
	// here (S-D19 retention exception; #2011 owns their clock).
	const proposalProbe = await queryable.query(
		`SELECT id, proposed_mapping FROM diarization_runs
		 WHERE proposed_mapping IS NOT NULL
		   AND proposed_mapping::text ~ $1`,
		[`"participant_user_id": ${Number(userId)}[^0-9]`],
	);
	let crossProposalRunRows = 0;
	for (const runRow of proposalProbe?.rows || []) {
		const mapping = runRow.proposed_mapping;
		if (!mapping || typeof mapping !== 'object') continue;
		let touched = false;
		const swept = {};
		for (const [speaker, entry] of Object.entries(mapping)) {
			if (entry && typeof entry === 'object' && entry.participant_user_id === userId) {
				swept[speaker] = null;
				touched = true;
			} else {
				swept[speaker] = entry;
			}
		}
		if (!touched) continue;
		await queryable.query('UPDATE diarization_runs SET proposed_mapping = $2 WHERE id = $1', [
			runRow.id,
			JSON.stringify(swept),
		]);
		crossProposalRunRows++;
	}
	// S-D19 (#1956, BR-7 design §10 / privacy C-8): the subject's OWN
	// panel labelling decisions — event_labelling_consent rows keyed by
	// user_id across ALL events (the user_id index is the enumeration
	// path). These rows are the panel speaker's own records: a panel
	// user's erasure deletes them wherever they sit (IP/UA die with
	// the row — no separate redaction, the row itself goes). The
	// DELETE keys ONLY on user_id, so a CANDIDATE's erasure never
	// touches another user's panel rows (§10's two directions kept
	// separate — they are not the candidate's personal data). The
	// documented tombstone exception: diarization_jobs/runs
	// panel_consent_snapshot copies (user id + decision + timestamps,
	// no IP/UA) on OTHER subjects' recordings may be retained under
	// the consent-record retention clock, access-restricted — the
	// same exception the existing consent tombstone carries.
	const { rowCount: panelLabellingConsentRows } = await queryable.query(
		'DELETE FROM event_labelling_consent WHERE user_id = $1',
		[userId],
	);
	// #2011 Part A (Lex disclosure condition on the S-D19 exception,
	// from the full #1944 position): the snapshot copies retained
	// under that exception are COUNTED as a named residual — never
	// touched, only disclosed. One retained entry = one SURVIVING
	// diarization_jobs / diarization_runs row whose
	// panel_consent_snapshot references this user, via
	// expected_user_ids OR any decisions[].user_id (both are written
	// by lib/diarizationGate.js; a row matching both counts once).
	// Placement is the semantics: this runs AFTER the S-D13 deletes
	// of the subject's OWN jobs/runs above (the only diarization-row
	// DELETEs in this routine), inside the same transaction — so the
	// subject's own copies are already gone and cannot inflate the
	// count, while copies on other subjects' rows (including jobs
	// merely CANCELLED by the #2019 sweep) survive and are counted.
	// Part B (the retention-clock sweep, #2011) owns expiring these
	// copies; this lane only counts them.
	const panelSnapshotRef = (table) =>
		`(SELECT COUNT(*) FROM ${table}
		  WHERE panel_consent_snapshot IS NOT NULL
		    AND ((panel_consent_snapshot -> 'expected_user_ids') @> jsonb_build_array($1::int)
		      OR EXISTS (
		        SELECT 1 FROM jsonb_array_elements(
		          CASE WHEN jsonb_typeof(panel_consent_snapshot -> 'decisions') = 'array'
		               THEN panel_consent_snapshot -> 'decisions' ELSE '[]'::jsonb END
		        ) AS d WHERE d ->> 'user_id' = $2)))`;
	const { rows: panelSnapshotRetainedRows } = await queryable.query(
		`SELECT (${panelSnapshotRef('diarization_jobs')} + ${panelSnapshotRef('diarization_runs')})::int AS retained`,
		[userId, String(userId)],
	);
	const panelConsentSnapshotsRetained = panelSnapshotRetainedRows?.[0]?.retained || 0;
	const { rowCount: omniScoreRows } = await queryable.query(
		'DELETE FROM omni_scores WHERE user_id = $1',
		[userId],
	);
	const { rowCount: roleScoreRows } = await queryable.query(
		'DELETE FROM role_scores WHERE user_id = $1',
		[userId],
	);
	// Privacy-engineer S-078 review (SHOULD-FIX): six more leaf tables hold
	// the user's personal data. All one-line DELETEs, same pattern.
	const { rowCount: screeningAnswerRows } = await queryable.query(
		'DELETE FROM screening_answers WHERE user_id = $1',
		[userId],
	);
	const { rowCount: evaluationRows } = await queryable.query(
		'DELETE FROM interview_evaluations WHERE candidate_id = $1',
		[userId],
	);
	const { rowCount: compositeScoreRows } = await queryable.query(
		'DELETE FROM interview_composite_scores WHERE candidate_id = $1',
		[userId],
	);
	const { rowCount: scoreComponentRows } = await queryable.query(
		'DELETE FROM score_components WHERE user_id = $1',
		[userId],
	);
	const { rowCount: scoreHistoryRows } = await queryable.query(
		'DELETE FROM score_history WHERE user_id = $1',
		[userId],
	);
	const { rowCount: jobRecommendationRows } = await queryable.query(
		'DELETE FROM job_recommendations WHERE user_id = $1',
		[userId],
	);
	// Privacy-engineer S-078 review (SHOULD-FIX): recording_consent's consent
	// FACT must survive erasure (Art. 7(1) accountability, Art. 17(3)(b)) —
	// but ip_address/user_agent are PII beyond proof-of-consent. Redact them.
	const { rowCount: consentRedactedRows } = await queryable.query(
		'UPDATE recording_consent SET ip_address = NULL, user_agent = NULL WHERE user_id = $1',
		[userId],
	);

	// #1127 (GAP-H, K-1): consent_records / consent_history — redact the
	// PII attached to the consent FACT, retain the rows (see header).
	// Ruled field sets are PER TABLE (STOP 1 panel correction — the
	// filing's symmetry was factually wrong): consent_records has NO
	// user_agent column (mig 013: ip_address + metadata JSONB; mig 133:
	// revocation fields), and its metadata (caller-supplied verbatim,
	// no allowlist) + revocation_reason (client free text) are IN the
	// redact set (Lex: neither is a named K-1 fact field). KEEP columns
	// are byte-identical — they appear in no UPDATE, and there is no
	// NOW() churn. NAMED RESIDUAL: the actor FKs revoked_by /
	// changed_by are KEPT (actor accountability, GAP-D precedent),
	// named in gapH.actorFkResidualColumns and counted in
	// gapH.actorFkResidual. Linkage (user_id / consent_record_id)
	// stays by design: kept rows remain LINKABLE personal data under
	// K-1's clock (OPEN — counsel), never anonymised.
	// Legal hold: per-row consult at EACH site (post-#799 pattern,
	// NOT the recording_consent precedent's entry-gate-only shape) —
	// findActiveHold({ userId }) per row (these tables carry no
	// company_id; the subject shape is the only derivation that
	// exists), three-way partition (redacted / held-preserved /
	// lookup-failure-preserved), fail-closed on any throw.
	const gapH = {
		consentRecordsRedacted: 0,
		consentRecordsHeld: 0,
		consentRecordsLookupFailed: 0,
		consentHistoryRedacted: 0,
		consentHistoryHeld: 0,
		consentHistoryLookupFailed: 0,
		rowsHeld: 0,
		heldTables: [],
		holdLookupFailed: 0,
		lookupFailedTables: [],
		actorFkResidual: 0,
		actorFkResidualColumns: ['consent_records.revoked_by', 'consent_history.changed_by'],
	};
	const gapHHeldTables = new Set();
	const gapHLookupFailedTables = new Set();
	const gapHPartition = async (rows) => {
		const unheld = [];
		const heldRows = [];
		const failedRows = [];
		for (const row of rows) {
			// PR-gate fix round (#1127, database-reviewer BLOCK, proven on
			// real PG): both production callers run erasePersonalData
			// inside BEGIN…COMMIT on one client, so a throwing consult
			// ABORTS the caller's transaction — the next statement throws
			// 25P02, erasePersonalData rejects, the caller rolls back and
			// the lookup-failure partition below never completes. Each
			// consult is therefore contained in a SAVEPOINT on the same
			// queryable: on throw, ROLLBACK TO SAVEPOINT restores the
			// transaction so the row can be counted lookup-failed and the
			// erasure can CONTINUE and complete.
			// No-surrounding-transaction callers (autocommit): SAVEPOINT
			// itself errors 25P01 ("can only be used in transaction
			// blocks", PG 16 — verified on a real server + node-pg). That
			// code is the probe: the consult runs bare, because in
			// autocommit each statement is its own implicit transaction
			// and a throw cannot poison later statements. Any other
			// SAVEPOINT error propagates (e.g. 25P02 — the caller's
			// transaction was already aborted before GAP-H; the existing
			// fail-closed abort is preserved, not papered over).
			let savepointActive = false;
			try {
				await queryable.query('SAVEPOINT gap_h_hold_consult');
				savepointActive = true;
			} catch (spErr) {
				if (spErr.code !== '25P01') throw spErr;
			}
			try {
				const hold = await findActiveHold({ userId }, queryable);
				if (savepointActive) {
					await queryable.query('RELEASE SAVEPOINT gap_h_hold_consult');
				}
				if (hold != null) heldRows.push(row);
				else unheld.push(row);
			} catch (holdErr) {
				if (savepointActive) {
					try {
						await queryable.query('ROLLBACK TO SAVEPOINT gap_h_hold_consult');
						await queryable.query('RELEASE SAVEPOINT gap_h_hold_consult');
					} catch (rollbackErr) {
						// Containment itself failed: log loudly and still
						// count the row fail-closed. If the transaction is
						// truly aborted, the next real statement surfaces
						// it (25P02) and the caller rolls back — nothing
						// is silently redacted or silently dropped.
						console.error(
							'[erasureService] #1127 GAP-H savepoint rollback failed — transaction may be aborted; erasure will fail closed:',
							rollbackErr.message,
						);
					}
				}
				console.error(
					'[erasureService] #1127 per-row legal-hold check failed — failing closed (skipping row, counted as lookup-failed):',
					holdErr.message,
				);
				failedRows.push(row);
			}
		}
		return { unheld, heldRows, failedRows, held: heldRows.length, lookupFailed: failedRows.length };
	};
	const gapHRedactFamily = async (
		table,
		redactedKey,
		heldKey,
		lookupFailedKey,
		selectSql,
		updateSql,
		actorColumn,
	) => {
		const { rows } = await queryable.query(selectSql, [userId]);
		const part = await gapHPartition(rows || []);
		gapH[heldKey] = part.held;
		gapH[lookupFailedKey] = part.lookupFailed;
		if (part.held > 0) {
			gapH.rowsHeld += part.held;
			gapHHeldTables.add(table);
		}
		if (part.lookupFailed > 0) {
			gapH.holdLookupFailed += part.lookupFailed;
			gapHLookupFailedTables.add(table);
		}
		// Named residual: actor FKs survive on every kept row of this
		// table (redacted, held and lookup-failed alike) — count the
		// rows carrying one, values never enter the result (§4.1).
		gapH.actorFkResidual += (rows || []).filter((r) => r[actorColumn] != null).length;
		if (part.unheld.length > 0) {
			const { rowCount } = await queryable.query(updateSql, [
				userId,
				part.unheld.map((r) => r.id),
			]);
			gapH[redactedKey] = rowCount || 0;
		}
	};
	await gapHRedactFamily(
		'consent_records',
		'consentRecordsRedacted',
		'consentRecordsHeld',
		'consentRecordsLookupFailed',
		'SELECT id, revoked_by FROM consent_records WHERE user_id = $1',
		"UPDATE consent_records SET ip_address = NULL, metadata = '{}'::jsonb, revocation_reason = NULL WHERE user_id = $1 AND id = ANY($2)",
		'revoked_by',
	);
	await gapHRedactFamily(
		'consent_history',
		'consentHistoryRedacted',
		'consentHistoryHeld',
		'consentHistoryLookupFailed',
		'SELECT id, changed_by FROM consent_history WHERE user_id = $1',
		'UPDATE consent_history SET ip_address = NULL, user_agent = NULL WHERE user_id = $1 AND id = ANY($2)',
		'changed_by',
	);
	gapH.heldTables = [...gapHHeldTables];
	gapH.lookupFailedTables = [...gapHLookupFailedTables];

	// #780: job_applications — redact the candidate-linked content, retain
	// the row (see header). Per-row legal-hold consult FIRST (STOP 1 §3):
	// a held row is excluded from the redaction and counted; a lookup
	// error on a row reads as held (fail-closed, isHeld semantics) — the
	// row is skipped, never silently redacted or silently dropped.
	const { rows: applicationRows } = await queryable.query(
		'SELECT id, company_id FROM job_applications WHERE candidate_id = $1',
		[userId],
	);
	const unheldApplicationIds = [];
	let jobApplicationRowsHeld = 0;
	for (const applicationRow of applicationRows) {
		let rowHeld;
		try {
			rowHeld =
				(await containedConsult(() =>
					findActiveHold(
						{ userId, companyId: applicationRow.company_id },
						queryable,
					),
				)) != null;
		} catch (holdErr) {
			console.error(
				'[erasureService] per-row legal-hold check failed for a job_application — failing closed (skipping row):',
				holdErr.message,
			);
			rowHeld = true;
		}
		if (rowHeld) {
			jobApplicationRowsHeld++;
		} else {
			unheldApplicationIds.push(applicationRow.id);
		}
	}
	let jobApplicationsRedactedRows = 0;
	if (unheldApplicationIds.length > 0) {
		const { rowCount } = await queryable.query(
			`UPDATE job_applications
			 SET cover_letter = NULL,
			     screening_answers = '{}'::jsonb,
			     resume_url = NULL,
			     match_score = NULL,
			     omniscore_at_apply = NULL,
			     screening_score = NULL,
			     assessment_score = NULL,
			     assessment_result = NULL,
			     recruiter_notes = NULL,
			     updated_at = NOW()
			 WHERE candidate_id = $1 AND id = ANY($2)`,
			[userId, unheldApplicationIds],
		);
		jobApplicationsRedactedRows = rowCount || 0;
	}

	// #813 (S-094): C2 sweep — the five application-keyed tables the chain
	// never touched (screening_responses, job_application_screenings,
	// ai_screenings, outreach_attempts, auto_apply_profiles). None is the
	// joint skeleton (that is job_applications itself, retained above), so
	// all five are whole-row DELETEs, partitioned by the #780 unheld
	// application set built in the block immediately above — no duplicate
	// hold consults for application-keyed rows, lib/legalHold.js untouched.
	// No file columns exist on any of the five (STOP 1 §2): no storage
	// ledger work. Cascade children screening_question_evaluations /
	// screening_overrides die via the screening_responses DELETE's
	// mig-073 CASCADEs — no explicit DELETEs for them.
	//
	// D-1 (panel ruling, 2026-10-14): ai_screening_audit_logs +
	// ai_screening_human_reviews are deleted by EXPLICIT counted DELETE
	// *before* the parent ai_screenings DELETE (the mig-076 CASCADEs
	// would otherwise take them uncounted — an unprovable erasure,
	// Art. 5(2)), after the per-row hold consult (held parents' children
	// are never touched). No skeleton, no hashes. The accountability
	// record survives in compliance_audit_trail (#920 guard; survival
	// proven by test — D-1 Condition 1 — and the trail's own writer
	// defects are filed as #1145).
	//
	// D-3 (panel ruling as tightened): rows with NULL application_id get
	// a per-row job-walk — exact-match only on the row's own identifiers
	// (job_id + candidate_id, or questionnaire → job for
	// screening_responses), inside this transaction, creating no linkage
	// record that survives. A successful resolution yielding NULL
	// company proceeds under the entry gate (documented residual). A
	// failed resolution OR a hold-consult error = fail-closed skip of
	// that row ONLY — counted in applicationKeyedRowsHeld, named in
	// applicationKeyedHeldDetails, never aborting the erasure. A row the
	// walk attaches to a held application follows the hold. The walk is
	// idempotent: a re-run re-walks skipped rows.
	// D-2 (Sumanth): auto_apply_profiles whole-row DELETE; the consent
	// FACT is captured pre-delete as a tombstone in the return metadata
	// ({profileExisted, gdprConsent, consentDate}) — never profile_data.
	const c2Query = async (sql, params) => {
		const res = await queryable.query(sql, params);
		return { rows: res?.rows || [], rowCount: res?.rowCount || 0 };
	};
	const unheldApplicationIdSet = new Set(unheldApplicationIds);
	const applicationKeyedHeldDetails = [];
	let applicationKeyedRowsHeld = 0;
	const c2NoteHeld = (table, id, reason) => {
		applicationKeyedRowsHeld++;
		applicationKeyedHeldDetails.push({ table, id, reason });
	};
	let screeningResponsesDeletedCount = 0;
	let jobApplicationScreeningsDeletedCount = 0;
	let aiScreeningsDeletedCount = 0;
	let aiScreeningAuditLogsDeleted = 0;
	let aiScreeningHumanReviewsDeleted = 0;
	let complianceAuditMarkersDrained = 0;
	let outreachAttemptsDeletedCount = 0;
	let autoApplyProfileDeletedCount = 0;
	let autoApplyConsentTombstone = null;
	const c2WalkNullApplicationRow = async ({ jobId = null, questionnaireId = null }) => {
		let resolvedJobId = jobId;
		let companyId = null;
		if (resolvedJobId == null && questionnaireId != null) {
			const { rows } = await c2Query(
				`SELECT q.job_id AS job_id, j.company_id AS company_id
				 FROM screening_questionnaires q
				 LEFT JOIN jobs j ON j.id = q.job_id
				 WHERE q.id = $1`,
				[questionnaireId],
			);
			if (!rows[0] || rows[0].job_id == null) return { resolved: false };
			resolvedJobId = rows[0].job_id;
			companyId = rows[0].company_id ?? null;
		} else if (resolvedJobId != null) {
			const { rows } = await c2Query('SELECT company_id FROM jobs WHERE id = $1', [
				resolvedJobId,
			]);
			if (!rows[0]) return { resolved: false };
			companyId = rows[0].company_id ?? null;
		} else {
			return { resolved: false };
		}
		const { rows: exactRows } = await c2Query(
			'SELECT id, company_id FROM job_applications WHERE job_id = $1 AND candidate_id = $2',
			[resolvedJobId, userId],
		);
		if (exactRows[0]) {
			if (!unheldApplicationIdSet.has(exactRows[0].id)) {
				return { resolved: true, heldApplication: true, companyId: exactRows[0].company_id ?? companyId };
			}
			if (exactRows[0].company_id != null) companyId = exactRows[0].company_id;
		}
		return { resolved: true, heldApplication: false, companyId };
	};
	const c2Partition = async (table, rows, walkOf) => {
		const unheldIds = [];
		for (const row of rows) {
			if (row.application_id != null) {
				if (unheldApplicationIdSet.has(row.application_id)) unheldIds.push(row.id);
				else c2NoteHeld(table, row.id, 'held_application');
				continue;
			}
			// D-3 job-walk for NULL-application rows.
			let walk;
			try {
				walk = await containedConsult(() => c2WalkNullApplicationRow(walkOf(row)));
			} catch (walkErr) {
				console.error(
					`[erasureService] #813 D-3 job-walk failed for a ${table} row — failing closed (skipping row):`,
					walkErr.message,
				);
				c2NoteHeld(table, row.id, 'job_walk_error');
				continue;
			}
			if (!walk.resolved) {
				c2NoteHeld(table, row.id, 'unresolved_job_walk');
				continue;
			}
			if (walk.heldApplication) {
				c2NoteHeld(table, row.id, 'held_application');
				continue;
			}
			let rowHeld;
			try {
				rowHeld =
					(await containedConsult(() =>
						findActiveHold(
							{ userId, companyId: walk.companyId ?? null },
							queryable,
						),
					)) != null;
			} catch (holdErr) {
				console.error(
					`[erasureService] #813 D-3 per-row legal-hold check failed for a ${table} row — failing closed (skipping row):`,
					holdErr.message,
				);
				rowHeld = true;
			}
			if (rowHeld) c2NoteHeld(table, row.id, 'held_company');
			else unheldIds.push(row.id);
		}
		return unheldIds;
	};
	const c2DeleteByIds = async (sql, keyParams, ids) => {
		if (ids.length === 0) return 0;
		const { rowCount } = await c2Query(sql, keyParams(ids));
		return rowCount || 0;
	};

	// screening_responses (candidate-keyed; walk via questionnaire).
	const { rows: c2ScreeningResponseRows } = await c2Query(
		'SELECT id, application_id, questionnaire_id FROM screening_responses WHERE candidate_id = $1',
		[userId],
	);
	const c2ScreeningResponseIds = await c2Partition(
		'screening_responses',
		c2ScreeningResponseRows,
		(r) => ({ questionnaireId: r.questionnaire_id ?? null }),
	);
	screeningResponsesDeletedCount = await c2DeleteByIds(
		'DELETE FROM screening_responses WHERE candidate_id = $1 AND id = ANY($2)',
		(ids) => [userId, ids],
		c2ScreeningResponseIds,
	);

	// job_application_screenings (candidate-keyed; walk via its job_id).
	const { rows: c2JobScreeningRows } = await c2Query(
		'SELECT id, application_id, job_id FROM job_application_screenings WHERE candidate_id = $1',
		[userId],
	);
	const c2JobScreeningIds = await c2Partition('job_application_screenings', c2JobScreeningRows, (r) => ({
		jobId: r.job_id ?? null,
	}));
	jobApplicationScreeningsDeletedCount = await c2DeleteByIds(
		'DELETE FROM job_application_screenings WHERE candidate_id = $1 AND id = ANY($2)',
		(ids) => [userId, ids],
		c2JobScreeningIds,
	);

	// ai_screenings (candidate-keyed; walk via its job_id) — D-1 children
	// explicitly deleted, counted, BEFORE the parent DELETE.
	const { rows: c2AiScreeningRows } = await c2Query(
		'SELECT id, application_id, job_id FROM ai_screenings WHERE candidate_id = $1',
		[userId],
	);
	const c2AiScreeningIds = await c2Partition('ai_screenings', c2AiScreeningRows, (r) => ({
		jobId: r.job_id ?? null,
	}));
	// #1337: drain compliance_audit_failed dead-letter markers into
	// compliance_audit_trail BEFORE the D-1 DELETEs below erase them.
	// The #1145 marker is the only record that a trail write failed;
	// deleting it unreplayed would permanently lose the accountability
	// event D-1 (#813) relies on the trail to preserve. Design (STOP 1
	// on #1337, Lex consulted): replay only this sweep's unheld
	// partition (held screenings keep their markers with their rows);
	// reconstruct from the still-present source rows, capped at the
	// original callsites' shared payload fields, provenance-labelled,
	// never backdated, and with event-time-unrecoverable fields
	// (actor_role, company_id, request context) written as null and
	// named in fields_missing — never re-read from current rows.
	// The INSERT rides THIS transaction client directly (the GAP-I
	// fold precedent: auditLogService.logEvent uses the global pool
	// and is not transactional), so replay + deletion are atomic.
	// Idempotent via payload dead_letter_marker_id. ANY drain failure
	// throws ComplianceAuditDrainError: both production callers wrap
	// erasePersonalData in BEGIN…COMMIT, so the whole erasure rolls
	// back — fail-closed, nothing deleted, retryable once the trail
	// fault is fixed. No proceed-despite-failure fallback is built;
	// that trade-off against the Art. 17 clock is Sumanth's to rule.
	if (c2AiScreeningIds.length > 0) {
		const { rows: deadLetterMarkers } = await c2Query(
			`SELECT id, screening_id, actor_id, metadata, created_at
			 FROM ai_screening_audit_logs
			 WHERE screening_id = ANY($1) AND action = 'compliance_audit_failed'
			 ORDER BY id ASC`,
			[c2AiScreeningIds],
		);
		let drainChainLockHeld = false;
		for (const marker of deadLetterMarkers) {
			try {
				const metadata =
					typeof marker.metadata === 'string'
						? JSON.parse(marker.metadata)
						: marker.metadata || {};
				const { rows: alreadyReplayed } = await c2Query(
					`SELECT id FROM compliance_audit_trail
					 WHERE payload->>'dead_letter_marker_id' = $1 LIMIT 1`,
					[String(marker.id)],
				);
				if (alreadyReplayed.length > 0) {
					complianceAuditMarkersDrained++;
					continue;
				}
				const eventType = metadata.event_type;
				if (eventType !== 'ai_decision' && eventType !== 'human_override') {
					throw new Error(`unknown dead-letter event_type: ${eventType}`);
				}
				const { rows: screeningRows } = await c2Query(
					'SELECT id, job_id, candidate_id, fit_score, recommendation FROM ai_screenings WHERE id = $1',
					[marker.screening_id],
				);
				if (!screeningRows[0]) {
					throw new Error(
						`source ai_screenings row ${marker.screening_id} missing at drain`,
					);
				}
				const screening = screeningRows[0];
				const entityId = metadata.entity_id ?? screening.candidate_id;
				const fieldsMissing = ['actor_role', 'company_id', 'request_context'];
				let payload;
				let fieldsReconstructed;
				if (eventType === 'ai_decision') {
					payload = {
						screening_id: marker.screening_id,
						inputs: { candidate_id: screening.candidate_id, job_id: screening.job_id },
						outputs: {
							fit_score: screening.fit_score,
							recommendation: screening.recommendation,
						},
						model_version: 'recruiter-screener-v1',
					};
					fieldsReconstructed = [
						'screening_id',
						'inputs',
						'outputs.fit_score',
						'outputs.recommendation',
						'model_version',
						'job_id',
						'entity_id',
					];
					// The marker does not record single-vs-batch; the
					// batch callsite never carried these fields (and
					// carried a `batch: true` flag the single callsite
					// lacks), so they are named missing rather than
					// completed by guessing (Lex, STOP 1 #1337;
					// reviewer note N1, #1337). Reconstruction also
					// reads CURRENT source-row state: ai_screenings /
					// human reviews upsert, so a re-screen or re-review
					// between the failed write and erasure is what the
					// replay carries — disclosed by the provenance
					// labels, not hidden (reviewer note N4).
					fieldsMissing.push(
						'batch',
						'outputs.recommendation_reason',
						'outputs.matched_skills',
						'outputs.missing_skills',
					);
				} else {
					const { rows: reviewRows } = await c2Query(
						'SELECT decision, reason FROM ai_screening_human_reviews WHERE screening_id = $1 AND reviewer_id = $2',
						[marker.screening_id, marker.actor_id],
					);
					if (!reviewRows[0]) {
						throw new Error(
							`source ai_screening_human_reviews row missing at drain for screening ${marker.screening_id}`,
						);
					}
					payload = {
						screening_id: marker.screening_id,
						override_decision: reviewRows[0].decision,
						reason: reviewRows[0].reason,
						original_ai_status: 'pending',
					};
					fieldsReconstructed = [
						'screening_id',
						'override_decision',
						'reason',
						'original_ai_status',
						'job_id',
						'entity_id',
					];
				}
				payload = {
					...payload,
					replayed_from_dead_letter: true,
					dead_letter_marker_id: marker.id,
					original_event_failed_at:
						marker.created_at instanceof Date
							? marker.created_at.toISOString()
							: marker.created_at,
					reconstruction_source:
						'ai_screenings/ai_screening_human_reviews at erasure drain (#1337)',
					original_payload_stored: false,
					fields_reconstructed: fieldsReconstructed,
					fields_missing: fieldsMissing,
					fields_inferred: ['entity_type'],
				};
				// #1989: take the compliance-audit-chain advisory lock on THIS
				// transaction's own client before reading the chain tip — the
				// same key logEvent (#1988) and writePanelAudit (#1961) take.
				// Xact-scoped: released at the erasure COMMIT/ROLLBACK, so
				// replay + deletion stay atomic. Once per drain (advisory
				// xact locks stack per acquisition), inside this try so a
				// lock failure surfaces as ComplianceAuditDrainError below
				// and aborts the erasure fail-closed. NOT a leaf lock
				// transaction-wide (review M1, #1989): it is held until the
				// erasure COMMIT/ROLLBACK, through the erasure's remainder —
				// concurrent chain appends wait, and logEvent/panel bound
				// that wait with their 2s lock_timeout and fail closed. A
				// different-key per-user advisory lock is taken later in
				// this transaction (observer-audio leg); the order is
				// chain -> per-user everywhere in-tree, so no cycle.
				if (!drainChainLockHeld) {
					await c2Query(
						`SELECT pg_advisory_xact_lock(hashtext('compliance-audit-chain'))`,
					);
					drainChainLockHeld = true;
				}
				const { rows: hashRows } = await c2Query(
					'SELECT current_hash FROM compliance_audit_trail ORDER BY created_at DESC, id DESC LIMIT 1',
				);
				const previousHash = hashRows[0]?.current_hash || GENESIS_HASH;
				const createdAt = new Date().toISOString();
				const currentHash = computeTrailHash(
					previousHash,
					eventType,
					entityId,
					marker.actor_id ?? null,
					payload,
					createdAt,
				);
				await c2Query(
					`INSERT INTO compliance_audit_trail
					 (event_type, entity_type, entity_id, actor_id, actor_role, job_id, company_id, payload, previous_hash, current_hash, created_at)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
					[
						eventType,
						'candidate',
						entityId,
						marker.actor_id ?? null,
						null,
						screening.job_id,
						null,
						JSON.stringify(payload),
						previousHash,
						currentHash,
						createdAt,
					],
				);
				complianceAuditMarkersDrained++;
			} catch (drainErr) {
				console.error(
					`[ALERT] [erasure] #1337 compliance audit drain failed for user ${userId}, marker ${marker.id} — aborting erasure fail-closed (nothing deleted; retry after the trail fault is fixed):`,
					drainErr.message,
				);
				const err = new Error(
					`compliance_audit_failed dead-letter drain blocked erasure for user ${userId} (marker ${marker.id}): ${drainErr.message}`,
				);
				err.name = 'ComplianceAuditDrainError';
				err.code = 'COMPLIANCE_AUDIT_DRAIN_BLOCKED';
				throw err;
			}
		}
	}
	if (c2AiScreeningIds.length > 0) {
		aiScreeningAuditLogsDeleted = await c2DeleteByIds(
			'DELETE FROM ai_screening_audit_logs WHERE screening_id = ANY($1)',
			(ids) => [ids],
			c2AiScreeningIds,
		);
		aiScreeningHumanReviewsDeleted = await c2DeleteByIds(
			'DELETE FROM ai_screening_human_reviews WHERE screening_id = ANY($1)',
			(ids) => [ids],
			c2AiScreeningIds,
		);
	}
	aiScreeningsDeletedCount = await c2DeleteByIds(
		'DELETE FROM ai_screenings WHERE candidate_id = $1 AND id = ANY($2)',
		(ids) => [userId, ids],
		c2AiScreeningIds,
	);

	// outreach_attempts (user-keyed; application_id NOT NULL — no walk).
	const { rows: c2OutreachRows } = await c2Query(
		'SELECT id, application_id FROM outreach_attempts WHERE user_id = $1',
		[userId],
	);
	const c2OutreachIds = await c2Partition('outreach_attempts', c2OutreachRows, () => ({}));
	outreachAttemptsDeletedCount = await c2DeleteByIds(
		'DELETE FROM outreach_attempts WHERE user_id = $1 AND id = ANY($2)',
		(ids) => [userId, ids],
		c2OutreachIds,
	);

	// auto_apply_profiles (user-keyed, no application partition; entry
	// gate only) — D-2: tombstone captured BEFORE the whole-row DELETE.
	const { rows: c2AutoApplyRows } = await c2Query(
		'SELECT id, gdpr_consent, consent_date FROM auto_apply_profiles WHERE user_id = $1',
		[userId],
	);
	autoApplyConsentTombstone =
		c2AutoApplyRows.length > 0
			? {
					profileExisted: true,
					gdprConsent: c2AutoApplyRows[0].gdpr_consent ?? null,
					consentDate: c2AutoApplyRows[0].consent_date ?? null,
				}
			: null;
	if (c2AutoApplyRows.length > 0) {
		const { rowCount } = await c2Query('DELETE FROM auto_apply_profiles WHERE user_id = $1', [
			userId,
		]);
		autoApplyProfileDeletedCount = rowCount || 0;
	}

	// #807 (S-090): threat_intel_checks — whole-row DELETE keyed by the
	// inherited #780 unheld application set, in the C2 position (see the
	// header block). The parent job_applications row is retained as a
	// skeleton (#780), so migration 260's FK carries no cascade action
	// and this explicit counted DELETE is the only erasure branch.
	// NO new hold consult: the DELETE inherits the unheld set exactly
	// like the five C2 tables above, so the #1167 lesson does not
	// trigger. Held applications' rows survive whole and are counted
	// via one COUNT over the held set — issued only when that set is
	// non-empty. Retention default (Lex, #807): the whole row follows
	// the application's lifecycle; no separate period, no purge.
	let threatIntelChecksDeleted = 0;
	let threatIntelRowsHeld = 0;
	if (unheldApplicationIds.length > 0) {
		const { rowCount } = await queryable.query(
			'DELETE FROM threat_intel_checks WHERE job_application_id = ANY($1)',
			[unheldApplicationIds],
		);
		threatIntelChecksDeleted = rowCount || 0;
	}
	const heldApplicationIds = applicationRows
		.map((row) => row.id)
		.filter((id) => !unheldApplicationIdSet.has(id));
	if (heldApplicationIds.length > 0) {
		const { rows: threatHeldRows } = await queryable.query(
			'SELECT COUNT(*)::int AS n FROM threat_intel_checks WHERE job_application_id = ANY($1)',
			[heldApplicationIds],
		);
		threatIntelRowsHeld = threatHeldRows?.[0]?.n || 0;
	}

	// #815 (S-095): application_ip_captures — whole-row DELETE in the
	// same position and shape as the #807 block above (database-gate
	// ruling): keyed ONLY by the inherited #780 unheld application
	// set. Migration 261's FK carries no cascade action, so this
	// explicit counted DELETE is the only erasure branch. NO
	// candidate-keyed delete: a candidate_id clause would erase
	// legally-held applications' rows and break the hold invariant.
	// Held applications' rows survive whole and are counted in
	// applicationIpRowsHeld via one COUNT over the held set — issued
	// only when that set is non-empty. NO new hold consult (the block
	// inherits the held/unheld partition exactly like #807).
	let applicationIpCapturesDeleted = 0;
	let applicationIpRowsHeld = 0;
	if (unheldApplicationIds.length > 0) {
		const { rowCount } = await queryable.query(
			'DELETE FROM application_ip_captures WHERE job_application_id = ANY($1)',
			[unheldApplicationIds],
		);
		applicationIpCapturesDeleted = rowCount || 0;
	}
	if (heldApplicationIds.length > 0) {
		const { rows: applicationIpHeldRows } = await queryable.query(
			'SELECT COUNT(*)::int AS n FROM application_ip_captures WHERE job_application_id = ANY($1)',
			[heldApplicationIds],
		);
		applicationIpRowsHeld = applicationIpHeldRows?.[0]?.n || 0;
	}

	// S-047 (E-008, #695): AI Observer reports + job queue. Scoped by
	// interview_session_id → candidate_id. The observer never stores biometric
	// templates (frames analyzed in-memory), so this is report-data deletion,
	// not template destruction. Job queue rows reveal the candidate was under
	// biometric observation (session linkage + timing) — erase alongside.
	const { rowCount: observerReportRows } = await queryable.query(
		`DELETE FROM ai_observer_reports
		 WHERE interview_session_id IN (
		   SELECT id FROM interview_sessions WHERE candidate_id = $1
		 )`,
		[userId],
	);
	const { rowCount: observerJobRows } = await queryable.query(
		`DELETE FROM observer_jobs
		 WHERE interview_session_id IN (
		   SELECT id FROM interview_sessions WHERE candidate_id = $1
		 )`,
		[userId],
	);

	// GAP-A (a) (#1120) — supersedes the S-047 SHOULD-FIX 7 two-key strip
	// below it in history: the legacy Track B observer persists candidate
	// voice transcriptions in interview_sessions.config
	// (config.observer_transcript — biometric-derived data), session
	// writers merge flattened resume text + session reports into config,
	// and conversation/frame_analysis/invite_token were never touched at
	// all. Session rows are never deleted, so all of it survived erasure.
	// Fix: whole-column resets for the pure content containers + a config
	// ALLOWLIST reset (deny-lists are the failed mechanism — the next
	// writer's key would leak). Only biometric_collection is rebuilt into
	// config (consent FACT for Art. 7(1), mirroring recording_consent).
	// Per-row legal-hold consult FIRST (entry condition): a held session
	// is preserved whole, counted, and disclosed — never partially
	// stripped in silence. The consult is fail-closed (error ⇒ held ⇒
	// skip) via gapAContainedHeld below.
	// #1167: GAP-A's consults used isHeld, which self-catches inside
	// legalHold.js — a swallowed PG error never throws here, yet it
	// poisons the caller's transaction (the next statement dies 25P02
	// and the caller rolls back wholesale). Contained findActiveHold
	// instead, mapped onto GAP-A's contract: held := (hold != null);
	// a contained throw ⇒ held (GAP-A has NO lookup-failed bucket —
	// error≡held is its designed contract, unchanged).
	const gapAContainedHeld = async (subject) => {
		try {
			return (await containedConsult(() => findActiveHold(subject, queryable))) != null;
		} catch (holdErr) {
			// #1197: parity with every other partition — a hold-check
			// failure must be operator-visible (message only: no subject,
			// no user/company ids, no row values), not silently discarded.
			console.error(
				'[erasureService] #1197 GAP-A per-row legal-hold check failed — failing closed (skipping row, counted as held):',
				holdErr.message,
			);
			return true;
		}
	};
	const gapASessionRes = await queryable.query(
		'SELECT id FROM interview_sessions WHERE candidate_id = $1',
		[userId],
	);
	const gapASessionRows = gapASessionRes?.rows || [];
	const unheldSessionIds = [];
	let sessionsHeld = 0;
	for (const sessionRow of gapASessionRows) {
		if (await gapAContainedHeld({ userId, sessionId: sessionRow.id })) {
			sessionsHeld++;
		} else {
			unheldSessionIds.push(sessionRow.id);
		}
	}
	let sessionsStripped = 0;
	if (unheldSessionIds.length > 0) {
		const stripRes = await queryable.query(
			`UPDATE interview_sessions
			 SET conversation = '[]'::jsonb,
			     frame_analysis = '{}'::jsonb,
			     invite_token = NULL,
			     config = CASE WHEN config ? 'biometric_collection'
			              THEN jsonb_build_object('biometric_collection', config->'biometric_collection')
			              ELSE '{}'::jsonb END
			 WHERE candidate_id = $1 AND id = ANY($2)`,
			[userId, unheldSessionIds],
		);
		sessionsStripped = stripRes?.rowCount || 0;
	}

	// GAP-A (c) (#1120): recording objects. Enumerate the candidate's
	// interview_recordings via BOTH attributions (event join + session
	// branch — the same mig-130 XOR repair as the transcript DELETE).
	// Per-row hold consult before anything is ledgered or redacted.
	// Unheld rows: decrypt the shared-key storage pointer, ledger the
	// egress object IN-TX (source_family='livekit_recording') for the
	// Phase-2 drain, and keep-redact the row (status='deleted',
	// storage_path=NULL). Hard-deleting the row is FORBIDDEN:
	// recording_consent.recording_id is ON DELETE CASCADE (mig 128) and
	// the consent fact must survive. A pointer that will not decrypt
	// FAILS CLOSED like a held row: the object cannot be inventoried, so
	// the row is NOT redacted (redaction would destroy the only pointer
	// to a surviving object) — it is preserved, counted, and disclosed
	// via recordingsUndecryptable.
	const gapARecordingRes = await queryable.query(
		`SELECT ir.id, ir.storage_path, ir.interview_event_id, ir.interview_session_id,
		        ir.panel_expected_user_ids, ir.panel_expected_hash
		 FROM interview_recordings ir
		 LEFT JOIN interview_events ie ON ie.id = ir.interview_event_id
		 WHERE ie.candidate_id = $1
		    OR ir.interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)`,
		[userId],
	);
	const gapARecordingRows = gapARecordingRes?.rows || [];
	const { decrypt: decryptRecordingPointer } = require('../services/encryption');
	const recordingLedgerKeys = [];
	const unheldRecordingIds = [];
	let recordingsHeld = 0;
	let tombstonePanelPairsCleared = 0;
	let recordingsUndecryptable = 0;
	for (const recordingRow of gapARecordingRows) {
		const held = await gapAContainedHeld({
			userId,
			sessionId: recordingRow.interview_session_id ?? undefined,
		});
		if (held) {
			recordingsHeld++;
			continue;
		}
		if (recordingRow.storage_path) {
			let location = null;
			try {
				location = decryptRecordingPointer(Buffer.from(recordingRow.storage_path)).toString('utf-8');
			} catch (decryptErr) {
				console.error(
					'[erasureService] GAP-A: recording storage_path decrypt failed — preserving row (pointer is the only inventory of a surviving object):',
					decryptErr.message,
				);
			}
			if (!location) {
				recordingsUndecryptable++;
				continue;
			}
			recordingLedgerKeys.push(location);
		}
		unheldRecordingIds.push(recordingRow.id);
		// #2014 (item 3): the pair this row's tombstone is about to
		// lose in the redact below — counted here, from the pre-redact
		// enumeration, so the disclosure names exactly the rows whose
		// panel pair was cleared (held rows never reach this point).
		// #2019 shape: the redact sets the array to '{}' (empty), NOT
		// NULL — a NULL array makes participantsFromFrozenSet return
		// null and callers fall back to the LIVE event roster,
		// resurrecting assignability the freeze exists to prevent
		// (Lex full-report condition; K-12 precedent panel_member_ids
		// = '{}'). The hash is nulled.
		if (recordingRow.panel_expected_user_ids != null || recordingRow.panel_expected_hash != null) {
			tombstonePanelPairsCleared++;
		}
	}
	for (const location of recordingLedgerKeys) {
		await queryable.query(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
       VALUES ($1, $2, 'r2', 'pending', 'livekit_recording')`,
			[userId, location],
		);
	}
	let recordingsRedacted = 0;
	if (unheldRecordingIds.length > 0) {
		const redactRes = await queryable.query(
			`UPDATE interview_recordings
			 SET status = 'deleted', storage_path = NULL, diarization_status = NULL, diarization_updated_at = NULL, panel_expected_user_ids = '{}', panel_expected_hash = NULL, updated_at = NOW()
			 WHERE id = ANY($1)`,
			[unheldRecordingIds],
		);
		recordingsRedacted = redactRes?.rowCount || 0;
	}

	// GAP-A frames (#1120): candidate-keyed recording_objects rows of
	// type 'frame' (lib/r2FrameStore.js) enter the same ledger path —
	// each object_key ledgered with the observer-audio /api/files
	// encoding (its object_key is already provider-prefixed, so Phase 2's
	// deleteFile addresses it), then the registry row is STAMPED
	// deleted_at, not deleted (registry = audit that the object existed
	// and was erased). Type 'recording' rows carry candidate_id NULL
	// (dormant writer) and cannot match this candidate-keyed select.
	const gapAFrameRes = await queryable.query(
		`SELECT object_key, interview_id FROM recording_objects
		 WHERE candidate_id = $1 AND object_type = 'frame' AND deleted_at IS NULL`,
		[userId],
	);
	const gapAFrameRows = gapAFrameRes?.rows || [];
	const frameLedgerKeys = [];
	const unheldFrameKeys = [];
	let framesHeld = 0;
	for (const frameRow of gapAFrameRows) {
		const held = await gapAContainedHeld({
			userId,
			sessionId: frameRow.interview_id ?? undefined,
		});
		if (held) {
			framesHeld++;
			continue;
		}
		if (frameRow.object_key) {
			// recording_objects has no `id` column (mig 253): object_key is
			// the PRIMARY KEY — unheld frames are tracked/stamped by it.
			unheldFrameKeys.push(frameRow.object_key);
			frameLedgerKeys.push(`/api/files/${encodeURIComponent(frameRow.object_key)}`);
		}
	}
	for (const key of frameLedgerKeys) {
		await queryable.query(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
       VALUES ($1, $2, 'r2', 'pending', 'frame')`,
			[userId, key],
		);
	}
	if (unheldFrameKeys.length > 0) {
		await queryable.query(
			`UPDATE recording_objects SET deleted_at = NOW()
			 WHERE candidate_id = $1 AND object_type = 'frame' AND deleted_at IS NULL AND object_key = ANY($2)`,
			[userId, unheldFrameKeys],
		);
	}
	const gapAHeldSkips = sessionsHeld + recordingsHeld + framesHeld;

	// Collect + dedupe storage keys for Phase 2. R2/B2 URLs go through
	// deleteFile(); local-disk paths (verification_requests) go through
	// deleteEncryptedFile().
	const r2Keys = [
		...new Set(
			[
				...cvUploadRows.map((r) => r.file_url),
				...parsedResumeRows.map((r) => r.file_url),
				...profileRows.flatMap((r) => [r.resume_url, r.photo_url]),
				...verificationDocRows.map((r) => r.file_url),
				...messageRows.map((r) => r.file_url),
			].filter(Boolean),
		),
	];
	const localPaths = [
		...new Set(
			[
				...verificationRequestRows.flatMap((r) => [
					r.id_document_encrypted_url,
					r.selfie_encrypted_url,
				]),
			].filter(Boolean),
		),
	];

	// Q3: persist the pending-deletion ledger IN-TX. If the process crashes
	// between COMMIT and Phase 2, the S-077 cron sweeps 'pending' entries.
	for (const key of r2Keys) {
		await queryable.query(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status)
       VALUES ($1, $2, 'r2', 'pending')`,
			[userId, key],
		);
	}
	for (const p of localPaths) {
		await queryable.query(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status)
       VALUES ($1, $2, 'local', 'pending')`,
			[userId, p],
		);
	}

	// Gate A (S-085 #787, design §5.2): observer-audio family.
	// destroyDEK() above already ran FIRST — chunk ciphertext is
	// unreadable even if a capture writer races this block; the advisory
	// lock (shared with the capture writers in lib/observerCapture.js)
	// serialises enumeration against chunk-persist confirms for the rest
	// of the transaction. Registry rows are STAMPED deleted_at, not
	// deleted — the registry is the audit that the objects existed and
	// were erased. Chunk keys are ledgered with source_family=
	// 'observer_audio' (P-19) so Phase 2 + verification count them
	// distinctly from the legacy 'file' family. Outcome rows are counts-
	// only capture audit; account erasure removes them too (Art. 17) —
	// the RETENTION purge paths never touch them.
	await queryable.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [String(userId)]);
	const oaRegistryRes = await queryable.query(
		`SELECT object_key FROM recording_objects
		 WHERE candidate_id = $1 AND object_type = 'observer_audio' AND deleted_at IS NULL`,
		[userId],
	);
	const oaChunkRes = await queryable.query(
		`DELETE FROM observer_audio_chunks WHERE candidate_id = $1 RETURNING object_key`,
		[userId],
	);
	const observerAudioObjectKeys = [
		...new Set([
			...((oaRegistryRes?.rows || []).map((r) => r.object_key)),
			...((oaChunkRes?.rows || []).map((r) => r.object_key)),
		]),
	].filter(Boolean);
	const observerAudioKeys = observerAudioObjectKeys.map(
		(k) => `/api/files/${encodeURIComponent(k)}`,
	);
	for (const key of observerAudioKeys) {
		await queryable.query(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
       VALUES ($1, $2, 'r2', 'pending', 'observer_audio')`,
			[userId, key],
		);
	}
	const oaMeasurementsRes = await queryable.query(
		`DELETE FROM observer_speech_measurements WHERE candidate_id = $1`,
		[userId],
	);
	const oaOutcomesRes = await queryable.query(
		`DELETE FROM observer_capture_outcomes WHERE candidate_id = $1`,
		[userId],
	);
	await queryable.query(
		`UPDATE recording_objects SET deleted_at = NOW()
		 WHERE candidate_id = $1 AND object_type = 'observer_audio' AND deleted_at IS NULL`,
		[userId],
	);

	// ── #1123 GAP-D (E-12): BGV & onboarding family ─────────────────────
	// Every family below: SELECT the candidate's rows, per-row legal-hold
	// consult (the row's own company_id where one exists — via the row,
	// its checklist→offer link, or its plan), then explicit DELETE/UPDATE
	// of the unheld ids only. Held rows are preserved, counted in
	// gapD.rowsHeld, and named in gapD.heldTables.
	const collectGapDStorage = (url) => {
		if (!url) return;
		if (typeof url === 'string' && url.startsWith('/api/files/')) {
			if (!gapDStorageKeys.includes(url) && !r2Keys.includes(url)) gapDStorageKeys.push(url);
		} else if (!gapD.nonPatternStorageUrls.includes(url)) {
			// Client-supplied URL the storage ledger cannot address
			// (deleteFile only handles /api/files/ URLs). Named
			// explicitly in the result — never silently skipped.
			gapD.nonPatternStorageUrls.push(url);
		}
	};

	// Delete order (ruled): candidate_onboarding_data and
	// onboarding_documents BEFORE onboarding_checklists (both FK to it).
	await gapDDeleteFamily(
		'candidate_onboarding_data',
		'candidateOnboardingData',
		`SELECT cod.id, o.company_id AS company_id
		 FROM candidate_onboarding_data cod
		 LEFT JOIN onboarding_checklists cl ON cl.id = cod.checklist_id
		 LEFT JOIN offers o ON o.id = cl.offer_id
		 WHERE cod.candidate_id = $1`,
		'DELETE FROM candidate_onboarding_data WHERE candidate_id = $1 AND id = ANY($2)',
	);
	const gapDDocRes = await gapDDeleteFamily(
		'onboarding_documents',
		'onboardingDocuments',
		'SELECT id, company_id, document_url FROM onboarding_documents WHERE candidate_id = $1',
		'DELETE FROM onboarding_documents WHERE candidate_id = $1 AND id = ANY($2)',
	);
	// Only unheld (deleted) rows ledger their objects — a held row's
	// object is held material and must survive with the row.
	for (const row of gapDDocRes.unheldRows) collectGapDStorage(row.document_url);
	await gapDDeleteFamily(
		'onboarding_checklists',
		'onboardingChecklists',
		`SELECT cl.id, o.company_id AS company_id
		 FROM onboarding_checklists cl
		 LEFT JOIN offers o ON o.id = cl.offer_id
		 WHERE cl.candidate_id = $1`,
		'DELETE FROM onboarding_checklists WHERE candidate_id = $1 AND id = ANY($2)',
	);
	await gapDDeleteFamily(
		'onboarding_chats',
		'onboardingChats',
		`SELECT ch.id, COALESCE(p.company_id, o.company_id) AS company_id
		 FROM onboarding_chats ch
		 LEFT JOIN onboarding_plans p ON p.id = ch.plan_id
		 LEFT JOIN onboarding_checklists cl ON cl.id = ch.checklist_id
		 LEFT JOIN offers o ON o.id = cl.offer_id
		 WHERE ch.candidate_id = $1`,
		'DELETE FROM onboarding_chats WHERE candidate_id = $1 AND id = ANY($2)',
	);

	// Onboarding plans + tasks: tasks are plan-scoped (no candidate FK)
	// and die only via an explicit delete; a task is held iff its plan
	// is held (the plan partition already consulted the plan's company).
	const { rows: gapDPlanRows } = await gapDQuery(
		'SELECT id, company_id FROM onboarding_plans WHERE candidate_id = $1',
		[userId],
	);
	const gapDPlanPart = await gapDPartition(gapDPlanRows);
	gapDNoteHeld('onboarding_plans', gapDPlanPart.held);
	gapDNoteLookupFailed('onboarding_plans', gapDPlanPart.lookupFailed);
	const gapDUnheldPlanIds = new Set(gapDPlanPart.unheld.map((r) => r.id));
	const gapDHeldPlanIds = new Set(gapDPlanPart.heldRows.map((r) => r.id));
	const gapDFailedPlanIds = new Set(gapDPlanPart.failedRows.map((r) => r.id));
	const gapDSurvivingPlanIds = new Set([...gapDHeldPlanIds, ...gapDFailedPlanIds]);
	const { rows: gapDTaskRows } = await gapDQuery(
		`SELECT t.id, t.plan_id FROM onboarding_tasks t
		 JOIN onboarding_plans p ON p.id = t.plan_id
		 WHERE p.candidate_id = $1`,
		[userId],
	);
	const gapDUnheldTasks = gapDTaskRows.filter((t) => !gapDSurvivingPlanIds.has(t.plan_id));
	gapDNoteHeld(
		'onboarding_tasks',
		gapDTaskRows.filter((t) => gapDHeldPlanIds.has(t.plan_id)).length,
	);
	gapDNoteLookupFailed(
		'onboarding_tasks',
		gapDTaskRows.filter((t) => gapDFailedPlanIds.has(t.plan_id)).length,
	);
	if (gapDUnheldTasks.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM onboarding_tasks WHERE id = ANY($1)', [
			gapDUnheldTasks.map((t) => t.id),
		]);
		gapD.onboardingTasks = rowCount || 0;
	}
	if (gapDPlanPart.unheld.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM onboarding_plans WHERE candidate_id = $1 AND id = ANY($2)',
			[userId, gapDPlanPart.unheld.map((r) => r.id)],
		);
		gapD.onboardingPlans = rowCount || 0;
	}

	// BGV family: discrepancies have no candidate_id — they are deleted
	// EXPLICITLY by parent (bg_verification_requests) ids FIRST, never
	// cascade-assumed. reference_checks (referee third-party PII, Q5
	// hard-delete) go before employment_history, whose embedded referee
	// columns die with its rows.
	const { rows: gapDBgRows } = await gapDQuery(
		'SELECT id FROM bg_verification_requests WHERE candidate_id = $1',
		[userId],
	);
	const gapDBgPart = await gapDPartition(gapDBgRows, () => null);
	gapDNoteHeld('bg_verification_requests', gapDBgPart.held);
	gapDNoteLookupFailed('bg_verification_requests', gapDBgPart.lookupFailed);
	const gapDHeldBgIds = new Set(gapDBgPart.heldRows.map((r) => r.id));
	const gapDFailedBgIds = new Set(gapDBgPart.failedRows.map((r) => r.id));
	const gapDSurvivingBgIds = new Set([...gapDHeldBgIds, ...gapDFailedBgIds]);
	if (gapDBgRows.length > 0) {
		const { rows: gapDDiscRows } = await gapDQuery(
			'SELECT id, verification_request_id FROM discrepancies WHERE verification_request_id = ANY($1)',
			[gapDBgRows.map((r) => r.id)],
		);
		const gapDUnheldDisc = gapDDiscRows.filter((d) => !gapDSurvivingBgIds.has(d.verification_request_id));
		gapDNoteHeld(
			'discrepancies',
			gapDDiscRows.filter((d) => gapDHeldBgIds.has(d.verification_request_id)).length,
		);
		gapDNoteLookupFailed(
			'discrepancies',
			gapDDiscRows.filter((d) => gapDFailedBgIds.has(d.verification_request_id)).length,
		);
		if (gapDUnheldDisc.length > 0) {
			const { rowCount } = await gapDQuery(
				'DELETE FROM discrepancies WHERE verification_request_id = ANY($1)',
				[[...new Set(gapDUnheldDisc.map((d) => d.verification_request_id))]],
			);
			gapD.discrepancies = rowCount || 0;
		}
	}
	if (gapDBgPart.unheld.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM bg_verification_requests WHERE candidate_id = $1 AND id = ANY($2)',
			[userId, gapDBgPart.unheld.map((r) => r.id)],
		);
		gapD.bgVerificationRequests = rowCount || 0;
	}
	await gapDDeleteFamily(
		'reference_checks',
		'referenceChecks',
		'SELECT id FROM reference_checks WHERE candidate_id = $1',
		'DELETE FROM reference_checks WHERE candidate_id = $1 AND id = ANY($2)',
	);
	await gapDDeleteFamily(
		'employment_history',
		'employmentHistory',
		'SELECT id FROM employment_history WHERE candidate_id = $1',
		'DELETE FROM employment_history WHERE candidate_id = $1 AND id = ANY($2)',
	);
	await gapDDeleteFamily(
		'education_history',
		'educationHistory',
		'SELECT id FROM education_history WHERE candidate_id = $1',
		'DELETE FROM education_history WHERE candidate_id = $1 AND id = ANY($2)',
	);

	// Offers (Q6): redact-to-skeleton — the joint candidate/company
	// record is retained (K-3 precedent); the candidate's content,
	// signature and the signed-letter pointer are nulled, and the
	// signature_url object is ledgered for Phase 2. NOTE: salary was
	// NOT NULL in migration 014 — this UPDATE is executable only
	// because migration 259 drops that constraint (PR-gate fix P-1;
	// the ruled NULL set below is unchanged).
	const { rows: gapDOfferRows } = await gapDQuery(
		'SELECT id, company_id, signature_url FROM offers WHERE candidate_id = $1',
		[userId],
	);
	const gapDOfferPart = await gapDPartition(gapDOfferRows);
	gapDNoteHeld('offers', gapDOfferPart.held);
	gapDNoteLookupFailed('offers', gapDOfferPart.lookupFailed);
	if (gapDOfferPart.unheld.length > 0) {
		const { rowCount } = await gapDQuery(
			`UPDATE offers
			 SET salary = NULL,
			     benefits = NULL,
			     template_data = NULL,
			     offer_letter_html = NULL,
			     candidate_signature = NULL,
			     candidate_signed_at = NULL,
			     candidate_sign_ip = NULL,
			     decline_reason = NULL,
			     signature_url = NULL,
			     updated_at = NOW()
			 WHERE candidate_id = $1 AND id = ANY($2)`,
			[userId, gapDOfferPart.unheld.map((r) => r.id)],
		);
		gapD.offersRedacted = rowCount || 0;
		for (const row of gapDOfferPart.unheld) collectGapDStorage(row.signature_url);
	}

	// Signature family split (STOP 1 §3D2). Linkage: signing_parties
	// carries user_id; signature_requests join parties to documents;
	// signature_documents are keyed by created_by + company_id.
	// Scoped by user_id only — parties with user_id NULL are external
	// signers, not this account's rows.
	const { rows: gapDPartyRows } = await gapDQuery(
		'SELECT id, company_id FROM signing_parties WHERE user_id = $1',
		[userId],
	);
	const gapDPartyIds = gapDPartyRows.map((r) => r.id);
	let gapDCandidateRequests = [];
	if (gapDPartyIds.length > 0) {
		const { rows } = await gapDQuery(
			'SELECT id, document_id, party_id FROM signature_requests WHERE party_id = ANY($1)',
			[gapDPartyIds],
		);
		gapDCandidateRequests = rows;
	}
	const gapDLinkedDocIds = [...new Set(gapDCandidateRequests.map((r) => r.document_id))];
	const { rows: gapDSigDocRows } = await gapDQuery(
		'SELECT id, company_id, created_by, file_url FROM signature_documents WHERE created_by = $1 OR id = ANY($2)',
		[userId, gapDLinkedDocIds],
	);
	let gapDDocPartyRows = [];
	if (gapDSigDocRows.length > 0) {
		const { rows } = await gapDQuery(
			'SELECT document_id, party_id FROM signature_requests WHERE document_id = ANY($1)',
			[gapDSigDocRows.map((r) => r.id)],
		);
		gapDDocPartyRows = rows;
	}
	const gapDPartiesByDoc = new Map();
	for (const row of gapDDocPartyRows) {
		if (!gapDPartiesByDoc.has(row.document_id)) gapDPartiesByDoc.set(row.document_id, []);
		gapDPartiesByDoc.get(row.document_id).push(row.party_id);
	}
	// A document is candidate-scoped (deletable) only when the candidate
	// is its creator or a party AND no other party has a request on it —
	// a company record with other parties survives, and only the
	// candidate's linkage on it is severed (requests + party PII below;
	// created_by is retained as the accountability skeleton, mirroring
	// the offers skeleton's retained candidate_id).
	const gapDDeletableDocs = [];
	const gapDSurvivingDocs = [];
	const gapDHeldDocIds = new Set();
	const gapDFailedDocIds = new Set();
	for (const doc of gapDSigDocRows) {
		const docHoldStatus = await gapDRowHoldCheck(doc.company_id ?? null);
		if (docHoldStatus === 'held') {
			gapDHeldDocIds.add(doc.id);
			continue;
		}
		if (docHoldStatus === 'lookup-failed') {
			gapDFailedDocIds.add(doc.id);
			continue;
		}
		const docParties = gapDPartiesByDoc.get(doc.id) || [];
		const hasOtherParty = docParties.some((p) => !gapDPartyIds.includes(p));
		const candidateIsParty = docParties.some((p) => gapDPartyIds.includes(p));
		if ((doc.created_by === userId || candidateIsParty) && !hasOtherParty) {
			gapDDeletableDocs.push(doc);
		} else {
			gapDSurvivingDocs.push(doc);
		}
	}
	gapDNoteHeld('signature_documents', gapDHeldDocIds.size);
	gapDNoteLookupFailed('signature_documents', gapDFailedDocIds.size);
	// Candidate-as-party signature_requests: the signature blob +
	// metadata are content — DELETE on every unheld document (held
	// documents keep theirs: held material is preserved whole;
	// lookup-failed documents keep theirs too, counted separately).
	const gapDSurvivingDocIdsForRequests = new Set([...gapDHeldDocIds, ...gapDFailedDocIds]);
	const gapDUnheldRequests = gapDCandidateRequests.filter(
		(r) => !gapDSurvivingDocIdsForRequests.has(r.document_id),
	);
	gapDNoteHeld(
		'signature_requests',
		gapDCandidateRequests.filter((r) => gapDHeldDocIds.has(r.document_id)).length,
	);
	gapDNoteLookupFailed(
		'signature_requests',
		gapDCandidateRequests.filter((r) => gapDFailedDocIds.has(r.document_id)).length,
	);
	if (gapDUnheldRequests.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM signature_requests WHERE id = ANY($1)', [
			gapDUnheldRequests.map((r) => r.id),
		]);
		gapD.signatureRequests = rowCount || 0;
	}
	// Candidate-scoped documents: their document_hash_records and
	// signature_audit_events are deleted EXPLICITLY (never
	// cascade-assumed), then the document row, and its file_url object
	// is ledgered. Audit events are deleted here only as part of the
	// document's own erasure — they are never UPDATEd or rewritten.
	if (gapDDeletableDocs.length > 0) {
		const docIds = gapDDeletableDocs.map((d) => d.id);
		const { rowCount: hashRows } = await gapDQuery(
			'DELETE FROM document_hash_records WHERE document_id = ANY($1)',
			[docIds],
		);
		gapD.documentHashRecords = hashRows || 0;
		const { rowCount: auditRows } = await gapDQuery(
			'DELETE FROM signature_audit_events WHERE document_id = ANY($1)',
			[docIds],
		);
		gapD.signatureAuditEvents = auditRows || 0;
		const { rowCount } = await gapDQuery(
			'DELETE FROM signature_documents WHERE id = ANY($1)',
			[docIds],
		);
		gapD.signatureDocuments = rowCount || 0;
		for (const doc of gapDDeletableDocs) collectGapDStorage(doc.file_url);
	}
	// Signing parties: DELETE only when every document they touch is
	// being deleted (or they touch none); REDACT the party PII when any
	// touched document survives (the row is shared — deleting it would
	// cascade into the surviving document's requests). Redaction uses
	// the users-tombstone shape (synthetic deleted.local address).
	const gapDSurvivingDocIds = new Set(gapDSurvivingDocs.map((d) => d.id));
	const gapDPartiesToDelete = [];
	const gapDPartiesToRedact = [];
	let gapDHeldParties = 0;
	let gapDFailedParties = 0;
	// Bucket precedence (#1154, privacy-review note): a held-document
	// touch outranks a failed-document touch, and either document
	// touch outranks the party's own consult (which then never runs).
	// Totals stay exact — every surviving party is counted exactly
	// once — but the bucket is the FIRST matching reason in that
	// order, not a per-row reason list (cf. #813's held details).
	for (const party of gapDPartyRows) {
		const partyDocIds = [
			...new Set(
				gapDCandidateRequests.filter((r) => r.party_id === party.id).map((r) => r.document_id),
			),
		];
		if (partyDocIds.some((id) => gapDHeldDocIds.has(id))) {
			gapDHeldParties++;
			continue;
		}
		if (partyDocIds.some((id) => gapDFailedDocIds.has(id))) {
			gapDFailedParties++;
			continue;
		}
		const partyHoldStatus = await gapDRowHoldCheck(party.company_id ?? null);
		if (partyHoldStatus === 'held') {
			gapDHeldParties++;
			continue;
		}
		if (partyHoldStatus === 'lookup-failed') {
			gapDFailedParties++;
			continue;
		}
		if (partyDocIds.some((id) => gapDSurvivingDocIds.has(id))) gapDPartiesToRedact.push(party);
		else gapDPartiesToDelete.push(party);
	}
	gapDNoteHeld('signing_parties', gapDHeldParties);
	gapDNoteLookupFailed('signing_parties', gapDFailedParties);
	if (gapDPartiesToDelete.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM signing_parties WHERE id = ANY($1)', [
			gapDPartiesToDelete.map((p) => p.id),
		]);
		gapD.signingPartiesDeleted = rowCount || 0;
	}
	for (const party of gapDPartiesToRedact) {
		// Privacy-review fix (in-pass, #1123): the ruled redact set
		// (email/full_name/phone) plus job_title and metadata — the
		// party metadata JSONB is an unclassified bucket (migration 066
		// notes it can carry government-ID verification data), so it
		// must not survive as a re-identification vector.
		const { rowCount } = await gapDQuery(
			"UPDATE signing_parties SET email = $1, full_name = $2, phone = NULL, user_id = NULL, job_title = NULL, metadata = '{}'::jsonb WHERE id = $3",
			[`erased-party-${party.id}@deleted.local`, 'Erased Party', party.id],
		);
		gapD.signingPartiesRedacted += rowCount || 0;
	}
	// NAMED RESIDUAL: signature_audit_events on surviving company
	// documents are NOT rewritten (hash chain) — the candidate's
	// actor_email/actor_id on those events survives this erasure and
	// is disclosed here as a count, clock OPEN — counsel (STOP 1 §3D2).
	// The count is a LOWER BOUND (PR-gate P-2): it counts only
	// actor-linked events (actor_id = userId). The sole writer
	// (server/services/signatureService.js _logAuditEvent) writes
	// signer-path events with actor_id NULL — those are attributable
	// to the candidate only via party_id, and a party-linked widening
	// was examined and NOT taken: every such event also carries
	// request_id = the candidate's own signature_requests row
	// (migration 066: signature_audit_events.request_id → 
	// signature_requests ON DELETE CASCADE), and those requests are
	// deleted earlier in this same block, so the party-linked events
	// do not survive to be counted here. Any event with both
	// actor_id and party_id NULL is likewise uncountable. Read
	// signatureAuditResidual as "at least this many", never exact.
	if (gapDSurvivingDocs.length > 0) {
		const { rows } = await gapDQuery(
			'SELECT COUNT(*)::int AS c FROM signature_audit_events WHERE document_id = ANY($1) AND actor_id = $2',
			[gapDSurvivingDocs.map((d) => d.id), userId],
		);
		gapD.signatureAuditResidual = rows[0]?.c || 0;
	}

	// GAP-D storage objects: ledger in-tx (crash-safe, S-076 pattern);
	// Phase 2 (deleteErasedStorageFiles) drains them post-commit and
	// re-consults legal hold per entry.
	for (const key of gapDStorageKeys) {
		await gapDQuery(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status)
       VALUES ($1, $2, 'r2', 'pending')`,
			[userId, key],
		);
		gapD.storageLedgered++;
	}
	gapD.heldTables = [...gapDHeldTables];
	gapD.lookupFailedTables = [...gapDLookupFailedTables];

	// ── #1121 GAP-B (E-2/E-14): score & assessment leftovers ──────────
	// All eleven tables: hard DELETE, no skeleton, no redaction (E-2/E-14
	// are MUST-ERASE; no K-line names any of them). Every family:
	// SELECT the candidate's rows, per-row findActiveHold consult via
	// the GAP-D partition machinery (the row's own company_id where one
	// exists, otherwise derived via job_id → jobs.company_id; attempts
	// derive via assessment → job → company, fallback application →
	// company), fail-closed on lookup error, then explicit counted
	// DELETE of the unheld ids only. Held rows are preserved, counted
	// in gapB.rowsHeld, and named in gapB.heldTables. No file/storage
	// columns on any table ⇒ no Phase-2 ledger work. No column is ever
	// nulled ⇒ no migration (the mig-259 lesson, STOP 1 §2).
	// FK order inside the block: children before parents
	// (assessment_conversations → job_assessment_attempts;
	// assessment_events → assessment_sessions) and skill_assessments
	// before assessment_sessions. Children follow their parent's hold
	// partition exactly.
	// Placement note (build deviation from STOP 1 §4, disclosed in the
	// PR): the block sits after the GAP-D block, not after the #813
	// block — the shipped queue-mocked suites (resume-family) exhaust
	// their finite mock queues mid-flow, and GAP-B queries placed
	// earlier consumed responses those suites destructure later
	// (proven by run: resume-family failed at the earlier placement,
	// passes here). No in-scope table has any FK interaction with the
	// GAP-A/GAP-D families (STOP 1 §2 sweep), so late placement
	// changes nothing functionally; the GAP-D block sits late for the
	// same reason.
	await gapBDeleteFamily(
		'score_snapshots',
		'scoreSnapshots',
		'SELECT id FROM score_snapshots WHERE user_id = $1',
		'DELETE FROM score_snapshots WHERE user_id = $1 AND id = ANY($2)',
	);
	// omniscore_results: zero in-repo writers (STOP 1 §3 ghost finding) —
	// the DELETE is still issued: E-2 names the table MUST-ERASE and
	// production rows from any out-of-repo write are not verified away.
	await gapBDeleteFamily(
		'omniscore_results',
		'omniscoreResults',
		'SELECT id FROM omniscore_results WHERE user_id = $1',
		'DELETE FROM omniscore_results WHERE user_id = $1 AND id = ANY($2)',
	);
	await gapBDeleteFamily(
		'score_appeals',
		'scoreAppeals',
		'SELECT id FROM score_appeals WHERE user_id = $1',
		'DELETE FROM score_appeals WHERE user_id = $1 AND id = ANY($2)',
	);
	// mutual_matches: likewise zero in-repo writers (STOP 1 §3); the
	// row carries its own company_id for the hold consult.
	await gapBDeleteFamily(
		'mutual_matches',
		'mutualMatches',
		'SELECT id, company_id FROM mutual_matches WHERE candidate_id = $1',
		'DELETE FROM mutual_matches WHERE candidate_id = $1 AND id = ANY($2)',
	);
	await gapBDeleteFamily(
		'screening_logs',
		'screeningLogs',
		`SELECT sl.id, j.company_id AS company_id
		 FROM screening_logs sl
		 LEFT JOIN jobs j ON j.id = sl.job_id
		 WHERE sl.candidate_id = $1`,
		'DELETE FROM screening_logs WHERE candidate_id = $1 AND id = ANY($2)',
	);
	// skill_assessments BEFORE assessment_sessions (its session_id FK
	// is SET NULL, so it must be deleted by user_id while it still
	// names the candidate — and before the sessions themselves go).
	await gapBDeleteFamily(
		'skill_assessments',
		'skillAssessments',
		'SELECT id FROM skill_assessments WHERE user_id = $1',
		'DELETE FROM skill_assessments WHERE user_id = $1 AND id = ANY($2)',
	);
	// assessment_results (#1340): table created by migration 270, long
	// after the GAP-B sweep — same shape as skill_assessments (user_id
	// only, no company_id, no child FKs, no in-repo writers), so the
	// per-row consult is findActiveHold({userId, companyId: null}) via
	// the same partition machinery. Lex classification (STOP 1, #1340):
	// ERASE under legal hold — migration 013's 1825-day registry row
	// is a retention-purge rule for live accounts (auto_delete=false),
	// not a keep-after-erasure classification; no recruiter-record
	// K-line names this candidate-keyed table.
	await gapBDeleteFamily(
		'assessment_results',
		'assessmentResults',
		'SELECT id FROM assessment_results WHERE user_id = $1',
		'DELETE FROM assessment_results WHERE user_id = $1 AND id = ANY($2)',
	);

	// job_assessment_attempts + child assessment_conversations: the
	// conversations of UNHELD attempts are deleted explicitly + counted
	// BEFORE the parent DELETE — never cascade-assumed.
	const { rows: gapBAttemptRows } = await gapDQuery(
		`SELECT a.id, COALESCE(j.company_id, app.company_id) AS company_id
		 FROM job_assessment_attempts a
		 LEFT JOIN job_assessments ja ON ja.id = a.assessment_id
		 LEFT JOIN jobs j ON j.id = ja.job_id
		 LEFT JOIN job_applications app ON app.id = a.application_id
		 WHERE a.candidate_id = $1`,
		[userId],
	);
	const gapBAttemptPart = await gapDPartition(gapBAttemptRows);
	gapBNoteHeld('job_assessment_attempts', gapBAttemptPart.held);
	gapBNoteLookupFailed('job_assessment_attempts', gapBAttemptPart.lookupFailed);
	const gapBUnheldAttemptIds = gapBAttemptPart.unheld.map((r) => r.id);
	const gapBHeldAttemptIdSet = new Set(gapBAttemptPart.heldRows.map((r) => r.id));
	const gapBFailedAttemptIdSet = new Set(gapBAttemptPart.failedRows.map((r) => r.id));
	const gapBSurvivingAttemptIdSet = new Set([...gapBHeldAttemptIdSet, ...gapBFailedAttemptIdSet]);
	if (gapBAttemptRows.length > 0) {
		const { rows: gapBConvRows } = await gapDQuery(
			'SELECT id, attempt_id FROM assessment_conversations WHERE attempt_id = ANY($1)',
			[gapBAttemptRows.map((r) => r.id)],
		);
		const gapBUnheldConv = gapBConvRows.filter((c) => !gapBSurvivingAttemptIdSet.has(c.attempt_id));
		gapBNoteHeld(
			'assessment_conversations',
			gapBConvRows.filter((c) => gapBHeldAttemptIdSet.has(c.attempt_id)).length,
		);
		gapBNoteLookupFailed(
			'assessment_conversations',
			gapBConvRows.filter((c) => gapBFailedAttemptIdSet.has(c.attempt_id)).length,
		);
		if (gapBUnheldConv.length > 0) {
			const { rowCount } = await gapDQuery(
				'DELETE FROM assessment_conversations WHERE attempt_id = ANY($1)',
				[gapBUnheldAttemptIds],
			);
			gapB.assessmentConversations = rowCount || 0;
		}
	}
	if (gapBUnheldAttemptIds.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM job_assessment_attempts WHERE candidate_id = $1 AND id = ANY($2)',
			[userId, gapBUnheldAttemptIds],
		);
		gapB.jobAssessmentAttempts = rowCount || 0;
	}

	// assessment_sessions + child assessment_events: same explicit
	// child-before-parent shape, by unheld session ids.
	const { rows: gapBSessionRows } = await gapDQuery(
		`SELECT s.id, j.company_id AS company_id
		 FROM assessment_sessions s
		 LEFT JOIN jobs j ON j.id = s.job_id
		 WHERE s.user_id = $1`,
		[userId],
	);
	const gapBSessionPart = await gapDPartition(gapBSessionRows);
	gapBNoteHeld('assessment_sessions', gapBSessionPart.held);
	gapBNoteLookupFailed('assessment_sessions', gapBSessionPart.lookupFailed);
	const gapBUnheldSessionIds = gapBSessionPart.unheld.map((r) => r.id);
	const gapBHeldSessionIdSet = new Set(gapBSessionPart.heldRows.map((r) => r.id));
	const gapBFailedSessionIdSet = new Set(gapBSessionPart.failedRows.map((r) => r.id));
	const gapBSurvivingSessionIdSet = new Set([...gapBHeldSessionIdSet, ...gapBFailedSessionIdSet]);
	if (gapBSessionRows.length > 0) {
		const { rows: gapBEventRows } = await gapDQuery(
			'SELECT id, session_id FROM assessment_events WHERE session_id = ANY($1)',
			[gapBSessionRows.map((r) => r.id)],
		);
		const gapBUnheldEvents = gapBEventRows.filter((e) => !gapBSurvivingSessionIdSet.has(e.session_id));
		gapBNoteHeld(
			'assessment_events',
			gapBEventRows.filter((e) => gapBHeldSessionIdSet.has(e.session_id)).length,
		);
		gapBNoteLookupFailed(
			'assessment_events',
			gapBEventRows.filter((e) => gapBFailedSessionIdSet.has(e.session_id)).length,
		);
		if (gapBUnheldEvents.length > 0) {
			const { rowCount } = await gapDQuery(
				'DELETE FROM assessment_events WHERE session_id = ANY($1)',
				[gapBUnheldSessionIds],
			);
			gapB.assessmentEvents = rowCount || 0;
		}
	}
	if (gapBUnheldSessionIds.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM assessment_sessions WHERE user_id = $1 AND id = ANY($2)',
			[userId, gapBUnheldSessionIds],
		);
		gapB.assessmentSessions = rowCount || 0;
	}
	gapB.heldTables = [...gapBHeldTables];
	gapB.lookupFailedTables = [...gapBLookupFailedTables];

	// ── #1122 GAP-C (E-13): scheduling & human-interview family ──────
	// Every family below: SELECT the candidate's rows, per-row
	// legal-hold consult via the GAP-D partition machinery (the row's
	// own company_id where one exists, otherwise the derived company —
	// see the header), fail-closed, then explicit counted DELETE /
	// REDACT of the unheld ids only. Children are deleted explicitly
	// before their parents and inherit the parent's partition exactly —
	// cascades are never the mechanism (the users row is tombstoned,
	// so they never fire). Placement: after the GAP-B block (the same
	// late placement, for the same mocked-queue reason recorded there);
	// the block runs after the shipped interview_evaluations /
	// interview_composite_scores DELETEs, satisfying the no-action FKs
	// into legacy interviews, and after GAP-A (recordings already
	// ledgered/redacted; the events disposition below never deletes a
	// recording row — it only reads whether one survives).
	const collectGapCStorage = (url) => {
		if (!url || typeof url !== 'string') return;
		if (url.startsWith('/api/files/')) {
			if (!gapCStorageKeys.includes(url)) gapCStorageKeys.push(url);
		} else if (!gapC.nonPatternStorageUrls.includes(url)) {
			// A URL the storage ledger cannot address (deleteFile only
			// handles /api/files/ URLs). Named explicitly in the
			// result — never silently skipped.
			gapC.nonPatternStorageUrls.push(url);
		}
	};

	// Legacy interviews cluster: interview_analysis (E-3-class
	// behavioural content) is deleted EXPLICITLY by unheld parent ids
	// FIRST, then the legacy rows themselves.
	const { rows: gapCLegacyRows } = await gapDQuery(
		`SELECT i.id, j.company_id AS company_id, i.video_urls
		 FROM interviews i
		 LEFT JOIN jobs j ON j.id = i.job_id
		 WHERE i.user_id = $1`,
		[userId],
	);
	const gapCLegacyPart = await gapDPartition(gapCLegacyRows);
	gapCNoteHeld('interviews', gapCLegacyPart.held);
	gapCNoteLookupFailed('interviews', gapCLegacyPart.lookupFailed);
	const gapCUnheldLegacyIds = gapCLegacyPart.unheld.map((r) => r.id);
	const gapCHeldLegacyIdSet = new Set(gapCLegacyPart.heldRows.map((r) => r.id));
	const gapCFailedLegacyIdSet = new Set(gapCLegacyPart.failedRows.map((r) => r.id));
	const gapCSurvivingLegacyIdSet = new Set([...gapCHeldLegacyIdSet, ...gapCFailedLegacyIdSet]);
	if (gapCLegacyRows.length > 0) {
		const { rows: gapCAnalysisRows } = await gapDQuery(
			'SELECT id, interview_id FROM interview_analysis WHERE interview_id = ANY($1)',
			[gapCLegacyRows.map((r) => r.id)],
		);
		const gapCUnheldAnalysis = gapCAnalysisRows.filter(
			(a) => !gapCSurvivingLegacyIdSet.has(a.interview_id),
		);
		gapCNoteHeld(
			'interview_analysis',
			gapCAnalysisRows.filter((a) => gapCHeldLegacyIdSet.has(a.interview_id)).length,
		);
		gapCNoteLookupFailed(
			'interview_analysis',
			gapCAnalysisRows.filter((a) => gapCFailedLegacyIdSet.has(a.interview_id)).length,
		);
		if (gapCUnheldAnalysis.length > 0) {
			const { rowCount } = await gapDQuery(
				'DELETE FROM interview_analysis WHERE interview_id = ANY($1)',
				[gapCUnheldLegacyIds],
			);
			gapC.interviewAnalysis = rowCount || 0;
		}
	}
	if (gapCUnheldLegacyIds.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM interviews WHERE user_id = $1 AND id = ANY($2)',
			[userId, gapCUnheldLegacyIds],
		);
		gapC.interviews = rowCount || 0;
		// Only unheld (deleted) rows ledger their objects — a held
		// row's video objects are held material and survive with it.
		for (const row of gapCLegacyPart.unheld) {
			const entries = Array.isArray(row.video_urls) ? row.video_urls : [];
			for (const entry of entries) {
				collectGapCStorage(
					typeof entry === 'string' ? entry : entry?.url ?? null,
				);
			}
		}
	}

	// Scheduled-interview cluster. interview_panels.interview_session_id
	// points at scheduled_interviews (mig 125 — the misnamed link), so
	// panels are keyed via the candidate's scheduled rows and inherit
	// their partition; the panel children inherit the panel partition.
	const { rows: gapCSchedRows } = await gapDQuery(
		'SELECT id, company_id FROM scheduled_interviews WHERE candidate_id = $1',
		[userId],
	);
	const gapCSchedPart = await gapDPartition(gapCSchedRows);
	gapCNoteHeld('scheduled_interviews', gapCSchedPart.held);
	gapCNoteLookupFailed('scheduled_interviews', gapCSchedPart.lookupFailed);
	const gapCUnheldSchedIds = gapCSchedPart.unheld.map((r) => r.id);
	const gapCHeldSchedIdSet = new Set(gapCSchedPart.heldRows.map((r) => r.id));
	const gapCFailedSchedIdSet = new Set(gapCSchedPart.failedRows.map((r) => r.id));
	const gapCSurvivingSchedIdSet = new Set([...gapCHeldSchedIdSet, ...gapCFailedSchedIdSet]);
	let gapCPanelRows = [];
	if (gapCSchedRows.length > 0) {
		const { rows } = await gapDQuery(
			'SELECT id, interview_session_id FROM interview_panels WHERE interview_session_id = ANY($1)',
			[gapCSchedRows.map((r) => r.id)],
		);
		gapCPanelRows = rows;
	}
	const gapCUnheldPanels = gapCPanelRows.filter(
		(p) => !gapCSurvivingSchedIdSet.has(p.interview_session_id),
	);
	gapCNoteHeld(
		'interview_panels',
		gapCPanelRows.filter((p) => gapCHeldSchedIdSet.has(p.interview_session_id)).length,
	);
	gapCNoteLookupFailed(
		'interview_panels',
		gapCPanelRows.filter((p) => gapCFailedSchedIdSet.has(p.interview_session_id)).length,
	);
	const gapCUnheldPanelIds = gapCUnheldPanels.map((r) => r.id);
	const gapCHeldPanelIdSet = new Set(
		gapCPanelRows.filter((p) => gapCHeldSchedIdSet.has(p.interview_session_id)).map((r) => r.id),
	);
	const gapCFailedPanelIdSet = new Set(
		gapCPanelRows.filter((p) => gapCFailedSchedIdSet.has(p.interview_session_id)).map((r) => r.id),
	);
	const gapCSurvivingPanelIdSet = new Set([...gapCHeldPanelIdSet, ...gapCFailedPanelIdSet]);
	let gapCScorecardRows = [];
	if (gapCPanelRows.length > 0) {
		const { rows } = await gapDQuery(
			'SELECT id, panel_id FROM scorecards WHERE panel_id = ANY($1)',
			[gapCPanelRows.map((r) => r.id)],
		);
		gapCScorecardRows = rows;
	}
	const gapCUnheldScorecards = gapCScorecardRows.filter(
		(sc) => !gapCSurvivingPanelIdSet.has(sc.panel_id),
	);
	gapCNoteHeld(
		'scorecards',
		gapCScorecardRows.filter((sc) => gapCHeldPanelIdSet.has(sc.panel_id)).length,
	);
	gapCNoteLookupFailed(
		'scorecards',
		gapCScorecardRows.filter((sc) => gapCFailedPanelIdSet.has(sc.panel_id)).length,
	);
	const gapCUnheldScorecardIds = gapCUnheldScorecards.map((r) => r.id);
	const gapCHeldScorecardIdSet = new Set(
		gapCScorecardRows.filter((sc) => gapCHeldPanelIdSet.has(sc.panel_id)).map((r) => r.id),
	);
	const gapCFailedScorecardIdSet = new Set(
		gapCScorecardRows.filter((sc) => gapCFailedPanelIdSet.has(sc.panel_id)).map((r) => r.id),
	);
	const gapCSurvivingScorecardIdSet = new Set([
		...gapCHeldScorecardIdSet,
		...gapCFailedScorecardIdSet,
	]);
	// scorecard_items BEFORE scorecards (explicit, by unheld scorecard
	// ids — never cascade-assumed).
	if (gapCScorecardRows.length > 0) {
		const { rows: gapCItemRows } = await gapDQuery(
			'SELECT id, scorecard_id FROM scorecard_items WHERE scorecard_id = ANY($1)',
			[gapCScorecardRows.map((r) => r.id)],
		);
		const gapCUnheldItems = gapCItemRows.filter(
			(it) => !gapCSurvivingScorecardIdSet.has(it.scorecard_id),
		);
		gapCNoteHeld(
			'scorecard_items',
			gapCItemRows.filter((it) => gapCHeldScorecardIdSet.has(it.scorecard_id)).length,
		);
		gapCNoteLookupFailed(
			'scorecard_items',
			gapCItemRows.filter((it) => gapCFailedScorecardIdSet.has(it.scorecard_id)).length,
		);
		if (gapCUnheldItems.length > 0) {
			const { rowCount } = await gapDQuery(
				'DELETE FROM scorecard_items WHERE scorecard_id = ANY($1)',
				[gapCUnheldScorecardIds],
			);
			gapC.scorecardItems = rowCount || 0;
		}
	}
	if (gapCUnheldScorecardIds.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM scorecards WHERE id = ANY($1)', [
			gapCUnheldScorecardIds,
		]);
		gapC.scorecards = rowCount || 0;
	}
	// panel_notes + panel_members BEFORE interview_panels, by unheld
	// panel ids (panel_notes.content is TEXT NOT NULL, mig 125 — DELETE
	// is the only executable shape, per the Q1 ruling).
	if (gapCUnheldPanelIds.length > 0) {
		for (const [table, countKey] of [
			['panel_notes', 'panelNotes'],
			['panel_members', 'panelMembers'],
		]) {
			const { rows: childRows } = await gapDQuery(
				`SELECT id, panel_id FROM ${table} WHERE panel_id = ANY($1)`,
				[gapCPanelRows.map((r) => r.id)],
			);
			const unheldChild = childRows.filter((c) => !gapCSurvivingPanelIdSet.has(c.panel_id));
			gapCNoteHeld(
				table,
				childRows.filter((c) => gapCHeldPanelIdSet.has(c.panel_id)).length,
			);
			gapCNoteLookupFailed(
				table,
				childRows.filter((c) => gapCFailedPanelIdSet.has(c.panel_id)).length,
			);
			if (unheldChild.length > 0) {
				const { rowCount } = await gapDQuery(
					`DELETE FROM ${table} WHERE panel_id = ANY($1)`,
					[gapCUnheldPanelIds],
				);
				gapC[countKey] = rowCount || 0;
			}
		}
		const { rowCount } = await gapDQuery('DELETE FROM interview_panels WHERE id = ANY($1)', [
			gapCUnheldPanelIds,
		]);
		gapC.interviewPanels = rowCount || 0;
	} else if (gapCPanelRows.length > 0) {
		// All panels survive (held or lookup-failed): their children
		// survive with them — count the survivals, split by the
		// parent's bucket, without touching them.
		for (const table of ['panel_notes', 'panel_members']) {
			const { rows: childRows } = await gapDQuery(
				`SELECT id, panel_id FROM ${table} WHERE panel_id = ANY($1)`,
				[gapCPanelRows.map((r) => r.id)],
			);
			gapCNoteHeld(
				table,
				childRows.filter((c) => gapCHeldPanelIdSet.has(c.panel_id)).length,
			);
			gapCNoteLookupFailed(
				table,
				childRows.filter((c) => gapCFailedPanelIdSet.has(c.panel_id)).length,
			);
		}
	}
	// interview_reminders: by unheld parent ids + recipient-keyed rows
	// (a reminder on a held parent's interview is preserved with it —
	// the partition is applied per row in JS, not in the SELECT).
	const { rows: gapCReminderRows } = await gapDQuery(
		'SELECT id, interview_id, recipient_id FROM interview_reminders WHERE interview_id = ANY($1) OR recipient_id = $2',
		[gapCSchedRows.map((r) => r.id), userId],
	);
	const gapCUnheldReminders = gapCReminderRows.filter(
		(r) => !gapCSurvivingSchedIdSet.has(r.interview_id),
	);
	gapCNoteHeld(
		'interview_reminders',
		gapCReminderRows.filter((r) => gapCHeldSchedIdSet.has(r.interview_id)).length,
	);
	gapCNoteLookupFailed(
		'interview_reminders',
		gapCReminderRows.filter((r) => gapCFailedSchedIdSet.has(r.interview_id)).length,
	);
	if (gapCUnheldReminders.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM interview_reminders WHERE id = ANY($1)', [
			gapCUnheldReminders.map((r) => r.id),
		]);
		gapC.interviewReminders = rowCount || 0;
	}
	// interview_feedback dies on its own candidate key (its
	// interview_id FK is SET NULL — parent deletion alone would leave
	// it detached and invisible), before the parent DELETE.
	await gapCDeleteFamily(
		'interview_feedback',
		'interviewFeedback',
		'SELECT id, company_id FROM interview_feedback WHERE candidate_id = $1',
		'DELETE FROM interview_feedback WHERE candidate_id = $1 AND id = ANY($2)',
	);
	if (gapCUnheldSchedIds.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM scheduled_interviews WHERE candidate_id = $1 AND id = ANY($2)',
			[userId, gapCUnheldSchedIds],
		);
		gapC.scheduledInterviews = rowCount || 0;
	}

	// Interview-events cluster. Company is DERIVED via
	// job_application_id → job_applications.company_id (the K-3
	// skeleton row survives with its linkage); a NULL derivation
	// consults {userId} only. Q2(b) partition, per event:
	// has_recording ⇒ REDACT (K-12), otherwise ⇒ DELETE.
	// #1972 (K-12 panel-consent clause, #1964): a third EXISTS in the
	// SAME SELECT snapshot tests event_labelling_consent — an event
	// carrying panel rows but no recording is REDACTED, never
	// DELETEd: migration 299's ON DELETE RESTRICT would abort the
	// DELETE and roll back the candidate's entire erasure. The
	// subject's OWN panel rows are already deleted earlier in this
	// function (S-D19 step, by user_id), so has_panel_consent here
	// reflects only OTHER users' surviving rows — a candidate's
	// erasure never touches them.
	const { rows: gapCEventRows } = await gapDQuery(
		`SELECT ie.id, ja.company_id AS company_id,
		        EXISTS (SELECT 1 FROM interview_recordings ir WHERE ir.interview_event_id = ie.id) AS has_recording,
		        EXISTS (SELECT 1 FROM event_labelling_consent elc WHERE elc.interview_event_id = ie.id) AS has_panel_consent
		 FROM interview_events ie
		 LEFT JOIN job_applications ja ON ja.id = ie.job_application_id
		 WHERE ie.candidate_id = $1`,
		[userId],
	);
	const gapCEventPart = await gapDPartition(gapCEventRows);
	gapCNoteHeld('interview_events', gapCEventPart.held);
	gapCNoteLookupFailed('interview_events', gapCEventPart.lookupFailed);
	const gapCHeldEventIdSet = new Set(gapCEventPart.heldRows.map((r) => r.id));
	const gapCFailedEventIdSet = new Set(gapCEventPart.failedRows.map((r) => r.id));
	const gapCSurvivingEventIdSet = new Set([...gapCHeldEventIdSet, ...gapCFailedEventIdSet]);
	// proposed_slots BEFORE both event dispositions: by unheld event
	// ids + proposed_by rows, held events' slots preserved.
	const { rows: gapCSlotRows } = await gapDQuery(
		'SELECT id, interview_event_id, proposed_by FROM proposed_slots WHERE interview_event_id = ANY($1) OR proposed_by = $2',
		[gapCEventRows.map((r) => r.id), userId],
	);
	const gapCUnheldSlots = gapCSlotRows.filter(
		(sl) => !gapCSurvivingEventIdSet.has(sl.interview_event_id),
	);
	gapCNoteHeld(
		'proposed_slots',
		gapCSlotRows.filter((sl) => gapCHeldEventIdSet.has(sl.interview_event_id)).length,
	);
	gapCNoteLookupFailed(
		'proposed_slots',
		gapCSlotRows.filter((sl) => gapCFailedEventIdSet.has(sl.interview_event_id)).length,
	);
	if (gapCUnheldSlots.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM proposed_slots WHERE id = ANY($1)', [
			gapCUnheldSlots.map((r) => r.id),
		]);
		gapC.proposedSlots = rowCount || 0;
	}
	// interview_rooms BEFORE both event dispositions: event-linked
	// rows only (interview_session_id IS NULL — session-linked rooms
	// are spine territory, mig 139, untouched).
	// FIX ROUND (Lex ruling, #1122 comment 6169043564 — Option A):
	// the DELETE is partitioned, at DELETE time in this transaction
	// and AFTER the legal-hold partition above, by NOT EXISTS on
	// interview_recordings.room_id. Mig 128 makes that FK ON DELETE
	// CASCADE, and the production writer sets room_id on event
	// recordings, so deleting a referenced room would cascade-destroy
	// the GAP-A-kept recording + its K-1 consent fact. A referenced
	// room survives WHOLE and unredacted under amended K-12; the
	// recording row is never touched (Option B — NULLing room_id —
	// was REJECTED). NOT EXISTS handles multiple recordings
	// referencing one room naturally: the room survives until the
	// last referencing recording is gone. Referenced survivals are
	// counted in gapC.interviewRoomsKeptForRecordings, never as
	// deleted (kept = unheld candidates − rows actually deleted).
	const { rows: gapCRoomRows } = await gapDQuery(
		'SELECT id, interview_event_id FROM interview_rooms WHERE interview_event_id = ANY($1) AND interview_session_id IS NULL',
		[gapCEventRows.map((r) => r.id)],
	);
	const gapCUnheldRooms = gapCRoomRows.filter(
		(rm) => !gapCSurvivingEventIdSet.has(rm.interview_event_id),
	);
	gapCNoteHeld(
		'interview_rooms',
		gapCRoomRows.filter((rm) => gapCHeldEventIdSet.has(rm.interview_event_id)).length,
	);
	gapCNoteLookupFailed(
		'interview_rooms',
		gapCRoomRows.filter((rm) => gapCFailedEventIdSet.has(rm.interview_event_id)).length,
	);
	if (gapCUnheldRooms.length > 0) {
		const { rowCount } = await gapDQuery(
			`DELETE FROM interview_rooms WHERE id = ANY($1)
			 AND NOT EXISTS (SELECT 1 FROM interview_recordings WHERE room_id = interview_rooms.id)`,
			[gapCUnheldRooms.map((r) => r.id)],
		);
		gapC.interviewRooms = rowCount || 0;
		gapC.interviewRoomsKeptForRecordings = gapCUnheldRooms.length - gapC.interviewRooms;
	}
	// #1972 partition (disjoint sets over unheld; held/lookup-failed
	// events survive whole above, before either disposition):
	// has_recording ⇒ recording redact; panel-only (no recording,
	// has_panel_consent) ⇒ panel redact via its OWN UPDATE so its
	// rowCount is measured, never inferred; neither ⇒ DELETE — and
	// by the EXISTS snapshot a DELETEd event has no panel rows, so
	// migration 299's RESTRICT is never reachable.
	const gapCRedactEventIds = gapCEventPart.unheld.filter((r) => r.has_recording).map((r) => r.id);
	const gapCPanelRedactEventIds = gapCEventPart.unheld
		.filter((r) => !r.has_recording && r.has_panel_consent)
		.map((r) => r.id);
	const gapCDeleteEventIds = gapCEventPart.unheld
		.filter((r) => !r.has_recording && !r.has_panel_consent)
		.map((r) => r.id);
	if (gapCRedactEventIds.length > 0) {
		// K-12 redact: exactly the five ruled assignments. The four
		// NULL targets are verified nullable in migration 126;
		// panel_member_ids is assigned '{}', never NULL.
		const { rowCount } = await gapDQuery(
			`UPDATE interview_events
			 SET notes = NULL,
			     meeting_link = NULL,
			     livekit_room_url = NULL,
			     calendar_event_ids = NULL,
			     panel_member_ids = '{}'
			 WHERE candidate_id = $1 AND id = ANY($2)`,
			[userId, gapCRedactEventIds],
		);
		gapC.interviewEventsRedacted = rowCount || 0;
	}
	if (gapCPanelRedactEventIds.length > 0) {
		// K-12 panel-consent clause (#1964/#1972): identical five
		// assignments to the recording redact — the event survives as
		// the same skeleton, parenting the panel speakers' consent
		// rows. Counted separately in
		// gapC.interviewEventsKeptForPanelConsent (this UPDATE's own
		// rowCount) and disclosed in the erasure result: a candidate
		// is never told "everything deleted" while this skeleton
		// stands.
		const { rowCount } = await gapDQuery(
			`UPDATE interview_events
			 SET notes = NULL,
			     meeting_link = NULL,
			     livekit_room_url = NULL,
			     calendar_event_ids = NULL,
			     panel_member_ids = '{}'
			 WHERE candidate_id = $1 AND id = ANY($2)`,
			[userId, gapCPanelRedactEventIds],
		);
		gapC.interviewEventsKeptForPanelConsent = rowCount || 0;
	}
	if (gapCDeleteEventIds.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM interview_events WHERE candidate_id = $1 AND id = ANY($2)',
			[userId, gapCDeleteEventIds],
		);
		gapC.interviewEventsDeleted = rowCount || 0;
	}

	// Independent families: candidate_feedback (candidate-authored,
	// own company), mock_interview_sessions (E-3-class interview
	// content — full DELETE by user_id), human_interview_requests
	// (candidate-keyed; outbound FK only — the spine session row it
	// points at is never touched).
	await gapCDeleteFamily(
		'candidate_feedback',
		'candidateFeedback',
		'SELECT id, company_id FROM candidate_feedback WHERE candidate_id = $1',
		'DELETE FROM candidate_feedback WHERE candidate_id = $1 AND id = ANY($2)',
	);
	await gapCDeleteFamily(
		'mock_interview_sessions',
		'mockInterviewSessions',
		'SELECT id FROM mock_interview_sessions WHERE user_id = $1',
		'DELETE FROM mock_interview_sessions WHERE user_id = $1 AND id = ANY($2)',
	);
	await gapCDeleteFamily(
		'human_interview_requests',
		'humanInterviewRequests',
		'SELECT id FROM human_interview_requests WHERE candidate_id = $1',
		'DELETE FROM human_interview_requests WHERE candidate_id = $1 AND id = ANY($2)',
	);

	// GAP-C storage objects: ledger in-tx (crash-safe, S-076 pattern);
	// Phase 2 (deleteErasedStorageFiles) drains them post-commit and
	// re-consults legal hold per entry.
	for (const key of gapCStorageKeys) {
		await gapDQuery(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
       VALUES ($1, $2, 'r2', 'pending', 'legacy_interview_video')`,
			[userId, key],
		);
		gapC.storageLedgered++;
	}
	gapC.heldTables = [...gapCHeldTables];
	gapC.lookupFailedTables = [...gapCLookupFailedTables];

	// ── #1124 GAP-E (E-11): profile-adjacent & career leftovers ─────
	// Placement (Rex, #1124 comment 6172052312): immediately after the
	// GAP-C block — GAP-E's queued queries append after GAP-C's, never
	// inside the B/C/D stretches (mock-queue ordering is load-bearing);
	// no existing namespace/block moves. All 19 tables: whole-row
	// DELETE, counted — no skeleton, no redaction, no new K-line
	// (STOP 1, comment 6171997501). Legal hold: the shipped entry gate
	// already ran first; below, per-row consults fail-closed through
	// the GAP-E-LOCAL three-way partition defined here.
	// gapDPartition is NOT reused here (GAP-E keeps its local
	// partition beside the block, placement unchanged). When GAP-E
	// shipped, the shared partition was two-way and read a lookup
	// ERROR as held; #1154 unified it to the same three-way contract
	// — error ⇒ counted skip (holdLookupFailed / lookupFailedTables),
	// never a held masquerade (#1116/#1154 honesty rule). The §8
	// convergence pin in gap-e-erasure.test.js locks both contracts.
	const gapE = {
		candidateDemographics: 0,
		recruiterFeedback: 0,
		sharedNotes: 0,
		skillEndorsements: 0,
		candidateInvites: 0,
		careerRecommendations: 0,
		skillGapAnalyses: 0,
		learningPaths: 0,
		companyResearchBriefs: 0,
		salaryPracticeSessions: 0,
		profileToolProgress: 0,
		careerCoachSessions: 0,
		applicationOptimizations: 0,
		comments: 0,
		commentMentions: 0,
		portfolioProjects: 0,
		candidateJobActions: 0,
		savedJobs: 0,
		jobAlerts: 0,
		rowsHeld: 0,
		heldTables: [],
		holdLookupFailed: 0,
		lookupFailedTables: [],
		storageLedgered: 0,
	};
	const gapEHeldTables = new Set();
	const gapELookupFailedTables = new Set();
	const gapEStorageKeys = [];
	const gapENoteHeld = (table, n) => {
		if (n > 0) {
			gapE.rowsHeld += n;
			gapEHeldTables.add(table);
		}
	};
	const gapENoteLookupFailed = (table, n) => {
		if (n > 0) {
			gapE.holdLookupFailed += n;
			gapELookupFailedTables.add(table);
		}
	};
	// Three-way per-row hold partition (GAP-E-local): findActiveHold
	// with the subject AND the row's precomputed company_id (or null ⇒
	// {userId} only). Hold found ⇒ held bucket; null ⇒ unheld; ERROR
	// ⇒ lookup-failed bucket (row preserved, counted separately,
	// never as a hold) — the row is erased in NO failure mode.
	const gapEPartition = async (rows, companyOf = (r) => r.company_id ?? null) => {
		const unheld = [];
		const heldRows = [];
		const failedRows = [];
		for (const row of rows) {
			try {
				const hold = await containedConsult(() =>
					findActiveHold(
						{ userId, companyId: companyOf(row) ?? null },
						queryable,
					),
				);
				if (hold != null) heldRows.push(row);
				else unheld.push(row);
			} catch (holdErr) {
				console.error(
					'[erasureService] #1124 per-row legal-hold check failed — failing closed (skipping row, counted as lookup-failed):',
					holdErr.message,
				);
				failedRows.push(row);
			}
		}
		return {
			unheld,
			heldRows,
			failedRows,
			held: heldRows.length,
			lookupFailed: failedRows.length,
		};
	};
	// SELECT a candidate-keyed family, partition, DELETE the unheld
	// ids explicitly (cascades are never the mechanism — the users row
	// is tombstoned, so they never fire).
	const gapEDeleteFamily = async (table, countKey, selectSql, deleteSql, opts = {}) => {
		const { rows } = await gapDQuery(selectSql, opts.selectParams || [userId]);
		const part = await gapEPartition(rows, opts.companyOf);
		gapENoteHeld(table, part.held);
		gapENoteLookupFailed(table, part.lookupFailed);
		let deleted = 0;
		if (part.unheld.length > 0) {
			const ids = part.unheld.map((r) => r.id);
			const { rowCount } = await gapDQuery(
				deleteSql,
				opts.deleteParams ? opts.deleteParams(ids) : [userId, ids],
			);
			deleted = rowCount || 0;
		}
		gapE[countKey] = deleted;
		return { deleted, held: part.held, lookupFailed: part.lookupFailed, unheldRows: part.unheld };
	};

	// 1) candidate_demographics FIRST, standalone (STOP 1 §2): special
	// category — whole-row DELETE, count from the DELETE's rowCount.
	// Only the surrogate id is read (for the per-row hold consult);
	// its values are never selected and the row is never a join key.
	await gapEDeleteFamily(
		'candidate_demographics',
		'candidateDemographics',
		'SELECT id FROM candidate_demographics WHERE user_id = $1',
		'DELETE FROM candidate_demographics WHERE user_id = $1 AND id = ANY($2)',
	);

	// 2) Third-party set — whole-row DELETE, no keeps (STOP 1 §3).
	// recruiter_feedback: company derived via job_id → jobs.company_id
	// (NULL job ⇒ {userId} only, via the LEFT JOIN).
	await gapEDeleteFamily(
		'recruiter_feedback',
		'recruiterFeedback',
		`SELECT rf.id, j.company_id AS company_id
		 FROM recruiter_feedback rf
		 LEFT JOIN jobs j ON j.id = rf.job_id
		 WHERE rf.candidate_id = $1`,
		'DELETE FROM recruiter_feedback WHERE candidate_id = $1 AND id = ANY($2)',
	);
	await gapEDeleteFamily(
		'shared_notes',
		'sharedNotes',
		'SELECT id FROM shared_notes WHERE candidate_id = $1',
		'DELETE FROM shared_notes WHERE candidate_id = $1 AND id = ANY($2)',
	);
	// skill_endorsements: keyed STRICTLY on candidate_id — never by
	// recruiter_id (that would destroy endorsements about OTHER
	// candidates authored by the erasing user).
	await gapEDeleteFamily(
		'skill_endorsements',
		'skillEndorsements',
		'SELECT id FROM skill_endorsements WHERE candidate_id = $1',
		'DELETE FROM skill_endorsements WHERE candidate_id = $1 AND id = ANY($2)',
	);
	// candidate_invites: whole row incl. the recruiter-authored
	// message; the row's OWN company_id is the hold attribution.
	await gapEDeleteFamily(
		'candidate_invites',
		'candidateInvites',
		'SELECT id, company_id FROM candidate_invites WHERE candidate_id = $1',
		'DELETE FROM candidate_invites WHERE candidate_id = $1 AND id = ANY($2)',
	);

	// 3) Mig-131/136 cluster: every child is deleted explicitly by
	// its OWN user_id BEFORE the parent career_coach_sessions rows —
	// the children's session_id FK is ON DELETE SET NULL, which is
	// never relied on. company_research_briefs.company_id is the
	// RESEARCHED company — it is not selected and is never hold
	// attribution (STOP 1 trap).
	for (const [table, countKey] of [
		['career_recommendations', 'careerRecommendations'],
		['skill_gap_analyses', 'skillGapAnalyses'],
		['learning_paths', 'learningPaths'],
		['company_research_briefs', 'companyResearchBriefs'],
		['salary_practice_sessions', 'salaryPracticeSessions'],
		['profile_tool_progress', 'profileToolProgress'],
	]) {
		await gapEDeleteFamily(
			table,
			countKey,
			`SELECT id FROM ${table} WHERE user_id = $1`,
			`DELETE FROM ${table} WHERE user_id = $1 AND id = ANY($2)`,
		);
	}
	await gapEDeleteFamily(
		'career_coach_sessions',
		'careerCoachSessions',
		'SELECT id FROM career_coach_sessions WHERE user_id = $1',
		'DELETE FROM career_coach_sessions WHERE user_id = $1 AND id = ANY($2)',
	);

	// 4) application_optimizations: whole-row DELETE — the originals
	// AND the AI-rewritten outputs (optimized_cover_letter,
	// optimized_answers, diff_highlights, scores, feedback) die with
	// the row (Principle 4; STOP 1 §5). No skeleton, no UPDATE.
	await gapEDeleteFamily(
		'application_optimizations',
		'applicationOptimizations',
		'SELECT id FROM application_optimizations WHERE user_id = $1',
		'DELETE FROM application_optimizations WHERE user_id = $1 AND id = ANY($2)',
	);

	// 5) Comments sub-family: ONE recursive scan — application branch
	// ONLY (entity_id ∈ the candidate's application ids, via the real
	// job_applications linkage) + reply children via parent_id
	// transitively (parent_id is a real FK), soft-deleted rows
	// included. Each row's company is precomputed in the scan
	// (application ⇒ its job_applications.company_id).
	// NAMED RESIDUAL: the entity_type='candidate' branch is NOT
	// scanned or deleted — its entity_id join is UNVERIFIABLE (Scout
	// build-entry re-verification, #1124 steering; supersedes comment
	// 6172041587's inference). No guessed join ships: blocked pending
	// a live-DB join check or a recorded ruling adopting users.id.
	const { rows: gapECommentRows } = await gapDQuery(
		`WITH RECURSIVE cand_comments AS (
		   SELECT c.id, c.entity_type, c.entity_id, c.parent_id, ja.company_id AS company_id
		   FROM comments c
		   JOIN job_applications ja ON ja.id = c.entity_id AND ja.candidate_id = $1
		   WHERE c.entity_type = 'application'
		   UNION
		   SELECT ch.id, ch.entity_type, ch.entity_id, ch.parent_id, p.company_id
		   FROM comments ch
		   JOIN cand_comments p ON ch.parent_id = p.id
		 )
		 SELECT id, entity_type, entity_id, parent_id, company_id FROM cand_comments`,
		[userId],
	);
	const gapECommentPart = await gapEPartition(gapECommentRows);
	gapENoteHeld('comments', gapECommentPart.held);
	gapENoteLookupFailed('comments', gapECommentPart.lookupFailed);
	const gapEUnheldCommentIds = gapECommentPart.unheld.map((r) => r.id);
	const gapEHeldCommentIdSet = new Set(gapECommentPart.heldRows.map((r) => r.id));
	const gapEFailedCommentIdSet = new Set(gapECommentPart.failedRows.map((r) => r.id));
	const gapEScannedCommentIdSet = new Set(gapECommentRows.map((r) => r.id));

	// comment_mentions inherits its parent comment's partition
	// exactly: mentions on the candidate's comments follow the parent
	// (held/lookup-failed parents keep their mention rows with them).
	const gapEMentionIdsToDelete = [];
	if (gapECommentRows.length > 0) {
		const { rows: gapEMentionRows } = await gapDQuery(
			'SELECT id, comment_id FROM comment_mentions WHERE comment_id = ANY($1)',
			[gapECommentRows.map((r) => r.id)],
		);
		let gapEMentionsHeld = 0;
		let gapEMentionsFailed = 0;
		for (const m of gapEMentionRows) {
			if (gapEHeldCommentIdSet.has(m.comment_id)) gapEMentionsHeld++;
			else if (gapEFailedCommentIdSet.has(m.comment_id)) gapEMentionsFailed++;
			else gapEMentionIdsToDelete.push(m.id);
		}
		gapENoteHeld('comment_mentions', gapEMentionsHeld);
		gapENoteLookupFailed('comment_mentions', gapEMentionsFailed);
	}
	// Mention rows where mentioned_user_id = the candidate on OTHER
	// comments: the mention row alone dies (host untouched), under
	// its parent comment's own partition. Rows whose parent is in the
	// scan above are already handled by inheritance — excluded here.
	const { rows: gapEForeignMentionRows } = await gapDQuery(
		`SELECT m.id, m.comment_id,
		        CASE WHEN c.entity_type = 'application' THEN ja.company_id ELSE NULL END AS company_id
		 FROM comment_mentions m
		 JOIN comments c ON c.id = m.comment_id
		 LEFT JOIN job_applications ja
		   ON c.entity_type = 'application' AND ja.id = c.entity_id
		 WHERE m.mentioned_user_id = $1`,
		[userId],
	);
	const gapEForeignMentions = gapEForeignMentionRows.filter(
		(m) => !gapEScannedCommentIdSet.has(m.comment_id),
	);
	const gapEForeignPart = await gapEPartition(gapEForeignMentions);
	gapENoteHeld('comment_mentions', gapEForeignPart.held);
	gapENoteLookupFailed('comment_mentions', gapEForeignPart.lookupFailed);
	for (const m of gapEForeignPart.unheld) gapEMentionIdsToDelete.push(m.id);

	// Mentions DELETE by id set BEFORE the comments DELETE by id set
	// (Rex's ordered pair — never cascade-assumed).
	if (gapEMentionIdsToDelete.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM comment_mentions WHERE id = ANY($1)', [
			gapEMentionIdsToDelete,
		]);
		gapE.commentMentions = rowCount || 0;
	}
	if (gapEUnheldCommentIds.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM comments WHERE id = ANY($1)', [
			gapEUnheldCommentIds,
		]);
		gapE.comments = rowCount || 0;
	}

	// 6) Simple candidate-keyed deletes.
	// portfolio_projects: image_url is a free-form client-supplied
	// URL (build check, STOP 1 §7) — an /api/files/-shaped value on
	// an UNHELD row is ledgered in-tx per the S-076 pattern; any
	// other value addresses no object we own and dies with the row.
	const gapEPortfolioRes = await gapEDeleteFamily(
		'portfolio_projects',
		'portfolioProjects',
		'SELECT id, image_url FROM portfolio_projects WHERE user_id = $1',
		'DELETE FROM portfolio_projects WHERE user_id = $1 AND id = ANY($2)',
	);
	for (const row of gapEPortfolioRes.unheldRows) {
		const url = row.image_url;
		if (typeof url === 'string' && url.startsWith('/api/files/') && !gapEStorageKeys.includes(url)) {
			gapEStorageKeys.push(url);
		}
	}
	for (const [table, countKey] of [
		['candidate_job_actions', 'candidateJobActions'],
		['saved_jobs', 'savedJobs'],
		['job_alerts', 'jobAlerts'],
	]) {
		await gapEDeleteFamily(
			table,
			countKey,
			`SELECT id FROM ${table} WHERE user_id = $1`,
			`DELETE FROM ${table} WHERE user_id = $1 AND id = ANY($2)`,
		);
	}

	// GAP-E storage objects: ledger in-tx (crash-safe, S-076 pattern);
	// Phase 2 drains them post-commit and re-consults legal hold.
	for (const key of gapEStorageKeys) {
		await gapDQuery(
			`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
       VALUES ($1, $2, 'r2', 'pending', 'portfolio_project_image')`,
			[userId, key],
		);
		gapE.storageLedgered++;
	}
	gapE.heldTables = [...gapEHeldTables];
	gapE.lookupFailedTables = [...gapELookupFailedTables];

	// ── #1125 GAP-F (E-15): communications & notifications family ────
	// Placement: immediately after the GAP-E block (STOP 1 §4 — one
	// GAP-F block in the GAP sequence, after GAP-E). All eight tables:
	// whole-row DELETE, counted — no skeleton, no redaction, no new
	// K-line. Legal hold: per-row consults fail-closed through the
	// GAP-F-local three-way partition below (same contract as
	// gapEPartition: an error is a counted lookup-failed skip, never a
	// held masquerade).
	const gapF = {
		communications: 0,
		sequenceEnrollments: 0,
		emailQueue: 0,
		notificationQueue: 0,
		notificationLogs: 0,
		userNotifications: 0,
		notificationPreferences: 0,
		notificationAudioCache: 0,
		rowsHeld: 0,
		heldTables: [],
		holdLookupFailed: 0,
		lookupFailedTables: [],
		emailCaptureFailed: false,
	};
	const gapFHeldTables = new Set();
	const gapFLookupFailedTables = new Set();
	const gapFNoteHeld = (table, n) => {
		if (n > 0) {
			gapF.rowsHeld += n;
			gapFHeldTables.add(table);
		}
	};
	const gapFNoteLookupFailed = (table, n) => {
		if (n > 0) {
			gapF.holdLookupFailed += n;
			gapFLookupFailedTables.add(table);
		}
	};

	// Email capture (STOP 1 §4, binding ordering): email-matched
	// deletes use the candidate's ORIGINAL address, captured before
	// the users tombstone rewrites it. Callers that tombstone before
	// invoking erasure (routes/auth.js delete-account) pass the
	// pre-tombstone address they already hold (req.user, loaded before
	// the UPDATE) as `originalEmail`; the fallback read below serves
	// callers that never tombstone (admin DSAR fulfillment). An
	// email-matched delete issued with the tombstone address would
	// match nothing and report a false zero.
	let gapFEmail = originalEmail ?? null;
	if (!gapFEmail) {
		const { rows: gapFUserRows } = await gapDQuery('SELECT email FROM users WHERE id = $1', [
			userId,
		]);
		gapFEmail = gapFUserRows[0]?.email ?? null;
	}
	// Privacy-review Finding 1 (#1125, PR #1160): validate the
	// RESOLVED address, regardless of source. The tombstone shape is
	// the one minted at routes/auth.js (`deleted_<id>_<hash>
	// @deleted.local` — the users-tombstone shape the GAP-D
	// signing-party redaction at this file's GAP-D block also keys
	// off, a synthetic deleted.local address). It is reachable here
	// via the admin DSAR caller (routes/admin.js passes no
	// originalEmail) after a self-delete tombstoned the address:
	// matching on it would match nothing and report a false-complete
	// clean zero. A NULL/unresolvable capture (no user row, no
	// email) is the same failure — the current code treated it only
	// as an unreported no-match branch, indistinguishable from a
	// genuine zero. Both are capture-failed: loud log (never the
	// address itself — this code never logs it), the flag qualifies
	// the email-matched families' zeros in the result, and the
	// effective match address is nulled so email-matched deletes
	// (email_queue, and the email branches of notification_queue /
	// notification_logs + their audio-cache knock-on) are not
	// issued at all. User-keyed deletes proceed normally.
	const gapFIsTombstoneEmail =
		typeof gapFEmail === 'string' && /^deleted_\d+_[^@]+@deleted\.local$/i.test(gapFEmail);
	if (!gapFEmail || gapFIsTombstoneEmail) {
		gapF.emailCaptureFailed = true;
		console.error(
			'[erasureService] #1125 GAP-F email capture failed — email-matched erasure skipped and flagged (gapF.emailCaptureFailed); user-keyed erasure proceeds',
		);
		gapFEmail = null;
	}

	// H1 any-hold probe (STOP 1 §4): computed lazily, once per run.
	// #1167: anyHoldActive SELF-CATCHES (a PG error returns true and
	// never throws), so the call is contained anyway — the helper's
	// unconditional rollback-to de-poisons the transaction even when
	// nothing throws. Its error⇒true semantics are unchanged: after a
	// contained call its return value governs.
	let gapFAnyHold = null;
	const gapFGetAnyHold = async () => {
		if (gapFAnyHold === null) gapFAnyHold = await containedConsult(() => anyHoldActive(queryable));
		return gapFAnyHold;
	};

	// Three-way per-row hold partition (GAP-F-local, gapEPartition
	// contract) with the H1 degraded rule for email-only rows: rows
	// flagged by opts.h1When cannot take a row-specific consult, so
	// after the candidate-level consult clears them they are ALSO
	// preserved whenever any hold is active anywhere (over-preservation
	// is the safe direction; survivals are counted and disclosed).
	const gapFPartition = async (rows, opts = {}) => {
		const companyOf = opts.companyOf || ((r) => r.company_id ?? null);
		const unheld = [];
		const heldRows = [];
		const failedRows = [];
		for (const row of rows) {
			try {
				const hold = await containedConsult(() =>
					findActiveHold(
						{ userId, companyId: companyOf(row) ?? null },
						queryable,
					),
				);
				if (hold != null) {
					heldRows.push(row);
					continue;
				}
				if (opts.h1When && opts.h1When(row) && (await gapFGetAnyHold())) {
					heldRows.push(row);
					continue;
				}
				unheld.push(row);
			} catch (holdErr) {
				console.error(
					'[erasureService] #1125 per-row legal-hold check failed — failing closed (skipping row, counted as lookup-failed):',
					holdErr.message,
				);
				failedRows.push(row);
			}
		}
		return {
			unheld,
			heldRows,
			failedRows,
			held: heldRows.length,
			lookupFailed: failedRows.length,
		};
	};
	// SELECT a family, partition, DELETE the unheld ids explicitly
	// (cascades are never the mechanism — the users row is
	// tombstoned, so they never fire).
	const gapFDeleteFamily = async (table, countKey, selectSql, deleteSql, opts = {}) => {
		const { rows } = await gapDQuery(selectSql, opts.selectParams || [userId]);
		const part = await gapFPartition(rows, opts);
		gapFNoteHeld(table, part.held);
		gapFNoteLookupFailed(table, part.lookupFailed);
		let deleted = 0;
		if (part.unheld.length > 0) {
			const ids = part.unheld.map((r) => r.id);
			const { rowCount } = await gapDQuery(
				deleteSql,
				opts.deleteParams ? opts.deleteParams(ids) : [userId, ids],
			);
			deleted = rowCount || 0;
		}
		gapF[countKey] = deleted;
		return { deleted, held: part.held, lookupFailed: part.lookupFailed, unheldRows: part.unheld };
	};

	// 1) communications — by candidate_id ONLY (never recruiter_id),
	// draft and sent alike (Lex ruling, STOP 1 §3). Self-FK closure:
	// the retained set (held ∪ lookup-failed) keeps every ancestor
	// via parent_id with it — an unheld parent of a retained child is
	// FK-blocked (NO ACTION) and must survive, counted in rowsHeld as
	// held-blocked. The remainder is deleted as ONE set statement
	// (NO ACTION checks fire at statement end, so intra-set parent/
	// child references do not block the set delete).
	const { rows: gapFCommRows } = await gapDQuery(
		'SELECT id, parent_id, company_id FROM communications WHERE candidate_id = $1',
		[userId],
	);
	const gapFCommPart = await gapFPartition(gapFCommRows);
	gapFNoteHeld('communications', gapFCommPart.held);
	gapFNoteLookupFailed('communications', gapFCommPart.lookupFailed);
	const gapFCommById = new Map(gapFCommRows.map((r) => [r.id, r]));
	const gapFCommRetainedIds = new Set(
		[...gapFCommPart.heldRows, ...gapFCommPart.failedRows].map((r) => r.id),
	);
	const gapFCommBlockedIds = new Set();
	for (const retained of [...gapFCommPart.heldRows, ...gapFCommPart.failedRows]) {
		const seen = new Set();
		let pid = retained.parent_id;
		while (pid != null && !seen.has(pid) && gapFCommById.has(pid)) {
			seen.add(pid);
			if (!gapFCommRetainedIds.has(pid)) {
				gapFCommBlockedIds.add(pid);
				gapFCommRetainedIds.add(pid);
			}
			pid = gapFCommById.get(pid)?.parent_id ?? null;
		}
	}
	gapFNoteHeld('communications', gapFCommBlockedIds.size);
	const gapFCommDeleteIds = gapFCommPart.unheld
		.filter((r) => !gapFCommBlockedIds.has(r.id))
		.map((r) => r.id);
	if (gapFCommDeleteIds.length > 0) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM communications WHERE candidate_id = $1 AND id = ANY($2)',
			[userId, gapFCommDeleteIds],
		);
		gapF.communications = rowCount || 0;
	}

	// 2) sequence_enrollments — by candidate_id, all statuses (no
	// sequence executor exists; the DELETE discharges the armed
	// next_send_at risk, STOP 1 §1.3).
	await gapFDeleteFamily(
		'sequence_enrollments',
		'sequenceEnrollments',
		'SELECT id, company_id FROM sequence_enrollments WHERE candidate_id = $1',
		'DELETE FROM sequence_enrollments WHERE candidate_id = $1 AND id = ANY($2)',
	);

	// 3) email_queue — email-only linkage (recipient string, no user
	// key): H1 rule for every row. Skipped entirely when no original
	// email could be captured (no match basis — never a guessed one).
	if (gapFEmail) {
		await gapFDeleteFamily(
			'email_queue',
			'emailQueue',
			'SELECT id FROM email_queue WHERE recipient = $1',
			'DELETE FROM email_queue WHERE recipient = $1 AND id = ANY($2)',
			{
				selectParams: [gapFEmail],
				deleteParams: (ids) => [gapFEmail, ids],
				h1When: () => true,
			},
		);
	}

	// 4) notification_queue — user_id OR email (user_id is nullable;
	// the email fallback is mandatory). NULL-user_id rows take H1.
	await gapFDeleteFamily(
		'notification_queue',
		'notificationQueue',
		gapFEmail
			? 'SELECT id, user_id FROM notification_queue WHERE user_id = $1 OR email = $2'
			: 'SELECT id, user_id FROM notification_queue WHERE user_id = $1',
		'DELETE FROM notification_queue WHERE id = ANY($1)',
		{
			selectParams: gapFEmail ? [userId, gapFEmail] : [userId],
			deleteParams: (ids) => [ids],
			h1When: (r) => r.user_id == null,
		},
	);

	// 5) notification_audio_cache + notification_logs — the cache is
	// a derived copy of a notification body (Principle 4): rows whose
	// notification_log_id ∈ the UNHELD log-id set are deleted
	// explicitly BEFORE the logs delete (cascade never assumed).
	// Cache rows of held/lookup-failed logs survive with their
	// parents; NULL-log-id rows are never selected (R-F1).
	const { rows: gapFLogRows } = await gapDQuery(
		gapFEmail
			? 'SELECT id, user_id FROM notification_logs WHERE user_id = $1 OR email = $2'
			: 'SELECT id, user_id FROM notification_logs WHERE user_id = $1',
		gapFEmail ? [userId, gapFEmail] : [userId],
	);
	const gapFLogPart = await gapFPartition(gapFLogRows, { h1When: (r) => r.user_id == null });
	gapFNoteHeld('notification_logs', gapFLogPart.held);
	gapFNoteLookupFailed('notification_logs', gapFLogPart.lookupFailed);
	const gapFUnheldLogIds = gapFLogPart.unheld.map((r) => r.id);
	if (gapFUnheldLogIds.length > 0) {
		const { rows: gapFCacheRows } = await gapDQuery(
			'SELECT id, notification_log_id FROM notification_audio_cache WHERE notification_log_id = ANY($1)',
			[gapFUnheldLogIds],
		);
		if (gapFCacheRows.length > 0) {
			const { rowCount } = await gapDQuery(
				'DELETE FROM notification_audio_cache WHERE id = ANY($1)',
				[gapFCacheRows.map((r) => r.id)],
			);
			gapF.notificationAudioCache = rowCount || 0;
		}
		const { rowCount } = await gapDQuery('DELETE FROM notification_logs WHERE id = ANY($1)', [
			gapFUnheldLogIds,
		]);
		gapF.notificationLogs = rowCount || 0;
	}

	// 6) Simple user-keyed deletes.
	await gapFDeleteFamily(
		'user_notifications',
		'userNotifications',
		'SELECT id FROM user_notifications WHERE user_id = $1',
		'DELETE FROM user_notifications WHERE user_id = $1 AND id = ANY($2)',
	);
	await gapFDeleteFamily(
		'notification_preferences',
		'notificationPreferences',
		'SELECT id FROM notification_preferences WHERE user_id = $1',
		'DELETE FROM notification_preferences WHERE user_id = $1 AND id = ANY($2)',
	);
	gapF.heldTables = [...gapFHeldTables];
	gapF.lookupFailedTables = [...gapFLookupFailedTables];

	// ── #1126 GAP-G (E-16): account residuals & tokens ────────────
	// Placement: immediately after the GAP-F block (STOP 1 §1 ruling:
	// every GAP-G write lands inside erasePersonalData; the users
	// strip below runs after ALL email-matched family deletes — its
	// own and GAP-F's — and the email it matches on is the GAP-F
	// captured original address above, never re-derived after
	// stripping). Whole-row DELETEs, counted — except the two
	// redactions, which are counted as redactions, never deletions:
	// the users-row strip (gapG.usersRedacted) and the assigned_by
	// severance (gapG.assignedBySevered). Legal hold: per-row
	// consults fail-closed through the GAP-G-local three-way partition
	// below (same contract as gapFPartition: an error is a counted
	// lookup-failed skip, never a held masquerade); the users strip is
	// additionally covered by the shipped entry gate — a held user
	// aborted this erasure before any block ran.
	const gapG = {
		calendarConnections: 0,
		oauthExchangeCodes: 0,
		refreshTokens: 0,
		oauthConnections: 0,
		passwordResetTokens: 0,
		userSettings: 0,
		userRoles: 0,
		usageLimits: 0,
		assessmentReferrals: 0,
		apiKeys: 0,
		usersRedacted: 0,
		assignedBySevered: 0,
		companyIdResidual: 0,
		rowsHeld: 0,
		heldTables: [],
		holdLookupFailed: 0,
		lookupFailedTables: [],
	};
	const gapGHeldTables = new Set();
	const gapGLookupFailedTables = new Set();
	const gapGNoteHeld = (table, n) => {
		if (n > 0) {
			gapG.rowsHeld += n;
			gapGHeldTables.add(table);
		}
	};
	const gapGNoteLookupFailed = (table, n) => {
		if (n > 0) {
			gapG.holdLookupFailed += n;
			gapGLookupFailedTables.add(table);
		}
	};
	// Three-way per-row hold partition (GAP-G-local, gapFPartition
	// contract): findActiveHold with the subject AND the row's own /
	// derived company_id (user-scoped rows carry none ⇒ {userId}
	// only; user_roles passes its row's company_id; referral rows
	// carry the company derived via their job — see the select).
	const gapGPartition = async (rows, companyOf = (r) => r.company_id ?? null) => {
		const unheld = [];
		const heldRows = [];
		const failedRows = [];
		for (const row of rows) {
			try {
				const hold = await containedConsult(() =>
					findActiveHold(
						{ userId, companyId: companyOf(row) ?? null },
						queryable,
					),
				);
				if (hold != null) heldRows.push(row);
				else unheld.push(row);
			} catch (holdErr) {
				console.error(
					'[erasureService] #1126 per-row legal-hold check failed — failing closed (skipping row, counted as lookup-failed):',
					holdErr.message,
				);
				failedRows.push(row);
			}
		}
		return {
			unheld,
			heldRows,
			failedRows,
			held: heldRows.length,
			lookupFailed: failedRows.length,
		};
	};
	// SELECT a family, partition, DELETE the unheld ids explicitly
	// (cascades are never the mechanism — the users row is
	// tombstoned, so they never fire).
	const gapGDeleteFamily = async (table, countKey, selectSql, deleteSql, opts = {}) => {
		const { rows } = await gapDQuery(selectSql, opts.selectParams || [userId]);
		const part = await gapGPartition(rows, opts.companyOf);
		gapGNoteHeld(table, part.held);
		gapGNoteLookupFailed(table, part.lookupFailed);
		let deleted = 0;
		if (part.unheld.length > 0) {
			const ids = part.unheld.map((r) => r.id);
			const { rowCount } = await gapDQuery(
				deleteSql,
				opts.deleteParams ? opts.deleteParams(ids) : [userId, ids],
			);
			deleted = rowCount || 0;
		}
		gapG[countKey] = deleted;
		return { deleted, held: part.held, lookupFailed: part.lookupFailed, unheldRows: part.unheld };
	};

	// 1) Credential / token families — a credential record dies
	// whole (STOP 1 §3): calendar OAuth tokens (shared-key encrypted
	// — encryption changes nothing), oauth exchange codes (expired
	// AND unexpired: rows hold plaintext tokens; expiry ≠ erasure),
	// refresh tokens (DELETE-at-erasure named decision — this also
	// closes the DSAR live-session risk), oauth connections and
	// password-reset tokens (DSAR parity with the self-serve flow).
	await gapGDeleteFamily(
		'calendar_connections',
		'calendarConnections',
		'SELECT id FROM calendar_connections WHERE user_id = $1',
		'DELETE FROM calendar_connections WHERE user_id = $1 AND id = ANY($2)',
	);
	await gapGDeleteFamily(
		'oauth_exchange_codes',
		'oauthExchangeCodes',
		'SELECT id FROM oauth_exchange_codes WHERE user_id = $1',
		'DELETE FROM oauth_exchange_codes WHERE user_id = $1 AND id = ANY($2)',
	);
	await gapGDeleteFamily(
		'refresh_tokens',
		'refreshTokens',
		'SELECT id FROM refresh_tokens WHERE user_id = $1',
		'DELETE FROM refresh_tokens WHERE user_id = $1 AND id = ANY($2)',
	);
	await gapGDeleteFamily(
		'oauth_connections',
		'oauthConnections',
		'SELECT id FROM oauth_connections WHERE user_id = $1',
		'DELETE FROM oauth_connections WHERE user_id = $1 AND id = ANY($2)',
	);
	await gapGDeleteFamily(
		'password_reset_tokens',
		'passwordResetTokens',
		'SELECT id FROM password_reset_tokens WHERE user_id = $1',
		'DELETE FROM password_reset_tokens WHERE user_id = $1 AND id = ANY($2)',
	);

	// 2) user_settings — keyed by its PK user_id (the table has no
	// id column): preference JSONBs are the subject's own data.
	const { rows: gapGSettingsRows } = await gapDQuery(
		'SELECT user_id FROM user_settings WHERE user_id = $1',
		[userId],
	);
	const gapGSettingsPart = await gapGPartition(gapGSettingsRows);
	gapGNoteHeld('user_settings', gapGSettingsPart.held);
	gapGNoteLookupFailed('user_settings', gapGSettingsPart.lookupFailed);
	if (gapGSettingsPart.unheld.length > 0) {
		const { rowCount } = await gapDQuery('DELETE FROM user_settings WHERE user_id = $1', [
			userId,
		]);
		gapG.userSettings = rowCount || 0;
	}

	// 3) user_roles — the subject's own rows, deleted by their
	// composite PK (the table has no id column); the row's own
	// company_id is the hold attribution.
	const { rows: gapGRoleRows } = await gapDQuery(
		'SELECT user_id, role_id, company_id FROM user_roles WHERE user_id = $1',
		[userId],
	);
	const gapGRolePart = await gapGPartition(gapGRoleRows);
	gapGNoteHeld('user_roles', gapGRolePart.held);
	gapGNoteLookupFailed('user_roles', gapGRolePart.lookupFailed);
	for (const row of gapGRolePart.unheld) {
		const { rowCount } = await gapDQuery(
			'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2 AND company_id = $3',
			[row.user_id, row.role_id, row.company_id],
		);
		gapG.userRoles += rowCount || 0;
	}

	// 4) usage_limits — per-user counters are behavioural data.
	await gapGDeleteFamily(
		'usage_limits',
		'usageLimits',
		'SELECT id FROM usage_limits WHERE user_id = $1',
		'DELETE FROM usage_limits WHERE user_id = $1 AND id = ANY($2)',
	);

	// 5) assessment_referrals — DELETE under all three linkages
	// (STOP 1 §3): email = the captured ORIGINAL address (the GAP-F
	// capture above; the branch is omitted when no usable address was
	// captured — never a guessed one), claimed_by_user_id, created_by.
	// Company for the hold partition is derived via the row's job
	// (job_assessment_id → job_assessments → jobs.company_id, GAP-B
	// precedent, aliased as company_id). Claim-then-erase leaves
	// job_applications / job_assessment_attempts to their own
	// families — no delete is issued against them here.
	await gapGDeleteFamily(
		'assessment_referrals',
		'assessmentReferrals',
		gapFEmail
			? `SELECT ar.id, j.company_id AS company_id
			   FROM assessment_referrals ar
			   LEFT JOIN job_assessments ja ON ja.id = ar.job_assessment_id
			   LEFT JOIN jobs j ON j.id = ja.job_id
			   WHERE ar.email = $2 OR ar.claimed_by_user_id = $1 OR ar.created_by = $1`
			: `SELECT ar.id, j.company_id AS company_id
			   FROM assessment_referrals ar
			   LEFT JOIN job_assessments ja ON ja.id = ar.job_assessment_id
			   LEFT JOIN jobs j ON j.id = ja.job_id
			   WHERE ar.claimed_by_user_id = $1 OR ar.created_by = $1`,
		'DELETE FROM assessment_referrals WHERE id = ANY($1)',
		{
			selectParams: gapFEmail ? [userId, gapFEmail] : [userId],
			deleteParams: (ids) => [ids],
		},
	);

	// 6) api_keys — by created_by (STOP 1 §3, added at STOP 1):
	// api-auth authenticates on key_hash + is_active with no users
	// join and no deleted_at check, so an erased user's key would
	// stay a working credential. The DELETE cascades api_key_usage
	// (FK CASCADE) — accepted and named at STOP 1.
	await gapGDeleteFamily(
		'api_keys',
		'apiKeys',
		'SELECT id FROM api_keys WHERE created_by = $1',
		'DELETE FROM api_keys WHERE created_by = $1 AND id = ANY($2)',
	);

	// 7) Severance (REDACTION, counted separately): user_roles rows
	// of OTHER users where the subject was only assigned_by are NOT
	// deleted — the attribution is severed to NULL (the column is
	// ON DELETE SET NULL by design) and the other user's
	// authorisation fact is preserved. Hold attribution is the
	// severed row's own company_id.
	const { rows: gapGAssignedRows } = await gapDQuery(
		'SELECT user_id, role_id, company_id FROM user_roles WHERE assigned_by = $1',
		[userId],
	);
	const gapGAssignedPart = await gapGPartition(gapGAssignedRows);
	gapGNoteHeld('user_roles', gapGAssignedPart.held);
	gapGNoteLookupFailed('user_roles', gapGAssignedPart.lookupFailed);
	for (const row of gapGAssignedPart.unheld) {
		const { rowCount } = await gapDQuery(
			'UPDATE user_roles SET assigned_by = NULL WHERE assigned_by = $1 AND user_id = $2 AND role_id = $3 AND company_id = $4',
			[userId, row.user_id, row.role_id, row.company_id],
		);
		gapG.assignedBySevered += rowCount || 0;
	}

	// 8) Users-row completion strip (REDACTION) — LAST in the block,
	// after every email-matched delete. Per-column disposition per
	// STOP 1 §2: the E-16 residuals (linkedin_data, title,
	// github_username, company_name, suspended_at) NULL, plus the
	// tombstone parity fields the DSAR path never applied. No
	// synthetic replacements beyond the two established tombstone
	// values; the email CASE preserves an existing synthetic address
	// (the self-serve flow already minted one) instead of re-minting.
	// company_id: NULL for candidate subjects only; employer-side
	// company_id is KEPT as a named residual (Lex to confirm) and
	// counted in gapG.companyIdResidual. K-6 billing fields
	// (stripe_subscription_id, subscription_plan, subscription_status,
	// is_paid) are NOT touched and NOT claimed erased.
	// Idempotency: when the row already sits at the full tombstone
	// state the UPDATE is not issued at all and usersRedacted stays 0.
	const { rows: gapGUserRows } = await gapDQuery(
		`SELECT email, name, role, company_id, deleted_at, linkedin_data, title,
		        github_username, company_name, suspended_at, password_hash,
		        google_id, linkedin_id, oauth_provider, avatar_url
		 FROM users WHERE id = $1`,
		[userId],
	);
	const gapGUser = gapGUserRows[0] ?? null;
	if (gapGUser) {
		if (gapGUser.role !== 'candidate' && gapGUser.company_id != null) {
			gapG.companyIdResidual = 1;
		}
		const gapGEmailIsTombstone =
			typeof gapGUser.email === 'string' &&
			/^deleted_\d+_[^@]+@deleted\.local$/i.test(gapGUser.email);
		const gapGNeedsStrip =
			!gapGEmailIsTombstone ||
			gapGUser.name !== 'Deleted User' ||
			gapGUser.deleted_at == null ||
			gapGUser.linkedin_data != null ||
			gapGUser.title != null ||
			gapGUser.github_username != null ||
			gapGUser.company_name != null ||
			gapGUser.suspended_at != null ||
			gapGUser.password_hash != null ||
			gapGUser.google_id != null ||
			gapGUser.linkedin_id != null ||
			gapGUser.oauth_provider != null ||
			gapGUser.avatar_url != null ||
			(gapGUser.role === 'candidate' && gapGUser.company_id != null);
		if (gapGNeedsStrip) {
			const { rowCount } = await gapDQuery(
				`UPDATE users SET
					deleted_at = NOW(),
					email = CASE WHEN email ~ '^deleted_[0-9]+_[^@]+@deleted\\.local$' THEN email ELSE 'deleted_' || id || '_' || substr(md5(random()::text), 1, 8) || '@deleted.local' END,
					name = 'Deleted User',
					password_hash = NULL,
					google_id = NULL,
					linkedin_id = NULL,
					oauth_provider = NULL,
					avatar_url = NULL,
					linkedin_data = NULL,
					title = NULL,
					github_username = NULL,
					company_name = NULL,
					suspended_at = NULL,
					company_id = CASE WHEN role = 'candidate' THEN NULL ELSE company_id END
				WHERE id = $1`,
				[userId],
			);
			gapG.usersRedacted = rowCount || 0;
		}
	}
	gapG.heldTables = [...gapGHeldTables];
	gapG.lookupFailedTables = [...gapGLookupFailedTables];

	// #1293: explicit final CSI delete — ordering-independent closure.
	// The admin-DSAR path has no prior tombstone, so CSI closure must
	// not depend on the GAP-G strip above firing trg_sync_csi_users;
	// the search-index row is deleted explicitly here, after GAP-G.
	await gapDQuery('DELETE FROM candidate_search_index WHERE user_id = $1', [userId]);

	return {
		shredded,
		embeddingsDeleted: embeddingsRows > 0,
		searchIndexDeleted: searchIndexRows > 0,
		cvUploadsDeleted: cvUploadRows.length > 0,
		parsedResumesDeleted: parsedResumeRows.length > 0,
		candidateProfileDeleted: profileRows.length > 0,
		identityVerificationsDeleted: verificationRows > 0,
		cvAnalysesDeleted: analysisRows > 0,
		cvReviewsDeleted: reviewRows > 0,
		verificationRequestsDeleted: verificationRequestRows.length > 0,
		verificationDocumentsDeleted: verificationDocRows.length > 0,
		workExperienceDeleted: workExpRows > 0,
		educationDeleted: educationRows > 0,
		candidateSkillsDeleted: skillsRows > 0,
		linkedinProfileDeleted: linkedinRows > 0,
		careerDiagnosesDeleted: diagnosisRows > 0,
		messagesDeleted: messageRows.length > 0,
		userMemoryDeleted: userMemoryRows > 0,
		matchResultsDeleted: matchResultRows > 0,
		practiceSessionsDeleted: practiceSessionRows > 0,
		screeningSessionsDeleted: screeningSessionRows > 0,
		interviewTranscriptsDeleted: transcriptRows > 0,
		omniScoresDeleted: omniScoreRows > 0,
		roleScoresDeleted: roleScoreRows > 0,
		screeningAnswersDeleted: screeningAnswerRows > 0,
		interviewEvaluationsDeleted: evaluationRows > 0,
		interviewCompositeScoresDeleted: compositeScoreRows > 0,
		scoreComponentsDeleted: scoreComponentRows > 0,
		scoreHistoryDeleted: scoreHistoryRows > 0,
		jobRecommendationsDeleted: jobRecommendationRows > 0,
		recordingConsentRedacted: consentRedactedRows > 0,
		jobApplicationsRedacted: jobApplicationsRedactedRows > 0,
		jobApplicationRowsHeld,
		// #813 (S-094) C2 sweep: five *Deleted booleans (true only when
		// rows were actually deleted), the D-1 child DELETE counts, the
		// held/skipped count with per-row details (held applications +
		// D-3 fail-closed skips), and the D-2 consent tombstone.
		screeningResponsesDeleted: screeningResponsesDeletedCount > 0,
		jobApplicationScreeningsDeleted: jobApplicationScreeningsDeletedCount > 0,
		aiScreeningsDeleted: aiScreeningsDeletedCount > 0,
		outreachAttemptsDeleted: outreachAttemptsDeletedCount > 0,
		autoApplyProfileDeleted: autoApplyProfileDeletedCount > 0,
		aiScreeningAuditLogsDeleted,
		aiScreeningHumanReviewsDeleted,
		// #1337: dead-letter markers replayed into compliance_audit_trail
		// before the D-1 DELETEs above (count only; sanitizer-safe).
		complianceAuditMarkersDrained,
		applicationKeyedRowsHeld,
		applicationKeyedHeldDetails,
		autoApplyConsentTombstone,
		// #807 (S-090): threat_intel_checks whole-row DELETE count +
		// held-row survival count (see the C2-position block above).
		threatIntelChecksDeleted,
		threatIntelRowsHeld,
		// #815 (S-095): application_ip_captures whole-row DELETE count +
		// held-row survival count (same position/shape as #807 above).
		applicationIpCapturesDeleted,
		applicationIpRowsHeld,
		observerReportsDeleted: observerReportRows > 0,
		observerJobsDeleted: observerJobRows > 0,
		observerAudioChunksDeleted: (oaChunkRes?.rowCount || 0) > 0,
		observerSpeechMeasurementsDeleted: (oaMeasurementsRes?.rowCount || 0) > 0,
		observerCaptureOutcomesDeleted: (oaOutcomesRes?.rowCount || 0) > 0,
		// GAP-A (#1120): per-mechanism counts, S-078 pattern. Held rows are
		// disclosed here (gapAHeldSkips + per-family held counts), never
		// silently skipped (#1116).
		interviewSessionsStripped: sessionsStripped > 0,
		sessionsStripped,
		sessionsHeld,
		transcriptsDeleted: transcriptRows || 0,
		// S-D13 (#1915): diarization artefact counts (E-3 explicit path).
		diarizationJobsDeleted: diarizationJobRows || 0,
		diarizationRunsDeleted: diarizationRunRows || 0,
		// #1944 (F-2): cross-recording id nulls on OTHER subjects'
		// recordings (field-null operations for mappings; rows touched
		// for audit). Rows themselves survive — see the sweep above.
		crossRecordingMappingsNulled:
			(crossMappingParticipantRows || 0) + (crossMappingUpdatedByRows || 0),
		crossRecordingAuditNulled: crossAuditRows || 0,
		// #2014 (residuals II): frozen panel pairs swept on OTHER
		// subjects' recordings (item 1), proposed_mapping entries
		// nulled on surviving runs (item 2, runs touched), and panel
		// pairs cleared on the subject's own tombstones (item 3).
		crossRecordingPanelPairsSwept: crossPanelSetRows || 0,
		crossRecordingPanelJobsCancelled: crossPanelJobCancelRows || 0,
		crossRecordingProposedMappingsNulled: crossProposalRunRows || 0,
		tombstonePanelPairsCleared,
		// S-D19 (#1956): the subject's own panel labelling consent rows.
		panelLabellingConsentDeleted: panelLabellingConsentRows || 0,
		// #2011 Part A: retained panel_consent_snapshot copies naming
		// this user on surviving diarization_jobs/runs rows (S-D19
		// exception, disclosed — never swept here).
		panelConsentSnapshotsRetained,
		speakerMappingsDeleted: speakerMappingRows || 0,
		speakerAuditDeleted: speakerAuditRows || 0,
		recordingsLedgered: recordingLedgerKeys.length,
		recordingsRedacted,
		recordingsHeld,
		recordingsUndecryptable,
		recordingFramesLedgered: frameLedgerKeys.length > 0,
		framesLedgered: frameLedgerKeys.length,
		framesHeld,
		gapAHeldSkips,
		gapB,
		gapC,
		gapD,
		gapE,
		gapF,
		gapG,
		gapH,
		storageKeys: [
			...r2Keys,
			...localPaths.map((p) => `local:${p}`),
			...observerAudioKeys,
			...recordingLedgerKeys,
			...frameLedgerKeys,
			...gapDStorageKeys,
			...gapCStorageKeys,
			...gapEStorageKeys,
		],
	};
}

// ─── #1171: bounded retry bound for 'failed' ledger rows ────────────────────
// `attempts` (migration 252) counts DRAIN RUNS for a row (one run = up to
// 3 internal storage tries in the loop below). A 'failed' row is eligible
// for the drain again while attempts < this bound; at/over it the row
// stays 'failed' — a true dead letter whose only exit is the manual
// verified-absent disposition below, never an unbounded retry loop.
const STORAGE_DELETION_MAX_ATTEMPTS = 5;

/**
 * Phase 2 of S-076 erasure: delete storage objects AFTER the DB transaction
 * commits. Reads from the pending_storage_deletions ledger (written in-tx by
 * Phase 1) — crash-safe: the S-077 cron sweeps un-marked entries.
 * R2 NEVER in-tx (distributed-transaction failure mode).
 *
 * Handles both R2/B2 URLs (via deleteFile) and local-disk paths
 * (verification_requests files, via deleteEncryptedFile).
 *
 * #1128 (GAP-I, D-8a): ONE aggregate audit entry per drain run per
 * subject (Art. 5(2) accountability for the RUN, not the object) —
 * counts by source family / storage type + error CLASS counts only.
 * The pre-#1128 per-file entries persisted the raw storage key
 * (file_url) permanently in biometric_audit_log.metadata (K-2 defect
 * (i)); no file_url, raw error message (messages embed bucket names /
 * locations), or any storage key is written here. The in-process
 * `failures` list (raw keys, for the operator caller in memory only)
 * is unchanged and is never persisted by this function.
 * Idempotent — already-deleted objects count as success.
 *
 * @param {number} userId — the erasing user
 * @param {object} [opts.audit] — { userId, userRole, ipAddress, companyId }
 * @returns {Promise<{ deleted: number, failed: number, failures: string[], heldSkips: number,
 *   ownershipSkips: number, ownershipLookupFailed: number, ownershipSkipsByFamily: object }>}
 *
 * #1137 ownership gate (per entry, after the legal-hold consult,
 * before any delete): a non-catalogue /api/files/ entry is deleted
 * only when NO surviving database row still references the object
 * (lib/storageOwnership.js). A surviving reference means the object
 * is another tenant's, a company's, or a retained joint record's —
 * several ledgered URL fields are client-supplied, so the ledgered
 * row being the erasing user's proves nothing about the object.
 * Contested entries fail closed exactly like held ones: the object
 * is NOT deleted, the ledger row stays 'pending' (never 'failed',
 * no attempts increment — a contested object is not a dead letter),
 * and the skip is counted in ownershipSkips /
 * ownershipSkipsByFamily. A reference-query error fails closed the
 * same way, counted in ownershipLookupFailed. Counts only are ever
 * disclosed (K-2); no URL, key, or hash is persisted here.
 */
async function deleteErasedStorageFiles(userId, { audit } = {}) {
	// #1395 audit (follow-up of #1343): the pool fallback here is
	// DELIBERATE — do NOT apply the #1343 transaction-client guard to
	// this function. Phase 2 runs POST-COMMIT by design (both route
	// callers invoke it after COMMIT; R2 is never in-tx), so there is
	// no caller transaction to protect. Correctness is per-entry, via
	// the ledger state machine: deletes are idempotent, and each
	// entry's outcome is recorded on its own row before the next is
	// attempted (when the DB is reachable — the recording UPDATE is
	// deliberately unguarded, so a DB throw aborts the run; entries
	// not yet attempted stay 'pending', and an entry whose object was
	// deleted but whose UPDATE failed also stays 'pending', the safe
	// direction: the idempotent re-drain converges it). Recovery
	// scope, stated exactly (#1171): the drain re-processes 'pending'
	// rows AND 'failed' rows whose attempts are still under
	// STORAGE_DELETION_MAX_ATTEMPTS — bounded retry, so a transient
	// storage failure is no longer a permanent dead letter. A
	// 'failed' row AT/OVER the bound is NOT selected: it stays
	// 'failed', honestly recorded and counted, until the manual
	// verified-absent disposition (below) resolves it. Caller consequence of an
	// abort: both route callers surface the throw as a request
	// failure even though Phase 1 already committed — the erasure
	// itself is NOT undone, and the ledger carries the remainder.
	// The fail-closed property this function DOES rely on — the
	// per-entry legal-hold consult (isHeld: error ⇒ held ⇒ skip) —
	// is per-entry, not transactional, and is unaffected by
	// autocommit. Pinned by
	// server/__tests__/lib/erasure-pool-fallback-audit-1395.test.js.
	const db = require('./db');
	const { deleteEncryptedFile } = require('../services/encryption');

	const { rows: pending } = await db.query(
		`SELECT id, file_url, storage_type, source_family, attempts FROM pending_storage_deletions
     WHERE user_id = $1 AND (status = 'pending' OR (status = 'failed' AND attempts < $2)) ORDER BY id`,
		[userId, STORAGE_DELETION_MAX_ATTEMPTS],
	);
	if (!pending.length)
		return {
			deleted: 0,
			failed: 0,
			failures: [],
			heldSkips: 0,
			ownershipSkips: 0,
			ownershipLookupFailed: 0,
			ownershipSkipsByFamily: {},
		};

	let deleted = 0;
	let heldSkips = 0;
	let ownershipSkips = 0;
	let ownershipLookupFailed = 0;
	const ownershipSkipsByFamily = {};
	const failures = [];
	// #1128 D-8a aggregate tallies: terminal entries (deleted + failed)
	// by family/type; failures by error class/code only.
	const bySourceFamily = {};
	const byStorageType = {};
	const errorClassCounts = {};
	const bump = (obj, key) => {
		obj[key] = (obj[key] || 0) + 1;
	};
	const errorClassOf = (err) => String(err?.code || err?.name || 'Error');

	for (const entry of pending) {
		// #799 (G-1): the ledger drain is a deletion path — a hold placed
		// after Phase 1 ledgered this key (but before Phase 2 drains it)
		// must still stop the storage delete. Per-entry consult on the
		// row's user_id (migration 252); held entries stay 'pending',
		// visibly skipped + counted, never silently retained or deleted.
		// isHeld is fail-closed (error ⇒ held ⇒ skip).
		if (await isHeld({ userId }, db)) {
			heldSkips++;
			continue;
		}
		// #1137 ownership gate (see the docstring above): local entries
		// address no storage object, and catalogue families
		// (frame / observer_audio / livekit_recording) carry
		// server-generated keys ledgered from candidate-keyed rows —
		// both are exempt BY SOURCE. Every other /api/files/ entry must
		// prove no surviving row references the object before the
		// delete below may run. Fail-closed on every doubt.
		if (
			entry.storage_type !== 'local' &&
			!CATALOGUE_SOURCE_FAMILIES.has(entry.source_family) &&
			typeof entry.file_url === 'string' &&
			entry.file_url.startsWith('/api/files/')
		) {
			// storageUrlForms mirrors deleteFile's own parsing floor:
			// a URL it returns null for (undecodable, or no provider
			// prefix) is one deleteFile itself can never delete — it
			// soft-skips to 'failed' on the legacy path below, so
			// ownership is moot for it and behaviour is unchanged.
			const forms = storageUrlForms(entry.file_url);
			let stillReferenced = false;
			if (forms) {
				try {
					stillReferenced = await hasSurvivingStorageReference(db, { userId, forms });
				} catch (ownershipErr) {
					ownershipLookupFailed++;
					console.error(
						`[erasure] storage ownership lookup failed: ledger_id=${entry.id} error_class=${errorClassOf(ownershipErr)}`,
					);
					continue;
				}
			}
			if (stillReferenced) {
				ownershipSkips++;
				bump(ownershipSkipsByFamily, entry.source_family || 'file');
				continue;
			}
		}
		let ok = false;
		let lastErr = null;
		for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
			try {
				if (entry.source_family === 'livekit_recording') {
					// GAP-A (#1120): egress objects live in the RECORDING
					// bucket, addressed by neither ledger URL form shipped
					// before this story: deleteFile() wants /api/files/…
					// URLs and deleteStorageObject() wants a raw
					// provider-prefixed key, while egress fileResults
					// locations are `s3://<bucket>/rekrut-recordings/…`
					// (verified against the in-repo egress fixtures).
					// Mapping, using ONLY the existing primitives: strip
					// the scheme/bucket to the raw key; if the location
					// names a bucket, ONLY a configured file-storage
					// provider owning that exact bucket may be used —
					// no provider match ⇒ visible failure below, never a
					// guess at another bucket and never a silent success.
					// (RECORDING_STORAGE_* is not set on the Render
					// services as of this build, so whether the egress
					// bucket coincides with a file-storage bucket is an
					// ops fact Phase 2 cannot assume — the re-estimate
					// trigger from STOP 1 §6 stays named in the PR.)
					const loc = entry.file_url;
					if (loc.startsWith('/api/files/')) {
						const res = await deleteFile(loc);
						ok = res.deleted || res.alreadyGone;
						if (!ok) {
							lastErr = new Error(`skipped: ${res.reason}`);
							break;
						}
					} else {
						const s3Match = loc.match(/^s3:\/\/([^/]+)\/(.+)$/);
						const httpMatch = loc.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+)$/);
						const bucket = s3Match?.[1] || httpMatch?.[1] || null;
						const rawKey = s3Match?.[2] || httpMatch?.[2] || loc;
						const providers = typeof getProviders === 'function' ? getProviders() : [];
						// S-1: no parseable bucket ⇒ fail closed exactly like a
						// bucket mismatch — never fall back to trying every
						// provider (a same-keyed object in the wrong bucket
						// could be deleted, or a false success reported).
						const candidates = bucket
							? providers.filter((p) => p.bucket === bucket)
							: [];
						if (!candidates.length) {
							lastErr = new Error(
								bucket
									? `recording bucket "${bucket}" is not a configured file-storage provider bucket — no existing primitive can address this egress object`
									: 'recording location carries no parseable bucket — failing closed, no bucket guessed',
							);
							break; // not retryable — configuration, not transient
						}
						let lastRes = null;
						for (const provider of candidates) {
							const res = await deleteStorageObject(`${provider.name}/${rawKey}`);
							lastRes = res;
							if (res.deleted || res.alreadyGone) {
								ok = true;
								break;
							}
						}
						if (!ok) {
							lastErr = new Error(`skipped: ${lastRes?.reason || 'delete_failed'}`);
							break; // soft-fail reasons are not retryable
						}
					}
				} else if (entry.storage_type === 'local') {
					// ponytail: deleteEncryptedFile is idempotent (existsSync
					// check) and path-traversal-safe — no retry needed for
					// local deletes, but keep the loop uniform.
					deleteEncryptedFile(entry.file_url);
					ok = true;
				} else {
					// ponytail: deleteFile is idempotent (NoSuchKey = success)
					// and never throws on unparseable URLs — only true storage
					// errors reach the retry loop.
					const res = await deleteFile(entry.file_url);
					ok = res.deleted || res.alreadyGone;
					if (!ok) {
						lastErr = new Error(`skipped: ${res.reason}`);
						break; // not retryable
					}
				}
			} catch (err) {
				lastErr = err;
				if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
			}
		}

		const newStatus = ok ? 'deleted' : 'failed';
		await db.query(
			`UPDATE pending_storage_deletions
       SET status = $1, attempts = attempts + 1, last_error = $2, updated_at = NOW()
       WHERE id = $3`,
			[newStatus, ok ? null : lastErr?.message || 'unknown', entry.id],
		);

		// #1128 D-8a: no per-file audit entry — tallies feed the ONE
		// aggregate entry written after the loop.
		bump(bySourceFamily, entry.source_family || 'file');
		bump(byStorageType, entry.storage_type || 'unknown');

		if (ok) {
			deleted++;
		} else {
			failures.push(entry.file_url);
			bump(errorClassCounts, errorClassOf(lastErr));
			// Ledger id + error class only — never the storage key or the
			// raw error message (which can embed bucket names/locations).
			console.error(
				`[erasure] storage delete failed after 3 attempts: ledger_id=${entry.id} error_class=${errorClassOf(lastErr)}`,
			);
		}
	}

	// #1128 D-8a: one aggregate biometric_audit_log entry per drain run
	// per subject. Audit failure stays swallowed-to-console exactly as
	// the per-file write was (the ledger rows themselves are the
	// durable record of what drained). #1194: the context-free default
	// role 'system' below is now valid — migration 267 widened the
	// user_role CHECK and logAccess validates roles loudly — so this
	// catch no longer fires on every context-free run.
	try {
		await biometricAudit.logAccess({
			userId: audit?.userId ?? userId,
			userRole: audit?.userRole ?? 'system',
			action: 'delete',
			dataType: 'storage_file',
			candidateId: audit?.userId ?? userId,
			ipAddress: audit?.ipAddress || null,
			companyId: audit?.companyId ?? null,
			metadata: {
				deleted,
				failed: failures.length,
				heldSkips,
				ownershipSkips,
				ownershipLookupFailed,
				ownershipSkipsByFamily,
				bySourceFamily,
				byStorageType,
				errorClassCounts,
			},
		});
	} catch (auditErr) {
		console.error('[erasure] storage-delete audit failed:', auditErr.message);
	}

	return {
		deleted,
		failed: failures.length,
		failures,
		heldSkips,
		ownershipSkips,
		ownershipLookupFailed,
		ownershipSkipsByFamily,
	};
}

/**
 * S-077 reconciliation sweep: process ALL pending storage deletions across
 * users (crash recovery for entries still 'pending').
 *
 * #1171: this sweep DOES retry 'failed' entries — bounded. Both the
 * enumeration here and the drain in deleteErasedStorageFiles select
 * 'pending' rows plus 'failed' rows with attempts under
 * STORAGE_DELETION_MAX_ATTEMPTS, so the claim the pre-#1128 docstring
 * made ("retry of failed entries") is now true, with the bound the
 * old text never had. A 'failed' row at/over the bound stays a dead
 * letter, preserved byte-for-byte until the manual verified-absent
 * disposition (disposeFailedStorageDeletionsVerifiedAbsent) resolves
 * it. (History: #1128 D-10 corrected the original false docstring to
 * say no retry happened; #1171 then shipped the bounded retry.)
 *
 * @param {object} [opts.audit] — audit context for the sweep
 * @returns {Promise<{ deleted: number, failed: number, heldSkips: number }>}
 */
async function sweepPendingStorageDeletions({ audit } = {}) {
	// #1395 audit: deliberate pool use, same reasoning as
	// deleteErasedStorageFiles above — this is the crash-recovery batch
	// sweep (server.js retention tick, no-arg call). It holds no
	// multi-statement invariant: it enumerates users with 'pending'
	// rows and delegates each to the per-entry drain. No #1343 guard —
	// its only production caller passes no client and must keep
	// working. Per-user failure isolation (#1395 review MEDIUM): one
	// user's drain throw is logged (error class only) and skipped —
	// it must not starve later users (the enumeration is ORDER BY
	// user_id, so an un-isolated poison user would repeat-abort every
	// 24h tick at the same point) nor block the ledger purge that
	// server.js awaits after the sweep in the same tick. The failed
	// user's rows stay 'pending' for the next tick.
	const db = require('./db');
	const { rows } = await db.query(
		`SELECT DISTINCT user_id FROM pending_storage_deletions WHERE status = 'pending' OR (status = 'failed' AND attempts < $1) ORDER BY user_id`,
		[STORAGE_DELETION_MAX_ATTEMPTS],
	);
	let totalDeleted = 0;
	let totalFailed = 0;
	let totalHeldSkips = 0;
	for (const { user_id } of rows) {
		try {
			const res = await deleteErasedStorageFiles(user_id, { audit });
			totalDeleted += res.deleted;
			totalFailed += res.failed;
			totalHeldSkips += res.heldSkips || 0;
		} catch (err) {
			console.error(
				`[erasure] storage sweep failed for user ${user_id}: error_class=${String(err?.code || err?.name || 'Error')}`,
			);
		}
	}
	return { deleted: totalDeleted, failed: totalFailed, heldSkips: totalHeldSkips };
}

// ─── #1128 GAP-I: ledger terminal purge (D-1..D-6) ──────────────────────────
// The drain leaves status='deleted' ledger rows behind forever — a
// permanent shadow inventory of erased objects' storage keys (K-2).
// This purge is the ledger's terminal state: after a 7-day grace (an
// ops/reconciliation window, not a counsel clock), a drained row is
// folded into ONE bounded, key-free audit_logs record per user (the
// erasure FACT and its counts survive under K-2) and the ledger row —
// the per-object key inventory — is deleted. It is a SEPARATE sweep:
// never inside erasePersonalData, never inside the drain loop (D-1).
const STORAGE_DELETION_PURGE_GRACE_DAYS = 7;
const STORAGE_DELETION_PURGE_MAX_USERS_PER_RUN = 500;
const PURGE_ELIGIBILITY = `status = 'deleted' AND updated_at < NOW() - INTERVAL '${STORAGE_DELETION_PURGE_GRACE_DAYS} days'`;

async function purgeDrainedStorageDeletions({ queryable } = {}) {
	// #1395 audit: on the pool path this is NOT the #1343 void, and
	// the pool singleton is an acceptable queryable BY DESIGN (contrast
	// erasePersonalData, which rejects it). This purge is
	// SELF-transactional: the pool is used only for read-only
	// candidate/count queries and the fail-closed hold pre-pass, and as
	// a client factory — every write (the fold INSERT + the ledger
	// DELETE) runs inside a per-user BEGIN…COMMIT on a dedicated
	// pool.connect() client, count-checked, with rollback on error
	// (D-3/D-4 below). No caller transaction is assumed.
	// Caller contract, NARROWED by the #1395 specialist review (HIGH):
	// the queryable must be a POOL — an object with connect() — or
	// omitted (the lib/db pool). A bare {query}-only queryable is
	// REFUSED with a typed error below, before any data is touched:
	// BEGIN on it would be either non-sticky (if it delegates per-query
	// to a pool — the #1343 void) or a no-op inside a caller's
	// transaction whose COMMIT/ROLLBACK this function would then
	// hijack. A connected pg Client is likewise not a pool: its
	// connect() rejects once connected, which the per-user containment
	// below surfaces as that user's 'error' skip — never a silent
	// bare-client transaction. Pinned by
	// server/__tests__/lib/erasure-pool-fallback-audit-1395.test.js.
	const pool = queryable || require('./db');
	if (typeof pool.connect !== 'function') {
		const err = new Error(
			'purgeDrainedStorageDeletions requires a pool (an object with connect()): ' +
				'it runs per-user BEGIN…COMMIT on dedicated clients it acquires itself',
		);
		err.name = 'ErasurePurgePoolRequiredError';
		err.code = 'ERASURE_PURGE_POOL_REQUIRED';
		throw err;
	}
	const result = {
		ledgerRowsPurged: 0,
		ledgerRowsRetainedFailed: 0,
		ledgerRowsRetainedPending: 0,
		ledgerRowsRetainedHeld: 0,
		ledgerHoldLookupFailed: 0,
		usersPurged: 0,
		usersSkipped: 0,
		perUser: [],
	};
	// Per-user status counts in ONE aggregate query (used for the
	// pre-pass partitions on the pool and, inside the tx, for a purged
	// user's retained-at-purge-time counts). eligible_deleted carries
	// the D-2 predicate; failed/pending rows are never eligible (D-6).
	const countsFor = async (q, userId) => {
		const { rows } = await q.query(
			`SELECT
				COUNT(*) FILTER (WHERE ${PURGE_ELIGIBILITY})::int AS eligible_deleted,
				COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
				COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
			 FROM pending_storage_deletions WHERE user_id = $1`,
			[userId],
		);
		return rows[0] || { eligible_deleted: 0, failed: 0, pending: 0 };
	};

	const { rows: candidates } = await pool.query(
		`SELECT user_id FROM pending_storage_deletions
		 WHERE ${PURGE_ELIGIBILITY}
		 GROUP BY user_id ORDER BY user_id LIMIT $1`,
		[STORAGE_DELETION_PURGE_MAX_USERS_PER_RUN],
	);

	for (const { user_id: userId } of candidates) {
		const entry = {
			userId,
			status: 'skipped',
			ledgerRowsPurged: 0,
			retainedFailed: 0,
			retainedPending: 0,
			retainedHeld: 0,
			holdLookupFailed: 0,
		};
		result.perUser.push(entry);
		const retainCounts = (c) => {
			entry.retainedFailed = c.failed;
			entry.retainedPending = c.pending;
			result.ledgerRowsRetainedFailed += c.failed;
			result.ledgerRowsRetainedPending += c.pending;
		};
		// #1176: EVERY path for this user — purged or skipped — must
		// contribute the user's retained failed/pending counts to the
		// run totals EXACTLY ONCE. Previously the in-tx held path and
		// the advisory-lock-lost / zero-locked skip paths never called
		// retainCounts, so rows that survived were absent from the
		// run's retained totals. The guard makes a second contribution
		// structurally impossible (no double-counting).
		let retainedCounted = false;
		const retainCountsOnce = (c) => {
			if (retainedCounted) return;
			retainedCounted = true;
			retainCounts(c);
		};

		// D-3 pre-pass (pool): three-way partition. findActiveHold THROWS
		// on lookup error — held and lookup-failed both preserve every
		// row for this user, and are counted separately (never netted).
		let activeHold = null;
		let lookupFailed = false;
		try {
			activeHold = await findActiveHold({ userId }, pool);
		} catch (_holdErr) {
			lookupFailed = true;
		}
		if (activeHold || lookupFailed) {
			// #1176: countsFor is CONTAINED per-user here. It previously
			// sat outside any try, so a counts failure aborted the whole
			// run — narrower than this function's containment design
			// ("one user's failure never aborts the run"). Fail closed:
			// count NOTHING for this user (never fabricate counts),
			// mark them 'error', and continue with the next user.
			let c;
			try {
				c = await countsFor(pool, userId);
			} catch (countsErr) {
				entry.status = 'error';
				entry.errorClass = String(countsErr?.code || countsErr?.name || 'Error');
				result.usersSkipped++;
				console.error(
					`[erasure] storage-deletion ledger purge counts failed for user ${userId}: error_class=${entry.errorClass}`,
				);
				continue;
			}
			retainCountsOnce(c);
			if (activeHold) {
				entry.status = 'held';
				entry.retainedHeld = c.eligible_deleted;
				result.ledgerRowsRetainedHeld += c.eligible_deleted;
			} else {
				entry.status = 'lookup_failed';
				entry.holdLookupFailed = c.eligible_deleted;
				result.ledgerHoldLookupFailed += c.eligible_deleted;
			}
			result.usersSkipped++;
			continue;
		}

		// Clear user: per-user transaction on a dedicated client (D-3).
		// connect() is acquired INSIDE the try (#1395 review): an
		// acquisition failure (pool exhausted, or a non-pool queryable
		// whose connect rejects) skips THIS user as 'error' instead of
		// aborting the whole run. Until acquisition succeeds `client`
		// stays === pool, so the catch/finally correctly skip the
		// rollback/release for a client that was never acquired.
		let client = pool;
		try {
			client = await pool.connect();
			await client.query('BEGIN');
			// Per-user advisory lock (xact-scoped): two parallel purge
			// runs must not split one user's rows between them — that
			// would write two fold rows for the user. The loser of the
			// lock skips the user this run (a later run finds nothing,
			// or the rows once the winner commits and grace still holds).
			const { rows: lockRows } = await client.query(
				`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
				[`gap-i-ledger-purge:${userId}`],
			);
			if (!lockRows[0]?.locked) {
				await client.query('ROLLBACK');
				// #1176: skipped ≠ invisible — this user's failed/pending
				// rows survive, so they count toward the run's retained
				// totals exactly once (pool, read-only, post-ROLLBACK).
				// A counts failure throws into the per-user catch below:
				// 'error', nothing counted, run continues.
				retainCountsOnce(await countsFor(pool, userId));
				result.usersSkipped++;
				continue;
			}
			const { rows: locked } = await client.query(
				`SELECT id, source_family, storage_type, attempts, created_at, updated_at
				 FROM pending_storage_deletions
				 WHERE user_id = $1 AND ${PURGE_ELIGIBILITY}
				 ORDER BY id FOR UPDATE SKIP LOCKED`,
				[userId],
			);
			if (!locked.length) {
				// A concurrent purge run drained this user first — no
				// fold row for a user with nothing purged (D-4).
				await client.query('ROLLBACK');
				// #1176: retained failed/pending rows still count toward
				// the run totals exactly once (pool, post-ROLLBACK); a
				// counts failure is contained by the per-user catch.
				retainCountsOnce(await countsFor(pool, userId));
				result.usersSkipped++;
				continue;
			}
			// D-3 in-tx hold re-check (isHeld never throws; error ⇒ held).
			if (await isHeld({ userId }, client)) {
				// #1176: count retained failed/pending via the client
				// BEFORE ROLLBACK (same snapshot as the locked rows),
				// exactly once. A counts failure throws into the
				// per-user catch: ROLLBACK, 'error', nothing counted.
				retainCountsOnce(await countsFor(client, userId));
				await client.query('ROLLBACK');
				entry.status = 'held';
				entry.retainedHeld = locked.length;
				result.ledgerRowsRetainedHeld += locked.length;
				result.usersSkipped++;
				continue;
			}
			const retained = await countsFor(client, userId);
			retainCountsOnce(retained);

			// D-4 fold metadata: bounded + key-free. Counts/digests over
			// ledger IDs and timestamps only — never file_url/keys.
			const bySourceFamily = {};
			const byStorageType = {};
			let attemptsTotal = 0;
			let createdMin = null;
			let createdMax = null;
			let terminalMin = null;
			let terminalMax = null;
			const iso = (v) => {
				if (v == null) return null;
				const d = v instanceof Date ? v : new Date(v);
				return Number.isNaN(d.getTime()) ? null : d.toISOString();
			};
			for (const row of locked) {
				const fam = row.source_family || 'file';
				const typ = row.storage_type || 'unknown';
				bySourceFamily[fam] = (bySourceFamily[fam] || 0) + 1;
				byStorageType[typ] = (byStorageType[typ] || 0) + 1;
				attemptsTotal += row.attempts || 0;
				const c = iso(row.created_at);
				const t = iso(row.updated_at);
				if (c && (!createdMin || c < createdMin)) createdMin = c;
				if (c && (!createdMax || c > createdMax)) createdMax = c;
				if (t && (!terminalMin || t < terminalMin)) terminalMin = t;
				if (t && (!terminalMax || t > terminalMax)) terminalMax = t;
			}
			const ids = locked.map((r) => r.id).sort((a, b) => a - b);
			const metadata = {
				gap_i_fold_version: 1,
				ledger_rows_purged: locked.length,
				objects_deleted: locked.length,
				by_source_family: bySourceFamily,
				by_storage_type: byStorageType,
				attempts_total: attemptsTotal,
				ledger_created_min: createdMin,
				ledger_created_max: createdMax,
				terminal_min: terminalMin,
				terminal_max: terminalMax,
				grace_days: STORAGE_DELETION_PURGE_GRACE_DAYS,
				batch_digest: crypto.createHash('sha256').update(ids.join(',')).digest('hex'),
				retained_failed: retained.failed,
				retained_pending: retained.pending,
				retained_held: 0,
				hold_lookup_failed: 0,
			};
			// Fold BEFORE delete, same client, same tx, direct INSERT —
			// never via AuditLogger.log / auditLogService (they swallow
			// errors and are not transactional; DB B2).
			await client.query(
				`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, metadata)
				 VALUES ($1, $2, $3, $4, $5::jsonb)`,
				['storage_deletion_ledger_purged', null, 'user', userId, JSON.stringify(metadata)],
			);
			// #1178 (security review O-1 on #1128): the hold predicate
			// rides INSIDE the DELETE, not only in the re-check above.
			// A hold committed after the re-check but before this
			// statement was a Read Committed phantom; the DELETE's own
			// WHERE is evaluated against data committed before the
			// statement starts, so such a hold now blocks its rows —
			// rowCount mismatches below, the tx rolls back (fold
			// included), and the user is contained as 'error' rather
			// than purged against a live hold. notHeldPredicate mirrors
			// the session-less isHeld({userId}) check exactly (direct
			// user hold, company via users.company_id, company via any
			// interview_session). Residual: a hold committed DURING
			// this statement's own execution can still slip — closing
			// that sliver needs lock/serializable designs (issue #1178).
			const del = await client.query(
				`DELETE FROM pending_storage_deletions
				 WHERE id = ANY($1) AND ${PURGE_ELIGIBILITY}
				 AND ${notHeldPredicate('pending_storage_deletions.user_id')}`,
				[ids],
			);
			if ((del.rowCount || 0) !== locked.length || (del.rowCount || 0) !== metadata.ledger_rows_purged) {
				throw new Error(
					`purge fold/delete count mismatch for user ${userId}: locked=${locked.length} deleted=${del.rowCount || 0}`,
				);
			}
			await client.query('COMMIT');
			entry.status = 'purged';
			entry.ledgerRowsPurged = del.rowCount;
			result.ledgerRowsPurged += del.rowCount;
			result.usersPurged++;
		} catch (err) {
			// One user's failure never aborts the run or another user.
			if (client !== pool) {
				try {
					await client.query('ROLLBACK');
				} catch (_rbErr) {}
			}
			entry.status = 'error';
			entry.errorClass = String(err?.code || err?.name || 'Error');
			result.usersSkipped++;
			console.error(
				`[erasure] storage-deletion ledger purge failed for user ${userId}: error_class=${entry.errorClass}`,
			);
		} finally {
			if (client !== pool && typeof client.release === 'function') client.release();
		}
	}
	return result;
}

// ─── #1973: K-12 panel-kept skeleton cleanup sweep ─────────────────────────
// STOP 1 as amended three times (issue #1973 comments 6499901121,
// 6499937562, 6499960851, 6499979485 — the binding predicate set is
// Amendment 3's C-4). Route: DEFERRED RETENTION SWEEP — no schema
// change, no marker. A GAP-C panel-kept skeleton (K-12 redacted
// interview_event whose ONLY keep basis was parenting other users'
// event_labelling_consent rows, migration 299 ON DELETE RESTRICT)
// must die once its last panel row is gone — and only then. No
// in-transaction cleanup is possible (at the S-D19 step the events
// are not skeletons yet), so this standalone sweep re-derives EVERY
// condition fresh at sweep time. It runs beside
// sweepPendingStorageDeletions on the server.js 24h retention tick
// and is NOT gated by RETENTION_PURGE_LIVE: erasure completion runs
// live in both retention modes (B-2, same reasoning as the
// storage-ledger sweep).
//
// C-4 predicate set — ALL conjuncts, re-stated inside the DELETE's
// own WHERE, fail-closed on every leg:
//  (1) exact K-12 signature — the five GAP-C assignments (notes,
//      meeting_link, livekit_room_url, calendar_event_ids NULL;
//      panel_member_ids = '{}'). REQUIRED but NEVER sufficient
//      alone (A-1): migration 126 defaults make a fresh live event
//      match it exactly.
//  (2) tombstone conjunction, exact form (B-3): candidate's users
//      row has deleted_at NOT NULL AND name = 'Deleted User' AND
//      email ~ '^deleted_<candidate_id>_[^@]+@deleted.local$' — the
//      embedded id must equal the event's own candidate_id.
//  (3) chronology (C-1): event.created_at <= candidate deleted_at.
//      The event-create route never checks deleted_at and
//      job_applications survive erasure, so a live event created
//      for an already-tombstoned candidate is a REACHABLE false
//      positive without this leg.
//  (4) NOT EXISTS interview_recordings, any status.
//  (5) NOT EXISTS event_labelling_consent rows, any decision —
//      absence of rows is the only "last row gone" signal.
//  (6) NOT EXISTS proposed_slots AND NOT EXISTS interview_rooms.
//      A-2: ANY dependent present EXCLUDES the event — dependents
//      are never cascade-disposed or counted as skeleton deletions.
//      A session-linked event (interview_session_id NOT NULL) is
//      likewise excluded, never swept into the session spine.
//  (7) hold NOT EXISTS over legal_holds (active = released_at IS
//      NULL) covering ALL FOUR attribution branches (C-2):
//      (a) user_id = candidate_id; (b) company_id = the DERIVED
//      company (job_application_id → job_applications.company_id —
//      the operative branch: GAP-G NULLs the candidate's
//      users.company_id, and notHeldPredicate omits this branch,
//      so it is spelled out here, never delegated to it);
//      (c) company_id = the candidate's users.company_id;
//      (d) company_id IN (interview_sessions companies of the
//      candidate). Hold release only RE-QUEUES: a released event
//      becomes eligible on a later run under this same full
//      re-derivation; release never deletes directly (B-1/C-5).
//  NO predicate on status / scheduled_at / duration_minutes /
//  timezone / job_application_id / recruiter_id (C-4: K-12 leaves
//  all of them; filtering on them creates false negatives).
//
// Concurrency (C-3): per event, ONE transaction — SERIALIZABLE,
// LOCK TABLE legal_holds IN SHARE MODE (closes the hold-insert
// race: a concurrent hold INSERT blocks until this event's
// transaction ends), SELECT … FOR UPDATE on the event row (FK
// child inserts take KEY SHARE on the parent, which conflicts
// with FOR UPDATE, so panel/recording/slot/room creation
// serialises against the sweep), hold re-check via the DELETE's
// own WHERE, audit row in the same transaction. rowCount = 0 ⇒
// raced, counted skipped, never an error. A serialization failure
// (40001) is retried once per event, then counted lookup-failed.
//
// Honesty (C-5 + privacy conditions): counts are labelled
// "skeleton-class" — the sweep proves a posture, not per-row
// provenance, and NEVER claims panel consent evidence is gone:
// diarization_jobs/runs panel_consent_snapshot copies persist on
// their own retention clock and are reported separately. A
// skeleton is pseudonymous personal data, never "anonymous".
// Composition fail-closed: the enumeration completes BEFORE any
// deletion — if it errors, the run aborts with zero deletions; a
// per-event lookup error preserves that event and is counted
// lookupFailedSkipped, never as held.
//
// Enumeration (#1977, reviewer minor 2 on PR #1976): keyset-paged
// past the hold/dependent partition. The shipped form applied
// LIMIT 100 BEFORE the partition, so >=100 accumulated
// held/dependent skeletons starved deletable higher-id skeletons
// indefinitely. Now `limit` is the PAGE size: pages are collected
// (id > cursor, ORDER BY id) until a short page ends the set, and
// only then does deletion start. Candidates inserted
// mid-enumeration with higher ids may join the same run — safe,
// because every per-event DELETE re-derives the full C-4
// conjunction. Page cap bounds one run's enumeration effort; a
// capped run reports enumerationTruncated instead of silently
// stopping (the next run re-scans from the start).
const SKELETON_SWEEP_MAX_EVENTS_PER_RUN = 100;
const SKELETON_SWEEP_ENUMERATION_MAX_PAGES = 100;

const SKEL_SIGNATURE_SQL = `ie.notes IS NULL AND ie.meeting_link IS NULL
	AND ie.livekit_room_url IS NULL AND ie.calendar_event_ids IS NULL
	AND ie.panel_member_ids = '{}'`;
const SKEL_TOMBSTONE_SQL = `u.deleted_at IS NOT NULL AND u.name = 'Deleted User'
	AND u.email ~ ('^deleted_' || ie.candidate_id || '_[^@]+@deleted\\.local$')`;
const SKEL_HOLD_EXISTS_SQL = `EXISTS (SELECT 1 FROM legal_holds lh
	WHERE lh.released_at IS NULL
	  AND (lh.user_id = ie.candidate_id
	       OR lh.company_id = (SELECT ja_h.company_id FROM job_applications ja_h WHERE ja_h.id = ie.job_application_id)
	       OR lh.company_id = u.company_id
	       OR lh.company_id IN (SELECT s_h.company_id FROM interview_sessions s_h WHERE s_h.candidate_id = ie.candidate_id)))`;
const SKEL_NO_DEPENDENTS_SQL = `NOT EXISTS (SELECT 1 FROM interview_recordings ir WHERE ir.interview_event_id = ie.id)
	AND NOT EXISTS (SELECT 1 FROM proposed_slots ps WHERE ps.interview_event_id = ie.id)
	AND NOT EXISTS (SELECT 1 FROM interview_rooms rm WHERE rm.interview_event_id = ie.id)
	AND ie.interview_session_id IS NULL`;
// The full C-4 conjunction over (interview_events ie JOIN users u).
const SKEL_FULL_PREDICATE_SQL = `${SKEL_SIGNATURE_SQL}
	AND ${SKEL_TOMBSTONE_SQL}
	AND ie.created_at <= u.deleted_at
	AND NOT EXISTS (SELECT 1 FROM event_labelling_consent elc WHERE elc.interview_event_id = ie.id)
	AND ${SKEL_NO_DEPENDENTS_SQL}
	AND NOT ${SKEL_HOLD_EXISTS_SQL}`;

async function sweepPanelSkeletonEvents({ queryable, limit } = {}) {
	const pool = queryable || require('./db');
	if (typeof pool.connect !== 'function') {
		const err = new Error(
			'sweepPanelSkeletonEvents requires a pool (an object with connect()): ' +
				'it runs per-event BEGIN…COMMIT on dedicated clients it acquires itself',
		);
		err.name = 'ErasureSkeletonSweepPoolRequiredError';
		err.code = 'ERASURE_SKELETON_SWEEP_POOL_REQUIRED';
		throw err;
	}
	const batch = Number.isInteger(limit) && limit > 0 ? limit : SKELETON_SWEEP_MAX_EVENTS_PER_RUN;
	const result = {
		label: 'skeleton-class',
		scanned: 0,
		deleted: 0,
		heldSkipped: 0,
		lookupFailedSkipped: 0,
		skipped: 0,
		enumerationTruncated: false,
	};
	// Enumeration (keyset-paged, completed BEFORE any deletion — an
	// error on any page aborts the run with zero deletions).
	// Candidates carry the identification legs (1)(2)(3)(5);
	// dependents and holds are partitioned in the same rows so the
	// counts reconcile, and BOTH are re-stated inside each per-event
	// DELETE below.
	const candidates = [];
	let cursor = 0;
	for (let page = 0; ; page++) {
		const { rows } = await pool.query(
			`SELECT ie.id, ie.candidate_id,
			        ${SKEL_HOLD_EXISTS_SQL} AS held,
			        NOT (${SKEL_NO_DEPENDENTS_SQL}) AS has_dependent
			 FROM interview_events ie
			 JOIN users u ON u.id = ie.candidate_id
			 WHERE ${SKEL_SIGNATURE_SQL}
			   AND ${SKEL_TOMBSTONE_SQL}
			   AND ie.created_at <= u.deleted_at
			   AND NOT EXISTS (SELECT 1 FROM event_labelling_consent elc WHERE elc.interview_event_id = ie.id)
			   AND ie.id > $2
			 ORDER BY ie.id
			 LIMIT $1`,
			[batch, cursor],
		);
		candidates.push(...rows);
		if (rows.length < batch) break;
		cursor = rows[rows.length - 1].id;
		if (page + 1 >= SKELETON_SWEEP_ENUMERATION_MAX_PAGES) {
			result.enumerationTruncated = true;
			break;
		}
	}
	result.scanned = candidates.length;

	for (const cand of candidates) {
		if (cand.has_dependent) {
			// A-2: excluded, never cascade-disposed.
			result.skipped++;
			continue;
		}
		if (cand.held) {
			result.heldSkipped++;
			continue;
		}
		// Per-event transaction (C-3). One retry on 40001.
		let outcome = 'lookup_failed';
		for (let attempt = 0; attempt < 2 && outcome === 'lookup_failed'; attempt++) {
			let client = pool;
			try {
				client = await pool.connect();
				await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
				await client.query('LOCK TABLE legal_holds IN SHARE MODE');
				const { rows: locked } = await client.query(
					`SELECT id FROM interview_events WHERE id = $1 FOR UPDATE`,
					[cand.id],
				);
				if (!locked.length) {
					await client.query('ROLLBACK');
					outcome = 'skipped'; // raced away — never an error
					break;
				}
				const del = await client.query(
					`DELETE FROM interview_events ie
					 USING users u
					 WHERE ie.id = $1 AND u.id = ie.candidate_id
					   AND ${SKEL_FULL_PREDICATE_SQL}`,
					[cand.id],
				);
				if ((del.rowCount || 0) === 1) {
					// Audit in the SAME transaction: event id +
					// tombstone user id + predicate outcome. The
					// label is skeleton-class (C-5) — never
					// "panel-kept", never a consent-evidence claim.
					// #1977 (reviewer minor 1): predicate_outcome is
					// DERIVED from this DELETE's own success — the
					// DELETE re-stated the full C-4 conjunction, so
					// rowCount=1 means every leg held at deletion
					// time; it is never copied from enumeration
					// state. The last-panel-row deletion timestamp
					// required by #1973's STOP 1 is unobtainable
					// in-schema (panel rows are deleted by their
					// owners' erasures with no deletion timestamp
					// recorded) — carried as an explicit
					// unavailability marker, never fabricated; the
					// deviation is recorded on #1977 (STOP 1,
					// comment 6502998880). Booleans only: no
					// panel-member ids/counts, no consent decisions,
					// no hold detail (privacy engineer, #1977).
					await client.query(
						`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, metadata)
						 VALUES ($1, $2, $3, $4, $5::jsonb)`,
						[
							'skeleton_event_swept',
							null,
							'interview_event',
							cand.id,
							JSON.stringify({
								label: 'skeleton-class',
								sweep: '1973',
								event_id: cand.id,
								tombstone_user_id: cand.candidate_id,
								predicate_outcome: {
									signature: true,
									tombstone: true,
									chronology: true,
									no_panel_rows: true,
									no_dependents: true,
									no_active_hold: true,
								},
								last_panel_row_deletion_timestamp: {
									value: null,
									source: 'unavailable',
									reason_code:
										'panel_rows_deleted_without_deletion_timestamp',
									recorded_on: '#1977',
								},
							}),
						],
					);
					await client.query('COMMIT');
					outcome = 'deleted';
				} else {
					// A predicate leg flipped between enumeration and
					// the locked DELETE (panel row / recording / hold
					// inserted) — raced, counted skipped.
					await client.query('ROLLBACK');
					outcome = 'skipped';
				}
			} catch (err) {
				if (client !== pool) {
					try {
						await client.query('ROLLBACK');
					} catch (_rbErr) {}
				}
				if (err && err.code === '40001' && attempt === 0) continue; // retry once
				console.error(
					`[erasure] skeleton sweep failed for event ${cand.id}: error_class=${String(err?.code || err?.name || 'Error')}`,
				);
				outcome = 'lookup_failed';
			} finally {
				if (client !== pool && typeof client.release === 'function') client.release();
			}
		}
		if (outcome === 'deleted') result.deleted++;
		else if (outcome === 'skipped') result.skipped++;
		else result.lookupFailedSkipped++;
	}

	// Every run logs — including zero-match runs (the log proves
	// diligence, privacy auditability condition).
	console.log(
		`[erasure] skeleton-class sweep (#1973): scanned=${result.scanned}, deleted=${result.deleted}, ` +
			`held=${result.heldSkipped}, lookup_failed=${result.lookupFailedSkipped}, skipped=${result.skipped}` +
			(result.enumerationTruncated ? ', enumeration_truncated=true (#1977 page cap)' : ''),
	);
	return result;
}

// ─── #2011 Part B: panel_consent_snapshot retention-clock sweep ────────────
// Rex design (docs/sdlc/rekrut-ai-v2/03-solutioning/speaker-labelled-
// transcripts/snapshot-retention-sweep-design.md; STOP 1 on #2011).
// A retained panel_consent_snapshot copy (migration 299 JSONB on
// diarization_jobs / diarization_runs) must not outlive the consent
// record it copies (Lex R-1 from #1944). Host rows die with their
// recording only on HARD delete (migration 296 CASCADE), but
// recordings actually end by soft-delete (purgeExpiredRecordings) or
// GAP-A keep-redacted tombstone — both leave the host rows and their
// snapshots alive indefinitely. This is the sibling sweep the #1973
// skeleton sweep's header comment defers to; it runs beside it on the
// server.js 24h retention tick. No new scheduler, no migration.
//
// THE CLOCK (§3 — no new duration invented; Gate-A C-06 stays open):
// a snapshot reference to panel user U (Part A's enumeration, reused
// verbatim: U in expected_user_ids OR any decisions[].user_id) is
// EXPIRED when BOTH hold:
//  (1) U's source event_labelling_consent row for that snapshot's
//      event is gone — no row for (host recording's
//      interview_event_id, U) and none with id = the decision entry's
//      record_id (either proves the source alive); AND
//  (2) the host recording has reached its own end — its
//      retention_expires_at is in the past, OR it is an erasure
//      tombstone (keep-redacted: status='deleted'), OR it no longer
//      exists (LEFT JOIN miss — unreachable while the mig-296 CASCADE
//      stands, kept so the predicate states the full clock).
//
// SURGERY (§4 — the #2014 JSON-surgery shape, JS-side like the
// proposed-mapping sweep: SQL cannot key a match on a nested value):
// U is removed from expected_user_ids (the array_remove signature)
// and U's decisions entries become JSON null — entries are nulled,
// never deleted, so "was proposed, now expired" never reads as
// "never consented". One user's expiry never touches another user's
// live reference in the same snapshot; a row is only rewritten when
// one of its references actually expired, so live snapshots stay
// byte-identical. A snapshot that no longer references any user is
// set to NULL — the host job/run row itself survives.
//
// GATING (§5 — two legs, kept distinct like #1172/#1973):
//  - erasure-completion leg (host ended by tombstone / recording
//    gone): runs UNGATED in both retention modes — gating it behind
//    RETENTION_PURGE_LIVE would retain an erased user's consent
//    evidence past every clock that was supposed to end it.
//  - retention-expiry leg (host ended by retention_expires_at only):
//    a retention schedule — live only when dryRun is false; under
//    dry-run the references are counted (retentionLegDryRunSkipped),
//    never removed. The flag itself is flipped NOWHERE here.
//
// LEGAL HOLD (§4, skeleton-sweep discipline): per expired reference,
// findActiveHold is consulted for BOTH the panel user and the host
// candidate (event/session attribution). A hold leaves that
// reference untouched, counted heldSkipped; a lookup ERROR leaves it
// untouched, counted lookupFailedSkipped — never as held, never
// silently retained. findActiveHold's own company branches (the
// subject's sessions) ride along unchanged.
//
// Counters (§4 + §5): scanned = jobs/runs rows carrying a non-NULL
// snapshot; snapshotsExpired = rows whose snapshot was modified by
// ≥1 removal; referencesRemoved = references removed, split by leg
// (erasureLegRemoved / retentionLegRemoved). Counts only — no
// snapshot content, no user ids, ever (§1176 O-4 labelling: this
// sweep logs on its own line from server.js).
async function sweepPanelConsentSnapshots({ queryable, dryRun = false } = {}) {
	const pool = queryable || require('./db');
	const result = {
		scanned: 0,
		snapshotsExpired: 0,
		referencesRemoved: 0,
		erasureLegRemoved: 0,
		retentionLegRemoved: 0,
		retentionLegDryRunSkipped: 0,
		heldSkipped: 0,
		lookupFailedSkipped: 0,
	};

	// Enumerate every snapshot-carrying host row with its recording's
	// clock state and the host candidate attribution for hold checks.
	const hostRows = [];
	for (const table of ['diarization_jobs', 'diarization_runs']) {
		const { rows } = await pool.query(
			`SELECT h.id AS host_id, h.panel_consent_snapshot AS snapshot,
			        ir.id AS recording_id, ir.interview_event_id AS event_id,
			        ir.status AS recording_status, ir.retention_expires_at AS retention_expires_at,
			        ie.candidate_id AS event_candidate_id,
			        sess.candidate_id AS session_candidate_id
			 FROM ${table} h
			 LEFT JOIN interview_recordings ir ON ir.id = h.recording_id
			 LEFT JOIN interview_events ie ON ie.id = ir.interview_event_id
			 LEFT JOIN interview_sessions sess ON sess.id = ir.interview_session_id
			 WHERE h.panel_consent_snapshot IS NOT NULL
			 ORDER BY h.id`,
		);
		for (const row of rows) hostRows.push({ table, ...row });
	}
	result.scanned = hostRows.length;

	// §3 leg (1) — cached per (event, user): is U's source consent row
	// for this snapshot's event still alive? A decision entry's
	// record_id also proves its source alive on its own.
	const sourceAliveCache = new Map();
	async function snapshotSourcePresent({ eventId, userId, recordId }) {
		const key = `${eventId ?? 'none'}:${userId}:${recordId ?? 'none'}`;
		if (sourceAliveCache.has(key)) return sourceAliveCache.get(key);
		const { rows } = await pool.query(
			`SELECT 1 FROM event_labelling_consent
			 WHERE user_id = $1 AND (interview_event_id = $2 OR id = $3) LIMIT 1`,
			[userId, eventId, recordId],
		);
		const present = rows.length > 0;
		sourceAliveCache.set(key, present);
		return present;
	}

	// §3 leg (2) — how the host recording ended, if it has:
	// 'erasure' (tombstone / gone — ungated leg) or 'retention'
	// (retention_expires_at passed — dry-run-gated leg) or null.
	function snapshotHostEnd(row) {
		if (!row.recording_id) return 'erasure';
		if (row.recording_status === 'deleted') return 'erasure';
		if (row.retention_expires_at && new Date(row.retention_expires_at) < new Date()) return 'retention';
		return null;
	}

	for (const row of hostRows) {
		const snap = row.snapshot;
		if (!snap || typeof snap !== 'object') continue;
		const expected = Array.isArray(snap.expected_user_ids) ? snap.expected_user_ids.map(Number) : [];
		const decisions = Array.isArray(snap.decisions) ? snap.decisions : [];
		const referenced = new Map(); // userId -> { recordId }
		for (const uid of expected) {
			if (Number.isInteger(uid) && !referenced.has(uid)) referenced.set(uid, { recordId: null });
		}
		for (const d of decisions) {
			if (d && typeof d === 'object' && d.user_id != null) {
				const uid = Number(d.user_id);
				if (Number.isInteger(uid)) {
					const existing = referenced.get(uid);
					if (!existing) {
						referenced.set(uid, { recordId: d.record_id ?? null });
					} else if (existing.recordId == null && d.record_id != null) {
						// #2026 M1: the expected entry (enumerated first)
						// carries no record_id — let the decision's fill in,
						// so snapshotSourcePresent's `OR id = $3` leg can
						// prove the source alive for a both-lists user.
						existing.recordId = d.record_id;
					}
				}
			}
		}
		if (!referenced.size) continue;

		const hostEnd = snapshotHostEnd(row);
		const hostCandidateId = row.event_candidate_id ?? row.session_candidate_id ?? null;
		let nextExpected = expected;
		let nextDecisions = decisions;
		let changed = false;

		for (const [userId, ref] of referenced) {
			// §3 leg (1): a live source record keeps the copy, verbatim.
			if (await snapshotSourcePresent({ eventId: row.event_id, userId, recordId: ref.recordId })) continue;
			// §3 leg (2): the host recording must have reached its end.
			if (!hostEnd) continue;
			// Legal hold, fail-closed, per reference (panel user AND
			// host candidate).
			let held = false;
			let lookupFailed = false;
			for (const subjectId of [userId, hostCandidateId]) {
				if (subjectId == null) continue;
				try {
					if (await findActiveHold({ userId: subjectId }, pool)) held = true;
				} catch (_holdErr) {
					lookupFailed = true;
				}
			}
			if (lookupFailed) {
				result.lookupFailedSkipped++;
				continue;
			}
			if (held) {
				result.heldSkipped++;
				continue;
			}
			// §5 gating: the retention leg is a schedule — counted
			// under dry-run, removed only live. The erasure leg is
			// completion and runs in both modes.
			if (hostEnd === 'retention' && dryRun) {
				result.retentionLegDryRunSkipped++;
				continue;
			}
			nextExpected = nextExpected.filter((uid) => uid !== userId);
			nextDecisions = nextDecisions.map((d) =>
				d && typeof d === 'object' && Number(d.user_id) === userId ? null : d,
			);
			changed = true;
			result.referencesRemoved++;
			if (hostEnd === 'erasure') result.erasureLegRemoved++;
			else result.retentionLegRemoved++;
		}
		if (!changed) continue;

		// Emptied ⇒ NULL (no user referenced via either path); the
		// host row itself survives either way.
		const stillReferenced =
			nextExpected.length > 0 ||
			nextDecisions.some((d) => d && typeof d === 'object' && d.user_id != null);
		const nextSnapshot = stillReferenced
			? { ...snap, expected_user_ids: nextExpected, decisions: nextDecisions }
			: null;
		await pool.query(`UPDATE ${row.table} SET panel_consent_snapshot = $2::jsonb WHERE id = $1`, [
			row.host_id,
			nextSnapshot === null ? null : JSON.stringify(nextSnapshot),
		]);
		result.snapshotsExpired++;
	}

	// Every run logs — including zero-match runs (diligence proof,
	// skeleton-sweep precedent).
	console.log(
		`[erasure] panel snapshot sweep (#2011 Part B): scanned=${result.scanned}, snapshots_expired=${result.snapshotsExpired}, ` +
			`references_removed=${result.referencesRemoved} (erasure_leg=${result.erasureLegRemoved}, retention_leg=${result.retentionLegRemoved}, ` +
			`retention_dry_run_skipped=${result.retentionLegDryRunSkipped}), held=${result.heldSkipped}, lookup_failed=${result.lookupFailedSkipped}`,
	);
	return result;
}

// ─── #1171: manual disposition of dead-letter 'failed' ledger rows ──────────
// A 'failed' row at/over STORAGE_DELETION_MAX_ATTEMPTS is never retried
// automatically again. Its only exit besides a (bound-raising) code
// change is this disposition: ops verifies OUT-OF-BAND that the storage
// object is in fact absent, then attests that here (verifiedAbsent ===
// true, explicit ledger ids for ONE user). The rows are folded into ONE
// bounded, key-free audit_logs record whose counts name them
// failed_verified_absent — NEVER objects_deleted: nothing was deleted
// by this function (it performs no storage call at all), and folding
// them into deleted counts would fabricate erasure evidence. The fold
// + row DELETE mirror purgeDrainedStorageDeletions exactly: pool-only
// (self-transactional, per-user BEGIN…COMMIT on a dedicated client),
// hold pre-pass fail-closed, advisory lock, in-tx hold re-check, and
// the hold predicate inside the DELETE itself (#1178). No new row
// status: the mig-252 status CHECK stays untouched — the disposition
// is recorded in the fold, and the ledger row is deleted.
async function disposeFailedStorageDeletionsVerifiedAbsent({ userId, ledgerIds, verifiedAbsent, queryable } = {}) {
	if (verifiedAbsent !== true) {
		const err = new Error(
			'disposeFailedStorageDeletionsVerifiedAbsent requires verifiedAbsent === true: ' +
				'the caller must attest ops verified out-of-band that each named object is absent',
		);
		err.name = 'ErasureVerifiedAbsentAttestationRequiredError';
		err.code = 'ERASURE_VERIFIED_ABSENT_ATTESTATION_REQUIRED';
		throw err;
	}
	const ids = [...new Set(Array.isArray(ledgerIds) ? ledgerIds : [])]
		.filter((n) => Number.isInteger(n))
		.sort((a, b) => a - b);
	if (!Number.isInteger(userId) || !ids.length || ids.length !== (Array.isArray(ledgerIds) ? ledgerIds.length : 0)) {
		const err = new Error(
			'disposeFailedStorageDeletionsVerifiedAbsent requires an integer userId and a non-empty ledgerIds list of integer ids',
		);
		err.name = 'ErasureVerifiedAbsentInvalidArgumentError';
		err.code = 'ERASURE_VERIFIED_ABSENT_INVALID_ARGUMENT';
		throw err;
	}
	const pool = queryable || require('./db');
	if (typeof pool.connect !== 'function') {
		const err = new Error(
			'disposeFailedStorageDeletionsVerifiedAbsent requires a pool (an object with connect()): ' +
				'it runs BEGIN…COMMIT on a dedicated client it acquires itself',
		);
		err.name = 'ErasureDispositionPoolRequiredError';
		err.code = 'ERASURE_DISPOSITION_POOL_REQUIRED';
		throw err;
	}
	const result = { userId, status: 'skipped', failedVerifiedAbsent: 0, ledgerIds: ids };
	// Hold pre-pass (pool), fail-closed exactly like the purge: a held
	// subject or a failed lookup disposes NOTHING.
	let activeHold = null;
	let lookupFailed = false;
	try {
		activeHold = await findActiveHold({ userId }, pool);
	} catch (_holdErr) {
		lookupFailed = true;
	}
	if (activeHold || lookupFailed) {
		result.status = activeHold ? 'held' : 'lookup_failed';
		return result;
	}
	let client = pool;
	try {
		client = await pool.connect();
		await client.query('BEGIN');
		const { rows: lockRows } = await client.query(
			`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
			[`gap-i-failed-verified-absent:${userId}`],
		);
		if (!lockRows[0]?.locked) {
			await client.query('ROLLBACK');
			return result; // 'skipped' — a concurrent disposition owns this user
		}
		const { rows: locked } = await client.query(
			`SELECT id, source_family, storage_type, attempts, created_at, updated_at
			 FROM pending_storage_deletions
			 WHERE user_id = $1 AND id = ANY($2) AND status = 'failed'
			 ORDER BY id FOR UPDATE SKIP LOCKED`,
			[userId, ids],
		);
		if (locked.length !== ids.length) {
			// All-or-nothing: a named row that is missing, not this
			// user's, or no longer 'failed' blocks the whole batch —
			// never a silent partial disposition.
			throw new Error(
				`verified-absent disposition count mismatch for user ${userId}: named=${ids.length} locked_failed=${locked.length}`,
			);
		}
		// In-tx hold re-check (isHeld never throws; error ⇒ held).
		if (await isHeld({ userId }, client)) {
			await client.query('ROLLBACK');
			result.status = 'held';
			return result;
		}
		// Fold metadata: bounded + key-free (ids/timestamps/counts only).
		const bySourceFamily = {};
		const byStorageType = {};
		let attemptsTotal = 0;
		let createdMin = null;
		let createdMax = null;
		let terminalMin = null;
		let terminalMax = null;
		const iso = (v) => {
			if (v == null) return null;
			const d = v instanceof Date ? v : new Date(v);
			return Number.isNaN(d.getTime()) ? null : d.toISOString();
		};
		for (const row of locked) {
			const fam = row.source_family || 'file';
			const typ = row.storage_type || 'unknown';
			bySourceFamily[fam] = (bySourceFamily[fam] || 0) + 1;
			byStorageType[typ] = (byStorageType[typ] || 0) + 1;
			attemptsTotal += row.attempts || 0;
			const c = iso(row.created_at);
			const t = iso(row.updated_at);
			if (c && (!createdMin || c < createdMin)) createdMin = c;
			if (c && (!createdMax || c > createdMax)) createdMax = c;
			if (t && (!terminalMin || t < terminalMin)) terminalMin = t;
			if (t && (!terminalMax || t > terminalMax)) terminalMax = t;
		}
		const metadata = {
			failed_disposition_version: 1,
			failed_verified_absent: locked.length,
			objects_deleted: 0,
			verified_absent_attested: true,
			by_source_family: bySourceFamily,
			by_storage_type: byStorageType,
			attempts_total: attemptsTotal,
			ledger_created_min: createdMin,
			ledger_created_max: createdMax,
			terminal_min: terminalMin,
			terminal_max: terminalMax,
			batch_digest: crypto.createHash('sha256').update(ids.join(',')).digest('hex'),
		};
		// Fold BEFORE delete, same client, same tx, direct INSERT —
		// never via a swallowing audit helper (purge D-4 precedent).
		await client.query(
			`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, metadata)
			 VALUES ($1, $2, $3, $4, $5::jsonb)`,
			[
				'storage_deletion_failed_verified_absent',
				null,
				'user',
				userId,
				JSON.stringify(metadata),
			],
		);
		// The hold predicate rides INSIDE the DELETE (#1178 precedent).
		const del = await client.query(
			`DELETE FROM pending_storage_deletions
			 WHERE id = ANY($1) AND status = 'failed'
			 AND ${notHeldPredicate('pending_storage_deletions.user_id')}`,
			[ids],
		);
		if ((del.rowCount || 0) !== locked.length) {
			throw new Error(
				`verified-absent fold/delete count mismatch for user ${userId}: locked=${locked.length} deleted=${del.rowCount || 0}`,
			);
		}
		await client.query('COMMIT');
		result.status = 'disposed';
		result.failedVerifiedAbsent = del.rowCount;
	} catch (err) {
		if (client !== pool) {
			try {
				await client.query('ROLLBACK');
			} catch (_rbErr) {}
		}
		result.status = 'error';
		result.errorClass = String(err?.code || err?.name || 'Error');
		console.error(
			`[erasure] verified-absent disposition failed for user ${userId}: error_class=${result.errorClass}`,
		);
	} finally {
		if (client !== pool && typeof client.release === 'function') client.release();
	}
	return result;
}

module.exports = {
	erasePersonalData,
	deleteErasedStorageFiles,
	sweepPendingStorageDeletions,
	sweepPanelSkeletonEvents,
	sweepPanelConsentSnapshots,
	purgeDrainedStorageDeletions,
	disposeFailedStorageDeletionsVerifiedAbsent,
	STORAGE_DELETION_MAX_ATTEMPTS,
	sanitizeErasureResult,
	STORAGE_DELETION_PURGE_GRACE_DAYS,
};
