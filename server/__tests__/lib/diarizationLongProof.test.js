/**
 * diarizationLongProof.test.js — S-D06 (#1908) unit tests for the
 * long-recording proof harness's ground-truth evaluation logic
 * (scripts/diarization-long-proof.js). Pure functions, no DB, no
 * engine: they decide AC-1/AC-3 pass/fail from stored turns, so they
 * are tested directly — a broken join and a phantom speaker MUST
 * fail here before any fixture run is believed.
 */
const {
	evaluateWindow,
	evaluateFixture,
	minute2Window,
} = require('../../../scripts/diarization-long-proof');

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

describe('canonical "minute 2" window — #1929 m9', () => {
	// Canonical definition (panel on #1929, comment 6525811830):
	// "Minute N" = [N×60, (N+1)×60) seconds. Minute 2 = [120,180].
	it('minute2Window returns [120,180] at and above 180 s, null below', () => {
		expect(minute2Window(3600)).toEqual([120, 180]);
		expect(minute2Window(180)).toEqual([120, 180]);
		expect(minute2Window(118.182)).toBeNull();
		expect(minute2Window(179.999)).toBeNull();
	});

	it('long fixture: minute 2 is [120,180] and there is no early window', () => {
		const r = evaluateFixture(GT, { speakerCount: 2, turns: GOOD_TURNS });
		expect(r.minute2.window_s).toEqual([120, 180]);
		expect(r.mappingMinute2).toEqual({ interviewer: 0, candidate: 1 });
		expect(r.earlyWindow).toBeNull();
		expect(r.mappingEarlyWindow).toBeNull();
	});

	it('118 s fixture: minute 2 does not exist; [60,120] is the distinctly named early window', () => {
		const shortGt = {
			duration_s: 118.182,
			speakers: ['interviewer', 'candidate'],
			turns: [
				{ speaker: 'interviewer', start_s: 60, end_s: 90 },
				{ speaker: 'candidate', start_s: 90, end_s: 118.182 },
			],
		};
		const turns = [
			{ speaker: 0, start_s: 60, end_s: 90 },
			{ speaker: 1, start_s: 90, end_s: 118.182 },
		];
		const r = evaluateFixture(shortGt, { speakerCount: 2, turns });
		// Not applicable — never silently substituted, never recorded
		// under the unqualified minute2 key.
		expect(r.minute2).toBeNull();
		expect(r.mappingMinute2).toBeNull();
		// The distinctly named early window carries the evidence.
		expect(r.earlyWindow.window_s).toEqual([60, 120]);
		expect(r.mappingEarlyWindow).toEqual({ interviewer: 0, candidate: 1 });
		expect(r.joinPass).toBe(true);
		expect(r.phantomPass).toBe(true);
	});
});

describe('evaluator hardening — #1929 M1 (distinctness + both-voices-present)', () => {
	// The engine collapsed BOTH voices into engine speaker 0 everywhere.
	const MERGED_TURNS = [
		{ speaker: 0, start_s: 100, end_s: 160 },
		{ speaker: 0, start_s: 160, end_s: 220 },
		{ speaker: 0, start_s: 3500, end_s: 3550 },
		{ speaker: 0, start_s: 3550, end_s: 3600 },
	];

	it('(M1a) fails the window when both voices merge into one engine speaker', () => {
		const w = evaluateWindow(GT.turns, MERGED_TURNS, 120, 180);
		expect(w.mapping).toEqual({ interviewer: 0, candidate: 0 });
		expect(w.pass).toBe(false);
	});

	it('(M1a) fails the join when both voices merge into one engine speaker in both windows', () => {
		const r = evaluateFixture(GT, { speakerCount: 1, turns: MERGED_TURNS });
		expect(r.mappingMinute2).toEqual({ interviewer: 0, candidate: 0 });
		expect(r.joinPass).toBe(false);
	});

	it('(M1b) fails a window containing ground-truth speech from only one expected voice', () => {
		// Window [100,160]: the interviewer speaks; the candidate's first
		// turn starts at exactly 160, so the candidate is absent here even
		// though the engine output is perfect. The window must not pass:
		// it never observed the candidate at all.
		const w = evaluateWindow(GT.turns, GOOD_TURNS, 100, 160);
		expect(w.pass).toBe(false);
	});

	it('(M1b) honours an explicit expected-voice set narrower than the full ground truth', () => {
		// Same one-voice window as above, but the caller declares that
		// only the interviewer is expected in it — then it passes.
		const w = evaluateWindow(GT.turns, GOOD_TURNS, 100, 160, ['interviewer']);
		expect(w.pass).toBe(true);
		expect(w.mapping).toEqual({ interviewer: 0 });
	});

	it('(M1b) fails the join when a voice speaks only outside both evaluated windows', () => {
		const midOnlyGt = {
			duration_s: 3600,
			speakers: ['interviewer', 'candidate'],
			turns: [
				{ speaker: 'interviewer', start_s: 100, end_s: 220 },
				{ speaker: 'candidate', start_s: 1000, end_s: 1060 },
				{ speaker: 'interviewer', start_s: 3500, end_s: 3600 },
			],
		};
		const turns = [
			{ speaker: 0, start_s: 100, end_s: 220 },
			{ speaker: 1, start_s: 1000, end_s: 1060 },
			{ speaker: 0, start_s: 3500, end_s: 3600 },
		];
		const r = evaluateFixture(midOnlyGt, { speakerCount: 2, turns });
		expect(r.joinPass).toBe(false);
	});
});
