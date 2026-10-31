import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobCard as CandidateJobCard } from '@/components/candidate/JobCard';
import { cleanSalaryRange, formatJobSalary, hasJobSalary } from '@/lib/salary';
import { CandidateJobDetailPage } from '@/pages/candidate/job-detail';
import { RecruiterJobFormPage } from '@/pages/recruiter/job-form';
import { RecruiterJobsPage } from '@/pages/recruiter/jobs';

// #2063 — direct salary_range renders + zero-width ranges.
// Three surfaces rendered salary_range RAW, guarded only by truthiness:
// a whitespace-only string is truthy, so it rendered as an empty badge /
// blank fragment (recruiter jobs badges x2, job-form previous-postings
// preview). Two candidate guards tested raw truthiness while formatting
// through the shared formatter, so a whitespace-only range still drew a
// $ salary row (JobCard, job-detail). And JS trim() does NOT remove
// U+200B–U+200D / U+FEFF, so a zero-width-only range passed the #2061
// rule in lib/salary itself and rendered invisibly everywhere.
// Contract: cleanSalaryRange() strips zero-width chars (everywhere in
// the string), then trims; nothing visible remaining = absent, the same
// way on every surface. Whitespace / zero-width = no salary.

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
			name: 'Journey User',
			email: 'journey@example.com',
			role: 'recruiter',
			subscriptionTier: 'pro',
		},
		isAuthenticated: true,
		login: vi.fn(),
		logout: vi.fn(),
		register: vi.fn(),
		refreshSubscription: vi.fn(),
		loading: false,
		isRecruiter: true,
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

// ─── 1. lib-level: zero-width handling in the shared helper ─────────

describe('#2063 cleanSalaryRange / formatter zero-width handling', () => {
	it('zero-width-only range: formatJobSalary falls through to "Salary not specified"', () => {
		expect(formatJobSalary({ salary_range: '\u200B\u200D' })).toBe('Salary not specified');
	});

	it('zero-width-only range: hasJobSalary is false', () => {
		expect(hasJobSalary({ salary_range: ' \u200B ' })).toBe(false);
	});

	it('cleanSalaryRange strips surrounding zero-width chars and trims', () => {
		expect(cleanSalaryRange(' \u200B$5k \uFEFF')).toBe('$5k');
	});

	it('cleanSalaryRange returns undefined when nothing visible remains', () => {
		expect(cleanSalaryRange('\u200B\uFEFF')).toBeUndefined();
		expect(cleanSalaryRange('   ')).toBeUndefined();
		expect(cleanSalaryRange('')).toBeUndefined();
		expect(cleanSalaryRange(null)).toBeUndefined();
		expect(cleanSalaryRange(undefined)).toBeUndefined();
	});

	it('cleanSalaryRange strips zero-width chars inside the string too (documented behaviour)', () => {
		// Implementation strips U+200B–U+200D/U+FEFF everywhere, not only
		// at the edges — an internal ZWSP carries no visible meaning.
		expect(cleanSalaryRange('$5\u200Bk')).toBe('$5k');
		expect(formatJobSalary({ salary_range: '₹8–12 LPA' })).toBe('₹8–12 LPA');
	});

	it('zero-width-wrapped real range renders cleaned through the formatter', () => {
		expect(formatJobSalary({ salary_range: '\u200B$90k\uFEFF' })).toBe('$90k');
		expect(hasJobSalary({ salary_range: '\u200B$90k\uFEFF' })).toBe(true);
	});

	it('zero-width-only range + numeric bounds: formatter falls through to the bounds', () => {
		const job = { salary_range: '\u200B', salary_min: '90000.00', currency_code: 'USD' };
		expect(formatJobSalary(job)).toContain('$90,000');
		expect(hasJobSalary(job)).toBe(true);
	});
});

// ─── 2. Recruiter jobs badges (list view renders both badge sites' ──
// ─── shared guard in the default list layout) ───────────────────────

const recruiterJob = {
	id: 2063,
	title: 'Badge Analyst',
	company: 'Acme',
	location: 'Remote',
	job_type: 'full-time',
	status: 'active',
	created_at: '2026-10-01T00:00:00Z',
};

function mockRecruiterJobs(jobs: Record<string, unknown>[]) {
	mockApiCall.mockImplementation(async (url: string) => {
		if (url.includes('/recruiter/jobs')) return { jobs };
		return {};
	});
}

function invisibleLeafElements(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('*')).filter((el) => {
		if (el.children.length > 0) return false;
		const t = el.textContent ?? '';
		return t.length > 0 && t.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() === '';
	});
}

describe('#2063 recruiter jobs salary badge', () => {
	it('whitespace-only range renders NO empty badge', async () => {
		mockRecruiterJobs([{ ...recruiterJob, salary_range: '   ' }]);
		const { container } = render(
			<MemoryRouter>
				<RecruiterJobsPage />
			</MemoryRouter>,
		);
		await screen.findByText('Badge Analyst');
		expect(invisibleLeafElements(container)).toEqual([]);
	});

	it('zero-width-only range renders NO invisible badge', async () => {
		mockRecruiterJobs([{ ...recruiterJob, salary_range: '\u200B\u200B' }]);
		const { container } = render(
			<MemoryRouter>
				<RecruiterJobsPage />
			</MemoryRouter>,
		);
		await screen.findByText('Badge Analyst');
		expect(invisibleLeafElements(container)).toEqual([]);
	});

	it('zero-width-wrapped real range renders the CLEANED text as the badge', async () => {
		mockRecruiterJobs([{ ...recruiterJob, salary_range: '\u200B$90k\uFEFF' }]);
		render(
			<MemoryRouter>
				<RecruiterJobsPage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('$90k')).toBeTruthy();
	});
});

// ─── 3. Job-form previous-postings preview ──────────────────────────

describe('#2063 job-form previous-postings preview salary', () => {
	it('whitespace-only previous salary shows "No salary", not a blank', async () => {
		mockApiCall.mockImplementation(async (url: string) => {
			if (url.includes('/countries')) return { countries: [] };
			if (url.includes('/memory/autofill/recruiter'))
				return {
					success: true,
					autofill: {
						recent_postings: [
							{
								id: 1,
								title: 'Previous Analyst',
								location: 'Remote',
								salary_range: '   ',
								job_type: 'full-time',
								created_at: '2026-10-01T00:00:00Z',
							},
						],
					},
				};
			return {};
		});
		render(
			<MemoryRouter>
				<RecruiterJobFormPage />
			</MemoryRouter>,
		);
		fireEvent.click(await screen.findByRole('button', { name: /use previous posting/i }));
		await screen.findByText('Previous Analyst');
		const text = document.body.textContent ?? '';
		expect(text).toContain('No salary');
	});

	it('zero-width-wrapped real previous salary shows the cleaned text', async () => {
		mockApiCall.mockImplementation(async (url: string) => {
			if (url.includes('/countries')) return { countries: [] };
			if (url.includes('/memory/autofill/recruiter'))
				return {
					success: true,
					autofill: {
						recent_postings: [
							{
								id: 2,
								title: 'Previous Designer',
								location: 'Remote',
								salary_range: '\u200B$75k\uFEFF',
								job_type: 'full-time',
								created_at: '2026-10-01T00:00:00Z',
							},
						],
					},
				};
			return {};
		});
		render(
			<MemoryRouter>
				<RecruiterJobFormPage />
			</MemoryRouter>,
		);
		fireEvent.click(await screen.findByRole('button', { name: /use previous posting/i }));
		await screen.findByText('Previous Designer');
		const text = document.body.textContent ?? '';
		expect(text).toContain('$75k');
		expect(text).not.toContain('\u200B$75k\uFEFF');
	});
});

// ─── 4. Candidate JobCard guard ─────────────────────────────────────

const cardJob = {
	id: 2063,
	title: 'Card Analyst',
	company: 'Acme',
	description: 'Analyse data.',
	requirements: 'SQL',
	location: 'Remote',
	job_type: 'full-time',
	status: 'active',
	created_at: '2026-10-01T00:00:00Z',
};

describe('#2063 candidate JobCard salary-row guard', () => {
	it('whitespace-only range draws NO salary row (no $ icon, no "Salary not specified")', () => {
		render(
			<MemoryRouter>
				<CandidateJobCard job={{ ...cardJob, salary_range: '   ' } as never} />
			</MemoryRouter>,
		);
		const text = document.body.textContent ?? '';
		expect(text).not.toContain('Salary not specified');
		expect(document.querySelector('svg.lucide-dollar-sign')).toBeNull();
	});

	it('zero-width-only range draws NO salary row', () => {
		render(
			<MemoryRouter>
				<CandidateJobCard job={{ ...cardJob, salary_range: '\u200B\u200B' } as never} />
			</MemoryRouter>,
		);
		expect(document.querySelector('svg.lucide-dollar-sign')).toBeNull();
	});

	it('guard: real range still draws the salary row with the cleaned text', () => {
		render(
			<MemoryRouter>
				<CandidateJobCard job={{ ...cardJob, salary_range: '\u200B$90k\uFEFF' } as never} />
			</MemoryRouter>,
		);
		expect(screen.getByText('$90k')).toBeTruthy();
		expect(document.querySelector('svg.lucide-dollar-sign')).not.toBeNull();
	});
});

// ─── 5. Candidate job-detail guard ──────────────────────────────────

const detailJob = {
	id: 42,
	title: 'Detail Analyst',
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
		if (url.includes('/jobs/42')) return { job: { ...detailJob, ...job } };
		if (url.includes('/candidate/dashboard/stats'))
			return { success: true, stats: { profile_completeness: 100, missing_sections: [] } };
		if (url.includes('/candidate/profile')) return { profile: { skills: [] } };
		if (url.includes('/candidate/applications')) return { applications: [] };
		if (url.includes('/candidate/saved-jobs')) return { saved_jobs: [] };
		return {};
	});
}

describe('#2063 candidate job-detail salary-row guard', () => {
	// Scope note: the page also embeds JobDetailContent (the drawer),
	// whose detail-grid tile renders formatJobSalary UNCONDITIONALLY —
	// "Salary not specified" there is the honest by-design state (#1019
	// drawer contract) and is NOT the #2063 defect. The #2063 target is
	// the header meta row at the guard: its DollarSign carries no
	// text-muted-foreground class, unlike the drawer's tile icon.
	function headerDollarIcon(): Element | undefined {
		return Array.from(document.querySelectorAll('svg.lucide-dollar-sign')).find(
			(svg) => !(svg.getAttribute('class') ?? '').includes('text-muted-foreground'),
		);
	}

	it('whitespace-only range draws NO header salary row', async () => {
		mockJobDetail({ salary_range: '   ', currency_code: 'USD' });
		render(
			<MemoryRouter initialEntries={['/candidate/jobs/42']}>
				<Routes>
					<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await screen.findByRole('button', { name: /apply now/i });
		expect(headerDollarIcon()).toBeUndefined();
		// Exactly one "Salary not specified" remains: the drawer's
		// by-design tile. The header row must not add a second one.
		const text = document.body.textContent ?? '';
		expect(text.split('Salary not specified').length - 1).toBe(1);
	});

	it('zero-width-only range draws NO header salary row', async () => {
		mockJobDetail({ salary_range: '\u200B\u200B', currency_code: 'USD' });
		render(
			<MemoryRouter initialEntries={['/candidate/jobs/42']}>
				<Routes>
					<Route path="/candidate/jobs/:id" element={<CandidateJobDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await screen.findByRole('button', { name: /apply now/i });
		expect(headerDollarIcon()).toBeUndefined();
		expect(document.body.textContent ?? '').not.toContain('\u200B\u200B');
	});
});
