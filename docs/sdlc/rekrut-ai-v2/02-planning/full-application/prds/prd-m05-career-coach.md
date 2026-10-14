# PRD — M5: Career Coach & Candidate AI Tools

**State (verified, Scout §2): BUILT, uneven depth.** **Surfaces:** `routes/career-coach.js`, `profile-enhancement.js`, `lib/career-coach-ai.js` · client: career-coach (7 tabs), cv-review, linkedin-optimizer, ai-coaching, career-diagnosis.

## 1. Purpose & users
Candidate-side AI help that is *not* the hiring path: career coaching, CV review, LinkedIn optimisation, diagnosis. Users: candidates only. Nothing in this module is shown to recruiters — that boundary is its defining rule (and the same boundary Sumanth's mock-scores ruling drew for practice, M12).

## 2. End-to-end journey
Candidate opens the coach → 7 tabs call real endpoints backed by `lib/career-coach-ai.js` → CV review and LinkedIn tools run from profile-enhancement routes. Depth is uneven: the LinkedIn tips endpoint is **explicitly mock** (`routes/profile-enhancement.js:9` — "AI-generated optimization tips (mock)").

## 3. Current state (verified)
Built and reachable; never part of any launch-critical ruling. No fake-score exposure (coaching output is qualitative), but mock-grade endpoints presented inside a real UI are an honesty risk of the same family as the no-fake-scores rule.

## 4. Gap to launch-ready
Entirely a **scope decision**: (a) ship in January as-is (mock endpoints labelled honestly or removed from the UI), (b) ship with the mock-grade surfaces cut, or (c) defer the module past launch. Engineering gap under (a)/(b) is small: find every mock-grade surface, label or cut it.

## 5. Functional requirements
- FR-M05-1: No endpoint may return mock/placeholder content presented as real AI output. Each mock-grade surface is either wired to a real provider, visibly labelled as a demo/limited feature, or removed from the client.
- FR-M05-2: Coach data stays candidate-private — no coach content in any recruiter surface, search index, or score input (same boundary as #792's marker guardrails).
- FR-M05-3: AI calls go through `lib/ai-provider.js` (the platform cascade) — no module-local provider keys or ad-hoc endpoints.

## 6. Non-functional
- Cost: $0-budget rule — coach features must run on the existing provider cascade within its limits; no new paid AI dependency at launch.
- Responsive: candidate mobile-primary, full device matrix.

## 7. Dependencies (verified states)
M4 profile data (exists) · `lib/ai-provider.js` cascade (exists; several providers balance-limited per the AI-keys record — capacity is an operations fact, not assumed).

## 8. Sprint 11 overlap
None.

## 9. ⚠ Unverified
Which endpoints beyond LinkedIn tips are mock-grade (Scout verified one explicitly; a full sweep was not done); coach usage volume (no analytics evidence pulled).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M05-1: M5 in or out at launch?** In-as-is (with FR-M05-1 honesty fixes) / in-with-mock-surfaces-cut / deferred past launch.
  **Rex's recommendation: in, with mock-grade surfaces cut or labelled (option b-lite).** The coach is candidate goodwill that costs little to keep honest; deferring it saves almost nothing because it's already built, and shipping silent mocks would break the honesty standard the whole launch is being sold on.
