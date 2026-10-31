import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AISearchPage } from '@/pages/candidate/ai-search';
import { CandidateJobDetailPage } from '@/pages/candidate/job-detail';

// #2059 — follow-up to #2057 / PR #2058 review nits.
//  1. Job-detail SEO meta description interpolated salary_range only:
//     a min/max-only job's description carried NO salary text. Contract:
//     the description's salary fragment comes from the shared formatter
//     (formatJobSalary/hasJobSalary) — min/max jobs show their entered-
//     currency figure, text jobs render verbatim (unchanged), no-salary
//     jobs show no salary fragment at all (never "Salary not specified").
//  2. AI-search SearchResultCard kept a DollarSign icon beside the salary
//     string, which since #2056 can be an INR/other-currency figure.
//     Contract: no dollar-sign icon beside a non-$ salary (icon dropped;
//     the formatted string carries its own currency symbol).
// Fixtures use the real API shape: PG NUMERIC bounds arrive as strings.

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		user: {
			id: 7,
			name: 'Journey Candidate',
			email: 'journey@example.com',
			role: 'candidate',
			subscriptionTier: 'pro',
		},
		isAuthenticated: true,
		login: vi.fn(),
		logout: vi.fn(),
		register: vi.fn(),
		refreshSubscription: vi.fn(),
		loading: false,
		isRecruiter: false,
	}),
	AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: false, json: async () => null })),
	);
});

// ─── 1. Job-detail meta description ─────────────────────────────────

const baseJob = {
	id: 42,
	title: 'Data Analyst',
	company: 'Acme',
	description: 'Analyse data.',
	requirements: 'SQL',
	location: 'Remote',
	job_type: 'full-time',
	skills_required: [],
	created_at: '2026-10-01T00:00:00Z',
};

function mockJobDetail(job: Record<string, unknown>) {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url.includes('/jobs/42')) return { job: { ...baseJob, ...job } };
		if (url.includes('/candidate/dashboard/stats'))
			return { success: true, stats: { profile_completeness: 100, missing_sections: [] } };
		if (url.includes('/candidate/profile')) return { profile: { skills: [] } };
		if (url.includes('/candidate/applications')) return { applications: [] };
		if (url.includes('/candidate/saved-jobs')) return { saved_jobs: [] };
		return {};
	});
}

async function readMetaDescription(): Promise<string> {
	await screen.findByRole('button', { name: /apply now/i });
	const el = document.querySelector('meta[name="description"]');
	expect(el, 'meta description tag').toBeTruthy();
	return el!.getAttribute('content') ?? '';
}

describe('#2059 job-detail meta description salary', () => {
	it('INR min/max-only job: description carries the ₹ range from the shared formatter', async () => {
		mockJobDetail({
			salary_range: '',
			salary_min: '800000.00',
			salary_max: '1200000.00',
			currency_code: 'INR',
		});
		render(
			<MemoryRouter initialEntries={['/candidate/jobs/42']}>
				<Routes>
					<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const desc = await readMetaDescription();
		expect(desc).toContain('Salary:');
		expect(desc).toContain('₹');
		expect(desc.replace(/[^0-9]/g, '')).toContain('800000');
		expect(desc.replace(/[^0-9]/g, '')).toContain('1200000');
	});

	it('USD min-only job: description carries the $ min figure', async () => {
		mockJobDetail({ salary_range: '', salary_min: '90000.00', currency_code: 'USD' });
		render(
			<MemoryRouter initialEntries={['/candidate/jobs/42']}>
				<Routes>
					<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const desc = await readMetaDescription();
		expect(desc).toContain('Salary:');
		expect(desc).toContain('$90,000');
	});

	it('text-only salary still renders verbatim (unchanged from today)', async () => {
		mockJobDetail({ salary_range: '₹8–12 LPA', currency_code: 'INR' });
		render(
			<MemoryRouter initialEntries={['/candidate/jobs/42']}>
				<Routes>
					<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const desc = await readMetaDescription();
		expect(desc).toContain('Salary: ₹8–12 LPA.');
	});

	it('no-salary job: description has no salary fragment and never "Salary not specified"', async () => {
		mockJobDetail({ salary_range: '', currency_code: 'USD' });
		render(
			<MemoryRouter initialEntries={['/candidate/jobs/42']}>
				<Routes>
					<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const desc = await readMetaDescription();
		expect(desc).not.toContain('Salary:');
		expect(desc).not.toContain('Salary not specified');
	});
});

// ─── 2. AI-search DollarSign icon ───────────────────────────────────

const aiJob = {
	id: 2059,
	title: 'Search Analyst',
	company: 'Acme',
	location: 'Remote',
	job_type: 'full-time',
	description: 'Analyse data.',
	skills_required: [],
	created_at: '2026-10-01T00:00:00Z',
};

describe('#2059 ai-search salary icon', () => {
	it('INR salary card shows the ₹ figure with NO dollar-sign icon anywhere on the page', async () => {
		mockApiCall.mockImplementation(async (url: string) => {
			if (url.includes('/matching/recommendations'))
				return {
					recommendations: [
						{
							...aiJob,
							salary_range: '',
							salary_min: '800000.00',
							salary_max: '1200000.00',
							currency_code: 'INR',
						},
					],
				};
			return {};
		});
		render(
			<MemoryRouter>
				<AISearchPage />
			</MemoryRouter>,
		);
		await screen.findByText('Search Analyst');
		const text = document.body.textContent ?? '';
		expect(text).toContain('₹');
		expect(document.querySelector('svg.lucide-dollar-sign')).toBeNull();
	});

	it('USD salary card still shows its $ figure (icon dropped, figure kept)', async () => {
		mockApiCall.mockImplementation(async (url: string) => {
			if (url.includes('/matching/recommendations'))
				return {
					recommendations: [
						{ ...aiJob, salary_range: '', salary_min: '80000.00', salary_max: '120000.00', currency_code: 'USD' },
					],
				};
			return {};
		});
		render(
			<MemoryRouter>
				<AISearchPage />
			</MemoryRouter>,
		);
		await screen.findByText('Search Analyst');
		const text = document.body.textContent ?? '';
		expect(text).toContain('$80,000');
		expect(document.querySelector('svg.lucide-dollar-sign')).toBeNull();
	});
});
