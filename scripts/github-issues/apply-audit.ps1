<#
.SYNOPSIS
    Applies the 2026-08-08 issue audit findings to GitHub.

.DESCRIPTION
    Every comment body lives in audit-comments/ as a markdown file and is
    passed straight to gh via --body-file. Nothing is interpolated in
    PowerShell, which keeps markdown backticks and code fences intact.

    Findings applied:
      1. Close #96, which duplicates work already completed on dev (#85).
      2. Flag three issues closed as COMPLETED with no supporting code,
         and note the real work on their open twins.
      3. Confirm three bugs still reproducible on dev.
      4. Annotate four roadmap issues that overlap existing implementations.
      5. File the dev-to-staging promotion gap.

    Idempotent: skips comments whose marker text is already present, and
    skips the new issue if a matching title already exists.

.PARAMETER DryRun
    Print the plan without touching GitHub.
#>

[CmdletBinding()]
param(
    [string]$GhPath = 'gh',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = 'sumanthrangausa-06/Rekrut_AI_v2'
$commentDir = Join-Path $PSScriptRoot 'audit-comments'
$marker = 'Audit 2026-08-08'

function Invoke-Gh {
    param([string[]]$Arguments)
    if ($DryRun) {
        Write-Host ('    [dry-run] gh ' + ($Arguments -join ' ')) -ForegroundColor DarkGray
        return ''
    }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $GhPath @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw ('gh failed: ' + ($Arguments -join ' ') + "`n" + $out) }
        return ($out -join "`n")
    }
    finally { $ErrorActionPreference = $prev }
}

function Test-AlreadyCommented {
    param([int]$Number)
    if ($DryRun) { return $false }
    $json = & $GhPath issue view $Number --repo $repo --json comments 2>$null
    if (-not $json) { return $false }
    $bodies = ($json | ConvertFrom-Json).comments.body -join "`n"
    return ($bodies -like ('*' + $marker + '*'))
}

function Add-FileComment {
    param([int]$Number, [string]$FileName, [string]$Label)
    $path = Join-Path $commentDir $FileName
    if (-not (Test-Path $path)) { throw ('missing comment file: ' + $path) }
    if (Test-AlreadyCommented -Number $Number) {
        Write-Host ('  = #' + $Number + ' already annotated') -ForegroundColor DarkGray
        return $false
    }
    Invoke-Gh @('issue', 'comment', "$Number", '--repo', $repo, '--body-file', $path) | Out-Null
    Write-Host ('  + #' + $Number + '  ' + $Label) -ForegroundColor Green
    return $true
}

Write-Host ''
Write-Host 'Applying 2026-08-08 audit findings' -ForegroundColor Cyan
if ($DryRun) { Write-Host 'Mode: DRY RUN' -ForegroundColor Yellow }
Write-Host ''

# --- 1. Close work already completed on dev --------------------------------

Write-Host '1. Closing issues that duplicate completed work' -ForegroundColor Cyan
$posted = Add-FileComment -Number 96 -FileName '96-close-duplicate.md' -Label 'render loops already fixed on dev'
if ($posted) {
    Invoke-Gh @('issue', 'close', '96', '--repo', $repo, '--reason', 'not planned') | Out-Null
    Write-Host '    closed #96' -ForegroundColor Green
}

# --- 2. False closures and their open twins --------------------------------

Write-Host ''
Write-Host '2. Flagging closures with no supporting code' -ForegroundColor Cyan
$pairs = @(
    @{ closed = 62; closedFile = '62-false-closure.md'; open = 52; openFile = '52-real-work.md'; what = 'OpenAPI docs' }
    @{ closed = 60; closedFile = '60-false-closure.md'; open = 45; openFile = '45-real-work.md'; what = 'load testing' }
    @{ closed = 63; closedFile = '63-false-closure.md'; open = 51; openFile = '51-real-work.md'; what = 'uptime monitoring' }
)
foreach ($p in $pairs) {
    Add-FileComment -Number $p.closed -FileName $p.closedFile -Label ('false closure: ' + $p.what) | Out-Null
    Add-FileComment -Number $p.open   -FileName $p.openFile   -Label ('real work: ' + $p.what)     | Out-Null
}

# --- 3. Bugs still reproducible on dev -------------------------------------

Write-Host ''
Write-Host '3. Confirming bugs still reproducible on dev' -ForegroundColor Cyan
Add-FileComment -Number 97  -FileName '97-confirmed.md'  -Label 'apply-from-drawer still dead-ends' | Out-Null
Add-FileComment -Number 101 -FileName '101-confirmed.md' -Label 'fabricated recruiter data remains' | Out-Null
Add-FileComment -Number 109 -FileName '109-narrowed.md'  -Label 'scope narrowed to 2 endpoints'     | Out-Null

# --- 4. Roadmap issues overlapping existing code ---------------------------

Write-Host ''
Write-Host '4. Annotating roadmap issues with existing implementation' -ForegroundColor Cyan
Add-FileComment -Number 146 -FileName '146-measure-first.md'          -Label 'code splitting likely done, measure first' | Out-Null
Add-FileComment -Number 142 -FileName '142-partial.md'                -Label 'EU AI Act partially built'                 | Out-Null
Add-FileComment -Number 53  -FileName '53-external-api-conflict.md'   -Label 'Cartesia shipped, conflicts with principle' | Out-Null
Add-FileComment -Number 78  -FileName '78-closeable.md'               -Label 'drawer already shipped'                     | Out-Null

# --- 5. The staging promotion gap ------------------------------------------

Write-Host ''
Write-Host '5. Filing the staging promotion gap' -ForegroundColor Cyan
$title = 'Promote dev to staging - six completed fixes are not deployed and QA is retesting stale code'
$found = $null
if (-not $DryRun) {
    $json = & $GhPath issue list --repo $repo --state all --limit 300 --json number,title 2>$null
    if ($json) { $found = ($json | ConvertFrom-Json) | Where-Object { $_.title -eq $title } }
}
if ($found) {
    Write-Host ('  = already exists as #' + $found[0].number) -ForegroundColor DarkGray
}
else {
    $url = Invoke-Gh @(
        'issue', 'create', '--repo', $repo,
        '--title', $title,
        '--body-file', (Join-Path $commentDir 'new-staging-promotion.md'),
        '--label', 'phase-0', '--label', 'P0', '--label', 'infrastructure', '--label', 'testing',
        '--milestone', 'Phase 0 - Critical Bug Fixes'
    )
    Write-Host ('  + created: ' + $url) -ForegroundColor Green
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Cyan
Write-Host ('  https://github.com/' + $repo + '/issues')
Write-Host ''
