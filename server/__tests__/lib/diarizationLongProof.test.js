/**
 * diarizationLongProof.test.js — S-D06 (#1908) unit tests for the
 * long-recording proof harness's ground-truth evaluation logic
 * (scripts/diarization-long-proof.js). Pure functions, no DB, no
 * engine: they decide AC-1/AC-3 pass/fail from stored turns, so they
 * are tested directly — a broken join and a phantom speaker MUST
 * fail here before any fixture run is believed.
 */
const { evaluateWindow, evaluateFixture } = require('../../../scripts/diarization-long-proof');

const GT = {
	duration_s: 3600,
	speakers: ['interviewer', 'candidate'],
	turns: [
		{ speaker: 'interviewer', start_s: 100, end_s: 160 },
		{ speaker: 'candidate', start_s: 160, end_s: 220 },
		{ speaker: 'interviewer', start_s: 3500, end_s: 3550 },
		{ speaker: 'candidate', start_s: 3550, end_s: 3600 },
	],
};

const GOOD_TURNS = [
	{ speaker: 0, start_s: 100, end_s: 160 },
	{ speaker: 1, start_s: 160, end_s: 220 },
	{ speaker: 0, start_s: 3500, end_s: 3550 },
	{ speaker: 1, start_s: 3550, end_s: 3600 },
];

describe('evaluateWindow (S-D06 AC-1)', () => {
	it('maps each ground-truth voice to exactly one engine speaker', () => {
		const w = evaluateWindow(GT.turns, GOOD_TURNS, 120, 180);
		expect(w.pass).toBe(true);
		expect(w.mapping).toEqual({ interviewer: 0, candidate: 1 });
	});

	it('fails when one voice is split across two engine speakers in the window', () => {
		const split = [
			{ speaker: 0, start_s: 100, end_s: 130 },
			{ speaker: 2, start_s: 130, end_s: 160 },
			{ speaker: 1, start_s: 160, end_s: 220 },
		];
		const w = evaluateWindow(GT.turns, split, 120, 180);
		expect(w.pass).toBe(false);
		expect(w.perVoice.interviewer.engineSpeakers).toEqual(expect.arrayContaining([0, 2]));
	});

	it('fails when a ground-truth voice is absent from the window', () => {
		const w = evaluateWindow(GT.turns, GOOD_TURNS, 300, 360);
		expect(w.pass).toBe(false);
	});
});

describe('evaluateFixture (S-D06 AC-1/AC-3)', () => {
	it('passes a consistent join: same engine number in minute 2 and the final minute', () => {
		const r = evaluateFixture(GT, { speakerCount: 2, turns: GOOD_TURNS });
		expect(r.joinPass).toBe(true);
		expect(r.phantomPass).toBe(true);
		expect(r.mappingMinute2).toEqual({ interviewer: 0, candidate: 1 });
		expect(r.mappingFinalMinute).toEqual({ interviewer: 0, candidate: 1 });
	});

	it('fails the join when a voice changes engine number by the final minute (cross-piece join break)', () => {
		const broken = [
			{ speaker: 0, start_s: 100, end_s: 160 },
			{ speaker: 1, start_s: 160, end_s: 220 },
			{ speaker: 2, start_s: 3500, end_s: 3550 },
			{ speaker: 1, start_s: 3550, end_s: 3600 },
		];
		const r = evaluateFixture(GT, { speakerCount: 3, turns: broken });
		expect(r.joinPass).toBe(false);
	});

	it('fails the phantom check when the engine invents a third speaker (AC-3)', () => {
		const phantom = [...GOOD_TURNS, { speaker: 2, start_s: 2000, end_s: 2060 }];
		const r = evaluateFixture(GT, { speakerCount: 3, turns: phantom });
		expect(r.phantomPass).toBe(false);
	});
});
