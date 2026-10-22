# Build Log — Assessments Phase A: reliability (#1602, #1606) + completion deadlock (#1612)

**Phase:** 4 — Implementation · **Persona:** Nova (build), Quinn (HL-003 gate), Rex + ecc database-reviewer (STOP 1 specialist position on #1612)
**PRD:** `docs/sdlc/rekrut-ai-v2/02-planning/sumanth-batch-2026-10-21/prd-assessments-module.md` §7 FR-A1–A5/A7, §10 JT-A1–A4
**Issues:** #1602 (submission hangs / answer loss), #1606 (assessments not opening), #1612 (passing-leg completion deadlock)
**STOP 1s:** #1602 comment 6331290184, #1606 comment 6331306854, FR-A6 audit #1606 comment 6331299379, #1612 STOP 1 (this build)

## What changed (behaviour)

Phase A separates three steps that previously shared ONE database transaction
in `POST /assessments/answer` and `POST /assessments/start`:

1. **Answer recording commits independently (FR-A1/A5).** `/answer` now:
   evaluates the answer without holding a transaction (an evaluation failure
   still records the answer as `pending_manual_review`, never a fake score —
   #1572 preserved), then records the answer in its own transaction under the
   session row lock and COMMITs before anything else happens. A retried
   submission of an already-recorded question (timeout, double-click,
   timer + manual press) is detected before evaluation and again under the
   lock, and returns the recorded state — an answer is never recorded or
   scored twice. One distinction the gate caught during this build: when a
   difficulty cell is exhausted, serving may RE-SERVE a question the
   session answered earlier (it becomes the outstanding question again);
   that is a new answer, not a retry, and the duplicate guard
   (`isAlreadyRecorded`) exempts exactly the currently-outstanding
   question. Without the exemption the guard and the re-serve trap the
   candidate on one question forever — found by the Quinn rig, fixed
   before this PR.
2. **Next-question serving is a navigation step (FR-A5/A7).** A new helper,
   `serveNextQuestion`, serves or re-serves the current question from
   `GET /assessments/session/:id/current` — the one path used by start-retry,
   answer-retry, and page refresh. A question-supply failure there is a
   retryable `503 QUESTION_UNAVAILABLE` navigation outcome; it can no longer
   roll back a recorded answer (the #1602 loss case) or destroy a started
   session (the #1606 case: `/start` now commits the session first, then
   serves; on failure it returns `503` with the session id and the client
   offers **Resume attempt**). Question supply also excludes questions
   already asked in the session while unserved bank rows exist (#1606 audit
   finding), falling back to re-serving only when a difficulty cell is fully
   exhausted.
3. **Completion is one atomic terminal transition (FR-A3).**
   `completeAssessment` opens with
   `UPDATE … SET status='completed' … WHERE id=$1 AND status='in_progress'`
   — the rowcount decides the winner of any race; the loser receives the
   existing completion. It runs in its own transaction
   (`completeAssessmentTx`) after the final answer has committed, and
   `/session/:id/current` finishes a recorded-but-uncompleted attempt the
   same way, so a completion failure is recoverable by retry, never by
   re-answering.
4. **#1612 deadlock fix — Option B (Rex + database-reviewer ruling).**
   The deadlock: the completion transaction's `candidate_skills` UPDATE
   (passing leg) holds that row's lock while the pool-side
   `omniscoreService.addTechnicalComponent` → `calculateScore` →
   `getSkillProficiency` runs `SELECT … FOR UPDATE` on the same
   `candidate_skills` row from a different connection — a self-deadlock
   PostgreSQL cannot detect (the wait is through the application).
   `addTechnicalComponent` and the `assessment_graded` audit write now run
   **after COMMIT** in `completeAssessmentTx`, in that order, each
   failure-isolated: an OmniScore failure is logged and never changes the
   candidate's completed outcome; the audit write runs even if the
   OmniScore feed fails. An `alreadyCompleted` claim skips both, so they
   fire exactly once per completion. Accepted trade-off (recorded on
   #1612): a crash in the commit→feed window can leave the OmniScore
   technical component unwritten for a durable completion — a
   reconciliation concern, never a candidate-facing hang.
   Rejected: threading the transaction client through the OmniScore
   service (option A — `calculateScore`/`getSkillProficiency` have many
   pool callers; a failure inside would abort the completion transaction
   without savepoint plumbing around every internal write), and touching
   the search-index trigger (option C — wrong layer; the trigger was not
   the lock holder).
5. **Counts are real.** The answer-record step sets
   `current_question_index` to the number of answers recorded; the serve
   step sets it to the question being shown (answers+1) — the value the
   candidate sees, "Question N", is always answers+1, and an attempt
   completes after exactly 10 recorded answers. Previously the counter was
   seeded to 1 at start and incremented per answer, so attempts completed
   after **9** answers while questions were numbered 1, 3, 4, … (verified
   on the fresh-install rig, pre-fix suite JT-A2 legs).
6. **Bounded client submissions (FR-A2/A4).** `apiCall` accepts
   `timeoutMs` (AbortController; the bound covers the whole call including
   the 401-refresh retry) and throws a `TIMEOUT`-coded error. The
   assessment runner uses a 30s bound for answer and current-state calls;
   spinners always resolve. Submission failures are inline states, not
   `alert()`: an unconfirmed answer stays on screen with a Retry (with the
   promise it will not be counted twice); a saved answer whose next
   question failed shows "Your answer was saved… Retry" — which is also
   the timer-expiry outcome (FR-A4): expiry submits the current input or
   `'(no answer)'` through the same path, so its primary outcome is never
   a bare error. The non-JSON error fallback in `apiCall` no longer
   reduces to a bare "Request failed". `apiCall` also preserves the
   server's `sessionId` and `answerRecorded` fields on thrown errors so
   callers can offer the right recovery.

7. **Schema drift found by the gate (migration 274, expand-only).**
   `chk_assessment_sessions_status` (migration 047) never included
   `'abandoned'`, although the start handler writes it when a candidate
   restarts a skill with an attempt in progress — so that start failed
   with a check-constraint 500 (another "assessment does not open" path).
   047's sibling constraints in the same file do include `'abandoned'`.
   Migration 274 re-adds the constraint as the old list plus
   `'abandoned'`; no value removed, no row rewritten. Flagged on #1606.
8. **Independent-review fixes (PR #1620).** The separate reviewer blocked
   the first cut on three findings, all fixed in this PR: (i) `/answer`
   now accepts only the session's outstanding question (coerced to a
   number, checked before evaluation and again under the record lock) —
   previously any bank question could be answered, an answer-oracle and
   fake-completion hole; (ii) `respondAfterRecord` is awaited at every
   `/answer` site and the new helpers take their pool connections inside
   their try blocks, so a post-commit pool failure becomes the designed
   503 instead of an unhandled rejection with no response; (iii) a
   completion claim that loses to a non-completion terminal transition
   (session abandoned by a newer start) returns no completion at all —
   `alreadyCompleted` requires an actual `skill_assessments` row — and
   the post-commit OmniScore feed is time-bounded (20s) so it cannot
   hang the completed response.

## Acceptance evidence

User-journey suite `e2e/journeys/assessment-phase-a.js` (Quinn +
Candidate Experience framing; PRD §10 JT-A1–A4 + the A5 start leg + the
JT-A6 integrity leg added by the review round),
run on the fresh-install rig (DB built only by `node migrate.js`, server
booted with the AI provider forced to fail by configuration — no mocked
fetch — and the question bank rig-seeded for determinism):

- Pre-fix (origin/dev f33eb3d92): 1 PASS / 6 FAIL — question numbered 3
  instead of 2 (JT-A1); answer rolled back on generation failure (JT-A4:
  500, 1 of 2 answers in DB); passing leg never completed (JT-A2/#1612:
  session stuck `in_progress`, no `skill_assessments`, no audit row);
  attempts completed after 9 answers (JT-A2/A2b); start returned a generic
  500 with no session for a zero-coverage skill (JT-A5).
- Post-fix: see the PR / issue checkpoints for the green run and the
  per-leg DB read-backs.

## Out of scope / follow-ups

- Per-skill bank coverage remediation (real questions per skill ×
  difficulty) remains the FR-A6 build follow-up; until a skill has supply,
  its start is the honest `QUESTION_UNAVAILABLE` state above, never a
  fake question (#1573). #1606 closure additionally requires the staging
  bank + parity evidence (PRD §11 item 3), which this dev-rig build does
  not provide.
- Phase B (unified exit + full-screen, #1604/#1605) builds on this
  terminal transition; the Partial Terminal-Submission Scoring gate
  (PRD §7) still requires Sumanth's ruling before any partial submission
  is scored.
- Reviewer-noted follow-up (not a regression): `serveNextQuestion` holds
  the session row lock across the AI cascade on an empty bank cell (dev
  held the equivalent lock inside the answer transaction). Generating
  outside the lock, then appending under a short re-checked lock, is the
  tracked improvement.
- No schema migration in this change beyond migration 274 (§7 above).
