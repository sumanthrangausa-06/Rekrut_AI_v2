# PRD — M7: Matching & Discovery

**State (verified, Scout §2): WORKS with an open P1 cluster.** **Surfaces:** `routes/candidateSearch.js` (859 lines), `matching.js`, `fitScore.js`, `candidate-company-matches.js`, `lib/job-alert-matcher.js` · client: recruiter/candidates, top-matches, company-matches, ai-search.

## 1. Purpose & users
Recruiters find candidates; candidates get discovered and alerted. Users: recruiters (search, top matches, company matches, AI search), candidates (job alerts).

## 2. End-to-end journey
Recruiter searches with filters → results paginate → candidate preview → invite to apply. In parallel: matcher computes company matches and job alerts for candidates.

## 3. Current state (verified)
All surfaces exist and function. Open P1 cluster from the 2026-10-07 candidates-page audit: **#405** (10 verified bugs — incl. snake_case/camelCase field mismatches so photos/experience/scores/availability silently never render, backend ignoring status tabs, pipeline stats counting the wrong population, bulk status update 500s, preview shape mismatch), **#414** (pagination dead), **#416** (preview/invite bypass soft-delete + opt-out). Soft-deleted users are hidden per Sumanth's ruling; rows are never deleted pre-launch (#151).

## 4. Gap to launch-ready
Close the #405/#414/#416 cluster with per-item re-verification (the cluster is Oct-2026-verified; re-check each item against current code before fixing — the Feb-cluster lesson, M13). The launch-blocking member is #416: it breaks the candidate-visibility promise (privacy), not just UX.

## 5. Functional requirements
- FR-M07-1: Search results render every field the API contract promises (contract test on the candidate card shape — kills the snake/camelCase class permanently).
- FR-M07-2: Pagination works end-to-end (server honours page params; client renders them) — #414.
- FR-M07-3: Preview and invite honour soft-delete and candidate opt-out/visibility exactly as M4's settings define (FR-M04-1's reader side) — #416.
- FR-M07-4: Ranking/filter inputs must never include the practice-fact marker or practice data (guardrail from the 2026-10-12 ruling, #792) — search is a named "never a tool input" surface.
- FR-M07-5 (two-sided): matching consumes **both** scores plus the pairing layer (PRD-M12 §2): the candidate OmniScore (in role context where role_scores exist), the company Trust Score on candidate-facing ordering/badges, and mutual fit per candidate–company–job. Each side's display follows the M12 visibility model; neither side's score may be used as a *hidden* filter against the other side (a company must not be silently buried for a low trust score, nor a candidate for a low composite — ordering influence must be explainable in the UI's own terms).

## 6. Non-functional
- Privacy: recruiter search is the highest-volume candidate-data surface; list payloads follow S-087 minimisation (no full profiles in list rows).
- Responsive: recruiter search is desktop-primary but must remain usable on tablet; candidate alerts are mobile surfaces.

## 7. Dependencies (verified states)
M4 profile/visibility data (exists; #416 is the violation) · M12 scores as display fields (exist; their correctness is M12's) · M18 alerts delivery (exists).

## 8. Sprint 11 overlap
None filed; #416's fix is adjacent to Sprint 11's authorisation theme — Lead may sequence it with the spine, but it is not in the approved sprint scope as filed.

## 9. ⚠ Unverified
Which of #405's 10 items remain live after the Sprint 9–11 changes (needs the per-item re-verification in §4); AI-search quality (no evaluation exists).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M07-1 (two-sided silence):** the docs say the company's Trust Score exists for *candidate protection* and display (badges), but do not state whether it may influence **candidate-facing job/company ordering** (ranking), or is display-only. **Rex's recommendation: display-only at launch** — badges and the company page, no ranking weight — until the Feedback input's data supply is verified (PRD-M12 §10 unverified item); ranking on an unverified input would bury companies for data we can't yet defend.
- Otherwise none. (If Lead proposes pulling #416 into Sprint 11, that is a sprint-scope change at your sprint-review gate, per the P0-trio precedent.)
