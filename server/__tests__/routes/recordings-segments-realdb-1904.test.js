/**
 * #1904 (S-D02) — Recordings handler stores timestamped segments,
 * replace-on-re-run. Architecture §3.1, PRD FR-D01..D03.
 *
 * Quinn-style user-journey suite on the fresh-install rig (HL-003):
 * the REAL recordings router, REAL lib/db, REAL auth + RBAC, REAL
 * livekit service and REAL ASR cascade (lib/ai-provider via
 * lib/polsia-ai) over HTTP via supertest, against a fresh Postgres
 * built by `node migrate.js`. State is read back from the DB.
 *
 * Stubs live ONLY at the two true external boundaries:
 *   - object storage: the recording's storage_path encrypts (real
 *     services/encryption) an http://127.0.0.1 URL served by a local
 *     stub — the real downloadRecordingAudio fetches it;
 *   - the ASR provider: OPENAI_BASE_URL points the Whisper leg at a
 *     local stub returning real verbose_json multi-segment payloads —
 *     the real cascade + S-D01 segment contract run end to end.
 * The handler and the DB — where this story's behaviour lives — are
 * never mocked. Synthetic fixtures only; no real recordings.
 *
 * Run:
 *   SD02_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd02_1904' \
 *     npx jest server/__tests__/routes/recordings-segments-realdb-1904.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const http = require('node:http');
const { Pool } = require('pg');

const DB_URL = process.env.SD02_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

const U_REC = 190401;
const U_CAND = 190402;
const C_ID = 19041;

// Gen-1: 3 segments jointly covering 0–12s; text joins to the full text.
const GEN1 = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: 'Hello candidate. Tell me about yourself. I led a team of five.',
	segments: [
		{ id: 0, start: 0.0, end: 2.0, text: 'Hello candidate.' },
		{ id: 1, start: 2.0, end: 6.5, text: ' Tell me about yourself.' },
		{ id: 2, start: 6.5, end: 12.0, text: ' I led a team of five.' },
	],
};
// Gen-2 (re-run): different words — the visible result must be ONLY this.
const GEN2 = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: 'Second run opening. Second run closing answer.',
	segments: [
		{ id: 0, start: 0.0, end: 5.0, text: 'Second run opening.' },
		{ id: 1, start: 5.0, end: 12.0, text: ' Second run closing answer.' },
	],
};

// #1923 bounds fixture (12s recording): one segment straddles the end,
// one lies fully outside it. Text = the segments' join (S-D01 contract).
const BOUNDS = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: 'Hello candidate. Tell me about yourself. Ghost words.',
	segments: [
		{ id: 0, start: 0.0, end: 2.0, text: 'Hello candidate.' },
		{ id: 1, start: 2.0, end: 9999.0, text: ' Tell me about yourself.' },
		{ id: 2, start: 100.0, end: 101.0, text: ' Ghost words.' },
	],
};
// #1923 order fixture: GEN1's segments delivered unsorted. Text = the
// segments' join in PROVIDER order (S-D01 contract joins in that order).
const UNSORTED = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: ' I led a team of five.Hello candidate. Tell me about yourself.',
	segments: [
		{ id: 0, start: 6.5, end: 12.0, text: ' I led a team of five.' },
		{ id: 1, start: 0.0, end: 2.0, text: 'Hello candidate.' },
		{ id: 2, start: 2.0, end: 6.5, text: ' Tell me about yourself.' },
	],
};
// #1923 rollback-pin fixture: a valid segment, then one whose end_s
// overflows int8 once converted to ms (1e16 s -> 1e19 ms > 9.22e18).
const OVERFLOW = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: 'Valid opening. Overflow tail.',
	segments: [
		{ id: 0, start: 0.0, end: 2.0, text: 'Valid opening.' },
		{ id: 1, start: 1.0, end: 1e16, text: ' Overflow tail.' },
	],
};

// #1923 tie fixture: two segments share a start; the longer is
// delivered first, so only the (start, end) sort key can order them.
const TIE = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: ' Longer segment. Short segment.',
	segments: [
		{ id: 0, start: 2.0, end: 6.5, text: ' Longer segment.' },
		{ id: 1, start: 2.0, end: 3.0, text: ' Short segment.' },
	],
};
// #1923 all-outside fixture: the only segment lies past the duration.
const ALLOUT = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: ' Ghost words.',
	segments: [{ id: 0, start: 100.0, end: 101.0, text: ' Ghost words.' }],
};

// #1997 pin C fixture: in-bounds times on a KNOWN-duration (12s)
// recording; the second segment's text carries the sentinel the test's
// database trigger raises on. Times pass every bound/clamp untouched —
// only the database can stop this insert.
const TRIGGERFAIL = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: 'Valid opening. TRIGGER-BOOM tail.',
	segments: [
		{ id: 0, start: 0.0, end: 2.0, text: 'Valid opening.' },
		{ id: 1, start: 2.0, end: 5.0, text: ' TRIGGER-BOOM tail.' },
	],
};
// #1997 at-duration fixtures (12s recording): a segment starting
// exactly at the duration (12.0s). Derived from the shipped #1923
// bound (drop when startMs >= durationMs): dropped-and-logged, never
// clamped to a zero-span row.
const ATDUR = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: 'Hello candidate. At-duration ghost.',
	segments: [
		{ id: 0, start: 0.0, end: 2.0, text: 'Hello candidate.' },
		{ id: 1, start: 12.0, end: 13.0, text: ' At-duration ghost.' },
	],
};
const ATDUR_ONLY = {
	task: 'transcription',
	language: 'english',
	duration: 12.0,
	text: ' At-duration ghost.',
	segments: [{ id: 0, start: 12.0, end: 13.0, text: ' At-duration ghost.' }],
};

let asrMode = 'gen1'; // 'gen1' | 'gen2' | 'fail' | 'bounds' | 'unsorted' | 'overflow' | 'tie' | 'allout' | 'trigfail' | 'atdur' | 'atduronly'
let asrServer;
let audioServer;
let asrPort;
let audioPort;
let app;
let request;
let generateToken;
let encryption;
let aiProvider;
let seedPool;
let recordingId;
let purgedRecordingId;

function listen(server) {
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function seedRecording(storageUrl, status = 'completed', durationSeconds = 12) {
	const q = (sql, params) => seedPool.query(sql, params);
	const ev = await q(
		`INSERT INTO interview_events (recruiter_id, candidate_id, status) VALUES ($1, $2, 'completed') RETURNING id`,
		[U_REC, U_CAND],
	);
	const eventId = ev.rows[0].id;
	const room = await q(
		`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status) VALUES ($1, $2, $3, 'closed') RETURNING id`,
		[eventId, `room-${eventId}`, `lk-${eventId}`],
	);
	const rec = await q(
		`INSERT INTO interview_recordings (interview_event_id, room_id, status, duration_seconds, storage_path)
		 VALUES ($1, $2, $3, $5, $4) RETURNING id`,
		[eventId, room.rows[0].id, status, encryption.encrypt(storageUrl), durationSeconds],
	);
	return rec.rows[0].id;
}

async function cleanAndSeed() {
	const q = (sql, params) => seedPool.query(sql, params);
	await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [[U_REC, U_CAND]]);
	await q(`DELETE FROM companies WHERE id = $1`, [C_ID]);
	await q(`INSERT INTO companies (id, name) VALUES ($1, 'S-D02 Co')`, [C_ID]);
	await q(
		`INSERT INTO users (id, email, name, role, company_id) VALUES
		   ($1, 'rec1904@test.local', 'Rec 1904', 'recruiter', $3),
		   ($2, 'cand1904@test.local', 'Cand 1904', 'candidate', NULL)`,
		[U_REC, U_CAND, C_ID],
	);
	recordingId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
	purgedRecordingId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
	// A purged recording: its only transcript row is the [purged] tombstone.
	await q(
		`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
		 VALUES ($1, 'unknown', '[purged]', 0, 12000)`,
		[purgedRecordingId],
	);
}

function recToken() {
	return generateToken({ id: U_REC, email: 'rec1904@test.local', role: 'recruiter' });
}

describeIfDb('#1904 S-D02 recordings segments (realdb journey)', () => {
	beforeAll(async () => {
		// Stubs at the external boundaries — started first so the seeded
		// storage URL and the provider base URL can point at them.
		audioServer = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'audio/mp4' });
			res.end(Buffer.from('synthetic-audio-bytes'));
		});
		audioPort = await listen(audioServer);
		asrServer = http.createServer((req, res) => {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				if (asrMode === 'fail') {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					return res.end(JSON.stringify({ error: 'stub ASR down' }));
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				const payload =
					asrMode === 'gen2'
						? GEN2
						: asrMode === 'bounds'
							? BOUNDS
							: asrMode === 'unsorted'
								? UNSORTED
								: asrMode === 'overflow'
									? OVERFLOW
									: asrMode === 'tie'
										? TIE
										: asrMode === 'allout'
											? ALLOUT
											: asrMode === 'trigfail'
												? TRIGGERFAIL
												: asrMode === 'atdur'
													? ATDUR
													: asrMode === 'atduronly'
														? ATDUR_ONLY
														: GEN1;
				return res.end(JSON.stringify(payload));
			});
		});
		asrPort = await listen(asrServer);

		// Env BEFORE the router (and its provider singleton) load.
		// server/test/setup.js replaced DATABASE_URL with a dummy; restore it.
		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });
		process.env.OPENAI_BASE_URL = `http://127.0.0.1:${asrPort}/v1`;

		seedPool = new Pool({ connectionString: DB_URL });
		encryption = require('../../../services/encryption');
		// The same singleton lib/polsia-ai delegates to (module cache).
		aiProvider = require('../../../lib/ai-provider');
		await cleanAndSeed();

		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const recordingsRouter = require('../../routes/recordings');
		app = express();
		app.use(express.json());
		app.use('/api/interviews/recordings', recordingsRouter);
	});

	// The ASR provider is a stubbed external boundary in this suite; its
	// circuit breaker is boundary health state. A leg failure opens a
	// 5-minute circuit (lib/ai-provider, #1430), which would otherwise
	// poison every later journey step in the process (the shipped AC-4
	// failure case included). Reset it between steps via the provider's
	// own testing hook so each step starts from a healthy boundary.
	beforeEach(() => {
		aiProvider.resetCircuitBreakers();
	});

	afterAll(async () => {
		if (seedPool) await seedPool.end();
		if (asrServer) asrServer.close();
		if (audioServer) audioServer.close();
	});

	test('AC-1: recruiter transcribes → timed segments, ordered, bounded, jointly covering, no words lost', async () => {
		asrMode = 'gen1';
		const res = await request(app)
			.post(`/api/interviews/recordings/${recordingId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		// AC-3 (shape): transcribe response shape unchanged for existing consumers.
		expect(Object.keys(res.body).sort()).toEqual(['success', 'transcript']);
		expect(Object.keys(res.body.transcript).sort()).toEqual(['confidence', 'duration_ms', 'text']);
		expect(res.body.transcript.text).toBe(GEN1.text);

		const got = await request(app)
			.get(`/api/interviews/recordings/${recordingId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.status).toBe(200);
		const segs = got.body.transcript.segments;
		expect(segs.length).toBe(3);
		// BIGINT columns serialise as strings — compare the numbers.
		expect(segs.map((s) => [Number(s.start_time_ms), Number(s.end_time_ms)])).toEqual([
			[0, 2000],
			[2000, 6500],
			[6500, 12000],
		]);
		for (const s of segs) {
			expect(s.speaker_identity).toBe('unknown');
			expect(Number(s.end_time_ms)).toBeGreaterThan(Number(s.start_time_ms));
			expect(Number(s.end_time_ms)).toBeLessThan(12000 + 1);
		}
		// Jointly covering 0 → 12000 with no gaps, text in order = full transcript.
		expect(Number(segs[0].start_time_ms)).toBe(0);
		expect(Number(segs[segs.length - 1].end_time_ms)).toBe(12000);
		expect(segs.map((s) => s.text).join('')).toBe(GEN1.text);

		const dbSegs = await seedPool.query(
			`SELECT speaker_identity, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY start_time_ms`,
			[recordingId],
		);
		expect(dbSegs.rows.length).toBe(3);
	});

	test('AC-3: a highlight attaches to a segment and survives a transcript reload', async () => {
		const got = await request(app)
			.get(`/api/interviews/recordings/${recordingId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		const segId = got.body.transcript.segments[1].id;
		const hl = await request(app)
			.post(`/api/interviews/recordings/transcript/${segId}/highlight`)
			.set('Authorization', `Bearer ${recToken()}`)
			.send({ note: 'Strong answer', timestamp_ms: 3000 });
		expect(hl.status).toBe(201);

		const reloaded = await request(app)
			.get(`/api/interviews/recordings/${recordingId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		const seg = reloaded.body.transcript.segments.find((s) => s.id === segId);
		expect(seg.highlights).toHaveLength(1);
		expect(seg.highlights[0].note).toBe('Strong answer');
	});

	test('AC-3: a purged recording transcript still renders as absence', async () => {
		const got = await request(app)
			.get(`/api/interviews/recordings/${purgedRecordingId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.status).toBe(200);
		expect(got.body.transcript.segment_count).toBe(0);
		expect(got.body.transcript.segments).toEqual([]);
	});

	test('AC-2: re-run replaces the generation atomically — old segments AND diarization artefacts gone in the same result', async () => {
		// Plant diarization artefacts of generation 1 (S-D03 tables).
		const q = (sql, params) => seedPool.query(sql, params);
		const job = await q(
			`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
			[recordingId],
		);
		await q(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb)`,
			[recordingId, job.rows[0].id],
		);
		await q(
			`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state) VALUES ($1, 0, $2, 'candidate', 'proposed')`,
			[recordingId, U_CAND],
		);
		await q(
			`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, actor_user_id, action) VALUES ($1, 0, $2, 'confirm')`,
			[recordingId, U_REC],
		);
		await q(
			`UPDATE interview_recordings SET diarization_status = 'complete', diarization_updated_at = NOW() WHERE id = $1`,
			[recordingId],
		);
		const gen1SegIds = (
			await q(`SELECT id FROM interview_transcripts WHERE recording_id = $1`, [recordingId])
		).rows.map((r) => r.id);
		expect(gen1SegIds.length).toBe(3);

		asrMode = 'gen2';
		const res = await request(app)
			.post(`/api/interviews/recordings/${recordingId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		expect(res.body.transcript.text).toBe(GEN2.text);

		// Exactly one generation exists afterwards: gen-2's two segments only.
		const dbSegs = await q(
			`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY start_time_ms`,
			[recordingId],
		);
		expect(dbSegs.rows.length).toBe(2);
		expect(dbSegs.rows.map((r) => r.text).join('')).toBe(GEN2.text);
		expect(dbSegs.rows.some((r) => gen1SegIds.includes(r.id))).toBe(false);

		// No diarization artefact of the old generation survives anywhere.
		for (const table of [
			'diarization_runs',
			'recording_speaker_mappings',
			'transcript_speaker_audit',
			'diarization_jobs',
		]) {
			const left = await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE recording_id = $1`, [
				recordingId,
			]);
			expect(left.rows[0].n).toBe(0);
		}
		const rec = await q(`SELECT status, diarization_status FROM interview_recordings WHERE id = $1`, [
			recordingId,
		]);
		expect(rec.rows[0].status).toBe('completed');
		expect(rec.rows[0].diarization_status).toBeNull();

		// And the recruiter sees only the new text — no old labels on new text.
		const got = await request(app)
			.get(`/api/interviews/recordings/${recordingId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.body.transcript.segments.map((s) => s.text).join('')).toBe(GEN2.text);
	});

	test('AC-4: all ASR legs fail → recording back to completed with NO transcript rows, nothing partial', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'fail';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(500);
		const rec = await seedPool.query(`SELECT status FROM interview_recordings WHERE id = $1`, [
			freshId,
		]);
		expect(rec.rows[0].status).toBe('completed');
		const rows = await seedPool.query(
			`SELECT COUNT(*)::int AS n FROM interview_transcripts WHERE recording_id = $1`,
			[freshId],
		);
		expect(rows.rows[0].n).toBe(0);
		const got = await request(app)
			.get(`/api/interviews/recordings/${freshId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.body.transcript.segment_count).toBe(0);
	});

	test('#1923 bounds: an out-of-duration segment is clamped to the recording duration and a fully-outside segment is not stored', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'bounds';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		// AC-3 (shape): transcribe response shape unchanged.
		expect(Object.keys(res.body).sort()).toEqual(['success', 'transcript']);
		expect(Object.keys(res.body.transcript).sort()).toEqual(['confidence', 'duration_ms', 'text']);

		// Stored state read back from the DB (insertion order): the
		// straddling segment's end is clamped to the 12s duration and
		// the fully-outside segment (100s on a 12s recording) is absent.
		const dbSegs = await seedPool.query(
			`SELECT text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
			[freshId],
		);
		expect(dbSegs.rows.map((r) => [Number(r.start_time_ms), Number(r.end_time_ms)])).toEqual([
			[0, 2000],
			[2000, 12000],
		]);
		for (const r of dbSegs.rows) {
			expect(Number(r.end_time_ms)).toBeLessThanOrEqual(12000);
		}

		const got = await request(app)
			.get(`/api/interviews/recordings/${freshId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.status).toBe(200);
		expect(got.body.transcript.segments.map((x) => x.text).join('')).toBe(
			'Hello candidate. Tell me about yourself.',
		);
	});

	test('#1923 order: segments delivered unsorted are stored in monotonic start_time_ms order', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'unsorted';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual(['success', 'transcript']);
		expect(Object.keys(res.body.transcript).sort()).toEqual(['confidence', 'duration_ms', 'text']);

		// Stored order = insertion order (id is a serial): on the base
		// handler the ids follow provider order (starts 6500, 0, 2000).
		const dbSegs = await seedPool.query(
			`SELECT text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
			[freshId],
		);
		expect(dbSegs.rows.map((r) => Number(r.start_time_ms))).toEqual([0, 2000, 6500]);
		expect(dbSegs.rows.map((r) => r.text).join('')).toBe(GEN1.text);

		// And the recruiter's read-back tells the story chronologically.
		const got = await request(app)
			.get(`/api/interviews/recordings/${freshId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.body.transcript.segments.map((x) => x.text).join('')).toBe(GEN1.text);
	});

	test('#1923 pin A: a forced mid-transaction failure on re-run leaves the old generation and its diarization artefacts fully intact', async () => {
		// The pin recording carries duration_seconds = NULL: with a known
		// duration the #1923 bound clamps the overflow segment to the
		// duration BEFORE insert and it can never reach Postgres (the fix
		// working as designed). With no honest bound to apply, end_s=1e16
		// becomes end_time_ms=1e19, overflows int8 inside the transaction
		// — after the deletes and the first segment insert.
		const pinId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`, 'completed', null);
		asrMode = 'gen1';
		const first = await request(app)
			.post(`/api/interviews/recordings/${pinId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(first.status).toBe(200);

		const q = (sql, params) => seedPool.query(sql, params);
		const job = await q(
			`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
			[pinId],
		);
		await q(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb)`,
			[pinId, job.rows[0].id],
		);
		await q(
			`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state) VALUES ($1, 0, $2, 'candidate', 'proposed')`,
			[pinId, U_CAND],
		);
		await q(
			`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, actor_user_id, action) VALUES ($1, 0, $2, 'confirm')`,
			[pinId, U_REC],
		);
		await q(
			`UPDATE interview_recordings SET diarization_status = 'complete', diarization_updated_at = NOW() WHERE id = $1`,
			[pinId],
		);
		// M2 (independent review): the NULL duration this pin depends
		// on is asserted from the recording row, not just the seed call.
		const pinRec = await q(`SELECT duration_seconds FROM interview_recordings WHERE id = $1`, [
			pinId,
		]);
		expect(pinRec.rows[0].duration_seconds).toBeNull();
		const genSegs = (
			await q(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[pinId],
			)
		).rows;
		expect(genSegs.length).toBe(3);

		asrMode = 'overflow';
		const res = await request(app)
			.post(`/api/interviews/recordings/${pinId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(500);

		// The whole swap rolled back: gen-1 segments are byte-identical.
		const afterSegs = (
			await q(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[pinId],
			)
		).rows;
		expect(afterSegs).toEqual(genSegs);
		for (const table of [
			'diarization_runs',
			'recording_speaker_mappings',
			'transcript_speaker_audit',
			'diarization_jobs',
		]) {
			const left = await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE recording_id = $1`, [
				pinId,
			]);
			expect(left.rows[0].n).toBe(1);
		}
		const rec = await q(
			`SELECT status, diarization_status FROM interview_recordings WHERE id = $1`,
			[pinId],
		);
		expect(rec.rows[0].status).toBe('completed');
		expect(rec.rows[0].diarization_status).toBe('complete');

		const got = await request(app)
			.get(`/api/interviews/recordings/${pinId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.body.transcript.segments.map((x) => x.text).join('')).toBe(GEN1.text);
	});

	test('#1923 pin B: a re-run with all ASR legs failing preserves the existing generation', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'gen1';
		const first = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(first.status).toBe(200);
		const genSegs = (
			await seedPool.query(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[freshId],
			)
		).rows;
		expect(genSegs.length).toBe(3);

		asrMode = 'fail';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(500);

		const afterSegs = (
			await seedPool.query(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[freshId],
			)
		).rows;
		expect(afterSegs).toEqual(genSegs);
		const rec = await seedPool.query(
			`SELECT status FROM interview_recordings WHERE id = $1`,
			[freshId],
		);
		expect(rec.rows[0].status).toBe('completed');
	});
	test('#1923 bounds: a payload whose only segment lies outside the duration fails honestly and stores nothing', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'allout';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(500);
		const rows = await seedPool.query(
			`SELECT COUNT(*)::int AS n FROM interview_transcripts WHERE recording_id = $1`,
			[freshId],
		);
		expect(rows.rows[0].n).toBe(0);
		const rec = await seedPool.query(
			`SELECT status FROM interview_recordings WHERE id = $1`,
			[freshId],
		);
		expect(rec.rows[0].status).toBe('completed');
	});

	test('#1923 order: equal-start segments are stored ordered by end_time_ms (tie-break)', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'tie';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		const dbSegs = await seedPool.query(
			`SELECT text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
			[freshId],
		);
		expect(dbSegs.rows.map((r) => [Number(r.start_time_ms), Number(r.end_time_ms)])).toEqual([
			[2000, 3000],
			[2000, 6500],
		]);
	});
	test('#1997 GET tie-order: equal-start segments read back in stored (id) order even when physical row order differs', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		const q = (sql, params) => seedPool.query(sql, params);
		// Plant three equal-start segments directly (the purged-tombstone
		// precedent: DB-planted rows are this suite's fixture tool) with
		// explicit ids assigned OUT of insertion order — physical order
		// (hi, lo, mid) differs from stored/id order (lo, mid, hi), as
		// after a restore. The GET contract (Rex, #1997): ties read back
		// in id order. ORDER BY start_time_ms alone returns physical
		// order here (verified on the rig) — that is the red on base.
		const maxRow = await q(`SELECT COALESCE(MAX(id), 0)::int AS m FROM interview_transcripts`);
		const base = maxRow.rows[0].m;
		const lo = base + 1;
		const mid = base + 2;
		const hi = base + 3;
		await q(
			`INSERT INTO interview_transcripts (id, recording_id, speaker_identity, text, start_time_ms, end_time_ms) VALUES
			   ($1, $4, 'unknown', ' Tie planted hi.', 2000, 3000),
			   ($2, $4, 'unknown', ' Tie planted lo.', 2000, 6500),
			   ($3, $4, 'unknown', ' Tie planted mid.', 2000, 4000)`,
			[hi, lo, mid, freshId],
		);
		// Keep the serial sequence ahead of the planted ids.
		await q(`SELECT setval('interview_transcripts_id_seq', $1)`, [hi + 10]);

		const got = await request(app)
			.get(`/api/interviews/recordings/${freshId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.status).toBe(200);
		expect(got.body.transcript.segments.map((x) => Number(x.id))).toEqual([lo, mid, hi]);
		expect(got.body.transcript.segments.map((x) => x.text)).toEqual([
			' Tie planted lo.',
			' Tie planted mid.',
			' Tie planted hi.',
		]);
	});

	test('#1997 pin C: a trigger-forced mid-transaction failure on re-run leaves the old generation and its diarization artefacts fully intact', async () => {
		// Future-proofing complement to pin A (#1997, DB/transactions
		// specialist): pin A's BIGINT-overflow probe only reaches
		// Postgres on a NULL-duration recording — any future bound could
		// make it unreachable. This pin forces the failure with a
		// database trigger on a KNOWN-duration recording with in-bounds
		// times, so nothing in the segment pipeline can pre-empt it.
		const pinId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'gen1';
		const first = await request(app)
			.post(`/api/interviews/recordings/${pinId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(first.status).toBe(200);

		const q = (sql, params) => seedPool.query(sql, params);
		const job = await q(
			`INSERT INTO diarization_jobs (recording_id, status) VALUES ($1, 'complete') RETURNING id`,
			[pinId],
		);
		await q(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb)`,
			[pinId, job.rows[0].id],
		);
		await q(
			`INSERT INTO recording_speaker_mappings (recording_id, speaker_number, participant_user_id, participant_role, state) VALUES ($1, 0, $2, 'candidate', 'proposed')`,
			[pinId, U_CAND],
		);
		await q(
			`INSERT INTO transcript_speaker_audit (recording_id, speaker_number, actor_user_id, action) VALUES ($1, 0, $2, 'confirm')`,
			[pinId, U_REC],
		);
		await q(
			`UPDATE interview_recordings SET diarization_status = 'complete', diarization_updated_at = NOW() WHERE id = $1`,
			[pinId],
		);
		const genSegs = (
			await q(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[pinId],
			)
		).rows;
		expect(genSegs.length).toBe(3);

		// Install the trigger AFTER all seeding (specialist placement
		// rule), as committed statements on this pool — DDL inside an
		// uncommitted test transaction would be invisible to the
		// handler's own connection. Pre-clean first so an aborted prior
		// run cannot poison this one.
		await q(`DROP TRIGGER IF EXISTS test1997_fail_trigger ON interview_transcripts`);
		await q(`DROP FUNCTION IF EXISTS test1997_fail_insert()`);
		await q(
			`CREATE FUNCTION test1997_fail_insert() RETURNS trigger AS $fn$
			 BEGIN
			   IF NEW.text LIKE '%TRIGGER-BOOM%' THEN
			     RAISE EXCEPTION 'test1997 forced mid-transaction failure';
			   END IF;
			   RETURN NEW;
			 END;
			 $fn$ LANGUAGE plpgsql`,
		);
		await q(
			`CREATE TRIGGER test1997_fail_trigger BEFORE INSERT ON interview_transcripts
			 FOR EACH ROW EXECUTE FUNCTION test1997_fail_insert()`,
		);

		// The sentinel segment sorts second (distinct start times), so
		// when it raises, the swap transaction has already executed all
		// five deletes plus one successful insert — rollback must undo
		// both. Teardown runs in finally, BEFORE the assertions below
		// (specialist rule), trigger before function (dependency order).
		let res;
		try {
			asrMode = 'trigfail';
			res = await request(app)
				.post(`/api/interviews/recordings/${pinId}/transcribe`)
				.set('Authorization', `Bearer ${recToken()}`);
		} finally {
			await q(`DROP TRIGGER IF EXISTS test1997_fail_trigger ON interview_transcripts`);
			await q(`DROP FUNCTION IF EXISTS test1997_fail_insert()`);
		}
		expect(res.status).toBe(500);

		const trigLeft = await q(
			`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname = 'test1997_fail_trigger'`,
		);
		expect(trigLeft.rows[0].n).toBe(0);

		const afterSegs = (
			await q(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[pinId],
			)
		).rows;
		expect(afterSegs).toEqual(genSegs);
		for (const table of [
			'diarization_runs',
			'recording_speaker_mappings',
			'transcript_speaker_audit',
			'diarization_jobs',
		]) {
			const left = await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE recording_id = $1`, [
				pinId,
			]);
			expect(left.rows[0].n).toBe(1);
		}
		const rec = await q(
			`SELECT status, diarization_status FROM interview_recordings WHERE id = $1`,
			[pinId],
		);
		expect(rec.rows[0].status).toBe('completed');
		expect(rec.rows[0].diarization_status).toBe('complete');

		const got = await request(app)
			.get(`/api/interviews/recordings/${pinId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.body.transcript.segments.map((x) => x.text).join('')).toBe(GEN1.text);
	});

	test('#1997 at-duration: a segment starting exactly at the recording duration is dropped; in-bounds segments are stored', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'atdur';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual(['success', 'transcript']);
		expect(Object.keys(res.body.transcript).sort()).toEqual(['confidence', 'duration_ms', 'text']);

		// Stored read-back: exactly the in-bounds row — no at-duration
		// row, and no zero-span [12000, 12000] clamp artefact.
		const dbSegs = await seedPool.query(
			`SELECT text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
			[freshId],
		);
		expect(dbSegs.rows.map((r) => [Number(r.start_time_ms), Number(r.end_time_ms)])).toEqual([
			[0, 2000],
		]);

		const got = await request(app)
			.get(`/api/interviews/recordings/${freshId}/transcript`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(got.status).toBe(200);
		expect(got.body.transcript.segments.map((x) => x.text).join('')).toBe('Hello candidate.');
	});

	test('#1997 at-duration: a re-run whose only segment starts exactly at the duration fails honestly and leaves the old generation untouched', async () => {
		const freshId = await seedRecording(`http://127.0.0.1:${audioPort}/audio.mp4`);
		asrMode = 'gen1';
		const first = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(first.status).toBe(200);
		const genSegs = (
			await seedPool.query(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[freshId],
			)
		).rows;
		expect(genSegs.length).toBe(3);

		asrMode = 'atduronly';
		const res = await request(app)
			.post(`/api/interviews/recordings/${freshId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`);
		expect(res.status).toBe(500);

		const afterSegs = (
			await seedPool.query(
				`SELECT id, text, start_time_ms, end_time_ms FROM interview_transcripts WHERE recording_id = $1 ORDER BY id`,
				[freshId],
			)
		).rows;
		expect(afterSegs).toEqual(genSegs);
		const rec = await seedPool.query(
			`SELECT status FROM interview_recordings WHERE id = $1`,
			[freshId],
		);
		expect(rec.rows[0].status).toBe('completed');
	});

});
