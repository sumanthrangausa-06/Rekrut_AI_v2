/**
 * #1913 (S-D11) — Candidate-view parity on the playback page
 * (Candidate Experience lens; PRD §7, Architecture §3.8, AC-1/2/3):
 * the owning candidate sees the identical composed labels + estimate
 * note + corrected-by line as the recruiter, sees the "raise it with
 * the hiring team" route text where the recruiter sees the correction
 * control, and gets NO editor, NO /speakers fetch, NO mapping
 * internals, NO participant emails, NO recruiter links. The recruiter
 * rendering is unchanged.
 *
 * The API boundary is mocked (house pattern, as #1911/#1912 suites);
 * the server-side parity + access proof lives in
 * server/__tests__/routes/recordings-candidate-parity-1913.integration.test.js.
 * Synthetic fixtures only.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingPlaybackPage } from '@/pages/recruiter/recording-playback';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

let mockUser: { id: number; role: string } | null = { id: 191302, role: 'candidate' };
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: mockUser }),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const DETAIL_WITH_NAMELESS_CONSENTER = {
	success: true,
	recording: {
		id: 1913,
		status: 'completed',
		started_at: '2026-10-20T14:00:00.000Z',
		stopped_at: '2026-10-20T15:00:00.000Z',
		duration_seconds: 3600,
		file_size_bytes: 1024,
		file_format: 'mp4',
		created_at: '2026-10-20T14:00:00.000Z',
		transcript: { segment_count: 2, last_transcript_at: '2026-10-20T15:05:00.000Z' },
		consent: [
			{ user_id: 191302, name: 'Cand 1913', email: 'cand1913@test.local', consented_at: '2026-10-20T13:59:00.000Z', consent_type: 'explicit' },
			{ user_id: 191304, name: null, email: 'nameless1913@test.local', consented_at: '2026-10-20T13:59:30.000Z', consent_type: 'explicit' },
		],
	},
};

const EMPTY_DETAIL = {
	success: true,
	recording: {
		...DETAIL_WITH_NAMELESS_CONSENTER.recording,
		transcript: { segment_count: 0, last_transcript_at: null },
		consent: [],
	},
};

const PLAYBACK = {
	success: true,
	playback: { url: 'http://127.0.0.1/audio.mp4', token: 'tok', expires_in: 3600 },
};

function seg(overrides: Record<string, unknown>) {
	return {
		id: 1,
		speaker_identity: 'unknown',
		text: 'segment text',
		start_time_ms: 0,
		end_time_ms: 4000,
		confidence: null,
		created_at: '2026-10-20T15:05:00.000Z',
		...overrides,
	};
}

const CORRECTED_TRANSCRIPT = {
	recording_id: 1913,
	segment_count: 2,
	segments: [
		seg({ id: 11, speaker_identity: 'Interviewer — Rec 1913', text: 'Tell me about yourself.', speaker_number: 0, diarization_covered: true }),
		seg({ id: 12, speaker_identity: 'Candidate — Cand 1913', text: 'I led a team of five.', start_time_ms: 4000, end_time_ms: 9000, speaker_number: 1, diarization_covered: true }),
	],
	diarization: {
		status: 'complete',
		mapping_state: 'corrected',
		corrected_by: 'Rec 1913',
		corrected_at: '2026-10-20T15:04:05.000Z',
		speakers: [
			{ speaker_number: 0, label: 'Interviewer — Rec 1913', assigned: true },
			{ speaker_number: 1, label: 'Candidate — Cand 1913', assigned: true },
		],
	},
};

let detailFixture: Record<string, unknown> = DETAIL_WITH_NAMELESS_CONSENTER;
let transcriptFixture: Record<string, unknown> = CORRECTED_TRANSCRIPT;
let detailFails = false;

function mockApi() {
	mockApiCall.mockReset();
	mockApiCall.mockImplementation(async (url: string) => {
		if (String(url).endsWith('/transcript')) {
			return { success: true, transcript: transcriptFixture };
		}
		if (String(url).endsWith('/playback')) return PLAYBACK;
		if (String(url).endsWith('/speakers')) {
			// Corrector-only endpoint: a candidate token is refused.
			throw new Error('Not authorized');
		}
		if (detailFails) throw new Error('Not authorized');
		return detailFixture;
	});
}

function renderPage(path = '/candidate/recordings/1913/playback') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/candidate/recordings/:id/playback" element={<RecordingPlaybackPage />} />
				<Route path="/recruiter/recordings/:id/playback" element={<RecordingPlaybackPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('#1913 S-D11 candidate view of the playback page', () => {
	beforeEach(() => {
		mockUser = { id: 191302, role: 'candidate' };
		detailFixture = DETAIL_WITH_NAMELESS_CONSENTER;
		transcriptFixture = CORRECTED_TRANSCRIPT;
		detailFails = false;
		mockApi();
	});

	it('AC-1: renders the identical composed labels, estimate note and corrected-by line', async () => {
		renderPage();
		// Each label renders at least twice: the segment heading and the
		// read-only speaker-names list — the same artefact the recruiter sees.
		expect((await screen.findAllByText('Interviewer — Rec 1913')).length).toBeGreaterThanOrEqual(2);
		expect(screen.getAllByText('Candidate — Cand 1913').length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText('Speaker names are detected automatically and can be wrong.')).toBeTruthy();
		expect(screen.getByText(/Speaker names corrected by Rec 1913 on/)).toBeTruthy();
		expect(screen.getByText('Tell me about yourself.')).toBeTruthy();
		expect(screen.getByText('I led a team of five.')).toBeTruthy();
	});

	it('AC-2: shows the raise-it route text where the recruiter sees the correction control', async () => {
		renderPage();
		expect(await screen.findByText(/raise it with the hiring team/)).toBeTruthy();
		expect(screen.queryByText('Correct speaker names')).toBeNull();
		expect(screen.queryByRole('link', { name: /correct speaker names/i })).toBeNull();
	});

	it('AC-2: offers no editor, no mapping internals, and never calls /speakers', async () => {
		const { container } = renderPage();
		expect(await screen.findByText(/raise it with the hiring team/)).toBeTruthy();
		expect(container.querySelector('select')).toBeNull();
		expect(screen.queryByRole('button', { name: /save speaker names/i })).toBeNull();
		expect(screen.queryByText(/Assign Speaker/)).toBeNull();
		const calledUrls = mockApiCall.mock.calls.map((c) => String(c[0]));
		expect(calledUrls.some((u) => u.endsWith('/speakers'))).toBe(false);
		expect(calledUrls.some((u) => u.endsWith('/speakers/mapping'))).toBe(false);
	});

	it('AC-3 + privacy: renders no participant email and no recruiter-surface link', async () => {
		const { container } = renderPage();
		expect(await screen.findByText(/raise it with the hiring team/)).toBeTruthy();
		// Named consenter shows by name; the nameless consenter's email
		// must never be the fallback in the candidate view.
		expect(screen.getByText('Cand 1913')).toBeTruthy();
		expect(container.textContent).not.toContain('nameless1913@test.local');
		expect(container.textContent).not.toContain('cand1913@test.local');
		expect(container.innerHTML).not.toContain('/recruiter/recordings');
		expect(container.innerHTML).not.toContain('mailto:');
	});

	it('AC-3: recruiter view is unchanged — correction link, editor fetch, email fallback intact', async () => {
		mockUser = { id: 191301, role: 'recruiter' };
		const { container } = renderPage('/recruiter/recordings/1913/playback');
		expect(await screen.findByText('Correct speaker names')).toBeTruthy();
		expect(screen.queryByText(/raise it with the hiring team/)).toBeNull();
		expect(screen.getByText('nameless1913@test.local')).toBeTruthy();
		await vi.waitFor(() => {
			const calledUrls = mockApiCall.mock.calls.map((c) => String(c[0]));
			expect(calledUrls.some((u) => u.endsWith('/speakers'))).toBe(true);
		});
		expect(container.textContent).toContain('Speaker names are detected automatically and can be wrong.');
	});

	it('non-owner candidate: API denial leaves the honest not-found state with a candidate back link', async () => {
		detailFails = true;
		const { container } = renderPage();
		expect(await screen.findByText('Recording Not Found')).toBeTruthy();
		const back = screen.getByRole('link', { name: /back to recordings/i });
		expect(back.getAttribute('href')).toBe('/candidate/interviews');
		expect(container.innerHTML).not.toContain('/recruiter/recordings');
	});

	it('legacy payload (no diarization block): candidate sees the transcript with no raise-it text and no note', async () => {
		transcriptFixture = {
			recording_id: 1913,
			segment_count: 1,
			segments: [seg({ id: 21, speaker_identity: 'unknown', text: 'Legacy answer.' })],
		};
		detailFixture = EMPTY_DETAIL;
		renderPage();
		expect(await screen.findByText('Legacy answer.')).toBeTruthy();
		expect(screen.queryByText(/raise it with the hiring team/)).toBeNull();
		expect(screen.queryByText('Speaker names are detected automatically and can be wrong.')).toBeNull();
	});
});
