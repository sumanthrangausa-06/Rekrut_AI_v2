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

	test('reliability_signals keeps neutral default score but flags no data', () => {
		// Regression: a brand-new user scored 85/100 here from pure defaults
		// (50 base + 15 attendance default + 20 follow-through default).
		const result = calcReliabilitySignals(emptyData());
		expect(result.raw).toBe(85);
		expect(result.hasData).toBe(false);
	});

	test('market_demand flags no data when no matches and no skills', () => {
		// Regression: the skill-category fallback awarded 20/100 with zero skills.
		const result = calcMarketDemand(emptyData());
		expect(result.raw).toBe(20);
		expect(result.hasData).toBe(false);
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
