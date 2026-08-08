# Rollback Runbook

> **Document**: `docs/rollback-runbook.md`  
> **Scope**: Rekrut AI — Render deployment rollback and database recovery  
> **Last updated**: 2026-08-08  
> **Issue**: [#46](https://github.com/rekrutai/rekrut-ai/issues/46) — Backup & DR verification and documentation

---

## 1. When to Use This Runbook

Use this runbook when:

- A production deployment introduces bugs, errors, or degraded performance
- A schema migration fails and prevents the application from starting
- Critical business functionality is broken after a release
- You need to revert to a previously known-good state

**Do NOT use this runbook for**:
- Infrastructure outages (see [`disaster-recovery.md`](./disaster-recovery.md))
- Database corruption or accidental data deletion (see DR plan Section 4.2)
- Security incidents (see `docs/security-runbook.md`)

---

## 2. Quick Decision Tree

```
Deployment broke something?
│
├─ Is the app still running but buggy?
│  └─ YES → Roll back application code (Section 3)
│
├─ Is the app failing to start due to a bad migration?
│  └─ YES → Roll back database + application (Section 4)
│
├─ Is data corrupted or accidentally deleted?
│  └─ YES → PITR recovery (disaster-recovery.md Section 4.2)
│
└─ Is this a critical security vulnerability?
   └─ YES → Security incident response (security-runbook.md)
```

---

## 3. Application Rollback (Render)

### 3.1 Method 1: Render Dashboard (Fastest — Recommended)

Render can reuse build artifacts from recent deploys, so rollbacks complete much faster than building from scratch.

1. **Open Render Dashboard** → `rekrutai-prod` service → **Events** page
2. **Find the last known good deploy** in the event list
3. **Click "Rollback"** next to that deploy
4. **Confirm** on the dialog — click "Rollback to this deploy"
5. Render starts a new deploy using the target deploy's build artifact

> ✅ **Dashboard rollbacks automatically disable auto-deploys** to prevent new commits from overwriting the rollback.

6. **Verify the rollback succeeded**:
   ```bash
   curl -s https://rekrutai.co/health
   # Expected: {"status":"ok",...}
   ```

7. **Monitor for 10 minutes**:
   - Check Render logs for errors
   - Verify error rates in your monitoring (if configured)
   - Confirm user-facing features work

8. **Re-enable auto-deploys** after the issue is fixed:
   - Render Dashboard → `rekrutai-prod` → **Settings** → Auto-Deploy → **On**

### 3.2 Method 2: Render API

Use this for automated or scripted rollbacks.

```bash
# Configuration
RENDER_API_KEY="<your-render-api-key>"
SERVICE_ID="srv-d69opaer433s73d6p570"  # rekrutai-prod

# Step 1: List recent deploys to find the good one
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SERVICE_ID/deploys?limit=10" | jq '.[] | {id, status, commit: .deploy.source.commit.id, created_at}'

# Step 2: Roll back to a specific deploy
DEPLOY_ID="<deploy-id-from-step-1>"

curl -s -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/$SERVICE_ID/deploys/$DEPLOY_ID/rollback"
```

> ⚠️ **API rollbacks do NOT disable auto-deploys automatically.** You must follow up:

```bash
# Disable auto-deploys to prevent new commits from overwriting the rollback
curl -s -X PATCH \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"autoDeploy":"no"}' \
  "https://api.render.com/v1/services/$SERVICE_ID"
```

> **After the fix is merged**: Re-enable auto-deploys:
> ```bash
> curl -s -X PATCH \
>   -H "Authorization: Bearer $RENDER_API_KEY" \
>   -H "Content-Type: application/json" \
>   -d '{"autoDeploy":"yes"}' \
>   "https://api.render.com/v1/services/$SERVICE_ID"
> ```

### 3.3 Method 3: Deploy a Specific Commit via GitHub Actions

If you know the exact commit SHA that was good:

1. **Push the good commit to a hotfix branch** (if not already on `main`):
   ```bash
   git checkout -b hotfix/rollback-$(date +%Y%m%d)
   git reset --hard <good-commit-sha>
   git push -u origin hotfix/rollback-$(date +%Y%m%d)
   ```

2. **Fast-forward `main` to the good commit** (only if team agrees):
   ```bash
   git checkout main
   git reset --hard <good-commit-sha>
   git push origin main --force-with-lease
   ```
   > ⚠️ Force-push to `main` is destructive. Prefer the Render Dashboard rollback unless you are certain.

3. **Trigger the deploy workflow** (if autoDeploy is enabled) or use Render Dashboard → Manual Deploy → Deploy specific commit.

### 3.4 Method 4: Render CLI (if installed)

```bash
# Install Render CLI if not already available
# npm install -g @render/cli

# Interactive rollback
render deploys create srv-d69opaer433s73d6p570 --commit <good-commit-sha>

# Note: This does NOT disable auto-deploys. Follow up with:
render services update srv-d69opaer433s73d6p570 --auto-deploy false
```

> ⚠️ **The Render platform CLI may not be installed in this environment.** The Render API (Method 2) is the preferred programmatic approach.

---

## 4. Database Rollback (Failed Migration)

### 4.1 Determine if Migration Is Reversible

Check the failed migration in `migrations/`:

```bash
# View the last few migrations
ls -la migrations/ | tail -10

# Read the failing migration
cat migrations/<timestamp>_<name>.js
```

**If the migration has a clear reverse operation** (e.g., `DROP TABLE` → reverse is re-create, `ADD COLUMN` → reverse is `DROP COLUMN`):
- Create a rollback migration (Section 4.2)

**If the migration destroyed data or the reverse is unsafe**:
- Use PITR recovery instead (see [`disaster-recovery.md`](./disaster-recovery.md) Section 4.2)

### 4.2 Create a Rollback Migration

Migrations in this project are custom JavaScript files run by `migrate.js`. Each migration runs in a transaction.

1. **Create a new rollback migration** with a timestamp **later** than the bad one:
   ```bash
   TIMESTAMP=$(date +%Y%m%d%H%M%S)
   cat > migrations/${TIMESTAMP}_rollback_<name>.js << 'EOF'
   async function up(client) {
     // Reverse the bad migration here
     await client.query(`DROP TABLE IF EXISTS new_table_created_by_bad_migration`);
     // Or: ALTER TABLE ... DROP COLUMN ...
   }

   module.exports = { up };
   EOF
   ```

2. **Test the rollback migration locally**:
   ```bash
   DATABASE_URL=postgresql://test:test@localhost:5432/rekrutai_test npm run migrate
   ```

3. **Push to main and deploy** (the CI/CD pipeline will run the migration on startup):
   ```bash
   git add migrations/
   git commit -m "fix: rollback migration for <bad-migration-name>"
   git push origin main
   ```

4. **Monitor the deploy** in Render Dashboard → Events

### 4.3 Manual Database Intervention (Emergency Only)

If the app cannot start and you need to unblock immediately:

```bash
# Step 1: Connect to Neon database directly
psql "$DATABASE_URL"

# Step 2: Check the _migrations table to see what was applied
SELECT * FROM _migrations ORDER BY applied_at DESC LIMIT 5;

# Step 3: If safe, manually remove the bad migration record
# (This tells migrate.js to re-run it next time — only if you have a fixed version)
DELETE FROM _migrations WHERE name = '<bad-migration-name>';

# Step 4: If the migration partially applied, clean up manually
# Example: DROP partially created tables, remove bad constraints, etc.
# ⚠️ This is risky — only do this if you fully understand the migration

# Step 5: Deploy the fixed migration
```

> ⚠️ **Warning**: Manual database changes bypass migration tracking. Document any manual changes and follow up with a proper migration.

---

## 5. Post-Rollback Checklist

After any rollback, complete this checklist:

- [ ] Application health check passes: `curl https://rekrutai.co/health`
- [ ] Render service status shows "Live" in Dashboard
- [ ] No error spikes in Render logs (check last 30 minutes)
- [ ] Database connectivity confirmed (no connection pool exhaustion)
- [ ] Critical user flows tested (login, job posting, application submission)
- [ ] If Stripe webhooks are involved, verify webhook event processing
- [ ] Notify team in Slack/chat that rollback is complete
- [ ] Create a follow-up task to fix the root cause
- [ ] Re-enable auto-deploys only after the fix is merged and tested on staging

---

## 6. Rollback Configuration Reference

### What Render Preserves During Rollback

| Configuration | Behavior during rollback |
|---------------|-------------------------|
| Build artifact | ✅ Reuses target deploy's artifact (fast) |
| Start command | ✅ From target deploy |
| Environment variables | ✅ From target deploy |
| Instance count | ✅ From target deploy |
| Health check path | ✅ From target deploy |
| Disks | ❌ Not rolled back (retains current state) |
| Instance type | ❌ Uses current configuration |
| Custom domains | ❌ Uses current configuration |

### Build Artifact Retention

Render retains a fixed number of recent build artifacts per service based on your plan. You can only roll back to deploys whose artifacts are still available.

> **Action**: If you need to roll back further than Render retains, you must rebuild from a specific commit (slower).

---

## 7. Environment-Specific Rollback Notes

### Production (`rekrutai-prod`)

- `autoDeploy: false` — deploys are manual or triggered by GitHub Actions
- `DATABASE_URL` is manually configured (not synced from `render.yaml`)
- Rollback via Dashboard is fastest; API rollback requires disabling auto-deploys manually
- **Always verify health checks after rollback**

### Staging (`rekrutai-staging`)

- `autoDeploy: true` — push to `staging` branch auto-deploys
- Rollback is less critical; can also reset `staging` branch to a good commit
- Useful for testing rollback procedures before production

### Dev (`rekrutai-dev`)

- `autoDeploy: true` — push to `dev` branch auto-deploys
- Database is Render-managed PostgreSQL (`rekrutai-dev-db`)
- Lowest risk environment — acceptable to break and fix quickly

---

## 8. Automation Opportunities

The following could be automated to reduce rollback time:

1. **Automated health-check gate after deploy** — Fail deploy if `/health` doesn't return 200 within 5 minutes
2. **Auto-rollback on health check failure** — If post-deploy health checks fail, automatically trigger rollback to previous deploy
3. **Database migration dry-run** — Run migrations against a staging clone before production deploy
4. **Canary deployment** — Deploy to a subset of traffic first (requires multiple Render instances)

> **Status**: Not currently implemented. Consider for future infrastructure improvements.

---

## 9. Related Documents

- [`docs/disaster-recovery.md`](./disaster-recovery.md) — Full DR plan and PITR recovery
- [`docs/deployment/prod-deploy-runbook.md`](./deployment/prod-deploy-runbook.md) — Production deployment procedures
- [`docs/guides/production-db.md`](./guides/production-db.md) — Database strategy
- [`render.yaml`](../render.yaml) — Infrastructure configuration
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — Deploy pipeline

---

## 10. Verification Log

| Date | Verification Type | Result | Verified By |
|------|------------------|--------|-------------|
| 2026-08-08 | Document created | N/A | DevOps Automator |
| — | Render Dashboard rollback test | **PENDING** | Requires manual execution on staging |
| — | Render API rollback test | **PENDING** | Requires `RENDER_API_KEY` |
| — | Rollback migration test | **PENDING** | Test on staging environment |

> **Next action**: Test the Render Dashboard rollback on the staging environment during the next maintenance window. Record results here.
