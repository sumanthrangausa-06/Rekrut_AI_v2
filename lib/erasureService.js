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
 * Semantics: destroy the candidate's DEK (renders all DEK-encrypted biometric
 * data unrecoverable) + hard-delete the candidate_embeddings row, audit the
 * destruction, skip cleanly when the user never had a DEK (DEKNotFound). Any
 * other error propagates → caller rolls back.
 */
const { destroyDEK } = require('./biometricCrypto');
const { deleteFile } = require('./file-storage');
const biometricAudit = require('./biometricAudit');

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
 *   storageKeys: string[] }>}
 *   shredded=false when no DEK existed; *Deleted false when no rows existed.
 *   storageKeys = deduped /api/files/... URLs for Phase 2 (deleteErasedStorageFiles,
 *   post-commit — R2 NEVER in-tx).
 */
async function erasePersonalData(userId, { client, audit } = {}) {
	let shredded;
	try {
		await destroyDEK(userId, { client, audit });
		shredded = true;
	} catch (err) {
		if (err.code === 'DEKNotFound') {
			// Not every user has a DEK (recruiters, candidates with no video
			// data). Nothing to shred — not an error.
			shredded = false;
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
	const queryable = client || require('./db');
	const { rowCount: embeddingsRows } = await queryable.query(
		'DELETE FROM candidate_embeddings WHERE user_id = $1',
		[userId],
	);
	const { rowCount: searchIndexRows } = await queryable.query(
		'DELETE FROM candidate_search_index WHERE user_id = $1',
		[userId],
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
	const { rowCount: transcriptRows } = await queryable.query(
		`DELETE FROM interview_transcripts WHERE recording_id IN (
			SELECT ir.id FROM interview_recordings ir
			JOIN interview_events ie ON ie.id = ir.interview_event_id
			WHERE ie.candidate_id = $1
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

	// SHOULD-FIX 7 (privacy-engineer S-047 review): the legacy Track B observer
	// persists candidate voice transcriptions in interview_sessions.config
	// (config.observer_transcript — biometric-derived data). Session rows are
	// never deleted, so this survives erasure. Strip observer-derived keys.
	// Retain biometric_collection (consent FACT for Art. 7(1), mirroring the
	// recording_consent pattern above).
	await queryable.query(
		`UPDATE interview_sessions
		 SET config = config - 'observer_transcript' - 'observer_enabled'
		 WHERE candidate_id = $1`,
		[userId],
	);

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
		observerReportsDeleted: observerReportRows > 0,
		observerJobsDeleted: observerJobRows > 0,
		observerAudioChunksDeleted: (oaChunkRes?.rowCount || 0) > 0,
		observerSpeechMeasurementsDeleted: (oaMeasurementsRes?.rowCount || 0) > 0,
		observerCaptureOutcomesDeleted: (oaOutcomesRes?.rowCount || 0) > 0,
		storageKeys: [...r2Keys, ...localPaths.map((p) => `local:${p}`), ...observerAudioKeys],
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
		`SELECT id, file_url, storage_type FROM pending_storage_deletions
     WHERE user_id = $1 AND status = 'pending' ORDER BY id`,
		[userId],
	);
	if (!pending.length) return { deleted: 0, failed: 0, failures: [] };

	let deleted = 0;
	const failures = [];

	for (const entry of pending) {
		let ok = false;
		let lastErr = null;
		for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
			try {
				if (entry.storage_type === 'local') {
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

	return { deleted, failed: failures.length, failures };
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
	for (const { user_id } of rows) {
		const res = await deleteErasedStorageFiles(user_id, { audit });
		totalDeleted += res.deleted;
		totalFailed += res.failed;
	}
	return { deleted: totalDeleted, failed: totalFailed };
}

module.exports = { erasePersonalData, deleteErasedStorageFiles, sweepPendingStorageDeletions };
