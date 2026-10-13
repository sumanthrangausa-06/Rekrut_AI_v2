import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssessmentResultsPage } from '@/pages/candidate/assessment-results';
import { CandidateOmniScorePage } from '@/pages/candidate/omniscore';
import { CandidateProfilePage } from '@/pages/candidate/profile';
import { RecruiterCareerPage } from '@/pages/recruiter/career-page';
import { RecruiterOmniScorePage } from '@/pages/recruiter/omniscore';

// S-111 (#836): no real score ⇒ no numeric score renders — the honest
// state ("Insufficient data" / nothing) instead of the fabricated
// fallbacks 75 / 300 / 500 / 100%.

vi.mock('@/lib/api', () => ({
	apiCall: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		user: { id: 1, name: 'Test User', email: 'test@example.com', role: 'candidate' },
		isAuthenticated: true,
		login: vi.fn(),
		logout: vi.fn(),
		register: vi.fn(),
		loading: false,
		isRecruiter: false,
	}),
	AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { apiCall } from '@/lib/api';

const mockApiCall = vi.mocked(apiCall);

function mockByUrl(map: Record<string, unknown>) {
	mockApiCall.mockImplementation(async (url: string) => {
		for (const [key, value] of Object.entries(map)) {
			if (url.includes(key)) return value;
		}
		return {};
	});
}

describe('Candidate OmniScore hero (was: total_score || 300)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('no score → "Insufficient data", no fabricated 300 hero', async () => {
		mockByUrl({
			'/omniscore/breakdown': { current: null, breakdown: {}, recommendations: [], history: [] },
			'/memory/omniscore-trend': { history: [] },
			'/omniscore/explainer': null,
		});
		render(
			<MemoryRouter>
				<CandidateOmniScorePage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('Insufficient data')).toBeInTheDocument();
	});

	it('real score → that score renders', async () => {
		mockByUrl({
			'/omniscore/breakdown': {
				current: { total_score: 612, tier: 'good', tier_label: 'Good' },
				breakdown: {},
				recommendations: [],
				history: [],
			},
			'/memory/omniscore-trend': { history: [] },
			'/omniscore/explainer': null,
		});
		render(
			<MemoryRouter>
				<CandidateOmniScorePage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('612')).toBeInTheDocument();
	});
});

describe('Recruiter TrustScore hero (was: score || 500)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('no score → "Insufficient data", no fabricated 500 hero', async () => {
		mockByUrl({
			'/omniscore/company-dashboard': {
				trust_score: { score: null, tier: 'new', tier_label: 'New Employer', breakdown: null },
				candidate_ratings: { summary: null, reviews: [] },
				hiring_funnel: null,
				recommendations: [],
			},
		});
		render(
			<MemoryRouter>
				<RecruiterOmniScorePage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('Insufficient data')).toBeInTheDocument();
		expect(screen.queryByText('500')).not.toBeInTheDocument();
	});

	it('real score → that score renders', async () => {
		mockByUrl({
			'/omniscore/company-dashboard': {
				trust_score: { score: 742, tier: 'good', tier_label: 'Good', breakdown: null },
				candidate_ratings: { summary: null, reviews: [] },
				hiring_funnel: null,
				recommendations: [],
			},
		});
		render(
			<MemoryRouter>
				<RecruiterOmniScorePage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('742')).toBeInTheDocument();
	});
});

describe('Candidate profile OmniScore ring (was: omni_score || 75)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('profile with no omni_score → no fabricated 75 ring', async () => {
		mockApiCall.mockResolvedValue({} as never);
		render(
			<MemoryRouter>
				<CandidateProfilePage />
			</MemoryRouter>,
		);
		expect(await screen.findByText(/Your Name/i)).toBeInTheDocument();
		expect(screen.getByText('Insufficient data')).toBeInTheDocument();
		expect(screen.queryByText('75')).not.toBeInTheDocument();
	});
});

describe('Public careers page TrustScore (was: candidate-average || 75, plus mock fallback)', () => {
	beforeEach(() => vi.clearAllMocks());

	const careerData = (trustscore: number | null) => ({
		company: {
			id: '42',
			name: 'Acme Inc',
			tagline: 'Join Acme',
			description: 'Acme builds things.',
			website: 'https://acme.example.com',
			location: 'Remote',
			size: '11-50 employees',
			industry: 'Technology',
			founded: '2020',
			trustscore,
			rating: 4.5,
			reviewCount: 3,
		},
		culture: { values: [], benefits: [], photos: [] },
		team: [],
		jobs: [],
		stats: { openPositions: 0, avgTimeToHire: 0, employees: 10, growthRate: 0 },
	});

	function renderCareers() {
		return render(
			<MemoryRouter initialEntries={['/careers/acme']}>
				<Routes>
					<Route path="/careers/:companyId" element={<RecruiterCareerPage />} />
				</Routes>
			</MemoryRouter>,
		);
	}

	it('company with no Trust Score basis → "Insufficient data", no number', async () => {
		mockApiCall.mockResolvedValue(careerData(null) as never);
		renderCareers();
		expect(await screen.findByText('TrustScore: Insufficient data')).toBeInTheDocument();
	});

	it('company with a real Trust Score → that score renders', async () => {
		mockApiCall.mockResolvedValue(careerData(822) as never);
		renderCareers();
		expect(await screen.findByText('TrustScore 822')).toBeInTheDocument();
	});

	it('API failure → honest unavailable state, never the fabricated mock company', async () => {
		mockApiCall.mockRejectedValue(new Error('boom'));
		renderCareers();
		expect(await screen.findByText(/isn't available right now/i)).toBeInTheDocument();
		expect(screen.queryByText('TechCorp')).not.toBeInTheDocument();
		expect(screen.queryByText('TrustScore 87')).not.toBeInTheDocument();
	});
});

describe('Assessment results integrity (was: anti_cheat_score || 100)', () => {
	beforeEach(() => vi.clearAllMocks());

	const baseResult = {
		id: 1,
		session_id: 5,
		assessment_id: 1,
		score: 80,
		passed: true,
		skill_name: 'JavaScript',
		max_difficulty_reached: 3,
		duration_seconds: 600,
		answers_given: [{ isCorrect: true }],
		tab_switches: 0,
		copy_paste_attempts: 0,
		time_anomalies: 0,
	};

	function renderResults(result: Record<string, unknown>) {
		mockApiCall.mockImplementation(async (url: string) => {
			if (url.includes('/assessments/session/')) return { result };
			return { results: [] };
		});
		return render(
			<MemoryRouter initialEntries={['/candidate/assessment-results?session=5']}>
				<AssessmentResultsPage />
			</MemoryRouter>,
		);
	}

	it('absent anti_cheat_score → "Insufficient data", not 100% Excellent', async () => {
		renderResults({ ...baseResult });
		expect(await screen.findByText('Insufficient data')).toBeInTheDocument();
		expect(screen.queryByText('Excellent')).not.toBeInTheDocument();
	});

	it('a real anti_cheat_score of 0 renders 0 / Poor — never masked to 100', async () => {
		renderResults({ ...baseResult, anti_cheat_score: 0 });
		expect(await screen.findByText('Poor')).toBeInTheDocument();
		expect(screen.queryByText('Excellent')).not.toBeInTheDocument();
	});

	it('a real anti_cheat_score of 100 still renders 100 / Excellent', async () => {
		renderResults({ ...baseResult, anti_cheat_score: 100 });
		expect(await screen.findByText('Excellent')).toBeInTheDocument();
	});
});
