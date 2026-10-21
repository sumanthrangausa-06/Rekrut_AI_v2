import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Mock analytics to avoid side effects
vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

import { BiometricPolicyPage } from '@/pages/biometric-policy';

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/privacy/biometric-policy" element={<BiometricPolicyPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('BiometricPolicyPage (S-056)', () => {
	it('renders at /privacy/biometric-policy without auth', () => {
		renderAt('/privacy/biometric-policy');
		expect(
			screen.getByRole('heading', { name: /biometric privacy policy/i }),
		).toBeInTheDocument();
	});

	it('describes what biometric data is collected', () => {
		renderAt('/privacy/biometric-policy');
		expect(screen.getByRole('heading', { name: /what we collect/i })).toBeInTheDocument();
		// Must name the concrete biometric data types
		expect(screen.getAllByText(/face/i).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/voice/i).length).toBeGreaterThan(0);
	});

	it('describes why biometric data is collected', () => {
		renderAt('/privacy/biometric-policy');
		expect(screen.getByText(/why we collect/i)).toBeInTheDocument();
	});

	it('does not promise the spec-only 60-second calibration warm-up (FS-140, #1095)', () => {
		renderAt('/privacy/biometric-policy');
		// No warm-up/calibration-baseline feature exists in the product;
		// the policy page must not promise one.
		expect(screen.queryByText(/60-second warm-up/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/personal baseline/i)).not.toBeInTheDocument();
	});

	it('does not claim unshipped face-match/liveness, 24-hour ID deletion, or armed 90-day deletion (#1555)', () => {
		renderAt('/privacy/biometric-policy');
		// No face-comparison or liveness implementation exists in the product.
		expect(screen.queryByText(/face match/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/liveness/i)).not.toBeInTheDocument();
		// Government ID images are NOT deleted within 24 hours (verification
		// retention is 90 days, with no automated deletion job).
		expect(screen.queryByText(/24 hours/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/government id images/i)).not.toBeInTheDocument();
		// The retention purge is not armed, so the page must not present
		// 90-day deletion as an accomplished/automatic fact.
		expect(screen.queryByText(/deleted 90 days/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/90 days after the hiring decision/i)).not.toBeInTheDocument();
		// The true recording anchors must be stated instead.
		expect(screen.getByText(/30 days after the hiring decision/i)).toBeInTheDocument();
		// The honest disclosure that replaces it must be present.
		expect(screen.getByText(/automated deletion at expiry is not yet enabled/i)).toBeInTheDocument();
	});

	it('does not claim unshipped deepfake/AI-answer/proxy detection, a 5-year BIPA consent-receipt rule, or recording-linked per-turn deletion (#1558)', () => {
		renderAt('/privacy/biometric-policy');
		// §2: no deepfake / AI-generated-answer / proxy detection is shipped;
		// the Observer's shipped state is presence-only (Gate A dormant).
		expect(screen.queryByText(/deepfake/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/AI-generated answers/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/proxy test-takers/i)).not.toBeInTheDocument();
		// §3: no 5-year consent-receipt retention rule exists in code, and no
		// BIPA retention requirement has been established (counsel territory).
		expect(screen.queryByText(/Retained for 5 years/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/required by Illinois BIPA/i)).not.toBeInTheDocument();
		expect(screen.getByText(/Retained as part of your consent record/i)).toBeInTheDocument();
		// §3: observer speech measurements purge on their own 30-day rule
		// (observer_audio policy), not with the video recording.
		expect(screen.queryByText(/measurements: Deleted with the video recording/i)).not.toBeInTheDocument();
		expect(screen.getByText(/kept for up to 30 days from when they were recorded/i)).toBeInTheDocument();
		expect(screen.getByText(/not deleted with the video recording/i)).toBeInTheDocument();
	});

	it('describes retention periods per data type', () => {
		renderAt('/privacy/biometric-policy');
		expect(screen.getByRole('heading', { name: /retention/i })).toBeInTheDocument();
		expect(screen.getAllByText(/90 days/i).length).toBeGreaterThan(0);
	});

	it('describes destruction method', () => {
		renderAt('/privacy/biometric-policy');
		expect(screen.getByRole('heading', { name: /destruction/i })).toBeInTheDocument();
	});

	it('describes how to request deletion (your rights)', () => {
		renderAt('/privacy/biometric-policy');
		expect(screen.getByRole('heading', { name: /your rights/i })).toBeInTheDocument();
		expect(screen.getByText(/privacy@rekrutai\.co/i)).toBeInTheDocument();
	});

	it('is marked as draft pending legal counsel review', () => {
		renderAt('/privacy/biometric-policy');
		expect(screen.getByText('DRAFT')).toBeInTheDocument();
		expect(screen.getByText(/pending legal counsel review/i)).toBeInTheDocument();
	});

	it('provides a back link to the main privacy policy', () => {
		renderAt('/privacy/biometric-policy');
		const backLink = screen.getByRole('link', { name: /back to privacy policy/i });
		expect(backLink).toHaveAttribute('href', '/privacy');
	});
});
