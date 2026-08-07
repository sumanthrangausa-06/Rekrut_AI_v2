# Rekrut AI v2 — Production Deployment Checklist

> **Prepared by:** DevOps Automator (subagent)  
> **Date:** 2026-06-09 00:28 CST  
> **Current Commit (dev):** `1e0944b` — fix(migrations): resolve duplicate prefixes 003, 005, 045; fix(render.yaml): add migration automation to startCommand  
> **Current Commit (main):** `7f56e99` — security: remove .admin-credentials plaintext file, enforce env-only admin auth  
> **Status:** 🔴 **NOT READY — Critical blockers found**

---

## 1. Pre-Deploy Verification Results

### 1.1 Environment Health

| Environment | URL | Health | Status | Notes |
|-------------|-----|--------|--------|-------|
| **Development / Staging** | `https://rekrutai-dev.onrender.com` | ✅ `{"status":"ok"}` | **PASS** | Healthy, timestamp 2026-06-08T16:24:55Z |
| **Production** | `https://rekrutai.co` | ✅ `{"status":"ok"}` | **PASS** | Running older code (not current `dev`/`main`) |

### 1.2 Build Pipeline Verification

| # | Check | Command | Status | Notes |
|---|-------|---------|--------|-------|
| 1.2.1 | Client build | `npm run build --prefix client` | ✅ **PASS** | Exit 0, built in 32.87s. Warning: 1 chunk ~1.57MB (index) |
| 1.2.2 | Client install | `npm install --include=dev` (client/) | ✅ **PASS** | 143 packages, 0 vulnerabilities |
| 1.2.3 | Root audit | `npm audit --audit-level moderate` | ✅ **PASS** | **0 vulnerabilities** |
| 1.2.4 | Client audit | `npm audit` (client/) | ✅ **PASS** | **0 vulnerabilities** |
| 1.2.5 | Server syntax | `node -c server.js` | ✅ **PASS** | No syntax errors |
| 1.2.6 | Routes syntax | `for f in routes/*.js; do node -c "$f"; done` | ✅ **PASS** | All route files valid |

### 1.3 Code & Branch Status

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1.3.1 | Current branch | ⚠️ **WARNING** | On `dev` branch. Production deploys from `main` |
| 1.3.2 | `dev` vs `main` divergence | 🔴 **BLOCKER** | `dev` is **16 commits ahead** of `main`. `main` is **5 commits ahead** of `dev`. Branches have **diverged** |
| 1.3.3 | Uncommitted changes | ⚠️ **WARNING** | `dev` has uncommitted changes: `client/dist/`, `client/src/pages/admin/compliance.tsx`, `e2e/*.spec.ts` |
| 1.3.4 | `main` render.yaml | 🔴 **BLOCKER** | `main` branch `startCommand` is `npm start` **WITHOUT** `npm run migrate` |
| 1.3.5 | `dev` render.yaml | ✅ **PASS** | `startCommand: npm run migrate && npm start` — correct |

---

## 2. Critical Blockers (Must Resolve Before Deploy)

### 🔴 B1 — Branch Divergence: `main` and `dev` are out of sync

**Problem:** `main` and `dev` have diverged. `dev` has 16 commits not on `main`, including critical fixes (migration prefix deduplication, render.yaml migration automation). `main` has 5 commits not on `dev`.

**Impact:** Deploying `main` to production would miss:
- Migration prefix fixes (duplicate 003, 005, 045)
- Automatic migration execution on startup
- EU AI Act compliance types
- E2E test improvements
- Mobile UI fixes
- Admin login CSRF double-submit pattern

**Fix Required:**
```bash
# Merge dev into main (or rebase main onto dev)
git checkout main
git merge dev
# Resolve any conflicts
git push origin main
```

**Owner:** Suga (CTO) / DevOps  
**ETA:** 30–60 min

---

### 🔴 B2 — `main` render.yaml Missing Migration Automation

**Problem:** `main` branch `render.yaml` has:
```yaml
startCommand: npm start
```
It should be:
```yaml
startCommand: npm run migrate && npm start
```

**Impact:** If deployed to production without this fix, **database migrations will NOT run automatically**. If any new migrations exist between last prod deploy and current code, the app will fail or behave inconsistently.

**Fix Required:** Ensure the merge from `dev` to `main` includes commit `1e0944b` which fixes this.

**Owner:** DevOps  
**ETA:** Included in B1 fix

---

### 🔴 B3 — Uncommitted Changes on `dev` Branch

**Problem:** Working tree on `dev` has uncommitted changes:
- `client/dist/assets/index-BqCqTyUH.js` (deleted)
- `client/dist/index.html` (modified)
- `client/dist/assets/index-CT5d3glb.js` (untracked)
- `client/src/pages/admin/compliance.tsx` (modified)
- `e2e/candidate-full-journey.spec.ts` (modified)
- `e2e/recruiter-critical-flow.spec.ts` (modified)

**Impact:** These changes may represent unfinished work or test artifacts. Should be committed or discarded before merge to `main`.

**Fix Required:**
```bash
git add -A  # OR selectively stage
git commit -m "chore: commit pre-deploy changes"
# Then merge to main
```

**Owner:** DevOps + Suga  
**ETA:** 15 min

---

### 🔴 B4 — `.env.example` Missing Many Production Variables

**Problem:** `.env.example` is missing 40+ variables that are required/specified in `render.yaml`. New developers or deployments won't know these variables exist.

**Missing from `.env.example`:**
- `REKRUT_AI_URL`, `APP_URL`, `FRONTEND_URL`, `BASE_URL`, `CORS_ORIGINS`
- `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `OPENAI_BASE_URL`, `OPENAI_DAILY_TOKEN_BUDGET`
- All `NIM_*` model configuration variables (24+ variables)
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL`
- `EMAIL_RATE_LIMIT`, `EMAIL_RATE_LIMIT_HOUR`, `EMAIL_RETRY_ATTEMPTS`, `EMAIL_RETRY_DELAY`
- `SMTP_SECURE`, `SMTP_FROM`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`
- `FORCE_SSL_VERIFY`

**Fix Required:** Update `.env.example` to include all variables from `render.yaml` with placeholder comments.

**Owner:** DevOps  
**ETA:** 30 min

---

## 3. Environment Variables Documentation

### 3.1 Auto-Set by Render (No Manual Action)

| Variable | Production Value | Source |
|----------|-----------------|--------|
| `NODE_ENV` | `production` | `render.yaml` |
| `PORT` | `10000` | `render.yaml` |
| `DATABASE_URL` | Auto-generated | `rekrutai-prod-db` connection string |
| `REKRUT_AI_URL` | `https://rekrutai.co` | `render.yaml` |
| `APP_URL` | `https://rekrutai.co` | `render.yaml` |
| `FRONTEND_URL` | `https://rekrutai.co` | `render.yaml` |
| `BASE_URL` | `https://rekrutai.co` | `render.yaml` |
| `CORS_ORIGINS` | `https://rekrutai.co,https://www.rekrutai.co` | `render.yaml` |
| `FORCE_SSL_VERIFY` | `true` | `render.yaml` |

### 3.2 Must Be Set in Render Dashboard (`sync: false`)

| Variable | Required | Status | Notes |
|----------|----------|--------|-------|
| `JWT_SECRET` | ✅ Required | ⚠️ VERIFY | Must be ≥32 char random string. App throws if missing. |
| `SESSION_SECRET` | ✅ Required | ⚠️ VERIFY | Must be ≥32 char random string. App throws if missing. |
| `ADMIN_USERNAME` | ✅ Required | ⚠️ VERIFY | Production admin username |
| `ADMIN_PASSWORD` | ✅ Required | ⚠️ VERIFY | Production admin password (strong, hashed) |
| `STRIPE_SECRET_KEY` | ✅ Required | ⚠️ VERIFY | Must be `sk_live_*` for production revenue |
| `STRIPE_PUBLISHABLE_KEY` | ✅ Required | ⚠️ VERIFY | Must be `pk_live_*` for production checkout |
| `STRIPE_WEBHOOK_SECRET` | ✅ Required | ⚠️ VERIFY | Must match live webhook endpoint in Stripe Dashboard |
| `POLSIA_API_KEY` | ✅ Required | ⚠️ VERIFY | Primary AI proxy key |
| `POLSIA_API_URL` | ✅ Required | ✅ OK | `https://polsia.com/api/proxy/ai` |
| `OPENAI_API_KEY` | ⚠️ Recommended | ⚠️ VERIFY | Fallback AI provider |
| `OPENAI_BASE_URL` | ⚠️ Optional | ⚠️ VERIFY | Custom proxy if needed |
| `OPENAI_DAILY_TOKEN_BUDGET` | ⚠️ Optional | ⚠️ VERIFY | Cost control |
| `NVIDIA_NIM_API_KEY` | ⚠️ Recommended | ⚠️ VERIFY | Fallback AI provider |
| `NIM_BASE_URL` | ⚠️ Recommended | ⚠️ VERIFY | `https://integrate.api.nvidia.com/v1` |
| `NIM_LLM_MODEL` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_LLM_LLAMA_8B` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_LLM_LLAMA_70B` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_LLM_GEMMA` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_LLM_GPT_OSS` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_LLM_NANO_30B` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_LLM_STEP_FLASH` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_LLM_ULTRA` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_REASONING_QWQ` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_SAFETY_MODEL` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_SAFETY_REASONING` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_VISION_GEMMA` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_VISION_FALLBACK_MODEL` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_EMBED_MODEL` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_EMBED_VL` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_DOCUMENT_MODEL` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_ASR_MODEL` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_ASR_V3` | ⚠️ Optional | ⚠️ VERIFY | Model config |
| `NIM_TTS_BASE_URL` | ⚠️ Optional | ⚠️ VERIFY | Audio service URL |
| `NIM_FASTPITCH_BASE_URL` | ⚠️ Optional | ⚠️ VERIFY | Audio service URL |
| `NIM_MAGPIE_ZERO_BASE_URL` | ⚠️ Optional | ⚠️ VERIFY | Audio service URL |
| `NIM_MAGPIE_FLOW_BASE_URL` | ⚠️ Optional | ⚠️ VERIFY | Audio service URL |
| `NIM_MAGPIE_MULTI_BASE_URL` | ⚠️ Optional | ⚠️ VERIFY | Audio service URL |
| `GROQ_API_KEY` | ⚠️ Recommended | ⚠️ VERIFY | Fast fallback AI provider |
| `CEREBRAS_API_KEY` | ⚠️ Optional | ⚠️ VERIFY | Enterprise fallback |
| `DEEPGRAM_API_KEY` | ⚠️ Recommended | ⚠️ VERIFY | Required for TTS/STT features |
| `R2_ACCESS_KEY_ID` | ⚠️ Optional | ⚠️ VERIFY | Cloudflare R2 storage |
| `R2_SECRET_ACCESS_KEY` | ⚠️ Optional | ⚠️ VERIFY | Cloudflare R2 storage |
| `R2_BUCKET_NAME` | ⚠️ Optional | ⚠️ VERIFY | Cloudflare R2 storage |
| `R2_ENDPOINT` | ⚠️ Optional | ⚠️ VERIFY | Cloudflare R2 storage |
| `R2_PUBLIC_URL` | ⚠️ Optional | ⚠️ VERIFY | Cloudflare R2 public CDN |
| `EMAIL_HOST` | ⚠️ Recommended | ⚠️ VERIFY | SMTP server |
| `EMAIL_PORT` | ⚠️ Recommended | ⚠️ VERIFY | SMTP port |
| `EMAIL_USER` | ⚠️ Recommended | ⚠️ VERIFY | SMTP username |
| `EMAIL_PASS` | ⚠️ Recommended | ⚠️ VERIFY | SMTP password |
| `EMAIL_FROM_ADDRESS` | ⚠️ Recommended | ⚠️ VERIFY | From address for emails |
| `EMAIL_FROM_NAME` | ⚠️ Recommended | ⚠️ VERIFY | From name for emails |
| `EMAIL_RATE_LIMIT` | ⚠️ Optional | ⚠️ VERIFY | Rate limit per minute |
| `EMAIL_RATE_LIMIT_HOUR` | ⚠️ Optional | ⚠️ VERIFY | Rate limit per hour |
| `EMAIL_RETRY_ATTEMPTS` | ⚠️ Optional | ⚠️ VERIFY | Retry count |
| `EMAIL_RETRY_DELAY` | ⚠️ Optional | ⚠️ VERIFY | Retry delay (ms) |
| `SMTP_HOST` | ⚠️ Optional | ⚠️ VERIFY | Alternative SMTP |
| `SMTP_PORT` | ⚠️ Optional | ⚠️ VERIFY | Alternative SMTP |
| `SMTP_USER` | ⚠️ Optional | ⚠️ VERIFY | Alternative SMTP |
| `SMTP_PASS` | ⚠️ Optional | ⚠️ VERIFY | Alternative SMTP |
| `SMTP_SECURE` | ⚠️ Optional | ⚠️ VERIFY | TLS setting |
| `SMTP_FROM` | ⚠️ Optional | ⚠️ VERIFY | Alternative from address |
| `GOOGLE_CLIENT_ID` | ⚠️ Recommended | ⚠️ VERIFY | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | ⚠️ Recommended | ⚠️ VERIFY | Google OAuth |
| `GOOGLE_REDIRECT_URI` | ⚠️ Recommended | ⚠️ VERIFY | Google OAuth callback |
| `LINKEDIN_CLIENT_ID` | ⚠️ Recommended | ⚠️ VERIFY | LinkedIn OAuth |
| `LINKEDIN_CLIENT_SECRET` | ⚠️ Recommended | ⚠️ VERIFY | LinkedIn OAuth |
| `LINKEDIN_REDIRECT_URI` | ⚠️ Recommended | ⚠️ VERIFY | LinkedIn OAuth callback |

---

## 4. Database Migration Status

### 4.1 Migration Inventory

| Check | Status | Details |
|-------|--------|---------|
| Total migration files | 56 | `001_add_omniscore.js` through `051` + prefix fixes |
| Duplicate prefix fix | ✅ Fixed in `dev` | Commit `1e0944b` resolved duplicate 003, 005, 045 prefixes |
| `main` branch status | 🔴 **BEHIND** | `main` does NOT have the duplicate prefix fix or migration automation |
| Dev DB connectivity | ✅ Verified | Neon PostgreSQL connected, 84 users in dev database |
| Production DB | ⚠️ Not verified | Must verify connectivity and schema before deploy |

### 4.2 Pre-Deploy Database Steps

| # | Step | Owner | Status |
|---|------|-------|--------|
| 4.2.1 | Merge migration fixes to `main` | DevOps + Suga | 🔴 **TODO** |
| 4.2.2 | Take manual snapshot of `rekrutai-prod-db` | DevOps | ⬜ **TODO** |
| 4.2.3 | Verify `startCommand` includes `npm run migrate` | DevOps | 🔴 **TODO** (fix in `main`) |
| 4.2.4 | Run `node migrate.js --dry-run` on staging | BE / DevOps | ⬜ **TODO** |
| 4.2.5 | Confirm no destructive migrations (DROP TABLE, etc.) | DevOps | ⬜ **TODO** |
| 4.2.6 | Document snapshot ID for rollback | DevOps | ⬜ **TODO** |

---

## 5. Rollback Plan

### 5.1 Fast Rollback (Render Dashboard) — 1–2 minutes

1. Go to [Render Dashboard](https://dashboard.render.com) → `rekrutai-prod`
2. Click **"Manual Deploy"** → **"Deploy a specific commit"**
3. Select last known good commit (document before deploy)
4. Wait for health check to pass
5. Verify `curl -s https://rekrutai.co/health` returns `{"status":"ok"}`

### 5.2 Git Revert Rollback — 2–5 minutes

```bash
# Revert to the last known good commit
git checkout main
git revert -m 1 <bad-commit> --no-edit
git push origin main
# Render auto-deploys the reverted main
```

### 5.3 Database Rollback (if data corruption) — 10–15 minutes

1. Render Dashboard → `rekrutai-prod-db` → **Snapshots**
2. Select pre-deploy snapshot (taken in step 4.2.2)
3. Click **Restore**
4. Wait for restore (5–10 minutes)
5. Restart `rekrutai-prod` service

### 5.4 Rollback Triggers

| Condition | Action | Owner | ETA |
|-----------|--------|-------|-----|
| `/health` returns non-200 for > 2 minutes | Immediate Render dashboard rollback | DevOps | 1–2 min |
| 50%+ of smoke tests fail | Git revert + investigate | DevOps + CTO | 2–5 min |
| Database errors in logs | DB snapshot restore + code revert | DevOps + Backend | 10–15 min |
| Stripe payment failures | Disable Stripe webhooks + investigate | DevOps + CEO | 5–10 min |
| AI provider circuit breakers tripped | Reset via admin endpoint | CTO | 2–5 min |

---

## 6. Post-Deploy Verification Steps

### 6.1 Health & Availability (Within 2 Minutes)

| # | Test | Expected Result | Command |
|---|------|-----------------|---------|
| 6.1.1 | Health endpoint | `{"status":"ok"}` | `curl -s https://rekrutai.co/health \| jq .` |
| 6.1.2 | API health | `{"status":"ok"}` | `curl -s https://rekrutai.co/api/health \| jq .` |
| 6.1.3 | Homepage | 200 OK | `curl -I https://rekrutai.co/` |
| 6.1.4 | Login page | 200 OK | `curl -I https://rekrutai.co/login` |

### 6.2 Security Headers (Within 5 Minutes)

| # | Header | Expected Value | Command |
|---|--------|----------------|---------|
| 6.2.1 | `content-security-policy` | Present (from helmet) | `curl -I https://rekrutai.co/ \| grep -i csp` |
| 6.2.2 | `strict-transport-security` | `max-age=31536000` | `curl -I https://rekrutai.co/ \| grep -i hsts` |
| 6.2.3 | `x-content-type-options` | `nosniff` | `curl -I https://rekrutai.co/ \| grep -i x-content` |
| 6.2.4 | `x-frame-options` | `SAMEORIGIN` or `DENY` | `curl -I https://rekrutai.co/ \| grep -i x-frame` |
| 6.2.5 | `x-powered-by` | **ABSENT** | `curl -I https://rekrutai.co/ \| grep -i x-powered` |
| 6.2.6 | `permissions-policy` | `camera=(self), microphone=(self)` | `curl -I https://rekrutai.co/ \| grep -i permissions` |

### 6.3 Functional Smoke Tests (Within 15 Minutes)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 6.3.1 | Homepage render | Load `/`, check hero, features, pricing | All sections visible, no console errors |
| 6.3.2 | Login flow | Use test credentials | Login succeeds, redirects to dashboard |
| 6.3.3 | Candidate jobs | Navigate to `/candidate/jobs` | Job listings load, search works |
| 6.3.4 | Recruiter dashboard | Navigate to `/recruiter/dashboard` | Dashboard loads, analytics visible |
| 6.3.5 | Dark mode toggle | Click toggle on any page | Theme switches, persists on reload |
| 6.3.6 | Mobile responsive | Emulate iPhone 14 in DevTools | Layout adapts, no horizontal scroll |
| 6.3.7 | Stripe pricing | Load `/pricing` | Free / Pro / Enterprise tiers visible |
| 6.3.8 | API endpoints | `GET /api/jobs`, `GET /api/auth/me` | Returns expected data |
| 6.3.9 | Admin compliance | Load `/admin/compliance` | EU AI Act compliance page loads |

---

## 7. Deployment Execution Plan

> ⚠️ **DO NOT EXECUTE UNTIL ALL BLOCKERS ARE RESOLVED**

### 7.1 Pre-Flight (Day Before Deploy)

| # | Step | Owner | Status |
|---|------|-------|--------|
| 7.1.1 | Commit all uncommitted changes on `dev` | DevOps | 🔴 **TODO** |
| 7.1.2 | Merge `dev` into `main` (resolve diverged branches) | Suga + DevOps | 🔴 **TODO** |
| 7.1.3 | Verify `main` render.yaml has `npm run migrate && npm start` | DevOps | 🔴 **TODO** |
| 7.1.4 | Update `.env.example` with all missing variables | DevOps | 🔴 **TODO** |
| 7.1.5 | Tag release: `git tag -a v2.0.1-20260609 <main-commit>` | DevOps | ⬜ **TODO** |
| 7.1.6 | Push tag to origin | DevOps | ⬜ **TODO** |
| 7.1.7 | Take production DB snapshot | DevOps | ⬜ **TODO** |
| 7.1.8 | Verify all `sync: false` env vars in Render Dashboard | DevOps + CEO | ⬜ **TODO** |
| 7.1.9 | Run full E2E suite against merged `main` | QA | ⬜ **TODO** |
| 7.1.10 | CEO approves Go/No-Go | CEO | ⬜ **TODO** |

### 7.2 Deploy Day (Execute in Sequence)

| # | Step | Command / Action | ETA | Owner |
|---|------|------------------|-----|-------|
| 7.2.1 | Push `main` to origin | `git push origin main` | 30s | DevOps |
| 7.2.2 | Trigger Render deploy (autoDeploy is `false` for prod) | Manual deploy in Render Dashboard | 1 min | DevOps |
| 7.2.3 | Monitor Render build | Dashboard logs | 3–5 min | DevOps |
| 7.2.4 | Wait for health check | `curl -s https://rekrutai.co/health` | 1–2 min | DevOps |
| 7.2.5 | Run Section 6 smoke tests | See above | 15 min | QA / DevOps |
| 7.2.6 | Monitor error logs | Render Dashboard → Logs | Ongoing | DevOps |

### 7.3 Build Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Push → Render trigger | ~30s | Manual deploy required (autoDeploy: false) |
| Build phase | ~3–5 min | Client build + server install |
| Deploy + health check | ~1–2 min | `/health` must return 200 |
| **Total** | **~5–8 min** | |

---

## 8. Important Warnings (Resolve Before Deploy if Possible)

| # | Warning | Impact | Owner | ETA |
|---|---------|--------|-------|-----|
| W1 | Client build chunk size ~1.57MB | Slow initial page load on mobile | Frontend | 4–8 hours (code splitting) |
| W2 | `.env.example` missing 40+ variables | Developer onboarding / deployment confusion | DevOps | 30 min |
| W3 | `autoDeploy: false` on production | Requires manual deploy trigger (intentional safety) | DevOps | N/A — by design |
| W4 | `numInstances: 1` on production | No redundancy if instance fails | DevOps | Consider upgrading to 2 post-launch |
| W5 | No `test` script in root `package.json` | E2E tests not easily discoverable | DevOps | 5 min |

---

## 9. Go / No-Go Verdict

### 🚫 CURRENT VERDICT: **NO-GO**

**Primary reasons:**

1. **B1 — Branch divergence:** `main` and `dev` are out of sync. `dev` has 16 commits (including critical migration fixes) not on `main`. Merging is required before any production deployment.
2. **B2 — `main` missing migration automation:** `main` branch `render.yaml` has `startCommand: npm start` without `npm run migrate`. Database migrations will not run on production startup.
3. **B3 — Uncommitted changes on `dev`:** Working tree has uncommitted changes that should be committed before merging to `main`.
4. **B4 — `.env.example` incomplete:** Missing 40+ environment variables that are specified in `render.yaml`.

### 📋 Path to Go

| Step | Owner | Estimated Time | Cumulative ETA |
|------|-------|----------------|----------------|
| Commit uncommitted changes on `dev` | DevOps | 15 min | 15 min |
| Update `.env.example` with all variables | DevOps | 30 min | 45 min |
| Merge `dev` into `main` (resolve diverged branches) | Suga + DevOps | 30–60 min | 1.5–2 hours |
| Verify `main` render.yaml has `npm run migrate` | DevOps | 5 min | 1.5–2 hours |
| Tag release and push | DevOps | 5 min | 1.5–2 hours |
| Take production DB snapshot | DevOps | 15 min | 1.5–2 hours |
| Run E2E tests against merged `main` | QA | 2–4 hours | 4–6 hours |
| CEO Go/No-Go approval | CEO | 30 min | 4–6 hours |
| **Execute deploy** | DevOps | 5–8 min | **4–6 hours total** |

---

## 10. Appendix: Useful Commands

```bash
# Check environment health
curl -s https://rekrutai-dev.onrender.com/health | jq .
curl -s https://rekrutai.co/health | jq .

# Check security headers
curl -I https://rekrutai.co/

# Build client
cd /root/.openclaw/workspace/Rekrut_AI_v2
npm run build --prefix client

# Check bundle size
ls -lah client/dist/assets/

# Security audit
npm audit --audit-level moderate

# Check server syntax
node -c server.js
for f in routes/*.js; do node -c "$f"; done

# DB health check
psql "$DATABASE_URL" -c "SELECT NOW(), count(*) FROM users;"

# Git status
git status
git log --oneline -5
git log --oneline main..dev
git log --oneline dev..main

# Check diff between main and dev
git diff --name-only main dev
```

---

## 11. Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-09 | v2.0 | DevOps Automator | Fresh checklist based on current state: verified build, audit, staging health, branch divergence, and render.yaml migration gap |

---

*This checklist is a living document. Update it as blockers are resolved and new issues are discovered.*
