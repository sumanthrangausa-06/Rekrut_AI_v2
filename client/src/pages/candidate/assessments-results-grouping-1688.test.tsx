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
 *
 * #1723 tightening (test hygiene only — no production change):
 *  - F4: ALL 7 shipped config labels are pinned verbatim (C3c), plus
 *    the two previously untested cases — a topic-less attempt that is
 *    NOT the oldest still trails (C2b), and the topic_id-set /
 *    topic_name-NULL heading fallback (C5).
 *  - F2: why grouping keys on topic_id ALONE (see the F2 note above
 *    C6) — documented with schema/code evidence instead of keying on
 *    (topic_id, skill_name), which would need a production change
 *    and, per the evidence, would key on a value topic_id already
 *    determines.
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

	test('C2b (#1723): a topic-less attempt that is NOT the oldest still trails — legacy group renders after BOTH topic groups', async () => {
		mockPageApis([
			result({ id: 1, score: 91, topic_id: 21, topic_name: 'Decorators', completed_at: '2026-10-21T10:00:00Z' }),
			result({
				id: 9,
				score: 66,
				topic_id: null,
				topic_name: null,
				format: null,
				difficulty_band: null,
				completed_at: '2026-10-20T10:00:00Z',
			}),
			result({ id: 2, score: 55, topic_id: 20, topic_name: 'Comprehensions', completed_at: '2026-10-19T10:00:00Z' }),
		]);
		await openResultsTab();
		expect(await screen.findByText('Earlier assessments — topic not recorded')).toBeInTheDocument();
		const text = document.body.textContent || '';
		const dec = text.indexOf('Python · Decorators');
		const comp = text.indexOf('Python · Comprehensions');
		const legacy = text.indexOf('Earlier assessments — topic not recorded');
		// The legacy attempt is the MIDDLE attempt by date (Oct 20, between
		// Oct 21 and Oct 19) — the legacy bucket still renders last, after
		// the older topic's group too. C2 pins the newest case; this pins
		// that position in the payload never matters.
		expect(dec).toBeGreaterThan(-1);
		expect(comp).toBeGreaterThan(dec);
		expect(legacy).toBeGreaterThan(comp);
		expect(text.indexOf('55%')).toBeGreaterThan(comp);
		expect(text.indexOf('55%')).toBeLessThan(legacy);
		expect(text.indexOf('66%')).toBeGreaterThan(legacy);
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

	// F4 (#1723): pin ALL 7 shipped config labels verbatim — the four
	// format strings and the three band strings in
	// resultFormatLabels/resultBandLabels (assessments.tsx, the shipped
	// configure/take vocabulary, UX spec §0.2). The label renders as ONE
	// span, format + band joined with ' · ', so each case asserts the
	// exact joined string: drift on ANY of the 7 labels fails here.
	const labelCases = [
		{ format: 'mixed', band: 'easy', label: 'Mixed — multiple choice and written answers · Easy' },
		{ format: 'mcq', band: 'medium', label: 'Multiple choice · Medium' },
		{ format: 'short_answer', band: 'hard', label: 'Written answers · Hard' },
		{ format: 'coding', band: 'easy', label: 'Coding · Easy' },
		// Single-part pins: the other part absent renders the one label
		// alone — no dangling separator, no invented second part.
		{ format: 'coding', band: null, label: 'Coding' },
		{ format: null, band: 'hard', label: 'Hard' },
	];
	for (const c of labelCases) {
		test(`C3c (#1723 F4): format=${c.format} band=${c.band} shows exactly "${c.label}"`, async () => {
			mockPageApis([result({ id: 1, format: c.format, difficulty_band: c.band })]);
			await openResultsTab();
			expect(await screen.findByText(c.label)).toBeInTheDocument();
		});
	}

	test('C5 (#1723): topic_id set but topic_name NULL — heading falls back to skill name, then to title, never a fabricated topic', async () => {
		mockPageApis([
			result({ id: 1, score: 91, topic_id: 20, topic_name: null, completed_at: '2026-10-21T10:00:00Z' }),
			result({
				id: 2,
				score: 73,
				topic_id: 21,
				topic_name: null,
				skill_name: null,
				title: 'Python assessment',
				completed_at: '2026-10-20T10:00:00Z',
			}),
		]);
		await openResultsTab();
		expect(await screen.findByText('91%')).toBeInTheDocument();
		// Group headings are the page's <h3>s: with topic_name NULL the
		// shipped fallback is `${skill_name || title}` — the bare skill
		// name for topic 20, the bare title for topic 21 (no skill name).
		const headings = [...document.querySelectorAll('h3')].map((h) => h.textContent);
		expect(headings).toContain('Python');
		expect(headings).toContain('Python assessment');
		expect(headings.some((h) => h && h.includes('·'))).toBe(false);
		const text = document.body.textContent || '';
		expect(text).not.toContain('null');
		expect(text).not.toContain('undefined');
	});

	// F2 (#1723) — grouping key: topic_id ALONE is safe; documented, not
	// re-keyed. The heading is frozen from a group's FIRST row
	// (`${skill_name} · ${topic_name}`), so topic_id-only keying is safe
	// iff topic_id determines skill_name. It does:
	//  1. Schema (migrations/279_assessment_catalogue.js):
	//     assessment_topics.subject_id is INT NOT NULL REFERENCES
	//     assessment_subjects(id), UNIQUE(subject_id, slug) — a topic
	//     belongs to exactly ONE subject.
	//  2. Configured starts (routes/assessments.js, §3.6 snapshot): the
	//     candidate_skills row is resolved by the SUBJECT's default
	//     topic's legacy_skill_name — every topic of a subject resolves
	//     to the same skill_name.
	//  3. Legacy starts (same file): the snapshot topic is the skill's
	//     OWN default topic, found via legacy_skill_name, which carries
	//     a UNIQUE partial index (uq_assessment_topics_legacy_skill_name)
	//     — a legacy skill name maps to at most one topic, and that
	//     topic's skill is the skill itself.
	// So (topic_id → subject → skill_name) is a function: two rows with
	// the same topic_id cannot carry different skill_names, and the
	// first row's heading cannot mislabel a later row. Keying the group
	// on (topic_id, skill_name) would change production grouping code
	// to defend against a state the write paths cannot produce — out of
	// scope for this test-only lane and unnecessary per the above.
	test('C6 (#1723 F2): two attempts on the SAME topic_id render ONE group under one heading, both cards inside it', async () => {
		mockPageApis([
			result({ id: 1, score: 91, topic_id: 20, topic_name: 'Comprehensions', completed_at: '2026-10-21T10:00:00Z' }),
			result({ id: 2, score: 73, topic_id: 20, topic_name: 'Comprehensions', completed_at: '2026-10-20T10:00:00Z' }),
		]);
		await openResultsTab();
		expect(await screen.findByText('91%')).toBeInTheDocument();
		expect(screen.getAllByText('Python · Comprehensions')).toHaveLength(1);
		expect(screen.getByText('73%')).toBeInTheDocument();
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
