/**
 * S-039 (#686): Observer column + Interviewer column — §4 projection
 * contract tests (component level).
 *
 * Contract (S-082 spike §4, as amended by the S-039 panel):
 * - Branch only on per-section `state`; absent metrics are NEVER coerced
 *   to 0 or rendered as measurements.
 * - Unknown `integrity_summary.version` renders as `missing`.
 * - Integrity events are listed individually from the `events[]` array —
 *   the array wins over stored counts; no aggregate score exists.
 * - `conversation.transcript_available` false/absent → no transcript
 *   affordance.
 * - On any surface, candidate-side non-consent renders the ONE canonical
 *   neutral sentence (passed in as a prop from the server payload) —
 *   never the declined label/explanation.
 *
 * Fixtures are pinned to the E-008 spec §4.3 / S-049a scaffold shapes.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
	ASSESSMENT_MISSING_COPY,
	ASSESSMENT_NOT_SUBMITTED_COPY,
	InterviewerAssessment,
} from '@/components/domain/InterviewerAssessment';
import {
	INSUFFICIENT_DATA_COPY,
	NO_INTEGRITY_EVENTS_COPY,
	ObserverAnalysis,
} from '@/components/domain/ObserverAnalysis';

// Canonical recruiter-neutral sentence (lib/observerReportStates.js) —
// live import so this suite fails if the canonical copy ever drifts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RECRUITER_NEUTRAL_COPY, DECLINED_COPY } = require('../../../../lib/observerReportStates');

const presentReport = {
	analysis: {
		vocal: { state: 'present', speech_rate_wpm: 142 },
		visual: { state: 'missing' },
		conversation: { state: 'present', transcript_available: false },
	},
	integrity_summary: {
		version: 1,
		state: 'present',
		events: [
			{ event_type: 'gaze_away', severity: 'info', count: 2, confidence: 0.8, review_status: 'pending' },
		],
		// Stored conveniences deliberately disagree with the array.
		total_events: 999,
		critical_count: 999,
		warning_count: 999,
		info_count: 999,
	},
};

describe('ObserverAnalysis — §4 projection contract', () => {
	it('branches on state: present renders its metrics, missing renders Insufficient data with no digits', () => {
		render(<ObserverAnalysis sectionStates={null} report={presentReport} />);

		const vocal = screen.getByTestId('observer-section-vocal');
		expect(vocal.textContent).toContain('142');

		const visual = screen.getByTestId('observer-section-visual');
		expect(visual.textContent).toContain(INSUFFICIENT_DATA_COPY);
		expect(visual.textContent).not.toMatch(/\d/);
	});

	it('events win over stored counts; events are listed individually; no aggregate exists', () => {
		const { container } = render(<ObserverAnalysis sectionStates={null} report={presentReport} />);

		const integrity = screen.getByTestId('observer-section-integrity');
		expect(integrity.textContent).toMatch(/gaze away/i);
		expect(integrity.textContent).not.toContain('999');
		expect(screen.queryByTestId('observer-aggregate-score')).toBeNull();
		expect(container.textContent).not.toMatch(/integrity score/i);
	});

	it('unknown integrity version renders as missing — events are NOT rendered', () => {
		const report = {
			...presentReport,
			integrity_summary: { ...presentReport.integrity_summary, version: 99 },
		};
		render(<ObserverAnalysis sectionStates={null} report={report} />);

		const integrity = screen.getByTestId('observer-section-integrity');
		expect(integrity.textContent).toContain(INSUFFICIENT_DATA_COPY);
		expect(integrity.textContent).not.toMatch(/gaze away/i);
	});

	it('present integrity with an empty events array renders the honest no-events line', () => {
		const report = {
			...presentReport,
			integrity_summary: { version: 1, state: 'present', events: [], total_events: 0 },
		};
		render(<ObserverAnalysis sectionStates={null} report={report} />);

		const integrity = screen.getByTestId('observer-section-integrity');
		expect(integrity.textContent).toContain(NO_INTEGRITY_EVENTS_COPY);
	});

	it('transcript affordance is gated on transcript_available', () => {
		const { rerender } = render(<ObserverAnalysis sectionStates={null} report={presentReport} />);
		expect(screen.queryByTestId('observer-transcript-affordance')).toBeNull();

		const withTranscript = {
			...presentReport,
			analysis: {
				...presentReport.analysis,
				conversation: { state: 'present', transcript_available: true },
			},
		};
		rerender(<ObserverAnalysis sectionStates={null} report={withTranscript} />);
		expect(screen.getByTestId('observer-transcript-affordance')).toBeTruthy();
	});

	it('all-declined states render the canonical neutral sentence once — never the declined copy', () => {
		const declinedStates = {
			vocal: { state: 'declined', label: DECLINED_COPY.label, explanation: DECLINED_COPY.explanation },
			visual: { state: 'declined', label: DECLINED_COPY.label, explanation: DECLINED_COPY.explanation },
			integrity: { state: 'declined', label: DECLINED_COPY.label, explanation: DECLINED_COPY.explanation },
		};
		const { container } = render(
			<ObserverAnalysis sectionStates={declinedStates} report={null} neutralCopy={RECRUITER_NEUTRAL_COPY} />,
		);

		expect(screen.getByText(RECRUITER_NEUTRAL_COPY)).toBeTruthy();
		expect(container.textContent).not.toContain(DECLINED_COPY.label);
		expect(container.textContent).not.toContain('declined biometric collection');
	});

	it('a declined section state vetoes payload data for that section (privacy S-2)', () => {
		// Withdrawn-after-grant shape: server-resolved states say declined
		// while a stale payload still carries metrics. The state wins —
		// consent resolves before presence, at render time too.
		render(
			<ObserverAnalysis
				sectionStates={{
					vocal: { state: 'declined' },
					visual: { state: 'missing' },
					integrity: { state: 'missing' },
				}}
				report={presentReport}
			/>,
		);
		const vocal = screen.getByTestId('observer-section-vocal');
		expect(vocal.textContent).not.toContain('142');
		expect(vocal.textContent).toMatch(/insufficient data/i);
	});

	it('missing sections from server-resolved states (no payload) render Insufficient data', () => {
		render(
			<ObserverAnalysis
				sectionStates={{ vocal: { state: 'missing' }, visual: { state: 'missing' }, integrity: { state: 'missing' } }}
				report={null}
			/>,
		);
		for (const key of ['vocal', 'visual', 'integrity']) {
			expect(screen.getByTestId(`observer-section-${key}`).textContent).toContain(
				INSUFFICIENT_DATA_COPY,
			);
		}
	});
});

describe('InterviewerAssessment — left column taxonomy (panel Q3)', () => {
	it('present → scores, notes, and recommendation render as provided', () => {
		render(
			<InterviewerAssessment
				assessment={{
					state: 'present',
					scores: [{ label: 'Communication', value: '4 / 5' }],
					notes: 'Strong system design discussion.',
					recommendation: 'Advance',
				}}
			/>,
		);
		const col = screen.getByTestId('interviewer-assessment-column');
		expect(col.textContent).toContain('Communication');
		expect(col.textContent).toContain('4 / 5');
		expect(col.textContent).toContain('Strong system design discussion.');
		expect(col.textContent).toContain('Advance');
	});

	it('not_submitted → its own honest copy, distinct from missing', () => {
		render(<InterviewerAssessment assessment={{ state: 'not_submitted' }} />);
		const col = screen.getByTestId('interviewer-assessment-column');
		expect(col.textContent).toContain(ASSESSMENT_NOT_SUBMITTED_COPY);
		expect(ASSESSMENT_NOT_SUBMITTED_COPY).not.toBe(ASSESSMENT_MISSING_COPY);
	});

	it('missing (and null) → the honest unavailable copy', () => {
		const { rerender } = render(<InterviewerAssessment assessment={{ state: 'missing' }} />);
		expect(screen.getByTestId('interviewer-assessment-column').textContent).toContain(
			ASSESSMENT_MISSING_COPY,
		);
		rerender(<InterviewerAssessment assessment={null} />);
		expect(screen.getByTestId('interviewer-assessment-column').textContent).toContain(
			ASSESSMENT_MISSING_COPY,
		);
	});
});
