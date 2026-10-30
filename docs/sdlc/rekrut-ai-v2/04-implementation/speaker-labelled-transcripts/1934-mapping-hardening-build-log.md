# #1934 — Diarization mapping hardening (build log)

Story: #1934 (follow-ups M-3/M-4 from the independent review of
PR #1932, S-D08 #1910). STOP 1: issue #1934 comment 6513703303 —
root causes, specialist decision (privacy-engineer lens USED for
M-4; no specialist for M-3, reasons recorded), and the discussed
Rex/Lead/Scout position on the M-4 fail direction, written BEFORE
the build. Base: dev `6fd69ef24`.

## What changed (`lib/speakerMapping.js` only, + tests)

### M-3 — speaker-number range validation in `computeProposal`

The per-turn loop guarded only `Number.isInteger(t.speaker)`. A
speaker of `-1` was proposed and would persist; a speaker of
`3000000000` (> int4) was proposed and then failed the
`recording_speaker_mappings` INSERT (`speaker_number` is int4,
migration 296), rolling back the entire stitch; floats were
skipped implicitly with the contract nowhere stated.

Fix: the skip condition is now the explicit contract — integer
within `[0, INT4_MAX]` (`INT4_MAX = 2147483647`, exported, with a
comment tying it to the int4 column). Out-of-contract turns
contribute no speaker, no share, no row, no proposed_mapping
entry. No schema change, no migration.

### M-4 — HA-2 kill-switch fail direction (`isAutoNameEnabled`)

Was: OFF only on the exact string `'false'` — `'FALSE'`, `'0'`,
`' false'` all left auto-naming ON, the inverted fail direction
vs `DIARIZATION_ENABLED` (whose typos land OFF).

Fix (discussed team position, STOP 1): the value is trimmed and
lower-cased; OFF when it is one of `false` / `0` / `off` / `no`.
Unset, `'true'`, and unrecognised values keep the documented
default ON — garbage is not silently treated as OFF. The two
diarization flags now parse differently ON PURPOSE: each flag's
typo lands on its own safe state (enable gate → OFF; degradation
kill switch → OFF). The header comment states this so a future
reader does not "harmonise" it back.

## Evidence (HL-003 / HL-007)

- **Red first (base `6fd69ef24`):** 4 failed / 26 passed in
  `speakerMapping.test.js` — negative-speaker row, negative speaker
  stealing the candidate assignment, >int4 row, M-4 OFF spellings.
  Boundary (0, int4-max), float, and default-ON tests passed on
  base as contract pins.
- **Green:** `speakerMapping.test.js` 30/30; with
  `diarizationFlag.test.js` 33/33. Regression:
  `transcriptStitch.test.js` + `diarizationWorker.test.js` PASS
  (33 tests). `diarizationFence-1916.test.js`: 2 failures —
  verified IDENTICAL on untouched base (pre-existing, about
  `lib/diarizationEnqueue.js` allowlist drift; not this change).
- **Real-DB gate (fresh-install rig, PG 18.6 @127.0.0.1:55436,
  `migrate.js` exit 0):** `speakerMapping.integration.test.js`
  9/9 PASS. Plus a direct M-3 probe through the real
  `persistStitch` with turns for speakers `-1` (largest share) and
  `3000000000` beyond segment coverage: on BASE the stitch threw
  `value "3000000000" is out of range for type integer` and ZERO
  mapping rows persisted (whole stitch rolled back); with the fix
  the outcome is `complete`, rows are exactly speakers 0/1 with the
  correct proposal, and `proposed_mapping` carries only 0/1.

## Adjacent observation (NOT fixed here — out of #1934 scope)

`lib/transcriptStitch.js` writes per-segment
`interview_transcripts.speaker_number` via max-overlap assignment
guarded only by `Number.isInteger` — an out-of-range speaker that
best-overlaps a segment takes the same int4 failure (or persists
`-1`) through that write. Same defect class, different function;
recommended as a Lead-filed follow-up rather than scope growth in
this lane.

## Review

Independent reviewer subagent (code-reviewer perspective) —
verdict recorded on the PR.
