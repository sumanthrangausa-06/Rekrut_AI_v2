# MEMORY.md — Long-Term Project Memory

_This is the distilled essence. Daily logs go in memory/YYYY-MM-DD.md._

---

## Project: Rekrut AI v2

**What it is:** AI-powered recruitment/hiring platform (hybrid web app: mobile, laptop, iPad)
**Founder:** Ranga Sumanth
**Domain:** rekrutai.co
**Status:** 85-90% production ready (dev branch)
**Launch deadline:** 90-day sprint (from ~June 2026)

---

## Architecture

**Frontend:** React + TypeScript, 42 routes, 53 pages
- 27 migrated to React, 11 legacy HTML, 3 placeholders (now mostly resolved)
- Settings page built (replaces last placeholder)
- TypeScript errors: 0 (`tsc --noEmit` exits clean)
- Bundle: 1.5MB gzipped (larger than 500KB warning — needs code-splitting)

**Backend:** Node.js/Express, 351 endpoints, 23 route files
- All services operational
- Rate limiter: distributed PostgreSQL-backed (fixed June 5, 2026)
- Security: helmet middleware added, CSP, HSTS, frame protection, x-powered-by disabled

**Database:** Neon PostgreSQL, 105 tables, schema hardened, performance tuned
- pgvector for AI matching

**AI:** 5-provider fallback, circuit breaker, token budgeting

**Deploy:** Render (2 services)
- `rekrutai-dev` (branch: dev, autoDeploy: true) — https://rekrutai-dev.onrender.com — for QA testing
- `rekrutai-prod` (branch: main, autoDeploy: true) — https://rekrut-ai.onrender.com — production
- `render.yaml` already has all 3 services configured (dev/staging/prod) with Neon DB connections
- Workflow: Dev (local build + agent work) → push to dev branch → QA tests on rekrutai-dev → PR to main → production
- Local `.env` synced from Render rekrutai-dev env vars (all API keys, DB, secrets)
- Local build verified: 43.42s, 1719 modules, TypeScript clean, bundle ~1.65MB (needs code-splitting)

**GitHub:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2
**Render:** https://rekrutai-dev.onrender.com

---

## Team & Roles

| Agent | Role | Responsibility |
|-------|------|----------------|
| Ranga | CEO/Founder | Decisions, approvals, Stripe keys |
| Suga (prev) | CEO (in Rekrut AI Company group) | Strategic leadership, big picture, code review |
| CMO | Marketing | Content-first strategy, $17.5K budget, 15K candidate target by Day 90 |
| Kimi | COO | Operations, sub-agent assignments, coordination |
| kimiclaw | CTO/Technical Lead | Hands-on engineering, architecture, deployment, code delivery |
| Sunny | QA | Testing, manual verification |

**210 Specialized Agent Pool:** Organized by specialty (BE-001, FE-001, AI-001, MKT-001, etc.)
- Backend 12, Frontend 8, AI/ML 18, DevOps 6, QA 8, Database 4, Product 13, Growth 28, Compliance 13, AI Research 23, Support 81
- Can be spawned via Kimi (COO) for parallel work

---

## Critical Decisions

1. **KYC:** In-house only. No vendor reliance.
2. **Launch Strategy:** B2C2B (candidate-first) confirmed.
3. **Stripe:** No live account yet. ~1 week needed. Also exploring alternatives.
4. **Staging:** Proper staging branch + environment on Render (Hobby plan)
5. **Agent Timeout Rule:** One agent = one file, one task. Multi-file >500 lines always times out at 3m.
6. **Micro-task Principle:** Break into single-file, single-component tasks. Spawn 5 agents in parallel for 5 files.
7. **Group Chat Collaboration (DISSOLVED):** As of 2026-06-08, the Rekrut AI Company group chat (19ea33fc-2152-8e68-8000-0c464b9e62f3) has been dissolved. New primary communication channel is Telegram via bot token `8848704376:AAFzsD1BX4tnqab8M_Gch9_DTivFe5NeJl0`.
8. **Proactive Engagement:** I do not wait to be called or @mentioned. I check Telegram regularly, jump in when I see something I can help with, and proactively reach out to Suga or Ranga when I need help or see a blocker. I don't sit idle waiting for instructions.

---

## Known Blockers (P0)

| ID | Issue | Status | Assignment |
|----|-------|--------|------------|
| B-001 | Candidate Search page | CLOSED — already built | N/A |
| B-008 | Sign Up polish (Visily design match) | todo | Suga |
| B-004 | Legacy HTML migration (42 files) | todo | Suga (low priority) |
| B-005 | /settings page (actual placeholder) | todo | kimiclaw |

**Discovery (June 5):** The 2 "P0 blockers" flagged as placeholders were actually already built:
- `/recruiter/candidates.tsx` — fully built with OmniScore, filters, pipeline stats
- `/recruiter/analytics.tsx` — fully built with hiring funnel, metrics, source breakdown
- `/candidate/documents.tsx` — fully built with upload, OCR, fraud detection
- Only actual placeholder was `/settings` — now built

---

## QA Results (June 6, 2026) — Updated Workflow

**New QA Process (2026-06-06):**
- QA uses browser agents for flow testing with screenshots
- Tests run against dev branch before merge to main
- GitHub issues track bugs, assigned to specialized agents
- QA reports issues → I assign to agents → agents fix → QA re-tests

**Previous Test Accounts:**
- test_candidate@rekrutai.co / Test123!
- test_recruiter@rekrutai.co / Test123!
- qa_test@rekrutai.co / Test123!

**P1 Issues:**
1. Missing API endpoints: `/api/candidate/jobs`, `/api/recruiter/analytics`
2. SPA token persistence: direct navigation to protected routes redirects to login

---

## Design Reference (Visily)

20 reference designs at `C:\Users\ranga\Downloads\visily-multiscreens`
Key screens reviewed:
- **Sign-up**: Clean card layout, left welcome panel + right form, blue primary (#4F46E5), LinkedIn social sign-in
- **Dashboard**: Sidebar nav, top search bar, chart cards, data tables, filter pills
- **Candidate Listing (B-001)**: Search bar + filter dropdowns, profile cards with avatars/skills/tags, "Send message"/"Connect" actions, pagination, right-side CTA promo
- **Homepage**: Hero with photos, trusted-by logos, feature cards, blog grid, consistent footer

Design system: White backgrounds, blue primary, card-based layouts, consistent footer (Logo/Product/Resources/Company/Newsletter), pill-style tags, clean typography

Priority: 12 P0 screens for launch

---

## Agent Work Patterns (Learned)

**What works:**
- New file creation in 1-2 minutes (no read needed)
- Single-file, single-component tasks
- Pre-reading file contents myself, sending to agent as context (avoids agent reading time)
- Direct edits for small fixes (1-2 files, App.tsx routes)
- Group chat collaboration with short messages and file-based deliverables

**What fails:**
- Multi-file modifications (agent times out at 3m)
- Files >500 lines (80% of budget spent on reading)
- "Fix all TypeScript errors" as one task
- 6x timeout on responsive layouts, ARIA labels
- 52KB reports nobody reads
- Working in isolation without updating the group

**Success pattern:** Spawn 5 agents for 5 files in parallel instead of 1 agent for 5 files. Update the group with one-line progress summaries.

---

## How to Work with Ranga

1. **Status updates:** Focused format — what's ready, what's blocked, what decisions needed. No fluff.
2. **When he says "stop talking":** Stop immediately. He means it.
3. **Async preferred:** When he's busy/sleeping, do async work. Don't ping repeatedly.
4. **Autonomy expected:** Don't ask for credentials you already have. Check files first.
5. **Direct action over reports:** He wants code, not 52KB architecture docs. Build first, summarize after.
6. **Group chat:** Don't dominate. Quality > quantity. Use reactions for simple acknowledgments.
7. **Frustration triggers:** Repetition, blocked progress without proposed solutions, asking for same info twice.

---

## How to Work in Telegram (Rekrut AI)

1. **Primary interface:** Telegram is my main workspace (group chat dissolved 2026-06-08). I do not work in isolation.
2. **Short messages:** 1-2 sentences per message. No multi-paragraph dumps.
3. **Direct mentions:** @mention the relevant person, not broadcast.
4. **Files for substance:** Substantial output in files, short summary in Telegram.
5. **Convergence signals:** Use `结论:`, `阻塞:`, `交回指挥:` to close discussions cleanly.
6. **No debate loops:** If disagreement repeats, stop and escalate to Ranga.
7. **Peer dialogue:** One question to one person, wait for reply, then return control.
8. **Celebrate wins:** One-line acknowledgment when something ships. No need for essays.

---

*Last updated: 2026-06-08. Telegram is now the primary channel. Group chat dissolved.*
