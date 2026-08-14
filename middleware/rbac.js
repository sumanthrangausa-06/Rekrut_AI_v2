/**
 * RBAC Middleware - Permission-based access control
 * GitHub Issue #138
 *
 * Provides:
 *   - requirePermission(permissionName)  -> Express middleware factory
 *   - requireRole(roleName)              -> Express middleware factory
 *   - checkPermission(userId, permissionName, companyId) -> async helper
 *   - invalidateUserCache(userId)        -> cache invalidation
 *
 * Caches user permissions in-memory with a 5-minute TTL.
 * Logs every permission denial to the audit trail.
 */

let _pool = null;
function getPool() {
	if (!_pool) {
		_pool = require('../lib/db');
	}
	return _pool;
}

// Lazy-load AuditLogger to avoid circular-dependency issues at startup
let _AuditLogger = null;
function getAuditLogger() {
	if (!_AuditLogger) {
		try {
			const { AuditLogger } = require('../services/auditLogger');
			_AuditLogger = AuditLogger;
		} catch {
			_AuditLogger = null;
		}
	}
	return _AuditLogger;
}

// In-memory permission cache
// Map<userId, { permissions: Set<string>, roles: Set<string>, expiresAt: number }>
const _permissionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build the permission set for a user (optionally scoped to a company).
 * Queries the database directly - use checkPermission() for cached access.
 */
async function _fetchUserPermissions(userId, companyId) {
	const params = [userId];
	let companyFilter = '';

	if (companyId) {
		params.push(companyId);
		companyFilter = 'AND ur.company_id = $2';
	}

	// Permissions via assigned roles
	const permResult = await getPool().query(
		`SELECT DISTINCT p.name
		 FROM user_roles ur
		 JOIN role_permissions rp ON ur.role_id = rp.role_id
		 JOIN permissions p ON rp.permission_id = p.id
		 WHERE ur.user_id = $1 ${companyFilter}`,
		params,
	);

	// Roles the user holds
	const roleResult = await getPool().query(
		`SELECT DISTINCT r.name
		 FROM user_roles ur
		 JOIN roles r ON ur.role_id = r.id
		 WHERE ur.user_id = $1 ${companyFilter}`,
		params,
	);

	return {
		permissions: new Set(permResult.rows.map((r) => r.name)),
		roles: new Set(roleResult.rows.map((r) => r.name)),
	};
}

/**
 * Invalidate the permission cache for a user.
 * Call this whenever a user's roles are assigned, revoked, or modified.
 */
function invalidateUserCache(userId) {
	const uid = String(userId);
	for (const key of _permissionCache.keys()) {
		if (key.startsWith(`${uid}:`)) {
			_permissionCache.delete(key);
		}
	}
}

/**
 * Check whether a user has a specific permission.
 * Respects company scoping when companyId is provided.
 * Falls back to global (non-company-scoped) roles when companyId is omitted.
 *
 * @param {number} userId
 * @param {string} permissionName
 * @param {number|null} companyId
 * @returns {Promise<boolean>}
 */
async function checkPermission(userId, permissionName, companyId) {
	const cacheKey = companyId ? `${userId}:${companyId}` : `${userId}:global`;
	const now = Date.now();

	let cached = _permissionCache.get(cacheKey);
	if (!cached || cached.expiresAt < now) {
		const data = await _fetchUserPermissions(userId, companyId);
		cached = { permissions: data.permissions, roles: data.roles, expiresAt: now + CACHE_TTL_MS };
		_permissionCache.set(cacheKey, cached);
	}

	return cached.permissions.has(permissionName);
}

/**
 * Check whether a user holds a specific role.
 * Respects company scoping when companyId is provided.
 *
 * @param {number} userId
 * @param {string} roleName
 * @param {number|null} companyId
 * @returns {Promise<boolean>}
 */
async function checkRole(userId, roleName, companyId) {
	const cacheKey = companyId ? `${userId}:${companyId}` : `${userId}:global`;
	const now = Date.now();

	let cached = _permissionCache.get(cacheKey);
	if (!cached || cached.expiresAt < now) {
		const data = await _fetchUserPermissions(userId, companyId);
		cached = { permissions: data.permissions, roles: data.roles, expiresAt: now + CACHE_TTL_MS };
		_permissionCache.set(cacheKey, cached);
	}

	return cached.roles.has(roleName);
}

/**
 * Log a permission-denied event to the audit trail.
 * Fails silently so audit logging never blocks core functionality.
 *
 * @param {Object} params
 * @param {number} params.userId
 * @param {string} [params.permissionName]
 * @param {string} [params.roleName]
 * @param {number|null} [params.companyId]
 * @param {Object} [params.req]
 */
async function _logPermissionDenied(params) {
	const auditLogger = getAuditLogger();
	if (!auditLogger || !auditLogger.log) return;

	try {
		await auditLogger.log({
			actionType: 'rbac_permission_denied',
			userId: params.userId,
			targetType: 'permission',
			targetId: null,
			metadata: {
				permission: params.permissionName || null,
				role: params.roleName || null,
				company_id: params.companyId || null,
				path: params.req?.path || null,
				method: params.req?.method || null,
			},
			req: params.req,
		});
	} catch (err) {
		console.error('[rbac] Audit log failed:', err.message);
	}
}

/**
 * Middleware factory: require a specific permission.
 *
 * @param {string} permissionName
 * @param {Object} [options]
 * @param {boolean} [options.requireCompanyId=false] - if true, req.user.company_id must be present
 * @returns {Function} Express middleware
 */
function requirePermission(permissionName, options) {
	return async (req, res, next) => {
		if (!req.user) {
			return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
		}

		const opts = options || {};
		const companyId = opts.requireCompanyId ? req.user.company_id : req.user.company_id || null;
		const hasPerm = await checkPermission(req.user.id, permissionName, companyId);

		if (!hasPerm) {
			await _logPermissionDenied({
				userId: req.user.id,
				permissionName: permissionName,
				companyId: companyId,
				req: req,
			});
			return res.status(403).json({
				error: `Access denied: '${permissionName}' permission required`,
				code: 'PERMISSION_DENIED',
				permission: permissionName,
			});
		}

		next();
	};
}

/**
 * Middleware factory: require at least one of the specified roles.
 *
 * @param {...string} roleNames
 * @returns {Function} Express middleware
 */
function requireRole() {
	const roleNames = Array.from(arguments);
	return async (req, res, next) => {
		if (!req.user) {
			return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
		}

		const companyId = req.user.company_id || null;
		const checks = roleNames.map((name) => checkRole(req.user.id, name, companyId));
		const hasAnyRole = await Promise.all(checks);

		if (!hasAnyRole.some(Boolean)) {
			await _logPermissionDenied({
				userId: req.user.id,
				roleName: roleNames.join(' | '),
				companyId: companyId,
				req: req,
			});
			return res.status(403).json({
				error: `Access denied: requires one of [${roleNames.join(', ')}]`,
				code: 'ROLE_DENIED',
				requiredRoles: roleNames,
			});
		}

		next();
	};
}

/**
 * Periodic cache cleanup - remove expired entries every 60 seconds.
 * Prevents unbounded growth in long-running processes.
 */
const _cleanupInterval = setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of _permissionCache.entries()) {
		if (entry.expiresAt < now) {
			_permissionCache.delete(key);
		}
	}
}, 60_000);
_cleanupInterval.unref();

module.exports = {
	requirePermission,
	requireRole,
	checkPermission,
	checkRole,
	invalidateUserCache,
};
