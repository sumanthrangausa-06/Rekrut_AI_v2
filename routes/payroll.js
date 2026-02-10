const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { authMiddleware, requireRole } = require('../lib/auth');
const payrollCalculator = require('../services/payroll-calculator');

// Helper: get company_id for the current user
function getCompanyId(user) {
  return user.company_id || null;
}

// Currency formatting helper
const CURRENCY_MAP = {
  US: { code: 'USD', symbol: '$', locale: 'en-US' },
  IN: { code: 'INR', symbol: '₹', locale: 'en-IN' },
  GB: { code: 'GBP', symbol: '£', locale: 'en-GB' },
  CA: { code: 'CAD', symbol: 'C$', locale: 'en-CA' },
};

function getCurrency(countryCode) {
  return CURRENCY_MAP[countryCode] || CURRENCY_MAP.US;
}

// Pay frequency defaults per country
const PAY_FREQ_DEFAULTS = {
  US: 'bi-weekly',
  IN: 'monthly',
  GB: 'monthly',
  CA: 'bi-weekly',
};

// ============== EMPLOYER ENDPOINTS ==============

/**
 * GET /api/payroll/countries
 * Get supported payroll countries with config
 */
router.get('/countries', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT country_code, country_name, currency_code, currency_symbol,
             default_pay_frequency, statutory_deductions
      FROM country_configs
      WHERE country_code IN ('US', 'IN') AND is_active = true
      ORDER BY country_code
    `);
    res.json({ countries: result.rows });
  } catch (err) {
    // If country_configs doesn't exist yet, return defaults
    res.json({
      countries: [
        { country_code: 'US', country_name: 'United States', currency_code: 'USD', currency_symbol: '$', default_pay_frequency: 'bi-weekly', statutory_deductions: ['federal_income_tax', 'state_income_tax', 'social_security', 'medicare'] },
        { country_code: 'IN', country_name: 'India', currency_code: 'INR', currency_symbol: '₹', default_pay_frequency: 'monthly', statutory_deductions: ['income_tax', 'provident_fund', 'esi', 'professional_tax'] },
      ]
    });
  }
});

/**
 * GET /api/payroll/employees
 * Get all employees for the company's payroll
 */
router.get('/employees', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) {
      return res.status(400).json({ error: 'No company associated with your account. Please contact support.' });
    }

    const result = await pool.query(`
      SELECT
        e.*,
        u.name as employee_name,
        u.email as employee_email,
        pc.salary_type,
        pc.salary_amount,
        pc.pay_frequency,
        pc.payment_method,
        pc.country_code as pay_country_code,
        pc.currency_code as pay_currency_code,
        pc.region_config
      FROM employees e
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN payroll_configs pc ON e.id = pc.employee_id
      WHERE e.company_id = $1 AND e.status = 'active'
      ORDER BY u.name
    `, [companyId]);

    // Merge country_code: prefer payroll config, fallback to employee record
    const employees = result.rows.map(e => ({
      ...e,
      country_code: e.pay_country_code || e.country_code || 'US',
      currency_code: e.pay_currency_code || e.currency_code || 'USD',
    }));

    res.json({ employees });
  } catch (err) {
    console.error('Get employees error:', err);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

/**
 * POST /api/payroll/employees
 * Add a new employee to payroll (for recruiters who want to manually add)
 */
router.post('/employees', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) {
      return res.status(400).json({ error: 'No company associated with your account' });
    }

    const { user_id, position, department, employment_type, start_date, country_code } = req.body;
    const cc = country_code || 'US';
    const curr = getCurrency(cc);

    await client.query('BEGIN');

    // Generate employee number
    const countResult = await client.query('SELECT COUNT(*) as cnt FROM employees WHERE company_id = $1', [companyId]);
    const empNum = `EMP-${String(parseInt(countResult.rows[0].cnt) + 1).padStart(4, '0')}`;

    const empResult = await client.query(`
      INSERT INTO employees (user_id, employer_id, company_id, employee_number, position, department,
                             employment_type, start_date, country_code, currency_code, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [user_id, req.user.id, companyId, empNum, position, department, employment_type || 'full-time',
        start_date || new Date(), cc, curr.code]);

    await client.query('COMMIT');

    if (empResult.rows.length === 0) {
      return res.status(409).json({ error: 'Employee already exists' });
    }

    res.json({ employee: empResult.rows[0], message: 'Employee added to payroll' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add employee error:', err);
    res.status(500).json({ error: 'Failed to add employee' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/payroll/employees/:employeeId/onboard
 * Complete employee onboarding with payroll setup
 */
router.post('/employees/:employeeId/onboard', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { employeeId } = req.params;
    const companyId = getCompanyId(req.user);
    const {
      salary_type,
      salary_amount,
      pay_frequency,
      payment_method,
      bank_name,
      bank_account_last4,
      tax_filing_status,
      federal_allowances,
      state_allowances,
      country_code,
      region_config,
    } = req.body;

    const cc = country_code || 'US';
    const curr = getCurrency(cc);

    await client.query('BEGIN');

    // Verify employee belongs to this company
    const empCheck = await client.query(
      'SELECT id FROM employees WHERE id = $1 AND company_id = $2',
      [employeeId, companyId]
    );

    if (empCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Update employee's country_code
    await client.query(
      'UPDATE employees SET country_code = $1, currency_code = $2, updated_at = NOW() WHERE id = $3',
      [cc, curr.code, employeeId]
    );

    // Create or update payroll config
    await client.query(`
      INSERT INTO payroll_configs (
        employee_id, salary_type, salary_amount, pay_frequency,
        payment_method, bank_name, bank_account_last4,
        tax_filing_status, federal_allowances, state_allowances,
        country_code, currency_code, region_config
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (employee_id)
      DO UPDATE SET
        salary_type = $2,
        salary_amount = $3,
        pay_frequency = $4,
        payment_method = $5,
        bank_name = $6,
        bank_account_last4 = $7,
        tax_filing_status = $8,
        federal_allowances = $9,
        state_allowances = $10,
        country_code = $11,
        currency_code = $12,
        region_config = $13,
        updated_at = NOW()
    `, [
      employeeId, salary_type, salary_amount,
      pay_frequency || PAY_FREQ_DEFAULTS[cc] || 'bi-weekly',
      payment_method, bank_name, bank_account_last4,
      tax_filing_status, federal_allowances || 0, state_allowances || 0,
      cc, curr.code, JSON.stringify(region_config || {}),
    ]);

    await client.query('COMMIT');
    res.json({ message: 'Employee payroll configured successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Onboard employee error:', err);
    res.status(500).json({ error: 'Failed to configure employee payroll' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/payroll/dashboard
 * Get payroll dashboard overview for the company
 */
router.get('/dashboard', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) {
      return res.json({
        activeEmployees: 0,
        employeesByCountry: {},
        upcomingPayrolls: [],
        recentPayrolls: [],
        monthlyTotal: 0,
      });
    }

    // Get active employees count + by country
    const employeesResult = await pool.query(
      `SELECT COALESCE(e.country_code, 'US') as cc, COUNT(*) as count
       FROM employees e
       WHERE e.company_id = $1 AND e.status = 'active'
       GROUP BY COALESCE(e.country_code, 'US')`,
      [companyId]
    );

    let totalEmployees = 0;
    const employeesByCountry = {};
    for (const row of employeesResult.rows) {
      employeesByCountry[row.cc] = parseInt(row.count);
      totalEmployees += parseInt(row.count);
    }

    // Get upcoming payroll runs
    const upcomingResult = await pool.query(`
      SELECT pr.*, COUNT(pc.id) as employee_count
      FROM payroll_runs pr
      LEFT JOIN paychecks pc ON pr.id = pc.payroll_run_id
      WHERE pr.company_id = $1
        AND pr.pay_date >= CURRENT_DATE
        AND pr.status != 'cancelled'
      GROUP BY pr.id
      ORDER BY pr.pay_date ASC
      LIMIT 5
    `, [companyId]);

    // Get recent payroll history
    const recentResult = await pool.query(`
      SELECT pr.*, COUNT(pc.id) as employee_count
      FROM payroll_runs pr
      LEFT JOIN paychecks pc ON pr.id = pc.payroll_run_id
      WHERE pr.company_id = $1 AND pr.status = 'completed'
      GROUP BY pr.id
      ORDER BY pr.pay_date DESC
      LIMIT 5
    `, [companyId]);

    // Get monthly total (in USD — for mixed currencies, we just show the sum)
    const monthlyResult = await pool.query(`
      SELECT COALESCE(SUM(total_net), 0) as total
      FROM payroll_runs
      WHERE company_id = $1
        AND status = 'completed'
        AND pay_date >= DATE_TRUNC('month', CURRENT_DATE)
    `, [companyId]);

    res.json({
      activeEmployees: totalEmployees,
      employeesByCountry,
      upcomingPayrolls: upcomingResult.rows,
      recentPayrolls: recentResult.rows,
      monthlyTotal: parseFloat(monthlyResult.rows[0].total || 0),
    });
  } catch (err) {
    console.error('Payroll dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * POST /api/payroll/runs
 * Create a new payroll run — region-aware (US federal+FICA / India slabs+EPF)
 */
router.post('/runs', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) {
      return res.status(400).json({ error: 'No company associated with your account' });
    }

    const { pay_period_start, pay_period_end, pay_date, country_code } = req.body;
    // country_code: 'US', 'IN', or 'ALL' (mixed)
    const runCountry = country_code || 'ALL';
    const curr = getCurrency(runCountry === 'ALL' ? 'US' : runCountry);

    await client.query('BEGIN');

    // Create payroll run
    const runResult = await client.query(`
      INSERT INTO payroll_runs (
        employer_id, company_id, pay_period_start, pay_period_end, pay_date,
        status, country_code, currency_code, currency_symbol
      )
      VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8)
      RETURNING *
    `, [req.user.id, companyId, pay_period_start, pay_period_end, pay_date,
        runCountry === 'ALL' ? null : runCountry, curr.code, curr.symbol]);

    const payrollRun = runResult.rows[0];

    // Get active employees with payroll configs, filtered by country if specified
    let empQuery = `
      SELECT e.*, u.name, pc.*,
             COALESCE(pc.country_code, e.country_code, 'US') as emp_country,
             COALESCE(pc.currency_code, e.currency_code, 'USD') as emp_currency
      FROM employees e
      JOIN users u ON e.user_id = u.id
      JOIN payroll_configs pc ON e.id = pc.employee_id
      WHERE e.company_id = $1 AND e.status = 'active'
    `;
    const empParams = [companyId];

    if (runCountry !== 'ALL') {
      empQuery += ` AND COALESCE(pc.country_code, e.country_code, 'US') = $2`;
      empParams.push(runCountry);
    }

    const employeesResult = await client.query(empQuery, empParams);

    let totalGross = 0;
    let totalNet = 0;
    let totalTaxes = 0;

    // Generate paychecks for each employee — route to correct tax calculator
    for (const emp of employeesResult.rows) {
      const empCountry = emp.emp_country || 'US';
      const empCurrency = emp.emp_currency || 'USD';
      let paycheck;

      if (empCountry === 'US') {
        // US: Calculate YTD gross for SS/Medicare cap
        const ytdResult = await client.query(`
          SELECT COALESCE(SUM(gross_pay), 0) as ytd_gross
          FROM paychecks
          WHERE employee_id = $1
            AND EXTRACT(YEAR FROM pay_date) = EXTRACT(YEAR FROM $2::date)
        `, [emp.id, pay_date]);

        const ytdGross = parseFloat(ytdResult.rows[0].ytd_gross);

        paycheck = payrollCalculator.calculatePaycheck(
          emp, emp,
          emp.salary_type === 'hourly' ? 80 : null,
          ytdGross
        );

        // Insert US paycheck with typed columns
        await client.query(`
          INSERT INTO paychecks (
            payroll_run_id, employee_id, pay_period_start, pay_period_end,
            pay_date, hours_worked, gross_pay, federal_tax, state_tax,
            social_security, medicare, other_deductions, net_pay,
            country_code, currency_code, region_deductions, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'US', 'USD', '{}', 'pending')
        `, [
          payrollRun.id, emp.id, pay_period_start, pay_period_end, pay_date,
          paycheck.hoursWorked, paycheck.grossPay, paycheck.federalTax,
          paycheck.stateTax, paycheck.socialSecurity, paycheck.medicare,
          paycheck.otherDeductions, paycheck.netPay,
        ]);
      } else {
        // International: Use calculateInternationalPaycheck
        paycheck = payrollCalculator.calculateInternationalPaycheck(
          emp, emp, empCountry,
          emp.salary_type === 'hourly' ? (empCountry === 'IN' ? 176 : 80) : null
        );

        // Store international deductions in JSONB
        const regionDeductions = {};
        for (const [key, val] of Object.entries(paycheck)) {
          if (key !== 'grossPay' && key !== 'netPay' && key !== 'totalDeductions' &&
              key !== 'country' && key !== 'currency' && key !== 'note' &&
              key !== 'hoursWorked' && typeof val === 'number') {
            regionDeductions[key] = val;
          }
        }

        await client.query(`
          INSERT INTO paychecks (
            payroll_run_id, employee_id, pay_period_start, pay_period_end,
            pay_date, hours_worked, gross_pay, federal_tax, state_tax,
            social_security, medicare, other_deductions, net_pay,
            country_code, currency_code, region_deductions, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0, $8, $9, $10, $11, $12, 'pending')
        `, [
          payrollRun.id, emp.id, pay_period_start, pay_period_end, pay_date,
          paycheck.hoursWorked || null,
          paycheck.grossPay, paycheck.totalDeductions, paycheck.netPay,
          empCountry, empCurrency, JSON.stringify(regionDeductions),
        ]);
      }

      totalGross += paycheck.grossPay;
      totalNet += paycheck.netPay;
      totalTaxes += paycheck.totalDeductions;
    }

    // Update payroll run totals
    await client.query(`
      UPDATE payroll_runs
      SET total_gross = $1, total_net = $2, total_taxes = $3, updated_at = NOW()
      WHERE id = $4
    `, [totalGross, totalNet, totalTaxes, payrollRun.id]);

    await client.query('COMMIT');

    res.json({
      message: 'Payroll run created successfully',
      payrollRun: {
        ...payrollRun,
        total_gross: totalGross,
        total_net: totalNet,
        total_taxes: totalTaxes,
        employee_count: employeesResult.rows.length,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create payroll run error:', err);
    res.status(500).json({ error: 'Failed to create payroll run' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/payroll/runs
 * List all payroll runs for the company
 */
router.get('/runs', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) return res.json({ runs: [] });

    const result = await pool.query(`
      SELECT pr.*, COUNT(pc.id) as employee_count
      FROM payroll_runs pr
      LEFT JOIN paychecks pc ON pr.id = pc.payroll_run_id
      WHERE pr.company_id = $1
      GROUP BY pr.id
      ORDER BY pr.pay_date DESC
      LIMIT 50
    `, [companyId]);

    res.json({ runs: result.rows });
  } catch (err) {
    console.error('List payroll runs error:', err);
    res.status(500).json({ error: 'Failed to list payroll runs' });
  }
});

/**
 * GET /api/payroll/runs/:runId
 * Get details of a specific payroll run
 */
router.get('/runs/:runId', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  try {
    const { runId } = req.params;
    const companyId = getCompanyId(req.user);

    const runResult = await pool.query(
      'SELECT * FROM payroll_runs WHERE id = $1 AND company_id = $2',
      [runId, companyId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    const paychecksResult = await pool.query(`
      SELECT pc.*, e.employee_number, u.name as employee_name,
             COALESCE(pc.country_code, 'US') as pay_country,
             COALESCE(pc.currency_code, 'USD') as pay_currency,
             COALESCE(pc.region_deductions, '{}') as region_deductions
      FROM paychecks pc
      JOIN employees e ON pc.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      WHERE pc.payroll_run_id = $1
      ORDER BY u.name
    `, [runId]);

    res.json({
      payrollRun: runResult.rows[0],
      paychecks: paychecksResult.rows,
    });
  } catch (err) {
    console.error('Get payroll run error:', err);
    res.status(500).json({ error: 'Failed to fetch payroll run' });
  }
});

/**
 * POST /api/payroll/runs/:runId/process
 * Process and approve a payroll run
 */
router.post('/runs/:runId/process', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { runId } = req.params;
    const companyId = getCompanyId(req.user);

    await client.query('BEGIN');

    const updateResult = await client.query(`
      UPDATE payroll_runs
      SET status = 'completed', processed_at = NOW(), processed_by = $1, updated_at = NOW()
      WHERE id = $2 AND company_id = $3 AND status = 'draft'
      RETURNING id
    `, [req.user.id, runId, companyId]);

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payroll run not found or already processed' });
    }

    await client.query(`
      UPDATE paychecks
      SET status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE payroll_run_id = $1
    `, [runId]);

    await client.query('COMMIT');

    res.json({ message: 'Payroll processed successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Process payroll error:', err);
    res.status(500).json({ error: 'Failed to process payroll' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/payroll/runs/:runId/payslip/:paycheckId
 * Generate an HTML payslip for printing/PDF
 */
router.get('/runs/:runId/payslip/:paycheckId', authMiddleware, async (req, res) => {
  try {
    const { runId, paycheckId } = req.params;

    // Either employer or the employee themselves can view
    const result = await pool.query(`
      SELECT pc.*, e.employee_number, u.name as employee_name, u.email as employee_email,
             e.position, e.department,
             COALESCE(pc.country_code, 'US') as pay_country,
             COALESCE(pc.currency_code, 'USD') as pay_currency,
             COALESCE(pc.region_deductions, '{}') as region_deductions,
             pr.pay_period_start as run_period_start, pr.pay_period_end as run_period_end
      FROM paychecks pc
      JOIN payroll_runs pr ON pc.payroll_run_id = pr.id
      JOIN employees e ON pc.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      WHERE pc.id = $1 AND pr.id = $2
    `, [paycheckId, runId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    const pc = result.rows[0];

    // Check access: employer (has company_id) or employee (user_id matches)
    const isEmployer = req.user.company_id && req.user.role !== 'candidate';
    const isEmployee = pc.employee_id && (await pool.query('SELECT id FROM employees WHERE id = $1 AND user_id = $2', [pc.employee_id, req.user.id])).rows.length > 0;

    if (!isEmployer && !isEmployee) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const country = pc.pay_country;
    const curr = getCurrency(country);

    const fmtMoney = (amt) => {
      const num = Number(amt || 0);
      return `${curr.symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    // Build deductions rows
    let deductionRows = '';
    if (country === 'US') {
      deductionRows = `
        <tr><td>Federal Income Tax</td><td class="amt">-${fmtMoney(pc.federal_tax)}</td></tr>
        <tr><td>State Income Tax</td><td class="amt">-${fmtMoney(pc.state_tax)}</td></tr>
        <tr><td>Social Security (FICA)</td><td class="amt">-${fmtMoney(pc.social_security)}</td></tr>
        <tr><td>Medicare</td><td class="amt">-${fmtMoney(pc.medicare)}</td></tr>
      `;
      if (Number(pc.other_deductions) > 0) {
        deductionRows += `<tr><td>Other Deductions</td><td class="amt">-${fmtMoney(pc.other_deductions)}</td></tr>`;
      }
    } else if (country === 'IN') {
      const rd = typeof pc.region_deductions === 'string' ? JSON.parse(pc.region_deductions) : pc.region_deductions;
      deductionRows = `
        <tr><td>Income Tax (TDS)</td><td class="amt">-${fmtMoney(rd.incomeTax || 0)}</td></tr>
        <tr><td>Provident Fund (EPF 12%)</td><td class="amt">-${fmtMoney(rd.providentFund || 0)}</td></tr>
        <tr><td>ESI</td><td class="amt">-${fmtMoney(rd.esi || 0)}</td></tr>
        <tr><td>Professional Tax</td><td class="amt">-${fmtMoney(rd.professionalTax || 0)}</td></tr>
      `;
    } else {
      const rd = typeof pc.region_deductions === 'string' ? JSON.parse(pc.region_deductions) : pc.region_deductions;
      for (const [k, v] of Object.entries(rd)) {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
        deductionRows += `<tr><td>${label}</td><td class="amt">-${fmtMoney(v)}</td></tr>`;
      }
    }

    const totalDeductions = country === 'US'
      ? Number(pc.federal_tax) + Number(pc.state_tax) + Number(pc.social_security) + Number(pc.medicare) + Number(pc.other_deductions)
      : Number(pc.other_deductions);

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Payslip - ${pc.employee_name}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;margin:0;padding:40px;color:#1a1a2e;background:#fff}
  .payslip{max-width:700px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
  .header{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:24px 32px;display:flex;justify-content:space-between;align-items:center}
  .header h1{margin:0;font-size:20px;letter-spacing:-0.5px}
  .header .badge{background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:20px;font-size:12px}
  .body{padding:24px 32px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
  .meta-item{background:#f8fafc;border-radius:8px;padding:12px 16px}
  .meta-item label{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;display:block;margin-bottom:4px}
  .meta-item span{font-size:14px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;padding:8px 0;border-bottom:2px solid #e2e8f0}
  td{padding:8px 0;font-size:14px;border-bottom:1px solid #f1f5f9}
  .amt{text-align:right;font-variant-numeric:tabular-nums}
  .total-row td{border-top:2px solid #e2e8f0;font-weight:700;font-size:16px;padding-top:12px}
  .net-pay{background:#ecfdf5;border-radius:8px;padding:16px;text-align:center;margin-top:16px}
  .net-pay label{font-size:12px;color:#059669;text-transform:uppercase;letter-spacing:0.5px}
  .net-pay .amount{font-size:32px;font-weight:800;color:#059669;margin-top:4px}
  .footer{text-align:center;padding:16px;color:#94a3b8;font-size:11px;border-top:1px solid #f1f5f9}
  @media print{body{padding:0}.payslip{border:none;border-radius:0}}
</style>
</head><body>
<div class="payslip">
  <div class="header">
    <h1>Rekrut AI Payslip</h1>
    <span class="badge">${country === 'US' ? '🇺🇸 US' : country === 'IN' ? '🇮🇳 India' : country}</span>
  </div>
  <div class="body">
    <div class="meta">
      <div class="meta-item"><label>Employee</label><span>${pc.employee_name}</span></div>
      <div class="meta-item"><label>Employee ID</label><span>${pc.employee_number}</span></div>
      <div class="meta-item"><label>Pay Period</label><span>${new Date(pc.pay_period_start).toLocaleDateString()} – ${new Date(pc.pay_period_end).toLocaleDateString()}</span></div>
      <div class="meta-item"><label>Pay Date</label><span>${new Date(pc.pay_date).toLocaleDateString()}</span></div>
      ${pc.position ? `<div class="meta-item"><label>Position</label><span>${pc.position}</span></div>` : ''}
      ${pc.department ? `<div class="meta-item"><label>Department</label><span>${pc.department}</span></div>` : ''}
    </div>

    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:0 0 8px">Earnings</h3>
    <table>
      <tr><td>Gross Pay</td><td class="amt" style="font-weight:600">${fmtMoney(pc.gross_pay)}</td></tr>
      ${pc.hours_worked ? `<tr><td style="color:#64748b">Hours Worked</td><td class="amt">${pc.hours_worked}</td></tr>` : ''}
    </table>

    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin:16px 0 8px">Deductions</h3>
    <table>
      ${deductionRows}
      <tr class="total-row"><td>Total Deductions</td><td class="amt" style="color:#dc2626">-${fmtMoney(totalDeductions || pc.other_deductions)}</td></tr>
    </table>

    <div class="net-pay">
      <label>Net Pay</label>
      <div class="amount">${fmtMoney(pc.net_pay)}</div>
    </div>
  </div>
  <div class="footer">
    Generated by Rekrut AI · ${new Date().toLocaleDateString()} · This is a system-generated payslip
  </div>
</div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Payslip generation error:', err);
    res.status(500).json({ error: 'Failed to generate payslip' });
  }
});

// ============== PAY PERIODS ==============

/**
 * GET /api/payroll/pay-periods
 * Get pay periods for the company, optionally filtered by country
 */
router.get('/pay-periods', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) return res.json({ periods: [] });

    const { country_code } = req.query;

    let query = 'SELECT * FROM pay_periods WHERE company_id = $1';
    const params = [companyId];

    if (country_code) {
      query += ' AND country_code = $2';
      params.push(country_code);
    }

    query += ' ORDER BY period_start DESC LIMIT 24';

    const result = await pool.query(query, params);
    res.json({ periods: result.rows });
  } catch (err) {
    console.error('Get pay periods error:', err);
    res.status(500).json({ error: 'Failed to fetch pay periods' });
  }
});

/**
 * POST /api/payroll/pay-periods/generate
 * Auto-generate pay periods for a country
 */
router.post('/pay-periods/generate', authMiddleware, requireRole('employer', 'recruiter', 'hiring_manager', 'admin'), async (req, res) => {
  try {
    const companyId = getCompanyId(req.user);
    if (!companyId) return res.status(400).json({ error: 'No company' });

    const { country_code, months } = req.body;
    const cc = country_code || 'US';
    const monthCount = months || 3;
    const freq = PAY_FREQ_DEFAULTS[cc] || 'bi-weekly';
    const periods = [];

    const now = new Date();
    let current = new Date(now.getFullYear(), now.getMonth(), 1);

    if (freq === 'monthly') {
      // Monthly: 1st to last day of month, paid on last day
      for (let i = 0; i < monthCount; i++) {
        const start = new Date(current);
        const end = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        const payDate = new Date(end);
        periods.push({ start, end, payDate });
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      }
    } else {
      // Bi-weekly: 14-day periods
      // Find the most recent Monday
      const day = current.getDay();
      const monday = new Date(current);
      monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));

      for (let i = 0; i < monthCount * 2; i++) {
        const start = new Date(monday);
        start.setDate(start.getDate() + i * 14);
        const end = new Date(start);
        end.setDate(end.getDate() + 13);
        const payDate = new Date(end);
        payDate.setDate(payDate.getDate() + 5); // Pay 5 days after period end
        periods.push({ start, end, payDate });
      }
    }

    // Insert periods
    for (const p of periods) {
      await pool.query(`
        INSERT INTO pay_periods (company_id, country_code, period_type, period_start, period_end, pay_date)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [companyId, cc, freq, p.start, p.end, p.payDate]);
    }

    res.json({ message: `Generated ${periods.length} pay periods`, count: periods.length });
  } catch (err) {
    console.error('Generate pay periods error:', err);
    res.status(500).json({ error: 'Failed to generate pay periods' });
  }
});

// ============== EMPLOYEE SELF-SERVICE ==============

/**
 * GET /api/payroll/employee/profile
 * Get employee's payroll profile
 */
router.get('/employee/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, pc.*,
             u.name as employer_name,
             COALESCE(pc.country_code, e.country_code, 'US') as pay_country,
             COALESCE(pc.currency_code, e.currency_code, 'USD') as pay_currency
      FROM employees e
      LEFT JOIN payroll_configs pc ON e.id = pc.employee_id
      LEFT JOIN users u ON e.employer_id = u.id
      WHERE e.user_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    res.json({ profile: result.rows[0] });
  } catch (err) {
    console.error('Get employee profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * GET /api/payroll/employee/paychecks
 * Get employee's paycheck history
 */
router.get('/employee/paychecks', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pc.*, pr.status as payroll_status,
             COALESCE(pc.country_code, 'US') as pay_country,
             COALESCE(pc.currency_code, 'USD') as pay_currency,
             COALESCE(pc.region_deductions, '{}') as region_deductions
      FROM paychecks pc
      JOIN payroll_runs pr ON pc.payroll_run_id = pr.id
      JOIN employees e ON pc.employee_id = e.id
      WHERE e.user_id = $1
      ORDER BY pc.pay_date DESC
      LIMIT 50
    `, [req.user.id]);

    res.json({ paychecks: result.rows });
  } catch (err) {
    console.error('Get paychecks error:', err);
    res.status(500).json({ error: 'Failed to fetch paychecks' });
  }
});

/**
 * GET /api/payroll/employee/paychecks/:paycheckId
 * Get detailed pay stub for a specific paycheck
 */
router.get('/employee/paychecks/:paycheckId', authMiddleware, async (req, res) => {
  try {
    const { paycheckId } = req.params;

    const result = await pool.query(`
      SELECT pc.*, e.employee_number, u.name as employee_name,
             emp.name as employer_name, emp.company_name,
             COALESCE(pc.country_code, 'US') as pay_country,
             COALESCE(pc.currency_code, 'USD') as pay_currency,
             COALESCE(pc.region_deductions, '{}') as region_deductions
      FROM paychecks pc
      JOIN employees e ON pc.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      JOIN users emp ON e.employer_id = emp.id
      WHERE pc.id = $1 AND e.user_id = $2
    `, [paycheckId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paycheck not found' });
    }

    res.json({ paycheck: result.rows[0] });
  } catch (err) {
    console.error('Get paycheck detail error:', err);
    res.status(500).json({ error: 'Failed to fetch paycheck' });
  }
});

/**
 * POST /api/payroll/employee/bank-account
 * Update employee's bank account for direct deposit
 */
router.post('/employee/bank-account', authMiddleware, async (req, res) => {
  try {
    const { bank_name, bank_account_last4, bank_routing_number } = req.body;

    await pool.query(`
      UPDATE payroll_configs pc
      SET
        bank_name = $1,
        bank_account_last4 = $2,
        bank_routing_number = $3,
        payment_method = 'direct_deposit',
        updated_at = NOW()
      FROM employees e
      WHERE pc.employee_id = e.id AND e.user_id = $4
    `, [bank_name, bank_account_last4, bank_routing_number, req.user.id]);

    res.json({ message: 'Bank account updated successfully' });
  } catch (err) {
    console.error('Update bank account error:', err);
    res.status(500).json({ error: 'Failed to update bank account' });
  }
});

module.exports = router;
