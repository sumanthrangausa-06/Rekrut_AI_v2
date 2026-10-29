# S-D16 (#1918) — Quinn journey suites + HA-1 measurement: build log (SYNTHETIC leg)

**Owner:** Quinn (Phase 6). **Date:** 2026-10-28. **Basis:** synthetic only.

## Scope split (honest)

- Synthetic leg executed in this PR: JT-D1…JT-D5, JT-D7 and the AC-5
  sweeps, on the fresh-install dev rig (real HTTP via supertest against
  the real recordings router, real Postgres, state read back).
- HA-1 human-voice leg (AC-2/AC-3/AC-4) NOT executed: no signed
  per-speaker written consents exist (Lex clarification on #1918,
  2026-10-28 — one signed BIPA-shaped consent per speaker before any
  recording). AC-2/3/4 remain OPEN; HA-2 and the panel bar are applied
  only to a human-voice measurement. The spike's synthetic figure is
  not quoted as expected accuracy anywhere.

## Rig

PostgreSQL 16.15 + pgvector 0.8.7 on 127.0.0.1:55433 (on-VM PGDG tree,
HL-009 pattern — the documented pguser rig does not exist on this VM);
fresh database `sd16_fresh`; `node migrate.js` exit 0 before any gate.

## What this PR adds

`server/__tests__/routes/recordings-journey-1918.integration.test.js`
(4 tests) — the gaps the per-story suites did not cover as journeys:

- JT-D2 panel consistency at the API level: same name in minute 2 and
  minute 40 for every mapped voice; unmatched voice renders
  "Speaker 4" with `assigned: false` (FR-D09).
- JT-D4 single-speaker leg: exactly one speaker, no invention (FR-D16).
- AC-5/BR-4 post-job artefact sweep: no embedding/voice-print column
  in any diarization-owned table and no embedding payload in the
  completed job's stored run/job rows.
- AC-5/BR-13 post-erasure sweep: real `erasePersonalData()` → zero
  rows for the recording in all five diarization-owned tables;
  transcript read returns absence in the established [purged] shape;
  another candidate's recording untouched.

Review cycle: independent review BLOCKED once on the AC-5/BR-4
payload sweep (proposed_mapping unswept; word-regex on a clean-by-
construction seed). Fixed as specified — whole-run-row + whole-job-row
sweep with `/embedding|voice.?print/i`, exact turn-keys assertion
(`{speaker, start_s, end_s}` only), and a production-shaped
proposed_mapping seed so the sweep is not vacuous — re-run 4/4, and an
independent re-review APPROVED the fix (mutation-checked).

JT-D1/D3/D4-states/D5/D7 are carried by the existing per-story suites
(#1911 composition, #1912 mapping/correction, #1913 candidate parity,
#1915 erasure), re-run on the same fresh rig in this story's gate —
see the results comment on #1918 for per-JT records and counts.
JT-D6's synthetic half is the S-D06 long-proof evaluator unit suite
(join/phantom logic); its human half is AC-2, open above.
