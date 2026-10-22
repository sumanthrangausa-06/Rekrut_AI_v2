# Design — Unified Assessment Exit Dialog & Full-Screen Policy (#1604 + #1605)

**Author:** Rex (Phase 3 — Solutioning) · **Date:** 2026-10-21 · **Status:** Design — at Suga's review gate. No build starts from this document until Suga clears it and the §11 scoring gate is ruled.
**Issues:** #1604 (no way to exit an assessment mid-test), #1605 (full-screen mode + exit rules) — designed as ONE reconciled design per the cross-link comments on both issues. The candidate never faces two exit behaviours.
**PRD:** `docs/sdlc/rekrut-ai-v2/02-planning/sumanth-batch-2026-10-21/prd-assessments-module.md` — §5 step 2 (instructions screen), §6.1 (four exit outcomes), §6.2 (full-screen policy), §7 Phase B (FR-B0–B4) and the named Partial Terminal-Submission Scoring gate, §10 JT-B1–B10.
**Rule basis:** Documentation-first (Sumanth, restored 2026-10-21; HL-006) — this design precedes any Phase B build. Provenance (HL-004): this is Rex's design, written from Aria's PRD, Sumanth's recorded rulings, and the verified code state in §2. It is not a panel ruling; the specialist reviews named in §12 are build gates, not consultations already held.
**Builds on:** Phase A (PR #1620, merged — #1602/#1606/#1612). Phase A changed the attempt/completion model materially (atomic completion claim, decoupled answer recording, `serveNextQuestion`); every mechanism below is specified against the Phase A code, not the pre-Phase-A code the PRD's §4 was grounded in. Where Phase A already built what the PRD asked Rex to design, this document says so and reuses it.

---

## 1. Decisions already ruled — this design does not reopen them

| # | Ruled fact | Source |
|---|---|---|
| D1 | ONE Exit button, ONE dialog, FOUR outcomes: Continue Test / Save & Exit / Submit & Exit / Exit Exam. | #1604 + #1605 cross-links; PRD §6.1 |
| D2 | Exit Exam terminates the attempt as `abandoned`, WITHOUT evaluation. No score exists — null, never 0. Excluded from results and from every score input (incl. OmniScore). Answers retained for audit only. | #1605; PRD §6.1 |
| D3 | **FOUNDER RULING: NO retake lockout after an abandoned attempt.** Exit Exam carries no retake penalty. (This supersedes PRD §6.1/§11 item 5, which left the question open, and makes JT-B4 unconditional — see §10.) The existing lockout (`SKILL_RETAKE_LOCKOUT_DAYS`, checked in `POST /assessments/start` against `skill_assessments.completed_at`) applies to completed attempts only and is untouched: an abandoned attempt writes no `skill_assessments` row, so it can never trip that check. No code change is needed to honour D3 — and no build may add one. | Sumanth, 2026-10-21, recorded on #1605 |
| D4 | Full-screen: auto full-screen on Start from the instructions screen; first exit = warning + timer paused + integrity event via the existing event path; second exit = auto-submit of SAVED answers exactly once, flagged on the attempt, results view states it plainly. All rules disclosed on the instructions screen before Start. | #1605; PRD §6.2 |
| D5 | Integrity events are observations for human review — never an automated cheating verdict, on any surface. | Standing product rule; PRD §8.5 |
| D6 | Timer pauses while the Exit dialog is open; dialog auto-closes (resume) after 30 s with no choice. | PRD §6.1 (Aria's decision; §5.3 confirms feasibility) |

---

## 2. Verified current state (dev @ 4d70411db, 2026-10-21, read live by Rex)

**Skill-assessment runner**

- Runner: `client/src/pages/candidate/assessment-take.tsx` (559 lines). Per-question client countdown (`timeLeft`, `setInterval` effect ≈L270); `submitting` flag disables repeat submission; integrity reporting today = `visibilitychange` → `tab_switch` only. No Exit control, no full-screen code (grep-verified, both runners + aptitude).
- Server: `routes/assessments.js` (3,296 lines).
  - `POST /assessments/start` — commits the session (`assessment_sessions`, status `in_progress`) BEFORE serving question 1 (FR-A7); a new start for the same skill first marks the previous `in_progress` session `abandoned` (≈L372–379). Retake lockout for completed skills checked before that (≈L349–368).
  - `POST /assessments/answer` — Phase A: evaluation outside any transaction, answer recorded in its own committed transaction under the session row lock, duplicate submissions return recorded state; navigation via `serveNextQuestion`.
  - **Completion (Phase A, FR-A3 — already built):** `completeAssessment(client, sessionId, userId)` (≈L1216) opens with ONE atomic status-guarded claim — `UPDATE assessment_sessions SET status='completed', completed_at=NOW() WHERE id=$1 AND status='in_progress' RETURNING *`. Rowcount decides the race winner; a loser with no existing `skill_assessments` row gets `null` (honest non-completion, never a fabricated one). `completeAssessmentTx` (≈L901) runs it in its own transaction; OmniScore feed (`omniscoreService.addTechnicalComponent`) + `assessment_graded` audit run AFTER commit, exactly once, skipped for `alreadyCompleted` claims (#1612 Option B).
  - `completeAssessment` scoring today (the §11 gate's subject): `passed = (session.score || 0) >= 60 && antiCheatScore >= 50`; inserts `skill_assessments` with hard-coded `max_score = 100`; on pass sets `candidate_skills.is_verified`. `session.score` accumulates per-answer points, so a partial attempt's reachable score is structurally below 100.
  - `GET /assessments/session/:sessionId/current` — the resume/refresh path: `completed` → results payload; `in_progress` → finishes a fully-answered session or re-serves the current question via `serveNextQuestion`; any other status → `{ status, skillName }` with no score (an abandoned session already surfaces scoreless here).
  - `POST /assessments/event` (≈L721) — inserts into `assessment_events (session_id, event_type, event_data)`; `event_type` is a free `VARCHAR(50)` (migration 006) with NO allowlist — new event types record today with zero server change. Counters exist only for `tab_switch` / `copy_paste`.
  - Schema: `assessment_sessions.status` CHECK already includes `abandoned` (migration 274, Phase A, expand-only). Columns include `questions_asked` / `answers_given` JSONB, `score INTEGER DEFAULT 0`, `tab_switches`, `copy_paste_attempts`, `time_anomalies`, `suspicious_behavior` JSONB, `started_at`, `completed_at` (migration 006 + later).

**Assigned job-assessment runner (parity target, FR-B4)**

- Runner: `client/src/pages/candidate/job-assessment-take.tsx` (556 lines). TWO timers: per-question countdown AND a whole-exam countdown derived from wall clock (`startedAt + timeLimitMinutes`, ≈L96–99). Scoring is a separate step: after the last answer the client polls `GET /assessments/attempt/:attemptId/score` (≈L173).
- Attempts: `job_assessment_attempts` (migration 042). Status CHECK is `('assigned','in_progress','completed','expired','abandoned')` (migration 047 + p4 expansion adding `assigned`) — **`abandoned` is already a legal value; no code path writes it today.** Abandon on this runner is a new write against an existing schema value, not a migration.
- Start/adopt: `POST /assessments/job-assessment/:id/start` (≈L2373–2392) adopts an `assigned` attempt to `in_progress`. This is the resume entry point.
- Answer: `POST /assessments/job-assessment/:id/answer` (≈L2500) — attempt fetched with `status='in_progress'` guard + `due_date` 410 guard; on the last answer it runs a PLAIN `UPDATE … SET status='completed'` (≈L2623, **not** status-guarded — two concurrent last-answers can both pass) then fires async `scoreAttempt(attemptId, assessmentId)`. Phase B must harden this one transition to the Phase A claim pattern (§6.3).
- Event endpoint: `POST /assessments/job-assessment/:id/event` (≈L3271) — records ONLY `tab_switch` / `copy_paste_attempts` counters; every other type returns `{logged: true}` and records nothing. Full-screen logging on this runner does not exist until this endpoint is extended (§7.2).
- Conversational mode exists (`POST /assessments/job-assessment/:id/converse`, ≈L3140). Scoped in §9.3.

**What does not exist anywhere today:** full-screen code, an Exit control, current-question draft persistence (a draft lives only in runner client state; Next is the only save), any `abandoned` write on the job runner, any terminal-transition endpoint other than the answer flow itself.

---

## 3. The unified exit dialog

### 3.1 Placement and behaviour (both runners, identical)

- A persistent, labelled **Exit** button in the runner header, visible on every question, never covering question content, keyboard-reachable in normal tab order.
- Clicking Exit (or the full-screen first-exit warning's "Review your options" action, §5) opens ONE modal dialog. Opening the dialog: (a) pauses all timers (§5.3), (b) logs `exit_dialog_opened` (§7), (c) traps focus inside the dialog, `role="alertdialog"`, labelled by its heading; Esc does NOT dismiss it silently — Esc = Continue Test (the safe outcome), announced as such.
- The dialog lists the four outcomes as four distinct, fully-labelled actions — not a confirm/cancel pair. Exit Exam is visually separated and carries its consequence in its label area, not in fine print. Selecting Exit Exam requires a second, inline confirmation step inside the same dialog ("Exit this exam without a score?" → [Exit Exam] [Go back]) — one extra deliberate act for the one irreversible, unscored outcome. The other three outcomes execute on a single selection.
- If no choice is made within **30 s**, the dialog closes and the test resumes exactly as Continue Test (D6), logging `exit_dialog_timeout_resume`.

### 3.2 Exact copy (honest, plain words — Candidate Experience reviews before build, §12)

Heading: **"Leave this test?"**

| Option | Label | Consequence line shown under the label |
|---|---|---|
| Continue | **Continue Test** | "Go back to your test. Nothing changes." |
| Save & Exit | **Save & Exit** | "Your answers so far are saved. You can resume this test later from the Assessments page." |
| Submit & Exit | **Submit & Exit** | "End the test now and score the answers you have saved so far. You cannot resume after submitting." (+ the partial-scoring sentence from the §11 ruling, once ruled — until then this option's scoring behaviour is whatever the ruling decides; the copy slot is reserved, not improvised at build time) |
| Exit Exam | **Exit Exam** | "End this test WITHOUT a score. It will show as 'Exited — not scored'. Your answers are kept for review only and are never marked. This does not block you from starting a fresh attempt." (last sentence = D3, stated to the candidate) |

Exit Exam inline confirmation: **"Exit this exam without a score? Your answers will not be marked."** → [Exit Exam] [Go back].

### 3.3 The exit endpoint (one new endpoint per runner — everything else is reuse)

Terminal and pause transitions must be server state, not client intentions, so exactly one new endpoint per runner is justified; no existing endpoint expresses them (`/answer` records answers; `/event` only logs).

**Skill runner:** `POST /assessments/session/:sessionId/exit`
Body: `{ action: 'save' | 'submit' | 'abandon', draft?: { questionId, answer } | null, reason?: 'candidate' | 'fullscreen_second_exit' }`
Auth/ownership exactly as `/session/:sessionId/current` (session's `user_id = req.user.id`, else 404).

**Job runner:** `POST /assessments/job-assessment/:id/exit`
Body: `{ attemptId, action: 'save' | 'submit' | 'abandon', draft?: { questionId, answer } | null, reason?: 'candidate' | 'fullscreen_second_exit' }`
Ownership + `due_date` 410 guard exactly as the job `/answer` handler.

Responses share one shape: `{ status: <resulting attempt status>, answersGiven: <n>, totalQuestions: <m> }`, or `409 { error: 'This attempt is already finished', code: 'ALREADY_FINISHED' }` when the attempt was already terminal (the wording every surface reuses — `respondAfterRecord` already returns this copy for the same situation).

---

## 4. Attempt-state transitions — exact, per outcome

### 4.1 Skill runner (`assessment_sessions`)

| Outcome | Transition (all status writes are atomic claims) | Answers | Score path | Afterwards |
|---|---|---|---|---|
| Continue Test | None. `in_progress` → `in_progress`. | Untouched; client draft untouched. | — | Same question, draft intact, timer resumes (§5.3). |
| Save & Exit | None — status STAYS `in_progress`. Server persists the draft if supplied (§8) and returns `answersGiven`. The client then navigates to the Assessments list. | Saved answers unchanged; current draft stored-but-not-answered (§8). | None. | List shows the attempt **In progress** with **Resume** (the Phase A list already renders a Resume action for resumable sessions, `assessments.tsx` ≈L156 — reuse, keyed on `in_progress`). Resume = `GET /session/:sessionId/current`, §8.2. Repeatable any number of times. |
| Submit & Exit | Atomic claim via the EXISTING `completeAssessmentTx` → `completeAssessment` claim (`UPDATE … SET status='completed' WHERE status='in_progress'`). Loser of a race gets the existing completion back (`alreadyCompleted`) or honest `null`. | Saved answers only; the current draft is NOT submitted (the dialog copy for Save vs Submit makes the draft rule visible: the draft is submitted only by pressing Next). | The EXISTING completion path — subject in full to the §11 gate for partial attempts. Post-commit OmniScore feed + audit fire exactly once, as today, only if the §11 ruling makes this attempt eligible. | Results view (same as Finish). Attempt can never resume: `/current` returns the `completed` payload. |
| Exit Exam | NEW atomic claim, the mirror image of completion: `UPDATE assessment_sessions SET status='abandoned', completed_at=NOW() WHERE id=$1 AND status='in_progress' RETURNING id`. Rowcount 0 → 409 ALREADY_FINISHED. Runs in its own transaction; writes NOTHING else — no `skill_assessments` row, no evaluation call, no OmniScore call, no audit `assessment_graded`. One `assessment_events` row: `exit_exam`. | `answers_given` left exactly as recorded — retained on the session row for audit. Never read by any scoring path (every scoring/results query keys on `skill_assessments` rows or `status='completed'`). | **No score exists.** No row, no number. `assessment_sessions.score` (the running-points column, `DEFAULT 0`) is an internal accumulator and MUST NOT be surfaced for an abandoned session on any surface — `/current` already returns no score for non-completed statuses; the build must keep it that way and JT-B4 asserts it. | Candidate sees "Exited — not scored" (§9.1). Attempt cannot be resumed or converted (`/current` returns `{status:'abandoned'}`; `/answer` already 400s on non-`in_progress`). A fresh attempt of the same skill starts normally — D3: no lockout row exists to block it, and `/start`'s existing abandon-previous behaviour is irrelevant (this session is already terminal). |
| Full-screen 2nd exit | The Submit transition above with `reason='fullscreen_second_exit'` (§5.2). | Saved answers only. | As Submit & Exit, incl. §11 gate. | Results view with the auto-submit statement (§9.2). |

### 4.2 Job runner (`job_assessment_attempts`)

Same four outcomes, mapped onto this runner's lifecycle (`assigned` → `in_progress` → terminal):

| Outcome | Transition | Notes |
|---|---|---|
| Continue Test | None. | Whole-exam + per-question timers resume (§5.3). |
| Save & Exit | Status stays `in_progress`; draft persisted (§8). | Resume re-enters via the existing start/adopt path (`POST /job-assessment/:id/start` finds the `in_progress` attempt). An attempt still in `assigned` was never started — Exit does not exist pre-start, so no `assigned`-state exit case exists. |
| Submit & Exit | NEW atomic claim: `UPDATE job_assessment_attempts SET status='completed', completed_at=NOW() WHERE id=$1 AND status='in_progress'`; on a won claim, fire the EXISTING async `scoreAttempt(attemptId, assessmentId)` exactly once (post-commit, `.catch` logged — the pattern the last-answer path already uses). The candidate lands on the existing score-polling view (`GET /assessments/attempt/:attemptId/score`). | Partial-attempt eligibility for scoring is the §11 gate, same as the skill runner. The separate scoring step is never invoked for an abandoned attempt. |
| Exit Exam | NEW atomic claim: `UPDATE … SET status='abandoned', completed_at=NOW() WHERE id=$1 AND status='in_progress'`. Legal value today (§2) — this is the first write of it. `scoreAttempt` is NOT called; `composite_score` stays NULL (never 0); no `job_applications.assessment_score` write occurs (that write lives inside the scoring path ≈L2935, which is never entered). | Recruiter surfaces read "Candidate exited — not scored" (§9.3, JT-B10). |
| Full-screen 2nd exit | Submit transition with `reason='fullscreen_second_exit'`. | As above. |

**Due-date interaction (job runner):** an `in_progress` attempt past its `due_date` already 410s on answer/score paths. Exit actions on such an attempt: Save & Exit is refused 410 (there is nothing resumable — the assignment expired); Submit & Exit and Exit Exam remain allowed (both are terminal housekeeping on work already done; refusing them would strand the attempt in `in_progress` forever). The attempt is NOT auto-flipped to `expired` by the exit endpoint — expiry status writes stay with the existing paths.

### 4.3 Exactly-once, across every terminal path

After Phase B there are five terminal triggers on the skill runner (Finish via `/answer`, timer-zero on the last question via `/answer`, Submit & Exit, full-screen auto-submit, Exit Exam) and four on the job runner. The invariant is one sentence: **an attempt leaves `in_progress` exactly once, by exactly one atomic status-guarded UPDATE, and every loser of that race receives ALREADY_FINISHED (or the winner's existing result), never a second transition.**

- Skill runner: completion already satisfies this (Phase A claim). The abandon claim in §4.1 uses the identical shape, so completion-vs-abandon races resolve by rowcount — an attempt can never be both `completed` and `abandoned` (JT-B7).
- Job runner: the abandon and submit claims use the identical shape, AND the existing last-answer completion (≈L2623, plain UPDATE) must be converted to the same guarded claim in the Phase B build — otherwise last-answer-vs-exit races reintroduce the double-transition Phase A eliminated on the other runner. This is a named build task, not an optional tidy-up.
- Client: the existing `submitting` in-flight disable is extended to every exit action and to the full-screen auto-submit trigger; a second trigger while one is in flight is a no-op on the client and ALREADY_FINISHED on the server if it ever arrives.

---

## 5. Full-screen policy — state machine

### 5.1 States and transitions (client, per attempt)

```
NOT_STARTED ──Start click──▶ FS_REQUESTED ──granted──▶ IN_FULLSCREEN (exitsUsed=0)
                                  │refused/unsupported──▶ NO_FS_MODE (event logged, test runs)
IN_FULLSCREEN ──fullscreenchange: exited──▶ FIRST_EXIT_WARNING (exitsUsed=1, timers paused)
FIRST_EXIT_WARNING ──"Return to full-screen"──▶ IN_FULLSCREEN (re-request; timers resume)
FIRST_EXIT_WARNING ──opens Exit dialog──▶ (dialog rules, §3; a Save/Exit Exam outcome ends the attempt — no auto-submit, the candidate chose)
IN_FULLSCREEN ──fullscreenchange: exited, exitsUsed=1──▶ AUTO_SUBMITTING ──▶ RESULTS (auto-submit statement)
NO_FS_MODE ──(no exits can occur)──▶ test runs to normal outcomes; Exit dialog fully available
```

Rules:

- **Entry:** `document.documentElement.requestFullscreen()` is called from the Start click handler on the instructions screen (the click is the user gesture the browser requires — PRD §5 step 2). If the promise rejects or `document.fullscreenEnabled` is false: log `fullscreen_unavailable`, enter NO_FS_MODE, show a one-line notice ("Your browser could not enter full-screen. The test will continue normally."), never block or penalise (PRD §6.2).
- **What counts as an exit:** a `fullscreenchange` event where `document.fullscreenElement` becomes null while the attempt is `in_progress` and the runner did not itself exit full-screen as part of a terminal navigation (Save & Exit / Submit & Exit / Exit Exam / Finish all set a `leavingIntentionally` flag BEFORE calling `document.exitFullscreen()` / navigating, and the handler ignores exits under that flag). Browser-chrome exits (Esc long-press, F11, OS gestures) all surface as the same event — no distinction is needed or attempted.
- **First exit:** show the warning as a modal (focus-trapped, `role="alertdialog"`), pause timers (§5.3), log `fullscreen_exit_first` (§7). Copy in §9.2. The only actions: **Return to Full-Screen** (primary) and **Review your options** (opens the §3 dialog — leaving via a chosen outcome from here is a choice, not a second exit).
- **Second exit:** no warning, no dialog. The client immediately calls the exit endpoint `{action:'submit', reason:'fullscreen_second_exit'}` (saved answers only — the unsaved draft is excluded, exactly as disclosed), exits to the results view on the response. If that call fails (network), §6.2's retry rule applies — the attempt is NOT left in a limbo the candidate cannot see.
- **Counter scope:** `exitsUsed` is per attempt, held in client state AND derivable from the event log (`fullscreen_exit_first` rows) — on a mid-test refresh/resume, the runner restores `exitsUsed` from the session payload (the build adds the count of prior `fullscreen_exit_first` events to the `/current` response, §7.3) so a refresh cannot reset the two-exit allowance.

### 5.2 The auto-submit flag

The attempt must carry, durably, that it was auto-submitted after two full-screen exits, and how many answers were saved:

- Skill runner: at completion with `reason='fullscreen_second_exit'`, `completeAssessment`'s existing `behavioral_flags` JSONB on the inserted `skill_assessments` row gains `{ fullscreen_auto_submit: true, answers_given: <n>, total_questions: <m> }` (the object already carries `tab_switches` etc. — same home, no new column). The event log holds the two `fullscreen_exit_*` rows as the audit trail.
- Job runner: the same marker goes into the attempt's new `completion_flags` JSONB (§8.3) — this runner has no `behavioral_flags` equivalent.
- The results views read the flag and render the §9.2 statement. A flag absent = a normal submission; the statement never renders without the flag (no false claims either direction).

### 5.3 Timer pause semantics

- **Skill runner:** the per-question timer is a client `setInterval` countdown (`assessment-take.tsx` ≈L270). Pausing = clearing the interval with `timeLeft` preserved; resuming = restarting the interval from the preserved `timeLeft`. It is NEVER reset to the full per-question limit on resume-from-pause (that would gift time), and the question does not auto-submit while paused — the interval is the only auto-submit driver, and it is stopped. Pauses: Exit dialog open (§3.1), first-exit warning shown. The 30 s dialog auto-resume (D6) bounds dialog pauses; the warning has no auto-resume (the candidate must act), but the question cannot expire underneath it.
- **Job runner:** the per-question timer behaves identically. The whole-exam timer is wall-clock (`startedAt + timeLimitMinutes`) and CANNOT be paused by stopping an interval — so pause credit is accounted server-side: the client logs `timer_pause_start` / `timer_pause_end` events (§7.2); the server-side deadline checks (the `/answer` and converse handlers' elapsed-time guards) compute elapsed as `now − started_at − Σ(pause intervals)`, with each interval taken from SERVER receipt timestamps of the two events, a single interval capped at 300 s credited (a candidate who walks away from a warning for an hour is credited 5 minutes and the excess is visible in the event log for human review — observational, D5, never an automatic verdict). The client countdown display applies the same credited total so what the candidate sees and what the server enforces agree.
- Timer-zero racing a pause is resolved in §6.3.

---

## 6. Edge cases

### 6.1 Network loss mid-exit

- **Save & Exit with no network:** the draft/exit call fails → the candidate stays IN the test, draft intact on screen, with a plain error ("We couldn't save right now — check your connection and try again. Your answers so far are already saved.") and a Retry. The client must not navigate away on an unconfirmed save. Nothing about the attempt changed server-side.
- **Submit & Exit / Exit Exam with no network:** same rule — no navigation, no local "pretend terminal" state. The attempt is still `in_progress` server-side; Retry re-sends the same action. Because both transitions are atomic claims, a retry after the first request secretly succeeded returns the terminal result / ALREADY_FINISHED, and the client treats that as success and navigates to the correct end state (results for submit; "Exited — not scored" for abandon). A request can therefore be retried blindly and safely.
- **Full-screen second exit with no network:** the auto-submit call fails → the candidate is shown the §9.2 failure notice with a **Submit now** retry action (they are already out of full-screen; there is nothing to return to). The attempt remains `in_progress` with all saved answers intact until a submit lands — it is never auto-abandoned as a fallback.
- **Answer in flight when Exit is chosen:** Exit actions are disabled while an `/answer` submission is in flight (`submitting`), and the exit endpoint's transitions read only RECORDED answers — an answer the server has not recorded is not "saved", and no exit outcome may claim it was.

### 6.2 Timer-zero racing an exit

- The per-question auto-submit fires from the timer interval; the interval is stopped the moment the dialog/warning opens (§5.3), so timer-zero cannot fire while a choice is being made.
- If timer-zero and an exit action land in the same tick (interval callback already queued): the answer submission and the exit transition serialise on the server. On the skill runner the answer records under the session row lock and completion/exit claims are atomic — whichever terminal claim wins, the other returns ALREADY_FINISHED and the client follows the server's resulting status, not its own intention. On the job runner the same holds once §4.3's claim conversion lands.
- Timer-zero on the LAST question is a completion trigger identical to Finish (Phase A behaviour) — if the candidate had the dialog open at that moment it cannot happen (timer paused); if it fires first, the dialog's actions then meet a `completed` attempt and the client shows the results view instead of an error.

### 6.3 Refresh / crash mid-test

Resume via `/current` (skill) or start/adopt (job) restores: current question (re-served), recorded answers count, the saved draft (§8.2), and `exitsUsed` (§5.1). Full-screen is re-requested on the resume Start action (a fresh user gesture), and re-entry after resume does not itself count as an exit.

### 6.4 Other edges, stated once

- **Exit before question 1 renders** (session created, question unavailable — Phase A 503 state): the runner is not in the test; Exit does not exist there. The list's Resume path already covers the saved attempt.
- **Double-clicking any dialog action:** in-flight disable + atomic claims (§4.3).
- **Abandon after a Save & Exit:** fully allowed — resume, open Exit, Exit Exam. The saved draft is discarded with the attempt (retained on the row for audit, never surfaced).
- **Recruiter assigns, candidate abandons, recruiter re-assigns:** re-assignment creates a NEW attempt row via the existing assignment paths; the abandoned row is untouched history. D3 governs the skill runner; for assigned assessments, whether a recruiter re-assigns is the recruiter's existing choice, not a candidate lockout.
- **Conversational mode (job runner):** §9.3 scope line.

---

## 7. Integrity-event usage

### 7.1 Skill runner — `POST /assessments/event`, zero server change to record

`event_type` is unconstrained `VARCHAR(50)` and the handler inserts any type (§2). New types, all with `event_data` carrying `{ answersGiven }` where relevant:

| event_type | When |
|---|---|
| `fullscreen_entered` | Full-screen granted on Start / resume / return-from-warning |
| `fullscreen_unavailable` | Browser refused/unsupported on Start |
| `fullscreen_exit_first` | First exit (warning shown) |
| `fullscreen_exit_second` | Second exit (auto-submit triggered) |
| `exit_dialog_opened` | Dialog opened (from Exit button or from the warning) |
| `exit_dialog_timeout_resume` | 30 s no-choice auto-resume |
| `exit_save` / `exit_submit` / `exit_exam` | The chosen outcome (mirrors the exit endpoint call; the endpoint ALSO writes `exit_exam` server-side per §4.1 so the abandon record does not depend on a client post) |
| `timer_pause_start` / `timer_pause_end` | Whole-exam accounting is job-runner-only; on this runner pauses are per-question client behaviour — these two types are logged here too, for one consistent vocabulary, but drive no server computation |

No counters are added for the new types (the `tab_switches`-style counter columns stay as they are); counts are derived from the event rows when read.

### 7.2 Job runner — `POST /assessments/job-assessment/:id/event`, explicit extension (required)

Today this endpoint silently drops every type except `tab_switch` / `copy_paste` while returning `{logged: true}` (PRD §4 caveat — a dropped full-screen event is a false `{logged: true}`). The build extends it to: accept the same vocabulary as §7.1, persist each event (server timestamp) into the attempt's new `integrity_events` JSONB (§8.3), keep the existing two counters working, and return `{logged: true}` ONLY for a type it actually recorded — an unrecognised type returns `400 { error: 'Unknown event type' }` so a client bug can never masquerade as a logged event again on this endpoint. The pause-credit computation (§5.3) reads `timer_pause_*` pairs from this store.

### 7.3 Read-back

`GET /assessments/session/:sessionId/current` gains two fields on the `in_progress` payload: `currentDraft` (§8.2) and `fullscreenExitsUsed` (count of `fullscreen_exit_first` events for the session). The job start/adopt response gains the same two fields from `integrity_events`. No new read endpoints.

---

## 8. Data model

### 8.1 What needs NO migration

- `assessment_sessions.status` already allows `abandoned` (migration 274). `job_assessment_attempts.status` already allows `abandoned` (047 + p4). **The abandon outcome needs no schema change on either runner.**
- Full-screen flag on skill completions reuses `skill_assessments.behavioral_flags` JSONB (§5.2). Integrity events reuse `assessment_events`.
- No status values are added, removed, or renamed anywhere. No table is dropped, no column is dropped or retyped.

### 8.2 Draft persistence (the one genuinely new datum — PRD §6.1 assigns this design to Rex)

A current-question draft is **stored-but-not-answered**: persisted server-side at Save & Exit (and at a full-screen first-exit warning? No — the warning does not end the session; the draft stays in client state there. Draft persistence happens ONLY at Save & Exit, the one outcome that leaves the runner).

- New nullable column on BOTH attempt tables: `current_draft JSONB` — shape `{ questionId, answer, savedAt }`. NULL = no draft.
- Written by the exit endpoint on `action:'save'` (overwrites any prior draft — there is only ever one current question). Cleared (set NULL) when: that question is answered via `/answer` (the answer handler clears it when the recorded answer's question matches the draft's), the attempt reaches any terminal state, or a new question is served after resume-and-Next.
- Restored by the resume reads (§7.3): the runner renders the draft onto the re-served question client-side; it is NOT in `answers_given` / `answers`, is never evaluated, and does not move the question index (JT-B2a asserts exactly this).
- A draft is the candidate's own unsubmitted work: it is never shown to recruiters, never scored, and on abandon it simply remains on the row with the retained answers (audit only).

### 8.3 Job-runner completion flag + event store

`job_assessment_attempts` gains: `completion_flags JSONB NOT NULL DEFAULT '{}'` (the §5.2 auto-submit marker) and `integrity_events JSONB NOT NULL DEFAULT '[]'` (§7.2 store). The skill runner needs neither (events table + `behavioral_flags` already exist there) — the asymmetry is deliberate reuse of what each runner already has, not inconsistency of behaviour: the candidate-facing policy is identical.

### 8.4 Migration — one, expand-only

ONE new migration (next number after 275: **276**), expand-only, following the migration-274 pattern:

```sql
ALTER TABLE assessment_sessions    ADD COLUMN IF NOT EXISTS current_draft JSONB;
ALTER TABLE job_assessment_attempts ADD COLUMN IF NOT EXISTS current_draft JSONB;
ALTER TABLE job_assessment_attempts ADD COLUMN IF NOT EXISTS completion_flags JSONB NOT NULL DEFAULT '{}';
ALTER TABLE job_assessment_attempts ADD COLUMN IF NOT EXISTS integrity_events JSONB NOT NULL DEFAULT '[]';
```

- **Expand→migrate→contract (Sumanth's Q6 ruling, 2026-10-19):** this migration is pure EXPAND — new nullable/defaulted columns, no constraint changes, no data movement, nothing contracted. It is safe on the shared staging/production database while old code is still running (old code ignores the columns). No contract step exists for this feature; if a future change ever removes these columns, that is a separate, separately-ruled migration.
- `down()` drops the four added columns and nothing else; it is data-losing by definition (drafts/events written since up) and must be labelled as such in the migration header, per the 274 precedent of recording contraction behaviour honestly.
- The build's STOP 1 includes the ecc database-reviewer on this migration (the Phase A #1612 pattern), and the fresh-install rig must build it from empty via `migrate.js` like every migration.

---

## 9. Honest UI copy — instructions screen and end states

### 9.1 Instructions screen (shown before Start, both runners — PRD §5 step 2)

A dedicated instructions view replaces today's start-in-place flow (skill list Start and job runner start both route through it). It states, in plain words, before the Start button:

> **Before you start**
> - This test has **{M} questions**. You have **{per-question time} per question**. When a question's time runs out, that question is submitted with the answer you have chosen — or recorded as unanswered — and the test moves on.
> - **This test runs in full-screen.** Leaving full-screen once shows a warning and pauses your timer. **Leaving a second time submits your test immediately**, using only the answers you have already saved.
> - **You can leave at any time with the Exit button.** You can save and resume later, submit the answers you have saved so far, or exit the exam without a score. Nothing about leaving is hidden — each option explains itself before you choose it.
> - Short answers are scored by AI and reviewed by a human. *(existing disclosure, kept)*

Start button label: **Start Test** (job runner, whole-exam variant adds: "You have **{timeLimitMinutes} minutes** in total, shown by the countdown at the top."). The Start click is the full-screen gesture (§5.1). Rules that are not on this screen may not be enforced mid-test (PRD §8.3) — any policy change updates this copy in the same PR.

### 9.2 Full-screen warning and results statements

First-exit warning: **"You left full-screen."** / "Your timer is paused. Return to full-screen to continue. If you leave full-screen again, your test will be submitted with the answers saved so far — {n} of {M} questions answered." → [Return to Full-Screen] [Review your options]

Auto-submitted results statement (only when the §5.2 flag is set): **"Submitted automatically after leaving full-screen twice. {n} of {M} questions answered."**

Auto-submit network-failure notice (§6.1): **"We couldn't submit your test — check your connection."** / "Your saved answers are safe. Use Submit Now to finish." → [Submit Now]

### 9.3 End states and other surfaces

- Abandoned, candidate (list + results area): **"Exited — not scored"**, no number, no percentage, no pass/fail wording anywhere (JT-B4). The attempt does not appear in My Results as a scored entry.
- Abandoned, recruiter (assigned): **"Candidate exited — not scored"** — never a zero, never a fail, excluded from scored-results and ranking views (JT-B10).
- Scope line, conversational mode (job runner): the Exit dialog and its four outcomes apply (they are attempt-level and use the same endpoint); the full-screen policy and per-question pause semantics apply to the question flow only in Phase B. Conversational turns have no per-question timer today; full-screen enforcement for conversational mode is a named follow-up issue, not a silent omission (PRD §4 required this to be stated, one way or the other).
- Aptitude runner: out of Phase B scope (FR-B4's conditional) — named follow-up, same reasoning as PRD §9; the dialog/endpoint pattern here is designed to be liftable to it unchanged.

---

## 10. Journey-test mapping (PRD §10 — Quinn + Candidate Experience author the suites; this is the design contract they test against)

| Test | What it asserts | Design sections |
|---|---|---|
| JT-B1 | Exit → Continue returns to the same question, draft intact | §3.1, §4.1 |
| JT-B2 | Save & Exit → list shows In progress + Resume; resume returns to first unanswered question, prior answers locked/counted; resume does NOT trigger the new-start abandon rule (it is the same session via `/current`, never a `/start`) — this resolves the question PRD §10 JT-B2 deferred to this design | §4.1, §7.3 |
| JT-B2a | Draft selected/typed but Next never pressed → Save & Exit → Resume lands on that question with the draft present, still unanswered (not evaluated, index unchanged); Next then submits it exactly once | §8.2 |
| JT-B3 | Submit & Exit → results scored from saved answers **as ruled by the §11 gate**; attempt cannot resume | §4.1, §11 |
| JT-B4 | Exit Exam → confirm "will NOT be marked" → "Exited — not scored", no number on list/results/profile; **and a fresh attempt of the same skill starts immediately (D3 — unconditional since Sumanth's 2026-10-21 ruling; this supersedes the conditional form in PRD §10)** | §4.1, D3 |
| JT-B5 | Instructions (timer, full-screen, exit consequences) shown before question 1; Start enters full-screen | §5.1, §9.1 |
| JT-B6 | First full-screen exit → warning, timer paused, re-entry continues with no answers lost; second exit → saved answers submitted exactly once; results state the auto-submit + N of M answered | §5.1–5.3, §9.2 |
| JT-B7 | No sequence (double-clicks, dialog + full-screen exit combined, refresh mid-dialog) yields a duplicate submission or an attempt both completed and abandoned | §4.3, §6 |
| JT-B8 | Job runner: all four outcomes, incl. abandon as a NEW write on `job_assessment_attempts`; Submit & Exit hands to the score step exactly once | §4.2 |
| JT-B9 | Job runner: full-screen policy incl. whole-exam timer pause credit; full-screen events evidenced as RECORDED by the extended event endpoint (row present in `integrity_events`), not merely posted | §5.3, §7.2 |
| JT-B10 | Recruiter view of an abandoned assigned attempt: "Candidate exited — not scored", no zero/fail, absent from scored/ranking views | §4.2, §9.3 |

All tests run on the fresh-install dev rig (HL-003): real HTTP, real DB built by `migrate.js` only, resulting state read back — for JT-B4/B8 including a direct read that no `skill_assessments` row / no `composite_score` exists for the abandoned attempt.

---

## 11. ⛔ GATE — Partial Terminal-Submission Scoring (owner: Rex; ruling: Sumanth) — the ONE open question

Phase B creates terminal submissions of PARTIAL attempts (Submit & Exit mid-test; full-screen second-exit auto-submit). `completeAssessment` today assumes a full attempt: `max_score` hard-coded 100, `passed` at ≥ 60, Verified badge on pass, OmniScore feed after commit. Applying that unchanged to a 3-of-10 submission fabricates a comparable score from an incomparable attempt (PRD §8.1 violation). **Until Sumanth rules, Phase B builds may ship: the dialog, Continue, Save & Exit + draft + resume, Exit Exam, the full-screen state machine, event logging, and the job-runner claim hardening — but no partial terminal submission may be scored, passed, Verified, or fed to OmniScore.** (A full attempt — all questions answered — reaching Submit & Exit is an ordinary completion and is not gated.)

The three decisions, with the options as Rex frames them (team discussion with Lead + Scout + Candidate Experience precedes Sumanth's ruling per HL-004; no recommendation is asserted here solo):

1. **Score expression for a partial completion** — (a) against questions answered only (e.g. 3/3 correct shows as a score of those 3, labelled partial), (b) against the full 100 (unanswered = not correct), or (c) no number at all — "Submitted early — {n} of {M} answered", evaluation recorded but no headline score.
2. **Pass / Verified eligibility** — can a partial submission ever be `passed`, and can it ever set the Verified badge?
3. **OmniScore eligibility** — may a partial submission feed OmniScore at all, and if so under what conditions?

This gate is the only item in this design requiring a Sumanth ruling. Everything else is decided by D1–D6, the PRD, or this design.

---

## 12. Specialist decision (mandatory record)

- **Candidate Experience (hiring-pack persona) — REQUIRED before build.** The exit dialog and instructions screen are pure candidate-journey surfaces: consequence copy (§3.2, §9), the Exit Exam confirmation friction, and the resume expectation (JT-B2/B2a) must be reviewed against how a stressed mid-test candidate actually reads them. Reason: domain fit — this persona owns the candidate journey; Rex owns the state machine, not the reading experience.
- **Accessibility — ecc/a11y-architect (or agency design accessibility reviewer) — REQUIRED before build.** Full-screen is an accessibility-sensitive mechanism: focus trapping in both modals, Esc behaviour (the browser reserves Esc for full-screen exit — keyboard and switch-device users exit full-screen differently and must not be pushed to a second-exit auto-submit by an assistive-technology artefact), screen-reader announcement of the warning and of timer pauses, and a non-full-screen path (NO_FS_MODE) that is a first-class equivalent, not a degraded one. Reason: risk domain of the change — §5's state machine is exactly where an a11y defect becomes an unfair auto-submit.
- **ecc database-reviewer — REQUIRED at the build's STOP 1** for migration 276 and the job-runner claim conversion (§4.3), following the Phase A #1612 pattern (Rex + database-reviewer, Option B precedent). Reason: shared-DB expand-only discipline + the deadlock class Phase A already hit once in this exact file.
- **Considered and NOT used:** security-reviewer — no new auth surface (both new endpoints reuse existing ownership guards verbatim; no new data exposure — drafts are owner-only and never recruiter-visible). ecc code-reviewer / requesting-code-review apply at build PR time as standard, not as design specialists. A generic UX/design review beyond Candidate Experience + accessibility was considered and skipped as duplicative for two modal surfaces whose copy is already fully specified here.

## 13. Build shape (for Lead's sprint planning — not part of this design's approval)

One Phase B story per runner would re-split the unified design; Rex's recommendation to Lead: ONE story for the shared dialog + exit endpoint + full-screen machine on the skill runner (incl. migration 276, instructions screen, JT-B1–B7), ONE story for job-runner parity (endpoint, claim conversion, event extension, JT-B8–B10), sequenced skill-first so the pattern is proven before it is ported. Both stories carry the §11 gate as an explicit blocker on their scoring acceptance criteria only.

— Rex
