/**
 * Data Access Audit Middleware
 * Issue #136 — Log every access to sensitive candidate data
 *
 * Usage:
 *   router.get('/candidates/:id', authMiddleware, dataAccessAudit('candidate_profile'), handler)
 *
 * Logs a data_access event after successful (2xx) responses only.
 */

const auditLogService = require('../services/auditLogService');

/**
 * Factory: create middleware that logs data access for a given resource type.
 * @param {string} resourceType — e.g. 'candidate_profile', 'verification_status', 'screening_result'
 * @param {Function} [getEntityId] — (req) => entityId; defaults to req.params.id or req.params.candidateId
 * @returns {Function} Express middleware
 */
function dataAccessAudit(resourceType, getEntityId) {
	return (req, res, next) => {
		const originalEnd = res.end.bind(res);

		res.end = async function (...args) {
			originalEnd(...args);

			// Only log successful accesses
			if (res.statusCode >= 200 && res.statusCode < 300) {
				try {
					const entityId = getEntityId
						? getEntityId(req)
						: parseInt(req.params.id || req.params.candidateId || req.params.candidate_id, 10);

					if (!entityId || !req.user) return;

					await auditLogService.logEvent({
						eventType: auditLogService.EVENT_TYPES.DATA_ACCESS,
						entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
						entityId,
						actorId: req.user.id,
						actorRole: req.user.role,
						companyId: req.user.company_id || null,
						payload: {
							resource_type: resourceType,
							path: req.path,
							method: req.method,
						},
						req,
					});
				} catch (e) {
					console.error('[dataAccessAudit] Failed to log (non-blocking):', e.message);
				}
			}
		};

		next();
	};
}

module.exports = { dataAccessAudit };
