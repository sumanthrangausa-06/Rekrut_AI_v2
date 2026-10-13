# PRD — M12: Scoring — OmniScore (Two-Sided)

**State (verified): PARTIAL — the documented model is two-sided and per-pairing; the code implements one global candidate score on the wrong inputs, plus fragments of the rest.** **Surfaces:** `routes/omniscore.js`, `fitScore.js`, `trustscore.js`, `services/omniscore.js` (1,246 lines), `services/trustscore.js` + `trustscore-standalone.js` · client: candidate/omniscore, recruiter/omniscore, recruiter-trustscore, leaderboard.
**Amended 2026-10-13** on Sumanth's product input: *"there is a candidate score AND a company score, both known as OmniScore, and OmniScore works according to that particular candidate and that particular company."* This PRD now models both sides from the previous docs; where the docs are silent, the question is boxed in §10 with the evidence quoted — not invented.

## 1. Purpose & users
OmniScore is the platform's two-sided trust number:
- **Candidate OmniScore** — a candidate's evidence-based standing, designed to be **contextual**: role-specific scores and company-specific fit ("how candidate fits YOUR company" — `docs/guides/FEATURE_MAP.md`, "Missing OmniScore Features").
- **Company OmniScore** — a company's trustworthiness **for candidates** (documented in code/docs as the *Employer Trust Score*): verification, job authenticity, hiring ratio, candidate feedback, behaviour. Its stated purpose is **candidate protection** — "lower scores warn candidates about potentially problematic employers" (`docs/analysis/ai-services-analysis.md` §3.7).
Users: candidates (own score, role scores, company scores on company/job surfaces, mutual fit), recruiters (candidate scores in their context, their own company's score).

## 2. The documented model (evidence, mined from previous docs)

**Candidate side** — 8 factors, weights 25/20/15/10/10/10/5/5 (Verified Skills / Interview Performance / Experience Quality / Education / Reliability / Soft Skills / Market Demand / Growth Trajectory — `FEATURE_MAP.md`; weights are hypotheses until validated, #113). Designed companions: explainability ("why is my score 650?"), historical trend, improvement recommendations, **role-specific scores** ("700 for frontend, 550 for backend"), **company-specific scores**, **peer comparison per role** ("top 20% for your role"), fraud detection.

**Company side** — `services/trustscore.js`, 0–1000 scale, **component architecture mirroring the candidate score, including the same time-decay formula** (`POWER(0.95, days/30)`): Verification 200 · Job Authenticity 250 · Hiring Ratio (interview-to-offer) 250 · Feedback (candidates rate interview experience) 200 · Behaviour 100. Inputs include candidate ratings of companies (`company_ratings`, migration 030: UNIQUE(company_id, candidate_id)). Designed surfaces: company profile pages, job listings (trust badges), candidate decision-making UI.

**Per-pairing layer** — `mutual_matches` (migration 030: one row per candidate–company–job, `company_score` default 500, `company_interest` flag) and a live endpoint (`routes/omniscore.js` ~:395) computing **mutual fit = geometric mean of candidate strength × company strength (trust ÷ 1000) × skill-match strength**, returned candidate-facing with `your_omniscore`, the company's score, and the fit level.

**Visibility model** (Sumanth, 2026-10-10 — interview PRD §"OmniScore Visibility Model"): the causal link between an interview and the score is invisible to everyone.

| Visibility | Candidate | Recruiter |
|---|---|---|
| OmniScore number | ✅ | ✅ |
| Activity feed ("completed AI interview Oct 10") | ✅ | ✅ |
| Score delta from this interview | ❌ | ❌ |
| Interview-specific scores | ❌ | ✅ |
| Qualitative feedback | ✅ | ✅ |
| Integrity flags/evidence | ❌ | ✅ (integrity *observations* — no aggregate integrity score, per OQ-2) |

## 3. Current state (verified — code vs the model above)
- **Candidate composite = one global number.** `computeFactors(userId)` takes no company/role parameter; peer percentile (`services/omniscore.js:796-802`) is computed across **all** candidates' total scores, not a per-role cohort.
- **Role scores exist but float free of the composite:** `role_scores` (best score per role, `GREATEST` upsert, interview_count) is written (`services/omniscore.js:1200-1212`) and served (`routes/omniscore.js:46,453`) — the composite neither reads role context nor varies by it.
- **Company score exists under another name:** trustscore is live (plus its duplicate `trustscore-standalone.js`, #175) and surfaces in the mutual-fit endpoint and a recruiter-trustscore page — but nothing in code or docs brands it "OmniScore"; Sumanth's 2026-10-13 statement names both sides OmniScore (see D-M12-3).
- **Mutual fit exists** (the endpoint above) — the only genuinely per-pairing computation in the product; its candidate-strength input inherits the composite's defects below.
- **Defect 1 (ADR-R1, #791):** practice feeds the composite — `services/omniscore.js:145-147` reads `practice_sessions`; `:272-278` averages **every attempt ever** into up to ~half of the 20% interview-performance factor + part of the 10% soft-skills factor. Opposite of the 2026-10-12 ruling (practice OUT → readiness panel). Code unchanged since the ruling.
- **Defect 2 (ADR-R2, #793):** real `interview_evaluations` scores effectively never reach the engine — the pipe reads a table the engine never reads. The score is practice-driven while presenting as evaluation-driven.
- Cold-start renders "Insufficient data" per factor — honoured (no fake scores). Fit score is a third, separate system (M7's surface).

## 4. Divergence — documented model vs code, and what the filed stories cover

| Documented element | Code today | Covered by |
|---|---|---|
| Practice is not score evidence (ruling) | Practice feeds composite | **#791** (removal + readiness panel) |
| Practice-fact visibility (ruling) | Full history exposed to recruiters | **#792** (opt-in marker + endpoint narrowing) |
| Evaluations drive the score | Pipe disconnected | **#793** |
| Company-specific candidate score ("fits YOUR company") | Absent — composite is global; only mutual-fit approximates pairing context | **NOT covered** |
| Role-specific scores connected to the composite | role_scores exist, composite ignores role context | **NOT covered** (table + endpoints only) |
| Peer comparison per role | Global-cohort percentile | **NOT covered** |
| Company OmniScore as a named, unified product | Live as "TrustScore" (+ duplicate impl.) | **NOT covered** (naming/unification undecided — D-M12-3) |
| Mutual fit per pairing | Exists (one endpoint) | Exists; input hygiene improves automatically when #791 lands |
| Visibility model (delta hidden etc.) | Implemented per the PRD table on the surfaces Scout traced | — (verify per surface at QA) |

**Uncovered remainder = scope candidate "Two-sided OmniScore completion"** (D-M12-4): company-specific candidate context + per-role percentile cohort + composite↔role-score connection + company-score unification. It is named here, **not sized** — sizing is Lead's, after Sumanth rules it in or out.

## 5. Gap to launch-ready
For January, the launch-blocking part is the *ruled* part: #791/#792/#793 (sequencing per Sprint 11 D1: #793 inside Sprint 11; #791/#792 = Sprint 12 lead pair). The two-sided completion (§4 remainder) is a scope decision, not a January defect — the product must simply not *claim* per-company candidate scores it doesn't compute (the honesty rule; any surface implying them is an S1-class claims defect).

## 6. Functional requirements
- FR-M12-1 (#791): practice contributes **zero** to the candidate composite. Readiness panel (role, completed count, latest, trend, date; labelled practice) beside the score; mock ≠ Quick Practice averaging; fallback-scored sessions excluded recruiter-facing; panel never feeds ranking/filtering/matching/auto-reject; candidate sees exactly what the recruiter sees; no practice = zero numeric effect.
- FR-M12-2 (#792): practice-fact marker — candidate opt-in default OFF, counts/dates only, absence renders as nothing, role-tied, never a tool input; the full-history recruiter endpoint is narrowed to this contract.
- FR-M12-3 (#793): real evaluations reach the engine via one documented pipe; a regression test proves a recorded evaluation moves its factor. Weights stay frozen until hiring-outcome validation exists.
- FR-M12-4: score changes from FR-M12-1/3 ship with a version note (announced correction, per the ruling).
- FR-M12-5: the visibility model (§2 table) holds on every surface that shows either score — deltas hidden from both sides; interview-specific scores and integrity observations recruiter-only; the company score is candidate-visible on company/job surfaces per its documented purpose (candidate protection), and a company sees its own score (recruiter-trustscore surface exists).
- FR-M12-6: any future per-pairing computation (mutual fit successors) must consume the *corrected* inputs (post-#791/#793) — no new surface may be built on the practice-fed composite.

## 7. Non-functional
- Honesty: factor cards keep "Insufficient data"; no factor silently counts missing data as low in a total; a per-pairing number may only be displayed where a per-pairing computation actually ran.
- Privacy: both scores are personal/company data under M19; scoring tables' erasure coverage is verified present and must survive #791/#793; candidate ratings of companies (company score's Feedback input) are candidate data — a company must never be able to identify which candidate rated it (aggregation/anonymity is a design requirement for any company-score surface change).
- Database lens: the engine's input set is a documented table list; new inputs join by review (the #793 failure mode, inverted).

## 8. Dependencies (verified states)
M9 practice producers (exist; provenance = FR-M09-2) · M10 evaluations (exist) · M7 surfaces consume scores + mutual fit (exist) · M6 pipeline displays scores in application context (exists — see PRD-M06 two-sided note) · M21 analytics reports both sides (see PRD-M21 note).

## 9. Sprint 11 overlap
#793 inside Sprint 11 (D1); #791/#792 are Sprint 12's lead pair (D1). Unchanged by this amendment.

## 10. ⚠ Unverified
Live score-distribution impact of the #791 removal (needs DB read); whether trustscore's two implementations diverge behaviourally; whether company_ratings are actually being written by any current flow (the Feedback component's data supply); per-surface fidelity to the visibility model (traced, not exhaustively audited).

## 11. ▣ DECISIONS FOR SUMANTH
- **D-M12-1: trust-score duplication (#175).** Delete `trustscore-standalone.js` after a one-pass caller check? **Rex: yes** — two implementations of one score is M10's split-brain disease at smaller scale.
- **D-M12-2:** the mock-scores ruling itself is made (recorded, §6) — no new decision; D1 sequencing stands unless you move it.
- **D-M12-3 (NEW — naming):** the docs and code call the company side **"TrustScore"**; your 2026-10-13 statement calls **both** sides OmniScore. Is the company score to be **renamed/unified as OmniScore** in product (one brand, two sides), or does "TrustScore" stay as the company side's name under the OmniScore family?
  *Evidence: `services/trustscore.js` header — "Employer Trust Score … for candidate protection"; `routes/omniscore.js:420` already presents it inside an OmniScore response as `company_score: TrustScore …`.*
  **Rex's recommendation: unify the brand as OmniScore (candidate OmniScore / company OmniScore), keeping "trust" as the company score's descriptor in explanations.** One name is what you described, and candidates meeting two score brands for one concept is a comprehension tax — but this is a product-identity call, so it is yours, and it should be made before any company-score surface work.
- **D-M12-4 (NEW — scope candidate): two-sided completion.** The documented intent (FEATURE_MAP: company-specific + role-specific + per-role peer comparison) is only fragmentarily built, and **#791/#792/#793 do not cover it**. Rule it **in** as a scoped workstream (Lead sizes it; it would sit naturally with/after the Sprint 12 OmniScore pair), **defer** it post-launch as named scope, or **drop** the per-pairing composite ambition and keep mutual-fit as the only pairing surface?
  **Rex's recommendation: defer as named post-launch scope, decided now.** The January launch is defensible with an honest global candidate score + mutual fit; but the per-pairing model is your stated product definition, so it should be recorded as committed-direction scope — not left as a doc aspiration that quietly dies, and not rushed into the launch window on top of #791/#793.
- **D-M12-5 (NEW — percentile cohort):** peer percentile is global today; the design language says per-role ("top 20% **for your role**"). Part of D-M12-4 if deferred; if D-M12-4 is ruled *in*, the cohort definition (role taxonomy source) needs its own line in that scope. **Rex: fold into D-M12-4** — deciding it separately invites a half-built cohort.
