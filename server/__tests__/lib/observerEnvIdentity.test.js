/**
 * observerEnvIdentity — Gate A (S-085 #787), design D-1.
 * STOP 1 evidence: NODE_ENV is unset on BOTH staging and production
 * (Render API, 2026-10-13), so identity resolution must prefer the
 * explicit stamp and the Render service name, and fail closed to
 * 'unknown' (capture-ineligible).
 */
const { resolveEnvIdentity } = require('../../../lib/observerEnvIdentity');

describe('resolveEnvIdentity', () => {
	test('explicit stamp wins', () => {
		expect(resolveEnvIdentity({ REKRUT_ENV_IDENTITY: 'production' })).toBe('production');
		expect(resolveEnvIdentity({ REKRUT_ENV_IDENTITY: 'staging', RENDER_SERVICE_NAME: 'rekrutai-prod' })).toBe('staging');
	});

	test('unrecognised explicit stamp fails closed to unknown (never falls through)', () => {
		expect(resolveEnvIdentity({ REKRUT_ENV_IDENTITY: 'bogus', RENDER_SERVICE_NAME: 'rekrutai-staging' })).toBe('unknown');
	});

	test('Render service name mapping (no env change needed)', () => {
		expect(resolveEnvIdentity({ RENDER_SERVICE_NAME: 'rekrutai-prod' })).toBe('production');
		expect(resolveEnvIdentity({ RENDER_SERVICE_NAME: 'rekrutai-staging' })).toBe('staging');
		expect(resolveEnvIdentity({ RENDER_SERVICE_NAME: 'rekrutai-dev' })).toBe('development');
	});

	test('NODE_ENV is only a fallback signal', () => {
		expect(resolveEnvIdentity({ NODE_ENV: 'production' })).toBe('production');
		expect(resolveEnvIdentity({ NODE_ENV: 'test' })).toBe('test');
		expect(resolveEnvIdentity({ RENDER_SERVICE_NAME: 'unrelated-service', NODE_ENV: 'development' })).toBe('development');
	});

	test('nothing set ⇒ unknown — the actual staging/prod NODE_ENV reality without the stamp', () => {
		expect(resolveEnvIdentity({})).toBe('unknown');
		expect(resolveEnvIdentity({ NODE_ENV: '' })).toBe('unknown');
	});
});
