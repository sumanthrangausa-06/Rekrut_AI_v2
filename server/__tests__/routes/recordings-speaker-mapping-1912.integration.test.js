/**
 * #1912 (S-D10) — Mapping editor + correction endpoints with audit trail
 * (Architecture §5.2/§5.3/§4.2; PRD FR-D10/D11/D12; JT-D3).
 *
 * Quinn + Recruiter-persona journey suite on the real rig (HL-003): the
 * REAL recordings router, REAL lib/db, REAL auth over HTTP via supertest,
 * against a real Postgres seeded directly. The journey is the user's:
 * a recruiter opens a transcript whose candidate/interviewer names were
 * proposed swapped, fixes them once in the editor, and every viewer —
 * including the candidate — sees the corrected names on next read, with
 * the audit trail and the untouched original proposal read back from
 * the DB. Synthetic fixtures only; no real recordings.
 *
 * Run:
 *   SD10_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd10_e2e' \
 *     npx jest server/__tests__/routes/recordings-speaker-mapping-1912.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SD10_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 191201;
const U_CAND = 191202;
const U_PANEL = 191203;
const U_OUT = 191204;
const U_ADMIN = 191205;
const U_PEER = 191206;
const U_OTHER = 191207;
const C_ID = 19121;
const C2_ID = 19122;

let app;
let request;
let generateToken;
let seedPool;

const R = {};

function tokenFor(id, email, role) {
	return generateToken({ id, email, role });
}
const recToken = () => tokenFor(U_REC, 'rec1912@test.local', 'recruiter');
const candToken = () => tokenFor(U_CAND, 'cand1912@test.local', 'candidate');
const panelToken = () => tokenFor(U_PANEL, 'panel1912@test.local', 'recruiter');
const outToken = () => tokenFor(U_OUT, 'out1912@test.local', 'candidate');
const adminToken = () => tokenFor(U_ADMIN, 'admin1912@test.local', 'admin');
const peerToken = () => tokenFor(U_PEER, 'peer1912@test.local', 'recruiter');
const otherToken = () => tokenFor(U_OTHER, 'other1912@test.local', 'recruiter');

async function seedRecording(diarizationStatus) {
	const q = (sql, params) => seedPool.query(sql, params);
	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, panel_member_ids, status)
		 VALUES ($1, $2, $3::int[], 'completed') RETURNING id`,
		[U_REC, U_CAND, [U_PANEL]],
	);
	const eventId = ev.rows[0].id;
	const room = await q(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status)
		 VALUES ($1, $2, $3, 'closed') RETURNING id`,
		[eventId, `room-${eventId}`, `lk-${eventId}`],
	);
	const rec = await q(
		`INSERT INTO interview_recordings
		   (interview_event_id, room_id, status, duration_seconds, storage_path, diarization_status)
		 VALUES ($1, $2, 'completed', 3600, 'stub', $3) RETURNING id`,
		[eventId, room.rows[0].id, diarizationStatus],
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

async function seedMapping(recordingId, speakerNumber, userId, role, state = 'proposed') {
	await seedPool.query(
		`INSERT INTO recording_speaker_mappings
		   (recording_id, speaker_number, participant_user_id, participant_role, state)
		 VALUES ($1, $2, $3, $4, $5)`,
		[recordingId, speakerNumber, userId, role, state],
	);
}

async function seedRun(recordingId, proposedMapping) {
	const job = await seedPool.query(
		`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
		[recordingId],
	);
	await seedPool.query(
		`INSERT INTO diarization_runs
		   (recording_id, job_id, engine_package, sdk_version, model_version, speaker_count, turns, proposed_mapping, coverage_end_ms)
		 VALUES ($1, $2, '@desert-ant-labs/who', '4.2.1', 'v0.3.4', 2, '[]'::jsonb, $3::jsonb, 20000)`,
		[recordingId, job.rows[0].id, JSON.stringify(proposedMapping)],
	);
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_REC, U_CAND, U_PANEL, U_OUT, U_ADMIN, U_PEER, U_OTHER];
	const eventScope = `SELECT id FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`;
	const recScope = `SELECT id FROM interview_recordings WHERE interview_event_id IN (${eventScope})
		OR interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $2)`;
	for (const table of [
		'interview_transcripts',
		'recording_speaker_mappings',
		'transcript_speaker_audit',
		'diarization_runs',
		'diarization_jobs',
	]) {
		await q(`DELETE FROM ${table} WHERE recording_id IN (${recScope})`, [U_REC, U_CAND]);
	}
	await q(`DELETE FROM interview_recordings WHERE id IN (${recScope})`, [U_REC, U_CAND]);
	await q(
		`DELETE FROM interview_sessions WHERE candidate_id = $1 OR company_id = ANY($2::int[])`,
		[U_CAND, [C_ID, C2_ID]],
	);
	await q(`DELETE FROM interview_rooms WHERE interview_event_id IN (${eventScope})`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM interview_events WHERE recruiter_id = $1 OR candidate_id = $2`, [
		U_REC,
		U_CAND,
	]);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = ANY($1::int[])`, [[C_ID, C2_ID]]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D10 Co'), ($2, 'S-D10 Other Co')`, [
		C_ID,
		C2_ID,
	]);
	// Panel sits in a DIFFERENT company on purpose: panel access must
	// come from panel_member_ids alone, never from a company match —
	// and U_PEER (same company as the recruiter of record, not panel,
	// not of record) must NOT pass the corrector gate (§5.2; PR #1937
	// review BLOCK-1).
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1912@test.local', 'Rec 1912', 'recruiter', $8),
		   ($2, 'cand1912@test.local', 'Cand 1912', 'candidate', NULL),
		   ($3, 'panel1912@test.local', 'Panel 1912', 'recruiter', $9),
		   ($4, 'out1912@test.local', 'Out 1912', 'candidate', NULL),
		   ($5, 'admin1912@test.local', 'Admin 1912', 'admin', NULL),
		   ($6, 'peer1912@test.local', 'Peer 1912', 'recruiter', $8),
		   ($7, 'other1912@test.local', 'Other 1912', 'recruiter', $9)`,
		[U_REC, U_CAND, U_PANEL, U_OUT, U_ADMIN, U_PEER, U_OTHER, C_ID, C2_ID],
	);

	// ── Swapped proposal (JT-D3): the machine named speaker 0 the
	// candidate and speaker 1 the interviewer; the words say otherwise.
	R.swapped = await seedRecording('complete');
	await seedSegment(R.swapped, { text: 'Short opener.', start: 0, end: 2000, speaker: 0 });
	await seedSegment(R.swapped, {
		text: 'So tell me about the role and the team I would join.',
		start: 2000,
		end: 6000,
		speaker: 0,
	});
	await seedSegment(R.swapped, { text: 'Welcome, thanks for coming in today.', start: 6000, end: 9000, speaker: 1 });
	await seedSegment(R.swapped, {
		text: 'I led a team of five engineers for three years and shipped two launches.',
		start: 9000,
		end: 20000,
		speaker: 1,
	});
	await seedMapping(R.swapped, 0, U_CAND, 'candidate');
	await seedMapping(R.swapped, 1, U_REC, 'interviewer');
	R.swappedProposal = {
		'0': { participant_user_id: U_CAND, participant_role: 'candidate' },
		'1': { participant_user_id: U_REC, participant_role: 'interviewer' },
	};
	await seedRun(R.swapped, R.swappedProposal);

	// ── Correct proposal, awaiting acceptance (AC-4) ────────────────────
	R.proposed = await seedRecording('complete');
	await seedSegment(R.proposed, { text: 'Let us begin.', start: 0, end: 4000, speaker: 0 });
	await seedSegment(R.proposed, { text: 'Happy to.', start: 4000, end: 8000, speaker: 1 });
	await seedMapping(R.proposed, 0, U_REC, 'interviewer');
	await seedMapping(R.proposed, 1, U_CAND, 'candidate');
	await seedRun(R.proposed, {
		'0': { participant_user_id: U_REC, participant_role: 'interviewer' },
		'1': { participant_user_id: U_CAND, participant_role: 'candidate' },
	});

	// ── All unassigned (AC-6: proposal named nobody) ────────────────────
	R.unassigned = await seedRecording('complete');
	await seedSegment(R.unassigned, { text: 'Voice one speaks first.', start: 0, end: 5000, speaker: 0 });
	await seedSegment(R.unassigned, { text: 'Voice two answers.', start: 5000, end: 10000, speaker: 1 });
	// Duration-vs-text discriminator for the sample-turn rule (§5.2
	// "longest" = longest segment by duration): this segment has far
	// more words but a much shorter duration than speaker 0's first.
	await seedSegment(R.unassigned, {
		text: 'A very much longer piece of sample text that runs on and on and on.',
		start: 10000,
		end: 11000,
		speaker: 0,
	});
	await seedMapping(R.unassigned, 0, null, null);
	await seedMapping(R.unassigned, 1, null, null);
	await seedRun(R.unassigned, { '0': null, '1': null });

	// ── Labelling not complete (AC-5 / §5.5: 409) ───────────────────────
	R.processing = await seedRecording('processing');
	await seedSegment(R.processing, { text: 'Still labelling.', start: 0, end: 3000 });
	await seedMapping(R.processing, 0, U_CAND, 'candidate');

	// ── Session-linked (AI interview; no interview_event) ──────────────
	// canAccessRecording trusts the session for ACCESS (candidate +
	// same-company recruiters), but §5.2's corrector set is defined by
	// the event's record — a session recording has no recruiter/panel
	// of record, so only an admin corrects (BLOCK-1 fixture).
	const sess = await seedPool.query(
		`INSERT INTO interview_sessions (candidate_id, company_id, status)
		 VALUES ($1, $2, 'completed') RETURNING id`,
		[U_CAND, C_ID],
	);
	const sessRec = await seedPool.query(
		`INSERT INTO interview_recordings
		   (interview_session_id, status, duration_seconds, storage_path, diarization_status)
		 VALUES ($1, 'completed', 3600, 'stub', 'complete') RETURNING id`,
		[sess.rows[0].id],
	);
	R.session = sessRec.rows[0].id;
	await seedSegment(R.session, { text: 'Session voice one.', start: 0, end: 5000, speaker: 0 });
	await seedSegment(R.session, { text: 'Session voice two.', start: 5000, end: 10000, speaker: 1 });
	await seedMapping(R.session, 0, null, null);
	await seedMapping(R.session, 1, null, null);

	// ── S-D19 (#1956, §13 item 7 / security S-4): frozen-set source ──
	// The recording's expected set was frozen as [U_REC, U_PANEL]; the
	// LIVE event is then mutated — U_OTHER added, nobody removed — and
	// mapping validation must keep judging by the freeze.
	R.frozen = await seedRecording('complete');
	await seedSegment(R.frozen, { text: 'Frozen voice one.', start: 0, end: 5000, speaker: 0 });
	await seedSegment(R.frozen, { text: 'Frozen voice two.', start: 5000, end: 10000, speaker: 1 });
	await seedMapping(R.frozen, 0, null, null);
	await seedMapping(R.frozen, 1, null, null);
	await seedRun(R.frozen, { '0': null, '1': null });
	const frozenEv = await seedPool.query(
		`SELECT interview_event_id FROM interview_recordings WHERE id = $1`,
		[R.frozen],
	);
	await seedPool.query(
		`UPDATE interview_recordings SET panel_expected_user_ids = $1::int[] WHERE id = $2`,
		[[U_REC, U_PANEL].sort((a, b) => a - b), R.frozen],
	);
	await seedPool.query(
		`UPDATE interview_events SET panel_member_ids = $1::int[] WHERE id = $2`,
		[[U_PANEL, U_OTHER], frozenEv.rows[0].interview_event_id],
	);
}

async function getSpeakers(recordingId, token) {
	return request(app)
		.get(`/api/interviews/recordings/${recordingId}/speakers`)
		.set('Authorization', `Bearer ${token}`);
}

async function putMapping(recordingId, token, assignments) {
	return request(app)
		.put(`/api/interviews/recordings/${recordingId}/speakers/mapping`)
		.set('Authorization', `Bearer ${token}`)
		.send({ assignments });
}

async function getTranscript(recordingId, token) {
	return request(app)
		.get(`/api/interviews/recordings/${recordingId}/transcript`)
		.set('Authorization', `Bearer ${token}`);
}

async function auditRows(recordingId) {
	const res = await seedPool.query(
		`SELECT speaker_number, from_user_id, to_user_id, actor_user_id, action
		 FROM transcript_speaker_audit WHERE recording_id = $1 ORDER BY id`,
		[recordingId],
	);
	return res.rows;
}

async function mappingRows(recordingId) {
	const res = await seedPool.query(
		`SELECT speaker_number, participant_user_id, participant_role, state, updated_by
		 FROM recording_speaker_mappings WHERE recording_id = $1 ORDER BY speaker_number`,
		[recordingId],
	);
	return res.rows;
}

async function correctedCountToday() {
	const res = await seedPool.query(
		`SELECT corrected_count FROM diarization_metrics_daily WHERE date = CURRENT_DATE`,
	);
	return res.rows.length ? res.rows[0].corrected_count : 0;
}

describeIfDb('#1912 S-D10 mapping editor + correction endpoints (realdb journey)', () => {
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

	test('AC-1: corrector gets assignments + state, sample turns, participant options, empty correction summary', async () => {
		const res = await getSpeakers(R.swapped, recToken());
		expect(res.status).toBe(200);
		expect(res.body.mapping_state).toBe('proposed');
		expect(res.body.corrected_by).toBeNull();
		expect(res.body.corrected_at).toBeNull();

		expect(res.body.participants).toEqual([
			{ user_id: U_CAND, role: 'candidate', name: 'Cand 1912' },
			{ user_id: U_REC, role: 'interviewer', name: 'Rec 1912' },
			{ user_id: U_PANEL, role: 'interviewer', name: 'Panel 1912' },
		]);

		const [s0, s1] = res.body.speakers;
		expect(s0).toMatchObject({
			speaker_number: 0,
			participant_user_id: U_CAND,
			participant_role: 'candidate',
			participant_name: 'Cand 1912',
			state: 'proposed',
		});
		// Sample turn = the speaker's longest segment (most identifying words).
		expect(s0.sample_turn).toEqual({
			text: 'So tell me about the role and the team I would join.',
			start_time_ms: 2000,
		});
		expect(s1).toMatchObject({
			speaker_number: 1,
			participant_user_id: U_REC,
			participant_role: 'interviewer',
			state: 'proposed',
		});
		expect(s1.sample_turn).toEqual({
			text: 'I led a team of five engineers for three years and shipped two launches.',
			start_time_ms: 9000,
		});

		// No diarization-derived quantity leaks (§5.1 fence).
		expect(JSON.stringify(res.body)).not.toMatch(/share|percent|turn_count|speaking/i);
	});

	test('AC-1: candidate and unrelated users get 403 on both endpoints; panel and admin are correctors', async () => {
		expect((await getSpeakers(R.swapped, candToken())).status).toBe(403);
		expect((await getSpeakers(R.swapped, outToken())).status).toBe(403);
		expect((await putMapping(R.swapped, candToken(), [{ speaker_number: 0, participant_user_id: U_CAND }])).status).toBe(403);
		expect((await getSpeakers(R.swapped, panelToken())).status).toBe(200);
		expect((await getSpeakers(R.swapped, adminToken())).status).toBe(200);
		// The candidate's 403 write attempt wrote nothing.
		expect(await auditRows(R.swapped)).toHaveLength(0);
	});

	test('AC-1 (BLOCK-1 regression): a same-company peer recruiter is NOT a corrector — §5.2 names the recruiter of record, the panel, or an admin', async () => {
		// U_PEER shares the recruiter of record's company, so
		// canAccessRecording admits them as a viewer — but viewing is
		// not correcting. Neither is an other-company recruiter.
		expect((await getSpeakers(R.swapped, peerToken())).status).toBe(403);
		expect(
			(await putMapping(R.swapped, peerToken(), [{ speaker_number: 0, participant_user_id: U_REC }])).status,
		).toBe(403);
		expect((await getSpeakers(R.swapped, otherToken())).status).toBe(403);
		expect(await auditRows(R.swapped)).toHaveLength(0);

		// Session-linked recording: no recruiter/panel of record exists,
		// so the same-company peer is refused and only an admin corrects.
		expect((await getSpeakers(R.session, peerToken())).status).toBe(403);
		expect((await getSpeakers(R.session, recToken())).status).toBe(403);
		expect((await getSpeakers(R.session, candToken())).status).toBe(403);
		const adminView = await getSpeakers(R.session, adminToken());
		expect(adminView.status).toBe(200);
		expect(adminView.body.participants).toEqual([]);
	});

	test('AC-2/AC-3 (JT-D3): recruiter swaps the swapped mapping — every viewer sees corrected names, audit holds one row per speaker, proposal untouched, first-correction metric moves', async () => {
		const metricBefore = await correctedCountToday();

		const res = await putMapping(R.swapped, recToken(), [
			{ speaker_number: 0, participant_user_id: U_REC },
			{ speaker_number: 1, participant_user_id: U_CAND },
		]);
		expect(res.status).toBe(200);
		expect(res.body.mapping_state).toBe('corrected');
		expect(res.body.speakers).toEqual([
			expect.objectContaining({ speaker_number: 0, participant_user_id: U_REC, participant_role: 'interviewer', state: 'corrected' }),
			expect.objectContaining({ speaker_number: 1, participant_user_id: U_CAND, participant_role: 'candidate', state: 'corrected' }),
		]);

		// Next read, recruiter: every turn of both speakers corrected.
		const recView = await getTranscript(R.swapped, recToken());
		expect(recView.status).toBe(200);
		expect(recView.body.transcript.segments.map((s) => s.speaker_identity)).toEqual([
			'Interviewer — Rec 1912',
			'Interviewer — Rec 1912',
			'Candidate — Cand 1912',
			'Candidate — Cand 1912',
		]);
		expect(recView.body.transcript.diarization.mapping_state).toBe('corrected');
		expect(recView.body.transcript.diarization.corrected_by).toBe('Rec 1912');
		expect(recView.body.transcript.diarization.corrected_at).toBeTruthy();

		// Next read, candidate: same corrected labels + the corrected-by line.
		const candView = await getTranscript(R.swapped, candToken());
		expect(candView.body.transcript.segments.map((s) => s.speaker_identity)).toEqual([
			'Interviewer — Rec 1912',
			'Interviewer — Rec 1912',
			'Candidate — Cand 1912',
			'Candidate — Cand 1912',
		]);
		expect(candView.body.transcript.diarization.corrected_by).toBe('Rec 1912');

		// DB read-back: one audit row per changed speaker, actor from session.
		expect(await auditRows(R.swapped)).toEqual([
			{ speaker_number: 0, from_user_id: U_CAND, to_user_id: U_REC, actor_user_id: U_REC, action: 'correct' },
			{ speaker_number: 1, from_user_id: U_REC, to_user_id: U_CAND, actor_user_id: U_REC, action: 'correct' },
		]);
		expect(await mappingRows(R.swapped)).toEqual([
			{ speaker_number: 0, participant_user_id: U_REC, participant_role: 'interviewer', state: 'corrected', updated_by: U_REC },
			{ speaker_number: 1, participant_user_id: U_CAND, participant_role: 'candidate', state: 'corrected', updated_by: U_REC },
		]);

		// FR-D12: the original proposal survives untouched.
		const run = await seedPool.query(
			`SELECT proposed_mapping FROM diarization_runs WHERE recording_id = $1`,
			[R.swapped],
		);
		expect(run.rows[0].proposed_mapping).toEqual(R.swappedProposal);

		// First correction for this recording increments the daily count once.
		expect(await correctedCountToday()).toBe(metricBefore + 1);
	});

	test('AC-5: identical re-PUT is a no-op — no new audit rows, no metric change', async () => {
		const metricBefore = await correctedCountToday();
		const res = await putMapping(R.swapped, recToken(), [
			{ speaker_number: 0, participant_user_id: U_REC },
			{ speaker_number: 1, participant_user_id: U_CAND },
		]);
		expect(res.status).toBe(200);
		expect(res.body.mapping_state).toBe('corrected');
		expect(await auditRows(R.swapped)).toHaveLength(2);
		expect(await correctedCountToday()).toBe(metricBefore);
	});

	test('AC-4: accepting the proposal unchanged records confirmed, distinctly — and the confirmer never appears as corrector', async () => {
		const res = await putMapping(R.proposed, recToken(), [
			{ speaker_number: 0, participant_user_id: U_REC },
			{ speaker_number: 1, participant_user_id: U_CAND },
		]);
		expect(res.status).toBe(200);
		expect(res.body.mapping_state).toBe('confirmed');
		expect(res.body.speakers.every((s) => s.state === 'confirmed')).toBe(true);
		expect(res.body.corrected_by).toBeNull();

		expect(await auditRows(R.proposed)).toEqual([
			{ speaker_number: 0, from_user_id: U_REC, to_user_id: U_REC, actor_user_id: U_REC, action: 'confirm' },
			{ speaker_number: 1, from_user_id: U_CAND, to_user_id: U_CAND, actor_user_id: U_REC, action: 'confirm' },
		]);

		const view = await getTranscript(R.proposed, candToken());
		expect(view.body.transcript.diarization.mapping_state).toBe('confirmed');
		expect(view.body.transcript.diarization.corrected_by).toBeNull();

		// A second identical PUT is now a pure no-op.
		const again = await putMapping(R.proposed, recToken(), [
			{ speaker_number: 0, participant_user_id: U_REC },
			{ speaker_number: 1, participant_user_id: U_CAND },
		]);
		expect(again.status).toBe(200);
		expect(await auditRows(R.proposed)).toHaveLength(2);
	});

	test('AC-5: invalid assignments are rejected with no partial write', async () => {
		const before = await mappingRows(R.unassigned);

		// Non-participant user.
		expect(
			(await putMapping(R.unassigned, recToken(), [{ speaker_number: 0, participant_user_id: U_OUT }])).status,
		).toBe(400);
		// One participant on two speakers.
		expect(
			(
				await putMapping(R.unassigned, recToken(), [
					{ speaker_number: 0, participant_user_id: U_CAND },
					{ speaker_number: 1, participant_user_id: U_CAND },
				])
			).status,
		).toBe(400);
		// Unknown speaker number.
		expect(
			(await putMapping(R.unassigned, recToken(), [{ speaker_number: 99, participant_user_id: U_CAND }])).status,
		).toBe(400);
		// Duplicate speaker entry.
		expect(
			(
				await putMapping(R.unassigned, recToken(), [
					{ speaker_number: 0, participant_user_id: U_CAND },
					{ speaker_number: 0, participant_user_id: U_REC },
				])
			).status,
		).toBe(400);

		expect(await mappingRows(R.unassigned)).toEqual(before);
		expect(await auditRows(R.unassigned)).toHaveLength(0);
	});

	test('AC-5/§5.5: correcting a recording whose labelling is not complete gets 409, nothing written', async () => {
		const res = await putMapping(R.processing, recToken(), [
			{ speaker_number: 0, participant_user_id: U_REC },
		]);
		expect(res.status).toBe(409);
		expect(await auditRows(R.processing)).toHaveLength(0);
	});

	test('AC-6: manual assignment from the editor names an all-unassigned recording, same audit trail', async () => {
		// Sample-turn rule pinned first (§5.2 "longest" = duration):
		// speaker 0's sample is the 5 s segment, not the wordier 1 s one.
		const editor = await getSpeakers(R.unassigned, recToken());
		expect(editor.status).toBe(200);
		expect(editor.body.speakers[0].sample_turn).toEqual({
			text: 'Voice one speaks first.',
			start_time_ms: 0,
		});

		const res = await putMapping(R.unassigned, panelToken(), [
			{ speaker_number: 0, participant_user_id: U_REC },
			{ speaker_number: 1, participant_user_id: U_CAND },
		]);
		expect(res.status).toBe(200);
		expect(res.body.mapping_state).toBe('corrected');

		const view = await getTranscript(R.unassigned, candToken());
		expect(view.body.transcript.segments.map((s) => s.speaker_identity)).toEqual([
			'Interviewer — Rec 1912',
			'Candidate — Cand 1912',
			'Interviewer — Rec 1912',
		]);
		expect(await auditRows(R.unassigned)).toEqual([
			{ speaker_number: 0, from_user_id: null, to_user_id: U_REC, actor_user_id: U_PANEL, action: 'correct' },
			{ speaker_number: 1, from_user_id: null, to_user_id: U_CAND, actor_user_id: U_PANEL, action: 'correct' },
		]);
	});

	test('unassign: setting a speaker back to nobody writes an unassign audit row and the transcript shows Speaker N', async () => {
		const res = await putMapping(R.unassigned, recToken(), [
			{ speaker_number: 1, participant_user_id: null },
		]);
		expect(res.status).toBe(200);

		const rows = await auditRows(R.unassigned);
		expect(rows[rows.length - 1]).toEqual({
			speaker_number: 1,
			from_user_id: U_CAND,
			to_user_id: null,
			actor_user_id: U_REC,
			action: 'unassign',
		});

		const view = await getTranscript(R.unassigned, recToken());
		expect(view.body.transcript.segments.map((s) => s.speaker_identity)).toEqual([
			'Interviewer — Rec 1912',
			'Speaker 2',
			'Interviewer — Rec 1912',
		]);
		// An unassign is a correction for the header line (S-D09 semantics).
		expect(view.body.transcript.diarization.corrected_by).toBe('Rec 1912');
	});

	test('S-D19 (§13 item 7, S-4): mapping validation uses the recording FROZEN set — a user added to the event after the freeze is NOT assignable; a frozen panellist still is', async () => {
		// GET editor: participants come from the freeze — U_OTHER (added
		// to the live event after the recording was made) is absent.
		const view = await getSpeakers(R.frozen, recToken());
		expect(view.status).toBe(200);
		const optionIds = view.body.participants.map((p) => p.user_id).sort((a, b) => a - b);
		expect(optionIds).toEqual([U_REC, U_CAND, U_PANEL].sort((a, b) => a - b));
		expect(optionIds).not.toContain(U_OTHER);

		// PUT assigning the post-freeze addition → rejected, no write.
		const bad = await putMapping(R.frozen, recToken(), [
			{ speaker_number: 0, participant_user_id: U_OTHER },
		]);
		expect(bad.status).toBe(400);
		expect(await mappingRows(R.frozen)).toEqual([
			expect.objectContaining({ speaker_number: 0, participant_user_id: null }),
			expect.objectContaining({ speaker_number: 1, participant_user_id: null }),
		]);

		// PUT assigning a frozen panellist → accepted.
		const ok = await putMapping(R.frozen, recToken(), [
			{ speaker_number: 0, participant_user_id: U_PANEL },
		]);
		expect(ok.status).toBe(200);
		const rows = await mappingRows(R.frozen);
		expect(rows[0].participant_user_id).toBe(U_PANEL);
	});

	test('AC-5: a single-speaker PUT that collides with an untouched speaker\u2019s assignment is rejected, nothing written', async () => {
		// R.swapped currently maps speaker 0 → Rec, speaker 1 → Cand.
		// Assigning Cand to speaker 0 alone would put Cand on both.
		const before = await mappingRows(R.swapped);
		const res = await putMapping(R.swapped, recToken(), [
			{ speaker_number: 0, participant_user_id: U_CAND },
		]);
		expect(res.status).toBe(400);
		expect(await mappingRows(R.swapped)).toEqual(before);
		expect(await auditRows(R.swapped)).toHaveLength(2);
	});
});
