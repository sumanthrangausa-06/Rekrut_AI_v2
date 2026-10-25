# C2 (server) build log — #1654, story C2 of the #1603 Assessments redesign

Branch `nova/1654-c2-server` (stacked PR 1 of 2; the client is PR 2 — neither
closes #1654 alone, STOP 1 Q6). Base: dev `b5b74db43`. Local-only build
(HL-007): no GitHub writes from the worker; the parent lands the PR.

## What was built (server only — `routes/assessments.js`)

1. **Config helpers beside the C1 block** — `BAND_START {easy:1, medium:3,
   hard:4}`, `BAND_RANGE` for the §5.2 clamp, `sessionTotal()` =
   `total_questions ?? LEGACY_TOTAL_QUESTIONS`, per-topic counts variant
   (`loadTopicCounts`/`topicServable` — one topic's grouped approved-only
   counts, never the whole-bank load), topic lookups (by id; default topic
   by subject; default topic by legacy skill name), and
   `resolveCandidateSkill` — the existing /start lookup-or-create, shared
   by both start bodies (§3.6 subject-legacy-name → candidate_skills).
2. **Pre-flight** `GET /catalog/:topicId/availability?format=&band=&count=`
   → `{ promised, servable, largestAvailable, reason|null }`.
   `largestAvailable` is per-configuration (it equals `servable` for the
   asked format+band), never the catalogue's cross-configuration maxCount.
   Honest reasons for zero supply and for servable < promised; 404 for
   unknown/inactive topics; 400 for invalid format/band/count; coding
   while the flag is OFF reads servable 0 with a coding-specific reason.
3. **POST /start dual body.** Configured `{topicId, format, difficultyBand,
   totalQuestions}`: validated enums; count must be in {10,25,50,100} **or**
   exactly the configuration's current servable (Q1's labelled
   largestAvailable offer); `setId` → explicit 400 `SETS_NOT_AVAILABLE`
   (Q3); `format:'coding'` with `ASSESSMENTS_CODING_ENABLED` off → 503
   `QUESTION_UNAVAILABLE` with a format-specific reason (Q4). Availability
   is re-checked **inside** the start transaction; insufficient supply
   returns the existing 503 shape extended with `{promised,
   largestAvailable}` and the session still commits + stays resumable
   (Phase A contract). All six snapshot columns (subject_id, topic_id,
   set_id [null], format, difficulty_band, total_questions) are written on
   INSERT; start difficulty is the band start 1/3/4. Legacy body: resolves
   the skill's default topic and snapshots `{format:'mixed',
   difficultyBand:'medium', total_questions:10}` with start difficulty 3
   (§8/SF-9 deliberate change); a skill with no catalogue topic snapshots
   the defaults with a NULL topic and serves via the legacy skill match.
   In-flight NULL-config sessions are untouched.
4. **Serving.** Session scope `{topicId, format}` is threaded through
   `serveNextQuestion` → `generateQuestion` (its sole caller). Snapshot
   sessions serve from the scoped pool — `topic_id` + format predicate
   (mixed → `format IN ('mcq','short_answer')`, §4.6) +
   `review_status='approved'` — in the Q2 order: bank-first (with
   exclusion) → AI generation (type driven by the session format) →
   in-scope approved re-serve (no exclusion, still fully predicated) →
   null (QUESTION_UNAVAILABLE). AI INSERTs write `topic_id`, derived
   `format` (§3.4), `source='ai_live'`, `review_status='pending'`; the
   generated row returns directly to its session but is not servable bank
   supply until curation approves it. NULL-config sessions keep today's
   exact queries, order, coin flip, and INSERT.
5. **/answer band clamp (§5.2)** — the adaptive step is clamped to the
   locked session's band (easy [1,2] / medium [2,4] / hard [4,5]); NULL
   band keeps [1,5]; `isCorrect === null` still moves neither way (#1572).
6. **Count plumbing** — `TOTAL_QUESTIONS` renamed `LEGACY_TOTAL_QUESTIONS`;
   every consumer (question payload, serve, respond-after-record, exit
   save/submit/abandon, completion, /session/current incl. fallbacks) reads
   `sessionTotal(session)`. Completed/current/exit payloads gain the
   snapshot label fields (`format`, `difficultyBand`) for §5.2/§8
   disclosure; the client PR consumes them.
7. **Score normalisation (Q5)** — ONE path for every completion:
   `completeAssessment` generalises the partial branch's §8 formula —
   `score = round(Σ scorePoints / Σ maxPoints × 100)`, `max_score = 100`,
   for partial AND non-partial, configured AND legacy. `passed`,
   `verified_score`, and the OmniScore feed (`addTechnicalComponent`,
   unchanged call site in `completeAssessmentTx`) all consume the
   percentage. This fixes the proven raw-sum defect (e.g. a raw 950 or 440
   written against max_score 100) on the legacy path — a named behaviour
   change, pinned by red-first tests. Partial labelling ('X of Y
   answered', no pass/Verified/OmniScore) is unchanged. Zero answered
   questions still write NO score (null), never a fabricated 0.
   Note: Σ maxPoints is derived per answered question from its bank row
   (difficulty × 10 MCQ / × 15 short_answer) — exactly the partial branch's
   existing derivation, now run for all completions; no new tracking was
   needed in the answer flow.

## STOP 1 rulings as implemented

- **Q1** — enum governs the UI; start accepts a non-enum count iff it
  equals the configuration's servable at check time (and servable > 0).
- **Q2** — snapshot sessions: bank → AI → in-scope approved re-serve →
  unavailable. Legacy NULL-config sessions keep the Phase A order.
- **Q3** — `setId` → 400 `SETS_NOT_AVAILABLE` until C3.
- **Q4** — coding start with the flag OFF → 503 family, coding reason.
- **Q5** — percentage score for all completions (see §7 above).
- **Q6** — stacked PRs; this is the server PR. JT-C1 needs both PRs.

No new migration: the snapshot columns are migration 280's.

## Fixture re-seeding (same PR)

- `e2e/journeys/assessment-phase-a.js` / `assessment-phase-b.js`: rig bank
  INSERTs now write `topic_id` (subquery on the topic's
  `legacy_skill_name`), `format='mcq'`, `review_status='approved'` — under
  the approved-only scoped predicate, unmapped/pending rig rows would
  silently stop being bank supply.
- Phase A JT-A4: the uncovered cell moves d4 → d5 (legacy start is now
  difficulty 3, §8/SF-9): Python rig supply is d3+d4 and the recovery
  insert is a d5 row. JT-A5: the SQL recovery insert is now a d3 row (the
  session's start difficulty). **Quinn AFTER-capture note:** both legs'
  premises assume the seeded product bank has no servable Python supply
  at d5 and no servable SQL supply at d3; if the capture shows seed
  supply at those cells, those two legs need a scarcer skill (rig-data
  decision for Lead/Quinn — flagged, not silently worked around).
- `assessments-question-boilerplate-1573.test.js`: the suite was red 5/5
  on pristine dev (pre-existing Phase A drift: its mock never answered
  serveNextQuestion's FOR UPDATE read, and it expected the pre-Phase-A
  500 contract). Harness repaired (created-session FOR UPDATE read;
  failure expectations assert the shipped 503 QUESTION_UNAVAILABLE
  contract) and EXTENDED with the C2 provenance scenario (topic-resolved
  start → AI INSERT carries topic_id / derived format / 'ai_live' /
  'pending'). No #1573 assertion was weakened; the suite is 6/6 green.

## Evidence

- New suite `server/__tests__/routes/assessments-config-1654.test.js`
  (Scout's 12-point list): RED 23 fail / 1 pass on pristine dev (the pass
  is the NULL-band [1,5] preservation pin) → GREEN 24/24.
  Logs in the worktree evidence folder (`evidence-1654/`): `red-1654.log`,
  `green-1654.log`, `baseline-pristine-dev.log`, `regression-1654.log`.
- Regression (per-suite individual runs; combined runs cross-contaminate
  mocks and are not the standard): every previously-green suite stays
  green (catalog-1653 18/18, start-enforce 6/6, transparency 2/2, assign
  5/5, deadlines 15/15, generate 5/5, job-questions-sanitize 3/3, referral
  18/18); pre-existing reds are byte-identical to baseline (retake-lockout
  3/5 — tests ii/iii/iv; 1572 8/8; 1584 2/2; score-roundtrip 1/7 — the
  Task 4c job-assessment test). 1573 improved 0/5 → 6/6 (see above).
- HL-003 E2E-on-dev (fresh-install journey proof, JT-C1/JT-C4) remains
  Quinn's AFTER capture — this PR's mock-based suite is a regression pin,
  not that gate.
