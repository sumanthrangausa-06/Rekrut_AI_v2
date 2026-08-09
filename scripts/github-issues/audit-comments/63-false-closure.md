**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**This was closed as completed, but the work does not appear to exist.**

The only monitoring asset on `origin/dev` is `scripts/monitor-health.sh`, which runs inside the deployment. That cannot detect a total outage, which is the entire purpose of external pinging. No external monitor is configured.

Not reopening, because #51 covers the same scope and is open. Flagging here so this closure is not read as evidence that uptime monitoring exists.
