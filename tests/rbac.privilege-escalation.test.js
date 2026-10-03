/**
 * @jest-environment node
 *
 * RBAC Privilege Escalation Tests — Issue #138
 *
 * Validates that each role can only access endpoints matching its permission
 * set, and that permission revocation invalidates active sessions.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// ─── Mock DB with RBAC support ────────────────────────────────────────────

jest.mock('../lib/db', () => {
  // In-memory stores (must be inside factory)
  const _mockUserRoles = new Map();
  const _mockRolePermissions = new Map();

  // Seed role permissions matching migration 128
  _mockRolePermissions.set('owner', new Set([
    'billing:manage', 'billing:read', 'company:manage', 'company:read',
    'members:manage', 'members:read', 'jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete',
    'candidates:read', 'candidates:score', 'candidates:manage',
    'interviews:read', 'interviews:schedule', 'interviews:conduct',
    'analytics:read', 'settings:manage', 'settings:read', 'compliance:read', 'compliance:manage',
  ]));
  _mockRolePermissions.set('admin', new Set([
    'company:manage', 'company:read', 'members:manage', 'members:read',
    'jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete',
    'candidates:read', 'candidates:score', 'candidates:manage',
    'interviews:read', 'interviews:schedule', 'interviews:conduct',
    'analytics:read', 'settings:manage', 'settings:read', 'compliance:read',
  ]));
  _mockRolePermissions.set('recruiter', new Set([
    'company:read', 'members:read', 'jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete',
    'candidates:read', 'candidates:score', 'candidates:manage',
    'interviews:read', 'interviews:schedule', 'interviews:conduct',
    'analytics:read', 'settings:read',
  ]));
  _mockRolePermissions.set('hiring_manager', new Set([
    'company:read', 'jobs:read', 'candidates:read', 'candidates:score', 'interviews:read',
  ]));
  _mockRolePermissions.set('interviewer', new Set([
    'interviews:read', 'interviews:conduct',
  ]));
  _mockRolePermissions.set('viewer', new Set([
    'company:read', 'jobs:read', 'candidates:read', 'interviews:read', 'analytics:read',
  ]));

  function _computeUserPermissions(userId) {
    const roles = _mockUserRoles.get(userId) || new Set();
    const perms = new Set();
    for (const role of roles) {
      const rolePerms = _mockRolePermissions.get(role) || new Set();
      for (const p of rolePerms) perms.add(p);
    }
    return perms;
  }

  const mockQuery = jest.fn(async (sql, params) => {
    const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

    // RBAC: fetch user permissions
    if (normalized.includes('select distinct p.name from user_roles ur')) {
      const userId = params[0];
      const perms = _computeUserPermissions(userId);
      return {
        rows: Array.from(perms).map((name) => ({ name })),
        rowCount: perms.size,
      };
    }

    // RBAC: fetch user roles
    if (normalized.includes('select distinct r.name from user_roles ur')) {
      const userId = params[0];
      const roles = _mockUserRoles.get(userId) || new Set();
      return {
        rows: Array.from(roles).map((name) => ({ name })),
        rowCount: roles.size,
      };
    }

    // Auth: SELECT user by ID
    if (normalized.includes('select * from users where id =')) {
      const userId = params[0];
      return {
        rows: [{
          id: userId,
          email: `user${userId}@test.com`,
          name: `User ${userId}`,
          role: 'recruiter',
          company_id: 1,
          suspended_at: null,
        }],
        rowCount: 1,
      };
    }

    // Auth: SELECT refresh token
    if (normalized.includes('select rt.*, u.email, u.role, u.name from refresh_tokens')) {
      return { rows: [], rowCount: 0 };
    }

    // Auth: UPDATE refresh tokens
    if (normalized.includes('update refresh_tokens')) {
      return { rows: [], rowCount: 1 };
    }

    // Generic fallback
    return { rows: [], rowCount: 0 };
  });

  return {
    query: mockQuery,
    _mockUserRoles,
    _mockRolePermissions,
    getQueryStats: () => ({ totalQueries: 0, slowQueries: 0, queriesPerMinute: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  };
});

jest.mock('../services/auditLogService', () => ({
  AuditLogger: {
    log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  },
}));

jest.mock('../lib/distributed-rate-limiter', () => {
  const rateLimitMiddleware = jest.fn((_req, _res, next) => next());
  return {
    rateLimits: {
      strict: rateLimitMiddleware,
      standard: rateLimitMiddleware,
      lenient: rateLimitMiddleware,
      ai: rateLimitMiddleware,
    },
    createRateLimit: () => rateLimitMiddleware,
    distributedRateLimiter: {
      checkLimit: jest.fn().mockResolvedValue({ allowed: true, count: 1, retryAfter: 0 }),
      startCleanup: jest.fn(),
    },
  };
});

// ─── Build test app ───────────────────────────────────────────────────────

const { requirePermission, invalidateUserCache } = require('../middleware/rbac');

function buildApp() {
  const app = express();
  app.use(express.json());

  // Fake auth middleware — sets req.user from Bearer token
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (!token) { req.user = null; return next(); }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        company_id: decoded.company_id || 1,
        company_name: 'TestCo',
      };
    } catch {
      req.user = null;
    }
    next();
  });

  // Test endpoints mapped to recruiter permissions
  app.get('/api/recruiter/dashboard', requirePermission('analytics:read'), (_req, res) => res.json({ ok: true }));
  app.get('/api/recruiter/jobs', requirePermission('jobs:read'), (_req, res) => res.json({ ok: true }));
  app.post('/api/recruiter/jobs', requirePermission('jobs:create'), (_req, res) => res.json({ ok: true }));
  app.put('/api/recruiter/jobs/:id', requirePermission('jobs:update'), (_req, res) => res.json({ ok: true }));
  app.get('/api/recruiter/applications', requirePermission('candidates:read'), (_req, res) => res.json({ ok: true }));
  app.put('/api/recruiter/applications/:id/status', requirePermission('candidates:manage'), (_req, res) => res.json({ ok: true }));
  app.get('/api/recruiter/interviews', requirePermission('interviews:read'), (_req, res) => res.json({ ok: true }));
  app.post('/api/recruiter/interviews', requirePermission('interviews:schedule'), (_req, res) => res.json({ ok: true }));
  app.get('/api/recruiter/analytics', requirePermission('analytics:read'), (_req, res) => res.json({ ok: true }));

  // Company endpoints
  app.get('/api/company/profile', requirePermission('company:read'), (_req, res) => res.json({ ok: true }));
  app.put('/api/company/profile', requirePermission('company:manage'), (_req, res) => res.json({ ok: true }));
  app.get('/api/company/team/members', requirePermission('members:read'), (_req, res) => res.json({ ok: true }));
  app.post('/api/company/team/invite', requirePermission('members:manage'), (_req, res) => res.json({ ok: true }));
  app.post('/api/company/transfer-ownership', requirePermission('company:manage'), (_req, res) => res.json({ ok: true }));

  // Error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeToken(userId, role) {
  return jwt.sign(
    { id: userId, email: `user${userId}@test.com`, role, company_id: 1 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('RBAC Privilege Escalation — Issue #138', () => {
  let app;
  const db = require('../lib/db');

  beforeEach(() => {
    app = buildApp();
    db._mockUserRoles.clear();
    // Clear permission cache
    invalidateUserCache(1);
    invalidateUserCache(2);
    invalidateUserCache(3);
    invalidateUserCache(4);
    invalidateUserCache(5);
    invalidateUserCache(6);
    invalidateUserCache(10);
    invalidateUserCache(11);
    invalidateUserCache(20);
  });

  describe('Role permission boundaries', () => {
    const testCases = [
      {
        role: 'owner',
        userId: 1,
        allowed: [
          ['GET', '/api/recruiter/dashboard'],
          ['GET', '/api/recruiter/jobs'],
          ['POST', '/api/recruiter/jobs'],
          ['PUT', '/api/recruiter/jobs/1'],
          ['GET', '/api/recruiter/applications'],
          ['PUT', '/api/recruiter/applications/1/status'],
          ['GET', '/api/recruiter/interviews'],
          ['POST', '/api/recruiter/interviews'],
          ['GET', '/api/recruiter/analytics'],
          ['GET', '/api/company/profile'],
          ['PUT', '/api/company/profile'],
          ['GET', '/api/company/team/members'],
          ['POST', '/api/company/team/invite'],
          ['POST', '/api/company/transfer-ownership'],
        ],
        denied: [],
      },
      {
        role: 'admin',
        userId: 2,
        allowed: [
          ['GET', '/api/recruiter/dashboard'],
          ['GET', '/api/recruiter/jobs'],
          ['POST', '/api/recruiter/jobs'],
          ['PUT', '/api/recruiter/jobs/1'],
          ['GET', '/api/recruiter/applications'],
          ['PUT', '/api/recruiter/applications/1/status'],
          ['GET', '/api/recruiter/interviews'],
          ['POST', '/api/recruiter/interviews'],
          ['GET', '/api/recruiter/analytics'],
          ['GET', '/api/company/profile'],
          ['PUT', '/api/company/profile'],
          ['GET', '/api/company/team/members'],
          ['POST', '/api/company/team/invite'],
        ],
        denied: [
          // admin has company:manage so can transfer ownership
        ],
      },
      {
        role: 'recruiter',
        userId: 3,
        allowed: [
          ['GET', '/api/recruiter/dashboard'],
          ['GET', '/api/recruiter/jobs'],
          ['POST', '/api/recruiter/jobs'],
          ['PUT', '/api/recruiter/jobs/1'],
          ['GET', '/api/recruiter/applications'],
          ['PUT', '/api/recruiter/applications/1/status'],
          ['GET', '/api/recruiter/interviews'],
          ['POST', '/api/recruiter/interviews'],
          ['GET', '/api/recruiter/analytics'],
          ['GET', '/api/company/profile'],
          ['GET', '/api/company/team/members'],
        ],
        denied: [
          ['PUT', '/api/company/profile'],
          ['POST', '/api/company/team/invite'],
          ['POST', '/api/company/transfer-ownership'],
        ],
      },
      {
        role: 'hiring_manager',
        userId: 4,
        allowed: [
          ['GET', '/api/recruiter/jobs'],
          ['GET', '/api/recruiter/applications'],
          ['GET', '/api/recruiter/interviews'],
          ['GET', '/api/company/profile'],
        ],
        denied: [
          ['GET', '/api/recruiter/dashboard'],
          ['POST', '/api/recruiter/jobs'],
          ['PUT', '/api/recruiter/jobs/1'],
          ['PUT', '/api/recruiter/applications/1/status'],
          ['POST', '/api/recruiter/interviews'],
          ['GET', '/api/recruiter/analytics'],
          ['PUT', '/api/company/profile'],
          ['POST', '/api/company/team/invite'],
          ['POST', '/api/company/transfer-ownership'],
        ],
      },
      {
        role: 'interviewer',
        userId: 5,
        allowed: [
          ['GET', '/api/recruiter/interviews'],
        ],
        denied: [
          ['GET', '/api/recruiter/dashboard'],
          ['GET', '/api/recruiter/jobs'],
          ['POST', '/api/recruiter/jobs'],
          ['GET', '/api/recruiter/applications'],
          ['PUT', '/api/recruiter/applications/1/status'],
          ['POST', '/api/recruiter/interviews'],
          ['GET', '/api/recruiter/analytics'],
          ['GET', '/api/company/profile'],
          ['POST', '/api/company/transfer-ownership'],
        ],
      },
      {
        role: 'viewer',
        userId: 6,
        allowed: [
          ['GET', '/api/recruiter/dashboard'],
          ['GET', '/api/recruiter/jobs'],
          ['GET', '/api/recruiter/applications'],
          ['GET', '/api/recruiter/interviews'],
          ['GET', '/api/recruiter/analytics'],
          ['GET', '/api/company/profile'],
        ],
        denied: [
          ['POST', '/api/recruiter/jobs'],
          ['PUT', '/api/recruiter/jobs/1'],
          ['PUT', '/api/recruiter/applications/1/status'],
          ['POST', '/api/recruiter/interviews'],
          ['PUT', '/api/company/profile'],
          ['POST', '/api/company/team/invite'],
          ['POST', '/api/company/transfer-ownership'],
        ],
      },
    ];

    for (const tc of testCases) {
      describe(`${tc.role}`, () => {
        beforeEach(() => {
          db._mockUserRoles.set(tc.userId, new Set([tc.role]));
        });

        for (const [method, path] of tc.allowed) {
          it(`allows ${method} ${path}`, async () => {
            const token = makeToken(tc.userId, tc.role);
            const res = await request(app)[method.toLowerCase()](path)
              .set('Authorization', `Bearer ${token}`);
            expect(res.status).not.toBe(403);
            expect(res.status).not.toBe(401);
          });
        }

        for (const [method, path] of tc.denied) {
          it(`denies ${method} ${path} with 403`, async () => {
            const token = makeToken(tc.userId, tc.role);
            const res = await request(app)[method.toLowerCase()](path)
              .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('PERMISSION_DENIED');
          });
        }
      });
    }
  });

  describe('Permission revocation → session invalidation', () => {
    it('blocks previously-allowed access after role is revoked', async () => {
      const userId = 10;
      db._mockUserRoles.set(userId, new Set(['recruiter']));

      const token = makeToken(userId, 'recruiter');

      // First request succeeds
      const res1 = await request(app)
        .post('/api/recruiter/jobs')
        .set('Authorization', `Bearer ${token}`);
      expect(res1.status).not.toBe(403);

      // Revoke role
      db._mockUserRoles.set(userId, new Set(['viewer']));
      invalidateUserCache(userId);

      // Same token now fails
      const res2 = await request(app)
        .post('/api/recruiter/jobs')
        .set('Authorization', `Bearer ${token}`);
      expect(res2.status).toBe(403);
      expect(res2.body.code).toBe('PERMISSION_DENIED');
    });

    it('allows access again after role is re-granted', async () => {
      const userId = 11;
      db._mockUserRoles.set(userId, new Set(['viewer']));
      const token = makeToken(userId, 'viewer');

      // Initially denied
      const res1 = await request(app)
        .post('/api/recruiter/jobs')
        .set('Authorization', `Bearer ${token}`);
      expect(res1.status).toBe(403);

      // Grant recruiter role
      db._mockUserRoles.set(userId, new Set(['recruiter']));
      invalidateUserCache(userId);

      // Now succeeds
      const res2 = await request(app)
        .post('/api/recruiter/jobs')
        .set('Authorization', `Bearer ${token}`);
      expect(res2.status).not.toBe(403);
    });
  });

  describe('Audit logging', () => {
    it('logs permission denials to audit trail', async () => {
      const { AuditLogger } = require('../services/auditLogService');
      const userId = 20;
      db._mockUserRoles.set(userId, new Set(['viewer']));
      const token = makeToken(userId, 'viewer');

      await request(app)
        .post('/api/recruiter/jobs')
        .set('Authorization', `Bearer ${token}`);

      expect(AuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'rbac_permission_denied',
          userId,
          metadata: expect.objectContaining({
            permission: 'jobs:create',
          }),
        }),
      );
    });
  });

  describe('Unauthenticated access', () => {
    it('returns 401 for protected endpoints without token', async () => {
      const res = await request(app).get('/api/recruiter/dashboard');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 for invalid tokens', async () => {
      const res = await request(app)
        .get('/api/recruiter/dashboard')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
    });
  });
});
