/**
 * Compliance Audit Log Service
 * Issue #136 — Tamper-evident audit trail for EU AI Act compliance
 *
 * Properties:
 * - Append-only, no updates or deletes
 * - Tamper-evident via hash chaining (each record contains hash of previous record)
 * - Exportable for regulators (JSON/CSV export)
 * - Queryable by: candidate, job, recruiter, date range
 * - Retained beyond operational data retention window
 *
 * Event types:
 * - ai_decision: AI scoring decisions (inputs, outputs, model version)
 * - human_override: Human override of AI decision, with reason
 * - data_access: Access to sensitive candidate data, attributed to user
 * - verification: Background check / document verification outcomes
 * - signature: Document signing events
 * - status_change: Hiring pipeline status changes
 */

const crypto = require('node:crypto');
const pool = require('../lib/db');

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

/**
 * Compute SHA-256 hash of concatenated audit fields.
 * @param {string} previousHash
 * @param {string} eventType
 * @param {number} entityId
 * @param {number|null} actorId
 * @param {Object} payload
 * @param {string} createdAt ISO timestamp
 * @returns {string} hex digest
 */
function computeHash(previousHash, eventType, entityId, actorId, payload, createdAt) {
	const data = `${previousHash}|${eventType}|${entityId}|${actorId || ''}|${JSON.stringify(payload)}|${createdAt}`;
	return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Get the most recent audit record globally to obtain the last hash.
 * @returns {Promise<string|null>} current_hash of last record, or null
 */
async function getLastHash() {
	const result = await pool.query(
		`SELECT current_hash FROM compliance_audit_trail ORDER BY created_at DESC LIMIT 1`
	);
	return result.rows.length > 0 ? result.rows[0].current_hash : null;
}

/**
 * Log an event to the compliance audit trail.
 * Append-only insert with automatic hash chain computation.
 *
 * @param {Object} eventData
 * @param {string} eventData.eventType — one of EVENT_TYPES
 * @param {string} eventData.entityType — one of ENTITY_TYPES
 * @param {number} eventData.entityId
 * @param {number|null} [eventData.actorId]
 * @param {string|null} [eventData.actorRole]
 * @param {number|null} [eventData.jobId]
 * @param {number|null} [eventData.companyId]
 * @param {Object} [eventData.payload] — contextual data (inputs, outputs, model version, reason, etc.)
 * @param {Object} [eventData.req] — Express request for IP/user-agent extraction
 * @returns {Promise<Object>} the inserted record
 */
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

	// Validate event type
	if (!Object.values(EVENT_TYPES).includes(eventType)) {
		throw new Error(`Invalid eventType: ${eventType}`);
	}
	if (!Object.values(ENTITY_TYPES).includes(entityType)) {
		throw new Error(`Invalid entityType: ${entityType}`);
	}

	// Enrich payload with request context if available
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

/**
 * Query the audit trail with filters.
 *
 * @param {Object} filters
 * @param {number|null} [filters.candidateId] — entity_id where entity_type='candidate'
 * @param {number|null} [filters.jobId]
 * @param {number|null} [filters.recruiterId] — actor_id
 * @param {string|null} [filters.startDate] — ISO date string
 * @param {string|null} [filters.endDate] — ISO date string
 * @param {string|null} [filters.eventType]
 * @param {number|null} [filters.companyId]
 * @param {number} [filters.limit=100]
 * @param {number} [filters.offset=0]
 * @returns {Promise<Object>} { rows, total }
 */
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

/**
 * Get the full record of AI decisions and consequential actions about a candidate.
 * For GDPR / right-to-explanation requests.
 *
 * @param {number} candidateId
 * @param {Object} [options]
 * @param {number} [options.limit=500]
 * @param {number} [options.offset=0]
 * @returns {Promise<Object>} { rows, total }
 */
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

/**
 * Verify the integrity of the hash chain.
 * Checks that every record's previous_hash matches the previous record's current_hash.
 *
 * @param {number|null} [companyId] — if provided, verify only that company's records
 * @returns {Promise<Object>} { valid: boolean, checked: number, errors: Array<{id, expected, actual}> }
 */
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

	// First record must have previous_hash = GENESIS_HASH
	if (rows[0].previous_hash !== GENESIS_HASH) {
		errors.push({
			id: rows[0].id,
			expected: GENESIS_HASH,
			actual: rows[0].previous_hash,
			message: 'First record does not reference genesis hash',
		});
	}

	// Verify each subsequent record's previous_hash matches the prior record's current_hash
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

	// Also verify each record's current_hash recomputes correctly
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

/**
 * Export a regulator-ready JSON report for a date range.
 *
 * @param {number|null} [companyId]
 * @param {string} startDate — ISO date string
 * @param {string} endDate — ISO date string
 * @param {string} [format='json'] — 'json' or 'csv'
 * @returns {Promise<Object|string>} regulator report object or CSV string
 */
async function exportForRegulator(companyId, startDate, endDate, format = 'json') {
	let query;
	let params = [startDate, endDate];

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

	// JSON report with metadata
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

module.exports = {
	EVENT_TYPES,
	ENTITY_TYPES,
	GENESIS_HASH,
	logEvent,
	getAuditTrail,
	getCandidateDecisions,
	verifyChain,
	exportForRegulator,
	computeHash, // exported for tests
};
