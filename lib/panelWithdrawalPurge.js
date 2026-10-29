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
 *
 * Transactionality (#1966 M-1, follow-up to the #1963 review): each
 * recording's purge runs in its OWN transaction on a dedicated client,
 * under the same per-event advisory lock the capture/worker pair uses,
 * so a failure mid-recording rolls that recording back whole — never
 * a partially purged recording with stale labels left visible. A
 * failed recording keeps its runs, so it stays selectable: re-calling
 * this function purges exactly the remainder. Failures are NOT
 * swallowed: after attempting every recording, the function throws an
 * Error naming the failed recordings, carrying `failures`
 * ([{ recordingId, message }]) and `purged` (recordings committed),
 * so the caller can act (retry/alert) instead of reading a log line.
 */
const db = require('./db');

/** The five purge statements for one recording, in order. */
async function purgeOneRecording(client, recordingId) {
	await client.query(`DELETE FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
	await client.query(`DELETE FROM recording_speaker_mappings WHERE recording_id = $1`, [
		recordingId,
	]);
	await client.query(`DELETE FROM transcript_speaker_audit WHERE recording_id = $1`, [recordingId]);
	await client.query(
		`UPDATE interview_transcripts SET speaker_number = NULL WHERE recording_id = $1`,
		[recordingId],
	);
	await client.query(
		`UPDATE interview_recordings
		 SET diarization_status = 'unavailable', diarization_updated_at = NOW(), updated_at = NOW()
		 WHERE id = $1`,
		[recordingId],
	);
}

/**
 * @param {number} eventId
 * @param {object} [queryable] - defaults to the lib/db pool. A pool
 *   (anything with `connect()`) lends one client per recording; a bare
 *   client is used directly and is NOT released (the caller owns it).
 * @returns {Promise<number>} recordings purged
 * @throws {Error} after all recordings were attempted, if any failed —
 *   `err.failures` lists { recordingId, message } per failed recording
 *   and `err.purged` counts the recordings that committed.
 */
async function purgeCompletedDiarizationForEvent(eventId, queryable = db) {
	const recRes = await queryable.query(
		`SELECT DISTINCT ir.id FROM interview_recordings ir
		 JOIN diarization_runs dr ON dr.recording_id = ir.id
		 WHERE ir.interview_event_id = $1`,
		[eventId],
	);
	let purged = 0;
	const failures = [];
	for (const { id: recordingId } of recRes.rows) {
		const ownClient = typeof queryable.connect === 'function';
		const client = ownClient ? await queryable.connect() : queryable;
		try {
			await client.query('BEGIN');
			await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
				`panel-event:${eventId}`,
			]);
			await purgeOneRecording(client, recordingId);
			await client.query('COMMIT');
			purged += 1;
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			failures.push({ recordingId, message: err.message });
		} finally {
			if (ownClient) client.release();
		}
	}
	if (failures.length > 0) {
		const err = new Error(
			`withdrawal purge incomplete for event ${eventId}: recording(s) ` +
				`${failures.map((f) => f.recordingId).join(', ')} failed and were rolled back ` +
				`(${purged} recording(s) purged); re-calling the purge retries exactly these`,
		);
		err.failures = failures;
		err.purged = purged;
		throw err;
	}
	return purged;
}

module.exports = { purgeCompletedDiarizationForEvent };
