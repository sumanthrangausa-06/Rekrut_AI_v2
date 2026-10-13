/**
 * S-039 (#686): Human interview side-by-side report — recruiter surface.
 *
 * Panel rulings under test (Sumanth-approved 2026-10-12):
 * - Audience split: on the RECRUITER surface, candidate-side non-consent
 *   (declined / withdrawn / unknown) collapses to ONE neutral sentence in
 *   metadata — the declined reason is never named in this page's DOM.
 *   Employer-disabled is named (AC-3). Copy arrives from the server,
 *   resolved through the canonical lib/observerReportStates.js — the
 *   assertions below import those constants live (provenance: no forked
 *   strings in the client).
 * - Surface form: single-column Interviewer Assessment + metadata strip;
 *   the two-column layout activates only when a section is `present`.
 * - Left column: honest empty state (scorecards are schema-only, nothing
 *   serves them); Track B AI output must never be substituted into it.
 * - No aggregate integrity score is computed or rendered, ever.
 *
 * Fixtures are pinned to the S-049a scaffold shape (buildReportSkeleton:
 * state-only sections, integrity_summary.version 1) as resolved by the
 * S-087 observer/status channel.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewReportPage } from '@/pages/recruiter/InterviewReport';

// Canonical copy — live import from the server module (single source).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
	RECRUITER_NEUTRAL_COPY,
	OBSERVER_DISABLED_COPY,
	OBSERVER_PRESENCE_COPY,
	DECLINED_COPY,
} = require('../../../../lib/observerReportStates');

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const humanSession = {
	id: 7,
	type: 'human',
	status: 'completed',
	completed_at: '2026-10-01T11:00:00.000Z',
	started_at: '2026-10-01T10:00:00.000Z',
	config: {
		// Track B evaluation — present so the substitution test can prove
		// none of it leaks into the Interviewer Assessment column.
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
	conversation: [],
	frame_analysis: {},
};

const missingStates = {
	vocal: { state: 'missing' },
	visual: { state: 'missing' },
	integrity: { state: 'missing' },
};

const declinedStates = {
	vocal: { state: 'declined', label: DECLINED_COPY.label, explanation: DECLINED_COPY.explanation },
	visual: { state: 'declined', label: DECLINED_COPY.label, explanation: DECLINED_COPY.explanation },
	integrity: { state: 'declined', label: DECLINED_COPY.label, explanation: DECLINED_COPY.explanation },
};

function mockApi(status: unknown, session: unknown = humanSession) {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url === '/interviews/interview-sessions/7') {
			return { success: true, session };
		}
		if (url === '/interviews/interview-sessions/7/recording') {
			return { success: true, recording: null };
		}
		if (url === '/interviews/interview-sessions/7/observer/status') {
			if (status instanceof Error) throw status;
			return status;
		}
		return { success: true, sessions: [] };
	});
}

function renderPage() {
	return render(
		<MemoryRouter initialEntries={['/recruiter/interviews/report/7']}>
			<Routes>
				<Route path="/recruiter/interviews/report/:sessionId" element={<InterviewReportPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('S-039: recruiter report — audience split + surface form', () => {
	it('employer-disabled → single column + the exact AC-3 message in metadata', async () => {
		mockApi({
			success: true,
			observer_enabled: false,
			job: null,
			report: null,
			section_states: missingStates,
			recruiter_notice: { kind: 'disabled', copy: OBSERVER_DISABLED_COPY },
		});

		renderPage();

		const metadata = await screen.findByTestId('report-metadata');
		expect(within(metadata).getByText(OBSERVER_DISABLED_COPY)).toBeTruthy();
		expect(metadata.getAttribute('role')).toBe('status');
		// Single column: interviewer column present, observer column absent.
		expect(screen.getByTestId('interviewer-assessment-column')).toBeTruthy();
		expect(screen.queryByTestId('observer-analysis-column')).toBeNull();
		expect(screen.queryByTestId('side-by-side')).toBeNull();
	});

	it('declined → ONE neutral sentence; the reason is never named in the DOM', async () => {
		mockApi({
			success: true,
			observer_enabled: true,
			job: null,
			report: null,
			section_states: declinedStates,
			recruiter_notice: { kind: 'neutral', copy: RECRUITER_NEUTRAL_COPY },
		});

		const { container } = renderPage();

		const metadata = await screen.findByTestId('report-metadata');
		expect(within(metadata).getByText(RECRUITER_NEUTRAL_COPY)).toBeTruthy();
		// The collapse: no declined label, no declined explanation, anywhere.
		expect(container.textContent).not.toContain(DECLINED_COPY.label);
		expect(container.textContent).not.toContain('declined biometric collection');
		expect(screen.queryByTestId('observer-analysis-column')).toBeNull();
	});

	it('unknown consent → the IDENTICAL neutral sentence as declined (T-16)', async () => {
		mockApi({
			success: true,
			observer_enabled: true,
			job: null,
			report: null,
			section_states: missingStates,
			recruiter_notice: { kind: 'neutral', copy: RECRUITER_NEUTRAL_COPY },
		});

		renderPage();

		const metadata = await screen.findByTestId('report-metadata');
		expect(within(metadata).getByText(RECRUITER_NEUTRAL_COPY)).toBeTruthy();
	});

	it('withdrawn after grant (neutral notice + report row) → version line suppressed (indistinguishable metadata)', async () => {
		// The report row exists (the observer once ran with consent), but
		// the notice is neutral — rendering the version line here would
		// distinguish this session from a declined/unknown one with no
		// row at all (privacy B-1, second signal).
		mockApi({
			success: true,
			observer_enabled: true,
			job: null,
			report: { id: 9, consent_state: 'granted', created_at: '2026-10-01T11:05:00.000Z', version: 1 },
			section_states: declinedStates,
			recruiter_notice: { kind: 'neutral', copy: RECRUITER_NEUTRAL_COPY },
		});

		renderPage();

		const metadata = await screen.findByTestId('report-metadata');
		expect(within(metadata).getByText(RECRUITER_NEUTRAL_COPY)).toBeTruthy();
		expect(metadata.textContent).not.toMatch(/version/i);
	});

	it('granted, scaffold sections missing → presence copy + version/rendered-at metadata, single column', async () => {
		mockApi({
			success: true,
			observer_enabled: true,
			job: { id: 3, status: 'completed' },
			report: { id: 5, consent_state: 'granted', created_at: '2026-10-01T11:05:00.000Z', version: 1 },
			section_states: missingStates,
			recruiter_notice: { kind: 'presence', copy: OBSERVER_PRESENCE_COPY },
		});

		renderPage();

		const metadata = await screen.findByTestId('report-metadata');
		expect(within(metadata).getByText(OBSERVER_PRESENCE_COPY)).toBeTruthy();
		expect(metadata.textContent).toContain('version 1');
		expect(metadata.textContent).toMatch(/rendered/i);
		expect(screen.queryByTestId('observer-analysis-column')).toBeNull();
		// Left column: honest empty state (nothing serves scorecards yet).
		const left = screen.getByTestId('interviewer-assessment-column');
		expect(left.textContent).toMatch(/no interviewer assessment is available/i);
	});

	it('a present section activates the two-column layout; Track B output never enters the human column', async () => {
		mockApi({
			success: true,
			observer_enabled: true,
			job: { id: 3, status: 'completed' },
			report: { id: 5, consent_state: 'granted', created_at: '2026-10-01T11:05:00.000Z', version: 1 },
			section_states: {
				vocal: { state: 'present' },
				visual: { state: 'missing' },
				integrity: { state: 'missing' },
			},
			recruiter_notice: { kind: 'none', copy: null },
		});

		renderPage();

		const layout = await screen.findByTestId('side-by-side');
		// Responsive structure: stacked on phones, two columns ≥ tablet.
		expect(layout.className).toContain('grid-cols-1');
		expect(layout.className).toContain('md:grid-cols-2');

		const observerCol = screen.getByTestId('observer-analysis-column');
		expect(within(observerCol).getByText('AI Observer Analysis')).toBeTruthy();
		// Visual is missing → Insufficient data, and no fabricated digits.
		const visual = within(observerCol).getByTestId('observer-section-visual');
		expect(visual.textContent).toMatch(/insufficient data/i);
		expect(visual.textContent).not.toMatch(/\d/);

		// Substitution guard: the Track B overall score (88) renders in the
		// AI Evaluation card but must NOT appear in the human column.
		const left = screen.getByTestId('interviewer-assessment-column');
		expect(left.textContent).not.toContain('88');

		// No aggregate integrity score anywhere in the document.
		expect(screen.queryByTestId('observer-aggregate-score')).toBeNull();
		expect(document.body.textContent).not.toMatch(/integrity score/i);
	});

	it('observer/status failure degrades quietly — the report still renders, no side-by-side region', async () => {
		mockApi(new Error('network down'));

		renderPage();

		expect(await screen.findByText('Interview Report')).toBeTruthy();
		expect(screen.queryByTestId('report-metadata')).toBeNull();
		expect(screen.queryByTestId('interviewer-assessment-column')).toBeNull();
	});

	it('non-human session → no side-by-side region at all', async () => {
		mockApi(
			{ success: true, observer_enabled: false, section_states: missingStates, recruiter_notice: { kind: 'disabled', copy: OBSERVER_DISABLED_COPY } },
			{ ...humanSession, type: 'screening' },
		);

		renderPage();

		expect(await screen.findByText('Interview Report')).toBeTruthy();
		expect(screen.queryByTestId('report-metadata')).toBeNull();
		expect(screen.queryByTestId('interviewer-assessment-column')).toBeNull();
	});
});
