/**
 * transcriptStitch.integration.test.js — S-D07 (#1909), HL-003 gate.
 *
 * NO mocks: the real stitch module against a real Postgres (fresh-
 * migrated DB), state read back from the DB. Proves the layer unit
 * tests cannot: AC-1 verbatim run retention, AC-4 generation guard
 * against a real re-transcription shape, and AC-5 atomicity — a fault
 * injected mid-transaction (a fractional speaker in the engine
 * output, thrown by the stitch AFTER the run insert and AFTER the
 * first segment's UPDATE has already succeeded) must leave zero
 * artefacts: the already-applied segment update rolled back too, no
 * run row, recording still 'processing', job still 'processing'.
 * That is the kill-mid-stitch state: an uncommitted transaction can
 * never present as final.
 *
 * Gated behind STITCH_INTEGRATION_DB_URL (house integration pattern).
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/sd07_e2e \
 *   STITCH_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd07_e2e' \
 *     npx jest server/__tests__/lib/transcriptStitch.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.STITCH_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const ENGINE = { package: '@desert-ant-labs/who', sdkVersion: '4.2.1', modelVersion: 'v0.3.4' };

describeIfDb('transcriptStitch.persistStitch (real DB — S-D07)', () => {
	jest.setTimeout(30000);
	let pool;
	let stitch;
	let candidateId;
	let recruiterId;

	async function seedRecording(segmentSpans) {
		const ev = await pool.query(
			`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
			 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
			[recruiterId, candidateId],
		);
		const rec = await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, status, diarization_status, retention_expires_at)
			 VALUES ($1, 'completed', 'processing', NOW() + INTERVAL '90 days') RETURNING id`,
			[ev.rows[0].id],
		);
		const recordingId = rec.rows[0].id;
		const segmentIds = [];
		for (const [start, end, text] of segmentSpans) {
			const s = await pool.query(
				`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
				 VALUES ($1, 'unknown', $2, $3, $4) RETURNING id`,
				[recordingId, text, start, end],
			);
			segmentIds.push(s.rows[0].id);
		}
		const job = await pool.query(
			`INSERT INTO diarization_jobs (recording_id, status, attempt_count) VALUES ($1, 'processing', 1) RETURNING id`,
			[recordingId],
		);
		return { recordingId, segmentIds, jobId: job.rows[0].id };
	}

	async function segmentsOf(recordingId) {
		const { rows } = await pool.query(
			`SELECT id, speaker_number FROM interview_transcripts WHERE recording_id = $1 ORDER BY start_time_ms`,
			[recordingId],
		);
		return rows;
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = new Pool({ connectionString: DB_URL });
		stitch = require('../../../lib/transcriptStitch');
		const cand = await pool.query(`INSERT INTO users (email) VALUES ('sd07-candidate@example.test') RETURNING id`);
		candidateId = cand.rows[0].id;
		const rec = await pool.query(`INSERT INTO users (email) VALUES ('sd07-recruiter@example.test') RETURNING id`);
		recruiterId = rec.rows[0].id;
	});

	afterAll(async () => {
		await pool.query(`DELETE FROM interview_events WHERE candidate_id = $1`, [candidateId]).catch(() => {});
		await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[candidateId, recruiterId]]).catch(() => {});
		await pool.end();
		const db = require('../../../lib/db');
		if (db.end) await db.end().catch(() => {});
	});

	it('AC-1/AC-5: stitch labels by max overlap, stores the run verbatim, flips status+job atomically', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording([
			[0, 10000, 'hello there'],
			[10000, 20000, 'general kenobi'],
			[20000, 30000, 'you are a bold one'],
		]);
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 13 },
			{ speaker: 1, start_s: 13, end_s: 30 },
		];
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 2, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');

		const segs = await segmentsOf(recordingId);
		expect(segs.map((s) => s.speaker_number)).toEqual([0, 1, 1]);

		const run = await pool.query(`SELECT * FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(run.rows).toHaveLength(1);
		expect(run.rows[0].turns).toEqual(turns); // verbatim, never re-shaped
		expect(run.rows[0].engine_package).toBe(ENGINE.package);
		expect(run.rows[0].sdk_version).toBe(ENGINE.sdkVersion);
		expect(run.rows[0].model_version).toBe(ENGINE.modelVersion);
		expect(run.rows[0].speaker_count).toBe(2);
		expect(Number(run.rows[0].coverage_end_ms)).toBe(30000);
		// S-D08 (#1910) supersedes the S-D07 placeholder: this seed's
		// turns are speaker 1 = 17s (56.7%) vs speaker 0 = 13s (43.3%)
		// — a 13.3-point gap, so speaker 1 proposes as candidate and
		// speaker 0 as lead interviewer (§3.7), assignments only.
		expect(run.rows[0].proposed_mapping).toEqual({
			'0': { participant_user_id: recruiterId, participant_role: 'interviewer' },
			'1': { participant_user_id: candidateId, participant_role: 'candidate' },
		});
		const mappings = await pool.query(
			`SELECT speaker_number, participant_user_id, participant_role, state
			 FROM recording_speaker_mappings WHERE recording_id = $1 ORDER BY speaker_number`,
			[recordingId],
		);
		expect(mappings.rows).toEqual([
			{ speaker_number: 0, participant_user_id: recruiterId, participant_role: 'interviewer', state: 'proposed' },
			{ speaker_number: 1, participant_user_id: candidateId, participant_role: 'candidate', state: 'proposed' },
		]);

		const rec = await pool.query(`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(rec.rows[0].diarization_status).toBe('complete');
		const job = await pool.query(`SELECT status FROM diarization_jobs WHERE id = $1`, [jobId]);
		expect(job.rows[0].status).toBe('complete');
	});

	it('AC-2: partial coverage — segments beyond coverage stay NULL, run records coverage_end_ms', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording([
			[0, 10000, 'covered'],
			[10000, 20000, 'uncovered tail'],
		]);
		const turns = [{ speaker: 0, start_s: 0, end_s: 10 }];
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 1, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');
		const segs = await segmentsOf(recordingId);
		expect(segs.map((s) => s.speaker_number)).toEqual([0, null]);
		const run = await pool.query(`SELECT coverage_end_ms FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(Number(run.rows[0].coverage_end_ms)).toBe(10000);
	});

	it('AC-3: single-voice recording — exactly one speaker number across all segments', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording([
			[0, 8000, 'only me'],
			[8000, 16000, 'still me'],
		]);
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 1, turns: [{ speaker: 0, start_s: 0, end_s: 16 }], engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');
		const segs = await segmentsOf(recordingId);
		expect(new Set(segs.map((s) => s.speaker_number))).toEqual(new Set([0]));
	});

	it('AC-4: stale job after re-transcription is superseded — its output never lands on the new segments', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording([
			[0, 10000, 'old generation'],
		]);
		// Re-transcription lands (S-D02 replace shape): old segments gone,
		// new generation inserted, a newer job enqueued.
		await pool.query(`DELETE FROM interview_transcripts WHERE recording_id = $1`, [recordingId]);
		const gen2 = await pool.query(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
			 VALUES ($1, 'unknown', 'new generation', 0, 10000) RETURNING id`,
			[recordingId],
		);
		await pool.query(
			`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'pending')`,
			[recordingId],
		);

		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 1, turns: [{ speaker: 0, start_s: 0, end_s: 10 }], engine: ENGINE },
		});
		expect(result.outcome).toBe('superseded');

		const segs = await segmentsOf(recordingId);
		expect(segs).toHaveLength(1);
		expect(segs[0].id).toBe(gen2.rows[0].id);
		expect(segs[0].speaker_number).toBeNull(); // stale labels never landed
		const runs = await pool.query(`SELECT id FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(runs.rows).toHaveLength(0);
		const staleJob = await pool.query(`SELECT status, cancel_reason FROM diarization_jobs WHERE id = $1`, [jobId]);
		expect(staleJob.rows[0].status).toBe('cancelled');
		expect(staleJob.rows[0].cancel_reason).toBe('superseded_by_retranscription');
		const rec = await pool.query(`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(rec.rows[0].diarization_status).toBe('processing'); // NOT flipped by the stale job
	});

	it('AC-5: fault at the last write rolls back EVERYTHING (kill-mid-stitch state)', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording([
			[0, 10000, 'first segment — its update lands, then must roll back'],
			[10000, 20000, 'second segment — carries the fault'],
		]);
		// The run insert (JSONB) succeeds; the FIRST segment's UPDATE
		// succeeds; then the fractional speaker on the second segment
		// makes the stitch throw (corrupt output is never rounded into
		// an invented label) — failure mid-transaction, after real
		// writes. EVERYTHING must roll back, applied updates included.
		await expect(stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: {
				speakerCount: 2,
				turns: [
					{ speaker: 0, start_s: 0, end_s: 10 },
					{ speaker: 1.5, start_s: 10, end_s: 20 },
				],
				engine: ENGINE,
			},
		})).rejects.toThrow();

		const runs = await pool.query(`SELECT id FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(runs.rows).toHaveLength(0); // run insert rolled back too
		// M-5 (PR #1932 review): no mapping rows survive the rollback either.
		const maps = await pool.query(`SELECT id FROM recording_speaker_mappings WHERE recording_id = $1`, [recordingId]);
		expect(maps.rows).toHaveLength(0);
		const segs = await segmentsOf(recordingId);
		expect(segs.map((x) => x.speaker_number)).toEqual([null, null]); // first segment's applied update rolled back
		const rec = await pool.query(`SELECT diarization_status FROM interview_recordings WHERE id = $1`, [recordingId]);
		expect(rec.rows[0].diarization_status).toBe('processing'); // readable, honest, not final
		const job = await pool.query(`SELECT status FROM diarization_jobs WHERE id = $1`, [jobId]);
		expect(job.rows[0].status).toBe('processing'); // sweeper can reclaim + retry
	});

	it('idempotency: a second persist for a completed job writes nothing new', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording([[0, 10000, 'once only']]);
		const output = { speakerCount: 1, turns: [{ speaker: 0, start_s: 0, end_s: 10 }], engine: ENGINE };
		const first = await stitch.persistStitch({ jobId, recordingId, expectedSegmentIds: segmentIds, output });
		expect(first.outcome).toBe('complete');
		const second = await stitch.persistStitch({ jobId, recordingId, expectedSegmentIds: segmentIds, output });
		expect(second.outcome).toBe('superseded');
		const runs = await pool.query(`SELECT id FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		expect(runs.rows).toHaveLength(1);
		// M-5 (PR #1932 review): the second persist duplicates no mapping rows.
		const maps = await pool.query(`SELECT id FROM recording_speaker_mappings WHERE recording_id = $1`, [recordingId]);
		expect(maps.rows).toHaveLength(1); // one speaker in this seed → exactly one row, still
		// Reviewer MINOR-2 (#1930): the superseded path attempts a
		// guarded cancel — assert it can never un-complete the job.
		const job = await pool.query(`SELECT status FROM diarization_jobs WHERE id = $1`, [jobId]);
		expect(job.rows[0].status).toBe('complete');
	});
});
