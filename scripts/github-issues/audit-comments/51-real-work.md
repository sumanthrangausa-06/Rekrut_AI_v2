**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

Note: #63 covers this same scope and was closed as completed on 2026-08-06, but this audit found no supporting code.

The only monitoring asset on `origin/dev` is `scripts/monitor-health.sh`, which runs inside the deployment and therefore cannot report a total outage. That is precisely the failure mode external pinging exists to catch.

Treat this issue as the real remaining work. It stays distinct from the self-hosted internal observability stack in #144 for the same reason: internal monitoring cannot report its own death.
