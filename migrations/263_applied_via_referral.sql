-- Migration 263: widen applied_via CHECK to include 'referral'
-- Issue #1229
--
-- Migration 228 defined chk_job_applications_applied_via as
-- CHECK (applied_via IN ('manual', 'auto_apply')), but the referral-claim
-- flow (routes/assessments.js, assessment referral claim) inserts
-- applied_via='referral', so the INSERT violates the CHECK and the whole
-- claim transaction rolls back on a fully-migrated database.
--
-- Fix: replace the constraint with the widened value set. Idempotent:
-- DROP CONSTRAINT IF EXISTS + re-add runs cleanly when the constraint is
-- present (normal case), already widened (re-run), or absent while the
-- column exists and all existing rows are within the widened set.
-- Re-adding validates existing rows; every value permitted before
-- ('manual', 'auto_apply', plus the column default 'manual') is in the
-- widened set, so validation cannot fail on a 228-conformant database.
-- On a drifted DB where the column/table is missing or out-of-set rows
-- exist, the ADD fails — safely: migrate.js runs each migration in a
-- transaction, so the failure rolls back and 263 stays unrecorded and
-- retryable (database-reviewer finding, #1229). Before promoting this
-- migration, verify the target DB's applied_via constraint + check for
-- out-of-set rows with one pg_constraint query.
-- Migration 228 is NOT edited.

ALTER TABLE job_applications
  DROP CONSTRAINT IF EXISTS chk_job_applications_applied_via;

ALTER TABLE job_applications
  ADD CONSTRAINT chk_job_applications_applied_via
  CHECK (applied_via IN ('manual', 'auto_apply', 'referral'));
