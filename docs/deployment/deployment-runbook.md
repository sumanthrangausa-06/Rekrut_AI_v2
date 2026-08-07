## Process Document: HireLoop Deployment Runbook (Staging → Production)

**Owner:** Suga (CTO) | **Last Updated:** 2026-06-06 | **Review Cadence:** Quarterly

### Purpose

Standardize and de-risk every deployment to production. This runbook ensures that code moves from staging to production in a repeatable, verifiable way with clear rollback paths and minimal user impact.

### Scope

- **Included:** Frontend (React/Vite), backend (Node.js/Express), database migrations (Neon PostgreSQL), static assets (blog posts, JSON data)
- **Excluded:** Infrastructure provisioning (handled by Render blueprints), SSL certificate management (handled by Cloudflare), Neon branching (separate SOP)
- **Applies to:** `dev` → `staging` → `production` promotion pipeline

### RACI Matrix

| Step | Responsible | Accountable | Consulted | Informed |
|------|------------|-------------|-----------|----------|
| 1. Pre-deploy checks | Suga | Ranga (CEO) | Kimi (COO) | Team |
| 2. Staging validation | Suga | Ranga | Sunny (QA) | Team |
| 3. Create production PR | Suga | Suga | — | Team |
| 4. Merge & deploy | Suga | Ranga | — | All users |
| 5. Post-deploy verification | Sunny | Suga | Ranga | Team |
| 6. Rollback (if needed) | Suga | Ranga | Kimi | Team |

### Process Flow

```
[Staging Branch] → [1. Pre-deploy checks] → [2. Validate staging] → [3. Create PR to main]
                                              ↓ FAIL          ↓ FAIL
                                         [Fix → retry]    [Abort → notify]

[3. Create PR to main] → [4. Merge & deploy] → [5. Post-deploy verify] → [DONE]
                                              ↓ FAIL
                                         [6. Rollback]
```

### Detailed Steps

#### Step 1: Pre-Deployment Checks (5-10 min)

- **Who:** Suga (or deploying engineer)
- **When:** Before any production deployment
- **How:**
  1. Ensure staging branch `git status` is clean (`git diff` empty)
  2. Confirm latest commit on staging is green (build passed, tests passed)
  3. Check `client/build` completed with no errors
  4. Verify database migrations in `migrations/` are idempotent (can run multiple times safely)
  5. Confirm all environment variables are set on production (Render dashboard)
  6. Check that no P0 bugs exist in staging (review Sentry, error logs)
- **Output:** ✅ Pre-deploy checklist complete (mentally or in deployment log)

#### Step 2: Staging Validation (10-15 min)

- **Who:** Suga + Sunny (QA)
- **When:** After staging auto-deploys
- **How:**
  1. Open `https://rekrutai-staging.onrender.com`
  2. Run smoke tests: login → dashboard → core page loads
  3. Verify critical user journeys: sign up → create profile → apply to job
  4. Check API health: `GET /api/health` returns 200
  5. Verify AI features respond (no provider timeouts): `GET /api/ai/health`
  6. Check database connectivity: no connection pool errors in logs
- **Output:** Staging validation pass/fail report

#### Step 3: Create Production Pull Request (2 min)

- **Who:** Suga
- **When:** After staging passes all checks
- **How:**
  1. Open GitHub: `https://github.com/sumanthrangausa-06/Rekrut_AI_v2`
  2. Create PR: `staging` → `main`
  3. Title format: `Deploy: [YYYYMMDD] — [brief description]`
  4. Body template:
     ```
     ## What's Deploying
     - Feature/fix list
     - Commits included: `git log main..staging --oneline`

     ## Staging Validation
     - [ ] Build passed
     - [ ] Smoke tests passed
     - [ ] API health check passed
     - [ ] AI providers responding
     - [ ] No P0 bugs in staging

     ## Rollback Plan
     - Previous production commit: `git rev-parse HEAD`
     - Rollback command: `git revert [merge commit]` or `git reset --hard [prev commit]`
     ```
- **Output:** GitHub PR link

#### Step 4: Merge & Deploy (5-10 min)

- **Who:** Suga (or Ranga for critical deployments)
- **When:** PR approved and ready
- **How:**
  1. Merge PR to `main` via GitHub (squash or merge commit — team convention is merge commit for deploys)
  2. Confirm Render auto-deploy triggers for production service
  3. Monitor Render dashboard for build status
  4. Watch build logs for errors (especially `npm run build` in client)
  5. Verify deployment completes (Render shows "Live")
- **Output:** Production deployment live at `https://hireloop-vzvw.polsia.app`

#### Step 5: Post-Deploy Verification (15-20 min)

- **Who:** Sunny (QA) + Suga
- **When:** Within 30 minutes of production deploy
- **How:**
  1. Open production URL
  2. Run same smoke tests as staging (login, dashboard, core pages)
  3. Verify API health endpoint
  4. Check error logs for new exceptions (Sentry/Render logs)
  5. Verify critical integrations: Stripe (test payment), AI providers (mock interview), email (SMTP)
  6. Check database migration logs (Neon dashboard or application logs)
  7. Verify no 500 errors in first 10 minutes of traffic
- **Output:** Post-deploy verification report (pass or flag issues)

#### Step 6: Rollback (if needed) (5-10 min)

- **Who:** Suga
- **When:** Any P0 issue detected in production
- **How:**
  1. Immediately identify last known good commit: `git log --oneline -5`
  2. Option A — Fast rollback (if database unchanged): `git revert [bad merge commit]` → push to main → Render auto-deploys
  3. Option B — Emergency reset: `git reset --hard [last good commit]` → force push to main (use only if revert is messy)
  4. Option C — Database rollback: If migrations ran, create a reverse migration or restore from Neon backup
  5. Verify rollback succeeded (API health check, core pages load)
  6. Notify team immediately in group chat with rollback reason and commit hash
- **Output:** Production restored to last known good state

### Exceptions and Edge Cases

| Scenario | What to Do |
|----------|-----------|
| Database migration fails on production | Check Neon migration logs. If partial migration, apply remaining changes manually or restore from backup. Never leave database in half-migrated state. |
| Render build fails | Check build logs. Common causes: missing env vars, Node.js version mismatch, memory limit exceeded. Fix → retry deployment. |
| AI provider down during deploy | Deploy anyway — the circuit breaker will handle fallback. Verify fallback providers are working. |
| Stripe webhook failure | Check Stripe dashboard for failed webhooks. Verify `STRIPE_WEBHOOK_SECRET` is correctly set. Replay failed webhooks if safe. |
| SSL/certificate error | Usually Cloudflare issue. Check certificate status. If urgent, toggle Cloudflare proxy status (orange cloud) to bypass. |
| Deployment during high traffic | Schedule deploys during low-traffic hours (02:00-06:00 UTC). If emergency deploy needed, use canary approach: deploy to 1 instance first. |
| Migration modifies existing data | Always back up production database before any data-modifying migration. Use `pg_dump` or Neon backup. |

### Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Deployment frequency | 2-3x per week | Count merges to main |
| Deployment success rate | > 95% | (Successful deploys / Total deploys) × 100 |
| Mean time to rollback | < 5 minutes | Time from P0 detection to restored service |
| Staging validation pass rate | > 90% | (Staging validations passed / Total staging deploys) × 100 |
| Post-deploy verification time | < 20 minutes | Time from deploy to signed-off verification |
| Downtime per deploy | 0 minutes | Target zero-downtime deploys (Render rolling deploys) |

### Related Documents

- **90-Day Technical Roadmap:** `kimi-group-chat/Rekrut AI/90-Day Technical Roadmap.md`
- **Module and Skills Audit:** `kimi-group-chat/Rekrut AI/Module and Skills Audit.md`
- **Render Blueprint:** `render.yaml` (infrastructure-as-code)
- **Neon Database Docs:** https://neon.tech/docs
- **Render Deploy Docs:** https://render.com/docs/deploy-node-express-app
- **Emergency Contacts:** Ranga (CEO) — decision authority, Suga (CTO) — technical execution, Kimi (COO) — coordination

---

**Notes for the team:**
- This runbook is a living document. If a deployment goes wrong and the runbook didn't cover it, update the runbook.
- When in doubt, roll back first, investigate second. User trust is harder to rebuild than code.
- Every deploy should have an owner. If the deployer is going offline, hand off to someone who can respond to issues.
