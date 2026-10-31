# #2011 Part B — `panel_consent_snapshot` retention-clock sweep (build log)

Story: #2011 [FOLLOW-UP] panel_consent_snapshot retention-clock sweep — Part B
ONLY (the sweep itself; Part A, the retained-count disclosure, merged as
PR #2023). #2011 stays OPEN after this lane — Suga gates the merge.
Design: Rex, `docs/sdlc/rekrut-ai-v2/03-solutioning/speaker-labelled-transcripts/snapshot-retention-sweep-design.md`
(PR #2024) — implemented exactly (§3 clock, §4 sweep shape, §5 two-leg gating).
STOP 1: issue #2011 comment 6537402928 (posted before any code; specialist
decision YES — privacy engineer + Lex lens + database lens, per design §7).
Base: dev `e0806202a`. Branch: `fix/2011-part-b-snapshot-sweep`.
PR to dev only; no merge/closure by Nova — Suga gates.

## Root cause

`diarization_jobs`/`diarization_runs` rows die with their recording only on
HARD delete (migration 296 `ON DELETE CASCADE`). Recordings actually end by
soft-delete (`purgeExpiredRecordings`) or by GAP-A keep-redacted tombstone —
both leave the host rows, and their `panel_consent_snapshot` copies, alive
indefinitely. Nothing tied a snapshot copy's lifetime to its source
`event_labelling_consent` record, so a retained copy could outlive the record
it copies (Lex R-1 from #1944). The #1973 skeleton sweep's header comment
already deferred exactly this work.

## What changed

- `lib/erasureService.js`: new `sweepPanelConsentSnapshots({ queryable, dryRun })`
  + export, sibling to `sweepPanelSkeletonEvents`.
  - **Clock (§3):** a reference to panel user U (Part A's enumeration:
    `expected_user_ids` OR any `decisions[].user_id`) is expired when BOTH
    (1) U's source row for the snapshot's event is gone — no
    `event_labelling_consent` row for (host recording's
    `interview_event_id`, U) and none with `id = decisions[].record_id`; AND
    (2) the host recording has ended — `retention_expires_at` in the past,
    OR tombstone (`status='deleted'`), OR recording gone (LEFT JOIN miss).
    No new duration invented; Gate-A C-06 stays open.
  - **Surgery (§4):** JS-side, the #2014 form — U removed from
    `expected_user_ids`, U's `decisions` entries become JSON `null` (entries
    nulled, never deleted). A row is rewritten only when one of its
    references actually expired, so live snapshots stay byte-identical. A
    snapshot referencing no user any more is set to `NULL`; the host job/run
    row survives.
  - **Gating (§5):** host ended by tombstone/gone = erasure-completion leg,
    ungated in both modes (#1172/#1973 precedent). Host ended by
    `retention_expires_at` only = retention-expiry leg, live only when
    `dryRun` is false; under dry-run those references are counted
    (`retentionLegDryRunSkipped`), never removed. `RETENTION_PURGE_LIVE` is
    flipped nowhere.
  - **Legal hold:** `findActiveHold` consulted per expired reference for the
    panel user AND the host candidate (fail-closed, skeleton discipline):
    held ⇒ untouched, counted `heldSkipped`; lookup error ⇒ untouched,
    counted `lookupFailedSkipped`, never as held.
  - **Counters:** `{ scanned, snapshotsExpired, referencesRemoved,
    erasureLegRemoved, retentionLegRemoved, retentionLegDryRunSkipped,
    heldSkipped, lookupFailedSkipped }` — counts only, no snapshot content,
    no user ids. Part A's count semantics untouched.
- `server.js`: one call inside the existing 24h `startRecordingRetention`
  interval beside the skeleton sweep (`{ dryRun: opts.dryRun }`), with its
  OWN `[erasure]` log line (#1176 O-4 labelling) — never conflated with the
  retention mode line. No new scheduler.
- `server/__tests__/lib/erasure-snapshot-sweep-2011.integration.test.js`:
  NEW JT-D7-family suite (see Evidence).

## Evidence (HL-003, local PG 18.6 + pgvector rig @127.0.0.1:55439, /opt/pg2011)

- **Red-first:** suite run on unmodified base `e0806202a` (fresh DB
  `snap2011_red`, migrate exit 0): **4 failed / 4 total** —
  `sweepPanelConsentSnapshots is not a function` (seeding clean; the only
  failure is the missing sweep).
- **Green:** fresh DB `snap2011_green`, `node migrate.js` exit 0, suite
  **4 passed / 4**. Matrix: panel user × host recordings live /
  retention-expired / tombstone × source present / deleted, across jobs
  and runs; shared snapshot loses only the expired user's reference;
  emptied snapshots ⇒ `NULL` with the host row surviving; expected-only
  and decisions-only reference shapes both swept; the Part A reviewer-minor
  negative fixture (snapshot referencing only a live-source user on an
  ended recording) stays byte-identical; legal-hold subject untouched and
  counted `heldSkipped`; dry-run removes the erasure leg only and counts
  the retention leg; a third sweep is idempotent.
  Counters observed: dry-run run — scanned=11, removed=3 (all erasure leg),
  retention dry-run-skipped=2, held=1; live run — scanned=10, removed=2
  (all retention leg), held=1; third run — removed=0, held=1.
- **Mutations (each on its own fresh migrated DB, then restored):**
  drop the source-existence predicate ⇒ **2 failed / 4** (live-source
  copies swept early — red, as designed). Drop the host-end predicate ⇒
  **2 failed / 4** (copies on live recordings swept — red, as designed).
  Post-restore re-run on fresh DB `snap2011_restore`: **4 passed / 4**;
  zero `MUTATION` markers remain in the file.
- **Neighbours (each on its own fresh migrated DB):** JT-D7 / Part A —
  `erasure-diarization-1915.integration.test.js` **1/1**; gap-c —
  `gap-c-1972-panel-erasure.integration.test.js` **2/2**; skeleton sweep —
  `erasure-skeleton-sweep-1973.integration.test.js` **6/6**. Mock batch:
  medium-tables, gap-c unit, skeleton unit all pass; `erasure-gap-a.test.js`
  shows the same **3 failures documented as pre-existing on unmodified
  base** in the Part A lane (recording-redaction tests, unrelated to this
  change).
- `node --check server.js` OK; `lib/erasureService.js` loads clean.

## What this does NOT do (design §8)

No migration. No scheduler. No `RETENTION_PURGE_LIVE` flip. No change to
Part A's count semantics. Does not close #2011 — Suga gates merge after
independent review.
