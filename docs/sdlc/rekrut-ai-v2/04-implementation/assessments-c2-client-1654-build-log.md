# Assessments C2 — client build log (#1654, #1603)

Stacked PR 2 of 2 for story #1654 (server PR #1675 merged, dev 892b5a81f).
Parent-landed after first-hand verification (HL-007): the builder's edits
were real on disk; its claimed commit was not. All numbers below are the
parent's own runs unless marked otherwise.

## What the candidate now gets

Available tab leads with the C1 catalogue (subjects → topics). Choosing a
topic with servable supply opens `AssessmentConfigureFlow`
(`client/src/pages/candidate/assessment-configure.tsx`):

1. **Configure** — format (Mixed / Multiple choice / Short answer /
   Coding), difficulty band (Easy/Medium/Hard with the true server ranges:
   easy adapts within levels 1–2, medium 2–4, hard 4–5 — matches
   `routes/assessments.js` BANDS), count (10/25/50/100).
2. **Pre-flight** — `GET /assessments/catalog/:topicId/availability` for
   the CHOSEN config (GAP-1: the catalogue list's availability is
   default-config only, so the list is never trusted for the promise).
   servable ≥ count → exact-count confirmation; 0 < servable < count →
   server `reason` verbatim + labelled "Use N questions instead" (user
   consent, never silent); servable = 0 → honest empty, reason verbatim,
   no start action (GAP-6). 'mixed' IS a valid pre-flight format
   (CONFIG_FORMATS includes it — the UX spec's GAP-5 premise was wrong
   against the merged server; pre-flight runs for every format).
3. **Instructions (pre-start)** — exact config echoed (subject · topic,
   format, count), band range, expected time, and an explicit disclosure
   that the full exit/full-screen rules are shown again before the first
   question.
4. **Start** — POST /assessments/start with
   {topicId, format, difficultyBand, totalQuestions}; the take-page flow
   (Phase B gate, Exit dialog, runner) is unchanged. On the extended 503
   the committed session id is preserved: Resume attempt and/or the
   labelled largestAvailable offer (api.ts now preserves
   promised/largestAvailable on the thrown error).

Legacy `/available` cards remain as the fallback when the catalogue is
empty or fails to load (dual-read, design §6.3) — legacy skills with no
catalogue topic keep their existing start path.

## Named deviations (for review to judge)

- **D1 (vs UX spec GAP-3):** the persona spec asked for exactly ONE
  instructions block (pre-start when a snapshot exists). This build keeps
  BOTH: the pre-start summary AND the Phase B post-start gate, with the
  pre-start copy explicitly disclosing the second showing. Rationale: the
  Phase B gate is the consent-grade disclosure at the moment of
  enforcement (integrity/full-screen rules); a summary screen must not
  silently replace it. Reviewer + Quinn to confirm or send back.
- **D2 (GAP-2):** the start-error panel offers Resume whenever the error
  carries a sessionId, including a 400 SETS_NOT_AVAILABLE (the session IS
  committed server-side before the 400). It does not branch on the code
  explicitly. Reviewer to judge whether the take page's own handling
  makes this honest or whether an explicit branch is required.
- **D3 (GAP-4, NOT addressed):** completion-surface labels in
  assessment-take.tsx ("X of Y answered", Verified string gating) are
  pre-existing behaviour, untouched here. Filed as follow-up if review
  agrees it is out of this PR's scope.

## Evidence (parent-run)

- New suite `assessment-configure-1654.test.tsx`: 7/7 PASS.
- Neighbouring suites (quick-practice-session 1352/1371/1378): 12/12 PASS.
- RED control: suite does not collect with the component absent
  (import-level red for a new screen; a behavioural RED against pristine
  is not reproducible post-hoc and is not claimed).
- Journey script `e2e/journeys/assessment-c2-config.js` (JT-C1/JT-C4)
  ships in this PR for Quinn's fresh-install gate — the gate, not this
  log, is the HL-003 evidence.
