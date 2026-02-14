# P2 Schema Hardening — Migration Changelog

> Migration: `migrations/045_p2_schema_hardening.js`  
> Deployed: 2026-02-14T17:39:15Z  
> Commit: 48c46714b465017f5cdacf0e81c395ef094c6985

## Summary

| Change Type | Count | Details |
|------------|-------|---------|
| CHECK constraints added | 37 | Status enums, type enums, score ranges |
| VARCHAR → TEXT conversions | 274 | Across ~80 tables |
| TIMESTAMP → TIMESTAMPTZ | 5 | screening_sessions table |
| Data normalizations | 1 | candidate_profiles.availability |
| VARCHAR columns retained | 25 | Genuinely bounded (country_code, etc.) |

## Build History

| Attempt | Commit | Result | Issue |
|---------|--------|--------|-------|
| 1 | 9de456a | ❌ Failed | `chk_interviews_type` — value `'mock'` not in constraint |
| 2 | 0e3be35 | ❌ Failed | `chk_candidate_profiles_availability` — value `'2 weeks'` not in constraint |
| 3 | 48c4671 | ✅ Live | All 37 CHECK constraints, 274 TEXT conversions, 5 timestamptz applied |

## Verification Results (post-deploy)

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Migration in `_migrations` | `p2_schema_hardening` | Found | ✅ |
| CHECK constraints (`chk_*`) | 37+ new | 42 total (37 new + 5 pre-existing) | ✅ |
| VARCHAR columns remaining | ~24 | 25 | ✅ |
| screening_sessions timestamptz | 5 columns | All 5 converted | ✅ |

## Data Adjustments

Before applying CHECK constraints, existing data was audited for violations:

| Column | Unexpected Value | Resolution |
|--------|-----------------|------------|
| `interviews.interview_type` | `'mock'` (3 rows) | Added to allowed values |
| `job_assessments.difficulty_level` | `'mid'` | Added alongside 'easy','medium','hard' |
| `mock_interview_sessions.status` | `'in_progress'` | Added to allowed values |
| `assessment_sessions.status` | `'in_progress'` | Added to allowed values |
| `paychecks.status` | `'paid'` | Added to allowed values |
| `candidate_profiles.availability` | `'2 weeks'`, `'1 month'`, `'3 months'` | Added human-readable + snake_case formats |
| `candidate_profiles.availability` | `'immediate'` (1 row) | Normalized to `'immediately'` pre-migration |
