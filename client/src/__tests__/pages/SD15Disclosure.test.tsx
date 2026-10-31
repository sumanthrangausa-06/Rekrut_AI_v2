/**
 * S-D15 (#1917, epic #1900) — disclosure surfaces, user-visible outcomes.
 *
 * AC-2: biometric-policy.tsx's "We do not extract face measurements or voice
 *       measurements…" line is corrected — no published page contradicts the
 *       shipped behaviour (#777 pattern).
 * AC-3: the recording/joining notice (ConsentDialog, shown to ALL
 *       participants — candidate, recruiters, panel) carries the all-speaker
 *       disclosure (BR-7).
 * AC-4: privacy.tsx + biometric-policy.tsx describe the processing per BR-14
 *       (purpose; embeddings retained: never; labels retained with the
 *       transcript under the recording's retention clock; SDK telemetry).
 *
 * Copy is Lex's (BR-6 canonical sentence, LEX-POSITION §2.2), not Nova's.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

import { ConsentDialog } from '@/pages/candidate/livekit-room';
import { BiometricPolicyPage } from '@/pages/biometric-policy';
import { PrivacyPage } from '@/pages/privacy';

function renderPage(page: 'biometric' | 'privacy') {
	const path = page === 'biometric' ? '/privacy/biometric-policy' : '/privacy';
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route
					path={path}
					element={page === 'biometric' ? <BiometricPolicyPage /> : <PrivacyPage />}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

describe('S-D15 AC-2/AC-4 — BiometricPolicyPage diarization disclosure', () => {
	it('no longer claims voice measurements are not extracted (the false line is gone)', () => {
		renderPage('biometric');
		expect(
			screen.queryByText(/We do not extract face measurements or voice measurements/i),
		).not.toBeInTheDocument();
	});

	it('carries the corrected line: face measurements not extracted, labelling disclosed as the exception', () => {
		renderPage('biometric');
		expect(screen.getByText(/We do not extract face measurements from your video/i)).toBeInTheDocument();
		expect(
			screen.getByText(/temporary mathematical template of each speaker's voice/i),
		).toBeInTheDocument();
		expect(screen.getAllByText(/never stored/i).length).toBeGreaterThan(0);
	});

	it('describes speaker labelling per BR-14: purpose, labels kept with transcript, telemetry check-in', () => {
		renderPage('biometric');
		// #1947 item 4 added a §2 purpose bullet also beginning "Speaker
		// labelling:", so the §1 disclosure is pinned by its fuller string.
		expect(screen.getByText(/Speaker labelling: to label who said what/i)).toBeInTheDocument();
		expect(screen.getByText(/kept as part of the transcript/i)).toBeInTheDocument();
		expect(screen.getByText(/license check-in/i)).toBeInTheDocument();
		expect(screen.getByText(/no voice templates/i)).toBeInTheDocument();
	});

	it('§3 clarifier: no retention period applies to labelling templates; no embeddings are stored (#1947)', () => {
		renderPage('biometric');
		// #1947: the face/voice-embeddings bullet was DELETED — no template is
		// ever stored (no INSERT INTO biometric_templates exists), so there is
		// no 90-day embeddings period for the clarifier to except against.
		expect(screen.getByText(/Speaker-labelling templates:/i)).toBeInTheDocument();
		expect(screen.getByText(/no retention period applies to it/i)).toBeInTheDocument();
		expect(screen.getByText(/We do not store face or voice embeddings/i)).toBeInTheDocument();
		expect(screen.queryByText(/Face\/voice embeddings \(mathematical templates\)/i)).not.toBeInTheDocument();
	});
});

describe('S-D15 AC-4 — PrivacyPage speaker-labelling section (BR-14)', () => {
	it('has a speaker labels section describing the processing', () => {
		renderPage('privacy');
		expect(
			screen.getByRole('heading', { name: /Speaker Labels in Interview Transcripts/i }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/temporary mathematical template of each speaker's voice/i),
		).toBeInTheDocument();
		expect(screen.getByText(/never compared with any other recording/i)).toBeInTheDocument();
	});

	it('discloses the Desert Ant Labs SDK telemetry check-in honestly', () => {
		renderPage('privacy');
		expect(screen.getByText(/Desert Ant Labs/i)).toBeInTheDocument();
		expect(screen.getByText(/license check-in/i)).toBeInTheDocument();
		expect(screen.getByText(/no information about anyone who took part/i)).toBeInTheDocument();
		// The measured Step-0 payload values are pinned, not just the categories.
		expect(screen.getByText(/persistent random ID/i)).toBeInTheDocument();
		expect(screen.getByText(/v0\.3\.4/)).toBeInTheDocument();
		expect(screen.getByText(/4\.2\.1/)).toBeInTheDocument();
		expect(screen.getByText(/"server"/)).toBeInTheDocument();
	});

	it('states the presentation-only fence: labels never feed scores', () => {
		renderPage('privacy');
		expect(screen.getByText(/never used in OmniScore, TrustScore, matching/i)).toBeInTheDocument();
	});
});

describe('S-D15 AC-3 — ConsentDialog all-speaker disclosure (BR-7)', () => {
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

	it('shows the speaker-labelling disclosure to every participant, with no observer props', () => {
		render(<ConsentDialog {...baseProps} />);
		expect(
			screen.getByText(/Speaker labelling \(where the candidate has given biometric consent\)/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/temporary mathematical template of each speaker's voice/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/applies to everyone in the call — candidate, recruiters, and panel members/i),
		).toBeInTheDocument();
	});
});
