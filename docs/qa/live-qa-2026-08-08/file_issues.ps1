# Files GitHub issues + evidence comments from the 2026-08-08 end-to-end QA sweep.
$ErrorActionPreference = "Stop"
$tok = Get-Content "$env:TEMP\ghtok.txt" -Raw
$h = @{ Authorization = "Bearer $tok"; Accept = "application/vnd.github+json" }
$repo = "https://api.github.com/repos/sumanthrangausa-06/Rekrut_AI_v2"
$REPORT = "docs/qa/live-qa-2026-08-08/REPORT.md"
$created = @()

function New-Issue($title, $labels, $body) {
	$payload = @{ title = $title; labels = $labels; body = $body } | ConvertTo-Json -Depth 5
	$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
	$r = Invoke-RestMethod -Uri "$repo/issues" -Method Post -Headers $h -Body $bytes -ContentType "application/json"
	Write-Output "CREATED #$($r.number) - $title"
	return $r.number
}

function Add-Comment($num, $body) {
	$payload = @{ body = $body } | ConvertTo-Json -Depth 5
	$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
	Invoke-RestMethod -Uri "$repo/issues/$num/comments" -Method Post -Headers $h -Body $bytes -ContentType "application/json" | Out-Null
	Write-Output "COMMENTED on #$num"
}

# ---------------------------------------------------------------- Issue 1
$b1 = @"
Found during the 2026-08-08 end-to-end QA sweep on staging (commit ``472c89f``, identical to production).
Full report: [``$REPORT``]($REPORT)

## Summary
Fourteen pages are stuck in **infinite React render loops**. They fire API requests continuously for as long as the page is open. This is not slow loading, it is unbounded. All numbers below are from a **single ~32 second page visit on a brand-new account with no data**.

### Recruiter
| Page | API calls | Worst offenders |
|---|---|---|
| ``/recruiter/candidates`` | **1,255** | ``saved-searches`` x483, ``jobs`` x265, ``candidates/full`` x256, ``pipeline-stats`` x243 |
| ``/recruiter/jobs/new`` | **653** | ``GET /api/countries`` x644 |
| ``/recruiter/job-create`` | **648** | ``GET /api/countries`` x640 |
| ``/recruiter/offers`` | **548** | ``candidates`` x180, ``onboarding/offers`` x180, ``jobs`` x180 |
| ``/recruiter/assessments`` | **447** | ``recruiter/catalog`` x108, ``job-assessments/all`` x108 |
| ``/recruiter/applications`` | **366** | ``recruiter/jobs`` x178, ``recruiter/applications`` x178 |
| ``/recruiter/company`` | **366** | ``company/team/members`` x179, ``company/profile`` x179 |
| ``/recruiter/onboarding-docs`` | **343** | ``onboarding/recruiter/summary`` x335 |
| ``/recruiter/jobs`` | **177** | ``recruiter/jobs`` x169 |
| ``/recruiter/omniscore`` | **71** | ``omniscore/company-dashboard`` x63 |

### Candidate
| Page | API calls | Worst offenders |
|---|---|---|
| ``/candidate/omniscore`` | **286** | **``POST omniscore/checkin`` x70**, ``explainer`` x70, ``breakdown`` x69, ``trend`` x69 |
| ``/candidate/onboarding`` | **188** | ``onboarding/wizard/progress`` x180 |
| ``/candidate/offers`` | **185** | ``onboarding/offers/me`` x177 |
| ``/candidate/profile`` | **81** | ``candidate/profile`` x73 |

## Impact
- ``/recruiter/candidates`` sustains roughly **39 requests/second per open tab**. Ten recruiters with that tab open is ~400 req/s hitting the API and database.
- ``/candidate/omniscore`` performs **70 POST writes** per visit to ``omniscore/checkin``. That is a write endpoint, not an idempotent read.
- ``/api/countries`` is a **static reference list fetched 644 times** to populate one dropdown.
- Any AI-backed endpoint caught in a loop multiplies provider spend directly.
- It also blocks the UI: the Candidates list never escapes its skeleton state because the loop never settles.

## Root cause
The loader is declared as a plain ``async function`` in the component body, so it is a **new reference on every render**, and it is then used as a ``useEffect`` dependency. Effect runs, sets state, re-render, new function reference, effect runs again, forever.

\`\`\`tsx
// client/src/pages/candidate/omniscore.tsx:264
useEffect(() => {
    loadMyScore()
}, [loadMyScore])          // <-- new reference every render

async function loadMyScore() {          // <-- not memoised
    await apiCall('/omniscore/checkin', { method: 'POST' }).catch(() => {})
    ...
}
\`\`\`

Confirmed instances of the identical construct:

| File | Effect dependency |
|---|---|
| ``client/src/pages/candidate/omniscore.tsx:266`` | ``loadMyScore`` |
| ``client/src/pages/candidate/profile.tsx:224`` | ``loadProfile`` |
| ``client/src/pages/candidate/offers.tsx:81`` | ``loadOffers`` |
| ``client/src/pages/candidate/onboarding.tsx:1368`` | ``loadProgress`` |
| ``client/src/pages/candidate/screening.tsx:70`` | ``loadScreening`` (same pattern, not yet exercised) |

The recruiter pages show identical behaviour and need the same audit.

## Suggested fix
Wrap each loader in ``useCallback`` with a stable dependency array, exactly as ``jobs.tsx``, ``applications.tsx`` and ``ai-coaching.tsx`` already do, or drop the function from the dependency array and run on mount only.

To prevent regressions: enable ``react-hooks/exhaustive-deps`` and add a test asserting a bounded API request count per page load. The harness in ``docs/qa/live-qa-2026-08-08/qa_lib.py`` already counts requests per page and is what surfaced this.

## Evidence
- ``docs/qa/live-qa-2026-08-08/results/phase1-candidate.json``
- ``docs/qa/live-qa-2026-08-08/results/phase2-recruiter.json``
"@
$created += New-Issue "[P0][Performance] Infinite render loops on 14 pages - up to 1,255 API calls per page view, including repeated POST writes" @("P0", "bug", "performance", "launch-blocker") $b1

# ---------------------------------------------------------------- Issue 2
$b2 = @"
Found during the 2026-08-08 end-to-end QA sweep.
Full report: [``$REPORT``]($REPORT)

## Summary
**Staging is configured with live-mode Stripe keys.** Clicking **Start checkout** on ``/pricing`` while signed in on staging created a real, chargeable Stripe session.

\`\`\`
POST https://rekrutai-staging.onrender.com/api/billing/checkout-session -> 200
-> https://checkout.stripe.com/c/pay/cs_live_b1ikxByCEsCMPaq4NyZKoElmJ6pXJwjDrhRGvh8G5qG0IPfijTUM9xqxwz...
\`\`\`

The ``cs_live_`` prefix confirms **live mode**. The hosted checkout rendered "Subscribe to Starter - Rekrut AI - \$29.00 per month".

I stopped at the checkout page and did **not** submit payment details.

## Impact
1. Anyone QA-ing billing on staging with a real card **will be charged real money**.
2. Stripe **test cards are rejected** in live mode, so the billing path cannot be properly tested before release.
3. Test traffic pollutes live Stripe data (customers, subscriptions, MRR reporting).

## Suggested fix
Point the ``rekrutai-staging`` Render service at ``sk_test_`` / ``pk_test_`` keys and a test-mode price ID, and add a startup assertion that refuses to boot with a ``sk_live_`` key when ``NODE_ENV !== 'production'``.

Related: #6 (Stripe live mode validation).

## Evidence
- ``docs/qa/live-qa-2026-08-08/results/phase5b-retest.json``
- ``docs/qa/live-qa-2026-08-08/screenshots/retest-01-stripe.png``
"@
$created += New-Issue "[P0][Security] Staging is configured with LIVE Stripe keys - checkout creates real chargeable cs_live sessions" @("P0", "security", "launch-blocker") $b2

# ---------------------------------------------------------------- Issue 3
$b3 = @"
Found during the 2026-08-08 end-to-end QA sweep on staging (commit ``472c89f``, identical to production).
Full report: [``$REPORT``]($REPORT)

## Summary
Candidates **cannot apply to a job from the job board**, which is the default path. The Apply button in the new slide-out drawer is a dead end with no error and no feedback.

## Reproduction
1. Sign in as a candidate, open ``/candidate/jobs``
2. Click any job card - the slide-out detail drawer opens (URL stays ``/candidate/jobs``)
3. Click **Apply Now** in the drawer

**Expected:** the application form opens.
**Actual:** the browser navigates to ``/candidate/jobs/174?apply=true`` and **the form stays closed**. The page looks like a normal job page. No error, no form, no network request. The candidate has no indication anything failed.

Verified state after the click:
\`\`\`json
{ "url": "https://rekrutai-staging.onrender.com/candidate/jobs/174?apply=true",
  "apply_heading": false, "textareas": 0 }
\`\`\`

## The feature itself works - only the entry point is broken
Going straight to ``/candidate/jobs/174`` and clicking **Apply Now** there works end to end:
\`\`\`
POST /api/candidate/jobs/174/apply -> 200
\`\`\`
and the application then appears in the candidate's Applications list and in the recruiter's Applications view.

## Root cause
``jobs.tsx`` navigates with an ``apply=true`` query parameter:
\`\`\`tsx
// client/src/pages/candidate/jobs.tsx:1091
onApply={() => {
    if (selectedJob) navigate(\`/candidate/jobs/\${selectedJob.id}?apply=true\`)
}}
\`\`\`

But ``client/src/pages/candidate/job-detail.tsx`` **never reads it**. The file contains no ``useSearchParams``, no ``location.search`` and no ``URLSearchParams``. The form is gated purely on local state:
\`\`\`tsx
// client/src/pages/candidate/job-detail.tsx:984
{showApplyForm && !applied && !showOneClickModal && (
\`\`\`

## Suggested fix
In ``job-detail.tsx``, read the query parameter on mount and open the form when present:
\`\`\`tsx
const [searchParams] = useSearchParams()
useEffect(() => {
    if (searchParams.get('apply') === 'true') setShowApplyForm(true)
}, [searchParams])
\`\`\`

Regression introduced with the job detail drawer (``c33bbb9``, issue #31 / PR #73).

## Evidence
- ``docs/qa/live-qa-2026-08-08/results/phase4-pipeline.json``
- ``docs/qa/live-qa-2026-08-08/results/phase3c-apply-direct.json``
- ``docs/qa/live-qa-2026-08-08/screenshots/drawer-02-after-apply.png``
"@
$created += New-Issue "[P0][BUG] Candidates cannot apply from the job board - Apply Now in the job drawer is a silent dead end" @("P0", "bug", "launch-blocker") $b3

# ---------------------------------------------------------------- Issue 4
$b4 = @"
Found during the 2026-08-08 end-to-end QA sweep.
Full report: [``$REPORT``]($REPORT)

## Summary
Ten endpoints called by the frontend return ``404 {"error":"API endpoint not found"}``. None of them have a matching handler anywhere in ``routes/``. Every call site swallows the error in an empty ``catch {}``, so the features fail silently with no user-visible message.

| Endpoint | Called from | Feature broken |
|---|---|---|
| ``GET /api/recruiter/saved-searches`` | ``/recruiter/candidates`` | Saved searches (**called 483x per visit**) |
| ``GET /api/recruiter/screenings`` | ``/recruiter/screening`` | Recruiter screening |
| ``GET /api/recruiter/conversations`` | ``/recruiter/chat`` | Recruiter messaging |
| ``GET /api/candidate/conversations`` | ``/candidate/chat`` | Candidate messaging |
| ``GET /api/conversations/:id/messages`` | both chat pages | Message threads |
| ``GET /api/careers/default`` | ``/recruiter/career-page`` | Public careers page |
| ``GET /api/candidate/list`` | ``/recruiter/onboarding-ai`` | AI onboarding |
| ``GET /api/candidate/documents`` | ``/candidate/documents`` | Document management |
| ``GET /api/onboarding/feedback/completed`` | ``/candidate/feedback`` | Post-hire feedback |
| ``GET /api/omniscore/explainer`` | ``/candidate/omniscore`` | "Why This Score?" explainability |

## Impact
**Both sides of chat/messaging are entirely non-functional**, which is a core feature of a two-sided hiring platform. Document management, recruiter screening, the public career page and saved searches are equally dead.

Because the errors are swallowed, these pages render as permanently empty rather than showing a failure, so the breakage is invisible in monitoring.

## Suggested fix
Implement the missing endpoints, or remove the UI that depends on them. Separately, replace the empty ``catch {}`` blocks with real error surfacing so future missing endpoints are visible.

## Evidence
- ``docs/qa/live-qa-2026-08-08/results/phase1-candidate.json``
- ``docs/qa/live-qa-2026-08-08/results/phase2-recruiter.json``
"@
$created += New-Issue "[P1][BUG] Ten frontend-referenced API endpoints return 404 - chat, screening, documents and career page are silently dead" @("P1", "bug") $b4

# ---------------------------------------------------------------- Issue 5
$b5 = @"
Found during the 2026-08-08 end-to-end QA sweep.
Full report: [``$REPORT``]($REPORT)

## Summary
On a **brand-new recruiter account with exactly one applicant**, ``/recruiter/candidates`` is broken in three distinct ways at once.

1. **The candidate list never renders.** The summary cards correctly read "Total Candidates 1 / New Applications 1", but the list below stays as grey skeleton placeholders indefinitely. This is a direct consequence of the 1,255-request render loop on this page.
2. **Fabricated saved searches.** Two chips labelled **"Senior Engineers - Remote"** and **"High Match - Frontend"** are shown, despite the account never creating a search and ``GET /api/recruiter/saved-searches`` returning 404. These are hardcoded.
3. **Fabricated trend deltas.** The cards show "↗12%", "↗8%", "−0%", "↗15%", "↗5%" on an account with no history whatsoever.

The applicant who applied to this recruiter's own job **never appears in the list**, even though the same application is visible on ``/recruiter/applications``.

## Impact
Every new recruiter and trial signup sees a page that looks like it belongs to someone else's account, and cannot actually see the candidates who applied to them.

## Related
Confirms #69 and #15 are still open, and extends them with the fabricated saved-searches finding. The list-never-renders symptom is blocked on the render loop issue.

## Evidence
- ``docs/qa/live-qa-2026-08-08/screenshots/pipe-03-candidates.png``
- ``docs/qa/live-qa-2026-08-08/results/phase4-pipeline.json``
"@
$created += New-Issue "[P1][BUG] Recruiter Candidates page: list never renders, plus fabricated saved searches and trend deltas on new accounts" @("P1", "bug", "analytics") $b5

# ---------------------------------------------------------------- Issue 6
$b6 = @"
Found during the 2026-08-08 end-to-end QA sweep.
Full report: [``$REPORT``]($REPORT)

## Summary
``/candidate/offers/manage`` issues ``GET /api/recruiter/candidates`` while signed in as a candidate, which correctly returns:

\`\`\`
403 {"error":"Recruiter access required"}
\`\`\`

The authorization check is working as intended. The bug is that a **candidate-facing route is wired to a recruiter-only data source** - either the route is mounted to the wrong component in ``App.tsx``, or the component queries the wrong endpoint.

## Reproduction
1. Sign in as a candidate
2. Open ``/candidate/offers/manage``
3. Observe the 403 in the network panel

## Evidence
- ``docs/qa/live-qa-2026-08-08/results/phase1-candidate.json``
"@
$created += New-Issue "[P2][BUG] Candidate route /candidate/offers/manage calls recruiter-only endpoint and gets 403" @("P2", "bug") $b6

# ---------------------------------------------------------------- Issue 7
$b7 = @"
Found during the 2026-08-08 end-to-end QA sweep.
Full report: [``$REPORT``]($REPORT)

## Summary
``POST /api/auth/forgot-password`` returns 200 on staging, but no email is sent. The confirmation screen reads:

> **Check your console** - For testing purposes (no email API key configured), the password reset link has been logged to the server console. The link will expire in 15 minutes.

## Impact
No transactional email can be delivered from staging, so **email flows cannot be verified before release**: password reset, candidate invites, offer letters, interview scheduling and status notifications.

It also means the reset link is written to server logs, which is not something we want carrying over to any environment that handles real users.

## Suggested fix
Configure an email provider key on the staging service, or point staging at a capture inbox (Mailhog / Mailtrap / Resend test mode) so the flows are testable end to end.

Production email delivery was **not** exercised in this pass (read-only) and still needs separate confirmation.

## Evidence
- ``docs/qa/live-qa-2026-08-08/results/phase5b-retest.json``
- ``docs/qa/live-qa-2026-08-08/screenshots/retest-02-reset.png``
"@
$created += New-Issue "[P2][Infra] No email provider configured on staging - reset links only logged to server console, email flows untestable" @("P2", "infrastructure") $b7

# ---------------------------------------------------------------- Issue 8
$b8 = @"
Found during the 2026-08-08 end-to-end QA sweep.
Full report: [``$REPORT``]($REPORT)

## Summary
Navigating directly to ``/candidate/video-interview`` renders a bare error card:

> **Error** - No interview ID provided

The route is registered in ``App.tsx`` and therefore directly reachable (bookmark, back button, shared link), but it has no graceful empty state.

## Expected
Either redirect to ``/candidate/interviews``, or show a friendly empty state such as "No interview selected - here are your scheduled interviews" with a link.

## Evidence
- ``docs/qa/live-qa-2026-08-08/screenshots/feat-05-video.png``
"@
$created += New-Issue "[P3][UI] /candidate/video-interview shows a raw 'Error - No interview ID provided' card instead of an empty state" @("P3", "design", "bug") $b8

Write-Output ""
Write-Output "=== Created: $($created -join ', ') ==="
