/**
 * S-D20 (#1957, epic #1900) — BR-7 own-screen notice UX, user-visible outcomes.
 *
 * Design: br7-panel-notice-design.md §4.3 (PanelLabellingNotice), §4.4
 * (ConsentDialog clarification), §15 S-D20 + privacy condition C-10.
 *
 * The notice IS the disclosure (privacy engineer, MANDATORY at STOP 1):
 * copy is the canonical BR-7 sentence verbatim; the decision controls act
 * only for the caller, re-render from the server's response, and a failed
 * capture shows an honest error — never a success for an unrecorded
 * decision. Accessibility (ecc/a11y-architect, INCLUDED at STOP 1): the
 * decision pair are native buttons grouped under a legend, reachable by
 * role/name; the collapsed status is an aria-live line.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConsentDialog, PanelLabellingNotice } from '@/pages/candidate/livekit-room';

const notice = {
	event_id: 123,
	notice_version: 'br7-1',
	roster_version: 'hmac-sha256:abc123',
	own_decision: null,
	decision_scope: 'panel_leg_only',
} as const;

const AGREE = /I agree to speaker labelling of my voice as described above/i;
const DECLINE = /^I decline speaker labelling$/i;

describe('PanelLabellingNotice (§4.3) — undecided caller', () => {
	it('renders the canonical BR-7 disclosure and the attestation identity line', () => {
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={vi.fn()} />);
		expect(
			screen.getByText(/temporary mathematical template of each speaker's voice/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/applies to everyone in the call — candidate, recruiters, and panel members/i),
		).toBeInTheDocument();
		expect(screen.getByText(/You are agreeing as Panel Pat/i)).toBeInTheDocument();
	});

	it('states BOTH consequences BEFORE any click — a decline must be informed to be real', () => {
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={vi.fn()} />);
		// Decline consequence (§4.3, verbatim intent).
		expect(screen.getByText(/The interview and the recording can still go ahead/i)).toBeInTheDocument();
		expect(screen.getByText(/No speaker labels will be created for this recording/i)).toBeInTheDocument();
		expect(screen.getByText(/the transcript will not show who said what/i)).toBeInTheDocument();
		// Grant consequence: a panel grant is necessary, not sufficient (§8).
		expect(
			screen.getByText(/only if every participant agrees and the candidate has given biometric consent/i),
		).toBeInTheDocument();
	});

	it('C-10: decline is equal in prominence to agree, and neither is pre-selected', () => {
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={vi.fn()} />);
		const agree = screen.getByRole('button', { name: AGREE });
		const decline = screen.getByRole('button', { name: DECLINE });
		// Equal prominence: identical styling classes, both enabled native buttons.
		expect(agree.className).toBe(decline.className);
		expect(agree).not.toBeDisabled();
		expect(decline).not.toBeDisabled();
		expect(agree.tagName).toBe('BUTTON');
		expect(decline.tagName).toBe('BUTTON');
		// Neither pre-selected: no pressed/checked state anywhere in the pair.
		expect(agree).not.toHaveAttribute('aria-pressed', 'true');
		expect(decline).not.toHaveAttribute('aria-pressed', 'true');
		expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
		expect(screen.queryByRole('checkbox', { checked: true })).not.toBeInTheDocument();
	});

	it('C-10: the labelling decision is mechanically distinct from recording consent — no bundled control', () => {
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={vi.fn()} />);
		expect(
			screen.getByRole('heading', { name: /Speaker labelling — your decision/i }),
		).toBeInTheDocument();
		// No recording-consent control lives inside the notice, and vice versa
		// the notice carries exactly the two decision buttons (plus none bundled).
		expect(screen.queryByRole('button', { name: /I consent to being recorded/i })).not.toBeInTheDocument();
		expect(screen.queryByText(/recording consent/i)).not.toBeInTheDocument();
	});

	it('a11y: the decision pair is grouped under a legend and reachable by role/name', () => {
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={vi.fn()} />);
		expect(screen.getByText(/Your speaker labelling decision/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: AGREE })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: DECLINE })).toBeInTheDocument();
	});
});

describe('PanelLabellingNotice — controls act only for the caller, from the server response', () => {
	it('Agree POSTs only the caller\u2019s own decision and collapses to the status line on the server\u2019s answer', async () => {
		const onDecide = vi.fn().mockResolvedValue({ own_decision: 'granted', decision_scope: 'panel_leg_only' });
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={onDecide} />);
		fireEvent.click(screen.getByRole('button', { name: AGREE }));
		await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(1));
		// The capture carries a decision for the caller alone — no other
		// participant is named, listed, or acted for anywhere in the notice.
		expect(onDecide).toHaveBeenCalledWith('granted');
		expect(await screen.findByText(/You agreed to speaker labelling for this interview/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Change/i })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: AGREE })).not.toBeInTheDocument();
	});

	it('Decline collapses to the declined status line', async () => {
		const onDecide = vi.fn().mockResolvedValue({ own_decision: 'declined', decision_scope: 'panel_leg_only' });
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={onDecide} />);
		fireEvent.click(screen.getByRole('button', { name: DECLINE }));
		await waitFor(() => expect(onDecide).toHaveBeenCalledWith('declined'));
		expect(await screen.findByText(/You declined speaker labelling for this interview/i)).toBeInTheDocument();
	});

	it('a failed capture shows an honest error and NO success — the notice stays open', async () => {
		const onDecide = vi.fn().mockRejectedValue(new Error('Failed to record labelling consent'));
		render(<PanelLabellingNotice notice={notice} callerName="Panel Pat" roomId="7" onDecide={onDecide} />);
		fireEvent.click(screen.getByRole('button', { name: AGREE }));
		expect(await screen.findByRole('alert')).toHaveTextContent(/could not be recorded/i);
		expect(screen.queryByText(/You agreed to speaker labelling/i)).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: AGREE })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: DECLINE })).toBeInTheDocument();
	});
});

describe('PanelLabellingNotice — recorded decisions render collapsed (per join, §4.3)', () => {
	it('a recorded decline renders as collapsed status on rejoin WITHOUT re-prompting (C-10)', () => {
		render(
			<PanelLabellingNotice
				notice={{ ...notice, own_decision: 'declined' }}
				callerName="Panel Pat"
				roomId="7"
				onDecide={vi.fn()}
			/>,
		);
		expect(screen.getByText(/You declined speaker labelling for this interview/i)).toBeInTheDocument();
		// Not re-nagged: the decision is not foregrounded again — no Agree/Decline
		// buttons until the caller themselves chooses Change.
		expect(screen.queryByRole('button', { name: AGREE })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: DECLINE })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Change/i })).toBeInTheDocument();
	});

	it('a recorded grant renders as collapsed status with a Change control', () => {
		render(
			<PanelLabellingNotice
				notice={{ ...notice, own_decision: 'granted' }}
				callerName="Panel Pat"
				roomId="7"
				onDecide={vi.fn()}
			/>,
		);
		expect(screen.getByText(/You agreed to speaker labelling for this interview/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Change/i })).toBeInTheDocument();
	});

	it('Change re-opens the caller\u2019s own controls; a change of mind is recorded from the server response', async () => {
		const onDecide = vi.fn().mockResolvedValue({ own_decision: 'declined', decision_scope: 'panel_leg_only' });
		render(
			<PanelLabellingNotice
				notice={{ ...notice, own_decision: 'granted' }}
				callerName="Panel Pat"
				roomId="7"
				onDecide={onDecide}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: /Change/i }));
		fireEvent.click(await screen.findByRole('button', { name: DECLINE }));
		await waitFor(() => expect(onDecide).toHaveBeenCalledWith('declined'));
		expect(await screen.findByText(/You declined speaker labelling for this interview/i)).toBeInTheDocument();
	});

	it('a granted decision can be withdrawn from the Change view', async () => {
		const onDecide = vi.fn().mockResolvedValue({ own_decision: 'withdrawn', decision_scope: 'panel_leg_only' });
		render(
			<PanelLabellingNotice
				notice={{ ...notice, own_decision: 'granted' }}
				callerName="Panel Pat"
				roomId="7"
				onDecide={onDecide}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: /Change/i }));
		fireEvent.click(await screen.findByRole('button', { name: /Withdraw my agreement/i }));
		await waitFor(() => expect(onDecide).toHaveBeenCalledWith('withdrawn'));
		expect(await screen.findByText(/You withdrew your speaker labelling agreement/i)).toBeInTheDocument();
	});

	it('renders nothing when there is no labelling notice — the candidate case (token field absent)', () => {
		const { container } = render(<PanelLabellingNotice notice={undefined} roomId="7" onDecide={vi.fn()} />);
		expect(container).toBeEmptyDOMElement();
	});
});

describe('ConsentDialog clarification (§4.4)', () => {
	const baseProps = {
		open: true,
		onClose: vi.fn(),
		participants: [{ userId: 1, name: 'Jane', consented: false }],
		recordingId: 42,
		onConsentGiven: vi.fn(),
		onStartRecording: vi.fn(),
		allConsented: false,
		consentLoading: false,
	};

	it('labels the participant list as recording consent only and states labelling is decided on each participant\u2019s own screen', () => {
		render(<ConsentDialog {...baseProps} />);
		expect(screen.getByText(/^Recording consent$/i)).toBeInTheDocument();
		expect(
			screen.getByText(/Speaker labelling is decided by each participant on their own screen/i),
		).toBeInTheDocument();
	});

	it('the dialog gains NO labelling buttons — it is never the capture surface (§4.4)', () => {
		render(<ConsentDialog {...baseProps} />);
		expect(screen.queryByRole('button', { name: AGREE })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: DECLINE })).not.toBeInTheDocument();
	});
});
