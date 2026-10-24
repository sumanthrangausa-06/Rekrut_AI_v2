# #1788 — Candidate reschedule writes a status the CHECK forbids — Build Log

**Story:** #1788 (P1, CONFIRMED) · **Branch:** `nova/1788-reschedule-vocab`
(base: `origin/dev` `97aacaee3ba47121e89874b185b05aa6197257b0`) ·
**STOP 1:** issue #1788 comment `6380367616` (design cited, specialist
decision, §2.3 writer inventory re-run, red baseline) ·
**Design:** Rex,
`docs/sdlc/rekrut-ai-v2/03-solutioning/interview-reschedule-vocabulary/design.md`
(PR #1794) — built exactly per D1–D7 / §6.1 / §7 / §8.

## Root cause

`PUT /api/candidate/interviews/:id/reschedule` (`routes/candidate.js`)
writes `status = 'reschedule_requested'` into `scheduled_interviews`.
Every reader already speaks that value (candidate page badge + upcoming
filter, recruiter page badge + the Confirm button it gates, recruiter
dashboard needs-action filter), but both historical definitions of
`chk_scheduled_interviews_status` forbid it — 047's list
(`scheduled/confirmed/in_progress/completed/cancelled/no_show`, the one
a fresh install actually gets) and p2's list (which swaps
`in_progress` for `rescheduled`). On a migrated DB every reschedule
fails PG 23514 → HTTP 500 and the request silently never happens — the
#1783 defect class, sibling route. The writer and the readers agree;
the schema is the only side of the contract that is wrong (migration
275 / 292 precedent).

## Red baseline (recorded before any fix was written)

Fresh-install rig (throwaway PG 16.2, empty DB built **only** by
`node migrate.js` from pristine dev, real `node server.js`, journey
setup entirely through real APIs; `/health` commit `97aacaee3`):

- Schema read-back: `chk_scheduled_interviews_status` = 047's 6-value
  list; `reschedule_requested` absent.
- `PUT /api/candidate/interviews/1/reschedule {"reason":"Family event - need to move","preferred_time":<+48h>}`
  → **HTTP 500** `{"error":"Failed to request reschedule"}`; server log
  PG **`23514`**, constraint `chk_scheduled_interviews_status`.
- Read-back: row unchanged (`scheduled`, outcome NULL, notes NULL).

## Fix (design §6/§7 — minimum surgical diff, three files + this log)

- `migrations/293_scheduled_interviews_status_union.js` (D1/D2/D3):
  drops every status-vocabulary CHECK on `scheduled_interviews` **by
  definition** (marker pair `%status%` + `%no_show%` — matches both
  historical definitions, does NOT match the outcome CHECK) and
  re-adds exactly one under the exact name
  `chk_scheduled_interviews_status` with the canonical union
  (`scheduled, confirmed, in_progress, completed, cancelled, no_show,
  rescheduled, reschedule_requested`). The name is load-bearing: p2's
  status block re-adds its narrow list whenever that name is absent.
  No exception handler anywhere (loud failure through migrate.js's
  per-file transaction). Expand-only: no value removed, no row touched;
  no contract step — the union IS the canonical vocabulary.
  `down()` follows migration 274's honesty precedent (refuses to
  narrow while widened-only rows exist). 047 and
  `p2_schema_hardening.sql` are NOT edited; the outcome CHECK is NOT
  touched.
- `routes/recruiter.js` `PUT /interviews/:id` (D5, §6.1): an
  `ALLOWED_STATUSES` validation block beside the existing outcome
  block. `status == null` (null or omitted) keeps the stored value via
  the existing `COALESCE`; a canonical value passes through; anything
  else, including `''`, returns an honest **400**
  (`Invalid interview status: …`) with no write. Only the validated
  value (`storedStatus`) is bound to the update — never the raw body
  value. Nothing else in the handler changes (auth chain, company
  scoping, outcome translation, feedback, cache invalidation, calendar
  sync). This is validation, not translation (§6.3): no client speaks
  a second status vocabulary.
- No client changes (D6); no other writer changes (§6.2 — the STOP 1
  grep re-run confirmed W1–W6 write server literals or omit the
  column).

## Tests — red first, then green

Rig for the suites: throwaway PG 16.2, empty DB built only by
`node migrate.js` **with migration 293 in the tree** (exit 0; schema
read-back: exactly one status CHECK with all 8 values, outcome CHECK
unchanged), real routers over real HTTP (supertest, real `lib/db` +
auth), rows read back.

- **New suite** `server/__tests__/candidate-reschedule-vocab-realdb-1788.test.js`
  (gated on `CAND1788_INTEGRATION_DB_URL`): **14/14** — schema
  read-back (one CHECK, 8 values, outcome unchanged, direct-SQL
  `bogus_status` still 23514); reschedule from `scheduled` AND from
  `confirmed` (200, `reschedule_requested`, original `scheduled_at`
  kept, `[Reschedule request]` + reason + `Preferred:` in notes);
  no-reason leg (200, default note); **leg A** recruiter Confirm via
  W7 → `confirmed`; **leg B** recruiter new-time via
  `PUT /api/interviews/reschedule` → `scheduled` at the new time; W7
  `reschedule_requested` → 200 persisted; W7 `maybe` / `declined` /
  `''` → 400 unchanged; W7 null/omitted → 200 unchanged; candidate
  rescheduling `completed` / `cancelled` / another candidate's → 404
  unchanged.
- **Neighbours, same DB, unmodified:** #1783 suite **3/3**, #1789
  suite **15/15** — the §6.1 block sits in their handler, so their
  green is this lane's regression evidence.
- **Migration robustness (database-reviewer lens):** fresh-install
  apply (above); idempotent re-run (record removed → re-migrate exit
  0, still exactly one status CHECK); p2-state convergence (live def
  forced to p2's narrow 6-value list → re-migrate exit 0 → exactly one
  union CHECK, outcome untouched); `down()` with
  `reschedule_requested` rows present logs the refusal and leaves the
  widened CHECK in place.
- **Assembled-app journey (this lane's development evidence):** full
  `node server.js` on the migrated DB, setup + journey entirely
  through real APIs — candidate reschedule 200 with DB + candidate-list
  read-backs, recruiter Confirm leg A, W7 `maybe` 400 unchanged,
  second interview reschedule + new-time leg B. (The independent Quinn
  AFTER capture on the assembled fresh-install app remains the
  completion gate, HL-003 — Lead's step.)

## Specialist decision (STOP 1)

YES — **ecc/database-reviewer (mandatory, design §9.1):** the risk
domain is the DB CHECK vocabulary / migration on the shared
staging/production DB. Applied to: by-definition drop precision
(outcome CHECK provably untouched — schema read-backs above), the
load-bearing constraint name, expand-only accounting, loud failure,
idempotency / state-agnostic convergence (all exercised, above).
**Security skipped** (no auth/scoping/exposure surface changes) and
**privacy skipped** (no personal-data handling changes), with reasons,
on the STOP 1 comment.

## §10 citation nit

Already landed with the design PR (#1794): the #1783 build log's
root-cause paragraph now cites `p2_schema_hardening.sql:2820` alone for
the outcome CHECK. Nothing to carry in this PR.
