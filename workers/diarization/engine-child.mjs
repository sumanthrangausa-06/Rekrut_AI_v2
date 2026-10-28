/**
 * Engine child process — one diarization run (S-D05, #1907;
 * Architecture §3.5, ADR-D01, Lex BR-4/BR-5/BR-8/BR-9).
 *
 * Spawned per job by lib/diarizationEngine.js. Reads raw PCM
 * (s16le, 16 kHz mono) from stdin — audio exists only in this
 * process's memory — loads the pinned vendor engine, diarizes,
 * prints ONE JSON line of turns to stdout, and exits. Voice-print
 * embeddings are computed inside this process by the SDK and cease
 * to exist when it exits, in every outcome. This process writes
 * nothing to disk (the SDK's weights-cache reads excepted).
 *
 * Modes:
 *   (default)      diarize PCM from stdin → turns JSON on stdout
 *   --provision    load the model only (downloads + SHA-256-verifies
 *                  the pinned weights into the cache) and exit 0
 *
 * The weights cache lives OUTSIDE the repo: DIARIZATION_WEIGHTS_DIR
 * or ~/.cache/rekrut-diarization/weights (BR-9).
 *
 * SDK telemetry is the vendor package's own behaviour and is left
 * exactly as built — this file sets no telemetry-related env, wraps
 * no SDK call, and filters nothing (BR-9, S-D05 AC-5).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Who } from '@desert-ant-labs/who/native';

// Step-0 measured model version for the pinned weights. BR-8: a
// package or weights change is a code change and updates this.
const MODEL_VERSION = 'v0.3.4';
const ENGINE_PACKAGE = '@desert-ant-labs/who';
const SAMPLE_RATE = 16000;

const weightsDir =
	process.env.DIARIZATION_WEIGHTS_DIR ||
	path.join(os.homedir(), '.cache', 'rekrut-diarization', 'weights');

function sdkVersion() {
	try {
		const pkgPath = path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			'node_modules',
			'@desert-ant-labs',
			'who',
			'package.json',
		);
		return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
	} catch {
		return 'unknown';
	}
}

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks);
}

const provisionOnly = process.argv[2] === '--provision';

try {
	const who = await Who.load({ directory: weightsDir });
	if (provisionOnly) {
		who.dispose();
		process.stdout.write(JSON.stringify({ provisioned: true }));
		process.exit(0);
	}

	const pcm = await readStdin();
	if (pcm.length < 2) throw new Error('no PCM audio on stdin');
	const samples = new Float32Array(pcm.length >> 1);
	for (let i = 0; i < samples.length; i++) {
		samples[i] = pcm.readInt16LE(i * 2) / 32768;
	}

	const result = await who.diarize({ samples, sampleRate: SAMPLE_RATE });
	const turns = result.turns.map((t) => ({
		speaker: t.speaker,
		start_s: +t.start.toFixed(3),
		end_s: +t.end.toFixed(3),
	}));
	who.dispose();
	process.stdout.write(
		JSON.stringify({
			speakerCount: result.speakerCount,
			turns,
			engine: { package: ENGINE_PACKAGE, sdkVersion: sdkVersion(), modelVersion: MODEL_VERSION },
		}),
	);
	process.exit(0);
} catch (err) {
	console.error(`[engine-child] ${err?.message || err}`);
	process.exit(1);
}
