# Database Provider Mismatch Analysis — B6 CRITICAL BLOCKER

> **Status:** ✅ Mismatch confirmed — `.env` uses Neon, `render.yaml` uses Render PostgreSQL  
> **Analysis Date:** 2026-06-08  
> **Analyst:** DevOps Automator (subagent)

---

## 1. Current `.env` DATABASE_URL Provider

**Provider:** **Neon PostgreSQL** (external, managed by Neon)

```
DATABASE_URL=postgresql://neondb_owner:****@ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

- Host ends in `.neon.tech`
- Uses Neon connection pooling (`-pooler` in hostname)
- Region: `us-east-1` (AWS)
- SSL required with channel binding
- **No other DB-related variables** in `.env` (e.g., no `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`)

---

## 2. Current `render.yaml` Database Configuration

**Provider:** **Render PostgreSQL** (managed by Render)

```yaml
# Production web service
- type: web
  name: rekrutai-prod
  envVars:
    - key: DATABASE_URL
      fromDatabase:
        name: rekrutai-prod-db
        property: connectionString

# Render-managed PostgreSQL instance
- type: pserv
  name: rekrutai-prod-db
  env: postgresql
  branch: main
  plan: standard
  ipAllowList: []
```

- Render will provision a **new** PostgreSQL database service named `rekrutai-prod-db`
- Render will **auto-inject** the `DATABASE_URL` environment variable at deploy time
- The production web service will receive the Render database connection string, **not** the Neon one
- Same pattern exists for staging (`rekrutai-staging-db`) and dev (`rekrutai-dev-db`)

---

## 3. The Mismatch

| Aspect | `.env` (local/development) | `render.yaml` (production) |
|--------|---------------------------|----------------------------|
| **Provider** | Neon PostgreSQL | Render PostgreSQL |
| **Host** | `ep-calm-field-aipg6g97-pooler.c-4.us-east-1.aws.neon.tech` | Render-managed (internal hostname) |
| **Connection method** | Hardcoded URL in `.env` | Auto-injected via `fromDatabase` |
| **Database instance** | Single Neon database | Three separate Render databases (prod, staging, dev) |

### 🔴 Critical Implications

1. **Production will use the wrong database**  
   When Render deploys `rekrutai-prod`, it will overwrite any manually-set `DATABASE_URL` with the connection string from `rekrutai-prod-db`. The application will connect to an empty/bare Render database instead of the Neon production database.

2. **Data loss / divergence risk**  
   If migrations run against the Render database while the Neon database holds the real data, the two will diverge. Any writes to the Render DB will be lost when the issue is corrected, or the Neon DB will become stale.

3. **Environment inconsistency**  
   Local development uses Neon, but production (as configured) will use Render. Schema drift, performance differences, and feature gaps between the two providers could cause bugs that only appear in production.

4. **Render `sync: false` secrets are not set**  
   The `render.yaml` marks many secrets (`JWT_SECRET`, `SESSION_SECRET`, `STRIPE_SECRET_KEY`, etc.) as `sync: false` without `generateValue: true`. These must be manually configured in the Render dashboard before the app will function. This is a separate but related deployment risk.

5. **Staging and dev also affected**  
   Both `rekrutai-staging` and `rekrutai-dev` use the same `fromDatabase` pattern, so they will also spin up separate Render databases rather than using Neon.

---

## 4. Recommended Fix

Choose **one** of the following options:

### Option A — Use Neon PostgreSQL for all environments (Recommended if Neon is the intended production DB)

**Goal:** Align all environments with the existing Neon database.

**Actions:**
1. In `render.yaml`, remove the `fromDatabase` blocks for `DATABASE_URL` in all three services (`rekrutai-prod`, `rekrutai-staging`, `rekrutai-dev`).
2. Replace with `sync: false` so the Neon `DATABASE_URL` can be manually set in the Render dashboard for each environment:
   ```yaml
   - key: DATABASE_URL
     sync: false
   ```
3. Manually configure the Neon `DATABASE_URL` in the Render dashboard for each environment (prod, staging, dev). Consider using separate Neon databases or branches for each environment.
4. Remove the unused `pserv` database definitions from `render.yaml` (or keep them if they serve a purpose, but they will not be used by the app).

**Pros:**
- Keeps the existing Neon database as the single source of truth.
- Aligns production with the current `.env` configuration.
- Avoids migrating data from Neon to Render.

**Cons:**
- Requires manual secret management in Render dashboard.
- Loses Render’s built-in database backup/restore UI (must rely on Neon’s tooling).

---

### Option B — Use Render PostgreSQL for all environments (Recommended if Render is the intended platform)

**Goal:** Migrate fully to Render-managed PostgreSQL.

**Actions:**
1. Keep the current `render.yaml` `fromDatabase` configuration as-is.
2. Migrate the existing data from Neon to the Render production database (`rekrutai-prod-db`). This will require a `pg_dump` from Neon and `pg_restore` to Render after the first Render DB is provisioned.
3. Update the local `.env` to use the Render database connection string for development (or set up a dedicated dev database on Render).
4. Ensure the Neon database is decommissioned or archived after migration to avoid ongoing costs and confusion.

**Pros:**
- Full platform alignment (Render web + Render DB).
- Native Render database management (backups, scaling, logs in one UI).
- No manual `DATABASE_URL` secret management in Render.

**Cons:**
- Requires a data migration from Neon to Render.
- Downtime risk during the cutover.
- Neon features (e.g., branching, serverless scaling) are lost if not replicated on Render.

---

## 5. Immediate Next Steps (Regardless of Option)

1. **Decide which database is the source of truth** — Neon or Render.
2. **Do NOT deploy the current `render.yaml` to production** until the mismatch is resolved. The current configuration will spin up empty Render databases and disconnect the app from the real Neon data.
3. **Audit other secrets** — `render.yaml` has `sync: false` for many critical secrets without `generateValue: true`. These must be set manually in the Render dashboard before any deployment will work.
4. **Document the chosen configuration** in the project README and team wiki so the mismatch does not recur.

---

*Report generated by DevOps Automator (subagent)*
*File: `/root/.openclaw/workspace/Rekrut_AI_v2/db-provider-analysis.md`*
