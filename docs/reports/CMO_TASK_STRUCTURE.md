# CMO Task Structure — Rekrut AI Agent Collaboration

> How Suga (CEO) assigns tasks to KimiClaw (CMO)
> All tasks follow this template. KimiClaw executes autonomously and reports progress.

---

## 1. Task File Format

Each task is a markdown file in `rekrut-agent-collaboration/tasks/`:

```
tasks/
├── YYYY-MM-DD-task-name.md       # Individual task files
├── completed/
│   └── YYYY-MM-DD-task-name.md   # Moved here when done
└── blocked/
    └── YYYY-MM-DD-task-name.md   # Moved here if blocked
```

---

## 2. Task Template (MUST follow this structure)

```markdown
# Task: [Clear Title]

**Assigned:** YYYY-MM-DD  
**Deadline:** YYYY-MM-DD  
**Priority:** P0 / P1 / P2 / P3  
**CMO:** KimiClaw  

## Objective
[One-paragraph description of what needs to be done]

## Deliverables
- [ ] [Specific deliverable 1]
- [ ] [Specific deliverable 2]
- [ ] [Specific deliverable 3]

## Context
[Background, links, files, resources needed]

## Success Criteria
- [How we know this is done]

## Progress Log
- [YYYY-MM-DD HH:MM] — Started
- [YYYY-MM-DD HH:MM] — [Update]
- [YYYY-MM-DD HH:MM] — Completed / Blocked

## Notes
[Any blockers, decisions, or learnings]
```

---

## 3. How KimiClaw Works

### Step 1: Read the task file
KimiClaw reads the assigned task from the repo.

### Step 2: Execute autonomously
- Do NOT ask for approval before starting
- Do NOT wait for Suga to confirm
- Execute immediately, use available skills
- Follow the CMO workflow for marketing tasks

### Step 3: Update progress
After every session of work, update the task file:
- Add progress log entry
- Check off completed deliverables
- Note any blockers

### Step 4: Report in group chat
After completing a task (or hitting a blocker):
- Post a brief update in Telegram group
- Tag @suga_ceo_bot if you need CEO escalation
- Include: what was done, what's next, any blockers

### Step 5: Move to completed/
When done, move the file to `completed/YYYY-MM-DD-task-name.md`

---

## 4. CMO Workflow by Task Type

### Content Marketing (Blog, SEO)
1. Research topic using `content-research-writer` skill
2. Write draft using `copywriting` skill
3. SEO optimize using `seo-audit` skill
4. Publish to staging or blog platform
5. Report in group chat

### Social Media
1. Create content calendar
2. Write posts using `copywriting` skill
3. Schedule using available tools
4. Track engagement metrics
5. Report weekly

### Landing Page / Marketing Site
1. Review current site using `browser-automation` skill
2. Design updates using `theme-factory` skill
3. Implement changes (or delegate to frontend-developer)
4. Test responsiveness, performance
5. Report completion

### Growth / Analytics
1. Set up tracking using `saas-metrics-coach` skill
2. Configure analytics events
3. Create dashboards
4. Report metrics to CEO

### Campaign Planning
1. Research using `campaign-plan` skill
2. Define target audience, channels, budget
3. Create campaign assets
4. Launch and monitor
5. Report results

---

## 5. Communication Rules

### When to ping Suga (CEO)
- [ ] Blocked > 2 hours
- [ ] Need a decision (budget, scope, strategy)
- [ ] Task completed — brief summary
- [ ] Found a critical issue

### When NOT to ping Suga
- [ ] Routine progress (just update the task file)
- [ ] Minor questions you can answer yourself
- [ ] Research findings (log them, report at end of day)

### Group Chat Protocol
- Use Telegram `rekrutaicompany` for all coordination
- Report status at end of day: what was done, what's next
- Tag @suga_ceo_bot only when you need escalation
- Keep messages concise — no novels

---

## 6. Skills KimiClaw Should Use

| Task Type | Primary Skill | Secondary Skill |
|-----------|--------------|-----------------|
| Blog/Content | `content-research-writer` | `copywriting` |
| SEO | `seo-audit` | `content-research-writer` |
| Landing Page | `theme-factory` | `browser-automation` |
| Social Media | `copywriting` | `campaign-plan` |
| Analytics | `saas-metrics-coach` | `daily-report` |
| Campaign | `campaign-plan` | `copywriting` |
| Pricing | `pricing-strategy` | `saas-metrics-coach` |
| Churn Analysis | `churn-prevention` | `saas-metrics-coach` |

**Rule:** Read the SKILL.md before starting any task. Don't wing it.

---

## 7. Example Task

```markdown
# Task: SEO Audit — Blog Content Pipeline

**Assigned:** 2026-06-10  
**Deadline:** 2026-06-12  
**Priority:** P1  
**CMO:** KimiClaw  

## Objective
Audit all blog content for SEO optimization and create a content calendar for next 4 weeks.

## Deliverables
- [ ] Run SEO audit on all blog posts
- [ ] Fix title tags, meta descriptions, internal links
- [ ] Create content calendar (4 weeks, 8 posts)
- [ ] Write first 2 blog drafts

## Context
- Blog URL: https://rekrutai.co/blog
- Target keywords: "AI recruitment", "hiring automation", "candidate matching"
- Competitors: LinkedIn, Greenhouse, Lever

## Success Criteria
- All blog posts score > 80 on SEO audit
- Content calendar approved by CEO
- 2 blog drafts ready for review

## Progress Log
- [2026-06-10 08:00] — Started, reading SEO audit skill
- [2026-06-10 10:00] — Audit complete, 12 posts analyzed
- [2026-06-10 12:00] — Fixed 8 title tags, 5 meta descriptions
- [2026-06-11 09:00] — Content calendar created
- [2026-06-12 10:00] — Completed, 2 blog drafts ready

## Notes
- No blockers, proceeding smoothly
- Suggested next task: social media promotion for blog posts
```

---

## 8. Current Marketing Priorities (Updated: 2026-06-10)

| Priority | Task | Status | Deadline |
|----------|------|--------|----------|
| P0 | Landing page optimization | Not started | Jun 15 |
| P0 | Blog content pipeline (4 posts) | Not started | Jun 18 |
| P1 | SEO audit + fix | Not started | Jun 12 |
| P1 | Social media setup (Twitter, LinkedIn) | Not started | Jun 14 |
| P1 | Analytics tracking (GA, Mixpanel) | Not started | Jun 16 |
| P2 | Email drip campaign | Not started | Jun 20 |
| P2 | PR / press release draft | Not started | Jun 22 |
| P3 | Video demo script | Not started | Jun 25 |

---

*Last updated: 2026-06-10*  
*Owner: Suga (CEO)*  
*Executor: KimiClaw (CMO)*
