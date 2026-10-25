/**
 * #893 — Recruiter compliance page must render ONLY real, recruiter-accessible
 * compliance API data. No mock arrays, no invented figures, no admin API,
 * no verdict copy ("Compliant") beyond what the data states.
 */
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecruiterCompliancePage } from '@/pages/recruiter/compliance';

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const source = fs.readFileSync(
	path.join(__dirname, '../../pages/recruiter/compliance.tsx'),
	'utf8',
);

describe('#893 source — no mock data reachable from the page', () => {
	it('contains no mock-data block or invented arrays', () => {
		expect(source).not.toContain('Mock Data');
		expect(source).not.toContain('biasMetrics');
		expect(source).not.toContain('consentRecords');
		expect(source).not.toContain('modelVersions');
		expect(source).not.toContain('promptVersions');
		expect(source).not.toContain('aiDecisions');
	});

	it('contains no invented people, models or figures from the old mock', () => {
		expect(source).not.toContain('Sarah Chen');
		expect(source).not.toContain('GPT-4o');
		expect(source).not.toContain('prompt-v3.2');
	});

	it('never calls the admin compliance API (wrong scope, 403 for recruiters)', () => {
		expect(source).not.toContain('/admin');
	});

	it('renders no "Compliant" verdict badge/copy', () => {
		expect(source).not.toContain('Compliant');
	});

	it('wires the ruled recruiter-accessible compliance endpoints', () => {
		expect(source).toContain('/compliance/bias/flagged');
		expect(source).toContain('/compliance/bias/reports');
		expect(source).toContain('/compliance/fairness/audits');
		expect(source).toContain('/compliance/retention/policies');
		expect(source).toContain('/recruiter/jobs');
	});
});

function mockEmptyApi() {
	mockApiCall.mockImplementation((url: string) => {
		if (url === '/recruiter/jobs') return Promise.resolve({ jobs: [] });
		if (url === '/compliance/bias/flagged') return Promise.resolve({ rows: [], total: 0 });
		if (url === '/compliance/bias/reports') return Promise.resolve({ reports: [] });
		if (url === '/compliance/fairness/audits') return Promise.resolve({ audits: [] });
		if (url === '/compliance/retention/policies') return Promise.resolve({ policies: [] });
		return Promise.reject(new Error(`unexpected: ${url}`));
	});
}

describe('#893 render — empty real data shows honest empty states only', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows empty states and zero invented figures when every endpoint is empty', async () => {
		mockEmptyApi();

		render(
			<MemoryRouter>
				<RecruiterCompliancePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/no flagged bias metrics/i)).toBeInTheDocument();
		});
		expect(screen.getByText(/no bias reports/i)).toBeInTheDocument();
		expect(screen.getByText(/no fairness audits/i)).toBeInTheDocument();
		expect(screen.getByText(/no retention policies/i)).toBeInTheDocument();
		expect(screen.getByText(/no jobs/i)).toBeInTheDocument();

		// Nothing invented from the old mock may appear.
		expect(screen.queryByText(/Sarah Chen/)).not.toBeInTheDocument();
		expect(screen.queryByText(/GPT-4o/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Compliant/)).not.toBeInTheDocument();
		expect(document.body.textContent).not.toContain('94.2');
	});
});

const REAL_PAYLOAD = {
	jobs: [{ id: 7, title: 'Warehouse Lead', status: 'active' }],
	flagged: {
		rows: [
			{
				id: 11,
				job_id: 7,
				job_title: 'Warehouse Lead',
				metric_type: 'four_fifths_rule',
				demographic_attribute: 'gender',
				group_breakdowns: [
					{ group_value: 'Female', total_applicants: 4, selected_count: 1, selection_rate: '0.2500' },
					{ group_value: 'Male', total_applicants: 4, selected_count: 2, selection_rate: '0.5000' },
				],
				overall_ratio: '0.5000',
				flagged: true,
				threshold_used: '0.80',
				calculated_at: '2026-10-01T00:00:00.000Z',
			},
		],
		total: 1,
	},
	metrics: [
		{
			id: 11,
			job_id: 7,
			metric_type: 'four_fifths_rule',
			demographic_attribute: 'gender',
			group_breakdowns: [
				{ group_value: 'Female', total_applicants: 4, selected_count: 1, selection_rate: '0.2500' },
				{ group_value: 'Male', total_applicants: 4, selected_count: 2, selection_rate: '0.5000' },
			],
			overall_ratio: '0.5000',
			flagged: true,
			threshold_used: '0.80',
			calculated_at: '2026-10-01T00:00:00.000Z',
		},
	],
	fourFifths: {
		job_id: 7,
		four_fifths_results: [
			{
				attribute: 'gender',
				groups: [],
				max_selection_rate: 0.5,
				min_selection_rate: 0.25,
				ratio: 0.5,
				flagged: true,
				threshold: 0.8,
			},
		],
	},
	reports: [
		{
			id: 3,
			report_date: '2026-09-15',
			analysis_type: 'demographic_parity',
			created_at: '2026-09-15T00:00:00.000Z',
		},
	],
	audits: [
		{
			id: 5,
			audit_date: '2026-09-20',
			audit_type: 'automated',
			overall_fairness_score: '88.50',
			issues_found: 2,
			status: 'completed',
		},
	],
	policies: [
		{
			id: 9,
			data_type: 'candidate_data',
			retention_days: 1095,
			auto_delete: false,
			description: 'Keep inactive candidate data for 3 years',
		},
	],
	overrides: {
		rows: [
			{
				id: 21,
				application_id: 31,
				job_id: 7,
				original_status: 'rejected',
				new_status: 'interview',
				reason: 'Manual review correction',
				overridden_by_name: 'Rita Recruiter',
				overridden_at: '2026-10-02T00:00:00.000Z',
			},
		],
		total: 1,
	},
};

function mockRealApi() {
	mockApiCall.mockImplementation((url: string) => {
		if (url === '/recruiter/jobs') return Promise.resolve({ jobs: REAL_PAYLOAD.jobs });
		if (url === '/compliance/bias/flagged') return Promise.resolve(REAL_PAYLOAD.flagged);
		if (url === '/compliance/bias/metrics/7')
			return Promise.resolve({ metrics: REAL_PAYLOAD.metrics });
		if (url === '/compliance/bias/four-fifths/7') return Promise.resolve(REAL_PAYLOAD.fourFifths);
		if (url === '/compliance/bias/reports') return Promise.resolve({ reports: REAL_PAYLOAD.reports });
		if (url === '/compliance/fairness/audits') return Promise.resolve({ audits: REAL_PAYLOAD.audits });
		if (url === '/compliance/retention/policies')
			return Promise.resolve({ policies: REAL_PAYLOAD.policies });
		if (url === '/compliance/overrides/job/7') return Promise.resolve(REAL_PAYLOAD.overrides);
		return Promise.reject(new Error(`unexpected: ${url}`));
	});
}

describe('#893 render — real payload shows exactly those figures', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the API-returned figures and nothing invented', async () => {
		mockRealApi();

		render(
			<MemoryRouter>
				<RecruiterCompliancePage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getAllByText('Warehouse Lead').length).toBeGreaterThan(0);
			// Per-job data loads in a second fetch — wait for it too.
			expect(screen.getAllByText('Female').length).toBeGreaterThan(0);
			expect(screen.getByText(/Manual review correction/)).toBeInTheDocument();
		});

		// Per-job bias metric group figures, exactly as returned (1/4 = 25.0%).
		expect(screen.getAllByText(/25\.0%/).length).toBeGreaterThan(0);
		// Overall ratio 0.5 rendered as a percentage.
		expect(screen.getAllByText(/50\.0%/).length).toBeGreaterThan(0);
		// Fairness audit score exactly as returned.
		expect(screen.getByText(/88\.5/)).toBeInTheDocument();
		// Retention policy exactly as returned.
		expect(screen.getByText('candidate_data')).toBeInTheDocument();
		expect(screen.getByText(/1095/)).toBeInTheDocument();
		// Human override exactly as returned.
		expect(screen.getByText(/Manual review correction/)).toBeInTheDocument();
		// Bias report type exactly as returned.
		expect(screen.getAllByText(/demographic_parity/).length).toBeGreaterThan(0);

		// No admin endpoint was ever requested.
		for (const call of mockApiCall.mock.calls) {
			expect(String(call[0])).not.toContain('/admin');
		}
		// Still no verdict copy.
		expect(screen.queryByText(/Compliant/)).not.toBeInTheDocument();
	});
});
