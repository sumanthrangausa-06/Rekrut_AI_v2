/**
 * #1600 — Job Board Filters button is a dead placeholder.
 *
 * User-journey acceptance tests (PRD prd-job-board-and-profile.md §10,
 * JT-J1–J4), written from the candidate's expectations FIRST (Sumanth's
 * 2026-10-21 user-perspective rule), before the fix:
 *
 *  JT-J1: Candidate opens the Job Board, clicks the header Filters, sets
 *         Location + Type = Full-time → only matching jobs are listed;
 *         the count shown equals the number listed.
 *  JT-J2: Candidate combines keyword + work mode + salary range → results
 *         satisfy all three (honoured by the SERVER, not only re-filtered
 *         client-side); clearing filters restores the full list.
 *  JT-J3: A combination with no matches → honest empty result (0 jobs,
 *         total 0) — never unrelated jobs presented as matches.
 *  JT-J4: The same journey works at mobile width — the header Filters
 *         door is not desktop-only.
 *
 * Two layers, labelled as what they are:
 *
 *  1. Static contract tests (always run): the header sheet must not be
 *     the dead placeholder; it must expose the PRD field set and write
 *     the board's own query-param names; jobs.tsx must sync its filter
 *     state from those URL params (ONE filter behaviour); the server
 *     /candidate/jobs handler must accept the parameter names the
 *     client actually sends (the verified five-name mismatch).
 *
 *  2. Real-HTTP integration tests (gated behind JT1600_BASE_URL +
 *     JT1600_INTEGRATION_DB_URL, 275-style): against a fresh-install
 *     dev build (migrate.js from empty) with the real server running,
 *     seed real jobs and drive GET /api/candidate/jobs with the exact
 *     parameter names the client sends. This is the layer that proves
 *     JT-J1–J3 end-to-end; Quinn's run attaches its output to #1600.
 *
 * Example:
 *   JT1600_BASE_URL='http://127.0.0.1:3100' \
 *   JT1600_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55471/nova1600_test' \
 *   JT1600_JWT_SECRET=<same secret the server runs with> \
 *     npx jest server/__tests__/routes/candidate-jobs-filters-1600.test.js --forceExit
 *
 * (JT1600_JWT_SECRET, not JWT_SECRET: server/test/setup.js forcibly
 * overrides JWT_SECRET with its own test value inside jest.)
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('#1600 static contract — header Filters is a real door (JT-J1/JT-J4)', () => {
	let header;
	beforeAll(() => {
		header = read('client/src/components/layout/header.tsx');
	});

	test('the dead placeholder text is gone', () => {
		expect(header).not.toContain('Filter options will be wired here.');
	});

	test('header sheet exposes the PRD §5.1 field set with labels', () => {
		for (const label of ['Keyword', 'Location', 'Job Type', 'Work Mode', 'Experience', 'Salary']) {
			expect(header).toContain(label);
		}
		// PRD value domains (verified against migration 047 CHECK + code enums)
		for (const v of ['full-time', 'part-time', 'internship', 'contract']) expect(header).toContain(v);
		for (const v of ['remote', 'hybrid', 'onsite']) expect(header).toContain(v);
	});

	test('header Apply writes the board\u2019s existing query-param names (one behaviour)', () => {
		for (const p of [
			'search',
			'location',
			'type',
			'remote_type',
			'experience_level',
			'salary_min',
			'salary_max',
		]) {
			expect(header).toContain(`'${p}'`);
		}
		expect(header).toContain('Apply');
		expect(header).toContain('Clear');
		// Off the Job Board, the door leads to the Job Board (FR-J1)
		expect(header).toContain('/candidate/jobs');
	});

	test('header Filters button is not desktop-only (JT-J4) and not shown to recruiters', () => {
		const btnIdx = header.indexOf('>Filters<');
		expect(btnIdx).toBeGreaterThan(-1);
		const btnSlice = header.slice(Math.max(0, btnIdx - 600), btnIdx);
		expect(btnSlice).not.toContain('hidden md:inline-flex');
		expect(btnSlice).not.toContain('hidden h-9');
		// Recruiter guard: the button block is conditioned on not-recruiter
		// (window spans the button element incl. its long Tailwind class list)
		expect(header).toMatch(/!isRecruiter[\s\S]{0,800}Filters|Filters[\s\S]{0,200}!isRecruiter/);
	});
});

describe('#1600 static contract — board syncs from URL + server honours client params', () => {
	test('jobs.tsx syncs FilterState from the URL filter params', () => {
		const jobs = read('client/src/pages/candidate/jobs.tsx');
		for (const p of ['remote_type', 'experience_level', 'salary_min', 'salary_max', 'type']) {
			expect(jobs).toContain(`searchParams.get('${p}')`);
		}
	});

	test('B1: URL params are honoured only behind the header filters=hdr1 marker', () => {
		const header = read('client/src/components/layout/header.tsx');
		const jobs = read('client/src/pages/candidate/jobs.tsx');
		expect(header).toContain("params.set('filters', 'hdr1')");
		expect(jobs).toContain("searchParams.get('filters')");
	});

	test('B-1 (review BLOCK): clear is an explicit signal — marker absence never resets state', () => {
		const header = read('client/src/components/layout/header.tsx');
		const jobs = read('client/src/pages/candidate/jobs.tsx');
		// Header Clear / empty Apply navigate with the explicit clear signal
		expect(header).toContain('filters=clear');
		// Board resets ONLY for the clear signal; absence leaves state alone
		// (search is shared with skill chips / AI search — inferring a reset
		// from marker absence wiped their intent)
		expect(jobs).toContain("mode !== 'hdr1' && mode !== 'clear'");
		expect(jobs).toContain("mode === 'clear'");
		// D-B1: consumed signals are stripped from the URL so they cannot
		// re-fire on a later param change or reload
		expect(jobs).toContain("next.delete('filters')");
		// D2-B1: the strip never rewrites a URL that no longer carries the
		// signal (updater no-ops), so concurrent param writes survive
		expect(jobs).toContain("if (!prev.has('filters')) return prev;");
	});

	test('B2: client salary refinement mirrors server semantics (Number coercion, NULL = no match)', () => {
		const jobs = read('client/src/pages/candidate/jobs.tsx');
		expect(jobs).toContain('Number(j.salary_min)');
		expect(jobs).toContain('Number(j.salary_max)');
		expect(jobs).not.toContain('(j.salary_max ?? 0) >= filters.salaryMin');
		expect(jobs).not.toContain('(j.salary_min ?? 0) <= filters.salaryMax');
	});

	test('server /candidate/jobs accepts the parameter names the client sends', () => {
		const src = read('routes/candidate.js');
		const start = src.indexOf("router.get('/jobs', authMiddleware");
		expect(start).toBeGreaterThan(-1);
		const handlerHead = src.slice(start, start + 1600);
		// The client sends snake_case names; the handler head must read them
		// (directly or as aliases), not only the legacy camelCase names.
		for (const p of ['remote_type', 'experience_level', 'company_size', 'sort_by']) {
			expect(handlerHead).toContain(p);
		}
		// S-5: the legacy names other callers may use keep working too.
		for (const p of ['job_type', 'remoteType', 'experienceLevel', 'companySize', 'sortBy']) {
			expect(handlerHead).toContain(p);
		}
	});
});

const BASE = process.env.JT1600_BASE_URL;
const DB_URL = process.env.JT1600_INTEGRATION_DB_URL;
const describeIntegration = BASE && DB_URL ? describe : describe.skip;

describeIntegration('#1600 real-HTTP journey — GET /api/candidate/jobs (JT-J1–J3)', () => {
	const { Pool } = require('pg');
	const jwt = require('jsonwebtoken');
	const pool = new Pool({ connectionString: DB_URL });
	let token;
	let candidateId;

	const SEED_JOBS = [
		// title, location, job_type, remote_type, experience_level, salary_min, salary_max
		['Frontend Engineer', 'Austin, TX', 'full-time', 'remote', 'mid', 90000, 130000],
		['Backend Engineer', 'Austin, TX', 'part-time', 'hybrid', 'senior', 70000, 100000],
		['Frontend Intern', 'New York, NY', 'internship', 'onsite', 'entry', 30000, 40000],
		['Platform Engineer', 'Denver, CO', 'full-time', 'remote', 'senior', 150000, 190000],
	];

	beforeAll(async () => {
		const owner = await pool.query(
			`INSERT INTO users (email, name, role) VALUES ('jt1600-owner@example.com','JT Owner','recruiter')
			 ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
		);
		const cand = await pool.query(
			`INSERT INTO users (email, name, role) VALUES ('jt1600-candidate@example.com','JT Candidate','candidate')
			 ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
		);
		candidateId = cand.rows[0].id;
		await pool.query('DELETE FROM jobs WHERE user_id = $1', [owner.rows[0].id]);
		for (const j of SEED_JOBS) {
			await pool.query(
				`INSERT INTO jobs (user_id, title, company, description, location, job_type, remote_type,
				                   experience_level, salary_min, salary_max, skills_required, status)
				 VALUES ($1,$2,'JT Co','desc',$3,$4,$5,$6,$7,$8,'[]'::jsonb,'active')`,
				[owner.rows[0].id, j[0], j[1], j[2], j[3], j[4], j[5], j[6]],
			);
		}
		token = jwt.sign(
			{ id: candidateId, email: 'jt1600-candidate@example.com', role: 'candidate' },
			process.env.JT1600_JWT_SECRET || process.env.JWT_SECRET,
			{ expiresIn: '1h' },
		);
	});

	afterAll(async () => {
		await pool.end();
	});

	async function getJobs(qs) {
		const res = await fetch(`${BASE}/api/candidate/jobs?${qs}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		return { status: res.status, body: await res.json() };
	}

	test('JT-J1: location + type (client param names) return only matching jobs, count = listings', async () => {
		const { status, body } = await getJobs('limit=200&location=Austin&type=full-time');
		expect(status).toBe(200);
		const titles = (body.data || []).map((j) => j.title);
		expect(titles).toEqual(['Frontend Engineer']);
		expect(body.pagination.total).toBe(1);
	});

	test('JT-J2: keyword + work mode + salary range combine — all three honoured server-side', async () => {
		const { status, body } = await getJobs(
			'limit=200&search=Engineer&remote_type=remote&salary_min=100000&salary_max=200000',
		);
		expect(status).toBe(200);
		const titles = (body.data || []).map((j) => j.title).sort();
		// Frontend Engineer (remote, 90–130k overlaps ≥100k..≤200k window via
		// salary_max>=min && salary_min<=max) and Platform Engineer qualify;
		// Backend Engineer is hybrid → excluded by work mode.
		expect(titles).toEqual(['Frontend Engineer', 'Platform Engineer']);
	});

	test('JT-J2b: experience_level (client param name) is honoured server-side', async () => {
		const { body } = await getJobs('limit=200&experience_level=senior');
		const titles = (body.data || []).map((j) => j.title).sort();
		expect(titles).toEqual(['Backend Engineer', 'Platform Engineer']);
	});

	test('JT-J3: impossible combination returns an honest empty result', async () => {
		const { status, body } = await getJobs('limit=200&location=Atlantis&type=internship');
		expect(status).toBe(200);
		expect(body.data).toEqual([]);
		expect(body.pagination.total).toBe(0);
	});

	test('JT-J2c: no filter params returns the full seeded list (clear restores)', async () => {
		const { body } = await getJobs('limit=200');
		expect(body.pagination.total).toBeGreaterThanOrEqual(SEED_JOBS.length);
		const titles = (body.data || []).map((j) => j.title);
		for (const j of SEED_JOBS) expect(titles).toContain(j[0]);
	});
});
