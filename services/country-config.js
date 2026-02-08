/**
 * Country Configuration Service
 * Central service for all country-specific logic:
 * - Currency formatting
 * - Document requirements
 * - Tax system rules
 * - Employment model defaults
 * - Date formatting
 */

const pool = require('../lib/db');

// In-memory cache (refreshed on demand)
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * Get all active country configs (cached)
 */
async function getAllCountries() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  const result = await pool.query(
    'SELECT * FROM country_configs WHERE is_active = true ORDER BY country_name'
  );
  _cache = result.rows;
  _cacheTime = Date.now();
  return _cache;
}

/**
 * Get single country config
 */
async function getCountry(countryCode) {
  const countries = await getAllCountries();
  return countries.find(c => c.country_code === countryCode) || null;
}

/**
 * Get onboarding document types for a country (from DB)
 */
async function getOnboardingDocs(countryCode) {
  const result = await pool.query(
    `SELECT * FROM country_document_types
     WHERE country_code = $1
     ORDER BY wizard_step, id`,
    [countryCode]
  );
  return result.rows;
}

/**
 * Get wizard steps for a country's onboarding
 * Groups documents by wizard_step and returns step definitions
 */
async function getWizardSteps(countryCode) {
  const docs = await getOnboardingDocs(countryCode);
  const country = await getCountry(countryCode);
  if (!country) return [];

  // Group by wizard_step
  const stepMap = {};
  for (const doc of docs) {
    const step = doc.wizard_step;
    if (!stepMap[step]) stepMap[step] = [];
    stepMap[step].push(doc);
  }

  // Build step definitions per country
  const stepDefs = COUNTRY_WIZARD_STEPS[countryCode] || COUNTRY_WIZARD_STEPS['_default'];
  return stepDefs.map((def, idx) => ({
    ...def,
    id: idx + 1,
    documents: stepMap[idx + 1] || [],
    country_code: countryCode
  }));
}

/**
 * Format currency value for a country
 */
function formatCurrency(amount, currencyCode = 'USD', currencySymbol = '$') {
  const num = parseFloat(amount);
  if (isNaN(num)) return `${currencySymbol}0`;

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: currencyCode === 'JPY' ? 0 : 0,
    maximumFractionDigits: currencyCode === 'JPY' ? 0 : 0,
  });

  // Place symbol based on convention
  const symbolAfter = ['SEK', 'NOK', 'DKK', 'PLN', 'CZK'];
  if (symbolAfter.includes(currencyCode)) {
    return `${formatted} ${currencySymbol}`;
  }
  return `${currencySymbol}${formatted}`;
}

/**
 * Format salary range for display
 */
function formatSalaryRange(min, max, currencyCode = 'USD', currencySymbol = '$') {
  if (min && max) {
    return `${formatCurrency(min, currencyCode, currencySymbol)} - ${formatCurrency(max, currencyCode, currencySymbol)}`;
  }
  if (min) return `From ${formatCurrency(min, currencyCode, currencySymbol)}`;
  if (max) return `Up to ${formatCurrency(max, currencyCode, currencySymbol)}`;
  return 'Not specified';
}

/**
 * Wizard step definitions per country
 * Each step has: label, icon name, description
 */
const COUNTRY_WIZARD_STEPS = {
  US: [
    { label: 'I-9 Form', icon: 'Globe', description: 'Employment eligibility verification (USCIS)' },
    { label: 'W-4 Tax Form', icon: 'Receipt', description: 'Federal tax withholding (IRS)' },
    { label: 'Banking & Contact', icon: 'Building2', description: 'Direct deposit & emergency contact' },
    { label: 'Employee Handbook', icon: 'FileText', description: 'Company policies acknowledgment' },
    { label: 'Review & Sign', icon: 'PenTool', description: 'Review all documents & e-sign' },
  ],
  IN: [
    { label: 'PAN & Aadhaar', icon: 'Shield', description: 'PAN card and Aadhaar verification' },
    { label: 'PF & ESI', icon: 'Receipt', description: 'Provident Fund & insurance declarations' },
    { label: 'Gratuity & Banking', icon: 'Building2', description: 'Gratuity nomination & bank details' },
    { label: 'Employee Handbook', icon: 'FileText', description: 'Company policies acknowledgment' },
    { label: 'Review & Sign', icon: 'PenTool', description: 'Review all documents & e-sign' },
  ],
  GB: [
    { label: 'Right to Work', icon: 'Shield', description: 'UK right to work verification' },
    { label: 'Tax & NI', icon: 'Receipt', description: 'P45/Starter checklist & National Insurance' },
    { label: 'Banking & Contact', icon: 'Building2', description: 'Bank details & emergency contact' },
    { label: 'Employee Handbook', icon: 'FileText', description: 'Company policies acknowledgment' },
    { label: 'Review & Sign', icon: 'PenTool', description: 'Review all documents & e-sign' },
  ],
  CA: [
    { label: 'TD1 Tax Forms', icon: 'Receipt', description: 'Federal & provincial tax credits' },
    { label: 'SIN Collection', icon: 'Shield', description: 'Social Insurance Number' },
    { label: 'Banking & Contact', icon: 'Building2', description: 'Bank details & emergency contact' },
    { label: 'Employee Handbook', icon: 'FileText', description: 'Company policies acknowledgment' },
    { label: 'Review & Sign', icon: 'PenTool', description: 'Review all documents & e-sign' },
  ],
  DE: [
    { label: 'GDPR & Tax ID', icon: 'Shield', description: 'Data consent & Steuer-ID' },
    { label: 'Social Insurance', icon: 'Receipt', description: 'Social insurance & work permit' },
    { label: 'Banking (IBAN)', icon: 'Building2', description: 'IBAN for salary transfers' },
    { label: 'Employee Handbook', icon: 'FileText', description: 'Company policies' },
    { label: 'Review & Sign', icon: 'PenTool', description: 'Review all documents & e-sign' },
  ],
  _default: [
    { label: 'Identity & Tax', icon: 'Shield', description: 'Identity verification & tax information' },
    { label: 'Compliance', icon: 'Receipt', description: 'Country-specific compliance forms' },
    { label: 'Banking & Contact', icon: 'Building2', description: 'Bank details & emergency contact' },
    { label: 'Employee Handbook', icon: 'FileText', description: 'Company policies' },
    { label: 'Review & Sign', icon: 'PenTool', description: 'Review all documents & e-sign' },
  ],
};

/**
 * Get the AI prompt context for generating onboarding documents in a specific country
 */
function getCountryDocPromptContext(countryCode) {
  const contexts = {
    US: `You are generating US employment documents. Follow USCIS I-9 (Edition 01/20/2025) and IRS W-4 (2025) specifications exactly. Use US date format (MM/DD/YYYY). Currency: USD. Employment is at-will unless stated otherwise.`,
    IN: `You are generating Indian employment documents. Follow Indian labor laws including Employees' Provident Fund (EPF), Employee State Insurance (ESI), and Payment of Gratuity Act. Use Indian date format (DD/MM/YYYY). Currency: INR (₹). Employment follows notice period norms (typically 30-90 days).`,
    GB: `You are generating UK employment documents. Follow HMRC PAYE requirements, Right to Work legislation, and UK employment law. Use UK date format (DD/MM/YYYY). Currency: GBP (£). Employment is contract-based with statutory notice periods.`,
    CA: `You are generating Canadian employment documents. Follow CRA TD1 requirements and provincial labor standards. Use Canadian date format (YYYY-MM-DD). Currency: CAD (C$). Employment follows provincial employment standards acts.`,
    DE: `You are generating German employment documents. Follow German labor law (Arbeitsrecht), GDPR/DSGVO requirements. Use German date format (DD.MM.YYYY). Currency: EUR (€). Employment follows collective bargaining agreements where applicable. Minimum 20 vacation days (4 weeks).`,
    FR: `You are generating French employment documents. Follow French labor law (Code du travail), RGPD requirements. Use French date format (DD/MM/YYYY). Currency: EUR (€). 35-hour work week standard. Minimum 5 weeks vacation.`,
    AU: `You are generating Australian employment documents. Follow ATO requirements, Fair Work Act 2009. Use Australian date format (DD/MM/YYYY). Currency: AUD (A$). Superannuation guarantee 11.5% (2025-26). NES minimum entitlements apply.`,
    SG: `You are generating Singapore employment documents. Follow IRAS and MOM requirements, Employment Act. Use Singapore date format (DD/MM/YYYY). Currency: SGD (S$). CPF contributions mandatory for citizens/PRs.`,
  };
  return contexts[countryCode] || contexts['US'];
}

/**
 * Validate country-specific required fields
 */
function validateCountryFields(countryCode, documentKey, data) {
  const errors = [];
  const validators = {
    US: {
      i9: () => {
        if (!data.legal_first_name) errors.push('First name is required');
        if (!data.legal_last_name) errors.push('Last name is required');
        if (!data.date_of_birth) errors.push('Date of birth is required');
        if (!data.ssn_encrypted && !data.ssn) errors.push('SSN is required');
        if (!data.i9_citizenship_status) errors.push('Citizenship status is required');
        if (!data.address_line1) errors.push('Address is required');
        if (!data.city) errors.push('City is required');
        if (!data.state) errors.push('State is required');
        if (!data.zip_code) errors.push('ZIP code is required');
      },
      w4: () => {
        if (!data.w4_filing_status) errors.push('Filing status is required');
      }
    },
    IN: {
      pan_card: () => {
        const pan = data.country_specific_data?.pan_number;
        if (!pan) errors.push('PAN number is required');
        else if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) errors.push('Invalid PAN format (e.g., ABCDE1234F)');
      },
      aadhaar: () => {
        const aadhaar = data.country_specific_data?.aadhaar_number;
        if (!aadhaar) errors.push('Aadhaar number is required');
        else if (!/^\d{12}$/.test(aadhaar.replace(/\s/g, ''))) errors.push('Aadhaar must be 12 digits');
      },
      pf_form11: () => {
        if (!data.country_specific_data?.uan_number && !data.country_specific_data?.is_first_pf) {
          errors.push('UAN number or first PF declaration required');
        }
      }
    },
    GB: {
      right_to_work: () => {
        if (!data.country_specific_data?.rtw_document_type) errors.push('Right to Work document type is required');
        if (!data.country_specific_data?.rtw_document_number) errors.push('Document number is required');
      },
      national_insurance: () => {
        const ni = data.country_specific_data?.ni_number;
        if (!ni) errors.push('National Insurance number is required');
        else if (!/^[A-Z]{2}\d{6}[A-D]$/.test(ni.replace(/\s/g, '').toUpperCase())) {
          errors.push('Invalid NI number format');
        }
      }
    },
    CA: {
      td1_federal: () => {
        if (data.country_specific_data?.td1_total_claim === undefined) {
          errors.push('TD1 total claim amount is required');
        }
      },
      sin_collection: () => {
        const sin = data.country_specific_data?.sin_number;
        if (!sin) errors.push('Social Insurance Number is required');
        else if (!/^\d{9}$/.test(sin.replace(/[\s-]/g, ''))) errors.push('SIN must be 9 digits');
      }
    },
    DE: {
      gdpr_consent: () => {
        if (!data.country_specific_data?.gdpr_consent_given) errors.push('GDPR consent is required');
      },
      tax_id: () => {
        const taxId = data.country_specific_data?.tax_id;
        if (!taxId) errors.push('Tax ID (Steuer-ID) is required');
        else if (!/^\d{11}$/.test(taxId)) errors.push('Tax ID must be 11 digits');
      }
    }
  };

  const countryValidators = validators[countryCode];
  if (countryValidators && countryValidators[documentKey]) {
    countryValidators[documentKey]();
  }

  return errors;
}

/**
 * Invalidate cache (call after updates)
 */
function clearCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = {
  getAllCountries,
  getCountry,
  getOnboardingDocs,
  getWizardSteps,
  formatCurrency,
  formatSalaryRange,
  getCountryDocPromptContext,
  validateCountryFields,
  clearCache,
  COUNTRY_WIZARD_STEPS,
};
