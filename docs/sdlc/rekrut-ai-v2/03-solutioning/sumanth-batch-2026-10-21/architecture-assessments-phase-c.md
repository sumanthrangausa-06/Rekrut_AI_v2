# Rex — Architecture / Design: #1603 EPIC Assessments Redesign (Phase C)

- **Issue:** #1603 `[EPIC] Assessments redesign — multiple subjects/topics, MCQ + coding formats, configurable counts and difficulty` — OPEN (verified via `gh issue view 1603`, 2026-10-22)
- **Phase:** 3-Solutioning (Rex owns). Input PRD: `docs/sdlc/rekrut-ai-v2/02-planning/sumanth-batch-2026-10-21/prd-assessments-module.md` §7 Phase C (FR-C1–C5), §10 JT-C1–C4, §11 items 5–6, §12.
- **Repo / branch verified:** `sumanthrangausa-06/Rekrut_AI_v2`, `origin/dev` tip `8efe4f666` (Merge PR #1646) at design time. All file:line evidence below is at `origin/dev`.
- **Skills consulted:** startup-cto (first) → smart-sdlc `create-architecture` → ecc/architect + agency-agents `engineering-backend-architect` + ecc/database-reviewer perspectives (schema/migration lens). Harness lessons applied: HL-003 (E2E gate), HL-006 (documentation-first — this doc precedes any Phase C build), HL-007 (no GitHub writes from this dispatch; landing is this file only).
- **Founder rulings incorporated (2026-10-21, binding):**
  1. **No retake lockout after an abandoned attempt.** (Completed-attempt lockout is a separate, existing behaviour — see §8; abandon never locks.)
  2. **Difficulty is adaptive WITHIN the chosen band.** Candidate picks Easy / Medium / Hard; the 1–5 engine adapts inside that band and never crosses a band boundary silently (PRD §11.6 recommendation, adopted by Sumanth; validated in §5 below).
- **Hard constraints:** $0 budget, no new paid services; expand-only migrations (expand → migrate → contract, contract is a separate Sumanth-gated step on the shared staging/prod DB); no fabricated questions or scores (#1573 / PRD §8 honesty rules are binding precedent); docs land in `docs/sdlc/` in the same PR as each build phase.

---

## 1. Current-state summary (verified, file:line evidence)

### 1.1 Catalogue is a code constant
- `routes/assessments.js:29` — `const SKILL_CATALOG = [` … 16 entries (JavaScript, Python, React, Node.js, SQL, TypeScript, Java, CSS & HTML, AWS, Docker, Git, Data Analysis, System Design, Project Management, Communication, Machine Learning), each `{name, category, icon, description, difficulty: 'Adaptive'}` (`:29–144`).
- `routes/assessments.js:145` `GET /available` maps that constant and overlays per-user history from `candidate_skills` + `skill_assessments` (`:171–215`). There is **no subjects/topics/sets concept anywhere** in the route, the client (`client/src/pages/candidate/assessments.tsx` groups the flat list by `category` only), or the schema.
- Consequence: adding/renaming a skill is a code deploy; the client and server each hardcode their side of the same list.

### 1.2 Fixed length, fixed start difficulty
- `routes/assessments.js:948` — `const TOTAL_QUESTIONS = 10;` Every consumer reads the constant: `questionPayload` (`:989–993`), `serveNextQuestion` completion check (`:1034`), completion/partial logic (`:1544–1710`), session/current reads (`:872–948`). There is no per-session count.
- `POST /start` (`:318`) accepts only `{skillId, skillName, category, jobId}`; the session INSERT (`:404–405`) seeds `current_difficulty = 2, current_question_index = 0`. No format, count, band, topic, or set is recorded on the session.

### 1.3 Question bank and supply
- Schema (migration `006_dynamic_assessments.js`): `assessment_questions(id, skill_category VARCHAR(100), difficulty_level INT 1–5 CHECK, question_type VARCHAR(50), question_text, options JSONB, correct_answer, explanation, time_limit_seconds)`. The bank is keyed by a **free-text skill name string**, not a foreign key — this is the root fragility behind #1606.
- `generateQuestion(skillName, category, difficulty, client, excludeIds)` (`routes/assessments.js:1295`): bank-first (`WHERE LOWER(skill_category)=LOWER($1) AND difficulty_level=$2 AND NOT (id = ANY(excludeIds)) ORDER BY RANDOM()`, `:1298–1309`), re-serve fallback if the cell is exhausted (`:1313–1330`), then AI backfill via `chat()` from `lib/polsia-ai` (`:1331ff`) which INSERTs the generated row into the bank. Question type is chosen by `Math.random() > 0.3 ? 'multiple_choice' : 'short_answer'` (`:1331`) — the candidate has no format choice today.
- On AI failure it returns `null` and fabricates nothing (`:1404ff`, #1573 fix — **must not regress**).
- **#1606 lesson (verified mechanism):** 13 of the 16 catalogue skills have no starting question in the bank at the starting difficulty, so start depended entirely on a live AI call. Phase A already hardened the *failure shape*: `POST /start` now COMMITs the session before serving (`:425ff`) and returns `503 QUESTION_UNAVAILABLE` with a resumable `sessionId` instead of rolling back. Phase C must fix the *supply shape* (§7), not re-fix the failure shape.

### 1.4 Adaptive engine (1–5, unbounded)
- In `POST /answer` (`:661–671` at design-time numbering; logic verified in the record-answer transaction): correct + no time anomaly → `+1` (cap 5); incorrect → `−1` (floor 1); **unevaluated (`isCorrect === null`, #1572) → no movement**. `max_difficulty_reached` tracked alongside. Scoring: MCQ `difficulty_level × 10` (`:539–541`); short_answer `(evaluation.score/100) × difficulty × 15` (`:553`), unevaluated short answers record `pending_manual_review` with no points (`:546–596`).
- The engine is sound; what it lacks is a **band clamp** and a **recorded chosen configuration** to clamp against.

### 1.5 Sessions, results, retake
- `assessment_sessions` (migration 006, plus later additive columns incl. Phase B `current_draft`): `user_id, skill_id, job_id, status, current_question_index, current_difficulty, questions_asked JSONB, answers_given JSONB, score, max_difficulty_reached, tab_switches, copy_paste_attempts, time_anomalies, started_at, completed_at`. Session state is JSONB arrays, not per-question rows — Phase C keeps this (see §3.4 decision).
- Retake: `SKILL_RETAKE_LOCKOUT_DAYS = 30` (`routes/assessments.js:16`), `canRetakeSkill()` checks the last **completed** attempt only. Abandoned attempts do not trigger it in code today — Phase C formalises the founder ruling so no future change regresses it (§8).
- Completion is now an atomic, status-guarded terminal transition in its own transaction (`completeAssessmentTx`, `:1084`; Phase A FR-A3) and partial-submission scoring is ruled (answered-only, labelled "X of Y answered", no pass/Verified, no OmniScore feed). Phase C builds on both; neither is redesigned here.

### 1.6 Coding surfaces exist — separately, and gated
- `routes/coding-submissions.js` (templates + submissions + grading, Issue #119), `routes/sandbox.js` (self-hosted Judge0, Issue #117), schema in migrations `117_code_sandbox.js` (`sandbox_languages`, `sandbox_submissions`, `sandbox_test_cases`) and `119_coding_templates.js` (`coding_templates` with `difficulty CHECK IN ('easy','medium','hard')`, `coding_test_cases` with `is_hidden`, `weight`).
- **#118 is OPEN** (verified via `gh issue view 118`, 2026-10-22: "Security audit of the code sandbox before public exposure"). The audit report on dev (`docs/security/code-sandbox-audit-118.md`, 2026-08-14) verdict is **CRITICAL — do not enable in production**: privileged Judge0 workers + Docker socket, unauthenticated Judge0 API on all interfaces, hidden test cases disclosed to any authenticated user. M13 decision D-M13-1 (Rex recommendation, PRD §12): **coding is gated on the #118 disposition.** Phase C therefore designs coding in full (§3.5) but ships it behind a server-side flag that stays OFF for real candidates until #118 is dispositioned (fixed or formally accepted by Sumanth). This is an open dependency, not a design gap.

### 1.7 What Phase C does NOT touch
Assigned job assessments (`job_assessments` / `job_assessment_attempts`, separate runner with its own scoring step) keep their lifecycle; Phase C adds only the *configuration* surface FR-C3 requires for assigned assessments (§4.3). OmniScore formula is out of scope (PRD §9); only its input contract is preserved (§8).

---

## 2. Design principles

1. **Catalogue is data, questions are data, configuration is recorded.** Anything a candidate chooses is stored on the session at start and never re-derived.
2. **Count promised = count served** (FR-C3). Availability is computed *before* start from real bank rows; generation is backfill during the test, never a pre-start promise.
3. **Honest unavailable beats broken open** (FR-C4, JT-C4, #1606, #1573). A topic that cannot serve its promised configuration does not start.
4. **Reuse before building (ponytail).** The bank, the adaptive engine, the completion transaction, the coding template/sandbox tables all exist. Phase C adds the catalogue layer and configuration plumbing; it does not rewrite the runner.
5. **Expand-only.** Every schema change in §6 is additive (new tables, new nullable columns, new indexes). No column is renamed, retyped, or dropped in this epic.

---

## 3. Target data model

Migration numbering: next free number at design time is **279** (latest on dev: `278_job_assessments_published_status.js`). Lead confirms at build time; numbers below are indicative.

### 3.1 `assessment_subjects` (new, migration 279)
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `slug` | VARCHAR(60) UNIQUE NOT NULL | e.g. `python`, `dsa` — stable key for URLs/seeds |
| `name` | VARCHAR(100) NOT NULL | Display name |
| `category` | VARCHAR(50) NOT NULL | Existing grouping values: `technical` / `analytical` / `soft_skill` (preserves today's `GET /available` grouping) |
| `icon` | VARCHAR(10) | Carried from `SKILL_CATALOG.icon` |
| `description` | TEXT | |
| `sort_order` | INT DEFAULT 0 | Catalogue display order = today's constant order at seed time |
| `is_active` | BOOLEAN DEFAULT true | Inactive = hidden from catalogue, history untouched |
| `created_at / updated_at` | TIMESTAMPTZ | |

Seed subjects (FR-C1): Python, Java, JavaScript, SQL, DSA, OOP, HTML/CSS, Aptitude **plus** the remaining existing skills mapped in (React, Node.js, TypeScript, AWS, Docker, Git, Data Analysis, System Design, Project Management, Communication, Machine Learning). Aptitude is seeded as a subject with topics but its *content* is out of scope (PRD §9) — it appears in the catalogue only if it has coverage per §7, otherwise it seeds inactive.

### 3.2 `assessment_topics` (new, migration 279)
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `subject_id` | INT NOT NULL → `assessment_subjects(id)` | |
| `slug` | VARCHAR(80) NOT NULL | UNIQUE per subject: `UNIQUE(subject_id, slug)` |
| `name` | VARCHAR(120) NOT NULL | e.g. Python → "Data Structures", "OOP in Python", "Comprehensions" |
| `description` | TEXT | |
| `legacy_skill_name` | VARCHAR(100) NULL | The exact `assessment_questions.skill_category` / `SKILL_CATALOG.name` string this topic inherits bank rows from (see §6 backfill). NULL for net-new topics. |
| `sort_order` | INT DEFAULT 0 | |
| `is_active` | BOOLEAN DEFAULT true | |

**Mapping rule:** each of the 16 legacy skills becomes exactly one subject with one **default topic** whose `legacy_skill_name` = the skill name. That default topic is what guarantees today's behaviour is representable on day one (§8). Finer topics (e.g. Python split into Core / OOP / Data Structures) are seeded as additional topics only when §7 coverage is met for them, or seeded inactive and activated by the coverage job — never seeded active-and-empty.

### 3.3 `assessment_sets` + `assessment_set_questions` (new, migration 279)
A **set** is a named, ordered, reusable question selection for a topic — the "multiple practice sets per topic" of FR-C1 and the unit that makes retakes differ (FR-C5).

| `assessment_sets` | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `topic_id` | INT NOT NULL → `assessment_topics(id)` | |
| `name` | VARCHAR(120) NOT NULL | e.g. "Python Core — Set A" |
| `format` | VARCHAR(20) NOT NULL CHECK IN (`mcq`, `short_answer`, `mixed`, `coding`) | Session format must match set format when a set is chosen |
| `difficulty_band` | VARCHAR(10) NOT NULL CHECK IN (`easy`, `medium`, `hard`) | |
| `is_active` | BOOLEAN DEFAULT true | A set with insufficient live questions is auto-inactive per §7 |

| `assessment_set_questions` | Type | Notes |
|---|---|---|
| `set_id` | INT → `assessment_sets(id)` ON DELETE CASCADE | PK `(set_id, question_id)` |
| `question_id` | INT → `assessment_questions(id)` | |
| `position` | INT NOT NULL | Serving order within the set |

**Two serving modes, one code path:**
- **Set mode** — candidate picks a set (or the system picks the least-recently-served active set for the topic+format+band): questions serve in `position` order from the join.
- **Pool mode** (default, and the only mode at first ship) — no set selected: questions serve from the topic's bank pool via the existing bank-first logic, scoped by topic (§3.4). Sets are curated *over* the pool later without any runner change, because `serveNextQuestion` only needs "the ordered candidate question-id source for this session" — pool or set.

This ordering matters: pool mode delivers FR-C1/C3/C4/C5; set curation is additive content work, not a second engine.

### 3.4 `assessment_questions` — extended, not replaced (migration 280, all additive/nullable)
| New column | Type | Notes |
|---|---|---|
| `topic_id` | INT NULL → `assessment_topics(id)` | Backfilled from `legacy_skill_name` (§6). NULL = unmapped legacy row; pool queries treat NULL-topic rows as belonging to the subject's default topic via the mapping table until backfill completes. |
| `format` | VARCHAR(20) NULL | Derived at backfill from `question_type`: `multiple_choice → mcq`, `short_answer → short_answer`, `coding → coding`. Kept as a column (not a view) because availability counts (§7) run per request. |
| `mcq_subtype` | VARCHAR(20) NULL CHECK IN (`concept`, `output_prediction`, `debugging`, `theory`) | FR-C2 MCQ sub-types. NULL = unclassified legacy MCQ; classified by the seed/curation pass, not by generation-time guessing. New AI-generated MCQs must return a subtype or are stored NULL and excluded from subtype-filtered pools. |
| `coding_template_id` | INT NULL → `coding_templates(id)` | Only for `format='coding'` rows (§3.5). |

Existing columns unchanged. `difficulty_level` (1–5) stays the storage scale; bands are a mapping over it (§5), never a retype.

**Decision — no per-question session rows.** `questions_asked` / `answers_given` JSONB on the session stays. A normalised `assessment_session_questions` table was considered and rejected for this epic: the runner, completion, partial scoring, draft, and exit flows all already work on the JSONB contract, and Phase C's queries (availability, progress) read the bank and `skill_assessments`, not session internals. Revisit only if per-question analytics becomes a requirement.

### 3.5 Coding question representation (FR-C2)
A coding question is **not** a new question engine. It is:
- one `assessment_questions` row: `format='coding'`, `question_text` = problem statement, `explanation` = editorial/approach notes (shown post-completion only), `time_limit_seconds` = per-question budget, `coding_template_id` → the existing `coding_templates` row carrying `starter_code`, `language_support`, limits;
- its test cases are the existing `coding_test_cases` rows for that template (`is_hidden` cases never serialised to the candidate — and see the #118 HIGH finding: the current test-case list endpoint leaks hidden `stdin`/`expected_stdout`; the Phase C runner must use its own read path that selects only non-hidden cases for display and never reuses that endpoint);
- the candidate's answer, stored in `answers_given[]` for the session, is `{questionId, codingSubmissionId}` — the code itself lives in `coding_submissions` / `sandbox_submissions` via the existing surfaces, not duplicated into JSONB;
- scoring: `scorePoints = round(passed_weight / total_weight × difficulty_level × 10)` using `coding_test_cases.weight` and the grader's per-case results — same scale family as MCQ so mixed-format totals stay comparable; a run that errors/times out at the sandbox scores 0 for the failed cases with the real run status shown (JT-C2: pass/fail per test case from the real run), and a sandbox *outage* records the answer as `pending_manual_review` (the #1572 honest pattern), never 0-by-default and never a fabricated pass.
- **Gate:** sessions may only include coding questions when server flag `ASSESSMENTS_CODING_ENABLED=true`. Default OFF. Flipping it requires the #118 disposition on the issue — Sumanth's gate, not a deploy default.

### 3.6 `assessment_sessions` — configuration snapshot (migration 280, additive)
| New column | Type | Notes |
|---|---|---|
| `subject_id` | INT NULL → subjects | NULL on legacy sessions |
| `topic_id` | INT NULL → topics | |
| `set_id` | INT NULL → sets | NULL = pool mode |
| `format` | VARCHAR(20) NULL | `mcq` / `short_answer` / `mixed` / `coding` as chosen |
| `difficulty_band` | VARCHAR(10) NULL | `easy` / `medium` / `hard` as chosen |
| `total_questions` | INT NULL | The promised count (10/25/50/100). NULL = legacy → read as 10 (§8) |

`skill_id` stays populated for every Phase C session (subject's default `candidate_skills` linkage) so results, OmniScore input, and history queries keep working unchanged.

### 3.7 Progress (FR-C5)
No new table. Per-topic progress is a read model over `skill_assessments` + `assessment_sessions` (which now carry `topic_id`): attempts, best score, last score, last attempted per `(user, topic)`. Retake differentiation is a serving rule (§5.3), not schema.

---

## 4. API changes

Base path unchanged: routes are mounted from `routes/assessments.js`. All new endpoints use `authMiddleware`; all start-path endpoints keep `rateLimits.ai` where they can trigger generation.

### 4.1 New: catalogue (data, not constant)
- `GET /assessments/catalog` → `{ subjects: [{ id, slug, name, category, icon, description, topics: [{ id, slug, name, description, availability: { formats: { mcq: {easy: n, medium: n, hard: n}, … }, maxCount, available: bool }, progress: { attempts, bestScore, lastScore, lastAttempted } | null }] }] }`
  Availability numbers are **real bank counts** (§7), computed in one grouped query over `assessment_questions` by `(topic_id, format, difficulty_level)` folded into bands — never constants, never generation estimates. Subjects/topics with zero availability return `available: false` (the client renders the §6.3 honest empty state; JT-C4) — they are not silently omitted, because omission is how #1606 hid.
- `GET /assessments/catalog/:topicId/availability?format=&band=&count=` → pre-flight for the instructions screen: `{ promised, servable, largestAvailable, reason | null }`. The instructions screen (JT-C1) renders exactly what start will serve; Start is disabled with the honest state when `servable < promised`, or offers `largestAvailable` **labelled as such** (FR-C4) — the candidate chooses the smaller count explicitly; the server never silently substitutes it.

### 4.2 Changed: start / answer / serve
- `POST /assessments/start` — accepts the new body `{ topicId, setId?, format, difficultyBand, totalQuestions }` **or** the legacy body `{ skillId | skillName, category }`. Legacy body → server resolves the skill's default topic, `format='mixed'`, `difficultyBand='medium'`, `totalQuestions=10`, starting difficulty 3 (band centre, §5) — recorded on the session exactly like a chosen configuration, so there is one downstream code path. Validation: `totalQuestions ∈ {10,25,50,100}`, format/band in their enums, topic active; availability re-checked inside the start transaction (the pre-flight is advisory; start is authoritative) → insufficient supply returns the existing `503 QUESTION_UNAVAILABLE` contract shape, extended with `{ promised, largestAvailable }`.
- `questionPayload` and every `TOTAL_QUESTIONS` consumer read `session.total_questions ?? 10`. The constant remains only as the legacy default value, renamed in code to `LEGACY_TOTAL_QUESTIONS` so no new code can pick it up by accident.
- `serveNextQuestion` pool query gains the session's scope: `topic_id = session.topic_id AND format matches session.format AND difficulty_level = session.current_difficulty`, with set mode reading `assessment_set_questions` order first. The Phase A contracts are preserved verbatim: outstanding question re-served, session committed before first question, generation failure = retryable navigation outcome, never an answer rollback.
- `POST /assessments/answer` — unchanged request/response contract. Internally the adaptive step clamps to the session band (§5). Coding answers arrive as `{ sessionId, questionId, codingSubmissionId, timeTaken }` after the client runs the code through the existing coding surfaces; the answer handler verifies the submission belongs to the user and the question's template before scoring it.

### 4.3 Assigned assessments (FR-C3, minimal)
`POST /assessments/assign` and the job-assessment generation path accept optional `{ totalQuestions, difficultyBand, format }` with the same enums, stored on the job assessment's existing config/flags JSON (no new columns on `job_assessments` in this epic). Absent = today's behaviour. The job runner reads its count from that config instead of its current fixed path. No recruiter authoring-UI redesign (PRD §9 out of scope) — the fields are accepted and honoured; UI surfacing is a follow-up story Lead may file separately.

### 4.4 Deprecated (not removed)
`GET /assessments/available` keeps its exact response shape, re-implemented over the new tables (subjects → the same flat list via default topics). The client migrates to `/catalog` in Phase C2; `/available` is removed only in a later, separately gated contract step (§6, step 5).

### 4.5 Client changes (summary for Lead's stories)
Assessments page: subject → topic drill-in (replacing category-grouped flat list), per-topic honest empty state; configuration step (format, band, count 10/25/50/100) before instructions; instructions screen states the exact chosen configuration, total time expectation (count × per-format time budget — 50/100-question tests must show their real expected duration before Start), exit/full-screen rules (Phase B, unchanged); runner reads `totalQuestions` from the server payload (already in the payload shape); coding runner embeds the existing code-editor component and per-case results view; progress view groups attempts by topic (JT-C3).

---

## 5. Difficulty-band adaptation algorithm (founder ruling 2)

### 5.1 Band mapping over the existing 1–5 scale
| Band | Levels in band | Start level | Rationale |
|---|---|---|---|
| Easy | {1, 2} | 1 | Beginner questions only; never serves a level-3+ question |
| Medium | {2, 3, 4} | 3 | The general-purpose band; centre start |
| Hard | {4, 5} | 5→ first question at 4 | Expert band; starts at 4 so one early miss doesn't strand the candidate at the ceiling with no signal — see note |

Note on Hard start: starting at 5 and dropping to 4 on a miss is equivalent in levels served; starting at 4 and rising to 5 on success gives the adaptation somewhere to go in both directions from question 1. Either honours the band; the build story picks start=4 and records the choice on the issue. What is **not** permitted is serving outside {4,5}.

Legacy sessions (no band) keep today's unbounded 1–5 behaviour with start 2 — they were promised "Adaptive" and finish under the rules they started with (§8).

### 5.2 Algorithm (drop-in replacement for the current step in `POST /answer`)
```
bandRange(session) = {easy:[1,2], medium:[2,3,4], hard:[4,5]}[session.difficulty_band] ?? [1,5]
on recorded answer:
  if isCorrect === null:            # unevaluated (#1572) — no movement, unchanged
      newDifficulty = current
  elif isCorrect && !timeAnomaly:   # time-anomaly rule unchanged
      newDifficulty = min(current + 1, max(bandRange))
  elif !isCorrect:
      newDifficulty = max(current - 1, min(bandRange))
  max_difficulty_reached = max(previous, newDifficulty)   # unchanged bookkeeping
```
The chosen band is shown on the instructions screen and in results ("Medium — questions adapted between levels 2–4") so the clamp is disclosed, not silent — "never crosses bands **silently**" is satisfied by (a) never crossing at all and (b) telling the candidate the range up front.

### 5.3 Retake differentiation (FR-C5)
Pool serving already excludes the session's own asked ids. Across attempts: `serveNextQuestion` receives the user's **most recent completed attempt's** question ids for this topic as a soft exclusion — applied only while the remaining pool at the needed `(format, difficulty)` still meets the session's remaining count; when it would starve the session, the exclusion relaxes oldest-first. Set mode: pick the active set for `(topic, format, band)` the user has gone longest without completing. "Different where the bank allows" (FR-C5's own words) — starvation never blocks a retake.

---

## 6. Catalogue-as-data migration path (expand-only)

| Step | Migration / change | Gate |
|---|---|---|
| 1. Expand | **279**: create `assessment_subjects`, `assessment_topics`, `assessment_sets`, `assessment_set_questions` + indexes. **280**: add nullable columns (§3.4, §3.6) + indexes on `assessment_questions(topic_id, format, difficulty_level)` and `assessment_sessions(topic_id)`. No existing column touched. | Normal dev PR gates |
| 2. Seed + backfill (data migration, same PR as 279/280 or immediate follow) | Insert subjects/default topics from `SKILL_CATALOG` verbatim (name, category, icon, description, order). Backfill `assessment_questions.topic_id` by joining `LOWER(skill_category) = LOWER(legacy_skill_name)`; backfill `format` from `question_type`. Idempotent (`ON CONFLICT DO NOTHING`, `WHERE topic_id IS NULL`) so re-runs are safe on the shared DB. Rows that match no legacy name stay NULL and are reported by the coverage job (§7) — never guessed into a topic. | Normal dev PR gates; backfill counts reported on the issue |
| 3. Dual-read | `/available` re-implemented over tables with a code fallback: if the catalogue tables are empty (fresh install before seed), serve the constant. `SKILL_CATALOG` is **not** deleted in this step. | Dev E2E (§9) |
| 4. Cut over | Client moves to `/catalog`; `/start` accepts the new body; constant becomes legacy-default-topic resolution only. | Dev E2E + staging re-proof before any promotion (Sumanth promotion gate, unchanged) |
| 5. Contract (NOT in this epic's dev scope) | Drop the constant fallback; consider `skill_category` deprecation. Any column drop is a contract-step migration on the shared staging/prod DB → **separate Sumanth approval**, expand→migrate→contract discipline. This design does not schedule it. | ⛔ Sumanth |

Fresh-install note: migrations 279/280 + seed must run clean from an empty DB (the #183-class failure is the standing caution) — the seed is part of the migration, not a manual step, and Quinn's fresh-install rig is the proof.

---

## 7. Seeding / coverage contract (the #1606 guarantee)

**Definitions.** For a `(topic, format, band)`: `servable = count of active bank questions in topic with format match and difficulty_level ∈ band`. (AI generation is **excluded** from `servable` — it is backfill, not supply.)

**Contract rules:**
1. **Offered counts are computed, never assumed.** The catalogue endpoint offers count `C` for a configuration only if `servable ≥ C`, **or** offers `largestAvailable = servable` explicitly labelled (FR-C4). A configuration with `servable = 0` renders the honest empty state and cannot start (JT-C4).
2. **A listed topic always opens or honestly says it cannot.** `is_active` on a topic means: at least one `(format, band)` configuration has `servable ≥ 10`. The seed/curation pass may not activate a topic below that floor. This is the direct #1606 fix at the data layer: 13/16 skills had no starting question because nothing ever asserted coverage; now activation itself asserts it.
3. **Coverage job.** A script (`scripts/audit-assessment-coverage.js`, run in CI/manual, output on the issue) reports the full matrix: every topic × format × band × servable count, flagging (a) active topics below floor, (b) NULL-topic bank rows, (c) bands within an offered format below the smallest offered count. Phase C does not close while the matrix has an unexplained red cell — same standard as FR-A6.
4. **Seeding minimum for launch topics.** Each launch topic is seeded to `servable ≥ 25` for MCQ/Medium (the middle count at the default band) before it is promoted beyond dev, by curated seed rows and/or reviewed generation persisted to the bank — generation happens **offline, is human/specialist-reviewed, and is stored as bank rows**; it never happens lazily inside a candidate's start request as the sole supply. Counts 50/100 are offered per-topic only where the matrix proves them; they are not a launch-wide promise.
5. **No fabricated fill.** If supply runs out mid-test despite the pre-flight (concurrent consumption cannot happen — bank rows are shared, not consumed — so the realistic cause is deactivation mid-test), serving falls back to the Phase A `QUESTION_UNAVAILABLE` retryable state. It never substitutes an off-topic, off-band, or templated question (#1573).

---

## 8. Backwards compatibility

- **In-flight sessions** at cut-over: have NULL config columns → read as legacy (`total_questions=10`, unbounded adaptation, `mixed` format, default topic of their skill). They finish under start-time rules. No session is migrated mid-flight.
- **Completed history / results:** `GET /results`, recruiter views, and `skill_assessments` are untouched in shape. Progress (§3.7) shows legacy attempts under their skill's default topic — truthful, because that is the topic they tested.
- **Retake lockout:** existing completed-attempt 30-day lockout behaviour is unchanged for completed attempts. **Abandoned attempts never trigger a lockout** (founder ruling 1) — Phase C adds a regression test asserting abandon → immediate fresh start succeeds, so the ruling is code-pinned, not comment-pinned. Whether the *completed*-attempt lockout should also change is not decided by this design (see §10, Q2 — only if Sumanth wants it revisited).
- **OmniScore input contract:** unchanged. Only completed, evaluated attempts feed it; partial attempts keep the Phase B ruling (labelled, no pass/Verified, no OmniScore feed); abandoned/exited attempts contribute nothing (PRD §8/§9).
- **Scoring comparability:** scores remain `Σ scorePoints / Σ maxPoints(session configuration)` — with variable counts the *percentage* is the comparable unit, and results display it with the configuration ("25 questions · Medium · MCQ") so a 10-question and a 100-question score are never presented as the same kind of number.
- **API clients:** `/available` shape preserved (§4.4); `/start` legacy body preserved (§4.2). The current client keeps working against the new server at every phase boundary — phases can ship independently.

---

## 9. Phased build breakdown (for Lead to story)

Each phase: own PR(s) to `dev`, own STOP 1, docs in the same PR (this doc lands in `docs/sdlc/rekrut-ai-v2/03-solutioning/sumanth-batch-2026-10-21/` with Phase C0), Quinn user-journey evidence on the fresh-install dev rig before closure (HL-003). Phases are sequential except where noted.

### C0 — Schema + seed + coverage job
Migrations 279/280, seed/backfill, `scripts/audit-assessment-coverage.js`, coverage matrix on #1603.
- **Specialist: YES — ecc/database-reviewer.** Why: new FK graph + backfill-by-string-join on the shared-DB migration path is exactly the risk domain; the reviewer checks expand-only safety, idempotency, and index choices before SQL is written. Also considered: agency database-optimizer — skipped, no query-performance problem is in evidence yet; availability query is a grouped count over an indexed column set.

### C1 — Catalogue API + dual-read
`GET /catalog`, availability computation, `/available` re-implementation, honest empty states in API responses.
- **Specialist: YES — ecc/security-reviewer (light pass).** Why: new read surfaces expose bank *counts* and per-user progress together; the pass confirms no question content, correct answers, or other users' progress leak through the catalogue payload. UX specialist skipped — no UI in this phase.

### C2 — Configuration, counts, band adaptation (core)
New `/start` body + session snapshot, `total_questions` plumbing through payload/serve/complete, band clamp (§5.2), pre-flight endpoint, client configuration + instructions screens, JT-C1 + JT-C4 journey tests.
- **Specialist: YES — Candidate Experience persona + agency design-ux-architect perspective.** Why: this phase is the candidate-facing promise surface (choose → see exact configuration → get exactly that); the risk is a configuration UI that misstates what will be served, which is a UX-truthfulness risk, not a code risk. Also YES — **Interviewer persona consulted** on band semantics (what Easy/Medium/Hard should mean per subject) — content validity of the bands. Database specialist skipped (schema already landed in C0).

### C3 — Sets, retake differentiation, per-topic progress
Set CRUD (seed-time/internal only — no admin UI in this epic), set-mode serving, soft-exclusion retake logic (§5.3), progress read model + client view, JT-C3.
- **Specialist: NO new specialist.** Why: serving-order and exclusion logic reuse the C2-verified pool path; the risk domain (runner correctness) is already covered by Quinn's journey tests plus the existing Phase A regression suite. Recruiter persona consulted (not a specialist dispatch) on what progress a recruiter should see — candidate progress view is candidate-only in this epic per PRD §9.

### C4 — Coding format (GATED — does not start until #118 disposition is on the issue)
Coding question representation (§3.5), runner editor integration, per-case results (JT-C2), `ASSESSMENTS_CODING_ENABLED` flag OFF by default.
- **Specialist: YES — ecc/security-reviewer (mandatory, blocking).** Why: this phase wires candidate code execution into the scored flow; the #118 audit's CRITICAL/HIGH findings (privileged workers, unauthenticated Judge0, hidden-case leak) are the risk domain, and the reviewer verifies the Phase C read path does not reintroduce the hidden-test-case leak. Also YES — **gensecai application-security specialist** if the security-reviewer wants a second lens on the sandbox boundary. No other phase may absorb C4 to "save time".

### C5 — Coverage hardening to launch floor
Seed/curate every launch topic to the §7.4 floor, activate finer-grained topics the matrix now supports, 50/100 counts enabled per-topic where proven. Content work, parallelisable per subject.
- **Specialist: YES — Interviewer persona (question quality) per subject batch.** Why: the risk is bad questions at scale, not code; generated-then-reviewed rows need a domain read before they enter the bank. Engineering specialists: no — no new code paths.

**Dependency order:** C0 → C1 → C2 → C3 → C5 (C5 content can start after C0 in parallel with C1/C2). C4 is independent in code but **blocked on #118**, not on C3.

---

## 10. Open questions for Sumanth (genuine product-scope only)

1. **Aptitude in the new catalogue:** PRD lists aptitude as a subject (FR-C1) but puts aptitude *content* out of scope. Should Aptitude appear in the Phase C catalogue at launch (seeded inactive until its own content exists), or stay on its existing separate surface until later? *Team position (Rex + Aria PRD reading): keep it on its existing surface; seed the subject inactive so the model is complete without promising a test that isn't there.*
2. **Completed-attempt retake lockout:** the founder ruling removed the lockout after *abandoned* attempts. The existing 30-day lockout after a *completed* attempt (`routes/assessments.js:16`) is untouched by that ruling — keep it, shorten it, or remove it for practice assessments? This design keeps it by default; changing it is a one-line config change whenever ruled. *(Not blocking any phase.)*
3. **Coding languages at launch (only if/when #118 clears):** `sandbox_languages` seeds 12 languages and `coding_templates.language_support` is broad. Which languages should coding *assessments* offer first — team position: Python + JavaScript + SQL only at launch (deepest bank, most candidate demand), others enabled per-topic as coverage proves. *(Blocking only for C4, which is already #118-gated.)*

No other open questions. Difficulty interaction (PRD §11.6) and abandoned-retake (PRD §11.5) are **ruled** and designed above, not re-asked.

---

## 11. Risks

| Risk | Impact | Mitigation in this design |
|---|---|---|
| Bank depth: 100-question counts need 100 servable rows per (topic, format, band) — far beyond today's bank | Candidates promised counts the bank can't serve; #1606 repeats at scale | §7 computed availability; counts offered per-configuration only where proven; C5 seeds to a stated floor, not to the maximum |
| AI backfill quality/cost at $0 budget: generation during tests is provider-dependent (standing MAJOR: provider keys) | Mid-test unavailability; unreviewed questions entering the bank via the live INSERT path | Pre-start supply never counts generation (§7.1); offline reviewed seeding for launch floor (§7.4); live backfill keeps #1573 honest-null behaviour. *Flag:* the existing live-backfill INSERT means unreviewed AI questions persist into the bank — C1's security/quality pass should confirm this stays, or gate live-generated rows to the session that generated them. Rex flags this as a quality-debt decision for Lead/Suga, not a silent carry-over. |
| #118 sandbox CRITICALs unresolved | Coding format cannot safely ship | C4 fully gated; flag default OFF; MCQ/short_answer launch is not blocked by it |
| Shared staging/prod DB: backfill-by-string-join mis-maps rows | Questions land in wrong topics; wrong tests served | Backfill is NULL-safe and report-first (§6 step 2): run the join as a SELECT report on the issue before the UPDATE in the same migration PR's evidence; unmapped rows stay NULL and visible |
| Long tests (50/100) vs per-question timers + full-screen/exit rules from Phase B | Fatigue exits create many partial attempts; timer math surprises | Instructions screen shows total expected duration (§4.5); partial-scoring ruling already covers the outcome honestly |
| Score comparability across counts/bands | Recruiters compare unlike numbers | §8: percentage + configuration label on every result; no cross-configuration ranking introduced |
| Scope bleed into job assessments | Phase C delays on the assigned-runner lifecycle | §4.3 minimal config acceptance only; runner lifecycle untouched |

---

## 12. Acceptance mapping (PRD §10, Phase C)

- **JT-C1** → C2 (configuration snapshot + count plumbing + pre-flight).
- **JT-C2** → C4 (gated on #118; recorded BLOCKED with reason until then — never fake-passed).
- **JT-C3** → C3 (soft-exclusion retakes + per-topic progress from real attempts).
- **JT-C4** → C1/C2 (computed availability + honest empty state before start).

*End of design. Next step: Suga review → Sumanth gate for Phase C build start (C0 first) → Lead stories per §9.*
