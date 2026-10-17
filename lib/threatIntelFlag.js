/**
 * threatIntelFlag — the ONLY reader of the threat-intel dark flag
 * (#807, S-090; observerCaptureFlag pattern, STOP 1 §3c).
 *
 * Rules (fail-closed, no exceptions):
 *   - The flag is ON only when the env var is exactly the string
 *     'true'. Unset, 'TRUE', '1', 'yes', whitespace-padded — all OFF.
 *   - The env var is read FRESH on every call. Nothing may cache it:
 *     flipping the flag must take effect at the next read.
 *   - No other module reads the env var directly (build-evidence
 *     census in the validation suite enforces this).
 *
 * The chassis is dark by default: with the flag OFF the pipeline
 * refuses every check and writes nothing. Setting the flag 'true' in
 * any production environment is additionally blocked until the #788
 * determination closes and the DSAR/export follow-up for this table
 * is built (see lib/threatIntelChecks.js header).
 */

const FLAG_ENV_VAR = 'THREAT_INTEL_ENABLED';

function isThreatIntelEnabled(env = process.env) {
	return env[FLAG_ENV_VAR] === 'true';
}

module.exports = {
	FLAG_ENV_VAR,
	isThreatIntelEnabled,
};
