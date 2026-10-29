/**
 * Migration 298 — event→session bridge (ADR-D06, #1925).
 *
 * Expand-only: interview_events gains the governing-session link
 * (nullable FK, ON DELETE SET NULL, indexed); diarization_jobs and
 * diarization_runs gain plain-integer provenance columns
 * (governing_session_id / consent_receipt_id, deliberately NO FK —
 * a historical snapshot of the gate decision). No backfill, no XOR
 * change, no consent_receipts change, nothing dropped/narrowed.
 * Mechanics proven on the real PG rig (fresh migrate incl. 298) —
 * see the #1925 build log (HL-003).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '298_event_session_bridge.js');

describe('migration 298 — event→session bridge (#1925)', () => {
	let migration;
	let calls;

	beforeAll(async () => {
		expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
		migration = require(MIGRATION_PATH);
		calls = [];
		const client = {
			query: async (sql, params) => {
				calls.push({ sql, params });
				// Post-state assertions read information_schema back:
				// answer with the four expected bridge columns.
				if (/information_schema\.columns/.test(sql)) {
					return {
						rows: [
							{ table_name: 'interview_events', column_name: 'interview_session_id', data_type: 'integer', is_nullable: 'YES' },
							{ table_name: 'diarization_jobs', column_name: 'governing_session_id', data_type: 'integer', is_nullable: 'YES' },
							{ table_name: 'diarization_jobs', column_name: 'consent_receipt_id', data_type: 'integer', is_nullable: 'YES' },
							{ table_name: 'diarization_runs', column_name: 'governing_session_id', data_type: 'integer', is_nullable: 'YES' },
							{ table_name: 'diarization_runs', column_name: 'consent_receipt_id', data_type: 'integer', is_nullable: 'YES' },
						],
					};
				}
				if (/pg_indexes/.test(sql)) {
					return { rows: [{ indexname: 'idx_interview_events_session' }] };
				}
				if (/pg_constraint/.test(sql)) {
					// FK-by-column assertion (confdeltype 'n' = SET NULL);
					// the provenance-no-FK assertion expects zero rows.
					if (/confdeltype/.test(sql)) return { rows: [{ confdeltype: 'n' }] };
					return { rows: [] };
				}
				return { rows: [], rowCount: 0 };
			},
		};
		await migration.up(client);
	});

	const allSql = () => calls.map((c) => c.sql).join('\n');

	test('exports name + up/down (migrate.js contract), named 298', () => {
		expect(migration.name).toMatch(/^298_/);
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('adds interview_events.interview_session_id as a nullable FK to interview_sessions with ON DELETE SET NULL', () => {
		const sql = allSql();
		expect(sql).toMatch(/ALTER TABLE interview_events[\s\S]*interview_session_id INTEGER/i);
		expect(sql).toMatch(/REFERENCES interview_sessions\(id\) ON DELETE SET NULL/i);
		expect(sql).not.toMatch(/ON DELETE CASCADE/i);
	});

	test('indexes the bridge link — partial, WHERE interview_session_id IS NOT NULL (DB-review condition)', () => {
		expect(allSql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_interview_events_session\s+ON interview_events\(interview_session_id\)\s+WHERE interview_session_id IS NOT NULL/i);
	});

	test('adds plain-integer provenance columns to diarization_jobs and diarization_runs — no FK on them', () => {
		const sql = allSql();
		for (const table of ['diarization_jobs', 'diarization_runs']) {
			expect(sql).toMatch(new RegExp(`ALTER TABLE ${table}[\\s\\S]*governing_session_id INTEGER`, 'i'));
			expect(sql).toMatch(new RegExp(`ALTER TABLE ${table}[\\s\\S]*consent_receipt_id INTEGER`, 'i'));
		}
		// Exactly one REFERENCES in the whole migration: the bridge link.
		expect((sql.match(/REFERENCES/gi) || [])).toHaveLength(1);
	});

	test('expand-only: no DROP, no backfill UPDATE, no consent_receipts / interview_recordings change', () => {
		const sql = allSql();
		expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
		expect(sql).not.toMatch(/UPDATE\s+(interview_events|diarization_jobs|diarization_runs)\s+SET/i);
		expect(sql).not.toMatch(/consent_receipts/i);
		expect(sql).not.toMatch(/ALTER TABLE interview_recordings/i);
	});

	test('idempotent shape: ADD COLUMN IF NOT EXISTS throughout', () => {
		const alters = calls.filter((c) => /ADD COLUMN/i.test(c.sql));
		expect(alters.length).toBeGreaterThanOrEqual(3);
		for (const c of alters) expect(c.sql).toMatch(/IF NOT EXISTS/i);
	});
});
