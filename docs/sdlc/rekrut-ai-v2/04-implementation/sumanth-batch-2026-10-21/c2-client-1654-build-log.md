# C2 (client) build log — #1654, story C2 of the #1603 Assessments redesign

Branch `nova/1654-c2-client` (stacked PR 2 of 2; the server is PR #1675,
merged — neither PR closes #1654 alone, STOP 1 Q6). Base: dev `892b5a81f`.
Local-only build (HL-007): no GitHub writes from the worker; the parent
lands the PR.

> **Consolidation note (#1679 item 8, 2026-10-22):** this file is now the
> SINGLE C2 client build log. The second log that shipped alongside it —
> `docs/sdlc/rekrut-ai-v2/04-implementation/assessments-c2-client-1654-build-log.md`
> (the parent-landed round-1 summary) — has been DELETED because the two
> contradicted each other on the SETS-400 behaviour: its D2 rationale
> claimed "the session IS committed server-side before the 400". That is
> false. **Server truth (verified first-hand in `routes/assessments.js`,
> POST /start configured branch, dev 122587d20): a `setId` in the start
> body returns `400 SETS_NOT_AVAILABLE` immediately after
> `await client.query('ROLLBACK')` and BEFORE the session INSERT — no
> session is created, committed, or stranded, so there is nothing to
> resume.** This log's GAP-2 addendum (below) already stated that
> correctly and is the surviving account; the round-1 D1/D2/D3 deviation
> framing in the deleted log is superseded by the GAP addendum and the
> fix-round record in this file.

## What was built (client only)

1. **`client/src/pages/candidate/assessment-configure.tsx` (new)** —
   `AssessmentConfigureFlow`, the candidate-facing flow in the STOP 1
   order: **configure → pre-flight → instructions → start**.
   - Configure: topic (chosen on the catalogue cards), format
     (Mixed / Multiple choice / Short answer / Coding), difficulty band
     (Easy / Medium / Hard), question count (10/25/50/100 — the enum
     governs the choice UI, §4.2/Q1).
   - Pre-flight: `GET /assessments/catalog/:topicId/availability?format=&band=&count=`
     re-runs on every choice change and renders exactly what start will
     serve. Servable ≥ chosen → "We can serve exactly N questions for
     this configuration." Servable < chosen (and > 0) → the server's
     reason verbatim plus the **labelled** offer "Use N questions
     instead" (N = the response's `largestAvailable`); there is no
     Continue action at the unservable count, and accepting the offer
     re-pre-flights at N — the smaller count is never silently
     substituted. Servable = 0 → the server's honest reason and no start
     path at all (JT-C4). A failed pre-flight read shows a retryable
     honest message, never a fabricated count.
   - Instructions (BEFORE start, §4.5): subject · topic, format, the
     exact count, the band with its disclosed level range ("Medium —
     questions adapt between levels 2 and 4", §5.2), the expected
     duration (count × the runner's 120s per-question budget, stated as
     an up-to figure), and the headline full-screen/exit disclosure.
     **Coexistence:** the Phase B post-start instructions gate in
     `assessment-take.tsx` is untouched — this screen says plainly that
     the full rules appear again before the first question.
   - Start: `POST /assessments/start` with the exact configured body
     `{ topicId, format, difficultyBand, totalQuestions }` (camelCase —
     verified against `routes/assessments.js` on dev, not the summary),
     then the existing sessionStorage hand-off + navigation into the
     runner, identical to the legacy path.
   - Start failures keep the Phase A/B contract: a 503
     `QUESTION_UNAVAILABLE` shows the server's message, a **Resume
     attempt** action when the extended body carries `sessionId` (the
     session is committed/resumable server-side), and the labelled
     smaller-count offer when it carries `largestAvailable` — offered,
     never auto-retried (pinned by test: exactly one start call).
2. **`client/src/pages/candidate/assessments.tsx`** — the Available tab
   now renders the C1 catalogue (`GET /assessments/catalog`): subjects →
   topics with real availability ("Up to N questions available" from the
   API's `maxCount`), subject-level progress, and a Configure & Start
   action only for topics whose `available` flag is true. A topic below
   the §7 floor renders the honest state ("No questions available for
   this topic yet — only N approved so far, not enough for a test
   yet.") with **no** action; a topic-less subject and an empty
   catalogue render honest empty states (JT-C4). If the catalogue read
   fails, the tab falls back to the legacy `/available` list and its
   legacy start (dual-read safety, design §6 step 3) — the legacy path
   is otherwise unchanged, as are the Assigned and Results tabs.
3. **`client/src/lib/api.ts`** — `apiCall`'s thrown-error preservation
   gains `promised` and `largestAvailable` (numbers only, same pattern
   as the existing `sessionId`/`retryable` preservation), so the start
   503's extended fields actually reach the client. No other behaviour
   changes.

No new dependencies; no server changes; no migration.

## Journey tests (red-first)

- New suite `client/src/pages/candidate/assessment-configure-1654.test.tsx`
  (7 tests, JT-C1 + JT-C4): **RED** on pristine dev — the suite cannot
  resolve `./assessment-configure` (the flow does not exist), 0 tests
  run, 1 failed suite (`evidence-1654c/red-1654c.log`). **GREEN 7/7**
  after the build (`evidence-1654c/green-1654c.log`). apiCall is mocked
  at the network boundary per the repo's client-test pattern; the
  payloads asserted are the real merged server contracts. Per HL-003
  these are regression pins, NOT the E2E-on-dev gate.
- Real-HTTP harness for Quinn's fresh-install rig:
  `e2e/journeys/assessment-c2-config.js` (Phase A pattern) — rig-seeds
  the Git topic, then JT-C1 (catalogue → pre-flight → configured start →
  session snapshot read back from the DB), JT-C4a (count 100: pre-flight
  reason + start 503 `{promised, largestAvailable}` + session still
  `in_progress`), JT-C4b (explicit non-enum `largestAvailable` start is
  accepted; BLOCKED-honest if the bank's servable lands on an enum),
  JT-C4c (coding flag-off 503 + `setId` 400 `SETS_NOT_AVAILABLE`).
  **Not run by this build** — it needs the parent/Quinn rig (server +
  fresh DB); JT-C1/JT-C4 closure still requires that capture.

## Regressions (individual runs; combined jest runs cross-contaminate)

- Server (untouched code; baseline = pristine-dev figures from the C2
  server build log): catalog-1653 **18/18**, config-1654 **24/24**,
  boilerplate-1573 **6/6** — identical after (`evidence-1654c/regression-server.log`).
- Client: new suite 7/7; `apiRetryableError` 5/5 and `apiCallPathGuard`
  (incl. the repo-wide `/api/`-prefix scan) pass — 22/22 across the
  three files run. Biome check on all four changed client files: clean.
  `tsc --noEmit`: no errors in the changed files.

## Deviations / notes

- The task summary described the start body with snake_case keys; the
  merged server actually accepts camelCase (`topicId`, `format`,
  `difficultyBand`, `totalQuestions`) and the pre-flight query is
  `?format=&band=&count=`. The client follows the code (verified
  first-hand in `routes/assessments.js` @ `892b5a81f`).
- Q5 (score normalisation) was server-side only in PR #1675; the client
  already renders the percentage + configuration-independent score from
  the results payload, so no client change was needed.
- Coding appears in the format picker; with the flag OFF its pre-flight
  honestly returns servable 0 with the coding reason, so it renders the
  JT-C4 empty state and can never start — no silent substitution.

## Addendum — Candidate Experience / design-ux GAP-1…GAP-6 (second commit)

Implemented: GAP-1, GAP-2, GAP-3, GAP-4, GAP-6 + plain-language band
copy. Tests: `assessment-configure-1654.test.tsx` grows to 9 (GAP-2,
GAP-6 added) and new `assessment-take-1654.test.tsx` adds 6 (GAP-3 ×2,
GAP-4 ×4) — RED 6 failed / 9 passed before the addendum build, GREEN
30/30 across the four client files run (incl. api-lib suites);
`evidence-1654c/red-addendum.log` / `green-addendum.log`. Server
regressions unchanged (catalog 18/18, config 24/24, 1573 6/6).

- **GAP-1 — implemented as specified.** The promise is never derived
  from the catalogue list: Start is reachable only after the per-topic
  availability endpoint confirms the candidate's actual chosen
  {format, band, count}; the returned `reason` renders verbatim when
  servable < promised; the only alternative count offered is the
  labelled `largestAvailable`. (Precision note: the list's
  `availability.available` is the §7 floor — maxCount ≥ 10 across ALL
  configurations, `computeTopicAvailability` in routes/assessments.js —
  not a "default config" figure; the client treats it only as "this
  topic may be configurable", never as a promise.)
- **GAP-2 — implemented.** The start handler branches explicitly on
  `code === 'SETS_NOT_AVAILABLE'` (400): a dedicated state — "sets are
  not available yet… No attempt was created" — with no Resume/offer
  affordance, because that 400 rolls back before any session exists
  (routes/assessments.js /start configured branch). The client never
  sends `setId` today; the branch is pinned by test so a future set UI
  cannot fall into the generic path. Other non-OKs keep their fields:
  `apiCall` preserves `code`/`status`/`sessionId`/`promised`/
  `largestAvailable` on the thrown error.
- **GAP-3 — implemented.** `assessment-take.tsx`: a session WITH a
  configuration snapshot renders the snapshot instructions block (chosen
  configuration in plain language + the same rule disclosures and
  full-screen Start/opt-out as the gate); a session WITHOUT one renders
  the Phase B gate. Exactly one block in every state. Snapshot sources:
  the configure flow's sessionStorage hand-off (`config` added) and the
  server's `format`/`difficultyBand` fields on `/session/:id/current`
  (in_progress branch) for refresh/resume. Legacy starts store no
  config and have NULL snapshot fields → Phase B gate, unchanged.
- **GAP-4 — implemented against the REAL response fields; two premise
  conflicts flagged:** (a) the field is `answersGiven`, not
  `answeredCount` (both /current branches; the take page already used
  it) — the partial label reads "Partial — answered X of Y" from
  `answersGiven`/`totalQuestions`, no pass/fail, no Verified badge, as
  before. (b) **`verifiedEligible` does not exist** — grep over
  `routes/` + `client/src/` returns zero hits; no merged response sends
  it. The client now reads it defensively (`=== true` only) on the
  completion path, so "Passed · Verified ✓" renders only if a future
  server field says so; today a server-passed attempt labels "Passed".
  (c) The "server withholds score on non-partial fail" premise also
  does not hold for /current (it returns the score for non-partial
  regardless of `passed`) — the client now enforces the label rule
  itself: failed → "Not passed" badge, NO raw score text rendered.
  (d) The real reconstruction defect the review pointed at is fixed:
  pass/fail came from `passed || finalScore >= 60` (completed view) and
  `(score || 0) >= 60` (showCompleted + its catch fallback) — all now
  read the server's `passed` field only; an unreadable result renders
  the fail labelling, never a guessed pass.
- **GAP-5 — CONFLICT, flagged with evidence (premise wrong against the
  merged server; NOT implemented as written).** `mixed` does NOT 400 on
  the availability endpoint: `CONFIG_FORMATS` includes `'mixed'`
  (routes/assessments.js:151), the endpoint validates against that list
  (:610), and `topicServable`/`computeTopicAvailability` compute mixed
  as the §4.6 union. Removing mixed pre-flight would delete a working
  honest check and push every mixed shortfall to a committed-session
  503 — the worse outcome GAP-1 exists to prevent. The client therefore
  keeps pre-flight for mixed AND keeps the /start 503
  `largestAvailable` handling for every format (race-proofing the
  advisory check). If the review intends the endpoint to reject mixed,
  that is a server-contract change for the parent to rule — the client
  will follow the contract, not the other way round.
- **GAP-6 — implemented; payload-shape note.** Chosen-config servable 0
  → "cannot start this configuration" (the pre-flight empty state; no
  Continue), regardless of the catalogue's `available` flag — pinned by
  a test where the catalogue topic is available but the chosen Coding
  configuration pre-flights 0. Shape note: the payload is
  `availability.formats.mcq.easy = <number>` (a folded count), not
  `…easy.servable`; the client reads counts only via the per-topic
  pre-flight response, so the distinction is documentary.
- **Band copy** is now plain candidate language in both instructions
  blocks: "Medium — questions adapt within the Medium band only
  (levels 2–4), based on your answers. They never move into another
  band."
- Incidental: one pre-existing TS error in the touched file fixed
  (`showCompleted(current.score)` → `?? undefined`, the pattern already
  used in runExit); tsc is clean on all touched files.
