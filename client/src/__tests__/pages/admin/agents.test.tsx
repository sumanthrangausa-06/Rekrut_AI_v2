/**
 * #1568: Admin Agent Monitor must never render an invented fleet.
 *
 * On API failure the page must show an honest error state with Retry —
 * never the old mock fallback (210 agents, Math.random metrics,
 * hard-coded 94.2% success stats). Same class as #849.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAgentsDashboardPage } from '@/pages/admin/agents';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const REAL_AGENT = {
	id: 'agent-real-1',
	name: 'Real Screening Agent',
	type: 'scheduled' as const,
	status: 'idle' as const,
	lastRunAt: '2026-10-21T10:00:00.000Z',
	totalRuns: 7,
	successRate: 85.7,
	avgDuration: 42,
	errorCount: 1,
	warningCount: 0,
	category: 'Screening',
	description: 'A real agent returned by the API',
};

const REAL_STATS = {
	totalAgents: 1,
	activeNow: 0,
	failedLast24h: 0,
	completedLast24h: 7,
	avgSuccessRate: 85.7,
	totalRunsToday: 7,
	avgDuration: 42,
	queueDepth: 0,
};

function mockSuccess() {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url === '/admin/agents') return { agents: [REAL_AGENT] };
		if (url.startsWith('/admin/agents/runs')) return { runs: [] };
		if (url === '/admin/agents/stats') return { stats: REAL_STATS };
		throw new Error(`unexpected url ${url}`);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('AdminAgentsDashboardPage — #1568 honest failure', () => {
	it('on API failure shows an honest error state with Retry, never an invented fleet', async () => {
		mockApiCall.mockRejectedValue(new Error('network down'));

		render(<AdminAgentsDashboardPage />);

		// Honest error state appears…
		expect(await screen.findByText(/failed to load agent data/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

		// …and none of the invented fleet/stats are rendered.
		const text = document.body.textContent || '';
		expect(text).not.toMatch(/94%/);
		expect(text).not.toMatch(/all 210 agents/i);
		expect(text).not.toMatch(/Agent 1:/);
		expect(screen.queryByText('Total Agents')).not.toBeInTheDocument();
	});

	it('on API success renders the real agents and stats returned by the API', async () => {
		mockSuccess();

		render(<AdminAgentsDashboardPage />);

		expect(await screen.findByText('Real Screening Agent')).toBeInTheDocument();
		expect(screen.getByText('Total Agents')).toBeInTheDocument();
		const text = document.body.textContent || '';
		expect(text).not.toMatch(/all 210 agents/i);
	});
});
