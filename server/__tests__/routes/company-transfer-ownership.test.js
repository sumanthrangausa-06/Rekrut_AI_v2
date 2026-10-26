/**
 * @jest-environment node
 *
 * Issue #768 — ownership transfer must not mint platform admins.
 *
 * POST /api/company/transfer-ownership demoted the old owner with
 * `UPDATE users SET role = 'admin'` — granting platform-wide admin
 * (all 25 admin routes) to a plain company user. The demotion target
 * must be 'recruiter': company-scoped, least privilege for a former owner.
 *
 * The company router is mounted with stubbed auth middleware (the route's
 * own auth/permission chain is not under test here). The transaction client
 * is stubbed per-test to serve the companies/users SELECTs and record the
 * UPDATEs issued inside the transaction.
 */
const request = require('supertest');
const express = require('express');

const mockInsertAuditLog = jest.fn(async () => ({}));
jest.mock('../../../routes/audit', () => ({
	insertAuditLog: (...args) => mockInsertAuditLog(...args),
}));

jest.mock('../../../lib/auth', () => {
	const actual = jest.requireActual('../../../lib/auth');
	return {
		...actual,
		authMiddleware: (req, _res, next) => {
			// role mirrors a real owner row (SELECT * in lib/auth): 'employer'
			// is the users.role; 'owner' exists only as the RBAC role.
			req.user = { id: 1, email: 'owner@test.com', name: 'Owner', role: 'employer', company_id: 1 };
			next();
		},
	};
});

jest.mock('../../../middleware/rbac', () => ({
	requirePermission: () => (_req, _res, next) => next(),
	invalidateUserCache: jest.fn(),
}));

// eslint-disable-next-line import/first
const pool = require('../../../lib/db');
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

describe('POST /api/company/transfer-ownership — old-owner demotion (Issue #768)', () => {
	let app;
	let issuedUpdates;

	beforeEach(() => {
		app = buildApp();
		issuedUpdates = [];
		mockInsertAuditLog.mockClear();

		function serveReads(normalized, params, recordWrites) {
			if (normalized.includes('select id, owner_id, name from companies where id =')) {
				return { rows: [{ id: 1, owner_id: 1, name: 'Test Co' }], rowCount: 1 };
			}
			if (
				normalized.includes('from users where id =') &&
				normalized.includes('suspended_at')
			) {
				return {
					rows: [
						{
							id: 2,
							name: 'Target',
							email: 'target@test.com',
							company_id: 1,
							role: 'recruiter',
							suspended_at: null,
						},
					],
					rowCount: 1,
				};
			}
			if (normalized.startsWith('update users set role =')) {
				if (recordWrites) issuedUpdates.push({ sql: normalized, params });
				return { rows: [], rowCount: 1 };
			}
			if (normalized.includes('update companies set owner_id =')) {
				return { rows: [], rowCount: 1 };
			}
			if (normalized.startsWith('delete from user_roles')) {
				if (recordWrites) issuedUpdates.push({ sql: normalized, params });
				return { rows: [], rowCount: 1 };
			}
			if (normalized.startsWith('insert into user_roles')) {
				if (recordWrites) issuedUpdates.push({ sql: normalized, params });
				return { rows: [], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		}

		const txQuery = jest.fn(async (sql, params) => {
			const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

			if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
				return { rows: [], rowCount: 0 };
			}
			return serveReads(normalized, params, true);
		});

		pool.connect = jest.fn(async () => ({ query: txQuery, release: jest.fn() }));
		// Pre-transaction SELECTs (company + target user) go through pool.query directly.
		pool.query = jest.fn(async (sql, params) => {
			const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
			return serveReads(normalized, params, false);
		});
	});

	it('demotes the old owner to recruiter, not platform admin', async () => {
		const res = await request(app)
			.post('/api/company/transfer-ownership')
			.send({ newOwnerId: 2 });

		expect(res.status).toBe(200);

		const demotion = issuedUpdates.find((u) => u.params[0] === 1);
		expect(demotion).toBeDefined();
		expect(demotion.sql).toMatch(/role = 'recruiter'/i);
		expect(demotion.sql).not.toMatch(/role = 'admin'/i);
	});

	it('never issues role = admin for any user in the transfer', async () => {
		const res = await request(app)
			.post('/api/company/transfer-ownership')
			.send({ newOwnerId: 2 });

		expect(res.status).toBe(200);

		const adminGrants = issuedUpdates.filter((u) => /role = 'admin'/i.test(u.sql));
		expect(adminGrants).toHaveLength(0);
	});

	it('revokes the old owner RBAC owner role (user_roles)', async () => {
		const res = await request(app)
			.post('/api/company/transfer-ownership')
			.send({ newOwnerId: 2 });

		expect(res.status).toBe(200);

		const revoke = issuedUpdates.find((u) => u.sql.startsWith('delete from user_roles'));
		expect(revoke).toBeDefined();
		// old owner (id=1), company-scoped (company_id=1), owner role only
		expect(revoke.params[0]).toBe(1);
		expect(revoke.params[1]).toBe(1);
		expect(revoke.sql).toMatch(/where name = 'owner'/);
	});

	it("never issues UPDATE users SET role = 'owner' during transfer (Issue #1140)", async () => {
		const res = await request(app)
			.post('/api/company/transfer-ownership')
			.send({ newOwnerId: 2 });

		expect(res.status).toBe(200);

		// chk_users_role (migration 047) forbids 'owner' in users.role — this
		// write rolls the whole transfer back where the CHECK exists.
		const ownerWrites = issuedUpdates.filter((u) => /role = 'owner'/i.test(u.sql));
		expect(ownerWrites).toHaveLength(0);

		// Ownership still moves via RBAC: old owner's owner role revoked,
		// new owner's owner role granted.
		expect(issuedUpdates.some((u) => u.sql.startsWith('delete from user_roles'))).toBe(true);
		expect(issuedUpdates.some((u) => u.sql.startsWith('insert into user_roles'))).toBe(true);
	});

	it('audit metadata separates RBAC and users.role changes (Issue #1196)', async () => {
		const res = await request(app)
			.post('/api/company/transfer-ownership')
			.send({ newOwnerId: 2 });

		expect(res.status).toBe(200);

		const auditCall = mockInsertAuditLog.mock.calls
			.map((c) => c[0])
			.find((c) => c && c.action === 'ownership_transferred');
		expect(auditCall).toBeDefined();
		const { metadata } = auditCall;

		// RBAC (user_roles) changes, vocabulary-pure:
		expect(metadata.old_owner_rbac_role_change).toEqual({ from: 'owner', to: null });
		expect(metadata.new_owner_rbac_role_change).toEqual({ from: null, to: 'owner' });
		// users.role changes, vocabulary-pure: old owner really demoted to
		// 'recruiter' from their pre-transfer role; new owner unchanged (#1140).
		expect(metadata.old_owner_users_role_change).toEqual({ from: 'employer', to: 'recruiter' });
		expect(metadata.new_owner_users_role_change).toEqual({ from: 'recruiter', to: 'recruiter' });
		// The old mixed-vocabulary fields are gone.
		expect(metadata.old_owner_role_change).toBeUndefined();
		expect(metadata.new_owner_role_change).toBeUndefined();
	});

	it('grants the new owner the RBAC owner role (user_roles)', async () => {
		const res = await request(app)
			.post('/api/company/transfer-ownership')
			.send({ newOwnerId: 2 });

		expect(res.status).toBe(200);

		const grant = issuedUpdates.find((u) => u.sql.startsWith('insert into user_roles'));
		expect(grant).toBeDefined();
		// new owner (id=2), company-scoped (company_id=1)
		expect(grant.params[0]).toBe(2);
		expect(grant.params[1]).toBe(1);
		expect(grant.sql).toMatch(/where r\.name = 'owner'/);
	});
});
