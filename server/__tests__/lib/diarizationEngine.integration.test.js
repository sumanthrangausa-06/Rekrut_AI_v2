/**
 * diarizationEngine.integration.test.js — S-D05 (#1907), HL-003 gate.
 *
 * NO test doubles on the path under test: real worker + real consent
 * gate + real diarizationJobs against a real fresh-migrated Postgres,
 * real ffmpeg decode, real per-job child process running the REAL
 * pinned vendor engine (@desert-ant-labs/who@4.2.1, installed in the
 * worker scope) on the spike's synthetic 121 s two-voice fixture.
 * The ONLY injected seam is fetchAudio returning the fixture buffer
 * (the fixture has no storage object; the storage fetch itself is
 * the transcribe handler's already-proven livekitService path).
 *
 * AC map: AC-2 run row carries engine_package / sdk_version=4.2.1 /
 * model_version=v0.3.4 and turns scoring ≥98% correct attribution
 * with 2 speakers against the spike ground truth (10 ms grid,
 * best-overlap mapping — the spike scorer's method) · AC-3 no new
 * files in the repo tree during/after the run (git status identical)
 * and no audio/weights artefacts under the worker dir outside
 * node_modules · AC-4 failure leg: an engine error fails the job
 * with its class and persists NO run row.
 *
 * Gated behind DIARIZATION_INTEGRATION_DB_URL (same pattern as the
 * S-D04 integration suite). DATABASE_URL must point at the same DB.
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55433/sd05_e2e \
 *   DIARIZATION_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/sd05_e2e' \
 *   DIARIZATION_WEIGHTS_DIR=$HOME/.cache/rekrut-diarization/weights \
 *     npx jest server/__tests__/lib/diarizationEngine.integration.test.js --forceExit
 *
 * SERIALIZED INVOCATION (#1941 harness lane — MUST run alone):
 * this suite MUST be run alone, in its own jest invocation, with
 * --runInBand --forceExit — never inside parallel regression batches
 * and never concurrent with other suites. Ops rule (#1918/#1941):
 * before running, require ≥2 GB available RAM and /tmp headroom.
 * The engine child peaks ~850 MB on a no-swap VM; in a low-memory
 * window the kernel OOM-kills it and the job fails as engine_oom
 * (the harness retries that class exactly once — see AC-2 below).
 */
jest.unmock('../../../lib/db');

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { Pool } = require('pg');

const DB_URL = process.env.DIARIZATION_INTEGRATION_DB_URL;
const SPIKE_DIR =
	process.env.SPIKE_DIR || path.join(process.env.HOME, 'workspace', 'spikes', 'who-diarization');
const WAV_PATH = path.join(SPIKE_DIR, 'audio', 'interview_mixed.wav');
const GT_PATH = path.join(SPIKE_DIR, 'audio', 'ground_truth.json');

const describeIfDb = DB_URL ? describe : describe.skip;

/**
 * AC-3 scoping (#1941): keep only git-status entries under workers/ —
 * the tree the engine child can actually dirty. Porcelain lines are
 * `XY <path>` (renames: `XY <orig> -> <path>`; the destination is
 * what exists in the tree now).
 */
function scopeStatusToWorkers(status) {
	return status
		.split('\n')
		.filter((line) => {
			if (!line.trim()) return false;
			const p = line.slice(3).split(' -> ').pop();
			return p === 'workers' || p.startsWith('workers/');
		})
		.join('\n');
}

/** Spike-scorer method: 10 ms grid, best-overlap speaker mapping. */
function scoreAttribution(gt, turns) {
	const gridMs = 10;
	const durationMs = Math.round(gt.duration_s * 1000);
	// best-overlap mapping: engine speaker -> gt speaker by overlap time
	const overlap = new Map();
	for (const t of turns) {
		for (const g of gt.turns) {
			const start = Math.max(t.start_s, g.start_s);
			const end = Math.min(t.end_s, g.end_s);
			if (end > start) {
				const key = `${t.speaker}|${g.speaker}`;
				overlap.set(key, (overlap.get(key) || 0) + (end - start));
			}
		}
	}
	const mapping = new Map();
	const usedGt = new Set();
	const pairs = [...overlap.entries()].sort((a, b) => b[1] - a[1]);
	for (const [key, _v] of pairs) {
		const [eng, gtSp] = key.split('|');
		if (!mapping.has(+eng) && !usedGt.has(gtSp)) {
			mapping.set(+eng, gtSp);
			usedGt.add(gtSp);
		}
	}
	let speechMs = 0;
	let correctMs = 0;
	for (let t = 0; t < durationMs; t += gridMs) {
		const ts = t / 1000;
		const g = gt.turns.find((x) => ts >= x.start_s && ts < x.end_s);
		if (!g) continue;
		speechMs += gridMs;
		const e = turns.find((x) => ts >= x.start_s && ts < x.end_s);
		if (e && mapping.get(e.speaker) === g.speaker) correctMs += gridMs;
	}
	return speechMs ? correctMs / speechMs : 0;
}

describeIfDb('diarization engine (real child, real DB — S-D05)', () => {
	jest.setTimeout(180000);
	let pool;
	let consentService;
	let diarizationJobs;
	let worker;
	let candidateId;
	let sessionId;
	let recordingId;

	/**
	 * Read a diarization_jobs row back INSIDE the test (#1941): the
	 * afterAll teardown deletes the recording and the cascade takes
	 * the job rows with it, so a failed job's error_class /
	 * error_message can only ever be captured here, before teardown.
	 */
	async function readJobRow(jobId) {
		const { rows } = await pool.query(
			`SELECT id, status, error_class, error_message FROM diarization_jobs WHERE id = $1`,
			[jobId],
		);
		return rows[0] || null;
	}

	beforeAll(async () => {
		process.env.DATABASE_URL = DB_URL;
		jest.resetModules();
		pool = new Pool({ connectionString: DB_URL });
		consentService = require('../../../lib/consentService');
		diarizationJobs = require('../../../lib/diarizationJobs');
		worker = require('../../../workers/diarization/index');

		const cand = await pool.query(
			`INSERT INTO users (email) VALUES ('sd05-candidate@example.test') RETURNING id`,
		);
		candidateId = cand.rows[0].id;
		const rec = await pool.query(
			`INSERT INTO users (email) VALUES ('sd05-recruiter@example.test') RETURNING id`,
		);
		const sess = await pool.query(
			`INSERT INTO interview_sessions (candidate_id, type, config, conversation, current_question_index)
			 VALUES ($1, 'human', '{}'::jsonb, '[]'::jsonb, 0) RETURNING id`,
			[candidateId],
		);
		sessionId = sess.rows[0].id;
		const recRow = await pool.query(
			`INSERT INTO interview_recordings (interview_event_id, interview_session_id, status, retention_expires_at)
			 VALUES (NULL, $1, 'completed', NOW() + INTERVAL '90 days') RETURNING id`,
			[sessionId],
		);
		recordingId = recRow.rows[0].id;
		await pool.query(
			`INSERT INTO interview_transcripts (recording_id, speaker_identity, text, start_time_ms, end_time_ms)
			 VALUES ($1, 'unknown', 'hello world', 0, 1000)`,
			[recordingId],
		);
		await consentService.recordConsent({
			sessionId,
			candidateId,
			type: 'biometric',
			accepted: true,
			locale: 'en',
		});
	});

	afterAll(async () => {
		await pool.query(`DELETE FROM interview_recordings WHERE id = $1`, [recordingId]).catch(() => {});
		await pool.query(`DELETE FROM interview_sessions WHERE id = $1`, [sessionId]).catch(() => {});
		await pool.query(`DELETE FROM users WHERE email LIKE 'sd05-%@example.test'`).catch(() => {});
		await pool.end();
		const db = require('../../../lib/db');
		if (db.end) await db.end().catch(() => {});
	});

	it('AC-2/AC-3: the spike fixture diarizes through the real worker path; run row + score read back', async () => {
		expect(fs.existsSync(WAV_PATH)).toBe(true);
		const wav = fs.readFileSync(WAV_PATH);
		const repoStatusBefore = execSync('git status --porcelain', {
			cwd: path.join(__dirname, '..', '..', '..'),
			encoding: 'utf8',
		});

		await diarizationJobs.enqueue(recordingId);
		let job = await diarizationJobs.claim('sd05-it-worker');
		let result = await worker.processJob(job, { fetchAudio: async () => wav });

		if (result.outcome !== 'complete') {
			// #1941: never fail bare — capture the job row before
			// teardown cascade-deletes it, and log it either way.
			const attemptRow = await readJobRow(job.id);
			console.error('[sd05-gate] AC-2 attempt 1 job row:', attemptRow);
			if (result.outcome === 'failed' && result.errorClass === 'engine_oom') {
				// Single retry on engine_oom ONLY (#1941): a fresh job,
				// claimed and processed exactly once more. Any other
				// errorClass — and any second failure — does not retry.
				// Claim loop: claim() returns retryable failed rows
				// oldest-first, so the first claim re-claims attempt 1 —
				// and processing THAT row after a fresh enqueue returns
				// 'superseded' (the fresh row made its generation stale;
				// proven by the #1941 probe-b first run). Keep claiming
				// until the fresh row itself is returned and process
				// only it; the re-claimed attempt-1 row stays claimed
				// and is cascade-deleted with the recording at teardown.
				const fresh = await diarizationJobs.enqueue(recordingId);
				job = await diarizationJobs.claim('sd05-it-worker');
				while (job && job.id !== fresh.id) {
					job = await diarizationJobs.claim('sd05-it-worker');
				}
				if (job) {
					result = await worker.processJob(job, { fetchAudio: async () => wav });
				}
			}
			if (result.outcome !== 'complete') {
				const failedRow = job ? await readJobRow(job.id) : attemptRow;
				console.error('[sd05-gate] AC-2 failed job row:', failedRow);
				throw new Error(
					`AC-2 diarization job did not complete: result=${JSON.stringify(result)} job row=${JSON.stringify(failedRow)}`,
				);
			}
		}

		const { rows } = await pool.query(
			`SELECT engine_package, sdk_version, model_version, speaker_count, turns, coverage_end_ms
			 FROM diarization_runs WHERE recording_id = $1`,
			[recordingId],
		);
		expect(rows).toHaveLength(1);
		const run = rows[0];
		expect(run.engine_package).toBe('@desert-ant-labs/who');
		expect(run.sdk_version).toBe('4.2.1');
		expect(run.model_version).toBe('v0.3.4');
		expect(run.speaker_count).toBe(2);
		expect(run.turns.length).toBeGreaterThanOrEqual(10);
		expect(Number(run.coverage_end_ms)).toBeGreaterThan(100000);

		const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
		const correct = scoreAttribution(gt, run.turns);
		console.log(`[sd05-gate] attribution correct share = ${(correct * 100).toFixed(2)}%`);
		expect(correct).toBeGreaterThanOrEqual(0.98);

		// AC-3 sweep: the run created no files in the repo tree.
		// #1941: the comparison is scoped to workers/ — the tree the
		// engine child can actually dirty. The whole-clone comparison
		// failed whenever any concurrent unrelated write landed in
		// this shared clone during the engine window, engine healthy.
		const repoStatusAfter = execSync('git status --porcelain', {
			cwd: path.join(__dirname, '..', '..', '..'),
			encoding: 'utf8',
		});
		const scopedBefore = scopeStatusToWorkers(repoStatusBefore);
		const scopedAfter = scopeStatusToWorkers(repoStatusAfter);
		if (scopedAfter !== scopedBefore) {
			console.error(
				'[sd05-gate] AC-3 workers/ mismatch — full unfiltered diff (before vs after):\n' +
					`BEFORE:\n${repoStatusBefore}\nAFTER:\n${repoStatusAfter}`,
			);
		}
		expect(scopedAfter).toBe(scopedBefore);
		const stray = execSync(
			`find workers -path '*/node_modules' -prune -o -type f \\( -name '*.wav' -o -name '*.pcm' -o -name '*.tflite' -o -name '*.onnx' \\) -print`,
			{ cwd: path.join(__dirname, '..', '..', '..'), encoding: 'utf8' },
		);
		expect(stray.trim()).toBe('');
	});

	it('AC-4: an engine failure fails the job with its class and persists no run row', async () => {
		await diarizationJobs.enqueue(recordingId);
		const job = await diarizationJobs.claim('sd05-it-worker');
		const failingEngine = async () => {
			const err = new Error('child died');
			err.errorClass = 'engine_oom';
			throw err;
		};
		const result = await worker.processJob(job, { runEngine: failingEngine });

		expect(result).toEqual({ outcome: 'failed', errorClass: 'engine_oom' });
		const { rows } = await pool.query(
			`SELECT status, error_class FROM diarization_jobs WHERE id = $1`,
			[job.id],
		);
		expect(rows[0]).toEqual({ status: 'failed', error_class: 'engine_oom' });
		const runs = await pool.query(
			`SELECT COUNT(*)::int AS n FROM diarization_runs WHERE recording_id = $1 AND job_id = $2`,
			[recordingId, job.id],
		);
		expect(runs.rows[0].n).toBe(0);
	});
});
