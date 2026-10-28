/**
 * diarizationFlag — the ONLY reader of DIARIZATION_ENABLED
 * (S-D04, #1906; Architecture §6.1 BR-1).
 *
 * The vendor/enablement gate for speaker labelling: OFF by default
 * everywhere. The flag-flip for real recordings is a release-checklist
 * act (S-D17) requiring Lex's G1/G2 conditions — this module only reads.
 *
 * Rules (fail-closed, mirroring lib/observerCaptureFlag.js):
 *   - ON only when the env var is exactly the string 'true'. Unset,
 *     'TRUE', '1', 'yes', whitespace-padded — all OFF.
 *   - Read FRESH on every call. Nothing may cache it: the transcribe
 *     path and the worker poll must see a flip at the next read.
 *   - No other module reads the env var directly.
 */
function isDiarizationEnabled(env = process.env) {
	return env.DIARIZATION_ENABLED === 'true';
}

module.exports = { isDiarizationEnabled };
