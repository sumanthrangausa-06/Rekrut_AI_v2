-- Migration: 045_fix_company_id_fk_constraints
-- Fix 5 FK corruption bugs: company_id columns incorrectly reference users.id instead of companies.id
-- Tables: offers, offer_templates, onboarding_documents, onboarding_plans, company_policies
-- Date: 2026-02-14
-- Task: #31581

-- Step 1: Drop incorrect FK constraints (all point to users.id instead of companies.id)
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_company_id_fkey;
ALTER TABLE offer_templates DROP CONSTRAINT IF EXISTS offer_templates_company_id_fkey;
ALTER TABLE onboarding_documents DROP CONSTRAINT IF EXISTS onboarding_documents_company_id_fkey;
ALTER TABLE onboarding_plans DROP CONSTRAINT IF EXISTS onboarding_plans_company_id_fkey;
ALTER TABLE company_policies DROP CONSTRAINT IF EXISTS company_policies_company_id_fkey;

-- Step 2: Add correct FK constraints (all point to companies.id)
ALTER TABLE offers ADD CONSTRAINT offers_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE offer_templates ADD CONSTRAINT offer_templates_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE onboarding_documents ADD CONSTRAINT onboarding_documents_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE onboarding_plans ADD CONSTRAINT onboarding_plans_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE company_policies ADD CONSTRAINT company_policies_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);

-- Step 3: Add missing index on offer_templates.company_id
-- (offers, onboarding_documents, onboarding_plans, company_policies already have company_id indexes)
CREATE INDEX IF NOT EXISTS idx_offer_templates_company ON offer_templates(company_id);
