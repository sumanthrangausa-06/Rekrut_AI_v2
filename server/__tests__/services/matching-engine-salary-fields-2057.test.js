/**
 * #2057: findMatchingJobs must carry the job's numeric salary fields.
 *
 * The ai-search page's default view is GET /api/matching/recommendations,
 * served by findMatchingJobs. Its SELECT + result mapping returned only
 * salary_range, so min/max-only jobs showed no salary on ai-search even
 * after the client was routed through the shared formatter. This test
 * pins the widening: the job query asks for salary_min / salary_max /
 * currency_code and the mapped recommendation carries them unchanged
 * (PG NUMERIC arrives as a string; the client formatter coerces).
 *
 * lib/db is mocked with a routing client; lib/ai-provider is mocked to
 * reject, and the candidate profile lookup returns no rows, so
 * updateCandidateEmbedding throws 'User not found' — which
 * findMatchingJobs catches by design — and the flow continues with the
 * seeded job_embeddings row.
 */

jest.mock('../../../lib/db', () => ({
	connect: jest.fn(),
	query: jest.fn(),
}));

jest.mock('../../../lib/ai-provider', () => ({
	generateEmbedding: jest.fn(async () => {
		throw new Error('No embedding provider available');
	}),
}));

const pool = require('../../../lib/db');
const { findMatchingJobs } = require('../../../services/matching-engine');

const jobRow = {
	job_id: 2057,
	title: 'Analyst',
	company: 'Acme',
	location: 'Remote',
	salary_range: null,
	salary_min: '80000.00',
	salary_max: '120000.00',
	currency_code: 'USD',
	job_type: 'full-time',
	description: 'Analyse data.',
	requirements: 'SQL',
	created_at: '2026-10-01T00:00:00Z',
	company_name: 'Acme',
	company_logo: null,
	trustscore: 800,
	trust_tier: 'gold',
	similarity_score: 0.9,
};

describe('#2057 findMatchingJobs salary fields', () => {
	let capturedSql;

	beforeEach(() => {
		jest.clearAllMocks();
		capturedSql = [];
		const client = {
			query: jest.fn(async (sql) => {
				capturedSql.push(sql);
				if (sql.includes('job_embeddings')) return { rows: [jobRow] };
				if (sql.includes('omni_scores')) return { rows: [{ omniscore: 700 }] };
				// candidate_skills, job_recommendations INSERT, and the
				// embedding-refresh profile lookup (no rows -> refresh
				// throws, caught by findMatchingJobs) all land here.
				return { rows: [] };
			}),
			release: jest.fn(),
		};
		pool.connect.mockImplementation(async () => client);
	});

	it('job SELECT asks for the salary columns and the mapping returns them', async () => {
		const matches = await findMatchingJobs(7, { limit: 20, minScore: 0.5 });

		const jobSql = capturedSql.find((s) => s.includes('job_embeddings'));
		expect(jobSql).toContain('j.salary_min');
		expect(jobSql).toContain('j.salary_max');
		expect(jobSql).toContain('j.currency_code');

		expect(matches).toHaveLength(1);
		expect(matches[0].salary_min).toBe('80000.00');
		expect(matches[0].salary_max).toBe('120000.00');
		expect(matches[0].currency_code).toBe('USD');
	});
});
