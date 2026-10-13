/**
 * Migration 257 — Gate A dormant capture substrate (S-085, #787).
 *
 * Static content validation + mock-client execution, following the
 * 250/254 migration-test pattern. The design contract (Rex v2 §9):
 *   - recording_objects widened for 'observer_audio' + registration_state
 *   - observer_audio policy row (30 days, D-1)
 *   - observer_audio_chunks / observer_speech_measurements /
 *     observer_capture_outcomes / observer_cohort_allowlist /
 *     observer_cohort_membership / observer_activation_enablements
 *   - observer_jobs.origin_env stamp column
 *   - pending_storage_deletions.source_family (P-19)
 *   - consent_type CHECKs widened for 'observer_capture' (type exists in
 *     the schema; NO consent_texts artefact row is inserted — counsel
 *     owns the wording, C-04)
 *   - D-2 errata: membership uses a surrogate PK (append-only rows)
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'257_observer_capture.js',
);

describe('257_observer_capture migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports up and down functions (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
		expect(typeof migration.down).toBe('function');
	});

	test('widens recording_objects.object_type to include observer_audio (by-name surgery, 254 pattern)', () => {
		expect(src).toMatch(/object_type IN \('frame',\s*'recording',\s*'observer_audio'\)/);
		expect(src).toMatch(/information_schema\.table_constraints/);
	});

	test('adds registration_state pending/confirmed with confirmed default', () => {
		expect(src).toMatch(/registration_state TEXT NOT NULL DEFAULT 'confirmed'/);
		expect(src).toMatch(/registration_state IN \('pending',\s*'confirmed'\)/);
	});

	test('inserts the observer_audio 30-day retention policy row (D-1), idempotent', () => {
		expect(src).toMatch(/'observer_audio',\s*30,\s*true/);
		expect(src).toMatch(/ON CONFLICT \(data_type\) DO NOTHING/);
	});

	test('creates observer_audio_chunks with unique object_key and (session, chunk_index)', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS observer_audio_chunks/);
		expect(src).toMatch(/object_key TEXT NOT NULL UNIQUE/);
		expect(src).toMatch(/UNIQUE \(interview_session_id, chunk_index\)/);
		expect(src).toMatch(/byte_size INTEGER/);
		expect(src).toMatch(/is_test BOOLEAN NOT NULL DEFAULT false/);
	});

	test('creates observer_speech_measurements with envelope-only measurement storage', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS observer_speech_measurements/);
		expect(src).toMatch(/measurements_envelope BYTEA NOT NULL/);
		expect(src).toMatch(/interview_session_id INTEGER NOT NULL UNIQUE/);
		expect(src).toMatch(/method_version INTEGER NOT NULL DEFAULT 1/);
		expect(src).toMatch(/state TEXT NOT NULL DEFAULT 'recorded'/);
	});

	test('creates observer_capture_outcomes with the frozen stop_reason enum', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS observer_capture_outcomes/);
		for (const reason of [
			'session_end',
			'flag_off',
			'consent_withdrawn',
			'consent_check_failed',
			'storage_failed',
			'dek_unavailable',
			'role_flip',
			'job_gone',
			'concurrency_cap',
			'worker_shutdown',
		]) {
			expect(src).toContain(`'${reason}'`);
		}
	});

	test('creates cohort allowlist + membership; membership has surrogate PK (D-2 errata)', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS observer_cohort_allowlist/);
		expect(src).toMatch(/company_id INTEGER PRIMARY KEY/);
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS observer_cohort_membership/);
		// D-2: surrogate PK, NOT a session-id PK — corrections are appended rows
		const membershipBlock = src.slice(src.indexOf('observer_cohort_membership'));
		expect(membershipBlock.slice(0, 400)).toMatch(/id SERIAL PRIMARY KEY/);
		expect(src).toMatch(/\(interview_session_id, recorded_at DESC\)/);
	});

	test('creates observer_activation_enablements PER EMPLOYER (§9/M1) with the six L-ACT-04 refs NOT NULL and inserts NO rows', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS observer_activation_enablements/);
		expect(src).toMatch(/company_id INTEGER PRIMARY KEY/);
		for (const col of [
			'counsel_ref',
			'lex_activation_ref',
			'quinn_validation_ref',
			'policy777_ref',
			'bipa_schedule_ref',
			'sumanth_activation_ref',
		]) {
			expect(src).toMatch(new RegExp(`${col} TEXT NOT NULL`));
		}
		expect(src).not.toMatch(/INSERT INTO observer_activation_enablements/);
	});

	test('outcomes carry the §8.5 accountability fields (M2) + candidate index', () => {
		expect(src).toMatch(/is_test BOOLEAN NOT NULL DEFAULT false/);
		expect(src).toMatch(/cohort_allowlist_version INTEGER/);
		expect(src).toMatch(/capture_gap_ratio NUMERIC/);
		expect(src).toMatch(/idx_observer_capture_outcomes_candidate/);
	});

	test('reconciler pending-intent scan has a partial index (M4)', () => {
		expect(src).toMatch(/idx_recording_objects_observer_pending/);
		expect(src).toMatch(/WHERE object_type = 'observer_audio' AND registration_state = 'pending'/);
	});

	test('stamps observer_jobs.origin_env with unknown default', () => {
		expect(src).toMatch(/ALTER TABLE observer_jobs\s+ADD COLUMN IF NOT EXISTS origin_env TEXT NOT NULL DEFAULT 'unknown'/);
	});

	test('adds pending_storage_deletions.source_family with file default + family index (P-19)', () => {
		expect(src).toMatch(/ADD COLUMN IF NOT EXISTS source_family TEXT NOT NULL DEFAULT 'file'/);
		expect(src).toMatch(/\(source_family, status\)/);
	});

	test('widens consent CHECKs for observer_capture but ships NO consent artefact', () => {
		expect(src).toMatch(/consent_texts_consent_type_check/);
		expect(src).toMatch(/consent_receipts_consent_type_check/);
		expect(src).toContain("'observer_capture'");
		// Counsel owns the wording (C-04): the type exists, the artefact does not.
		expect(src).not.toMatch(/INSERT INTO consent_texts/);
	});

	test('up() executes against a client without error and issues the core DDL', async () => {
		const queries = [];
		const client = {
			query: jest.fn(async (sql) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 0 };
			}),
		};
		await migration.up(client);
		const all = queries.join('\n');
		expect(all).toContain('observer_audio_chunks');
		expect(all).toContain('observer_speech_measurements');
		expect(all).toContain('observer_capture_outcomes');
		expect(all).toContain('origin_env');
		expect(all).toContain('source_family');
	});

	test('down() drops the new tables but LEAVES the additive columns + widened CHECKs (§9 down note, M3)', async () => {
		const queries = [];
		const client = {
			query: jest.fn(async (sql) => {
				queries.push(String(sql));
				return { rows: [], rowCount: 0 };
			}),
		};
		await migration.down(client);
		const all = queries.join('\n');
		expect(all).toMatch(/DROP TABLE IF EXISTS observer_audio_chunks/);
		expect(all).toMatch(/DROP TABLE IF EXISTS observer_activation_enablements/);
		expect(all).toMatch(/DROP INDEX IF EXISTS idx_recording_objects_observer_pending/);
		// §9: registration_state / source_family / origin_env stay.
		expect(all).not.toMatch(/DROP COLUMN IF EXISTS origin_env/);
		expect(all).not.toMatch(/DROP COLUMN IF EXISTS source_family/);
		expect(all).not.toMatch(/DROP COLUMN IF EXISTS registration_state/);
		expect(all).not.toMatch(/DROP CONSTRAINT[^;]*consent_type/);
	});
});
