/**
 * S-064 (#714): Withdrawn-consent recovery UI.
 *
 *   AC-1: candidate who withdrew consent sees an inline recovery message
 *         (not a redirect) when a biometric-gated call fails
 *   AC-2: "Review consent again" navigates to the consent screens with
 *         ?sessionId= and ?reason=withdrawn
 *   AC-3: "End session" calls onExit (the caller abandons the session)
 *   AC-4: copy is honest and non-pressuring (UX architect reviewed)
 *   AC-5: "Continue without" is the primary path (session can proceed)
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WithdrawnConsentRecovery } from '@/components/WithdrawnConsentRecovery';

const defaultProps = {
	consentType: 'biometric',
	sessionId: 42 as number | null,
	onContinue: vi.fn(),
	onExit: vi.fn(),
};

describe('WithdrawnConsentRecovery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('AC-1: renders the recovery message inline', () => {
		render(<WithdrawnConsentRecovery {...defaultProps} />);
		expect(
			screen.getByRole('heading', { name: /consent withdrawn/i }),
		).toBeInTheDocument();
	});

	it('AC-2: re-consent link points at the consent screens with sessionId and reason', () => {
		render(<WithdrawnConsentRecovery {...defaultProps} />);
		const link = screen.getByRole('link', { name: /review consent again/i });
		expect(link.getAttribute('href')).toBe(
			'/interview/consent?sessionId=42&reason=withdrawn',
		);
	});

	it('AC-3: exit button calls onExit', () => {
		const onExit = vi.fn();
		render(<WithdrawnConsentRecovery {...defaultProps} onExit={onExit} />);
		fireEvent.click(screen.getByRole('button', { name: /end session/i }));
		expect(onExit).toHaveBeenCalledTimes(1);
	});

	it('AC-4: copy does not pressure the candidate to re-consent', () => {
		render(<WithdrawnConsentRecovery {...defaultProps} />);
		// No urgency language, no consequence threats, no blanket promises.
		expect(screen.queryByText(/must/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/required to continue/i)).not.toBeInTheDocument();
		expect(
			screen.queryByText(/nothing further will be collected/i),
		).not.toBeInTheDocument();
	});

	it('AC-5: continue-without is the primary action', () => {
		const onContinue = vi.fn();
		render(
			<WithdrawnConsentRecovery {...defaultProps} onContinue={onContinue} />,
		);
		const btn = screen.getByRole('button', {
			name: /continue without biometric collection/i,
		});
		expect(btn).toBeInTheDocument();
		// Primary styling (bg-primary), unlike the secondary actions.
		expect(btn.className).toMatch(/bg-primary/);
		fireEvent.click(btn);
		expect(onContinue).toHaveBeenCalledTimes(1);
	});

	it('uses neutral status role, not alert (withdrawal was deliberate)', () => {
		const { container } = render(
			<WithdrawnConsentRecovery {...defaultProps} />,
		);
		expect(container.querySelector('[role="status"]')).toBeInTheDocument();
		expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument();
	});

	it('works without a sessionId (re-consent link omits it)', () => {
		render(<WithdrawnConsentRecovery {...defaultProps} sessionId={null} />);
		const link = screen.getByRole('link', { name: /review consent again/i });
		expect(link.getAttribute('href')).toBe('/interview/consent?reason=withdrawn');
	});
});
