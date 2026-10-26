/**
 * #1512 — SessionReportBody must render the honest unavailable state:
 * a null overall_score shows "N/A", never a re-fabricated "0/100", the
 * recommendation badge reads "N/A" (not an empty red decline badge), and
 * the analysis-unavailable note is visible. Null per-question scores show
 * "—", not 0.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionReportBody, type SessionReport } from '@/components/domain/SessionReport';

const HONEST_REPORT: SessionReport = {
	overall_score: null,
	recommendation: null,
	recommendation_reasoning: 'AI analysis unavailable — no score or recommendation assigned.',
	analysis_unavailable: true,
	note: 'AI analysis unavailable for this session.',
	strengths: [],
	red_flags: [],
	question_scores: [{ question_index: 0, score: null, feedback: 'Response provided (AI analysis unavailable)' }],
	communication_clarity: { score: null, feedback: 'AI analysis unavailable — no score assigned' },
	technical_depth: { score: null, feedback: 'AI analysis unavailable — no score assigned' },
	confidence_enthusiasm: { score: null, indicators: [] },
};

describe('SessionReportBody honest null rendering (#1512)', () => {
	it('shows N/A + the unavailable note, never 0/100', () => {
		const { container } = render(<SessionReportBody report={HONEST_REPORT} />);

		expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
		expect(container.textContent).toContain('AI analysis unavailable — no score or recommendation assigned.');
		expect(container.textContent).toContain('AI analysis unavailable for this session.');
		expect(container.textContent).not.toContain('0/100');
		expect(container.textContent).not.toContain('DECLINE');
	});

	it('still renders a real scored report numerically', () => {
		const { container } = render(
			<SessionReportBody
				report={{ overall_score: 82, recommendation: 'advance', strengths: [], red_flags: [], question_scores: [] }}
			/>,
		);

		expect(container.textContent).toContain('82/100');
		expect(container.textContent).toContain('ADVANCE');
	});
});
