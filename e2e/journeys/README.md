# User-Journey Acceptance Suites (Quinn)

Two continuous, user-perspective journey suites — Sumanth's directive
2026-10-21 ("think like a user… create those tests and then let them pass").
Each suite walks ONE persona's whole chain in the order a real user lives
it, over **real HTTP** against a fresh-install build, and asserts
**user-visible outcomes**: what the user sees, receives, and can do —
including honest empty/failure states (no dead buttons, no fake numbers,
no success messages for things that did not happen). Resulting state is
read back from the database. Implementation internals are never asserted.

| Suite | Persona | Tracking issue |
|---|---|---|
| `candidate-journey.js` | Candidate (with Candidate Experience persona) | #1588 |
| `recruiter-journey.js` | Recruiter (with Recruiter persona) | #1589 |

**Candidate chain:** land → sign up → profile → CV upload/parse → real
score or honest insufficient-data → browse jobs → apply → consent choices
(grant AND decline recorded truthfully) → screening/practice → honest
results that match the database.

**Recruiter chain:** sign up → company setup → post a job → review
applicants → move pipeline stages → interview → decision (offer the
candidate can actually see).

## Verdicts

- `PASS` — the user-visible expectation held, with evidence.
- `FAIL` — a real expectation broke (a product defect until proven
  otherwise; file a `[BUG]` issue and link it from the baseline comment).
- `BLOCKED` — the step depends on an external service that is unavailable
  in the environment (live AI provider — provider-key MAJOR; file-storage
  egress). BLOCKED is recorded with the honest failure the user saw; it is
  never skipped and never fake-passed.

Exit code is 1 only when a step FAILs.

## How to run (fresh-install rig)

```bash
# 1. Throwaway PostgreSQL (any local cluster), empty database:
createdb journeybaseline

# 2. Build the schema ONLY with the migration runner:
DATABASE_URL=postgresql://postgres@127.0.0.1:<pg-port>/journeybaseline \
  node migrate.js

# 3+4. Start the app and run the suites with the canonical launcher
#    (issue #1672): it spawns the server, waits for /health, runs the
#    suite(s), and kills the server it started.
DATABASE_URL=postgresql://postgres@127.0.0.1:<pg-port>/journeybaseline \
  ./run-journey-rig.sh both

# NEVER start the server under test with NODE_ENV=test: server.js binds
# its listener only when NODE_ENV !== 'test' (so jest can import the
# app without a port), so a test-mode server never comes up and the
# harness waits forever. The launcher pins NODE_ENV=development for
# the spawned server. Do not copy new harness shapes — extend
# run-journey-rig.sh.
```

Notes:
- The launcher's health wait is bounded by `JOURNEY_HEALTH_TRIES`
  (default 40 attempts at the 2s poll interval); an attempt counts as
  healthy only on HTTP 200 with the `/health` body reporting the DB
  connected.
- Suite evidence JSON (`candidate-evidence.json` /
  `recruiter-evidence.json`) lands in the repo root (the launcher's
  working directory) unless `JOURNEY_OUT` is set.
- Auth endpoints are rate-limited (5 strict hits / 15 min / IP). A suite
  run uses 3; back-to-back runs of both suites can exhaust the window —
  the scripts retry a 429 after a 70s pause, and a fully clean baseline
  may need to wait out the window between runs.
- Record every baseline as a per-step PASS/FAIL/BLOCKED comment on the
  tracking issue, with the evidence JSON kept alongside the run records.
- Re-run a suite whenever any step of its journey changes.
