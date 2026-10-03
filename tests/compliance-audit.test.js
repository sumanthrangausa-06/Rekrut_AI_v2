/**
 * @jest-environment node
 */

const crypto = require('node:crypto');
const auditLogService = require('../services/auditLogService');

// In-memory store for compliance audit trail records (shared with mock)
const memoryStore = [];

jest.mock('../lib/db', () => {
	const { randomUUID } = require('node:crypto');
	let insertCounter = 0;

	const mockQuery = jest.fn(async (sql, params) => {
		const normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();

		// compliance_audit_trail INSERT
		if (normalized.includes('insert into compliance_audit_trail') && normalized.includes('returning')) {
			insertCounter++;
			const record = {
				id: randomUUID(),
				event_type: params[0],
				entity_type: params[1],
				entity_id: params[2],
				actor_id: params[3],
				actor_role: params[4],
				job_id: params[5],
				company_id: params[6],
				payload: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7],
				previous_hash: params[8],
				current_hash: params[9],
				created_at: params[10],
				_insert_order: insertCounter,
			};
			memoryStore.push(record);
			return { rows: [record], rowCount: 1 };
		}

		// compliance_audit_trail SELECT last hash
		if (
			normalized.includes('select current_hash from compliance_audit_trail') &&
			normalized.includes('order by created_at desc')
		) {
			if (memoryStore.length === 0) return { rows: [], rowCount: 0 };
			const last = [...memoryStore].sort((a, b) => {
				const d = new Date(b.created_at) - new Date(a.created_at);
				return d !== 0 ? d : b._insert_order - a._insert_order;
			})[0];
			return { rows: [{ current_hash: last.current_hash }], rowCount: 1 };
		}

		// compliance_audit_trail COUNT
		if (normalized.includes('select count(*) as total from compliance_audit_trail')) {
			let filtered = memoryStore;
			if (normalized.includes('where entity_type =') && normalized.includes('and entity_id =')) {
				const etIdx = params.findIndex((p) => p === 'candidate' || p === 'job' || p === 'company' || p === 'user');
				const eidIdx = etIdx >= 0 ? etIdx + 1 : -1;
				if (etIdx >= 0 && eidIdx >= 0 && eidIdx < params.length) {
					filtered = filtered.filter(
						(r) => r.entity_type === params[etIdx] && r.entity_id === params[eidIdx],
					);
				}
			} else if (normalized.includes('where actor_id =')) {
				const actorIdx = params.findIndex((p) => typeof p === 'number');
				if (actorIdx >= 0) {
					filtered = filtered.filter((r) => r.actor_id === params[actorIdx]);
				}
			}
			return { rows: [{ total: String(filtered.length) }], rowCount: 1 };
		}

		// compliance_audit_trail SELECT all with optional WHERE and ORDER BY
		if (normalized.includes('select * from compliance_audit_trail')) {
			let filtered = [...memoryStore];

			// Handle WHERE entity_type = $1 AND entity_id = $2
			if (normalized.includes('where entity_type =') && normalized.includes('and entity_id =')) {
				const etIdx = params.findIndex((p) => p === 'candidate' || p === 'job' || p === 'company' || p === 'user');
				const eidIdx = etIdx >= 0 ? etIdx + 1 : -1;
				if (etIdx >= 0 && eidIdx >= 0 && eidIdx < params.length) {
					filtered = filtered.filter(
						(r) => r.entity_type === params[etIdx] && r.entity_id === params[eidIdx],
					);
				}
			}

			// Handle WHERE actor_id = $N
			if (normalized.includes('where actor_id =')) {
				const actorIdx = params.findIndex((p) => typeof p === 'number');
				if (actorIdx >= 0) {
					filtered = filtered.filter((r) => r.actor_id === params[actorIdx]);
				}
			}

			// Handle WHERE company_id = $N
			if (normalized.includes('where company_id =')) {
				const companyIdx = params.findIndex((p) => typeof p === 'number');
				if (companyIdx >= 0) {
					filtered = filtered.filter((r) => r.company_id === params[companyIdx]);
				}
			}

			// Sort
			if (normalized.includes('order by created_at asc')) {
				filtered.sort((a, b) => {
					const d = new Date(a.created_at) - new Date(b.created_at);
					return d !== 0 ? d : a._insert_order - b._insert_order;
				});
			} else {
				filtered.sort((a, b) => {
					const d = new Date(b.created_at) - new Date(a.created_at);
					return d !== 0 ? d : b._insert_order - a._insert_order;
				});
			}

			// Apply limit/offset (last two numeric params if they look like limit/offset)
			let limit = filtered.length;
			let offset = 0;
			const numericParams = params.filter((p) => typeof p === 'number');
			if (numericParams.length >= 2) {
				limit = numericParams[numericParams.length - 2];
				offset = numericParams[numericParams.length - 1];
			}
			return { rows: filtered.slice(offset, offset + limit), rowCount: filtered.length };
		}

		// Unknown query
		return { rows: [], rowCount: 0 };
	});

	return {
		query: mockQuery,
		getQueryStats: () => ({ totalQueries: 0, slowQueries: 0, queriesPerMinute: 0 }),
		end: jest.fn().mockResolvedValue(undefined),
		on: jest.fn(),
	};
});

describe('Compliance Audit Trail — Issue #136', () => {
	beforeEach(() => {
		memoryStore.length = 0;
	});

	describe('logEvent', () => {
		it('creates an audit record with a valid hash chain', async () => {
			const record = await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				actorRole: 'recruiter',
				companyId: 5,
				payload: { fit_score: 85, recommendation: 'interview' },
			});

			expect(record).toBeDefined();
			expect(record.id).toBeDefined();
			expect(record.event_type).toBe('ai_decision');
			expect(record.previous_hash).toBe(auditLogService.GENESIS_HASH);
			expect(record.current_hash).toBeDefined();
			expect(record.current_hash).not.toBe(record.previous_hash);
		});

		it('chains the second record to the first', async () => {
			const first = await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { fit_score: 85 },
			});

			const second = await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.HUMAN_OVERRIDE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 11,
				companyId: 5,
				payload: { decision: 'reject', reason: 'Missing required skills' },
			});

			expect(second.previous_hash).toBe(first.current_hash);
			expect(second.current_hash).not.toBe(second.previous_hash);
		});

		it('rejects invalid event types', async () => {
			await expect(
				auditLogService.logEvent({
					eventType: 'invalid_type',
					entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
					entityId: 1,
				}),
			).rejects.toThrow('Invalid eventType');
		});
	});

	describe('verifyChain', () => {
		it('verifies a valid chain', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { fit_score: 85 },
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { new_status: 'interviewed' },
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.SIGNATURE,
				entityType: auditLogService.ENTITY_TYPES.USER,
				entityId: 10,
				actorId: 10,
				companyId: 5,
				payload: { document_id: 42 },
			});

			const result = await auditLogService.verifyChain();
			expect(result.valid).toBe(true);
			expect(result.checked).toBe(3);
			expect(result.errors).toHaveLength(0);
		});

		it('detects tampering with a record', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { fit_score: 85 },
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { new_status: 'interviewed' },
			});

			// Tamper with the second record's payload
			memoryStore[1].payload = { new_status: 'hired' };

			const result = await auditLogService.verifyChain();
			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors.some((e) => e.message.includes('tampered'))).toBe(true);
		});

		it('detects a broken hash chain', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { fit_score: 85 },
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { new_status: 'interviewed' },
			});

			// Break the chain by changing previous_hash
			memoryStore[1].previous_hash = 'tampered_hash';

			const result = await auditLogService.verifyChain();
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.message.includes('chain broken'))).toBe(true);
		});
	});

	describe('getAuditTrail', () => {
		it('queries by candidate id', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: {},
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 2,
				actorId: 10,
				companyId: 5,
				payload: {},
			});

			const result = await auditLogService.getAuditTrail({ candidateId: 1 });
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].entity_id).toBe(1);
		});

		it('queries by recruiter (actor_id)', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: {},
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 20,
				companyId: 5,
				payload: {},
			});

			const result = await auditLogService.getAuditTrail({ recruiterId: 10 });
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].actor_id).toBe(10);
		});
	});

	describe('getCandidateDecisions', () => {
		it('returns all decisions for a candidate', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { fit_score: 85 },
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.HUMAN_OVERRIDE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 11,
				companyId: 5,
				payload: { decision: 'reject' },
			});
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 2,
				actorId: 10,
				companyId: 5,
				payload: { fit_score: 90 },
			});

			const result = await auditLogService.getCandidateDecisions(1);
			expect(result.rows).toHaveLength(2);
			expect(result.total).toBe(2);
		});
	});

	describe('exportForRegulator', () => {
		it('exports JSON report with metadata', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.AI_DECISION,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: { fit_score: 85 },
			});

			const start = new Date(Date.now() - 86400000).toISOString();
			const end = new Date(Date.now() + 86400000).toISOString();
			const report = await auditLogService.exportForRegulator(5, start, end, 'json');

			expect(report.report_metadata).toBeDefined();
			expect(report.report_metadata.company_id).toBe(5);
			expect(report.report_metadata.record_count).toBe(1);
			expect(report.report_metadata.chain_verified).toBe(true);
			expect(report.records).toHaveLength(1);
		});

		it('exports CSV report', async () => {
			await auditLogService.logEvent({
				eventType: auditLogService.EVENT_TYPES.STATUS_CHANGE,
				entityType: auditLogService.ENTITY_TYPES.CANDIDATE,
				entityId: 1,
				actorId: 10,
				companyId: 5,
				payload: {},
			});

			const start = new Date(Date.now() - 86400000).toISOString();
			const end = new Date(Date.now() + 86400000).toISOString();
			const csv = await auditLogService.exportForRegulator(5, start, end, 'csv');

			expect(csv).toContain('event_type');
			expect(csv).toContain('current_hash');
			expect(csv).toContain('status_change');
		});
	});

	describe('append-only behavior', () => {
		it('does not provide update or delete methods', () => {
			expect(auditLogService.updateEvent).toBeUndefined();
			expect(auditLogService.deleteEvent).toBeUndefined();
			expect(typeof auditLogService.logEvent).toBe('function');
		});
	});
});
