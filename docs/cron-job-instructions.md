# Rekrut AI — Cron Job Instructions Reference

> **Job ID:** `056d6b3f-357e-435c-a835-cf5f4e973798`
> **Name:** `rekrut-ai-issue-lifecycle`
> **Schedule:** Every 1 hour (3,600,000ms)
> **Session Target:** Isolated (fresh context per run)
> **Delivery:** Announce to Telegram (`6652708323`)
> **Model:** `kimi-coding/k2p6`
> **Timeout:** 55 minutes (3,300s)
> **Status:** ✅ Enabled
> **Saved:** 2026-08-11

---

## Table of Contents
1. [Core Rules](#core-rules)
2. [Phase-Based Prioritization](#phase-based-prioritization)
3. [End-to-End Issue Solving](#end-to-end-issue-solving)
4. [Sub-Issue Creation](#sub-issue-creation)
5. [Full-Stack Implementation](#full-stack-implementation)
6. [Workflow Phases](#workflow-phases)
7. [Agent Mapping](#agent-mapping)
8. [Blocker Verification](#blocker-verification)
9. [Management Commands](#management-commands)

---

## Core Rules

1. **Spawn ONLY ONE subagent at a time.** Never spawn multiple simultaneously.
2. **Use gstack skills as PRIMARY.** Built-in skills are fallback only.
3. **Use agency-agents ONLY.** Never spawn generic subagents.
4. **Commit work after each phase** before moving to next.
5. **If blocked, report clearly** and wait for next run.
6. **Fix on dev branch first.** Then merge to staging. Never commit directly to staging.
7. **End-to-end implementation.** Issues must be solved completely, not partially.

---

## Phase-Based Prioritization

Milestones MUST be completed in order. Phase advancement is FORBIDDEN until ALL earlier phase P0 issues are closed.

### Hard Rules
1. If ANY P0 issue is open in Phase 0, work on Phase 0. Period.
2. If ANY P0 issue is open in Phase 1, work on Phase 1. Period.
3. Only when ALL P0s in a phase are closed may you advance.
4. P1 and P2 issues in earlier phases can be worked on after all P0s are done.
5. NEVER skip a P0 issue because history says "blocked" — VERIFY blockers first.

### Priority Order
| Phase | Name | Priority |
|-------|------|----------|
| Phase 0 | Critical Bug Fixes | P0 > P1 > P2 |
| Phase 1 | MVP Launch | P0 > P1 > P2 > P3 |
| Phase 2 | Structured Screening | P0 > P1 > P2 |
| Phase 3 | Technical Assessment | P0 > P1 > P2 |
| Phase 4 | Interview Excellence | P0 > P1 > P2 |
| Phase 5 | Secure Hiring | P0 > P1 > P2 |
| Phase 6 | Enterprise Complete | P0 > P1 > P2 |

**Skip issues labeled:** `needs-design`, `needs-requirements`

---

## End-to-End Issue Solving

When the cron picks up an issue, it MUST implement the complete solution:

### Frontend
- React components (pages, modals, forms, tables)
- UI/UX with Tailwind CSS + shadcn/ui
- Responsive design (mobile-first)
- Client-side validation
- Loading states, error states, empty states
- Toast notifications for user feedback

### Backend
- API routes (Express.js)
- Input validation (Zod/Joi)
- Authentication & authorization guards
- Rate limiting
- Error handling with proper HTTP codes

### Database
- Schema migrations (PostgreSQL/Neon)
- New tables, columns, indexes
- Seed data if needed
- Backwards compatibility

### Server/Infra
- Environment variables (Render)
- Health checks
- CORS origins
- CSP headers
- Webhook handlers

### Testing
- TypeScript compilation check
- Client build verification
- E2E tests if applicable
- Manual verification via browser if needed

---

## Sub-Issue Creation

If an issue requires work across >3 files or has >5 acceptance criteria:

1. **DO NOT skip it.**
2. **DECOMPOSE it:**
   a. Read the full issue body
   b. Create 3-7 sub-issues:
      - Title: `[#N-x] Description` (e.g., `[#104-a] Frontend: Pending screen`)
      - Body must include: `## Parent Issue\n#N` + clear acceptance criteria
      - Labels: inherit from parent + type labels
      - Milestone: same as parent
      - Priority: one level lower (P0 → P1, P1 → P2)
   c. Comment on parent with sub-issue table
   d. Update state: `phase: "DECOMPOSED"`
   e. Work on sub-issues in order

---

## Full-Stack Implementation

When planning an issue, the cron MUST consider ALL layers:

```
┌─────────────────┐
│   Frontend      │ React + Tailwind + shadcn/ui
│   (Client)      │
├─────────────────┤
│   API Routes    │ Express.js endpoints
│   (Backend)     │ Auth, validation, rate limits
├─────────────────┤
│   Database      │ PostgreSQL schema, migrations
│   (Neon)        │ Indexes, constraints
├─────────────────┤
│   Server/Infra  │ Render env vars, health checks
│                 │ CORS, CSP, webhooks
└─────────────────┘
```

**Example:** "Add job bookmarking"
- Frontend: Bookmark button, bookmarks page, empty state
- Backend: POST/GET/DELETE `/api/jobs/:id/bookmark`
- Database: `bookmarks` table (user_id, job_id, created_at)
- Server: Nothing new (uses existing auth)

---

## Workflow Phases

### PHASE: DISCOVER
1. List open issues: `gh issue list --limit 50 --state open`
2. Find highest priority issue (lowest phase with open P0s)
3. Read full issue: `gh issue view <number>`
4. Check if epic/large scope → decompose if needed
5. Update state with `current_issue`, `current_phase`, `phase: "PLAN"`
6. Report: "DISCOVER: Picked issue #N — [title] (Phase X)"

### PHASE: PLAN
1. Read issue body
2. Analyze scope: frontend? backend? database? all?
3. **Read gstack skill file** (autoplan/cso/ship/qa)
4. **Read agency-agent definition file**
5. Write plan:
   - `plan.approach`: what to build
   - `plan.files`: all files to touch
   - `plan.layers`: [frontend, backend, database, server]
   - `plan.agent`: which agent to spawn
   - `plan.skill_file`: which gstack skill
   - `plan.agent_definition_file`: which agent definition
6. Update state: `phase: "BUILD"`
7. Report: "PLAN: Issue #N — [approach]. Layers: [frontend+backend+db]. Agent: [X]."

### PHASE: BUILD
1. Read `plan.agent` and `plan.agent_definition_file`
2. **Subagent task MUST include:**
   ```
   **BEFORE STARTING:** Read your agent definition file at [FILE]
   AND the relevant skill file at [SKILL]
   You MUST read these before writing any code.
   
   **FULL STACK TASK:** Implement [feature] across ALL layers:
   - Frontend: [specific components/pages]
   - Backend: [API routes, validation]
   - Database: [schema changes, migrations]
   - Testing: [build check, manual verification]
   ```
3. Spawn ONE subagent
4. Update state: `phase: "BUILD_IN_PROGRESS"`
5. Report: "BUILD: Spawned [agent] for issue #N."

### PHASE: BUILD_IN_PROGRESS
1. Check git log for new commits
2. If no commits → report "still building", return
3. If commits found → move to REVIEW

### PHASE: REVIEW
1. `git diff HEAD~1 --stat` — review all changes
2. `npx tsc --noEmit` — TypeScript check
3. Verify all layers implemented (frontend + backend + db)
4. Update state: `phase: "TEST"`
5. Report: "REVIEW: Issue #N — [N files changed]. Moving to TEST."

### PHASE: TEST
1. `cd client && npm run build` — client build
2. If build fails → phase back to BUILD with fix instructions
3. If build passes → `phase: "SHIP"`
4. Report: "TEST: Build passed. Moving to SHIP."

### PHASE: SHIP
1. `git push origin dev`
2. `gh pr list` — check for open PRs
3. Update state: `phase: "REFLECT"`
4. Report: "SHIP: Pushed to dev. Moving to REFLECT."

### PHASE: REFLECT
1. `gh issue close <number> --comment "Implemented in dev."`
2. Log to memory: `memory/YYYY-MM-DD.md`
3. Reset state for next issue
4. Report: "REFLECT: Issue #N closed. Ready for next."

---

## Agent Mapping

| Issue Label | Agent | Agent Definition File | Skill File |
|------------|-------|----------------------|-----------|
| enhancement + UI | frontend-developer | engineering-frontend-developer.md | autoplan |
| enhancement + API | backend-architect | engineering-backend-architect.md | autoplan |
| bug + UI | frontend-developer | engineering-frontend-developer.md | autoplan |
| bug + API | backend-architect | engineering-backend-architect.md | autoplan |
| security | application-security-engineer | security-application-security-engineer.md | cso |
| testing | model-qa-specialist | engineering-model-qa-specialist.md | qa |
| deploy | devops-automator | engineering-devops-automator.md | ship |
| infra | devops-automator | engineering-devops-automator.md | ship |
| full-stack (both) | backend-architect (spawns frontend subagent) | engineering-backend-architect.md | autoplan |

---

## Blocker Verification

Before skipping any issue as "blocked", run these:

**Email provider:**
```bash
RENDER_KEY=$(grep RENDER_API_KEY ~/.credentials.env | cut -d= -f2)
curl -s -H "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/services/srv-d8j6js3bc2fs73bf4rmg/env-vars" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'{ev[\"envVar\"][\"key\"]}: {ev[\"envVar\"].get(\"value\",\"NOT SET\")}') for ev in d if ev['envVar']['key'] in ['SMTP_HOST','SMTP_USER']]"
```

**Stripe key:**
```bash
RENDER_KEY=$(grep RENDER_API_KEY ~/.credentials.env | cut -d= -f2)
curl -s -H "Authorization: Bearer $RENDER_KEY" \
  "https://api.render.com/v1/services/srv-d8j6js3bc2fs73bf4rmg/env-vars" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'STRIPE_KEY_TYPE: {\"test\" if ev[\"envVar\"].get(\"value\",\"\").startswith(\"sk_test_\") else \"live\" if ev[\"envVar\"].get(\"value\",\"\").startswith(\"sk_live_\") else \"unknown\"}') for ev in d if ev['envVar']['key'] == 'STRIPE_SECRET_KEY']"
```

---

## Management Commands

| Action | Command |
|--------|---------|
| Pause cron | `cron update 056d6b3f-357e-435c-a835-cf5f4e973798 patch '{"enabled": false}'` |
| Resume cron | `cron update 056d6b3f-357e-435c-a835-cf5f4e973798 patch '{"enabled": true}'` |
| Trigger now | `cron run 056d6b3f-357e-435c-a835-cf5f4e973798` |
| Delete cron | `cron remove 056d6b3f-357e-435c-a835-cf5f4e973798` |
| View history | `cron runs 056d6b3f-357e-435c-a835-cf5f4e973798` |

---

## State File

`/root/.openclaw/workspace/.gstack/rekrut-ai-cron-state.json`

Tracks:
- `current_issue`: active issue number
- `current_phase`: milestone phase
- `phase`: current workflow phase (DISCOVER → PLAN → BUILD → ...)
- `plan`: plan details
- `build_*`: build tracking
- `history`: run history

---

## Collaboration with Cursor Agent

See `docs/cursor-collaboration.md` for details.

---

*Last updated: 2026-08-11*
