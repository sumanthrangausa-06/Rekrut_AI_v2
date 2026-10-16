import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssessmentResultsPage } from '@/pages/candidate/assessment-results';
import { CandidateOmniScorePage } from '@/pages/candidate/omniscore';
import { CandidateProfilePage } from '@/pages/candidate/profile';
import { RecruiterCareerPage } from '@/pages/recruiter/career-page';
import { RecruiterOmniScorePage } from '@/pages/recruiter/omniscore';
import { RecruiterTrustscorePage } from '@/pages/recruiter-trustscore';

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

describe('Standalone TrustScore page (#1239: null totals → no-data hero)', () => {
	beforeEach(() => vi.clearAllMocks());

	const nullTrustscore = {
		total_score: null,
		verification: 0,
		job_authenticity: 0,
		hiring_ratio: 0,
		feedback: 0,
		behavior: 0,
		tier: null,
		tier_label: null,
		tier_color: '#94a3b8',
	};
	const breakdownFor = (v1: unknown, v2: Record<string, unknown>) => ({
		success: true,
		current: v1,
		v2,
		breakdown: [],
		v2_breakdown: [],
		recommendations: [],
		v2_recommendations: [],
		history: [],
		analytics: { active_jobs: 0, total_applications: 0, interviews: 0, offers: 0, hires: 0 },
	});

	it('no-data company → "Insufficient data" hero, no NaN, no V2 0, no self-contradicting badge', async () => {
		mockByUrl({
			'/trustscore/breakdown': breakdownFor(nullTrustscore, {
				total_score: null,
				v1_score: null,
				v2_score: null,
				employee_satisfaction: 0,
				interview_experience: 0,
				offer_acceptance_rate: 0,
				time_to_hire: 0,
				response_rate: 0,
				salary_competitiveness: 0,
				diversity_metrics: 0,
				career_growth: 0,
				tier: null,
				tier_label: null,
				tier_color: '#94a3b8',
				data_sufficiency: { overall: 0, factors: {} },
			}),
			'/trustscore/assessment-responsiveness': null,
			'/trustscore/standalone': null,
			'/trustscore': { success: true, trustscore: nullTrustscore },
		});
		const { container } = render(
			<MemoryRouter>
				<RecruiterTrustscorePage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('Insufficient data')).toBeInTheDocument();
		expect(container.textContent).not.toContain('NaN');
		expect(container.textContent).not.toMatch(/V2:\s*0\s*pts/);
		// The hero must not sit beside its own "Insufficient Data (x%)" badge.
		expect(screen.queryByText(/Insufficient Data \(/)).not.toBeInTheDocument();
	});

	it('real scores → hero and V1 render exactly as today', async () => {
		const realV1 = { ...nullTrustscore, total_score: 700, tier: 'good', tier_label: 'Good' };
		mockByUrl({
			'/trustscore/breakdown': breakdownFor(realV1, {
				total_score: 742,
				v1_score: 700,
				v2_score: 123,
				employee_satisfaction: 0,
				interview_experience: 0,
				offer_acceptance_rate: 0,
				time_to_hire: 0,
				response_rate: 0,
				salary_competitiveness: 0,
				diversity_metrics: 0,
				career_growth: 0,
				tier: 'good',
				tier_label: 'Good',
				tier_color: '#84cc16',
				data_sufficiency: { overall: 80, factors: {} },
			}),
			'/trustscore/assessment-responsiveness': null,
			'/trustscore/standalone': null,
			'/trustscore': { success: true, trustscore: realV1 },
		});
		render(
			<MemoryRouter>
				<RecruiterTrustscorePage />
			</MemoryRouter>,
		);
		expect(await screen.findByText('742')).toBeInTheDocument();
		expect(screen.getByText('700')).toBeInTheDocument();
		expect(screen.getByText(/V2:/)).toHaveTextContent('V2: 123 pts');
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
					<Route path="/careers/:company" element={<RecruiterCareerPage />} />
				</Routes>
			</MemoryRouter>,
		);
	}

	it('#1187: requests the company from the URL (/careers/acme), not /careers/default', async () => {
		mockApiCall.mockResolvedValue(careerData(null) as never);
		renderCareers();
		expect(await screen.findByText('TrustScore: Insufficient data')).toBeInTheDocument();
		expect(mockApiCall).toHaveBeenCalledWith('/careers/acme');
		expect(mockApiCall).not.toHaveBeenCalledWith('/careers/default');
	});

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
