<#
.SYNOPSIS
    Creates the Rekrut AI roadmap labels, milestones and issues on GitHub.

.DESCRIPTION
    Reads issues.json and creates everything via the GitHub CLI.
    Idempotent: existing labels, milestones and issues (matched by title) are
    skipped, so the script is safe to re-run after a partial failure.

    Task issues are linked to their epic after creation by appending a
    "Part of #N" line to the body and a checklist entry to the epic.

.PARAMETER GhPath
    Path to gh.exe. Defaults to whatever is on PATH.

.PARAMETER DryRun
    Print what would be created without calling GitHub.

.EXAMPLE
    ./create-issues.ps1 -DryRun
    ./create-issues.ps1
#>

[CmdletBinding()]
param(
    [string]$GhPath = "gh",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$specPath  = Join-Path $scriptDir "issues.json"

if (-not (Test-Path $specPath)) {
    throw "Cannot find issues.json at $specPath"
}

$spec = Get-Content $specPath -Raw | ConvertFrom-Json
$repo = $spec.meta.repo

function Invoke-Gh {
    param([string[]]$Arguments)
    if ($DryRun) {
        Write-Host "  [dry-run] gh $($Arguments -join ' ')" -ForegroundColor DarkGray
        return ""
    }
    $out = & $GhPath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gh failed: $($Arguments -join ' ')`n$out"
    }
    return ($out -join "`n")
}

Write-Host ""
Write-Host "Rekrut AI - GitHub issue bootstrap" -ForegroundColor Cyan
Write-Host "Repo: $repo"
if ($DryRun) { Write-Host "Mode: DRY RUN (nothing will be created)" -ForegroundColor Yellow }
Write-Host ""

# --- Preflight -------------------------------------------------------------

if (-not $DryRun) {
    & $GhPath auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "gh is not authenticated. Run: $GhPath auth login"
    }
}

# --- Labels ----------------------------------------------------------------

Write-Host "Labels" -ForegroundColor Cyan
$existingLabels = @{}
if (-not $DryRun) {
    $raw = & $GhPath label list --repo $repo --limit 200 --json name 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
        (($raw | ConvertFrom-Json).name) | ForEach-Object { $existingLabels[$_] = $true }
    }
}

foreach ($label in $spec.labels) {
    if ($existingLabels.ContainsKey($label.name)) {
        Write-Host "  = $($label.name) (exists)" -ForegroundColor DarkGray
        continue
    }
    Invoke-Gh @("label", "create", $label.name,
                "--repo", $repo,
                "--color", $label.color,
                "--description", $label.description) | Out-Null
    Write-Host "  + $($label.name)" -ForegroundColor Green
}

# --- Milestones ------------------------------------------------------------
# gh has no milestone command, so use the REST API.

Write-Host ""
Write-Host "Milestones" -ForegroundColor Cyan
$milestoneNumbers = @{}
$existingMilestones = @{}

if (-not $DryRun) {
    $raw = & $GhPath api "repos/$repo/milestones?state=all&per_page=100" 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
        foreach ($m in ($raw | ConvertFrom-Json)) {
            $existingMilestones[$m.title] = $m.number
        }
    }
}

foreach ($ms in $spec.milestones) {
    if ($existingMilestones.ContainsKey($ms.title)) {
        $milestoneNumbers[$ms.title] = $existingMilestones[$ms.title]
        Write-Host "  = $($ms.title) (exists, #$($existingMilestones[$ms.title]))" -ForegroundColor DarkGray
        continue
    }
    if ($DryRun) {
        Write-Host "  [dry-run] milestone: $($ms.title)" -ForegroundColor DarkGray
        continue
    }
    $result = & $GhPath api "repos/$repo/milestones" -X POST `
        -f title="$($ms.title)" `
        -f description="$($ms.description)" `
        -f due_on="$($ms.due_on)" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Failed to create milestone '$($ms.title)':`n$result" }
    $milestoneNumbers[$ms.title] = ($result | ConvertFrom-Json).number
    Write-Host "  + $($ms.title)" -ForegroundColor Green
}

# --- Issues ----------------------------------------------------------------

Write-Host ""
Write-Host "Issues" -ForegroundColor Cyan

# Existing issues by title, so a re-run does not duplicate.
$existingIssues = @{}
if (-not $DryRun) {
    $raw = & $GhPath issue list --repo $repo --state all --limit 500 --json number,title 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
        foreach ($i in ($raw | ConvertFrom-Json)) {
            $existingIssues[$i.title] = $i.number
        }
    }
}

$created = @{}   # key -> issue number
$order   = @()   # preserve declaration order for the epic-linking pass

foreach ($issue in $spec.issues) {
    $order += $issue

    if ($existingIssues.ContainsKey($issue.title)) {
        $created[$issue.key] = $existingIssues[$issue.title]
        Write-Host "  = #$($existingIssues[$issue.title]) $($issue.title)" -ForegroundColor DarkGray
        continue
    }

    # Body goes through a temp file so newlines and markdown survive intact.
    $bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) ("rekrut-issue-" + [guid]::NewGuid().ToString() + ".md")
    Set-Content -Path $bodyFile -Value $issue.body -Encoding UTF8

    try {
        $args = @("issue", "create", "--repo", $repo,
                  "--title", $issue.title,
                  "--body-file", $bodyFile)

        foreach ($l in $issue.labels) { $args += @("--label", $l) }

        if ($issue.milestone) { $args += @("--milestone", $issue.milestone) }

        if ($DryRun) {
            Write-Host "  [dry-run] $($issue.title)" -ForegroundColor DarkGray
            Write-Host "            labels: $($issue.labels -join ', ')" -ForegroundColor DarkGray
            if ($issue.milestone) { Write-Host "            milestone: $($issue.milestone)" -ForegroundColor DarkGray }
            continue
        }

        $url = Invoke-Gh $args
        $number = [int]($url -split '/')[-1]
        $created[$issue.key] = $number
        Write-Host "  + #$number $($issue.title)" -ForegroundColor Green
    }
    finally {
        Remove-Item $bodyFile -ErrorAction SilentlyContinue
    }
}

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry run complete. $($spec.issues.Count) issues would be created." -ForegroundColor Yellow
    return
}

# --- Link tasks to epics ---------------------------------------------------

Write-Host ""
Write-Host "Linking tasks to epics" -ForegroundColor Cyan

$epicChildren = @{}
foreach ($issue in $order) {
    if (-not $issue.epic) { continue }
    if (-not $created.ContainsKey($issue.key))  { continue }
    if (-not $created.ContainsKey($issue.epic)) { continue }

    $childNum = $created[$issue.key]
    $epicNum  = $created[$issue.epic]

    if (-not $epicChildren.ContainsKey($epicNum)) { $epicChildren[$epicNum] = @() }
    $epicChildren[$epicNum] += [pscustomobject]@{ Number = $childNum; Title = $issue.title }
}

foreach ($epicNum in $epicChildren.Keys) {
    $current = & $GhPath issue view $epicNum --repo $repo --json body | ConvertFrom-Json

    if ($current.body -match '## Tasks') {
        Write-Host "  = #$epicNum already has a task list" -ForegroundColor DarkGray
        continue
    }

    $lines = @($current.body, "", "## Tasks", "")
    foreach ($child in ($epicChildren[$epicNum] | Sort-Object Number)) {
        $lines += "- [ ] #$($child.Number) $($child.Title)"
    }

    $bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) ("rekrut-epic-" + [guid]::NewGuid().ToString() + ".md")
    Set-Content -Path $bodyFile -Value ($lines -join "`n") -Encoding UTF8
    try {
        Invoke-Gh @("issue", "edit", "$epicNum", "--repo", $repo, "--body-file", $bodyFile) | Out-Null
        Write-Host "  + #$epicNum linked $($epicChildren[$epicNum].Count) tasks" -ForegroundColor Green
    }
    finally {
        Remove-Item $bodyFile -ErrorAction SilentlyContinue
    }
}

# --- Summary ---------------------------------------------------------------

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
Write-Host "  Issues created or found: $($created.Count)"
Write-Host "  https://github.com/$repo/issues"
Write-Host ""
