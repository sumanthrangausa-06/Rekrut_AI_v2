# HL-010 helpers — build log (issue #2073)

**Lane:** Nova (implementation persona), per Lead's STOP 1 on #2073.
**Base:** `origin/dev` at `8c93b2033` (verified live before branching).
**Branch:** `fix/2073-hl010-helpers`. Test-infra / ops scripts only — no
application code, routes, schema, or DB changes.

## What was built

| File | Purpose |
|---|---|
| `scripts/lane-pick-precheck.sh` | Before a STOP 1: prints an issue's state/title, latest 10 comments (author + first 5 lines each), merged PRs referencing it (repo-scoped `gh search`), and for each merged PR whether its merge commit is an ancestor of the local `origin/dev` ref. Bad/missing arg → usage, exit 2, naming the bad value. |
| `scripts/health-multiwindow.sh` | Samples a health URL across N windows (default 3, interval default 5s), printing every sample (HTTP code, `gitCommit`, db status when present). Prints `HEALTHY` only if ALL windows are 200 with db connected (when a db field exists); else `NOT-HEALTHY`. Exit 0/1/2 (healthy / not-healthy / bad args naming the bad value). Windows and interval validated as positive integers. |
| `scripts/harness-helpers.test.sh` | Stubbed suite in the journey-rig test style (`e2e/journeys/run-journey-rig.test.sh`): `curl`/`gh` stubbed via PATH, no network; the lane ancestor check runs against a real fixture git repo with a local `refs/remotes/origin/dev` ref (git is not stubbed). |

Design notes (ponytail — minimum code, no new dependencies):

- The health parser handles both body shapes seen in this repo:
  `"db":"connected"` (string, live app shape) and
  `"db":{"connected":true}` (object, journey-rig stub shape).
- The lane script scopes every `gh` call with `-R <owner/repo>`
  derived from the `origin` remote. This matters: unscoped
  `gh search prs "2073"` matches PR *number* 2073 across all of
  GitHub (verified first-hand — it returned foreign repos' PRs).
- The ancestor check uses the local `origin/dev` ref; the script
  header tells the operator to `git fetch origin dev` first.

## Evidence

### RED (tests written first, scripts absent)

```
FAIL: a all-200+db-connected -> HEALTHY exit 0 (rc=127 out=bash: .../health-multiwindow.sh: No such file or directory)
FAIL: b mixed 200/404 -> NOT-HEALTHY exit 1 (rc=127 ...)
FAIL: c 200+db-disconnected -> NOT-HEALTHY exit 1 (rc=127 ...)
FAIL: d windows=abc -> exit 2 naming bad value (rc=127 ...)
FAIL: e missing URL -> exit 2 (rc=127)
FAIL: f lane missing arg -> exit 2 (rc=127)
FAIL: g lane arg=xyz -> exit 2 naming bad value (rc=127 ...)
FAIL: h lane fixture -> exit 0, title+comment+PR+ancestor=yes (rc=127)
8 case(s) FAILED
```

### GREEN (final code)

```
PASS: a all-200+db-connected -> HEALTHY exit 0 (rc=0 out=HEALTHY)
PASS: b mixed 200/404 -> NOT-HEALTHY exit 1 (rc=1 out=NOT-HEALTHY)
PASS: c 200+db-disconnected -> NOT-HEALTHY exit 1 (rc=1 out=NOT-HEALTHY)
PASS: d windows=abc -> exit 2 naming bad value (rc=2 out=error: windows must be a positive integer, got 'abc')
PASS: e missing URL -> exit 2 (rc=2)
PASS: f lane missing arg -> exit 2 (rc=2)
PASS: g lane arg=xyz -> exit 2 naming bad value (rc=2 out=error: issue-number must be a positive integer, got 'xyz')
PASS: h lane fixture -> exit 0, title+comment+PR+ancestor=yes (rc=0)
ALL PASS
```

### Mutation sanity

The health verdict was mutated to accept a single good window
(any-200 → HEALTHY). Result: case b went red —
`FAIL: b mixed 200/404 -> NOT-HEALTHY exit 1 (rc=0 out=HEALTHY)`,
`1 case(s) FAILED`. Mutant reverted; suite back to ALL PASS.

### Real (unstubbed) runs, first-hand

- Health helper against a local HTTP server returning
  `{"status":"ok","gitCommit":"deadbeef","db":"connected"}` with real
  curl: both windows printed `HTTP 200 gitCommit=deadbeef
  db=connected`, verdict `HEALTHY`, exit 0.
- Lane pre-check for #2073 itself: state `OPEN`, exact issue title,
  Lead's STOP 1 comment, and `Merged PRs referencing #2073: (none
  found)` — correct: no merged PR references #2073 yet.
- Lane pre-check for #1584 (known merged PRs): listed PR #1598 with
  mergeCommit `50cc828be925482a1e43e89ce67a2de4e3e8e811` and
  `ancestor of origin/dev: yes` — both independently re-verified
  against `gh pr view 1598` and a direct
  `git merge-base --is-ancestor` call.
- Arg edges: `--help` → usage, exit 0 (both scripts);
  `windows=0`, `interval=0`, `interval=abc`, lane arg `0` → exit 2
  naming the bad value.

## Review BLOCK fix (PR #2074, ecc code-reviewer — B1 + M1–M3 coverage)

**BLOCK B1 — integer overflow crashed through validation.** A >int64
digit-only argument (e.g. windows `99999999999999999999999999`) passed
the digit-only `case` check, then `[ "$windows" -lt 1 ]` errored
(`integer expression expected`, test rc 2 treated as false), the
sampling loop's test errored the same way, zero windows were sampled,
and the health helper still printed `HEALTHY`, exit 0 — the exact
false-healthy class HL-010 exists to prevent. The lane helper had the
same defect (26-digit issue number proceeded, exit 0 instead of 2).

**Fix (both scripts, minimum diff):** after the digit-only check and
before any integer test, bound the digit length — more than 9 digits
→ the existing usage error, exit 2, naming the bad value. Applied
identically to health `windows`, health `interval-sec`, and lane
`issue-number`.

**Red-first:** new suite cases i/j/k were added before the fix and
failed on the shipped code exactly as the reviewer reproduced:

```
FAIL: i windows=overflow -> exit 2 naming bad value (rc=0 out=HEALTHY)
FAIL: j interval=overflow -> exit 2 naming bad value (rc=0 out=HEALTHY)
FAIL: k lane arg=overflow -> exit 2 naming bad value (rc=0 out=... integer expression expected)
```

**GREEN after the fix — suite is now 15 cases, ALL PASS:**

```
PASS: i windows=overflow -> exit 2 naming bad value (rc=2 ...)
PASS: j interval=overflow -> exit 2 naming bad value (rc=2 ...)
PASS: k lane arg=overflow -> exit 2 naming bad value (rc=2 ...)
PASS: l object db connected:true -> HEALTHY exit 0 (rc=0 out=HEALTHY)
PASS: m object db connected:false -> NOT-HEALTHY exit 1 (rc=1 out=NOT-HEALTHY)
PASS: n lane gh calls all carry -R repo flag (rc=0 calls=4 unscoped=0)
PASS: o lane fixture -> exit 0, ancestor=no (rc=0)
ALL PASS
```

Direct repro of the reviewer's command now exits 2 naming the value
in both scripts (was: HEALTHY, exit 0 / proceeds, exit 0).

**Coverage minors added as suite cases (M1–M3), each mutation-proven**
(mutate → named case(s) red → restore → ALL PASS):

- **M1 (-R scoping):** the `gh` stub now refuses any call without
  `-R fixture-owner/fixture-repo` and logs calls; case n asserts every
  logged call carries the flag. Mutation (force `REPO_ARGS=()`):
  cases h, n, o red — n reported `calls=3 unscoped=3`.
- **M2 (object db shape):** cases l/m exercise
  `{"db":{"connected":true}}` → HEALTHY and
  `{"db":{"connected":false}}` → NOT-HEALTHY. Mutation (break the
  `connected:true` pattern in the health helper): only case l red.
- **M3 (ancestor=no):** case o runs a fixture whose merged PR's merge
  commit is not an ancestor of `origin/dev`. Mutation (hardcode
  `ancestor="yes"`): only case o red.
