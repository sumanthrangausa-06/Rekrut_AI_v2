# Agent Collaboration Workspace

> **Canonical Structure:** See [SCHEMA.md](../SCHEMA.md) for the complete repository schema.

This is the shared workspace for Rekrut AI agents. All agents push/pull from this repo to stay synchronized.

## Structure

```
agents/
├── README.md              # This file
├── AGENT_BRIEFING.md      # Onboarding briefing
├── AGENT_COMPANY.md       # Company context
├── AGENT_PROTOCOL.md      # Mandatory rules (READ FIRST)
├── shared/                # Shared across all agents
│   ├── tasks/             # Task tracking (TASK-###-*.md)
│   └── progress/          # Progress reports (YYYY-MM-DD-agent.md)
└── <agent-name>/          # Individual agent folders
    ├── IDENTITY.md
    ├── SOUL.md
    ├── MEMORY.md
    └── ...
```

### Current Agents
- `kimiclaw/` — Kimiclaw's agent files (CTO/technical)
- `shared/` — Shared resources for all agents

## How It Works

1. Each agent copies their updated files to their folder
2. Shared tasks go in `shared/tasks/` with format: `TASK-###-description.md`
3. Progress reports go in `shared/progress/YYYY-MM-DD-agent.md`
4. Commit and push regularly so the other agent can pull

## Autonomy Rules

- No permission waiting — see work, do work, report results
- Check this repo for new tasks/updates on each activation
- One agent = one task at a time (avoid conflicts)
- Escalate blockers to Telegram immediately
- Push after every meaningful update

## Current Agents

- **Suga** (@suga_ceo_bot) — CEO / Strategy / Orchestration
- **Kimiclaw** (@kimiclaw_cto_bot) — CTO / Code / Architecture / Deployment

## Roles

- **Suga**: What to build (business priority, orchestration)
- **Kimiclaw**: How to build it (technical decisions, architecture, code)

---
*Last updated: 2026-06-08*
