# PRD — Assessments Module: Reliability, Unified Exit & Full-Screen Rules, Multi-Topic Redesign

**Author:** Aria (Phase 2 — Planning) · **Date:** 2026-10-21 · **Status:** At Suga's review gate (docs PR, not yet merged)
**Issues covered:** #1602 (P1), #1606 (P1), #1604, #1605, #1603 (EPIC)
**Rule basis:** Documentation-first (Sumanth, restored 2026-10-21; HL-006) — this PRD precedes any build on these issues. Acceptance criteria are written as user-journey tests (Sumanth's user-perspective rule, 2026-10-21).
**Companion docs:** `02-planning/full-application/prds/prd-m13-assessments-coding.md` (module PRD — this document covers the candidate skill-assessment batch and defers to M13 for the coding sandbox gate D-M13-1); PRD 2 of this batch: `prd-job-board-and-profile.md`.

> **Grounding note.** Every "current state" claim below was verified by reading the code on `origin/dev` at 50cc828be on 2026-10-21. Anything not verified is marked ⚠ **Unverified** and listed as an open verification item — it is not stated as fact anywhere in this PRD.

---

## 1. Executive summary

Candidates cannot reliably take skill assessments today: submissions hang or fail with answers at risk (#1602), some assessments never open (#1606), there is no way to leave a test mid-attempt (#1604), and there are no full-screen integrity rules (#1605). On top of the broken basics, the module is one hardcoded shape — 16 skills, exactly 10 questions each, two question types — where the product needs multiple subjects and topics, MCQ + coding formats, configurable question counts, and difficulty levels (#1603).

This PRD specifies, in build order: **(A)** make starting, answering, and submitting bulletproof and honest; **(B)** one unified exit design + full-screen policy that reconciles #1604 and #1605; **(C)** the multi-topic redesign of the catalogue. A and B ship on the current runner; C follows Rex's architecture (Phase 3) before any build.

## 2. Problem statement

**Who:** Candidates verifying skills on the Assessments page (self-serve skill assessments), and candidates taking recruiter-assigned job assessments.

**What is broken (verified in code, §4):**

1. Answer submission is a single request that evaluates the answer *and* generates the next question inside the same transaction. When the AI provider is slow or down, Next/Finish spins indefinitely. The rollback/loss case is narrower than "any provider failure" (verified, §4): an **evaluation-only** provider failure does **not** lose the answer — the answer is recorded as `pending_manual_review` (`routes/assessments.js:528,546,596`) and the transaction commits if the next question serves from the bank. Rollback and answer loss occur when **next-question generation returns null in the same transaction** (`routes/assessments.js:652-662`, 500 "Failed to generate next question"), because the whole transaction — including the just-recorded answer — is rolled back. The candidate sees a spinner, then a bare failure ("Request failed"), and cannot tell whether their answer counted. (#1602)
2. Starting an assessment generates its first question the same way. For a skill whose question bank has no row at the starting difficulty, start depends entirely on a live AI generation call; if generation returns null at start, the transaction rolls back and start fails with a 500 (`routes/assessments.js:397-402`) — the assessment simply does not open, the candidate gets an alert and stays on the list. This is the code path consistent with Python and SQL "not opening" while other skills work (bank coverage differs per skill). (#1606 — root cause to be confirmed per-skill by the audit in §7, FR-A6.)
3. The test runner has no exit control of any kind, and no full-screen behaviour. A candidate who must stop has one option: close the tab and abandon the session silently. (#1604, #1605)
4. The catalogue is a hardcoded constant of 16 skills with a hard cap of 10 questions and two question types (multiple choice, short answer). There is no subject → topic structure, no format choice, no count choice, no explicit difficulty choice. (#1603)

**Why it matters:** Assessments are a trust surface. A candidate who loses answers to a spinner, or who is scored by a flow they cannot exit cleanly, learns the platform is not trustworthy — the exact opposite of the launch proposition. These are P1 defects in the founder's own testing (filed 2026-10-21).

## 3. Target users

- **Primary:** Candidate taking a self-serve skill assessment (verify a skill, earn a Verified badge / best score on the Assessments page).
- **Secondary:** Candidate taking a recruiter-assigned job assessment (Assigned tab → job-assessment runner). The unified exit and full-screen rules in §6 apply to this runner too (see scope, §9).
- **Affected downstream:** Recruiters reading assessment results (attempt statuses must mean one thing everywhere), and OmniScore inputs (only genuinely evaluated, completed attempts may feed scoring — §8).

## 4. Current state (verified on dev @ 50cc828be)

**Surfaces**

- List/start: `client/src/pages/candidate/assessments.tsx` — tabs Available / Assigned / My Results. Start = `POST /assessments/start`; the first question is handed to the runner through `sessionStorage`.
- Runner (skill assessments): `client/src/pages/candidate/assessment-take.tsx` (411 lines) — one question at a time; per-question countdown from `question.timeLimit` (default 120s in the client; server generation uses 90s MCQ / 180s short answer).
- Runner (assigned job assessments): `client/src/pages/candidate/job-assessment-take.tsx` — a separate runner with its own endpoints (`/assessments/job-assessment/:id/start|answer|score`) and its own attempt table, timer model, and scoring step. See the per-runner mapping below — §6 requirements must be implemented per runner, not assumed shared.
- Aptitude tests: `client/src/pages/candidate/aptitude-test-take.tsx` + `routes/aptitude.js` — a third runner; named in scope boundaries (§9).
- Server: `routes/assessments.js` (2,975 lines) — `/available`, `/start`, `/answer`, `/event`, `/session/:sessionId/current`, `/generate`, job-assessment and referral families.

**Per-runner mapping — assigned job-assessment runner (verified, Rex full review 2026-10-21)**

| Aspect | Skill-assessment runner | Assigned job-assessment runner |
|---|---|---|
| Attempt record | `assessment_sessions` — statuses `in_progress`, `completed`, `abandoned` (an `abandoned` write exists, `routes/assessments.js:376`) | `job_assessment_attempts` — has an **extra `assigned` status** (created as `assigned`, `routes/assessments.js:1410-1411,1538-1540`; adopted to `in_progress` on start, `:2058-2072`) and **no `abandoned` write today** — no code path writes `abandoned` to this table, so §6.1's abandon outcome is new work on this runner, not a reuse |
| Scoring | Inside / at the end of the answer flow (`completeAssessment`, §7 gate) | A **separate step** after the last answer: the client polls `GET /assessments/attempt/:attemptId/score` (`client/src/pages/candidate/job-assessment-take.tsx:173`). Exit/submit design must state what happens to this separate scoring step for partial and abandoned attempts |
| Timer | Per-question countdown only; no whole-exam timer | **Whole-exam timer** (`timeLimitMinutes`, counted from `startedAt` — `job-assessment-take.tsx:96-99`) **plus** `due_date` expiry: an assigned or in-progress attempt past its `due_date` is refused with **410** (`routes/assessments.js:2064-2065,2083-2084`, and the same 410 guard on answer/score paths) |
| Modes | One question at a time, MCQ / short answer | A **conversational mode exists** (`routes/assessments.js:2906-2944`, `feature: 'conversational'`) in addition to the question flow — §6 exit/full-screen rules must state how they apply in conversational mode, or Rex's design must explicitly scope it out |
| Integrity events | `POST /assessments/event` posts `tab_switch` / `copy_paste` | Its own endpoint, `POST /assessments/job-assessment/:id/event` (`routes/assessments.js:2950-2975`), **drops every event type other than `tab_switch` / `copy_paste`** — it returns `{logged: true}` without recording anything else. §6.2 full-screen logging therefore needs an **explicit extension of this endpoint** (new event types recorded, not silently dropped); it does not come free from the skill runner's event path |

**Verified behaviours**

- **Catalogue:** `SKILL_CATALOG` constant, `routes/assessments.js:29` — 16 skills (JavaScript, Python, React, Node.js, SQL, TypeScript, Java, CSS & HTML, AWS, Docker, Git, Data Analysis, System Design, Project Management, Communication, Machine Learning), served by `GET /assessments/available` overlaid with the candidate's own skills/history.
- **Question supply:** `generateQuestion()` (`routes/assessments.js:754`) first selects a random row from the `assessment_questions` bank for (skill, difficulty); on a bank miss it generates one via the AI cascade (`chat()`, lib/polsia-ai) and inserts it into the bank. Question count is hard-capped: `totalQuestions: 10` and completion at question index ≥ 10 (`routes/assessments.js:426, 625, 693`).
- **Answering:** `POST /assessments/answer` runs in one DB transaction: MCQ answers are scored deterministically (`answer === correct_answer`, points = difficulty × 10); short answers are evaluated by AI (`evaluateShortAnswer`). If evaluation does not happen, the answer is recorded with **no score** and status `pending_manual_review` — never a default score (#1572 fix, `routes/assessments.js:528,546,596`). That evaluation-only failure path commits and the test continues **if the next question serves from the bank**. The loss case is distinct: the same request then generates/serves the next question, and if next-question generation returns null the handler rolls back the whole transaction and returns 500 (`routes/assessments.js:652-662`) — losing the just-recorded answer with it. The same rollback-at-start occurs when first-question generation returns null (`routes/assessments.js:397-402`). On other errors the transaction also rolls back and the client shows an alert; an `allProvidersFailed` error maps to a dedicated AI-unavailable response (`handleAIError`).
- **Timer:** per-question, client-side countdown; at zero the client auto-submits via the same `/answer` call with `'(no answer)'` if nothing was entered. There is no whole-exam timer in this runner.
- **Sessions:** `assessment_sessions.status` ∈ `in_progress`, `completed`, `abandoned` (starting a new session for the same skill marks the previous in-progress one `abandoned`, `routes/assessments.js:371-376`). A completed/abandoned session rejects further answers (400 "Session is not active"). Retake lockout exists for completed skills (`SKILL_RETAKE_LOCKOUT_DAYS`, ~line 347).
- **Integrity events:** the runner already posts `tab_switch` and `copy_paste` events to `POST /assessments/event`. There is **no** full-screen code and **no** exit control in any candidate runner (grep-verified across `assessment-take.tsx`, `job-assessment-take.tsx`, `aptitude-test-take.tsx`).
- **Results honesty (already correct — do not regress):** the completion screen reads the real session result (`/session/:id/current`); `antiCheatScore` is null-safe (absent = not computed, never a default 100, S-111).

⚠ **Unverified (open verification items, §11):** per-skill question-bank coverage by difficulty (the #1606 audit itself); whether staging behaves identically to dev for start/answer (Sumanth filed from staging). **Resolved by Rex's full review (2026-10-21):** next-question generation returning null mid-test rolls back the transaction and returns 500 (`routes/assessments.js:652-662`); the job-assessment runner's attempt table, scoring step, timer model, and event endpoint are mapped in the per-runner table above.

## 5. The candidate journey (target state, step by step)

1. **Choose.** On the Assessments page the candidate picks a subject/skill (and, after Phase C, a topic, format, count, and difficulty). They see how many questions, what format, and the time per question *before* starting.
2. **Instructions.** Before the first question, an instructions screen states, in plain words: the question count and format; the per-question timer and what happens at zero (auto-submit of that question); the full-screen requirement and the two-exit policy (§6.2); the exit options and exactly what each one does to their attempt (§6.1); and that short answers are AI-scored with human review (existing disclosure). Nothing starts until the candidate clicks **Start** (the click is also the browser gesture that permits full-screen).
3. **Answer.** One question at a time, with progress (Question N of M), the per-question countdown, and a visible **Exit** button. Selecting/typing an answer is the candidate's draft; pressing **Next** saves that answer and advances. If saving fails, the candidate stays on the same question, keeps their answer on screen, sees *why* it failed in plain words, and can retry (§7, FR-A2/A3).
4. **Next / Finish.** Next advances only after the save is confirmed. Finish (last question) submits the attempt **exactly once** and lands on the results view.
5. **Timer expiry.** When a question's timer reaches zero, that question is auto-submitted with the candidate's current selection/text if any, otherwise recorded as no-answer, and the test advances (or completes on the last question). The candidate is told this happened. A timer expiry must never produce a failure message as its outcome.
6. **Exit paths.** At any point the candidate can open the Exit dialog (§6.1) and choose Continue / Save & Exit / Submit & Exit / Exit Exam (abandon). Each outcome is exactly what its label says.
7. **Results.** A completed attempt shows the real computed score, pass/fail against the stated threshold, and per-question feedback where evaluation exists. Anything not yet evaluated is labelled "awaiting review" — never shown as a number. An abandoned attempt shows "Exited — not scored" and no number.

## 6. The unified exit design (reconciles #1604 + #1605)

#1604 asks for Continue / Save & Exit / Submit & Exit. #1605 asks for an Exit Exam that abandons **without evaluation**, plus full-screen rules. These are not two dialogs. **Reconciliation, stated explicitly: there is ONE Exit button and ONE dialog with FOUR options; "Submit & Exit" (#1604) and "Exit Exam" (#1605) are different outcomes with different consequences, and the dialog copy must make the difference unmistakable before the candidate confirms.**

### 6.1 The four outcomes

| Option | What happens to answers | Attempt status (server) | Score | Candidate sees afterwards |
|---|---|---|---|---|
| **Continue Test** | Nothing changes | `in_progress` | — | Returns to the current question |
| **Save & Exit** | All answered questions are saved server-side, **and** the current question's draft is saved as **stored-but-not-answered** (see the draft rule below — this is new persistence, it does not exist today) | stays `in_progress` (resumable) | none yet | Assessments list shows the attempt as **In progress** with a **Resume** action |
| **Submit & Exit** | All saved answers submitted for evaluation, exactly once | `completed` | computed from real evaluation only | Results view (same as Finish) |
| **Exit Exam** (abandon) | Answers are kept in the attempt record for audit, **never evaluated** | `abandoned` | **none — no score exists** (null, never 0) | "Exited — not scored"; the attempt never appears as a result and never feeds any score |

Rules that bind all four:

- **Exactly once.** Submit & Exit, Finish, timer completion, and the second-full-screen-exit auto-submit are the same terminal transition. Once an attempt is `completed` or `abandoned`, every further answer/submit/exit action is refused with a plain "This attempt is already finished" response. This must be the **atomic status-guarded transition required by FR-A3** — not an extension of the current non-locking status check (see FR-A3).
- **Timer while the dialog is open:** the per-question timer **pauses** while the Exit dialog is open, so a candidate is never punished for reading the consequences. If the candidate makes no choice within 30 seconds, the dialog closes and the test resumes (timer restarts). *(Design decision by Aria; Rex to confirm feasibility in Phase 3 — the timer is currently client-side, so this is implementable without server changes, but the resume semantics must be consistent.)*
- **Current-question draft at Save & Exit (definition, resolving the draft inconsistency):** the candidate's unsubmitted selection/text on the current question is a **draft: stored-but-not-answered**. It is persisted server-side at Save & Exit, it is **not** recorded as an answer, it is not evaluated, and it does not advance the question index. On resume it is restored onto that same question exactly as left, still unanswered, until the candidate presses Next. **This persistence does not exist today** — today a draft lives only in the runner's client state and pressing Next is the only save. Designing and building the draft persistence is **assigned to Rex's Phase 3 design**; no build may claim Save & Exit preserves the current draft until that design lands. JT-B2 tests this case explicitly.
- **Save & Exit resume semantics:** resuming returns to the first unanswered question — which, if a draft was saved at exit, is the draft's question, shown with the draft intact (above); answered questions are locked (shown in review only, if a review view exists — otherwise simply skipped); the resumed question's per-question timer starts fresh. A candidate may Save & Exit and resume any number of times; starting a *different* attempt of the same skill follows the existing rule (previous in-progress session is marked `abandoned`) and the candidate is told that at start time.
- **Abandon is honest and final:** an abandoned attempt cannot be resumed or converted to a submission. Whether the candidate may start a fresh attempt afterwards is **conditional on Sumanth's §11 item 5 ruling** (retake lockout after abandon — today the lockout applies to completed attempts only); neither this section nor JT-B4 may state a fresh attempt as unconditionally available until that ruling is made.
- **Assigned (job) assessments:** the same four outcomes apply. One difference, stated for the recruiter's side: a recruiter viewing an abandoned assigned attempt sees "Candidate exited — not scored", never a zero and never a fail.

### 6.2 Full-screen policy (#1605)

- On **Start** (from the instructions screen), the runner requests full-screen. If the browser refuses or does not support it, the test still runs, the fact is logged as an integrity event, and the candidate is not blocked or penalised for a browser limitation.
- **First exit** from full-screen: a warning the candidate cannot miss — "You left full-screen. Return to full-screen to continue. Leaving again will submit your test with the answers saved so far." — an integrity event is logged via the existing `POST /assessments/event`, and the candidate returns to the test by re-entering full-screen. The question timer pauses while the warning is shown (same rule as §6.1).
- **Second exit**: the attempt auto-submits **the answers saved so far**, exactly once → `completed`, with an integrity flag on the attempt recording that it was auto-submitted after two full-screen exits. The current question's unsaved draft is not included (the candidate was warned this is the rule). The candidate lands on the results view, which states plainly: "Submitted automatically after leaving full-screen twice. N of M questions answered."
- The policy (requirement, warnings, auto-submit, Exit Exam consequences) is stated on the instructions screen before Start (§5 step 2) — no rule may surprise the candidate mid-test.
- Full-screen events join the existing integrity event stream (tab switch, copy/paste) — observations for human review, never an automated cheating verdict (standing product rule). **Per-runner caveat (§4 mapping):** on the job-assessment runner this requires an explicit extension of its event endpoint (`routes/assessments.js:2950-2975`), which today records only `tab_switch`/`copy_paste` and silently drops everything else while returning `{logged: true}`; a full-screen event that is dropped by that endpoint is not logged, however the client behaved.

### 6.3 Failure & empty states the candidate must see (never silent, never fake)

- Start fails (question unavailable, provider down, network): the candidate stays on the list/instructions, sees what failed in plain words and a **Retry** action. No session is left dangling in a state the candidate cannot see or resume.
- Answer save fails: §5 step 3 — stay on the question, answer preserved on screen, plain-words reason, Retry. The candidate's typed/selected answer is never discarded by a failed request.
- Provider unavailable during evaluation: the answer is still recorded; its evaluation is `pending_manual_review` (the existing honest state) and results label it "awaiting review". The test continues; a provider outage must not freeze or fail an in-progress attempt.
- No questions exist for a chosen subject/topic at all: an honest empty state — "No questions are available for this yet" — and the attempt is not started. Never a test with fabricated placeholder questions.

## 7. Requirements

### Phase A — Reliability (#1602, #1606)

- **FR-A1 (answer-save integrity):** Every Next/Finish press results in exactly one of two visible outcomes: the answer is confirmed saved (test advances / completes) or the candidate remains on the same question with their answer intact, a plain-words reason, and a Retry action. There is no state in which the candidate cannot tell whether their answer counted.
- **FR-A2 (no indefinite loading):** Every submission state resolves — success, or a failure message with retry — within a bounded time. A spinner that never resolves is a defect by definition. The bounded behaviour (timeout + retry affordance) is part of the build's acceptance evidence.
- **FR-A3 (exactly-once completion — atomic terminal transition required):** Finishing, timer-expiry on the last question, Submit & Exit, and second-full-screen-exit all converge on one terminal transition. Double-clicks, retries after timeout, and refresh during submission cannot create duplicate submissions or double-scored attempts. **Design requirement for Rex (not an existing basis):** the current session-status guard is **not** sufficient and must not be cited as the basis — it is a non-locking read-then-check in `/answer` (`session.status !== 'in_progress'` → 400, `routes/assessments.js:465-468`), which two concurrent requests can both pass, and `completeAssessment` re-checks **no status at all** before completing. Rex's design must specify an **atomic status-guarded terminal transition** — e.g. a single `UPDATE … SET status='completed' … WHERE id=$1 AND status='in_progress'` whose affected-row count decides success, with the loser of any race receiving the "already finished" response — applied to every terminal path (Finish, Submit & Exit, timer completion, second-full-screen-exit, abandon). The client must also disable repeat submission while one is in flight — it does today via `submitting`, keep and extend to all terminal paths.
- **FR-A4 (timer-expiry auto-submit):** At zero, the current question is submitted with the candidate's current input (or recorded as no-answer), per §5 step 5. Timer expiry on the final question completes the attempt. The outcome shown to the candidate is the next question or the results view — never an error as the primary outcome.
- **FR-A5 (decouple evaluation from navigation — design direction for Rex):** the perceived hang exists because evaluation + next-question generation ride inside the answer request. Rex's design must preserve the distinction verified in §4: a slow or failed *evaluation* alone already records the answer as `pending_manual_review` (`routes/assessments.js:528,546,596`) and must never block navigation — the answer is recorded, the next question is served, evaluation completes under that honest pattern where it cannot complete synchronously. The design must additionally break the actual loss case: next-question generation returning null (`routes/assessments.js:652-662`) or failing at start (`:397-402`) must no longer roll back a recorded answer — navigation failure and answer loss must be separate outcomes. (Requirement on behaviour, not on mechanism.)
- **FR-A6 (#1606 audit — gate for the whole phase):** Before any "fixed" claim, produce the per-assessment audit matrix: **every** catalogue skill × start → answer all questions → finish → results, executed on the fresh-install dev rig, recording for each skill whether the question bank has coverage at every difficulty the session can reach (1–5) or generation is required, and the observed result. Any skill that cannot complete is fixed or its start is honestly blocked with the §6.3 empty state until it can. #1606 closes only when the matrix is fully green or every red cell has its own follow-up issue.
- **FR-A7 (start integrity):** Starting either succeeds into a playable first question or fails honestly (§6.3). A created session must always be visible/resumable to the candidate (list or runner), never orphaned.

### ⛔ NAMED GATE — Partial Terminal-Submission Scoring (pre-Phase-B; owner: Rex, ruling: Sumanth)

**Phase B cannot build until this gate is ruled.** Phase B introduces terminal submissions of *partial* attempts (Submit & Exit mid-test, and the second-full-screen-exit auto-submit of saved answers so far, §6.1/§6.2). Today the only completion path is the full 10-question flow, and `completeAssessment` (`routes/assessments.js:910-985`) scores it with hard-coded assumptions that are unsafe for a partial attempt: it writes `max_score` **100** regardless of how many questions were answered, computes `passed` as score **>= 60** (with the anti-cheat floor), and on a pass **sets the Verified badge** (`candidate_skills.is_verified`) and **feeds the result into OmniScore** (`omniscoreService.addTechnicalComponent`). Applying any of that unchanged to, say, a 3-of-10 partial submission would fabricate a comparable score from an incomparable attempt — a direct violation of §8.

Rex owns preparing this gate; **Sumanth rules** on the three decisions:

1. **Score normalisation for partial completions** — is a partial attempt's score expressed against the questions answered, against the full 100, or not expressed as a number at all?
2. **Pass / Verified eligibility** — can a partial terminal submission ever count as `passed`, and can it ever set the Verified badge?
3. **OmniScore eligibility** — may a partial terminal submission feed OmniScore at all, and if so under what conditions?

Until all three are ruled, Phase B builds may implement the dialog, the abandon outcome, and Save & Exit, but **no partial terminal submission may be scored, passed, Verified, or fed to OmniScore**.

### Phase B — Unified exit + full-screen (#1604, #1605)

- **FR-B0 (gate dependency):** Phase B is subject to the **Partial Terminal-Submission Scoring gate** above — owner Rex, ruling Sumanth. No Phase B build starts on the scoring of partial terminal submissions until that gate is ruled.
- **FR-B1:** One Exit button, visible throughout the test without distracting (persistent, labelled "Exit"), opening the single dialog of §6.1 with the four outcomes and consequence copy per option.
- **FR-B2:** Attempt statuses mean exactly one thing on every surface that shows them: `in_progress` (incl. saved-for-resume), `completed` (scored from real evaluation), `abandoned` (exited, never scored, no numeric score anywhere).
- **FR-B3:** Full-screen policy exactly as §6.2, including the pre-start instructions, first-exit warning + pause, second-exit auto-submit of saved answers, and integrity-event logging through `POST /assessments/event`.
- **FR-B4:** Both candidate runners (skill assessments and job assessments) implement the same dialog, statuses, and full-screen policy. Aptitude tests adopt the same behaviour in this phase if Rex's design confirms the runners share enough structure; otherwise aptitude is a named follow-up, not a silent omission.

### Phase C — Multi-topic redesign (#1603, EPIC — Rex architecture first)

- **FR-C1 (catalogue model):** Subjects (Python, Java, JavaScript, SQL, DSA, OOP, HTML/CSS, aptitude, and the existing 16 skills mapped into the model) → topics within a subject → multiple practice sets per topic. The catalogue is **data** (served from the backend), not a hardcoded client/server constant; the current `SKILL_CATALOG` constant is the migration source, not the future.
- **FR-C2 (formats):** MCQ (concept, output-prediction, debugging, theory) and coding (editor + test cases + automatic evaluation). Coding evaluation rides the existing coding surfaces (`routes/coding-submissions.js`, `routes/sandbox.js`) — gated by the #118 sandbox audit disposition (M13 D-M13-1) before real candidates run code.
- **FR-C3 (configuration):** The candidate (or the assigning recruiter, for assigned assessments) chooses question count (10 / 25 / 50 / 100), format, and difficulty (Easy / Medium / Hard). How explicit difficulty interacts with the current adaptive 1–5 engine is Rex's design decision; the PRD requirement is that the *chosen* configuration is what the candidate gets — count shown before start equals count served.
- **FR-C4 (question supply):** Questions come from a real bank per (subject, topic, format, difficulty) with generation as backfill, per the existing bank-first pattern in `generateQuestion`. A configuration with insufficient questions shows the §6.3 honest empty state (or offers the largest available count, labelled as such) — never silently fewer questions than promised, never fabricated questions presented as curated.
- **FR-C5 (progress):** Repeated attempts use different question sets where the bank allows; scores, feedback, and progress tracking per topic persist and are shown from real attempt records.

## 8. Honesty requirements (binding on all phases)

1. **No fabricated scores, anywhere in these flows.** A score is displayed only when it was computed from a real evaluation of real answers. Unevaluated work shows "awaiting review"; abandoned work shows no score; a failed evaluation shows an honest unavailable state. (Extends the standing no-fake-numbers rule; the #1572/#1573 fixes are the precedent and must not regress.)
2. **No silent failure.** Every failure state in §6.3 names what happened in plain words and offers the next action (retry / resume / back to list).
3. **No surprise rules.** Every consequence (timer, full-screen, exit outcomes) is disclosed before Start.
4. **Counts are real.** "Question N of M", "N of M answered", attempt counts, and best scores come from the attempt's actual records.
5. **Integrity data is observational.** Full-screen/tab/copy events are recorded for human review; the product never presents an automated cheating verdict to anyone.

## 9. Scope

**In scope:** candidate skill-assessment flow (list → instructions → runner → results); assigned job-assessment runner for exit/full-screen parity (FR-B4); the #1606 audit; Phase C catalogue model and candidate-side configuration.

**Out of scope:** recruiter assessment authoring UI changes (beyond what FR-C3 needs for assigned configuration); the coding sandbox internals (#118 owns); aptitude-test content; OmniScore formula changes (only the input contract in §3/§8 — abandoned and unevaluated attempts contribute nothing); pricing/entitlement gating for assessments.

## 10. Acceptance criteria — user-journey tests

*Written from the candidate's expectations (2026-10-21 rule). Each test runs the real flow on the fresh-install dev rig; the work is done when the tests pass end-to-end. Provider-dependent steps that cannot run are recorded BLOCKED with the reason, never passed.*

**#1602 — submission reliability**
- JT-A1: Candidate answers question 1 and presses Next → the next question appears; pressing browser Back/refresh and resuming shows the session at question 2 (the answer counted).
- JT-A2: On the last question the candidate presses Finish → results appear once; pressing Finish repeatedly / refreshing during submission never produces a second submission or a changed score.
- JT-A3: Candidate lets a question's timer reach zero with an answer selected → the test advances (or completes) and the results reflect that answer as submitted; with no answer selected → the question is recorded as unanswered and the test still advances/completes. At no point does the candidate see a bare "Request failed" as the outcome of a timer expiry.
- JT-A4: With the network/provider forced to fail during an answer submission → the candidate stays on the same question, their answer is still on screen, a plain-words message explains the failure, and Retry succeeds when the failure clears — the answer is counted exactly once.

**#1606 — every assessment opens**
- JT-A5: For **every** skill in the catalogue, the candidate can start, answer all questions, finish, and see results (the FR-A6 matrix, executed as journeys). Any skill that cannot is either fixed or shows the honest "not available yet" state instead of failing on open.

**#1604 + #1605 — unified exit & full-screen**
- JT-B1: Mid-test, the candidate opens Exit → Continue Test → returns to the same question with their draft intact.
- JT-B2: Mid-test, Save & Exit → the Assessments list shows the attempt In progress with Resume; Resume returns to the first unanswered question with prior answers locked and counted. Cross-reference (JT-B2 vs FR-A7): Resume acts on the same session and is not a "new session start", so the auto-abandon rule for starting a new attempt does not apply to it — the definitive ruling on this interaction is deferred to Rex's Phase 3 design.
- JT-B2a (draft-at-exit, explicit): Mid-test, the candidate selects/types an answer on the current question but does **not** press Next, then Save & Exit → Resume → the candidate lands on that same question with the **draft present and intact, still not answered** (not evaluated, not counted as an answered question, question index unchanged); pressing Next then submits that draft as the answer, exactly once.
- JT-B3: Mid-test, Submit & Exit → results show the score computed from the answers given so far, **as ruled by the Partial Terminal-Submission Scoring gate (§7)**; the attempt cannot be resumed.
- JT-B4: Mid-test, Exit Exam → the candidate confirms an explicit "will NOT be marked" warning → the attempt shows "Exited — not scored" with no number anywhere (list, results, profile). Whether a fresh attempt can then be started is **conditional on Sumanth's §11 item 5 ruling** (retake lockout after abandon): if the ruling applies the lockout, the test asserts the lockout is shown honestly with its reason; if it does not, the test asserts a fresh attempt starts. The unconditional claim is not tested or shipped before that ruling.
- JT-B5: Starting a test shows the instructions (timer, full-screen, exit consequences) before the first question; the test enters full-screen on Start.
- JT-B6: Leaving full-screen once → warning shown, timer paused, candidate re-enters and continues with no answers lost. Leaving a second time → the test submits the saved answers exactly once and the results view states it was auto-submitted and how many questions were answered.
- JT-B7: No sequence of exit actions (double-clicks, dialog + full-screen exit combined, refresh mid-dialog) produces a duplicate submission or an attempt that is both completed and abandoned.
- JT-B8 (job runner — exit outcomes): On the **assigned job-assessment runner** (`job_assessment_attempts`), the candidate exercises each §6.1 outcome: Continue returns to the current question; Save & Exit leaves the attempt resumable (from its `assigned`/`in_progress` lifecycle); Submit & Exit hands the attempt to its separate scoring step (`/assessments/attempt/:attemptId/score`, `job-assessment-take.tsx:173`) exactly once, subject to the §7 scoring gate; Exit Exam records the attempt as abandoned/exited — a status write that **does not exist on this table today** and must be evidenced as newly built, not assumed.
- JT-B9 (job runner — full-screen policy): On the job runner, starting enters full-screen per §6.2; first exit warns and pauses (including the whole-exam `timeLimitMinutes` timer); second exit auto-submits saved answers exactly once. The test evidences that the full-screen events were **actually recorded** by the job runner's event endpoint (`routes/assessments.js:2950-2975`) — after its explicit extension beyond `tab_switch`/`copy_paste` — not merely that the client posted them and received `{logged: true}`.
- JT-B10 (job runner — recruiter view of an exit): After a candidate Exit Exam on an assigned assessment, the **recruiter** viewing that attempt sees **"Candidate exited — not scored"** — no zero, no fail, no score — and the attempt does not appear in any scored-results or ranking view.

**#1603 — redesign (Phase C, after Rex architecture)**
- JT-C1: Candidate chooses a subject → a topic → a format → a count (e.g. 25) and difficulty → the instructions show exactly that configuration, and the test serves that many questions of that format/difficulty.
- JT-C2: A coding-format test presents an editor and test cases, runs the candidate's code, and shows pass/fail per test case from the real run.
- JT-C3: Retaking a topic serves a different question set where the bank allows, and the candidate's progress view shows both attempts' real scores.
- JT-C4: Choosing a configuration with no available questions shows the honest empty state before start — the candidate is never dropped into a broken or shortened test without being told.

## 11. Open questions & verification items

1. **Resolved (Rex full review, 2026-10-21):** next-question generation returning null mid-test rolls back the whole transaction and returns 500 (`routes/assessments.js:652-662`); at start the same rollback returns 500 (`:397-402`). FR-A5 is written against this verified behaviour. Draft handling on the job runner remains a Rex Phase 3 design item (the §6.1 stored-but-not-answered draft definition applies to both runners).
2. ⚠ Per-skill bank coverage by difficulty — produced by the FR-A6 audit; the leading hypothesis for #1606 (bank miss + provider failure at start) is confirmed or replaced by that audit's evidence, per skill.
3. ⚠ Staging parity for start/answer/exit surfaces (Sumanth filed from staging; this PRD is grounded in dev) — verify before closure claims, per the two-environment proof rule.
4. **Resolved (Rex full review, 2026-10-21):** job-assessment runner internals are mapped in §4's per-runner table (attempt table + `assigned` status + no `abandoned` write, separate scoring step, whole-exam timer + `due_date` 410, conversational mode, event-endpoint extension needed). Rex's Phase 3 design works from that mapping for FR-B4 parity.
5. **For Sumanth (product call, batched — not blocking Phase A):** should the retake lockout also apply after an *abandoned* attempt, or only after completed ones? Aria's recommendation: abandon does not trigger the lockout (the candidate was never scored), except that repeated abandon-after-start within a short window may be rate-limited as an integrity signal for human review.
6. **For Sumanth:** Phase C difficulty — replace the adaptive engine with the chosen Easy/Medium/Hard, or keep adaptation *within* the chosen band? Aria's recommendation: keep adaptation within the chosen band (preserves the existing engine, honours the candidate's choice). Rex to validate in architecture.

## 12. Dependencies & risks

- **AI provider availability (standing MAJOR):** question generation and short-answer evaluation ride the provider cascade (`lib/polsia-ai.js`). With no working provider key reachable, generation-dependent steps cannot be proven end-to-end; the PRD's failure-state requirements (FR-A1/A2, §6.3) are precisely what makes the module honest under that condition, and bank coverage (FR-A6) is what makes it usable. Journey tests record provider steps BLOCKED, never fake-passed.
- **#118 sandbox audit** gates coding-format launch (Phase C / FR-C2), per M13 D-M13-1.
- **Risk — scope bleed:** Phase C is an epic; Phases A/B must not be held hostage to it. The batch order stands: A → B → C.
