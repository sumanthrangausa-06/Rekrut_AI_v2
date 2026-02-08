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
 * Calculate paycheck for non-US countries
 * Uses simplified models per country (production would integrate actual tax APIs)
 */
function calculateInternationalPaycheck(employee, config, countryCode, hoursWorked = null) {
  const grossPay = calculateGrossPay(config, hoursWorked);

  const calculators = {
    // India: Income tax slabs + PF + ESI
    IN: () => {
      const annualized = grossPay * 12;
      let incomeTax = 0;
      // New Tax Regime (2025-26)
      const slabs = [
        { min: 0, max: 300000, rate: 0 },
        { min: 300000, max: 700000, rate: 0.05 },
        { min: 700000, max: 1000000, rate: 0.10 },
        { min: 1000000, max: 1200000, rate: 0.15 },
        { min: 1200000, max: 1500000, rate: 0.20 },
        { min: 1500000, max: Infinity, rate: 0.30 },
      ];
      for (const slab of slabs) {
        if (annualized <= slab.min) break;
        incomeTax += Math.min(annualized - slab.min, slab.max - slab.min) * slab.rate;
      }
      const monthlyTax = incomeTax / 12;
      const pfEmployee = grossPay * 0.12; // 12% employee PF
      const esiEmployee = grossPay <= 21000 ? grossPay * 0.0075 : 0; // 0.75% ESI
      const professionalTax = 200; // Max ₹200/month in most states
      const totalDeductions = monthlyTax + pfEmployee + esiEmployee + professionalTax;
      return {
        grossPay: parseFloat(grossPay.toFixed(2)),
        incomeTax: parseFloat(monthlyTax.toFixed(2)),
        providentFund: parseFloat(pfEmployee.toFixed(2)),
        esi: parseFloat(esiEmployee.toFixed(2)),
        professionalTax,
        totalDeductions: parseFloat(totalDeductions.toFixed(2)),
        netPay: parseFloat((grossPay - totalDeductions).toFixed(2)),
        country: 'IN', currency: 'INR',
      };
    },
    // UK: PAYE + National Insurance
    GB: () => {
      const annualized = grossPay * 12;
      const personalAllowance = 12570;
      const taxable = Math.max(0, annualized - personalAllowance);
      let incomeTax = 0;
      if (taxable <= 37700) incomeTax = taxable * 0.20;
      else if (taxable <= 125140) incomeTax = 37700 * 0.20 + (taxable - 37700) * 0.40;
      else incomeTax = 37700 * 0.20 + (125140 - 37700) * 0.40 + (taxable - 125140) * 0.45;
      const monthlyTax = incomeTax / 12;
      // NI Class 1: 8% on earnings between £12,570-£50,270, 2% above
      const niThreshold = 12570 / 12;
      const niUpper = 50270 / 12;
      let ni = 0;
      if (grossPay > niThreshold) ni = Math.min(grossPay - niThreshold, niUpper - niThreshold) * 0.08;
      if (grossPay > niUpper) ni += (grossPay - niUpper) * 0.02;
      const totalDeductions = monthlyTax + ni;
      return {
        grossPay: parseFloat(grossPay.toFixed(2)),
        incomeTax: parseFloat(monthlyTax.toFixed(2)),
        nationalInsurance: parseFloat(ni.toFixed(2)),
        totalDeductions: parseFloat(totalDeductions.toFixed(2)),
        netPay: parseFloat((grossPay - totalDeductions).toFixed(2)),
        country: 'GB', currency: 'GBP',
      };
    },
    // Canada: Federal + Provincial tax + CPP + EI
    CA: () => {
      const annualized = grossPay * (config.pay_frequency === 'monthly' ? 12 : 26);
      const basicPersonal = 15705;
      const taxable = Math.max(0, annualized - basicPersonal);
      let federalTax = 0;
      const brackets = [
        { min: 0, max: 55867, rate: 0.15 },
        { min: 55867, max: 111733, rate: 0.205 },
        { min: 111733, max: 154906, rate: 0.26 },
        { min: 154906, max: 220000, rate: 0.29 },
        { min: 220000, max: Infinity, rate: 0.33 },
      ];
      for (const b of brackets) {
        if (taxable <= b.min) break;
        federalTax += Math.min(taxable - b.min, b.max - b.min) * b.rate;
      }
      const periods = config.pay_frequency === 'monthly' ? 12 : 26;
      const periodTax = federalTax / periods;
      const provincialTax = periodTax * 0.5; // Simplified: ~50% of federal
      const cpp = Math.min(grossPay * 0.0595, 3867.50 / periods);
      const ei = Math.min(grossPay * 0.0166, 1049.12 / periods);
      const totalDeductions = periodTax + provincialTax + cpp + ei;
      return {
        grossPay: parseFloat(grossPay.toFixed(2)),
        federalTax: parseFloat(periodTax.toFixed(2)),
        provincialTax: parseFloat(provincialTax.toFixed(2)),
        cpp: parseFloat(cpp.toFixed(2)),
        ei: parseFloat(ei.toFixed(2)),
        totalDeductions: parseFloat(totalDeductions.toFixed(2)),
        netPay: parseFloat((grossPay - totalDeductions).toFixed(2)),
        country: 'CA', currency: 'CAD',
      };
    },
  };

  if (calculators[countryCode]) return calculators[countryCode]();

  // Fallback: simple flat 25% estimated tax
  const estimatedTax = grossPay * 0.25;
  return {
    grossPay: parseFloat(grossPay.toFixed(2)),
    estimatedTax: parseFloat(estimatedTax.toFixed(2)),
    totalDeductions: parseFloat(estimatedTax.toFixed(2)),
    netPay: parseFloat((grossPay - estimatedTax).toFixed(2)),
    country: countryCode, currency: 'USD',
    note: 'Estimated tax calculation. Consult local tax authority for exact figures.',
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
  calculateInternationalPaycheck,
  generatePayStub
};
