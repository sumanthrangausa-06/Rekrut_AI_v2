# #1981 — Hold-aware expiry purge for skeleton_event_swept audit rows (build log)

Story: #1981 (follow-up from Lex position on #1979, comment
6504275867). STOP 1: issue #1981 comment 6505671957 — root cause,
specialist decisions (privacy engineer + database reviewer, both
mandatory and USED; Rex + Lead discussed; security/UX/schema
specialists considered and skipped with reasons), written BEFORE
the build. PR: #1982 (to dev; not merged at time of writing —
Suga verifies first-hand).

## Behaviour change (admin-facing only)

The retention purge summary gains one aggregate entry,
`audit_logs_skeleton_event_swept`. No user UI or API shape changes.
The purge itself remains behind the existing route gate
(`RETENTION_PURGE_LIVE=true` + production); this story builds the
path, it does not arm it. Proof is dev-rig-only by nature: no
2555-day-old rows can exist on staging and PURGE_LIVE is off, so
no staging proof is owed or claimed.

## What changed

### Root cause

`sweepPanelSkeletonEvents` (lib/erasureService.js) writes
`skeleton_event_swept` audit rows with `user_id = NULL`; subject
linkage lives only in `metadata.tombstone_user_id`.
`EuComplianceService.executePurge` consulted holds via
`heldPredicate('audit_logs.user_id')`, which can never match for
this class — the old path was hold-blind for these rows. The
seeded audit_logs policy (migration 013: 2555 days,
`auto_delete=false`) also made the generic branch unreachable.

### Fix

- `lib/legalHold.js`: `skeletonAuditHeldPredicate()` /
  `skeletonAuditNotHeldPredicate()` — subject is a CASE-guarded
  cast of `metadata->>'tombstone_user_id'` (digit cap +
  int4-range check make the cast unable to raise); a missing /
  malformed / out-of-range subject reads as HELD (fail-closed).
  Company coverage mirrors `heldPredicate` (users.company_id +
  interview_sessions) plus the sweep's job-application branch via
  `target_id`. Recorded limit: the sweep deletes the event that
  branch keys through, so it normally cannot fire at purge time;
  the residual question is on #1981 for Lex.
- `services/euComplianceService.js`: the generic audit_logs
  branch excludes the skeleton class in all three statements;
  new `purgeExpiredSkeletonAuditRows` applies the fixed 2555-day
  clock from `created_at` (named period per Lex #1979, not read
  from the editable policy row), whole-row DELETE, aggregate
  counts only, no per-subject row written. `executePurge` appends
  its entry unconditionally (outside the auto_delete policy loop)
  and only for unscoped calls (`companyId == null` — these are
  system rows; a company-scoped call must not trigger or report
  global skeleton deletion).

### Evidence

Red-first unit suite failed 4/4 on base 12c2ee5be. Independent
reviewer: PASS, two LOWs fixed in-PR (negative-string tombstone
posture; 2554/2556-day boundary postures). Quinn E2E on a real
local Postgres rig (integration suite, 13 postures): dry-run
held_skips=7 / affected=3 / zero deletions; live run deleted
exactly the unheld-expired, released-hold, and 2556-day rows —
all held/unexpired/malformed/generic rows survived read-back.
Full evidence on PR #1982 and the #1981 checkpoint comment.
