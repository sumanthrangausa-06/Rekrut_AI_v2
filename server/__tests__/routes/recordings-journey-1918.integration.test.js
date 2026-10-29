/**
 * #1918 (S-D16) — Quinn consolidated journey suite, SYNTHETIC leg.
 *
 * Fills the gaps the per-story suites (#1911/#1912/#1913/#1915) do not
 * cover as journeys, per PRD §14:
 *  - JT-D2: a 4-speaker panel keeps the same name in minute 2 and
 *    minute 40 for every mapped voice; the unmatched voice renders
 *    "Speaker 4" and never carries a participant's name (FR-D09).
 *  - JT-D4 (single-speaker leg): a one-voice recording labels as
 *    exactly one speaker — no invented second speaker (FR-D16).
 *  - AC-5 / BR-4 post-job artefact sweep: after a completed
 *    diarization job, no embedding/voice-print artefact persists in
 *    any diarization-owned table (schema columns or JSON payloads).
 *  - AC-5 / BR-13 post-erasure sweep: after the candidate's real
 *    erasure, zero diarization residue remains for their recording
 *    in any diarization-owned table, and the transcript read returns
 *    absence (FR-D18; complements #1915's fuller JT-D7 journey).
 *
 * Quinn journey suite on the real rig (HL-003): REAL recordings
 * router, REAL lib/db, REAL auth over HTTP via supertest, real
 * Postgres seeded directly, state read back from the DB. Synthetic
 * fixtures only; no real recordings, no human voices (HA-1 human
 * leg is blocked on signed per-speaker consents — see #1918).
 *
 * Run:
 *   SD16_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd16_fresh' \
 *     npx jest server/__tests__/routes/recordings-journey-1918.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool, Client } = require('pg');

const DB_URL = process.env.SD16_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 191801;
const U_CAND = 191802;
const U_PANEL2 = 191803;
const U_PANEL3 = 191804;
const U_ERASE = 191806;
const C_ID = 19181;

const DIARIZATION_TABLES = [
	'diarization_jobs',
	'diarization_runs',
	'recording_speaker_mappings',
	'transcript_speaker_audit',
	'interview_transcripts',
];

let app;
let request;
let generateToken;
let erasePersonalData;
let seedPool;

const R = {};

const recToken = () =>
	generateToken({ id: U_REC, email: 'rec1918@test.local', role: 'recruiter' });

async function seedRecording(eventId, diarizationStatus) {
	const rec = await seedPool.query(
		`INSERT INTO interview_recordings
		   (interview_event_id, room_id, status, duration_seconds, storage_path, diarization_status)
		 VALUES ($1, NULL, 'completed', 3600, 'stub', $2) RETURNING id`,
		[eventId, diarizationStatus],
	);
	return rec.rows[0].id;
}

async function seedSegment(recordingId, { text, start, end, speaker = null }) {
	const res = await seedPool.query(
		`INSERT INTO interview_transcripts
		   (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
		 VALUES ($1, 'unknown', $2, $3, $4, $5) RETURNING id`,
		[recordingId, text, start, end, speaker],
	);
	return res.rows[0].id;
}

async function seedMapping(recordingId, speakerNumber, userId, role) {
	await seedPool.query(
		`INSERT INTO recording_speaker_mappings
		   (recording_id, speaker_number, participant_user_id, participant_role, state)
		 VALUES ($1, $2, $3, $4, 'proposed')`,
		[recordingId, speakerNumber, userId, role],
	);
}

async function seedEvent(candidateId) {
	const ev = await seedPool.query(
		`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, status)
		 VALUES ($1, $2, $3::int[], 'completed') RETURNING id`,
		[U_REC, candidateId, [U_PANEL2, U_PANEL3]],
	);
	return ev.rows[0].id;
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_REC, U_CAND, U_PANEL2, U_PANEL3, U_ERASE];
	const eventScope = `SELECT id FROM interview_events WHERE recruiter_id = $1 OR candidate_id = ANY($2::int[])`;
	const recScope = `SELECT id FROM interview_recordings WHERE interview_event_id IN (${eventScope})`;
	// Delete order respects diarization_runs → diarization_jobs FK.
	for (const table of [
		'interview_transcripts',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'diarization_runs',
		'diarization_jobs',
	]) {
		await q(`DELETE FROM ${table} WHERE recording_id IN (${recScope})`, [U_REC, userIds]);
	}
	await q(`DELETE FROM interview_recordings WHERE interview_event_id IN (${eventScope})`, [U_REC, userIds]);
	await q(`DELETE FROM interview_events WHERE recruiter_id = $1 OR candidate_id = ANY($2::int[])`, [U_REC, userIds]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D16 Co')`, [C_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1918@test.local', 'Rec 1918', 'recruiter', $6),
		   ($2, 'cand1918@test.local', 'Cand 1918', 'candidate', NULL),
		   ($3, 'panel21918@test.local', 'Panel Two', 'recruiter', $6),
		   ($4, 'panel31918@test.local', 'Panel Three', 'recruiter', $6),
		   ($5, 'erase1918@test.local', 'Erase 1918', 'candidate', NULL)`,
		[U_REC, U_CAND, U_PANEL2, U_PANEL3, U_ERASE, C_ID],
	);

	// ── JT-D2 panel: 4 voices; speakers 0/1/2 mapped, speaker 3 not ──
	const panelEvent = await seedEvent(U_CAND);
	R.panel = await seedRecording(panelEvent, 'complete');
	// Minute 2 (120s–180s) and minute 40 (2400s–2460s): every voice
	// speaks in both windows with the same speaker_number.
	for (const [base, tag] of [[120000, 'early'], [2400000, 'late']]) {
		await seedSegment(R.panel, { text: `Candidate ${tag}.`, start: base, end: base + 10000, speaker: 0 });
		await seedSegment(R.panel, { text: `Recruiter ${tag}.`, start: base + 10000, end: base + 20000, speaker: 1 });
		await seedSegment(R.panel, { text: `Panel two ${tag}.`, start: base + 20000, end: base + 30000, speaker: 2 });
		await seedSegment(R.panel, { text: `Unmatched ${tag}.`, start: base + 30000, end: base + 40000, speaker: 3 });
	}
	await seedMapping(R.panel, 0, U_CAND, 'candidate');
	await seedMapping(R.panel, 1, U_REC, 'interviewer');
	await seedMapping(R.panel, 2, U_PANEL2, 'interviewer');
	await seedMapping(R.panel, 3, null, null);
	// A completed job + run for the AC-5 post-job sweep (turns carry
	// speaker/start/end only — no embedding payload, by construction).
	const job = await q(
		`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
		[R.panel],
	);
	await q(
		`INSERT INTO diarization_runs (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, coverage_end_ms, proposed_mapping)
		 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 4,
		   '[{"speaker":0,"start_s":120,"end_s":130},{"speaker":3,"start_s":2400,"end_s":2410}]'::jsonb, 2440000,
		   $3::jsonb)`,
		[
			R.panel,
			job.rows[0].id,
			JSON.stringify({
				0: { participant_user_id: U_CAND, participant_role: 'candidate' },
				1: { participant_user_id: U_REC, participant_role: 'interviewer' },
				2: { participant_user_id: U_PANEL2, participant_role: 'interviewer' },
				3: null,
			}),
		],
	);
	R.panelJob = job.rows[0].id;

	// ── JT-D4 single-speaker: one voice only ────────────────────────
	const singleEvent = await seedEvent(U_CAND);
	R.single = await seedRecording(singleEvent, 'complete');
	await seedSegment(R.single, { text: 'Only voice one.', start: 0, end: 5000, speaker: 0 });
	await seedSegment(R.single, { text: 'Only voice two.', start: 5000, end: 11000, speaker: 0 });
	await seedMapping(R.single, 0, U_CAND, 'candidate');

	// ── AC-5 erasure target: the erasing candidate's own recording ──
	const eraseEvent = await seedEvent(U_ERASE);
	R.erase = await seedRecording(eraseEvent, 'complete');
	await seedSegment(R.erase, { text: 'Erase me Q.', start: 0, end: 4000, speaker: 0 });
	await seedSegment(R.erase, { text: 'Erase me A.', start: 4000, end: 9000, speaker: 1 });
	await seedMapping(R.erase, 0, U_REC, 'interviewer');
	await seedMapping(R.erase, 1, U_ERASE, 'candidate');
	const eJob = await q(
		`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
		[R.erase],
	);
	await q(
		`INSERT INTO diarization_runs (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, coverage_end_ms)
		 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 2,
		   '[{"speaker":0,"start_s":0,"end_s":4},{"speaker":1,"start_s":4,"end_s":9}]'::jsonb, 9000)`,
		[R.erase, eJob.rows[0].id],
	);
	await q(
		`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action)
		 VALUES ($1, 0, $2, $3, $2, 'correct')`,
		[R.erase, U_REC, U_ERASE],
	);
}

async function countArtefacts(recordingId) {
	const counts = {};
	for (const table of DIARIZATION_TABLES) {
		const { rows } = await seedPool.query(
			`SELECT COUNT(*)::int AS n FROM ${table} WHERE recording_id = $1`,
			[recordingId],
		);
		counts[table] = rows[0].n;
	}
	return counts;
}

async function getTranscript(recordingId, token) {
	return request(app)
		.get(`/api/interviews/recordings/${recordingId}/transcript`)
		.set('Authorization', `Bearer ${token}`);
}

describeIfDb('#1918 S-D16 consolidated journeys (synthetic, realdb)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.BIOMETRIC_ENCRYPTION_KEY = 'b'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();

		({ erasePersonalData } = require('../../../lib/erasureService'));
		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const recordingsRouter = require('../../routes/recordings');
		app = express();
		app.use(express.json());
		app.use('/api/interviews/recordings', recordingsRouter);
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
	});

	test('JT-D2: panel labels are consistent minute 2 → minute 40; unmatched voice is "Speaker 4", never named', async () => {
		const res = await getTranscript(R.panel, recToken());
		expect(res.status).toBe(200);
		const segs = res.body.transcript.segments;
		const bySpeakerWindow = {};
		for (const s of segs) {
			const window = s.start_time_ms < 1000000 ? 'early' : 'late';
			bySpeakerWindow[`${s.speaker_number}:${window}`] = s.speaker_identity;
		}
		// Same speaker_number → same displayed name in both windows.
		for (const n of [0, 1, 2, 3]) {
			expect(bySpeakerWindow[`${n}:early`]).toBeDefined();
			expect(bySpeakerWindow[`${n}:late`]).toBe(bySpeakerWindow[`${n}:early`]);
		}
		expect(bySpeakerWindow['0:early']).toBe('Candidate — Cand 1918');
		expect(bySpeakerWindow['1:early']).toBe('Interviewer — Rec 1918');
		expect(bySpeakerWindow['2:early']).toBe('Interviewer — Panel Two');
		// FR-D09: the unmatched voice is never given a participant name.
		expect(bySpeakerWindow['3:early']).toBe('Speaker 4');
		const speakers = res.body.transcript.diarization.speakers;
		expect(speakers).toHaveLength(4);
		expect(speakers.find((s) => s.speaker_number === 3)).toEqual({
			speaker_number: 3,
			label: 'Speaker 4',
			assigned: false,
		});
	});

	test('JT-D4: single-voice recording labels as exactly one speaker (no invented speaker)', async () => {
		const res = await getTranscript(R.single, recToken());
		expect(res.status).toBe(200);
		const t = res.body.transcript;
		expect(new Set(t.segments.map((s) => s.speaker_identity))).toEqual(
			new Set(['Candidate — Cand 1918']),
		);
		expect(t.diarization.speakers).toHaveLength(1);
		expect(t.diarization.status).toBe('complete');
	});

	test('AC-5/BR-4: post-job artefact sweep — no embedding persists in any diarization-owned artefact', async () => {
		// Schema sweep: no diarization-owned table has an
		// embedding/voice-print-shaped column at all.
		const cols = await seedPool.query(
			`SELECT table_name, column_name FROM information_schema.columns
			 WHERE table_name = ANY($1::text[])
			   AND (column_name ILIKE '%embedding%' OR column_name ILIKE '%voice%print%'
			        OR column_name ILIKE '%voiceprint%')`,
			[[...DIARIZATION_TABLES, 'interview_recordings']],
		);
		expect(cols.rows).toEqual([]);
		// Payload sweep: the completed job's WHOLE stored run row
		// (incl. proposed_mapping, the run's second jsonb column) and
		// whole job row carry no embedding/voice-print payload under
		// any key name — a vector under a neutral key would fail here.
		const run = await seedPool.query(
			`SELECT * FROM diarization_runs WHERE recording_id = $1`,
			[R.panel],
		);
		expect(run.rows).toHaveLength(1);
		expect(JSON.stringify(run.rows[0])).not.toMatch(/embedding|voice.?print/i);
		// Stored turns carry exactly the production keys
		// ({speaker, start_s, end_s} — lib/diarizationEngine /
		// lib/transcriptStitch shape), nothing else rides along.
		const turns = typeof run.rows[0].turns === 'string'
			? JSON.parse(run.rows[0].turns)
			: run.rows[0].turns;
		expect(Array.isArray(turns)).toBe(true);
		for (const turn of turns) {
			expect(Object.keys(turn).sort()).toEqual(['end_s', 'speaker', 'start_s']);
		}
		const jobRow = await seedPool.query(
			`SELECT * FROM diarization_jobs WHERE id = $1`,
			[R.panelJob],
		);
		expect(JSON.stringify(jobRow.rows[0])).not.toMatch(/embedding|voice.?print/i);
	});

	test('AC-5/BR-13 + JT-D7: post-erasure sweep — zero diarization residue; transcript read is absence', async () => {
		expect(await countArtefacts(R.erase)).toEqual({
			diarization_jobs: 1,
			diarization_runs: 1,
			recording_speaker_mappings: 2,
			transcript_speaker_audit: 1,
			interview_transcripts: 2,
		});
		const client = new Client({ connectionString: DB_URL });
		await client.connect();
		try {
			await client.query('BEGIN');
			await erasePersonalData(U_ERASE, { client });
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			throw err;
		} finally {
			await client.end();
		}
		expect(await countArtefacts(R.erase)).toEqual({
			diarization_jobs: 0,
			diarization_runs: 0,
			recording_speaker_mappings: 0,
			transcript_speaker_audit: 0,
			interview_transcripts: 0,
		});
		// The panel recording (another candidate) is untouched.
		expect((await countArtefacts(R.panel)).diarization_runs).toBe(1);
		// Read-back absence, in the established [purged] shape (the
		// #1915 pattern): no segments, no label data, no names.
		const after = await getTranscript(R.erase, recToken());
		expect([200, 403, 404]).toContain(after.status);
		if (after.status === 200) {
			expect(after.body.transcript.segment_count).toBe(0);
			expect(after.body.transcript.segments).toEqual([]);
			const d = after.body.transcript.diarization;
			if (d) {
				expect(d.speakers).toEqual([]);
				expect(d.mapping_state).toBeNull();
				expect(d.corrected_by).toBeNull();
			}
		}
		expect(JSON.stringify(after.body)).not.toContain('Erase 1918');
		expect(JSON.stringify(after.body)).not.toContain('Speaker');
	});
});
