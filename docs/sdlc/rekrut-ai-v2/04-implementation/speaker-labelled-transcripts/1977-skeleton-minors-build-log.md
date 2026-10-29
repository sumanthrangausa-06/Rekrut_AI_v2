# #1977 — Skeleton-sweep review minors (build log)

Story: #1977 (follow-ups from the independent review of PR #1976,
comment 6501875894 — APPROVE-WITH-MINORS). Parent: #1973 (closed
via PR #1976, merge ff0381cde).
STOP 1: issue #1977 comment 6502998880 — root causes, specialist
decisions (privacy engineer + database reviewer, both USED;
security-reviewer and Rex considered and skipped with reasons),
and the recorded scope for every minor, written BEFORE the build.

## What changed

### Minor 2 — enumeration LIMIT-before-partition starvation (code)

`sweepPanelSkeletonEvents` (`lib/erasureService.js`) enumerated
with a single `ORDER BY ie.id LIMIT 100` and partitioned
held/dependent rows in JS *after* the limit, so >=100 accumulated
held/dependent skeletons starved deletable higher-id skeletons
indefinitely.

Fix (database-reviewer approved shape): keyset-paged enumeration.
`limit` is now the page size; pages are collected
(`ie.id > cursor ORDER BY ie.id`) until a short page ends the set,
and only then does deletion start — collect-before-delete keeps
the fail-closed property (an error on any page aborts the run
with zero deletions). The per-event DELETE is unchanged (full C-4
conjunction re-stated, SERIALIZABLE, FOR UPDATE), so candidates
inserted mid-enumeration are safe whether or not they join the
run. A per-run page cap (100 pages) bounds enumeration effort; a
capped run sets `enumerationTruncated` in the result and logs it
explicitly instead of silently stopping. Counts reconcile over
the full enumerated set, exactly as before on small data.

### Minor 1 — audit metadata (code + recorded deviation)

The audit row written in the DELETE transaction now also carries:

- `predicate_outcome` — `{signature, tombstone, chronology,
  no_panel_rows, no_dependents, no_active_hold}`, all true,
  **derived from the DELETE's own success** (its WHERE re-states
  the full conjunction, so rowCount=1 means every leg held at
  deletion time; never copied from enumeration state);
- `last_panel_row_deletion_timestamp` — an explicit
  unavailability marker `{value: null, source: 'unavailable',
  reason_code: 'panel_rows_deleted_without_deletion_timestamp',
  recorded_on: '#1977'}`.

**Deviation record:** #1973's STOP 1 privacy condition asked for
the actual last-panel-row deletion timestamp. It is unobtainable
in-schema — panel rows are deleted by the panel members' own
erasures and no deletion timestamp for them is recorded anywhere;
by sweep time the rows are gone. The timestamp will therefore
never be carried; this log, the STOP 1 on #1977, and the marker
in every audit row are the record of that deviation (it was
previously narrowed silently — that is what this follow-up
repairs). Per the privacy engineer: the candidate's own
`deleted_at` is NOT substituted (it would create a new joinable
timeline for an erased subject); booleans only — no panel-member
ids or counts, no consent decisions, no hold detail.
Privacy-engineer flag recorded on #1977 for Lex/Suga (not built
here): audit-log retention for `skeleton_event_swept` rows is an
unowned open question.

### Minor 3 — coverage gaps closed in the shipped suite

`server/__tests__/lib/erasure-skeleton-sweep-1973.integration.test.js`:

- **S11** session-linked skeleton seed (the fourth A-2 dependent
  leg — previously only probe-verified by the reviewer by hand);
  the AC-5 posture-audit query also gains the session-link leg it
  was missing.
- **AUDIT** assertions: exactly one `skeleton_event_swept` row for
  a swept event, metadata shape asserted (label, event id,
  tombstone user id, predicate outcome, unavailability marker);
  no audit row for a held event.
- **RACE** posture: a wrapper pool inserts a panel row the moment
  enumeration returns; the event survives (never deleted in that
  run) and sweeps cleanly once the row is removed.
- **STARVE** regression: 12 held skeletons ahead of a deletable
  one, swept with page size 5 — the deletable one is reached and
  deleted in the same run; all held skeletons persist.

### Minor 4 — C-2 interpretation (no action; already recorded)

Verified first-hand before build: #1973 closure comment
6501904142 already records the interpretation (enumeration errors
abort the run with zero deletions; per-event lookup failures
count as lookupFailedSkipped and the event is never deleted).
Not duplicated.

## Evidence (HL-003)

Rig: local PG 16 at 127.0.0.1:55433 (the /tmp/pg1973 rig),
fresh DB `skel1977_e2e`, `node migrate.js` exit 0.

- Red first (tests extended, lib untouched): **3 failed / 5
  passed** — journey (audit metadata + result shape), STARVE
  (the starvation defect), unit empty-run shape. RACE and S11
  pass on the old code: they are coverage for behaviour the
  reviewer had probe-verified correct, not defects.
- Green after the fix: skeleton integration **6/6** + unit
  **2/2**; a second consecutive run on the same DB also **8/8**
  (seed cleanup covers the new candidates).
- Regressions: #1972 GAP-C integration **2/2** on its own
  fresh-migrated DB (`gapc1977_e2e`, migrate exit 0); mocked
  erasure family **260/260** across 17 suites — identical to the
  #1973 baseline.
