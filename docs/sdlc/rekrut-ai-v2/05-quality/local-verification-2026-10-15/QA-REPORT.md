# QA Report — Full Local Verification with Screenshot Proof (2026-10-15)

**Order:** Sumanth, 2026-10-15 — "test it in local environment… I need it updated on a git branch / GitHub issue with proof, the screenshots of all the modules."
**QA owner:** Quinn · **Filing:** Lead (companion QA issue) · **Supersedes the missing-screenshots gap of the 2026-10-14 run** (that run saved API payloads + logs only).

## The direct answer

**No — not everything is working fine, and now there is photographic proof of exactly what is and isn't.**

- The app **installs cleanly from scratch and boots**: `npm ci` exit 0 (797 packages — the PR #1203 lockfile fix holds), client builds, numbered migrations apply cleanly through **260**, `FRESH-DB CHECK PASSED`, health green.
- The **account core works end to end**: candidate + recruiter signup, company auto-creation, UI logins, a real application submitted and visible in the recruiter pipeline, honest dashboards in several places.
- But the **fresh-install schema-drift disease (#1184 family) is still live**: all nine Oct 14 defects (#1185–#1192) **retested today and ALL still broken**, plus **14 new findings** from this walk — most are the same disease in new places (missing columns the code queries), three are **fabrication-class** (invented numbers shown as real), all screenshot-proven below.
- **97 screenshots** were captured (desktop 1440×900), organised by module under `screenshots/`. Every verdict in this report names its screenshot. No screen is claimed working without one.

## Environment record

| Item | Value |
|---|---|
| Checkout | Fresh clone `~/workspace/rekrut-qa-20261015` (shared checkout untouched) |
| dev HEAD | `62ec551c75a4b26a073daf9487a4ce5c60c6e9a9` ("Merge PR #1211, #807 threat-intel chassis") — echoed by `/health` |
| Runtime | Node v24.20.0 · npm 10.9.4 · Playwright 1.64.1 (Chromium headless) |
| Database | Fresh empty DB `rekrut_qa_20261015` on local Postgres **16.15** @ 127.0.0.1:55433 (pgvector 0.6.0 available). Local only — Neon never touched. Local PG version ≠ Neon's; local proof is not live-version proof. |
| Install | Root `npm ci` exit 0 (797 pkgs) · client `npm ci` + `vite build` exit 0 |
| Migrations | Numbered chain clean through **260** (260 = `threat_intel_checks`, new since Oct 14). `node migrate.js` then **exits 1** at the trailing unnumbered `p2_schema_hardening.sql` — the known **#1141** halt, reproduced verbatim |
| Fresh-DB check | `node scripts/check-fresh-db.js` → **`FRESH-DB CHECK PASSED`** · 242 public tables |
| Serving origin | `http://localhost:3000` — required: the CORS allowlist (server.js:448) is hard-coded (Render hosts + `localhost:5173/3000/3001`); any other local host:port renders a **blank page** because Vite bundles are crossorigin and the CORS error becomes a 500. First attempt on 127.0.0.1:3100 proved this; environment corrected, product untouched. Recorded as Observation O-1. |
| Fixtures | Candidate `candidate@rekrutai.test` · Recruiter/owner `recruiter@qacorp.rekrutai.test` (company "QA Corp 2026", id 1, slug `qa-corp-2026-2`) · Admin via env credentials. **Only undeliverable `@rekrutai.test` addresses used.** One job ("QA Fixture Data Analyst", id 1) seeded directly in the DB *because the create endpoint 500s (#1185)*; one real application submitted through the API (application id 1, status `applied`). |
| Email | **No real email was sent.** The sandbox blocks outbound SMTP at the network level and the Brevo key in env returns 401; all sends were to `@rekrutai.test` and failed harmlessly. Side effect: the apply API response was delayed by the mail retry chain — an environment artefact, recorded, not a product defect. |
| Viewport | Desktop 1440×900 only, per Sumanth's standing order. Mobile pass remains deferred. |

## Per-module verdicts

Verdicts: **PASS** = screens render real/honest data, no failing calls · **PARTIAL** = renders, with named defects or render-only depth · **FAIL** = a launch surface is broken or shows invented data · **BLOCKED-ENV** = this VM cannot exercise it (storage path) · **ABSENT-BY-DESIGN** = intentionally not built.

| Module | Verdict | What the screenshots show |
|---|---|---|
| Public (landing, pricing, about, blog, contact, legal) | **PASS** | All render real content, zero failed requests. `public/landing.png`, `public/pricing.png` (plans render from the API). Minor: `/compare`, `/leaderboard`, `/privacy/biometric-policy` return HTTP **404 status while rendering** (Defect D12); leaderboard API 500s (D5). Biometric policy page renders with its DRAFT banner (`public/biometric-policy.png`) — the #777 promise-vs-build gap stands. |
| M1 Auth | **PASS** | Register (candidate + employer) 201s; UI logins land correctly for candidate and admin; login is fast. `M1-auth/login.png`, `M1-auth/register.png`. The recruiter login *landing* is wrong — see M2/D10. |
| M2 Companies / RBAC | **FAIL** | Company editor renders (`M2-companies/recruiter-company-1190.png`), team renders. But: careers page bounces a logged-out visitor to /login (#1187, `M2-companies/careers-page-1186-1187.png`), public company page shows "Failed to load company profile" (#1189, `M2-companies/public-company-page-1189.png`), profile update 500s (#1190), **`/recruiter/profile` is a fully fake "TechCorp Solutions — Verified, 4.8 rating, 89 hires" page served to a real recruiter** (fabrication, `M2-companies/recruiter-profile-fake.png`), the company **owner lands on "Awaiting Approval"** after login (D10, `M1-auth/recruiter-post-login.png`), and a join-requests call 500s in the shell of **every** recruiter page (D1). |
| M3 Jobs | **FAIL** | Recruiter list/detail render the seeded job (`M3-jobs/recruiter-jobs.png`). Create endpoint 500s (#1185; the form renders, `M3-jobs/recruiter-job-new-1185.png`). Candidate Job Board shows **"0 active jobs — No jobs match your filters" while a job exists** — the 500 (#1191) is swallowed into a false empty state (`M3-jobs/candidate-jobs-1191.png`); job detail likewise fails (`M3-jobs/candidate-job-detail-1191.png`). |
| M4 Candidates | **PARTIAL** | Candidate profile is the honesty proof done right: score ring reads **"Insufficient data"** (`M4-candidates/candidate-profile.png`). Dashboard renders real counts (`M4-candidates/candidate-dashboard.png`). Saved Jobs 500s (D2). Observation: profile header shows "0 Applications" while the candidate has 1 (O-3). |
| M5 Coach | **PARTIAL** (render-verified) | Career Coach, AI Coaching, CV Review, Career Diagnosis all render with no failing data calls (`M5-coach/*`). LinkedIn Optimizer's tips call 404s (D14). Live AI generation was **not** exercised (provider/token discipline) — screens only. |
| M6 Applications | **PARTIAL** | Recruiter pipeline **works**: the real application is listed with candidate, job, 36% match (`M6-applications/recruiter-applications.png`); job applicants view renders. Candidate **My Applications shows "0 Total Applied — You haven't applied to any jobs yet" while the API holds the application** (D2, `M6-applications/candidate-applications.png`). |
| M7 Matching | **PARTIAL** | Top Matches and Company Matches render (`M7-matching/*`). AI Search's recommendations call 500s (D5, `M7-matching/ai-search.png`). |
| M8 Session Engine | **PARTIAL** (render-only) | LiveKit room page renders (`M8-session-engine/candidate-livekit-room.png`); `/candidate/interview` redirects to AI Coaching; recruiter session room renders. No live session was run — a real session needs LiveKit + a second party + media devices this sandbox can't honestly provide. |
| M9 AI Interview | **PARTIAL** (render-only) | Interviews, AI Screening, Interview Practice screens render clean (`M9-ai-interview/*`). No AI session executed (provider discipline). |
| M10 Human Interviews | **PARTIAL** | Recruiter Interviews, Calendar, Panels, Recordings render (`M10-human-interviews/*`). Candidate interview **history API returns 400** — the server treats `history` as an interview `:id` (D7). |
| M11 Observer | **PARTIAL** (dormant by design) | Proctoring page renders (`M11-observer/recruiter-proctoring.png`). Observer capture is dormant/unreachable by the Gate A ruling — nothing to activate locally, and nothing was. |
| M12 Scoring | **FAIL** | **#1192 screenshot-proven on three surfaces**: score-less candidate's dashboard card shows **"300 OmniScore"** (`M4-candidates/candidate-dashboard.png`); the OmniScore page shows **"352 — Needs Work — Your Candidate Credit Score"** while every factor card says "Insufficient data" (`M12-scoring/candidate-omniscore-1192.png`); a brand-new company's dashboard shows **"Employer Trust Score: 0/1000"** (`M2-companies/recruiter-dashboard-1192.png`). The standalone TrustScore page's four data calls all **403 "Recruiter access required"** for the company owner (D9, `M12-scoring/recruiter-trustscore-1192.png`). Explainer endpoint 500s (D6). |
| M13 Assessments | **PARTIAL** | Assessments and Aptitude Tests render real empty states (`M13-assessments/*` — "0 Tests Taken" is honest). Job assessment page renders. The anti-cheat surface remains **not exercised** — a fresh candidate has no completed assessment and manufacturing one needs the full AI flow (same honest gap as Oct 14). |
| M14 Verification | **PARTIAL + BLOCKED-ENV** | Documents, Identity, Background Check pages render (`M14-verification/*`). Upload-dependent flows are **BLOCKED-ENV**: this VM's Node→R2/B2 path fails through the egress proxy (proven Oct 14; not re-litigated). No upload was faked. |
| M15 Threat-Intel | **ABSENT-BY-DESIGN** | No UI exists — by the approved narrowed design the chassis is dark until the CRA determination (#788) closes. The recruiter nav in every M2/M12 screenshot contains no threat-intel surface; migration 260 created `threat_intel_checks` (verified in the DB). This is the design working, not a failure. |
| M16 Billing | **PARTIAL** | Pricing renders plans from the API (`public/pricing.png`); settings page renders (`M16-billing/recruiter-settings-billing.png`); admin Revenue renders (`M16-billing/admin-revenue.png`). Checkout was not attempted — it leaves for Stripe and needs the live-key decision (#837/#98), out of local scope by design. |
| M17 Post-Hire | **PARTIAL** | Offers, Onboarding, Payroll pages render on both sides (`M17-posthire/*`), consistent with the "releasing soon" ruling for unfinished parts. Employee payroll profile API 404s (D13). `/employee-payroll` bounces a recruiter session to the candidate payroll page (role-routing artefact, noted in evidence JSON). |
| M18 Comms | **FAIL** | Candidate chat renders (`M18-comms/candidate-chat.png`); `/candidate/messages` redirects to chat. **Recruiter Communications is an invented inbox**: "Alex Johnson — Application for Senior Frontend Developer", "Sarah Chen — Interview Availability", "1 unread" — for a company whose only real candidate is the QA fixture (fabrication class, S-123; `M18-comms/recruiter-communications.png`). |
| M19 Privacy | **FAIL** | Public privacy + biometric pages render. **Recruiter Compliance page renders a fully invented compliance posture**: "Avg Selection Rate 25.0%, Bias Flags 3, Consents 6/10, 80% Rule Violation Detected, Female 89/342, Black 22/98…" plus a green "Compliant" badge — for a company with one candidate and one application (fabrication class, S-124; `M19-privacy/recruiter-compliance.png`). Admin compliance APIs 500 (D3). |
| M20 Admin | **PARTIAL** | Env-admin login works (lands on AI Health as designed). Dashboard renders honest values (2 users, $0 revenue, `M20-admin/admin-dashboard.png`); AI Health page renders (`M20-admin/admin-ai-health-254.png`); Agents, Agent Dashboard, Revenue render. **But**: the dashboard's own ai-health feed still 404s (**#254**, fresh evidence), and **Analytics / Biometric Audit / Email Queue bounce the admin to /login** — their APIs 401 the admin session (D11). Compliance data calls 500 (D3); EU AI Act page's data calls 404/500 (D3/D12-adjacent, see evidence). |
| M21 Analytics | **PARTIAL** | Recruiter Analytics renders (`M21-analytics/recruiter-analytics.png`) but its activity feed call is **`/api/api/recruiter/activity` → 404** (double-prefix, D8). Admin Analytics is unreachable for the env-admin (D11). |
| M22 Referrals | **FAIL** | Referrals list API 500s (`uuid = integer` type mismatch, D4); the page at least says so honestly — "Something went wrong — Failed to load referrals" (`M22-referrals/candidate-referrals.png`). Referral *creation* via this surface is broken on a fresh DB. (The referral INSERT defect #824 is a separate already-filed item.) |

**Module tally (22 modules + public surfaces): PASS 2 (Public, M1) · PARTIAL 13 · FAIL 6 (M2, M3, M12, M18, M19, M22) · ABSENT-BY-DESIGN 1 (M15).**

## Oct 14 defect family — retest results (all on today's HEAD `62ec551c`)

| Issue | Retest | Today's evidence |
|---|---|---|
| #1184 (class) | **STILL OPEN — class still producing failures** | Five original columns still missing (below) + at least five more found today (D1–D5) |
| #1185 job create 500 (`jobs.auto_send_on_apply`) | **STILL BROKEN** | `POST /api/recruiter/jobs` → 500; server log `column "auto_send_on_apply" of relation "jobs" does not exist` |
| #1186 careers API 500 (`companies.industry`) | **STILL BROKEN** | `GET /api/careers/1` and `/api/careers/qa-corp-2026-2` → 500; log `column "industry" does not exist` |
| #1187 careers page ignores URL company | **STILL BROKEN — now proven in the browser** | Logged-out visit to `/careers/qa-corp-2026-2` called `/api/careers/default` → 401 → bounced to /login (`M2-companies/careers-page-1186-1187.png`) |
| #1188 careers hard-coded stats | **STILL BROKEN** | Source still returns `avgTimeToHire: 18` server-side (`routes/careers.js:135,286`); rendered capture remains blocked by #1186's 500, as the issue itself states |
| #1189 public company profile 500 (`companies.logo_url`) | **STILL BROKEN** | API 500 + page renders "Failed to load company profile" (`M2-companies/public-company-page-1189.png`) |
| #1190 company profile update 500 (`companies.description`) | **STILL BROKEN** | `PUT /api/company/profile` → 500; log `column "description" does not exist` |
| #1191 candidate jobs list/detail 500 (`company_size`, `auto_send_on_apply`) | **STILL BROKEN** | API 500s; Job Board renders a false "0 active jobs" empty state (`M3-jobs/candidate-jobs-1191.png`) |
| #1192 starter scores for no-data accounts | **STILL BROKEN — now screenshot-proven** | Dashboard "300", OmniScore page "352 / Needs Work", fresh-company Trust "0/1000" — see M12/M4/M2 screenshots. Profile payload stays honest (`omni_score: null`; ring "Insufficient data") — the fabrication is in the stats/breakdown/trust payloads, exactly as filed |
| #254 admin ai-health feed 404 | **STILL BROKEN** | Admin dashboard's `GET /api/admin/ai-health` → 404 during this run (the standalone AI Health *page* works via other paths) |

## New findings for Lead to file (each with screenshot + log evidence in this package)

| # | Finding | Root cause (server log) | Sev |
|---|---|---|---|
| D1 | `GET /api/company/join-requests` 500s in the shell of **every recruiter page** | `column rjr.requested_at does not exist` — #1184 family | S2 |
| D2 | Candidate Saved Jobs 500 + **My Applications page renders false "0 applied"** while `GET /api/candidate/applications` returns the application | `column sj.saved_at does not exist` — #1184 family; page discards good data on the failed call | S2 |
| D3 | Admin compliance APIs 500 (`/api/admin/compliance/data-requests`, `consents`, `appeals`) | `column u.full_name does not exist` — #1184 family | S2 |
| D4 | Candidate referrals list 500 | `operator does not exist: uuid = integer` — drift-family type mismatch | S2 |
| D5 | AI Search recommendations 500 + TrustScore leaderboard 500 | `column c.logo_url does not exist` — same column as #1189 | S2 |
| D6 | OmniScore explainer 500 | `function percent_rank(integer) does not exist` (window function called without window) — code bug | S3 |
| D7 | Candidate interview history API 400 | Route treats `history` as `:id` — "Valid interview ID required" | S3 |
| D8 | Recruiter dashboard activity feed 404 | Client calls `/api/api/recruiter/activity` (double `/api` prefix — S-126 class) | S3 |
| D9 | TrustScore page unusable for company owner | All `/api/trustscore*` calls 403 "Recruiter access required" for role `employer` (RBAC drift, cf. #766) | S2 |
| D10 | **Company owner lands on "Awaiting Approval" after login** — page claims a join request is pending; DB shows the user IS `companies.owner_id` and **zero join requests exist**. Direct URLs bypass the wall, so the guard is also inconsistent | Post-login routing misclassifies the owner (cf. the #6 ownership findings) | S2 |
| D11 | Admin Analytics / Biometric Audit / Email Queue pages bounce the env-admin to /login | Their APIs (`/api/analytics/dashboard`, `/api/admin/biometric-audit`, `/api/admin/email-queue`) 401 the cookie admin session — mixed auth models | S2 |
| D12 | Valid client routes return **HTTP 404 document status while rendering** (`/compare`, `/leaderboard`, `/privacy/biometric-policy`, `/aptitude-tests`, `/candidate/identity-verification`, `/candidate/scores`, `/candidate/messages`, `/recruiter/aptitude-tests`, `/recruiter/session-room`, `/admin/biometric-audit`) | SPA fallback status handling | S3 |
| D13 | Candidate payroll page: `GET /api/payroll/employee/profile` 404 | Route missing/mismatched | S3 |
| D14 | LinkedIn Optimizer: `GET /api/profile-enhancement/linkedin-tips` 404 | Route missing/mismatched | S3 |

**Fabrication-class confirmations (already-filed set, fresh screenshot proof today):** fake TechCorp recruiter profile (S-115 family), invented recruiter inbox (S-123), invented recruiter compliance posture (S-124), #1192 starter scores, #1188 careers stats. The standing rule — *no mock/invented data presented as real on any surface* — is violated on at least five live surfaces on today's `dev`.

**Observations (not filed as defects):**
- O-1: CORS allowlist is hard-coded; any deployment on a host not in the list renders a blank page (hit during this run's setup on 127.0.0.1:3100). By design for known hosts; a trap for any new environment — same fresh-environment theme as #1184.
- O-2: Recruiter dashboard shows delta chips ("↗ 12%", "↗ 100%") on a company with 1 job / 1 applicant / no history — basis unverified; flagged for Lead's judgement, not claimed as fabrication.
- O-3: Candidate profile header shows "0 Applications" while the candidate has 1 (dashboard + API agree on 1).
- O-4: One console error on most pages (`ERR_SSL_PROTOCOL_ERROR`) is an external-resource fetch through this VM's egress proxy — environment noise, not an app defect.
- O-5: The seeded fixture job exists only because #1185 blocks the real create flow; every "job renders" PASS above inherits that caveat.

## What this run does NOT prove

Anything about the **live database** (it may or may not carry these columns — #1142's read-only introspection at the promotion gate is still the only instrument); staging behaviour; storage in production; billing checkout; live AI/interview sessions; the mobile pass (deferred by Sumanth's order); the anti-cheat surface (no completed-assessment fixture exists). Local Postgres 16.15 ≠ Neon's version. This run says: **the code installs and boots cleanly; the fresh-install data layer and five fabrication surfaces are not launch-ready** — and now every part of that sentence has a screenshot behind it.

## Package contents

- `QA-REPORT.md` — this report
- `screenshots/<module>/` — 97 PNGs, desktop 1440×900, named `<Module>__<screen>.png`
- `evidence/` — per-phase walk telemetry JSON (final URL, document status, failed requests, console errors, visible-text capture for every screen) + `seed-results.json`
