# C1 — Catalogue API + dual-read (issue #1653, #1603 Phase C)

- **Design:** `docs/sdlc/rekrut-ai-v2/03-solutioning/sumanth-batch-2026-10-21/architecture-assessments-phase-c.md` §4.1, §4.4, §4.6, §6 step 3, §7.
- **Scope built:** `GET /assessments/catalog` (new) + `GET /assessments/available` re-implemented over the C0 tables with its frozen response shape, in `routes/assessments.js` only. Red-first tests: `server/__tests__/routes/assessments-catalog-1653.test.js` (18 tests: RED 15 failed / 3 passed on pristine dev — the 3 passes pin legacy fallback behaviour; GREEN 18/18 on the branch).
- **Servable twin:** `BANDS` + `computeTopicAvailability` in `routes/assessments.js` are a port of `scripts/audit-assessment-coverage.js` (BANDS + the servable fold), comment-cited both ways from the route side: servable counts ONLY `review_status='approved'` rows; bands easy {1,2} / medium {2,3,4} / hard {4,5} with deliberate boundary overlap (a shared-level row counts in each band it belongs to, once per configuration); `mixed` = mcq + short_answer per band (§4.6), coding never a member. The audit script itself is unchanged in C1 — if one side changes, the other must.

## §2.3 can_retake correction (Scout finding, adopted at STOP 1)

The design's §1.5/§4.4 premise — that the displayed `can_retake` can diverge from the `/start` gate via a started-but-uncompleted attempt — did **not** reproduce at this tip: there is no `candidate_skills.last_attempted` column; the legacy `/available` value was `MAX(sa.completed_at)` over a join already filtered `completed_at IS NOT NULL`, the same semantic input the gate reads. C1 therefore implements §4.4 as an **explicitness + pinning fix, not a live-divergence fix** (the PR must not claim otherwise):

- the table-path progress read is completed-attempts only and names the value internally `last_completed_at`; `/available` maps it to the frozen external field `last_attempted`;
- a regression test pins that an abandoned session and an unsubmitted (`completed_at` NULL) verification row do not move `can_retake` or the attempt count, and that the displayed value equals the gate's decision from the same input;
- `/catalog` progress `lastAttempted` is built from completed attempts only and is a different concept from the retake input, though both derive from the same completed-only read in C1;
- `progress.lastScore` is the latest completed attempt's score via `DISTINCT ON (...) ORDER BY completed_at DESC` — never `MAX(score)` (§2.4 pitfall: a MAX would silently duplicate `best_score`).

## Lead rulings implemented

- **R1 (available threshold):** `available :=` best (format, band) servable ≥ 10 (§7 rule-2 floor); `maxCount` = largest servable across all configurations (including `mixed`), always reported. On today's bank most topics honestly read `available:false` with their real `maxCount` until C5 content lands.
- **R2 (inactive/empty):** subjects and topics are filtered on `is_active` (Aptitude, `is_active=false`, is absent); inactive topics are excluded; active topics with zero availability are included with `available:false`; topic-less active subjects (DSA, OOP) return `topics: []`.
- **R5 (fallback trigger):** dual-read fallback to `SKILL_CATALOG` (the pre-C1 `/available` body, extracted unchanged into `buildAvailableFromConstant`) fires ONLY when the subjects query returns zero rows. A thrown DB error returns the existing generic 500 for `/available` (and a generic 500 for `/catalog`) — never a confident catalogue over a broken database. `/catalog` has no constant fallback: empty tables return `{ subjects: [] }`.
- **R4 (leak discipline, for the security pass):** the grouped availability query selects ONLY `topic_id, format, difficulty_level, COUNT(*)` with `review_status='approved'`; both responses are built from explicit field allowlists (DB rows are never spread); progress is aggregated `WHERE user_id = req.user.id` on every table touched; payload-denylist tests pin that no `question_text` / `correct_answer` / `explanation` / `options` key appears in either response.

## Interim states (recorded, not hidden)

- **R3:** serving stays legacy until C2. C1 availability describes the bank per §7 but `/start` still draws through the legacy `generateQuestion` path (no approved-only pool predicate, no topic scoping yet) — C1 availability ≠ what `/start` draws from.
- **R6:** `/recruiter/catalog` stays on the `SKILL_CATALOG` constant through C1; a later story owns its migration. `SKILL_CATALOG` also remains as the `/available` dual-read fallback (§6 step 3); deleting it is the §6 step 5 contract, Sumanth-gated.
- `/available` table path: catalogue order is `subjects.sort_order`; a subject's user skill is matched case-insensitively through its default topic's `legacy_skill_name` (HTML/CSS ← legacy "CSS & HTML"), falling back to the subject name; `difficulty` is the frozen `'Adaptive'` literal (subjects carry no difficulty column); non-catalogue user skills keep the legacy append semantics.
- `/catalog` progress is read at a topic through its `legacy_skill_name` (subject-level aggregation per §3.6/§3.7); topics without a legacy name carry `progress: null` in C1 — per-topic session attribution is C3.

## Verification notes

- Neighbouring suites (`assessments-assign`, `assessments-start-enforce`, `assessments-transparency`, `assessments-generate`) pass. `assessments-retake-lockout` fails 3/5 **identically on pristine dev** (stash A/B verified) — pre-existing at this tip, unrelated to C1.
- Closure still requires Quinn's fresh-install journey E2E (§9 preamble): `/available` renders identically to pre-C1 and `/catalog` counts match a hand-run of the coverage audit on the same DB — parent-run, not part of this build.
