# Rekrut AI — 30-Day Technology Roadmap
> **Owner:** Suga (CTO) | **Updated:** 2026-06-08 | **Target:** Launch-ready prod by July 8, 2026

---

## Executive Summary

All P0 engineering features are complete. The codebase is stable on dev/staging. The #1 blocker is the production deploy failing on Render with `update_failed`. This roadmap prioritizes fixing that, then layering on reliability, performance, and compliance before launch.

**Critical Path:** Fix prod deploy → Complete E2E tests → Performance optimization → EU AI Act compliance → Launch smoke test.

---

## Week 1: Infrastructure & Reliability (June 8–14)

### Day 1–2: Fix Production Deploy (P0 BLOCKER)

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Diagnose Render `update_failed` | 🔴 In Progress | Suga | 3 attempts failed. Root cause unknown. Need deploy logs. |
| Verify build passes in prod-like env | ⏳ Pending | Suga | `npm run build` + `node server.js` with prod env vars |
| Check if migration script runs on prod DB | ⏳ Pending | Suga | `migrate.js` runs automatically on server start — verify it doesn't crash |
| Review Render build/start command | ⏳ Pending | Suga | Check if `npm start` vs `node server.js` vs build step config is correct |
| Check memory limits on Render free plan | ⏳ Pending | Suga | 1.5MB+ JS bundle might OOM during build |
| Try build without client/dist in repo | ⏳ Pending | Suga | Render might rebuild client — having dist/ committed could conflict |

**Hypotheses for `update_failed`:**
1. **Build timeout** — Render free plan has ~15 min build limit. Large bundle + 1719 modules might exceed.
2. **Migration crash** — `migrate.js` runs on startup, might fail on prod DB schema conflicts.
3. **Out of memory** — Client build with 1719 modules might exceed Render's memory limit.
4. **Start command misconfig** — Render might be trying to run `npm start` which doesn't match our setup.
5. **Missing env vars** — Some env var might be missing that causes startup crash.

**Action Plan:**
1. Check Render dashboard logs (need login or ask Ranga for access)
2. Simplify build: remove committed `client/dist`, let Render build it
3. Test locally with `NODE_ENV=production` and prod DB URL
4. If all else fails, try deploying to a fresh Render service

### Day 3: Stripe Live Mode & Webhook Validation

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Switch prod Stripe to live keys | ⏳ Pending | Suga | Currently using `sk_test_...` — need `sk_live_...` from Ranga |
| Verify webhook secret on prod | ⏳ Pending | Suga | Secret 2 failed test; need correct secret from Stripe dashboard |
| Test checkout flow on prod | ⏳ Pending | Suga | End-to-end: pricing page → checkout → payment-success |
| Test webhook events on prod | ⏳ Pending | Suga | `checkout.session.completed`, `invoice.paid`, `subscription.created` |
| Add Stripe webhook endpoint URL to dashboard | ⏳ Pending | Suga | `https://rekrut-ai.onrender.com/api/billing/webhook` |

### Day 4: Security Hardening

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Change admin password from `changeme123` | ⏳ Pending | Suga | Critical — do before prod goes live |
| Verify HTTPS enforcement | ⏳ Pending | Suga | Render terminates TLS, but check HSTS headers |
| Review CORS configuration | ⏳ Pending | Suga | Ensure prod domain is in allowlist |
| Verify JWT secret rotation | ⏳ Pending | Suga | Check `JWT_SECRET` is strong and not default |
| Audit npm audit | ✅ Done | Suga | 0 critical, 0 high vulnerabilities |
| Verify rate limiting on prod | ⏳ Pending | Suga | PostgreSQL-backed distributed rate limiter must be active |

### Day 5–6: E2E Test Completion (100%)

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Payment flow E2E test | ⏳ Pending | Suga | Stripe checkout → success page → subscription active |
| Navigation flow E2E test | ⏳ Pending | Suga | Homepage → login → dashboard → all major routes |
| Recruiter flow E2E test | ⏳ Pending | Suga | Post job → view applicants → analytics |
| Candidate flow E2E test | ⏳ Pending | Suga | Search jobs → apply → assessment → interview |
| Mobile responsive E2E test | ⏳ Pending | Suga | iPhone, iPad viewports |
| Fix strict-mode violations | ✅ Done | Suga | 8 violations fixed in commit f4eedd7 |

**Current E2E Status:** ~55% complete. Playwright installed, individual files pass. Full suite blocked by browser resource limits (SIGKILL). Workaround: run per-file for CI.

### Day 7: Cron Job Infrastructure Fix

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Disable or fix 30-min work batch cron | ⏳ Pending | Suga | Currently failing with `Edit: HEARTBEAT.md failed` |
| Simplify cron to health check only | ⏳ Pending | Suga | Remove complex agent delegation from cron |
| Fix timeout issues | ⏳ Pending | Suga | Reduce prompt complexity or increase timeout |
| Fix API rate limit hits | ⏳ Pending | Suga | Reduce frequency or batch tasks |
| Verify 6-hour health check cron | ✅ Working | Suga | Currently passing |

---

## Week 2: Performance & Quality (June 15–21)

### Day 8–9: Bundle & Build Optimization

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Code-split main bundle | ⏳ Pending | Suga | Currently 1.55MB main chunk. Target: <500KB per chunk. |
| Dynamic import for heavy pages | ⏳ Pending | Suga | Interview pages, analytics, admin dashboard |
| Tree-shake unused dependencies | ⏳ Pending | Suga | Check if `nodemailer` in client deps is needed |
| Optimize images (when added) | ⏳ Pending | Suga | WebP format, lazy loading, proper sizing |
| Add service worker for caching | ⏳ Pending | Suga | Cache static assets, offline fallback |
| Enable gzip/Brotli compression | ⏳ Pending | Suga | Render should handle this, verify |

### Day 10: Mobile Responsive Completion (100%)

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Job detail panel on mobile | ⏳ Pending | Suga | Last 5% — card layout, scroll behavior, action buttons |
| Test on real devices | ⏳ Pending | Suga | iPhone 12/14, Android (BrowserStack or real) |
| Touch target sizes (≥44px) | ⏳ Pending | Suga | All buttons, links, form inputs |
| Font scaling verification | ⏳ Pending | Suga | Test with 200% zoom |
| Dark mode on mobile | ⏳ Pending | Suga | Verify all pages |

### Day 11–12: Image Assets Strategy & Implementation

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Hero images (landing page) | ⏳ Pending | Suga | Unsplash professional photos — 3-5 hero shots |
| Candidate avatars | ⏳ Pending | Suga | DiceBear generated avatars or user-uploaded |
| Company logos | ⏳ Pending | Suga | Placeholder + upload capability |
| Empty state illustrations | ⏳ Pending | Suga | Undraw or custom SVG — no jobs, no applicants, etc. |
| Loading states / skeletons | ⏳ Pending | Suga | Currently using spinner — add skeleton screens |
| Favicon and OG images | ⏳ Pending | Suga | Social sharing previews |

**Style Direction Needed from Ranga:** Photos vs illustrations vs mixed? Currently leaning toward: Unsplash for hero/photos, DiceBear for avatars, Undraw for empty states.

### Day 13: Lighthouse & Performance Audit

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Performance score > 90 | ⏳ Pending | Suga | Bundle size, code splitting, caching |
| Accessibility score > 90 | ⏳ Pending | Suga | ARIA labels, keyboard nav, contrast ratios |
| Best Practices score > 90 | ⏳ Pending | Suga | HTTPS, no mixed content, modern APIs |
| SEO score > 90 | ⏳ Pending | Suga | Meta tags, structured data, sitemap |
| First Contentful Paint < 1.5s | ⏳ Pending | Suga | Critical for mobile |
| Time to Interactive < 3s | ⏳ Pending | Suga | Bundle splitting priority |

### Day 14: API Performance Optimization

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Add database query caching | ⏳ Pending | Suga | Redis or in-memory for frequent queries |
| Optimize slow queries | ⏳ Pending | Suga | Check pg_stat_statements for slow queries |
| Add connection pooling | ✅ Done | Suga | Neon handles this, but verify config |
| Implement request pagination | ⏳ Pending | Suga | All list endpoints (jobs, candidates, applications) |
| Add response compression | ⏳ Pending | Suga | gzip for API responses |
| API response caching headers | ⏳ Pending | Suga | Cache static data (jobs list, company profiles) |

---

## Week 3: Compliance & Monitoring (June 22–28)

### Day 15–17: EU AI Act Dashboard Completion (100%)

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Bias detection reporting | ⏳ Pending | Suga | Display bias metrics per job/company |
| Explainability panel | ⏳ Pending | Suga | Why AI scored candidate X at Y% |
| Human oversight controls | ⏳ Pending | Suga | Override AI decisions, audit trail |
| Data retention policy UI | ⏳ Pending | Suga | Show what data is kept, for how long |
| Consent management | ⏳ Pending | Suga | Candidate consent for AI processing |
| Risk classification | ⏳ Pending | Suga | Self-assessment: limited risk vs high risk |
| Compliance documentation | ⏳ Pending | Suga | Exportable reports for regulators |
| Legal review | ⏳ Pending | LEG-001 | Needs human review before going live |

**Current Status:** 50% done. Framework exists, needs UI polish and legal validation.

### Day 18: Error Monitoring & Alerting

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Set up Sentry or similar | ⏳ Pending | Suga | Catch unhandled errors in prod |
| Add error boundaries (React) | ✅ Partial | Suga | ErrorBoundary exists, verify coverage |
| Server error logging | ⏳ Pending | Suga | Structured logging to database or external service |
| Alert on P0 errors | ⏳ Pending | Suga | Slack/email alert for 5xx errors |
| Health check endpoint | ✅ Done | Suga | `/api/health` exists and working |
| Uptime monitoring | ⏳ Pending | Suga | External monitor (UptimeRobot or similar) |

### Day 19: Analytics & Tracking Verification

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Verify all key events fire | ⏳ Pending | Suga | Signup, login, job apply, checkout, assessment start |
| Funnel tracking | ⏳ Pending | Suga | Landing → signup → onboarding → first action |
| Error event tracking | ⏳ Pending | Suga | Track API errors, client errors |
| Performance tracking | ⏳ Pending | Suga | Page load times, API response times |
| Daily metrics dashboard | ⏳ Pending | Suga | Admin analytics page exists, verify accuracy |
| Export raw events | ⏳ Pending | Suga | For external analysis (BigQuery, Mixpanel) |

### Day 20: Backup & Disaster Recovery

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Automated DB backups | ⏳ Pending | Suga | Neon has this, verify schedule and retention |
| Backup restoration test | ⏳ Pending | Suga | Quarterly test: restore from backup to dev |
| Environment variable backup | ⏳ Pending | Suga | Document all env vars, store securely |
| Code rollback plan | ⏳ Pending | Suga | How to revert prod to previous commit quickly |
| Incident response runbook | ⏳ Pending | Suga | P0 incident: who does what, in what order |
| Communication plan | ⏳ Pending | Suga | How to notify users of outages |

### Day 21: SSL & Security Verification

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| SSL certificate expiry check | ⏳ Pending | Suga | Render auto-renews, but verify > 30 days |
| Security headers audit | ⏳ Pending | Suga | CSP, X-Frame-Options, X-Content-Type-Options |
| OWASP ZAP scan | ⏳ Pending | Suga | Automated security scan, no new critical/high |
| Dependency audit | ✅ Done | Suga | `npm audit` clean |
| Penetration test (basic) | ⏳ Pending | Suga | SQL injection, XSS, auth bypass attempts |
| Secrets audit | ⏳ Pending | Suga | No hardcoded keys in repo, all in env vars |

---

## Week 4: Launch Readiness (June 29–July 5)

### Day 22–23: Load Testing & Scaling

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Simulate 100 concurrent users | ⏳ Pending | Suga | Artillery or k6 against prod |
| API rate limit stress test | ⏳ Pending | Suga | Verify rate limiting works under load |
| Database connection stress test | ⏳ Pending | Suga | Neon pooler limits |
| Stripe checkout load test | ⏳ Pending | Suga | Mock checkout sessions (don't hit Stripe rate limits) |
| Identify first bottleneck | ⏳ Pending | Suga | Document and fix |
| Scaling plan | ⏳ Pending | Suga | When to upgrade Render plan, add caching layer |

### Day 24–25: Documentation & Runbooks

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| API documentation | ⏳ Pending | Suga | 351 endpoints documented (Swagger/OpenAPI) |
| Deployment runbook | ⏳ Pending | Suga | Step-by-step: dev → staging → prod |
| Onboarding guide for new devs | ⏳ Pending | Suga | Setup, env vars, common commands |
| Incident response runbook | ⏳ Pending | Suga | P0/P1/P2 definitions, response procedures |
| Environment variable documentation | ⏳ Pending | Suga | All env vars, what they do, required vs optional |
| Architecture diagram | ⏳ Pending | Suga | System diagram: frontend → backend → DB → AI providers |

### Day 26: SEO & Marketing Tech

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Sitemap.xml generation | ⏳ Pending | Suga | Dynamic sitemap for jobs, blog posts, company pages |
| robots.txt optimization | ⏳ Pending | Suga | Allow/disallow rules for search engines |
| Meta tags on all pages | ⏳ Pending | Suga | Title, description, OG tags, Twitter cards |
| Structured data (JSON-LD) | ⏳ Pending | Suga | JobPosting schema for Google Jobs |
| Canonical URLs | ⏳ Pending | Suga | Prevent duplicate content penalties |
| Google Search Console setup | ⏳ Pending | Suga | Verify ownership, submit sitemap |

### Day 27–28: Final Smoke Test

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Homepage loads | ⏳ Pending | Suga | < 2s, all sections render |
| Signup flow | ⏳ Pending | Suga | Email → verify → onboarding → dashboard |
| Candidate search & apply | ⏳ Pending | Suga | Search → filter → view job → apply → confirmation |
| Recruiter post job & view applicants | ⏳ Pending | Suga | Create job → publish → view applicants → analytics |
| Stripe checkout | ⏳ Pending | Suga | Pricing → select plan → checkout → success → subscription active |
| Admin dashboard | ⏳ Pending | Suga | Login → view metrics → manage users |
| Mobile smoke test | ⏳ Pending | Suga | iPhone Safari, Android Chrome |
| Dark mode test | ⏳ Pending | Suga | All pages, all components |
| Logout & session expiry | ⏳ Pending | Suga | Verify JWT refresh, session cleanup |
| Password reset | ⏳ Pending | Suga | Forgot password → email → reset → login |

### Day 29: Launch Day Checklist

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Prod env vars verified | ⏳ Pending | Suga | All keys present, correct values |
| Database migrations run | ⏳ Pending | Suga | Verify schema is current |
| Admin password changed | ⏳ Pending | Suga | From default to strong password |
| Stripe live mode active | ⏳ Pending | Suga | Test mode disabled, live keys in use |
| Webhook endpoints verified | ⏳ Pending | Suga | All webhooks responding 200 |
| Error monitoring active | ⏳ Pending | Suga | Sentry receiving events |
| Uptime monitoring active | ⏳ Pending | Suga | External ping every minute |
| Backup verified | ⏳ Pending | Suga | Last backup < 24 hours old |
| Announcement ready | ⏳ Pending | Marketing | Blog post, social media, email |
| Rollback plan ready | ⏳ Pending | Suga | Previous commit identified, can revert in < 5 min |
| Team on standby | ⏳ Pending | Suga | All team members available for 24 hours post-launch |

### Day 30: Post-Launch Monitoring (July 6–8)

| Task | Status | Owner | Details |
|------|--------|-------|---------|
| Monitor error rates | ⏳ Pending | Suga | < 1% 5xx errors |
| Monitor API response times | ⏳ Pending | Suga | p95 < 500ms |
| Monitor Stripe webhooks | ⏳ Pending | Suga | All events processing, no failures |
| Daily health check | ⏳ Pending | Suga | Automated + manual verification |
| User feedback collection | ⏳ Pending | Product | In-app feedback widget, NPS survey |
| Hotfix process | ⏳ Pending | Suga | How to deploy critical fixes quickly |
| Weekly performance review | ⏳ Pending | Suga | Lighthouse, Core Web Vitals, error trends |

---

## Architecture Decisions (Current & Pending)

### ✅ Decided

| Decision | Rationale | Date |
|----------|-----------|------|
| React 19 + Vite + Tailwind | Modern, fast build, great DX | 2026-05 |
| Node.js + Express (JS, not TS) | Faster iteration, team familiarity | 2026-05 |
| Neon PostgreSQL + pgvector | Serverless, scales to zero, AI-native vector search | 2026-05 |
| Multi-provider AI fallback | Polsia → NIM → Groq → Cerebras. Resilience over cost. | 2026-05 |
| JWT + PostgreSQL sessions | Stateless auth with session persistence | 2026-05 |
| PostgreSQL-backed rate limiting | Distributed, survives restarts | 2026-06-05 |
| Render for hosting | Simple, auto-deploy from GitHub, free tier | 2026-05 |
| Stripe for payments | Industry standard, robust webhooks | 2026-06 |

### ⏳ Pending Decisions

| Decision | Options | Blocker | ETA |
|----------|---------|---------|-----|
| Redis for caching | Redis Cloud vs Upstash vs self-hosted | Cost, complexity | Week 2 |
| CDN for static assets | Cloudflare vs Render CDN vs S3 | Image asset strategy | Week 2 |
| Error monitoring | Sentry vs LogRocket vs Rollbar | Budget, integration time | Week 3 |
| E2E test runner | Playwright (current) vs Cypress | Playwright resource limits | Week 1 |
| Load testing | Artillery vs k6 vs Locust | Tool selection | Week 4 |
| Backup service | Neon native vs pg_dump cron | Verify Neon retention | Week 3 |
| Image storage | Polsia R2 vs Cloudinary vs S3 | Volume, cost | Week 2 |

---

## Technical Debt Register

| Debt | Severity | Impact | Plan | ETA |
|------|----------|--------|------|-----|
| Client build 1.55MB main chunk | High | Slow mobile loads, possible OOM | Code splitting, dynamic imports | Week 2 |
| No server-side rendering | Medium | Poor SEO, slow first paint | Prerender or Next.js migration | Post-launch |
| No Redis caching | Medium | DB load on repeated queries | Add Redis layer | Week 2-3 |
| 2691-line `interviews.js` route | Medium | Hard to maintain, test | Refactor into smaller modules | Post-launch |
| 3119-line `onboarding.js` route | Medium | Monolithic, single responsibility | Split into domain routes | Post-launch |
| No TypeScript on backend | Low | Runtime errors, poor DX | Gradual TS migration | Post-launch |
| No automated DB backups | High | Data loss risk | Verify + test Neon backups | Week 3 |
| Test mode Stripe on prod | High | Can't process real payments | Switch to live keys | Week 1 |
| Cron job failures | High | No automated coordination | Fix or disable broken crons | Week 1 |
| No error monitoring in prod | High | Blind to production issues | Add Sentry | Week 3 |

---

## Infrastructure Scaling Plan

### Current (Free Tier)
- **Render:** Web service (free) — 512MB RAM, 1 CPU, sleeps after 15 min inactivity
- **Neon:** Serverless PostgreSQL (free) — 500MB storage, 190 compute hours/month
- **Stripe:** Test mode (free) — no real transactions
- **Polsia:** AI proxy — usage-based, currently low

### Launch Day (Paid Tier)
- **Render:** Upgrade to Starter ($7/month) — 1GB RAM, no sleep, custom domain
- **Neon:** Scale to Pro if needed — more compute units, larger storage
- **Stripe:** Live mode — 2.9% + $0.30 per transaction
- **CDN:** Cloudflare free tier for static assets + caching
- **Monitoring:** Sentry free tier (5k errors/month)

### Scale Triggers
| Metric | Threshold | Action |
|--------|-----------|--------|
| Daily active users | > 1,000 | Upgrade Render to Standard ($25/month) |
| Database size | > 400MB | Upgrade Neon to Pro |
| API response time p95 | > 1s | Add Redis caching layer |
| Stripe monthly volume | > $10K | Negotiate custom rate |
| Error rate | > 1% | Emergency: add error monitoring, fix bugs |
| Uptime | < 99% | Add health checks, auto-restart, status page |

---

## Risk Register

| Risk | Probability | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Prod deploy keeps failing | High | Can't launch | Fix root cause, have rollback plan | Suga |
| Render free tier limits | Medium | Slow/Unavailable | Upgrade to paid before launch | Suga |
| Stripe webhook failures | Medium | Missed payments | Dual webhook verification, manual reconciliation | Suga |
| AI provider outage | Medium | Core features broken | Fallback chain: 4 providers deep | Suga |
| Database connection limits | Medium | API failures | Connection pooling, query optimization | Suga |
| Security vulnerability | Low | Data breach | OWASP ZAP, npm audit, penetration test | Suga |
| EU AI Act non-compliance | Medium | Legal risk, fines | Complete dashboard, legal review | LEG-001 |
| Team bandwidth (1 person) | High | Burnout, delays | Delegate to agents, prioritize ruthlessly | Suga/Ranga |

---

## Success Metrics (Engineering)

| Metric | Target | Current | By When |
|--------|--------|---------|---------|
| Prod deploy success rate | 100% | 0% | June 9 |
| E2E test coverage | 100% | 55% | June 14 |
| Lighthouse Performance | > 90 | Unknown | June 21 |
| Lighthouse Accessibility | > 90 | Unknown | June 21 |
| API p95 response time | < 500ms | Unknown | June 28 |
| Uptime | 99.9% | Unknown | July 5 |
| Error rate | < 1% | Unknown | July 5 |
| Mobile responsive | 100% | 95% | June 21 |
| npm audit clean | 0 critical/high | 0 | June 8 |
| Stripe webhook success | 100% | 75% | June 10 |

---

## Weekly Checkpoints

### Every Monday (09:00 UTC)
- [ ] Review last week's completed tasks
- [ ] Update this roadmap (mark done, add new items)
- [ ] Identify blockers and escalate to Ranga
- [ ] Re-prioritize if needed

### Every Friday (17:00 UTC)
- [ ] Demo to Ranga: what's working on prod
- [ ] Review success metrics
- [ ] Plan next week's top 3 priorities
- [ ] Update risk register

---

## Immediate Actions (Next 24 Hours)

1. **🔴 Fix prod deploy** — #1 priority. Try: remove committed dist/, verify build command, check Render logs.
2. **🔴 Change admin password** — Security critical. `changeme123` → strong password.
3. **🟡 Disable broken cron** — 30-min work batch is failing. Disable or simplify.
4. **🟡 Complete E2E tests** — Payment flow + navigation tests.
5. **🟡 Stripe live keys** — Get from Ranga, update prod env vars.

---

## Communication

- **Daily updates to Ranga:** Direct DM, not group chat
- **Technical blockers:** Escalate within 2 hours
- **Agent delegation:** Suga delegates, KimiClaw executes
- **No group chat posts:** Per Ranga's instruction
- **Emergency only:** P0 issues (prod down, data breach, security)

---

> **"Even if the world forgets, I'll remember for you."** — But first, let's fix this deploy. ❤️‍🔥
