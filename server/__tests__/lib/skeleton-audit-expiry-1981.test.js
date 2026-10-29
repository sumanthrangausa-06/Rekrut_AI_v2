/**
 * #1981 — Hold-aware expiry purge for skeleton_event_swept audit rows.
 *
 * STOP 1: issue comment 6505671957. Lex position on #1979 (comment
 * 6504275867): skeleton_event_swept audit rows live 2555 days (7 years)
 * from created_at, then whole-row DELETE; a legal hold pauses the
 * clock; aggregate-count recording only (never a new per-subject row);
 * RETENTION_PURGE_LIVE stays OFF (this builds the path, it does not
 * arm it).
 *
 * Root cause: sweepPanelSkeletonEvents writes these rows with
 * audit_logs.user_id = NULL; linkage lives only in
 * metadata.tombstone_user_id, so heldPredicate('audit_logs.user_id')
 * in EuComplianceService.executePurge can never match a hold for
 * this class — the old purge path is hold-blind for these rows.
 *
 * This file is the mock-pool unit layer (SQL shape + wiring). The
 * real-DB layer is skeleton-audit-expiry-1981.integration.test.js.
 */
jest.mock('../../../lib/db', () => ({
	query: jest.fn(),
	connect: jest.fn(),
}));
jest.mock('../../../services/auditLogService', () => ({
	logEvent: jest.fn().mockResolvedValue({ id: 'audit-1' }),
	EVENT_TYPES: { STATUS_CHANGE: 'status_change' },
	ENTITY_TYPES: {},
}));

const db = require('../../../lib/db');
const EuComplianceService = require('../../../services/euComplianceService');

describe('#1981 skeletonAudit predicates (lib/legalHold)', () => {
	test('metadata-keyed, fail-closed skeleton predicates exist with the sweep-derived branches', () => {
		const lh = require('../../../lib/legalHold');
		expect(typeof lh.skeletonAuditHeldPredicate).toBe('function');
		expect(typeof lh.skeletonAuditNotHeldPredicate).toBe('function');
		const held = lh.skeletonAuditHeldPredicate();
		// Subject comes from metadata, never audit_logs.user_id.
		expect(held).toMatch(/metadata->>'tombstone_user_id'/);
		expect(held).not.toMatch(/audit_logs\.user_id/);
		// Fail-closed: an unparseable / missing subject reads as held.
		expect(held).toMatch(/IS NULL OR/);
		// Derived branches: users.company_id + interview_sessions
		// (via heldPredicate reuse) and job_applications via target_id.
		expect(held).toMatch(/interview_sessions/);
		expect(held).toMatch(/job_applications/);
		expect(held).toMatch(/legal_holds/);
		expect(lh.skeletonAuditNotHeldPredicate()).toBe(`NOT ${held}`);
	});
});

describe('#1981 executePurge wiring', () => {
	let policies;
	let skeletonCountCalls;
	beforeEach(() => {
		jest.clearAllMocks();
		policies = [];
		skeletonCountCalls = 0;
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM data_retention_policies')) {
				return { rows: policies, rowCount: policies.length };
			}
			if (sql.includes('skeleton_event_swept')) {
				if (sql.trimStart().startsWith('DELETE')) return { rows: [], rowCount: 3 };
				skeletonCountCalls += 1;
				// First skeleton COUNT is the held count, second is the
				// dry-run would-delete count.
				return { rows: [{ c: skeletonCountCalls === 1 ? 2 : 3 }], rowCount: 1 };
			}
			if (sql.includes('FROM audit_logs')) {
				if (sql.trimStart().startsWith('DELETE')) return { rows: [], rowCount: 1 };
				return { rows: [{ c: 0 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});
	});

	test('skeleton expiry segment runs even when NO policy is auto_delete (seeded audit_logs policy is dormant)', async () => {
		const summary = await EuComplianceService.executePurge({ dryRun: true });
		const skel = summary.find((s) => s.data_type === 'audit_logs_skeleton_event_swept');
		expect(skel).toBeDefined();
		expect(skel.retention_days).toBe(2555);
		expect(skel.held_skips).toBe(2);
		expect(skel.affected_count).toBe(3);
		expect(skel.dry_run).toBe(true);
		// Aggregate only: the summary entry carries no subject id and
		// no keys beyond the standard aggregate shape.
		expect(Object.keys(skel).sort()).toEqual(
			['affected_count', 'cutoff', 'data_type', 'dry_run', 'held_skips', 'retention_days'].sort(),
		);
	});

	test('dry-run issues no skeleton DELETE; live run deletes only via the metadata-keyed, class-gated statement', async () => {
		await EuComplianceService.executePurge({ dryRun: true });
		const dryDeletes = db.query.mock.calls.filter(
			(c) => c[0].trimStart().startsWith('DELETE') && c[0].includes('skeleton_event_swept'),
		);
		expect(dryDeletes).toHaveLength(0);

		jest.clearAllMocks();
		db.query.mockImplementation(async (sql) => {
			if (sql.includes('FROM data_retention_policies')) return { rows: [], rowCount: 0 };
			if (sql.includes('skeleton_event_swept')) {
				if (sql.trimStart().startsWith('DELETE')) return { rows: [], rowCount: 3 };
				return { rows: [{ c: 2 }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		});
		const summary = await EuComplianceService.executePurge({ dryRun: false });
		const liveDeletes = db.query.mock.calls.filter(
			(c) => c[0].trimStart().startsWith('DELETE') && c[0].includes('skeleton_event_swept'),
		);
		expect(liveDeletes).toHaveLength(1);
		expect(liveDeletes[0][0]).toMatch(/metadata->>'tombstone_user_id'/);
		// No per-subject audit row is written by the purge.
		const inserts = db.query.mock.calls.filter((c) => c[0].includes('INSERT INTO audit_logs'));
		expect(inserts).toHaveLength(0);
		const skel = summary.find((s) => s.data_type === 'audit_logs_skeleton_event_swept');
		expect(skel.affected_count).toBe(3);
		expect(skel.held_skips).toBe(2);
	});

	test('generic audit_logs branch excludes the skeleton class in every statement', async () => {
		policies = [
			{ data_type: 'audit_logs', retention_days: 30, auto_delete: true, company_id: null, policy_scope: 'global' },
		];
		await EuComplianceService.executePurge({ dryRun: false });
		// Every DELETE over audit_logs is either the class-gated,
		// metadata-keyed skeleton delete, or a generic delete that
		// explicitly EXCLUDES the skeleton class.
		const deletes = db.query.mock.calls.filter((c) =>
			c[0].trimStart().startsWith('DELETE FROM audit_logs'),
		);
		expect(deletes.length).toBeGreaterThanOrEqual(2);
		for (const [sql] of deletes) {
			const isSkeletonDelete = /action_type\s*=\s*'skeleton_event_swept'/.test(sql);
			if (!isSkeletonDelete) {
				expect(sql).toMatch(
					/IS DISTINCT FROM 'skeleton_event_swept'|<> 'skeleton_event_swept'|!= 'skeleton_event_swept'/,
				);
			}
		}
		const genericDelete = deletes.find(
			(c) => !/action_type\s*=\s*'skeleton_event_swept'/.test(c[0]),
		);
		expect(genericDelete).toBeDefined();
	});
});
