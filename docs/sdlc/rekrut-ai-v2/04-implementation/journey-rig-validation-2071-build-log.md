# Build log — #2071 journey-rig launcher validation minors

**Persona:** Nova (implementation). **Base:** `origin/dev` `1b0d2e60e` (Merge PR #2070).
**Scope:** `e2e/journeys/run-journey-rig.sh` + `e2e/journeys/run-journey-rig.test.sh` only.
No other launcher behaviour changed. No database involved (shell suite only).

## Root cause (verified against the script on origin/dev)

1. PORT was validated only as all-digits (`''|*[!0-9]*`). `PORT=0` passed,
   the server bound an ephemeral port, and the launcher burned the full
   health window (default 40 tries ≈ 80s) before its generic exit 2.
   `PORT=99999` passed the same check and failed via early-death detection
   with a server log tail, never naming the bad value.
2. `JOURNEY_HEALTH_TRIES` was used unvalidated in
   `seq 1 "${JOURNEY_HEALTH_TRIES:-40}"`. A non-numeric value made `seq`
   fail, the health loop ran zero times, and the launcher exited 2 with the
   misleading generic "did not answer /health … in time" message.

Both were safe-and-loud (no fake pass, no infinite hang) — the defect was
wasted time and a message that blamed the server for the caller's typo.

## Fix

In the existing pre-spawn validation block (before the `DATABASE_URL`
check, before any spawn), reusing the script's existing `case` pattern:

- PORT: after the digits check, a range check (1–65535). Leading zeros are
  stripped before the numeric tests so values read as plain decimal
  (`0080` → 80, accepted) and a long digit string cannot overflow them.
  Failure: exit 2, `port must be 1-65535 (got '<value>')`.
- `JOURNEY_HEALTH_TRIES`: normalised to its default (40) at startup, then
  validated as a positive integer (digits, and not all zeros). Failure:
  exit 2, `JOURNEY_HEALTH_TRIES must be a positive integer (got '<value>')`.

## Red evidence (tests written first, run against the unmodified launcher)

New cases f/g/h added to `run-journey-rig.test.sh`; prior cases a–e passed,
the three new cases failed for exactly the reported reasons:

```
FAIL: f PORT=0 -> ... (rc=2 elapsed=4148ms spawn_marker=present msg=[rig] waiting for /health on port 0 ...)
FAIL: g PORT=99999 -> ... (rc=2 elapsed=2027ms spawn_marker=present msg=[rig] waiting for /health on port 99999 ...)
FAIL: h JOURNEY_HEALTH_TRIES=abc -> ... (rc=2 elapsed=11ms msg=[rig] waiting for /health on port 3417 ...)
3 case(s) FAILED
```

(Case f ran with `JOURNEY_HEALTH_TRIES=2` to keep the RED run fast; at the
default 40 tries the same path is the ~80s burn described in #2071.)

## Green evidence (full suite, fixed launcher)

```
PASS: a invalid suite -> exit 2 in <5s, no spawn
PASS: b non-numeric port -> exit 2 in <5s, no spawn
PASS: c degraded health -> exit 2, suites never run
PASS: d1 healthy + suite exit 0 -> launcher exit 0, suite ran
PASS: d2 healthy + suite exit 1 -> launcher exit 1, suite ran
PASS: e SIGTERM-ignoring server -> launcher exit 0 in <20s, server dead
PASS: f PORT=0 -> exit 2 in <5s, no spawn, message names bad value (elapsed=8ms, got '0')
PASS: g PORT=99999 -> exit 2 in <5s, no spawn, message names bad value (elapsed=7ms, got '99999')
PASS: h JOURNEY_HEALTH_TRIES=abc -> exit 2 in <5s, no spawn, message names env var + bad value (elapsed=6ms, got 'abc')
ALL PASS
```

Direct spot-checks against the fixed launcher (all exit 2, named message):
`PORT=65536` → `port must be 1-65535 (got '65536')`;
`JOURNEY_HEALTH_TRIES=0` → `… positive integer (got '0')`;
`JOURNEY_HEALTH_TRIES=-3` → `… positive integer (got '-3')`.
Boundary unit check of the range logic: 1, 80, 0080, 65535 accepted;
0, 000, 65536, 99999, 100000 rejected.

## Mutation sanity checks

- Port bound mutated `65535 → 999999` in a scratch copy: case g FAILs
  (spawn happened, generic message), all other cases pass — the test
  detects the range regression.
- `JOURNEY_HEALTH_TRIES` name removed from the validation message in a
  scratch copy: case h FAILs, all other cases pass — the test detects
  the message regression.

## Files changed

- `e2e/journeys/run-journey-rig.sh` — two validation guards (above).
- `e2e/journeys/run-journey-rig.test.sh` — cases f, g, h + header.
- `docs/sdlc/rekrut-ai-v2/04-implementation/journey-rig-validation-2071-build-log.md` — this log.
