# Build Log — #1600 Job Board Filters (header sheet wired to the board's one filter model)

**Issue:** #1600 · **PRD:** `02-planning/sumanth-batch-2026-10-21/prd-job-board-and-profile.md` §4.1/§5.1/§6 FR-J1–J4, §10 JT-J1–J4 · **Persona:** Nova (Implementation), Lead coordinating · **Branch:** `nova/1600-job-board-filters`

## What was broken (verified on dev @ 870a0defc)

1. The global header's **Filters** button opened a Sheet whose entire content was
   "Filter options will be wired here." — connected to nothing.
2. Five of the Job Board's own filters were silently ignored server-side: the
   client sends `type` / `remote_type` / `experience_level` / `company_size` /
   `sort_by` (`client/src/pages/candidate/jobs.tsx`), the server destructured
   `job_type` / `remoteType` / `experienceLevel` / `companySize` / `sortBy`
   (`routes/candidate.js`). Filtering only *appeared* to work via the page's
   client-side re-filtering of the returned page.

## Behaviour change (what a candidate now experiences)

- The header **Filters** button (candidates; every viewport width) opens a sheet
  with real controls: Keyword, Location, Job Type (Full-time / Part-time /
  Internship / Contract), Work Mode (Remote / Hybrid / On-site), Experience
  Level, Salary Range — with **Apply Filters** and **Clear Filters**.
- Apply writes those filters to `/candidate/jobs` using the board's own
  query-param names; the board syncs its `FilterState` from the URL, so the
  header door and the in-page `JobFilterBar` controls are ONE filter behaviour
  (same state, same results). Off the Job Board, Apply navigates to the board
  with the filters applied. The button shows the active-filter count on the board.
- The server now honours every parameter the client sends (aliases coalesced in
  `GET /candidate/jobs` only), so combined filters are enforced server-side, not
  just re-filtered client-side.
- Honest states unchanged and now reachable through both doors: active-filter
  count, and "No jobs match your filters" with a working Clear Filters action.
- Recruiters no longer see the Filters button (the candidate Job Board is not a
  recruiter surface; a dead button must not exist for either role). Recruiter
  header navigation is otherwise unchanged.

## Specialist STOP 1 review fixes (a11y-architect + frontend-developer)

- **B1 (param-collision guard):** the header writes a `filters=1` marker with
  its filter params, and the board/header honour those params only when the
  marker is present — a bare `type`/`location` param from any other link or a
  future feature can never be misread as filter intent. Verified by grep: no
  live route or link consumes a bare `type` on candidate routes today.
- **B2 (salary semantics):** the API returns `salary_min`/`salary_max` as
  strings or NULL. The board's client-side salary refinement now coerces with
  `Number()` and treats a NULL bound as no-match when that filter is set —
  exactly the server's semantics — so the two layers can never disagree.
- **Follow-up filed as #1632 (not blocking):** the shared `Sheet` primitive
  lacks dialog semantics (`role="dialog"`/`aria-modal`) and focus return; it
  affects this sheet and JobFilterBar's mobile sheet equally. Labels in the
  new sheet are `htmlFor`-linked, targets ≥44px, Esc/backdrop close work today.

## Independent diff review — BLOCK B-1 fixed (re-review via delta review)

The independent reviewer blocked the first diff: the board reset its
URL-driven fields whenever the `filters=1` marker *disappeared*, and marker
absence can also mean a skill deep-link navigation or Back — the reset wiped
`search`, which skill chips and AI search also own. **Fix:** absence now
leaves state untouched; clearing is an explicit signal — header Clear (and
Apply with an empty draft) navigates to `/candidate/jobs?filters=clear`, and
the board resets only for that signal. A regression test pins the state
machine's shape.

Reviewer item B-2 (matchPreferences narrowing) was rebutted with evidence:
`_matchPreferences` is computed in `jobs.tsx` but is **not** part of the
filter return conjunction — it is dead pre-existing computation and cannot
narrow results; no behaviour change was made for it. Reviewer item B-3
(JobCard salary display) is a pre-existing display-layer observation, out of
scope here.

## Tests

- Journey acceptance tests (written red first):
  `server/__tests__/routes/candidate-jobs-filters-1600.test.js` —
  static contract layer (placeholder gone, field set, param names, URL sync,
  server alias acceptance, mobile/recruiter guards) + real-HTTP integration
  layer (JT-J1–J3) gated behind `JT1600_BASE_URL` + `JT1600_INTEGRATION_DB_URL`,
  run by Quinn against a fresh-install dev build (evidence on #1600).
- Quinn E2E (HL-003): fresh Postgres → `migrate.js` from empty → real server →
  seeded jobs → the exact client parameter names exercised over real HTTP,
  resulting state read back. See the Quinn comment on #1600 for requests,
  statuses, and result sets.

## Out of scope / observed

- Header Sort dropdown remains UI-only (PRD §8 — separate follow-up, unchanged).
- Server clamps `limit` to 50 in `GET /candidate/jobs` (pre-existing pagination
  behaviour; the client asks for 200). Not changed by this fix.
