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
 * Persistence (S-D05 R1): behind the write-time gate, the worker
 * inserts the diarization_runs row verbatim (turns + engine
 * provenance). It does NOT set segment speaker_numbers and does NOT
 * flip diarization_status to 'complete' — stitching and the status
 * flip are S-D07's atomic step (§3.6); the recording honestly stays
 * 'processing' until then.
 *
 * Failures (S-D05 R2): engine/fetch/decode errors are caught here,
 * classified (§3.5 taxonomy), and recorded via diarizationJobs.fail —
 * never thrown past processJob, never partially persisted.
 */

const diarizationJobs = require('../../lib/diarizationJobs');
const diarizationEngine = require('../../lib/diarizationEngine');
const { evaluateDiarizationGate } = require('../../lib/diarizationGate');
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
 * Persist the engine's original output verbatim (§3.6 step 4 /
 * S-D05 R1): one diarization_runs row — turns, engine provenance,
 * coverage. Stitching (S-D07) reads this row; nothing mutates it.
 */
async function insertRunRow(job, output) {
	const turns = Array.isArray(output.turns) ? output.turns : [];
	const coverageEndMs = turns.length
		? Math.round(Math.max(...turns.map((t) => t.end_s || 0)) * 1000)
		: 0;
	await db.query(
		`INSERT INTO diarization_runs
		   (recording_id, job_id, engine_package, sdk_version, model_version,
		    speaker_count, turns, coverage_end_ms)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
		[
			job.recording_id,
			job.id,
			output.engine.package,
			output.engine.sdkVersion,
			output.engine.modelVersion,
			output.speakerCount,
			JSON.stringify(turns),
			coverageEndMs,
		],
	);
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

	await diarizationJobs.markProcessing(job.id);
	await setRecordingDiarizationStatus(recordingId, 'processing');

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
		console.log(
			`[diarization] consent blocked at write for job ${job.id} recording ${recordingId}: ${writeGate.code} — output discarded`,
		);
		await diarizationJobs.cancel(job.id, `consent_blocked_at_write:${writeGate.code}`);
		await setRecordingDiarizationStatus(recordingId, 'unavailable');
		return { outcome: 'cancelled_at_write', code: writeGate.code };
	}

	// Behind the write gate: persist the engine's original output
	// verbatim (S-D05 R1) — only real engine output carries provenance
	// (output.engine); the S-D04 stub seam persists nothing. Segment
	// labels + the 'complete' status flip are S-D07's atomic stitch.
	if (output?.engine) {
		await insertRunRow(job, output);
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
	insertRunRow,
};
