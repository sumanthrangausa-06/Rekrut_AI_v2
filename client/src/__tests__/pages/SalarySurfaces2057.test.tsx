import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AISearchPage } from '@/pages/candidate/ai-search';
import { CandidateJobDetailPage } from '@/pages/candidate/job-detail';
import { CandidateOmniScorePage } from '@/pages/candidate/omniscore';

// #2057 — follow-up to the #1019 salary contract (PR #2056 review minors).
// Three surfaces still gated salary on the salary_range TEXT field alone:
//  1. job-detail JSON-LD: baseSalary emitted only when salary_range text
//     was present — min/max-only jobs emitted none, and text-only jobs
//     emitted an EMPTY QuantitativeValue (min/max undefined). Contract:
//     baseSalary exists exactly when numeric min and/or max exist, in the
//     entered currency; free text is never converted into invented numbers.
//  2. ai-search result cards: salary_range text only — min/max-only jobs
//     showed no salary. Contract: route through formatJobSalary.
//  3. omniscore mutual matches: salary_range text only. Same contract.
// "No salary entered" renders honestly on all three: no figure, no symbol,
// no baseSalary block.
//
// Fixtures are shaped like the real API payloads after this fix:
// GET /api/jobs/:id and GET /api/jobs already carried salary_min /
// salary_max / currency_code (#1019 STOP 1); GET /api/matching/
// recommendations and GET /api/omniscore/mutual-matches are widened by
// this lane to carry the same fields.

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

function digits(text: string): string {
	return text.replace(/[^0-9]/g, '');
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: false, json: async () => null })),
	);
});

// ─── 1. Job-detail JSON-LD baseSalary ───────────────────────────────

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

function renderJobDetail() {
	return render(
		<MemoryRouter initialEntries={['/candidate/jobs/42']}>
			<Routes>
				<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function readJsonLd(): Promise<Record<string, any>> {
	await screen.findByRole('button', { name: /apply now/i });
	const el = document.querySelector('script[type="application/ld+json"]');
	expect(el, 'JSON-LD script tag').toBeTruthy();
	return JSON.parse(el!.textContent || '{}');
}

describe('#2057 job-detail JSON-LD baseSalary', () => {
	it('USD min/max-only job (no salary_range text) emits baseSalary with both bounds in USD', async () => {
		mockJobDetail({ salary_range: '', salary_min: 80000, salary_max: 120000, currency_code: 'USD' });
		renderJobDetail();
		const ld = await readJsonLd();
		expect(ld.baseSalary).toEqual({
			'@type': 'MonetaryAmount',
			currency: 'USD',
			value: { '@type': 'QuantitativeValue', minValue: 80000, maxValue: 120000, unitText: 'YEAR' },
		});
	});

	it('INR min/max-only job emits baseSalary in the entered INR currency, never USD', async () => {
		mockJobDetail({ salary_range: '', salary_min: 800000, salary_max: 1200000, currency_code: 'INR' });
		renderJobDetail();
		const ld = await readJsonLd();
		expect(ld.baseSalary?.currency).toBe('INR');
		expect(ld.baseSalary?.value?.minValue).toBe(800000);
		expect(ld.baseSalary?.value?.maxValue).toBe(1200000);
	});

	it('min-only job emits baseSalary with minValue and no maxValue', async () => {
		mockJobDetail({ salary_range: '', salary_min: 90000, currency_code: 'USD' });
		renderJobDetail();
		const ld = await readJsonLd();
		expect(ld.baseSalary?.currency).toBe('USD');
		expect(ld.baseSalary?.value?.minValue).toBe(90000);
		expect(ld.baseSalary?.value?.maxValue).toBeUndefined();
	});

	it('max-only job emits baseSalary with maxValue and no minValue', async () => {
		mockJobDetail({ salary_range: '', salary_max: 120000, currency_code: 'USD' });
		renderJobDetail();
		const ld = await readJsonLd();
		expect(ld.baseSalary?.value?.maxValue).toBe(120000);
		expect(ld.baseSalary?.value?.minValue).toBeUndefined();
	});

	it('text-only salary emits NO baseSalary — free text is never converted into invented numbers', async () => {
		mockJobDetail({ salary_range: '₹8–12 LPA', currency_code: 'INR' });
		renderJobDetail();
		const ld = await readJsonLd();
		expect(ld.baseSalary).toBeUndefined();
	});

	it('no salary at all emits NO baseSalary', async () => {
		mockJobDetail({ salary_range: '', currency_code: 'USD' });
		renderJobDetail();
		const ld = await readJsonLd();
		expect(ld.baseSalary).toBeUndefined();
	});
});

// ─── 2. AI search result cards ──────────────────────────────────────

function mockAiSearch(jobs: Record<string, unknown>[]) {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url.includes('/matching/recommendations')) return { recommendations: jobs };
		return {};
	});
}

const aiJob = {
	id: 2057,
	title: 'Search Analyst',
	company: 'Acme',
	location: 'Remote',
	job_type: 'full-time',
	description: 'Analyse data.',
	skills_required: [],
	created_at: '2026-10-01T00:00:00Z',
};

describe('#2057 ai-search salary rendering', () => {
	it('INR min/max-only job shows the ₹ range through the shared formatter', async () => {
		mockAiSearch([
			{ ...aiJob, salary_range: '', salary_min: 800000, salary_max: 1200000, currency_code: 'INR' },
		]);
		render(
			<MemoryRouter>
				<AISearchPage />
			</MemoryRouter>,
		);
		await screen.findByText('Search Analyst');
		const text = document.body.textContent ?? '';
		expect(text).toContain('₹');
		expect(text).not.toContain('$');
		expect(digits(text)).toContain('800000');
		expect(digits(text)).toContain('1200000');
	});

	it('salary_range text still renders verbatim', async () => {
		mockAiSearch([{ ...aiJob, salary_range: '₹8–12 LPA', currency_code: 'INR' }]);
		render(
			<MemoryRouter>
				<AISearchPage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('₹8–12 LPA')).toBeTruthy();
	});

	it('no-salary job shows no figure and no currency symbol', async () => {
		mockAiSearch([{ ...aiJob, salary_range: '', currency_code: 'INR' }]);
		render(
			<MemoryRouter>
				<AISearchPage />
			</MemoryRouter>,
		);
		await screen.findByText('Search Analyst');
		const text = document.body.textContent ?? '';
		expect(text).not.toContain('$');
		expect(text).not.toContain('₹');
	});
});

// ─── 3. OmniScore mutual matches ────────────────────────────────────

const mutualMatch = {
	job_id: 2057,
	title: 'Match Analyst',
	location: 'Remote',
	job_type: 'full-time',
	company_id: 9,
	company_name: 'Acme',
	company_tier: 'gold',
	company_trust_score: 800,
	application_status: null,
	match_score: 90,
	mutual_fit_score: 80,
	mutual_level: 'good',
	signals: { your_score: 'OmniScore 700', company_score: 'TrustScore 800', skill_match: '90% match' },
};

function mockOmniscore(matches: Record<string, unknown>[]) {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url.includes('/omniscore/mutual-matches')) return { mutual_matches: matches };
		if (url.includes('/omniscore/breakdown'))
			return {
				current: { total_score: 700, tier_label: 'Strong' },
				breakdown: {},
				recommendations: [],
				history: [],
			};
		if (url.includes('/omniscore/ratable-companies')) return { companies: [] };
		if (url.includes('/omniscore/explainer')) return null;
		if (url.includes('/memory/omniscore-trend')) return { history: [] };
		return {};
	});
}

async function renderMatches(matches: Record<string, unknown>[]) {
	mockOmniscore(matches);
	render(
		<MemoryRouter>
			<CandidateOmniScorePage />
		</MemoryRouter>,
	);
	fireEvent.click(await screen.findByRole('button', { name: /mutual matches/i }));
}

describe('#2057 omniscore mutual-match salary rendering', () => {
	it('USD min/max-only match shows the $ range through the shared formatter', async () => {
		await renderMatches([
			{ ...mutualMatch, salary_range: '', salary_min: 80000, salary_max: 120000, currency_code: 'USD' },
		]);
		await screen.findByText('Match Analyst');
		const text = document.body.textContent ?? '';
		expect(text).toContain('$80,000');
		expect(text).toContain('$120,000');
	});

	it('salary_range text still renders verbatim', async () => {
		await renderMatches([{ ...mutualMatch, salary_range: '₹8–12 LPA', currency_code: 'INR' }]);
		expect(await screen.findByText('₹8–12 LPA')).toBeTruthy();
	});

	it('no-salary match shows no figure', async () => {
		await renderMatches([{ ...mutualMatch, salary_range: '', currency_code: 'USD' }]);
		await screen.findByText('Match Analyst');
		const card = screen.getByText('Match Analyst').closest('div');
		expect(card?.textContent ?? '').not.toContain('$80,000');
		const text = document.body.textContent ?? '';
		expect(text).not.toContain('Salary not specified');
	});
});
