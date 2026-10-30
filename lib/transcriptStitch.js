/**
 * transcriptStitch — Stitching: segments × diarization turns
 * (S-D07, #1909; Architecture §3.6, PRD FR-D05/D06/D15/D16/D03).
 *
 * Turns (segments × turns) into stored, labelled data. Owns: the
 * max-overlap assignment, the verbatim retention of the engine's
 * original output in `diarization_runs`, the generation guard, and
 * the atomic persistence of a completed labelling. Names are
 * S-D08's: the mapping proposal (lib/speakerMapping, §3.7) is
 * computed and persisted INSIDE this transaction (§4.3 step 4), and
 * the run row's `proposed_mapping` carries it. Display is S-D09's.
 *
 * Presentation-only (BR-12): speaker numbers attribute transcript
 * text. This module imports nothing from, and is imported by
 * nothing in, the OmniScore / Trust Score / matching / screening
 * code — the fence S-D14 machine-checks.
 *
 * Privacy (BR-4/BR-5, privacy review on #1909): turns are stored
 * exactly as the engine supervisor stripped them —
 * `{speaker, start_s, end_s}` timing triples, nothing else. No
 * embeddings, no voice prints, no accuracy/confidence/share fields
 * are written anywhere by this module.
 */

const pool = require('./db');
const diarizationJobs = require('./diarizationJobs');
const speakerMapping = require('./speakerMapping');

// #1929 M4: an abrupt-end recording produced a 0.06 s phantom turn
// (a spurious extra speaker). A turn shorter than this floor is
// engine noise, not a voice: it is retained verbatim in the run row
// (audit truth) but can never label a segment — an honest NULL beats
// a phantom label. Ceiling: genuine sub-100 ms turns are below
// syllable scale; if a future engine emits meaningful shorter turns,
// raise the floor question with Rex rather than silently tuning.
const MIN_ASSIGNABLE_TURN_MS = 100;

function turnMs(turn) {
	return {
		speaker: turn.speaker,
		startMs: Math.round((turn.start_s || 0) * 1000),
		endMs: Math.round((turn.end_s || 0) * 1000),
	};
}

/**
 * The assignable turns, in ms — the ONE assignability predicate for
 * this module (#1929 M4/m5: assignSpeakers and coverageEndMs share
 * it, so the two can never drift apart). A turn is assignable when
 * it clears the sub-floor filter (#1929 M4: shorter than
 * MIN_ASSIGNABLE_TURN_MS is engine noise, e.g. the 0.06 s abrupt-end
 * phantom) and the speaker-number range filter (#1993, extending
 * #1934 M-3: speaker outside [0, INT4_MAX] is not assignable — a
 * negative speaker is a valid int4 and would otherwise persist as a
 * meaningless, orphan label the mapping proposal already skips; an
 * over-int4 speaker would fail the segment UPDATE and roll back
 * every label in the interview). Non-integer speakers INSIDE the
 * range are deliberately NOT filtered here: the persist loop's AC-5
 * throw for corrupt (fractional) output stays reachable and
 * unchanged for them (e.g. 1.5). A fractional speaker that is also
 * out of range (e.g. -1.5) is removed by this filter like any
 * out-of-range turn — the range contract takes precedence (review
 * M-1 on PR #1994). INT4_MAX is reused from speakerMapping (required
 * above; it does not require this module back, so no cycle) — one
 * contract definition for both int4 writes. Unassignable turns are
 * still retained verbatim in the run row (audit truth); they simply
 * never label a segment and never extend the coverage claim.
 */
function assignableTurnsMs(turns) {
	return (Array.isArray(turns) ? turns : [])
		.map(turnMs)
		.filter((t) => t.endMs - t.startMs >= MIN_ASSIGNABLE_TURN_MS)
		.filter((t) => !(t.speaker < 0 || t.speaker > speakerMapping.INT4_MAX));
}

/**
 * How far into the recording diarization actually covered (FR-D15):
 * the last end among ASSIGNABLE turns only (#1929 M4/m5). A tail
 * phantom or an out-of-range turn must not extend the coverage
 * claim past the last real voice; no clamping to the recording
 * duration either — 3600000 stays 3600000 for a 3602464 ms recording.
 */
function coverageEndMs(turns) {
	const usable = assignableTurnsMs(turns);
	if (usable.length === 0) return 0;
	return Math.max(...usable.map((t) => t.endMs));
}

/**
 * Max-overlap assignment (§3.6.1): each segment gets the speaker
 * whose turn overlaps its span the most (interval intersection on
 * ms). Ties and no-overlap → NULL (unlabelled, honest). Sub-floor
 * turns (#1929 M4) and out-of-range speakers (#1993, [0, INT4_MAX]
 * contract) are not assignable.
 *
 * @param {Array<{id:number, start_time_ms:number, end_time_ms:number}>} segments
 * @param {Array<{speaker:number, start_s:number, end_s:number}>} turns
 * @returns {Map<number, number|null>} segment id → speaker_number
 */
function assignSpeakers(segments, turns) {
	const usable = assignableTurnsMs(turns);
	const result = new Map();
	for (const seg of segments) {
		let bestSpeaker = null;
		let bestOverlap = 0;
		let tied = false;
		for (const t of usable) {
			const overlap = Math.min(seg.end_time_ms, t.endMs) - Math.max(seg.start_time_ms, t.startMs);
			if (overlap <= 0) continue;
			if (overlap > bestOverlap) {
				bestOverlap = overlap;
				bestSpeaker = t.speaker;
				tied = false;
			} else if (overlap === bestOverlap && t.speaker !== bestSpeaker) {
				tied = true;
			}
		}
		result.set(seg.id, tied ? null : bestSpeaker);
	}
	return result;
}

/**
 * Persist one job's diarization output atomically (§3.6.4–6):
 *
 *   BEGIN
 *   guard: job row FOR UPDATE — must exist, be `processing`, belong
 *          to this recording; must still be the NEWEST job for the
 *          recording; no run row may exist for it yet; the current
 *          segment id set must equal `expectedSegmentIds` (the set
 *          the worker read for this job — ids are monotonic and
 *          never reused, so a re-transcription's new generation can
 *          never satisfy this; §3.6.5 generation guard, FR-D03)
 *   INSERT diarization_runs (turns + versions verbatim — before any
 *          segment write, and never mutated afterwards; the S-D08
 *          mapping proposal rides on this row as proposed_mapping)
 *   UPDATE interview_transcripts speaker_number per segment
 *   INSERT recording_speaker_mappings (S-D08 proposal rows)
 *   UPDATE interview_recordings diarization_status='complete'
 *   UPDATE diarization_jobs status='complete' (guarded, rowCount=1)
 *   COMMIT
 *
 * Any failure before COMMIT rolls back EVERYTHING: the recording
 * stays `processing` with unlabelled, readable segments — never a
 * half-labelled transcript presented as final (AC-5). A guard
 * failure discards the output and marks the job superseded
 * (`cancelled` + `superseded_by_retranscription` — migration 296's
 * status CHECK has no literal 'superseded'; DB review on #1909).
 * All statements run on ONE pool client; the diarizationJobs
 * helpers (separate autocommit connections) are never called
 * inside the transaction.
 *
 * @param {{jobId:number, recordingId:number, expectedSegmentIds:number[],
 *          output:{speakerCount:number, turns:Array, engine:object},
 *          governingSessionId?:number, consentReceiptId?:number,
 *          panelConsentSnapshot?:object}} args
 *   governingSessionId/consentReceiptId (#1925, ADR-D06 §5 step 7): the
 *   event-bridge gate provenance, written onto the run row as the
 *   durable authorization record alongside the produced labels.
 *   panelConsentSnapshot (S-D19, #1956): the BR-7 panel-leg snapshot,
 *   written onto the run row identically (design §7 P5, test I1).
 *   Absent (session-linked jobs) → NULL, exactly as pre-bridge rows.
 * @returns {Promise<{outcome:'complete'|'superseded', runId?:number, coverageEndMs?:number}>}
 */
async function persistStitch({ jobId, recordingId, expectedSegmentIds, output, governingSessionId, consentReceiptId, panelConsentSnapshot }) {
	const turns = Array.isArray(output?.turns) ? output.turns : [];
	const coverage = coverageEndMs(turns);
	const expected = [...(expectedSegmentIds || [])].sort((a, b) => a - b);
	const client = await pool.connect();
	let guardFailed = false;
	try {
		await client.query('BEGIN');

		const jobRes = await client.query(
			`SELECT id, recording_id, status FROM diarization_jobs WHERE id = $1 FOR UPDATE`,
			[jobId],
		);
		const job = jobRes.rows[0];
		if (!job || job.status !== 'processing' || job.recording_id !== recordingId) {
			guardFailed = true;
		}

		let interviewEventId = null;
		if (!guardFailed) {
			const recRes = await client.query(
				`SELECT id, interview_event_id FROM interview_recordings WHERE id = $1 FOR UPDATE`,
				[recordingId],
			);
			if (recRes.rows.length === 0) guardFailed = true;
			else interviewEventId = recRes.rows[0].interview_event_id;
		}

		if (!guardFailed) {
			const newest = await client.query(
				`SELECT MAX(id) AS max_id FROM diarization_jobs WHERE recording_id = $1`,
				[recordingId],
			);
			if (Number(newest.rows[0].max_id) !== jobId) guardFailed = true;
		}

		if (!guardFailed) {
			const existing = await client.query(
				`SELECT 1 FROM diarization_runs WHERE job_id = $1`,
				[jobId],
			);
			if (existing.rows.length > 0) guardFailed = true; // idempotency backstop
		}

		let segments = [];
		if (!guardFailed) {
			const segRes = await client.query(
				`SELECT id, start_time_ms, end_time_ms FROM interview_transcripts
				 WHERE recording_id = $1 ORDER BY id`,
				[recordingId],
			);
			segments = segRes.rows;
			const current = segments.map((s) => s.id);
			if (JSON.stringify(current) !== JSON.stringify(expected)) guardFailed = true;
		}

		if (guardFailed) {
			await client.query('ROLLBACK');
		} else {
			// Mapping proposal (§3.7, S-D08): participants from the
			// recording's interview event (meeting facts only), shares
			// computed transiently inside computeProposal and discarded.
			// Computed BEFORE the run insert so proposed_mapping lands
			// on the run row; the mapping ROWS insert after the segment
			// updates, so the corrupt-output fault path below still
			// throws before any mapping write. All inside this
			// transaction — a failure rolls back run, labels, and
			// mappings together (§4.3 step 4).
			const participants = await speakerMapping.loadParticipants(client, interviewEventId);
			const proposal = speakerMapping.computeProposal({
				turns,
				participants,
				autoNameEnabled: speakerMapping.isAutoNameEnabled(),
			});

			// Original output retained verbatim, BEFORE stitching (§3.6.4).
			const runRes = await client.query(
				`INSERT INTO diarization_runs
				   (recording_id, job_id, engine_package, sdk_version, model_version,
				    speaker_count, turns, coverage_end_ms, proposed_mapping,
				    governing_session_id, consent_receipt_id, panel_consent_snapshot)
				 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12::jsonb)
				 RETURNING id`,
				[
					recordingId,
					jobId,
					output.engine.package,
					output.engine.sdkVersion,
					output.engine.modelVersion,
					output.speakerCount,
					JSON.stringify(turns),
					coverage,
					proposal.proposedMapping === null ? null : JSON.stringify(proposal.proposedMapping),
					governingSessionId ?? null,
					consentReceiptId ?? null,
					// S-D19 (#1956, §7 P5): panel-leg provenance on the run,
					// identical to the claim snapshot on the job (I1).
					panelConsentSnapshot == null ? null : JSON.stringify(panelConsentSnapshot),
				],
			);

			const assignments = assignSpeakers(segments, turns);
			for (const seg of segments) {
				const speaker = assignments.get(seg.id);
				if (speaker === null || speaker === undefined) continue; // stays NULL — honest
				if (!Number.isInteger(speaker)) {
					// Corrupt engine output reaching the INTEGER column:
					// fail the whole stitch (tx rolls back, run included)
					// rather than storing a rounded, invented label.
					throw new Error(`transcriptStitch: non-integer speaker ${speaker} from engine output`);
				}
				await client.query(
					`UPDATE interview_transcripts SET speaker_number = $2 WHERE id = $1`,
					[seg.id, speaker],
				);
			}

			// One mapping row per distinct turn speaker (S-D08) —
			// unassigned speakers included, so "Speaker N" and the
			// manual path (FR-D10) have a row to work from.
			await speakerMapping.persistMappings(client, recordingId, proposal.rows);

			await client.query(
				`UPDATE interview_recordings
				 SET diarization_status = 'complete', diarization_updated_at = NOW(), updated_at = NOW()
				 WHERE id = $1`,
				[recordingId],
			);
			const jobUpd = await client.query(
				`UPDATE diarization_jobs SET status = 'complete', updated_at = NOW()
				 WHERE id = $1 AND status = 'processing'`,
				[jobId],
			);
			if (jobUpd.rowCount !== 1) {
				throw new Error(`transcriptStitch: job ${jobId} completion guard failed (rowCount=${jobUpd.rowCount})`);
			}

			await client.query('COMMIT');
			return { outcome: 'complete', runId: runRes.rows[0].id, coverageEndMs: coverage };
		}
	} catch (err) {
		await client.query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		client.release();
	}

	// Guard failed: the output is discarded (nothing was written).
	// Mark the job superseded outside the rolled-back transaction,
	// via the guarded queue helper (never resurrects a terminal job;
	// a job row deleted by re-transcription simply no-ops).
	await diarizationJobs.cancel(jobId, 'superseded_by_retranscription').catch(() => {});
	return { outcome: 'superseded' };
}

module.exports = {
	assignSpeakers,
	coverageEndMs,
	persistStitch,
	MIN_ASSIGNABLE_TURN_MS,
};
