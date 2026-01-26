module.exports = {
  name: '011_payroll_system',
  async up(client) {
    // Employee table - links to users who have been hired
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        employer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        employee_number VARCHAR(50) UNIQUE,
        department VARCHAR(100),
        position VARCHAR(100),
        employment_type VARCHAR(50) DEFAULT 'full-time',
        start_date DATE NOT NULL,
        end_date DATE,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Payroll configuration for each employee
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_configs (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        salary_type VARCHAR(50) DEFAULT 'hourly',
        salary_amount DECIMAL(10, 2) NOT NULL,
        pay_frequency VARCHAR(50) DEFAULT 'bi-weekly',
        payment_method VARCHAR(50) DEFAULT 'direct_deposit',
        bank_name VARCHAR(100),
        bank_account_last4 VARCHAR(4),
        bank_routing_number VARCHAR(20),
        tax_filing_status VARCHAR(50) DEFAULT 'single',
        federal_allowances INTEGER DEFAULT 0,
        state_allowances INTEGER DEFAULT 0,
        additional_withholding DECIMAL(10, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Payroll runs - scheduled payment batches
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id SERIAL PRIMARY KEY,
        employer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        pay_period_start DATE NOT NULL,
        pay_period_end DATE NOT NULL,
        pay_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'draft',
        total_gross DECIMAL(10, 2) DEFAULT 0,
        total_net DECIMAL(10, 2) DEFAULT 0,
        total_taxes DECIMAL(10, 2) DEFAULT 0,
        processed_at TIMESTAMP,
        processed_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Individual paychecks
    await client.query(`
      CREATE TABLE IF NOT EXISTS paychecks (
        id SERIAL PRIMARY KEY,
        payroll_run_id INTEGER REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        pay_period_start DATE NOT NULL,
        pay_period_end DATE NOT NULL,
        pay_date DATE NOT NULL,
        hours_worked DECIMAL(6, 2),
        gross_pay DECIMAL(10, 2) NOT NULL,
        federal_tax DECIMAL(10, 2) DEFAULT 0,
        state_tax DECIMAL(10, 2) DEFAULT 0,
        social_security DECIMAL(10, 2) DEFAULT 0,
        medicare DECIMAL(10, 2) DEFAULT 0,
        other_deductions DECIMAL(10, 2) DEFAULT 0,
        net_pay DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        paid_at TIMESTAMP,
        stub_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Benefits enrollment
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_benefits (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        benefit_type VARCHAR(50) NOT NULL,
        plan_name VARCHAR(100),
        coverage_level VARCHAR(50),
        employee_contribution DECIMAL(10, 2) DEFAULT 0,
        employer_contribution DECIMAL(10, 2) DEFAULT 0,
        start_date DATE NOT NULL,
        end_date DATE,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tax documents (W-2, 1099)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tax_documents (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        employer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tax_year INTEGER NOT NULL,
        document_type VARCHAR(50) NOT NULL,
        total_wages DECIMAL(10, 2),
        federal_withholding DECIMAL(10, 2),
        state_withholding DECIMAL(10, 2),
        social_security_wages DECIMAL(10, 2),
        medicare_wages DECIMAL(10, 2),
        document_url TEXT,
        issued_at TIMESTAMP,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Indexes for performance
    await client.query('CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_employees_employer_id ON employees(employer_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_paychecks_employee_id ON paychecks(employee_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_payroll_runs_employer_id ON payroll_runs(employer_id)');

    console.log('✓ Payroll system tables created');
  }
};
