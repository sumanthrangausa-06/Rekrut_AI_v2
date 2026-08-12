# Neon CU Saving Plan — Action Items

## Changes Made (Automated)
- ✅ `docs/cron-job-instructions.md` updated with CU-saving deployment strategy
- ✅ Cron payload updated — dev branch = GitHub only, staging = deploy for QA
- ✅ Non-blocking workflow — never wait for Cursor QA

## Manual Actions Required (You Need to Do These)

### 1. Suspend/Delete Dev Service on Render

**Option A: Suspend (can resume later)**
1. Go to https://dashboard.render.com/
2. Find service: `rekrutai-dev` (or whatever your dev service is called)
3. Click the service → Settings → Suspend
4. This stops the service but keeps the configuration

**Option B: Delete (permanent)**
1. Go to https://dashboard.render.com/
2. Find service: `rekrutai-dev`
3. Click the service → Settings → Delete Service
4. Confirm deletion

**Recommendation:** Suspend first. If you don't need it for 2 weeks, then delete.

### 2. Configure Neon Auto-Suspend

**For Staging Database:**
1. Go to https://console.neon.tech/
2. Select your Rekrut AI project
3. Go to Branches → Select `staging` branch (or default branch if shared)
4. Click Edit on the compute endpoint
5. Set **Auto-suspend delay**: `5 minutes` (300 seconds)
6. Set **Minimum compute time**: `0` (or 1 minute)
7. Save

**For Prod Database:**
1. Same steps as above but for `main` or `prod` branch
2. Set **Auto-suspend delay**: `5 minutes`
3. Note: First request after idle will have ~1-2 second cold start

### 3. Verify Render Staging Uses Correct DB

Make sure your Render staging service uses the staging branch of Neon:
1. Render dashboard → Select `rekrutai-staging`
2. Environment → Check `DATABASE_URL`
3. Should point to staging branch, not prod

### 4. Update Local Dev Environment (Optional)

For local development on dev branch:
```bash
# In Rekrut_AI_v2/
npm run dev  # Backend on localhost:3000
# In another terminal
cd client && npm run dev  # Frontend on localhost:5173
```

No Render deployment needed. No Neon connection needed (use local SQLite or mock DB).

---

## Expected CU Savings

| Before | After |
|--------|-------|
| Dev: 720 hrs/month | Dev: **0 hrs/month** |
| Staging: 720 hrs/month | Staging: **~10-20 hrs/month** |
| Prod: 720 hrs/month | Prod: **~50-100 hrs/month** |
| **Total: ~2,160 hrs** | **Total: ~60-120 hrs** |
| Free tier: 191 hrs | **Well within limit** |

---

## What This Means for Workflow

**Suga's Cron:**
- Builds on dev branch locally
- Tests locally (tsc, build)
- Commits to dev
- When ready for QA: merges dev→staging, pushes (triggers Render deploy)
- Staging Neon wakes up, Cursor tests
- Staging goes idle, Neon suspends

**Cursor QA:**
- Tests on staging (the only deployed environment for QA)
- Adds `qa-passed` or `qa-failed` labels
- Suga picks up on next cron run

**Production:**
- Stays deployed but Neon auto-suspends
- Wakes up when user opens app
- ~1-2 sec cold start for first request after idle

---

Done by Suga on 2026-08-12
