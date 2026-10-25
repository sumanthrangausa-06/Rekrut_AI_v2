/**
 * observerCaptureFlag — Gate A (S-085 #787), design §3.2 G-FLAG.
 * The flag's only reader. ON only for the exact string 'true'; read fresh
 * on every call; transitions surfaced for the §6.4 flag_transition log.
 */
const flag = require('../../../lib/observerCaptureFlag');

describe('readCaptureFlag', () => {
	beforeEach(() => flag._resetFlagState());

	test("only the exact string 'true' is ON", () => {
		expect(flag.readCaptureFlag({})).toBe(false);
		expect(flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: 'TRUE' })).toBe(false);
		expect(flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: '1' })).toBe(false);
		expect(flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: ' true' })).toBe(false);
		expect(flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: 'true ' })).toBe(false);
		expect(flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: 'yes' })).toBe(false);
		expect(flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: 'true' })).toBe(true);
	});

	test('reads are fresh — a flip takes effect at the very next read (kill bound)', () => {
		const env = { OBSERVER_AUDIO_CAPTURE_ENABLED: 'true' };
		expect(flag.readCaptureFlag(env)).toBe(true);
		env.OBSERVER_AUDIO_CAPTURE_ENABLED = 'false';
		expect(flag.readCaptureFlag(env)).toBe(false);
		delete env.OBSERVER_AUDIO_CAPTURE_ENABLED;
		expect(flag.readCaptureFlag(env)).toBe(false);
	});

	test('transitions: boot baseline counts, flips surface once, steady state is quiet', () => {
		flag.readCaptureFlag({});
		expect(flag.consumeFlagTransition()).toEqual({ from: null, to: false });
		expect(flag.consumeFlagTransition()).toBeNull();
		flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: 'true' });
		expect(flag.consumeFlagTransition()).toEqual({ from: false, to: true });
		flag.readCaptureFlag({ OBSERVER_AUDIO_CAPTURE_ENABLED: 'true' });
		expect(flag.consumeFlagTransition()).toBeNull();
	});
});
