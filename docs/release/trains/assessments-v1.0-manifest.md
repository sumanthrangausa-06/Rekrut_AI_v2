# Train manifest — Assessments v1.0 (Train 5)

- **Module:** assessments (new registry entry) — staging v0.1 (existing, journey UNPROVEN) → v1.0 candidate. Dev version "1.0".
- **Base staging SHA:** `7e886c14a8fa1109c703f2472c8028b33dac5275` (Train 4 close-out, PR #1821) — re-verified live 2026-10-24 at assembly: `git ls-remote` dev `81b541acd`, staging `7e886c14a`, main `5fa8ade11`.
- **Train head (pre-manifest):** `8b5dcb7cc5a3928796d2a42c3e1e51a512a260cb` (55 cherry-picks on the base, zero conflicts).
- **Authorization:** Sumanth's standing promotion authorization (2026-10-22: "you build everything and promote to staging and then to main") + promotions-first priority (2026-10-24: "okay go ahead"). Train order per the programme body: cv-review (Train 3, done), job-board/profile (Train 4, done), then assessments carrying the #1606 staging-proof debt, then OmniScore.
- **Why this train:** #1606 (assessments not opening for previously-empty topics) was fixed and dev-proven through the #1603 catalogue chain (C0–C5: catalogue schema, seed groups A–C, coverage batches 1–5 — all 16 topics at coverage floor plus OOP) plus the Phase A reliability fix (#1602/#1606) and Phase B exit/full-screen work (#1604/#1605), but staging still runs pre-fix code and #1606 remains OPEN on staging proof only. This train promotes exactly that chain so Quinn can run the staging proof. #1603's catalogue legs ride the same proof.
- **Assembly note (concurrency):** the cherry-pick sequence was executed by a programme process already running against this worktree when Relay audited it (script `/tmp/train5-picks.sh`, picks.log in the goal hidden_files); Relay verified every landing first-hand (git log/reflog, diff, patch-ids, suites, fresh-install) per HL-007 instead of re-picking. Deviations from Relay's original brief are listed explicitly below — none are hidden.

## Ordered picks (dev merge order; all applied clean, zero conflicts)

| # | PR | Title | Dev merge commit |
|---|----|-------|------------------|
| 1 | #1339 | fix(db): migration 270 creates assessment_results (#1336) | `b7af0b27b` |
| 2 | #1369 | fix(client): preserve retryable/retryAfterMs on apiCall thrown errors (#1365) | `aae9709b1` |
| 3 | #1585 | fix(assessments): #1572 no fabricated 50 on short-answer evaluation failure | `3e8bcd9fc` |
| 4 | #1590 | fix(assessments): #1573 — no boilerplate templated question on generation failure | `ef81897ee` |
| 5 | #1598 | fix(#1584): assessment_graded fabricated confidence + admin ai_% reader defaults (items 2+4) | `50cc828be` |
| 6 | #1599 | fix(recruiter): pending assessment answers show Pending review, not incorrect (#1584 item 3) | `0fbf22b6d` |
| 7 | #1620 | fix(assessments): Phase A reliability — decouple recording/navigation/completion (#1602, #1606, #1612) | `f77dba9b7` |
| 8 | #1635 | docs(design): Rex — unified assessment exit + full-screen design (#1604 + #1605) | `d60b84a9d` |
| 9 | #1641 | feat(assessments): unified exit dialog + full-screen policy — Phase B (#1604, #1605) | `b6efab0d3` |
| 10 | #1644 | fix(assessments): migration 278 — allow 'published' in job_assessments status CHECK (#1642) | `83313e28e` |
| 11 | #1646 | test(assessments): static contract tests for migration 278 (#1642 follow-up) | `8efe4f666` |
| 12 | #1650 | docs(design): Rex architecture — #1603 Assessments redesign (Phase C) | `9019f4089` |
| 13 | #1662 | feat(assessments): #1603 C0 — catalogue schema 279/280 + seed/backfill + coverage audit (#1652) | `35f08d755` |
| 14 | #1663 | feat(assessments): seed Group A question banks — Node.js, SQL, TypeScript, Java (#1647) | `faf899dbc` |
| 15 | #1665 | fix(assessments): curation keys on full content; migration 282 demotes diverged rows (#1664) | `afff5bf28` |
| 16 | #1668 | feat(assessments): #1653 #1603 C1 — catalogue API + dual-read /available (approved-only servable) | `b94ea00ec` |
| 17 | #1669 | feat(assessments): seed Group B question banks — CSS & HTML, AWS, Docker, Git (#1648, #1606) | `040407e31` |
| 18 | #1673 | feat(assessments): seed Group C banks + complete legacy cells (#1649, #1606) | `3ede2449a` |
| 19 | #1675 | feat(assessments): #1654 #1603 C2 server — configuration, bands, mixed serving, approved-only pool, unified % score | `892b5a81f` |
| 20 | #1677 | feat(assessments): C2 client — configure → pre-flight → instructions → start (#1654) | `64ba6e456` |
| 21 | #1680 | fix(assessments): #1679 P1 — remove invented time figures + stale pre-flight race | `f444c2b27` |
| 22 | #1681 | feat(assessments): C2b — optional generation config on POST /generate (#1655) | `122587d20` |
| 23 | #1682 | fix(assessments): #1679 items 3-9 — honest C2 client residuals | `65a357724` |
| 24 | #1684 | feat(assessments): #1656 C3 — sets, retake differentiation, per-topic progress | `e687dbe91` |
| 25 | #1697 | fix(assessments): #1689 take-page AI-scoring disclosure gated on written formats | `4cde82ff8` |
| 26 | #1696 | fix(scripts): #1685 set-creation topic-membership check | `a88f11b50` |
| 27 | #1698 | fix(assessments): #1687 scope /start auto-abandon to same topic (+ #1685 item 2) | `0b5fddf2c` |
| 28 | #1700 | feat(assessments): C5 Batch 1 — coverage floor for JavaScript, Python, React, Node.js (#1691) | `a5160e29c` |
| 29 | #1701 | fix(assessments): #1691 — replace 6 defective Batch 1 rows (post-merge Interviewer BLOCK) | `23266581a` |
| 30 | #1702 | feat(assessments): C5 Batch 2 — coverage floor for SQL, TypeScript, Java, Data Analysis (#1692) | `2910c4be2` |
| 31 | #1703 | feat(assessments): C5 Batch 3 — coverage floor for AWS, Docker, Git, CSS & HTML (#1693) | `7dac8db46` |
| 32 | #1704 | fix(assessments): #1693 — correct merge/rebase explanation in migration 287 | `acd388664` |
| 33 | #1705 | feat(assessments): C5 Batch 4 — coverage floor for Communication, ML, PM, System Design (#1694) | `7e9c733da` |
| 34 | #1706 | test(assessments): pin take-page Coding disclosure boundary + whole-document AI-disclosure count (#1699) | `0d96304f8` |
| 35 | #1709 | fix(assessments): #1707 — gate/condition take-page AI-scoring claims outside the snapshot block | `7e1b5a090` |
| 36 | #1708 | feat(assessments): C5 Batch 5 — OOP topic + full 29-question bank (#1695) | `0571be00e` |
| 37 | #1711 | test(assessments): #1683 — pin legacy label contract (server defaults/band ↔ client label) | `eef1d7129` |
| 38 | #1713 | fix(assessments): #1710 — widen within the band before re-serving a repeat (scoped path) | `55e62bf73` |
| 39 | #1719 | fix(honesty): #1715 O1–O3 — null-guard integrity badge, honest NULL omni total, anti-cheat ?? null | `88583cefc` |
| 40 | #1720 | fix(assessments): #1686 — per-topic retake lockout on POST /start | `4d1f650ce` |
| 41 | #1722 | feat(assessments): #1688 — group My Results by topic (GET /results topic snapshot + Results tab grouping) | `59d568553` |
| 42 | #1730 | fix(assessments): #1716 — default-topic retake gate counts topic-less completions | `a004071d2` |
| 43 | #1736 | fix(aptitude): recruiter stats route shadowed by /:id — register /stats first (#1732) | `1e16dd4d5` |
| 44 | #1737 | fix(memory): unrecorded confidence is NULL, never a fabricated 0.8 (#1626) | `e8ccba152` |
| 45 | #1738 | fix(admin): agents stats avg_duration NULL when unmeasured, never fabricated 0 (#1625) | `f23da770a` |
| 46 | #1741 | fix(db): question_bank role nullable + widen type CHECK — recruiter saves stop 500ing (#1739) | `8c6a65c27` |
| 47 | #1742 | fix(recruiter): #1740 — question-bank POST accepts single-question shape + preserves question_type | `a5326150d` |
| 48 | #1765 | test(results): #1723 pin all 7 grouping labels + tighten /results harness discrimination | `e9da7f01f` |
| 49 | #1769 | fix(assessments): #1678 send verifiedEligible on completion payloads (GAP-4) | `9eaab8314` |
| 50 | #1774 | fix(assessments): #1670 pin catalog progress isolation predicates + explicit fallback join scoping | `cf2e09e53` |
| 51 | #1806 | test(assessments): #1627 restore graded-confidence suite (mock drifted from #1620 guard + #1654 grading) | `8b47cfbed` |
| 52 | #1809 | test(assessments): #1807 restore short-answer-honesty-1572 suite (mock drifted from #1620 guard) | `79088d29a` |
| 53 | #1810 | test(assessments): #1807 restore score-roundtrip suite (Phase B claim RETURNING drift) | `8744c14e1` |
| 54 | #1811 | test(assessments): #1807 restore retake-lockout suite (Phase A serve drift) | `39bad10c4` |
| 55 | #1812 | test(assessments): #1807 follow-up — tighten retake-suite skill-by-id mock branch (review SHOULD-FIX on #1811) | `6daab32a7` |

**Assembly result: 55 picks applied, 0 conflicts, 0 skipped from the executed list.** File-set diff vs staging = 120 files = exactly the union of the 55 pick file-sets, with ONE explained net-zero exception: `docs/sdlc/rekrut-ai-v2/04-implementation/assessments-c2-client-1654-build-log.md` (touched by #1677/#1682) exists on neither the train tree nor the dev tip, so it contributes no net diff. **Patch-ids: 55/55 MATCH** (Lead first-hand: every train commit's patch-id vs its dev merge diff-vs-first-parent — full check, not a sample). Relay's independent 5/5 sample (#1339, #1620, #1662, #1700, #1741) agrees.

## Deviations from Relay's original brief (all deliberate in the executed list, recorded for the reviewer)

- **Added before #1620 (5 picks):** #1369 (client `api.ts` retryable-error glue that #1620/#1677 build on), #1585 (#1572 short-answer honesty — the original fix whose suite #1809 restores), #1590 (#1573 boilerplate guard — suite pinned by #1675), #1598 (#1584 graded-confidence honesty, `routes/assessments.js` leg; also touches `routes/admin.js` ai_% reader), #1599 (#1584 recruiter pending-state, recruiter assessments page). All assessment-surface or direct glue; without #1585/#1590 the train's own restored suites would pin behaviour staging never received.
- **#1676 EXCLUDED (per brief):** its file set is `routes/auth.js` only (Polsia payment-verify timeout, #1666) — it does NOT touch `routes/assessments.js`, so the brief's inclusion condition fails.
- **Scope-flagged inclusions (reviewer: rule on these):** #1719 touches `services/omniscore.js` + `services/document-verification.js` alongside its `assessments.tsx` integrity-badge leg (#1715 O1–O3) — the brief said exclude OmniScore PRs; the executed list kept it because O1 (null-guard integrity badge) is an assessments-surface fix and its client suite rides this train. #1736 (`routes/aptitude.js` stats route order), #1737 (`services/memory-service.js` confidence honesty), #1738 (`routes/admin.js` avg-duration honesty) are non-assessment honesty fixes that were in the brief's pick list and were kept. #1742 (`routes/recruiter.js` question-bank POST contract) is kept as the API half of the #1741 question-bank pair (migrations 291/292).
- **Excluded per brief:** #1714 (migration 290, #1280 — separate approved lane; confirmed absent: no `290_` in the train diff), #1661, #1671, and all other OmniScore PRs.

## Migrations carried: 18 (all up-paths additive / expand-only)

| Migration | Verdict |
|---|---|
| 270_assessment_results | CREATE TABLE IF NOT EXISTS — additive (score cast noted by Scout; no contraction) |
| 274_assessment_sessions_abandoned_status | CHECK drop+re-add widened with 'abandoned' — expand |
| 276_assessment_exit_drafts | ADD COLUMN IF NOT EXISTS (draft columns) — additive (drops exist only in the never-run down path) |
| 277_job_attempt_flags_events | ADD COLUMN + backfill UPDATE + SET NOT NULL on new columns — additive |
| 278_job_assessments_published_status | CHECK drop+re-add widened with 'published' — expand |
| 279_assessment_catalogue | CREATE TABLE ×4 (subjects/topics/sets/set_questions) — additive; the one non-idempotent CREATE per Scout (runner skips recorded filenames on re-run) |
| 280_assessment_question_provenance | ADD COLUMN IF NOT EXISTS provenance columns — additive |
| 281_seed_group_a_question_bank | Seed INSERTs, idempotent (ON CONFLICT/guard) — additive |
| 282_curation_content_integrity | UPDATE demoting diverged curation rows (#1664) — data-touching, no deletes, no schema change |
| 283_seed_group_b_question_bank | Seed INSERTs, idempotent — additive |
| 284_seed_group_c_question_bank | Seed INSERTs, idempotent — additive |
| 285_seed_batch1_question_bank | Seed INSERTs, idempotent — additive |
| 286_seed_batch2_question_bank | Seed INSERTs, idempotent — additive |
| 287_seed_batch3_question_bank | Seed INSERTs, idempotent — additive |
| 288_seed_batch4_question_bank | Seed INSERTs, idempotent — additive |
| 289_seed_batch5_question_bank | Seed INSERTs, idempotent — additive |
| 291_question_bank_role_nullable | ALTER COLUMN role DROP NOT NULL — widen |
| 292_question_bank_type_check_widen | CHECK drop+re-add widened — expand |

NOT carried: 290 (#1280 DROP DEFAULT — separate approved lane), 293, 267/271/272/273/275 (other modules). Scout's Train 5 migration check (goal hidden_files `train-5/migration-check.md`): SAFE WITH CONDITIONS — migrate.js floats some async migration promises, so a post-deploy probe of question_bank parity + assessment_results/276/278 state on staging is MANDATORY; do not trust the deploy log alone. The expand→migrate→contract rule is respected: no carried migration contracts a live structure on its up path.

## Pre-merge checks (Relay, first-hand, 2026-10-24, train tree)

- **Server suites** (jest, train tree): assessments-* routes (17 files) + recruiter-question-bank-1740 + migrations 278/291/292 — **20 suites PASS / 1 skipped, 184 tests passed / 19 skipped, 0 failed**. Byte-identical counts on the dev tip (same command). The skipped suite is `assessments-verified-eligible-1678` — DB-gated (`describeIfDb`), skips identically on dev.
- **Client suites** (vitest, train tree): assessment-configure-1654, assessment-take-1654, assessments-legacy-label-1683, assessments-results-grouping-1688, AssessmentsIntegrityHonestNull1715, RecruiterAssessmentPendingState, RecruiterJobAssessmentUnscoredBucket, apiRetryableError — **8 files, 77/77 PASS**, identical on the dev tip.
- **Fresh-install migration check** (train tree, local PG 16 on 127.0.0.1:55433 — the TOOLS.md custom PG 18.4 install is absent on this VM, system PG 16 + pgvector used; DB `train5_fresh`, dropped after): `DATABASE_URL=… node migrate.js` exit 0, "All migrations completed successfully", **183 migrations applied** including all 18 carried train migrations in order; catalogue read-back: **19 subjects / 17 topics / 495 assessment_questions**. Reproduced on a second fresh DB with identical results.
- Test rig note: train worktree ran suites with `node_modules` symlinked from the dev checkout (train and dev `package.json` are identical; no dependency rides this train beyond a 1-line package.json addition already present on dev).

## Retest plan (staging, after deploy — Quinn witnessed by Relay)

- **#1606 (primary):** fresh TEST candidate on staging → open an assessment for a previously-empty topic (one of the C5/seed-covered topics) → the assessment opens and STARTS (the exact user complaint); bank parity read-back: staging catalogue counts (subjects/topics/questions via the catalogue API / DB read) match the fresh-install baseline (19/17/495, allowing for staging's pre-existing rows — parity is per-topic coverage floor, not raw equality).
- **#1603 catalogue legs:** catalogue API serves approved-only topics; configure → pre-flight → instructions → start flow works for a configured topic; per-topic progress and My Results grouping render; retake lockout is per-topic (#1686).
- **#1602/#1612 leg:** submission completes without hang; timer auto-submit fires.
- **#1604/#1605 leg:** unified exit dialog + full-screen policy behave per Rex's design on the take page.
- **Mandatory post-deploy probe (Scout condition):** question_bank parity + assessment_results / 276 / 278 state read back on staging after migrations run — deploy log alone is not evidence.
- **Neighbour:** staging /health 200 warm; Job Board + Profile (Train 4) and CV Review (Train 3) surfaces still green.
- Partial pass = FAIL; the tag `staging/assessments@v1.0`, the registry close-out, and the #1606 closure wait for a full pass. #1603 stays open on its remaining gated sub-story regardless (C4 #1657 gated on #118).

## Boundary

- No env changes, no `RETENTION_PURGE_LIVE`, no data writes beyond TEST accounts created by the retest itself.
- Migration 290 (#1280) does NOT ride this train.
- Main promotion only after the staging retest passes in full (dual-environment rule).
- Rollback is by forward code fix only (migrations never un-apply on the shared staging/production database).
