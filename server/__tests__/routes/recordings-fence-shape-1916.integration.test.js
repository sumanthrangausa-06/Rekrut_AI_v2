/**
 * #1916 (S-D14) — Presentation-only fence, AC-2: response shape.
 *
 * Architecture §6.2 way 3 / PRD FR-D14 / Lex BR-12: no transcript or
 * speakers API response may expose a diarization-derived QUANTITY —
 * no speaking share, no per-speaker turn count, no diarization
 * confidence, no talk ratio, no percentage. Labels are presentation;
 * quantities would be scoring inputs wearing a display costume.
 *
 * Quinn-style journey on the real rig (HL-003), cloned from the S-D09
 * (#1911) suite: the REAL recordings router, REAL lib/db, REAL auth
 * over HTTP via supertest, against a real Postgres seeded directly.
 * The fence lives in the response composition (S-D09/S-D10), which is
 * exactly the layer exercised — nothing about it is mocked.
 *
 * The fixture is adversarial on purpose: speaker 0 holds ~90% of the
 * timed segments and a diarization_runs row carrying speaker_count,
 * turns and the raw proposed_mapping EXISTS in the database — the data
 * is all there server-side, so any leak would be visible. None of it
 * may surface.
 *
 * Precision (STOP 1 on #1916): a segment's `confidence` is the ASR
 * confidence and `segment_count` counts transcript segments — both are
 * pre-existing legacy fields, byte-identical on pre-feature recordings
 * (pinned by the S-D09 suite), and are NOT diarization-derived. The
 * forbidden-key scan therefore covers every diarization-owned surface
 * (the `diarization` block, every `speakers[]` payload, the whole
 * /speakers body) plus exact key-set pins on segments. `speakers[]`
 * cardinality itself is the §5.1-specified panel, consciously accepted
 * in the S-D09 privacy review (F-3); per-speaker quantities are banned.
 *
 * Run:
 *   SD14_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd14_e2e' \
 *     npx jest server/__tests__/routes/recordings-fence-shape-1916.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SD14_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 191601;
const U_CAND = 191602;
const C_ID = 19161;

const FORBIDDEN_KEY = /share|ratio|turn_?count|speaker_?count|percent|speaking|confidence/i;

function collectKeys(value, out = []) {
	if (Array.isArray(value)) {
		for (const v of value) collectKeys(v, out);
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			out.push(k);
			collectKeys(v, out);
		}
	}
	return out;
}

function collectNumbers(value, keyPath = '', out = []) {
	if (Array.isArray(value)) {
		value.forEach((v, i) => collectNumbers(v, `${keyPath}[${i}]`, out));
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) collectNumbers(v, `${keyPath}.${k}`, out);
	} else if (typeof value === 'number') {
		out.push({ path: keyPath, value });
	}
	return out;
}

let app;
let request;
let generateToken;
let seedPool;
let REC_ID;

const recToken = () => generateToken({ id: U_REC, email: 'rec1916@test.local', role: 'recruiter' });
const candToken = () =>
	generateToken({ id: U_CAND, email: 'cand1916@test.local', role: 'candidate' });

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const eventScope = `SELECT id FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`;
	const recScope = `SELECT id FROM interview_recordings WHERE interview_event_id IN (${eventScope})`;
	for (const table of [
		'interview_transcripts',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'diarization_runs',
		'diarization_jobs',
	]) {
		await q(`DELETE FROM ${table} WHERE recording_id IN (${recScope})`, [U_REC, U_CAND]);
	}
	await q(`DELETE FROM interview_recordings WHERE interview_event_id IN (${eventScope})`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM interview_rooms WHERE interview_event_id IN (${eventScope})`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [[U_REC, U_CAND]]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D14 Co')`, [C_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1916@test.local', 'Rec 1916', 'recruiter', $3),
		   ($2, 'cand1916@test.local', 'Cand 1916', 'candidate', NULL)`,
		[U_REC, U_CAND, C_ID],
	);

	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, status)
		 VALUES ($1, $2, '{}'::int[], 'completed') RETURNING id`,
		[U_REC, U_CAND],
	);
	const room = await q(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
		 VALUES ($1, $2, $3, 'closed') RETURNING id`,
		[ev.rows[0].id, `room-${ev.rows[0].id}`, `lk-${ev.rows[0].id}`],
	);
	const rec = await q(
		`INSERT INTO interview_recordings
		   (interview_event_id, room_id, status, duration_seconds, storage_path, diarization_status)
		 VALUES ($1, $2, 'completed', 3600, 'stub', 'complete') RETURNING id`,
		[ev.rows[0].id, room.rows[0].id],
	);
	REC_ID = rec.rows[0].id;

	// Uneven shares by construction: speaker 0 speaks 0–90 s in nine
	// segments; speaker 1 speaks 90–100 s in one. A leaked share would
	// read 0.9 / 0.1; a leaked turn count 9 / 1.
	for (let i = 0; i < 9; i++) {
		await q(
			`INSERT INTO interview_transcripts
			   (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
			 VALUES ($1, 'unknown', $2, $3, $4, 0)`,
			[REC_ID, `Candidate long answer part ${i + 1}.`, i * 10000, (i + 1) * 10000],
		);
	}
	await q(
		`INSERT INTO interview_transcripts
		   (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
		 VALUES ($1, 'unknown', 'One short question.', 90000, 100000, 1)`,
		[REC_ID],
	);
	await q(
		`INSERT INTO recording_speaker_mappings
		   (recording_id, speaker_number, participant_user_id, participant_role, state)
		 VALUES ($1, 0, $2, 'candidate', 'proposed'), ($1, 1, $3, 'interviewer', 'proposed')`,
		[REC_ID, U_CAND, U_REC],
	);

	// The run row holds every quantity the fence bans from responses.
	const job = await q(
		`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
		[REC_ID],
	);
	await q(
		`INSERT INTO diarization_runs
		   (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, proposed_mapping, coverage_end_ms)
		 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 2,
		   '[{"speaker":0,"start_s":0,"end_s":90},{"speaker":1,"start_s":90,"end_s":100}]'::jsonb,
		   '{"0": "candidate", "1": "interviewer"}'::jsonb, 100000)`,
		[REC_ID, job.rows[0].id],
	);
}

describeIfDb('#1916 S-D14 fence response shape (realdb journey)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });

		seedPool = new Pool({ connectionString: DB_URL });
		await cleanAndSeed();

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

	test('AC-2 transcript: exact key sets on every diarization-owned surface', async () => {
		const res = await request(app)
			.get(`/api/interviews/recordings/${REC_ID}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		const t = res.body.transcript;
		expect(Object.keys(t).sort()).toEqual([
			'diarization',
			'recording_id',
			'segment_count',
			'segments',
		]);
		expect(Object.keys(t.diarization).sort()).toEqual([
			'corrected_at',
			'corrected_by',
			'mapping_state',
			'speakers',
			'status',
		]);
		for (const spk of t.diarization.speakers) {
			expect(Object.keys(spk).sort()).toEqual(['assigned', 'label', 'speaker_number']);
		}
		for (const seg of t.segments) {
			expect(Object.keys(seg).sort()).toEqual(
				[
					'confidence',
					'created_at',
					'diarization_covered',
					'end_time_ms',
					'highlights',
					'id',
					'speaker_identity',
					'speaker_number',
					'start_time_ms',
					'text',
				].sort(),
			);
		}
	});

	test('AC-2 transcript: no diarization-derived quantity anywhere in the diarization surfaces', async () => {
		const res = await request(app)
			.get(`/api/interviews/recordings/${REC_ID}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		const t = res.body.transcript;

		// Forbidden keys across the whole diarization block (incl. speakers[]).
		const badKeys = collectKeys(t.diarization).filter((k) => FORBIDDEN_KEY.test(k));
		expect(badKeys).toEqual([]);

		// The only number the diarization block may carry is speaker_number.
		const strayNumbers = collectNumbers(t.diarization).filter(
			(n) => !n.path.endsWith('.speaker_number'),
		);
		expect(strayNumbers).toEqual([]);

		// The stored run quantities / raw proposal never serialise.
		const raw = JSON.stringify(res.body);
		expect(raw).not.toMatch(/speaker_count|proposed_mapping|talk|share/i);
	});

	test('AC-2 transcript: candidate audience is fenced identically', async () => {
		const res = await request(app)
			.get(`/api/interviews/recordings/${REC_ID}/transcript`)
			.set('Authorization', `Bearer ${candToken()}`);
		expect(res.status).toBe(200);
		const t = res.body.transcript;
		expect(Object.keys(t.diarization).sort()).toEqual([
			'corrected_at',
			'corrected_by',
			'mapping_state',
			'speakers',
			'status',
		]);
		expect(collectKeys(t.diarization).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
	});

	test('AC-2 speakers editor: exact keys + forbidden-key scan over the whole body', async () => {
		const res = await request(app)
			.get(`/api/interviews/recordings/${REC_ID}/speakers`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual([
			'corrected_at',
			'corrected_by',
			'mapping_state',
			'participants',
			'speakers',
			'success',
		]);
		for (const spk of res.body.speakers) {
			expect(Object.keys(spk).sort()).toEqual([
				'participant_name',
				'participant_role',
				'participant_user_id',
				'sample_turn',
				'speaker_number',
				'state',
			]);
			expect(Object.keys(spk.sample_turn).sort()).toEqual(['start_time_ms', 'text']);
		}
		for (const p of res.body.participants) {
			expect(Object.keys(p).sort()).toEqual(['name', 'role', 'user_id']);
		}
		// The /speakers body carries no ASR segment at all, so the
		// forbidden scan honestly covers every key in it — confidence
		// included.
		expect(collectKeys(res.body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
		const raw = JSON.stringify(res.body);
		expect(raw).not.toMatch(/speaker_count|proposed_mapping|talk|share/i);
	});
});
