# #1601 — Profile completion single source of truth (build log)

**Issue:** Job Board / job detail showed 0% profile completion for completed
profiles; the ≥80% one-click-apply gate could never open.
**PRD:** `02-planning/sumanth-batch-2026-10-21/prd-job-board-and-profile.md`
§4.2/§5.2/§6 FR-P1–P4, JT-P1–P3.

## The rule (standing, for every future surface)

**Profile completion has exactly one definition and two sanctioned sources:**

1. `client/src/lib/profile-completion.ts` — the canonical 12-field
   calculation (client side).
2. `GET /candidate/dashboard/stats` → `stats.profile_completeness` — its
   only server mirror (routes/candidate.js, same 12 fields).

Every surface — Profile page, Dashboard, job detail, job board, any future
surface — displays a value obtained from one of these two, computed from the
same underlying profile data.

- **No surface may read a completion value off a raw profile row.**
  `GET /candidate/profile` returns the raw row; it has no `completeness`
  field, and adding one there would create a third computation site
  (PRD §9 forbids this).
- **No surface may compute its own variant.**
- **Unknown is not 0 (FR-P3).** Absent / loading / error ⇒ render NO
  percentage. `|| 0` as a display fallback for this fact is a defect.
  A genuinely empty profile's true calculated value (which may be 0% or
  another low number) is a *known* value and displays normally — known
  zero and unknown must never be conflated.
- **Gates use the same value as the banner (FR-P4).** One-click apply's
  ≥80% gate consumes the identical canonical value the user is shown.

## What changed

- `client/src/pages/candidate/job-detail.tsx` — was reading
  `data.profile?.completeness || 0` from `GET /candidate/profile` (field
  never returned ⇒ always 0). Now consumes `GET /candidate/dashboard/stats`,
  state is `number | null`; banner and one-click gate render/act only on a
  known value.
- `client/src/pages/candidate/dashboard.tsx` — stat-card description used
  `stats?.profile_completeness || 0` (fabricated 0% while loading). Now
  shows the real percentage when stats are loaded and no percentage
  otherwise.

## Sweep record (FR-P2)

Audited every `completeness`/`completion` consumer on dev. Company-profile
completeness (candidate/company-profile, recruiter/company), LinkedIn
optimizer `completenessScore`, and CV-review `completeness_score` are
*different facts* with their own sources and were left unchanged. The dead
`profile.tsx.backup` file still carries an old divergent local calculation;
it is not a live surface (cleanup candidate, tracked separately).

## Verification

- Journey tests JT-P1–P3: `client/src/__tests__/pages/JobDetailProfileCompletion.test.tsx`
  (core JT cases red 3/4 on the old code → green; final suite 8/8 including
  the 80/79 gate-boundary cases and the Dashboard stat-card cases added on
  specialist review).
- Quinn E2E (HL-003): real HTTP against a fresh-install dev build on a real
  database — Profile-equivalent (lib) value, Dashboard stats value, and the
  job-detail source value read back and compared; evidence on issue #1601.
