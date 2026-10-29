/**
 * diarizationEnqueue — the transcribe handler's enqueue step
 * (S-D19, #1956; br7-panel-notice-design.md §7.2, security S-7).
 *
 * Enqueue is a THIRD check, not a formality: after transcription
 * commits, a diarization job is created only when the feature is
 * enabled, the recording is event-linked, AND the panel leg (§7)
 * passes for the recording right now. A panel block suppresses the
 * enqueue — no job row is created and the recording's diarization
 * state folds to 'unavailable', the same honest surface as every
 * other block. The claim/write gate remains the authority; this only
 * removes the window in which a queued job exists for a recording
 * already known to be blocked.
 */
const db = require('./db');
const diarizationJobs = require('./diarizationJobs');
const { isDiarizationEnabled } = require('./diarizationFlag');
const { evaluatePanelLeg } = require('./diarizationGate');

async function setDiarizationStatus(recordingId, status) {
	await db.query(
		`UPDATE interview_recordings
		 SET diarization_status = $2, diarization_updated_at = NOW(), updated_at = NOW()
		 WHERE id = $1`,
		[recordingId, status],
	);
}

/**
 * @param {number} recordingId
 * @returns {Promise<{enqueued: true} | {enqueued: false, reason?: string, code?: string}>}
 */
async function enqueueDiarizationForRecording(recordingId) {
	if (!isDiarizationEnabled()) return { enqueued: false, reason: 'disabled' };
	const recRes = await db.query(
		`SELECT interview_event_id FROM interview_recordings WHERE id = $1`,
		[recordingId],
	);
	if (!recRes.rows[0]?.interview_event_id) {
		return { enqueued: false, reason: 'not_event_linked' };
	}

	// §7.2 — the panel leg as the enqueue-time third check.
	const panel = await evaluatePanelLeg(recordingId);
	if (!panel.allowed) {
		await setDiarizationStatus(recordingId, 'unavailable');
		return { enqueued: false, code: panel.code };
	}

	await diarizationJobs.enqueue(recordingId);
	await setDiarizationStatus(recordingId, 'pending');
	return { enqueued: true };
}

module.exports = { enqueueDiarizationForRecording };
