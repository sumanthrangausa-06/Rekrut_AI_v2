/**
 * diarizationPinning-1907.test.js — S-D05 (#1907) static guards.
 *
 * AC-1: the worker-scope package.json pins @desert-ant-labs/who at
 * EXACTLY 4.2.1 (no range operator); the root package.json does NOT
 * carry the engine (the web service never loads the model); no model
 * weights file exists anywhere in the tracked repo tree (BR-9).
 * AC-5 (BR-9): no diarization source sets, overrides, or references
 * the SDK telemetry endpoint env — telemetry is left exactly as the
 * vendor built it. (This test file itself is excluded from the scan:
 * it has to name the string to forbid it.)
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..', '..');
const TELEMETRY_ENV = 'DAL_LICENSE_ENDPOINT';

describe('S-D05 pinning + telemetry guards', () => {
	it('AC-1: worker package pins the engine at exactly 4.2.1, no range', () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(REPO, 'workers', 'diarization', 'package.json'), 'utf8'),
		);
		expect(pkg.dependencies['@desert-ant-labs/who']).toBe('4.2.1');
	});

	it('AC-1: root package.json does not carry the engine dependency', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
		expect(pkg.dependencies).not.toHaveProperty('@desert-ant-labs/who');
		expect(pkg.devDependencies || {}).not.toHaveProperty('@desert-ant-labs/who');
	});

	it('AC-1/BR-9: no weights file is tracked in the repo', () => {
		const tracked = execSync('git ls-files', { cwd: REPO, encoding: 'utf8' });
		const weights = tracked
			.split('\n')
			.filter((f) => /\.(tflite|onnx|f16|f32)$/i.test(f));
		expect(weights).toEqual([]);
	});

	it('AC-5/BR-9: no diarization source touches the SDK telemetry endpoint', () => {
		const sources = [
			'lib/diarizationEngine.js',
			'lib/diarizationJobs.js',
			'lib/diarizationGate.js',
			'lib/diarizationFlag.js',
			'workers/diarization/index.js',
			'workers/diarization/engine-child.mjs',
		];
		for (const rel of sources) {
			const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
			expect({ file: rel, touches: text.includes(TELEMETRY_ENV) }).toEqual({
				file: rel,
				touches: false,
			});
		}
	});

	it('child entry loads the pinned native entry and the weights dir is outside the repo', () => {
		const child = fs.readFileSync(
			path.join(REPO, 'workers', 'diarization', 'engine-child.mjs'),
			'utf8',
		);
		expect(child).toContain("from '@desert-ant-labs/who/native'");
		expect(child).toContain('DIARIZATION_WEIGHTS_DIR');
		expect(child).not.toMatch(/writeFile|createWriteStream/);
	});
});
