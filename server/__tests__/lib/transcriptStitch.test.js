/**
 * transcriptStitch.test.js — S-D07 (#1909), pure stitch logic.
 *
 * User-perspective framing: a recruiter reading the transcript expects
 * every segment labelled by the voice that actually said most of it,
 * and anything labelling couldn't honestly reach left unlabelled.
 *
 * AC map: AC-1 max-overlap assignment (ties → NULL) · AC-2 no-overlap
 * stays NULL + coverage_end_ms · AC-3 single voice stays one speaker ·
 * #1929 M4 abrupt-end phantom turn must not steal a segment from the
 * real turn that overlaps it more.
 */
jest.mock('../../../lib/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const { assignSpeakers, coverageEndMs, MIN_ASSIGNABLE_TURN_MS } = require('../../../lib/transcriptStitch');

const seg = (id, start_time_ms, end_time_ms) => ({ id, start_time_ms, end_time_ms });
const turn = (speaker, start_s, end_s) => ({ speaker, start_s, end_s });

describe('transcriptStitch.assignSpeakers (S-D07)', () => {
	it('AC-1: assigns the max-overlap speaker per segment', () => {
		const segments = [seg(1, 0, 10000), seg(2, 10000, 20000), seg(3, 20000, 30000)];
		const turns = [turn(0, 0, 15), turn(1, 15, 30)];
		const out = assignSpeakers(segments, turns);
		// seg2 spans the boundary: 5s of speaker 0, 5s of speaker 1 → tie → NULL is AC-1's rule;
		// use asymmetric turns instead for the strict max check below.
		expect(out.get(1)).toBe(0);
		expect(out.get(3)).toBe(1);
	});

	it('AC-1: strict max wins on a boundary-spanning segment', () => {
		const segments = [seg(2, 10000, 20000)];
		const turns = [turn(0, 0, 13), turn(1, 13, 30)]; // 3s vs 7s
		expect(assignSpeakers(segments, turns).get(2)).toBe(1);
	});

	it('AC-1: an exact tie leaves the segment unlabelled (NULL), never a coin flip', () => {
		const segments = [seg(1, 0, 10000)];
		const turns = [turn(0, 0, 5), turn(1, 5, 10)];
		expect(assignSpeakers(segments, turns).get(1)).toBeNull();
	});

	it('AC-2: a segment with no overlapping turn stays NULL', () => {
		const segments = [seg(1, 0, 5000), seg(2, 60000, 70000)];
		const turns = [turn(0, 0, 10)];
		const out = assignSpeakers(segments, turns);
		expect(out.get(1)).toBe(0);
		expect(out.get(2)).toBeNull();
	});

	it('AC-2: coverage_end_ms is the last turn end in ms (0 for no turns)', () => {
		expect(coverageEndMs([turn(0, 0, 10), turn(1, 10, 42.464)])).toBe(42464);
		expect(coverageEndMs([])).toBe(0);
	});

	it('AC-3: single-voice turns yield exactly that one speaker number', () => {
		const segments = [seg(1, 0, 8000), seg(2, 8000, 16000), seg(3, 16000, 24000)];
		const turns = [turn(2, 0, 24)];
		const values = [...assignSpeakers(segments, turns).values()];
		expect(values).toEqual([2, 2, 2]);
		expect(new Set(values).size).toBe(1);
	});

	it('#1929 M4: a 60ms phantom turn never steals a segment from the real overlapping turn', () => {
		const segments = [seg(1, 0, 10000)];
		const turns = [turn(0, 0, 10), turn(2, 4.0, 4.06)]; // phantom speaker 2, 0.06s
		expect(assignSpeakers(segments, turns).get(1)).toBe(0);
	});

	it('#1929 M4: a sub-floor turn alone cannot label a segment (honest NULL over a phantom label)', () => {
		const segments = [seg(1, 4000, 9000)];
		const turns = [turn(2, 4.0, 4.06)];
		expect(MIN_ASSIGNABLE_TURN_MS).toBeGreaterThan(60);
		expect(assignSpeakers(segments, turns).get(1)).toBeNull();
	});

	it('#1993: a negative-speaker turn cannot label a segment (not assignable — honest NULL)', () => {
		const segments = [seg(1, 0, 10000)];
		const turns = [turn(-1, 0, 10)];
		expect(assignSpeakers(segments, turns).get(1)).toBeNull();
	});

	it('#1993: a >INT4_MAX-speaker turn cannot label a segment (not assignable — honest NULL)', () => {
		const segments = [seg(1, 0, 10000)];
		const turns = [turn(3000000000, 0, 10)];
		expect(assignSpeakers(segments, turns).get(1)).toBeNull();
	});

	it('#1993: an out-of-range turn never steals a segment from a valid overlapping turn', () => {
		const segments = [seg(1, 0, 10000)];
		// Out-of-range turn overlaps MORE (full span); valid turn overlaps 3s.
		const turns = [turn(-1, 0, 10), turn(1, 0, 3)];
		expect(assignSpeakers(segments, turns).get(1)).toBe(1);
	});

	it('#1993: a speaker of exactly INT4_MAX is in contract and labels normally (boundary pin)', () => {
		const segments = [seg(1, 0, 10000)];
		const turns = [turn(2147483647, 0, 10)];
		expect(assignSpeakers(segments, turns).get(1)).toBe(2147483647);
	});

	it('overlap is computed on ms boundaries (fractional seconds round consistently)', () => {
		const segments = [seg(1, 1500, 2500)];
		const turns = [turn(1, 1.5, 2.5)];
		expect(assignSpeakers(segments, turns).get(1)).toBe(1);
	});
});
