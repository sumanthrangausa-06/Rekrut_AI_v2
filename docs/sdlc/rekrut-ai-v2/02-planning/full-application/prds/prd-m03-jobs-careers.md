# PRD — M3: Jobs & Careers

**State (verified, Scout §2): WORKS.** **Surfaces:** `routes/jobs.js` (589 lines), `careers.js` · client: job-create/form, jobs, candidate/jobs, job-detail, career-page.

## 1. Purpose & users
The demand side's catalogue: recruiters post and manage jobs; candidates and the public browse them, including per-company career pages. Users: recruiters, candidates, anonymous visitors (careers pages).

## 2. End-to-end journey
Recruiter creates job (form) → job listed → candidate searches/browses → job detail → save or apply (hands off to M4/M6). Public career page renders a company's open roles without login.

## 3. Current state (verified)
Full loop works in code. One open defect: salary display mismatch (#315 — data-entry vs render).

## 4. Gap to launch-ready
#315 fix; salary/transparency fields must match the launch markets' expectations (US + India at launch; EU postponed per 2026-10-13 ruling — pay-transparency depth for EU is out of launch scope until EU returns). Job-posting content rules (global-hiring-compliance: no discriminatory language, required disclosures per market) are a copy/lint concern, not yet mechanised.

## 5. Functional requirements
- FR-M03-1: Salary entered = salary displayed, in the currency/locale of the job's market (#315 closed by fix + test).
- FR-M03-2: Job create/edit validates required fields server-side; the public career page shows only published jobs.
- FR-M03-3: Job posts pass a posting-content check for the launch markets (US/India) — at minimum a reviewed checklist in the create flow; automated linting is a post-launch option, not a launch requirement.

## 6. Non-functional
- Responsive: job browse/detail is a primary mobile surface for candidates — full device matrix applies; career pages are public and must render without client JS errors on low-end phones.
- SEO/public: career pages must not leak draft/unpublished job data.

## 7. Dependencies (verified states)
M2 (company identity — exists) · M6 (apply hand-off — exists; Sprint 11 hardens its authorisation).

## 8. Sprint 11 overlap
None (M6's sprint work begins after the apply hand-off).

## 9. ⚠ Unverified
Career-page runtime behaviour on staging; #315's exact break point (entry vs render) beyond Scout's characterisation.

## 10. ▣ DECISIONS FOR SUMANTH
- None. (EU pay-transparency depth returns with the EU launch decision, already postponed.)
