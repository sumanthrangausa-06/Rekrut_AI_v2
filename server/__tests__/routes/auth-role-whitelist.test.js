/**
 * @jest-environment node
 *
 * Issue #336 (P0) — public signup must never create admin users.
 *
 * The register endpoint took `role` verbatim from the request body, so
 * POST /api/auth/register with {"role":"admin"} minted a valid admin JWT.
 * These tests pin the whitelist: candidate/employer/recruiter/hiring_manager
 * allowed, everything else (admin, owner, case variants, garbage) → 400.
 */
const request = require('supertest');
const app = require('../../../server');

const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Password123!';
const ADMIN_PASSWORD = 'AdminPass123!'; // meets the old admin password policy

describe('POST /api/auth/register — role whitelist (Issue #336)', () => {
	describe('rejected roles', () => {
		it.each([
			['admin'],
			['Admin'],
			['ADMIN'],
			['owner'],
			['superuser'],
			['root'],
		])('rejects role=%s with 400 and creates no user', async (role) => {
			const email = `norole-${role}-${Date.now()}@example.com`;
			const res = await request(app)
				.post('/api/auth/register')
				.send({
					email,
					password: role.toLowerCase() === 'admin' ? ADMIN_PASSWORD : TEST_PASSWORD,
					name: 'Role Probe',
					role,
				});

			expect(res.status).toBe(400);
			expect(res.body.code).toBe('INVALID_ROLE');

			// No user row was created — login must fail
			const loginRes = await request(app)
				.post('/api/auth/login')
				.send({ email, password: TEST_PASSWORD });
			expect(loginRes.status).toBe(401);
		});

		it('rejects a null role with 400 (fail-closed)', async () => {
			const res = await request(app)
				.post('/api/auth/register')
				.send({
					email: `norole-null-${Date.now()}@example.com`,
					password: TEST_PASSWORD,
					name: 'Null Role',
					role: null,
				});

			expect(res.status).toBe(400);
			expect(res.body.code).toBe('INVALID_ROLE');
		});
	});

	describe('allowed roles (existing behavior preserved)', () => {
		it('creates a candidate when role is omitted (default)', async () => {
			const res = await request(app)
				.post('/api/auth/register')
				.send({
					email: `cand-${Date.now()}@example.com`,
					password: TEST_PASSWORD,
					name: 'Candidate User',
				});

			expect(res.status).toBe(201);
			expect(res.body.user.role).toBe('candidate');
		});

		it.each([
			['candidate'],
			['employer'],
			['recruiter'],
			['hiring_manager'],
		])('creates a user with role=%s', async (role) => {
			const isRecruiterFamily = role !== 'candidate';
			const email = `role-${role}-${Date.now()}@${isRecruiterFamily ? 'startup-xyz.com' : 'example.com'}`;
			const res = await request(app)
				.post('/api/auth/register')
				.send({
					email,
					password: TEST_PASSWORD,
					name: 'Role User',
					role,
					...(isRecruiterFamily ? { company_name: 'Startup XYZ' } : {}),
				});

			expect(res.status).toBe(201);
			expect(res.body.user.role).toBe(role);
		});

		it('keeps the company-owner flow intact: first recruiter with a new domain registers fine', async () => {
			// Owner status is granted server-side via user_roles (first user with the
			// domain); users.role itself stays 'recruiter'. This must not 400.
			const res = await request(app)
				.post('/api/auth/register')
				.send({
					email: `founder-${Date.now()}@newco-xyz.com`,
					password: TEST_PASSWORD,
					name: 'Founder',
					role: 'recruiter',
					company_name: 'NewCo XYZ',
				});

			expect(res.status).toBe(201);
			expect(res.body.user.role).toBe('recruiter');
			expect(res.body).toHaveProperty('token');
		});
	});
});
