/**
 * #1914 (S-D12) — AC-1 client half: the recruiter recordings list renders
 * a recording's diarization_status beside its recording status only when
 * the status is non-NULL; NULL renders exactly today's UI (no badge).
 * Architecture §7 ("visible wherever recording state is managed …
 * pending / processing / complete / failed / unavailable at a glance").
 *
 * The API boundary is mocked (house pattern, as #1911/#1912/#1913 suites);
 * the server-side payload proof lives in
 * server/__tests__/routes/recordings-operator-visibility-1914.integration.test.js.
 * Synthetic fixtures only.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecruiterRecordingsPage } from '@/pages/recruiter/recordings';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

function recording(overrides: Record<string, unknown>) {
	return {
		id: 1,
		status: 'completed',
		started_at: '2026-10-20T14:00:00.000Z',
		stopped_at: '2026-10-20T15:00:00.000Z',
		duration_seconds: 3600,
		file_size_bytes: 1024,
		file_format: 'mp4',
		retention_expires_at: null,
		created_at: '2026-10-20T14:00:00.000Z',
		diarization_status: null,
		...overrides,
	};
}

const RECORDINGS = [
	recording({ id: 101, diarization_status: 'complete' }),
	recording({ id: 102, diarization_status: 'failed' }),
	recording({ id: 103, diarization_status: null }),
];

beforeEach(() => {
	mockApiCall.mockReset();
	mockApiCall.mockImplementation(async (path: string) => {
		if (path.startsWith('/recruiter/interviews')) {
			return {
				interviews: [
					{
						id: 77,
						candidate_name: 'Cand 1914',
						candidate_email: 'cand1914@test.local',
						job_title: 'Engineer',
						scheduled_at: '2026-10-20T14:00:00.000Z',
					},
				],
			} as never;
		}
		if (path.startsWith('/interviews/recordings')) {
			return { success: true, recordings: RECORDINGS } as never;
		}
		throw new Error(`unexpected apiCall: ${path}`);
	});
});

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/recruiter/recordings?event_id=77']}>
			<RecruiterRecordingsPage />
		</MemoryRouter>,
	);
}

describe('#1914 S-D12 recordings list — diarization badge (AC-1)', () => {
	it('renders the labelling state beside the recording status when non-NULL', async () => {
		renderPage();
		expect(await screen.findByText('Speaker labels: Complete')).toBeTruthy();
		expect(await screen.findByText('Speaker labels: Failed')).toBeTruthy();
	});

	it('renders NO labelling badge for a NULL diarization_status (today\u2019s UI)', async () => {
		renderPage();
		// All three rows render (ID captions are unique per recording).
		expect(await screen.findByText('ID: 103')).toBeTruthy();
		const badges = screen.getAllByText(/Speaker labels:/);
		expect(badges).toHaveLength(2); // 101 + 102 only — nothing for 103
	});
});
