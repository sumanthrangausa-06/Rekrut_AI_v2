# #1807 Lane C — assessments-score-roundtrip suite restore (build log)

**Issue:** #1807 (three assessment suites fail on pristine dev — suite-drift class of #1627)
**Lane:** `server/__tests__/routes/assessments-score-roundtrip.test.js` only. Test-only; no production code changes; no assertions changed.

## STOP 1 root cause (verified first-hand by Lead on dev 8b47cfbed)

The failing test (Task 4c) answers the last question of a job assessment
via POST `/job-assessment/:id/answer` and expects 200 + async scoring.

- Phase B (§4.3, #1604/#1605) replaced the plain completion UPDATE in
  that handler with an atomic status-guarded claim:
  `UPDATE job_assessment_attempts SET status='completed', ...
  WHERE id=$1 AND status='in_progress' RETURNING id`, and the handler
  decides the winner by `claimRes.rows.length` — a lost claim returns
  409 `ALREADY_FINISHED`.
- The suite's mock branch for `update job_assessment_attempts set
  status =` returned `{ rows: [], rowCount: 1 }` — correct for the old
  rowCount-based code, but for the claim it models a LOST claim, so the
  route correctly answered 409.

Verdict: **suite drift, code correct.** The claim semantics are the
intended Phase B contract (exactly-once completion + scoring); the mock
did not model the RETURNING row.

## Fix (mock fidelity only)

The `set status =` branch now returns `{ rows: [{ id: params[0] }],
rowCount: 1 }` when the statement carries `RETURNING id` (the claim),
and keeps the empty-rows shape for non-claim status updates.

## Evidence

- Red on pristine dev 8b47cfbed: 1 failed / 6 passed (409 vs 200 on 4c).
- Green on this branch: 7 passed / 7.
- The pre-fix red IS the discrimination proof for the claim pin: with the
  claim modelled as lost, the route 409s and no scoring fires; with it
  modelled as won, scoring + notification + application write all fire
  exactly once (and the already-scored no-op test still passes).

## Specialist decision

None. One-point test-fidelity fix in the #1627 pattern; the Phase B
claim semantics under test are untouched.
