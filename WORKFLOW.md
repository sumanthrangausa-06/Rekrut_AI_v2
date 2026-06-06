# Rekrut AI - Development Workflow

## 🎯 The Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   dev branch  →  staging branch  →  main branch  →  production              │
│   (build)          (test/QA)         (approved)      (live)                 │
│                                                                             │
│   • Subagents work here     • You review here     • Only after            │
│   • Never push to staging   • Integration tests     • You approve            │
│   • Never push to main                            • Auto-deploy             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Branches

| Branch | Purpose | URL | Rules |
|--------|---------|-----|-------|
| `dev` | Development - I build here | You test locally | **Only branch for active work. Never push to staging/main.** |
| `staging` | Integration / QA | https://rekrutai-dev.onrender.com | Promote from dev after review. Not for direct commits. |
| `main` | Production - Live site | https://rekrutai.co | Promote from staging only after approval. Never direct commits. |

## How It Works

### Step 1: You Request a Feature
```
You: "Build a pricing page"
```

### Step 2: I Build on `dev` Branch ONLY
```bash
git checkout dev
# I build the feature
git add .
git commit -m "feat: add pricing page"
git push origin dev
```
**Rule: Subagents and all automated work must check out `dev` first. Never push to staging or main directly.**

### Step 3: Promote to `staging` for Review
```bash
git checkout staging
git merge dev --no-ff
git push origin staging
```
- Staging auto-deploys to https://rekrutai-dev.onrender.com
- You review on staging
- Integration tests run here

### Step 4: You Review on Staging
- Check the feature works
- Check for bugs
- Check mobile responsiveness
- Check the code (optional)

### Step 5: You Decide
```
Option A: "Looks good, promote to main"
  → I merge staging → main
  → Render auto-deploys production
  → Feature goes LIVE

Option B: "Fix this issue"
  → I make changes on dev
  → Merge to staging again
  → You review again
  → Repeat until approved

Option C: "Reject, don't want this"
  → I discard the changes on dev
  → Revert staging if already merged
  → Nothing goes to production
```

## Commands You Need

### Test locally (dev branch)
```bash
cd Rekrut_AI_v2
git fetch origin
git checkout dev
git pull
npm install
npm run dev
# Test at http://localhost:3000
```

### Review on staging
```bash
# Just open https://rekrutai-dev.onrender.com
# It's auto-deployed from staging branch
```

### Approve and promote to production
```bash
# Tell me: "Promote staging to main"
# I will handle the merge and deploy
```

## ⚠️ Critical Rules

| Rule | Why | If broken |
|------|-----|-----------|
| **Only work on `dev`** | Prevents untested code reaching production | Revert and replay on dev |
| **Never push to `staging` directly** | Staging is for integration, not development | Merge dev to staging instead |
| **Never push to `main` directly** | Production must be protected | Revert immediately, go through staging |
| **Always checkout dev first** | Ensures subagents start on correct branch | Check branch before any work |

## Current Branch Status

```bash
# Check current branch
git branch
# * dev      <- Development (safe to break)
#   staging  <- Integration testing (promote from dev)
#   main     <- Production (protected)
```

## Questions?

- **Q: What if I break dev?**
  - A: No problem! Dev is for breaking things. Main is protected.

- **Q: Can I see what changed?**
  - A: Yes! Run `git log` or ask me to show you the diff.

- **Q: How do I revert a bad merge?**
  - A: Tell me "Revert the last merge" and I'll fix it.

- **Q: Can I have multiple features in dev?**
  - A: Yes! Each feature is a separate commit. You can approve some, reject others.

- **Q: What if subagents push to staging/main by mistake?**
  - A: Tell me immediately. I will revert, replay on dev, and go through the proper flow.
