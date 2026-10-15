#!/usr/bin/env node
/**
 * GAP-A3 (#1131): migration TOOLING for existing plaintext LiveKit
 * recording objects — batch re-encryption in place under per-candidate
 * DEKs (the GAP-A2 envelope, lib/sessionRecordingStore).
 *
 * =====================================================================
 * BOUNDARY: this story ships a gate-ready tool + LOCAL fixture evidence
 * only. A production run is NOT authorised by the tool's existence —
 * it is a launch-gate act (and additionally blocked until #1120's
 * egress-bucket identity is verified). Live mode exists as code and is
 * exercised ONLY through in-memory fakes in the fixture suite.
 * =====================================================================
 *
 * Shape (consolidated STOP 1 outcome on #1131, which governs):
 *  - Dry-run DEFAULT (no flags): enumerate + classify + report only.
 *    NO downloads, NO writes of any kind (existence Head probes and
 *    select-only DEK classification only — never getOrCreateDEK).
 *  - Live requires BOTH `--live` and `--approved-by "<name>"`; it
 *    refuses with exit 1 BEFORE any DB/storage connection otherwise.
 *    `--approved-by` alone never enables live.
 *  - Two passes (privacy D-2): the main pass NEVER mints a DEK
 *    (absent-DEK rows are their own class); `--pass absent-dek`
 *    processes only that class and counts `dek_minted`.
 *  - Per-object live sequence (B-2 ordering): fresh re-read + start
 *    guard → hold partition → attribution → DEK preflight → download
 *    (explicit cap) → encrypt → upload .enc → registry check+insert
 *    (expires_at copied VERBATIM from the row) → VERIFY (read-back,
 *    exact envelope length, decrypt + byte equality) → ledger intent
 *    (select-before-insert reuse) → hold + DEK-destroyed re-checks →
 *    guarded CAS repoint → verified plaintext delete → ledger mark.
 *  - A ledger-recovery phase opens every live run: a pending/failed
 *    livekit_recording ledger row whose recording already points at
 *    the .enc sibling gets its plaintext deleted + marked.
 *  - Reporting is two-tier: Tier 1 counts-only (NO ids, NO storage
 *    keys/locations/URLs, NO pointer ciphertext, NO hashes, NO raw
 *    error messages — error CLASSES only); Tier 2 manifest (file via
 *    --manifest only, never in git/PR/issue) carries recording ids for
 *    EXCEPTION classes only. Console logging: counts + recording_id +
 *    error class only.
 *  - The tool never deletes an interview_recordings row, never writes
 *    temp plaintext files, and never derives an envelope IV
 *    deterministically (envelopes come from sessionRecordingStore,
 *    which uses random IVs via biometricCrypto).
 *
 * Population note: the enumeration scan is bounded by
 * `storage_path IS NOT NULL AND status IN ('completed','failed')`
 * (ids only); the row-level predicate (marker 'default'/NULL) is then
 * applied per row in classification / the start guard, so the
 * unknown_marker and already_migrated classes are reachable and the
 * dry-run classes sum to the enumerated total (self-checked).
 *
 * Usage:
 *   node scripts/gap-a3-plaintext-recording-migration.js                 # dry-run
 *   node scripts/gap-a3-plaintext-recording-migration.js --live --approved-by "Name"
 *   node scripts/gap-a3-plaintext-recording-migration.js --pass absent-dek --live --approved-by "Name"
 *   flags: --limit <n>  --recording-id <id>  --report <path>  --manifest <path>
 *
 * Exit codes: 0 clean / 1 refusal-or-fatal / 2 remainder or
 * reconciliation mismatch (house pattern from #721).
 */

const TOOL_VERSION = 'gap-a3/1.0.0';
// Fixed Postgres advisory-lock key: one migration instance at a time.
const ADVISORY_LOCK_KEY = 1131003;
const MAX_ATTEMPTS = 3; // MAX_COMPLETION_ATTEMPTS precedent (#1130 R-3)
// Error codes that quarantine on attempt 1 (never retried).
const NON_RETRYABLE = new Set([
	'NO_CANDIDATE',
	'DEK_DESTROYED',
	'BUCKET_MISMATCH',
	'RECORDING_TOO_LARGE',
	'NOT_FOUND',
]);

const OUTCOME_FIELDS = [
	'migrated',
	'migrated_resumed',
	'migrated_plaintext_pending',
	'recovered_deletions',
	'dek_minted',
	'skipped_held',
	'hold_lookup_failed',
	'company_derivation_failed',
	'unresolvable',
	'dek_destroyed',
	'destroyed_mid_migration',
	'absent_dek',
	'not_found',
	'undecryptable_pointer',
	'expired_excluded',
	'unknown_marker',
	'already_migrated',
	'registry_conflict',
	'concurrent_change',
	'ledger_error',
	'quarantined',
	'failed',
];
// Classes whose recording ids may appear in the Tier 2 manifest.
// migrated / migrated_resumed are NEVER listed per-row (counts only).
const EXCEPTION_CLASSES = [
	'skipped_held',
	'hold_lookup_failed',
	'unresolvable',
	'dek_destroyed',
	'destroyed_mid_migration',
	'absent_dek',
	'not_found',
	'undecryptable_pointer',
	'expired_excluded',
	'unknown_marker',
	'already_migrated',
	'registry_conflict',
	'concurrent_change',
	'ledger_error',
	'quarantined',
	'failed',
	'migrated_plaintext_pending',
	'company_derivation_failed',
];

// ─── Pure CLI helpers (no connections) ────────────────────────────────────

function parseArgs(argv = []) {
	const out = {
		live: false,
		approvedBy: null,
		pass: 'main',
		limit: null,
		recordingId: null,
		report: null,
		manifest: null,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--live') out.live = true;
		else if (a === '--help' || a === '-h') out.help = true;
		else if (a === '--approved-by') out.approvedBy = argv[++i] ?? null;
		else if (a === '--pass') out.pass = argv[++i] ?? 'main';
		else if (a === '--limit') out.limit = Number(argv[++i]);
		else if (a === '--recording-id') out.recordingId = Number(argv[++i]);
		else if (a === '--report') out.report = argv[++i] ?? null;
		else if (a === '--manifest') out.manifest = argv[++i] ?? null;
	}
	return out;
}

/** Returns an error string, or null when the options may run. Pure. */
function validateOptions(opts = {}) {
	if (opts.pass != null && !['main', 'absent-dek'].includes(opts.pass)) {
		return 'INVALID_PASS';
	}
	if (opts.live && (opts.approvedBy == null || String(opts.approvedBy).trim() === '')) {
		return 'LIVE_REQUIRES_APPROVED_BY';
	}
	if (opts.limit != null && opts.limit !== null && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
		return 'INVALID_LIMIT';
	}
	if (
		opts.recordingId != null &&
		opts.recordingId !== null &&
		!Number.isInteger(opts.recordingId)
	) {
		return 'INVALID_RECORDING_ID';
	}
	return null;
}

function usage() {
	return [
		'GAP-A3 plaintext recording migration tooling (#1131)',
		'Usage: node scripts/gap-a3-plaintext-recording-migration.js [--live --approved-by "<name>"]',
		'  (no flags)            dry-run: enumerate + classify + report, no writes',
		'  --live                live mode; requires --approved-by "<name>"',
		'  --pass main|absent-dek  pass selection (default main)',
		'  --limit <n>           process at most n enumerated rows',
		'  --recording-id <id>   process a single recording',
		'  --report <path>       write Tier 1 JSON report to path',
		'  --manifest <path>     write Tier 2 exception manifest to path',
		'Exit codes: 0 clean / 1 refusal-or-fatal / 2 remainder or reconciliation mismatch',
		'Production run NOT authorised by this tool — launch-gate act.',
	].join('\n');
}

function errorClass(err) {
	return (err && (err.code || err.name)) || 'Error';
}

function coded(code, message) {
	const err = new Error(message || code);
	err.code = code;
	return err;
}

function buffersEqual(a, b) {
	if (a == null || b == null) return a == null && b == null;
	try {
		return Buffer.from(a).equals(Buffer.from(b));
	} catch {
		return false;
	}
}

// ─── Dependency resolution (injectable adapters) ──────────────────────────
// Tests inject the mocked pool + (wrapped) sessionRecordingStore so the
// SAME code path runs dry-run and live against in-memory fakes.

function resolveDeps(overrides = {}) {
	const pool = overrides.pool || require('../lib/db');
	const storage = overrides.storage || require('../lib/sessionRecordingStore');
	const encryption = overrides.encryption || require('../services/encryption');
	const livekit = require('../server/services/livekit');
	const legalHold = require('../lib/legalHold');
	return {
		pool,
		storage,
		encryption,
		marker: storage.ENCRYPTION_KEY_ID || 'candidate-dek:v1',
		maxBytes: storage.MAX_SESSION_RECORDING_BYTES,
		findActiveHold: overrides.findActiveHold || legalHold.findActiveHold,
		resolveCandidateId: overrides.resolveCandidateId || livekit.resolveRecordingCandidateId,
		dekState: overrides.dekState || livekit._dekState,
		isDEKDestroyedNow: overrides.isDEKDestroyedNow || livekit._isDEKDestroyedNow,
	};
}

// ─── Subject construction (hold consult + attribution) ────────────────────

/**
 * Resolve attribution for a recording row: candidate via
 * resolveRecordingCandidateId ONLY, plus the event-flow company
 * derivation (interview_events.job_application_id →
 * job_applications.company_id). Never guesses a candidate.
 */
async function buildSubjects(row, deps) {
	const info = {
		attribution: null,
		candidateId: null,
		companyId: null,
		companyDerivationFailed: false,
		sessionMissing: false,
		subjects: null,
	};
	if (row.interview_session_id != null) info.attribution = 'session';
	else if (row.interview_event_id != null) info.attribution = 'event';

	info.candidateId = await deps.resolveCandidateId(row);

	if (info.attribution === 'session') {
		const s = await deps.pool.query('SELECT id FROM interview_sessions WHERE id = $1', [
			row.interview_session_id,
		]);
		info.sessionMissing = s.rows.length === 0;
	}
	if (info.attribution === 'event') {
		const res = await deps.pool.query(
			`SELECT ja.company_id AS company_id
			   FROM interview_events ie
			   JOIN job_applications ja ON ja.id = ie.job_application_id
			  WHERE ie.id = $1`,
			[row.interview_event_id],
		);
		if (!res.rows[0] || res.rows[0].company_id == null) {
			// NULL is never "cleared": session-less consult + flag.
			info.companyDerivationFailed = true;
		} else {
			info.companyId = res.rows[0].company_id;
		}
	}

	if (info.attribution === 'session') {
		info.subjects = { candidateId: info.candidateId, sessionId: row.interview_session_id };
	} else if (info.attribution === 'event') {
		info.subjects = info.companyDerivationFailed
			? { candidateId: info.candidateId }
			: { candidateId: info.candidateId, companyId: info.companyId };
	} else {
		info.subjects = { candidateId: info.candidateId };
	}
	return info;
}

/**
 * Hold partition via findActiveHold called DIRECTLY (never isHeld —
 * the held / lookup-failed distinction is the report). Returns
 * 'held' | 'clear' | 'lookup_failed'.
 *
 * Dangling-session note: when the row's own session no longer exists,
 * findActiveHold throws by design (fail-closed, F-6) — but there is
 * also no subject left to hold and no candidate resolvable through
 * it; the row is dispositioned by its attribution failure
 * (unresolvable) further down the precedence chain instead of being
 * merged into the lookup-failure bucket.
 */
async function consultHold(row, deps, subjectsInfo) {
	if (subjectsInfo.sessionMissing) return 'clear';
	const s = subjectsInfo.subjects || {};
	if (s.candidateId == null && s.sessionId == null && s.companyId == null) return 'clear';
	try {
		const hold = await deps.findActiveHold(s, deps.pool);
		return hold ? 'held' : 'clear';
	} catch {
		return 'lookup_failed';
	}
}

// ─── Ledger helpers ───────────────────────────────────────────────────────

async function findLedgerRow(deps, candidateId, fileUrl) {
	const res = await deps.pool.query(
		`SELECT id, status FROM pending_storage_deletions
		  WHERE user_id = $1 AND file_url = $2 AND storage_type = 'r2'
		    AND source_family = 'livekit_recording' AND status IN ('pending','failed')
		  ORDER BY id ASC LIMIT 1`,
		[candidateId, fileUrl],
	);
	return res.rows[0] || null;
}

/** Select-before-insert reuse of an existing pending/failed ledger row. */
async function ensureLedgerIntent(deps, candidateId, fileUrl) {
	const existing = await findLedgerRow(deps, candidateId, fileUrl);
	if (existing) return existing;
	const res = await deps.pool.query(
		`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
		 VALUES ($1, $2, 'r2', 'pending', 'livekit_recording')
		 RETURNING id`,
		[candidateId, fileUrl],
	);
	if (!res.rows[0]) throw coded('LEDGER_ERROR', 'ledger intent insert returned no row');
	return res.rows[0];
}

async function markLedgerDeleted(deps, ledgerId) {
	await deps.pool.query(
		`UPDATE pending_storage_deletions SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
		[ledgerId],
	);
}

/** Failure-marking stores the error CLASS only — never a raw message. */
async function markLedgerFailed(deps, ledgerId, cls) {
	await deps.pool.query(
		`UPDATE pending_storage_deletions
		    SET status = 'failed', last_error = $1, attempts = attempts + 1, updated_at = NOW()
		  WHERE id = $2`,
		[String(cls || 'Error'), ledgerId],
	);
}

// ─── Classification (dry-run; also the closing reconciliation scan) ──────

/**
 * Classify one freshly-read row. Precedence (mutually exclusive):
 * hold_lookup_failed → skipped_held → unknown_marker → already_migrated
 * → undecryptable_pointer → expired_excluded → unresolvable →
 * dek_destroyed → absent_dek → not_found → migratable (resume_enc is a
 * migratable sub-flag). Performs NO downloads and NO writes: existence
 * Head probes + select-only DEK classification only.
 */
async function classifyRow(row, deps) {
	const info = {
		recordingId: row.id,
		cls: null,
		errorClass: null,
		candidateId: null,
		attribution: null,
		companyDerivationFailed: false,
		plaintextLocation: null,
		encLocation: null,
		resume: false,
		ledgerPreexisting: false,
	};

	const subjectsInfo = await buildSubjects(row, deps);
	info.candidateId = subjectsInfo.candidateId;
	info.attribution = subjectsInfo.attribution;
	info.companyDerivationFailed = subjectsInfo.companyDerivationFailed;

	const hold = await consultHold(row, deps, subjectsInfo);
	if (hold === 'lookup_failed') {
		info.cls = 'hold_lookup_failed';
		info.errorClass = 'HOLD_LOOKUP_FAILED';
		return info;
	}
	if (hold === 'held') {
		info.cls = 'skipped_held';
		return info;
	}

	const marker = row.encryption_key_id ?? null;
	if (marker !== null && marker !== 'default' && marker !== deps.marker) {
		info.cls = 'unknown_marker';
		return info;
	}

	let plaintext = null;
	try {
		plaintext = deps.encryption.decrypt(Buffer.from(row.storage_path)).toString('utf8');
	} catch {
		plaintext = null;
	}
	if (marker === deps.marker) {
		info.cls = 'already_migrated';
		info.plaintextLocation = plaintext;
		return info;
	}
	if (plaintext && plaintext.endsWith('.enc')) {
		info.cls = 'already_migrated';
		info.plaintextLocation = plaintext;
		return info;
	}
	if (!plaintext) {
		info.cls = 'undecryptable_pointer';
		info.errorClass = 'UNDECRYPTABLE_POINTER';
		return info;
	}
	info.plaintextLocation = plaintext;

	try {
		info.encLocation = deps.storage.encLocationFor(plaintext);
	} catch (err) {
		info.cls = 'quarantined';
		info.errorClass = errorClass(err);
		return info;
	}

	if (row.retention_expires_at && new Date(row.retention_expires_at).getTime() < Date.now()) {
		info.cls = 'expired_excluded';
		return info;
	}

	if (info.candidateId == null) {
		info.cls = 'unresolvable';
		info.errorClass = 'NO_CANDIDATE';
		return info;
	}

	let state;
	try {
		state = await deps.dekState(info.candidateId); // select-only; never mints
	} catch (err) {
		info.cls = 'quarantined';
		info.errorClass = errorClass(err);
		return info;
	}
	if (state === 'destroyed') {
		info.cls = 'dek_destroyed';
		info.errorClass = 'DEK_DESTROYED';
		return info;
	}
	if (state === 'absent') {
		info.cls = 'absent_dek';
		return info;
	}

	// not_found requires BOTH existence probes: plaintext key AND the
	// .enc sibling. Plaintext absent + .enc present = resume (migratable).
	let plainExists;
	let encExists = false;
	try {
		plainExists = await deps.storage.recordingObjectExists(plaintext);
		if (!plainExists) encExists = await deps.storage.recordingObjectExists(info.encLocation);
	} catch (err) {
		info.cls = 'quarantined';
		info.errorClass = errorClass(err);
		return info;
	}
	if (!plainExists && !encExists) {
		info.cls = 'not_found';
		info.errorClass = 'NOT_FOUND';
		return info;
	}
	if (!plainExists && encExists) info.resume = true;

	if (row.status === 'failed') {
		const led = await findLedgerRow(deps, info.candidateId, plaintext);
		info.ledgerPreexisting = !!led;
	}
	info.cls = 'migratable';
	return info;
}

// ─── Live per-object migration ────────────────────────────────────────────

/**
 * Migrate one recording, in exactly the consolidated sequence.
 * `snapshotPointer` is the storage_path bytes read at classification
 * (start guard / CAS compare). Returns {disposition, errorClass?,
 * resumed?, dekMinted?}. Registry conflicts and concurrent changes are
 * dispositions, not failures — they consume no attempts.
 */
async function processOne(recordingId, snapshotPointer, deps, ctx = {}) {
	const pass = ctx.pass || 'main';
	const log = ctx.log || (() => {});

	const freshRes = await deps.pool.query('SELECT * FROM interview_recordings WHERE id = $1', [
		recordingId,
	]);
	const row = freshRes.rows[0] || null;
	// Start guard: predicate + status + pointer freshness on the fresh row.
	if (
		!row ||
		!['completed', 'failed'].includes(row.status) ||
		row.storage_path == null ||
		row.encryption_key_id === deps.marker ||
		!buffersEqual(row.storage_path, snapshotPointer)
	) {
		return { disposition: 'concurrent_change' };
	}

	// Hold partition (before any other touch).
	const subjectsInfo = await buildSubjects(row, deps);
	const hold = await consultHold(row, deps, subjectsInfo);
	if (hold === 'lookup_failed') return { disposition: 'hold_lookup_failed', errorClass: 'HOLD_LOOKUP_FAILED' };
	if (hold === 'held') return { disposition: 'skipped_held' };

	// Attribution: resolveRecordingCandidateId only — never guessed.
	const candidateId = subjectsInfo.candidateId;
	if (candidateId == null) return { disposition: 'unresolvable', errorClass: 'NO_CANDIDATE' };

	let plaintextLocation;
	let encLocation;
	try {
		plaintextLocation = deps.encryption.decrypt(Buffer.from(row.storage_path)).toString('utf8');
		encLocation = deps.storage.encLocationFor(plaintextLocation);
	} catch (err) {
		if (!plaintextLocation) return { disposition: 'undecryptable_pointer', errorClass: 'UNDECRYPTABLE_POINTER' };
		return { disposition: 'quarantined', errorClass: errorClass(err) };
	}

	// DEK preflight at processing time (never cached).
	let dekState;
	try {
		dekState = await deps.dekState(candidateId);
	} catch (err) {
		return { disposition: 'quarantined', errorClass: errorClass(err) };
	}
	if (dekState === 'destroyed') return { disposition: 'dek_destroyed', errorClass: 'DEK_DESTROYED' };
	let mintPending = false;
	if (dekState === 'absent') {
		if (pass === 'main') return { disposition: 'absent_dek' };
		mintPending = true; // absent-dek pass: encryptWithDEK mints; counted below
	}

	// Existence / resume detection (both probes).
	let plainExists;
	let encExists = false;
	try {
		plainExists = await deps.storage.recordingObjectExists(plaintextLocation);
		if (!plainExists) encExists = await deps.storage.recordingObjectExists(encLocation);
	} catch (err) {
		return { disposition: 'quarantined', errorClass: errorClass(err) };
	}
	if (!plainExists && !encExists) return { disposition: 'not_found', errorClass: 'NOT_FOUND' };
	const resume = !plainExists && encExists;

	let ledgerRow = null;
	let dekMinted = false;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			let source = null;
			if (!resume) {
				// Row's stored file_size_bytes is advisory only; the cap
				// is enforced by the counting-stream download itself.
				source = await deps.storage.downloadRecordingObject(plaintextLocation, {
					maxBytes: deps.maxBytes,
				});
				const envelope = await deps.storage.encryptSessionRecording(source, candidateId, recordingId);
				if (mintPending) dekMinted = true;
				await deps.storage.uploadEncryptedObject(plaintextLocation, envelope);
			}

			// Registry check + insert. A row for this .enc key held by a
			// DIFFERENT candidate, or soft-deleted, is a conflict: stop
			// this object, never a silent ON CONFLICT swallow.
			const reg = await deps.pool.query(
				'SELECT object_key, candidate_id, deleted_at FROM recording_objects WHERE object_key = $1',
				[encLocation],
			);
			if (
				reg.rows[0] &&
				(Number(reg.rows[0].candidate_id) !== candidateId || reg.rows[0].deleted_at != null)
			) {
				return { disposition: 'registry_conflict', dekMinted };
			}
			await deps.pool.query(
				`INSERT INTO recording_objects (object_key, candidate_id, object_type, expires_at)
				 VALUES ($1, $2, 'recording', $3)
				 ON CONFLICT (object_key) DO NOTHING`,
				// expires_at copies the row's retention_expires_at VERBATIM.
				[encLocation, candidateId, row.retention_expires_at],
			);

			// VERIFY (before any ledger intent / repoint / delete):
			// re-download the .enc with the DEFAULT cap; envelope length
			// must equal source length + 29 exactly; decrypt must
			// succeed; decrypted bytes must equal the source.
			const encBytes = await deps.storage.downloadRecordingObject(encLocation);
			if (!resume) {
				if (encBytes.length !== source.length + 29) {
					throw coded('VERIFY_FAILED', 'envelope length mismatch');
				}
				const decrypted = await deps.storage.decryptSessionRecording(encBytes, candidateId, recordingId);
				if (!decrypted.equals(source)) throw coded('VERIFY_FAILED', 'decrypted bytes differ');
			} else {
				// Resume verify rule: there are no source bytes to compare
				// (the plaintext is already gone) — verify = decrypt
				// succeeds AND decrypted length is consistent with the
				// envelope (envelope length − 29) AND, when the row
				// carries file_size_bytes, equals it exactly.
				const decrypted = await deps.storage.decryptSessionRecording(encBytes, candidateId, recordingId);
				if (decrypted.length !== encBytes.length - 29) {
					throw coded('VERIFY_FAILED', 'resume length inconsistency');
				}
				if (row.file_size_bytes != null && decrypted.length !== Number(row.file_size_bytes)) {
					throw coded('VERIFY_FAILED', 'resume size mismatch');
				}
			}

			// Ledger intent (select-before-insert reuse). Failure aborts
			// the object: NO repoint, NO delete.
			try {
				ledgerRow = await ensureLedgerIntent(deps, candidateId, plaintextLocation);
			} catch {
				return { disposition: 'ledger_error', errorClass: 'LEDGER_ERROR', dekMinted };
			}

			// Re-checks before repoint: hold re-consult + DEK destruction.
			const hold2 = await consultHold(row, deps, subjectsInfo);
			if (hold2 === 'lookup_failed') {
				return { disposition: 'hold_lookup_failed', errorClass: 'HOLD_LOOKUP_FAILED', dekMinted };
			}
			if (hold2 === 'held') return { disposition: 'skipped_held', dekMinted };
			if (await deps.isDEKDestroyedNow(candidateId)) {
				// G-1 shape: the .enc is ledgered as its own pending row;
				// plaintext untouched, no repoint, never restored.
				await ensureLedgerIntent(deps, candidateId, encLocation).catch(() => null);
				return { disposition: 'destroyed_mid_migration', errorClass: 'DEK_DESTROYED', dekMinted };
			}

			// Guarded repoint (this tool's own CAS — B-1).
			const encPointer = deps.encryption.encrypt(Buffer.from(encLocation));
			const upd = await deps.pool.query(
				`UPDATE interview_recordings
				    SET storage_path = $1, encryption_key_id = 'candidate-dek:v1', updated_at = NOW()
				  WHERE id = $2
				    AND status IN ('completed','failed')
				    AND storage_path = $3
				    AND encryption_key_id IS DISTINCT FROM 'candidate-dek:v1'
				    AND NOT EXISTS (SELECT 1 FROM candidate_data_keys
				                    WHERE candidate_id = $4 AND destroyed_at IS NOT NULL)`,
				[encPointer, recordingId, Buffer.from(snapshotPointer), candidateId],
			);
			if (!upd.rowCount) return { disposition: 'concurrent_change', dekMinted };

			// Verified plaintext delete, then ledger mark by id. A delete
			// (or mark) failure leaves the ledger pending for the
			// ledger-recovery phase of the next live run. For resume,
			// the plaintext is already gone: DeleteObject + head-check
			// converges as already-gone inside the verified delete.
			try {
				await deps.storage.deleteRecordingObjectVerified(plaintextLocation);
			} catch {
				return { disposition: 'migrated_plaintext_pending', resumed: resume, dekMinted };
			}
			try {
				await markLedgerDeleted(deps, ledgerRow.id);
			} catch {
				return { disposition: 'migrated_plaintext_pending', resumed: resume, dekMinted };
			}
			log(recordingId, 'migrated');
			return { disposition: 'migrated', resumed: resume, dekMinted };
		} catch (err) {
			const cls = errorClass(err);
			if (NON_RETRYABLE.has(cls) || err.nonRetryable) {
				if (cls === 'NOT_FOUND') return { disposition: 'not_found', errorClass: cls, dekMinted };
				return { disposition: 'quarantined', errorClass: cls, dekMinted };
			}
			if (attempt === MAX_ATTEMPTS) {
				if (ledgerRow) await markLedgerFailed(deps, ledgerRow.id, cls).catch(() => {});
				return { disposition: 'quarantined', errorClass: cls, dekMinted };
			}
			// retryable: loop (deterministic .enc key + conflict-safe
			// registry/ledger reuse make the retry converge)
		}
	}
	return { disposition: 'quarantined', errorClass: 'Error', dekMinted };
}

// ─── Ledger-recovery phase (opens every LIVE run) ─────────────────────────

async function ledgerRecoveryPhase(deps, outcomes, log) {
	const led = await deps.pool.query(
		`SELECT id, user_id, file_url FROM pending_storage_deletions
		  WHERE source_family = 'livekit_recording' AND status IN ('pending','failed') AND user_id > 0
		  ORDER BY id ASC`,
	);
	if (!led.rows.length) return;
	const all = await deps.pool.query('SELECT * FROM interview_recordings ORDER BY id ASC');
	for (const ledgerRow of led.rows) {
		try {
			let encLocation;
			try {
				encLocation = deps.storage.encLocationFor(ledgerRow.file_url);
			} catch {
				continue; // cannot name the sibling — leave untouched
			}
			let acted = false;
			for (const rec of all.rows) {
				if (rec.storage_path == null) continue;
				const candidateId = await deps.resolveCandidateId(rec);
				if (candidateId !== Number(ledgerRow.user_id)) continue;
				let pointer = null;
				try {
					pointer = deps.encryption.decrypt(Buffer.from(rec.storage_path)).toString('utf8');
				} catch {
					pointer = null;
				}
				// Act ONLY if the repoint already happened (the decrypted
				// pointer names the .enc sibling of the ledgered plaintext).
				if (pointer === encLocation) {
					await deps.storage.deleteRecordingObjectVerified(ledgerRow.file_url);
					await markLedgerDeleted(deps, ledgerRow.id);
					outcomes.recovered_deletions++;
					acted = true;
					break;
				}
			}
			void acted;
		} catch (err) {
			log(null, 'recovery_error', errorClass(err));
		}
	}
}

// ─── Enumeration + classification scan ────────────────────────────────────

async function enumerateIds(deps, opts) {
	const res = await deps.pool.query(
		`SELECT id FROM interview_recordings
		  WHERE storage_path IS NOT NULL AND status IN ('completed','failed')
		  ORDER BY id ASC`,
	);
	let ids = res.rows.map((r) => Number(r.id));
	if (opts.recordingId != null) ids = ids.filter((id) => id === Number(opts.recordingId));
	if (opts.limit != null) ids = ids.slice(0, Number(opts.limit));
	return ids;
}

async function sideCounts(deps) {
	const deleted = await deps.pool.query(
		`SELECT COUNT(*) AS count FROM interview_recordings WHERE status = 'deleted' AND storage_path IS NOT NULL`,
	);
	const active = await deps.pool.query(
		`SELECT COUNT(*) AS count FROM interview_recordings WHERE status IN ('pending','recording','processing') AND storage_path IS NOT NULL`,
	);
	const noObject = await deps.pool.query(
		`SELECT COUNT(*) AS count FROM interview_recordings WHERE storage_path IS NULL`,
	);
	return {
		deleted_pointer_retained: Number(deleted.rows[0]?.count || 0),
		excluded_active: Number(active.rows[0]?.count || 0),
		no_object: Number(noObject.rows[0]?.count || 0),
	};
}

async function classificationScan(ids, deps) {
	const byClass = {};
	const classified = new Map();
	let derivationFailed = 0;
	const migratable = {
		total: 0,
		resume_enc: 0,
		ledger_preexisting: 0,
		by_status: { completed: 0, failed: 0 },
		by_attribution: { session: 0, event: 0 },
	};
	for (const id of ids) {
		const fresh = await deps.pool.query('SELECT * FROM interview_recordings WHERE id = $1', [id]);
		const row = fresh.rows[0];
		if (!row) continue;
		const info = await classifyRow(row, deps);
		info.snapshotPointer = row.storage_path != null ? Buffer.from(row.storage_path) : null;
		info.status = row.status;
		classified.set(id, info);
		byClass[info.cls] = (byClass[info.cls] || 0) + 1;
		if (info.companyDerivationFailed) derivationFailed++;
		if (info.cls === 'migratable') {
			migratable.total++;
			if (info.resume) migratable.resume_enc++;
			if (info.ledgerPreexisting) migratable.ledger_preexisting++;
			if (info.status === 'completed' || info.status === 'failed') {
				migratable.by_status[info.status]++;
			}
			if (info.attribution === 'session' || info.attribution === 'event') {
				migratable.by_attribution[info.attribution]++;
			}
		}
	}
	return { byClass, classified, derivationFailed, migratable };
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function runMigration(opts = {}, depOverrides = {}) {
	const startedAt = new Date();
	const options = {
		live: !!opts.live,
		approvedBy: opts.approvedBy ?? null,
		pass: opts.pass || 'main',
		limit: opts.limit ?? null,
		recordingId: opts.recordingId ?? null,
		reportPath: opts.report || opts.reportPath || null,
		manifestPath: opts.manifest || opts.manifestPath || null,
	};

	const outcomes = {};
	for (const f of OUTCOME_FIELDS) outcomes[f] = 0;
	const errorClassCounts = {};
	const manifest = { tool: TOOL_VERSION, generated_at: startedAt.toISOString(), exceptions: {} };
	const addException = (cls, recordingId, candidateId) => {
		if (!EXCEPTION_CLASSES.includes(cls)) return;
		if (!manifest.exceptions[cls]) manifest.exceptions[cls] = [];
		manifest.exceptions[cls].push(
			candidateId != null ? { recording_id: recordingId, candidate_id: candidateId } : { recording_id: recordingId },
		);
	};
	const bumpError = (cls) => {
		if (cls) errorClassCounts[cls] = (errorClassCounts[cls] || 0) + 1;
	};
	// Console discipline: counts + recording_id + error class only.
	const log = (recordingId, event, cls) => {
		console.log(
			`[gap-a3] ${event} recording_id=${recordingId == null ? '-' : recordingId}${cls ? ` error_class=${cls}` : ''}`,
		);
	};

	const baseReport = () => ({
		tool: TOOL_VERSION,
		mode: options.live ? 'live' : 'dry-run',
		pass: options.pass,
		approved_by: options.live ? options.approvedBy : null,
		started_at: startedAt.toISOString(),
		finished_at: new Date().toISOString(),
		population: { total: 0, byClass: {}, migratable: null, side_counts: null },
		outcomes,
		plaintext_remaining: null,
		error_class_counts: errorClassCounts,
		reconciliation: { ok: false },
		scope_limits: [
			'Completeness is row-bounded: egress objects landed on pointer-NULL rows and bucket objects with no row are out of scope (bucket-listing reconciliation is a follow-up for the live gate).',
			'Hold claim is scoped to candidate- and company-held material; recruiter/panel-member user-holds are not consulted.',
			'Verified delete is current-version only; bucket versioning is unverified — "expunged" is not claimed.',
		],
	});

	// Refusal BEFORE any DB/storage connection (live gate).
	const validationError = validateOptions(options);
	if (validationError) {
		const report = baseReport();
		report.fatal_error_class = validationError;
		return { exitCode: 1, report, manifest };
	}

	const deps = resolveDeps(depOverrides);
	let report = baseReport();

	try {
		// Startup: fresh-process assumption; assert storage config
		// before the first storage op; clear any cached client.
		if (typeof deps.storage._clearClient === 'function') deps.storage._clearClient();
		deps.storage.getRecordingStorageConfig();

		// Single instance: Postgres advisory lock (both modes).
		const lockRes = await deps.pool.query('SELECT pg_try_advisory_lock($1) AS locked', [
			ADVISORY_LOCK_KEY,
		]);
		const lockRow = lockRes.rows[0] || {};
		const locked = lockRow.locked ?? lockRow.pg_try_advisory_lock ?? Object.values(lockRow)[0];
		if (!locked) {
			report.fatal_error_class = 'ADVISORY_LOCK_HELD';
			return { exitCode: 1, report, manifest };
		}

		try {
			// Ledger-recovery phase opens every LIVE run.
			if (options.live) await ledgerRecoveryPhase(deps, outcomes, log);

			const ids = await enumerateIds(deps, options);
			const sides = await sideCounts(deps);
			const scan = await classificationScan(ids, deps);
			const classSum = Object.values(scan.byClass).reduce((a, b) => a + b, 0);
			const selfCheckOk = classSum === ids.length;

			report.population = {
				total: ids.length,
				byClass: scan.byClass,
				migratable: scan.migratable,
				side_counts: sides,
			};
			outcomes.company_derivation_failed = scan.derivationFailed;
			// Derivation-failed rows are exception-listed (flag, not a class).
			for (const info of scan.classified.values()) {
				if (info.companyDerivationFailed) {
					addException('company_derivation_failed', info.recordingId, info.candidateId);
				}
			}

			if (!options.live) {
				// Dry-run outcomes mirror the classification; nothing migrated.
				for (const [cls, n] of Object.entries(scan.byClass)) {
					if (cls in outcomes) outcomes[cls] += n;
				}
				for (const info of scan.classified.values()) {
					if (info.errorClass) bumpError(info.errorClass);
					addException(info.cls, info.recordingId, info.candidateId);
				}
				report.reconciliation = {
					ok: selfCheckOk,
					method: 'dry-run class sum vs enumerated total',
					enumerated_total: ids.length,
					class_sum: classSum,
				};
				report.plaintext_remaining = plaintextRemaining(outcomes, sides);
				report.finished_at = new Date().toISOString();
				await writeOutputs(options, report, manifest);
				return { exitCode: selfCheckOk ? 0 : 2, report, manifest };
			}

			// LIVE: process targets for this pass; every other row's
			// disposition is its classification class.
			const isTarget = (info) =>
				options.pass === 'main' ? info.cls === 'migratable' : info.cls === 'absent_dek';
			const dispositions = new Map();
			for (const info of scan.classified.values()) {
				if (!isTarget(info)) {
					dispositions.set(info.recordingId, info.cls);
					if (info.cls in outcomes) outcomes[info.cls]++;
					if (info.errorClass) bumpError(info.errorClass);
					addException(info.cls, info.recordingId, info.candidateId);
				}
			}
			for (const info of scan.classified.values()) {
				if (!isTarget(info)) continue;
				const result = await processOne(info.recordingId, info.snapshotPointer, deps, {
					pass: options.pass,
					log,
				});
				dispositions.set(info.recordingId, result.disposition);
				if (result.disposition === 'migrated') {
					outcomes.migrated++;
					if (result.resumed) outcomes.migrated_resumed++;
				} else if (result.disposition in outcomes) {
					outcomes[result.disposition]++;
				} else {
					outcomes.failed++;
				}
				if (result.errorClass) bumpError(result.errorClass);
				if (result.dekMinted) outcomes.dek_minted++;
				addException(result.disposition, info.recordingId, info.candidateId);
			}

			// Closing reconciliation: re-run the classification scan.
			const closingIds = await enumerateIds(deps, options);
			const closing = await classificationScan(closingIds, deps);
			const remainder =
				options.pass === 'main'
					? closing.byClass.migratable || 0
					: closing.byClass.absent_dek || 0;
			// Full disposition sum: every enumerated row has exactly one
			// final disposition. (The STOP 1 equation's named terms are
			// all included; already_migrated / destroyed_mid_migration /
			// ledger_error / migrated_resumed-as-subcount complete it.)
			const dispositionSum = dispositions.size;
			const reconciled = selfCheckOk && dispositionSum === ids.length && remainder === 0;
			report.reconciliation = {
				ok: reconciled,
				method: 'closing dry-run classification scan (not summed run reports)',
				enumerated_total: ids.length,
				disposition_sum: dispositionSum,
				closing_byClass: closing.byClass,
				remainder_target: remainder,
				equation:
					'enumerated_total = migrated + migrated_plaintext_pending + skipped_held + hold_lookup_failed + unresolvable + dek_destroyed + absent_dek(main pass) + not_found + undecryptable_pointer + expired_excluded + unknown_marker + already_migrated + registry_conflict + concurrent_change + destroyed_mid_migration + ledger_error + quarantined + failed (+ out-of-pass rows in the absent-dek pass, counted under their class)',
			};
			report.plaintext_remaining = plaintextRemaining(outcomes, sides);
			report.finished_at = new Date().toISOString();
			await writeOutputs(options, report, manifest);
			return { exitCode: reconciled ? 0 : 2, report, manifest };
		} finally {
			await deps.pool
				.query('SELECT pg_advisory_unlock($1) AS locked', [ADVISORY_LOCK_KEY])
				.catch(() => {});
		}
	} catch (err) {
		report = baseReport();
		report.fatal_error_class = errorClass(err);
		report.finished_at = new Date().toISOString();
		return { exitCode: 1, report, manifest };
	}
}

/**
 * plaintext_remaining statement: plaintext that remains after the run,
 * by the classes that retain it (held + lookup-failed + quarantined
 * classes + expired + class D), plus absent-DEK rows in the main pass.
 */
function plaintextRemaining(outcomes, sides) {
	const quarantinedClasses =
		(outcomes.quarantined || 0) +
		(outcomes.failed || 0) +
		(outcomes.unresolvable || 0) +
		(outcomes.dek_destroyed || 0) +
		(outcomes.destroyed_mid_migration || 0) +
		(outcomes.registry_conflict || 0) +
		(outcomes.concurrent_change || 0) +
		(outcomes.ledger_error || 0);
	const breakdown = {
		held: outcomes.skipped_held || 0,
		hold_lookup_failed: outcomes.hold_lookup_failed || 0,
		quarantined_classes: quarantinedClasses,
		expired_excluded: outcomes.expired_excluded || 0,
		deleted_pointer_retained: sides?.deleted_pointer_retained || 0,
		absent_dek_main_pass: outcomes.absent_dek || 0,
		migrated_plaintext_pending: outcomes.migrated_plaintext_pending || 0,
	};
	return {
		total: Object.values(breakdown).reduce((a, b) => a + b, 0),
		breakdown,
		basis:
			'held + hold-lookup-failed + quarantined classes (quarantined, failed, unresolvable, dek_destroyed, destroyed_mid_migration, registry_conflict, concurrent_change, ledger_error) + expired + deleted_pointer_retained (class D) + absent_dek (main pass) + migrated_plaintext_pending',
	};
}

async function writeOutputs(options, report, manifest) {
	if (!options.reportPath && !options.manifestPath) return;
	const fs = require('node:fs');
	if (options.reportPath) {
		fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
	}
	if (options.manifestPath) {
		fs.writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	}
}

// ─── CLI entry (require.main guard — house pattern) ───────────────────────

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log(usage());
		process.exit(0);
	}
	const validationError = validateOptions(opts);
	if (validationError) {
		// Refusal before any DB/storage connection.
		console.error(`[gap-a3] refusal error_class=${validationError}`);
		process.exit(1);
	}
	const { exitCode, report } = await runMigration(opts);
	console.log(JSON.stringify(report, null, 2));
	process.exit(exitCode);
}

if (require.main === module) {
	main().catch(() => {
		console.error('[gap-a3] fatal error_class=FatalError');
		process.exit(1);
	});
}

module.exports = {
	TOOL_VERSION,
	ADVISORY_LOCK_KEY,
	MAX_ATTEMPTS,
	parseArgs,
	validateOptions,
	usage,
	errorClass,
	classifyRow,
	processOne,
	runMigration,
	plaintextRemaining,
};
