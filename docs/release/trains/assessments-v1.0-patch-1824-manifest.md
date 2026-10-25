# Train 7 patch manifest — #1824 Resume door + #1718 anti-cheat NULL-guard → staging

**Relay (release persona) — Train 7 rider-clearing patch (2026-10-24).**
Train 5 (assessments v1.0, PR #1822) closed current on staging with two
recorded riders in the registry: (1) the Save & Exit saved session had
no Resume door on the Assessments list (#1824, server state + draft
verified correct via API during the Train 5 retest), and (2) the #1727
anti-cheat NULL-guard client sweep (assessments-adjacent) did not ride
Train 5. Both riders are since fixed and dev-proven (#1824 via PR
#1832, closed 2026-10-25; #1718 via PR #1727, closed 2026-10-23). This
patch train carries exactly those fixes to staging. Version stays
assessments v1.0 — this is a patch on the current train, per the
Train 6 patch precedent (PR #1829).

## Picks (3, dev order)

- 73a83923a — #1718 NULL-guard sweep (PR #1727) → picked as 37695f953,
  patch-id f1d5e9c6aa2407e34e02fdf18baf8cc01bac2bb5 (identical).
- bdf50d59c — #1718 review F1 test pin (PR #1727) → picked as 58070f1de,
  patch-id 443af4d3026a1ea7031f5b35910c42c36c6e4963 (identical).
- 41acec0bb — #1824 Resume door (PR #1832) → picked as 2e2b4b94a,
  patch-id 67da35fdc3952d4f304d56c859e6d0e5e1f374d1 (identical).

All three cherry-picks applied clean (no conflicts). After the picks,
`routes/assessments.js`, `client/src/pages/candidate/assessments.tsx`,
`client/src/pages/recruiter/assessments.tsx` and
`client/src/pages/candidate/aptitude-tests.tsx` are byte-identical to
dev tip. `client/src/pages/candidate/aptitude-test-results.tsx`
differs from dev only by the unrelated #1609 pending-review rendering,
which has never ridden a train and is out of scope here; the #1718
hunk in that file is patch-id identical. Diff vs staging: 13 files
(2 client pages + 2 aptitude pages + configure page, routes/assessments.js,
4 suites, 2 build logs) + this manifest. **No migrations.**

## Pre-merge evidence (first-hand, train tree)

- Server suites GREEN: assessments-catalog-resumable-1824 (the #1824
  pin: catalog returns `resumable: { sessionId }` for the owner's
  latest in_progress topic session, null otherwise, other users'
  sessions never leak, SQL shape pinned) + assessments-catalog-1653
  neighbour — 23/23 PASS (jest, train tree).
- Client suites GREEN: assessments-resume-1824 (2 tests) +
  AntiCheatNullGuard1718 (11 tests) — 13/13 PASS (vitest, train tree).
- Both fixes were independently reviewed and E2E-proven on dev before
  their dev PRs merged (#1832, #1727); this train changes no code —
  patch-ids above are the proof.

## Retest plan (after merge + deploy)

Re-run the Train 5 rider checks ONLY, first-hand against staging:
(1) candidate saves an in-progress topic assessment via Save & Exit →
the Assessments list shows the Resume door for that topic and Resume
re-enters the saved session; a candidate with no saved session sees
no Resume door. (2) Recruiter assessments + candidate aptitude pages
render a NULL anti_cheat_score honestly (no fabricated %, no crash).
On full pass: registry close-out PR clearing both riders from the
assessments entry (version stays v1.0, train_pr updated). No tag
change — `staging/assessments@v1.0` already exists; the close-out
records this patch under it, per the Train 6 patch precedent.
