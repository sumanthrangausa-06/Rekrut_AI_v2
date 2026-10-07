/**
 * @jest-environment node
 *
 * Issue #347 — recruiter registration without company_name must fail fast.
 *
 * POST /api/auth/register with a recruiter role (employer/recruiter/
 * hiring_manager) and no company_name used to silently skip company
 * auto-creation, leaving the user with company_id=null — permanently blocked
 * by requireApprovedRecruiter (403 on every write).
 *
 * Now: 400 COMPANY_NAME_REQUIRED before the user row is created, unless the
 * email domain matches an existing company (pending-approval flow).
 */
const request = require('supertest');
const app = require('../../../server');

const TEST_PASSWORD = 'Test123!@#';

describe('POST /api/auth/register — company_name required for recruiters (Issue #347)', () => {
	it.each([
		['employer'],
		['recruiter'],
		['hiring_manager'],
	])('rejects role=%s without company_name with 400 and creates no user', async (role) => {
		const email = `nocompany-${role}-${Date.now()}@brandnew-${Date.now()}.com`;
		const res = await request(app).post('/api/auth/register').send({
			email,
			password: TEST_PASSWORD,
			name: 'No Company',
			role,
			// no company_name
		});

		expect(res.status).toBe(400);
		expect(res.body.code).toBe('COMPANY_NAME_REQUIRED');

		// No user row was created — login must fail
		const loginRes = await request(app)
			.post('/api/auth/login')
			.send({ email, password: TEST_PASSWORD });
		expect(loginRes.status).toBe(401);
	});

	it('accepts recruiter signup with company_name (new domain)', async () => {
		const email = `withcompany-${Date.now()}@freshco-${Date.now()}.com`;
		const res = await request(app).post('/api/auth/register').send({
			email,
			password: TEST_PASSWORD,
			name: 'Has Company',
			role: 'recruiter',
			company_name: 'FreshCo',
		});

		expect(res.status).toBe(201);
		expect(res.body.user.role).toBe('recruiter');
		// Note: the mock DB doesn't persist companies, so company_id isn't
		// asserted here — the key check is that it does NOT 400.
	});

	it('candidate signup without company_name still works', async () => {
		const email = `cand-nocompany-${Date.now()}@example.com`;
		const res = await request(app).post('/api/auth/register').send({
			email,
			password: TEST_PASSWORD,
			name: 'Candidate',
			role: 'candidate',
		});

		expect(res.status).toBe(201);
		expect(res.body.user.role).toBe('candidate');
	});
});
