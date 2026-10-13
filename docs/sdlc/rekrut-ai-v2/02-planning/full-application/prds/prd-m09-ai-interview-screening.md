# PRD — M9: AI Interview & Screening

**State (verified, Scout §2): WORKS; analysis hand-rolled inline per feature.** **Surfaces:** `routes/interviews.js`, `screening.js`, `ai-screener.js`, `quick-practice.js`, `ai.js`, `voice.js`, `services/interview-ai.js` (9 exports) · client: mock-interview, ai-screening, screening, voice-screening, quick-practice.

## 1. Purpose & users
The AI-run interview modes: candidate **mock practice** (candidate-only feedback), **AI screening** on real applications, voice screening, and Quick Practice drills. Users: candidates (practice + screening), recruiters (screening results).

## 2. End-to-end journey
*Practice:* candidate starts a mock → conversational/voice session (`InterviewSession` runtime; `ai-screening.tsx` is a dashboard, not a runtime) → transcript → inline AI analysis → results page with qualitative feedback. *Screening:* recruiter sends (M6) → candidate completes a conversational screening (`routes/screening.js` analyze/batch/questions/compare) → report lands in the pipeline. Quick Practice runs isolated drills under its own router.

## 3. Current state (verified)
All modes run. Analysis is generated **inline in `routes/interviews.js`, hand-rolled per feature** — the S-049 panel finding: the spec's `AnalysisService`/`IntegrityService` never existed, and **none of `services/interview-ai.js`'s 9 exports transfer** to the Observer path (S-082, verified). Legacy heuristic fallbacks in this family fabricate scores when AI fails (flat-5 / length-based) — a documented anti-pattern (S-082) that practice sessions inherit today (relevant to M12/#791's exclusion rule). Retired legacy writes return 410 (S-074). `GET /screening/sessions` embeds **full transcripts** for the monitor page — an over-send surface awaiting Sumanth's scope ruling since 2026-10-12.

## 4. Gap to launch-ready
(1) The screening-sessions over-send ruling + resulting fix. (2) Fallback-score hygiene: any session whose score came from a fallback must be marked as such at the data layer (precondition for #791's exclusion rule in M12). (3) Nothing else functional — the panel ruled legacy inline analysis is **left alone pre-launch** (high blast radius, no user payoff); opportunistic extraction only, modernisation is Sage's post-launch phase.

## 5. Functional requirements
- FR-M09-1: Mock practice results are candidate-facing feedback only at the point of production; any downstream use obeys the 2026-10-12 ruling (M12 PRD) — this module produces the data, M12 governs its consumption.
- FR-M09-2: Every AI-generated score carries provenance (model-scored vs fallback-scored); fallback-scored sessions are marked in storage, not just in logs.
- FR-M09-3: Screening monitor data follows S-087 minimisation once Sumanth rules the scope (full transcripts only via a gated single-session read, as with interview sessions).
- FR-M09-4: AI screening shares qualitative feedback with the candidate but issues **no formal candidate report** (Sumanth's decision, 2026-10-10/11) — unchanged.

## 6. Non-functional
- Honesty: no score may be presented that the producing path cannot explain (the fallback-marking rule, FR-M09-2, is the mechanism).
- Privacy: screening transcripts are candidate PII; retention/erasure follow M19 (interviews family is covered).
- Responsive: mock + screening runtimes are phone-first candidate surfaces; the iOS voice path has a parked known issue (PR #549 closed unmerged — revisit only on Sumanth's ask; not a launch requirement as filed).

## 7. Dependencies (verified states)
M8 engine (exists) · M12 consumption rules (exist as ruling; code gap is M12's) · `lib/ai-provider.js` + self-hosted audio (exist).

## 8. Sprint 11 overlap
None (Sprint 11's #793 touches M12's pipe, not this module's producers — sequencing note for Lead).

## 9. ⚠ Unverified
Which inline analysis paths still reach a fallback in production configuration; Quick Practice's isolation under the current mount order (asserted by Scout, not re-run).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M09-1: the screening-sessions over-send.** Same shape as S-087: trim the monitor list payload, move full transcripts behind the gated single-session read — as its own small story, or accept the surface as-is for launch?
  **Rex's recommendation: fix it, as its own story, before launch.** It is the same defect Sumanth already ruled "fix it" on for interview sessions (F-1); leaving the identical pattern live on the screening side would be an inconsistent privacy posture, and the fix pattern is now proven and cheap.
