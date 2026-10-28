/**
 * diarizationEngine.test.js — S-D05 (#1907)
 * Supervisor side (lib/diarizationEngine.js): ffmpeg decode seam,
 * per-job child lifecycle, §3.5 failure taxonomy.
 *
 * AC map: AC-3 audio path is pipe-to-memory (decode reads stdin,
 * writes stdout; the child receives PCM on stdin — no file path is
 * ever passed) · AC-4 child killed (SIGKILL) → engine_oom, timeout →
 * engine_timeout, supervisor survives and the NEXT call succeeds,
 * no partial output (a failed call resolves nothing) · AC-2 shape:
 * a successful child returns {speakerCount, turns, engine} with the
 * §3.5 provenance fields.
 *
 * The child is a fake .mjs script per case (the real vendor child is
 * exercised by the Quinn HL-003 gate with the spike fixture).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
	decodeToPcm,
	runEngineChild,
	diarizeAudio,
	provisionWeights,
	DiarizationEngineError,
} = require('../../../lib/diarizationEngine');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd05-engine-'));

function writeChild(name, body) {
	const p = path.join(tmp, name);
	fs.writeFileSync(p, body);
	return p;
}

const OK_CHILD = writeChild(
	'ok.mjs',
	`let n = 0; for await (const c of process.stdin) n += c.length;
	 if (process.argv[2] === '--provision') { process.stdout.write('{}'); process.exit(0); }
	 process.stdout.write(JSON.stringify({
	   speakerCount: 2,
	   turns: [{ speaker: 0, start_s: 0, end_s: 1.5 }],
	   engine: { package: '@desert-ant-labs/who', sdkVersion: '4.2.1', modelVersion: 'v0.3.4' },
	   stdinBytes: n,
	 }));`,
);
const FAIL_CHILD = writeChild(
	'fail.mjs',
	`console.error('engine exploded'); process.exit(3);`,
);
const KILLED_CHILD = writeChild(
	'killed.mjs',
	`process.kill(process.pid, 'SIGKILL');`,
);
const SLEEP_CHILD = writeChild(
	'sleep.mjs',
	`setTimeout(() => {}, 60000);`,
);
const GARBAGE_CHILD = writeChild(
	'garbage.mjs',
	`process.stdout.write('not json at all');`,
);
const EXTRA_FIELDS_CHILD = writeChild(
	'extra.mjs',
	`for await (const c of process.stdin) {}
	 process.stdout.write(JSON.stringify({
	   speakerCount: 1,
	   turns: [{ speaker: 0, start_s: 0, end_s: 2, embedding: [0.1, 0.2], confidence: 0.9 }],
	   engine: { package: '@desert-ant-labs/who', sdkVersion: '4.2.1', modelVersion: 'v0.3.4' },
	 }));`,
);

const PCM = Buffer.alloc(32000, 1); // 1 s of s16le silence-ish bytes

describe('diarizationEngine supervisor (S-D05)', () => {
	jest.setTimeout(20000);

	it('AC-2 shape: success returns turns + engine provenance; PCM arrived on stdin', async () => {
		const out = await runEngineChild(PCM, { childPath: OK_CHILD });
		expect(out.speakerCount).toBe(2);
		expect(out.turns).toEqual([{ speaker: 0, start_s: 0, end_s: 1.5 }]);
		expect(out.engine).toEqual({
			package: '@desert-ant-labs/who',
			sdkVersion: '4.2.1',
			modelVersion: 'v0.3.4',
		});
	});

	it('turns are stripped to the §3.5 shape — no extra child field can reach persistence', async () => {
		const out = await runEngineChild(PCM, { childPath: EXTRA_FIELDS_CHILD });
		expect(out.turns).toEqual([{ speaker: 0, start_s: 0, end_s: 2 }]);
	});

	it('AC-4: child SIGKILLed mid-job → engine_oom, and the supervisor survives (next job OK)', async () => {
		await expect(runEngineChild(PCM, { childPath: KILLED_CHILD })).rejects.toMatchObject({
			name: 'DiarizationEngineError',
			errorClass: 'engine_oom',
		});
		const out = await runEngineChild(PCM, { childPath: OK_CHILD });
		expect(out.speakerCount).toBe(2);
	});

	it('AC-4: child exceeding the timeout → engine_timeout (supervisor kill)', async () => {
		await expect(
			runEngineChild(PCM, { childPath: SLEEP_CHILD, timeoutMs: 300 }),
		).rejects.toMatchObject({ errorClass: 'engine_timeout' });
	});

	it('non-zero child exit → engine_failed with stderr context', async () => {
		await expect(runEngineChild(PCM, { childPath: FAIL_CHILD })).rejects.toMatchObject({
			errorClass: 'engine_failed',
		});
		await expect(runEngineChild(PCM, { childPath: FAIL_CHILD })).rejects.toThrow(/engine exploded/);
	});

	it('malformed child output → engine_failed, nothing resolved', async () => {
		await expect(runEngineChild(PCM, { childPath: GARBAGE_CHILD })).rejects.toMatchObject({
			errorClass: 'engine_failed',
		});
	});

	it('AC-3: decode of garbage audio → decode_failed (ffmpeg pipe, no temp file)', async () => {
		await expect(decodeToPcm(Buffer.from('this is not audio'))).rejects.toMatchObject({
			errorClass: 'decode_failed',
		});
	});

	it('AC-3: decode of a real WAV yields non-empty PCM; diarizeAudio chains decode → child', async () => {
		// Build a 0.2 s silent WAV in memory with ffmpeg itself (stdin→stdout).
		const { spawn } = require('node:child_process');
		const wav = await new Promise((resolve, reject) => {
			const ff = spawn(
				'ffmpeg',
				['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.2', '-f', 'wav', 'pipe:1'],
				{ stdio: ['ignore', 'pipe', 'pipe'] },
			);
			const chunks = [];
			ff.stdout.on('data', (d) => chunks.push(d));
			ff.on('error', reject);
			ff.on('close', (code) =>
				code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg wav gen ${code}`)),
			);
		});
		const pcm = await decodeToPcm(wav);
		expect(pcm.length).toBeGreaterThan(0);
		expect(pcm.length % 2).toBe(0); // s16le frames

		const out = await diarizeAudio(wav, { childPath: OK_CHILD });
		expect(out.speakerCount).toBe(2);
	});

	it('empty audio → decode_failed before any spawn', async () => {
		await expect(diarizeAudio(Buffer.alloc(0), { childPath: OK_CHILD })).rejects.toMatchObject({
			errorClass: 'decode_failed',
		});
	});

	it('provisionWeights: child --provision exit 0 → true; failing child → engine_failed', async () => {
		await expect(provisionWeights({ childPath: OK_CHILD })).resolves.toBe(true);
		await expect(provisionWeights({ childPath: FAIL_CHILD })).rejects.toMatchObject({
			errorClass: 'engine_failed',
		});
	});

	it('errors are DiarizationEngineError instances carrying errorClass', async () => {
		const err = await runEngineChild(PCM, { childPath: FAIL_CHILD }).catch((e) => e);
		expect(err).toBeInstanceOf(DiarizationEngineError);
		expect(err).toBeInstanceOf(Error);
	});
});
