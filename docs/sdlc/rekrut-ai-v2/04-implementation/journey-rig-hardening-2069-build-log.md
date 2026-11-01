# Journey-rig launcher hardening — build log (#2069)

Persona: Nova (implementation), under Lead's STOP 1 on #2069
(discussed team position: Lead / Rex / Scout; Suga synthesises).

## Root cause (the five PR #1881 review findings)

The canonical journey launcher `e2e/journeys/run-journey-rig.sh` could
be fooled or stalled in small ways:

1. **Health gate ignored the body.** `/health` in `server.js` answers
   HTTP 200 even when degraded (`db: {connected: false}` on the
   timeout/error paths, and whenever the fast health check reports
   unhealthy). The launcher discarded the body (`curl -o /dev/null`)
   and treated any 200 as healthy, so suites started against a rig
   whose database was down and failed step-by-step instead of the
   gate failing fast with a clear reason.
2. **Suite name validated only after spawn.** The invalid-suite
   `case` branch sat after server boot + health wait, so a typo
   booted the whole server before printing usage.
3. **PORT never validated.** A non-numeric port made the server
   listen on a unix socket (real `server.js` behaviour) while the
   launcher polled a TCP port that could never answer, burning the
   full health window (~80s).
4. **Cleanup was SIGTERM-only.** `kill` + `wait` with no backstop:
   a server that ignores SIGTERM would hang the launcher (and the
   gate run) forever on exit.
5. **Evidence location undocumented.** The suites' evidence JSON
   (`candidate-evidence.json` / `recruiter-evidence.json`) lands in
   the repo root by default (`JOURNEY_OUT` overrides), but the README
   never said so.

None of these could fake a pass (the suites assert DB read-back
themselves); they wasted gate time, and finding 4 could stall a run.

## Specialist decision (from STOP 1)

YES — ecc code-reviewer lens for the independent review (risk domain
is gate integrity, not product behaviour). Considered and skipped:
security (no auth/data surface; local-only secret fallbacks
untouched), database (no schema/query change — the DB check reads
the existing health body), UX (no user surface). Independent review
is pending at PR open; Suga dispatches it.

## Fix (exactly the STOP 1 shape)

`e2e/journeys/run-journey-rig.sh`:

1. Health loop captures the `/health` body and requires HTTP 200
   AND `"connected":true` in the body (also tolerating
   `"connected": true`). On window expiry it still exits 2 with the
   server log tail (message now names the DB-connected condition).
2. Suite (`candidate|recruiter|both`) and numeric-PORT validation
   run BEFORE the `DATABASE_URL` check and before any spawn;
   violations print usage to stderr and exit 2 instantly. The final
   `case` dispatch is unchanged.
3. Cleanup: SIGTERM, poll `kill -0` for up to ~5s (50 × 0.1s), then
   SIGKILL if still alive, then `wait`.
4. `JOURNEY_HEALTH_TRIES` env override (default 40 — exactly the
   previous window) controls the health-loop count; documented in
   the script header.

`e2e/journeys/README.md`: documents `JOURNEY_HEALTH_TRIES` and adds
the evidence-JSON location line. The suites and their `JOURNEY_OUT`
defaults are NOT changed (per the STOP 1 discussion).

`e2e/journeys/run-journey-rig.test.sh` (new): pin test — builds a
fake repo in a temp dir, copies the REAL launcher in, and runs it
against a stub `server.js` (switchable health body, SIGTERM-ignoring
mode, spawn marker) and stub suites (suite-run marker, switchable
exit code). Asserts cases (a)–(e) below; prints PASS/FAIL per case
and exits non-zero on any failure; cleans up its temp dirs and any
stray stub process.

No changes to `server.js`, the journey suites, or any product code.
No new dependencies.

## Red / green evidence

Pin test plus manual probes were run against the CURRENT (pre-fix)
launcher first (base `origin/dev` @
eaf852816b4d3cf8b3d874ac3ca5063036ebc506).

Manual red probes (fake rig, stub server) on the old launcher:

- (a) invalid suite, `timeout 15`: exited 2 in 2s with usage — but
  only AFTER booting the server: spawn marker PRESENT (the defect).
- (b) non-numeric port, `timeout 15`: never exited (timeout killed
  it, rc=124 at 15s), spawn marker PRESENT — it was burning the
  health window.
- (c) degraded health (`connected:false`, `JOURNEY_HEALTH_TRIES=3`,
  ignored by the old launcher): rc=0 and the suite-run marker was
  PRESENT — suites ran against a DB-down rig.
- (e) SIGTERM-ignoring server, `timeout -k 2 20`: launcher hung in
  cleanup (rc=124 at 20s) and the stub server process was STILL
  ALIVE afterwards.

Pin test on the old launcher (exit 4):

```
FAIL: a invalid suite -> exit 2 in <5s, no spawn (rc=2 elapsed=2247ms spawn_marker=present)
FAIL: b non-numeric port -> exit 2 in <5s, no spawn (rc=124 elapsed=10011ms spawn_marker=present)
FAIL: c degraded health -> exit 2, suites never run (rc=0 elapsed=2182ms suite_marker=present)
PASS: d1 healthy + suite exit 0 -> launcher exit 0, suite ran (rc=0 suite_marker=present)
PASS: d2 healthy + suite exit 1 -> launcher exit 1, suite ran (rc=1 suite_marker=present)
FAIL: e SIGTERM-ignoring server -> launcher exit 0 in <20s, server dead (rc=124 elapsed=25012ms server_pid=10562 server_dead=no)
4 case(s) FAILED
```

Pin test after the fix (exit 0):

```
PASS: a invalid suite -> exit 2 in <5s, no spawn (rc=2 elapsed=6ms spawn_marker=absent)
PASS: b non-numeric port -> exit 2 in <5s, no spawn (rc=2 elapsed=6ms spawn_marker=absent)
PASS: c degraded health -> exit 2, suites never run (rc=2 elapsed=6222ms suite_marker=absent)
PASS: d1 healthy + suite exit 0 -> launcher exit 0, suite ran (rc=0 suite_marker=present)
PASS: d2 healthy + suite exit 1 -> launcher exit 1, suite ran (rc=1 suite_marker=present)
PASS: e SIGTERM-ignoring server -> launcher exit 0 in <20s, server dead (rc=0 elapsed=7253ms server_pid=10948 server_dead=yes)
ALL PASS
```

Additional checks:

- `bash -n` passes on both `run-journey-rig.sh` and
  `run-journey-rig.test.sh`.
- Validation ordering: with `DATABASE_URL` unset, an invalid suite
  or non-numeric port exits 2 with usage (not the DATABASE_URL
  error); a valid invocation still hits the DATABASE_URL check.
- Spaced-body tolerance: a stub serving `{"db":{"connected": true}}`
  (space after the colon) is accepted as healthy (launcher rc=0).

## Files changed

- `e2e/journeys/run-journey-rig.sh` (modified)
- `e2e/journeys/README.md` (modified)
- `e2e/journeys/run-journey-rig.test.sh` (new)
- `docs/sdlc/rekrut-ai-v2/04-implementation/journey-rig-hardening-2069-build-log.md` (new, this file)

## User-journey acceptance (Quinn lens, from STOP 1)

A gate run on a rig whose DB is down now fails at the launcher with
a clear reason instead of starting journeys that fail step-by-step;
a typo'd invocation fails in under a second; a normal healthy rig
runs both suites exactly as before (pin-test case d).
