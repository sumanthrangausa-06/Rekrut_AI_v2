# Neon CU Saving Plan — Final State

> **Status:** All changes complete as of 2026-08-12
> **Cron Schedule:** Every 3 hours (was every 1 hour)

---

## Current Setup (All Changes Applied)

| Environment | Render | Neon DB | Cost | Notes |
|-------------|--------|---------|------|-------|
| **Dev** | ❌ **SUSPENDED** | ❌ None | $0 | GitHub branch only, test locally |
| **Staging** | ✅ **Free tier** | ✅ Auto-suspend | $0 | Sleeps after 15 min, wakes for QA |
| **Prod** | ✅ **Paid tier** | ✅ Auto-suspend | Active usage only | No health checks — wakes on user traffic |

### What Changed

1. **Dev service SUSPENDED** on Render ✅
2. **Staging moved to free tier** ✅
3. **Prod health checks disabled** ✅
4. **Cron reduced to every 3 hours** ✅
5. **Neon auto-suspend: 5 minutes** on staging and prod ✅

---

## CU Hour Math

| Environment | Before | After | Savings |
|-------------|--------|-------|---------|
| Dev | 720 hrs/month | **0 hrs** | 100% |
| Staging | 720 hrs/month | **~5-10 hrs** | ~99% |
| Prod | 720 hrs/month | **~30-50 hrs** | ~93% |
| **Total** | **~2,160 hrs** | **~35-60 hrs** | **~97%** |
| Free tier limit | 191 hrs | Well within | ✅ |
| **Monthly cost** | ~$50-100 | **$0-10** | **~90%** |

### Why Staging is So Low
- Render free tier **sleeps after 15 min** of no traffic
- Only wakes when:
  - Suga pushes to staging (deploy)
  - Cursor runs QA (once per day)
- Most of the time: **asleep, consuming nothing**

### Why Prod is Lower Now
- **No health checks** = no periodic pings keeping Neon awake
- Only wakes when **real users** open the app
- Auto-suspends 5 min after last query

### Why Cron at 3 Hours Helps
- Every cron run that ships something = staging wake-up
- Was: 24 wake-ups/day (hourly)
- Now: ~8 wake-ups/day (every 3h)
- Fewer wake-ups = fewer CU hours

---

## Manual Actions (All Done)

### ✅ 1. Dev Service Suspended
- Render dashboard → `rekrutai-dev` → Settings → Suspend
- Status: **SUSPENDED**
- Cost: $0

### ✅ 2. Staging on Free Tier
- Render dashboard → `rekrutai-staging` → Free tier
- Sleeps after 15 min idle
- Cost: $0

### ✅ 3. Prod Health Checks Disabled
- Render dashboard → `rekrutai` (prod) → Settings
- Health check interval: **None** or minimum
- Only wakes on user traffic

### ✅ 4. Neon Auto-Suspend
- Neon console → Project settings
- Staging branch: Auto-suspend **5 min**
- Prod branch: Auto-suspend **5 min**
- Minimum compute time: **0**

---

## Workflow Now

**Suga's Cron (every 3 hours):**
1. Check queue for `qa-passed` → close issues
2. Check queue for `qa-failed` → rebuild
3. DISCOVER → PLAN → BUILD (on dev, locally)
4. SHIP to staging (merge dev→staging, push)
5. Staging wakes up (Render free tier ~30 sec + Neon ~1-2 sec)
6. Cursor QA tests (once per day)
7. Staging sleeps after 15 min idle

**Cursor QA (once per day):**
1. Find `ready-for-qa` issues
2. Test on staging (triggers wake-up)
3. Add `qa-passed` or `qa-failed`
4. Staging sleeps after done

**Production:**
1. Sleeps 99% of the time
2. Wakes only when user opens app
3. Auto-suspends 5 min after last activity

---

## Troubleshooting

### "Staging is slow on first request"
- **Expected:** Render free tier sleeps after 15 min
- **First request:** ~30 sec cold start
- **Solution:** None — this is the tradeoff for $0 cost
- **Workaround:** Cursor can hit staging once to wake it, then wait 30 sec before testing

### "Prod has cold start"
- **Expected:** Neon auto-suspends after 5 min
- **First query:** ~1-2 sec cold start
- **Solution:** None — this is the tradeoff for low CU usage
- **Note:** Only affects first user after idle period

### "Neon CU usage still high"
- Check if health checks are truly disabled
- Check if cron is shipping too frequently
- Check if Cursor QA is running too often
- Verify auto-suspend is set to 5 min (not longer)

---

## Files

- `docs/cron-job-instructions.md` — Full workflow with CU-saving strategy
- `docs/deployment/NEON_CU_SAVING_PLAN.md` — This file

---

Updated by Suga on 2026-08-12
