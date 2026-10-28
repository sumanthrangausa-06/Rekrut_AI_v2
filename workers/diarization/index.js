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
 * Engine seam: in this story the engine is a stub — it spawns no
 * process, fetches no audio, and returns no turns. S-D05 swaps the
 * stub for the real per-job child process behind the same
 * `runEngine(job) → { speakerCount, turns }` shape; the fetch + spawn
 * will live inside that seam, downstream of this gate. The stub's
 * output is never persisted and the recording is never marked
 * 'complete' by this skeleton — it stays 'processing' until S-D05
 * persists real labels (no fake completion).
 */

const diarizationJobs = require('../../lib/diarizationJobs');
const { evaluateDiarizationGate } = require('../../lib/diarizationGate');
const { isDiarizationEnabled } = require('../../lib/diarizationFlag');
const db = require('../../lib/db');

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const SWEEPER_INTERVAL_MS = 60000;
const WORKER_ID = `diarization-worker-${process.pid}-${Date.now()}`;

/**
 * Stub engine (S-D04). S-D05 replaces this with the real child process.
 * @returns {Promise<{speakerCount: number, turns: Array}>}
 */
async function runStubEngine(_job) {
	return { speakerCount: 0, turns: [] };
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
 * Process one claimed job end-to-end: claim gate → stub engine →
 * write gate → complete. Never throws to the poll loop for a gate
 * outcome; gate outcomes are returned, not raised.
 *
 * @param {object} job - a claimed diarization_jobs row ({id, recording_id})
 * @param {object} [overrides] - test/S-D05 seam: { runEngine }
 * @returns {Promise<{outcome: string, code?: string, output?: object}>}
 */
async function processJob(job, overrides = {}) {
	const runEngine = overrides.runEngine || runStubEngine;
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

	// ponytail: the stub output is deliberately NOT persisted and the
	// recording is NOT marked 'complete' — S-D05 persists real turns
	// (run row + stitching + status 'complete') at exactly this point,
	// behind the write gate above.
	await diarizationJobs.complete(job.id);
	console.log(`[diarization] job ${job.id} recording ${recordingId} complete (stub engine)`);
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
};
