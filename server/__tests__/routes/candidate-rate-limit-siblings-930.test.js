/**
 * #930 — withdraw + auto-apply endpoints missing rateLimits.standard.
 *
 * PR #928 added rateLimits.standard to the candidate status/apply routes,
 * but two authenticated write siblings were left unbounded:
 *   PUT  /applications/:id/withdraw
 *   POST /applications/auto-apply
 *
 * Contract under test (router-wiring tier): both routes carry the EXACT
 * rateLimits.standard middleware instance used by the sibling routes
 * (PUT /applications/:id/status is the in-file control), in the middleware
 * chain before the handler. Behavioural 429 proof runs in the E2E-on-dev
 * gate (real server, NODE_ENV != test, real HTTP) — the limiter itself
 * deliberately skips in NODE_ENV=test, so this tier asserts wiring, and
 * the E2E tier asserts effect.
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

describe('#930 — rateLimits.standard wiring on candidate application siblings', () => {
	test('control: PUT /applications/:id/status already carries rateLimits.standard', () => {
		const handlers = handlersFor('put', '/applications/:id/status');
		expect(handlers).not.toBeNull();
		expect(handlers).toContain(rateLimits.standard);
	});

	test('PUT /applications/:id/withdraw carries rateLimits.standard', () => {
		const handlers = handlersFor('put', '/applications/:id/withdraw');
		expect(handlers).not.toBeNull();
		expect(handlers).toContain(rateLimits.standard);
	});

	test('POST /applications/auto-apply carries rateLimits.standard', () => {
		const handlers = handlersFor('post', '/applications/auto-apply');
		expect(handlers).not.toBeNull();
		expect(handlers).toContain(rateLimits.standard);
	});

	test('limiter runs before the route handler on both fixed routes', () => {
		for (const [method, path] of [
			['put', '/applications/:id/withdraw'],
			['post', '/applications/auto-apply'],
		]) {
			const handlers = handlersFor(method, path);
			const idx = handlers.indexOf(rateLimits.standard);
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(handlers.length - 1);
		}
	});
});
