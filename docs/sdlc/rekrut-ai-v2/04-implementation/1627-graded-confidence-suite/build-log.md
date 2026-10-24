# #1627 — assessments-graded-confidence-1584 suite restored (test-only)

**Root cause (STOP 1 on the issue):** suite drift, not a code defect.
The suite was written for #1584 (9da94955b) against the pre-guard
/answer flow. PR #1620's review fix (0d8fc5d54) later added the
QUESTION_NOT_CURRENT integrity guard (only a session's outstanding
question may be answered) and the locked-transaction record flow;
#1654 changed completion grading to earned/max points over the
recorded answers with a bank re-read. The suite's mock session carried
empty questions_asked/answers_given, so the guard correctly returned
400 and the suite failed 2/2 on pristine dev.

**Fix (test file only, no production change):** the mock now models a
real 10th-question state — 9 recorded prior answers, Q5 outstanding as
the 10th asked; the answers UPDATE and the completion claim carry the
recorded answers forward (the suite's storedScore pattern, extended);
the grading bank re-read (id = ANY) returns difficulty-2 MCQ rows.
Assertions unchanged: the assessment_graded audit entry records
score/passed and NO confidence.

**Evidence:**
- Red on pristine dev d33cb2a68: 2/2 fail (400 vs expected 200).
- Green on the fix: 2/2 pass.
- Mutation: re-adding `confidence: passed ? 0.85 : 0.6` to the graded
  audit metadata fails the suite 2/2 — the pin still discriminates.
- Neighbours: 8 assessment route suites, 100/100 pass.
