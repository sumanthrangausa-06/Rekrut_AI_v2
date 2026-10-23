// OmniScore v2 — insufficient-data flags (Issue #113 follow-up)
// Each factor calculator must report `hasData`: false when it consumed no
// real input records, so the UI can render "Insufficient data" instead of
// a misleading 0/100 (or a default-driven non-zero like reliability's 85).
const {
	calcVerifiedSkills,
	calcInterviewPerformance,
	calcExperienceQuality,
	calcEducationCredentials,
	calcReliabilitySignals,
	calcSoftSkills,
	calcMarketDemand,
	calcGrowthTrajectory,
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
});

describe('omniscore factor hasData flags', () => {
	test.each([
		['verified_skills', calcVerifiedSkills],
		['interview_performance', calcInterviewPerformance],
		['experience_quality', calcExperienceQuality],
		['education_credentials', calcEducationCredentials],
		['reliability_signals', calcReliabilitySignals],
		['soft_skills', calcSoftSkills],
		['market_demand', calcMarketDemand],
		['growth_trajectory', calcGrowthTrajectory],
	])('%s reports hasData=false on empty input', (_name, calc) => {
		const result = calc(emptyData());
		expect(result.hasData).toBe(false);
	});

	test('reliability_signals is measured-only: zero input scores 0 and flags no data (#1776)', () => {
		// #1776 (panel ruling on #1761, Option D): the neutral base and the
		// default attendance/follow-through rates are removed. A brand-new
		// user previously scored 85/100 here from pure defaults (50 base +
		// 15 attendance default + 20 follow-through default); now zero
		// measured sub-signals means raw 0 with hasData=false, so #1538
		// persists null and no attendance detail string is produced.
		const result = calcReliabilitySignals(emptyData());
		expect(result.raw).toBe(0);
		expect(result.hasData).toBe(false);
		expect(result.details.join(' ')).not.toMatch(/attendance/i);
		expect(result.coverageNote).toBeNull();
	});

	describe('#1776 reliability_signals — measured-only renormalisation', () => {
		test('apps-only candidate: follow-through only, renormalised to 100, with coverage note', () => {
			const result = calcReliabilitySignals({
				...emptyData(),
				applications: [{ status: 'applied' }],
			});
			expect(result.hasData).toBe(true);
			expect(result.raw).toBe(100); // followRate 1.0 renormalised over its 40-pt weight
			expect(result.coverage).toEqual({ attendance: false, followThrough: true });
			expect(result.coverageNote).toBe(
				'based on application follow-through only; attendance: insufficient data',
			);
			// No interview exists, so no attendance-% detail may be produced.
			expect(result.details.join(' ')).not.toMatch(/attendance/i);
			expect(result.details.join(' ')).toMatch(/follow-through 100%/);
		});

		test('apps-only with withdrawals: raw reflects the measured follow rate alone', () => {
			const result = calcReliabilitySignals({
				...emptyData(),
				applications: [{ status: 'applied' }, { status: 'withdrawn' }],
			});
			expect(result.raw).toBe(50); // followRate 0.5 renormalised
			expect(result.coverageNote).toMatch(/follow-through only/);
		});

		test('interviews-only candidate: attendance only, renormalised, with coverage note', () => {
			// Real scheduled_interviews shape (Quinn #1776 gate evidence):
			// attended is written as status 'completed' + outcome 'passed'
			// (routes/recruiter.js PUT /interviews/:id); outcome 'completed'
			// cannot exist — chk_scheduled_interviews_outcome allows only
			// passed/failed/pending_review/no_decision/NULL.
			const result = calcReliabilitySignals({
				...emptyData(),
				interviews: [
					{ status: 'completed', outcome: 'passed' },
					{ status: 'completed', outcome: 'passed' },
				],
			});
			expect(result.hasData).toBe(true);
			expect(result.raw).toBe(100); // attendance 1.0 renormalised over its 60-pt weight
			expect(result.coverage).toEqual({ attendance: true, followThrough: false });
			expect(result.coverageNote).toBe(
				'based on interview attendance only; application follow-through: insufficient data',
			);
		});

		test('no-show penalty applies only when interviews are measured', () => {
			// Real shape: a no-show is status 'no_show' with outcome NULL
			// (the app's own representation, Quinn #1776 gate evidence) —
			// outcome 'no_show' violates chk_scheduled_interviews_outcome
			// (PG 23514), so the pre-fix { outcome: 'no_show' } mock could
			// never occur on real data and the penalty never fired.
			const result = calcReliabilitySignals({
				...emptyData(),
				interviews: [
					{ status: 'completed', outcome: 'passed' },
					{ status: 'no_show', outcome: null },
				],
			});
			// attendance 0.5 renormalised = 50, minus 10 no-show penalty
			expect(result.raw).toBe(40);
		});

		test('cancelled interview (status) also incurs the no-show penalty', () => {
			// status 'cancelled' is written by routes/recruiter.js (status
			// passthrough + calendar branch), routes/interviews.js
			// reschedule-cancel and routes/candidate.js decline — always as
			// STATUS; outcome 'cancelled' is not storable (CHECK above).
			const result = calcReliabilitySignals({
				...emptyData(),
				interviews: [
					{ status: 'completed', outcome: 'passed' },
					{ status: 'cancelled', outcome: null },
				],
			});
			expect(result.raw).toBe(40);
		});

		test('Quinn gate scenario (#1776): 1 app + attended + no-show in real shapes => 60', () => {
			const result = calcReliabilitySignals({
				...emptyData(),
				interviews: [
					{ status: 'completed', outcome: 'passed' },
					{ status: 'no_show', outcome: null },
				],
				applications: [{ status: 'applied' }],
			});
			// a = 1/2, f = 1: 60*0.5 + 40*1 - 10 penalty = 60 (pre-fix: 70)
			expect(result.raw).toBe(60);
			expect(result.coverage).toEqual({ attendance: true, followThrough: true });
			expect(result.coverageNote).toBeNull();
			expect(result.details.join(' ')).toMatch(/1 no-shows\/cancellations \(-10\)/);
		});

		test('fully-measured candidate: raw = 60a + 40f - penalty (panel worked example 75 -> 50)', () => {
			const result = calcReliabilitySignals({
				...emptyData(),
				interviews: [
					{ status: 'completed', outcome: 'passed' },
					{ status: 'scheduled', outcome: null },
				],
				applications: [{ status: 'applied' }, { status: 'withdrawn' }],
			});
			expect(result.raw).toBe(50); // 60*0.5 + 40*0.5, no no-shows
			expect(result.coverage).toEqual({ attendance: true, followThrough: true });
			expect(result.coverageNote).toBeNull();
		});

		test('fully-measured perfect candidate stays 100', () => {
			const result = calcReliabilitySignals({
				...emptyData(),
				interviews: [{ status: 'completed', outcome: 'passed' }],
				applications: [{ status: 'applied' }],
			});
			expect(result.raw).toBe(100);
			expect(result.coverageNote).toBeNull();
		});
	});

	test('market_demand flags no data when no matches and no skills', () => {
		// Regression: the skill-category fallback awarded 20/100 with zero skills.
		const result = calcMarketDemand(emptyData());
		expect(result.raw).toBe(20);
		expect(result.hasData).toBe(false);
	});

	describe('#793 interview_evaluations feed interview_performance', () => {
		test('evaluations-only input moves the factor (AC2)', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({
				...d,
				evaluations: [
					{ score: 80, max_score: 100 },
					{ score: 60, max_score: 100 },
					{ score: 70, max_score: 100 },
				],
			});
			expect(result.hasData).toBe(true);
			// avg 70/100 -> 70 * 0.5 = 35 of the 50-point interview half
			expect(result.raw).toBe(35);
			expect(result.details.join(' ')).toMatch(/interview evaluations/);
		});

		test('fallback-only evaluations behave as no data (filtered upstream)', () => {
			// The SQL in fetchCandidateData excludes rows whose reasoning is
			// 'AI evaluation unavailable — using neutral score'; the calculator
			// therefore receives [] for a fallback-only candidate.
			const d = emptyData();
			const result = calcInterviewPerformance({ ...d, evaluations: [] });
			expect(result.hasData).toBe(false);
			expect(result.raw).toBe(0);
		});

		test('missing evaluations field defaults to no evaluations (fixture guard)', () => {
			const result = calcInterviewPerformance(emptyData());
			expect(result.hasData).toBe(false);
			expect(result.raw).toBe(0);
		});

		test('non-100 max_score is normalised to the 0-100 scale', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({
				...d,
				evaluations: [{ score: 4, max_score: 5 }],
			});
			expect(result.hasData).toBe(true);
			expect(result.raw).toBe(40); // 4/5 = 80 -> 80 * 0.5
		});

		test('string scores from pg NUMERIC are coerced', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({
				...d,
				evaluations: [{ score: '80.00', max_score: '100.00' }],
			});
			expect(result.hasData).toBe(true);
			expect(result.raw).toBe(40);
		});

		test('evaluations win over feedback — no double count', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({
				...d,
				evaluations: [{ score: 80, max_score: 100 }],
				interviews: [
					{ outcome: 'completed', feedback: JSON.stringify({ overall_score: 5 }) },
				],
			});
			// eval half only: 80 * 0.5 = 40; feedback path (5*10=50) must NOT add
			expect(result.raw).toBe(40);
		});

		test('evaluations add to practice half without changing its math', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({
				...d,
				practice: [{ score: 8 }],
				evaluations: [
					{ score: 80, max_score: 100 },
					{ score: 60, max_score: 100 },
					{ score: 70, max_score: 100 },
				],
			});
			expect(result.raw).toBe(75); // practice 40 + evaluations 35
		});

		test('regression: practice-only fixture produces exact prior raw/details', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({ ...d, practice: [{ score: 8 }] });
			expect(result.raw).toBe(40);
			expect(result.hasData).toBe(true);
		});

		test('regression: feedback-only fixture produces exact prior raw', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({
				...d,
				interviews: [
					{ outcome: 'completed', feedback: JSON.stringify({ overall_score: 4 }) },
				],
			});
			expect(result.raw).toBe(40); // 4/5 scale -> 4*10
			expect(result.hasData).toBe(true);
		});

		test('regression: completed-count fallback unchanged when no evaluations/feedback', () => {
			const d = emptyData();
			const result = calcInterviewPerformance({
				...d,
				interviews: [{ outcome: 'completed', feedback: null }],
			});
			expect(result.raw).toBe(10);
		});

		test('AC3: evaluations do not change any other factor', () => {
			const d = emptyData();
			const withEvals = {
				...d,
				skills: [{ is_verified: true }],
				// fixed end_date: calcExperienceQuality otherwise uses new Date()
				// and two calls drift at the 1e-10 level, unrelated to #793
				experience: [{ title: 'Dev', start_date: '2020-01-01', end_date: '2022-01-01' }],
				education: [{ degree: 'BSc' }],
				evaluations: [{ score: 90, max_score: 100 }],
			};
			const without = { ...withEvals, evaluations: [] };
			expect(calcVerifiedSkills(withEvals)).toEqual(calcVerifiedSkills(without));
			expect(calcExperienceQuality(withEvals).raw).toBe(calcExperienceQuality(without).raw);
			expect(calcEducationCredentials(withEvals)).toEqual(calcEducationCredentials(without));
			expect(calcReliabilitySignals(withEvals)).toEqual(calcReliabilitySignals(without));
			expect(calcSoftSkills(withEvals)).toEqual(calcSoftSkills(without));
			expect(calcMarketDemand(withEvals)).toEqual(calcMarketDemand(without));
			expect(calcGrowthTrajectory(withEvals)).toEqual(calcGrowthTrajectory(without));
		});
	});

	test('factors flag hasData=true when they consume real input', () => {
		const d = emptyData();
		expect(calcVerifiedSkills({ ...d, skills: [{ is_verified: true }] }).hasData).toBe(true);
		expect(calcVerifiedSkills({ ...d, projects: [{ id: 1 }] }).hasData).toBe(true);
		expect(
			calcInterviewPerformance({ ...d, practice: [{ score: 8 }] }).hasData,
		).toBe(true);
		expect(
			calcExperienceQuality({ ...d, experience: [{ title: 'Dev', start_date: '2020-01-01' }] })
				.hasData,
		).toBe(true);
		expect(calcEducationCredentials({ ...d, education: [{ degree: 'BSc' }] }).hasData).toBe(
			true,
		);
		expect(
			calcReliabilitySignals({ ...d, applications: [{ status: 'applied' }] }).hasData,
		).toBe(true);
		expect(
			calcSoftSkills({ ...d, practice: [{ category: 'communication', score: 7 }] }).hasData,
		).toBe(true);
		expect(calcMarketDemand({ ...d, skills: [{ category: 'AI' }] }).hasData).toBe(true);
		expect(
			calcMarketDemand({ ...d, matches: [{ match_level: 'good' }] }).hasData,
		).toBe(true);
		expect(
			calcGrowthTrajectory({ ...d, activity: [{ created_at: new Date().toISOString() }] })
				.hasData,
		).toBe(true);
	});
});
