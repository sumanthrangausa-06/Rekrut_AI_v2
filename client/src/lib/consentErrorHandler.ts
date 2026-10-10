/**
 * consentErrorHandler — Frontend handling for consent-related API errors.
 *
 * When the `requireBiometricConsent` middleware (S-011) blocks a request,
 * it returns a 403 with a `code` field. This module translates those codes
 * into user-facing recovery actions:
 *
 *   CONSENT_REQUIRED      → redirect to /interview/consent?sessionId=X
 *   CONSENT_VERSION_STALE → redirect to /interview/consent?sessionId=X&reason=stale
 *   CONSENT_WITHDRAWN     → no redirect (caller shows inline message)
 *   others                → no action (throw normally)
 *
 * Non-consent 403s (auth failures, etc.) are never touched.
 */

/** Codes that trigger a redirect to the consent screens. */
const REDIRECT_CODES = new Set(['CONSENT_REQUIRED', 'CONSENT_VERSION_STALE']);

/**
 * Returns true if the error code is a consent-related code from the
 * requireBiometricConsent middleware.
 */
export function isConsentErrorCode(code: string | undefined): boolean {
	if (!code) return false;
	return code.startsWith('CONSENT_');
}

/**
 * Returns true if this consent code should trigger a redirect to the
 * consent screens. CONSENT_WITHDRAWN is intentionally excluded — the
 * withdrawal was deliberate, so we show an inline message instead of
 * yanking the user to a different page.
 */
export function shouldRedirectForConsentCode(code: string | undefined): boolean {
	if (!code) return false;
	return REDIRECT_CODES.has(code);
}

/**
 * Extract a sessionId from a request URL and/or body.
 * Checks (in order): body.sessionId, body.interview_id, URL path /mock/:id/,
 * URL query ?sessionId=. Returns null if not found or invalid.
 */
export function extractSessionIdFromRequest(
	requestUrl: string,
	body?: unknown,
): number | null {
	// 1. Body fields (most reliable — explicit)
	if (body && typeof body === 'object') {
		const b = body as Record<string, unknown>;
		const fromBody = parseSessionId(b.sessionId ?? b.interview_id);
		if (fromBody !== null) return fromBody;
	}

	// 2. URL path: /mock/:sessionId/...
	const pathMatch = requestUrl.match(/\/mock\/(\d+)(?:\/|$|\?)/);
	if (pathMatch) {
		const fromPath = parseSessionId(pathMatch[1]);
		if (fromPath !== null) return fromPath;
	}

	// 3. Query string: ?sessionId=123
	const queryMatch = requestUrl.match(/[?&]sessionId=(\d+)/);
	if (queryMatch) {
		const fromQuery = parseSessionId(queryMatch[1]);
		if (fromQuery !== null) return fromQuery;
	}

	return null;
}

/** Parse a value as a positive integer sessionId. Returns null if invalid. */
function parseSessionId(value: unknown): number | null {
	if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
		return value;
	}
	if (typeof value === 'string' && /^\d+$/.test(value)) {
		const n = parseInt(value, 10);
		if (n > 0) return n;
	}
	return null;
}

/**
 * Build the redirect URL for a consent error code, or null if this code
 * should not redirect. The consent screens page reads ?sessionId= and
 * ?reason=stale from the query string.
 */
export function getConsentRedirect(
	code: string | undefined,
	sessionId: number | null,
): string | null {
	if (!shouldRedirectForConsentCode(code)) return null;

	let url = '/interview/consent';
	const params = new URLSearchParams();
	if (sessionId !== null) {
		params.set('sessionId', String(sessionId));
	}
	if (code === 'CONSENT_VERSION_STALE') {
		params.set('reason', 'stale');
	}
	const query = params.toString();
	if (query) url += `?${query}`;
	return url;
}
