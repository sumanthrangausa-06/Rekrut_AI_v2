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
	RETENTION_PURGE: 'retention_purge', // S-077 (#760): system purge audit entries
	INTERVIEW_EVENT: 'interview_event', // #1961: panel-labelling audit rows (migration 300 widens the DB CHECK)
});

const GENESIS_HASH = '0';

// ─── Hash chain helpers (compliance audit trail) ────────────────────────────

// #1342: canonical payload serialisation for the hash chain.
//
// The payload lives in a JSONB column, which does NOT preserve JS key
// order: Postgres emits object keys ordered by (UTF-8 byte length, then
// bytewise), recursively. The pre-fix writer hashed JSON.stringify of
// the pre-DB object (caller insertion order) while verifyChain
// recomputed over the jsonb-normalised object, so any payload whose
// insertion order differed from jsonb order could never verify. Both
// sides now hash this canonical form, which is exactly what jsonb
// storage preserves — rows that verified before this change keep the
// same hash inputs. Postgres coupling is deliberate (the payload is
// already jsonb); a storage-independent canonical form (e.g. RFC 8785)
// would invalidate rows that verify today and belongs in a versioned
// chain cutover, not this fix.
//
// Built manually, never by rebuilding a sorted object and calling
// JSON.stringify on it: V8 enumerates integer-like keys numerically
// regardless of insertion order, which would corrupt the canonical
// order. Primitives delegate to JSON.stringify (escaping, 1e21, -0,
// NaN/Infinity all match); undefined/function/symbol values are
// dropped in objects and become null in arrays, as JSON.stringify does.
function canonicalJsonbStringify(value) {
	return serializeCanonical(value, new Set(), false);
}

// `toJSONApplied` preserves JSON.stringify's call-once semantics: a
// toJSON() RESULT is canonicalised, but its own toJSON (if any) is not
// invoked a second time at the same position. `ancestors` gives
// circular payloads JSON.stringify's TypeError instead of a stack
// overflow; shared (non-circular) references serialise normally.
function serializeCanonical(value, ancestors, toJSONApplied) {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (ancestors.has(value)) {
		throw new TypeError('Converting circular structure to JSON');
	}
	if (!toJSONApplied && typeof value.toJSON === 'function') {
		// e.g. a Date on the writer side (jsonb stores its ISO string),
		// or a Buffer / custom toJSON returning an object — the result
		// must be canonicalised, not stringified in insertion order.
		const result = value.toJSON();
		if (result !== value) {
			// The originator stays on the ancestor stack while its
			// result serialises, so a result that (transitively)
			// references the originator is circular, as in JSON.stringify.
			ancestors.add(value);
			try {
				return serializeCanonical(result, ancestors, true);
			} finally {
				ancestors.delete(value);
			}
		}
		// Self-returning toJSON: JSON.stringify proceeds to serialise
		// the object itself — fall through to the object/array branch
		// below (toJSON is not invoked again at this position).
	}
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			// Array order is committed data — never sorted. Iterate by
			// index: holes read as undefined and become null, exactly
			// as JSON.stringify and jsonb ingest treat them (.map
			// would skip holes and emit empty fields).
			const items = [];
			for (let i = 0; i < value.length; i++) {
				const s = serializeCanonical(value[i], ancestors, false);
				items.push(s === undefined ? 'null' : s);
			}
			return `[${items.join(',')}]`;
		}
		const keys = Object.keys(value).sort((a, b) => {
			const ba = Buffer.from(a, 'utf8');
			const bb = Buffer.from(b, 'utf8');
			return ba.length - bb.length || Buffer.compare(ba, bb);
		});
		const parts = [];
		for (const key of keys) {
			const s = serializeCanonical(value[key], ancestors, false);
			if (s === undefined) continue;
			parts.push(`${JSON.stringify(key)}:${s}`);
		}
		return `{${parts.join(',')}}`;
	} finally {
		ancestors.delete(value);
	}
}

function computeHash(previousHash, eventType, entityId, actorId, payload, createdAt) {
	const data = `${previousHash}|${eventType}|${entityId}|${actorId || ''}|${canonicalJsonbStringify(payload)}|${createdAt}`;
	return crypto.createHash('sha256').update(data).digest('hex');
}

// #1988: chain head read on a given queryable (logEvent's transaction
// client, under the chain lock). Ordering aligned with writePanelAudit
// and the erasure drain fold (created_at DESC, id DESC): id is a random
// UUID, so the secondary key is a deterministic-but-arbitrary tie-break,
// NOT insertion order — the monotonic guard in logEvent is what actually
// prevents this writer from creating a same-millisecond tie.
async function getChainHead(queryable) {
	const result = await queryable.query(
		`SELECT current_hash, created_at FROM compliance_audit_trail ORDER BY created_at DESC, id DESC LIMIT 1`,
	);
	return result.rows.length > 0 ? result.rows[0] : null;
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

	// #1988 — hash-chain serialisation, mirroring writePanelAudit's Pool
	// branch (lib/panelLabelling.js, #1961). The append is read-last-hash
	// → compute → INSERT; without a lock, two concurrent appends read
	// the SAME predecessor and fork the chain. logEvent has only the
	// global pool (no caller-passed queryable, signature unchanged), and
	// a Pool has no transaction: check out a client and wrap read+insert
	// in BEGIN/COMMIT so the advisory xact lock spans both statements
	// (on the bare pool it would release at statement end and protect
	// nothing). Same lock key as the panel writer, so logEvent and
	// panel appends serialise against each other.
	//
	// The chain lock is a LEAF lock here (security review, #1988): it is
	// taken last, nothing is acquired after it, and it is held only to
	// COMMIT. Call-site audit: no logEvent caller holds any advisory
	// lock when calling logEvent, and the only other chain-lock holders
	// (writePanelAudit's callers) never call logEvent. A caller holding
	// 'compliance-audit-chain' on ANOTHER connection must never call
	// logEvent — Postgres cannot detect that cross-connection
	// self-deadlock; the 2s lock_timeout below is its bound, and it
	// fails this write closed rather than queueing on pooled clients.
	//
	// Pre-existing, unchanged: logEvent was never inside a caller's
	// transaction (global pool, autocommit) and still is not — this row
	// can commit even if a caller's business transaction later rolls
	// back. RESIDUAL: the erasure drain fold in lib/erasureService.js
	// is a third writer of this table that takes no chain lock (it must
	// append on its own transaction client; tracked in #1989) — this
	// fix serialises logEvent and panel writers only.
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		// SET LOCAL is transaction-scoped: it cannot leak lock_timeout
		// to the next borrower of this pooled client.
		await client.query(`SET LOCAL lock_timeout = '2s'`);
		await client.query(`SELECT pg_advisory_xact_lock(hashtext('compliance-audit-chain'))`);

		const head = await getChainHead(client);
		const previousHash = head?.current_hash || GENESIS_HASH;

		// Monotonic guard (security review, #1988): created_at carries
		// only JS-millisecond precision and the row id is a random UUID,
		// so no column can order a same-millisecond tie by insertion.
		// Under the lock, never create one: this row's timestamp is
		// strictly after its predecessor's. The bumped value is exactly
		// what is hashed and stored — the hash formula and its inputs'
		// shape are unchanged, so existing rows keep verifying.
		let createdAtMs = Date.now();
		if (head?.created_at) {
			const headMs = new Date(head.created_at).getTime();
			if (Number.isFinite(headMs) && createdAtMs <= headMs) {
				createdAtMs = headMs + 1;
			}
		}
		const createdAt = new Date(createdAtMs).toISOString();
		const currentHash = computeHash(
			previousHash,
			eventType,
			entityId,
			actorId,
			enrichedPayload,
			createdAt,
		);

		const result = await client.query(
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

		await client.query('COMMIT');
		client.release();
		// Returned only after COMMIT succeeds: a row whose commit failed
		// is not durable and is never handed back as if it were.
		return result.rows[0];
	} catch (err) {
		// ROLLBACK, then rethrow the ORIGINAL error (never swallowed,
		// never replaced). If rollback itself fails the client may hold
		// an open transaction and the xact lock: destroy it via
		// release(err) instead of returning it to the pool.
		try {
			await client.query('ROLLBACK');
			client.release();
		} catch (_rollbackErr) {
			client.release(err);
		}
		throw err;
	}
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
	const { limit = 500, offset = 0, companyId } = options;

	// #920 (Sumanth ruling): when a companyId is provided, BOTH the count
	// and the rows query scope to that company's events only. When it is
	// absent, the queries below are byte-identical to the pre-#920 shape
	// (candidate-self and admin callers keep the unscoped view).
	if (companyId !== undefined && companyId !== null) {
		const countResult = await pool.query(
			`SELECT COUNT(*) as total FROM compliance_audit_trail
     WHERE entity_type = $1 AND entity_id = $2 AND company_id = $3`,
			[ENTITY_TYPES.CANDIDATE, candidateId, companyId],
		);
		const total = parseInt(countResult.rows[0].total, 10);

		const result = await pool.query(
			`SELECT * FROM compliance_audit_trail
     WHERE entity_type = $1 AND entity_id = $2 AND company_id = $3
     ORDER BY created_at ASC
     LIMIT $4 OFFSET $5`,
			[ENTITY_TYPES.CANDIDATE, candidateId, companyId, limit, offset],
		);

		return { rows: result.rows, total };
	}

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

// #1988: order rows by hash linkage — the chain's true order. Rows are
// fetched in a deterministic fallback order (created_at ASC, id ASC);
// the walk then follows previous_hash → current_hash from genesis.
// Timestamp order alone cannot order same-millisecond rows (JS-ms
// created_at, random-UUID ids), which made verifyChain able to report
// a valid tied chain as broken depending on Postgres's tie order.
// Rows the walk cannot reach (orphans, fork branches, cycles) keep
// their fallback order after the walked chain, where the linkage
// checks below flag them.
function orderByHashLinkage(fetchedRows) {
	const childrenByPrevious = new Map();
	for (const row of fetchedRows) {
		const siblings = childrenByPrevious.get(row.previous_hash) || [];
		siblings.push(row);
		childrenByPrevious.set(row.previous_hash, siblings);
	}
	const ordered = [];
	const seen = new Set();
	let previousHash = GENESIS_HASH;
	for (;;) {
		const next = (childrenByPrevious.get(previousHash) || []).find((r) => !seen.has(r.id));
		if (!next) break;
		ordered.push(next);
		seen.add(next.id);
		previousHash = next.current_hash;
	}
	for (const row of fetchedRows) {
		if (!seen.has(row.id)) ordered.push(row);
	}
	return ordered;
}

async function verifyChain(companyId = null) {
	let query;
	let params = [];

	if (companyId !== undefined && companyId !== null) {
		query = `SELECT * FROM compliance_audit_trail WHERE company_id = $1 ORDER BY created_at ASC, id ASC`;
		params = [companyId];
	} else {
		query = `SELECT * FROM compliance_audit_trail ORDER BY created_at ASC, id ASC`;
	}

	const result = await pool.query(query, params);
	// Unscoped verification walks the hash linkage (orderByHashLinkage).
	// Scoped verification reads a NON-contiguous subset of the chain, so
	// linkage cannot order or prove it: it keeps the deterministic
	// timestamp fallback and, as before, recomputes hashes / checks
	// adjacency within the subset only — it does not prove global
	// contiguity (pre-existing semantics, labelled per #1988 review).
	const rows =
		companyId !== undefined && companyId !== null ? result.rows : orderByHashLinkage(result.rows);

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
