# Build log — #1656 C3: sets, retake differentiation, per-topic progress

- **Story:** #1656 `[STORY] #1603 C3 — sets, retake differentiation, per-topic progress`
- **Persona:** Nova (Phase 4 — Implementation). Branch `nova/1656-c3-sets-retake-progress` off `origin/dev` @ `65a357724` (verified first-hand via `git ls-remote`).
- **Design:** `docs/sdlc/rekrut-ai-v2/03-solutioning/sumanth-batch-2026-10-21/architecture-assessments-phase-c.md` §3.3 (sets), §3.7 (progress), §4.6 (mixed/set matching), §5.3 (retake differentiation).
- **STOP 1:** Lead rulings R1–R6 (issue #1656 comment 6347448981) + amendment adopting Scout's §6 (comment 6347471166). Specialist decision (R6): none new — confirmed in the rulings.
- **Skills:** startup-cto → superpowers/systematic-debugging → superpowers/test-driven-development (red-first) → ecc/database-reviewer mindset for the query work → ponytail (minimum diff) → verification-before-completion. Harness lessons: HL-003 (E2E gate), HL-006 (this log, in the same commit), HL-007 (no GitHub writes from this lane; landing proof quoted in the report).

## What was built (R1–R4; R5 is Quinn's JT-C3, R6 no specialist)

### R1/R2 — Sets (server-side serving; no HTTP admin endpoint, no UI, no shipped content sets)
- `POST /start` (configured body) now resolves sets instead of the C2 blanket 400:
  - **Explicit `setId`:** must exist, be active, belong to the topic, match the band exactly, and match the format per §4.6 (`setMatchesSession`: exact format, or a `mixed` session drawing an `mcq`/`short_answer` set). Any failure → the honest `400 SETS_NOT_AVAILABLE`, rolled back **before any session exists** (C2 contract preserved verbatim).
  - **No `setId`:** `pickAutoSet` picks, among active compatible sets for the topic with ≥1 approved question, the one the user has gone longest without completing (`last_completed_at ASC NULLS FIRST, id ASC` over the user's completed set sessions). No sets → pool mode, exactly as C2.
  - The chosen set is recorded on the session snapshot (`assessment_sessions.set_id`, migration 280 column — **no new migration; no schema change at all in C3**).
  - Servable for a set session is the **set's own approved membership** (`setApprovedCount`), so the C2 labelled-offer / committed-session-503 machinery keys off the set, never the topic pool.
- `serveNextQuestion` set branch: serves the set's approved questions **in `position` order** (`loadSetQuestionIds`, approved-only join per §7 rule 6). Set exhausted before the promised count → `awaiting_completion`; `sessionCompletionThreshold` (new helper, used by `respondAfterRecord` and GET `/session/:id/current`) completes the attempt honestly as a **partial** — never a hang, never a silent pool fallback mid-set.
- **Internal/test creation path:** `scripts/create-assessment-set.js` — exports `createAssessmentSet(client, { topicId, name, format, difficultyBand, questionIds })` (single transaction, validates topic/questions, reports approved/servable count) plus a CLI. Test fixtures create their own sets through it / direct state. **No hand-authored content sets are shipped** (amendment Q2); real curation is C5.

### R3 — Retake soft exclusion (§5.3, new build)
- `loadPreviousCompletedQuestionIds`: the user's most recent **completed** attempt's asked ids, in asked order — topic-keyed when the session has `topic_id`, skill-keyed fallback for legacy topic-less sessions. Only `status='completed'` rows are read: **abandoned attempts contribute nothing** (no lock — the /start gate already read completed-only; no exclusion either).
- `applySoftExclusion`: folds those ids into the bank draw only while the remaining pool at the needed (format, difficulty) — after the hard in-session exclusion — still meets the session's remaining count; on starvation it relaxes **oldest-first**. The AI leg and the final re-serve fallback are not soft-excluded (existing starvation relief, existing order; on the legacy path, when a soft exclusion was folded in, AI is tried before the re-serve — the scoped path's Q2 order).

### R4 — Per-topic progress (§3.7)
- `loadCatalogTables` gains the per-(user, topic) read model: `skill_assessments` joined to `assessment_sessions` on `session_id`, grouped by `topic_id`, completed-only; latest score via a `LATERAL` read ordered by `completed_at DESC` (never `MAX()`, the §2.4 pitfall). No new endpoint.
- `GET /catalog`: a topic with its own completed attempts reports `{ attempts, bestScore, lastScore, lastAttempted, canRetake }` from that model (`canRetake` from the topic's last completed attempt — the /start gate's own input, §4.4). A default topic with **only** topic-less legacy history keeps the C1 skill-keyed surfacing unchanged in values, plus the same `canRetake`. No attempts → `progress: null`, never a fabricated number.
- **Client** (`assessments.tsx` + `assessment-configure.tsx` type): consumes the richer payload honestly — `Last: X/100` renders only when `lastScore != null` (the #1679 null-renders-nothing rule), and `canRetake === false` shows the plain lockout note instead of letting Start fail later. **No set picker UI** (amendment Q5: API-level, gate-tested at API level).

## Tests (red-first)

New suite `server/__tests__/routes/assessments-sets-retake-progress-1656.test.js` (15 tests; harness cloned from the #1654 stateful SQL-emulating dispatcher, extended for sets / previous-attempt / pool-id / per-topic-progress reads — predicates apply only when the route SQL carries them). Written before the route changes: **9 failed / 6 passed** on the unmodified route (the 6 passes were today's already-honest behaviours). After the build: **15/15 pass**. Pins: position-order serving (scrambled position vs id order), snapshot `set_id`, unknown/inactive/wrong-topic/wrong-format/wrong-band 400s with zero sessions, §4.6 mixed←mcq set, auto-pick longest-not-completed, pool fallback with no sets, enum-count 503 carrying the **set's** `largestAvailable` (2, not the pool's 12), mid-session starvation completing as a labelled partial (2 of 3), full soft exclusion, **oldest-first relaxation discriminated** (serves the oldest relaxed id — newest-first or no-relaxation serve different ids), abandoned-attempt no-exclusion, legacy skill fallback, cross-topic isolation, per-topic progress incl. per-topic `canRetake` split (35d → true vs 10d → false on sibling topics), and legacy-only default-topic surfacing.

**C1 suite adjustment (recorded, deliberate):** `assessments-catalog-1653.test.js` pinned the exact progress object by `toEqual`; §3.7/R4 adds `canRetake`, so the two expectations gained `canRetake: false` (user 7, last completion 2d ago) / `canRetake: true` (user 9, 40d ago). No other C1 assertion changed.

## Regression evidence

- `assessments-config-1654` (C2), `assessments-catalog-1653` (C1), `assessments-start-enforce`, and the new C3 suite: **63/63 pass**.
- All 15 `assessments-*` server suites: 11 pass; 4 fail (`assessments-retake-lockout`, `assessments-score-roundtrip`, `assessments-short-answer-honesty-1572`, `assessments-graded-confidence-1584`) with **identical counts (14 failed / 8 passed) on the pristine `origin/dev` route in this same environment** — pre-existing environment failures, verified by stash-swap A/B, not C3 regressions.
- Biome lint on all changed files: no errors (2 pre-existing warnings on `routes/assessments.js`, unchanged class from baseline).

## HL-003 E2E gate — real HTTP, real DB (fresh install)

Local Postgres 16 scratch instance → fresh database → `node migrate.js` **all migrations clean from empty**. Then `1656-c3-e2e-proof.js` (committed alongside this log) mounted the real router over HTTP with a real JWT and **no mocks**: **20/20 checks passed** (full output: `1656-c3-e2e-evidence.txt`). Covered: set creation via the new helper (counts reported), position-order serving end-to-end to completion (score 100 read back), unknown setId 400 with session count unchanged, catalogue progress read-back from the real completion (`attempts 1, best 100, last 100, canRetake false`), pool-mode retake on a 13-question bank serving a never-asked question (previous attempt's 3 excluded; pool 13 vs remaining 10 — the exclusion binds exactly), pool session `set_id` NULL, and auto-pick recording + serving the only compatible set.

## Not done / gates beyond this lane

- **Quinn JT-C3 (R5)** — the journey run incl. the real-browser client leg with a fixture set (amendment Q6) is Quinn's gate step after this build; if the rig cannot seed a set it records BLOCKED there.
- No staging promotion, no PR — per HL-007 this lane commits locally and stops; the parent verifies and lands.
