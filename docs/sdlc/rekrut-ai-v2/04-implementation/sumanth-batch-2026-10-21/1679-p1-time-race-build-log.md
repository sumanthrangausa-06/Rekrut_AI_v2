# #1679 P1 pair — build log (items 1 + 2 only)

**Scope:** P1 pair of issue #1679 only — (1) invented time figures on the
assessment instructions screen, (2) stale pre-flight race on the configure
screen. STOP 1 was posted on #1679 before this build (specialist decision
and root-cause analysis recorded there). Items 3–9 of #1679 are NOT touched
by this change and remain open.

**File changed:** `client/src/pages/candidate/assessment-configure.tsx`
(plus tests in `assessment-configure-1654.test.tsx`).

## Root causes

1. **Invented time figures** — `assessment-configure.tsx` hard-coded
   `SECONDS_PER_QUESTION = 120` (old line ~76) and the instructions bullet
   (old line ~220) rendered "Expected time: up to about {count × 120 / 60}
   minutes (up to 2 minutes per question)". The server truth is per-question:
   `timeLimit = question.time_limit_seconds || 120` is a *fallback*, not a
   ceiling, and generated rows carry 90s (MCQ) / 180s (written) limits — so
   both the total and the per-question figure were invented.
   **Fix:** the constant is deleted and the bullet now states only the
   per-question rule: each question has its own timer shown on the question;
   on expiry it is submitted with the chosen answer — or recorded as
   unanswered — and the test moves on. No total-time claim remains.

2. **Stale pre-flight race** — the availability `useEffect` set
   `flightLoading` on re-run but never cleared the previous `flight`, and
   `canServeChosen` read the stale `flight` while ignoring `flightLoading`.
   After changing format/band/count, "Continue to instructions" stayed
   clickable on the *previous* configuration's result until the new check
   landed.
   **Fix:** `setFlight(null)` at the start of the effect, and
   `canServeChosen` is gated on `!flightLoading`. Minimum diff; no other
   refactoring.

## Evidence (red-first)

- RED: two new tests in `assessment-configure-1654.test.tsx`
  (`#1679 — P1: invented time figures + stale pre-flight race` describe)
  were run against the unfixed component and both failed, for the intended
  reasons (the "Expected time" bullet was present; Continue stayed rendered
  while the new count's pre-flight was pending). The 9 pre-existing tests
  passed. Log: run evidence retained by Suga (nova-1679-2026-10-22/red.log).
- GREEN: after the fixes, the full configure test file passes, and the
  neighbouring suites (`assessment-take-1654.test.tsx` and the assessments
  page tests in the same file) show no new failures. Log:
  nova-1679-2026-10-22/green.log.

## NOT changed

- Items 3–9 of #1679 (including item 8, the C2 client build-log corrections)
  — separate lanes; the two existing C2 client build logs are untouched.
- No server code, no other client surface, no behaviour change beyond the
  two fixes above.
