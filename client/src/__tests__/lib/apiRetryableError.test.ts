/**
 * #1365 — apiCall must not strip the server's retry signal on !res.ok.
 *
 * The server's retryable failures are real HTTP errors, not resolved
 * bodies: routes/quick-practice.js returns
 *   503 { error, retryable: true, retryAfterMs: 3000 }
 * for submit-video provider/timeout/content-failed failures (and
 * retryable:true, no retryAfterMs, for text submit). apiCall throws on
 * !res.ok, so those fields only reach a caller's retry check if they are
 * preserved on the thrown error — previously only .code and .status were
 * attached, so the frontend "auto-retry once on 503" logic could never
 * fire for a real 503.
 *
 * fetch is stubbed at the network boundary with the exact server body
 * shape (the shape server tests pin in
 * server/__tests__/routes/qp-practice-submit-video-1357.test.js).
 * These are regression pins; they do NOT satisfy the Quinn E2E-on-dev
 * closure gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiCall } from '../../lib/api';

type ThrownError = Error & {
	status?: number;
	code?: string;
	retryable?: boolean;
	retryAfterMs?: number;
};

function stubErrorResponse(status: number, body: Record<string, unknown>) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok: false,
			status,
			json: async () => body,
		})),
	);
}

async function captureThrown(): Promise<ThrownError> {
	try {
		// POST, like production: this also traverses apiCall's CSRF branch
		// (the stub's non-ok response makes getCsrfToken return null and
		// proceed), so the pin matches the live submit-video path.
		await apiCall('/interviews/practice/submit-video', {
			method: 'POST',
			body: { question_id: 'beh-1' },
		});
	} catch (err) {
		return err as ThrownError;
	}
	throw new Error('apiCall should have thrown on a 503 response');
}

describe('apiCall retryable error preservation (#1365)', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.unstubAllGlobals();
	});

	it('a real 503 body reaches the caller retry check: status + retryable + retryAfterMs + message', async () => {
		stubErrorResponse(503, {
			error: 'AI analysis is temporarily unavailable. Please try again in a moment.',
			retryable: true,
			retryAfterMs: 3000,
		});

		const err = await captureThrown();

		expect(err).toBeInstanceOf(Error);
		expect(err.message).toBe(
			'AI analysis is temporarily unavailable. Please try again in a moment.',
		);
		expect(err.status).toBe(503);
		expect(err.retryable).toBe(true);
		expect(err.retryAfterMs).toBe(3000);
		// The exact check a caller performs to auto-retry once on 503:
		expect(err.status === 503 && err.retryable === true).toBe(true);
	});

	it('text-submit shape: retryable:true with no retryAfterMs does not invent a delay', async () => {
		stubErrorResponse(503, {
			error: 'AI coaching is temporarily unavailable. Please try again in a moment.',
			retryable: true,
		});

		const err = await captureThrown();

		expect(err.retryable).toBe(true);
		expect(err.retryAfterMs).toBeUndefined();
	});

	it('an explicit server retryable:false is preserved (distinct from "server said nothing")', async () => {
		stubErrorResponse(500, { error: 'Failed to analyze video response. Please try again.', retryable: false });

		const err = await captureThrown();

		expect(err.retryable).toBe(false);
		expect(err.status === 503 && err.retryable === true).toBe(false);
	});

	it('malformed field types are not propagated: string retryable / string retryAfterMs are dropped', async () => {
		stubErrorResponse(503, {
			error: 'AI analysis is temporarily unavailable. Please try again in a moment.',
			retryable: 'true',
			retryAfterMs: '3000',
		});

		const err = await captureThrown();

		expect(err.retryable).toBeUndefined();
		expect(err.retryAfterMs).toBeUndefined();
	});

	it('backward compat: a non-retryable error gains no invented retryable flag, .code/.message unchanged', async () => {
		stubErrorResponse(400, { error: 'Response must be at least 50 characters', code: 'TOO_SHORT' });

		const err = await captureThrown();

		expect(err.message).toBe('Response must be at least 50 characters');
		expect(err.status).toBe(400);
		expect(err.code).toBe('TOO_SHORT');
		expect(err.retryable).toBeUndefined();
		expect(err.retryAfterMs).toBeUndefined();
	});
});
