# PRD — M13: Assessments & Coding

**State (verified, Scout §2): BUILT; verification debt.** **Surfaces:** `routes/assessments.js`, `aptitude.js`, `coding-templates.js`, `coding-submissions.js`, `sandbox.js`, `questionnaire.js` · client: assessments, aptitude-tests, job-assessment, screening-questionnaire.

## 1. Purpose & users
Structured evaluation beyond interviews: aptitude tests, job assessments, coding challenges with a sandboxed runner, and screening questionnaires. Users: recruiters (assign), candidates (take), hiring team (results).

## 2. End-to-end journey
Recruiter attaches an assessment to a job/application (one of M6's INSERT-adjacent paths, `assessments.js:1476`) → candidate completes it (coding runs in `routes/sandbox.js`) → results render for candidate + recruiter.

## 3. Current state (verified)
All surfaces exist and are wired. The debt: the Feb-2026 "completely broken" cluster (#243 aptitude path mismatch et al.) is **at least partially stale** — Scout's spot checks found several sibling endpoints now existing (calendar connect, one-click apply, screening analyze). Each cluster issue needs its own re-verification before anyone trusts or closes it. #118 (sandbox security audit) remains open — the sandbox executes candidate code, so its audit is a security item, not hygiene.

## 4. Gap to launch-ready
(1) Per-item re-verification of the Feb cluster (verify-then-close-or-fix, one by one — the standing lesson from both the Feb cluster and Scout's §3.1 stale list). (2) #118 sandbox audit disposition before any real candidate runs code at launch scale. (3) Assessment results must join the erasure map (they're candidate data — coverage today rides on the applications family, see M19 §5.2 map; confirm explicitly).

## 5. Functional requirements
- FR-M13-1: Every Feb-cluster issue is re-verified against current code before closure or scheduling (evidence on the issue, per the issue-verification hard rule) — no bulk actions.
- FR-M13-2: The coding sandbox runs candidate code with no network egress, no host filesystem access beyond its workdir, and hard CPU/memory/time limits; #118's audit findings are dispositioned (fixed or formally accepted by Sumanth) before launch.
- FR-M13-3: Assessment/coding results are named in the erasure inventory (M19) with the same change that touches them.

## 6. Non-functional
- Security (API/database lenses): the sandbox is the module's risk centre; questionnaire/assessment reads are application-scoped and inherit M6's object-authorisation convention.
- Responsive: candidate test-taking is mobile-plausible for aptitude/questionnaire; coding is desktop-primary but must not break on tablet.

## 7. Dependencies (verified states)
M6 application linkage (exists) · M19 erasure (exists; this module's explicit naming is FR-M13-3).

## 8. Sprint 11 overlap
None filed. (M6's Sprint 11 work touches `assessments.js`'s application path — regression awareness only.)

## 9. ⚠ Unverified
Per-page runtime health of the whole module (Scout: code-traced only); sandbox isolation strength (that's #118's question, unanswered); the Feb cluster's true live count.

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M13-1:** Accept #118's audit as a **pre-launch gate** for the coding surface (coding assessments don't ship to real candidates until it dispositions), or ship coding with the audit as a fast-follow?
  **Rex's recommendation: gate it.** Candidate code execution is the one place a launch incident could hurt *other* tenants' data, not just the candidate's own session; aptitude/questionnaire surfaces are unaffected either way.
