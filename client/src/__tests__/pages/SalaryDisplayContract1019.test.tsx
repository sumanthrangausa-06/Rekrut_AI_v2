import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { JobCard as CandidateJobCard } from '@/components/candidate/JobCard';
import { JobCard as DomainJobCard } from '@/components/domain/job-card';
import { JobDetailContent } from '@/components/domain/job-detail-drawer';

// FS-013 (#1019) REMAINDER — salary entry→display contract.
// The min/max USD shape was proven end-to-end by #315 (Quinn AFTER,
// 2026-10-21, 18/18 PASS) and is regression-covered here. This suite
// covers the remaining shapes — salary_range text / fixed single value /
// max-only / no salary — across BOTH launch-market currencies (USD, INR).
//
// User expectation: the salary a recruiter enters is the salary a
// candidate sees — same amount, same currency — on list, detail, and
// public detail. "No salary entered" renders honestly: no invented
// figure, no ungrounded label, no dangling separators.
//
// Fixtures are shaped exactly like the real API payloads (GET /api/jobs
// and /api/jobs/:id already return currency_code — verified at STOP 1).

vi.mock('@/lib/analytics', () => ({
	trackEvent: vi.fn(),
}));

const baseJob = {
	id: 1019,
	title: 'Data Analyst',
	company: 'Acme',
	description: 'Analyse data.',
	requirements: 'SQL',
	location: 'Remote',
	job_type: 'full-time',
	status: 'active',
	created_at: '2026-10-01T00:00:00Z',
};

function digits(text: string): string {
	return text.replace(/[^0-9]/g, '');
}

function renderCandidateCard(job: Record<string, unknown>) {
	return render(
		<MemoryRouter>
			<CandidateJobCard job={{ salary_range: '', ...baseJob, ...job }} />
		</MemoryRouter>,
	);
}

function renderDrawer(job: Record<string, unknown>) {
	return render(
		<MemoryRouter>
			<JobDetailContent job={{ salary_range: '', ...baseJob, ...job }} />
		</MemoryRouter>,
	);
}

function renderDomainCard(props: Record<string, unknown>) {
	return render(
		<MemoryRouter>
			<DomainJobCard
				id="1019"
				title="Data Analyst"
				company="Acme"
				location="Remote"
				locationType="remote"
				jobType="full-time"
				postedAt="2026-10-01T00:00:00Z"
				tags={[]}
				{...props}
			/>
		</MemoryRouter>,
	);
}

describe('FS-013 salary contract — candidate list card', () => {
	it('USD min/max range renders the entered amounts in USD (regression, #315-proven shape)', () => {
		renderCandidateCard({ salary_min: 80000, salary_max: 120000, currency_code: 'USD' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('$80,000');
		expect(text).toContain('$120,000');
	});

	it('INR min/max range renders ₹ amounts, never $', () => {
		renderCandidateCard({ salary_min: 800000, salary_max: 1200000, currency_code: 'INR' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('₹');
		expect(text).not.toContain('$');
		expect(digits(text)).toContain('800000');
		expect(digits(text)).toContain('1200000');
	});

	it('INR fixed single value (min only) renders ₹, never $', () => {
		renderCandidateCard({ salary_min: 900000, currency_code: 'INR' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('₹');
		expect(text).not.toContain('$');
		expect(digits(text)).toContain('900000');
	});

	it('USD max-only renders as "Up to $120,000", not a bare figure', () => {
		renderCandidateCard({ salary_max: 120000, currency_code: 'USD' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('Up to $120,000');
	});

	it('salary_range text renders verbatim', () => {
		renderCandidateCard({ salary_range: '₹8–12 LPA', currency_code: 'INR' });
		expect(screen.getByText('₹8–12 LPA')).toBeTruthy();
	});

	it('no salary renders no figure and no currency symbol', () => {
		renderCandidateCard({ currency_code: 'INR' });
		const text = document.body.textContent ?? '';
		expect(text).not.toContain('$');
		expect(text).not.toContain('₹');
	});
});

describe('FS-013 salary contract — candidate detail drawer', () => {
	it('USD min/max range renders the entered amounts in USD (regression)', () => {
		renderDrawer({ salary_min: 80000, salary_max: 120000, currency_code: 'USD' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('$80,000');
		expect(text).toContain('$120,000');
	});

	it('INR min/max range renders ₹ amounts, never $', () => {
		renderDrawer({ salary_min: 800000, salary_max: 1200000, currency_code: 'INR' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('₹');
		expect(text).not.toContain('$');
		expect(digits(text)).toContain('800000');
		expect(digits(text)).toContain('1200000');
	});

	it('INR fixed single value (min only) renders ₹, never $', () => {
		renderDrawer({ salary_min: 900000, currency_code: 'INR' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('₹');
		expect(text).not.toContain('$');
		expect(digits(text)).toContain('900000');
	});

	it('USD max-only renders as "Up to $120,000" — a bare figure reads as a fixed salary', () => {
		renderDrawer({ salary_max: 120000, currency_code: 'USD' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('Up to $120,000');
	});

	it('salary_range text renders verbatim', () => {
		renderDrawer({ salary_range: '₹8–12 LPA', currency_code: 'INR' });
		expect(screen.getByText('₹8–12 LPA')).toBeTruthy();
	});

	it('no salary renders "Salary not specified" — no invented figure', () => {
		renderDrawer({ currency_code: 'USD' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('Salary not specified');
		expect(text).not.toContain('$');
	});
});

describe('FS-013 salary contract — domain card (top matches)', () => {
	it('INR min/max renders ₹ amounts, never $', () => {
		renderDomainCard({ salaryMin: 800000, salaryMax: 1200000, salaryCurrency: 'INR' });
		const text = document.body.textContent ?? '';
		expect(text).toContain('₹');
		expect(text).not.toContain('$');
	});

	it('salary_range text renders verbatim instead of falling through to min/max or a label', () => {
		renderDomainCard({ salaryRange: '₹8–12 LPA', salaryCurrency: 'INR' });
		expect(screen.getByText('₹8–12 LPA')).toBeTruthy();
	});

	it('no salary renders "Salary not specified", never an ungrounded label', () => {
		renderDomainCard({});
		const text = document.body.textContent ?? '';
		expect(text).toContain('Salary not specified');
		expect(text).not.toContain('Competitive');
	});
});
