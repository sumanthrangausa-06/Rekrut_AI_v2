# Build log — #1229 applied_via CHECK rejects 'referral'

**Branch:** `fix/1229-applied-via-referral` (base origin/dev 96fe0f83) · **Persona:** Nova · **Specialist:** ecc/database-reviewer (STOP 1 decision + independent PR review)

## Defect
`migrations/228_auto_apply_schema.sql` defines `chk_job_applications_applied_via CHECK (applied_via IN ('manual','auto_apply'))`. The referral-claim INSERT at `routes/assessments.js:1476-1477` uses `applied_via='referral'` inside a transaction, so the claim rolls back on a fully-migrated DB.

## Writer audit (origin/dev @ 96fe0f83)
- `routes/assessments.js:1477` — `'referral'` — **only value outside the CHECK**
- `routes/candidate.js` `submitApplication()` — `'manual'` (apply), `'auto_apply'` (both auto-apply routes), fallback `'manual'`
- `routes/ai-screener.js:121` — column omitted → default `'manual'`
- No later migration touches the constraint (228 is the sole definition).

## Fix
New migration `263_applied_via_referral.sql` (next free number; highest existing 262; 228 NOT edited): `DROP CONSTRAINT IF EXISTS` + re-add `CHECK (applied_via IN ('manual','auto_apply','referral'))`. Idempotent; re-adding validates existing rows and cannot fail on a 228-conformant DB (old set ⊂ new set).

## Evidence (local PG 127.0.0.1:55433, scratch DBs)
- **RED** (`rekrut_1229_red`, unpatched): numbered chain through 262 applied; CHECK def `('manual','auto_apply')`; exact referral INSERT shape → **23514 chk_job_applications_applied_via**.
- **GREEN** (`rekrut_1229_green`, with 263): 263 applied + recorded in `_migrations` (154 completions vs 153 baseline = +1); CHECK def `('manual','auto_apply','referral')`; referral INSERT **succeeded**; `manual`/`auto_apply` succeeded; bogus value correctly rejected 23514; direct re-apply of 263 idempotent.
- **Claim flow**: the exact claim transaction (claim UPDATE on `assessment_referrals` → application INSERT `'referral'` → attempt INSERT `'assigned'`) **COMMITTED**; application persisted with `applied_via='referral'`. (Attempt step needed p4's status widening applied to the scratch DB — p4 is a p-series migration that cannot run on a fresh DB until #1141 is fixed; on a fully-migrated DB it has already run.)
- **Schema-drift CI guard** (`scripts/check-schema-drift.js --ci`, fresh DB `rekrut_1229_guard`): **PASS**; migrate exit 1 attributed to pre-existing #1141.
- **Jest subset** (job-applications-erasure, application-ip-capture, analytics-cache, honest-null-omniscore): 4 suites / 48 tests PASS on branch and on pristine origin/dev baseline — identical. Full unit suite does not terminate within 280s (pre-existing; server timers) — subset comparison used instead.

## Pre-existing, NOT this story
Fresh `migrate.js` aborts at `p2_schema_hardening.sql` (0A000, view/trigger-blocked type alters) identically on pristine dev and on this branch — filed as #1141/#1149. The numbered chain (through 263) completes before that point in both cases.

## Not verified
Production/staging live schema state for the constraint — no live-DB path from this VM (Neon TLS egress blocked). The migration is safe in both states (present → widened; absent → added).
