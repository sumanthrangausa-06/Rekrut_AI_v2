const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const { requireAuth, requireRole } = require('../lib/auth');
const payrollCalculator = require('../services/payroll-calculator');

// ============== EMPLOYER ENDPOINTS ==============

/**
 * GET /api/payroll/employees
 * Get all employees for the employer's payroll
 */
router.get('/employees', requireAuth, requireRole('employer'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.*,
        u.name as employee_name,
        u.email as employee_email,
        pc.salary_type,
        pc.salary_amount,
        pc.pay_frequency,
        pc.payment_method
      FROM employees e
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN payroll_configs pc ON e.id = pc.employee_id
      WHERE e.employer_id = $1 AND e.status = 'active'
      ORDER BY u.name
    `, [req.user.id]);

    res.json({ employees: result.rows });
  } catch (err) {
    console.error('Get employees error:', err);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

/**
 * POST /api/payroll/employees/:employeeId/onboard
 * Complete employee onboarding with payroll setup
 */
router.post('/employees/:employeeId/onboard', requireAuth, requireRole('employer'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { employeeId } = req.params;
    const {
      salary_type,
      salary_amount,
      pay_frequency,
      payment_method,
      bank_name,
      bank_account_last4,
      tax_filing_status,
      federal_allowances,
      state_allowances
    } = req.body;

    await client.query('BEGIN');

    // Verify employee belongs to this employer
    const empCheck = await client.query(
      'SELECT id FROM employees WHERE id = $1 AND employer_id = $2',
      [employeeId, req.user.id]
    );

    if (empCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Create or update payroll config
    await client.query(`
      INSERT INTO payroll_configs (
        employee_id, salary_type, salary_amount, pay_frequency,
        payment_method, bank_name, bank_account_last4,
        tax_filing_status, federal_allowances, state_allowances
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        updated_at = NOW()
    `, [
      employeeId, salary_type, salary_amount, pay_frequency,
      payment_method, bank_name, bank_account_last4,
      tax_filing_status, federal_allowances, state_allowances
    ]);

    await client.query('COMMIT');
    res.json({ message: 'Employee onboarded successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Onboard employee error:', err);
    res.status(500).json({ error: 'Failed to onboard employee' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/payroll/dashboard
 * Get payroll dashboard overview for employer
 */
router.get('/dashboard', requireAuth, requireRole('employer'), async (req, res) => {
  try {
    // Get active employees count
    const employeesResult = await pool.query(
      'SELECT COUNT(*) as count FROM employees WHERE employer_id = $1 AND status = $2',
      [req.user.id, 'active']
    );

    // Get upcoming payroll runs
    const upcomingResult = await pool.query(`
      SELECT pr.*, COUNT(pc.id) as employee_count
      FROM payroll_runs pr
      LEFT JOIN paychecks pc ON pr.id = pc.payroll_run_id
      WHERE pr.employer_id = $1
        AND pr.pay_date >= CURRENT_DATE
        AND pr.status != 'cancelled'
      GROUP BY pr.id
      ORDER BY pr.pay_date ASC
      LIMIT 3
    `, [req.user.id]);

    // Get recent payroll history
    const recentResult = await pool.query(`
      SELECT pr.*, COUNT(pc.id) as employee_count
      FROM payroll_runs pr
      LEFT JOIN paychecks pc ON pr.id = pc.payroll_run_id
      WHERE pr.employer_id = $1 AND pr.status = 'completed'
      GROUP BY pr.id
      ORDER BY pr.pay_date DESC
      LIMIT 5
    `, [req.user.id]);

    // Get monthly total
    const monthlyResult = await pool.query(`
      SELECT COALESCE(SUM(total_net), 0) as total
      FROM payroll_runs
      WHERE employer_id = $1
        AND status = 'completed'
        AND pay_date >= DATE_TRUNC('month', CURRENT_DATE)
    `, [req.user.id]);

    res.json({
      activeEmployees: parseInt(employeesResult.rows[0].count),
      upcomingPayrolls: upcomingResult.rows,
      recentPayrolls: recentResult.rows,
      monthlyTotal: parseFloat(monthlyResult.rows[0].total || 0)
    });
  } catch (err) {
    console.error('Payroll dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * POST /api/payroll/runs
 * Create a new payroll run
 */
router.post('/runs', requireAuth, requireRole('employer'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { pay_period_start, pay_period_end, pay_date } = req.body;

    await client.query('BEGIN');

    // Create payroll run
    const runResult = await client.query(`
      INSERT INTO payroll_runs (
        employer_id, pay_period_start, pay_period_end, pay_date, status
      )
      VALUES ($1, $2, $3, $4, 'draft')
      RETURNING *
    `, [req.user.id, pay_period_start, pay_period_end, pay_date]);

    const payrollRun = runResult.rows[0];

    // Get all active employees with payroll configs
    const employeesResult = await client.query(`
      SELECT e.*, u.name, pc.*
      FROM employees e
      JOIN users u ON e.user_id = u.id
      JOIN payroll_configs pc ON e.id = pc.employee_id
      WHERE e.employer_id = $1 AND e.status = 'active'
    `, [req.user.id]);

    let totalGross = 0;
    let totalNet = 0;
    let totalTaxes = 0;

    // Generate paychecks for each employee
    for (const emp of employeesResult.rows) {
      // Calculate YTD gross for tax calculations
      const ytdResult = await client.query(`
        SELECT COALESCE(SUM(gross_pay), 0) as ytd_gross
        FROM paychecks
        WHERE employee_id = $1
          AND EXTRACT(YEAR FROM pay_date) = EXTRACT(YEAR FROM $2::date)
      `, [emp.id, pay_date]);

      const ytdGross = parseFloat(ytdResult.rows[0].ytd_gross);

      // Calculate paycheck
      const paycheck = payrollCalculator.calculatePaycheck(
        emp,
        emp,
        emp.salary_type === 'hourly' ? 80 : null, // Default 80 hours for hourly
        ytdGross
      );

      // Insert paycheck
      await client.query(`
        INSERT INTO paychecks (
          payroll_run_id, employee_id, pay_period_start, pay_period_end,
          pay_date, hours_worked, gross_pay, federal_tax, state_tax,
          social_security, medicare, other_deductions, net_pay, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
      `, [
        payrollRun.id, emp.id, pay_period_start, pay_period_end, pay_date,
        paycheck.hoursWorked, paycheck.grossPay, paycheck.federalTax,
        paycheck.stateTax, paycheck.socialSecurity, paycheck.medicare,
        paycheck.otherDeductions, paycheck.netPay
      ]);

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
      payrollRun: { ...payrollRun, total_gross: totalGross, total_net: totalNet, total_taxes: totalTaxes }
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
 * GET /api/payroll/runs/:runId
 * Get details of a specific payroll run
 */
router.get('/runs/:runId', requireAuth, requireRole('employer'), async (req, res) => {
  try {
    const { runId } = req.params;

    // Get payroll run
    const runResult = await pool.query(
      'SELECT * FROM payroll_runs WHERE id = $1 AND employer_id = $2',
      [runId, req.user.id]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    // Get paychecks for this run
    const paychecksResult = await pool.query(`
      SELECT pc.*, e.employee_number, u.name as employee_name
      FROM paychecks pc
      JOIN employees e ON pc.employee_id = e.id
      JOIN users u ON e.user_id = u.id
      WHERE pc.payroll_run_id = $1
      ORDER BY u.name
    `, [runId]);

    res.json({
      payrollRun: runResult.rows[0],
      paychecks: paychecksResult.rows
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
router.post('/runs/:runId/process', requireAuth, requireRole('employer'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { runId } = req.params;

    await client.query('BEGIN');

    // Update payroll run status
    await client.query(`
      UPDATE payroll_runs
      SET status = 'completed', processed_at = NOW(), processed_by = $1, updated_at = NOW()
      WHERE id = $2 AND employer_id = $3 AND status = 'draft'
    `, [req.user.id, runId, req.user.id]);

    // Update all paychecks in this run
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

// ============== EMPLOYEE ENDPOINTS ==============

/**
 * GET /api/payroll/employee/profile
 * Get employee's payroll profile
 */
router.get('/employee/profile', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, pc.*, u.name as employer_name
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
router.get('/employee/paychecks', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pc.*, pr.status as payroll_status
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
router.get('/employee/paychecks/:paycheckId', requireAuth, async (req, res) => {
  try {
    const { paycheckId } = req.params;

    const result = await pool.query(`
      SELECT pc.*, e.employee_number, u.name as employee_name,
             emp.name as employer_name, emp.company_name
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
router.post('/employee/bank-account', requireAuth, async (req, res) => {
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
