/**
 * S-048 (#696): Observer consent disclosure — component tests.
 *
 * Verifies the ConsentDialog disclosure copy branches correctly on the
 * default-deny gate states (privacy-engineer BLOCKER):
 * - granted  → affirmative notice ("will include AI-assisted analysis...")
 * - declined → reassurance copy ("disabled — you declined biometric analysis")
 * - unknown  → no notice (observer blocked, nothing truthful to disclose)
 * - observer disabled → no notice (AC-2)
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsentDialog } from '@/pages/candidate/livekit-room';

// Dialog primitives render in a portal; testing-library handles it.
vi.mock('@/components/ui/dialog', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/components/ui/dialog')>();
	return actual;
});

const baseProps = {
	open: true,
	onClose: vi.fn(),
	participants: [{ userId: 1, name: 'Jane', consented: false }],
	recordingId: 42,
	onConsentGiven: vi.fn(),
	onStartRecording: vi.fn(),
	allConsented: false,
	consentLoading: false,
};

describe('ConsentDialog observer disclosure (S-048)', () => {
	it('shows affirmative disclosure when observer enabled + consent granted', () => {
		render(<ConsentDialog {...baseProps} observerEnabled={true} observerConsent="granted" />);
		expect(
			screen.getByText(/will include AI-assisted analysis of your voice and video/i),
		).toBeInTheDocument();
		const link = screen.getByRole('link', { name: /learn more/i });
		expect(link).toHaveAttribute('href', '/privacy/biometric-policy');
	});

	it('shows reassurance copy when observer enabled + consent declined', () => {
		render(<ConsentDialog {...baseProps} observerEnabled={true} observerConsent="declined" />);
		expect(
			screen.getByText(/AI-assisted analysis of this session is disabled/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/will include AI-assisted analysis/i)).not.toBeInTheDocument();
	});

	it('shows no disclosure when observer enabled + consent unknown', () => {
		render(<ConsentDialog {...baseProps} observerEnabled={true} observerConsent="unknown" />);
		expect(screen.queryByText(/AI-assisted analysis/i)).not.toBeInTheDocument();
	});

	it('shows no disclosure when observer disabled (AC-2)', () => {
		render(<ConsentDialog {...baseProps} observerEnabled={false} observerConsent="granted" />);
		expect(screen.queryByText(/AI-assisted analysis/i)).not.toBeInTheDocument();
	});

	it('shows no disclosure when observer fields absent', () => {
		render(<ConsentDialog {...baseProps} />);
		expect(screen.queryByText(/AI-assisted analysis/i)).not.toBeInTheDocument();
	});
});
