/**
 * diarizationProofArtefacts.test.js — #1929 M3 recomputability pin.
 *
 * AC-1 of the S-D06 (#1908) long-recording proof must be recomputable
 * from committed artefacts alone: the committed results record
 * (1908-long-recording-proof-results.json: engine turns + recorded
 * evaluation per fixture) plus the committed fixture ground truth
 * (1908-fixtures-ground-truth/*.ground-truth.json). Before M3 the
 * ground truth was never committed, so this test could not exist —
 * it failed red on the missing files.
 *
 * For each fixture this re-runs the harness evaluator
 * (scripts/diarization-long-proof.js evaluateFixture — imported only,
 * its logic is untouched) on the committed ground truth and the
 * recorded engine turns, and asserts the recomputed headline fields
 * equal the recorded evaluation exactly. The recorded run's
 * speakerCount is preserved in its recorded evaluation
 * (evaluateFixture echoes it), so that is the run input here.
 * Pure functions + file reads: no DB, no engine, no audio.
 */
const fs = require('node:fs');
const path = require('node:path');
const { evaluateFixture } = require('../../../scripts/diarization-long-proof');

const IMPL_DIR = path.join(
	__dirname,
	'../../../docs/sdlc/rekrut-ai-v2/04-implementation',
);
const results = JSON.parse(
	fs.readFileSync(path.join(IMPL_DIR, '1908-long-recording-proof-results.json'), 'utf8'),
);

describe('S-D06 proof artefacts — AC-1 recomputable from committed files (#1929 M3)', () => {
	for (const name of ['2min', '30min', '60min']) {
		it(`${name}: recorded evaluation recomputes from the committed ground truth`, () => {
			const recorded = results.fixtures.find((f) => f.fixture === name);
			expect(recorded).toBeDefined();

			const gt = JSON.parse(
				fs.readFileSync(
					path.join(
						IMPL_DIR,
						'1908-fixtures-ground-truth',
						`diarization-${name}.ground-truth.json`,
					),
					'utf8',
				),
			);

			// The committed ground truth must describe the same fixture
			// the results record measured.
			expect(gt.duration_s).toBe(recorded.duration_s);

			const recomputed = evaluateFixture(gt, {
				speakerCount: recorded.evaluation.speakerCount,
				turns: recorded.turns,
			});
			expect(recomputed.joinPass).toBe(recorded.evaluation.joinPass);
			expect(recomputed.phantomPass).toBe(recorded.evaluation.phantomPass);
			// Window-scoped pin (#1929 m9): this pin asserts the mapping
			// for the window the recorded evaluation actually evaluated,
			// named by that window — it is window-scoped by design, not a
			// blanket "minute 2" claim across fixtures.
			const recordedWindow = recorded.evaluation.minute2.window_s;
			if (recordedWindow[0] === 120) {
				// Canonical minute 2 = [120,180] (duration >= 180 s).
				expect(recomputed.minute2.window_s).toEqual([120, 180]);
				expect(recomputed.mappingMinute2).toEqual(recorded.evaluation.mappingMinute2);
			} else {
				// The recorded 2-min evaluation stays history: at the time
				// it was recorded, the [60,120] window was filed under the
				// minute-2 name. Under the canonical definition that
				// window is the distinctly named early window, and the
				// recorded mapping is asserted against it explicitly.
				expect(recordedWindow).toEqual([60, 120]);
				expect(recomputed.minute2).toBeNull();
				expect(recomputed.mappingMinute2).toBeNull();
				expect(recomputed.earlyWindow.window_s).toEqual([60, 120]);
				expect(recomputed.mappingEarlyWindow).toEqual(
					recorded.evaluation.mappingMinute2,
				);
			}
			expect(recomputed.mappingFinalMinute).toEqual(
				recorded.evaluation.mappingFinalMinute,
			);
		});
	}
});
