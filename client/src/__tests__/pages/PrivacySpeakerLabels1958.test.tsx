/**
 * S-D21 (#1958, epic #1900) — privacy.tsx §13 gate-sentence rider (BR-7 N-3).
 *
 * Design: br7-panel-notice-design.md §11 item 3 — the §13 gate sentence
 * gains the panel leg, so the published policy states the gate as built
 * (S-D19, #1956): labelling runs only where the candidate has given
 * biometric consent AND every other participant has agreed to speaker
 * labelling on their own screen. A published page that contradicts the
 * shipped gate is the #777 defect class; this suite pins the rider and
 * the decline outcome the gate actually produces (ADR-D07: a decline —
 * candidate's or participant's — means no labels, an unlabelled
 * transcript, and no penalty).
 *
 * Pattern: SD15Disclosure.test.tsx (render the real page, assert
 * user-visible text). Red-first: the rider assertion fails on the
 * pre-rider §13 and passes once the rider lands.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

import { PrivacyPage } from '@/pages/privacy';

function renderPrivacy() {
	return render(
		<MemoryRouter initialEntries={['/privacy']}>
			<Routes>
				<Route path="/privacy" element={<PrivacyPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('S-D21 — PrivacyPage §13 gate sentence carries the panel leg (§11 rider)', () => {
	it('states BOTH legs of the shipped gate, with the gate\u2019s pre-recording timing (privacy review C-1)', () => {
		renderPrivacy();
		expect(
			screen.getByText(
				/only where the candidate has given biometric consent for that interview and, before the recording starts, every other person expected to take part in that recording/i,
			),
		).toBeInTheDocument();
		expect(screen.getByText(/has agreed to speaker labelling on their own screen/i)).toBeInTheDocument();
		// The gate blocks PANEL_AGREEMENT_AFTER_RECORDING — the page says so.
		expect(
			screen.getByText(/An agreement recorded after a recording has started does not count for that recording/i),
		).toBeInTheDocument();
	});

	it('the old candidate-only gate sentence no longer stands alone', () => {
		renderPrivacy();
		// The pre-rider sentence ended at "biometric consent." — with the
		// rider, that full stop is gone (the sentence continues to the
		// panel leg), so the candidate-only claim cannot be read off the
		// page as the whole gate.
		expect(screen.queryByText(/only where the candidate has given biometric consent\./i)).not.toBeInTheDocument();
	});

	it('names BOTH decliners in the no-penalty promise — no ambiguous "they" (privacy review C-2)', () => {
		renderPrivacy();
		expect(
			screen.getByText(
				/If the candidate or any other participant declines, no labels are created, the transcript stays unlabelled, and there is no penalty for declining/i,
			),
		).toBeInTheDocument();
	});

	it('states the post-write purge and qualifies label retention with it (privacy review C-2/C-3, gate §7.1)', () => {
		renderPrivacy();
		expect(
			screen.getByText(/records a decline or withdrawal after labels have been created, those labels are removed/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/except where they are removed after a later decline or withdrawal/i),
		).toBeInTheDocument();
	});
});
