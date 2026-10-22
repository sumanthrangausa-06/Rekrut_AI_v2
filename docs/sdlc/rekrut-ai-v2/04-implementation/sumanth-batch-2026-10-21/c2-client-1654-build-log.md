# C2 (client) build log — #1654, story C2 of the #1603 Assessments redesign

Branch `nova/1654-c2-client` (stacked PR 2 of 2; the server is PR #1675,
merged — neither PR closes #1654 alone, STOP 1 Q6). Base: dev `892b5a81f`.
Local-only build (HL-007): no GitHub writes from the worker; the parent
lands the PR.

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
