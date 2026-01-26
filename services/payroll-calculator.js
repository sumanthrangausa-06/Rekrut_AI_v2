/**
 * Payroll Calculator Service
 * Handles salary calculations, tax withholding, and paycheck generation
 */

// 2026 Federal Tax Brackets (Single)
const FEDERAL_TAX_BRACKETS = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 }
];

// Social Security and Medicare rates
const SOCIAL_SECURITY_RATE = 0.062;
const SOCIAL_SECURITY_WAGE_BASE = 168600; // 2026 limit
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009; // Additional 0.9% over $200k

/**
 * Calculate gross pay based on salary configuration
 */
function calculateGrossPay(config, hoursWorked = null) {
  const { salary_type, salary_amount, pay_frequency } = config;

  if (salary_type === 'hourly' && hoursWorked) {
    return hoursWorked * parseFloat(salary_amount);
  }

  // Salary - divide by pay periods per year
  const periodsPerYear = {
    'weekly': 52,
    'bi-weekly': 26,
    'semi-monthly': 24,
    'monthly': 12
  };

  const periods = periodsPerYear[pay_frequency] || 26;
  return parseFloat(salary_amount) / periods;
}

/**
 * Calculate federal income tax withholding
 */
function calculateFederalTax(grossPay, filingStatus = 'single', allowances = 0) {
  // Annualize the gross pay (assuming bi-weekly)
  const annualizedGross = grossPay * 26;

  // Standard deduction for 2026 (simplified)
  const standardDeduction = filingStatus === 'single' ? 14600 : 29200;
  const allowanceAmount = allowances * 4700; // Per allowance

  let taxableIncome = Math.max(0, annualizedGross - standardDeduction - allowanceAmount);

  // Calculate tax using brackets
  let tax = 0;
  for (let bracket of FEDERAL_TAX_BRACKETS) {
    if (taxableIncome <= bracket.min) break;

    const taxableInBracket = Math.min(
      taxableIncome - bracket.min,
      bracket.max - bracket.min
    );

    tax += taxableInBracket * bracket.rate;
  }

  // Convert annual tax back to pay period
  return tax / 26;
}

/**
 * Calculate state income tax (simplified - using CA as example)
 */
function calculateStateTax(grossPay, state = 'CA') {
  // Simplified state tax calculation (using CA as example: ~5% average)
  // In production, this would use actual state tax tables
  const stateRates = {
    'CA': 0.05,
    'NY': 0.045,
    'TX': 0.00,
    'FL': 0.00,
    'WA': 0.00
  };

  const rate = stateRates[state] || 0.04;
  return grossPay * rate;
}

/**
 * Calculate Social Security tax
 */
function calculateSocialSecurity(grossPay, ytdGross = 0) {
  const remaining = Math.max(0, SOCIAL_SECURITY_WAGE_BASE - ytdGross);
  const taxableAmount = Math.min(grossPay, remaining);
  return taxableAmount * SOCIAL_SECURITY_RATE;
}

/**
 * Calculate Medicare tax
 */
function calculateMedicare(grossPay, ytdGross = 0) {
  let medicare = grossPay * MEDICARE_RATE;

  // Additional Medicare tax on income over $200k
  const thresholdRemaining = Math.max(0, 200000 - ytdGross);
  if (grossPay > thresholdRemaining) {
    const additionalTaxableAmount = grossPay - thresholdRemaining;
    medicare += additionalTaxableAmount * ADDITIONAL_MEDICARE_RATE;
  }

  return medicare;
}

/**
 * Calculate complete paycheck
 */
function calculatePaycheck(employee, config, hoursWorked = null, ytdGross = 0) {
  const grossPay = calculateGrossPay(config, hoursWorked);

  const federalTax = calculateFederalTax(
    grossPay,
    config.tax_filing_status,
    config.federal_allowances
  );

  const stateTax = calculateStateTax(grossPay, 'CA'); // Default to CA for now

  const socialSecurity = calculateSocialSecurity(grossPay, ytdGross);
  const medicare = calculateMedicare(grossPay, ytdGross);

  const additionalWithholding = parseFloat(config.additional_withholding || 0);

  const totalDeductions =
    federalTax +
    stateTax +
    socialSecurity +
    medicare +
    additionalWithholding;

  const netPay = grossPay - totalDeductions;

  return {
    grossPay: parseFloat(grossPay.toFixed(2)),
    federalTax: parseFloat(federalTax.toFixed(2)),
    stateTax: parseFloat(stateTax.toFixed(2)),
    socialSecurity: parseFloat(socialSecurity.toFixed(2)),
    medicare: parseFloat(medicare.toFixed(2)),
    otherDeductions: parseFloat(additionalWithholding.toFixed(2)),
    totalDeductions: parseFloat(totalDeductions.toFixed(2)),
    netPay: parseFloat(netPay.toFixed(2)),
    hoursWorked: hoursWorked
  };
}

/**
 * Generate pay stub content
 */
function generatePayStub(employee, paycheck, payPeriod) {
  return {
    employeeName: employee.name,
    employeeNumber: employee.employee_number,
    payPeriod: `${payPeriod.start} - ${payPeriod.end}`,
    payDate: payPeriod.payDate,
    grossPay: paycheck.grossPay,
    deductions: {
      federalIncomeTax: paycheck.federalTax,
      stateIncomeTax: paycheck.stateTax,
      socialSecurity: paycheck.socialSecurity,
      medicare: paycheck.medicare,
      other: paycheck.otherDeductions
    },
    netPay: paycheck.netPay,
    hoursWorked: paycheck.hoursWorked
  };
}

module.exports = {
  calculateGrossPay,
  calculateFederalTax,
  calculateStateTax,
  calculateSocialSecurity,
  calculateMedicare,
  calculatePaycheck,
  generatePayStub
};
