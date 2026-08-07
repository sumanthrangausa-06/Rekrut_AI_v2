# Render Webhook Setup Guide

## Problem
GitHub repository has NO webhooks configured (`[]`).
Render auto-deploy requires a webhook to receive push notifications.

## How to Create the Webhook

1. Go to Render Dashboard → `rekrutai-staging` service → Settings
2. Find the "GitHub Webhook URL" (it looks like `https://api.render.com/v1/webhooks/github/...`)
3. Copy that URL

Then run this command (or tell me the webhook URL and I'll create it):

```bash
gh api repos/sumanthrangausa-06/Rekrut_AI_v2/hooks \
  -X POST \
  -f name=web \
  -f active=true \
  -f events[]=push \
  -f config[url]='https://api.render.com/v1/webhooks/github/YOUR_WEBHOOK_PATH' \
  -f config[content_type]=json
```

## Alternative: Manual Deploy
Go to Render Dashboard → `rekrutai-staging` → click **Manual Deploy** → **Deploy latest commit**

## Current Status
- Commit `7eba7ab` pushed to staging (fixes `FORCE_SSL_VERIFY=false` for DB connection)
- Server running `c4ef37a` (health check fix deployed)
- Need new commit `7eba7ab` deployed for DB fix to take effect
