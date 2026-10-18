/**
 * #1403 — auto-apply profile siblings missing rateLimits.standard.
 *
 * PR #1400 (#930) added rateLimits.standard to the withdraw + auto-apply
 * job routes in routes/candidate.js, but the three nearest siblings in
 * the same auto-apply profile surface were left unbounded:
 *   POST /auto-apply/activate
 *   POST /auto-apply/deactivate
 *   PUT  /auto-apply/profile
 * (mounted under /api/candidate in the server entry)
 *
 * Contract under test (router-wiring tier): all three routes carry the
 * EXACT rateLimits.standard middleware instance used by the #930 sibling
 * routes, in the middleware chain before the handler; and the #930
 * routes still carry it (regression pin). Behavioural 429 proof runs in
 * the E2E-on-dev gate (real server, NODE_ENV != test, real HTTP) — the
 * limiter itself deliberately skips in NODE_ENV=test, so this tier
 * asserts wiring, and the E2E tier asserts effect.
 */

jest.mock('../../../lib/auth', () => {
	const passthrough = (req, res, next) => next();
	const authMiddleware = jest.fn((req, res, next) => next());
	return {
		authMiddleware,
		requireRole: () => passthrough,
		requireApprovedRecruiter: passthrough,
		requireNotSuspended: passthrough,
		requireEmployer: passthrough,
		optionalAuth: passthrough,
	};
});
jest.mock('../../../services/matching-engine', () => ({
	calculateDeterministicMatch: jest.fn(() => ({ match_score: 80 })),
}));
jest.mock('../../../lib/notify', () => ({ notifyUser: jest.fn().mockResolvedValue(1) }));
jest.mock('../../../lib/email-service', () => ({
	sendTemplatedEmail: jest.fn().mockResolvedValue({}),
	sendCustomEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../routes/chat', () => ({
	getOrCreateConversation: jest.fn().mockResolvedValue({ id: 1 }),
}));
jest.mock('../../../lib/subscription', () => ({
	checkFeatureAccess: jest.fn().mockResolvedValue({ allowed: true }),
	incrementUsage: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../../../services/trustscore', () => ({
	updateHiringRatioScore: jest.fn().mockResolvedValue(true),
	calculateTrustScore: jest.fn().mockResolvedValue(null),
}));

// NOTE: lib/distributed-rate-limiter is deliberately NOT mocked — the test
// compares handler identity against the real rateLimits.standard instance.
const { rateLimits } = require('../../../lib/distributed-rate-limiter');
const candidateRoutes = require('../../../routes/candidate');

function handlersFor(method, path) {
	const layer = candidateRoutes.stack.find(
		(l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()],
	);
	if (!layer) return null;
	return layer.route.stack.map((s) => s.handle);
}

const TARGETS = [
	['post', '/auto-apply/activate'],
	['post', '/auto-apply/deactivate'],
	['put', '/auto-apply/profile'],
];

const SIBLINGS_930 = [
	['put', '/applications/:id/withdraw'],
	['post', '/applications/auto-apply'],
	['post', '/jobs/:id/auto-apply'],
	['put', '/applications/:id/status'],
];

describe('#1403 — rateLimits.standard wiring on auto-apply profile siblings', () => {
	test.each(SIBLINGS_930)('control (#930): %s %s still carries rateLimits.standard', (method, path) => {
		const handlers = handlersFor(method, path);
		expect(handlers).not.toBeNull();
		expect(handlers).toContain(rateLimits.standard);
	});

	test.each(TARGETS)('%s %s carries rateLimits.standard', (method, path) => {
		const handlers = handlersFor(method, path);
		expect(handlers).not.toBeNull();
		expect(handlers).toContain(rateLimits.standard);
	});

	test('limiter runs before the route handler on all three fixed routes', () => {
		for (const [method, path] of TARGETS) {
			const handlers = handlersFor(method, path);
			const idx = handlers.indexOf(rateLimits.standard);
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(handlers.length - 1);
		}
	});
});
