/**
 * Task 1 (#322): Unified interview_sessions migration — static content validation.
 *
 * Environment limitation: no live PostgreSQL in this VM, and migrations must
 * NEVER run against the shared Neon DB. This test therefore validates the
 * migration FILE content: required tables, columns, IF NOT EXISTS guards,
 * nullable FK columns, 128 re-assertions, and backfill INSERTs.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'migrations',
	'129_interview_sessions_unified.js',
);

describe('129_interview_sessions_unified migration', () => {
	let src;
	let migration;

	beforeAll(() => {
		src = fs.readFileSync(MIGRATION_PATH, 'utf8');
		migration = require(MIGRATION_PATH);
	});

	test('exports an up function (migrate.js contract)', () => {
		expect(typeof migration.up).toBe('function');
	});

	test('creates interview_sessions with IF NOT EXISTS', () => {
		expect(src).toMatch(/CREATE TABLE IF NOT EXISTS interview_sessions/);
	});

	test('interview_sessions has every required column', () => {
		const required = [
			'id',
			'type',
			'job_id',
			'application_id',
			'candidate_id',
			'company_id',
			'triggered_by',
			'invite_token',
			'status',
			'config',
			'conversation',
			'frame_analysis',
			'started_at',
			'completed_at',
		];
		// Extract the interview_sessions CREATE TABLE block only, so column
		// matches can't come from the re-asserted 128 tables.
		const block = src.match(/CREATE TABLE IF NOT EXISTS interview_sessions \(([\s\S]*?)\n\s*\)/);
		expect(block).not.toBeNull();
		for (const col of required) {
			expect(block[1]).toMatch(new RegExp(`\\b${col}\\b`));
		}
	});

	test('invite_token is UNIQUE', () => {
		expect(src).toMatch(/invite_token VARCHAR\(128\) UNIQUE/);
	});

	test('config/conversation/frame_analysis are JSONB', () => {
		expect(src).toMatch(/config JSONB/);
		expect(src).toMatch(/conversation JSONB/);
		expect(src).toMatch(/frame_analysis JSONB/);
	});

	test('adds nullable interview_session_id to interview_recordings', () => {
		expect(src).toMatch(
			/ALTER TABLE interview_recordings\s+ADD COLUMN IF NOT EXISTS interview_session_id INTEGER/i,
		);
	});

	test('adds nullable interview_session_id to interview_evaluations', () => {
		expect(src).toMatch(
			/ALTER TABLE interview_evaluations\s+ADD COLUMN IF NOT EXISTS interview_session_id INTEGER/i,
		);
	});

	test('re-asserts all four migration-128 tables with IF NOT EXISTS', () => {
		for (const t of [
			'interview_recordings',
			'interview_transcripts',
			'recording_consent',
			'transcript_highlights',
		]) {
			expect(src).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`));
		}
	});

	test('every CREATE TABLE uses IF NOT EXISTS', () => {
		const bare = src.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/g);
		expect(bare).toBeNull();
	});

	test('backfills screening sessions as type=screening', () => {
		expect(src).toMatch(/INSERT INTO interview_sessions/);
		expect(src).toMatch(/FROM screening_sessions/);
		expect(src).toMatch(/'screening'/);
	});

	test('backfills mock sessions as type=practice with candidate_id=user_id', () => {
		expect(src).toMatch(/FROM mock_interview_sessions/);
		expect(src).toMatch(/'practice'/);
		expect(src).toMatch(/candidate_id/);
	});

	test('creates lookup indexes', () => {
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_interview_sessions_candidate/);
		expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_interview_sessions_token/);
	});
});
