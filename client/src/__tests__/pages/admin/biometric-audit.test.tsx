/**
 * S-065 (#715): Biometric audit log viewer UI.
 *
 * AC-2: Admin UI page lists audit entries with filters
 *       (candidate, date range, event type).
 * AC-3: Entries show pseudonymized candidate refs — the page must render
 *       candidate_ref and never a raw numeric candidate ID.
 *
 * RED phase: client/src/pages/admin/biometric-audit.tsx does not exist yet.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BiometricAuditPage } from '@/pages/admin/biometric-audit';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const SAMPLE_RESPONSE = {
	success: true,
	entries: [
		{
			id: 1,
			accessed_at: '2026-10-01T10:00:00.000Z',
			user_id: 5,
			user_role: 'recruiter',
			action: 'view',
			data_type: 'face_embedding',
			candidate_ref: 'CAND-3f9a2b1c4d5e',
			ip_address: '1.2.3.4',
		},
		{
			id: 2,
			accessed_at: '2026-10-02T11:00:00.000Z',
			user_id: 7,
			user_role: 'admin',
			action: 'delete',
			data_type: 'voice_profile',
			candidate_ref: 'CAND-9e8d7c6b5a4f',
			ip_address: '5.6.7.8',
		},
	],
	total: 2,
	limit: 50,
	offset: 0,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockApiCall.mockResolvedValue(SAMPLE_RESPONSE);
});

describe('BiometricAuditPage', () => {
	it('AC-2: fetches and renders audit entries in a table', async () => {
		render(<BiometricAuditPage />);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith(
				expect.stringContaining('/admin/biometric-audit'),
			);
		});

		expect(await screen.findByText('CAND-3f9a2b1c4d5e')).toBeInTheDocument();
		expect(await screen.findByText('CAND-9e8d7c6b5a4f')).toBeInTheDocument();
	});

	it('AC-3: renders pseudonymized refs, never raw numeric candidate IDs', async () => {
		render(<BiometricAuditPage />);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalled();
		});

		// The pseudonym format is shown…
		expect(await screen.findByText('CAND-3f9a2b1c4d5e')).toBeInTheDocument();
		// …and no bare "candidate 42"-style raw ID cell exists.
		const cells = document.querySelectorAll('td');
		const cellTexts = Array.from(cells).map((c) => c.textContent);
		expect(cellTexts.some((t) => /^42$/.test(t ?? ''))).toBe(false);
	});

	it('AC-2: action filter triggers a refetch with the filter param', async () => {
		render(<BiometricAuditPage />);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalled();
		});
		mockApiCall.mockClear();

		const actionSelect = await screen.findByLabelText(/action/i);
		fireEvent.change(actionSelect, { target: { value: 'view' } });

		const applyBtn = await screen.findByRole('button', { name: /apply|filter|search/i });
		fireEvent.click(applyBtn);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith(
				expect.stringContaining('action=view'),
			);
		});
	});

	it('AC-2: candidate filter triggers a refetch with candidate_id param', async () => {
		render(<BiometricAuditPage />);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalled();
		});
		mockApiCall.mockClear();

		const candidateInput = await screen.findByLabelText(/candidate/i);
		fireEvent.change(candidateInput, { target: { value: '42' } });

		const applyBtn = await screen.findByRole('button', { name: /apply|filter|search/i });
		fireEvent.click(applyBtn);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith(
				expect.stringContaining('candidate_id=42'),
			);
		});
	});

	it('AC-2: date range filters are sent as query params', async () => {
		render(<BiometricAuditPage />);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalled();
		});
		mockApiCall.mockClear();

		const startInput = await screen.findByLabelText(/start date/i);
		fireEvent.change(startInput, { target: { value: '2026-09-01' } });

		const applyBtn = await screen.findByRole('button', { name: /apply|filter|search/i });
		fireEvent.click(applyBtn);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith(
				expect.stringContaining('start_date=2026-09-01'),
			);
		});
	});

	it('shows an empty state when there are no entries', async () => {
		mockApiCall.mockResolvedValue({ success: true, entries: [], total: 0, limit: 50, offset: 0 });
		render(<BiometricAuditPage />);

		expect(await screen.findByText(/no audit entries/i)).toBeInTheDocument();
	});

	it('shows an error state when the fetch fails', async () => {
		mockApiCall.mockRejectedValue(new Error('Forbidden'));
		render(<BiometricAuditPage />);

		expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
	});

	it('paginates: next page button refetches with offset', async () => {
		mockApiCall.mockResolvedValue({ ...SAMPLE_RESPONSE, total: 120 });
		render(<BiometricAuditPage />);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalled();
		});
		mockApiCall.mockClear();

		const nextBtn = await screen.findByRole('button', { name: /next/i });
		fireEvent.click(nextBtn);

		await waitFor(() => {
			expect(mockApiCall).toHaveBeenCalledWith(
				expect.stringContaining('offset=50'),
			);
		});
	});
});
