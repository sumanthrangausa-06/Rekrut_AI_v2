<#
.SYNOPSIS
    Reconciles the pre-existing issue backlog against the roadmap issues
    created from issues.json.

.DESCRIPTION
    Three passes:
      1. Close older issues that the new roadmap issues supersede, leaving a
         comment on both sides so the trail is followable.
      2. Cross-link older issues whose scope overlaps but is genuinely
         distinct, without closing anything.
      3. Assign unmilestoned backlog issues to the phase they belong to.

    Idempotent: skips anything already closed or already assigned.

.PARAMETER DryRun
    Print the plan without touching GitHub.
#>

[CmdletBinding()]
param(
    [string]$GhPath = "gh",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repo = "sumanthrangausa-06/Rekrut_AI_v2"

# --- Pass 1: supersede ------------------------------------------------------
# old = the pre-existing issue to close
# new = the roadmap issue that replaces it
$supersede = @(
    @{ old = 86; new = 98;  topic = "staging is configured with live Stripe keys" }
    @{ old = 87; new = 97;  topic = "candidates cannot apply from the job board drawer" }
    @{ old = 88; new = 109; topic = "ten frontend-referenced API endpoints return 404" }
    @{ old = 89; new = 101; topic = "recruiter Candidates page shows fabricated data" }
    @{ old = 69; new = 101; topic = "recruiter pages show fabricated mock data" }
    @{ old = 91; new = 99;  topic = "no email provider configured on staging" }
    @{ old = 92; new = 107; topic = "video interview page shows a raw error card" }
    @{ old = 68; new = 96;  topic = "candidate OmniScore page is broken" }
    @{ old = 70; new = 105; topic = "slow post-auth redirect" }
    @{ old = 8;  new = 145; topic = "E2E test suite" }
    @{ old = 43; new = 146; topic = "splitting the 1.55MB main bundle" }
    @{ old = 50; new = 142; topic = "EU AI Act compliance dashboard" }
)

# Superseded because the architecture decision changed, not just detail level.
$supersedeWithReason = @(
    @{
        old = 9; new = 144
        topic = "production monitoring and alerting"
        reason = "The original issue proposed Sentry or Datadog. The CEO review on 2026-08-08 settled on a fully self-hosted stack (Prometheus, Grafana, Loki, Alertmanager) to stay consistent with the all-in-one, no-external-dependency principle."
    }
)

# --- Pass 2: cross-link only ------------------------------------------------
# Overlapping but distinct scope. Both stay open.
$crossLink = @(
    @{ a = 6;  b = 98;  note = "#6 covers validating live mode on **production**. #98 covers **staging** wrongly holding live keys. Both need doing, in that order." }
    @{ a = 49; b = 100; note = "#100 fixes the CSRF failure that currently blocks every analytics event. #49 is the follow-up verification that the full funnel actually fires once #100 lands." }
    @{ a = 51; b = 144; note = "#144 covers internal observability. #51 covers **external** uptime pinging, which is what catches a total outage that internal monitoring cannot self-report." }
)

# --- Pass 3: milestone triage ----------------------------------------------
$triage = @{
    "Phase 0 - Critical Bug Fixes" = @(90)
    "Phase 1 - MVP Launch" = @(
        6,    # Stripe live mode validation on production
        7,    # Sign up / sign in UI polish
        10,   # Job search UI polish
        11,   # Profile edit UI polish
        12,   # Recruiter dashboard UI polish
        13,   # Create job UI polish
        16,   # Filter button empty on mobile
        18,   # Settings/notifications request failed
        49,   # Event tracking verification
        71,   # Leftover E2E test jobs visible in production
        72    # Truncated chart labels
    )
    "Phase 2 - Structured Screening" = @(
        3,    # Candidate search, build from placeholder
        14,   # Chat UI polish
        23,   # AI "why you're a match" explanations
        76,   # Job fit score
        81    # Working style profile
    )
    "Phase 3 - Technical Assessment" = @(
        26,   # Profile enhancement tools
        34,   # CV review dashboard
        77,   # Career diagnosis
        82    # AI CV review
    )
    "Phase 4 - Interview Excellence" = @(
        5,    # AI interview UI polish
        15    # Recruiter analytics dashboard
    )
    "Phase 6 - Enterprise Complete" = @(
        52    # OpenAPI documentation for 351 endpoints
    )
}

# ---------------------------------------------------------------------------

function Invoke-Gh {
    param([string[]]$Arguments)
    if ($DryRun) {
        Write-Host "    [dry-run] gh $($Arguments -join ' ')" -ForegroundColor DarkGray
        return ""
    }
    # gh writes its success confirmations to stderr, which PowerShell would
    # otherwise promote to a terminating error. Trust the exit code instead.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = & $GhPath @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw "gh failed: $($Arguments -join ' ')`n$out" }
        return ($out -join "`n")
    }
    finally { $ErrorActionPreference = $prev }
}

function Add-Comment {
    param([int]$Number, [string]$Body)
    $f = Join-Path ([System.IO.Path]::GetTempPath()) ("rk-" + [guid]::NewGuid().ToString() + ".md")
    Set-Content -Path $f -Value $Body -Encoding UTF8
    try { Invoke-Gh @("issue", "comment", "$Number", "--repo", $repo, "--body-file", $f) | Out-Null }
    finally { Remove-Item $f -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "Reconciling backlog against roadmap issues" -ForegroundColor Cyan
if ($DryRun) { Write-Host "Mode: DRY RUN" -ForegroundColor Yellow }
Write-Host ""

# Snapshot current state so we can skip work already done.
$state = @{}
$raw = & $GhPath issue list --repo $repo --state all --limit 300 --json number,state,milestone
foreach ($i in ($raw | ConvertFrom-Json)) {
    $state[$i.number] = [pscustomobject]@{
        State     = $i.state
        Milestone = if ($i.milestone) { $i.milestone.title } else { $null }
    }
}

# --- Pass 1 -----------------------------------------------------------------

Write-Host "Pass 1: closing superseded issues" -ForegroundColor Cyan

$allSupersede = @()
foreach ($m in $supersede) {
    $allSupersede += @{
        old = $m.old; new = $m.new; topic = $m.topic
        reason = "The replacement carries the reproduction steps, root cause with file and line references, and acceptance criteria from the 2026-08-08 QA sweep."
    }
}
$allSupersede += $supersedeWithReason

foreach ($m in $allSupersede) {
    if ($state.ContainsKey($m.old) -and $state[$m.old].State -eq "CLOSED") {
        Write-Host "  = #$($m.old) already closed" -ForegroundColor DarkGray
        continue
    }

    Add-Comment -Number $m.old -Body @"
Superseded by #$($m.new).

$($m.reason)

Closing this one so there is a single place to track $($m.topic). Follow #$($m.new).
"@

    Invoke-Gh @("issue", "close", "$($m.old)", "--repo", $repo, "--reason", "not planned") | Out-Null
    Add-Comment -Number $m.new -Body "Supersedes #$($m.old), which covered the same ground and has been closed."
    Write-Host "  + closed #$($m.old), superseded by #$($m.new)" -ForegroundColor Green
}

# --- Pass 2 -----------------------------------------------------------------

Write-Host ""
Write-Host "Pass 2: cross-linking overlapping issues" -ForegroundColor Cyan

foreach ($l in $crossLink) {
    Add-Comment -Number $l.a -Body "Related to #$($l.b).`n`n$($l.note)"
    Add-Comment -Number $l.b -Body "Related to #$($l.a).`n`n$($l.note)"
    Write-Host "  + linked #$($l.a) <-> #$($l.b)" -ForegroundColor Green
}

# --- Pass 3 -----------------------------------------------------------------

Write-Host ""
Write-Host "Pass 3: assigning backlog issues to milestones" -ForegroundColor Cyan

foreach ($milestone in $triage.Keys | Sort-Object) {
    Write-Host "  $milestone" -ForegroundColor White
    foreach ($num in $triage[$milestone]) {
        if (-not $state.ContainsKey($num)) {
            Write-Host "    ! #$num not found, skipping" -ForegroundColor Yellow
            continue
        }
        if ($state[$num].State -eq "CLOSED") {
            Write-Host "    = #$num closed, skipping" -ForegroundColor DarkGray
            continue
        }
        if ($state[$num].Milestone) {
            Write-Host "    = #$num already in '$($state[$num].Milestone)'" -ForegroundColor DarkGray
            continue
        }
        Invoke-Gh @("issue", "edit", "$num", "--repo", $repo, "--milestone", $milestone) | Out-Null
        Write-Host "    + #$num" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
Write-Host "  https://github.com/$repo/milestones"
Write-Host ""
