/**
 * S-087 (#790): InterviewReport loads its session from the gated
 * single-session endpoint, not by fetching the whole candidate list and
 * finding the session in it.
 *
 *   - GET /interviews/interview-sessions/:id returns { success, session }.
 *   - The list URL (`?candidate_id=`) must never be called by this page.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewReportPage } from '@/pages/recruiter/InterviewReport';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const fullSession = {
	id: 7,
	type: 'screening',
	status: 'completed',
	completed_at: '2026-10-01T11:00:00.000Z',
	started_at: '2026-10-01T10:00:00.000Z',
	config: {
		report: {
			overall_score: 88,
			recommendation: 'advance',
			strengths: ['Clear communicator'],
			red_flags: [],
			dimension_scores: {},
			question_scores: [],
			key_moments: [],
		},
	},
	conversation: [
		{ role: 'candidate', text: 'My answer text', timestamp: '2026-10-01T10:05:00.000Z' },
	],
	frame_analysis: {},
};

beforeEach(() => {
	vi.clearAllMocks();
	mockApiCall.mockImplementation(async (url: string) => {
		if (url === '/interviews/interview-sessions/7') {
			return { success: true, session: fullSession };
		}
		if (url === '/interviews/interview-sessions/7/recording') {
			return { success: true, recording: null };
		}
		// The old list path returns nothing usable — if the page still used
		// it, the report could never render.
		return { success: true, sessions: [] };
	});
});

describe('S-087: InterviewReport single-session load', () => {
	it('renders the report and transcript loaded via the single-session endpoint', async () => {
		render(
			<MemoryRouter initialEntries={['/recruiter/interviews/report/7']}>
				<Routes>
					<Route path="/recruiter/interviews/report/:sessionId" element={<InterviewReportPage />} />
				</Routes>
			</MemoryRouter>,
		);

		expect(await screen.findByText('My answer text')).toBeTruthy();
		expect(await screen.findByText('Interview Report')).toBeTruthy();
	});

	it('never calls the sessions list URL', async () => {
		render(
			<MemoryRouter initialEntries={['/recruiter/interviews/report/7']}>
				<Routes>
					<Route path="/recruiter/interviews/report/:sessionId" element={<InterviewReportPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await screen.findByText('My answer text');
		const urls = mockApiCall.mock.calls.map(([url]) => String(url));
		expect(urls).toContain('/interviews/interview-sessions/7');
		expect(urls.some((u) => u.includes('candidate_id='))).toBe(false);
	});
});
