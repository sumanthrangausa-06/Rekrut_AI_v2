# #1807 Lane 2 — assessments-short-answer-honesty-1572 suite restore (build log)

**Issue:** #1807 (three assessment suites fail on pristine dev — suite-drift class of #1627)
**Lane:** `server/__tests__/routes/assessments-short-answer-honesty-1572.test.js` only. Test-only; no production code changes; no assertions changed.

## STOP 1 root cause (verified first-hand by Lead on dev 8b47cfbed)

All 8 tests failed with 400 instead of 200. Tracing POST /answer in
`routes/assessments.js`:

- The suite's session-load mock returned `questions_asked: []` on every
  load, so the session had NO outstanding question.
- PR #1620's integrity guard (`qid !== outstandingQuestionId(session)` →
  400 `QUESTION_NOT_CURRENT`, routes/assessments.js answer handler) then
  correctly rejected every answer. The guard is the intended contract;
  the suite predates it.
- Second wall behind the first: `respondAfterRecord` re-loads the session
  by id only (`WHERE id = $1`, no user_id) — no mock branch matched it,
  and the recorded answers were never carried forward, so the post-record
  read-back could not see the state the record UPDATE wrote (the same
  fidelity gap the #1627 restore fixed for the graded-confidence suite).

Verdict: **suite drift, code correct.** The #1572 honesty contract
(evaluation failure → answer recorded UNEVALUATED, null score, 0 points,
no fabricated audit entry) is intact in the route and untouched.

## Fix (mock fidelity only)

- `SESSION.questions_asked` now models Q5 as the outstanding question in
  the exact shape `serveNextQuestion` pushes:
  `{ questionId: 5, difficulty: 2, timestamp }`.
- Session loads (id + user_id, incl. the locked FOR UPDATE re-read) return
  the carried-forward `storedAnswers`.
- The record UPDATE branch stores the written answers into
  `storedAnswers`, so the id-only post-record read-back (new branch) sees
  the post-write state.
- `storedAnswers` reset per test.

## Evidence

- Red on pristine dev 8b47cfbed: 8 failed / 8.
- Green on this branch: 8 passed / 8.
- Mutation: reintroducing the original #1572 defect (fabricated
  `{ score: 50 }` fallback in `evaluateShortAnswer`'s catch) → 2 tests
  fail. The pin still discriminates. Route file restored byte-clean after
  the mutation run.
- Neighbours: full assessments route-suite set run on the branch (see PR).

## Specialist decision

None. Genuine one-point test-fidelity fix in the #1627 pattern: no
production, auth, security, privacy, or schema surface; the #1620 guard
and the #1572 contract under test are untouched. Independent review +
the suite evidence above serve as this lane's gates.
