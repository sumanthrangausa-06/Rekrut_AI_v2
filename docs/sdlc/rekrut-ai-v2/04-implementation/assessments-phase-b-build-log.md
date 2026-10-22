# Build Log — Assessments Phase B: unified exit dialog & full-screen policy (#1604, #1605)

**Phase:** 4 — Implementation · **Persona:** Nova (build), Quinn (HL-003 gate)
**PRD:** `docs/sdlc/rekrut-ai-v2/02-planning/sumanth-batch-2026-10-21/prd-assessments-module.md` §6.1/§6.2, §7 Phase B (FR-B1–B4), §10 JT-B1–B10
**Design:** `docs/sdlc/rekrut-ai-v2/03-solutioning/sumanth-batch-2026-10-21/design-assessment-exit-fullscreen.md` (Rex, PR #1635)
**STOP 1s:** #1604 comment 6335101020, #1605 comment 6335101624 (specialist decision + verdicts recorded there)
**Branch:** `nova/1604-1605-exit-fullscreen` → `dev`

## Founder ruling applied

Partial terminal submissions (Submit & Exit mid-test, full-screen second-exit
auto-submit) are scored over **answered questions only**, labelled plainly as
partial (**answered X of Y**) wherever shown, are **not** eligible for
pass/Verified, and do **not** feed OmniScore. Retake after abandon: **no
lockout** (an abandoned attempt writes no `skill_assessments` row, so the
completed-only lockout in `POST /assessments/start` can never trip; no code
was added to change that).

## What changed (behaviour)

1. **One Exit button, one dialog, four outcomes — both runners.** A shared
   component (`client/src/components/assessments/exit-fullscreen.tsx`) renders
   the identical dialog in the skill runner and the assigned job runner:
   Continue Test / Save & Exit / Submit & Exit / Exit Exam (the last with an
   inline second confirmation inside the same dialog). Opening the dialog
   pauses all timers; no choice within 30 s resumes the test (see the
   accessibility amendment below). Exact copy per design §3.2 as amended by
   the Candidate Experience review (final partial wording, draft rule stated
   in both Save and Submit lines, "timer is paused" as the dialog's first
   line, Exit Exam "kept only as a record" + no-waiting-period confirmation).
2. **One new exit endpoint per runner.** `POST /assessments/session/:sessionId/exit`
   and `POST /assessments/job-assessment/:id/exit` with
   `{action: 'save'|'submit'|'abandon', draft?, reason?}` and the shared
   response shape `{status, answersGiven, totalQuestions}`; a terminal
   attempt answers `409 {error:'This attempt is already finished', code:'ALREADY_FINISHED'}`,
   so any exit request can be retried blindly (§6.1 network-loss rule).
   Ownership guards are the existing ones verbatim.
3. **Exactly-once terminal transitions (§4.3).** Submit & Exit reuses the
   Phase A atomic completion claim (`completeAssessmentTx`). Exit Exam is its
   mirror claim to `abandoned` — it writes no `skill_assessments` row, runs
   no evaluation, feeds no OmniScore; answers stay on the attempt row for
   audit. The job runner's last-answer plain UPDATE was converted to the
   same status-guarded claim, and its submit claim writes the completion
   flags in the same transaction, then fires `scoreAttempt` exactly once
   after commit.
4. **Partial scoring (skill runner).** Inside the claim transaction, from
   the locked session row: score = earned points / max points of the
   ANSWERED questions × 100 (answered questions read `FOR UPDATE` under the
   claim's lock discipline); `passed` is always false, the Verified write is
   unreachable, `behavioral_flags` gains `{partial, answers_given,
   total_questions, correct_count, fullscreen_auto_submit}`, and
   `completeAssessmentTx` skips the OmniScore feed for partial results (the
   graded audit still records them, labelled partial). Zero answered
   questions ⇒ score NULL — no number at all, never a fabricated 0.
   A retried auto-submit backfills `fullscreen_auto_submit` via idempotent
   `jsonb_set` (database-reviewer condition).
5. **Partial scoring (job runner).** `scoreAttempt` already computes its
   composite over answered questions only; for a partial-flagged attempt it
   now skips the application round-trip (no pass/fail write, no stage
   advance) and the OmniScore recalculation, and `GET /attempt/:id/score`
   returns `result: null` with the partial counts. `scoreAttempt` refuses
   abandoned attempts outright.
6. **Draft persistence (§8.2).** `current_draft JSONB` on both attempt
   tables (migration 276): written only by Save & Exit, validated against
   the session's outstanding question (skill) / the assessment's questions
   (job), restored by the resume read-backs (`/session/:id/current`,
   job `/start`), cleared in the same write that records that question's
   answer, and cleared on every terminal transition. A draft is never in
   `answers_given`/`answers`, never evaluated, never recruiter-visible.
7. **Full-screen policy (§5).** Instructions screens on both runners
   disclose every rule before the first question (counts, per-question /
   whole-exam time, the two-exit policy, the exit outcomes, "an answer is
   saved when you press Next", AI-scoring disclosure) — Start is the
   full-screen gesture. First exit ⇒ warning modal + timers paused +
   `fullscreen_exit_first` recorded; second exit ⇒ the exit endpoint with
   `reason:'fullscreen_second_exit'` (saved answers only). The exits-used
   count is restored from the server on resume, so a refresh cannot reset
   the allowance. Client timers pause while the dialog/warning is open;
   the job runner's whole-exam server guard subtracts **pause credit**
   computed from the recorded `timer_pause_start/end` events (one shared
   helper for `/answer`, `/converse` and the exit paths; overlapping
   intervals merged, 300 s cap per merged interval, unpaired starts
   discarded — database-reviewer condition).
8. **Job event endpoint (§7.2).** It now records the full §7 vocabulary
   into the attempt's `integrity_events` (migration 277) in a single
   ownership+status-guarded append (rowcount 0 ⇒ 404), keeps the
   `tab_switch`/`copy_paste` counters, and returns `400` for unknown types —
   `{logged:true}` is only ever returned for an event actually recorded.
   The skill runner's event table already accepted the vocabulary.
9. **Honest end states everywhere.** Candidate: "Exited — not scored"
   (runner end state; abandoned attempts never appear in My Results — they
   have no `skill_assessments` row). Partial results render as
   **Partial result** with the CX paragraph ("…based only on those X
   answered questions: C of X correct… not a pass, does not earn Verified,
   does not count toward your OmniScore"), the chip
   **"Partial — answered X of Y"**, and the score in "C of X answered
   correct" form — in the runner completion view, the results page, and
   the assessments list (never a bare %, never Failed). Auto-submitted
   results state "Submitted automatically after leaving full-screen twice.
   N of M questions answered." Recruiter (job): abandoned attempts are
   listed separately as **"Candidate exited — not scored"** and stay out of
   scored/ranking views (they have no `scored_at`); partial attempts carry
   the same Partial chip with the answered-only score form.

## Specialist-condition amendments to the design (STOP 1)

- **Accessibility BLOCK 1 (exit counting):** full-screen exits are counted
  only from the in-test state with no modal open, and auto-submit
  additionally requires a question interaction since the last granted
  entry. A raw exit failing those checks is logged as
  `fullscreen_exit_repeat` (new vocabulary entry, recorded like the rest)
  and re-shows the warning with the count unchanged. Esc in the warning
  does nothing.
- **Accessibility BLOCK 2 (30 s auto-close):** any focus/keyboard/pointer
  interaction with the dialog resets the countdown, and it never fires
  while the dialog holds focus (WCAG 2.2.1). The visible countdown and the
  paused-timer line are in the dialog's first lines.
- **Accessibility BLOCK 3 (opt-out):** an explicit, unpenalised
  **Continue without full-screen** choice on both instructions screens and
  on the first-exit warning. It runs the identical test (same questions,
  timers, dialog, scoring eligibility), is logged factually as
  `fullscreen_opt_out`, and is never presented as suspicious.
- **Database-reviewer M1-2 (abandon timestamp):** abandon claims set a new
  dedicated `abandoned_at` column (migration 276, both tables) and leave
  `completed_at` NULL — deviating from design §4.1's `completed_at=NOW()`.
  A consumer audit at build time found no surface reading
  `assessment_sessions.completed_at` as "completed" (all key on
  `skill_assessments`), but the dedicated column removes the misread class.
- **Database-reviewer M1-1 (migration shape):** the design's single
  migration 276 is split into 276 (drafts + `abandoned_at`) and 277 (job
  `completion_flags` + `integrity_events`, with type-consistency guards,
  NULL backfill and `SET NOT NULL`). Both are expand-only; both `down()`s
  warn over data-bearing rows before dropping only their own columns.
- **Modals:** `role="alertdialog"`, `aria-modal`, labelledby/describedby,
  real focus traps, rendered inside the runner root (inside the
  full-screen subtree), initial focus on Continue Test (dialog) / the
  heading (warning), focus returns to the Exit button; timer pause/resume
  announced via a polite status region; the ticking countdown is never
  live-announced. Continue from a warning-opened dialog returns to the
  warning (Candidate Experience condition).

## Journey tests & evidence

Suite: `e2e/journeys/assessment-phase-b.js` (Quinn + Candidate Experience
framing) — JT-B1, JT-B2, JT-B2a, JT-B3, JT-B4, JT-B6 (API/event level:
full-screen is a browser capability; the state machine itself is covered
by the client review), JT-B7, JT-B8, JT-B9, JT-B10.

- RED baseline (pristine dev @ 1a8a6da93, fresh-install rig): JT-B1 PASS;
  JT-B2/B2a/B3/B4/B6/B7 FAIL with `Cannot POST /api/assessments/session/:id/exit`
  (endpoint did not exist); job legs FAIL (exit endpoint 404, events dropped).
- GREEN + per-leg DB read-backs: see the PR description and the checkpoint
  comments on #1604/#1605 for the final evidence JSON summary.

## Out of scope / follow-ups

- Conversational mode (job runner): the Exit dialog and its four outcomes
  apply (attempt-level, same endpoint); full-screen enforcement for
  conversational turns is a named follow-up (design §9.3), not silently
  included.
- Aptitude runner: out of Phase B scope (design §9.3) — the dialog/endpoint
  pattern is liftable unchanged.
- The job instructions gate shows after the start/adopt call returns (the
  first point the real question count and time limit exist) and before the
  first question is revealed; a pre-start read endpoint for assigned
  assessments is a follow-up if product wants the counts before adoption.
