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
		const job = await diarizationJobs.claim('sd05-it-worker');
		const result = await worker.processJob(job, { fetchAudio: async () => wav });

		expect(result.outcome).toBe('complete');

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

		// AC-3 sweep: the run created no files in the repo tree
		const repoStatusAfter = execSync('git status --porcelain', {
			cwd: path.join(__dirname, '..', '..', '..'),
			encoding: 'utf8',
		});
		expect(repoStatusAfter).toBe(repoStatusBefore);
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
