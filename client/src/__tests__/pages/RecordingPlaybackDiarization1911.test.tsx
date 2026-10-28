/**
 * #1911 (S-D09) — Playback page renders composed speaker labels:
 * standing estimate note, state banners, partial-coverage boundary
 * markers, no heading on unlabelled turns, legacy payloads unchanged,
 * minute-40 seek (FR-D02/D04/D13/D15/D20; Architecture §3.8/§5.1/§5.4).
 *
 * The API boundary is mocked (house pattern); every assertion is on
 * user-visible rendering. Synthetic fixtures only.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingPlaybackPage } from '@/pages/recruiter/recording-playback';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

let mockUser: { id: number; role: string } | null = { id: 191101, role: 'recruiter' };
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: mockUser }),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const DETAIL = {
	success: true,
	recording: {
		id: 1911,
		status: 'completed',
		started_at: '2026-10-20T14:00:00.000Z',
		stopped_at: '2026-10-20T15:00:00.000Z',
		duration_seconds: 3600,
		file_size_bytes: 1024,
		file_format: 'mp4',
		created_at: '2026-10-20T14:00:00.000Z',
		transcript: { segment_count: 3, last_transcript_at: '2026-10-20T15:05:00.000Z' },
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

let transcriptFixture: Record<string, unknown> = {};

function mockApi() {
	mockApiCall.mockReset();
	mockApiCall.mockImplementation(async (url: string) => {
		if (String(url).endsWith('/transcript')) {
			return { success: true, transcript: transcriptFixture };
		}
		if (String(url).endsWith('/playback')) return PLAYBACK;
		return DETAIL;
	});
}

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/recruiter/recordings/1911/playback']}>
			<Routes>
				<Route path="/recruiter/recordings/:id/playback" element={<RecordingPlaybackPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

const COMPLETE_1TO1 = {
	recording_id: 1911,
	segment_count: 2,
	segments: [
		seg({
			id: 11,
			speaker_identity: 'Interviewer — Rec 1911',
			speaker_number: 0,
			diarization_covered: true,
			text: 'Hello, tell me about yourself.',
			start_time_ms: 0,
			end_time_ms: 4000,
		}),
		seg({
			id: 12,
			speaker_identity: 'Candidate — Cand 1911',
			speaker_number: 1,
			diarization_covered: true,
			text: 'I led a team of five.',
			start_time_ms: 4000,
			end_time_ms: 9000,
		}),
	],
	diarization: {
		status: 'complete',
		mapping_state: 'proposed',
		corrected_by: null,
		corrected_at: null,
		speakers: [
			{ speaker_number: 0, label: 'Interviewer — Rec 1911', assigned: true },
			{ speaker_number: 1, label: 'Candidate — Cand 1911', assigned: true },
		],
	},
};

beforeEach(() => {
	mockUser = { id: 191101, role: 'recruiter' };
	transcriptFixture = COMPLETE_1TO1;
	mockApi();
	// jsdom gaps the page relies on.
	Element.prototype.scrollIntoView = vi.fn();
	Object.defineProperty(HTMLMediaElement.prototype, 'play', {
		configurable: true,
		value: vi.fn().mockResolvedValue(undefined),
	});
	Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
		configurable: true,
		value: vi.fn(),
	});
});

describe('#1911 RecordingPlaybackPage diarization rendering', () => {
	it('complete 1:1 — standing note, correction entry point, speaker names section, composed headings, no percentages', async () => {
		const { container } = renderPage();

		expect(
			await screen.findByText('Speaker names are detected automatically and can be wrong.'),
		).toBeInTheDocument();

		// Correction entry point is a live anchor to the speakers section.
		const entry = screen.getByRole('link', { name: /correct speaker names/i });
		expect(entry).toHaveAttribute('href', '#speaker-names');
		const section = container.querySelector('#speaker-names');
		expect(section).not.toBeNull();
		expect(section?.textContent).toContain('Interviewer — Rec 1911');
		expect(section?.textContent).toContain('Candidate — Cand 1911');

		// Segment headings carry the composed names.
		expect(screen.getAllByText('Interviewer — Rec 1911').length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText('I led a team of five.')).toBeInTheDocument();

		// AC-5: no percentage figure anywhere on the page.
		expect(container.textContent).not.toMatch(/\d+\s?%/);
	});

	it('processing — "being prepared" banner, note present, segments readable with NO speaker heading', async () => {
		transcriptFixture = {
			recording_id: 1911,
			segment_count: 2,
			segments: [
				seg({ id: 21, speaker_number: null, diarization_covered: false, text: 'Still labelling one.', start_time_ms: 0, end_time_ms: 3000 }),
				seg({ id: 22, speaker_number: null, diarization_covered: false, text: 'Still labelling two.', start_time_ms: 3000, end_time_ms: 7000 }),
			],
			diarization: {
				status: 'processing',
				mapping_state: null,
				corrected_by: null,
				corrected_at: null,
				speakers: [],
			},
		};
		renderPage();

		expect(await screen.findByText('Speaker labels are being prepared')).toBeInTheDocument();
		expect(
			screen.getByText('Speaker names are detected automatically and can be wrong.'),
		).toBeInTheDocument();
		expect(screen.getByText('Still labelling one.')).toBeInTheDocument();
		// The stored 'unknown' string is never rendered as a heading.
		expect(screen.queryByText('unknown')).toBeNull();
		// No correction entry point before labelling completes.
		expect(screen.queryByRole('link', { name: /correct speaker names/i })).toBeNull();
	});

	it('unavailable — "Speaker labels unavailable for this recording" banner, transcript still usable', async () => {
		transcriptFixture = {
			recording_id: 1911,
			segment_count: 1,
			segments: [
				seg({ id: 31, speaker_number: null, diarization_covered: false, text: 'No labels here.', start_time_ms: 0, end_time_ms: 3000 }),
			],
			diarization: {
				status: 'unavailable',
				mapping_state: null,
				corrected_by: null,
				corrected_at: null,
				speakers: [],
			},
		};
		renderPage();

		expect(
			await screen.findByText('Speaker labels unavailable for this recording'),
		).toBeInTheDocument();
		expect(screen.getByText('No labels here.')).toBeInTheDocument();
		expect(screen.queryByText('unknown')).toBeNull();
	});

	it('interior gap — a stop marker AND a resume marker render; the gap segment has no heading', async () => {
		transcriptFixture = {
			recording_id: 1911,
			segment_count: 3,
			segments: [
				seg({ id: 41, speaker_identity: 'Candidate — Cand 1911', speaker_number: 0, diarization_covered: true, text: 'Before the gap.', start_time_ms: 0, end_time_ms: 5000 }),
				seg({ id: 42, speaker_number: null, diarization_covered: false, text: 'Inside the gap.', start_time_ms: 5000, end_time_ms: 9000 }),
				seg({ id: 43, speaker_identity: 'Interviewer — Rec 1911', speaker_number: 1, diarization_covered: true, text: 'After the gap.', start_time_ms: 9000, end_time_ms: 14000 }),
			],
			diarization: {
				status: 'complete',
				mapping_state: 'proposed',
				corrected_by: null,
				corrected_at: null,
				speakers: [
					{ speaker_number: 0, label: 'Candidate — Cand 1911', assigned: true },
					{ speaker_number: 1, label: 'Interviewer — Rec 1911', assigned: true },
				],
			},
		};
		renderPage();

		expect(
			await screen.findByText('Speaker labels stop here — the rest of this transcript is unlabelled'),
		).toBeInTheDocument();
		expect(screen.getByText('Speaker labels resume here')).toBeInTheDocument();
		expect(screen.getByText('Inside the gap.')).toBeInTheDocument();
		expect(screen.queryByText('unknown')).toBeNull();
	});

	it('corrected — the corrected-by line shows who fixed the names and when', async () => {
		transcriptFixture = {
			...COMPLETE_1TO1,
			diarization: {
				...COMPLETE_1TO1.diarization,
				mapping_state: 'corrected',
				corrected_by: 'Rec 1911',
				corrected_at: '2026-10-20T15:04:05.000Z',
			},
		};
		renderPage();

		expect(
			await screen.findByText(/Speaker names corrected by Rec 1911 on/),
		).toBeInTheDocument();
	});

	it('legacy payload (no diarization fields) renders exactly as today — stored headings, no note, no banners, no markers', async () => {
		transcriptFixture = {
			recording_id: 1911,
			segment_count: 2,
			segments: [
				seg({ id: 51, text: 'Legacy opening.', start_time_ms: 0, end_time_ms: 3000 }),
				seg({ id: 52, text: 'Legacy answer.', start_time_ms: 3000, end_time_ms: 8000 }),
			],
		};
		renderPage();

		expect(await screen.findByText('Legacy opening.')).toBeInTheDocument();
		expect(screen.getAllByText('unknown')).toHaveLength(2);
		expect(
			screen.queryByText('Speaker names are detected automatically and can be wrong.'),
		).toBeNull();
		expect(screen.queryByText(/Speaker labels are/)).toBeNull();
		expect(screen.queryByText(/Speaker labels stop here/)).toBeNull();
		expect(screen.queryByRole('link', { name: /correct speaker names/i })).toBeNull();
	});

	it('AC-4/FR-D20: clicking a turn at minute 40 seeks playback to 2400s', async () => {
		transcriptFixture = {
			recording_id: 1911,
			segment_count: 1,
			segments: [
				seg({
					id: 61,
					speaker_identity: 'Candidate — Cand 1911',
					speaker_number: 0,
					diarization_covered: true,
					text: 'The minute-forty answer.',
					start_time_ms: 2400000,
					end_time_ms: 2405000,
				}),
			],
			diarization: {
				status: 'complete',
				mapping_state: 'proposed',
				corrected_by: null,
				corrected_at: null,
				speakers: [{ speaker_number: 0, label: 'Candidate — Cand 1911', assigned: true }],
			},
		};
		const { container } = renderPage();

		const segmentEl = await screen.findByText('The minute-forty answer.');
		fireEvent.click(segmentEl);
		const video = container.querySelector('video');
		expect(video).not.toBeNull();
		expect(video?.currentTime).toBe(2400);
	});

	it('candidate viewer — note renders, but the correction entry point never does', async () => {
		mockUser = { id: 191102, role: 'candidate' };
		renderPage();

		expect(
			await screen.findByText('Speaker names are detected automatically and can be wrong.'),
		).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /correct speaker names/i })).toBeNull();
	});
});
