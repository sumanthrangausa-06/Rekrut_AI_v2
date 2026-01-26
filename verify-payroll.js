/**
 * Payroll Integration Verification
 * Tests the payroll calculator and basic flow
 */

const payrollCalculator = require('./services/payroll-calculator');

console.log('=== Verifying Payroll Integration ===\n');

// Test 1: Calculate hourly paycheck
console.log('Test 1: Hourly Employee Paycheck');
const hourlyConfig = {
  salary_type: 'hourly',
  salary_amount: 25.00,
  pay_frequency: 'bi-weekly',
  tax_filing_status: 'single',
  federal_allowances: 0,
  additional_withholding: 0
};

const hourlyPaycheck = payrollCalculator.calculatePaycheck(
  { name: 'Test Employee' },
  hourlyConfig,
  80, // hours worked
  0 // ytd gross
);

console.log('Hours: 80, Rate: $25/hr');
console.log('Gross Pay:', `$${hourlyPaycheck.grossPay}`);
console.log('Federal Tax:', `$${hourlyPaycheck.federalTax}`);
console.log('State Tax:', `$${hourlyPaycheck.stateTax}`);
console.log('Social Security:', `$${hourlyPaycheck.socialSecurity}`);
console.log('Medicare:', `$${hourlyPaycheck.medicare}`);
console.log('Net Pay:', `$${hourlyPaycheck.netPay}`);
console.log('✓ Hourly calculation successful\n');

// Test 2: Calculate salary paycheck
console.log('Test 2: Salaried Employee Paycheck');
const salaryConfig = {
  salary_type: 'salary',
  salary_amount: 75000, // annual
  pay_frequency: 'bi-weekly',
  tax_filing_status: 'single',
  federal_allowances: 0,
  additional_withholding: 0
};

const salaryPaycheck = payrollCalculator.calculatePaycheck(
  { name: 'Test Employee' },
  salaryConfig,
  null,
  0
);

console.log('Annual Salary: $75,000 (bi-weekly)');
console.log('Gross Pay:', `$${salaryPaycheck.grossPay}`);
console.log('Federal Tax:', `$${salaryPaycheck.federalTax}`);
console.log('State Tax:', `$${salaryPaycheck.stateTax}`);
console.log('Social Security:', `$${salaryPaycheck.socialSecurity}`);
console.log('Medicare:', `$${salaryPaycheck.medicare}`);
console.log('Net Pay:', `$${salaryPaycheck.netPay}`);
console.log('✓ Salary calculation successful\n');

// Test 3: Verify tax calculations are reasonable
console.log('Test 3: Tax Calculation Validation');
const grossPay = salaryPaycheck.grossPay;
const totalTax = salaryPaycheck.federalTax + salaryPaycheck.stateTax +
                 salaryPaycheck.socialSecurity + salaryPaycheck.medicare;
const effectiveTaxRate = (totalTax / grossPay * 100).toFixed(2);

console.log(`Effective Tax Rate: ${effectiveTaxRate}%`);

if (effectiveTaxRate >= 15 && effectiveTaxRate <= 35) {
  console.log('✓ Tax rate is within reasonable bounds (15-35%)\n');
} else {
  console.error('❌ Tax rate seems incorrect:', effectiveTaxRate);
  process.exit(1);
}

// Test 4: Verify routes are loaded
console.log('Test 4: Verifying Route Modules');
try {
  const payrollRoutes = require('./routes/payroll');
  console.log('✓ Payroll routes module loaded successfully\n');
} catch (err) {
  console.error('❌ Failed to load payroll routes:', err.message);
  process.exit(1);
}

// Test 5: Verify migration files exist
console.log('Test 5: Verifying Migration Files');
const fs = require('fs');
const migrations = fs.readdirSync('./migrations').filter(f => f.includes('payroll'));
console.log(`Found ${migrations.length} payroll-related migration files:`);
migrations.forEach(m => console.log(`  - ${m}`));

if (migrations.length > 0) {
  console.log('✓ Migration files present\n');
} else {
  console.error('❌ No payroll migration files found');
  process.exit(1);
}

console.log('=== All Payroll Verification Tests Passed ✓ ===');
