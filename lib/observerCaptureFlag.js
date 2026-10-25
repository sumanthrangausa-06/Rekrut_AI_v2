/**
 * observerCaptureFlag — the ONLY reader of OBSERVER_AUDIO_CAPTURE_ENABLED
 * (Gate A, S-085 #787, design §3.2 G-FLAG).
 *
 * Rules (fail-closed, no exceptions):
 *   - The flag is ON only when the env var is exactly the string 'true'.
 *     Unset, 'TRUE', '1', 'yes', whitespace-padded — all OFF.
 *   - The env var is read FRESH on every call. Nothing in the capture path
 *     may cache it: flipping the flag must take effect at the next read
 *     (the ≤2 s kill bound depends on the 1 s watchdog reading it fresh).
 *   - No other module reads the env var directly (build-evidence grep in
 *     the validation suite enforces this).
 *
 * Transition tracking: the module remembers the previously observed state
 * so the worker can emit a `flag_transition` log line (design §6.4)
 * whenever a read differs from the previous read. The boot baseline read
 * counts as the first transition (from null).
 */

const FLAG_ENV_VAR = 'OBSERVER_AUDIO_CAPTURE_ENABLED';

let previousState = null;
let pendingTransition = null;

function readCaptureFlag(env = process.env) {
	const current = env[FLAG_ENV_VAR] === 'true';
	if (previousState !== current) {
		pendingTransition = { from: previousState, to: current };
		previousState = current;
	}
	return current;
}

/**
 * Return (and clear) the pending flag transition, if any read since the
 * last consume observed a state change. Returns null when nothing changed.
 */
function consumeFlagTransition() {
	const t = pendingTransition;
	pendingTransition = null;
	return t;
}

/** Test-only: reset transition tracking between suites. */
function _resetFlagState() {
	previousState = null;
	pendingTransition = null;
}

module.exports = {
	FLAG_ENV_VAR,
	readCaptureFlag,
	consumeFlagTransition,
	_resetFlagState,
};
