/**
 * #1462 — euComplianceService.getExplanationForJob removed.
 *
 * Follow-up to #1458 (PR #1461 review, nit 1): getExplanationForJob returned
 * cached ai_decision_explanations rows raw, with no weights_hash check —
 * unlike the gated read in explainDecisionForJob, which only serves a cached
 * row when its weights_hash equals the effective hash ('v2-match-results').
 * Verified zero callers repo-wide (repo-wide grep, incl. server.js and root
 * entry files, returns only the definition), so the dead function is deleted
 * (ponytail) rather than gated: the live serving path is
 * explainDecisionForJob, which already does cache-or-regenerate under the
 * hash gate, and a gated raw getter would be a second read path to keep in
 * sync on the next hash bump.
 *
 * These tests fail on unmodified code (the export exists and serves a
 * stale-hash row raw) and pass once it is removed.
 */

jest.mock('../../lib/db', () => ({
	query: jest.fn(async () => ({
		rows: [
			{
				user_id: 1,
				job_id: 1,
				overall_score: '42.00',
				weights_hash: 'default-v1', // stale, pre-#1458 shape
				factor_breakdowns: {
					factor_breakdowns: [{ factor: 'Cultural Fit', weight: 0.1, score: 42 }],
				},
			},
		],
	})),
}));

jest.mock('../../services/auditLogService', () => ({
	logEvent: jest.fn(async () => ({})),
	EVENT_TYPES: { AI_DECISION: 'ai_decision' },
	ENTITY_TYPES: { CANDIDATE: 'candidate', JOB: 'job' },
}));

const EuComplianceService = require('../../services/euComplianceService');

describe('#1462 dead ungated cache getter is removed', () => {
	test('getExplanationForJob export is gone', () => {
		expect(EuComplianceService.getExplanationForJob).toBeUndefined();
	});

	test('the gated serving path remains available', () => {
		expect(typeof EuComplianceService.explainDecisionForJob).toBe('function');
	});
});
