# Rekrut AI — Error Tracker & Issue Monitor

> **Built by:** Suga (CTO)  
> **Runtime:** 7 months (continuous background process)  
> **Purpose:** Track every launch blocker, wait for fixes, and report daily.

---

## What This Does

This is a headless TypeScript process that runs 24/7 for 7 months. It tracks every issue in the Rekrut AI codebase, watches for fixes, detects regressions, and generates a daily report for Ranga.

**No fluff. No UI. Just a log file and a daily markdown report.**

---

## How It Works

### 1. Poll Loop (Every 60 seconds)
- Reads the master issue tracker JSON file
- Checks for new issues added by the team
- Checks for slipped deadlines (P0 = 3 days, P1 = 7 days, P2 = 14 days)
- Checks for resolved issues (via git commits or manual updates)
- Saves state to `.tracker-state.json`

### 2. Trigger System (Every 1 second)
- Lightweight tick check for real-time responsiveness
- Fires on: file changes, git commits, CI/CD completions
- Auto-detects fix keywords in commit messages (`fix`, `resolve`, `close`)
- Maps file paths to related issues automatically

### 3. Daily Report (Every 24 hours at 6 PM IST)
- Generates `daily-status.md` in `./reports/`
- Counts: fixed, new, regressed, slipped
- Lists all P0 blockers with detail
- Answers: **"Are we ready to launch?"** — Yes / Conditional / No
- Writes action items for next 7 days

### 4. Alert System
- Critical: New P0 found, P0 slipped >3 days, CI/CD failure with P0s open
- Warning: P1 slipped >3 days, >5 new issues in 24h
- Info: Daily summary, fix confirmations
- Alerts written to `./alerts/` as JSON files for Slack/email integration

---

## File Structure

```
./
├── error-tracker.ts          # Main script (this file)
├── .tracker-state.json       # Runtime state (auto-created)
├── issues/
│   └── master-tracker.json   # Source of truth for all issues
├── logs/
│   └── error-tracker.log     # Every check, every alert
├── reports/
│   └── daily-status.md       # Daily report for Ranga
└── alerts/
    └── alert-*.json          # Individual alert files
```

---

## Setup

```bash
# Install deps
npm install

# Run the tracker
npx ts-node error-tracker.ts

# Or compile and run
npx tsc error-tracker.ts
node error-tracker.js
```

---

## Configuration

Edit `CONFIG` at the top of `error-tracker.ts`:

| Setting | Default | Description |
|---------|---------|-------------|
| `POLL_INTERVAL` | 60,000 ms | How often to check for issue changes |
| `REPORT_INTERVAL` | 24h | How often to generate daily report |
| `P0_SLIP_THRESHOLD` | 3 days | Days a P0 can slip before critical alert |
| `NEW_ISSUES_ALERT` | 5 | Alert if >5 new issues in 24h |
| `ALERT_RECIPIENTS` | Ranga + Suga | Who gets alerts |

---

## Integration with Git

Add this git hook to `.git/hooks/post-commit`:

```bash
#!/bin/bash
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --pretty=%B)
FILES=$(git diff-tree --no-commit-id --name-only -r $COMMIT_HASH)

curl -X POST http://localhost:3001/trigger/git-commit \
  -H "Content-Type: application/json" \
  -d "{\"commitHash\":\"$COMMIT_HASH\",\"message\":\"$COMMIT_MSG\",\"files\":[$FILES]}"
```

This auto-detects fixes and updates issue status without manual entry.

---

## Integration with CI/CD

Add to your GitHub Actions workflow:

```yaml
- name: Notify Tracker
  if: always()
  run: |
    curl -X POST http://localhost:3001/trigger/cicd \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"${{ job.status }}\",\"buildId\":\"${{ github.run_id }}\"}"
```

---

## Sample Daily Report Output

```markdown
# Rekrut AI — Daily Status Report

> **Date:** 2026-06-12
> **Runtime:** 168 hours
> **Total Issues:** 30
> **Open:** 12 | **Fixed:** 15 | **Slipped:** 3

## Launch Readiness

| Metric | Count | Status |
|--------|-------|--------|
| P0 Blockers (Open) | 2 | 🔴 BLOCKED |
| P1 Critical (Open) | 5 | 🟡 WATCH |
| P2 Important (Open) | 3 | 🟢 OK |
| Issues Slipped | 3 | ⚠️ ACTION |

### Ready to Launch?

**NO** — P0 blockers remain. Do not launch.

## Today's Changes

| Type | Count | Issues |
|------|-------|--------|
| Fixed | 2 | B-008, B-009 |
| New | 0 | None |
| Regressed | 0 | None |
| Slipped | 1 | B-003 |

## P0 Blockers — Detail

### B-003: Stripe Live Mode

- **Owner:** Suga
- **Status:** open
- **Days Open:** 7
- **Slipped:** 4 days
- **Description:** Billing only works in test mode...
- **Last Note:** Blocked on Ranga: Stripe live account credentials

## Next 7 Days — Action Items

- [ ] **URGENT:** B-003 — Stripe Live Mode has slipped 4 days. Reassign or escalate.
- [ ] B-001 — Candidate Search: Verify completion and close.
```

---

## Why 7 Months?

- 90 days for launch sprint
- 60 days for post-launch stabilization
- 60 days for feature expansion and monitoring
- Buffer for delayed launches

The tracker runs the whole time. After launch, it switches from **launch mode** to **maintenance mode** — tracking regressions, new bugs, and feature requests instead of blockers.

---

## Built by Suga

No external dependencies. No SaaS to pay for. Just Node.js, `fs`, and a timer. If the server restarts, it picks up where it left off from `.tracker-state.json`.

**Questions?** Ping me. I'll add what you need.

---

*Last updated: June 5, 2026*