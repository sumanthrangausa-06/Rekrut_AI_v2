# Rekrut AI — Staging Redeploy Guide

## Problem
Render auto-deploy is NOT working for `rekrutai-staging`. Pushing to the `staging` branch does not trigger a redeploy. The server is running old code (pre-fixes).

## Evidence
- `/health` returns old format: `{"status":"ok","timestamp":"..."}` ❌
- `/version` returns HTML (SPA catch-all) ❌  
- `/deploy-check` returns HTML (SPA catch-all) ❌
- Latest commit pushed: `da8cb92` (not deployed)

## How to Fix

### Option 1: Render Dashboard (Recommended)

1. Go to **https://dashboard.render.com/**
2. Sign in with your Render account
3. Find the service named **`rekrutai-staging`**
4. Click on it to open the service page
5. Look for the **"Manual Deploy"** button (top right)
6. Click **"Deploy latest commit"**
7. Wait 2-3 minutes for the build to complete
8. Verify:
   ```bash
   curl https://rekrutai-staging.onrender.com/health
   # Should return: {"status":"ok","db":"connected","tables":{...},"pool":{...},"env":"staging","issues":[]}
   
   curl https://rekrutai-staging.onrender.com/version
   # Should return: {"commit":"da8cb92",...}
   ```

### Option 2: Check Git Connection

If Manual Deploy works but auto-deploy still doesn't:

1. In Render Dashboard → `rekrutai-staging` → **Settings**
2. Check **"Git Repository"** section
3. Make sure it's connected to: `sumanthrangausa-06/Rekrut_AI_v2`
4. Make sure **branch** is set to: `staging`
5. Make sure **Auto-Deploy** is enabled
6. If disconnected, reconnect it

### Option 3: Recreate Service from Blueprint

If the service is missing or broken:

1. Delete the old `rekrutai-staging` service (if it exists)
2. Go to Render Dashboard → **Blueprints**
3. Click **"New Blueprint Instance"**
4. Select your repo: `sumanthrangausa-06/Rekrut_AI_v2`
5. Render will read `render.yaml` and create:
   - `rekrutai-staging` (web service)
   - `rekrutai-staging-db` (PostgreSQL)
6. Set required environment variables (secrets) in the dashboard

### Option 4: Render CLI

If you have the Render CLI installed:

```bash
# Install render CLI if not already installed
npm install -g @renderinc/cli

# Login
render login

# Deploy staging
render deploy --service rekrutai-staging
```

## Required Environment Variables (Secrets)

After recreating, set these in Render Dashboard → Service → Environment:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `STRIPE_SECRET_KEY` (test key for staging)
- `STRIPE_WEBHOOK_SECRET`
- `POLSIA_API_KEY`
- `POLSIA_API_URL`
- `OPENAI_API_KEY`
- `NVIDIA_NIM_API_KEY`
- `GROQ_API_KEY`
- `CEREBRAS_API_KEY`
- `DEEPGRAM_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT`
- `R2_PUBLIC_URL`
- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_USER`
- `EMAIL_PASS`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`

## Verification After Redeploy

```bash
# Health check (should show new format)
curl https://rekrutai-staging.onrender.com/health

# Version check (should show commit SHA)
curl https://rekrutai-staging.onrender.com/version

# Deploy check (should show deploy info)
curl https://rekrutai-staging.onrender.com/deploy-check

# Auth register (should show detailed errors, not generic)
curl -X POST https://rekrutai-staging.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"YOUR_STRONG_PASSWORD_HERE"}'
```

## Pipeline Status (Blocked)

```
dev → staging:     ✅ Commits synced
unit tests:        ✅ 15/15 passing
staging deploy:    ❌ RENDER AUTO-DEPLOY BROKEN — NEEDS MANUAL FIX
E2E tests:         ⏸️ Blocked — needs staging redeploy first
production:        ⏸️ Blocked — needs E2E pass first
```

---
*Generated: 2026-06-12*
