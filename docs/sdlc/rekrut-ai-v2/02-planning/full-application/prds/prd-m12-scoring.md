# PRD — M12: Scoring — OmniScore, Fit, Trust

**State (verified, Scout §2): PARTIAL — two verified defects against stated decisions.** **Surfaces:** `routes/omniscore.js`, `fitScore.js`, `trustscore.js`, `services/omniscore.js` (1,246 lines) · client: candidate/omniscore, recruiter/omniscore, recruiter-trustscore, leaderboard.

## 1. Purpose & users
One explainable candidate score (OmniScore v2: 8 factors, weights 25/20/15/10/10/10/5/5 — **hypotheses until validated**), plus the older fit-score and trust-score systems. Users: candidates (own score + factor explanations), recruiters (score as one input among many).

## 2. End-to-end journey
Candidate practises / is evaluated → engine recomputes from its input tables → factor cards render (cold-start = "Insufficient data" per factor — honoured, no fake scores) → candidate + recruiter pages display. Intended evidence: real interview evaluations. **Actual evidence today: predominantly practice** (see §3).

## 3. Current state (verified — Rex's findings, re-verified by Scout this pass)
- **Defect 1 (ADR-R1, #791):** `services/omniscore.js:145-147` reads `practice_sessions`; `:272-278` averages **every attempt ever** and blends practice into the composite (up to ~half of the 20% interview-performance factor + part of the 10% soft-skills factor). This is the **opposite of Sumanth's 2026-10-12 ruling** (practice OUT → labelled readiness panel). Code unchanged since the ruling.
- **Defect 2 (ADR-R2, #793):** real `interview_evaluations` scores effectively never reach the engine — the pipe reads a table the engine never reads. (Mirror image of Defect 1: the score is practice-driven while presenting as evaluation-driven.)
- Fit score and trust score are separate older systems; trust exists twice (`services/trustscore.js` + `trustscore-standalone.js` — #175 deletion candidate since 2026-10).

## 4. Gap to launch-ready
Execute the ruling (#791 removal + readiness panel; #792 practice-fact marker with its six guardrails) and fix the pipe (#793). Sumanth ruled the removal **scheduled separately** (one-time score drop for practised candidates is a correction, announced via version note). Sprint 11 D1 placed #791/#792 as **Sprint 12's lead pair** and #793 inside Sprint 11 — this PRD states requirements; that sequencing stands until Sumanth changes it.

## 5. Functional requirements
- FR-M12-1 (#791): practice data contributes **zero** to OmniScore. The readiness panel shows role, completed-session count, latest result, trend, date — labelled as practice (self-directed, not proctored, not part of OmniScore). Mock and Quick Practice are never averaged together; fallback-scored sessions (M9 FR-M09-2 provenance) are excluded from anything recruiter-facing; the panel never feeds ranking/filtering/matching/auto-reject; candidate sees exactly what the recruiter sees; no practice = zero numeric effect and an honest empty state.
- FR-M12-2 (#792): the practice-fact marker is candidate **opt-in, default OFF** (fail-closed); counts/dates only, never scores or coaching; absence renders as nothing; role-tied; never a filter/sort/rank input; the existing recruiter endpoint exposing **full practice history + scores + coaching is narrowed** to this contract.
- FR-M12-3 (#793): real evaluation scores reach the engine through one documented pipe; a regression test proves a recorded evaluation moves the factor it claims to feed. Any weight change remains forbidden until hiring-outcome validation data exists (weights-as-hypotheses rule).
- FR-M12-4: Score changes from FR-M12-1/3 ship with a version note (the drop is a correction, announced — ruling's terms).

## 6. Non-functional
- Honesty: factor cards keep the "Insufficient data" cold-start; no factor may silently count missing data as low in the total (the pre-ruling hidden-penalty pattern is a named defect of the old engine).
- Privacy: score inputs are candidate data; erasure coverage for scoring tables is verified present (M19) and must survive the #791/#793 changes.
- Database lens: the engine's input set is a documented table list — any new input joins it via review, not by a route quietly writing a table the engine happens to read (the #793 failure mode, inverted).

## 7. Dependencies (verified states)
M9 practice producers (exist; provenance marking is FR-M09-2) · M10 evaluations (exist) · M7 readers must honour FR-M07-4 (marker never a ranking input).

## 8. Sprint 11 overlap
#793 is inside Sprint 11 per D1. #791/#792 are Sprint 12 lead pair per D1. This PRD changes neither.

## 9. ⚠ Unverified
Live score distribution impact of the removal (needs DB read); whether trust-score's two implementations diverge in behaviour or only in code.

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M12-1: trust-score duplication (#175).** Delete `trustscore-standalone.js` (ponytail cleanup, filed since 2026-10) or keep both?
  **Rex's recommendation: delete the standalone after a one-pass caller check** — two implementations of one score is the same split-brain disease as M10's scorecards, at smaller scale.
- **D-M12-2:** None on the ruling itself — it is made; D1 sequencing stands unless you move it.
