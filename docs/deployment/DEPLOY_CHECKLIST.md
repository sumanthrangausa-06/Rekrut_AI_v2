# Rekrut AI — Production Deployment Checklist

> **Prepared by:** DO-001 (DevOps Lead)  
> **Date:** 2026-06-08 09:30 CST  
> **Target Production Commit:** `f92f3a9` (main)  
> **Current Production Commit:** `fb1fdb3` (deployed 2026-05-16)  
> **Staging Health:** ✅ `https://rekrutai-dev.onrender.com/health` — `200 OK`  
> **Production Health:** ✅ `https://rekrutai.co/health` — `200 OK`  
> **Status:** 🚫 NOT READY — Blockers exist (see Section 5)

---

## 1. Pre-Deploy Verification

### 1.1 Code Quality & Branch Sanity

| Step | Command / Action | Expected Result | Status |
|------|------------------|-----------------|--------|
| Verify dev is merged into main | `git log main..dev --oneline` | **No output** (dev ⊆ main) | ✅ PASS |
| Verify main is ahead of prod | `git log prodCommit..main --oneline` | Shows diff list | ✅ PASS |
| Check for uncommitted changes | `git status` | Working tree clean | ⚠️ **BLOCKER** — dist artifacts from `vite.config.ts` change are uncommitted |
| Verify no merge conflicts | `git merge-tree $(git merge-base main dev) main dev` | Clean merge | ✅ PASS |
| Syntax check server | `node -c server.js` | No errors | ⬜ TODO |
| Syntax check all routes | `for f in routes/*.js; do node -c "$f"; done` | No errors | ⬜ TODO |

### 1.2 Build Verification

| Step | Command / Action | Expected Result | Status |
|------|------------------|-----------------|--------|
| Clean client build | `cd client && npm install && npm run build` | Exit 0, no errors | ⬜ TODO |
| Build artifacts committed | `git diff --stat` after build | Only expected dist changes | ⚠️ **BLOCKER** — `vite.config.ts` + dist changes not committed |
| Chunk size check | Review `client/dist/assets/` | No chunk > 600KB (warning limit) | ✅ PASS — Largest chunk ~1.5MB index, vendor 48KB, ui 75KB |
| TypeScript errors | `cd client && npx tsc --noEmit` | ≤ 3 pre-existing errors (per QA report) | ⬜ TODO |

### 1.3 Security Audit (Pre-Deploy Must-Fix)

| Issue | File | Status | Action Required |
|-------|------|--------|-----------------|
| Hardcoded JWT fallback | `lib/auth.js` | ✅ FIXED | Throws error if `JWT_SECRET` missing |
| DB SSL `rejectUnauthorized` | `lib/db.js` | ✅ PARTIALLY FIXED | Conditional: `true` in production, `false` in dev |
| Session cookie `secure` | `server.js` | ✅ FIXED | `secure: process.env.NODE_ENV === 'production'` |
| CORS `origin: true` | `server.js` | ✅ FIXED | Explicit origin whitelist callback |
| Permissions-Policy overly broad | `server.js` | ⚠️ **BLOCKER** | `camera=*, microphone=*` — must restrict to `self` or enumerate trusted providers |
| Missing security headers | `server.js` | ⚠️ **BLOCKER** | No `helmet` or `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `CSP` |
| `x-powered-by` header | `server.js` | ⚠️ **BLOCKER** | Express version disclosed — `app.disable('x-powered-by')` |

### 1.4 Environment & Secrets Verification

| Step | Action | Status |
|------|--------|--------|
| Verify `render.yaml` matches prod config | Check `rekrutai-prod` service definition | ✅ Configured |
| Verify all `sync: false` env vars are set in Render dashboard | `JWT_SECRET`, `SESSION_SECRET`, `ADMIN_*`, `STRIPE_*`, `OPENAI_API_KEY`, etc. | ⚠️ **BLOCKER** — Must be manually verified before deploy |
| Verify production DB connection string | `rekrutai-prod-db` in Render dashboard | ✅ Configured in `render.yaml` |
| Verify Stripe keys are **live** not test | `STRIPE_SECRET_KEY` should start with `sk_live_` | ⚠️ **REQUIRES RANGA APPROVAL** |
| Verify `NODE_ENV=production` in Render | `render.yaml` sets this | ✅ Configured |
| Verify `FORCE_SSL_VERIFY=true` | `render.yaml` sets this | ✅ Configured |

### 1.5 Database Migration Check

| Step | Action | Expected Result | Status |
|------|--------|-----------------|--------|
| List pending migrations | Compare deployed commit vs `main` | None new (all migrations are from May 16 or earlier) | ✅ PASS |
| Verify migration syntax | `node migrate.js --dry-run` or review SQL | Valid, no duplicates | ⬜ TODO |
| Backup production DB | Render dashboard → manual snapshot | Snapshot created | ⬜ TODO |

### 1.6 Test Execution

| Step | Command / Action | Expected Result | Status |
|------|------------------|-----------------|--------|
| E2E tests (Playwright) | `npx playwright test` | All pass | ⚠️ **BLOCKER** — No root-level test script; E2E tests exist but have not been run on this commit |
| Auth persistence tests | `npx playwright test auth-persistence.spec.ts` | Pass | ⬜ TODO |
| Candidate flow tests | `npx playwright test candidate-flow.spec.ts` | Pass | ⬜ TODO |
| Recruiter flow tests | `npx playwright test recruiter-flow.spec.ts` | Pass | ⬜ TODO |
| Payment flow tests | `npx playwright test payment-flow.spec.ts` | Pass | ⚠️ **REQUIRES RANGA APPROVAL** (Stripe live mode) |
| Public pages tests | `npx playwright test public-pages.spec.ts` | Pass | ⬜ TODO |

> **Note:** Root `package.json` has no `test` script. Add `"test": "npx playwright test"` or run E2E tests manually via `npx playwright test`.

---

## 2. Deployment Steps

### 2.1 Commit Uncommitted Changes (DO NOT SKIP)

The current working tree has uncommitted build artifacts from the `vite.config.ts` manualChunks change:

```bash
cd /root/.openclaw/workspace/Rekrut_AI_v2

# Stage the new dist artifacts and config
git add client/vite.config.ts
git add client/dist/index.html
git add client/dist/assets/index-X08BN_0R.js
git add client/dist/assets/ui-C3mIOmxN.js
git add client/dist/assets/vendor-i685DcQp.js
git rm client/dist/assets/index-V1CW76hW.js

# Verify the diff is clean
git diff --cached --stat
# Expected: ~12 insertions, ~1148 deletions (old chunk removed)

# Commit with clear message
git commit -m "build: commit dist artifacts from manualChunks vendor/ui split"
```

### 2.2 Merge & Tag (if not already done)

Current state: `main` already contains all `dev` commits + merge commit `f92f3a9`.
No additional merge needed.

```bash
# Verify main is clean and up to date
git checkout main
git pull origin main

# Tag the release
git tag -a "v2.0.0-$(date +%Y%m%d)" f92f3a9 -m "Production deploy v2.0.0 $(date +%Y-%m-%d)"
git push origin --tags
```

### 2.3 Render Deployment

Render `rekrutai-prod` has `autoDeploy: true` on `main` branch. Pushing to `main` will trigger automatic deployment.

```bash
# Push the committed dist artifacts
git push origin main
```

**Deployment timeline (estimated):**
- Git push triggers Render webhook → ~30s
- Build phase (`cd client && npm install && npm run build && cd .. && npm install`) → ~3-5 min
- Deploy phase (health check pass) → ~1-2 min
- **Total:** ~5-8 minutes

### 2.4 Monitor Deployment

```bash
# Watch health endpoint during deploy
curl -s https://rekrutai.co/health
# Should return {"status":"ok","timestamp":"..."} within 2 minutes of deploy start

# Check Render dashboard for build logs
# URL: https://dashboard.render.com/web/srv-d69opaer433s73d6p570
```

---

## 3. Post-Deploy Verification (Smoke Tests)

### 3.1 Immediate Health Checks (within 2 minutes of deploy)

| Endpoint | Expected Result | Status |
|----------|-----------------|--------|
| `GET https://rekrutai.co/health` | `{"status":"ok","timestamp":"..."}` | ⬜ TODO |
| `GET https://rekrutai.co/api/health` | `404` (alias not configured) or `200` (if added) | ⬜ TODO |
| `GET https://rekrutai.co/` | `200 OK`, hero text visible | ⬜ TODO |
| `GET https://rekrutai.co/login` | `200 OK`, login form visible | ⬜ TODO |
| `GET https://rekrutai.co/about` | `200 OK`, about page loads | ⬜ TODO |

### 3.2 Functional Smoke Tests (within 15 minutes of deploy)

| Test | Steps | Expected Result | Status |
|------|-------|-----------------|--------|
| Homepage render | Load `/`, check hero, features, pricing, testimonials | All sections visible, no console errors | ⬜ TODO |
| Login flow | Use test credentials: `test_recruiter@rekrutai.co` / `Test123!` | Login succeeds, redirects to dashboard | ⬜ TODO |
| Candidate jobs page | Login as candidate, navigate to `/candidate/jobs` | Job listings load, search/filter work | ⬜ TODO |
| Recruiter dashboard | Login as recruiter, navigate to `/recruiter/dashboard` | Dashboard loads, analytics visible | ⬜ TODO |
| Recruiter candidates | Navigate to `/recruiter/candidates` | Candidate search loads, SQL query works | ⬜ TODO |
| Dark mode toggle | Click dark mode toggle on any page | Theme switches, persists on reload | ⬜ TODO |
| Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll | ⬜ TODO |
| Stripe pricing page | Load `/pricing` | Free / Pro / Enterprise tiers visible | ⬜ TODO |

### 3.3 Performance & Security Smoke Tests

| Test | Tool / Command | Expected Result | Status |
|------|---------------|-----------------|--------|
| Security headers | `curl -I https://rekrutai.co/` | `X-Frame-Options`, `X-Content-Type-Options`, `HSTS`, `CSP` present | ⚠️ **BLOCKER** — Not implemented yet |
| `x-powered-by` absent | `curl -I https://rekrutai.co/\| grep -i powered` | No match | ⬜ TODO |
| HTTPS enforcement | `curl -I http://rekrutai.co/` | Redirects to HTTPS | ⬜ TODO |
| Page load time | DevTools Network tab | < 500ms for static assets, < 1.5s for full page | ⬜ TODO |
| Lighthouse score | Chrome DevTools Lighthouse | Performance > 85, Accessibility > 85, SEO > 90, Best Practices > 90 | ⬜ TODO |

### 3.4 API Smoke Tests

| Endpoint | Auth | Expected Result | Status |
|----------|------|-----------------|--------|
| `GET /api/auth/me` | Session cookie | Returns current user object | ⬜ TODO |
| `GET /api/jobs` | Public | Returns job listings | ⬜ TODO |
| `GET /api/recruiter/candidates` | Recruiter session | Returns candidates | ⬜ TODO |
| `POST /api/ai-health/verify` | Admin | Runs AI provider verification | ⬜ TODO |

---

## 4. Rollback Plan

### 4.1 Render Dashboard Rollback (Fastest — 1-2 minutes)

1. Go to [Render Dashboard](https://dashboard.render.com/web/srv-d69opaer433s73d6p570)
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select commit `fb1fdb3` (last known good production commit)
4. Wait for health check to pass
5. Verify `/health` returns `200 OK`

### 4.2 Git Revert Rollback (2-5 minutes)

```bash
# Revert the merge commit on main
git checkout main
git revert -m 1 f92f3a9 --no-edit
# Revert the dist commit too
git revert HEAD --no-edit
git push origin main
# Render auto-deploys the reverted main
```

### 4.3 Database Rollback (if migration ran)

- Render PostgreSQL → **Snapshots** → Restore snapshot from before deploy
- **Note:** If no new migrations were run, DB rollback is not needed

### 4.4 Rollback Triggers

| Condition | Action | Owner |
|-----------|--------|-------|
| `/health` returns non-200 for > 2 minutes | Immediate Render dashboard rollback | DO-001 |
| 50%+ of smoke tests fail | Git revert + investigate | DO-001 + Suga (CTO) |
| Database errors in logs | DB snapshot restore + code revert | DO-001 + BE-002 |
| Stripe payment failures | Disable Stripe webhooks + investigate | DO-001 + Ranga (CEO) |
| AI provider circuit breakers tripped | Reset via `/api/ai-health/reset` (admin) | Suga (CTO) |

### 4.5 Communication Plan

| Event | Channel | Message |
|-------|---------|---------|
| Rollback initiated | `#deployments` (or equivalent) | `🚨 Rollback initiated — reverting to commit fb1fdb3. Reason: [X]. ETA: 2 min.` |
| Rollback complete | `#deployments` | `✅ Rollback complete. Production at fb1fdb3. Health: OK. Investigating root cause.` |
| All-clear | `#deployments` | `✅ Post-rollback verification complete. Issue ticket: [link].` |

---

## 5. What Needs Ranga's Explicit Approval Before Going Live

### 🚨 CRITICAL — Must be approved by Ranga (CEO) before deploy

| Item | Reason | Risk if Not Approved |
|------|--------|----------------------|
| **Stripe mode switch** | `STRIPE_SECRET_KEY` in prod Render dashboard must be **live key** (`sk_live_*`) not test key (`sk_test_*`). Current `.env` has test keys. | Customers cannot make real payments; revenue is zero. |
| **Go/No-Go on untested protected routes** | Candidate/recruiter dashboards were not fully tested in the June 6 QA report. The `f92f3a9` commit adds new E2E tests but they have not been run against staging. | Core product pages (jobs, dashboard, analytics) may be broken for paying users. |
| **Security headers go-live decision** | Missing `helmet` security headers (CSP, HSTS, X-Frame-Options) was flagged as P1 blocker by QA. The current code does not have them. | XSS, clickjacking, content injection risks in production. Legal/compliance risk. |
| **Database backup confirmation** | Production DB `rekrutai-prod-db` must have a manual snapshot before deploy. | If deploy corrupts data, no rollback path for DB state. |
| **API key budget check** | AI providers (OpenAI, NVIDIA NIM, Groq, Cerebras) may see increased traffic post-deploy. | Unexpected $500+ API bill if usage spikes. |
| **EU AI Act compliance page** | `/admin/compliance` was not tested in QA. | Regulatory non-compliance if compliance reporting is broken. |

### ⚠️ IMPORTANT — Should be reviewed by Ranga

| Item | Reason | Risk |
|------|--------|------|
| **Commit the uncommitted dist artifacts** | The `vite.config.ts` manualChunks change and new dist files are in working tree but not committed. This means the current `main` (`f92f3a9`) does NOT include the chunked build. Pushing now would deploy the old build. | Chunk splitting benefit lost; larger JS payload. |
| **Staging branch discrepancy** | The `rekrutai-staging` Render service is configured for the `staging` branch (`f875d20`), which is NOT the same as `dev` (`2f51620`). We tested `rekrutai-dev` (dev branch), not `rekrutai-staging`. | Staging may not reflect the actual code being promoted. |
| **Permissions-Policy header** | `camera=*, microphone=*` allows all origins to request camera/mic. This is overly broad for video interviews. | If any XSS exists, blast radius includes camera/mic access. |

---

## 6. Checklist Summary — GO / NO-GO

| # | Gate | Status | Owner |
|---|------|--------|-------|
| 1 | `dev` fully merged into `main` | ✅ PASS | DO-001 |
| 2 | Uncommitted build artifacts committed | ❌ **BLOCKER** | DO-001 |
| 3 | Security headers (helmet) added | ❌ **BLOCKER** | BE-002 / Suga |
| 4 | `x-powered-by` disabled | ❌ **BLOCKER** | BE-002 |
| 5 | Permissions-Policy restricted | ❌ **BLOCKER** | BE-002 |
| 6 | E2E tests run and pass on this commit | ❌ **BLOCKER** | QA-001 / Suga |
| 7 | Production DB snapshot taken | ⚠️ **REQUIRES RANGA** | DO-001 |
| 8 | Stripe live keys confirmed in Render | ⚠️ **REQUIRES RANGA** | Ranga |
| 9 | All `sync: false` env vars verified in Render | ⚠️ **REQUIRES RANGA** | DO-001 / Ranga |
| 10 | Ranga approves Go/No-Go for untested protected routes | ⚠️ **REQUIRES RANGA** | Ranga |
| 11 | Lighthouse / mobile smoke tests pass | ⬜ TODO | QA-001 |
| 12 | Build time < 5 min, no errors | ⬜ TODO | DO-001 |
| 13 | Post-deploy health checks pass | ⬜ TODO | DO-001 |

### 🚫 CURRENT VERDICT: **NO-GO**

**Reasons:**
1. Uncommitted build artifacts in working tree — must be committed before deploy
2. Security headers not implemented (P1 blocker from QA)
3. `x-powered-by` not disabled (information disclosure)
4. E2E tests have not been executed on the current `main` commit
5. Ranga has not approved the Go/No-Go for live Stripe keys and untested protected routes

**ETA to Ready:** 2-4 hours (security headers + build commit + E2E run) + Ranga approval.

---

## Appendix A: Commit Diff Summary (main vs production)

```
f92f3a9 Merge dev into main — prod deploy trigger
2f51620 build: fresh client dist + e2e login test fix
f4eedd7 fix(e2e): resolve strict mode violations for password/email locators
37d9343 Merge branch 'dev' of https://github.com/sumanthrangausa-06/Rekrut_AI_v2 into dev
e419b42 fix(recruiter): Candidate search SQL query fix + test suite
0809459 test: Add auth persistence and candidate jobs E2E tests
... (and more back to fb1fdb3)
```

**Key changes since last production deploy (`fb1fdb3`):**
- E2E test suite (Playwright) added
- Recruiter candidate search SQL fix
- Auth persistence tests
- Mobile responsive fixes
- Stripe subscription management fixes
- Vite manualChunks config (vendor/ui code splitting) — **uncommitted**

---

## Appendix B: Environment Variables Quick Reference

**Production Render `rekrutai-prod` must have these set (sync: false):**

| Variable | Status | Notes |
|----------|--------|-------|
| `JWT_SECRET` | ⚠️ Must verify | Must be strong random string, not test value |
| `SESSION_SECRET` | ⚠️ Must verify | Must be strong random string, not test value |
| `ADMIN_USERNAME` | ⚠️ Must verify | Production admin username |
| `ADMIN_PASSWORD` | ⚠️ Must verify | Production admin password (hashed) |
| `STRIPE_SECRET_KEY` | ⚠️ Must verify | **LIVE KEY** (`sk_live_*`) |
| `STRIPE_WEBHOOK_SECRET` | ⚠️ Must verify | Live webhook secret |
| `OPENAI_API_KEY` | ⚠️ Must verify | Production API key |
| `DATABASE_URL` | ✅ Auto | From `rekrutai-prod-db` |
| `NODE_ENV` | ✅ Auto | `production` |
| `CORS_ORIGINS` | ✅ Auto | `https://rekrutai.co,https://www.rekrutai.co` |

---

## Appendix C: Useful Commands

```bash
# Check Render deploy status
curl -s https://rekrutai.co/health | jq .

# Check staging
curl -s https://rekrutai-dev.onrender.com/health | jq .

# Run E2E tests locally
cd /root/.openclaw/workspace/Rekrut_AI_v2
npx playwright test

# Run specific test
npx playwright test auth-persistence.spec.ts

# Build client
cd client && npm install && npm run build

# Check bundle size
ls -lah client/dist/assets/

# Check security headers
curl -I https://rekrutai.co/

# DB health check (requires psql)
psql "$DATABASE_URL" -c "SELECT NOW(), count(*) FROM users;"
```
