// Migration 300: extend compliance_audit_trail entity_type CHECK for panel-labelling audit rows
// Issue #1961 (S-D18 review minor 5) — lib/panelLabelling.writePanelAudit
// records audit rows FOR an interview event (entity_id = interview event
// id) but migration 129's CHECK only allowed
// ('candidate','job','company','user','retention_purge'), so the corrected
// label entity_type='interview_event' would throw check_violation on every
// panel audit INSERT (proven on the fresh-install rig, #1961 build log).
// This widens the CHECK following migration 254's exact precedent
// (backward-compatible: existing rows unaffected, no data touched).
// The constraint lookup uses pg_constraint contype='c' (genuine CHECK
// only) — on PG18, information_schema surfaces NOT NULL constraints as
// CHECK, so an information_schema/LIKE lookup can select the entity_type
// not-null pseudo-CHECK, drop it, and collide on the re-add (defect
// #1329/#1155, fixed for 254 in the same way).

async function up(client) {
	await client.query(`
		DO $$
		DECLARE
			chk_name TEXT;
		BEGIN
			SELECT con.conname INTO chk_name
			FROM pg_constraint con
			JOIN pg_class rel ON rel.oid = con.conrelid
			WHERE rel.relname = 'compliance_audit_trail'
				AND con.contype = 'c'
				AND con.conname LIKE '%entity_type%'
			LIMIT 1;

			IF chk_name IS NOT NULL THEN
				EXECUTE format('ALTER TABLE compliance_audit_trail DROP CONSTRAINT %I', chk_name);
			END IF;
		END
		$$;
	`);

	await client.query(`
		ALTER TABLE compliance_audit_trail
		ADD CONSTRAINT compliance_audit_trail_entity_type_check
		CHECK (entity_type IN ('candidate', 'job', 'company', 'user', 'retention_purge', 'interview_event'))
	`);
}

async function down(client) {
	// Reverting while interview_event rows exist would violate the old CHECK,
	// so down() is intentionally a no-op. Retain the wider constraint.
}

module.exports = { up, down };
