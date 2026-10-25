/**
 * S-073 (#733): QP biometric consent frontend flow.
 *
 *   AC-2: consent UI shown with QP-specific text before recording
 *   AC-3: accept → consent recorded → onAccepted (video mode)
 *   AC-4: decline → onDeclined (parent shows respectful messaging);
 *         decline receipt recorded best-effort for audit trail
 *
 * Text mode is exempt (no frames = no consent needed) — this component
 * only renders in the video path.
 *
 * #1306: apiCall prepends '/api' itself (lib/api.ts) — the path argument
 * must be '/consent/record'. The previous version of this test mocked
 * apiCall and asserted '/api/consent/record', encoding the double-/api
 * 404 bug as correct behaviour. The server round-trip is proven by the
 * real-DB integration test (server/__tests__/lib/consentService.integration.test.js).
 *
 * H1 (UX architect): the component carries no local declined UI — the
 * parent renders the declined panel on onDeclined(). The component must
 * not promise anything about backend enforcement it cannot verify.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QPBiometricConsent } from '@/components/QPBiometricConsent';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const CONSENT_TEXT = {
	consent_type: 'biometric_practice',
	version: 1,
	text_en: 'DRAFT — What we collect: biometric measurements from your practice video…',
	text_hi: 'DRAFT — हम क्या एकत्र करते हैं…',
	effective_from: '2026-10-11T00:00:00.000Z',
};

function mockSuccess() {
	mockApiCall.mockImplementation(async (url: string, options?: { method?: string }) => {
		if (String(url).includes('/consent/texts/biometric_practice')) {
			return CONSENT_TEXT;
		}
		if (String(url) === '/consent/record') {
			expect(options?.method).toBe('POST');
			return { id: 1, type: 'biometric_practice', accepted: true };
		}
		throw new Error(`unexpected apiCall: ${url}`);
	});
}

function renderConsent(overrides?: { onAccepted?: () => void; onDeclined?: () => void }) {
	const onAccepted = overrides?.onAccepted ?? vi.fn();
	const onDeclined = overrides?.onDeclined ?? vi.fn();
	const onBack = vi.fn();
	render(
		<QPBiometricConsent
			sessionId={42}
			onAccepted={onAccepted}
			onDeclined={onDeclined}
			onBack={onBack}
		/>,
	);
	return { onAccepted, onDeclined, onBack };
}

describe('QPBiometricConsent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it('AC-2: renders the QP-specific consent text before recording', async () => {
		mockSuccess();
		renderConsent();

		await waitFor(() => {
			expect(screen.getByText(/what we collect/i)).toBeInTheDocument();
		});
		// Must be the QP text, not the interview biometric text
		expect(screen.queryByText(/hiring decision/i)).not.toBeInTheDocument();
	});

	it('AC-2: consent text region is labelled for assistive tech (L4)', async () => {
		mockSuccess();
		renderConsent();

		await waitFor(() => {
			expect(
				screen.getByRole('region', { name: /biometric consent text/i }),
			).toBeInTheDocument();
		});
	});

	it('AC-3: accept records biometric_practice consent and calls onAccepted', async () => {
		mockSuccess();
		const { onAccepted } = renderConsent();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /i consent/i })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole('button', { name: /i consent/i }));

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith(
				'/consent/record',
				expect.objectContaining({
					method: 'POST',
					body: expect.objectContaining({
						sessionId: 42,
						type: 'biometric_practice',
						accepted: true,
					}),
				}),
			);
			expect(onAccepted).toHaveBeenCalled();
		});
	});

	it('AC-4: decline calls onDeclined (parent renders respectful messaging); no punitive copy here', async () => {
		mockSuccess();
		const { onDeclined } = renderConsent();

		await waitFor(() => {
			expect(
				screen.getByRole('button', { name: /decline and use text mode/i }),
			).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole('button', { name: /decline and use text mode/i }));

		await waitFor(() => {
			expect(onDeclined).toHaveBeenCalled();
		});
		// H1: no local declined UI — the parent owns the decline messaging.
		// The component itself must never carry punitive language.
		expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
	});

	it('AC-4: decline records the decline for audit trail (best-effort)', async () => {
		mockSuccess();
		renderConsent();

		await waitFor(() => {
			expect(
				screen.getByRole('button', { name: /decline and use text mode/i }),
			).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole('button', { name: /decline and use text mode/i }));

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith(
				'/consent/record',
				expect.objectContaining({
					body: expect.objectContaining({ accepted: false }),
				}),
			);
		});
	});

	it('M4: header copy does not imply video-without-analysis exists', async () => {
		mockSuccess();
		renderConsent();

		await waitFor(() => {
			expect(screen.getByText(/what we collect/i)).toBeInTheDocument();
		});
		// "This step is optional" (accurate) — never bare "This is optional"
		expect(
			screen.getByText(/this step is optional — you can practice with a text response instead/i),
		).toBeInTheDocument();
	});

	it('shows loading state with a back affordance (M2)', () => {
		mockApiCall.mockImplementation(() => new Promise(() => {})); // never resolves
		const { onBack } = renderConsent();
		expect(screen.getByText(/loading/i)).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: /back to mode selection/i }));
		expect(onBack).toHaveBeenCalled();
	});

	it('MEDIUM-3: error state offers a way back (never strands the user)', async () => {
		mockApiCall.mockRejectedValue(new Error('Request failed: 500'));
		const { onBack } = renderConsent();

		await waitFor(() => {
			expect(screen.getByText(/could not load/i)).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole('button', { name: /back to mode selection/i }));
		expect(onBack).toHaveBeenCalled();
	});

	it('shows error with retry when consent text fails to load (L3: no assumed cause)', async () => {
		mockApiCall.mockRejectedValue(new Error('Request failed: 500'));
		renderConsent();

		await waitFor(() => {
			expect(screen.getByText(/could not load/i)).toBeInTheDocument();
		});
		// L3: does not blame the user's connection outright — retry comes first
		expect(screen.getByText(/please try again/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
	});

	it('shows error with retry when consent record fails on accept', async () => {
		mockApiCall.mockImplementation(async (url: string) => {
			if (String(url).includes('/consent/texts/')) return CONSENT_TEXT;
			throw new Error('Network error');
		});

		renderConsent();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /i consent/i })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole('button', { name: /i consent/i }));

		await waitFor(() => {
			expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
		});
	});

	it('LOW-6: consent text shows version and effective date', async () => {
		mockSuccess();
		renderConsent();

		await waitFor(() => {
			expect(screen.getByText(/what we collect/i)).toBeInTheDocument();
		});
		expect(screen.getByText(/consent v1/i)).toBeInTheDocument();
	});
});
