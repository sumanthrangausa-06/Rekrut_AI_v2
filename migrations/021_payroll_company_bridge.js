module.exports = {
  name: '021_payroll_company_bridge',
  async up(client) {
    // Add company_id to employees table for proper multi-recruiter company support
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'employees' AND column_name = 'company_id'
        ) THEN
          ALTER TABLE employees ADD COLUMN company_id INTEGER;
        END IF;
      END $$;
    `);

    // Add company_id to payroll_runs table so payroll runs are company-scoped
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'payroll_runs' AND column_name = 'company_id'
        ) THEN
          ALTER TABLE payroll_runs ADD COLUMN company_id INTEGER;
        END IF;
      END $$;
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_id ON payroll_runs(company_id)');

    // Auto-create employee records from accepted offers that don't have employees yet
    const acceptedOffers = await client.query(`
      SELECT o.*, u.name as candidate_name
      FROM offers o
      JOIN users u ON o.candidate_id = u.id
      WHERE o.status = 'accepted'
        AND NOT EXISTS (
          SELECT 1 FROM employees e WHERE e.user_id = o.candidate_id
        )
    `);

    for (const offer of acceptedOffers.rows) {
      const empNum = 'EMP-' + String(offer.candidate_id).padStart(4, '0');

      // Create employee record
      const empResult = await client.query(`
        INSERT INTO employees (user_id, employer_id, company_id, employee_number, position, employment_type, start_date, status)
        VALUES ($1, $2, $3, $4, $5, 'full-time', $6, 'active')
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        offer.candidate_id,
        offer.recruiter_id,
        offer.company_id,
        empNum,
        offer.title,
        offer.start_date || new Date()
      ]);

      if (empResult.rows.length > 0) {
        const employeeId = empResult.rows[0].id;
        const annualSalary = parseFloat(offer.salary || 50000);

        // Create payroll config
        await client.query(`
          INSERT INTO payroll_configs (employee_id, salary_type, salary_amount, pay_frequency, payment_method, tax_filing_status)
          VALUES ($1, 'salary', $2, 'bi-weekly', 'direct_deposit', 'single')
          ON CONFLICT (employee_id) DO NOTHING
        `, [employeeId, annualSalary]);

        console.log(`  Created employee record for ${offer.candidate_name} (${empNum})`);
      }
    }

    // Backfill company_id for any existing employees that have employer_id but no company_id
    await client.query(`
      UPDATE employees e
      SET company_id = u.company_id
      FROM users u
      WHERE e.employer_id = u.id
        AND e.company_id IS NULL
        AND u.company_id IS NOT NULL
    `);

    // Backfill company_id for existing payroll_runs
    await client.query(`
      UPDATE payroll_runs pr
      SET company_id = u.company_id
      FROM users u
      WHERE pr.employer_id = u.id
        AND pr.company_id IS NULL
        AND u.company_id IS NOT NULL
    `);

    console.log('Payroll company bridge migration complete');
  }
};
