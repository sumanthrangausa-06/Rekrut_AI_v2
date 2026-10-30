# #1993 — transcriptStitch int4 range guard (build log)

Story: #1993 (follow-up flagged by the independent reviewer on
PR #1992 / #1934, concurred by Nova + Suga; deliberately not
scope-grown into the #1934 lane). STOP 1: issue #1993 comment
6514530604 — root cause, specialist decision (none used;
privacy/security/database considered and skipped with reasons,
following the #1934 M-3 precedent), and the discussed Rex/Lead/Scout
position on throw-vs-skip, written BEFORE the build.
Base: dev `4325e4ad0`.

## The discussed decision (STOP 1, summarised)

The key call was the failure mode for an out-of-range speaker at the
per-segment `speaker_number` UPDATE in `persistStitch`:

- **Option A (settled) — throw.** Extend the existing guard: an
  integer speaker `< 0` or `> INT4_MAX` throws like the existing
  non-integer case; the whole stitch rolls back (run included), the
  recording/job stay `processing` for retry.
- **Option B (Lead's dissent, preserved on the STOP 1) — skip.**
  Mirror `computeProposal`'s skip: out-of-range turns never label a
  segment, the segment stays NULL, the stitch completes.

Rex's deciding argument: AC-5 / architecture §3.6.6 was authored for
exactly this write, and an out-of-range **max-overlap winner** is a
positive assertion about the segment (the engine says this
unrepresentable speaker said most of it), not an absence — ties,
no-overlap, and sub-floor turns are absences and honestly render
NULL. `computeProposal`'s skip is not a counter-precedent: the §3.7
proposal is advisory and voidable wholesale, and its skip can never
assert anything false about a segment. Lead's poison-pill caveat
(a deterministically-corrupt recording retries forever) is recorded:
it already exists today for fractional speakers under AC-5, so A
widens an accepted failure mode rather than creating one; a
terminal-state policy for corrupt output is a separate follow-up.

`INT4_MAX` is **reused from `lib/speakerMapping.js`**:
`transcriptStitch.js` already requires that module (L27) and
`speakerMapping` does not require it back — no cycle, and both int4
writes now share one contract definition.

## What changed

- `lib/transcriptStitch.js` — in the `persistStitch` segment loop,
  immediately after the existing non-integer throw: a range check
  `speaker < 0 || speaker > speakerMapping.INT4_MAX` throwing
  `transcriptStitch: out-of-range speaker <n> from engine output`.
  Nothing else. No migration (`speaker_number` is already int4,
  migration 296), no scoring/matching/screening imports (BR-12).
- `server/__tests__/lib/transcriptStitch.integration.test.js` —
  three new cases: negative winner, >INT4_MAX winner, and the
  INT4_MAX boundary pin (in-contract, persists exactly).

## Evidence (HL-003 / HL-007)

- **Red first (base `4325e4ad0`, lib untouched):** 2 failed / 7
  passed in `transcriptStitch.integration.test.js` on fresh DB
  `nova1993_e2e` (PG 18.6 @127.0.0.1:55436, `node migrate.js`
  exit 0). Negative case: the stitch **resolved
  `{outcome: 'complete'}`** — speaker -1 persisted. >INT4_MAX case:
  rejected, but with the raw PG message `value "3000000000" is out
  of range for type integer`, not the contract error. The INT4_MAX
  boundary pin passed on base as designed (contract pin).
- **Green (fresh DB `nova1993_green`, PG 18.6, `node migrate.js`
  exit 0):** `transcriptStitch.integration.test.js` **9/9 PASS** —
  both out-of-range cases reject with the range-contract error and
  roll back EVERYTHING (segments `[NULL, NULL]`, zero run rows,
  zero mapping rows, recording + job still `processing`, all read
  back from the DB); the boundary case completes and persists
  `2147483647` exactly; the normal 0/1 case (AC-1/AC-5) persists
  exactly as before. Unit regression: `transcriptStitch.test.js` +
  `speakerMapping.test.js` + `diarizationWorker.test.js` **63/63
  PASS**.
- **BR-12 fence:** `diarizationFence-1916.test.js` — both direction
  tests (no diarization↔scoring/matching/screening imports either
  way) PASS. The suite's other 2 failures are **identical on
  untouched base** (pre-existing allowlist drift, same as recorded
  in the #1934 build log); not this change.
- Rig note: the shared `/home/pguser` PG is absent on this VM;
  this lane rebuilt a fresh PG 18.6 cluster from
  `~/workspace/pgfull` under `/var/tmp/pg1993` on port 55436 and
  verified it with a `migrate.js` run (exit 0) before trusting it.

## Documentation

One-point defect fix: the STOP 1 root-cause + discussed decision +
this build log satisfies the documentation rule (no user-visible
behaviour change beyond corrupt-output handling). This log is
included because the #1934 lane (PR #1992) included one.
