# Rekrut AI — Uptime Monitoring Setup Guide

> **Issue:** #51  
> **Purpose:** Step-by-step instructions for setting up free uptime monitoring with UptimeRobot, health check scripts, and Slack alerting.

---

## 1. Self-Hosted Status Page

A lightweight status page is built in at **`/status`** (served from `public/status.html`).

- **What it shows:** Real-time health for Production, Staging, and the current instance
- **What it checks:** `/api/health` on each environment
- **Auto-refresh:** Every 60 seconds
- **Indicators:**
  - 🟢 Green — all checks passing
  - 🟡 Yellow — degraded (DB timeout, missing tables, etc.)
  - 🔴 Red — endpoint unreachable or critical failure

### Access URLs

| Environment | Status Page |
|-------------|-------------|
| Production | `https://rekrutai.co/status` |
| Staging | `https://rekrutai-staging.onrender.com/status` |
| Local | `http://localhost:3000/status` |

> **No deploy needed** — `public/status.html` is served statically by the Express server. It goes live on the next deploy.

---

## 2. Health Endpoints

The following endpoints are available for monitoring tools:

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | None | **Primary health check** — fast DB ping, returns 200 even if degraded (safe for Render deploy checks) |
| `GET /api/health` | None | Same as `/health` — alias for monitoring consistency |
| `GET /health/detailed` | None | Extended health — DB, memory, uptime, external service config status |
| `GET /health/analytics` | None | Analytics cache & query profiler stats |

### `/health/detailed` Response Example

```json
{
  "status": "ok",
  "timestamp": "2026-08-17T13:30:00.000Z",
  "responseTimeMs": 45,
  "uptime": { "seconds": 3600, "formatted": "1h 0m 0s" },
  "memory": { "rss": "128MB", "heapUsed": "96MB", "heapTotal": "112MB", "external": "12MB" },
  "db": { "connected": true, "latencyMs": 12, "pool": { "totalCount": 5, "idleCount": 3, "waitingCount": 0 }, "issues": { "missingTables": [], "missingEnv": [], "connectionError": null } },
  "externalServices": {
    "openai": { "configured": true },
    "anthropic": { "configured": true },
    "polsia": { "configured": true },
    "stripe": { "configured": true },
    "sentry": { "configured": true },
    "livekit": { "configured": false },
    "google_oauth": { "configured": true },
    "smtp": { "configured": false }
  },
  "node": { "version": "v24.15.0", "platform": "linux", "arch": "x64", "pid": 1234 }
}
```

> **Note:** External service checks verify that environment variables are set. They do **not** make live API calls to avoid cost and latency.

---

## 3. UptimeRobot Setup (Free Tier)

[UptimeRobot](https://uptimerobot.com) offers 50 free monitors with 5-minute intervals.

### 3.1 Create Account

1. Go to [uptimerobot.com](https://uptimerobot.com) and sign up
2. Verify email
3. Log in to the dashboard

### 3.2 Add Monitors

Click **"Add New Monitor"** and configure each:

#### Monitor 1 — Production Health

| Field | Value |
|-------|-------|
| Monitor Type | HTTP(s) |
| Friendly Name | `Rekrut AI — Production /health` |
| URL | `https://rekrutai.co/health` |
| Monitoring Interval | 5 minutes (free tier max) |
| Timeout | 10 seconds |

#### Monitor 2 — Production API Health

| Field | Value |
|-------|-------|
| Monitor Type | HTTP(s) |
| Friendly Name | `Rekrut AI — Production /api/health` |
| URL | `https://rekrutai.co/api/health` |
| Monitoring Interval | 5 minutes |

#### Monitor 3 — Staging Health

| Field | Value |
|-------|-------|
| Monitor Type | HTTP(s) |
| Friendly Name | `Rekrut AI — Staging /health` |
| URL | `https://rekrutai-staging.onrender.com/health` |
| Monitoring Interval | 5 minutes |

#### Monitor 4 — Status Page

| Field | Value |
|-------|-------|
| Monitor Type | HTTP(s) |
| Friendly Name | `Rekrut AI — Status Page` |
| URL | `https://rekrutai.co/status` |
| Monitoring Interval | 5 minutes |

### 3.3 Keyword Monitoring (Optional but Recommended)

For each monitor, enable **"Alert When Keyword Not Exists"** with keyword `"status":"ok"`. This catches 200 responses that report degraded state.

### 3.4 Alert Contacts

Configure alert contacts in **Settings → Alert Contacts**:

- **Email** — your on-call email
- **Slack** — see Section 4 below
- **Pushover / Telegram** — optional for mobile alerts

Then assign contacts to each monitor via **Edit Monitor → Alert Contacts to Notify**.

---

## 4. Slack Webhook Setup

### 4.1 Create Incoming Webhook

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"** → **"From scratch"**
3. Name it `Rekrut AI Alerts` and select your workspace
4. Go to **Incoming Webhooks** → toggle **On**
5. Click **"Add New Webhook to Workspace"**
6. Choose the channel (e.g. `#alerts` or `#engineering`) and click **Allow**
7. Copy the **Webhook URL** (looks like `https://hooks.slack.com/services/T000/B000/XXXX`)

### 4.2 Add Webhook to UptimeRobot

1. In UptimeRobot, go to **Settings → Alert Contacts**
2. Click **"Add Alert Contact"**
3. Select **Slack** as the type
4. Paste the webhook URL
5. Test the integration — you should see a test message in Slack

### 4.3 Slack Message Format

UptimeRobot sends messages like:

```
🔴 Monitor is DOWN: Rekrut AI — Production /health
https://rekrutai.co/health — HTTP 500 — 12423ms
```

```
🟢 Monitor is UP: Rekrut AI — Production /health
It was down for 6 minutes.
```

---

## 5. Health Check Script (Cron / CI)

A standalone script is provided at `scripts/health-check.js`.

### 5.1 Usage

```bash
# Check local instance
node scripts/health-check.js

# Check production
HEALTH_URL=https://rekrutai.co/health API_URL=https://rekrutai.co/api/health node scripts/health-check.js

# Check staging
HEALTH_URL=https://rekrutai-staging.onrender.com/health API_URL=https://rekrutai-staging.onrender.com/api/health node scripts/health-check.js
```

### 5.2 Cron Setup

Add to your server crontab (`crontab -e`):

```cron
# Check production health every 5 minutes, log to syslog
*/5 * * * * cd /path/to/rekrut-ai && HEALTH_URL=https://rekrutai.co/health API_URL=https://rekrutai.co/api/health node scripts/health-check.js 2>&1 | logger -t rekrut-health
```

Or on Render, use a [Cron Job service](https://render.com/docs/cron-jobs):

```yaml
# render.yaml (append to existing services)
services:
  - type: cron
    name: rekrut-health-check
    env: node
    buildCommand: ""
    startCommand: "node scripts/health-check.js"
    schedule: "*/5 * * * *"
    envVars:
      - key: HEALTH_URL
        value: https://rekrutai.co/health
      - key: API_URL
        value: https://rekrutai.co/api/health
```

### 5.3 CI Integration

In GitHub Actions, add a step:

```yaml
- name: Health check
  run: node scripts/health-check.js
  env:
    HEALTH_URL: ${{ vars.HEALTH_URL }}
    API_URL: ${{ vars.API_URL }}
```

The script exits with code `1` on failure, causing the CI step to fail.

---

## 6. Alert Thresholds & Escalation

| Monitor | Down Threshold | Up Threshold | Escalation |
|---------|---------------|--------------|------------|
| `/health` | 1 failure (1× 5min) | 1 success | Slack #engineering |
| `/api/health` | 2 failures (2× 5min) | 1 success | Slack #engineering + email |
| Status page | 2 failures | 1 success | Slack #alerts |

> **Tip:** Keep `/health` threshold at 1 because Render's deploy health check also uses it. If it fails once, something is genuinely wrong.

---

## 7. Runbook — When Alerts Fire

| Alert | First Check | Next Action |
|-------|------------|-------------|
| `/health` DOWN | Check Render dashboard → service status | If Render shows healthy, check DB connection in `/health/detailed` |
| `/health` degraded | Check `/health/detailed` for missing tables/env | Run migrations if tables missing; verify env vars in Render dashboard |
| 5xx spike | Check Sentry for recent errors | Look at last deploy (`/deploy-check`) for bad commit |
| High memory | Check `/health/detailed` → `memory.heapUsed` | Restart service; investigate memory leak if recurring |
| DB timeout | Check `/health/detailed` → `db.latencyMs` | Check Neon dashboard for connection limits; verify pool settings |

---

## 8. Files Reference

| File | Purpose |
|------|---------|
| `public/status.html` | Self-hosted status page (HTML/JS, no build step) |
| `server.js` | Express routes for `/status`, `/health`, `/health/detailed` |
| `scripts/health-check.js` | Standalone Node.js health checker for cron/CI |
| `docs/monitoring-setup.md` | This guide |

---

*Ready for Ranga to configure UptimeRobot and Slack webhooks. No code changes needed beyond the included commit.*
