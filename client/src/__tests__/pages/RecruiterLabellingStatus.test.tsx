/**
 * S-D20 (#1957) — recruiter interview-detail status line (§9).
 *
 * The recruiter's per-interview surface in this codebase is the interview
 * card on recruiter/interviews.tsx (there is no separate detail page).
 * §9: the recruiter sees their OWN status line + Change there (the §10
 * pre-interview re-decision path) — and NO view of any other
 * participant's decision. The only read of own state is the S-D18 token
 * field, which carries the caller's own decision only; this suite pins
 * that the card consumes exactly that shape and nothing more.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiCall = vi.fn();
beforeEach(() => {
	apiCall.mockReset();
});
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: { id: 11, name: 'Rita Recruiter', role: 'recruiter' } }),
}));

import { InterviewLabellingStatus } from '@/pages/recruiter/interviews';

const interview = { id: 123, livekit_room_id: 7 };

const CHECK = /Check speaker labelling status/i;
function clickCheck() {
	fireEvent.click(screen.getByRole('button', { name: CHECK }));
}

describe('InterviewLabellingStatus (§9) — recruiter detail status line', () => {
	it('shows the recruiter\u2019s OWN recorded decision as a collapsed status line with Change', async () => {
		apiCall.mockResolvedValue({
			token: 'tok',
			labelling_notice: {
				event_id: 123,
				notice_version: 'br7-1',
				roster_version: 'hmac-sha256:abc123',
				own_decision: 'declined',
				decision_scope: 'panel_leg_only',
			},
		});
		render(<InterviewLabellingStatus interview={interview} />);
		clickCheck();
		expect(await screen.findByText(/You declined speaker labelling for this interview/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Change/i })).toBeInTheDocument();
		// No other participant's decision is shown or named — own state only.
		expect(screen.queryByText(/panel/i)).not.toBeInTheDocument();
	});

	it('shows the full own-screen notice when the recruiter has not decided yet', async () => {
		apiCall.mockResolvedValue({
			token: 'tok',
			labelling_notice: {
				event_id: 123,
				notice_version: 'br7-1',
				roster_version: 'hmac-sha256:abc123',
				own_decision: null,
				decision_scope: 'panel_leg_only',
			},
		});
		render(<InterviewLabellingStatus interview={interview} />);
		clickCheck();
		expect(
			await screen.findByRole('button', { name: /I agree to speaker labelling of my voice/i }),
		).toBeInTheDocument();
		expect(screen.getByText(/You are agreeing as Rita Recruiter/i)).toBeInTheDocument();
	});

	it('renders nothing for an interview with no LiveKit room (no notice can exist)', async () => {
		apiCall.mockResolvedValue({});
		const { container } = render(<InterviewLabellingStatus interview={{ id: 9 }} />);
		await waitFor(() => expect(apiCall).not.toHaveBeenCalled());
		expect(container).toBeEmptyDOMElement();
	});

	it('a failed status load is honest — it says so and points at the room, never a fake status', async () => {
		apiCall.mockRejectedValue(new Error('network down'));
		render(<InterviewLabellingStatus interview={interview} />);
		clickCheck();
		expect(await screen.findByText(/Speaker labelling: status unavailable/i)).toBeInTheDocument();
		expect(screen.queryByText(/You agreed to speaker labelling/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/You declined speaker labelling/i)).not.toBeInTheDocument();
	});

	it('BLOCK-1 regression: rendering the card fires NO token POST on mount — the fetch is lazy, on the recruiter\u2019s own click only', async () => {
		apiCall.mockResolvedValue({
			labelling_notice: {
				event_id: 123,
				notice_version: 'br7-1',
				roster_version: 'hmac-sha256:abc123',
				own_decision: 'granted',
				decision_scope: 'panel_leg_only',
			},
		});
		render(<InterviewLabellingStatus interview={interview} />);
		// Neutral pre-action state: a line + the explicit action control.
		expect(screen.getByText(/Speaker labelling:/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: CHECK })).toBeInTheDocument();
		await waitFor(() => expect(apiCall).not.toHaveBeenCalled());
		expect(apiCall).not.toHaveBeenCalled();
		// The recruiter's own click is the one and only trigger — one POST.
		clickCheck();
		expect(await screen.findByText(/You agreed to speaker labelling for this interview/i)).toBeInTheDocument();
		expect(apiCall).toHaveBeenCalledTimes(1);
		expect(apiCall).toHaveBeenCalledWith('/livekit/rooms/7/token', { method: 'POST' });
	});
});