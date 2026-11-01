# #2066 item 4 — livekit exemption test pinning (build log)

**Issue:** #2066 (follow-up from the #1137 lane, PR #2065) item 4 —
"Livekit exemption test pinning (re-review residual)": seed the
`livekit_recording` canonical form into the unit suite's
`referencedForms` so the third catalogue family's exemption is pinned
independently. Items 1–3 of #2066 (insert-time binding, terminal
contested status, drain-lock hardening) are design refinements and are
NOT part of this lane; #2066 stays open for them.
**STOP 1:** Lead/Nova, on #2066 (comment 6551402219) — specialist
decision: YES, security-reviewer lens (the pin guards the fail-closed
erasure ownership gate); Quinn owns the mutation evidence.

## The hole (verified first-hand at dev `2aef6e439`)

`server/__tests__/lib/erasure-storage-ownership-1137.test.js`,
catalogue-exemption test: `referencedForms` seeded the canonical
(decoded) forms of the observer_audio and frame entries, but not of
the livekit_recording entry (`/api/files/r2%2Frecordings%2Fsession.enc`,
canonical `/api/files/r2/recordings/session.enc`). The mocked
surviving-reference predicate answers "referenced" only for seeded
forms, so a regression removing `livekit_recording` from
`CATALOGUE_SOURCE_FAMILIES` (`lib/storageOwnership.js:157`) would let
its entry pass the ownership check unreferenced and be deleted — the
test stayed green while the exemption was broken. Production code was
verified correct; only the pin was missing.

## Fix (test-only, one seed + comment)

The catalogue test's `referencedForms` now also seeds
`/api/files/r2/recordings/session.enc`, with a comment stating the
per-family pinning intent. No production code changes.

## Evidence (Quinn, this lane, first-hand)

- Green: the pinned suite passes 11/11 on the fixed tree.
- Mutation (red): removing `livekit_recording` from
  `CATALOGUE_SOURCE_FAMILIES` makes the catalogue test FAIL —
  `deleted` 2 vs expected 3 (the livekit entry is ownership-skipped
  against its seeded surviving reference). Restored; green again.
- Counterfactual (the hole, re-proven): the OLD test under the same
  mutation passes 11/11 — exactly the silent regression this pin closes.
- Neighbours: `erasure-failed-retry-1171` PASS. `erasure-gap-a` has 3
  failing recording-object tests that are IDENTICAL on pristine
  `origin/dev` (stash-and-rerun, 3 failed / 19 passed both ways) —
  pre-existing, unrelated to this test-only change, recorded here so
  they are not attributed to this lane.

## Gate note (HL-003)

This lane changes only a mocked-DB unit test's seed data; there is no
user flow, route, or production behaviour to exercise. The completion
evidence for a test pin is the mutation pair above (mutation fails the
new test, passes the old one), which is the strongest form available
for this change class. The real-DB integration suite for #1137 itself
is unchanged and untouched.
