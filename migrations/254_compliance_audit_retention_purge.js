// Migration 254: extend compliance_audit_trail entity_type CHECK for retention purges
// Issue #760 (S-077) — the _auditPurge path inserts entity_type='retention_purge'
// via auditLogService, but migration 129's CHECK only allows
// ('candidate','job','company','user'), so every audit INSERT would throw
// check_violation. Extend the CHECK (backward-compatible: existing rows unaffected).

async function up(client) {
	await client.query(`
		DO $$
		DECLARE
			chk_name TEXT;
		BEGIN
			SELECT constraint_name INTO chk_name
			FROM information_schema.table_constraints
			WHERE table_name = 'compliance_audit_trail'
				AND constraint_type = 'CHECK'
				AND constraint_name LIKE '%entity_type%'
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
		CHECK (entity_type IN ('candidate', 'job', 'company', 'user', 'retention_purge'))
	`);
}

async function down(client) {
	// Reverting while retention_purge rows exist would violate the old CHECK,
	// so down() is intentionally a no-op. Retain the wider constraint.
}

module.exports = { up, down };
