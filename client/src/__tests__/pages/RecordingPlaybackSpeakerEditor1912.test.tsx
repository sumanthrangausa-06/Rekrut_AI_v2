/**
 * #1912 (S-D10) — The #speaker-names section becomes the mapping editor
 * for correctors: per-speaker assignment selects guided by sample turns,
 * one save that PUTs the full mapping, honest error surface on rejection,
 * and no editor (read-only list) for non-recruiters (Architecture §5.2/§5.3).
 *
 * The API boundary is mocked (house pattern); every assertion is on
 * user-visible rendering + the exact PUT the save sends. The server-side
 * journey (real HTTP + DB) lives in
 * server/__tests__/routes/recordings-speaker-mapping-1912.integration.test.js.
 * Synthetic fixtures only.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingPlaybackPage } from '@/pages/recruiter/recording-playback';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

let mockUser: { id: number; role: string } | null = { id: 191201, role: 'recruiter' };
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: mockUser }),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const DETAIL = {
	success: true,
	recording: {
		id: 1912,
		status: 'completed',
		started_at: '2026-10-20T14:00:00.000Z',
		stopped_at: '2026-10-20T15:00:00.000Z',
		duration_seconds: 3600,
		file_size_bytes: 1024,
		file_format: 'mp4',
		created_at: '2026-10-20T14:00:00.000Z',
		transcript: { segment_count: 2, last_transcript_at: '2026-10-20T15:05:00.000Z' },
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

const TRANSCRIPT = {
	recording_id: 1912,
	segment_count: 2,
	segments: [
		seg({
			id: 21,
			speaker_identity: 'Candidate — Cand 1912',
			speaker_number: 0,
			diarization_covered: true,
			text: 'So tell me about the role and the team I would join.',
			start_time_ms: 2000,
			end_time_ms: 6000,
		}),
		seg({
			id: 22,
			speaker_identity: 'Interviewer — Rec 1912',
			speaker_number: 1,
			diarization_covered: true,
			text: 'I led a team of five engineers for three years.',
			start_time_ms: 9000,
			end_time_ms: 20000,
		}),
	],
	diarization: {
		status: 'complete',
		mapping_state: 'proposed',
		corrected_by: null,
		corrected_at: null,
		speakers: [
			{ speaker_number: 0, label: 'Candidate — Cand 1912', assigned: true },
			{ speaker_number: 1, label: 'Interviewer — Rec 1912', assigned: true },
		],
	},
};

const SPEAKERS = {
	success: true,
	speakers: [
		{
			speaker_number: 0,
			participant_user_id: 191202,
			participant_role: 'candidate',
			participant_name: 'Cand 1912',
			state: 'proposed',
			sample_turn: { text: 'So tell me about the role and the team I would join.', start_time_ms: 2000 },
		},
		{
			speaker_number: 1,
			participant_user_id: 191201,
			participant_role: 'interviewer',
			participant_name: 'Rec 1912',
			state: 'proposed',
			sample_turn: { text: 'I led a team of five engineers for three years.', start_time_ms: 9000 },
		},
	],
	participants: [
		{ user_id: 191202, role: 'candidate', name: 'Cand 1912' },
		{ user_id: 191201, role: 'interviewer', name: 'Rec 1912' },
		{ user_id: 191203, role: 'interviewer', name: 'Panel 1912' },
	],
	mapping_state: 'proposed',
	corrected_by: null,
	corrected_at: null,
};

let putCalls: Array<{ url: string; options: unknown }> = [];
let putError: Error | null = null;

function mockApi() {
	mockApiCall.mockReset();
	putCalls = [];
	putError = null;
	mockApiCall.mockImplementation(async (url: string, options?: unknown) => {
		const u = String(url);
		if (u.endsWith('/speakers/mapping')) {
			putCalls.push({ url: u, options });
			if (putError) throw putError;
			return { ...SPEAKERS, mapping_state: 'corrected' };
		}
		if (u.endsWith('/speakers')) return SPEAKERS;
		if (u.endsWith('/transcript')) return { success: true, transcript: TRANSCRIPT };
		if (u.endsWith('/playback')) return PLAYBACK;
		return DETAIL;
	});
}

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/recruiter/recordings/1912/playback']}>
			<Routes>
				<Route path="/recruiter/recordings/:id/playback" element={<RecordingPlaybackPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	mockUser = { id: 191201, role: 'recruiter' };
	mockApi();
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

describe('#1912 RecordingPlaybackPage speaker mapping editor', () => {
	it('corrector sees labelled assignment selects pre-filled with the current mapping, guided by sample turns', async () => {
		const { container } = renderPage();

		const sel0 = (await screen.findByLabelText(/assign speaker 1 to/i)) as HTMLSelectElement;
		const sel1 = (await screen.findByLabelText(/assign speaker 2 to/i)) as HTMLSelectElement;
		expect(sel0.value).toBe('191202');
		expect(sel1.value).toBe('191201');

		// Sample turns (words + timestamp) help tell the voices apart —
		// asserted inside the editor section (the same words also appear
		// as transcript segments).
		const section = container.querySelector('#speaker-names');
		expect(section?.textContent).toContain('tell me about the role');
		expect(section?.textContent).toContain('led a team of five');

		// Options are the call's participants plus "Not assigned".
		expect(screen.getAllByRole('option', { name: /not assigned/i })).toHaveLength(2);
		expect(screen.getAllByRole('option', { name: /panel 1912/i }).length).toBeGreaterThan(0);
	});

	it('swap + save sends the full corrected mapping and confirms to the user', async () => {
		renderPage();

		const sel0 = (await screen.findByLabelText(/assign speaker 1 to/i)) as HTMLSelectElement;
		const sel1 = (await screen.findByLabelText(/assign speaker 2 to/i)) as HTMLSelectElement;
		fireEvent.change(sel0, { target: { value: '191201' } });
		fireEvent.change(sel1, { target: { value: '191202' } });
		fireEvent.click(screen.getByRole('button', { name: /save speaker names/i }));

		await waitFor(() => expect(putCalls).toHaveLength(1));
		expect(putCalls[0].url).toContain('/recordings/1912/speakers/mapping');
		expect(putCalls[0].options).toMatchObject({
			method: 'PUT',
			body: {
				assignments: [
					{ speaker_number: 0, participant_user_id: 191201 },
					{ speaker_number: 1, participant_user_id: 191202 },
				],
			},
		});
		expect(await screen.findByText(/speaker names saved/i)).toBeInTheDocument();
	});

	it('a rejected save surfaces the server reason and keeps the editor open', async () => {
		renderPage();
		await screen.findByLabelText(/assign speaker 1 to/i);
		putError = new Error('a participant can be assigned to only one speaker');
		fireEvent.click(screen.getByRole('button', { name: /save speaker names/i }));

		expect(
			await screen.findByText(/a participant can be assigned to only one speaker/i),
		).toBeInTheDocument();
		expect(screen.getByLabelText(/assign speaker 1 to/i)).toBeInTheDocument();
	});

	it('non-recruiter sees the read-only speaker list and the editor is never fetched', async () => {
		mockUser = { id: 191202, role: 'candidate' };
		const { container } = renderPage();

		expect(await screen.findByText(/speaker names are detected automatically/i)).toBeInTheDocument();
		const section = container.querySelector('#speaker-names');
		expect(section?.textContent).toContain('Candidate — Cand 1912');
		expect(screen.queryByLabelText(/assign speaker/i)).not.toBeInTheDocument();
		expect(
			mockApiCall.mock.calls.some((c) => String(c[0]).includes('/speakers')),
		).toBe(false);
	});
});
