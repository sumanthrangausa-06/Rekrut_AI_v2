/**
 * @jest-environment node
 *
 * Issue #336 (P0) — team invites must never mint platform admins.
 *
 * POST /api/company/team/invite took `role` verbatim from the request body,
 * so an authenticated company user with members:manage could invite
 * {"role":"admin"} and create a platform admin. These tests pin the
 * whitelist: employer/recruiter/hiring_manager allowed (exactly what the
 * client invite dropdown offers), everything else → 400.
 *
 * The company router is mounted with stubbed auth middleware (the route's
 * own auth/permission chain is not under test here); the mocked DB from
 * server/test/setup.js backs storage.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	return {
		...actual,
		authMiddleware: (req, _res, next) => {
			req.user = { id: 1, email: 'owner@test.com', name: 'Owner', company_id: 1 };
			next();
		},
	};
});

jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (_req, _res, next) => next(),
	invalidateUserCache: jest.fn(),
}));

// eslint-disable-next-line import/first
const companyRouter = require('../../../routes/company');

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use('/api/company', companyRouter);
	// eslint-disable-next-line no-unused-vars
	app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
	return app;
}

describe('POST /api/company/team/invite — role whitelist (Issue #336)', () => {
	let app;
	beforeEach(() => {
		app = buildApp();
	});

	describe('rejected roles', () => {
		it.each([
			['admin'],
			['Admin'],
			['owner'],
			['superuser'],
		])('rejects invite role=%s with 400', async (role) => {
			const res = await request(app)
				.post('/api/company/team/invite')
				.send({ email: `inv-${role}-${Date.now()}@test.com`, name: 'Invitee', role });

			expect(res.status).toBe(400);
			expect(res.body.code).toBe('INVALID_ROLE');
		});
	});

	describe('allowed roles (client dropdown parity)', () => {
		it.each([
			['recruiter'],
			['hiring_manager'],
			['employer'],
		])('passes the role gate for invite role=%s', async (role) => {
			const res = await request(app)
				.post('/api/company/team/invite')
				.send({ email: `inv-${role}-${Date.now()}@test.com`, name: 'Invitee', role });

			// Must not be rejected for the role. (The mocked DB has no company
			// row, so the handler may fail later in the flow — the security
			// property under test is that the role gate lets it through.)
			expect(res.body.code).not.toBe('INVALID_ROLE');
		});
	});
});
