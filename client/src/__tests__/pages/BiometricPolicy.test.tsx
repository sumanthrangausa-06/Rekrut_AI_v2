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
