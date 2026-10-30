# #1997 — Transcript GET tie-order key, trigger-based rollback pin, at-duration boundary (build log)

Story: #1997 [FOLLOW-UP] #1923 residuals — filed by Suga at the
#1923 gate (PR #1996 merged): Rex's GET tie-order complement, the
DB/transactions specialist's trigger-based rollback pin, and PR
#1996 review MINOR-1's remaining at-duration case.
STOP 1: issue #1997 comment 6516792032 (posted before any code).
Base: dev `e756abefe`. Branch: `nova/1997-transcript-residuals`.
PR to dev only; no merge/closure by Nova — Suga gates.

## Root cause

1. **GET tie-order:** the transcript GET (`server/routes/recordings.js`)
   carries two query variants (post-feature with `speaker_number`;
   legacy) and both ended `ORDER BY start_time_ms` with no secondary
   key. PostgreSQL guarantees no order among equal keys, so
   equal-start ties could read back in an order other than stored
   (insertion/`id`) order.
2. **Pin reachability:** PR #1996's pin A forces its mid-transaction
   failure via a BIGINT-overflow segment, which only reaches
   Postgres on a `duration_seconds = NULL` recording — with a known
   duration the #1923 bound clamps the probe first. Any future bound
   change could make that pin unreachable.
3. **At-duration branch untested:** the shipped bound filter is
   `startMs >= durationMs`; no test covered a segment starting
   exactly at the duration.

## Discussed decision (STOP 1, HL-004 — not a solo call)

Consulted before STOP 1: a database/transactions specialist (ecc
database-reviewer lens). Positions from #1923/#1997 already on the
record were not re-litigated.

- **GET tie key — `ORDER BY start_time_ms, id` in BOTH variants
  (Rex's recorded position, specialist concurring).** `id` is the
  primary key and monotonic in insertion order (segments insert
  sequentially in one transaction in sorted order), so ties now
  deterministically read back in stored order. The variants must not
  diverge in ordering semantics. No new index: per-recording result
  sets are small and the tie-break is a cheap in-memory sort step.
  The transcribe-handler comment naming the GET ordering is updated
  to match (PR #1996 review MINOR-3 precision, same substance).
- **Trigger pin — BEFORE INSERT on a text sentinel (specialist
  design review).** The sentinel segment sorts second (distinct
  start times), so at raise time the swap transaction has already
  executed all five deletes plus one successful insert; the pin
  proves rollback of both. A `start_time_ms`-keyed trigger was
  rejected: it couples the pin to the very timing logic it must
  outlive. Placement rules adopted verbatim from the specialist:
  install only after gen-1 + artefacts are planted, as committed
  (autocommit) statements (DDL in an uncommitted test transaction
  would be invisible to the handler's pool connection); teardown in
  a `finally` immediately after the HTTP request, before the
  intactness assertions, `DROP TRIGGER IF EXISTS` then
  `DROP FUNCTION IF EXISTS`; uniquely-prefixed names
  (`test1997_…`) plus a pre-clean at test start.
- **At-duration behaviour — derived, not invented.** The shipped
  filter drops any segment with `startMs >= durationMs`; clamping
  applies only to survivors' `endMs`. A segment starting exactly at
  the duration (12000 ms on a 12 s recording) therefore takes the
  drop branch: mixed payload → dropped-and-logged, HTTP 200, only
  in-bounds rows stored; sole segment → bounded list empty → honest
  500 before `BEGIN`, old generation untouched. The sole case is
  tested as a re-run over an existing gen-1 (specialist: only that
  version pins "untouched" rather than "still empty").
- **Not re-litigated:** fully-outside segments stay
  dropped-and-logged (not reject-whole); the transcribe response
  text stays the provider's text.

## What changed

- `server/routes/recordings.js` — GET handler only:
  `ORDER BY start_time_ms` → `ORDER BY start_time_ms, id` in both
  query variants; the transcribe-handler comment that names the GET
  ordering updated to match. Nothing else moves. No migration;
  `lib/ai-provider.js` untouched; `DIARIZATION_ENABLED` untouched.
- `server/__tests__/routes/recordings-segments-realdb-1904.test.js`
  — 4 new cases in the shipped suite (fixtures `TRIGGERFAIL`,
  `ATDUR`, `ATDUR_ONLY`; modes `trigfail`, `atdur`, `atduronly`):
  1. **GET tie determinism** — three equal-start segments planted
     directly in the DB (the suite's purged-tombstone precedent)
     with explicit ids assigned out of insertion order (physical
     order hi/lo/mid ≠ id order lo/mid/hi, as after a restore);
     GET must return them in id order.
  2. **Pin C (trigger rollback)** — gen-1 + planted diarization
     artefacts on a known-duration (12 s) recording; a
     `test1997_…` BEFORE-INSERT trigger raises on the `TRIGGER-BOOM`
     text sentinel; re-run payload `[0→2s valid, 2→5s sentinel]`
     (in-bounds times — no bound can pre-empt it): HTTP 500, gen-1
     segments byte-identical, all 4 artefact tables intact,
     `diarization_status='complete'`, recording `completed`, GET
     still serves gen-1, and the trigger is verified gone
     (`pg_trigger` count 0) after teardown.
  3. **At-duration mixed** — payload `[0→2s, 12→13s]` on a 12 s
     recording: HTTP 200, response shape asserted exactly, stored
     read-back exactly `[[0, 2000]]` (no at-duration row, no
     zero-span `[12000, 12000]` artefact), GET join is the
     in-bounds text only.
  4. **At-duration sole (re-run)** — gen-1 transcribed, then re-run
     with only `[12→13s]`: HTTP 500, gen-1 byte-identical,
     recording `completed`.

## Evidence (HL-003 / HL-007)

Rig: local PostgreSQL 18.6 on 127.0.0.1:55437 (existing rig
detected and reused, HL-009 spirit; tree under
`/var/tmp/pg1923-root`, data `/var/tmp/pg1923-data`). Fresh
databases per phase; the repo's real `node migrate.js`: exit 0,
"All migrations completed successfully" (both runs).

- **Red first (base handler `e756abefe` + the final test file,
  fresh DB `sd02_1997_red`, migrate exit 0): 1 failed / 14 passed
  of 15.** The GET tie test fails with the defect values: GET
  returned ids `[23, 21, 22]` (physical order) against expected
  `[21, 22, 23]` (id order). Pin C and both at-duration cases
  **passed on base** — they pin shipped #1923 semantics/atomicity
  and are reported as pins, not fixes. The 11 shipped cases passed.
  (Pre-check on the rig before building: the same planted-id layout
  on a scratch table returns physical order under
  `ORDER BY start_time_ms` alone and id order with `, id`.)
- **Green (fresh DB `sd02_1997_green`, migrate exit 0): 15 passed,
  15 total** — all assertions read back from the DB / GET.
- **Regressions: 172 passed, 0 failed** — mocked/unit 70
  (recordings-transcribe-claim, recordings-whisper-confidence-1619,
  recordings-encryption, recordings-purged-sentinel,
  recordings-session, ai-provider-segment-contract-1903,
  diarizationJobs); real-DB neighbours 102 on the green DB
  (transcript-composition-1911 ×14, candidate-parity-1913 ×5,
  speaker-mapping-1912 ×12, journey-1918 ×4, session-detail-1938
  ×5, transcriptStitch unit+integration ×22, diarizationWorker
  unit+integration ×33, diarizationFence-1916 ×7) — the same set
  and counts as the #1923 lane.

## Boundaries held

No migration; no staging/main contact; `RETENTION_PURGE_LIVE`
untouched; `DIARIZATION_ENABLED` stays OFF; no email/outreach.
