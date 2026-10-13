# Project Knowledge Base — Full-Application Relearn Edition, 2026-10-13

**Author:** Scout (relearn persona), on Sumanth's directive (2026-10-13): "start from the beginning" — a full-application relearn replacing sprint-by-sprint discovery.
**Feeds:** Rex (documentation + per-module PRDs) → Sumanth's decisions → Lead (planning).
**Verified against:** `origin/dev` HEAD `48454fea` (PR #814 merge). Local working tree was behind `origin/dev`; S-085 capture files verified via `git show origin/dev:…`. Mocked/local evidence only — **no real-DB run is possible from this VM (Neon TLS wall)**; runtime-proven items are credited to the S-088 audit where noted.
**Scale of the surface:** 74 route mounts in `server.js` (65 files in `routes/`, 7 in `server/routes/`), 45 libs, 25 services, 153 migration files (~230 distinct tables created across migrations), 143 client pages, 100 server test suites + 28 client suites + 43 e2e specs.

**How to read this edition:** §1 is the module inventory (modules defined by the code, not sprint history). §2 gives each module's verified state + one traced journey. §3 is the full issue reconciliation. §4 is cross-cutting state. §5 is reverse ADRs / code-vs-decision disagreements. Rex can lift §2 module sections directly.

---

## 1. Module inventory (22 modules, code-defined)

| # | Module | Server surface | Client surface | One-line state |
|---|--------|---------------|----------------|----------------|
| M1 | Auth & Accounts | `routes/auth.js` (1,825 lines) | login/register/forgot/reset, admin/login | Works; OAuth employer-block live |
| M2 | Companies, Teams & RBAC | `routes/company.js`, `departments.js`, `audit.js` | recruiter/company, team, join-requests, pending-approval | Works; role model drifted (#766) |
| M3 | Jobs & Careers | `routes/jobs.js`, `careers.js` | job-create/form, jobs, candidate/jobs, job-detail, career-page | Works end-to-end |
| M4 | Candidates & Profiles | `routes/candidate.js` (5,715 lines), `candidate-preferences.js`, `candidate-documents.js` | candidate/profile, documents, saved-jobs, onboarding | Works; god-file risk |
| M5 | Career Coach & Candidate AI Tools | `routes/career-coach.js`, `profile-enhancement.js`, `lib/career-coach-ai.js` | career-coach (7 tabs), cv-review, linkedin-optimizer, ai-coaching, career-diagnosis | Built; several endpoints mock-grade |
| M6 | Applications & Pipeline | spread across `candidate.js`, `recruiter.js`, `ai-screener.js`, `assessments.js` (no dedicated router) | candidate/applications, recruiter/applications, job-applicants | Works WITH 3 runtime-proven P0 authz holes |
| M7 | Matching & Discovery | `candidateSearch.js`, `matching.js`, `fitScore.js`, `candidate-company-matches.js`, `lib/job-alert-matcher.js` | recruiter/candidates, top-matches, company-matches, ai-search | Works; known P1 bug cluster open (#405/#414/#416) |
| M8 | Interviews — Session Engine | `server/routes/interview-sessions-v2.js`, `session-lifecycle.js`, `routes/interview-sessions.js`, `interview-events.js`, `interviews-unified.js` | book-interview, session-room, panel-room | Works; the unified core |
| M9 | AI Interview & Screening | `routes/interviews.js`, `screening.js`, `ai-screener.js`, `quick-practice.js`, `ai.js`, `voice.js`, `services/interview-ai.js` (9 exports) | mock-interview, ai-screening, screening, voice-screening, quick-practice | Works; analysis hand-rolled inline per feature |
| M10 | Human Interviews, Panels & Recordings | `routes/panels.js`, `server/routes/livekit.js`, `recordings.js`, `human-interview-requests.js`, `frame-proxy.js` | livekit-room, InterviewSession, panels, panel-room, recordings, recording-playback | Works (presence path); TWO parallel scorecard systems |
| M11 | AI Observer & Integrity | `lib/observerConsentGate.js`, `observerJobs.js`, `observerReportWriter.js`, `observerReportStates.js`, `observerCapture*.js`, `workers/ai-observer/` | InterviewReport, InterviewPanel, proctoring pages | Presence-only works; capture built DORMANT; analysis chain absent |
| M12 | Scoring — OmniScore, Fit, Trust | `routes/omniscore.js`, `fitScore.js`, `trustscore.js`, `services/omniscore.js` (1,246 lines) | candidate/omniscore, recruiter/omniscore, recruiter-trustscore, leaderboard | Partial: practice feeds score (ruled out, unfixed); eval pipe broken |
| M13 | Assessments & Coding | `routes/assessments.js`, `aptitude.js`, `coding-templates.js`, `coding-submissions.js`, `sandbox.js`, `questionnaire.js` | assessments, aptitude-tests, job-assessment, screening-questionnaire | Built; Feb-2026 breakage cluster partially stale — needs per-item re-verification |
| M14 | Verification & Background Checks | `routes/verification.js`, `identity-verification.js`, `background-check.js`, `services/document-verification.js` | identity-verification, background-check (both sides) | Built; erasure-wired (S-076) |
| M15 | Threat-Intel | — none — | — none — | ABSENT: zero code (`grep -ri threat_intel` = no hits); design + chassis stories only |
| M16 | Billing & Subscriptions | `routes/billing.js` (527 lines, raw Stripe API via fetch), `lib/subscription.js` | pricing, payment-success, settings billing surfaces | Partial: checkout exists; metering absent (#698–#700); staging on LIVE keys (#98) |
| M17 | Post-Hire — Offers, Onboarding, Payroll, E-Signature | `routes/onboarding.js`, `payroll.js` (1,152 lines), `signature.js`, `services/payroll-calculator.js` | offers, offer-management, onboarding (both sides), payroll (3 pages), SignDocument | Built and wired; NOT in any launch-scope ruling — scope question |
| M18 | Notifications, Email & Comms | `routes/notifications.js`, `voice-notifications.js`, `email-tracking.js`, `communications.js`, `chat.js`, `lib/email-service.js` (Brevo), `lib/email-queue.js` | chat (both sides), recruiter-communications, admin/email-queue | Works; staging email provider only configured 2026-10-07, behaviourally unverified (#99) |
| M19 | Consent, Privacy & Compliance | `server/routes/consent.js`, `lib/consentService.js`, `lib/erasureService.js`, `routes/compliance.js`, `lib/biometricAudit.js`, `services/euComplianceService.js` | consent-screens, biometric-policy, privacy, admin/compliance, admin/biometric-audit, EU AI Act dashboard | Strongest module; Applications erasure gap + purge-arming defect remain |
| M20 | Admin & Platform Ops | `routes/admin.js` (2,534 lines), `api-keys.js`, `public-api.js`, `audit.js`, `health.js`, `docs.js` | 11 admin pages (dashboard, agents, ai-health, analytics, revenue, compliance…) | Partial: console exists; #254 path mismatches open; MFA absent (#660) |
| M21 | Analytics & Reporting | `routes/analytics.js`, `lib/analytics-cache.js`, materialized views (migration p3c) | recruiter/analytics, admin/analytics | Built; integrity-metrics reporting absent (E-004/E-005 stories) |
| M22 | Referrals & Introductions | `routes/referrals.js`, `recruiter-introductions.js` | referrals, referral-landing, referral-assessment | Works with one live break: referral claim INSERT 500s (#824) |
| — | Landing/Marketing & Legal pages | static + `routes/docs.js` | landing, pricing, blog, about, contact, terms, privacy, biometric-policy | Works; policy page over-promises (#777) |

---

## 2. Per-module verified state + journey traces

### M1 — Auth & Accounts
**State: WORKS.** Email/password + Google/LinkedIn OAuth with signed-JWT state tokens. Employer OAuth signup is blocked in code as ruled: `routes/auth.js:916` (Google) and `:1173` (LinkedIn) redirect to `/register?role=recruiter&oauth_employer_blocked=true`. Role CHECK (migration 047): `candidate, recruiter, employer, admin, hiring_manager`.
**Journey:** register → JWT issued → role dashboard → token refresh. Traced in code end-to-end.
**Known opens:** #105 post-auth redirect 6.1 s; #184/#185 E2E auth-suite friction (test-side); P0 #336 test-admin cleanup deferred to pre-launch by ruling.

### M2 — Companies, Teams & RBAC
**State: WORKS with drift.** Company creation with domain enforcement, team invite (`POST /api/company/team/invite`), join requests, departments (#139 hierarchy built — `routes/departments.js` mounted). RBAC map (migration 128) has **no `employer` entry** while the role CHECK allows it; `recruiter` holds near-owner permissions; platform `admin` vs company `owner` conflated in places. This is #766 — BLOCKED on Sumanth's decision; Rex's recommendations on file since 2026-10-11.
**Journey:** employer registers → company created → invites recruiter → recruiter joins → shared job pipeline. Works.

### M3 — Jobs & Careers
**State: WORKS.** `routes/jobs.js` (589 lines) + public careers routes; recruiter create/edit pages; candidate browse/detail/save. Salary display bug #315 open (data-entry vs render mismatch).
**Journey:** recruiter posts job → candidate searches → views detail → applies (hands off to M6). Works.

### M4 — Candidates & Profiles
**State: WORKS; structural risk.** `routes/candidate.js` is a 5,715-line god-file carrying profile, documents, applications writes (`:2759` INSERT INTO job_applications), one-click apply (`:3796`), and more. Profile, documents (encrypted at rest via `lib/document-crypto.js`), preferences, saved jobs all wired.
**Journey:** candidate completes profile → uploads CV (parsed into `parsed_resumes`) → applies. Works.

### M5 — Career Coach & Candidate AI Tools
**State: BUILT, uneven depth.** Career coach has 7 client tabs + dedicated AI lib; CV review and LinkedIn optimizer exist, but LinkedIn tips endpoint is explicitly **mock** (`routes/profile-enhancement.js:9` — "AI-generated optimization tips (mock)"). AI coaching pages exist. This module was never part of the launch-critical path in any ruling — scope question for Rex.
**Journey:** candidate opens coach → tabs call real endpoints → CV/LinkedIn tools partially mock-grade.

### M6 — Applications & Pipeline
**State: WORKS WITH PROVEN P0 HOLES (S-088 audit, runtime-proven 2026-10-13).** No dedicated router — application logic is spread across `candidate.js`, `recruiter.js`, `ai-screener.js:121` and `assessments.js:1476` (three separate INSERT paths into `job_applications`, incl. the ai-screener phantom-creation funnel, #823).
**Proven holes (live fixtures, not static reads):** candidate status self-advance incl. reversing a recruiter rejection (#820/S-096); enumerable explain-decision IDOR leaking `recruiter_notes` + sibling endpoints (#821/S-097); cross-company screening-send mutating another company's application (#822/S-098). Erasure: `job_applications` is **absent from `lib/erasureService.js`** DELETE list — cover_letter + screening_answers survive (#780, dry-run confirmed; extension #813/#829).
**Journey:** apply (M4) → recruiter pipeline (job-applicants) → screening send → status flow → interview booking. Functionally works; authorization layer is the defect.

### M7 — Matching & Discovery
**State: WORKS with an open P1 cluster.** Candidate search (`candidateSearch.js`, 859 lines), matching engine, fit score, company matches, job-alert matcher all exist. The 2026-10-07 candidates-page audit findings live on as #405 (10 verified bugs), #414 (pagination dead), #416 (preview/invite bypass soft-delete + opt-out). Soft-deleted users are hidden per ruling; rows are never deleted pre-launch (#151).
**Journey:** recruiter searches → filters → previews → invites. Works with the filed defects.

### M8 — Interviews — Session Engine
**State: WORKS — the unified core.** Mount order in `server.js:659-676` is load-bearing (sessions router first, lifecycle, human-requests, unified, events, quick-practice isolated before legacy interviews). Session creation (S-001 v2), state machine lifecycle (S-003), human-interview requests (S-012) all live.
**Journey:** create session (any mode) → state transitions via lifecycle routes → completion → report surfaces. Works.

### M9 — AI Interview & Screening
**State: WORKS; analysis is hand-rolled per feature (the S-049 finding).** Mock interview, AI screening (conversational, `routes/screening.js` analyze/batch/questions/compare), voice screening, Quick Practice (isolated router), AI chat. `services/interview-ai.js` exposes 9 functions — **none transfer** to the Observer path (S-082). Legacy mock/screening reports are generated inline in `routes/interviews.js`; the five retired legacy writes return 410 (`routes/interviews.js:98,112,126…`, S-074). `GET /screening/sessions` embeds full transcripts for the monitor — over-send surface, scope ruling still pending from Sumanth.
**Journey:** candidate starts mock → LiveKit/self-hosted audio → transcript → inline AI analysis → results page. Works.

### M10 — Human Interviews, Panels & Recordings
**State: WORKS (presence path) with a split-brain scorecard problem.** LiveKit tokens (`server/routes/livekit.js`, derives `observer_consent` server-side), encrypted recording store (`lib/r2RecordingStore.js`), playback, frame proxy. **Two scorecard systems coexist:** (a) panels — `routes/panels.js` fully implements scorecards incl. **submit-and-lock** (`:451` submit locks; `:382` blocks edits after submit) and peer aggregate (`:595`), gated by `verifyPanelMember`; (b) the migration-125 `scorecards`/`scorecard_items` tables linked to `scheduled_interviews`, which **no route serves**. The S-039 report reads neither — its human column renders `missing` by design until S-093 (#810, re-scoped by Rex to the AI-section gate + session resolver) lands.
**Journey:** book → LiveKit room → panel scorecards submitted/locked → aggregate. Works via panels; the report page does not yet consume it.

### M11 — AI Observer & Integrity
**State: PRESENCE-ONLY WORKS; CAPTURE BUILT DORMANT; ANALYSIS ABSENT.** Toggle + default-deny gate (`observerConsentGate.js` — only `biometric_collection === true` admits the Observer), in-process worker (`server.js:1059` `startWorker()`), report writer scaffold (S-049a), renderer (S-039), payload minimisation (S-087). Capture substrate (S-085, PR #800): `lib/observerCaptureFlag.js` is the ONLY reader of `OBSERVER_AUDIO_CAPTURE_ENABLED`, ON only for the exact string `'true'`, read fresh per call — **flag is unset in every environment, so capture has never run**. Dormancy Evidence Pack 10/10 (Rung 1); Rung 2 + jest C-L3 outstanding. The analysis chain (E-004/E-005: S-027 #674 fusion, S-034 #681, S-049b #697) is **spec-only** — no AnalysisService/IntegrityService exists. Integrity-adjacent legacy surface that DOES exist: proctoring routes + flag pages (separate, older system).
**Journey:** recruiter enables observer → candidate consents (or not) → worker joins subscribe-only → presence + consent recorded → report shows sections `missing` honestly. Works exactly to the Gate A line.

### M12 — Scoring — OmniScore, Fit, Trust
**State: PARTIAL — two verified defects against stated decisions.** `services/omniscore.js:145-147` reads `practice_sessions`; `:272-278` averages **every attempt** and adds up to 50 pts into the composite — practice feeds OmniScore today (ruled OUT 2026-10-12, #791, code unchanged). `interview_evaluations` scores effectively never reach the engine (#793 — pipe reads a table the engine never reads; note erasure deletes from `interview_evaluations`, the engine reads other tables). Cold-start renders "Insufficient data" per factor (no fake scores — honoured). Fit score and trust score (v1 `services/trustscore.js` + `trustscore-standalone.js` both still present; #175 ponytail deletion still real) are separate, older systems.
**Journey:** candidate practises / is evaluated → score recomputed → candidate + recruiter OmniScore pages render. Works, on the wrong inputs.

### M13 — Assessments & Coding
**State: BUILT; verification debt.** Aptitude, assessments, coding templates/submissions with sandbox (`routes/sandbox.js`; #118 sandbox security audit open), questionnaire. The Feb-2026 "completely broken" cluster (#243 aptitude path mismatch et al.) — spot checks in this pass found endpoints now existing for several siblings (calendar connect, one-click apply, screening analyze), so the cluster is **at least partially stale**; each issue needs its own re-verification before anyone trusts or closes it.
**Journey:** recruiter assigns assessment → candidate takes → results pages. Wired; per-page health unverified this pass.

### M14 — Verification & Background Checks
**State: BUILT + erasure-wired.** Identity verification (gov ID + selfie via `verification_requests`), document verification service, background-check routers (candidate + shared). Erasure deletes `verification_requests`, `verification_documents`, `identity_verifications` (S-076 privacy catch). Productised background-check depth (#132/#133) remains open scope.
**Journey:** candidate verifies identity → recruiter views status. Works.

### M15 — Threat-Intel
**State: ABSENT.** Zero code, zero tables (`grep -ri threat_intel` across lib/routes/services/workers/migrations = no hits). What exists: the S-081 spec (privacy-reviewed), the narrowed-v1 approval (chassis + internal repeat-IP signal, dark until #788), stories S-090/S-091/S-095 (+ UI S-092 deferred behind #788), and the counsel story #788 itself (OPEN, no outreach per Sumanth's 2026-10-13 instruction).

### M16 — Billing & Subscriptions
**State: PARTIAL.** Stripe integration is hand-rolled fetch calls (`routes/billing.js:77` `stripePost`), webhook mounted raw at `server.js:472`, subscription tier matrix in `lib/subscription.js` (candidate-facing Free/Pro). **Metering does not exist** — S-050/S-051/S-052 (#698/#699/#700) are open stories; pricing decision itself is still Sumanth's (Atlas+Ledger options memo 2026-10-12, Option A→D recommended, undecided). Risk on record: #98 staging wired to LIVE Stripe keys; #6 P0 Stripe live-mode validation; #193 E2E payment flow failing.
**Journey:** pricing page → checkout → webhook → tier applied. Wired; commercial model unbuilt.

### M17 — Post-Hire — Offers, Onboarding, Payroll, E-Signature
**State: BUILT and wired — the largest surface never scoped by any launch ruling.** `routes/payroll.js` alone is 1,152 lines with a real calculator service; onboarding routes + both-side pages; offers pages both sides; e-signature engine routes + SignDocument page (#131 asks for PKCS#7 sealing — current depth unverified). Nothing in the January launch scope (per the module-order ruling and Gate A record) includes this module; whether it is launch surface, later phase, or dead weight is an unmade decision — flagged for Rex/Sumanth in §5.
**Journey:** offer → onboarding docs → payroll run pages exist end-to-end in code. Runtime health unverified this pass.

### M18 — Notifications, Email & Communications
**State: WORKS.** In-app notifications + voice notifications, email via Brevo (`lib/email-service.js:22-28`, API + SMTP relay), queue + tracking, candidate↔recruiter chat with read receipts deferred (#337). Staging Brevo credentials added 2026-10-07; #99 (no email provider on staging) is **stale as titled** — configured since, behaviourally unverified.
**Journey:** event → queue → Brevo send → tracking. Wired.

### M19 — Consent, Privacy & Compliance
**State: STRONGEST MODULE — two live defects.** Consent lifecycle routes + `consentService.js` (403 lines), DSAR endpoint (S-073 family), `erasureService.js` (495 lines; **31 table DELETEs + `recording_consent` redaction + users tombstone**, list verified in this pass), biometric audit, retention purge cron in `server.js`.
**Defect 1 (arming):** purge arms only when `RETENTION_PURGE_LIVE === 'true' && NODE_ENV === 'production'` (`server.js:1012`); `NODE_ENV` is unset on both Render services (Rex, Sprint 11) → **the 90/30-day retention promise currently has no working enforcement** (#805). Sumanth has also never flipped `RETENTION_PURGE_LIVE` — two separate gates, both closed.
**Defect 2 (coverage):** Applications family absent from erasure (#780/#813/#829); payroll/post-hire records are not in the erasure list either (unexamined surface — no issue exists; see §3 gaps).
**Journey:** candidate consents/declines → receipts stored → DSAR export/delete → 31-table erasure + storage ledger. Works except as noted.

### M20 — Admin & Platform Ops
**State: PARTIAL.** `routes/admin.js` 2,534 lines + 11 admin pages (dashboard, agents, AI health, analytics, revenue, compliance, biometric audit, email queue). #254 (admin endpoint path mismatches) still open; admin MFA does not exist (#660/S-055); the P0 #336 self-registration mint path was closed in code 2026-10-06 (`f1bca66d`) — remaining exposure is the two QA test-admin accounts, cleanup deferred to pre-launch by ruling.
**Journey:** admin login (separate page) → console pages call admin routes. Mostly works; mismatches filed.

### M21 — Analytics & Reporting
**State: BUILT (product analytics); integrity reporting ABSENT.** Recruiter analytics + admin analytics/revenue pages, materialized views for performance. E-006 reporting stories (S-036 #683 recruiter full report, S-037 #684 candidate qualitative report) are unbuilt — today's "reports" are the interview surfaces in M9/M10. Integrity metrics dashboards (S-053a/b #701/#702) absent (depend on M11 analysis).
**Journey:** recruiter opens analytics → aggregated application/interview data renders. Works.

### M22 — Referrals & Introductions
**State: WORKS with one live break.** Referral routes + landing + assessment pages; recruiter introductions. **Break:** referral-first application creation violates a CHECK constraint — the S-088 audit found the referral INSERT 500s (#824/S-100; one of the three `job_applications` INSERT paths sets `applied_via='referral'`).
**Journey:** referral link → signup → apply. Breaks at the apply step for referral-first candidates today.

---

## 3. Full issue reconciliation (swept 2026-10-13)

**Totals: 416 issues — 191 OPEN, 225 CLOSED.** Open issues by family:

| Family | Count (approx.) | Contents |
|--------|------|----------|
| Phase-3 SDLC epics + stories (E-001…E-009, S-001…S-057) | ~95 | #631–#639 epics (all 9 OPEN), their story children #641–#703 |
| Sprint 9–11 era (S-068…S-110, follow-ups, C-L, discovered) | ~50 | #721, #739, #745, #761–#834 |
| Legacy backlog (pre-Oct-2026 features/bugs/E2E) | ~46 | #6–#529: phase epics #94/#95/#102/#108/#116/#123/#130/#137, Feb bug cluster, E2E failures #184–#195 |

### 3.1 Verified STALE or ALREADY-DONE on inspection (this pass — flagging, not closing; closure is Suga/Sumanth's gate)
| Issue | Verdict | Evidence |
|-------|---------|----------|
| #99 No email provider on staging | **Stale as titled** | Brevo configured on staging 2026-10-07 (`lib/email-service.js:22-28`); residual truth = "behaviourally unverified," not "no provider" |
| #252 Screening runner: no backend endpoint | **Likely stale** | `routes/screening.js` now exposes analyze/batch/questions/compare endpoints |
| #247 One-click apply: no backend | **Stale** | `routes/candidate.js:3796` `POST /ai/one-click-apply` exists |
| #250 Recruiter calendar: no backend endpoints | **Partially stale** | `routes/calendar.js` now has connect/callback/disconnect/status/connections/availability endpoints |
| #661 S-056 Biometric privacy policy page (NEW) | **Already built** | `client/src/pages/biometric-policy.tsx` exists; the live remainder is #777 (the page's unbuilt calibration promise) |
| #658 S-016b DSAR data export generation | **Substantially done** | DSAR fulfillment endpoint merged 2026-10-11 (#746 via PR #757) |
| #654 S-014 Biometric audit log | **Substantially present** | `lib/biometricAudit.js` + `client/src/pages/admin/biometric-audit.tsx` exist; append-only guarantees unverified |
| #655 S-015 Automated retention purges | **Partially done, cannot arm** | Purge cron built (S-077, migrations 253/254) but arming is doubly gated shut (see §2 M19) — the story's remainder is #805 + Sumanth's flip decision |
| #641 S-002 Invite token generation/expiry | **Partially done** | `invite_token` exists on sessions and was the S-087 minimisation subject; expiry semantics unverified |
| #649/#650 S-010/S-011 consent screens + enforcement middleware | **Partially done** | `consent-screens.tsx`, consent routes, and the Observer gate exist; a general API-wide consent middleware (S-011 as written) does not |
| #647 S-008 LiveKit room orchestration | **Partially done** | LiveKit routes + rooms run today (M10); S-008's full orchestration scope was never separately verified |
| Feb-2026 cluster #239–#246, #249, #251, #254 | **Mixed/stale-prone** | Spot checks found several "missing" endpoints now present; each issue needs individual re-verification — do NOT bulk-trust or bulk-close |

### 3.2 Verified STILL-REAL (spot-checked this pass)
- **#780/#813/#829** — `job_applications` absent from the erasure DELETE list (read in full this pass). Real.
- **#791** — practice feeds OmniScore (`services/omniscore.js:145-278`). Real, code unchanged since the ruling.
- **#793** — evaluation pipe disconnect stands as filed. Real.
- **#175** — both `services/trustscore.js` and `trustscore-standalone.js` still exist. Real.
- **#777** — policy page promise vs spec-only E-003. Real (page read in prior passes).
- **#721/#739** — R2 plaintext run still unexecuted (environment-blocked; pre-launch track by ruling). Real.
- **#820/#821/#822** — runtime-proven by S-088 (fixtures), not re-run this pass. Real per audit.
- **Migration-238 fresh-DB halt** — reported by the S-088/Sprint-11 pass (`candidate_profiles.bio` never created on the fresh path; migrations ≥239 never apply to a fresh DB). **Not independently re-run in this pass**; no story filed for it yet (see gaps).

### 3.3 Open epics — honest state
All nine Phase-3 epics (#631–#639) remain OPEN. Only **E-008 (#638, AI Observer)** has substantial merged implementation (presence path + dormant capture). E-002 (#632, Consent & Compliance) is largely built via the S-070s workstreams though its child stories were never individually closed. E-001/E-003/E-004/E-005/E-006/E-007/E-009 children are overwhelmingly **spec-only**. The six legacy phase epics (#94/#95/#102/#108/#116/#123/#130/#137) predate the SDLC system and were never reconciled against it — they overlap the Phase-3 epics (e.g. #108 Structured Screening vs E-001/E-004) and double-count scope if read naively. **Rex should treat the Phase-3 epic set as canonical and the legacy epics as un-reconciled history.**

### 3.4 Decisions/promises with NO issue (gaps found this pass)
1. **Migration-238 fresh-DB halt** — no story exists (Lead flagged "deserves its own story"; unfiled at sweep time). Blocks fresh staging provisioning on the D2 promotion track.
2. **Payroll/post-hire erasure coverage** — erasure never examined M17 records (payroll, onboarding documents beyond candidate docs). No issue, no decision.
3. **Gate A C-L2 (Neon PITR window evidence)** — lives only as a condition in Lex's PR #800 ruling/#787 closure; no standalone tracked issue.
4. **Atlas evidence gates** (15–20 discovery calls + 3–5 paid-pilot commitments pre-launch; Gate A reopens if workflow alone doesn't sell) — business track from the CEO panel; no issue.
5. **DESIGN.md bootstrap** — the design intake's shared prerequisite (one gated `impeccable document` run) was never filed or scheduled.
6. **#334's shipped reality** — "separate Record and AI Observer toggles" was decided in Phase 2; code ships a single `observer_enabled` flag. The issue is open, so this is a code-vs-decision gap (§5), not a missing issue.
7. **Pricing decision** — Atlas+Ledger memo delivered 2026-10-12; the decision itself is Sumanth's and has no tracking issue (the metering stories #698–#700 exist but presuppose it).

### 3.5 Blocked items (state, not scope)
- **On Sumanth:** #766 (role model), pricing decision, `RETENTION_PURGE_LIVE` flip, screening-sessions over-send scope ruling, #336 cleanup + #151 purge (pre-launch, by ruling).
- **On counsel (#788, no outreach per 2026-10-13 instruction):** threat-intel release (#808/#809), Gate A activation contract, Lex's C-01…C-08 determinations.

---

## 4. Cross-cutting state

**Authorization / company scoping.** The good pattern exists and is used in places: `requireRecruiter`, `requireCompanyOwnerOrRecruiter`, `verifyPanelMember` (panels, M10) are real middleware with object-level checks. The bad pattern is inconsistency: M6 proved three object-level holes at runtime, M7 has the #416 preview/invite bypass, and #821's siblings show **auth-only endpoints treated as if authentication were authorization** (audit export). There is no platform-wide object-authorization convention — each router hand-rolls it. This is the single most repeatable defect class in the codebase.

**Erasure / retention coverage by module.** Interviews ✓ (S-076/77/78 + capture C-L track) · Candidates/Profiles ✓ · Scoring ✓ (omni_scores, role_scores, components, history all deleted) · Verification ✓ · Observer ✓ (day-one wiring) · **Applications ✗ (#780 family)** · **Post-Hire/Payroll — unexamined** · Threat-intel — nothing exists to erase. Retention enforcement: built, **not armed anywhere** (M19 defect 1).

**Test reality.** 100 server suites / 28 client suites / 43 e2e specs on paper. Jest's **first real execution happened 2026-10-13** (Quinn's ledger: 1,201 tests, 0 product bugs; capture mirror suites don't execute under jest — #817; `npm ci` lockfile drift — #818). Everything before that ran on custom harnesses + mocked suites. Real-DB integration runs are **impossible from this VM**; staging QA is the only real-DB confirmation path, and staging shares the production DB (#151) with migrations executed at boot via `render.yaml` — so promotion is a production-schema event (Sprint-11 D2 finding, verified in plan review).

**Responsive / UI state.** Tailwind with CSS-variable theming (`client/src/index.css` — shadcn-style token set) + 22 shadcn-style primitives in `client/src/components/ui`. **No DESIGN.md exists anywhere in the repo** (searched this pass) — the design intake's prerequisite was never run, so Aria/Nova/Quinn pull impeccable/Vercel guidance per-task with no project design document to anchor to. Sumanth's whole-app responsiveness directive stands; #16 (mobile filter button) and #191 (mobile nav E2E) are the filed remnants; no systematic responsive audit exists.

**Environments.** Render: staging (free tier, no shell), dev, prod services; staging shares prod DB by design. Deploys are manual. Migrations run at boot. This VM cannot reach Neon/R2/B2 over TLS — every "verified" claim in this edition is code-level or local-harness level unless credited to the S-088 runtime audit (local Postgres + local server).

---

## 5. Reverse ADRs — load-bearing decisions in the code, and where code now disagrees with stated decisions

**ADR-R1 — Practice is candidate-only feedback (stated) vs practice feeds the score (code).** The longest-running disagreement, resolved by Sumanth's 2026-10-12 ruling (Option b + marker, #791/#792) — **the code still implements the pre-ruling behaviour** (`services/omniscore.js:145-278`). Until #791 lands, the product does the opposite of the recorded decision.

**ADR-R2 — Real evaluations are the score's evidence (intent) vs the pipe reads a table the engine never reads (code).** #793. The system presents OmniScore as evaluation-driven; mechanically it is practice-driven (R1) — the two defects are mirror images.

**ADR-R3 — Retention is enforced at 90/30 days (policy) vs the purge can never arm (code/config).** `server.js:1012` requires `NODE_ENV === 'production'`; Render services don't set it (#805). A compliance promise with no live mechanism — the design assumed an environment convention nobody maintains.

**ADR-R4 — Submit-and-lock protects score integrity (panel decision) vs two scorecard systems (code).** The S-039 panel designed against migration-125 scorecards believing them schema-only; panels (M10) had implemented submit-and-lock all along. The decision was right; its premise about the code was wrong — the panel-rule (verified-state dependencies) exists because of this class of miss. S-093 (#810) now owns the reconciliation (AI-section gate + session resolver).

**ADR-R5 — Employer is a company owner (product language) vs `employer` is a role with no RBAC entry and recruiter holds its powers (code).** #766. The code's de-facto decision (recruiter = company admin) was never made by anyone; it accumulated.

**ADR-R6 — One consent, one toggle (shipped) vs separate Record / Observer toggles (Phase-2 decision, #334).** Code ships `observer_enabled` only. The Phase-2 decision was never implemented or formally revoked.

**ADR-R7 — Staging is a safe QA environment (assumption) vs staging = production DB + migrations at boot (config).** `render.yaml` + #151. Every promotion is a production event; the D2 promotion discipline (frozen dev, Relay checklist, Sumanth gate) is the compensating decision, made 2026-10-13.

**ADR-R8 — The Observer is an analysis product (vision/PRD) vs presence-only is the shipped truth (Gate A ruling).** The PRD amendment (Aria, PR #816, at Sumanth's gate at sweep time) exists precisely to close this gap in writing; until it merges, the PRD still promises what the ruling deferred — and the public policy page still promises a calibration baseline that is spec-only (#777).

**ADR-R9 — Post-hire is part of the product (code) vs no launch ruling ever scoped it (decisions).** M17 is ~4,000+ lines of wired product (payroll alone 1,152 route lines) that no ruling includes or excludes. The code decided by existing. Rex's documentation pass should force the question; Scout takes no position on the answer.

**ADR-R10 — Deletion is a launch-eve cleanup (ruling) vs test data is load-bearing until launch (operations).** #151 + the no-delete rule for QA accounts: test admins (205/206), E2E job listings (#71), and shared-DB test data are simultaneously "remove before launch" and "needed until launch." Both are recorded decisions; the pre-launch track is where they reconcile.

---

## 6. What this edition supersedes / leaves open

- This edition supersedes the v2 KB's module picture (the v2 body was interview-engine-scoped; its §§1–7 updates remain the record for those decisions and are NOT restated here except where this pass re-verified them).
- **Not verified in this pass (stated plainly):** runtime health of M13/M17 journeys (code-traced only); the migration-238 halt (reported, not re-run); per-issue verification of the Feb-2026 cluster beyond spot checks; append-only guarantees of the biometric audit log; e-signature depth vs #131.
- Scout's artefacts remain working-tree drafts until Suga routes the commit (shared-tree discipline).
