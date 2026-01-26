module.exports = {
  name: '012_payroll_fixes',
  async up(client) {
    // Add unique constraint on payroll_configs.employee_id if not exists
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'payroll_configs_employee_id_key'
        ) THEN
          ALTER TABLE payroll_configs ADD CONSTRAINT payroll_configs_employee_id_key UNIQUE (employee_id);
        END IF;
      END $$;
    `);

    console.log('✓ Payroll fixes applied');
  }
};
