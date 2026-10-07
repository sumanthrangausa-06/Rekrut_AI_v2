// OmniScore — job assessments feed verified_skills (2x weight vs self-tests)
// Job assessments are proctored and employer-validated, so each passed job
// assessment counts double (20 pts) vs a passed skill self-test (10 pts),
// within the same 30-pt "Passed assessments" bucket.
const { calcVerifiedSkills } = require('../../services/omniscore');

const emptyData = () => ({
	profile: null,
	skills: [],
	experience: [],
	education: [],
	assessments: [],
	jobAssessments: [],
	practice: [],
	interviews: [],
	applications: [],
	projects: [],
	docs: [],
	matches: [],
	activity: [],
});

describe('verified_skills: job assessments', () => {
	test('passed job assessment counts 2x a skill self-test', () => {
		const d = emptyData();
		d.jobAssessments = [{ composite_score: 85, passing_score: 70 }];
		const result = calcVerifiedSkills(d);
		// 1 passed job assessment × 20 pts = 20
		expect(result.raw).toBe(20);
		expect(result.hasData).toBe(true);
		expect(result.details.join(' ')).toMatch(/job assessment/i);
	});

	test('skill-only baseline unchanged when no job assessments exist', () => {
		const d = emptyData();
		d.assessments = [{ passed: true }, { passed: true }, { passed: true }];
		const result = calcVerifiedSkills(d);
		// 3 passed skill assessments × 10 pts = 30 (existing behavior)
		expect(result.raw).toBe(30);
	});

	test('incomplete/unscored/failed job attempts do not count', () => {
		const d = emptyData();
		d.jobAssessments = [
			{ composite_score: null, passing_score: 70 }, // not scored
			{ composite_score: 45, passing_score: 70 }, // failed
			{ composite_score: 85, passing_score: null }, // no passing_score → default 70, passes
		];
		const result = calcVerifiedSkills(d);
		// Only the third counts: 1 × 20 = 20
		expect(result.raw).toBe(20);
	});

	test('bucket caps at 30 regardless of mix', () => {
		const d = emptyData();
		d.assessments = [{ passed: true }, { passed: true }]; // 20 pts
		d.jobAssessments = [
			{ composite_score: 90, passing_score: 70 }, // 20 pts
			{ composite_score: 88, passing_score: 70 }, // 20 pts
		];
		const result = calcVerifiedSkills(d);
		// 20 + 40 = 60 → capped at 30
		expect(result.raw).toBe(30);
	});

	test('hasData true with only job assessments', () => {
		const d = emptyData();
		d.jobAssessments = [{ composite_score: 75, passing_score: 70 }];
		expect(calcVerifiedSkills(d).hasData).toBe(true);
	});
});
