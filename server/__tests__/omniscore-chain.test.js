// OmniScore v2 — hasData must survive the calculateScore -> getScoreBreakdown chain
//
// Regression (PR #286 follow-up): calculateScore rebuilt each factor as
// { raw, weight, details }, silently dropping hasData. getScoreBreakdown's
// `has_data: factorData?.hasData ?? true` then defaulted to true for every
// factor, so the UI never rendered "Insufficient data" despite the flag
// existing on the calculators. Unit tests on the calculators alone could not
// catch this — it only manifests end to end.
jest.mock('../../lib/db', () => {
	const mockClient = {
		query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
		release: jest.fn(),
	};
	return {
		connect: jest.fn(async () => mockClient),
		query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
	};
});

const { calculateScore, getScoreBreakdown } = require('../../services/omniscore');

const EMPTY_USER = '00000000-0000-0000-0000-000000000000';
const FACTOR_KEYS = [
	'verified_skills',
	'interview_performance',
	'experience_quality',
	'education_credentials',
	'reliability_signals',
	'soft_skills',
	'market_demand',
	'growth_trajectory',
];

describe('omniscore hasData chain (calculateScore -> getScoreBreakdown)', () => {
	test('calculateScore preserves hasData=false on every factor for empty data', async () => {
		const score = await calculateScore(EMPTY_USER);
		expect(Object.keys(score.factors)).toEqual(expect.arrayContaining(FACTOR_KEYS));
		for (const key of FACTOR_KEYS) {
			expect(score.factors[key].hasData).toBe(false);
		}
	});

	test('getScoreBreakdown exposes has_data=false per factor for empty data', async () => {
		const { breakdown } = await getScoreBreakdown(EMPTY_USER);
		expect(Object.keys(breakdown)).toEqual(expect.arrayContaining(FACTOR_KEYS));
		for (const key of FACTOR_KEYS) {
			expect(breakdown[key].has_data).toBe(false);
		}
	});
});
