/**
 * observerCapture — persistence + session runtime for Gate A capture
 * (S-085 #787, design §3.4–§5.4, §8). Everything in this module sits
 * BEHIND the capture gate (lib/observerCaptureGate.js): nothing here is
 * reachable while a session is dormant, and the dormancy suite proves it
 * (all §8.1 counters exactly zero with the flag off).
 *
 * Registry-intent-first chunk protocol (§4.4) — an unregistered storage
 * object is impossible:
 *   1. A committed tx writes the intent: recording_objects row
 *      (registration_state='pending', expires_at = now + 30d) + the
 *      observer_audio_chunks row, both under the PRE-GENERATED bare key.
 *      Failure ⇒ no PUT ever happens; the chunk is dropped.
 *   2. Encrypt → PUT at that key (r2ObserverAudioStore).
 *   3. A confirm tx under pg_advisory_xact_lock(hashtext(candidateId))
 *      re-checks job existence + gate state, then marks the registry row
 *      'confirmed', records byte_size, and rewrites both rows' object_key
 *      to the provider-prefixed key the store returned. On re-check
 *      failure: compensating delete of the object; if THAT fails, a
 *      pending_storage_deletions ledger row (source_family=
 *      'observer_audio') guarantees eventual deletion.
 *   A crash between steps leaves a 'pending' intent the reconciler
 *   retires (reconcileObserverAudioIntents): it deletes the object under
 *   every provider prefix (deletes are idempotent) and removes the intent
 *   rows. The full T11 fault-injection proof is in the C-5 suite.
 *
 * Structured logs follow design §6.4 (+ D-3 errata: gate_code): the emit
 * path whitelists fields — candidate/user/employer IDs, transcript text,
 * audio bytes/hashes, measurement values, consent contents, and object
 * keys can never reach a log line through this module.
 */
const db = require('./db');
const store = require('./r2ObserverAudioStore');
const biometricCrypto = require('./biometricCrypto');
const { packEnvelope } = require('./r2FrameStore');
const { deleteStorageObject } = require('./file-storage');
const { recheckCaptureGate } = require('./observerCaptureGate');
const { readCaptureFlag } = require('./observerCaptureFlag');
const { resolveEnvIdentity } = require('./observerEnvIdentity');
const speech = require('./observerSpeech');

const CHUNK_SECONDS = 30;
const CHUNK_FORCE_FLUSH_SECONDS = 120;
const MEASUREMENT_SAMPLE_RATE = 16000;
const MAX_CONSECUTIVE_STORAGE_FAILURES = 3;
const RECONCILE_GRACE_MS = 5 * 60 * 1000;
const RETENTION_DAYS = 30; // fallback only — the policy row governs (§5.1)
const TEST_RETENTION_DAYS = 7; // §5.5 test-artefact max lifetime (a rule, not the policy row)
const MEASUREMENT_METHOD_VERSION_COLUMN = 1; // §9 coarse column; envelope carries the version string
// ponytail ceiling (design §11 risk 5): measurement PCM is accumulated
// in memory; ~4.5 MB at 16 kHz/16-bit ≈ 2.3 minutes of audio. Beyond the
// cap, accumulation stops and the header discloses captured seconds — a
// streaming aggregator is the pre-activation upgrade path.
const MEASUREMENT_PCM_CAP_BYTES = 4_500_000;

const STOP_REASONS = Object.freeze([
	'session_end',
	'flag_off',
	'consent_withdrawn',
	'consent_check_failed',
	'storage_failed',
	'dek_unavailable',
	'role_flip',
	'job_gone',
	'concurrency_cap',
	'worker_shutdown',
]);

// ─── Structured log (§6.4 + D-3) ────────────────────────────────────────────

const LOG_EVENTS = Object.freeze([
	'capture_decision',
	'capture_started',
	'capture_stopped',
	'chunk_persisted',
	'chunk_dropped',
	'flag_transition',
	'watchdog_teardown',
	'reconcile',
	'purge',
	'stats',
]);
const PERMITTED_LOG_FIELDS = Object.freeze([
	'ts',
	'event',
	'flag_state',
	'scope',
	'env',
	'session_id',
	'counters',
	'stop_reason',
	'counts',
	'gate_code',
]);

let logSink = (line) => console.log(JSON.stringify(line));
function _setLogSink(fn) {
	logSink = typeof fn === 'function' ? fn : (line) => console.log(JSON.stringify(line));
}

function emitLog(event, fields = {}) {
	if (!LOG_EVENTS.includes(event)) {
		throw new Error(`observerCapture.emitLog: unknown event "${event}"`);
	}
	const line = { ts: new Date().toISOString(), event };
	for (const key of PERMITTED_LOG_FIELDS) {
		if (key === 'ts' || key === 'event') continue;
		if (fields[key] === undefined) continue;
		if (key === 'flag_state') {
			// §6.4 enum is 'on' | 'off' — call sites pass booleans.
			line[key] = fields[key] ? 'on' : 'off';
		} else if (key === 'counters' || key === 'counts') {
			// Counts only, enforced by VALUE not just by field name
			// (security review minor 4): non-numeric entries are dropped,
			// so nothing (IDs, keys, text) can ride inside a counts object.
			const clean = {};
			for (const [k, v] of Object.entries(fields[key] || {})) {
				if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
			}
			line[key] = clean;
		} else {
			line[key] = fields[key];
		}
	}
	logSink(line);
	return line;
}

// ─── §8.1 counters ──────────────────────────────────────────────────────────

function createCaptureCounters() {
	return {
		streamsOpened: 0,
		framesReceived: 0,
		bytesBuffered: 0,
		chunksPersisted: 0,
		chunksDropped: 0,
		registryRowsWritten: 0,
		asrInvocations: 0,
		measurementWrites: 0,
		outcomeRowsWritten: 0,
	};
}

// ─── Legal-hold seam (P-10) ─────────────────────────────────────────────────

/**
 * Legal-hold check consulted by EVERY purge/deletion path in this module
 * (and by the retention extensions in services/euComplianceService.js).
 * No hold mechanism exists in the product today — holds arrive with
 * #799/G-1. Until then this seam returns false; when holds land, this is
 * the single function that learns about them, and every caller already
 * skips + counts held artefacts instead of deleting them.
 */
async function isLegalHoldActive({ candidateId, sessionId } = {}) {
	void candidateId;
	void sessionId;
	return false;
}

// ─── Lock discipline (§3.2) ─────────────────────────────────────────────────

async function acquireCandidateLock(client, candidateId) {
	await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [String(candidateId)]);
}

function ledgerFileUrl(prefixedKey) {
	return `/api/files/${encodeURIComponent(prefixedKey)}`;
}

async function insertDeletionLedgerRow(queryable, { candidateId, prefixedKey }) {
	await queryable.query(
		`INSERT INTO pending_storage_deletions (user_id, file_url, storage_type, status, source_family)
		 VALUES ($1, $2, 'r2', 'pending', 'observer_audio')`,
		[candidateId, ledgerFileUrl(prefixedKey)],
	);
}

// ─── Chunk persistence (§4.4) ───────────────────────────────────────────────

/**
 * Persist one accumulated chunk via the intent-first protocol.
 * @returns {Promise<{persisted: boolean, reason?: string, key?: string}>}
 *   reason ∈ 'intent_failed' | 'storage_failed' | 'dek_unavailable' |
 *   'gate:<kind>' — never throws for storage/gate failures (the session
 *   layer decides whether to continue or stop); DOES throw on programmer
 *   error (missing ids).
 */
async function persistChunk({
	sessionId,
	candidateId,
	chunkIndex,
	pcmBuffer,
	sampleRate,
	scope,
	isTest,
	jobOriginEnv,
	counters,
	pool = db,
}) {
	if (sessionId == null || candidateId == null || chunkIndex == null) {
		throw new Error('observerCapture.persistChunk: sessionId, candidateId, chunkIndex are required');
	}
	if (!Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0) {
		if (counters) counters.chunksDropped++;
		return { persisted: false, reason: 'storage_failed' };
	}

	// Pre-flight (T8b): a destroyed DEK can never encrypt again — refuse
	// BEFORE the intent insert, so a capture attempt against an erased
	// candidate writes zero rows (no pending intent for the reconciler
	// to retire, no resurrection path). Best-effort: if the check itself
	// errors, the encrypt path still classifies the failure at step 2.
	try {
		const { rows } = await pool.query(
			`SELECT destroyed_at FROM candidate_data_keys WHERE candidate_id = $1`,
			[candidateId],
		);
		if (rows[0]?.destroyed_at) {
			if (counters) counters.chunksDropped++;
			return { persisted: false, reason: 'dek_unavailable' };
		}
	} catch { /* fall through to the intent-first protocol */ }

	const bareKey = store.generateChunkKey(scope);

	// Step 1 — intent tx (committed before any storage call).
	let client;
	try {
		client = await pool.connect();
		await client.query('BEGIN');
		// Retention comes from the POLICY ROW, not the literal (§5.1, DB
		// review M6): Lex/Sumanth can shorten it without a code change.
		// The constant is only the fallback when the row is absent.
		const { rows: policyRows } = await client.query(
			`SELECT retention_days FROM data_retention_policies WHERE data_type = 'observer_audio'`,
		);
		const retentionDays = policyRows[0]?.retention_days ?? RETENTION_DAYS;
		await client.query(
			`INSERT INTO recording_objects
			   (object_key, interview_id, candidate_id, object_type, registration_state, expires_at)
			 VALUES ($1, $2, $3, 'observer_audio', 'pending', NOW() + ($4 || ' days')::interval)`,
			[bareKey, sessionId, candidateId, String(retentionDays)],
		);
		await client.query(
			`INSERT INTO observer_audio_chunks
			   (interview_session_id, candidate_id, chunk_index, object_key, byte_size, sample_rate, is_test)
			 VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
			[sessionId, candidateId, chunkIndex, bareKey, sampleRate, !!isTest],
		);
		await client.query('COMMIT');
		if (counters) counters.registryRowsWritten++;
	} catch (err) {
		try { await client?.query('ROLLBACK'); } catch { /* already closed */ }
		if (counters) counters.chunksDropped++;
		emitLog('chunk_dropped', { scope, session_id: sessionId });
		return { persisted: false, reason: 'intent_failed' };
	} finally {
		client?.release?.();
	}

	// Step 2 — encrypt → PUT.
	let put;
	try {
		put = await store.putEncryptedChunkAtKey({ pcmBuffer, candidateId, sessionId, chunkIndex, bareKey });
	} catch (err) {
		if (counters) counters.chunksDropped++;
		emitLog('chunk_dropped', { scope, session_id: sessionId });
		// DEK destroyed mid-session (erasure racing capture) is its own stop
		// reason (§3.6 step 6); everything else is a storage failure. The
		// pending intent row is left for the reconciler — by design.
		if (/destroyed/i.test(err?.message || '')) return { persisted: false, reason: 'dek_unavailable' };
		return { persisted: false, reason: 'storage_failed' };
	}

	// Step 3 — confirm tx under the candidate lock, with gate re-checks.
	let confirmClient;
	try {
		confirmClient = await pool.connect();
		await confirmClient.query('BEGIN');
		await acquireCandidateLock(confirmClient, candidateId);
		const { rows: jobRows } = await confirmClient.query(
			`SELECT id, origin_env FROM observer_jobs WHERE interview_session_id = $1`,
			[sessionId],
		);
		if (!jobRows[0]) throw Object.assign(new Error('job gone'), { gateKind: 'job_gone' });
		const recheck = await recheckCaptureGate({
			sessionId,
			candidateId,
			scope,
			jobOriginEnv: jobRows[0].origin_env,
			queryable: confirmClient,
		});
		if (!recheck.ok) throw Object.assign(new Error('gate recheck failed'), { gateKind: recheck.kind, gateCode: recheck.gateCode });
		// RowCounts are checked (DB review m8): if the reconciler already
		// retired this intent (only possible when the PUT stalled past
		// the 5-minute grace), the UPDATEs match nothing — that must fail
		// the confirm (→ compensating delete) rather than report a
		// persisted chunk whose rows no longer exist.
		const regUpdate = await confirmClient.query(
			`UPDATE recording_objects SET registration_state = 'confirmed', object_key = $2 WHERE object_key = $1`,
			[bareKey, put.key],
		);
		const chunkUpdate = await confirmClient.query(
			`UPDATE observer_audio_chunks SET byte_size = $2, object_key = $3 WHERE object_key = $1`,
			[bareKey, put.byteSize, put.key],
		);
		if (regUpdate.rowCount === 0 || chunkUpdate.rowCount === 0) {
			throw Object.assign(new Error('intent rows retired before confirm'), { gateKind: 'check_failed' });
		}
		await confirmClient.query('COMMIT');
		if (counters) {
			counters.chunksPersisted++;
		}
		emitLog('chunk_persisted', { scope, session_id: sessionId });
		return { persisted: true, key: put.key };
	} catch (err) {
		try { await confirmClient?.query('ROLLBACK'); } catch { /* already closed */ }
		// Compensating delete; on failure the ledger guarantees deletion.
		try {
			await store.deleteObserverAudioObject(put.key);
		} catch {
			try {
				await insertDeletionLedgerRow(pool, { candidateId, prefixedKey: put.key });
			} catch { /* reconciler + retention remain as backstops */ }
		}
		if (counters) counters.chunksDropped++;
		emitLog('chunk_dropped', {
			scope,
			session_id: sessionId,
			gate_code: err.gateCode || undefined,
		});
		return { persisted: false, reason: err.gateKind ? `gate:${err.gateKind}` : 'storage_failed', gateCode: err.gateCode };
	} finally {
		confirmClient?.release?.();
		// jobOriginEnv (caller's copy) is intentionally not trusted here:
		// the confirm tx re-reads the job's stamp under the lock (§3.2 G-ENV).
		void jobOriginEnv;
	}
}

// ─── Measurement persistence (§4.3) ─────────────────────────────────────────

async function persistSpeechMeasurements({
	sessionId,
	candidateId,
	measurements,
	methodVersion,
	isTest,
	scope,
	state = 'final',
	counters,
	pool = db,
	requireGate = true,
}) {
	let client;
	try {
		client = await pool.connect();
		await client.query('BEGIN');
		await acquireCandidateLock(client, candidateId);
		// Erasure guard BEFORE any encryption (security review M-4):
		// encryptWithDEK get-or-creates key material, so it must never
		// run for an erased candidate — the tombstone check happens
		// inside the lock, ahead of the encrypt, and discarded writes
		// (job gone / gate closed) mint nothing.
		const { rows: dekState } = await client.query(
			`SELECT destroyed_at FROM candidate_data_keys WHERE candidate_id = $1`,
			[candidateId],
		);
		if (dekState[0]?.destroyed_at) {
			await client.query('ROLLBACK');
			return { written: false, reason: 'dek_unavailable' };
		}
		const { rows: jobRows } = await client.query(
			`SELECT id, origin_env FROM observer_jobs WHERE interview_session_id = $1`,
			[sessionId],
		);
		if (!jobRows[0]) {
			await client.query('ROLLBACK');
			return { written: false, reason: 'job_gone' };
		}
		// Gate re-check (§3.2) protects COMPUTED measurements. The teardown
		// absence record (all-missing, e.g. CAPTURE_INCOMPLETE) discloses and
		// collects nothing, and design §7.3/T5 require it to be written even
		// when the gate has already closed — callers pass requireGate=false
		// for that payload only.
		if (requireGate) {
			const recheck = await recheckCaptureGate({
				sessionId,
				candidateId,
				scope,
				jobOriginEnv: jobRows[0].origin_env,
				queryable: client,
			});
			if (!recheck.ok) {
				await client.query('ROLLBACK');
				return { written: false, reason: `gate:${recheck.kind}`, gateCode: recheck.gateCode };
			}
		}
		// Encrypt only now — lock held, job verified, gate re-checked,
		// erasure tombstone clear (security review M-4 reordering).
		const plaintext = Buffer.from(JSON.stringify(measurements), 'utf8');
		const { ciphertext, iv, tag } = await biometricCrypto.encryptWithDEK(
			plaintext,
			candidateId,
			store.measurementAAD(candidateId, sessionId),
		);
		plaintext.fill(0);
		const envelope = packEnvelope({ iv, tag, ciphertext });
		await client.query(
			`INSERT INTO observer_speech_measurements
			   (interview_session_id, candidate_id, measurements_envelope, method_version, state, is_test)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (interview_session_id) DO UPDATE SET
			   measurements_envelope = EXCLUDED.measurements_envelope,
			   method_version = EXCLUDED.method_version,
			   state = EXCLUDED.state,
			   updated_at = NOW()`,
			// The coarse method_version COLUMN is §9's integer method
			// generation; the full engine version string lives in the
			// envelope header (DB review M7).
			[sessionId, candidateId, envelope, MEASUREMENT_METHOD_VERSION_COLUMN, state, !!isTest],
		);
		await client.query('COMMIT');
		if (counters) counters.measurementWrites++;
		return { written: true };
	} catch (err) {
		try { await client?.query('ROLLBACK'); } catch { /* already closed */ }
		throw err;
	} finally {
		client?.release?.();
	}
}

// ─── Outcome record (§8.5) ──────────────────────────────────────────────────

async function writeCaptureOutcome({
	sessionId,
	candidateId,
	scope,
	isTest = false,
	cohortAllowlistVersion = null,
	captureGapRatio = null,
	counters,
	audioSecondsCaptured,
	stopReason,
	startedAt,
	queryable = db,
}) {
	if (!STOP_REASONS.includes(stopReason)) {
		throw new Error(`observerCapture.writeCaptureOutcome: unknown stop_reason "${stopReason}"`);
	}
	// §5.2 lock discipline (§8.5, DB review M5): the outcome write takes
	// the same per-candidate advisory lock as chunk/measurement persist,
	// erasure, and the withdrawal sweeper — and inside the lock it refuses
	// to resurrect an accountability row for a candidate whose DEK
	// erasure destroyed (erasePersonalData deletes outcome rows under
	// this lock; a teardown landing afterwards must not recreate one).
	const client = typeof queryable.connect === 'function' ? await queryable.connect() : queryable;
	try {
		await client.query('BEGIN');
		await acquireCandidateLock(client, candidateId);
		const { rows: dekRows } = await client.query(
			`SELECT destroyed_at FROM candidate_data_keys WHERE candidate_id = $1`,
			[candidateId],
		);
		if (dekRows[0]?.destroyed_at) {
			await client.query('ROLLBACK');
			return { written: false, reason: 'candidate_erased' };
		}
		await client.query(
			`INSERT INTO observer_capture_outcomes
			   (interview_session_id, candidate_id, scope, is_test, cohort_allowlist_version,
			    chunks_persisted, chunks_dropped, audio_seconds_captured, capture_gap_ratio,
			    stop_reason, started_at, stopped_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
			 ON CONFLICT (interview_session_id) DO UPDATE SET
			   chunks_persisted = EXCLUDED.chunks_persisted,
			   chunks_dropped = EXCLUDED.chunks_dropped,
			   audio_seconds_captured = EXCLUDED.audio_seconds_captured,
			   capture_gap_ratio = EXCLUDED.capture_gap_ratio,
			   stop_reason = EXCLUDED.stop_reason,
			   stopped_at = NOW()`,
			[
				sessionId,
				candidateId,
				scope,
				!!isTest,
				cohortAllowlistVersion ?? null,
				counters?.chunksPersisted ?? 0,
				counters?.chunksDropped ?? 0,
				audioSecondsCaptured ?? 0,
				captureGapRatio ?? null,
				stopReason,
				startedAt,
			],
		);
		await client.query('COMMIT');
		if (counters) counters.outcomeRowsWritten++;
		return { written: true };
	} catch (err) {
		try { await client.query('ROLLBACK'); } catch { /* already closed */ }
		throw err;
	} finally {
		if (client !== queryable && typeof client.release === 'function') client.release();
	}
}

// ─── Reconciler (§4.4) ──────────────────────────────────────────────────────

async function reconcileObserverAudioIntents({ queryable = db, now = new Date(), graceMs = RECONCILE_GRACE_MS } = {}) {
	const cutoff = new Date(now.getTime() - graceMs);
	const { rows } = await queryable.query(
		`SELECT object_key, candidate_id FROM recording_objects
		 WHERE object_type = 'observer_audio' AND registration_state = 'pending'
		   AND deleted_at IS NULL AND created_at < $1`,
		[cutoff],
	);
	let objectsDeleted = 0;
	let rowsRetired = 0;
	let ledgerRowsWritten = 0;
	for (const row of rows) {
		const bareKey = row.object_key;
		// Per-row locked transaction (security review M-1): the confirm
		// path holds the candidate advisory lock while it flips a row to
		// 'confirmed' — retirement must serialise with it and re-verify
		// the row is STILL pending under the lock, or a stalled confirm
		// and the reconciler can conspire to orphan a live object.
		const client = typeof queryable.connect === 'function' ? await queryable.connect() : queryable;
		try {
			if (client !== queryable) await client.query('BEGIN');
			if (client !== queryable) await acquireCandidateLock(client, row.candidate_id);
			const { rows: current } = await client.query(
				`SELECT registration_state, deleted_at FROM recording_objects WHERE object_key = $1`,
				[bareKey],
			);
			if (!current[0] || current[0].registration_state !== 'pending' || current[0].deleted_at) {
				if (client !== queryable) await client.query('COMMIT');
				continue; // confirmed or already gone — not ours to retire
			}
			// Pending rows carry the bare key: the object may sit under
			// either provider prefix (PUT fallback order), so try both —
			// deletes are idempotent (NoSuchKey = success).
			let deleted = true;
			for (const prefix of ['r2', 'b2']) {
				try {
					const r = await deleteStorageObject(`${prefix}/${bareKey}`);
					if (!r.deleted) deleted = false;
				} catch {
					deleted = false;
				}
			}
			if (deleted) {
				objectsDeleted++;
			} else {
				// Ledger both candidate prefixes so Phase 2/sweeper
				// retries the right objects; skip if a pending row
				// already exists.
				for (const prefix of ['r2', 'b2']) {
					const prefixedKey = `${prefix}/${bareKey}`;
					const { rows: existing } = await client.query(
						`SELECT id FROM pending_storage_deletions WHERE file_url = $1 AND status = 'pending'`,
						[ledgerFileUrl(prefixedKey)],
					);
					if (!existing[0]) {
						await insertDeletionLedgerRow(client, { candidateId: row.candidate_id, prefixedKey });
						ledgerRowsWritten++;
					}
				}
			}
			await client.query(`DELETE FROM observer_audio_chunks WHERE object_key = $1`, [bareKey]);
			await client.query(
				`DELETE FROM recording_objects WHERE object_key = $1 AND registration_state = 'pending'`,
				[bareKey],
			);
			rowsRetired++;
			if (client !== queryable) await client.query('COMMIT');
		} catch (err) {
			if (client !== queryable) {
				try { await client.query('ROLLBACK'); } catch { /* already closed */ }
			}
			throw err;
		} finally {
			if (client !== queryable && typeof client.release === 'function') client.release();
		}
	}
	if (rows.length > 0) {
		emitLog('reconcile', {
			counts: { intents_found: rows.length, objects_deleted: objectsDeleted, rows_retired: rowsRetired, ledger_rows_written: ledgerRowsWritten },
		});
	}
	return { intentsFound: rows.length, objectsDeleted, rowsRetired, ledgerRowsWritten };
}

// ─── Test-artefact purge (§5.1) ─────────────────────────────────────────────

async function purgeTestObserverAudio({ dryRun = true, queryable = db, now = new Date() } = {}) {
	const cutoff = new Date(now.getTime() - TEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	const { rows } = await queryable.query(
		`SELECT object_key, interview_session_id, candidate_id FROM observer_audio_chunks
		 WHERE is_test = true AND captured_at < $1`,
		[cutoff],
	);
	let objectsDeleted = 0;
	let heldSkips = 0;
	for (const row of rows) {
		if (await isLegalHoldActive({ candidateId: row.candidate_id, sessionId: row.interview_session_id })) {
			heldSkips++;
			continue;
		}
		if (!dryRun) {
			await store.deleteObserverAudioObject(row.object_key);
			await queryable.query(`DELETE FROM observer_audio_chunks WHERE object_key = $1`, [row.object_key]);
			await queryable.query(`UPDATE recording_objects SET deleted_at = NOW() WHERE object_key = $1`, [row.object_key]);
		}
		objectsDeleted++;
	}
	// Measurements + outcomes: per-row, hold-checked (§5.5 names all
	// three families; privacy review A-5 — a bulk DELETE cannot consult
	// the hold seam per artefact).
	let measurementRowsDeleted = 0;
	let outcomeRowsDeleted = 0;
	const { rows: measRows } = await queryable.query(
		`SELECT id, interview_session_id, candidate_id FROM observer_speech_measurements
		 WHERE is_test = true AND created_at < $1`,
		[cutoff],
	);
	for (const row of measRows) {
		if (await isLegalHoldActive({ candidateId: row.candidate_id, sessionId: row.interview_session_id })) {
			heldSkips++;
			continue;
		}
		if (!dryRun) {
			await queryable.query(`DELETE FROM observer_speech_measurements WHERE id = $1`, [row.id]);
		}
		measurementRowsDeleted++;
	}
	const { rows: outcomeRows } = await queryable.query(
		`SELECT interview_session_id, candidate_id FROM observer_capture_outcomes
		 WHERE is_test = true AND started_at < $1`,
		[cutoff],
	);
	for (const row of outcomeRows) {
		if (await isLegalHoldActive({ candidateId: row.candidate_id, sessionId: row.interview_session_id })) {
			heldSkips++;
			continue;
		}
		if (!dryRun) {
			await queryable.query(`DELETE FROM observer_capture_outcomes WHERE interview_session_id = $1`, [row.interview_session_id]);
		}
		outcomeRowsDeleted++;
	}
	emitLog('purge', { counts: { test_objects: objectsDeleted, held_skips: heldSkips, dry_run: dryRun ? 1 : 0 } });
	return { objectsDeleted, measurementRowsDeleted, outcomeRowsDeleted, heldSkips, dryRun };
}

// ─── Withdrawal sweeper (§5.4) ──────────────────────────────────────────────

/**
 * Backstop for sessions whose worker died before the watchdog could act:
 * find sessions with a withdrawn capture-relevant receipt (observer_capture
 * or biometric) that still have surviving capture artefacts, and queue
 * those artefacts for deletion through the migration-252 ledger. The DEK
 * is NOT destroyed by withdrawal (§5.4).
 */
async function sweepWithdrawnCaptureArtefacts({ pool = db } = {}) {
	const { rows: sessions } = await pool.query(
		`SELECT DISTINCT c.interview_session_id, c.candidate_id
		 FROM consent_receipts c
		 WHERE c.consent_type IN ('observer_capture', 'biometric')
		   AND c.withdrawn_at IS NOT NULL
		   AND EXISTS (SELECT 1 FROM observer_audio_chunks a WHERE a.interview_session_id = c.interview_session_id)
		`,
	);
	let chunksQueued = 0;
	let measurementsDeleted = 0;
	let heldSkips = 0;
	for (const s of sessions) {
		// §5.5 names the withdrawal sweeper explicitly: the hold seam is
		// consulted per session BEFORE anything is queued (privacy A-5).
		if (await isLegalHoldActive({ candidateId: s.candidate_id, sessionId: s.interview_session_id })) {
			heldSkips++;
			continue;
		}
		let client;
		try {
			client = await pool.connect();
			await client.query('BEGIN');
			await acquireCandidateLock(client, s.candidate_id);
			const { rows: chunks } = await client.query(
				`SELECT object_key FROM observer_audio_chunks WHERE interview_session_id = $1`,
				[s.interview_session_id],
			);
			for (const chunk of chunks) {
				const { rows: existing } = await client.query(
					`SELECT id FROM pending_storage_deletions WHERE file_url = $1 AND status = 'pending'`,
					[ledgerFileUrl(chunk.object_key)],
				);
				if (!existing[0]) {
					await insertDeletionLedgerRow(client, { candidateId: s.candidate_id, prefixedKey: chunk.object_key });
					chunksQueued++;
				}
			}
			await client.query(`DELETE FROM observer_audio_chunks WHERE interview_session_id = $1`, [s.interview_session_id]);
			const m = await client.query(`DELETE FROM observer_speech_measurements WHERE interview_session_id = $1`, [s.interview_session_id]);
			measurementsDeleted += m.rowCount || 0;
			await client.query(
				`UPDATE recording_objects SET deleted_at = NOW()
				 WHERE interview_id = $1 AND object_type = 'observer_audio' AND deleted_at IS NULL`,
				[s.interview_session_id],
			);
			await client.query('COMMIT');
		} catch (err) {
			try { await client?.query('ROLLBACK'); } catch { /* already closed */ }
			throw err;
		} finally {
			client?.release?.();
		}
	}
	return { sessions: sessions.length, chunksQueued, measurementsDeleted, heldSkips };
}

// ─── Resampling (§3.4) ──────────────────────────────────────────────────────

/**
 * Resample PCM16 mono to the measurement rate. Integer ratios use block
 * averaging (48k→16k is the production case); other ratios use linear
 * interpolation. Returns a new Buffer; the input is untouched.
 */
function resamplePcm16(buffer, fromRate, toRate = MEASUREMENT_SAMPLE_RATE) {
	if (fromRate === toRate) return Buffer.from(buffer);
	const inSamples = Math.floor(buffer.length / 2);
	if (inSamples === 0) return Buffer.alloc(0);
	const ratio = fromRate / toRate;
	const outLength = Math.floor(inSamples / ratio);
	const out = Buffer.alloc(outLength * 2);
	if (Number.isInteger(ratio)) {
		for (let i = 0; i < outLength; i++) {
			let sum = 0;
			for (let j = 0; j < ratio; j++) sum += buffer.readInt16LE((i * ratio + j) * 2);
			out.writeInt16LE(Math.round(sum / ratio), i * 2);
		}
	} else {
		for (let i = 0; i < outLength; i++) {
			const pos = i * ratio;
			const idx = Math.floor(pos);
			const frac = pos - idx;
			const a = buffer.readInt16LE(idx * 2);
			const b = idx + 1 < inSamples ? buffer.readInt16LE((idx + 1) * 2) : a;
			out.writeInt16LE(Math.round(a + (b - a) * frac), i * 2);
		}
	}
	return out;
}

// ─── Capture session runtime (§3.4/§3.6/§3.7) ──────────────────────────────

class CaptureSession {
	constructor({ sessionId, candidateId, jobId, scope, isTest, cohortAllowlistVersion = null, jobOriginEnv, counters, pool = db, startedAt = new Date() }) {
		this.cohortAllowlistVersion = cohortAllowlistVersion;
		this.sessionId = sessionId;
		this.candidateId = candidateId;
		this.jobId = jobId;
		this.scope = scope;
		this.isTest = !!isTest;
		this.jobOriginEnv = jobOriginEnv;
		this.counters = counters;
		this.pool = pool;
		this.startedAt = startedAt;
		this.state = 'capturing'; // capturing → stopping → stopped (one-way)
		this.stopReason = null;
		this.boundIdentity = null;
		this.nativeRate = null;
		this.pendingBuffers = [];
		this.pendingSeconds = 0;
		this.nextChunkIndex = 0;
		this.receivedSeconds = 0;
		this.capturedSeconds = 0;
		this.consecutiveStorageFailures = 0;
		this.flushInFlight = null;
		this.measurementBuffers = [];
		this.measurementBytes = 0;
		this.measurementTruncated = false;
	}

	/** Bind the candidate identity resolved at Gate 2 (§3.5). */
	bindIdentity(identity) {
		if (identity && !this.boundIdentity) this.boundIdentity = identity;
	}

	/**
	 * Verify a track's identity at chunk persist (§3.5): a different
	 * candidate identity than the bound one is a role flip.
	 * @returns {boolean} false ⇒ caller must abort with role_flip
	 */
	verifyIdentity(identity) {
		// Pure and fail-closed (security review B-1): verification NEVER
		// binds. Binding happens exactly once, explicitly, at capture
		// start, to the identity the worker derived from the session's
		// candidate_id — an unbound session verifies NOTHING, so the
		// first track to publish (routinely the interviewer's) can never
		// poison the binding and be captured as the candidate.
		return !!identity && !!this.boundIdentity && identity === this.boundIdentity;
	}

	/**
	 * Accept one audio frame (PCM16 at the track's native rate).
	 * @returns {Promise<{stop?: string}>} stop set when capture must end
	 */
	async onFrame(pcmBuffer, nativeRate) {
		if (this.state !== 'capturing') return {};
		if (this.nativeRate == null) this.nativeRate = nativeRate;
		const seconds = pcmBuffer.length / 2 / nativeRate;
		this.counters.framesReceived++;
		this.counters.bytesBuffered += pcmBuffer.length;
		this.receivedSeconds += seconds;

		// Measurement accumulation (16 kHz), capped — header discloses it.
		const resampled = resamplePcm16(pcmBuffer, nativeRate);
		if (!this.measurementTruncated) {
			if (this.measurementBytes + resampled.length <= MEASUREMENT_PCM_CAP_BYTES) {
				this.measurementBuffers.push(resampled);
				this.measurementBytes += resampled.length;
			} else {
				this.measurementTruncated = true;
			}
		}

		this.pendingBuffers.push(pcmBuffer);
		this.pendingSeconds += seconds;
		if (this.pendingSeconds >= CHUNK_SECONDS && !this.flushInFlight) {
			this.flushInFlight = this.flushChunk().finally(() => { this.flushInFlight = null; });
			return this.flushInFlight;
		}
		if (this.pendingSeconds >= CHUNK_FORCE_FLUSH_SECONDS) {
			return this.flushChunk();
		}
		return {};
	}

	/** Persist the accumulated pending audio as the next chunk. */
	async flushChunk() {
		if (this.pendingBuffers.length === 0) return {};
		const buffers = this.pendingBuffers;
		const seconds = this.pendingSeconds;
		this.pendingBuffers = [];
		this.pendingSeconds = 0;
		const pcm = Buffer.concat(buffers);
		const chunkIndex = this.nextChunkIndex++;
		const result = await persistChunk({
			sessionId: this.sessionId,
			candidateId: this.candidateId,
			chunkIndex,
			pcmBuffer: pcm,
			sampleRate: this.nativeRate,
			scope: this.scope,
			isTest: this.isTest,
			jobOriginEnv: this.jobOriginEnv,
			counters: this.counters,
			pool: this.pool,
		});
		pcm.fill(0);
		if (result.persisted) {
			this.capturedSeconds += seconds;
			this.consecutiveStorageFailures = 0;
			return {};
		}
		if (result.reason === 'dek_unavailable') return { stop: 'dek_unavailable' };
		if (result.reason && result.reason.startsWith('gate:')) {
			const kind = result.reason.slice(5);
			if (kind === 'withdrawn') return { stop: 'consent_withdrawn' };
			if (kind === 'flag_off') return { stop: 'flag_off' };
			if (kind === 'job_gone') return { stop: 'job_gone' };
			return { stop: 'consent_check_failed' };
		}
		this.consecutiveStorageFailures++;
		if (this.consecutiveStorageFailures >= MAX_CONSECUTIVE_STORAGE_FAILURES) {
			return { stop: 'storage_failed' };
		}
		return {};
	}

	get captureGapRatio() {
		if (this.receivedSeconds <= 0) return 0;
		return Math.max(0, 1 - this.capturedSeconds / this.receivedSeconds);
	}

	/**
	 * One-way teardown (§3.6 step 10): flush or discard the partial chunk,
	 * write measurements (or the CAPTURE_INCOMPLETE set), write the outcome
	 * row, zero all buffers. Idempotent — a second call is a no-op.
	 */
	async finalize(stopReason) {
		if (this.state === 'stopped') return;
		this.state = 'stopping';
		this.stopReason = stopReason;
		try {
			if (this.flushInFlight) {
				try { await this.flushInFlight; } catch { /* outcome recorded below */ }
			}
			if (stopReason === 'session_end' && this.pendingBuffers.length > 0) {
				await this.flushChunk();
			}
			// Any remaining partial audio is discarded, never persisted.
			for (const b of this.pendingBuffers) b.fill(0);
			this.pendingBuffers = [];
			this.pendingSeconds = 0;

			const gapRatio = this.captureGapRatio;
			if (stopReason !== 'consent_withdrawn') {
				let measurements;
				let computedMeasurements = false;
				if (stopReason === 'session_end' && this.measurementBytes > 0) {
					const pcm = Buffer.concat(this.measurementBuffers);
					measurements = await speech.computeSpeechMeasurements(pcm, MEASUREMENT_SAMPLE_RATE, {
						captureGapRatio: gapRatio,
						audioSecondsCaptured: this.capturedSeconds,
						corpusRef: `session:${this.sessionId}`,
						onAsrInvocation: () => { this.counters.asrInvocations++; },
					});
					pcm.fill(0);
					computedMeasurements = true;
				} else {
					measurements = speech.buildMissingMeasurementSet(
						stopReason === 'session_end' ? 'NO_SPEECH' : 'CAPTURE_INCOMPLETE',
						{ captureGapRatio: gapRatio, audioSecondsCaptured: this.capturedSeconds, truncated: this.measurementTruncated, corpusRef: `session:${this.sessionId}` },
					);
				}
				await persistSpeechMeasurements({
					sessionId: this.sessionId,
					candidateId: this.candidateId,
					measurements,
					methodVersion: speech.METHOD_VERSION,
					isTest: this.isTest,
					scope: this.scope,
					state: 'final',
					counters: this.counters,
					pool: this.pool,
					requireGate: computedMeasurements,
				});
			}
			await writeCaptureOutcome({
				sessionId: this.sessionId,
				candidateId: this.candidateId,
				scope: this.scope,
				isTest: this.isTest,
				cohortAllowlistVersion: this.cohortAllowlistVersion,
				captureGapRatio: this.captureGapRatio,
				counters: this.counters,
				audioSecondsCaptured: this.capturedSeconds,
				stopReason,
				startedAt: this.startedAt,
				queryable: this.pool,
			});
			emitLog('capture_stopped', {
				scope: this.scope,
				env: resolveEnvIdentity(),
				session_id: this.sessionId,
				stop_reason: stopReason,
				counters: { ...this.counters },
			});
		} finally {
			for (const b of this.measurementBuffers) b.fill(0);
			this.measurementBuffers = [];
			this.measurementBytes = 0;
			this.state = 'stopped';
		}
	}
}

module.exports = {
	CHUNK_SECONDS,
	CHUNK_FORCE_FLUSH_SECONDS,
	MEASUREMENT_SAMPLE_RATE,
	MAX_CONSECUTIVE_STORAGE_FAILURES,
	RECONCILE_GRACE_MS,
	STOP_REASONS,
	LOG_EVENTS,
	PERMITTED_LOG_FIELDS,
	emitLog,
	_setLogSink,
	createCaptureCounters,
	isLegalHoldActive,
	persistChunk,
	persistSpeechMeasurements,
	writeCaptureOutcome,
	reconcileObserverAudioIntents,
	purgeTestObserverAudio,
	sweepWithdrawnCaptureArtefacts,
	resamplePcm16,
	CaptureSession,
	// exported for tests
	_ledgerFileUrl: ledgerFileUrl,
};
