# #1642 — Job assessments cannot be published on a fresh install

**Phase:** 4-Implementation (defect fix) · **Persona trail:** Nova STOP 1 → Suga build/gate (advance run 2026-10-22; see issue #1642 for the full record, including why the parent completed the landing)

## Root cause
Migration 047's `chk_job_assessments_status` allows `('draft','active','archived')`, but the publish endpoint writes `'published'` (`routes/assessments.js:2756`). On any database built only by `node migrate.js`, publishing a job assessment fails with SQLSTATE 23514. Readers (`:2322`, `:2383`, `:2780`) already require `'published'` — the schema was the only side of the contract that was wrong. Found by the PR #1641 Quinn rig, which had widened the CHECK locally in the rig only.

## Fix
Migration `278_job_assessments_published_status.js` (274-pattern, expand-only): drops the existing status CHECK on `job_assessments` by definition lookup and re-adds the canonical `chk_job_assessments_status` as `('draft','active','archived','published')`. No value removed, no rows rewritten. `p2_schema_hardening.sql` defines no competing CHECK for this table (verified).

## Evidence (fresh-install rigs, PG16 @ 127.0.0.1:55471, DBs built only by `node migrate.js`)
- **RED** (`suga1642_red`, pristine dev `b6efab0d3`): the publish UPDATE fails — `violates check constraint "chk_job_assessments_status"`.
- **GREEN** (`suga1642_green`, dev + 278): the same UPDATE succeeds (`status='published'`, `published_at` set); exactly one status CHECK remains, definition `draft/active/archived/published`; `draft`/`active`/`archived` writes still accepted (no regression).

## User-visible behaviour change
On fresh installs, a recruiter publishing a job assessment now succeeds instead of failing; candidates can see and start published job assessments as designed. No behaviour change on databases where publish already worked via other paths.
