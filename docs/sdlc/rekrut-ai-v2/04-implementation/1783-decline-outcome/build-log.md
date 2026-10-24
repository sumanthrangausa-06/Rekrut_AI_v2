# #1783 — Candidate interview decline writes free-text reason into `scheduled_interviews.outcome`

Build log · Nova (implementation) · 2026-10-23 · Branch `nova/1783-decline-outcome` off `origin/dev` `b513d6cfd`

## Root cause (STOP 1, on the issue)
`PUT /api/candidate/interviews/:id/decline` (`routes/candidate.js`) wrote the
candidate's free-text decline reason (`reason || 'Candidate declined'`) into
`scheduled_interviews.outcome`. That column is a closed evaluation vocabulary:
`chk_scheduled_interviews_outcome` (`migrations/p2_schema_hardening.sql:2820`
only — migration 047 adds no outcome constraint; its `scheduled_interviews`
entry is the *status* CHECK at :632-634; correction recorded in the #1788
design, §10) allows only
`passed / failed / pending_review / no_decision / NULL`. On a fully migrated DB
every decline therefore failed with PG 23514 and the candidate got HTTP 500 —
the interview stayed `scheduled`.

## Verify-first evidence (fresh-install rig)
Throwaway Postgres 16, empty DB built by `node migrate.js` from empty, real
server over real HTTP, seeded company/job/candidate/recruiter + one
`scheduled` interview:

- Pre-fix: `PUT /api/candidate/interviews/1/decline {"reason":"Schedule conflict - family event"}`
  → **HTTP 500** `{"error":"Failed to decline interview"}`; server log:
  `violates check constraint "chk_scheduled_interviews_outcome"`;
  read-back: `status='scheduled', outcome=NULL, notes=NULL` (decline lost).
- Post-fix (same rig, same request): **HTTP 200**, read-back:
  `status='cancelled', outcome=NULL, notes='\n[Declined] Schedule conflict - family event'`.

## Fix (Option A from STOP 1 — code evidence)
- `routes/candidate.js` decline: `status='cancelled'`, `outcome=NULL`, and the
  reason is appended to `notes` — the exact pattern the sibling reschedule
  route in the same file already uses for candidate free-text reasons
  (`[Reschedule request] …`). `notes` is already returned by the candidate
  interview list and rendered in recruiter interview views, so the reason
  stays visible where it was always meant to be seen. `feedback` (JSONB,
  structured recruiter feedback / OmniScore input) was rejected as a home for
  it; widening the CHECK was rejected (closed vocabulary, schema gate).
- Class check — every writer of `scheduled_interviews.outcome` (git grep over
  routes/services): candidate decline (fixed above) and
  `routes/recruiter.js PUT /interviews/:id`, which passed the client value
  through unvalidated (same PG 23514 → 500 class; Quinn hit it on PR #1778
  with outcome `no_show`). It now validates against the CHECK vocabulary and
  returns an honest **400** for an out-of-vocabulary outcome; lawful values
  still write. All other writers (accept, reschedule, cancel, inserts) do not
  write `outcome`.

## Tests
- New real-DB suite `server/__tests__/candidate-decline-outcome-realdb-1783.test.js`
  (pattern of `omniscore-reliability-realdb-1776.test.js`; gated on
  `CAND1783_INTEGRATION_DB_URL`): decline with reason → 200/cancelled/outcome
  NULL/reason in notes; decline with no reason → 200/cancelled/default note;
  recruiter sibling → 400 on `no_show`, 200 + persisted `passed` on lawful
  outcome. **Red before fix (3/3 failed, HTTP 500), green after (3/3).**
- Neighbours: `omniscore-reliability-1776`, `omniscore-factors`,
  `honest-null-candidate-routes`, `candidate-score-fallbacks-1377` — 51/51
  passed; `omniscore-reliability-realdb-1776` against the same migrated DB —
  2/2 passed.

## Quinn journey gate (AFTER capture, for Lead to arrange)
Candidate journey step: sign in as a candidate with a `scheduled` interview →
open My Interviews → Decline → type a reason → submit. Expect: success (no
error toast / no 500), the interview shows as cancelled, and on read-back
`status='cancelled'`, `outcome IS NULL`, and the typed reason is present in
`notes` (visible on the recruiter interview view). Also decline with an empty
reason: still succeeds with the default `[Declined] Candidate declined` note.

## Observed, NOT fixed here (for Lead to file/verify separately)
The sibling reschedule route writes `status='reschedule_requested'`, which is
not in the fresh-DB `chk_scheduled_interviews_status` vocabulary
(`scheduled/confirmed/in_progress/completed/cancelled/no_show`). Flagged from
schema+code evidence only — not reproduced over HTTP in this lane, and the
correct resolution (vocabulary vs writer) is a separate design call.
