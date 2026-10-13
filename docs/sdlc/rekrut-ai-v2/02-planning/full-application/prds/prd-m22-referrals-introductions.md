# PRD — M22: Referrals & Introductions

**State (verified, Scout §2): WORKS with one live break.** **Surfaces:** `routes/referrals.js`, `recruiter-introductions.js` · client: referrals, referral-landing, referral-assessment.

## 1. Purpose & users
Growth through people: candidates referred by employees/contacts land, sign up, and apply with referral attribution; recruiters make introductions. Users: referrers, referred candidates, recruiters.

## 2. End-to-end journey
Referral link → landing → signup → apply — **breaks at the apply step for referral-first candidates today**: one of the three `job_applications` INSERT paths sets `applied_via='referral'` in a way that violates a CHECK constraint, so the INSERT **500s** (#824/S-100, proven in the S-088 audit). Recruiter introductions follow a separate, working path.

## 3. Current state (verified)
Referral pages, landing, and assessment surfaces exist. The break is narrow and total at once: the referral-first funnel — the exact candidates referrals exist to attract — cannot complete an application.

## 4. Gap to launch-ready
Fix #824 (validate/normalise `applied_via` against the CHECK constraint at the creation path; part of M6's FR-M06-5 funnel consolidation), with a regression test that walks the full referral-first journey end-to-end.

## 5. Functional requirements
- FR-M22-1: The referral-first journey (link → signup → apply → pipeline-visible with attribution) completes end-to-end; a test proves it (this journey is a launch funnel, not an edge case).
- FR-M22-2: Referral attribution is recorded once, at application creation, from the server-side referral record — never from client-supplied referrer claims.
- FR-M22-3: Referral data (referrer identity, relationship) is candidate-adjacent PII: inside the erasure map (M19 FR-M19-2) and never exposed across companies.

## 6. Non-functional
- Privacy: referral landing pages must not disclose the referrer's employer relationship beyond what the referrer provided for that purpose.
- Responsive: referral landing is a mobile-first acquisition surface (links arrive in messages) — full device matrix.

## 7. Dependencies (verified states)
M6 creation paths (exist; #824 is one of them) · M1 signup (exists).

## 8. Sprint 11 overlap
#824 was filed by the S-088 audit into Sprint 11's discovered set (sequenced/Sprint-12 candidacy per Lead's plan) — this PRD states the requirement; the sprint placement is Lead's record.

## 9. ⚠ Unverified
Introductions-path health beyond code trace; referral assessment page behaviour on staging.

## 10. ▣ DECISIONS FOR SUMANTH
- None.
