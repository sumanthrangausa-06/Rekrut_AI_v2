/**
 * Diarization Worker — skeleton (S-D04, #1906; Architecture §3.4, ADR-D02)
 *
 * Polls the diarization_jobs table (lib/diarizationJobs.js — the
 * observer_jobs sibling from S-D03) and runs each claimed job through
 * the claim-time consent gate before anything else happens.
 *
 * Process model: standalone Node process (`node workers/diarization/
 * index.js`), mirroring workers/ai-observer/'s poll/claim pattern —
 * 5 s poll, 30 s heartbeat, 60 s stale-claim sweep (5 min threshold).
 * Concurrency 1: one job at a time per process.
 *
 * Enablement (BR-1): with DIARIZATION_ENABLED off (the default), poll()
 * claims nothing and the transcribe path enqueues nothing — recordings
 * behave exactly as they did before this feature existed (AC-1).
 *
 * Consent (BR-2/BR-3): the gate (lib/diarizationGate.js) is evaluated
 * live from the DB at claim time, BEFORE any audio is fetched and
 * before the engine runs, and repeated at write time immediately
 * before output would persist. A block cancels the job with the
 * structured reason `consent_blocked_at_claim:<CODE>` /
 * `consent_blocked_at_write:<CODE>` and sets the recording's
 * diarization_status to 'unavailable' (the §4 internal state for
 * consent-blocked outcomes, rendered to users identically to failed).
 *
 * Engine seam: S-D04 shipped a stub behind `runEngine(job) →
 * { speakerCount, turns }`; S-D05 (#1907) put the real engine behind
 * the same shape — fetch the recording's audio in memory (the same
 * livekitService paths the transcribe handler uses), decode + diarize
 * via lib/diarizationEngine.js, which spawns the per-job child
 * process (workers/diarization/engine-child.mjs) whose memory —
 * voice-print embeddings included — dies at exit (BR-4/BR-5).
 *
 * Persistence (S-D07, #1909 — supersedes S-D05 R1): behind the
 * write-time gate, the worker hands the engine output verbatim to
 * lib/transcriptStitch.persistStitch, which in ONE transaction
 * stores the diarization_runs row, sets segment speaker_numbers by
 * max overlap, flips diarization_status to 'complete' and completes
 * the job (§3.6). A stale generation's output is discarded there
 * (`superseded`); a stitch failure fails the job retryably and the
 * recording honestly stays/flips to 'failed' — never half-labelled.
 *
 * Failures (S-D05 R2): engine/fetch/decode errors are caught here,
 * classified (§3.5 taxonomy), and recorded via diarizationJobs.fail —
 * never thrown past processJob, never partially persisted.
 */

const diarizationJobs = require('../../lib/diarizationJobs');
const transcriptStitch = require('../../lib/transcriptStitch');
const diarizationEngine = require('../../lib/diarizationEngine');
const {
	evaluateDiarizationGate,
	evaluatePanelLeg,
	panelSnapshotsEqual,
	normalizePanelSnapshot,
} = require('../../lib/diarizationGate');
const { isDiarizationEnabled } = require('../../lib/diarizationFlag');
const db = require('../../lib/db');

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const SWEEPER_INTERVAL_MS = 60000;
const WORKER_ID = `diarization-worker-${process.pid}-${Date.now()}`;

/**
 * Fetch a recording's audio into memory — the same paths the
 * transcribe handler uses (server/routes/recordings.js): the GAP-A2
 * in-memory DEK decrypt for `.enc` recordings, the storage download
 * for legacy plaintext. No plaintext audio touches disk here either.
 * Required lazily: the livekit service is heavy and unit tests that
 * inject runEngine/fetchAudio never need it loaded.
 */
async function fetchRecordingAudio(recordingId) {
	const livekitService = require('../../server/services/livekit');
	const recording = await livekitService.findRecordingById(recordingId);
	if (!recording) return null;
	const storagePath = livekitService.decryptStoragePath(recording);
	if (!storagePath) return null;
	if (livekitService.isEncryptedRecording(recording, storagePath)) {
		return livekitService.fetchDecryptedRecording(recording).catch(() => null);
	}
	return livekitService.downloadRecordingAudio(storagePath);
}

/**
 * Real engine (S-D05): fetch audio in memory → decode + diarize in
 * the per-job child process. Embeddings never leave the child.
 * @returns {Promise<{speakerCount: number, turns: Array, engine: object}>}
 */
async function runRealEngine(job, overrides = {}) {
	const fetchAudio = overrides.fetchAudio || fetchRecordingAudio;
	const audio = await fetchAudio(job.recording_id);
	if (!audio || audio.length === 0) {
		throw new diarizationEngine.DiarizationEngineError(
			'engine_failed',
			`no audio fetched for recording ${job.recording_id}`,
		);
	}
	return diarizationEngine.diarizeAudio(audio, overrides.engineOptions || {});
}

/**
 * Stub engine (S-D04 seam, kept for tests that exercise the gate
 * without the vendor package). Its output carries no engine
 * provenance, so processJob persists no run row for it.
 * @returns {Promise<{speakerCount: number, turns: Array}>}
 */
async function runStubEngine(_job) {
	return { speakerCount: 0, turns: [] };
}

/**
 * Snapshot the current transcript generation for this job: the
 * segment ids the stitch's generation guard (§3.6.5) will compare
 * against at write time. Captured BEFORE the engine runs — a
 * re-transcription landing during the (multi-minute) engine run
 * replaces the segments, the id sets diverge, and the stale output
 * is discarded instead of landing on new text (FR-D03).
 */
async function readSegmentIds(recordingId) {
	const { rows } = await db.query(
		`SELECT id FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
		[recordingId],
	);
	return rows.map((r) => r.id);
}

async function setRecordingDiarizationStatus(recordingId, status) {
	await db.query(
		`UPDATE interview_recordings
		 SET diarization_status = $2, diarization_updated_at = NOW(), updated_at = NOW()
		 WHERE id = $1`,
		[recordingId, status],
	);
}

/**
 * Persist the claim-time gate provenance on the job row — governing
 * session + receipt (#1925) and, for S-D19 (#1956, §7 P5), the panel
 * snapshot, WRITE-ONCE (security S-2): the snapshot UPDATE is guarded
 * on panel_consent_snapshot IS NULL; a retry whose recomputed snapshot
 * differs from the stored one fails PANEL_SNAPSHOT_CONFLICT and never
 * overwrites it (a requeue creates a NEW job row instead). When a real
 * transaction client is available, the write runs in ONE transaction
 * under a per-event advisory lock (security C-5c), with the panel leg
 * re-evaluated on that client when verifyLive is set (processJob) —
 * so no decision flip can land between the check and the persisting
 * of what was checked. Unit doubles without .connect take the guarded
 * single-statement path on the pool interface.
 *
 * @returns {Promise<{ok: true} | {conflict: true} | {blocked: string}>}
 */
async function persistClaimProvenance(jobId, claimGate, { verifyLive = false } = {}) {
	const snapshot = claimGate.panelSnapshot || null;

	const guardedWrite = async (queryable) => {
		await queryable.query(
			`UPDATE diarization_jobs SET governing_session_id = $2, consent_receipt_id = $3, updated_at = NOW()
			 WHERE id = $1`,
			[jobId, claimGate.sessionId, claimGate.consentReceiptId],
		);
		if (!snapshot) return { ok: true };
		const upd = await queryable.query(
			`UPDATE diarization_jobs SET panel_consent_snapshot = $2, updated_at = NOW()
			 WHERE id = $1 AND panel_consent_snapshot IS NULL`,
			[jobId, JSON.stringify(snapshot)],
		);
		if (upd.rowCount === 0) {
			const existing = await queryable.query(
				`SELECT panel_consent_snapshot FROM diarization_jobs WHERE id = $1`,
				[jobId],
			);
			const stored = existing.rows[0]?.panel_consent_snapshot;
			const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
			if (!parsed || !panelSnapshotsEqual(parsed, snapshot)) return { conflict: true };
		}
		return { ok: true };
	};

	if (typeof db.connect !== 'function') {
		// #1950 M2: the no-client fallback (unit doubles) gets the SAME
		// guarded handling as the transactional path below and the
		// stitch path — a transient DB throw must not propagate out of
		// processJob and strand the job in `claimed` until the sweeper.
		// It becomes the structured blocked outcome, and processJob
		// cancels the job at claim.
		try {
			return await guardedWrite(db);
		} catch (err) {
			console.log(
				`[diarization] claim provenance persist failed for job ${jobId}: ${err.message}`,
			);
			return { blocked: 'PANEL_AGREEMENT_UNVERIFIABLE' };
		}
	}

	// #1950 M2 (review minor): the connect itself is inside the guard —
	// a pool-acquire failure gets the same structured blocked outcome
	// as any other persist failure, never a throw that strands the job.
	let client;
	try {
		client = await db.connect();
		await client.query('BEGIN');
		await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
			`panel-event:${claimGate.eventId}`,
		]);
		if (verifyLive) {
			const jobRes = await client.query(
				`SELECT recording_id FROM diarization_jobs WHERE id = $1`,
				[jobId],
			);
			const recordingId = jobRes.rows[0]?.recording_id;
			const recheck = await evaluatePanelLeg(recordingId, client);
			if (!recheck.allowed) {
				await client.query('ROLLBACK');
				return { blocked: recheck.code };
			}
			if (!panelSnapshotsEqual(recheck.panelSnapshot, snapshot)) {
				await client.query('ROLLBACK');
				return { conflict: true };
			}
		}
		const result = await guardedWrite(client);
		if (result.conflict) {
			await client.query('ROLLBACK');
			return result;
		}
		await client.query('COMMIT');
		return result;
	} catch (err) {
		if (client) await client.query('ROLLBACK').catch(() => {});
		// Fail-closed: provenance that cannot be persisted atomically
		// cannot authorize the claim.
		console.log(`[diarization] claim provenance persist failed for job ${jobId}: ${err.message}`);
		return { blocked: 'PANEL_AGREEMENT_UNVERIFIABLE' };
	} finally {
		if (client) client.release();
	}
}

/**
 * P6 write-time comparison (§7): the claim snapshot vs the write
 * evaluation. Returns the block code, or null when the snapshots agree.
 * Frozen-set divergence (set or hash) → PANEL_EXPECTED_SET_CHANGED;
 * any per-user tuple difference → PANEL_AGREEMENT_CHANGED (a flip
 * granted → declined → granted still differs in decided_at/record_id).
 */
function panelWriteComparisonCode(claimSnapshot, writeSnapshot) {
	if (!claimSnapshot) return null;
	if (!writeSnapshot) return 'PANEL_AGREEMENT_CHANGED';
	const a = normalizePanelSnapshot(claimSnapshot);
	const b = normalizePanelSnapshot(writeSnapshot);
	if (
		JSON.stringify(a.expected_user_ids) !== JSON.stringify(b.expected_user_ids) ||
		a.expected_hash !== b.expected_hash
	) {
		return 'PANEL_EXPECTED_SET_CHANGED';
	}
	if (JSON.stringify(a.decisions) !== JSON.stringify(b.decisions)) {
		return 'PANEL_AGREEMENT_CHANGED';
	}
	return null;
}

/**
 * Process one claimed job end-to-end: claim gate → engine →
 * write gate → complete. Never throws to the poll loop for a gate
 * outcome; gate outcomes are returned, not raised.
 *
 * @param {object} job - a claimed diarization_jobs row ({id, recording_id})
 * @param {object} [overrides] - test/S-D05 seam: { runEngine }
 * @returns {Promise<{outcome: string, code?: string, output?: object}>}
 */
async function processJob(job, overrides = {}) {
	const runEngine = overrides.runEngine || ((j) => runRealEngine(j, overrides));
	const recordingId = job.recording_id;

	// Claim-time gate (BR-2/BR-3) — before any audio, before the engine.
	const claimGate = await evaluateDiarizationGate(recordingId);
	if (!claimGate.allowed) {
		console.log(
			`[diarization] consent blocked at claim for job ${job.id} recording ${recordingId}: ${claimGate.code}`,
		);
		await diarizationJobs.cancel(job.id, `consent_blocked_at_claim:${claimGate.code}`);
		await setRecordingDiarizationStatus(recordingId, 'unavailable');
		return { outcome: 'cancelled_at_claim', code: claimGate.code };
	}

	// Bridge provenance (#1925, ADR-D06 §5 step 7): when the gate
	// resolved via the event's governing session, persist which session
	// and receipt authorized this claim on the job row — the snapshot
	// the write-time re-resolution is compared against below. S-D19
	// (#1956, §7 P5): the panel snapshot rides the same persist —
	// write-once, in one transaction under a per-event advisory lock
	// with a live panel re-check (persistClaimProvenance). A snapshot
	// conflict or a flip caught by the re-check cancels at claim.
	if (claimGate.via === 'event_bridge') {
		const persisted = await persistClaimProvenance(job.id, claimGate, { verifyLive: true });
		if (persisted.conflict || persisted.blocked) {
			const code = persisted.conflict ? 'PANEL_SNAPSHOT_CONFLICT' : persisted.blocked;
			console.log(
				`[diarization] consent blocked at claim for job ${job.id} recording ${recordingId}: ${code}`,
			);
			await diarizationJobs.cancel(job.id, `consent_blocked_at_claim:${code}`);
			await setRecordingDiarizationStatus(recordingId, 'unavailable');
			return { outcome: 'cancelled_at_claim', code };
		}
	}

	await diarizationJobs.markProcessing(job.id);
	await setRecordingDiarizationStatus(recordingId, 'processing');
	const expectedSegmentIds = await readSegmentIds(recordingId);

	const heartbeatTimer = setInterval(() => {
		diarizationJobs.heartbeat(job.id).catch(() => {});
	}, HEARTBEAT_INTERVAL_MS);
	let output;
	try {
		output = await runEngine(job);
	} catch (err) {
		// S-D05 R2: a failed engine/fetch/decode fails the JOB with its
		// error class — no run row, no partial output, supervisor lives.
		const errorClass = err.errorClass || 'engine_failed';
		console.log(
			`[diarization] job ${job.id} recording ${recordingId} failed (${errorClass}): ${err.message}`,
		);
		await diarizationJobs.fail(job.id, errorClass, String(err.message || err).slice(0, 500));
		await setRecordingDiarizationStatus(recordingId, 'failed');
		return { outcome: 'failed', errorClass };
	} finally {
		clearInterval(heartbeatTimer);
	}

	// Write-time re-check (§3.4): consent resolved live AGAIN,
	// immediately before any output could persist. Withdrawal during
	// the run discards the output — nothing is written, the transcript
	// stays unlabelled, and the job cancels at write.
	const writeGate = await evaluateDiarizationGate(recordingId);
	if (!writeGate.allowed) {
		// S-D19 P6 translation: a PANEL_* block at write, after the panel
		// leg PASSED at claim, means the panel state changed mid-job —
		// the write code is the comparison code (§8: a withdrawal landing
		// between claim and write is PANEL_AGREEMENT_CHANGED; a frozen
		// set that became unresolvable is PANEL_EXPECTED_SET_CHANGED).
		// Candidate codes are never translated (precedence unchanged).
		let writeCode = writeGate.code;
		if (claimGate.via === 'event_bridge' && claimGate.panelSnapshot && writeCode.startsWith('PANEL_')) {
			if (writeCode === 'PANEL_SET_UNRESOLVABLE') {
				writeCode = 'PANEL_EXPECTED_SET_CHANGED';
			} else if (writeCode !== 'PANEL_AGREEMENT_UNVERIFIABLE') {
				writeCode = 'PANEL_AGREEMENT_CHANGED';
			}
		}
		console.log(
			`[diarization] consent blocked at write for job ${job.id} recording ${recordingId}: ${writeCode} — output discarded`,
		);
		await diarizationJobs.cancel(job.id, `consent_blocked_at_write:${writeCode}`);
		await setRecordingDiarizationStatus(recordingId, 'unavailable');
		return { outcome: 'cancelled_at_write', code: writeCode };
	}

	// Bridge write-time comparison (#1925, ADR-D06 §5 step 7): the
	// write-time evaluation re-resolves from scratch; if the governing
	// session it resolved differs from the claim-time one, the output
	// was not authorized by the claim-time consent — block at write.
	if (
		claimGate.via === 'event_bridge' &&
		(writeGate.via !== 'event_bridge' || writeGate.sessionId !== claimGate.sessionId)
	) {
		console.log(
			`[diarization] consent blocked at write for job ${job.id} recording ${recordingId}: SESSION_BINDING_MISMATCH (governing session changed since claim) — output discarded`,
		);
		await diarizationJobs.cancel(job.id, 'consent_blocked_at_write:SESSION_BINDING_MISMATCH');
		await setRecordingDiarizationStatus(recordingId, 'unavailable');
		return { outcome: 'cancelled_at_write', code: 'SESSION_BINDING_MISMATCH' };
	}

	// Panel write-time comparison (S-D19, §7 P6): both gates allowed,
	// but the run that was authorized must be the run that is written —
	// any divergence between the claim snapshot and the write snapshot
	// (frozen set/hash, or any user's decision tuple, incl. a
	// granted → declined → granted flip) discards the output.
	if (claimGate.via === 'event_bridge' && claimGate.panelSnapshot) {
		const compareCode = panelWriteComparisonCode(claimGate.panelSnapshot, writeGate.panelSnapshot);
		if (compareCode) {
			console.log(
				`[diarization] consent blocked at write for job ${job.id} recording ${recordingId}: ${compareCode} — output discarded`,
			);
			await diarizationJobs.cancel(job.id, `consent_blocked_at_write:${compareCode}`);
			await setRecordingDiarizationStatus(recordingId, 'unavailable');
			return { outcome: 'cancelled_at_write', code: compareCode };
		}
	}

	// Behind the write gate: only real engine output carries
	// provenance (output.engine); the S-D04 stub seam persists
	// nothing and completes as before.
	if (output?.engine) {
		const persistStitch = overrides.persistStitch || transcriptStitch.persistStitch;
		let stitched;
		try {
			// Bridge jobs carry the write-gate provenance onto the run
			// row (#1925); session-linked jobs call the stitch exactly
			// as before (no extra keys).
			const stitchArgs =
				writeGate.via === 'event_bridge'
					? {
							jobId: job.id,
							recordingId,
							expectedSegmentIds,
							output,
							governingSessionId: writeGate.sessionId,
							consentReceiptId: writeGate.consentReceiptId,
							// S-D19: the run row carries the same panel
							// snapshot the claim rested on (P5/I1).
							panelConsentSnapshot: writeGate.panelSnapshot ?? null,
						}
					: { jobId: job.id, recordingId, expectedSegmentIds, output };
			stitched = await persistStitch(stitchArgs);
		} catch (err) {
			// Stitch failure (incl. a 40P01 deadlock against a racing
			// re-transcription — DB review on #1909): the transaction
			// rolled back, so nothing partial exists. Fail the job
			// retryably (never a deterministic class) and mark the
			// recording failed — honest, recoverable, not final-labelled.
			const errorClass = 'engine_failed';
			console.log(
				`[diarization] stitch failed for job ${job.id} recording ${recordingId}: ${err.message}`,
			);
			await diarizationJobs.fail(job.id, errorClass, String(err.message || err).slice(0, 500));
			await setRecordingDiarizationStatus(recordingId, 'failed');
			return { outcome: 'failed', errorClass };
		}
		if (stitched.outcome === 'superseded') {
			console.log(
				`[diarization] job ${job.id} recording ${recordingId} superseded — stale output discarded`,
			);
			return { outcome: 'superseded', output };
		}
		console.log(`[diarization] job ${job.id} recording ${recordingId} complete (stitched)`);
		return { outcome: 'complete', output };
	}
	await diarizationJobs.complete(job.id);
	console.log(`[diarization] job ${job.id} recording ${recordingId} complete`);
	return { outcome: 'complete', output };
}

/**
 * One poll tick: claim the next job (if enabled) and process it.
 * Flag off → claims nothing (AC-1).
 */
async function poll(overrides = {}) {
	if (!isDiarizationEnabled()) return null;
	const job = await diarizationJobs.claim(WORKER_ID);
	if (!job) return null;
	return processJob(job, overrides);
}

/** Sweeper tick: recover stale claims (dead workers) to pending. */
async function sweep() {
	try {
		const recovered = await diarizationJobs.recoverStale();
		if (recovered > 0) {
			console.log(`[diarization] recovered ${recovered} stale job(s)`);
		}
	} catch (err) {
		console.error('[diarization] sweep error:', err.message);
	}
}

/**
 * Start the poll loop + sweeper. Returns timer handles for stopWorker().
 * Safe to require without starting (tests import processJob/poll).
 */
function startWorker() {
	console.log(
		`[diarization] worker starting (id: ${WORKER_ID}, enabled: ${isDiarizationEnabled()})`,
	);
	if (isDiarizationEnabled()) {
		// AC-1: provision the pinned weights cache at worker start
		// (the SDK SHA-256-verifies its own manifest on load). A
		// provisioning failure is logged, never fatal — jobs fail
		// honestly with their error class if the cache is unusable.
		diarizationEngine
			.provisionWeights()
			.then(() => console.log('[diarization] weights cache provisioned'))
			.catch((err) => console.error('[diarization] weights provisioning failed:', err.message));
	}
	const tick = () => {
		poll().catch((err) => console.error('[diarization] poll error:', err.message));
	};
	const pollTimer = setInterval(tick, POLL_INTERVAL_MS);
	const sweepTimer = setInterval(sweep, SWEEPER_INTERVAL_MS);
	sweep().catch(() => {});
	return { pollTimer, sweepTimer };
}

function stopWorker(timers) {
	if (!timers) return;
	clearInterval(timers.pollTimer);
	clearInterval(timers.sweepTimer);
}

if (require.main === module) {
	process.on('SIGTERM', () => process.exit(0));
	process.on('SIGINT', () => process.exit(0));
	startWorker();
}

module.exports = {
	WORKER_ID,
	POLL_INTERVAL_MS,
	HEARTBEAT_INTERVAL_MS,
	SWEEPER_INTERVAL_MS,
	processJob,
	poll,
	sweep,
	startWorker,
	stopWorker,
	runStubEngine,
	runRealEngine,
	fetchRecordingAudio,
	readSegmentIds,
	persistClaimProvenance,
	panelWriteComparisonCode,
};
