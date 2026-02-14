# HireLoop Database Schema Improvements

**Last Updated:** 2026-02-14
**Schema Stats:** 105 tables | 160 FK relationships | 295 indexes | ~1,250 columns

---

## P0 — Critical Data Integrity (FK Corruption)

> **STATUS: ✅ ALL RESOLVED** (2026-02-14, Task #31581)

### ✅ RESOLVED: 5 tables had `company_id` FK pointing to `users.id` instead of `companies.id`

| Table | Constraint | Old Target | New Target | Status |
|-------|-----------|------------|------------|--------|
| `offers` | `offers_company_id_fkey` | `users.id` | `companies.id` | ✅ Fixed |
| `offer_templates` | `offer_templates_company_id_fkey` | `users.id` | `companies.id` | ✅ Fixed |
| `onboarding_documents` | `onboarding_documents_company_id_fkey` | `users.id` | `companies.id` | ✅ Fixed |
| `onboarding_plans` | `onboarding_plans_company_id_fkey` | `users.id` | `companies.id` | ✅ Fixed |
| `company_policies` | `company_policies_company_id_fkey` | `users.id` | `companies.id` | ✅ Fixed |

**What was done:**
1. Verified 0 orphaned records across all 5 tables (no data cleanup needed)
2. Dropped 5 incorrect FK constraints
3. Added 5 correct FK constraints → `companies.id`
4. Added missing index `idx_offer_templates_company` on `offer_templates.company_id`
5. Verified enforcement: inserting invalid `company_id` correctly rejected by FK constraint

**Migration:** `migrations/045_fix_company_id_fk_constraints.sql`
**Applied via:** Direct DDL (psql) — migration file in repo for reference

---

## P1 — Interview Flow Issues

### 🔴 OPEN: All 8 interview records stuck in `in_progress` state with NULL `job_id`
- Zero completed interviews exist
- `interviews.job_id` nullable + has FK constraint (null reference risk)
- Impact: Interview completion workflow entirely non-functional
- Status: Report #17974, fix roadmap documented

---

## P2 — Role Enum Mismatch

### 🟡 OPEN: 7 QA test users assigned `employer` role
- Frontend only recognizes: `recruiter`, `candidate`, `admin`, `hiring_manager`
- Risk: `employer` role users may see broken views or no access
- Recommendation: Migrate `employer` → `recruiter` or add `employer` to frontend enum

---

## P3 — Schema Optimization

### 🔵 OPEN: Missing FK indexes
- Audit all FK columns for missing indexes (per PostgreSQL best practice)
- FK columns without indexes cause slow JOINs and table-level locks on DELETE

### 🔵 OPEN: QA test data pollution
- Test accounts mixed with production user data
- 6/14 `mock_interview_sessions` incomplete
- Recommendation: Separate test data or add `is_test` flag

---

## Change Log

| Date | Change | Task |
|------|--------|------|
| 2026-02-14 | Created initial schema improvement roadmap | #31573 |
| 2026-02-14 | ✅ Fixed all 5 P0 FK corruption issues | #31581 |
