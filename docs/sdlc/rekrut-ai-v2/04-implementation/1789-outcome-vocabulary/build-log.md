# #1789 — Recruiter interview feedback outcome vocabulary — Build Log

**Story:** #1789 (P1, filed by Lead from the independent review of PR #1786,
Finding 3) · **Branch:** `nova/1789-outcome-vocab` (base: `origin/dev`
`969bdaf51`) · **STOP 1:** issue #1789 comment 6377736485 (root cause, fix
plan, specialist decision) · **Design:** Rex,
`docs/sdlc/rekrut-ai-v2/03-solutioning/interview-outcome-vocabulary/design.md`
(PR #1790) — built exactly per §5/§6/§9, option (b).

## Root cause

The only real client of `PUT /api/recruiter/interviews/:id`
(`client/src/pages/recruiter/interviews.tsx`, `submitFeedback()`) sends only
the hire-family vocabulary — `strong_hire / hire / lean_hire / lean_no_hire /
no_hire`, or `'completed'` when the recruiter picks nothing
(`fbOutcome || 'completed'`). None of those six values is in
`chk_scheduled_interviews_outcome` (`passed / failed / pending_review /
no_decision / NULL`). The route's #1786 validation correctly rejected them
with an honest 400 — so every real UI feedback submission lost its feedback
(pre-#1786: PG 23514 → 500). The defect is at the API boundary, not in the
data model.

## Fix (design §6 — minimum surgical diff, two files)

- `routes/recruiter.js`, `PUT /interviews/:id` only (§6.1): the
  `ALLOWED_OUTCOMES` rejection becomes a translation step. Client values
  translate per §5 — `strong_hire / hire / lean_hire → passed`,
  `lean_no_hire / no_hire → failed`, `completed → no_decision` (D4: a
  no-selection submit records **no** decision; never a fabricated `passed`).
  Canonical values pass through unchanged. Anything else (incl. `''`,
  `no_show`, `maybe`) keeps the honest 400, now listing both accepted
  vocabularies, row unchanged. Only the translated value reaches the
  existing `COALESCE` update — no hire-family string can reach the DB.
  D7 is the chosen contract: `outcome: null` / omitted keeps the stored
  value (the handler's partial-update semantics); there is no
  clear-to-NULL; retraction is an explicit `no_decision`. Nothing else in
  the handler changes (auth chain, company scoping, feedback JSON, cache
  invalidation, calendar sync).
- `client/src/pages/recruiter/interviews.tsx`, display only (§6.4, D6):
  two lookup maps at module level. Dialog re-open on a past interview
  reverse-maps the stored value to the select's representative value
  (`passed → hire`, `failed → no_hire`, `pending_review / no_decision /
  NULL → ''`) — `hire`, not `strong_hire`, because the stored data no
  longer knows the original gradation (§6.2 accepted loss). The outcome
  badge renders the same representative labels (`Hire` / `No Hire` /
  `No decision` / `Pending review`; null → no badge). Select options and
  `submitFeedback()`'s request shape do not change. The candidate surface
  is not changed.
- No migration, no CHECK change, OmniScore untouched (D2/D3): stored
  values stay canonical, so both OmniScore outcome readers keep working
  exactly as today.

## Tests — red first, then green

Rig: throwaway PG16 cluster on 127.0.0.1:55489, empty DB built only by
`node migrate.js` (exit 0), the real recruiter router over real HTTP
(supertest, real `lib/db` + auth), rows read back from the DB.

- **Red (before the fix), recorded on #1789 (comment 6377791246):** new
  suite `server/__tests__/recruiter-outcome-vocab-realdb-1789.test.js` —
  **8 failed / 7 passed**. Every client-vocabulary submit returned 400
  and the feedback was lost; the 7 passes were the pre-existing lawful
  behaviour (canonical pass-through ×4, honest 400 for `no_show` /
  `maybe` / `''` ×3).
- **Green (after the fix):** the new suite **15/15** — the full §5 table
  asserted from stored state, `strong_hire` feedback preserved verbatim,
  `completed → no_decision` (explicitly not `passed`), D7 keep-on-null /
  omitted pinned, `''` → 400, change-of-mind `passed` + `no_hire` →
  `failed`.
- **Neighbours on the same DB:** the #1783 suite
  (`candidate-decline-outcome-realdb-1783`) **3/3, unmodified** (D8: its
  `completed`-as-bad-value premise is superseded — `completed` is now a
  lawful alias tested as a translation in the new suite; `maybe` is the
  second genuinely-bad value alongside `no_show`);
  `omniscore-interview-performance-realdb-1782` + `omniscore-factors`
  **34/34**.
- Client: `tsc --noEmit` shows no new error in `interviews.tsx` from
  this change (the one error in that file, L997 `screening_session_id`,
  is pre-existing on dev and outside this diff, as are the repo's other
  standing tsc errors).

## Specialist decision (STOP 1)

YES — **ecc/code-reviewer** (mandatory): the risk domain is the API
contract (one route's accepted vocabulary, the §5 translation table),
and this touches interview outcome persistence. **ecc/database-reviewer
considered and skipped** per design §9.1: under option (b) there is no
migration, column, or query change; it becomes mandatory only if option
(c) is re-opened.

## Quinn journey gate (AFTER capture, for Lead to arrange)

Design §8 on the assembled fresh-install app: recruiter loads their
interview list → submits feedback exactly as the client builds it
(`strong_hire` first) → 200, row reads back `status='completed'`,
`outcome='passed'`, feedback verbatim → re-open the dialog: the select
presents `hire` and the badge reads "Hire" → candidate's scheduled list
renders the canonical "Result:" word with no error → no-selection submit
stores `no_decision`, never `passed`. This lane's real-DB suite is the
development evidence; the assembled-app journey capture is the
completion evidence (HL-003) and remains for the gate.
