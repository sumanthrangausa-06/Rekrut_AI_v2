# Adds 2026-08-08 QA evidence comments to existing issues.
$ErrorActionPreference = "Stop"
$tok = Get-Content "$env:TEMP\ghtok.txt" -Raw
$h = @{ Authorization = "Bearer $tok"; Accept = "application/vnd.github+json" }
$repo = "https://api.github.com/repos/sumanthrangausa-06/Rekrut_AI_v2"
$REPORT = "docs/qa/live-qa-2026-08-08/REPORT.md"

function Add-Comment($num, $body) {
	$payload = @{ body = $body } | ConvertTo-Json -Depth 5
	$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
	Invoke-RestMethod -Uri "$repo/issues/$num/comments" -Method Post -Headers $h -Body $bytes -ContentType "application/json" | Out-Null
	Write-Output "COMMENTED on #$num"
}

$hdr = "**Re-verified 2026-08-08** during a full end-to-end QA sweep on staging (commit ``472c89f``, identical to production). Report: [``$REPORT``]($REPORT)"

# ---- #68 OmniScore ----
Add-Comment 68 @"
$hdr

**Status changed, but still broken.** The infinite *spinner* is gone - the page now renders. What replaced it is worse:

``/candidate/omniscore`` fires **286 API calls in a single 32-second page visit**, including **70 ``POST /api/omniscore/checkin`` writes**:

| Endpoint | Calls |
|---|---|
| ``POST /api/omniscore/checkin`` | 70 |
| ``GET /api/omniscore/explainer`` | 70 (all **404**) |
| ``GET /api/memory/omniscore-trend`` | 69 |
| ``GET /api/omniscore/breakdown`` | 69 |

Two separate defects are involved, both now tracked:
- The render loop - see #85 (root cause is ``useEffect(() => loadMyScore(), [loadMyScore])`` at ``client/src/pages/candidate/omniscore.tsx:264`` with ``loadMyScore`` declared as a plain ``async function``)
- ``GET /api/omniscore/explainer`` does not exist server-side, so "Why This Score?" never renders - see #88

Suggest keeping this issue for the user-facing OmniScore experience and closing it once #85 and #88 land.
"@

# ---- #69 recruiter mock data ----
Add-Comment 69 @"
$hdr

**Still reproducible, and broader than previously recorded.** On a brand-new recruiter account with exactly one real applicant, ``/recruiter/candidates`` shows:

- **Fabricated saved searches**: chips labelled "Senior Engineers - Remote" and "High Match - Frontend", despite the account never creating one and ``GET /api/recruiter/saved-searches`` returning **404**. These are hardcoded.
- **Fabricated trend deltas**: "↗12%", "↗8%", "−0%", "↗15%", "↗5%" with no history to compute them from.
- **The real candidate list never renders** - permanent skeleton placeholders, because the page is stuck in a 1,255-request render loop (#85).

Screenshot: ``docs/qa/live-qa-2026-08-08/screenshots/pipe-03-candidates.png``

Filed as #89 with the full detail since the scope now includes the saved-searches fabrication and the list-rendering failure.
"@

# ---- #15 recruiter analytics ----
Add-Comment 15 @"
$hdr

Still open. Fabricated metrics remain on new recruiter accounts across **Dashboard, Candidates and Analytics** - not just Analytics. Newly documented this round: hardcoded "saved searches" chips on ``/recruiter/candidates`` for an account that has never created one.

Detail in #89. Note that the Candidates page cannot render its real data at all until the render loop in #85 is fixed.
"@

# ---- #70 slow redirect ----
Add-Comment 70 @"
$hdr

**Confirmed and consistent on staging.** Measured across six separate authentications this session, the post-auth redirect is reliably **~6.1 seconds**:

| Action | Time to land |
|---|---|
| Candidate signup | 6.22 s |
| Recruiter signup | 6.13 s |
| Candidate login | 6.10 - 6.15 s (4 runs) |
| Recruiter login | 6.11 - 6.14 s (2 runs) |

The consistency (always ~6.1 s, never 2 s or 15 s) points at a **fixed timer or a fixed-duration retry/poll**, not variable network latency.

Also worth noting: **registration lands on ``/login``, not the dashboard**. The account is authenticated by that point, but the user is routed through the login screen on the way, which is what makes signup feel broken.

Every authenticated page load also issues ``GET /api/auth/me`` and ``GET /api/billing/tier`` **4 times each**, which suggests duplicated auth bootstrapping that may be related.
"@

# ---- #48 SEO 404 ----
Add-Comment 48 @"
$hdr

Still reproducible **on production**. ``https://rekrutai.co/this-route-does-not-exist`` returns **HTTP 200** with the SPA shell rather than a 404 status. Verified 2026-08-08 in the read-only production smoke pass (``docs/qa/live-qa-2026-08-08/results/phase6-prod-smoke.json``).
"@

# ---- #49 analytics events ----
Add-Comment 49 @"
$hdr

Still reproducible. ``POST /api/analytics/events`` returns **403 ``{"error":"CSRF token validation failed","code":"CSRF_INVALID"}``** across the app, on both anonymous public pages and authenticated candidate/recruiter pages.

Observed again this session on ``/pricing`` and the settings pages while signed in. Sitewide event tracking is still not being collected.
"@

# ---- #76 - #83 placeholder features ----
$ph = @{
	76 = "/candidate/top-matches"
	77 = "/candidate/career-diagnosis"
	78 = "the job board (drawer exists, see note below)"
	79 = "/candidate/linkedin-optimizer"
	80 = "referrals (no route)"
	81 = "/candidate/career-diagnosis (working style)"
	82 = "/candidate/cv-review"
	83 = "auto-apply (no route)"
}
foreach ($n in 76, 77, 79, 81, 82) {
	Add-Comment $n @"
$hdr

**Confirmed still unbuilt.** Verified as part of a full sweep of all 29 candidate routes. This feature's route is wired to ``_PlaceholderPage`` in ``client/src/App.tsx`` and renders a stub (~510 characters of shell, no functionality).

It is reachable from the candidate sidebar and carries a **"NEW" badge**, so signed-in users are actively invited into a dead end. Worth either hiding these entries behind a flag until the features ship, or replacing the stub with an explicit "coming soon" state.

No duplicate filed - tracking here.
"@
}

Add-Comment 80 @"
$hdr

**Confirmed still unbuilt.** No route exists for this feature in ``client/src/App.tsx`` and nothing is reachable from the candidate navigation. Verified during a full sweep of all 29 candidate routes. No duplicate filed - tracking here.
"@

Add-Comment 83 @"
$hdr

**Confirmed still unbuilt.** No auto-apply route or control exists. Verified during a full sweep of all 29 candidate routes.

Related context worth having here: the **normal** apply path is currently broken from the job board - clicking "Apply Now" in the job drawer navigates to ``?apply=true`` which the detail page ignores, so no form opens (#87). That should land before auto-apply is built on top of it.
"@

Add-Comment 78 @"
$hdr

**Shipped, but with a defect.** The slide-out job drawer is live on ``/candidate/jobs`` and renders correctly (verified 2026-08-08 on staging).

However, its **Apply Now button is a dead end**: it navigates to ``/candidate/jobs/:id?apply=true`` and ``job-detail.tsx`` never reads that query parameter, so the application form never opens and no request is made. Applying from the standalone job page works fine.

Filed as #87 with the root cause and a suggested fix.
"@

Write-Output ""
Write-Output "=== Comments complete ==="
