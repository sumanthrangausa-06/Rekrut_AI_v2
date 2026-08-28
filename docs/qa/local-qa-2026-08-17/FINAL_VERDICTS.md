# Local ready-for-QA verdicts — 2026-08-20

Environment: `localhost:3000` on `dev` @ `80326e3`, Postgres 17.6 on `:5433`.
Render staging/dev/prod are **billing-suspended**. Render MCP has **no env-read tool**, so staging keys were not applied. Local `.env` has no OpenAI/LiveKit/Stripe/OAuth secrets.

## Why links look missing

Three independent defects, not one:

1. **RBAC never assigns roles** (`user_roles` starts empty). `routes/auth.js` creates a company for a new recruiter but never inserts `user_roles`. Then ~85 endpoints gated by `requirePermission()` return 403, including `GET /api/company/profile`. Auth context calls that on **every** logged-in page (`client/src/contexts/auth-context.tsx`). Candidate pages therefore always fire a 403. Recruiter pages did too until QA locally inserted an `owner` row.

2. **Header links point at routes that do not exist** (`client/src/components/layout/header.tsx`):
   - Candidate Coaching → `/candidate/coaching` (real route is `/candidate/ai-coaching`)
   - Recruiter Dashboard → `/recruiter/dashboard` (real route is `/recruiter`)
   Six other pages also `Link` to `/recruiter/dashboard`.

3. **Features have routes but no sidebar entry** — they exist in `App.tsx` and cannot be reached by clicking around:

   Candidate orphans: `/candidate/chat`, `/candidate/ai-screening`, `/candidate/background-check`, `/candidate/video-interview`, `/candidate/interview`, `/candidate/interview-practice`, `/candidate/interview-analysis`, `/candidate/history`, `/candidate/feedback`, `/candidate/livekit-room`, `/candidate/company-profile`, `/candidate/offers/manage`, `/candidate/assessment-results`.

   Recruiter orphans: `/recruiter/chat`, `/recruiter/screening`, `/recruiter/background-check`, `/recruiter/trustscore`, `/recruiter/profile`, `/recruiter/career-page`, `/recruiter/communications`, `/recruiter/onboarding-ai`, `/recruiter/onboarding-docs`, `/recruiter/payroll-dashboard`, `/recruiter/post-hire-feedback`, `/recruiter/job-create`.

4. **Stale `KNOWN_ROUTES` in `server.js`** (Issue #106 overcorrection). Valid SPA paths such as `/recruiter/panels`, `/recruiter/recordings`, `/recruiter/calendar`, `/recruiter/background-check`, `/candidate/referrals` still **render**, but the HTTP status is 404 because they are missing from the regex list. Direct refresh / crawlers / Playwright treat them as missing.

Sidebar itself is **not** empty: after login, candidate has 22 working nav items and recruiter has 19. Click-test: only `/recruiter/candidates` crashed.

## Cross-cutting launch blockers

| ID | Defect | Impact |
|---|---|---|
| P0 | `analyticsCache.key` is `static` but called on the instance (`lib/analytics-cache.js:27`) | `/api/recruiter/dashboard`, pipeline-stats, analytics — 500 |
| P0 | `user_roles` never populated on registration (#138) | Recruiter owner is locked out of own company APIs |
| P0 | `CandidateOmniScorePage` / `RecruiterInterviewsPage` missing imports | Already filed as [#182](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/182); local build has the fix |
| P0 | Fresh migrate cannot complete | [#183](https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/183) |
| P0 | `UNSPLASH_IMAGES` used in `candidates.tsx` without import | Recruiter Candidates page error-boundary |
| P1 | Auth context always hits `/api/company/profile` | Every candidate page logs 403 |
| P1 | `KNOWN_ROUTES` incomplete | Valid pages return HTTP 404 |

## Browser E2E (after local owner-role grant + seeded job)

**Candidate:** all 22 sidebar links rendered. Job Board shows seeded job with **70% fit**. Top Matches shows premium gate. Company Matches shows 4-step flow. Settings Profile tab loads. OmniScore and Career Coach return 500 (schema). Every page still requests `/api/company/profile` → 403.

**Recruiter:** 19/20 sidebar links OK. **Candidates crashes**. Dashboard UI paints but API 500 so metrics stay 0. Create Job, Team, Company, Compliance, Screening render.

## Per-issue matrix (70 `ready-for-qa`)

Verdict key: **FAIL** = broken vs acceptance; **PASS** = exercised and met; **PARTIAL** = some AC; **BLOCKED** = needs keys/staging; **SHIPPED-UI** = page exists, AC not fully proven.

### FAIL
| # | Why |
|---|---|
| 3 | `candidate_search_index` never created (migration 130) |
| 12 / 72 / 129 | `analyticsCache.key is not a function` → dashboard/analytics 500 |
| 45 | No load-test plan/docs |
| 77 | `diagnosis_data` column missing |
| 112 / 128 / 141 | Candidates page: `UNSPLASH_IMAGES` + search 500 + pipeline-stats 500 |
| 113 | `v.status` missing on `document_verifications` |
| 119 | `coding_templates` never created (migration 119 JSON) |
| 121 | `career_coach_sessions` never created (`current_role` reserved) |
| 122 | `/api/trustscore/breakdown` 500 (`u.location` missing); methodology 200 |
| 136 | Admin consents query `u.full_name` missing (page shell can still render) |
| 138 | RBAC tables seeded; **no assignment path** — feature fails closed |
| 143 | No ClickHouse integration files |
| 178 | `cartesia-voice.js` still 487 lines |

### PASS (API and/or visual, with caveats)
18 (settings page loads; notifications tab not fully clicked after rate-limit), 28, 29, 37, 44 (landing), 80 (referrals page exists; HTTP 404 from KNOWN_ROUTES), 82 (empty-state 404 for no CV is correct), 90 (**fixed in routing**: `/candidate/offers/manage` now mounts `CandidateOffersPage`, empty state, not recruiter API), 104 (Team + Join Requests render for owner), 106 (unknown path 404s), 110 (screening page renders after RBAC), 111, 114 (conversations API 200; chat is **orphan** in nav), 115, 118 (audit doc exists), 127 (calendar UI; HTTP 404 from KNOWN_ROUTES), 139, 140, 142, 156, 169, 170, 173, 180.

### PARTIAL
| # | Why |
|---|---|
| 13 | Create-job page renders cleanly; polish AC subjective |
| 16 | Filter button exists on jobs; mobile label not re-verified after login rate-limit |
| 23 / 24 | Premium gate present; generated explanations not exercised (no AI key / gated) |
| 25 / 30 / 76 | Seeded job card + 70% fit visible; skill pills not all in card text |
| 27 | 4-step UI present; AI outreach not run |
| 33 | Auto-apply API 200; no Auto-Apply control on job card |
| 34 | CV Review page exists; no uploaded CV / AI |
| 38 | Top 5 badge on job card; intro CTA not in free Top Matches overlay |
| 52 | `lib/openapi-generator.js` exists; `/api/docs` 401 without auth |
| 109 | Several missing endpoints now exist; omniscore still 500 |
| 117 | `/api/sandbox/languages` 200; Judge0/Docker not proven |
| 125 / 126 | Pages render; HTTP 404 from KNOWN_ROUTES; no live sessions |

### BLOCKED (need staging keys / unsuspend Render)
6 Stripe live, 5 AI interview polish (camera/LLM), 44 full asset/OG, 53 Cartesia live, 107 video empty-state (LiveKit), 120 proctoring, 124 LiveKit, 133–135 verification vendors, 159–168 OAuth.

### SHIPPED-UI only (not a sign-off)
5, 11, 14 — pages load; polish AC not measured.

## Staging keys

Cannot fetch via Render MCP (`update_environment_variables` only). All three Render services are **suspended for billing**. Paste a staging env export (or unsuspend and give API access) if you want OAuth/Stripe/LiveKit/AI retested.

## Not posted to GitHub yet

Ask if I should comment + relabel the remaining issues. Already on GitHub: #182, #183, and earlier comments on #3, #77, #113, #119, #121, #129.
