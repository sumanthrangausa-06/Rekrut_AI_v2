/**
 * Audit Log Service
 * Merged from auditLogger.js + auditLogService.js (Issue #174)
 *
 * Provides:
 * - General audit logging (AuditLogger class) → audit_logs table
 * - Compliance audit trail (logEvent) → compliance_audit_trail table
 * - Hash-chain verification for tamper evidence
 * - Export for regulators
 * - Express middleware for automatic audit logging
 */

const crypto = require('node:crypto');
const pool = require('../lib/db');

// ─── Constants ──────────────────────────────────────────────────────────────

const EVENT_TYPES = Object.freeze({
	AI_DECISION: 'ai_decision',
	HUMAN_OVERRIDE: 'human_override',
	DATA_ACCESS: 'data_access',
	VERIFICATION: 'verification',
	SIGNATURE: 'signature',
	STATUS_CHANGE: 'status_change',
});

const ENTITY_TYPES = Object.freeze({
	CANDIDATE: 'candidate',
	JOB: 'job',
	COMPANY: 'company',
	USER: 'user',
});

const GENESIS_HASH = '0';

// ─── Hash chain helpers (compliance audit trail) ────────────────────────────

function computeHash(previousHash, eventType, entityId, actorId, payload, createdAt) {
	const data = `${previousHash}|${eventType}|${entityId}|${actorId || ''}|${JSON.stringify(payload)}|${createdAt}`;
	return crypto.createHash('sha256').update(data).digest('hex');
}

async function getLastHash() {
	const result = await pool.query(
		`SELECT current_hash FROM compliance_audit_trail ORDER BY created_at DESC LIMIT 1`,
	);
	return result.rows.length > 0 ? result.rows[0].current_hash : null;
}

// ─── Compliance audit trail ─────────────────────────────────────────────────

async function logEvent(eventData) {
	const {
		eventType,
		entityType,
		entityId,
		actorId = null,
		actorRole = null,
		jobId = null,
		companyId = null,
		payload = {},
		req = null,
	} = eventData;

	if (!Object.values(EVENT_TYPES).includes(eventType)) {
		throw new Error(`Invalid eventType: ${eventType}`);
	}
	if (!Object.values(ENTITY_TYPES).includes(entityType)) {
		throw new Error(`Invalid entityType: ${entityType}`);
	}

	const enrichedPayload = { ...payload };
	if (req) {
		enrichedPayload._request = {
			ip: req.ip || req.connection?.remoteAddress || null,
			userAgent: req.get('user-agent') || null,
			path: req.path || null,
			method: req.method || null,
		};
	}

	const createdAt = new Date().toISOString();
	const previousHash = (await getLastHash()) || GENESIS_HASH;
	const currentHash = computeHash(
		previousHash,
		eventType,
		entityId,
		actorId,
		enrichedPayload,
		createdAt,
	);

	const result = await pool.query(
		`INSERT INTO compliance_audit_trail
       (event_type, entity_type, entity_id, actor_id, actor_role, job_id, company_id, payload, previous_hash, current_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
		[
			eventType,
			entityType,
			entityId,
			actorId,
			actorRole,
			jobId,
			companyId,
			JSON.stringify(enrichedPayload),
			previousHash,
			currentHash,
			createdAt,
		],
	);

	return result.rows[0];
}

async function getAuditTrail(filters = {}) {
	const {
		candidateId,
		jobId,
		recruiterId,
		startDate,
		endDate,
		eventType,
		companyId,
		limit = 100,
		offset = 0,
	} = filters;

	const conditions = [];
	const params = [];
	let idx = 1;

	if (candidateId !== undefined && candidateId !== null) {
		conditions.push(`entity_type = $${idx++} AND entity_id = $${idx++}`);
		params.push(ENTITY_TYPES.CANDIDATE, candidateId);
	}
	if (jobId !== undefined && jobId !== null) {
		conditions.push(`job_id = $${idx++}`);
		params.push(jobId);
	}
	if (recruiterId !== undefined && recruiterId !== null) {
		conditions.push(`actor_id = $${idx++}`);
		params.push(recruiterId);
	}
	if (startDate) {
		conditions.push(`created_at >= $${idx++}`);
		params.push(startDate);
	}
	if (endDate) {
		conditions.push(`created_at <= $${idx++}`);
		params.push(endDate);
	}
	if (eventType) {
		conditions.push(`event_type = $${idx++}`);
		params.push(eventType);
	}
	if (companyId !== undefined && companyId !== null) {
		conditions.push(`company_id = $${idx++}`);
		params.push(companyId);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	const countResult = await pool.query(
		`SELECT COUNT(*) as total FROM compliance_audit_trail ${whereClause}`,
		params,
	);
	const total = parseInt(countResult.rows[0].total, 10);

	params.push(limit, offset);
	const dataResult = await pool.query(
		`SELECT * FROM compliance_audit_trail
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
		params,
	);

	return { rows: dataResult.rows, total };
}

async function getCandidateDecisions(candidateId, options = {}) {
	const { limit = 500, offset = 0 } = options;

	const countResult = await pool.query(
		`SELECT COUNT(*) as total FROM compliance_audit_trail
     WHERE entity_type = $1 AND entity_id = $2`,
		[ENTITY_TYPES.CANDIDATE, candidateId],
	);
	const total = parseInt(countResult.rows[0].total, 10);

	const result = await pool.query(
		`SELECT * FROM compliance_audit_trail
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at ASC
     LIMIT $3 OFFSET $4`,
		[ENTITY_TYPES.CANDIDATE, candidateId, limit, offset],
	);

	return { rows: result.rows, total };
}

async function verifyChain(companyId = null) {
	let query;
	let params = [];

	if (companyId !== undefined && companyId !== null) {
		query = `SELECT * FROM compliance_audit_trail WHERE company_id = $1 ORDER BY created_at ASC`;
		params = [companyId];
	} else {
		query = `SELECT * FROM compliance_audit_trail ORDER BY created_at ASC`;
	}

	const result = await pool.query(query, params);
	const rows = result.rows;

	if (rows.length === 0) {
		return { valid: true, checked: 0, errors: [] };
	}

	const errors = [];

	if (rows[0].previous_hash !== GENESIS_HASH) {
		errors.push({
			id: rows[0].id,
			expected: GENESIS_HASH,
			actual: rows[0].previous_hash,
			message: 'First record does not reference genesis hash',
		});
	}

	for (let i = 1; i < rows.length; i++) {
		const prev = rows[i - 1];
		const curr = rows[i];
		if (curr.previous_hash !== prev.current_hash) {
			errors.push({
				id: curr.id,
				expected: prev.current_hash,
				actual: curr.previous_hash,
				message: `Hash chain broken between ${prev.id} and ${curr.id}`,
			});
		}
	}

	for (const row of rows) {
		const recomputed = computeHash(
			row.previous_hash,
			row.event_type,
			row.entity_id,
			row.actor_id,
			row.payload,
			new Date(row.created_at).toISOString(),
		);
		if (recomputed !== row.current_hash) {
			errors.push({
				id: row.id,
				expected: recomputed,
				actual: row.current_hash,
				message: 'Current hash does not match recomputed value (data tampered)',
			});
		}
	}

	return {
		valid: errors.length === 0,
		checked: rows.length,
		errors,
	};
}

async function exportForRegulator(companyId, startDate, endDate, format = 'json') {
	let query;
	const params = [startDate, endDate];

	if (companyId !== undefined && companyId !== null) {
		query = `SELECT * FROM compliance_audit_trail
           WHERE company_id = $3 AND created_at >= $1 AND created_at <= $2
           ORDER BY created_at ASC`;
		params.push(companyId);
	} else {
		query = `SELECT * FROM compliance_audit_trail
           WHERE created_at >= $1 AND created_at <= $2
           ORDER BY created_at ASC`;
	}

	const result = await pool.query(query, params);
	const rows = result.rows;

	if (format === 'csv') {
		const headers = [
			'id',
			'event_type',
			'entity_type',
			'entity_id',
			'actor_id',
			'actor_role',
			'job_id',
			'company_id',
			'payload',
			'previous_hash',
			'current_hash',
			'created_at',
		];
		const csvRows = rows.map((row) =>
			headers
				.map((h) => {
					const val = row[h];
					if (val === null || val === undefined) return '';
					if (typeof val === 'object') return JSON.stringify(val).replace(/"/g, '""');
					return String(val).replace(/"/g, '""');
				})
				.map((v) => `"${v}"`)
				.join(','),
		);
		return `${headers.join(',')}\n${csvRows.join('\n')}`;
	}

	return {
		report_metadata: {
			generated_at: new Date().toISOString(),
			company_id: companyId || null,
			date_range: { start: startDate, end: endDate },
			record_count: rows.length,
			chain_verified: (await verifyChain(companyId)).valid,
		},
		records: rows,
	};
}

// ─── General audit logger (audit_logs table) ────────────────────────────────

// biome-ignore lint/complexity/noStaticOnlyClass: Preserving existing AuditLogger API to avoid changing 28+ call sites
class AuditLogger {
	static async log({ actionType, userId, targetType, targetId, metadata = {}, req = null }) {
		try {
			const ipAddress = req ? req.ip || req.connection?.remoteAddress : null;
			const userAgent = req ? req.get('user-agent') : null;

			await pool.query(
				`INSERT INTO audit_logs (action_type, user_id, target_type, target_id, metadata, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[actionType, userId, targetType, targetId, JSON.stringify(metadata), ipAddress, userAgent],
			);
		} catch (error) {
			console.error('Audit log failed:', error);
			// Don't throw - audit logging should not break core functionality
		}
	}

	static async query({
		userId,
		actionType,
		targetType,
		startDate,
		endDate,
		limit = 100,
		offset = 0,
	}) {
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

	static async exportLogs({ startDate, endDate, format = 'json' }) {
		const result = await pool.query(
			`SELECT * FROM audit_logs
       WHERE created_at >= $1 AND created_at <= $2
       ORDER BY created_at ASC`,
			[startDate, endDate],
		);

		if (format === 'csv') {
			const headers = Object.keys(result.rows[0] || {}).join(',');
			const rows = result.rows
				.map((row) =>
					Object.values(row)
						.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v))
						.join(','),
				)
				.join('\n');
			return `${headers}\n${rows}`;
		}

		return result.rows;
	}
}

// ─── Middleware for automatic audit logging ─────────────────────────────────

function auditMiddleware(actionType, getMetadata = () => ({})) {
	return async (req, res, next) => {
		const originalJson = res.json.bind(res);

		res.json = (data) => {
			if (res.statusCode < 400) {
				AuditLogger.log({
					actionType,
					userId: req.session?.userId || req.user?.id,
					targetType: req.params?.type,
					targetId: req.params?.id || data?.id,
					metadata: getMetadata(req, res, data),
					req,
				});
			}
			return originalJson(data);
		};

		next();
	};
}

module.exports = {
	// Compliance audit trail exports
	EVENT_TYPES,
	ENTITY_TYPES,
	GENESIS_HASH,
	logEvent,
	getAuditTrail,
	getCandidateDecisions,
	verifyChain,
	exportForRegulator,
	computeHash,
	// General audit logger exports
	AuditLogger,
	auditMiddleware,
};
