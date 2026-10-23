/**
 * Issue #1688 — My Results tab groups attempts by topic (STOP 1,
 * comment 6356181525; design §4.5 remainder).
 *
 * User-journey framing (Candidate Experience lens): a candidate opens
 * My Results after completing assessments on two topics, plus an old
 * topic-less attempt — they see attempts grouped under the right topic
 * names, newest first as the payload orders them, and the old attempt
 * honestly bucketed under "Earlier assessments — topic not recorded",
 * never labelled with a topic it did not have.
 *
 * apiCall is mocked at the network boundary (the repo's client-test
 * pattern). Regression pins only — NOT the HL-003 E2E-on-dev gate.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiCallMock = vi.fn();
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
	useNavigate: () => navigateMock,
}));

import { CandidateAssessmentsPage } from './assessments';

function result(over: Record<string, unknown> = {}) {
	return {
		id: 1,
		score: 80,
		max_score: 100,
		passed: true,
		anti_cheat_score: 95,
		duration_seconds: 600,
		completed_at: '2026-10-20T10:00:00Z',
		title: 'Python assessment',
		skill_name: 'Python',
		category: 'technical',
		max_difficulty_reached: 3,
		tab_switches: 0,
		copy_paste_attempts: 0,
		behavioral_flags: null,
		topic_id: 20,
		topic_name: 'Comprehensions',
		format: 'mcq',
		difficulty_band: 'medium',
		...over,
	};
}

function mockPageApis(results: unknown[]) {
	apiCallMock.mockImplementation(async (url: string) => {
		if (url === '/assessments/results') return { results };
		if (url === '/assessments/assigned') return { attempts: [] };
		if (url === '/assessments/available') return { skills: [] };
		if (url === '/assessments/catalog') return { subjects: [] };
		throw new Error(`unexpected ${url}`);
	});
}

async function openResultsTab() {
	render(<CandidateAssessmentsPage />);
	// Radix TabsTrigger renders a plain <button> in jsdom (no tab role
	// in this environment — the shipped configure suite never switches
	// tabs), so the trigger is clicked by its visible label.
	fireEvent.click(await screen.findByText('My Results'));
}

beforeEach(() => {
	apiCallMock.mockReset();
	navigateMock.mockReset();
	sessionStorage.clear();
});

describe('#1688 — My Results grouping by topic', () => {
	test('C1: two topics interleaved by date render grouped, most-recent topic first, cards in server order within groups', async () => {
		mockPageApis([
			result({ id: 1, score: 91, topic_id: 21, topic_name: 'Decorators', completed_at: '2026-10-21T10:00:00Z' }),
			result({ id: 2, score: 82, topic_id: 20, topic_name: 'Comprehensions', completed_at: '2026-10-20T10:00:00Z' }),
			result({ id: 3, score: 73, topic_id: 21, topic_name: 'Decorators', completed_at: '2026-10-19T10:00:00Z' }),
		]);
		await openResultsTab();
		expect(await screen.findByText('Python · Decorators')).toBeInTheDocument();
		expect(screen.getByText('Python · Comprehensions')).toBeInTheDocument();
		const text = document.body.textContent || '';
		const dec = text.indexOf('Python · Decorators');
		const comp = text.indexOf('Python · Comprehensions');
		// Most-recently-attempted topic's group first; both Decorators
		// cards (91, then 73) sit inside it before Comprehensions opens.
		expect(dec).toBeGreaterThan(-1);
		expect(comp).toBeGreaterThan(dec);
		expect(text.indexOf('91%')).toBeGreaterThan(dec);
		expect(text.indexOf('91%')).toBeLessThan(comp);
		expect(text.indexOf('73%')).toBeGreaterThan(dec);
		expect(text.indexOf('73%')).toBeLessThan(comp);
		expect(text.indexOf('82%')).toBeGreaterThan(comp);
	});

	test('C2: a topic-less attempt (newest of all) renders LAST under the exact legacy heading, skill name kept, nothing invented', async () => {
		mockPageApis([
			result({
				id: 9,
				score: 66,
				topic_id: null,
				topic_name: null,
				format: null,
				difficulty_band: null,
				completed_at: '2026-10-22T10:00:00Z',
			}),
			result({ id: 1, score: 91, topic_id: 20, topic_name: 'Comprehensions', completed_at: '2026-10-20T10:00:00Z' }),
		]);
		await openResultsTab();
		const legacy = await screen.findByText('Earlier assessments — topic not recorded');
		expect(legacy).toBeInTheDocument();
		const text = document.body.textContent || '';
		// Trailing group despite being the newest attempt overall.
		expect(text.indexOf('Earlier assessments — topic not recorded')).toBeGreaterThan(
			text.indexOf('Python · Comprehensions'),
		);
		expect(text.indexOf('66%')).toBeGreaterThan(text.indexOf('Earlier assessments — topic not recorded'));
		// Its skill name still shows on the card (real recorded data).
		expect(screen.getAllByText('Python').length).toBeGreaterThan(0);
	});

	test('C3: format/band label reuses the shipped vocabulary — mcq/medium shows Multiple choice and Medium', async () => {
		mockPageApis([result({ id: 1, format: 'mcq', difficulty_band: 'medium' })]);
		await openResultsTab();
		expect(await screen.findByText(/Multiple choice/)).toBeInTheDocument();
		expect(screen.getByText(/Medium/)).toBeInTheDocument();
	});

	test('C3b: a null-format/null-band attempt shows no format or band label', async () => {
		mockPageApis([
			result({ id: 1, topic_id: null, topic_name: null, format: null, difficulty_band: null }),
		]);
		await openResultsTab();
		expect(await screen.findByText('Earlier assessments — topic not recorded')).toBeInTheDocument();
		expect(screen.queryByText(/Multiple choice/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Written answers/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Medium/)).not.toBeInTheDocument();
	});

	test('C4a: empty results still render the honest empty state', async () => {
		mockPageApis([]);
		await openResultsTab();
		expect(await screen.findByText('No assessment results yet')).toBeInTheDocument();
	});

	test('C4b: Partial badge behaviour is unchanged inside groups', async () => {
		mockPageApis([
			result({
				id: 1,
				passed: false,
				behavioral_flags: { partial: true, answers_given: 2, total_questions: 10, correct_count: 1 },
			}),
		]);
		await openResultsTab();
		expect(await screen.findByText('Python · Comprehensions')).toBeInTheDocument();
		expect(screen.getByText(/Partial — answered 2 of 10/)).toBeInTheDocument();
	});
});
