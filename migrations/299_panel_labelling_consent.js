// =============================================================================
// Migration 299: BR-7 panel labelling consent capture — S-D18 (#1955)
// =============================================================================
//
// Design: Rex, br7-panel-notice-design.md §5.1 (epic #1900). STOP 1 on
// #1955 carries the binding specialist amendments over the design text:
//   - privacy B-1: interview_event_id FK is ON DELETE RESTRICT (NOT the
//     design's CASCADE — candidate erasure whole-deletes interview_events;
//     CASCADE would silently delete panel speakers' consent records).
//   - privacy B-2 / DB B-1: NO UNIQUE(interview_event_id, user_id) — the
//     table is append-only; absence of the unique is ASSERTED below via a
//     pg_constraint scan (298-style), not merely omitted.
//   - user_id FK CASCADE stands as backstop: account deletion tombstones
//     users (lib/erasureService.js), so it never fires on the §10 path;
//     S-D19 owns the enumerated erasure step for this table.
//   - panel_expected_hash is a plain SHA-256 raw 64-char hex (DB-only,
//     never API-returned); the API-facing roster_version is a separate
//     keyed HMAC-SHA256 computed in lib/panelLabelling.js.
//
// WHAT (expand-only — nothing renamed, dropped, narrowed, backfilled):
//   1. event_labelling_consent — append-only per-event panel decisions.
//   2. interview_recordings.panel_expected_user_ids INTEGER[] NULL +
//      panel_expected_hash VARCHAR(64) NULL — the §6 freeze columns.
//   3. diarization_jobs / diarization_runs .panel_consent_snapshot JSONB
//      NULL — gate provenance (written by S-D19's gate leg, not here).
//
// EXECUTION GATE: designed and proven on the local rig only in #1955.
// Executes on the shared Neon database only after the Nov 1 unfreeze,
// in dev → staging → main promotion order. down() is a log-only no-op.
// =============================================================================

module.exports = {
	name: '299_panel_labelling_consent',
	up: async (client) => {
		await client.query(`
			CREATE TABLE IF NOT EXISTS event_labelling_consent (
				id SERIAL PRIMARY KEY,
				interview_event_id INTEGER NOT NULL REFERENCES interview_events(id) ON DELETE RESTRICT,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				decision VARCHAR(10) NOT NULL CONSTRAINT chk_event_labelling_consent_decision CHECK (decision IN ('granted','declined','withdrawn')),
				notice_version VARCHAR(20) NOT NULL,
				decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				ip_address INET NULL,
				user_agent_hash VARCHAR(64) NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_event_labelling_consent_event
			ON event_labelling_consent(interview_event_id)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_event_labelling_consent_user
			ON event_labelling_consent(user_id)
		`);
		await client.query(`
			ALTER TABLE interview_recordings
			ADD COLUMN IF NOT EXISTS panel_expected_user_ids INTEGER[]
		`);
		await client.query(`
			ALTER TABLE interview_recordings
			ADD COLUMN IF NOT EXISTS panel_expected_hash VARCHAR(64)
		`);
		await client.query(`
			ALTER TABLE diarization_jobs
			ADD COLUMN IF NOT EXISTS panel_consent_snapshot JSONB
		`);
		await client.query(`
			ALTER TABLE diarization_runs
			ADD COLUMN IF NOT EXISTS panel_consent_snapshot JSONB
		`);

		// ── Post-state assertions (fail loud, 296/298 pattern) ─────────
		// (table,column)-keyed type/nullability assertions (DB condition).
		const cols = await client.query(
			`SELECT table_name, column_name, data_type, udt_name, is_nullable FROM information_schema.columns
			 WHERE table_schema = 'public'
			   AND ((table_name = 'event_labelling_consent')
			     OR (table_name = 'interview_recordings' AND column_name IN ('panel_expected_user_ids', 'panel_expected_hash'))
			     OR (table_name IN ('diarization_jobs', 'diarization_runs') AND column_name = 'panel_consent_snapshot'))`,
		);
		const key = (r) => `${r.table_name}.${r.column_name}`;
		const byKey = new Map(cols.rows.map((r) => [key(r), r]));
		const expectCol = (table, column, dataType, udtName, nullable) => {
			const r = byKey.get(`${table}.${column}`);
			if (!r || r.data_type !== dataType || r.udt_name !== udtName || r.is_nullable !== nullable) {
				throw new Error(
					`Migration 299 post-state assertion failed: ${table}.${column} expected ${dataType}/${udtName} nullable=${nullable}, got ${JSON.stringify(r || null)}`,
				);
			}
		};
		expectCol('event_labelling_consent', 'id', 'integer', 'int4', 'NO');
		expectCol('event_labelling_consent', 'interview_event_id', 'integer', 'int4', 'NO');
		expectCol('event_labelling_consent', 'user_id', 'integer', 'int4', 'NO');
		expectCol('event_labelling_consent', 'decision', 'character varying', 'varchar', 'NO');
		expectCol('event_labelling_consent', 'notice_version', 'character varying', 'varchar', 'NO');
		expectCol('event_labelling_consent', 'decided_at', 'timestamp with time zone', 'timestamptz', 'NO');
		expectCol('event_labelling_consent', 'ip_address', 'inet', 'inet', 'YES');
		expectCol('event_labelling_consent', 'user_agent_hash', 'character varying', 'varchar', 'YES');
		expectCol('event_labelling_consent', 'created_at', 'timestamp with time zone', 'timestamptz', 'NO');
		expectCol('interview_recordings', 'panel_expected_user_ids', 'ARRAY', '_int4', 'YES');
		expectCol('interview_recordings', 'panel_expected_hash', 'character varying', 'varchar', 'YES');
		expectCol('diarization_jobs', 'panel_consent_snapshot', 'jsonb', 'jsonb', 'YES');
		expectCol('diarization_runs', 'panel_consent_snapshot', 'jsonb', 'jsonb', 'YES');

		// Both FKs asserted by column + confdeltype (DB condition):
		// event 'r' = RESTRICT (privacy B-1), user 'c' = CASCADE.
		const fk = await client.query(
			`SELECT a.attname, c.confdeltype FROM pg_constraint c
			 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
			 WHERE c.contype = 'f'
			   AND c.conrelid = 'event_labelling_consent'::regclass
			   AND a.attname IN ('interview_event_id', 'user_id')`,
		);
		const fkByCol = new Map(fk.rows.map((r) => [r.attname, r.confdeltype]));
		if (fkByCol.get('interview_event_id') !== 'r' || fkByCol.get('user_id') !== 'c') {
			throw new Error(
				`Migration 299 post-state assertion failed: FK delete rules wrong (event must be RESTRICT 'r', user CASCADE 'c'): ${JSON.stringify(fk.rows)}`,
			);
		}
		// Absence of UNIQUE(interview_event_id, user_id) asserted (B-2):
		// NO unique constraint of any kind on this append-only table.
		const uniq = await client.query(
			`SELECT c.conname FROM pg_constraint c
			 WHERE c.contype = 'u'
			   AND c.conrelid = 'event_labelling_consent'::regclass`,
		);
		if (uniq.rows.length !== 0) {
			throw new Error(
				'Migration 299 post-state assertion failed: event_labelling_consent carries a UNIQUE constraint (append-only — deliberately none)',
			);
		}
		const chk = await client.query(
			`SELECT c.conname FROM pg_constraint c
			 WHERE c.contype = 'c' AND c.conname = 'chk_event_labelling_consent_decision'
			   AND c.conrelid = 'event_labelling_consent'::regclass`,
		);
		if (chk.rows.length !== 1) {
			throw new Error(
				'Migration 299 post-state assertion failed: chk_event_labelling_consent_decision not present',
			);
		}
		const idx = await client.query(
			`SELECT indexname FROM pg_indexes
			 WHERE schemaname = 'public'
			   AND indexname IN ('idx_event_labelling_consent_event', 'idx_event_labelling_consent_user')`,
		);
		if (idx.rows.length !== 2) {
			throw new Error(
				'Migration 299 post-state assertion failed: idx_event_labelling_consent_event/_user not both present',
			);
		}

		console.log(
			'Migration 299: event_labelling_consent (append-only, event FK RESTRICT, no UNIQUE) + recording freeze columns + panel_consent_snapshot on diarization_jobs/runs; expand-only, no rows touched',
		);
	},
	down: async (_client) => {
		// No-op by design: migrations never un-apply on the shared DB.
		console.log(
			'Migration 299 down(): no-op — reversal, if needed, is a forward migration (shared-DB rule)',
		);
	},
};
