/**
 * #1801 — a rescheduled / reschedule_requested interview row with
 * outcome 'passed' must earn NO credit in any OmniScore calculator.
 *
 * Filed from the independent ecc/code-reviewer MEDIUM on PR #1800:
 * the #1781/#1798 "status wins" guard excludes no_show/cancelled from
 * the credited set, but the rescheduled family (lawful statuses since
 * migration 293 / #1796) was never excluded, so one contradictory row
 * (reachable via the routes/recruiter.js PUT COALESCE passthrough —
 * status, outcome and feedback pass through independently) measured:
 * calcInterviewPerformance raw 50, calcSoftSkills raw 40,
 * calcReliabilitySignals raw 100.
 *
 * Panel position (issue #1801, comment 6381682759 — Lead, with Scout
 * verification + Candidate Experience lens): a rescheduled interview
 * has not happened; credit follows attendance, not the outcome field.
 * ONE shared credited-interview predicate for all three calculators.
 * Reliability: a rescheduled-family row is pending — it earns no
 * attendance credit, no no-show penalty, and does not count toward
 * the attendance denominator (attendance is unmeasured until the row
 * resolves to completed / no_show / cancelled).
 *
 * Pure-calculator pins in the omniscore-factors.test.js style; the
 * HL-003 real-DB gate (calculateScore persisted read-back) is Quinn's
 * AFTER gate before merge.
 */
const {
	calcInterviewPerformance,
	calcReliabilitySignals,
	calcSoftSkills,
} = require('../../services/omniscore');

const emptyData = () => ({
	profile: null,
	skills: [],
	experience: [],
	education: [],
	assessments: [],
	practice: [],
	interviews: [],
	applications: [],
	projects: [],
	docs: [],
	matches: [],
	activity: [],
	evaluations: [],
});

const FB5 = JSON.stringify({ overall_score: 5, communication: 5 });
const FB2 = JSON.stringify({ overall_score: 2, communication: 2 });
const RESCHED = ['rescheduled', 'reschedule_requested'];

describe('#1801 calcInterviewPerformance — rescheduled family earns no credit', () => {
	test.each(RESCHED)('%s + passed + 5/5 feedback: raw 0, hasData false', (status) => {
		const r = calcInterviewPerformance({
			...emptyData(),
			interviews: [{ status, outcome: 'passed', feedback: FB5 }],
		});
		expect(r.raw).toBe(0);
		expect(r.hasData).toBe(false);
	});

	test('control: completed + passed + 5/5 feedback still earns raw 50', () => {
		const r = calcInterviewPerformance({
			...emptyData(),
			interviews: [{ status: 'completed', outcome: 'passed', feedback: FB5 }],
		});
		expect(r.raw).toBe(50);
		expect(r.hasData).toBe(true);
	});

	test('mixed: rescheduled 5/5 does not lift a completed 2/5 (raw 20, completed only)', () => {
		const r = calcInterviewPerformance({
			...emptyData(),
			interviews: [
				{ status: 'completed', outcome: 'passed', feedback: FB2 },
				{ status: 'rescheduled', outcome: 'passed', feedback: FB5 },
			],
		});
		expect(r.raw).toBe(20);
	});
});

describe('#1801 calcSoftSkills — rescheduled family feedback is not evidence', () => {
	test.each(RESCHED)('%s + passed + communication 5: raw 0, hasData false', (status) => {
		const r = calcSoftSkills({
			...emptyData(),
			interviews: [{ status, outcome: 'passed', feedback: FB5 }],
		});
		expect(r.raw).toBe(0);
		expect(r.hasData).toBe(false);
	});

	test('control: completed + passed + communication 5 still earns raw 40', () => {
		const r = calcSoftSkills({
			...emptyData(),
			interviews: [{ status: 'completed', outcome: 'passed', feedback: FB5 }],
		});
		expect(r.raw).toBe(40);
		expect(r.hasData).toBe(true);
	});

	test('mixed: only the completed row counts (communication 2 → raw 16)', () => {
		const r = calcSoftSkills({
			...emptyData(),
			interviews: [
				{ status: 'completed', outcome: 'passed', feedback: FB2 },
				{ status: 'reschedule_requested', outcome: 'passed', feedback: FB5 },
			],
		});
		expect(r.raw).toBe(16);
	});
});

describe('#1801 calcReliabilitySignals — rescheduled family is pending, unmeasured', () => {
	test.each(RESCHED)('%s + passed alone: attendance unmeasured, hasData false', (status) => {
		const r = calcReliabilitySignals({
			...emptyData(),
			interviews: [{ status, outcome: 'passed', feedback: FB5 }],
		});
		expect(r.hasData).toBe(false);
		expect(r.raw).toBe(0);
		expect(r.coverage.attendance).toBe(false);
	});

	test.each(RESCHED)(
		'%s + passed with an application: follow-through only, attendance unmeasured',
		(status) => {
			const r = calcReliabilitySignals({
				...emptyData(),
				interviews: [{ status, outcome: 'passed', feedback: FB5 }],
				applications: [{ status: 'applied' }],
			});
			expect(r.raw).toBe(100); // followRate 1.0 renormalised alone
			expect(r.coverage).toEqual({ attendance: false, followThrough: true });
			expect(r.coverageNote).toMatch(/follow-through only/);
		},
	);

	test('completed + rescheduled: attendance 100% over resolved rows, no penalty', () => {
		const r = calcReliabilitySignals({
			...emptyData(),
			interviews: [
				{ status: 'completed', outcome: 'passed', feedback: FB5 },
				{ status: 'rescheduled', outcome: 'passed', feedback: FB5 },
			],
		});
		expect(r.raw).toBe(100);
		expect(r.details.join(' ')).not.toMatch(/no-shows/);
	});

	test('rescheduled + no_show: no attendance credit for the rescheduled row (raw 0)', () => {
		const r = calcReliabilitySignals({
			...emptyData(),
			interviews: [
				{ status: 'rescheduled', outcome: 'passed', feedback: FB5 },
				{ status: 'no_show', outcome: null, feedback: null },
			],
		});
		// Resolved denominator is 1 (the no_show): rate 0, penalty 10 → clamped 0.
		// Pre-fix this measured raw 40 (rescheduled counted as attended 1/2, −10).
		expect(r.raw).toBe(0);
		expect(r.coverage.attendance).toBe(true);
	});
});
