# GitHub Issue Bootstrap

Creates the full Rekrut AI roadmap on GitHub: 22 labels, 7 milestones, 54 issues.

Generated from [`docs/reports/CEO_REVIEW_SUMMARY.md`](../../docs/reports/CEO_REVIEW_SUMMARY.md)
and [`docs/reports/STRATEGIC_MARKET_ANALYSIS.md`](../../docs/reports/STRATEGIC_MARKET_ANALYSIS.md).

## Files

| File | Purpose |
|------|---------|
| `issues.json` | Every label, milestone and issue, with full bodies |
| `create-issues.ps1` | Idempotent creation script |

## Run it

The GitHub CLI is already downloaded to a temp folder. If that folder is gone,
grab it again from https://cli.github.com or re-download the portable build.

```powershell
# 1. Put gh on PATH for this session
$env:PATH = "C:\Users\sranga\AppData\Local\Temp\ghcli\extract\bin;$env:PATH"

# 2. Log in (opens your browser)
gh auth login

# 3. Preview without creating anything
.\scripts\github-issues\create-issues.ps1 -DryRun

# 4. Create for real
.\scripts\github-issues\create-issues.ps1
```

If you prefer a personal access token, set `GH_TOKEN` instead of running
`gh auth login`. The token needs `repo` scope.

The script is safe to re-run. Labels, milestones and issues that already exist
(matched by name or title) are skipped, so a partial failure can be resumed by
simply running it again.

## What gets created

### Milestones

| Milestone | Effort | Due |
|-----------|--------|-----|
| Phase 0 - Critical Bug Fixes | 40h | 2026-08-15 |
| Phase 1 - MVP Launch | 80h | 2026-08-29 |
| Phase 2 - Structured Screening | 230h | 2026-09-26 |
| Phase 3 - Technical Assessment | 280h | 2026-10-31 |
| Phase 4 - Interview Excellence | 240h | 2026-12-05 |
| Phase 5 - Secure Hiring | 200h | 2027-01-16 |
| Phase 6 - Enterprise Complete | 265h | 2027-02-27 |

### Issue structure

One vision issue, seven phase epics, and 46 task issues. Tasks are linked to
their epic by a checklist appended to the epic body after creation.

**Vision** — Product vision and master roadmap. Explains what we are building,
the market evidence for why it matters, the full candidate and recruiter
pipelines, and the locked architecture decisions.

**Phase 0, Critical Bug Fixes** — Render loops, apply-from-drawer, live Stripe
keys on staging, missing email provider, analytics CSRF, fabricated recruiter
data. All sourced from `docs/qa/live-qa-2026-08-08/REPORT.md`.

**Phase 1, MVP Launch** — Company email domain enforcement, recruiter approval
workflow, slow post-auth redirect, 404 status codes, video empty state, plus
monitoring, bundle splitting and XSS hardening.

**Phase 2, Structured Screening** — The ten missing API endpoints, screening
questions, aptitude test engine, AI Recruiter Screener, OmniScore v2, chat,
documents, ClickHouse, E2E coverage.

**Phase 3, Technical Assessment** — Docker and Judge0 code sandbox, its security
audit, test templates and auto-grading, proctoring, AI Career Coach,
TrustScore v2.

**Phase 4, Interview Excellence** — LiveKit, panel interviews, recording and
transcript, calendar integration, team collaboration, analytics dashboard.

**Phase 5, Secure Hiring** — E-signature, identity verification, employment and
education verification, OCR and fraud detection, Aadhaar, audit trail.

**Phase 6, Enterprise Complete** — RBAC, team hierarchy, public API, bulk
import, EU AI Act compliance reporting.

## Editing before you run

`issues.json` is the source of truth. Change a title, body, label or milestone
there and re-run. Because matching is by title, editing a title after the issue
already exists will create a second issue rather than updating the first.
