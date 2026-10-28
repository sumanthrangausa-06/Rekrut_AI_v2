/**
 * #1911 (S-D09) — Transcript API composition: GET /:id/transcript composes
 * speaker labels from recording_speaker_mappings (§3.8/§5.1), Rex rulings
 * 2026-10-28 (C1–C6), PRD FR-D02/D04/D13/D15/D20.
 *
 * Quinn-style journey suite on the real rig (HL-003): the REAL recordings
 * router, REAL lib/db, REAL auth over HTTP via supertest, against a real
 * Postgres seeded directly (the story lives on the READ path — no ASR or
 * storage boundary is exercised). State is read back from the DB.
 * Synthetic fixtures only; no real recordings.
 *
 * Run:
 *   SD09_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd09_e2e' \
 *     npx jest server/__tests__/routes/recordings-transcript-composition-1911.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const { Pool } = require('pg');

const DB_URL = process.env.SD09_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 191101;
const U_CAND = 191102;
const U_PANEL = 191103;
const U_OUT = 191104;
const C_ID = 19111;

const LEGACY_SEGMENT_KEYS = [
	'confidence',
	'created_at',
	'end_time_ms',
	'id',
	'speaker_identity',
	'start_time_ms',
	'text',
];

let app;
let request;
let generateToken;
let seedPool;

// Recording ids created by the seed helpers (one per scenario).
const R = {};

function tokenFor(id, email, role) {
	return generateToken({ id, email, role });
}
const recToken = () => tokenFor(U_REC, 'rec1911@test.local', 'recruiter');
const candToken = () => tokenFor(U_CAND, 'cand1911@test.local', 'candidate');
const outToken = () => tokenFor(U_OUT, 'out1911@test.local', 'candidate');

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

async function seedSegment(recordingId, { identity = 'unknown', text, start, end, speaker = null }) {
	const res = await seedPool.query(
		`INSERT INTO interview_transcripts
		   (recording_id, speaker_identity, text, start_time_ms, end_time_ms, speaker_number)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		[recordingId, identity, text, start, end, speaker],
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

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	const userIds = [U_REC, U_CAND, U_PANEL, U_OUT];
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
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D09 Co')`, [C_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1911@test.local', 'Rec 1911', 'recruiter', $5),
		   ($2, 'cand1911@test.local', 'Cand 1911', 'candidate', NULL),
		   ($3, 'panel1911@test.local', 'Panel 1911', 'recruiter', $5),
		   ($4, 'out1911@test.local', 'Out 1911', 'candidate', NULL)`,
		[U_REC, U_CAND, U_PANEL, U_OUT, C_ID],
	);

	// ── 1:1 complete, proposed mapping ──────────────────────────────────
	R.oneToOne = await seedRecording('complete');
	R.oneToOneSegs = [
		await seedSegment(R.oneToOne, { text: 'Hello, tell me about yourself.', start: 0, end: 4000, speaker: 0 }),
		await seedSegment(R.oneToOne, { text: 'I led a team of five.', start: 4000, end: 9000, speaker: 1 }),
	];
	await seedMapping(R.oneToOne, 0, U_REC, 'interviewer');
	await seedMapping(R.oneToOne, 1, U_CAND, 'candidate');

	// ── Legacy (pre-feature): status NULL, stored 'unknown' segments ───
	R.legacy = await seedRecording(null);
	await seedSegment(R.legacy, { text: 'Legacy opening.', start: 0, end: 3000 });
	await seedSegment(R.legacy, { text: 'Legacy answer.', start: 3000, end: 8000 });

	// ── Processing: segments exist, none numbered yet ───────────────────
	R.processing = await seedRecording('processing');
	await seedSegment(R.processing, { text: 'Still labelling one.', start: 0, end: 3000 });
	await seedSegment(R.processing, { text: 'Still labelling two.', start: 3000, end: 7000 });

	// ── Failed / unavailable ────────────────────────────────────────────
	R.failed = await seedRecording('failed');
	await seedSegment(R.failed, { text: 'No labels here.', start: 0, end: 3000 });
	R.unavailable = await seedRecording('unavailable');
	await seedSegment(R.unavailable, { text: 'Consent-blocked labels.', start: 0, end: 3000 });

	// ── Rex C5(i): phantom tail — numbered segments, then a tail the run
	// reached only via sub-100 ms noise turns; those segments stay
	// unnumbered in storage and must read back uncovered.
	R.phantomTail = await seedRecording('complete');
	await seedSegment(R.phantomTail, { text: 'Covered one.', start: 0, end: 5000, speaker: 0 });
	await seedSegment(R.phantomTail, { text: 'Covered two.', start: 5000, end: 10000, speaker: 1 });
	await seedSegment(R.phantomTail, { text: 'Beyond the real turns.', start: 10000, end: 20000 });
	await seedSegment(R.phantomTail, { text: 'Phantom tail segment.', start: 20000, end: 3599000 });
	await seedMapping(R.phantomTail, 0, U_CAND, 'candidate');
	await seedMapping(R.phantomTail, 1, U_REC, 'interviewer');
	const job = await seedPool.query(
		`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
		[R.phantomTail],
	);
	await seedPool.query(
		`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns, coverage_end_ms)
		 VALUES ($1, $2, '@desert-ant-labs/who',
		   '[{"speaker":0,"start_s":0,"end_s":10},{"speaker":1,"start_s":5,"end_s":10},{"speaker":0,"start_s":3595,"end_s":3595.06}]'::jsonb,
		   3595060)`,
		[R.phantomTail, job.rows[0].id],
	);

	// ── Rex C5(ii): interior gap — numbered, NULL, numbered ─────────────
	R.gap = await seedRecording('complete');
	await seedSegment(R.gap, { text: 'Before the gap.', start: 0, end: 5000, speaker: 0 });
	await seedSegment(R.gap, { text: 'Inside the gap.', start: 5000, end: 9000 });
	await seedSegment(R.gap, { text: 'After the gap.', start: 9000, end: 14000, speaker: 1 });
	await seedMapping(R.gap, 0, U_CAND, 'candidate');
	await seedMapping(R.gap, 1, U_REC, 'interviewer');

	// ── Panel cap (C2): third speaker unassigned ────────────────────────
	R.panel = await seedRecording('complete');
	await seedSegment(R.panel, { text: 'Candidate answer.', start: 0, end: 6000, speaker: 0 });
	await seedSegment(R.panel, { text: 'Lead question.', start: 6000, end: 10000, speaker: 1 });
	await seedSegment(R.panel, { text: 'Third voice.', start: 10000, end: 15000, speaker: 2 });
	// F4c (PR #1936 review): a covered segment whose speaker has NO
	// mapping row at all — the composition fallback, distinct from the
	// unassigned-row case above.
	await seedSegment(R.panel, { text: 'Unlisted voice.', start: 15000, end: 20000, speaker: 5 });
	await seedMapping(R.panel, 0, U_CAND, 'candidate');
	await seedMapping(R.panel, 1, U_REC, 'interviewer');
	await seedMapping(R.panel, 2, null, null);

	// ── Corrected: audit row + corrected state beats confirmed ─────────
	R.corrected = await seedRecording('complete');
	await seedSegment(R.corrected, { text: 'Swapped voice one.', start: 0, end: 5000, speaker: 0 });
	await seedSegment(R.corrected, { text: 'Swapped voice two.', start: 5000, end: 10000, speaker: 1 });
	await seedMapping(R.corrected, 0, U_CAND, 'candidate', 'corrected');
	await seedMapping(R.corrected, 1, U_REC, 'interviewer', 'confirmed');
	await seedPool.query(
		`INSERT INTO transcript_speaker_audit
		   (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action, created_at)
		 VALUES ($1, 0, $2, $3, $4, 'correct', '2026-10-20 15:04:05+00')`,
		[R.corrected, U_REC, U_CAND, U_REC],
	);

	// ── Corrected with an unresolvable (erased) actor ───────────────────
	R.correctedNoActor = await seedRecording('complete');
	await seedSegment(R.correctedNoActor, { text: 'Erased corrector.', start: 0, end: 5000, speaker: 0 });
	await seedMapping(R.correctedNoActor, 0, U_CAND, 'candidate', 'corrected');
	await seedPool.query(
		`INSERT INTO transcript_speaker_audit
		   (recording_id, speaker_number, from_user_id, to_user_id, actor_user_id, action)
		 VALUES ($1, 0, NULL, $2, NULL, 'correct')`,
		[R.correctedNoActor, U_CAND],
	);

	// ── Confirmed aggregation ───────────────────────────────────────────
	R.confirmed = await seedRecording('complete');
	await seedSegment(R.confirmed, { text: 'Accepted as proposed.', start: 0, end: 5000, speaker: 0 });
	await seedMapping(R.confirmed, 0, U_CAND, 'candidate', 'confirmed');

	// ── Purged tombstone on a post-feature recording ────────────────────
	R.purged = await seedRecording('complete');
	await seedSegment(R.purged, { text: '[purged]', start: 0, end: 5000 });
}

async function getTranscript(recordingId, token) {
	return request(app)
		.get(`/api/interviews/recordings/${recordingId}/transcript`)
		.set('Authorization', `Bearer ${token}`);
}

describeIfDb('#1911 S-D09 transcript composition (realdb journey)', () => {
	beforeAll(async () => {
		// Env BEFORE the router (and lib/db's pool) load — the 1904 pattern.
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

	test('AC-1: 1:1 complete composes names from the mappings, §5.1 block, no leaked keys', async () => {
		const res = await getTranscript(R.oneToOne, recToken());
		expect(res.status).toBe(200);
		const t = res.body.transcript;
		expect(Object.keys(t).sort()).toEqual(['diarization', 'recording_id', 'segment_count', 'segments']);

		const [s0, s1] = t.segments;
		expect(s0.speaker_number).toBe(0);
		expect(s0.diarization_covered).toBe(true);
		expect(s0.speaker_identity).toBe('Interviewer — Rec 1911');
		expect(s1.speaker_number).toBe(1);
		expect(s1.diarization_covered).toBe(true);
		expect(s1.speaker_identity).toBe('Candidate — Cand 1911');

		expect(t.diarization).toEqual({
			status: 'complete',
			mapping_state: 'proposed',
			corrected_by: null,
			corrected_at: null,
			speakers: [
				{ speaker_number: 0, label: 'Interviewer — Rec 1911', assigned: true },
				{ speaker_number: 1, label: 'Candidate — Cand 1911', assigned: true },
			],
		});

		// AC-5 key scan: the diarization block + speakers carry exactly the
		// §5.1 keys; segments gain exactly two keys over the legacy set.
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
				[...LEGACY_SEGMENT_KEYS, 'diarization_covered', 'highlights', 'speaker_number'].sort(),
			);
		}
		const addedJson = JSON.stringify(t.diarization) + JSON.stringify(t.segments.map((s) => s.speaker_number));
		expect(addedJson).not.toMatch(/share|percent|turn_count|speaking/i);
	});

	test('FR-D02: a highlight still attaches to a composed segment and survives reload', async () => {
		const segId = R.oneToOneSegs[1];
		const hl = await request(app)
			.post(`/api/interviews/recordings/transcript/${segId}/highlight`)
			.set('Authorization', `Bearer ${recToken()}`)
			.send({ note: 'Strong answer', timestamp_ms: 5000 });
		expect(hl.status).toBe(201);

		const reloaded = await getTranscript(R.oneToOne, recToken());
		const seg = reloaded.body.transcript.segments.find((s) => s.id === segId);
		expect(seg.speaker_identity).toBe('Candidate — Cand 1911');
		expect(seg.highlights).toHaveLength(1);
		expect(seg.highlights[0].note).toBe('Strong answer');
	});

	test('AC-1: legacy recording returns byte-identical shape to today (no new keys anywhere)', async () => {
		const res = await getTranscript(R.legacy, recToken());
		expect(res.status).toBe(200);
		const dbSegs = await seedPool.query(
			`SELECT id, speaker_identity, text, start_time_ms, end_time_ms, confidence, created_at
			 FROM interview_transcripts WHERE recording_id = $1 ORDER BY start_time_ms`,
			[R.legacy],
		);
		const expectedSegments = dbSegs.rows.map((s) => ({
			id: s.id,
			speaker_identity: s.speaker_identity,
			text: s.text,
			start_time_ms: s.start_time_ms,
			end_time_ms: s.end_time_ms,
			confidence: s.confidence,
			created_at: s.created_at.toISOString(),
			highlights: [],
		}));
		expect(res.body.transcript).toEqual({
			recording_id: R.legacy,
			segment_count: 2,
			segments: expectedSegments,
		});
		expect(res.body.transcript.diarization).toBeUndefined();
		for (const seg of res.body.transcript.segments) {
			expect(Object.keys(seg).sort()).toEqual([...LEGACY_SEGMENT_KEYS, 'highlights'].sort());
		}
	});

	test('AC-2/J4: processing → block status processing, segments honestly uncovered', async () => {
		const res = await getTranscript(R.processing, recToken());
		expect(res.status).toBe(200);
		const t = res.body.transcript;
		expect(t.diarization).toEqual({
			status: 'processing',
			mapping_state: null,
			corrected_by: null,
			corrected_at: null,
			speakers: [],
		});
		for (const seg of t.segments) {
			expect(seg.speaker_number).toBeNull();
			expect(seg.diarization_covered).toBe(false);
			// Stored value kept in the payload; the client renders no heading.
			expect(seg.speaker_identity).toBe('unknown');
		}
	});

	test('AC-2/J4: failed and unavailable recordings both surface status "unavailable"', async () => {
		for (const id of [R.failed, R.unavailable]) {
			const res = await getTranscript(id, recToken());
			expect(res.status).toBe(200);
			expect(res.body.transcript.diarization.status).toBe('unavailable');
			expect(res.body.transcript.segments[0].diarization_covered).toBe(false);
		}
	});

	test('C5(i): phantom sub-100ms tail — segments past the last assignable turn are uncovered (coverage_end_ms never used)', async () => {
		const res = await getTranscript(R.phantomTail, recToken());
		expect(res.status).toBe(200);
		const segs = res.body.transcript.segments;
		expect(segs.map((s) => s.diarization_covered)).toEqual([true, true, false, false]);
		expect(segs.map((s) => s.speaker_number)).toEqual([0, 1, null, null]);
		expect(segs[0].speaker_identity).toBe('Candidate — Cand 1911');
		expect(segs[1].speaker_identity).toBe('Interviewer — Rec 1911');
	});

	test('C5(ii): interior gap — covered, uncovered, covered in segment order', async () => {
		const res = await getTranscript(R.gap, recToken());
		expect(res.status).toBe(200);
		const segs = res.body.transcript.segments;
		expect(segs.map((s) => s.diarization_covered)).toEqual([true, false, true]);
		expect(segs[1].speaker_number).toBeNull();
		expect(segs[2].speaker_identity).toBe('Interviewer — Rec 1911');
	});

	test('C2: panel cap — third speaker composes as "Speaker 3", speakers[] shows assigned:false', async () => {
		const res = await getTranscript(R.panel, recToken());
		expect(res.status).toBe(200);
		const t = res.body.transcript;
		expect(t.segments[2].speaker_identity).toBe('Speaker 3');
		expect(t.segments[2].diarization_covered).toBe(true);
		// F4c: covered segment with no mapping row → fallback "Speaker N".
		expect(t.segments[3].speaker_identity).toBe('Speaker 6');
		expect(t.segments[3].diarization_covered).toBe(true);
		expect(t.diarization.speakers).toEqual([
			{ speaker_number: 0, label: 'Candidate — Cand 1911', assigned: true },
			{ speaker_number: 1, label: 'Interviewer — Rec 1911', assigned: true },
			{ speaker_number: 2, label: 'Speaker 3', assigned: false },
		]);
	});

	test('corrected: mapping_state corrected (beats confirmed), corrected_by/at from the latest audit row', async () => {
		const res = await getTranscript(R.corrected, recToken());
		expect(res.status).toBe(200);
		const d = res.body.transcript.diarization;
		expect(d.mapping_state).toBe('corrected');
		expect(d.corrected_by).toBe('Rec 1911');
		expect(new Date(d.corrected_at).toISOString()).toBe('2026-10-20T15:04:05.000Z');
	});

	test('corrected with an unresolvable actor → corrected_by/at honestly null, state still corrected', async () => {
		const res = await getTranscript(R.correctedNoActor, recToken());
		expect(res.status).toBe(200);
		const d = res.body.transcript.diarization;
		expect(d.mapping_state).toBe('corrected');
		expect(d.corrected_by).toBeNull();
		expect(d.corrected_at).toBeNull();
	});

	test('mapping_state aggregation: all-confirmed mappings read "confirmed"', async () => {
		const res = await getTranscript(R.confirmed, recToken());
		expect(res.status).toBe(200);
		expect(res.body.transcript.diarization.mapping_state).toBe('confirmed');
		expect(res.body.transcript.diarization.corrected_by).toBeNull();
	});

	test('purged tombstone on a post-feature recording still renders as absence', async () => {
		const res = await getTranscript(R.purged, recToken());
		expect(res.status).toBe(200);
		expect(res.body.transcript.segment_count).toBe(0);
		expect(res.body.transcript.segments).toEqual([]);
		expect(JSON.stringify(res.body)).not.toContain('[purged]');
	});

	test('FR-D19: candidate reads the same composed labels (no highlights); a non-participant candidate gets 403', async () => {
		const res = await getTranscript(R.oneToOne, candToken());
		expect(res.status).toBe(200);
		const t = res.body.transcript;
		expect(t.segments.map((s) => s.speaker_identity)).toEqual([
			'Interviewer — Rec 1911',
			'Candidate — Cand 1911',
		]);
		expect(t.diarization.status).toBe('complete');
		for (const seg of t.segments) {
			expect(seg.highlights).toBeUndefined();
		}

		const denied = await getTranscript(R.oneToOne, outToken());
		expect(denied.status).toBe(403);
	});
});
