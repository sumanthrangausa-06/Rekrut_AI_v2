/**
 * requireBiometricConsent middleware tests (S-011).
 *
 * consentService is mocked — these tests verify the middleware's enforcement
 * logic, fail-closed behavior, and that client-supplied consent claims are
 * ignored. DB-level consent state logic is tested in consentService.test.js.
 */
jest.mock('../../../lib/consentService', () => ({
	checkConsentState: jest.fn(),
}));

const consentService = require('../../../lib/consentService');
const { requireBiometricConsent } = require('../../../server/middleware/requireBiometricConsent');

function mockReq(overrides = {}) {
	return {
		body: {},
		query: {},
		params: {},
		headers: {},
		user: { id: 1001 },
		...overrides,
	};
}

function mockRes() {
	const res = {};
	res.status = jest.fn().mockReturnValue(res);
	res.json = jest.fn().mockReturnValue(res);
	return res;
}

describe('requireBiometricConsent middleware', () => {
	let middleware;

	beforeEach(() => {
		jest.clearAllMocks();
		middleware = requireBiometricConsent('biometric');
	});

	test('valid consent → calls next()', async () => {
		consentService.checkConsentState.mockResolvedValue({ state: 'valid', version: '1.0' });
		const req = mockReq({ body: { sessionId: 42 } });
		const res = mockRes();
		const next = jest.fn();

		await middleware(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		expect(res.status).not.toHaveBeenCalled();
		expect(req.consentState).toEqual({ state: 'valid', version: '1.0' });
	});

	test('missing consent → 403 CONSENT_REQUIRED', async () => {
		consentService.checkConsentState.mockResolvedValue({ state: 'missing' });
		const req = mockReq({ body: { sessionId: 42 } });
		const res = mockRes();

		await middleware(req, res, jest.fn());

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'CONSENT_REQUIRED' }),
		);
	});

	test('stale consent → 403 CONSENT_VERSION_STALE with versions', async () => {
		consentService.checkConsentState.mockResolvedValue({
			state: 'stale',
			receiptVersion: '1.0',
			currentVersion: '2.0',
		});
		const req = mockReq({ body: { sessionId: 42 } });
		const res = mockRes();

		await middleware(req, res, jest.fn());

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'CONSENT_VERSION_STALE',
				receiptVersion: '1.0',
				currentVersion: '2.0',
			}),
		);
	});

	test('withdrawn consent → 403 CONSENT_WITHDRAWN', async () => {
		consentService.checkConsentState.mockResolvedValue({
			state: 'withdrawn',
			withdrawnAt: '2026-10-10T00:00:00Z',
		});
		const req = mockReq({ body: { sessionId: 42 } });
		const res = mockRes();

		await middleware(req, res, jest.fn());

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'CONSENT_WITHDRAWN' }),
		);
	});

	test('no sessionId → 400 fail-closed', async () => {
		const req = mockReq({ body: {} });
		const res = mockRes();
		const next = jest.fn();

		await middleware(req, res, next);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'CONSENT_SESSION_REQUIRED' }),
		);
		expect(next).not.toHaveBeenCalled();
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	test('DB error → 503 fail-closed (consent unverifiable)', async () => {
		consentService.checkConsentState.mockRejectedValue(new Error('connection refused'));
		const req = mockReq({ body: { sessionId: 42 } });
		const res = mockRes();
		const next = jest.fn();

		await middleware(req, res, next);

		expect(res.status).toHaveBeenCalledWith(503);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'CONSENT_CHECK_UNAVAILABLE' }),
		);
		expect(next).not.toHaveBeenCalled();
	});

	test('forged consent header is ignored — DB says missing → 403', async () => {
		// Attacker sends a header claiming consent. Middleware must ignore it.
		consentService.checkConsentState.mockResolvedValue({ state: 'missing' });
		const req = mockReq({
			body: { sessionId: 42 },
			headers: {
				'x-consent-granted': 'true',
				'x-consent-receipt': 'forged-receipt-token',
			},
		});
		const res = mockRes();

		await middleware(req, res, jest.fn());

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'CONSENT_REQUIRED' }),
		);
	});

	test('forged body consent claim is ignored — DB says missing → 403', async () => {
		consentService.checkConsentState.mockResolvedValue({ state: 'missing' });
		const req = mockReq({
			body: { sessionId: 42, consent: true, consentGranted: true, receipt: 'abc123' },
		});
		const res = mockRes();

		await middleware(req, res, jest.fn());

		expect(res.status).toHaveBeenCalledWith(403);
		expect(consentService.checkConsentState).toHaveBeenCalledWith(42, 'biometric', 1001);
	});

	test('sessionId resolved from query and params', async () => {
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });

		await middleware(mockReq({ query: { sessionId: 7 } }), mockRes(), jest.fn());
		expect(consentService.checkConsentState).toHaveBeenCalledWith(7, 'biometric', 1001);

		await middleware(mockReq({ params: { sessionId: 9 } }), mockRes(), jest.fn());
		expect(consentService.checkConsentState).toHaveBeenCalledWith(9, 'biometric', 1001);
	});

	test('consent type is passed through to checkConsentState', async () => {
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
		const recordingGate = requireBiometricConsent('recording');

		await recordingGate(mockReq({ body: { sessionId: 1 } }), mockRes(), jest.fn());

		expect(consentService.checkConsentState).toHaveBeenCalledWith(1, 'recording', 1001);
	});

	test('unknown state → 403 fail-closed', async () => {
		consentService.checkConsentState.mockResolvedValue({ state: 'something-unexpected' });
		const req = mockReq({ body: { sessionId: 42 } });
		const res = mockRes();
		const next = jest.fn();

		await middleware(req, res, next);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(next).not.toHaveBeenCalled();
	});

	test('no req.user → 403 fail-closed (unauthenticated cannot pass gate)', async () => {
		const req = mockReq({ body: { sessionId: 42 }, user: undefined });
		const res = mockRes();
		const next = jest.fn();

		await middleware(req, res, next);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'CONSENT_REQUIRED' }),
		);
		expect(next).not.toHaveBeenCalled();
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	test('receipt for another candidate → 403 (IDOR protection)', async () => {
		// DB returns missing because the receipt belongs to a different candidate.
		consentService.checkConsentState.mockResolvedValue({ state: 'missing' });
		const req = mockReq({ body: { sessionId: 42 }, user: { id: 1001 } });
		const res = mockRes();

		await middleware(req, res, jest.fn());

		expect(consentService.checkConsentState).toHaveBeenCalledWith(42, 'biometric', 1001);
		expect(res.status).toHaveBeenCalledWith(403);
	});

	test('non-integer sessionId → 400 (type confusion rejected)', async () => {
		for (const bad of [['1'], {}, 0, -5, 'abc']) {
			const req = mockReq({ body: { sessionId: bad } });
			const res = mockRes();
			const next = jest.fn();
			jest.clearAllMocks();

			await middleware(req, res, next);

			expect(res.status).toHaveBeenCalledWith(400);
			expect(next).not.toHaveBeenCalled();
		}
		expect(consentService.checkConsentState).not.toHaveBeenCalled();
	});

	test('numeric string sessionId is coerced and accepted', async () => {
		consentService.checkConsentState.mockResolvedValue({ state: 'valid' });
		const req = mockReq({ body: { sessionId: '42' } });
		const res = mockRes();
		const next = jest.fn();

		await middleware(req, res, next);

		expect(consentService.checkConsentState).toHaveBeenCalledWith(42, 'biometric', 1001);
		expect(next).toHaveBeenCalledTimes(1);
	});
});
