# gstack Skills Reference for Rekrut AI

> **gstack** is Garry Tan's Claude Code setup with 23+ AI tools that act as a virtual engineering team.
> Installed at: `~/.cursor/skills/gstack/`

**Last Updated:** 2026-08-06

---

## Quick Reference: Which Skill for What Task?

### Planning & Strategy

| Task | Skill | Description |
|------|-------|-------------|
| New idea, brainstorming, "is this worth building?" | `/office-hours` | Product ideas session |
| Strategy, scope, "think bigger" | `/plan-ceo-review` | CEO-level strategic review |
| Architecture, "does this design make sense?" | `/plan-eng-review` | Engineering manager review |
| Design system, visual identity | `/design-consultation` | Designer consultation |
| Review design of a plan | `/plan-design-review` | Design plan review |
| API/CLI/SDK design, developer experience | `/plan-devex-review` | DevEx review of plan |
| Run all reviews automatically | `/autoplan` | Full review pipeline |
| Write a spec, file an issue, backlog item | `/spec` | Spec/issue authoring |

### Code Review & Quality

| Task | Skill | Description |
|------|-------|-------------|
| Review code, check diff, pre-landing | `/review` | Code review |
| Bug, error, "this doesn't work" | `/investigate` | Bug investigation |
| Security audit, OWASP, vulnerabilities | `/cso` | Chief Security Officer audit |
| Code quality dashboard | `/health` | Health check |
| Second opinion, cross-model review | `/codex` | Codex review |

### QA & Testing

| Task | Skill | Description |
|------|-------|-------------|
| Test the site, find bugs, "does this work?" | `/qa` | Full QA with fixes |
| Report bugs only, no fixes | `/qa-only` | QA reporting only |
| Open browser for testing | `/open-gstack-browser` | Launch browser |
| Import cookies for auth testing | `/setup-browser-cookies` | Auth cookie setup |
| Page speed, performance benchmarks | `/benchmark` | Performance testing |

### Design Review

| Task | Skill | Description |
|------|-------|-------------|
| Visual polish, "this looks off" | `/design-review` | Design audit of live site |
| Generate design variations | `/design-shotgun` | Multiple design options |
| Design in HTML | `/design-html` | HTML design creation |
| Live developer experience audit | `/devex-review` | DevEx audit |

### Shipping & Deployment

| Task | Skill | Description |
|------|-------|-------------|
| Ship, deploy, create PR | `/ship` | Ship changes |
| Merge + deploy + verify | `/land-and-deploy` | Full deploy pipeline |
| Configure deployment | `/setup-deploy` | Deployment setup |
| Post-deploy monitoring | `/canary` | Canary monitoring |

### Documentation

| Task | Skill | Description |
|------|-------|-------------|
| Update docs after shipping | `/document-release` | Release documentation |
| Write docs from scratch | `/document-generate` | Generate documentation |
| Make a PDF | `/make-pdf` | PDF generation |

### Context & Session

| Task | Skill | Description |
|------|-------|-------------|
| Save progress, checkpoint | `/context-save` | Save session context |
| Resume, "where was I?" | `/context-restore` | Restore context |
| Weekly retro, "what did we ship?" | `/retro` | Retrospective |
| Show learnings | `/learn` | View project learnings |

### Safety & Control

| Task | Skill | Description |
|------|-------|-------------|
| Safety mode, careful mode | `/careful` | Careful mode |
| Safety guard | `/guard` | Guard mode |
| Restrict edits to directory | `/freeze` | Freeze edits |
| Remove restrictions | `/unfreeze` | Unfreeze edits |
| Upgrade gstack | `/gstack-upgrade` | Update gstack |

---

## Usage in Rekrut AI Project

### For New Features
```
1. /office-hours     → Brainstorm the feature
2. /plan-ceo-review  → Validate strategy/scope
3. /plan-eng-review  → Lock architecture
4. /spec             → Write the spec/issue
5. (implement)
6. /review           → Code review
7. /qa               → Test it
8. /ship             → Deploy it
```

### For Bug Fixes
```
1. /investigate      → Find the root cause
2. (fix)
3. /review           → Review the fix
4. /ship             → Deploy
```

### For Security Reviews
```
1. /cso              → Security audit (OWASP + STRIDE)
2. /review           → Code review with security focus
```

### For Design Work
```
1. /design-consultation  → Discuss design approach
2. /design-shotgun       → Generate variations
3. /design-review        → Audit live site
```

### For Deployment
```
1. /review           → Final code review
2. /ship             → Create PR, deploy
3. /canary           → Monitor production
4. /document-release → Update docs
```

---

## Rekrut AI Specific Mappings

| Rekrut AI Area | Recommended Skills |
|----------------|-------------------|
| **OmniScore Changes** | `/plan-eng-review` → `/review` → `/qa` |
| **Interview AI** | `/cso` → `/review` → `/qa` |
| **Frontend Pages** | `/design-review` → `/qa` → `/ship` |
| **API Routes** | `/plan-eng-review` → `/review` → `/ship` |
| **Database Migrations** | `/careful` → `/plan-eng-review` → `/review` |
| **Security Issues** | `/cso` → `/investigate` → `/review` |
| **Performance Issues** | `/benchmark` → `/investigate` → `/review` |
| **New Feature Ideas** | `/office-hours` → `/plan-ceo-review` → `/spec` |
| **Documentation** | `/document-generate` → `/document-release` |
| **Production Deploy** | `/review` → `/ship` → `/canary` |

---

## Key Principles

1. **Invoke the skill** when a task matches - don't answer ad-hoc
2. **Complete one loop**: plan → review → ship
3. **Safety first**: Use `/careful` or `/guard` for risky changes
4. **Document learnings**: gstack remembers project quirks via `/learn`
5. **Use `/qa`** to actually test in a browser, not just code review

---

## Skill Files Location

All skills are in `~/.cursor/skills/gstack/[skill-name]/SKILL.md`

To read a skill's full instructions:
```bash
cat ~/.cursor/skills/gstack/review/SKILL.md
```

---

## Version

gstack version: Check `~/.cursor/skills/gstack/VERSION`
