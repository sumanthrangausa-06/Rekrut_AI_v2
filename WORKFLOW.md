# Rekrut AI - Development Workflow

## 🎯 The Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│    YOU ASK        →        I BUILD        →        YOU REVIEW        →        │
│   "Build X"              on dev branch           on dev branch              │
│                                                                             │
│         ↓                                                                   │
│                                                                             │
│    YOU APPROVE      →       MERGE TO MAIN      →      AUTO-DEPLOY           │
│    "Looks good"             (production)              rekrutai.co           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Branches

| Branch | Purpose | URL |
|--------|---------|-----|
| `dev` | Development - I build here | You test locally |
| `main` | Production - Live site | https://rekrutai.co |

## How It Works

### Step 1: You Request a Feature
```
You: "Build a pricing page"
```

### Step 2: I Build on `dev` Branch
```bash
git checkout dev
# I build the feature
git add .
git commit -m "feat: add pricing page"
git push origin dev
```

### Step 3: You Test Locally
```bash
# On your machine
git fetch origin
git checkout dev
npm install
npm run dev
# Open localhost:3000 in browser
```

### Step 4: You Review
- Check the feature works
- Check for bugs
- Check the code (optional)

### Step 5: You Decide
```
Option A: "Looks good, merge it"
  → I merge dev → main
  → Render auto-deploys
  → Feature goes LIVE

Option B: "Fix this issue"
  → I make changes on dev
  → You test again
  → Repeat until approved

Option C: "Reject, don't want this"
  → I discard the changes
  → Nothing goes to production
```

## Commands You Need

### Test a feature (dev branch)
```bash
cd Rekrut_AI_v2
git fetch origin
git checkout dev
git pull
npm install
npm run dev
# Test at http://localhost:3000
```

### Approve and merge to production
```bash
# Tell me: "Merge dev to main"
# I will handle it
```

### Go back to production version
```bash
git checkout main
git pull
npm run dev
```

## Safety Guarantees

| What | Guarantee |
|------|-----------|
| `main` branch | ONLY changes when YOU approve |
| Production site | ONLY updates from `main` |
| `dev` branch | I can break things here safely |
| Your approval | Required before ANY production change |

## Current Branch Status

```bash
# Check current branch
git branch
# * dev    <- Development (safe to break)
#   main   <- Production (protected)
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
