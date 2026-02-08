module.exports = {
  name: '027_multi_country_support',
  async up(client) {
    // ═══════════════════════════════════════════════════════
    // MULTI-COUNTRY ARCHITECTURE
    // Adds country_code to key tables, country configuration,
    // and country-specific onboarding document definitions.
    // ═══════════════════════════════════════════════════════

    // 1. Country configurations table — master reference for supported countries
    await client.query(`
      CREATE TABLE IF NOT EXISTS country_configs (
        id SERIAL PRIMARY KEY,
        country_code VARCHAR(2) NOT NULL UNIQUE,
        country_name VARCHAR(100) NOT NULL,
        currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
        currency_symbol VARCHAR(5) NOT NULL DEFAULT '$',
        date_format VARCHAR(20) NOT NULL DEFAULT 'MM/DD/YYYY',
        default_pay_frequency VARCHAR(20) NOT NULL DEFAULT 'bi-weekly',
        timezone VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
        tax_system VARCHAR(50),
        employment_model VARCHAR(50) DEFAULT 'at-will',
        notice_period_days INTEGER DEFAULT 0,
        statutory_deductions JSONB DEFAULT '[]',
        required_onboarding_docs JSONB DEFAULT '[]',
        legal_requirements JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 2. Seed supported countries
    await client.query(`
      INSERT INTO country_configs (country_code, country_name, currency_code, currency_symbol, date_format, default_pay_frequency, timezone, tax_system, employment_model, notice_period_days, statutory_deductions, required_onboarding_docs, legal_requirements) VALUES
      ('US', 'United States', 'USD', '$', 'MM/DD/YYYY', 'bi-weekly', 'America/New_York', 'federal_state', 'at-will', 0,
        '["federal_income_tax","state_income_tax","social_security","medicare"]'::jsonb,
        '["i9","w4","direct_deposit","emergency_contact","employee_handbook"]'::jsonb,
        '{"i9_required":true,"w4_required":true,"fica_required":true,"state_tax_varies":true,"at_will_employment":true}'::jsonb),

      ('IN', 'India', 'INR', '₹', 'DD/MM/YYYY', 'monthly', 'Asia/Kolkata', 'income_tax_slabs', 'contract', 30,
        '["income_tax","provident_fund","esi","professional_tax"]'::jsonb,
        '["pan_card","aadhaar","pf_form11","pf_nomination","esi_form","gratuity_nomination","employee_handbook"]'::jsonb,
        '{"pan_required":true,"aadhaar_required":true,"pf_mandatory":true,"esi_threshold":21000,"gratuity_after_5_years":true,"notice_period_standard":30}'::jsonb),

      ('GB', 'United Kingdom', 'GBP', '£', 'DD/MM/YYYY', 'monthly', 'Europe/London', 'paye', 'contract', 30,
        '["income_tax","national_insurance","student_loan"]'::jsonb,
        '["right_to_work","p45_or_starter","national_insurance","employee_handbook"]'::jsonb,
        '{"right_to_work_required":true,"ni_required":true,"paye_system":true,"minimum_notice_1week_per_year":true,"statutory_sick_pay":true}'::jsonb),

      ('CA', 'Canada', 'CAD', 'C$', 'YYYY-MM-DD', 'bi-weekly', 'America/Toronto', 'federal_provincial', 'contract', 14,
        '["federal_income_tax","provincial_income_tax","cpp","ei"]'::jsonb,
        '["td1_federal","td1_provincial","sin_collection","employee_handbook"]'::jsonb,
        '{"td1_required":true,"sin_required":true,"cpp_mandatory":true,"ei_mandatory":true,"minimum_notice_varies_by_province":true}'::jsonb),

      ('DE', 'Germany', 'EUR', '€', 'DD.MM.YYYY', 'monthly', 'Europe/Berlin', 'income_tax_class', 'contract', 28,
        '["income_tax","solidarity_surcharge","church_tax","health_insurance","pension","unemployment"]'::jsonb,
        '["gdpr_consent","tax_id","social_insurance","work_permit","employee_handbook"]'::jsonb,
        '{"gdpr_required":true,"work_permit_non_eu":true,"tax_class_system":true,"mandatory_health_insurance":true,"minimum_28_vacation_days":true}'::jsonb),

      ('FR', 'France', 'EUR', '€', 'DD/MM/YYYY', 'monthly', 'Europe/Paris', 'income_tax_progressive', 'contract', 30,
        '["income_tax","social_contributions","csg_crds"]'::jsonb,
        '["gdpr_consent","carte_vitale","work_permit","employee_handbook"]'::jsonb,
        '{"gdpr_required":true,"35hr_work_week":true,"minimum_5_weeks_vacation":true,"mandatory_profit_sharing_50plus":true}'::jsonb),

      ('AU', 'Australia', 'AUD', 'A$', 'DD/MM/YYYY', 'monthly', 'Australia/Sydney', 'payg', 'contract', 14,
        '["payg_withholding","superannuation","medicare_levy"]'::jsonb,
        '["tfn_declaration","super_choice","fair_work_info","employee_handbook"]'::jsonb,
        '{"tfn_required":true,"superannuation_11_5_percent":true,"fair_work_act":true,"minimum_4_weeks_leave":true}'::jsonb),

      ('SG', 'Singapore', 'SGD', 'S$', 'DD/MM/YYYY', 'monthly', 'Asia/Singapore', 'progressive', 'contract', 30,
        '["income_tax","cpf_employee","cpf_employer"]'::jsonb,
        '["nric_or_fin","cpf_submission","work_pass","employee_handbook"]'::jsonb,
        '{"cpf_mandatory":true,"work_pass_required_foreigners":true,"no_minimum_wage":true,"14_days_annual_leave":true}'::jsonb)

      ON CONFLICT (country_code) DO NOTHING
    `);

    // 3. Add country_code to companies (with operating_countries for multi-country ops)
    await client.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS primary_country VARCHAR(2) DEFAULT 'US',
      ADD COLUMN IF NOT EXISTS operating_countries JSONB DEFAULT '["US"]'
    `);

    // 4. Add country_code to jobs
    await client.query(`
      ALTER TABLE jobs
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'US',
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS salary_min NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS salary_max NUMERIC(12,2)
    `);

    // 5. Add country_code to offers
    await client.query(`
      ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'US',
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'USD'
    `);

    // 6. Add country_code to employees
    await client.query(`
      ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'US',
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'USD'
    `);

    // 7. Add country_code to candidate_onboarding_data
    await client.query(`
      ALTER TABLE candidate_onboarding_data
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'US',
      ADD COLUMN IF NOT EXISTS country_specific_data JSONB DEFAULT '{}'
    `);

    // 8. Country-specific onboarding document types reference
    await client.query(`
      CREATE TABLE IF NOT EXISTS country_document_types (
        id SERIAL PRIMARY KEY,
        country_code VARCHAR(2) NOT NULL,
        document_key VARCHAR(50) NOT NULL,
        document_name VARCHAR(150) NOT NULL,
        description TEXT,
        is_required BOOLEAN DEFAULT true,
        government_form_id VARCHAR(50),
        wizard_step INTEGER DEFAULT 1,
        fields_schema JSONB DEFAULT '{}',
        ai_prompt_template TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(country_code, document_key)
      )
    `);

    // 9. Seed document types for each country
    await client.query(`
      INSERT INTO country_document_types (country_code, document_key, document_name, description, is_required, government_form_id, wizard_step) VALUES
      -- USA
      ('US', 'i9', 'Form I-9 Employment Eligibility', 'USCIS Form I-9 — verifies identity and work authorization', true, 'USCIS I-9 (01/20/2025)', 1),
      ('US', 'w4', 'Form W-4 Tax Withholding', 'IRS Form W-4 — federal tax withholding certificate', true, 'IRS W-4 (2025)', 2),
      ('US', 'state_tax', 'State Tax Withholding', 'State-specific tax withholding form (if applicable)', false, NULL, 2),
      ('US', 'direct_deposit', 'Direct Deposit Authorization', 'Banking info for payroll', true, NULL, 3),
      ('US', 'emergency_contact', 'Emergency Contact', 'Emergency contact information', true, NULL, 3),
      ('US', 'employee_handbook', 'Employee Handbook Acknowledgment', 'Company policies and handbook', true, NULL, 4),

      -- India
      ('IN', 'pan_card', 'PAN Card Verification', 'Permanent Account Number — required for income tax', true, 'PAN', 1),
      ('IN', 'aadhaar', 'Aadhaar Verification', 'Aadhaar number for identity and UAN linkage', true, 'Aadhaar', 1),
      ('IN', 'pf_form11', 'PF Form 11 Declaration', 'Provident Fund declaration + UAN transfer', true, 'EPF Form 11', 2),
      ('IN', 'pf_nomination', 'PF Nomination (Form 2)', 'Provident Fund nomination for beneficiary', true, 'EPF Form 2', 2),
      ('IN', 'esi_form', 'ESI Declaration', 'Employee State Insurance if salary under ₹21,000/month', false, 'ESI Form 1', 2),
      ('IN', 'gratuity_nomination', 'Gratuity Nomination (Form F)', 'Nomination for gratuity payment', true, 'Form F', 3),
      ('IN', 'bank_details', 'Bank Account Details', 'Bank info for salary credit', true, NULL, 3),
      ('IN', 'employee_handbook', 'Employee Handbook Acknowledgment', 'Company policies and handbook', true, NULL, 4),

      -- United Kingdom
      ('GB', 'right_to_work', 'Right to Work Check', 'Verify eligibility to work in the UK', true, 'Right to Work', 1),
      ('GB', 'p45_or_starter', 'P45 or Starter Checklist', 'P45 from previous employer OR HMRC Starter Checklist', true, 'P45/Starter Checklist', 1),
      ('GB', 'national_insurance', 'National Insurance Number', 'NI number for tax and benefits', true, 'NI Number', 2),
      ('GB', 'bank_details', 'Bank Account Details', 'UK bank details for salary', true, NULL, 3),
      ('GB', 'emergency_contact', 'Emergency Contact', 'Emergency contact information', true, NULL, 3),
      ('GB', 'employee_handbook', 'Employee Handbook Acknowledgment', 'Company policies and handbook', true, NULL, 4),

      -- Canada
      ('CA', 'td1_federal', 'TD1 Federal Tax Credits', 'Federal personal tax credits return', true, 'TD1', 1),
      ('CA', 'td1_provincial', 'TD1 Provincial Tax Credits', 'Provincial personal tax credits return', true, 'TD1 Provincial', 1),
      ('CA', 'sin_collection', 'Social Insurance Number', 'SIN for tax reporting and CPP/EI', true, 'SIN', 2),
      ('CA', 'bank_details', 'Bank Account Details', 'Canadian bank details for payroll', true, NULL, 3),
      ('CA', 'emergency_contact', 'Emergency Contact', 'Emergency contact information', true, NULL, 3),
      ('CA', 'employee_handbook', 'Employee Handbook Acknowledgment', 'Company policies and handbook', true, NULL, 4),

      -- Germany (EU)
      ('DE', 'gdpr_consent', 'GDPR Consent & Data Processing', 'GDPR-compliant data processing agreement', true, 'GDPR Art. 6/13', 1),
      ('DE', 'tax_id', 'Tax Identification Number', 'Steuerliche Identifikationsnummer', true, 'Steuer-ID', 1),
      ('DE', 'social_insurance', 'Social Insurance Registration', 'Sozialversicherungsausweis', true, 'SV-Ausweis', 2),
      ('DE', 'work_permit', 'Work Permit (non-EU)', 'Aufenthaltserlaubnis if non-EU citizen', false, NULL, 2),
      ('DE', 'bank_details', 'Bank Account (IBAN)', 'IBAN for salary transfers', true, NULL, 3),
      ('DE', 'employee_handbook', 'Employee Handbook', 'Company policies', true, NULL, 4),

      -- France (EU)
      ('FR', 'gdpr_consent', 'GDPR Consent & Data Processing', 'Consentement RGPD', true, 'RGPD Art. 6/13', 1),
      ('FR', 'carte_vitale', 'Carte Vitale / Social Security', 'Numéro de sécurité sociale', true, 'Carte Vitale', 1),
      ('FR', 'work_permit', 'Work Permit (non-EU)', 'Titre de séjour if non-EU citizen', false, NULL, 2),
      ('FR', 'rib', 'Bank Details (RIB)', 'Relevé d''Identité Bancaire for salary', true, NULL, 3),
      ('FR', 'employee_handbook', 'Employee Handbook', 'Règlement intérieur', true, NULL, 4),

      -- Australia
      ('AU', 'tfn_declaration', 'TFN Declaration', 'Tax File Number declaration for PAYG withholding', true, 'TFN Declaration (NAT 3092)', 1),
      ('AU', 'super_choice', 'Superannuation Choice', 'Superannuation fund nomination form', true, 'Super Choice Form', 2),
      ('AU', 'fair_work_info', 'Fair Work Information Statement', 'Acknowledgment of Fair Work rights', true, 'FWIS', 2),
      ('AU', 'bank_details', 'Bank Account Details', 'Australian bank BSB + account for salary', true, NULL, 3),
      ('AU', 'employee_handbook', 'Employee Handbook', 'Company policies', true, NULL, 4),

      -- Singapore
      ('SG', 'nric_or_fin', 'NRIC/FIN Verification', 'National Registration IC or Foreign ID Number', true, 'NRIC/FIN', 1),
      ('SG', 'cpf_submission', 'CPF Submission', 'Central Provident Fund enrollment', true, 'CPF', 2),
      ('SG', 'work_pass', 'Work Pass (foreigners)', 'Employment Pass, S Pass, or Work Permit', false, NULL, 2),
      ('SG', 'bank_details', 'Bank Account Details', 'Singapore bank for salary', true, NULL, 3),
      ('SG', 'employee_handbook', 'Employee Handbook', 'Company policies', true, NULL, 4)

      ON CONFLICT (country_code, document_key) DO NOTHING
    `);

    // 10. Add index for fast country lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_country_code ON jobs(country_code);
      CREATE INDEX IF NOT EXISTS idx_offers_country_code ON offers(country_code);
      CREATE INDEX IF NOT EXISTS idx_employees_country_code ON employees(country_code);
      CREATE INDEX IF NOT EXISTS idx_country_document_types_country ON country_document_types(country_code);
    `);

    console.log('Multi-country support migration complete — 8 countries seeded with document types');
  }
};
