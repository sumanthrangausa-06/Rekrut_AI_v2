module.exports = {
  name: '029_global_payroll_enhancements',
  async up(client) {
    // ═══════════════════════════════════════════════════════
    // GLOBAL PAYROLL — US + India region-aware schema
    // Adds country_code to payroll tables so tax calculations
    // route to the correct regional calculator.
    // ═══════════════════════════════════════════════════════

    // 1. Add country_code to payroll_configs
    await client.query(`
      ALTER TABLE payroll_configs
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'US',
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS region_config JSONB DEFAULT '{}'
    `);

    // 2. Add country_code and currency to payroll_runs
    await client.query(`
      ALTER TABLE payroll_runs
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(2),
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS currency_symbol VARCHAR(5) DEFAULT '$'
    `);

    // 3. Add region_deductions JSONB to paychecks for non-US breakdowns
    //    US uses the existing typed columns (federal_tax, state_tax, social_security, medicare)
    //    India/other countries use region_deductions JSONB for PF, ESI, professional tax, etc.
    await client.query(`
      ALTER TABLE paychecks
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'US',
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS region_deductions JSONB DEFAULT '{}'
    `);

    // 4. Backfill payroll_configs country_code from employees
    await client.query(`
      UPDATE payroll_configs pc
      SET country_code = e.country_code,
          currency_code = e.currency_code
      FROM employees e
      WHERE pc.employee_id = e.id
        AND e.country_code IS NOT NULL
        AND pc.country_code = 'US'
        AND e.country_code != 'US'
    `);

    // 5. Create pay_periods table for managing pay cycles per country
    await client.query(`
      CREATE TABLE IF NOT EXISTS pay_periods (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        country_code VARCHAR(2) NOT NULL DEFAULT 'US',
        period_type VARCHAR(20) NOT NULL DEFAULT 'bi-weekly',
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        pay_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'upcoming',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_pay_periods_company ON pay_periods(company_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_pay_periods_country ON pay_periods(country_code)');

    console.log('✓ Global payroll enhancements applied (US + India)');
  }
};
