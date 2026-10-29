/**
 * Migration 299 — BR-7 panel labelling consent capture (S-D18, #1955).
 * STOP 1 specialist conditions asserted here:
 *  - privacy B-1: event FK ON DELETE RESTRICT (confdeltype 'r')
 *  - privacy B-2 / DB B-1: NO UNIQUE(interview_event_id, user_id) — absence asserted
 *  - DB: named indexes idx_event_labelling_consent_event/_user, named CHECK
 *    chk_event_labelling_consent_decision, both FKs by column + confdeltype,
 *    panel_expected_hash raw 64-char hex column, panel_expected_user_ids ARRAY (_int4),
 *    (table,column)-keyed type assertions
 * 299-pattern mocked-client suite (as 296/298).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '299_panel_labelling_consent.js');

const COLUMNS = [
	{ table_name: 'event_labelling_consent', column_name: 'id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO' },
	{ table_name: 'event_labelling_consent', column_name: 'interview_event_id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO' },
	{ table_name: 'event_labelling_consent', column_name: 'user_id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO' },
	{ table_name: 'event_labelling_consent', column_name: 'decision', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'NO' },
	{ table_name: 'event_labelling_consent', column_name: 'notice_version', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'NO' },
	{ table_name: 'event_labelling_consent', column_name: 'decided_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz', is_nullable: 'NO' },
	{ table_name: 'event_labelling_consent', column_name: 'ip_address', data_type: 'inet', udt_name: 'inet', is_nullable: 'YES' },
	{ table_name: 'event_labelling_consent', column_name: 'user_agent_hash', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'YES' },
	{ table_name: 'event_labelling_consent', column_name: 'created_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz', is_nullable: 'NO' },
	{ table_name: 'interview_recordings', column_name: 'panel_expected_user_ids', data_type: 'ARRAY', udt_name: '_int4', is_nullable: 'YES' },
	{ table_name: 'interview_recordings', column_name: 'panel_expected_hash', data_type: 'character varying', udt_name: 'varchar', is_nullable: 'YES' },
	{ table_name: 'diarization_jobs', column_name: 'panel_consent_snapshot', data_type: 'jsonb', udt_name: 'jsonb', is_nullable: 'YES' },
	{ table_name: 'diarization_runs', column_name: 'panel_consent_snapshot', data_type: 'jsonb', udt_name: 'jsonb', is_nullable: 'YES' },
];

describe('migration 299 — panel labelling consent (#1955)', () => {
	let migration;
	let calls;

	beforeAll(async () => {
		expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
		migration = require(MIGRATION_PATH);
		calls = [];
		const client = {
			query: async (sql, params) => {
				calls.push({ sql, params });
				if (/information_schema\.columns/.test(sql)) return { rows: COLUMNS };
				if (/pg_indexes/.test(sql)) {
					return { rows: [{ indexname: 'idx_event_labelling_consent_event' }, { indexname: 'idx_event_labelling_consent_user' }] };
				}
				if (/pg_constraint/.test(sql)) {
					if (/confdeltype/.test(sql)) {
						return { rows: [{ attname: 'interview_event_id', confdeltype: 'r' }, { attname: 'user_id', confdeltype: 'c' }] };
					}
					if (/chk_event_labelling_consent_decision/.test(sql)) {
						return { rows: [{ conname: 'chk_event_labelling_consent_decision' }] };
					}
					if (/contype\s*=\s*'u'/.test(sql)) return { rows: [] }; // NO unique — absence
					return { rows: [] };
				}
				return { rows: [], rowCount: 0 };
			},
		};
		await migration.up(client);
	});

	const allSql = () => calls.map((c) => c.sql).join('\n');

	test('exports name + up/down, named 299; down() is log-only no-op', async () => {
		expect(migration.name).toMatch(/^299_/);
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
		const downCalls = [];
		await migration.down({ query: async (sql) => { downCalls.push(sql); return { rows: [] }; } });
		expect(downCalls).toHaveLength(0);
	});

	test('creates event_labelling_consent append-only: event FK RESTRICT, user FK CASCADE, NO UNIQUE(event,user)', () => {
		const sql = allSql();
		expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS event_labelling_consent/i);
		expect(sql).toMatch(/REFERENCES interview_events\(id\) ON DELETE RESTRICT/i);
		expect(sql).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/i);
		expect(sql).not.toMatch(/UNIQUE\s*\(\s*interview_event_id\s*,\s*user_id\s*\)/i);
	});

	test('named CHECK + named indexes', () => {
		const sql = allSql();
		expect(sql).toMatch(/chk_event_labelling_consent_decision/);
		expect(sql).toMatch(/CHECK \(decision IN \('granted','declined','withdrawn'\)\)/i);
		expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_event_labelling_consent_event/i);
		expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_event_labelling_consent_user/i);
	});

	test('recording freeze columns + snapshot JSONB on jobs and runs', () => {
		const sql = allSql();
		expect(sql).toMatch(/ALTER TABLE interview_recordings[\s\S]*panel_expected_user_ids INTEGER\[\]/i);
		expect(sql).toMatch(/ALTER TABLE interview_recordings[\s\S]*panel_expected_hash VARCHAR\(64\)/i);
		expect(sql).toMatch(/ALTER TABLE diarization_jobs[\s\S]*panel_consent_snapshot JSONB/i);
		expect(sql).toMatch(/ALTER TABLE diarization_runs[\s\S]*panel_consent_snapshot JSONB/i);
	});

	test('expand-only: no DROP, no backfill UPDATE', () => {
		const sql = allSql();
		expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
		expect(sql).not.toMatch(/UPDATE\s+(interview_recordings|diarization_jobs|diarization_runs)\s+SET/i);
	});
});
