const pool = require('../lib/db');

/**
 * Audit Logger Service
 * Tracks all AI decisions, recruiter actions, and compliance-relevant events
 */
class AuditLogger {
  /**
   * Log an action to the audit trail
   * @param {Object} params
   * @param {string} params.actionType - Type of action (e.g., 'omniscore_calculated', 'candidate_rejected')
   * @param {number} params.userId - User who performed the action
   * @param {string} params.targetType - Type of target entity (e.g., 'candidate', 'job')
   * @param {number} params.targetId - ID of target entity
   * @param {Object} params.metadata - Additional context data
   * @param {Object} params.req - Express request object for IP/user agent
   */
  static async log({ actionType, userId, targetType, targetId, metadata = {}, req = null }) {
    try {
      const ipAddress = req ? (req.ip || req.connection?.remoteAddress) : null;
      const userAgent = req ? req.get('user-agent') : null;

      await pool.query(
        `INSERT INTO audit_logs (action_type, user_id, target_type, target_id, metadata, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [actionType, userId, targetType, targetId, JSON.stringify(metadata), ipAddress, userAgent]
      );
    } catch (error) {
      console.error('Audit log failed:', error);
      // Don't throw - audit logging should not break core functionality
    }
  }

  /**
   * Query audit logs with filters
   */
  static async query({ userId, actionType, targetType, startDate, endDate, limit = 100, offset = 0 }) {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND user_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (actionType) {
      query += ` AND action_type = $${paramIndex++}`;
      params.push(actionType);
    }

    if (targetType) {
      query += ` AND target_type = $${paramIndex++}`;
      params.push(targetType);
    }

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Export audit logs for compliance reporting
   */
  static async exportLogs({ startDate, endDate, format = 'json' }) {
    const result = await pool.query(
      `SELECT * FROM audit_logs
       WHERE created_at >= $1 AND created_at <= $2
       ORDER BY created_at ASC`,
      [startDate, endDate]
    );

    if (format === 'csv') {
      // Convert to CSV format
      const headers = Object.keys(result.rows[0] || {}).join(',');
      const rows = result.rows.map(row =>
        Object.values(row).map(v =>
          typeof v === 'object' ? JSON.stringify(v) : v
        ).join(',')
      ).join('\n');
      return `${headers}\n${rows}`;
    }

    return result.rows;
  }
}

// Middleware for automatic audit logging
function auditMiddleware(actionType, getMetadata = () => ({})) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function(data) {
      // Log after successful response
      if (res.statusCode < 400) {
        AuditLogger.log({
          actionType,
          userId: req.session?.userId || req.user?.id,
          targetType: req.params?.type,
          targetId: req.params?.id || data?.id,
          metadata: getMetadata(req, res, data),
          req
        });
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = { AuditLogger, auditMiddleware };
