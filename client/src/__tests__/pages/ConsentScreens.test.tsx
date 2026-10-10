import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Mock analytics to avoid side effects
vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

// Mock fetch for consent API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { ConsentScreensPage } from '@/pages/consent-screens';

function renderAt(path: string, locale = 'en') {
	mockFetch.mockReset();
	// GET /api/consent/texts/:type returns consent text
	mockFetch.mockImplementation((url: string) => {
		if (url.includes('/api/consent/texts/')) {
			const type = url.split('/').pop()?.split('?')[0] ?? 'recording';
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve({
						consent_type: type,
						version: '1.0',
						text_en: `DRAFT English text for ${type}`,
						text_hi: `DRAFT Hindi text for ${type}`,
					}),
			});
		}
		// POST /api/consent/record
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1 }) });
	});
	return render(
		<MemoryRouter initialEntries={[`${path}?locale=${locale}`]}>
			<Routes>
				<Route path="/interview/consent" element={<ConsentScreensPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('ConsentScreensPage (S-010)', () => {
	it('AC-1: shows 3 separate consent screens (recording, biometric, id_verification)', async () => {
		renderAt('/interview/consent');
		// Step 1: recording
		expect(await screen.findByRole('heading', { name: /interview recording/i })).toBeInTheDocument();
		// Advance to step 2
		fireEvent.click(screen.getByRole('button', { name: /i accept/i }));
		expect(await screen.findByRole('heading', { name: /biometric analysis/i })).toBeInTheDocument();
		// Advance to step 3
		fireEvent.click(screen.getByRole('button', { name: /i accept/i }));
		expect(await screen.findByRole('heading', { name: /id verification/i })).toBeInTheDocument();
	});

	it('AC-2: each screen shows what we collect / how long / how to delete with Accept/Decline', async () => {
		renderAt('/interview/consent');
		expect(await screen.findByText(/what we collect/i)).toBeInTheDocument();
		expect(screen.getByText(/how long we keep/i)).toBeInTheDocument();
		expect(screen.getByText(/how to delete/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /i accept/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
	});

	it('AC-3: declining recording shows session-cannot-start message', async () => {
		renderAt('/interview/consent');
		expect(await screen.findByRole('heading', { name: /interview recording/i })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /decline/i }));
		expect(await screen.findByText(/session cannot start/i)).toBeInTheDocument();
	});

	it('AC-4: declining biometric offers the human-interview alternative', async () => {
		renderAt('/interview/consent');
		// Accept recording to reach biometric step
		expect(await screen.findByRole('heading', { name: /interview recording/i })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /i accept/i }));
		expect(await screen.findByRole('heading', { name: /biometric analysis/i })).toBeInTheDocument();
		// Decline biometric
		fireEvent.click(screen.getByRole('button', { name: /decline/i }));
		expect(await screen.findByRole('heading', { name: /human interview available/i })).toBeInTheDocument();
	});

	it('AC-5: Hindi locale renders Hindi text with English accessible', async () => {
		renderAt('/interview/consent', 'hi');
		expect(await screen.findByText(/DRAFT Hindi text for recording/)).toBeInTheDocument();
		// English toggle available
		expect(screen.getByRole('button', { name: /english/i })).toBeInTheDocument();
	});

	it('AC-6: AI-use disclosure is shown as a separate step', async () => {
		renderAt('/interview/consent');
		// Walk through all 3 consent steps
		for (let i = 0; i < 3; i++) {
			await screen.findByRole('button', { name: /i accept/i });
			fireEvent.click(screen.getByRole('button', { name: /i accept/i }));
		}
		// AI disclosure step
		expect(await screen.findByText(/this interview uses ai/i)).toBeInTheDocument();
		expect(screen.getByText(/human recruiter reviews/i)).toBeInTheDocument();
	});

	it('marks consent copy as DRAFT pending legal review', async () => {
		renderAt('/interview/consent');
		expect(await screen.findByText(/draft/i)).toBeInTheDocument();
	});

	it('shows "policy updated" banner when ?reason=stale', async () => {
		render(
			<MemoryRouter initialEntries={['/interview/consent?sessionId=123&reason=stale']}>
				<Routes>
					<Route path="/interview/consent" element={<ConsentScreensPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(await screen.findByRole('alert')).toBeInTheDocument();
		expect(screen.getByText(/policy has been updated/i)).toBeInTheDocument();
	});

	it('does not show stale banner without ?reason=stale', async () => {
		renderAt('/interview/consent');
		await screen.findByRole('heading', { name: /interview recording/i });
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});
});
