/**
 * #1931 items 1 + 2 — diarization_runs UNIQUE(job_id) + re-transcription
 * lock-first (follow-up from PR #1930, review MINOR-3).
 *
 * Item 1 (real DB, no mocks): a second diarization_runs row carrying the
 * SAME non-null job_id must be rejected by the SCHEMA (SQLSTATE 23505)
 * after migration 301 — today the only guard is persistStitch's
 * in-transaction existence check, so a direct insert succeeds (the
 * hole). NULL job_id rows must stay unlimited (Postgres UNIQUE allows
 * multiple NULLs — the desired semantics: at most one run per job).
 *
 * Item 2 (real route, real DB): the POST /:id/transcribe segment-swap
 * transaction must lock in persistStitch's order — diarization_jobs
 * row(s) FOR UPDATE (id order), then the interview_recordings row
 * FOR UPDATE — before any DELETE, so a stitch and a re-transcription
 * serialise instead of interleaving around the generation guard, and
 * (database-reviewer BLOCK) no AB–BA deadlock cycle opens against a
 * stitch holding its job row. Two behavioural scenarios, each with a
 * seeded job + run + a 3-segment old generation (GEN2 has 2, so
 * counts cannot coincide), probed from a third connection with
 * FOR UPDATE NOWAIT and EXACT row-count assertions (a probe that
 * locks 0 rows has proven nothing and fails):
 *   - Scenario 1: the holder takes job → recording (persistStitch's
 *     shape). The swap must park before touching anything: the run
 *     row and all 3 old segments stay lockable, the old generation
 *     stays visible; after release the swap completes (200) and only
 *     the new generation exists. Pre-fix, the swap deletes the old
 *     segments and the probe fails 55P03 (lock_not_available).
 *   - Scenario 2: the holder takes the JOB row only (a stitch caught
 *     between its two locks — the deadlock window). Jobs-first: the
 *     swap parks on its first statement holding nothing, run row
 *     untouched. The rejected recording-only variant would take the
 *     recording lock and delete the run row before blocking on the
 *     job DELETE → the probe fails 55P03 on the run row. This is the
 *     scenario that behaviourally discriminates the two shapes.
 * Stubs live only at the two true external boundaries (object storage
 * + ASR provider), exactly as the #1904 suite: the handler and the DB
 * — where this behaviour lives — are never mocked.
 * A structural test pins the lock order in the source (BEGIN → jobs
 * FOR UPDATE → recording FOR UPDATE → first DELETE) as a backstop.
 *
 * Run:
 *   RUNS1931_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd1931_e2e' \
 *     npx jest server/__tests__/routes/recordings-1931-lockfirst.integration.test.js --forceExit
 */
jest.unmock('../../../lib/db');

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Pool } = require('pg');

const DB_URL = process.env.RUNS1931_INTEGRATION_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

jest.setTimeout(60000);

// ─── Structural pin (runs with or without a DB) ──────────────────────

describe('#1931 item 2 — structural: recording-row lock precedes the swap deletes', () => {
	it('the transcribe swap transaction locks jobs then the recording row (stitch order) before its first DELETE', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../routes/recordings.js'), 'utf8');
		const begin = src.indexOf("await client.query('BEGIN')");
		expect(begin).toBeGreaterThan(-1);
		const afterBegin = src.slice(begin);
		const jobLockIdx = afterBegin.search(
			/SELECT[\s\S]{0,160}?FROM\s+diarization_jobs[\s\S]{0,160}?FOR UPDATE/,
		);
		const lockIdx = afterBegin.search(
			/SELECT[\s\S]{0,120}?FROM\s+interview_recordings[\s\S]{0,120}?FOR UPDATE/,
		);
		const deleteIdx = afterBegin.search(/DELETE FROM diarization_runs/);
		expect(jobLockIdx).toBeGreaterThan(-1);
		expect(lockIdx).toBeGreaterThan(-1);
		expect(deleteIdx).toBeGreaterThan(-1);
		// Global order (database-reviewer, #1931): jobs → recording →
		// deletes — the same order persistStitch acquires its locks, so
		// the two paths can never hold one lock while awaiting the other.
		expect(jobLockIdx).toBeLessThan(lockIdx);
		expect(lockIdx).toBeLessThan(deleteIdx);
	});
});

// ─── Real-DB suites ──────────────────────────────────────────────────

const U_REC = 193101;
const U_CAND = 193102;
const C_ID = 19311;

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

describeIfDb('#1931 items 1 + 2 (real DB — fresh-install rig)', () => {
	let pool;
	let app;
	let request;
	let generateToken;
	let encryption;
	let aiProvider;
	let asrServer;
	let audioServer;
	let asrPort;
	let audioPort;
	let lockA;
	let lockB;

	function listen(server) {
		return new Promise((resolve) =>
			server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
		);
	}

	function recToken() {
		return generateToken({ id: U_REC, email: 'rec1931@test.local', role: 'recruiter' });
	}

	async function seedJobAndRecording() {
		const ev = await pool.query(
			`INSERT INTO interview_events (recruiter_id, candidate_id, duration_minutes, timezone, status)
			 VALUES ($1, $2, 60, 'UTC', 'completed') RETURNING id`,
			[U_REC, U_CAND],
		);
		const rec = await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, status, retention_expires_at)
			 VALUES ($1, 'completed', NOW() + INTERVAL '90 days') RETURNING id`,
			[ev.rows[0].id],
		);
		const job = await pool.query(
			`INSERT INTO diarization_jobs (recording_id, status, attempt_count) VALUES ($1, 'complete', 1) RETURNING id`,
			[rec.rows[0].id],
		);
		return { recordingId: rec.rows[0].id, jobId: job.rows[0].id };
	}

	beforeAll(async () => {
		audioServer = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'audio/mp4' });
			res.end(Buffer.from('synthetic-audio-bytes'));
		});
		audioPort = await listen(audioServer);
		asrServer = http.createServer((req, res) => {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				// Slow ASR leg: gives the lock test a deterministic window
				// in which the claim has committed but the swap has not
				// yet begun.
				setTimeout(() => {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(GEN2));
				}, 1500);
			});
		});
		asrPort = await listen(asrServer);

		process.env.DATABASE_URL = DB_URL;
		process.env.ENCRYPTION_KEY = 'a'.repeat(64);
		process.env.AI_KEYS_JSON = JSON.stringify({ openai: 'test-key' });
		process.env.OPENAI_BASE_URL = `http://127.0.0.1:${asrPort}/v1`;

		pool = new Pool({ connectionString: DB_URL });
		encryption = require('../../../services/encryption');
		aiProvider = require('../../../lib/ai-provider');

		await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[U_REC, U_CAND]]);
		await pool.query(`DELETE FROM companies WHERE id = $1`, [C_ID]);
		await pool.query(`INSERT INTO companies (id, name) VALUES ($1, '1931 Co')`, [C_ID]);
		await pool.query(
			`INSERT INTO users (id, email, name, role, company_id) VALUES
			   ($1, 'rec1931@test.local', 'Rec 1931', 'recruiter', $3),
			   ($2, 'cand1931@test.local', 'Cand 1931', 'candidate', NULL)`,
			[U_REC, U_CAND, C_ID],
		);

		// Lock-test recordings: completed, event-linked, each with a
		// processing diarization job, one run row for that job, and a
		// 3-segment gen-1 generation the re-transcription will replace.
		async function seedLockRecording() {
			const ev = await pool.query(
				`INSERT INTO interview_events (recruiter_id, candidate_id, status) VALUES ($1, $2, 'completed') RETURNING id`,
				[U_REC, U_CAND],
			);
			const room = await pool.query(
				`INSERT INTO interview_rooms (interview_event_id, room_name, livekit_room_id, status) VALUES ($1, $2, $3, 'closed') RETURNING id`,
				[ev.rows[0].id, `room-1931-${ev.rows[0].id}`, `lk-1931-${ev.rows[0].id}`],
			);
			const rec = await pool.query(
				`INSERT INTO interview_recordings (interview_event_id, room_id, status, duration_seconds, storage_path, diarization_status)
				 VALUES ($1, $2, 'completed', 12, $3, 'processing') RETURNING id`,
				[ev.rows[0].id, room.rows[0].id, encryption.encrypt(`http://127.0.0.1:${audioPort}/audio.mp4`)],
			);
			const recordingId = rec.rows[0].id;
			const job = await pool.query(
				`INSERT INTO diarization_jobs (recording_id, status, attempt_count) VALUES ($1, 'processing', 1) RETURNING id`,
				[recordingId],
			);
			const run = await pool.query(
				`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb) RETURNING id`,
				[recordingId, job.rows[0].id],
			);
			const segmentIds = [];
			for (const [start, end, text] of [
				[0, 4000, 'Old one.'],
				[4000, 8000, ' Old two.'],
				[8000, 12000, ' Old three.'],
			]) {
				const s = await pool.query(
					`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
					 VALUES ($1, 'unknown', $2, $3, $4) RETURNING id`,
					[recordingId, text, start, end],
				);
				segmentIds.push(s.rows[0].id);
			}
			return { recordingId, jobId: job.rows[0].id, runId: run.rows[0].id, segmentIds };
		}
		lockA = await seedLockRecording();
		lockB = await seedLockRecording();

		const express = require('express');
		request = require('supertest');
		({ generateToken } = require('../../../lib/auth'));
		const recordingsRouter = require('../../routes/recordings');
		app = express();
		app.use(express.json());
		app.use('/api/interviews/recordings', recordingsRouter);
	});

	beforeEach(() => {
		aiProvider.resetCircuitBreakers();
	});

	afterAll(async () => {
		await pool.query(`DELETE FROM interview_events WHERE candidate_id = $1`, [U_CAND]).catch(() => {});
		await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[U_REC, U_CAND]]).catch(() => {});
		await pool.query(`DELETE FROM companies WHERE id = $1`, [C_ID]).catch(() => {});
		await pool.end().catch(() => {});
		if (asrServer) asrServer.close();
		if (audioServer) audioServer.close();
		const db = require('../../../lib/db');
		if (db.end) await db.end().catch(() => {});
	});

	// ── Item 1 ────────────────────────────────────────────────────────

	it('item 1: a second diarization_runs row with the same job_id is rejected by the schema (23505)', async () => {
		const { recordingId, jobId } = await seedJobAndRecording();
		await pool.query(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb)`,
			[recordingId, jobId],
		);
		await expect(
			pool.query(
				`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb)`,
				[recordingId, jobId],
			),
		).rejects.toMatchObject({ code: '23505' });
		const count = await pool.query(
			`SELECT COUNT(*)::int AS n FROM diarization_runs WHERE job_id = $1`,
			[jobId],
		);
		expect(count.rows[0].n).toBe(1);
	});

	it('item 1: NULL job_id rows stay unlimited, and different jobs may each hold one run', async () => {
		const a = await seedJobAndRecording();
		const b = await seedJobAndRecording();
		await pool.query(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, NULL, '@desert-ant-labs/who', '[]'::jsonb)`,
			[a.recordingId],
		);
		await pool.query(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, NULL, '@desert-ant-labs/who', '[]'::jsonb)`,
			[a.recordingId],
		);
		await pool.query(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb)`,
			[a.recordingId, a.jobId],
		);
		await pool.query(
			`INSERT INTO diarization_runs (recording_id, job_id, engine_package, turns) VALUES ($1, $2, '@desert-ant-labs/who', '[]'::jsonb)`,
			[b.recordingId, b.jobId],
		);
		const nulls = await pool.query(
			`SELECT COUNT(*)::int AS n FROM diarization_runs WHERE recording_id = $1 AND job_id IS NULL`,
			[a.recordingId],
		);
		expect(nulls.rows[0].n).toBe(2);
	});

	// ── Item 2 ────────────────────────────────────────────────────────

	async function waitForClaim(recordingId) {
		// The handler's claim has committed (status 'processing') —
		// the swap itself cannot have begun: the ASR leg takes 1500 ms.
		for (let i = 0; i < 80; i++) {
			const st = await pool.query(`SELECT status FROM interview_recordings WHERE id = $1`, [
				recordingId,
			]);
			if (st.rows[0].status === 'processing') return true;
			await new Promise((r) => setTimeout(r, 25));
		}
		return false;
	}

	async function probeLocks(probe, fixture) {
		// NOWAIT-lock the run row and every old segment from a third
		// connection; returns the locked row counts or the error.
		await probe.query('BEGIN');
		try {
			const run = await probe.query(
				`SELECT id FROM diarization_runs WHERE id = $1 FOR UPDATE NOWAIT`,
				[fixture.runId],
			);
			const segs = await probe.query(
				`SELECT id FROM interview_transcripts WHERE id = ANY($1::int[]) FOR UPDATE NOWAIT`,
				[fixture.segmentIds],
			);
			await probe.query('ROLLBACK').catch(() => {});
			return { error: null, runRows: run.rows.length, segRows: segs.rows.length };
		} catch (err) {
			await probe.query('ROLLBACK').catch(() => {});
			return { error: err, runRows: -1, segRows: -1 };
		}
	}

	function fireTranscribe(recordingId) {
		// .then() is attached immediately: supertest only sends the
		// request once the thenable is engaged.
		return request(app)
			.post(`/api/interviews/recordings/${recordingId}/transcribe`)
			.set('Authorization', `Bearer ${recToken()}`)
			.then((r) => r);
	}

	async function expectGenerationReplaced(fixture) {
		const after = await pool.query(
			`SELECT id, text FROM interview_transcripts WHERE recording_id = $1 ORDER BY start_time_ms`,
			[fixture.recordingId],
		);
		expect(after.rows.map((r) => r.text).join('')).toBe(GEN2.text);
		expect(after.rows.some((r) => fixture.segmentIds.includes(r.id))).toBe(false);
		const runs = await pool.query(
			`SELECT COUNT(*)::int AS n FROM diarization_runs WHERE recording_id = $1`,
			[fixture.recordingId],
		);
		expect(runs.rows[0].n).toBe(0); // old run deleted with its generation
	}

	it('item 2 (scenario 1): while a stitch-shaped holder owns job → recording, the swap touches nothing; after release it completes and replaces the generation', async () => {
		const holder = await pool.connect();
		const probe = await pool.connect();
		let responsePromise;
		try {
			responsePromise = fireTranscribe(lockA.recordingId);
			expect(await waitForClaim(lockA.recordingId)).toBe(true);

			// persistStitch's exact lock shape: job row, then recording.
			await holder.query('BEGIN');
			await holder.query(`SELECT id FROM diarization_jobs WHERE id = $1 FOR UPDATE`, [
				lockA.jobId,
			]);
			await holder.query(`SELECT id FROM interview_recordings WHERE id = $1 FOR UPDATE`, [
				lockA.recordingId,
			]);

			// Give the handler time to finish ASR and attempt its swap.
			await new Promise((r) => setTimeout(r, 2000));

			const probeResult = await probeLocks(probe, lockA);
			expect(probeResult.error).toBeNull();
			expect(probeResult.runRows).toBe(1);
			expect(probeResult.segRows).toBe(3);

			// The old (3-segment) generation is still the visible state.
			const visible = await pool.query(
				`SELECT COUNT(*)::int AS n FROM interview_transcripts WHERE recording_id = $1`,
				[lockA.recordingId],
			);
			expect(visible.rows[0].n).toBe(3);

			await holder.query('COMMIT');
		} finally {
			await holder.query('ROLLBACK').catch(() => {});
			holder.release();
			probe.release();
		}

		const res = await responsePromise;
		expect(res.status).toBe(200);
		await expectGenerationReplaced(lockA);
	});

	it('item 2 (scenario 2): while a stitch holds ONLY its job row (the deadlock window), the jobs-first swap parks holding nothing — the run row stays lockable', async () => {
		const holder = await pool.connect();
		const probe = await pool.connect();
		let responsePromise;
		try {
			responsePromise = fireTranscribe(lockB.recordingId);
			expect(await waitForClaim(lockB.recordingId)).toBe(true);

			// A stitch caught between its two locks: job held,
			// recording not yet taken.
			await holder.query('BEGIN');
			await holder.query(`SELECT id FROM diarization_jobs WHERE id = $1 FOR UPDATE`, [
				lockB.jobId,
			]);

			await new Promise((r) => setTimeout(r, 2000));

			// Jobs-first: the swap is parked on its first statement and
			// has deleted nothing — the run row still locks. The
			// recording-only variant would have deleted it (55P03).
			const probeResult = await probeLocks(probe, lockB);
			expect(probeResult.error).toBeNull();
			expect(probeResult.runRows).toBe(1);
			expect(probeResult.segRows).toBe(3);

			await holder.query('COMMIT');
		} finally {
			await holder.query('ROLLBACK').catch(() => {});
			holder.release();
			probe.release();
		}

		const res = await responsePromise;
		expect(res.status).toBe(200);
		await expectGenerationReplaced(lockB);
	});
});
