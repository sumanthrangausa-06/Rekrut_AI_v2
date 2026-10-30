# #2002 — runEngineChild close handler stdoutExceeded guard (build log)

Story: #2002 [FOLLOW-UP] runEngineChild close handler does not check
stdoutExceeded — latent double-reject (from the PR #2001 independent
review, comment 6518933656, APPROVE-WITH-MINORS).
STOP 1: issue #2002 comment 6519788712 (posted before any code).
Base: dev `a6eaee66a` (PR #2001 merged, verified live). Branch:
`nova/2002-close-stdout-guard`. PR to dev only; no merge/closure by
Nova — Suga gates.

## Root cause

In `lib/diarizationEngine.js` `runEngineChild` (as landed by #1927),
the stdout `data` handler sets `stdoutExceeded = true`, SIGKILLs the
child and rejects `engine_failed` ("engine child stdout exceeded
…-byte cap") when accumulated stdout passes `STDOUT_CAP`. The `close`
handler never checked `stdoutExceeded`: the killed child closes with
`signal = 'SIGKILL'`, so `close` fell into the signal branch and
attempted a second reject as `engine_oom`. Promise first-settle wins,
so callers correctly saw `engine_failed` — a latent dead reject, not
a live wrong result. The risk is structural: any future change to
settle order or handler structure (e.g. a spawnFn seam settling on
close) would silently flip the cap error to `engine_oom`, mislabelling
a runaway-output failure as a memory kill.

## Specialist decision (STOP 1)

Yes — lens applied, no separate dispatch. ecc **silent-failure-hunter**
lens applied by Nova: the defect class is a silent second settle
attempt masking the real error class; the lens confirms a guard at
the handler (not a settle-wrapper or refactor) is the right-sized
fix. Considered and skipped: a separate specialist subagent (the fix
is a single guard prescribed by PR #2001's independent review, no
design judgment open); database/security/UX specialists (no schema,
auth, consent or UI surface touched). Independent review of the PR
diff happens at Suga's gate.

User/journey framing: internal engine hardening, no user-visible
effect today. The promise pinned: a child that blows the stdout cap
keeps surfacing `engine_failed`, never `engine_oom`. No user journey
changes, so no fresh-install journey run applies (HL-003); the
diarizationEngine suite plus the new pin is the evidence surface.

## Change (lib/diarizationEngine.js, +5 lines)

One guard at the top of the `close` handler in `runEngineChild`,
after `clearTimeout(timer)`:

```js
if (stdoutExceeded) return;
```

with a comment naming why (the cap path already rejected
`engine_failed` and SIGKILLed; this close must not fall through to
the `engine_oom` branch). Nothing else changes. The
decode-timeout/stdout-cap consistency observation from the same
review is explicitly NOT changed (issue: no change required).

## Red / green evidence (honest)

A true behavioural red at the promise surface is **impossible**:
first-settle wins is exactly why the defect is latent — the shipped
pin test passes on base too. The defect was instead observed directly
with an instrumented-copy probe (in /tmp, nothing shipped): a copy of
the lib with one `console.error('PROBE_OOM_BRANCH_ENTERED')` line
inserted in the close handler's signal branch, driven by a fake child
via the existing `spawnFn` seam (Buffer of `STDOUT_CAP + 1` bytes,
then `close` emitted from `kill('SIGKILL')`):

- **Base `a6eaee66a` (RED):** settles `engine_failed` / "stdout
  exceeded 1048576-byte cap", `killedWith=SIGKILL`, 1 settlement —
  and stderr shows `PROBE_OOM_BRANCH_ENTERED`: the close handler DID
  enter the OOM branch and attempt the dead second reject.
- **Fixed (GREEN):** identical settlement (`engine_failed`, cap
  message, SIGKILL, 1 settlement) and NO probe line — the OOM branch
  is never entered.

Shipped pin (`server/__tests__/lib/diarizationEngine.test.js`):
`#2002: stdout cap then close-with-signal settles once as
engine_failed, never engine_oom` — fake child via the existing
`spawnFn` seam (same pattern as `hangingFfmpeg`), emits a Buffer past
`STDOUT_CAP`, asserts the SIGKILL, emits `close` with the signal,
asserts exactly one settlement with `engine_failed` / /stdout
exceeded/. On base it passes (contract pin — see above); it fails if
the settlement contract ever flips.

## Tests

- Engine suite: base 17/17 → after 18/18 (new pin included).
- Neighbouring diarization lib suites (Fence-1916, Flag, Gate, Jobs,
  Pinning-1907, Worker): base 102/102 → after 102/102, unchanged.
- Combined run after the fix: 7 suites, 120/120 passed.
