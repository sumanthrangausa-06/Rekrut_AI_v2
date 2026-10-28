/**
 * diarizationFlag.test.js — S-D04 (#1906)
 * The DIARIZATION_ENABLED flag (Architecture §6.1 BR-1): OFF by default,
 * ON only for exactly 'true', read fresh on every call (never cached).
 */
const { isDiarizationEnabled } = require('../../../lib/diarizationFlag');

describe('diarizationFlag (BR-1)', () => {
	it('is OFF when the env var is unset', () => {
		expect(isDiarizationEnabled({})).toBe(false);
	});

	it("is ON only for exactly 'true'", () => {
		expect(isDiarizationEnabled({ DIARIZATION_ENABLED: 'true' })).toBe(true);
		for (const v of ['TRUE', 'True', '1', 'yes', ' true', 'true ', '']) {
			expect(isDiarizationEnabled({ DIARIZATION_ENABLED: v })).toBe(false);
		}
	});

	it('reads the env fresh on every call — a flip takes effect immediately', () => {
		const env = { DIARIZATION_ENABLED: 'true' };
		expect(isDiarizationEnabled(env)).toBe(true);
		env.DIARIZATION_ENABLED = 'false';
		expect(isDiarizationEnabled(env)).toBe(false);
	});
});
