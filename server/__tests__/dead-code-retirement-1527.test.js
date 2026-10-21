/**
 * #1527 (Story F, R2+R5) — dead-code retirement pin.
 *
 * The three functions below had zero production callers (fresh grep-proof
 * on origin/dev @ 3ac740532, attached to #1527 STOP 1 + PR body):
 *   - services/scoreExplainer.js  explainDecisionForJob        (R2)
 *   - services/biasDetection.js   analyzeDemographicParityForJob (R5)
 *   - services/biasDetection.js   generatePerJobReport           (R5)
 * This pin FAILS while any of them is still exported, and pins that the
 * live siblings survive — including EuComplianceService.explainDecisionForJob,
 * a DIFFERENT live function (#1525) that must never be confused with R2.
 */
jest.mock('../../lib/db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const scoreExplainer = require('../../services/scoreExplainer');
const BiasDetection = require('../../services/biasDetection');
const EuComplianceService = require('../../services/euComplianceService');

describe('#1527 dead functions are retired', () => {
	test('scoreExplainer.explainDecisionForJob (R2) is gone', () => {
		expect(scoreExplainer.explainDecisionForJob).toBeUndefined();
	});

	test('BiasDetection.analyzeDemographicParityForJob (R5) is gone', () => {
		expect(BiasDetection.analyzeDemographicParityForJob).toBeUndefined();
	});

	test('BiasDetection.generatePerJobReport (R5) is gone', () => {
		expect(BiasDetection.generatePerJobReport).toBeUndefined();
	});
});

describe('#1527 live siblings survive', () => {
	test('scoreExplainer still exports explainOmniScore + explainDecision', () => {
		expect(typeof scoreExplainer.explainOmniScore).toBe('function');
		expect(typeof scoreExplainer.explainDecision).toBe('function');
	});

	test('BiasDetection still exposes the global (non-per-job) paths', () => {
		expect(typeof BiasDetection.analyzeDemographicParity).toBe('function');
		expect(typeof BiasDetection.analyzeScoreDistribution).toBe('function');
		expect(typeof BiasDetection.generateReport).toBe('function');
		expect(typeof BiasDetection.calculateFourFifthsRule).toBe('function');
		expect(typeof BiasDetection.getReports).toBe('function');
	});

	test('EuComplianceService.explainDecisionForJob (different function) is untouched', () => {
		expect(typeof EuComplianceService.explainDecisionForJob).toBe('function');
	});
});
