/**
 * #1634 — Post-#1600 hotfix: company_size alias returns zero jobs;
 * preserved `skill` param can clobber a header-applied keyword.
 *
 * Behaviour-level tests (the #1634 addendum flagged the #1600 tests for
 * pinning vocabulary, not behaviour — these tests assert outcomes):
 *
 *  CS-1: The JobFilterBar sends bucket labels (startup/small/medium/
 *        large), but companies.company_size stores ranges. Selecting a
 *        bucket must return the jobs whose company size falls in that
 *        bucket — not zero jobs.
 *  CS-2: A raw stored range sent directly (other callers) keeps working
 *        (exact match).
 *  CS-3: An empty legacy alias param (`?job_type=&type=full-time`) must
 *        not defeat the non-empty alias (non-empty coalesce).
 *
 * Layers:
 *  1. Unit tests of the bucket→range translation (always run).
 *  2. Real-HTTP integration tests (gated behind JT1634_BASE_URL +
 *     JT1634_INTEGRATION_DB_URL, #1600 pattern): fresh-install dev build,
 *     real server, seeded companies of differing sizes + jobs, driven
 *     with the exact params the client sends. Quinn's run attaches its
 *     output to #1634.
 *
 * Example:
 *   JT1634_BASE_URL='http://127.0.0.1:3100' \
 *   JT1634_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55433/nova1634_test' \
 *   JT1634_JWT_SECRET=<same secret the server runs with> \
 *     npx jest server/__tests__/routes/candidate-jobs-company-size-1634.test.js --forceExit
 */
const { companySizeRanges } = require('../../../lib/company-size');

describe('#1634 unit — company_size bucket → stored range translation (CS-1)', () => {
	test('startup covers the 1-50 stored ranges (JobFilterBar label "Startup (1-50)")', () => {
		expect(companySizeRanges('startup')).toEqual(['1-10', '11-50']);
	});
	test('small covers 51-200', () => {
		expect(companySizeRanges('small')).toEqual(['51-200']);
	});
	test('medium covers the 201-1000 stored ranges', () => {
		expect(companySizeRanges('medium')).toEqual(['201-500', '501-1000']);
	});
	test('large covers the 1000+ stored ranges', () => {
		expect(companySizeRanges('large')).toEqual(['1001-5000', '5001+']);
	});
	test('every stored range belongs to exactly one bucket (no gaps, no overlaps)', () => {
		const stored = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'];
		const covered = ['startup', 'small', 'medium', 'large'].flatMap((b) => companySizeRanges(b));
		expect(covered.sort()).toEqual([...stored].sort());
	});
	test('a raw stored range is not a bucket — caller falls back to exact match', () => {
		expect(companySizeRanges('51-200')).toBeNull();
		expect(companySizeRanges('')).toBeNull();
		expect(companySizeRanges(undefined)).toBeNull();
	});
});

const BASE = process.env.JT1634_BASE_URL;
const DB_URL = process.env.JT1634_INTEGRATION_DB_URL;
const describeIntegration = BASE && DB_URL ? describe : describe.skip;

describeIntegration(
	'#1634 real-HTTP journey — GET /api/candidate/jobs company_size (CS-1–CS-3)',
	() => {
		const { Pool } = require('pg');
		const jwt = require('jsonwebtoken');
		const pool = new Pool({ connectionString: DB_URL });
		let token;

		// [title, company_size stored range]
		const SEED = [
			['Tiny Startup Job', '1-10'],
			['Fifty Person Job', '11-50'],
			['Small Co Job', '51-200'],
			['Mid Co Job', '201-500'],
			['Upper Mid Job', '501-1000'],
			['Big Co Job', '1001-5000'],
			['Mega Co Job', '5001+'],
		];

		beforeAll(async () => {
			const owner = await pool.query(
				`INSERT INTO users (email, name, role) VALUES ('jt1634-owner@example.com','JT1634 Owner','recruiter')
			 ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
			);
			const cand = await pool.query(
				`INSERT INTO users (email, name, role) VALUES ('jt1634-candidate@example.com','JT1634 Candidate','candidate')
			 ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
			);
			await pool.query('DELETE FROM jobs WHERE user_id = $1', [owner.rows[0].id]);
			for (const [title, size] of SEED) {
				const co = await pool.query(
					`INSERT INTO companies (name, company_size) VALUES ($1, $2) RETURNING id`,
					[`JT1634 ${title} Co`, size],
				);
				await pool.query(
					`INSERT INTO jobs (user_id, company_id, title, company, description, location, job_type, remote_type,
				                   experience_level, salary_min, salary_max, skills_required, status)
				 VALUES ($1,$2,$3,$4,'desc','Austin, TX','full-time','remote','mid',90000,130000,'[]'::jsonb,'active')`,
					[owner.rows[0].id, co.rows[0].id, title, `JT1634 ${title} Co`],
				);
			}
			token = jwt.sign(
				{ id: cand.rows[0].id, email: 'jt1634-candidate@example.com', role: 'candidate' },
				process.env.JT1634_JWT_SECRET || process.env.JWT_SECRET,
				{ expiresIn: '1h' },
			);
		});

		afterAll(async () => {
			await pool.end();
		});

		async function getTitles(qs) {
			const res = await fetch(`${BASE}/api/candidate/jobs?${qs}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			const body = await res.json();
			return { status: res.status, body, titles: (body.data || []).map((j) => j.title) };
		}

		test('CS-1a: company_size=startup returns the 1-10 and 11-50 jobs, not zero', async () => {
			const { status, body, titles } = await getTitles('limit=200&company_size=startup');
			expect(status).toBe(200);
			expect(titles.sort()).toEqual(['Fifty Person Job', 'Tiny Startup Job']);
			expect(body.pagination.total).toBe(2);
		});

		test('CS-1b: company_size=small returns only the 51-200 job', async () => {
			const { titles } = await getTitles('limit=200&company_size=small');
			expect(titles).toEqual(['Small Co Job']);
		});

		test('CS-1c: company_size=medium returns the 201-500 and 501-1000 jobs', async () => {
			const { titles } = await getTitles('limit=200&company_size=medium');
			expect(titles.sort()).toEqual(['Mid Co Job', 'Upper Mid Job']);
		});

		test('CS-1d: company_size=large returns the 1001-5000 and 5001+ jobs', async () => {
			const { titles } = await getTitles('limit=200&company_size=large');
			expect(titles.sort()).toEqual(['Big Co Job', 'Mega Co Job']);
		});

		test('CS-1e: legacy camelCase alias companySize honours buckets too', async () => {
			const { titles } = await getTitles('limit=200&companySize=small');
			expect(titles).toEqual(['Small Co Job']);
		});

		test('CS-2: a raw stored range value (not a bucket label) still exact-matches via the fallback', async () => {
			const { titles } = await getTitles('limit=200&company_size=51-200');
			expect(titles).toEqual(['Small Co Job']);
		});

		test('CS-3: empty legacy param does not defeat the alias (?job_type=&type=part-time)', async () => {
			// All seeded jobs are full-time. ?job_type=&type=part-time must
			// honour the part-time filter and return 0 jobs; the ?? defect
			// let the empty job_type win, dropped the filter, and returned
			// every seeded job.
			const { body, titles } = await getTitles('limit=200&job_type=&type=part-time');
			expect(titles).toEqual([]);
			expect(body.pagination.total).toBe(0);
		});
	},
);
