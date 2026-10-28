/**
 * speakerMapping.integration.test.js — S-D08 (#1910), HL-003 gate.
 *
 * NO mocks: the real stitch + speakerMapping modules against a real
 * Postgres (fresh-migrated DB), state read back from the DB. Proves
 * the layer unit tests cannot: the proposal persists ATOMICALLY with
 * the stitch (§4.3 step 4) — diarization_runs.proposed_mapping plus
 * one recording_speaker_mappings row per speaker, state='proposed'.
 *
 * Synthetic fixtures only — no real recordings.
 *
 * Gated behind SPEAKER_MAPPING_INTEGRATION_DB_URL (house pattern).
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/sd08_e2e \
 *   SPEAKER_MAPPING_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd08_e2e' \
 *     npx jest server/__tests__/lib/speakerMapping.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SPEAKER_MAPPING_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

const ENGINE = { package: '@desert-ant-labs/who', sdkVersion: '4.2.1', modelVersion: 'v0.3.4' };

describeIfDb('speakerMapping via persistStitch (real DB — S-D08)', () => {
	jest.setTimeout(30000);
	let pool;
	let stitch;
	let candidateId;
	let recruiterId;
	let panelId;

	async function seedRecording({ withEvent = true, panel = false } = {}) {
		let eventId = null;
		let sessionId = null;
		if (withEvent) {
			const ev = await pool.query(
				`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, duration_minutes, timezone, status)
				 VALUES ($1, $2, $3, 60, 'UTC', 'completed') RETURNING id`,
				[recruiterId, candidateId, panel ? [panelId] : []],
			);
			eventId = ev.rows[0].id;
		} else {
			// Session-linked (AC-4's real shape): migration 130's XOR
			// CHECK forbids a recording with neither link, so the
			// no-event case must carry a session link.
			const sess = await pool.query(`INSERT INTO interview_sessions (type) VALUES ('human') RETURNING id`);
			sessionId = sess.rows[0].id;
		}
		const rec = await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, interview_session_id, status, diarization_status, retention_expires_at)
			 VALUES ($1, $2, 'completed', 'processing', NOW() + INTERVAL '90 days') RETURNING id`,
			[eventId, sessionId],
		);
		const recordingId = rec.rows[0].id;
		const segmentIds = [];
		for (const [start, end] of [[0, 10000], [10000, 20000]]) {
			const s = await pool.query(
				`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
				 VALUES ($1, 'unknown', 'synthetic segment', $2, $3) RETURNING id`,
				[recordingId, start, end],
			);
			segmentIds.push(s.rows[0].id);
		}
		const job = await pool.query(
			`INSERT INTO diarization_jobs (recording_id, status, attempt_count) VALUES ($1, 'processing', 1) RETURNING id`,
			[recordingId],
		);
		return { recordingId, segmentIds, jobId: job.rows[0].id };
	}

	async function mappingsOf(recordingId) {
		const { rows } = await pool.query(
			`SELECT speaker_number, participant_user_id, participant_role, state
			 FROM recording_speaker_mappings WHERE recording_id = $1 ORDER BY speaker_number`,
			[recordingId],
		);
		return rows;
	}

	async function runOf(recordingId) {
		const { rows } = await pool.query(`SELECT proposed_mapping FROM diarization_runs WHERE recording_id = $1`, [recordingId]);
		return rows[0];
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		delete process.env.DIARIZATION_AUTO_NAME;
		jest.resetModules();
		pool = new Pool({ connectionString: DB_URL });
		stitch = require('../../../lib/transcriptStitch');
		const mk = async (email) => (await pool.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [email])).rows[0].id;
		candidateId = await mk('sd08-candidate@example.test');
		recruiterId = await mk('sd08-recruiter@example.test');
		panelId = await mk('sd08-panel@example.test');
	});

	afterAll(async () => {
		delete process.env.DIARIZATION_AUTO_NAME;
		await pool.query(`DELETE FROM interview_events WHERE candidate_id = $1`, [candidateId]).catch(() => {});
		await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[candidateId, recruiterId, panelId]]).catch(() => {});
		await pool.end();
		const db = require('../../../lib/db');
		if (db.end) await db.end().catch(() => {});
	});

	it('AC-1: 1:1 with a clear share leader — largest → candidate, next → lead, proposed_mapping on the run, all proposed', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording();
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 13 },
			{ speaker: 1, start_s: 13, end_s: 30 },
		]; // shares 43% / 57% — clear leader (14-point gap)
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 2, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');

		const rows = await mappingsOf(recordingId);
		expect(rows).toEqual([
			{ speaker_number: 0, participant_user_id: recruiterId, participant_role: 'interviewer', state: 'proposed' },
			{ speaker_number: 1, participant_user_id: candidateId, participant_role: 'candidate', state: 'proposed' },
		]);
		const run = await runOf(recordingId);
		expect(run.proposed_mapping).toEqual({
			'0': { participant_user_id: recruiterId, participant_role: 'interviewer' },
			'1': { participant_user_id: candidateId, participant_role: 'candidate' },
		});
	});

	it('AC-2: top-two shares within 10 points — both persist unassigned', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording();
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 52 },
			{ speaker: 1, start_s: 52, end_s: 100 },
		]; // 52 / 48
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 2, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');
		const rows = await mappingsOf(recordingId);
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.participant_user_id === null && r.participant_role === null && r.state === 'proposed')).toBe(true);
		expect((await runOf(recordingId)).proposed_mapping).toEqual({ '0': null, '1': null });
	});

	it('AC-3: more speakers than participants — the extra voice persists unassigned ("Speaker N")', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording();
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 50 },
			{ speaker: 1, start_s: 50, end_s: 80 },
			{ speaker: 2, start_s: 80, end_s: 100 },
		]; // 50 / 30 / 20, two participants
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 3, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');
		const rows = await mappingsOf(recordingId);
		expect(rows).toHaveLength(3);
		expect(rows[0].participant_user_id).toBe(candidateId);
		expect(rows[1].participant_user_id).toBe(recruiterId);
		expect(rows[2].participant_user_id).toBeNull();
	});

	it('AC-4: no resolvable interview_events row — all speakers persist unassigned, manual path only', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording({ withEvent: false });
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 40 },
			{ speaker: 1, start_s: 40, end_s: 100 },
		];
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 2, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');
		const rows = await mappingsOf(recordingId);
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.participant_user_id === null)).toBe(true);
	});

	it('AC-5: DIARIZATION_AUTO_NAME=false — proposal skipped entirely, stitch otherwise unchanged', async () => {
		process.env.DIARIZATION_AUTO_NAME = 'false';
		try {
			const { recordingId, segmentIds, jobId } = await seedRecording();
			const turns = [
				{ speaker: 0, start_s: 0, end_s: 13 },
				{ speaker: 1, start_s: 13, end_s: 30 },
			];
			const result = await stitch.persistStitch({
				jobId, recordingId, expectedSegmentIds: segmentIds,
				output: { speakerCount: 2, turns, engine: ENGINE },
			});
			expect(result.outcome).toBe('complete');
			const rows = await mappingsOf(recordingId);
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.participant_user_id === null && r.state === 'proposed')).toBe(true);
			expect((await runOf(recordingId)).proposed_mapping).toBeNull(); // skipped entirely
			const segs = await pool.query(
				`SELECT speaker_number FROM interview_transcripts WHERE recording_id = $1 ORDER BY start_time_ms`,
				[recordingId],
			);
			expect(segs.rows.map((s) => s.speaker_number)).toEqual([0, 1]); // stitching itself unchanged
		} finally {
			delete process.env.DIARIZATION_AUTO_NAME;
		}
	});

	it('B-2 (PR #1932 review): guard trip with a panel persists ALL speakers unassigned', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording({ panel: true });
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 40 },
			{ speaker: 1, start_s: 40, end_s: 78 },
			{ speaker: 2, start_s: 78, end_s: 100 },
		]; // 40 / 38 / 22 — top two within 10 points
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 3, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');
		const rows = await mappingsOf(recordingId);
		expect(rows).toHaveLength(3);
		expect(rows.every((r) => r.participant_user_id === null && r.participant_role === null)).toBe(true);
		expect((await runOf(recordingId)).proposed_mapping).toEqual({ '0': null, '1': null, '2': null });
	});

	it('B-1 (PR #1932 review): a sub-100ms phantom speaker persists NO mapping row', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording({ panel: true });
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 13 },
			{ speaker: 1, start_s: 13, end_s: 30 },
			{ speaker: 2, start_s: 30, end_s: 30.06 }, // 60ms phantom — engine noise, not a voice
		];
		const result = await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 3, turns, engine: ENGINE },
		});
		expect(result.outcome).toBe('complete');
		const rows = await mappingsOf(recordingId);
		expect(rows.map((r) => r.speaker_number)).toEqual([0, 1]); // no row for the phantom
		expect((await runOf(recordingId)).proposed_mapping['2']).toBeUndefined();
	});

	it('AC-6: nothing persisted carries a share, turn-count, or confidence figure (BR-12 fence)', async () => {
		const { recordingId, segmentIds, jobId } = await seedRecording();
		const turns = [
			{ speaker: 0, start_s: 0, end_s: 13 },
			{ speaker: 1, start_s: 13, end_s: 30 },
		];
		await stitch.persistStitch({
			jobId, recordingId, expectedSegmentIds: segmentIds,
			output: { speakerCount: 2, turns, engine: ENGINE },
		});
		const run = await runOf(recordingId);
		const persisted = JSON.stringify(run.proposed_mapping) + JSON.stringify(await mappingsOf(recordingId));
		for (const banned of ['share', 'confidence', 'turn_count', 'turnCount', 'duration']) {
			expect(persisted.toLowerCase()).not.toContain(banned);
		}
		const cols = await pool.query(
			`SELECT column_name FROM information_schema.columns WHERE table_name = 'recording_speaker_mappings'`,
		);
		const colNames = cols.rows.map((c) => c.column_name).join(',');
		for (const banned of ['share', 'confidence', 'count']) {
			expect(colNames).not.toContain(banned);
		}
	});
});
