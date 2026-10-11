/**
 * S-060 (#710): "Request Human Interview" button wires to the backend.
 *
 * The button already exists on the biometric-decline offer screen, but it only
 * fires an analytics event — it never calls the S-012 backend. These tests pin
 * the required behavior:
 *   AC-1: decline biometric → "Request human interview" button visible
 *   AC-2: click → POST /api/interviews/sessions/:id/request-human-interview
 *   AC-3: 201 → confirmation message
 *   AC-4: failure → error message + retry
 *   AC-5: button only in biometric_offer state (not on accept path)
 * Plus: 409 REQUEST_ALREADY_EXISTS → treated as sent (idempotent UX).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentScreensPage } from '@/pages/consent-screens';

// Analytics must not hit the network in tests.
vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

const SESSION_ID = '42';

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	let idx = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			const r = responses[Math.min(idx++, responses.length - 1)];
			return {
				ok: r.ok,
				status: r.status,
				json: async () => r.body,
			} as Response;
		}),
	);
	return calls;
}

function renderPage() {
	return render(
		<MemoryRouter initialEntries={[`/interview/consent?sessionId=${SESSION_ID}`]}>
			<ConsentScreensPage />
		</MemoryRouter>,
	);
}

/** Consent texts load + three screens render; decline the biometric one. */
async function declineBiometric() {
	// texts for recording/biometric/id_verification — the step heading (h1) is unique
	await waitFor(() => {
		expect(screen.getByRole('heading', { name: /interview recording/i })).toBeInTheDocument();
	});
	// Move to biometric step: accept recording first
	fireEvent.click(screen.getByRole('button', { name: /accept/i }));
	await waitFor(() => {
		expect(screen.getByRole('heading', { name: /biometric analysis/i })).toBeInTheDocument();
	});
	fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
	// biometric_offer screen appears
	await waitFor(() => {
		expect(screen.getByRole('heading', { name: /human interview available/i })).toBeInTheDocument();
	});
}

const consentTexts = (type: string) => ({
	ok: true,
	status: 200,
	body: { consent_type: type, version: '1', text_en: 'Test text 1. what we collect: x 2. how long: y 3. how to delete: z', text_en2: '', text_hi: '', effective_from: '2026-01-01' },
});

describe('S-060: Request human interview button', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('AC-1: shows the request button after biometric decline', async () => {
		mockFetchSequence([
			consentTexts('recording'),
			consentTexts('biometric'),
			consentTexts('id_verification'),
			{ ok: true, status: 200, body: { ok: true } }, // /api/consent/record
		]);
		renderPage();
		await declineBiometric();
		expect(screen.getByRole('button', { name: /request human interview/i })).toBeInTheDocument();
	});

	it('AC-2: click calls POST /api/interviews/sessions/:id/request-human-interview', async () => {
		const calls = mockFetchSequence([
			consentTexts('recording'),
			consentTexts('biometric'),
			consentTexts('id_verification'),
			{ ok: true, status: 200, body: { ok: true } }, // record decline
			{ ok: true, status: 201, body: { request: { id: 7, status: 'pending' } } }, // human-interview request
		]);
		renderPage();
		await declineBiometric();
		fireEvent.click(screen.getByRole('button', { name: /request human interview/i }));
		await waitFor(() => {
			const hit = calls.find((c) => c.url.includes('/api/interviews/sessions/42/request-human-interview'));
			expect(hit).toBeDefined();
			expect(hit!.init?.method).toBe('POST');
		});
	});

	it('AC-3: 201 shows confirmation message', async () => {
		mockFetchSequence([
			consentTexts('recording'),
			consentTexts('biometric'),
			consentTexts('id_verification'),
			{ ok: true, status: 200, body: { ok: true } },
			{ ok: true, status: 201, body: { request: { id: 7, status: 'pending' } } },
		]);
		renderPage();
		await declineBiometric();
		fireEvent.click(screen.getByRole('button', { name: /request human interview/i }));
		await waitFor(() => {
			expect(screen.getByText(/request sent/i)).toBeInTheDocument();
		});
	});

	it('409 REQUEST_ALREADY_EXISTS is treated as sent (idempotent UX)', async () => {
		mockFetchSequence([
			consentTexts('recording'),
			consentTexts('biometric'),
			consentTexts('id_verification'),
			{ ok: true, status: 200, body: { ok: true } },
			{ ok: false, status: 409, body: { code: 'REQUEST_ALREADY_EXISTS', error: 'already requested' } },
		]);
		renderPage();
		await declineBiometric();
		fireEvent.click(screen.getByRole('button', { name: /request human interview/i }));
		await waitFor(() => {
			expect(screen.getByText(/request sent/i)).toBeInTheDocument();
		});
	});

	it('AC-4: server error shows error message with retry option', async () => {
		const calls = mockFetchSequence([
			consentTexts('recording'),
			consentTexts('biometric'),
			consentTexts('id_verification'),
			{ ok: true, status: 200, body: { ok: true } },
			{ ok: false, status: 500, body: { code: 'INTERNAL_ERROR', error: 'Request failed' } },
		]);
		renderPage();
		await declineBiometric();
		fireEvent.click(screen.getByRole('button', { name: /request human interview/i }));
		// Error alert renders…
		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
		});
		// …and the same button becomes the retry control.
		const retry = screen.getByRole('button', { name: /^try again$/i });
		expect(retry).toBeInTheDocument();
		// Retry re-attempts: second click fires the request again.
		fireEvent.click(retry);
		await waitFor(() => {
			const hits = calls.filter((c) => c.url.includes('request-human-interview'));
			expect(hits.length).toBeGreaterThanOrEqual(2);
		});
	});

	it('shows a loading state while the request is in flight', async () => {
		let resolveRequest!: (v: unknown) => void;
		const pending = new Promise((res) => {
			resolveRequest = res;
		});
		const calls: Array<{ url: string }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				calls.push({ url: String(url) });
				if (String(url).includes('request-human-interview')) {
					await pending;
					return { ok: true, status: 201, json: async () => ({ request: { id: 1 } }) } as Response;
				}
				if (String(url).includes('/api/consent/texts/')) {
					const type = String(url).split('/').pop();
					return { ok: true, status: 200, json: async () => consentTexts(type!).body } as Response;
				}
				return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
			}),
		);
		renderPage();
		await declineBiometric();
		fireEvent.click(screen.getByRole('button', { name: /request human interview/i }));
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /sending|requesting/i })).toBeInTheDocument();
		});
		resolveRequest(null);
		await waitFor(() => {
			expect(screen.getByText(/request sent/i)).toBeInTheDocument();
		});
	});

	it('AC-5: button does not appear on the accept path', async () => {
		mockFetchSequence([
			consentTexts('recording'),
			consentTexts('biometric'),
			consentTexts('id_verification'),
			{ ok: true, status: 200, body: { ok: true } },
			{ ok: true, status: 200, body: { ok: true } },
		]);
		renderPage();
		// Accept all three consents — never declines.
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /interview recording/i })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole('button', { name: /accept/i }));
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /biometric analysis/i })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole('button', { name: /accept/i }));
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /id verification/i })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole('button', { name: /accept/i }));
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: /request human interview/i })).not.toBeInTheDocument();
		});
	});
});
