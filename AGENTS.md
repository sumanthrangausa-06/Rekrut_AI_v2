# Rekrut AI - Agent Status

> **Quick Reference:** For complete repository structure, see [SCHEMA.md](SCHEMA.md).
> **Agent Docs:** See [agents/](agents/) for full agent documentation.
> **SDLC Framework:** See [_superml/config.yml](_superml/config.yml) — strict 8-phase SDLC is mandatory.
> **SDLC Docs:** See [docs/sdlc/rekrut-ai-v2/](docs/sdlc/rekrut-ai-v2/) — every phase documented.

**Last Updated:** 2026-10-10

## Quick Links

| Resource | Location |
|----------|----------|
| Agent Protocol | [agents/AGENT_PROTOCOL.md](agents/AGENT_PROTOCOL.md) |
| Task Tracking | [docs/guides/TASKS.md](docs/guides/TASKS.md) |
| Coordination | [docs/guides/COORDINATION.md](docs/guides/COORDINATION.md) |
| Repository Schema | [SCHEMA.md](SCHEMA.md) |
| SDLC Config | [_superml/config.yml](_superml/config.yml) |
| SDLC Docs | [docs/sdlc/rekrut-ai-v2/](docs/sdlc/rekrut-ai-v2/) |

## Working Rules

1. **Sync First:** `git fetch && git pull` before any work
2. **Branch:** `feature → dev → staging → main`. Feature branches merge to `dev` via PR. `dev` promotes to `staging` via PR for QA. `staging` merges to `main` only after QA passes AND Sumanth approves. Never push directly to `staging` or `main`.
3. **SDLC:** Strict 8-phase SDLC (Relearn → Analysis → Planning → Solutioning → Implementation → Quality → Release → Maintenance). See `_superml/`. No skipping phases.
4. **Approval:** Sumanth approves before any code is written, at each promotion gate, and before any deletion.
5. **Coordinate:** Keep `TASKS.md` and `COORDINATION.md` current
6. **Document:** Every SDLC phase produces documents in `docs/sdlc/rekrut-ai-v2/`

## Current Agents

| Agent | Role | Folder |
|-------|------|--------|
| Kimiclaw | CTO / Technical | [agents/kimiclaw/](agents/kimiclaw/) |

## Current Focus

- Calendar automation
- ATS/HRIS integrations
- OmniScore alias cleanup
- Transactional email coverage
