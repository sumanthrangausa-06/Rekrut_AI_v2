# MEMORY.md — Long-Term Memory for Suga

## Model Routing Policy (2026-07-19)
**Decision:** User mandated complexity-based model routing to optimize costs.
- **Easy tasks** → `kimi-coding/kimi-for-coding` (k2.6): $0.60/$3 per M tokens
- **Hard tasks** → `kimi-coding/kimi-k3`: $3/$15 per M tokens

**Routing rules documented in TOOLS.md.** Key self-assessment:
- >3 files touched? → K3
- Security/production issue? → K3
- Single command/file read? → k2.6
- Status check/cron? → k2.6

**Subagent defaults:**
- Engineering agents (frontend, backend, code-review, security, QA) → K3
- DevOps (deploy, health checks) → k2.6
- Content/growth → k2.6
- Strategy/AI engineer → K3

**Current session model:** kimi-coding/kimi-for-coding (k2.6) — switched for orchestration work.
**Default for new sessions:** kimi-coding/kimi-k3

---

[Previous memory entries preserved...]
