# End-to-End QA Report — Candidate & Recruiter Flows

> **Date:** 2026-08-08
> **Environment:** Staging (`https://rekrutai-staging.onrender.com`) — commit `472c89f`, identical to production
> **Production:** `https://rekrutai.co` — read-only smoke pass only
> **Method:** Playwright (Chromium 151), fresh accounts, full route sweep + interactive flows
> **Coverage:** 29 candidate routes, 25 recruiter routes, 14 public/production pages, core hiring loop, Stripe, AI, email, video

---

## Executive Summary

The **core hiring loop works**: a recruiter can post a job, a candidate can discover and apply
to it, the application reaches the recruiter, and the recruiter can advance the candidate
through the pipeline. Every one of the 54 authenticated routes returned HTTP 200 and rendered
without a stuck spinner — the job-board spinner fix from `50f0edd` is holding.

Underneath that, three critical problems make the platform unsafe to scale or launch:

| # | Severity | Finding |
|---|----------|---------|
| 1 | **P0** | **14 pages are stuck in infinite render loops**, firing up to **1,255 API requests per page view**, including repeated `POST` writes |
| 2 | **P0** | **Staging is wired to LIVE Stripe keys** — checkout produced a real `cs_live_…` session for $29 |
| 3 | **P0** | **Candidates cannot apply from the job board** — the default path is a dead end |
| 4 | **P1** | **10 API endpoints referenced by the frontend do not exist**, silently disabling chat, screening, documents, career page and saved searches |
| 5 | **P1** | Recruiter Candidates list never renders; shows fabricated saved searches and trend deltas |
| 6 | **P2** | Candidate page calls a recruiter-only endpoint and gets 403 |
| 7 | **P2** | No email provider configured on staging — reset links only go to the server console |
| 8 | **P3** | Direct visit to the video interview page shows a raw `Error` card |

Counts: **3 Critical, 2 High, 2 Medium, 1 Low**, plus confirmation that six previously filed
issues are still reproducible.

---

## 1. [P0] Infinite render loops — up to 1,255 API calls per page view

### What happens
Opening certain pages causes the browser to hammer the API continuously for as long as the page
stays open. This is not slow loading; it is an unbounded loop. Measured over a single ~32 second
page visit on a brand-new account with no data:

**Recruiter**

| Page | API calls | Worst endpoint |
|------|-----------|----------------|
| `/recruiter/candidates` | **1,255** | `saved-searches` ×483, `jobs` ×265, `candidates/full` ×256, `pipeline-stats` ×243 |
| `/recruiter/jobs/new` | **653** | `GET /api/countries` ×644 |
| `/recruiter/job-create` | **648** | `GET /api/countries` ×640 |
| `/recruiter/offers` | **548** | `candidates` ×180, `onboarding/offers` ×180, `jobs` ×180 |
| `/recruiter/assessments` | **447** | `recruiter/catalog` ×108, `job-assessments/all` ×108 |
| `/recruiter/applications` | **366** | `recruiter/jobs` ×178, `recruiter/applications` ×178 |
| `/recruiter/company` | **366** | `company/team/members` ×179, `company/profile` ×179 |
| `/recruiter/onboarding-docs` | **343** | `onboarding/recruiter/summary` ×335 |
| `/recruiter/jobs` | **177** | `recruiter/jobs` ×169 |
| `/recruiter/omniscore` | **71** | `omniscore/company-dashboard` ×63 |

**Candidate**

| Page | API calls | Worst endpoint |
|------|-----------|----------------|
| `/candidate/omniscore` | **286** | `POST omniscore/checkin` ×70, `explainer` ×70, `breakdown` ×69, `trend` ×69 |
| `/candidate/onboarding` | **188** | `onboarding/wizard/progress` ×180 |
| `/candidate/offers` | **185** | `onboarding/offers/me` ×177 |
| `/candidate/profile` | **81** | `candidate/profile` ×73 |

### Why it matters
- `/recruiter/candidates` sustains roughly **39 requests per second per open tab**. Ten recruiters
  with the page open is ~400 req/s against the API and database.
- `/candidate/omniscore` issues **70 `POST` writes** to `omniscore/checkin` per visit. This is a
  write endpoint being called repeatedly, not an idempotent read.
- `/api/countries` is a static reference list fetched **644 times** to render one dropdown.
- Any AI-backed endpoint caught in one of these loops multiplies provider spend directly.

### Root cause
A single repeated mistake. The load function is declared as a plain `async function` in the
component body, which creates a **new function reference on every render**, and it is then listed
as a `useEffect` dependency. The effect re-runs after every render, sets state, which triggers
another render, which recreates the function, which re-runs the effect.

```264:290:client/src/pages/candidate/omniscore.tsx
	useEffect(() => {
		loadMyScore()
	}, [loadMyScore])

	useEffect(() => {
		if (tab === 'matches' && matches.length === 0) loadMatches()
		if (tab === 'rate-companies' && companies.length === 0) loadCompanies()
	}, [tab, loadCompanies, loadMatches, matches.length, companies.length])

	async function loadMyScore() {
		try {
			// Daily checkin + breakdown + trend + explainer in parallel
			await apiCall('/omniscore/checkin', { method: 'POST' }).catch(() => {})
```

Confirmed instances of the same pattern (plain `async function` used as an effect dependency):

| File | Effect dependency |
|------|-------------------|
| `client/src/pages/candidate/omniscore.tsx:266` | `loadMyScore` |
| `client/src/pages/candidate/profile.tsx:224` | `loadProfile` |
| `client/src/pages/candidate/offers.tsx:81` | `loadOffers` |
| `client/src/pages/candidate/onboarding.tsx:1368` | `loadProgress` |
| `client/src/pages/candidate/screening.tsx:70` | `loadScreening` (same pattern, not yet exercised) |

The recruiter pages exhibit identical behaviour and should be audited for the same construct.

### Fix
Wrap each loader in `useCallback` with a stable dependency array (as `jobs.tsx`, `applications.tsx`
and `ai-coaching.tsx` already do), or drop the function from the dependency array and run the
effect on mount only. A lint rule for `react-hooks/exhaustive-deps` plus a test asserting a
bounded request count per page would prevent regressions.

**Evidence:** `results/phase1-candidate.json`, `results/phase2-recruiter.json`

---

## 2. [P0] Staging is using LIVE Stripe keys

Clicking **Start checkout** on `/pricing` while signed in on **staging** produced:

```
POST https://rekrutai-staging.onrender.com/api/billing/checkout-session -> 200
→ https://checkout.stripe.com/c/pay/cs_live_b1ikxByCEsCMPaq4NyZKoElmJ6pXJwjDrhRGvh8G5qG0IPfijTUM9xqxwz...
```

The `cs_live_` prefix means this is a **live-mode** Stripe session. The rendered checkout read
"Subscribe to Starter - Rekrut AI — $29.00 per month". Anyone testing billing on staging with a
real card will be charged real money, and Stripe test cards will be rejected, so the billing path
cannot actually be QA'd.

I stopped at the checkout page and did not submit payment details.

**Fix:** point the staging service at `sk_test_` / `pk_test_` keys and a test-mode price ID.
Relates to #6 (Stripe live mode validation).

**Evidence:** `results/phase5b-retest.json`, `screenshots/retest-01-stripe.png`

---

## 3. [P0] Candidates cannot apply from the job board — the default path is a dead end

### Reproduction
1. Sign in as a candidate and open `/candidate/jobs`.
2. Click any job card. The slide-out detail drawer opens (URL stays `/candidate/jobs`).
3. Click **Apply Now** in the drawer.

**Expected:** the application form opens.
**Actual:** the browser navigates to `/candidate/jobs/174?apply=true` and the application form
stays closed. The page looks like an ordinary job page. No error, no form, no network request.
The candidate has no indication that anything failed.

Applying from the standalone page directly does work — clicking **Apply Now** there opens the
form and submitting produces `POST /api/candidate/jobs/174/apply -> 200`, with the application
appearing in the candidate's Applications list and in the recruiter's Applications view.

So the feature is functional, but **the entry point that users actually take is broken**.

### Root cause
The drawer navigates with an `apply=true` query parameter:

```1091:1096:client/src/pages/candidate/jobs.tsx
				onApply={() => {
					if (selectedJob) navigate(`/candidate/jobs/${selectedJob.id}?apply=true`)
				}}
				onViewFullPage={() => {
					if (selectedJob) navigate(`/candidate/jobs/${selectedJob.id}`)
				}}
```

But `client/src/pages/candidate/job-detail.tsx` never reads it — the file contains no
`useSearchParams`, no `location.search`, and no `URLSearchParams`. The form is gated purely on
local state:

```984:984:client/src/pages/candidate/job-detail.tsx
			{showApplyForm && !applied && !showOneClickModal && (
```

### Fix
In `job-detail.tsx`, read the query parameter on mount and call `setShowApplyForm(true)` when
`apply=true` is present.

This is a regression introduced with the job detail drawer (`c33bbb9`, issue #31 / PR #73).

**Evidence:** `results/phase4-pipeline.json`, `results/phase3c-apply-direct.json`,
`screenshots/drawer-02-after-apply.png`, `screenshots/apply-03-submitted.png`

---

## 4. [P1] Ten frontend-referenced API endpoints do not exist

These return `404 {"error":"API endpoint not found"}` and have no matching handler anywhere in
`routes/`. Each one silently disables a feature, because every call site swallows the error.

| Endpoint | Called from | Feature affected |
|----------|-------------|------------------|
| `GET /api/recruiter/saved-searches` | `/recruiter/candidates` | Saved searches (**called 483× per visit**) |
| `GET /api/recruiter/screenings` | `/recruiter/screening` | Recruiter screening |
| `GET /api/recruiter/conversations` | `/recruiter/chat` | Recruiter messaging |
| `GET /api/candidate/conversations` | `/candidate/chat` | Candidate messaging |
| `GET /api/conversations/:id/messages` | both chat pages | Message threads |
| `GET /api/careers/default` | `/recruiter/career-page` | Public careers page |
| `GET /api/candidate/list` | `/recruiter/onboarding-ai` | AI onboarding |
| `GET /api/candidate/documents` | `/candidate/documents` | Document management |
| `GET /api/onboarding/feedback/completed` | `/candidate/feedback` | Post-hire feedback |
| `GET /api/omniscore/explainer` | `/candidate/omniscore` | "Why This Score?" explainability |

Both sides of **chat/messaging are entirely non-functional** — a core two-sided hiring feature.

**Fix:** implement the endpoints, or remove the UI that depends on them, and surface real errors
instead of swallowing them in empty `catch {}` blocks.

**Evidence:** `results/phase1-candidate.json`, `results/phase2-recruiter.json`

---

## 5. [P1] Recruiter Candidates page: list never renders, data is fabricated

On a brand-new recruiter account with exactly one applicant, `/recruiter/candidates` shows:

- **Skeleton placeholders that never resolve.** The summary cards correctly read "Total
  Candidates 1 / New Applications 1", but the list below stays as grey loading bars indefinitely
  — a direct consequence of the 1,255-request loop in finding #1.
- **Fabricated saved searches.** Two chips labelled "Senior Engineers - Remote ★" and
  "High Match - Frontend" are displayed, despite the account never having created a search and
  `GET /api/recruiter/saved-searches` returning 404. These are hardcoded.
- **Fabricated trend deltas.** "↗12%", "↗8%", "−0%", "↗15%", "↗5%" on an account with no history.

The applicant who applied to this recruiter's own job never appears in the list, even though the
same application is visible on `/recruiter/applications`.

This confirms #69 and #15 are still open and extends them with the saved-searches fabrication.

**Evidence:** `screenshots/pipe-03-candidates.png`, `results/phase4-pipeline.json`

---

## 6. [P2] Candidate page calls a recruiter-only endpoint

`/candidate/offers/manage` issues `GET /api/recruiter/candidates`, which correctly returns
`403 {"error":"Recruiter access required"}`. The authorization check is doing its job; the bug is
that a candidate-facing route is wired to a recruiter data source. Either the route is mounted to
the wrong component or the component is querying the wrong endpoint.

**Evidence:** `results/phase1-candidate.json`

---

## 7. [P2] No email provider configured on staging

`POST /api/auth/forgot-password` returns 200, but the confirmation screen reads:

> **Check your console** — For testing purposes (no email API key configured), the password reset
> link has been logged to the server console.

No transactional email can be delivered from staging, so email flows (reset, invites, offer
letters, notifications) cannot be verified before release. Production email delivery was not
exercised in this read-only pass and still needs separate confirmation.

**Evidence:** `results/phase5b-retest.json`, `screenshots/retest-02-reset.png`

---

## 8. [P3] Video interview page shows a raw error card

Navigating directly to `/candidate/video-interview` renders a bare **"Error — No interview ID
provided"** card. The route is registered in `App.tsx` and therefore directly reachable, but has
no graceful empty state directing the user to their scheduled interviews.

**Evidence:** `screenshots/feat-05-video.png`

---

## What works well

Worth stating plainly, because a lot does:

- **The core hiring loop completes.** Job creation (`POST /api/recruiter/jobs -> 200`), candidate
  discovery, application submission, recruiter visibility, and pipeline advancement
  (`PUT /api/recruiter/applications/43 -> 200`) all function.
- **No stuck spinners anywhere.** All 54 authenticated routes rendered. The `50f0edd` job-board
  fix is holding.
- **No JavaScript exceptions.** Zero uncaught page errors across the entire sweep.
- **The three-step job posting wizard works**, including AI title/skill suggestion controls, and
  the posted job goes Active/Live immediately with correct counters.
- **AI coaching loads properly** with a 54-question library (15 behavioural, 25 technical,
  14 situational).
- **Stripe checkout mechanically works** — the session is created and the hosted page renders
  correctly. The defect is key configuration, not the integration.
- **Production public pages are clean.** All 14 pages returned 200 with no console errors and no
  failed requests.
- **Mobile is sound.** At 390×844 there is no horizontal overflow (`scrollWidth == clientWidth`).

---

## Previously filed issues — still reproducible

| Issue | Status |
|-------|--------|
| #15 / #69 recruiter mock data | Still present, now with fabricated saved searches too |
| #48 404 pages return HTTP 200 | Confirmed on production: `/this-route-does-not-exist` → 200 |
| #49 analytics CSRF | Confirmed: `POST /api/analytics/events` → `403 CSRF_INVALID` sitewide |
| #68 OmniScore | No longer a spinner, but now a 286-request loop with 70 writes — still broken |
| #70 slow post-auth redirect | Confirmed and consistent: 6.1 s on every login and signup |
| #76–#83 placeholder pages | All seven still render the stub page, reachable from nav with NEW badges |

---

## Test accounts (staging)

| Role | Email | Password |
|------|-------|----------|
| Candidate | `qa.cand.1786175062@rekrutqa.test` | `RekrutQA!2026x` |
| Recruiter | `qa.rec.1786175490@rekrutqa.test` | `RekrutQA!2026x` |

Test job created: **QA Loop Engineer 1786179662** (job ID 174), company "QA Staging Co 1786175490".

---

## Reproducing this run

```bash
cd docs/qa/live-qa-2026-08-08
pip install playwright && python -m playwright install chromium
python phase1_candidate.py      # candidate signup + 29-route sweep
python phase2_recruiter.py      # recruiter signup + 25-route sweep
python phase3_hiring_loop.py    # post job -> discover -> apply
python phase3c_apply_direct.py  # standalone vs drawer apply
python phase4_pipeline.py       # drawer defect + recruiter pipeline
python phase5_features.py       # pipeline advance, offers, AI, video
python phase5b_retest.py        # Stripe, reset email, AI generation
python phase6_prod_smoke.py     # read-only production pass
```

Each script writes structured JSON to `results/` and full-page screenshots to `screenshots/`.
`qa_lib.py` provides the shared recorder that captures console errors, failed requests, per-page
API call counts and stuck-spinner detection — the API call counter is what surfaced finding #1
and is worth keeping in CI.
