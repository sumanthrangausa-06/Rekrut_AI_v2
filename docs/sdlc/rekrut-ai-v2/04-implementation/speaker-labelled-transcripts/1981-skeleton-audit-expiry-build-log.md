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
  interview_sessions) plus job-application attribution: any
  company the subject has a retained `job_applications` row with
  (privacy HIGH-1 — that skeleton survives erasure with
  company_id intact, so this branch IS reachable at purge time),
  and a precise `target_id` leg for rows whose event still
  exists. Recorded limit: the sweep's own precise
  event→application leg keys through the event it deleted, so
  that exact leg cannot fire for swept rows; the residual
  question is on #1981 for Lex. The subject CASE also guards
  non-object metadata (`jsonb_typeof`) so an array/scalar
  metadata value reads as unattributable instead of raising.
  The summary entry breaks out `unattributable_skips` from
  `held_skips` (#1154 audit-truthfulness precedent).
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
local Postgres rig (integration suite, 15 postures + 2 sequence
tests): dry-run held_skips=9 (incl. unattributable_skips=5) /
affected=3 / zero deletions; live run deleted exactly the
unheld-expired, released-hold, and 2556-day rows — all held
(incl. the applications-only company hold), unexpired,
malformed, and generic rows survived read-back. Two further
tests behaviourally prove the generic-branch exclusion (an
armed 30-day generic policy deletes a 100-day generic row but
cannot touch a 100-day skeleton row; skeleton entry appears
exactly once despite two policy rows) and the release sequence
(purge-while-held → release deletes nothing → next purge
deletes). Sensitivity check: with the pre-amendment predicate
restored, the integration tests fail.
Full evidence on PR #1982 and the #1981 checkpoint comment.
