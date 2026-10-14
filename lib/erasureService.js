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
 * Semantics: destroy the candidate's DEK (renders all DEK-encrypted biometric
 * data unrecoverable) + hard-delete the candidate_embeddings row, audit the
 * destruction, skip cleanly when the user never had a DEK (DEKNotFound). Any
 * other error propagates → caller rolls back.
 */
const { destroyDEK } = require('./biometricCrypto');
const { deleteFile, deleteStorageObject, getProviders } = require('./file-storage');
const biometricAudit = require('./biometricAudit');
const { isHeld, findActiveHold, LegalHoldError } = require('./legalHold');

/**
 * Erase a user's personal data as part of an erasure workflow.
 *
 * @param {number} userId — the erasing user (candidate_id == user.id)
 * @param {object} opts
 * @param {object} opts.client — pg client/pool; destruction + audit ride it
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
 *   applicationKeyedRowsHeld: number, applicationKeyedHeldDetails: object[],
 *   autoApplyConsentTombstone: object|null,
 *   interviewSessionsStripped: boolean, sessionsStripped: number, sessionsHeld: number,
 *   transcriptsDeleted: number,
 *   recordingsLedgered: number, recordingsRedacted: number, recordingsHeld: number,
 *   recordingsUndecryptable: number,
 *   recordingFramesLedgered: boolean, framesLedgered: number, framesHeld: number,
 *   gapAHeldSkips: number,
 *   storageKeys: string[] }>}
 *   gapD: object, storageKeys: string[] }>}
 *   shredded=false when no DEK existed; *Deleted false when no rows existed.
 *   storageKeys = deduped /api/files/... URLs for Phase 2 (deleteErasedStorageFiles,
 *   post-commit — R2 NEVER in-tx).
 */
async function erasePersonalData(userId, { client, audit } = {}) {
	// #799 (G-1) legal-hold gate — the FIRST statement, before the DEK is
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
	const queryable = client || require('./db');
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
	const gapDStorageKeys = [];
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
	// where the row carries one. A lookup error reads as held
	// (fail-closed) — the row is skipped and counted, never erased.
	const gapDRowHeld = async (companyId) => {
		try {
			return (
				(await findActiveHold({ userId, companyId: companyId ?? null }, queryable)) != null
			);
		} catch (holdErr) {
			console.error(
				'[erasureService] #1123 per-row legal-hold check failed — failing closed (skipping row):',
				holdErr.message,
			);
			return true;
		}
	};
	const gapDPartition = async (rows, companyOf = (r) => r.company_id ?? null) => {
		const unheld = [];
		let held = 0;
		for (const row of rows) {
			if (await gapDRowHeld(companyOf(row))) held++;
			else unheld.push(row);
		}
		return { unheld, held };
	};
	const gapDNoteHeld = (table, held) => {
		if (held > 0) {
			gapD.rowsHeld += held;
			gapDHeldTables.add(table);
		}
	};
	// SELECT a candidate-keyed family, consult per row, DELETE the
	// unheld ids explicitly (cascades are never the mechanism — the
	// users row is tombstoned, so they never fire).
	const gapDDeleteFamily = async (table, countKey, selectSql, deleteSql, opts = {}) => {
		const { rows } = await gapDQuery(selectSql, opts.selectParams || [userId]);
		const { unheld, held } = await gapDPartition(rows, opts.companyOf);
		gapDNoteHeld(table, held);
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
		return { deleted, held, unheldRows: unheld };
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
				(await findActiveHold(
					{ userId, companyId: applicationRow.company_id },
					queryable,
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
				walk = await c2WalkNullApplicationRow(walkOf(row));
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
					(await findActiveHold(
						{ userId, companyId: walk.companyId ?? null },
						queryable,
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
	// stripped in silence. isHeld is fail-closed (error ⇒ held ⇒ skip).
	const gapASessionRes = await queryable.query(
		'SELECT id FROM interview_sessions WHERE candidate_id = $1',
		[userId],
	);
	const gapASessionRows = gapASessionRes?.rows || [];
	const unheldSessionIds = [];
	let sessionsHeld = 0;
	for (const sessionRow of gapASessionRows) {
		if (await isHeld({ userId, sessionId: sessionRow.id }, queryable)) {
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
		`SELECT ir.id, ir.storage_path, ir.interview_event_id, ir.interview_session_id
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
	let recordingsUndecryptable = 0;
	for (const recordingRow of gapARecordingRows) {
		const held = await isHeld(
			{
				userId,
				sessionId: recordingRow.interview_session_id ?? undefined,
			},
			queryable,
		);
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
			 SET status = 'deleted', storage_path = NULL, updated_at = NOW()
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
		const held = await isHeld(
			{ userId, sessionId: frameRow.interview_id ?? undefined },
			queryable,
		);
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
	const gapDUnheldPlanIds = new Set(gapDPlanPart.unheld.map((r) => r.id));
	const gapDHeldPlanIds = new Set(
		gapDPlanRows.filter((r) => !gapDUnheldPlanIds.has(r.id)).map((r) => r.id),
	);
	const { rows: gapDTaskRows } = await gapDQuery(
		`SELECT t.id, t.plan_id FROM onboarding_tasks t
		 JOIN onboarding_plans p ON p.id = t.plan_id
		 WHERE p.candidate_id = $1`,
		[userId],
	);
	const gapDUnheldTasks = gapDTaskRows.filter((t) => !gapDHeldPlanIds.has(t.plan_id));
	gapDNoteHeld('onboarding_tasks', gapDTaskRows.length - gapDUnheldTasks.length);
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
	const gapDHeldBgIds = new Set(
		gapDBgRows.filter((r) => !gapDBgPart.unheld.includes(r)).map((r) => r.id),
	);
	if (gapDBgRows.length > 0) {
		const { rows: gapDDiscRows } = await gapDQuery(
			'SELECT id, verification_request_id FROM discrepancies WHERE verification_request_id = ANY($1)',
			[gapDBgRows.map((r) => r.id)],
		);
		const gapDUnheldDisc = gapDDiscRows.filter((d) => !gapDHeldBgIds.has(d.verification_request_id));
		gapDNoteHeld('discrepancies', gapDDiscRows.length - gapDUnheldDisc.length);
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
	for (const doc of gapDSigDocRows) {
		if (await gapDRowHeld(doc.company_id ?? null)) {
			gapDHeldDocIds.add(doc.id);
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
	// Candidate-as-party signature_requests: the signature blob +
	// metadata are content — DELETE on every unheld document (held
	// documents keep theirs: held material is preserved whole).
	const gapDUnheldRequests = gapDCandidateRequests.filter((r) => !gapDHeldDocIds.has(r.document_id));
	gapDNoteHeld('signature_requests', gapDCandidateRequests.length - gapDUnheldRequests.length);
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
		if (await gapDRowHeld(party.company_id ?? null)) {
			gapDHeldParties++;
			continue;
		}
		if (partyDocIds.some((id) => gapDSurvivingDocIds.has(id))) gapDPartiesToRedact.push(party);
		else gapDPartiesToDelete.push(party);
	}
	gapDNoteHeld('signing_parties', gapDHeldParties);
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
		applicationKeyedRowsHeld,
		applicationKeyedHeldDetails,
		autoApplyConsentTombstone,
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
		recordingsLedgered: recordingLedgerKeys.length,
		recordingsRedacted,
		recordingsHeld,
		recordingsUndecryptable,
		recordingFramesLedgered: frameLedgerKeys.length > 0,
		framesLedgered: frameLedgerKeys.length,
		framesHeld,
		gapAHeldSkips,
		gapD,
		storageKeys: [
			...r2Keys,
			...localPaths.map((p) => `local:${p}`),
			...observerAudioKeys,
			...recordingLedgerKeys,
			...frameLedgerKeys,
			...gapDStorageKeys,
		],
	};
}

/**
 * Phase 2 of S-076 erasure: delete storage objects AFTER the DB transaction
 * commits. Reads from the pending_storage_deletions ledger (written in-tx by
 * Phase 1) — crash-safe: the S-077 cron sweeps un-marked entries.
 * R2 NEVER in-tx (distributed-transaction failure mode).
 *
 * Handles both R2/B2 URLs (via deleteFile) and local-disk paths
 * (verification_requests files, via deleteEncryptedFile).
 *
 * Each file gets its own audit entry with metadata (Q4: Art. 5(2)
 * accountability — the entry identifies WHICH file and the outcome).
 * Idempotent — already-deleted objects count as success.
 *
 * @param {number} userId — the erasing user
 * @param {object} [opts.audit] — { userId, userRole, ipAddress, companyId }
 * @returns {Promise<{ deleted: number, failed: number, failures: string[] }>}
 */
async function deleteErasedStorageFiles(userId, { audit } = {}) {
	const db = require('./db');
	const { deleteEncryptedFile } = require('../services/encryption');

	const { rows: pending } = await db.query(
		`SELECT id, file_url, storage_type, source_family FROM pending_storage_deletions
     WHERE user_id = $1 AND status = 'pending' ORDER BY id`,
		[userId],
	);
	if (!pending.length) return { deleted: 0, failed: 0, failures: [], heldSkips: 0 };

	let deleted = 0;
	let heldSkips = 0;
	const failures = [];

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

		// Q4: per-file audit entry with metadata (Art. 5(2) accountability).
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
					file_url: entry.file_url,
					storage_type: entry.storage_type,
					outcome: newStatus,
					error: ok ? null : lastErr?.message,
				},
			});
		} catch (auditErr) {
			console.error('[erasure] storage-delete audit failed:', auditErr.message);
		}

		if (ok) {
			deleted++;
		} else {
			failures.push(entry.file_url);
			console.error(
				`[erasure] storage delete failed after 3 attempts: ${entry.file_url} — ${lastErr?.message}`,
			);
		}
	}

	return { deleted, failed: failures.length, failures, heldSkips };
}

/**
 * S-077 reconciliation sweep: process ALL pending storage deletions across
 * users (crash recovery + retry of failed entries). Called by the purge cron.
 *
 * @param {object} [opts.audit] — audit context for the sweep
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
async function sweepPendingStorageDeletions({ audit } = {}) {
	const db = require('./db');
	const { rows } = await db.query(
		`SELECT DISTINCT user_id FROM pending_storage_deletions WHERE status = 'pending'`,
	);
	let totalDeleted = 0;
	let totalFailed = 0;
	let totalHeldSkips = 0;
	for (const { user_id } of rows) {
		const res = await deleteErasedStorageFiles(user_id, { audit });
		totalDeleted += res.deleted;
		totalFailed += res.failed;
		totalHeldSkips += res.heldSkips || 0;
	}
	return { deleted: totalDeleted, failed: totalFailed, heldSkips: totalHeldSkips };
}

module.exports = { erasePersonalData, deleteErasedStorageFiles, sweepPendingStorageDeletions };
