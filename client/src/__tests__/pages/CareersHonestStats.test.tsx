import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecruiterCareerPage } from '@/pages/recruiter/career-page';

// #1188: each careers stat card renders ONLY when its value exists —
// no fabricated 18d / +34% / 50 employees / 4.5★, and no blank units
// ("d", "+%") for null values. The employees stat carries the
// company's declared size, labelled as company size.

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

const careerData = (overrides: Record<string, unknown> = {}) => ({
	company: {
		id: '42',
		name: 'Acme Inc',
		tagline: 'Join Acme',
		description: 'Acme builds things.',
		website: 'https://acme.example.com',
		location: 'Remote',
		size: null,
		industry: 'Technology',
		founded: '2020',
		trustscore: null,
		rating: null,
		reviewCount: 0,
	},
	culture: { values: [], benefits: [], photos: [] },
	team: [],
	jobs: [],
	stats: { openPositions: 0, avgTimeToHire: null, employees: null, growthRate: null },
	...overrides,
});

function renderCareers(data: Record<string, unknown>) {
	mockApiCall.mockResolvedValue(data as never);
	return render(
		<MemoryRouter initialEntries={['/careers/acme']}>
			<Routes>
				<Route path="/careers/:company" element={<RecruiterCareerPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Careers page honest stats (#1188)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('#1187: requests the company from the URL (/careers/acme), not /careers/default', async () => {
		renderCareers(careerData());
		expect((await screen.findAllByText('Open Positions')).length).toBeGreaterThan(0);
		expect(mockApiCall).toHaveBeenCalledWith('/careers/acme');
		expect(mockApiCall).not.toHaveBeenCalledWith('/careers/default');
	});

	it('no-data company → no stat cards for null stats, no invented numbers, no blank units', async () => {
		renderCareers(careerData());
		// Page itself renders (real open-positions count is honest at 0).
		expect((await screen.findAllByText('Open Positions')).length).toBeGreaterThan(0);
		expect(screen.queryByText('Avg Time to Hire')).not.toBeInTheDocument();
		expect(screen.queryByText('YoY Growth')).not.toBeInTheDocument();
		expect(screen.queryByText('Company Size')).not.toBeInTheDocument();
		expect(screen.queryByText('Employees')).not.toBeInTheDocument();
		expect(screen.queryByText('18d')).not.toBeInTheDocument();
		expect(screen.queryByText('+34%')).not.toBeInTheDocument();
		expect(screen.queryByText('4.5')).not.toBeInTheDocument();
		// Undeclared size renders as absence — never '11-50 employees'.
		expect(screen.queryByText('11-50 employees')).not.toBeInTheDocument();
	});

	it('company with real stats → computed values render, growth card stays hidden (null)', async () => {
		renderCareers(
			careerData({
				company: {
					id: '42',
					name: 'Acme Inc',
					tagline: 'Join Acme',
					description: 'Acme builds things.',
					website: 'https://acme.example.com',
					location: 'Remote',
					size: '51-200',
					industry: 'Technology',
					founded: '2020',
					trustscore: null,
					rating: 4.7,
					reviewCount: 3,
				},
				stats: { openPositions: 2, avgTimeToHire: 20.5, employees: '51-200', growthRate: null },
			}),
		);
		expect(await screen.findByText('20.5d')).toBeInTheDocument();
		expect(screen.getByText('Avg Time to Hire')).toBeInTheDocument();
		expect(screen.getByText('Company Size')).toBeInTheDocument();
		expect(screen.getAllByText('51-200').length).toBeGreaterThan(0);
		expect(screen.getByText('4.7')).toBeInTheDocument();
		expect(screen.getByText('3 reviews')).toBeInTheDocument();
		expect(screen.queryByText('YoY Growth')).not.toBeInTheDocument();
	});
});
