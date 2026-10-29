/**
 * panelWithdrawalPurge — post-write withdrawal purge
 * (S-D19, #1956; br7-panel-notice-design.md §7.1, privacy C-1).
 *
 * A decline/withdrawal recorded AFTER a run has written labels is not
 * covered by any gate — the processing already happened — so when a
 * panel decision for an event becomes declined/withdrawn, the capture
 * handler calls this: for every recording of the event with completed
 * diarization runs, the diarization artefacts are deleted through the
 * same deletion family the re-transcribe path performs
 * (server/routes/recordings.js: diarization_runs + speaker mappings +
 * correction audit deleted, transcript speaker_numbers cleared) and
 * the recording's diarization state folds to 'unavailable'. No new
 * deletion machinery — the same statements, scoped per recording.
 *
 * The diarization_jobs rows — and their claim-time
 * panel_consent_snapshot — are deliberately NOT deleted: the snapshot
 * is the evidence that the labels, while they existed, were
 * authorized when written (privacy C-2); it leaves with the job/run
 * records under §10 retention. (Run rows ARE deleted, as §7.1(a)
 * specifies; the run's own snapshot goes with its row.)
 *
 * Re-processing is barred without further machinery: any future job
 * blocks at claim on the live decision, and the enqueue path (§7.2)
 * suppresses creation while a non-grant stands.
 */
const db = require('./db');

/**
 * @param {number} eventId
 * @param {object} [queryable] - defaults to the lib/db pool
 * @returns {Promise<number>} recordings purged
 */
async function purgeCompletedDiarizationForEvent(eventId, queryable = db) {
	const recRes = await queryable.query(
		`SELECT DISTINCT ir.id FROM interview_recordings ir
		 JOIN diarization_runs dr ON dr.recording_id = ir.id
		 WHERE ir.interview_event_id = $1`,
		[eventId],
	);
	let purged = 0;
	for (const { id: recordingId } of recRes.rows) {
		await queryable.query(`DELETE FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		await queryable.query(`DELETE FROM recording_speaker_mappings WHERE recording_id = $1`, [
			recordingId,
		]);
		await queryable.query(`DELETE FROM transcript_speaker_audit WHERE recording_id = $1`, [
			recordingId,
		]);
		await queryable.query(
			`UPDATE interview_transcripts SET speaker_number = NULL WHERE recording_id = $1`,
			[recordingId],
		);
		await queryable.query(
			`UPDATE interview_recordings
			 SET diarization_status = 'unavailable', diarization_updated_at = NOW(), updated_at = NOW()
			 WHERE id = $1`,
			[recordingId],
		);
		purged += 1;
	}
	return purged;
}

module.exports = { purgeCompletedDiarizationForEvent };
