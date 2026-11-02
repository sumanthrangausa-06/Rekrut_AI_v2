# #1391 — CV analysis follows the candidate's Public-profile switch: build log

**Persona:** Nova (implementation), under Sumanth's founder ruling on #1391
(2026-11-02) and the STOP 1 comment posted on the issue.
**Skills:** startup-cto → systematic-debugging → test-driven-development →
verification-before-completion; privacy-engineer specialist lens (YES at
STOP 1 — consent/visibility enforcement at the API layer); ponytail
(one shared helper, no per-endpoint copies).
**Lessons:** HL-003 (E2E gate), HL-007 (landing proof).

## Behaviour change (user-visible)

Recruiter CV analysis now respects the candidate's Public-profile switch
(Settings → Privacy, "Allow recruiters to view your profile and contact
you"):

- Switch **ON**: any recruiter may view/analyse the candidate (unchanged).
- Switch **OFF**: analysis is blocked with **404** (never 403 — a blocked
  id is indistinguishable from a nonexistent one) — **except** the
  recruiter(s) of jobs the candidate actually applied to, who keep access
  scoped to **that job only**.
- No settings row / missing-or-null switch value: **fail closed**
  (treated as private) on these endpoints; the applicant exception still
  applies.
- A blocked attempt creates **no screening record** and is written to the
  audit log (`action_type = 'screening_visibility_denied'`).

## Root cause (verified first-hand on dev `1f891f385`)

The analysis endpoints checked only that the recruiter owns the job, then
fetched the candidate by raw user id; the switch was never read on those
paths.

**Storage correction:** the switch is **not** a
`candidate_profiles.profile_visible` column (none exists). It is
`user_settings.privacy->>'profile_visible'` — migration 060,
`routes/settings.js` (`DEFAULT_PRIVACY`, `PATCH /privacy`), with the
existing discovery enforcement precedent in `routes/candidateSearch.js`
(#416). Note: #416's discovery treatment defaults to visible when the
row/key is absent; this gate deliberately fails closed on absent/null
for analysis endpoints (flagged on the issue's STOP 1 for the reviewer).

## What was gated (one shared helper: `lib/candidate-visibility.js`)

Checked after job ownership, before any profile fetch beyond the
visibility check itself, before any AI/screener spend, and before any
screening-record write:

- `routes/screening.js`: `POST /analyze`, `POST /questions`,
  `POST /compare` (either candidate blocked → whole compare denied).
- `routes/ai-screener.js`: `POST /jobs/:jobId/screen/:candidateId` (the
  endpoint the recruiter UI calls; the gate also runs before its
  `findOrCreateApplication` write).
- `routes/recruiter.js`: `POST /jobs/:id/analyze-candidate`.

Already application-scoped surfaces were left unchanged (screening
`/batch`, recruiter candidate/pipeline/ranked lists keyed on
`job_applications`, `/ai/candidate-summary` by `application_id`,
candidateSearch discovery — already visibility-gated by #416).
Multi-candidate batch/compare semantics in `ai-screener`
`POST /jobs/:jobId/screen-batch` and `recruiter`
`POST /ai/compare-candidates` are listed as ambiguous on the STOP 1
comment and are **not** gated by this change.

## Evidence

- Red-first: the journey suite failed on base dev in exactly the 7
  denial/scope cases (all allow cases passed).
- Quinn user-journey E2E (HL-003): real HTTP against the real routers on
  a fresh-install Postgres built only by `node migrate.js`; only the AI
  library boundaries are stubbed (`lib/recruiter-screener`,
  `services/job-optimizer` for analyze-candidate) — gate behaviour, DB
  writes and audit rows are real and read back.
  Suite: `server/__tests__/routes/screening-profile-visible-gate-1391-realdb.test.js`.
