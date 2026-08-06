# Rekrut AI — Uptime Monitoring Setup

> **Date:** 2026-06-09
> **Setup by:** DevOps Automator
> **Scope:** Production, Staging, and Dev environment health checks

---

## 1. What Was Set Up

### 1.1 Health Check Script
- **Path:** `scripts/monitor-health.sh`
- **Language:** Bash (no external dependencies beyond `curl` and `bc`)
- **Monitors:**
  - **Production:** `https://rekrutai.co/health` → `{"status":"ok"}` (200 OK)
  - **Staging:** `https://rekrutai-staging.onrender.com/health` → `{"status":"ok"}` (200 OK)
  - **Dev:** `https://rekrutai-dev.onrender.com/health` → `{"status":"ok"}` (200 OK)

### 1.2 Cron Schedule
- **Frequency:** Every 5 minutes (`*/5 * * * *`)
- **Log retention:** 14 days (auto-cleanup)
- **Cron entry:**
  ```
  */5 * * * * /root/.openclaw/workspace/Rekrut_AI_v2/scripts/monitor-health.sh >> /root/.openclaw/workspace/Rekrut_AI_v2/logs/uptime/cron.log 2>&1
  ```

### 1.3 Alert Logic
| Condition | Threshold | Action |
|-----------|-----------|--------|
| First failure | HTTP ≠ 200 or timeout | Log `WARNING` to `alerts.log` |
| Consecutive failures | 2+ in a row | Log `CRITICAL` to `alerts.log` + stderr (for cron email) |
| Slow response | > 3s | Log `WARNING` |
| Very slow response | > 5s | Log `CRITICAL` |
| Recovery | Back to 200 after failures | Log `RECOVERY` |

### 1.4 Log Files
| File | Purpose |
|------|---------|
| `logs/uptime/health-check-YYYY-MM-DD.log` | Daily check results (HTTP code, response time, status) |
| `logs/uptime/alerts.log` | All alerts (WARNING, CRITICAL, RECOVERY) |
| `logs/uptime/cron.log` | Cron execution output |
| `logs/uptime/state/*.failures` | Per-environment failure counters (resets on success) |
| `logs/uptime/state/*.last_rt` | Last response time (for trend analysis) |

---

## 2. Render Built-In Monitoring (Already Active)

Render provides its own health checks via `healthCheckPath: /health` in `render.yaml`:
- Render restarts the service if `/health` fails
- This is **infrastructure-level** monitoring (container restart)
- The external script provides **service-level** monitoring (URL reachable from outside)

**Combined coverage:** Render keeps the container alive; the external script verifies end-to-end reachability.

---

## 3. How to Check Current Status

### Quick check (run manually)
```bash
cd /root/.openclaw/workspace/Rekrut_AI_v2
./scripts/monitor-health.sh
```

### View today's logs
```bash
tail -f /root/.openclaw/workspace/Rekrut_AI_v2/logs/uptime/health-check-$(date -u +%Y-%m-%d).log
```

### View alerts
```bash
tail -f /root/.openclaw/workspace/Rekrut_AI_v2/logs/uptime/alerts.log
```

### Check cron is running
```bash
crontab -l
```

---

## 4. Recommended Upgrade: UptimeRobot (Free Tier)

For **email/SMS/Slack alerts** without relying on cron, set up UptimeRobot:

1. Sign up at [https://uptimerobot.com](https://uptimerobot.com) (free tier)
2. Add 3 monitors:
   - **Type:** HTTP(s)
   - **URL:** `https://rekrutai.co/health`
   - **Interval:** 5 minutes
   - **Alert contact:** Email/Slack/Discord
3. Repeat for staging and dev URLs

**Free tier limits:** 50 monitors, 5-minute checks, email alerts included.

### Why UptimeRobot is better than cron-only
- Alerts sent to email/Slack/Discord automatically
- Public status page available
- Historical uptime graphs
- No dependency on this server being online

---

## 5. Known Limitations

| Limitation | Mitigation |
|------------|------------|
| Alerts only go to local log files | Upgrade to UptimeRobot or add `curl` webhook to Slack in `monitor-health.sh` |
| No historical dashboard | UptimeRobot free tier provides this |
| Checks from single location (this server) | UptimeRobot checks from multiple global locations |
| No SSL certificate expiry monitoring | UptimeRobot monitors this; or add `openssl s_client -connect rekrutai.co:443 -servername rekrutai.co` to script |

---

## 6. Next Steps (Post-Launch)

- [ ] **Set up UptimeRobot** for production (primary) + staging (secondary)
- [ ] **Add Slack webhook** to `monitor-health.sh` for immediate team notifications
- [ ] **Add SSL expiry check** to script (alert 30 days before expiry)
- [ ] **Add response-time trend analysis** (track p95 latency over time)
- [ ] **Add synthetic transaction check** (login → dashboard → logout) for deeper health validation
- [ ] **Dashboard:** Grafana or UptimeRobot public page for team visibility

---

## 7. Quick Reference

```bash
# Manual health check
./scripts/monitor-health.sh

# Check all endpoints
curl -s https://rekrutai.co/health
curl -s https://rekrutai-staging.onrender.com/health
curl -s https://rekrutai-dev.onrender.com/health

# View logs
tail -f logs/uptime/health-check-$(date -u +%Y-%m-%d).log
tail -f logs/uptime/alerts.log

# Edit cron
crontab -e
```

---

*Status: ✅ Active — cron running every 5 minutes since 2026-06-09*
