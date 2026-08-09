# Disaster Recovery Plan

> **Document**: `docs/disaster-recovery.md`  
> **Scope**: Rekrut AI — Neon PostgreSQL (production) + Render web services  
> **Last updated**: 2026-08-08  
> **Issue**: [#46](https://github.com/rekrutai/rekrut-ai/issues/46) — Backup & DR verification and documentation

---

## 1. Overview

This document defines the disaster recovery (DR) strategy for Rekrut AI. It covers backup schedules, recovery objectives, escalation procedures, and step-by-step recovery instructions.

**Environments**

| Environment | Branch | Database | Platform | autoDeploy |
|-------------|--------|----------|----------|------------|
| Production | `main` | Neon PostgreSQL | Render Web Service (`rekrutai-prod`) | ❌ Disabled |
| Staging | `staging` | Render PostgreSQL (`rekrutai-staging-db`) | Render Web Service (`rekrutai-staging`) | ✅ Enabled |
| Dev | `dev` | Render PostgreSQL (`rekrutai-dev-db`) | Render Web Service (`rekrutai-dev`) | ✅ Enabled |

---

## 2. Recovery Objectives

### RTO (Recovery Time Objective)

**Target: < 1 hour**

RTO is the maximum acceptable time between a service disruption and the restoration of service to users.

| Scenario | Expected RTO | Notes |
|----------|-------------|-------|
| Application rollback (bad deploy) | 5–15 min | Render reuses build artifacts; no rebuild needed |
| Database point-in-time recovery (PITR) | 15–45 min | Create Neon branch from PITR → verify → swap `DATABASE_URL` |
| Full Render service failure | 15–30 min | Redeploy via GitHub Actions or Render Dashboard |
| Neon region outage | 1–4 hours | Requires `pg_dump` to new region or Neon project migration |
| Total account loss | 2–4 hours | Restore from external `pg_dump` backup + redeploy |

### RPO (Recovery Point Objective)

**Target: < 1 hour**

RPO is the maximum acceptable amount of data loss measured in time.

| Scenario | Expected RPO | Notes |
|----------|-------------|-------|
| Neon PITR (point-in-time recovery) | Minutes | Continuous WAL archiving; recover to any point in retention window |
| Render PostgreSQL (staging/dev) | Up to 24 hours | Automated daily backups by Render |
| External `pg_dump` (monthly) | Up to 30 days | Manual monthly backup to external storage |

---

## 3. Backup Schedule & Configuration

### 3.1 Neon (Production Database)

Neon manages backups automatically through its storage-layer architecture:

| Feature | Status | Details |
|---------|--------|---------|
| Continuous WAL archiving | ✅ Active | Built into Neon storage layer |
| Point-in-time recovery (PITR) | ✅ Available | Via Neon console or CLI |
| Automated backups | ✅ Managed by Neon | No manual scheduling required |
| Backup retention | Plan-dependent | 6 hours (Free) → up to 30 days (Scale) |

> **Action required**: Verify your Neon plan and retention window in the Neon dashboard:
> Project → Branches → `main` → Backup & Restore

#### Default Neon Backup Behavior

- Neon captures **every write** via WAL (Write-Ahead Log) archiving
- PITR allows restoring to **any point in time** within the retention window
- No traditional "snapshot" schedule — recovery is continuous
- Branching from a point in time is the recovery mechanism (does not duplicate storage cost)

### 3.2 Render PostgreSQL (Staging / Dev)

Render provides automated daily backups for PostgreSQL services:

| Feature | Status | Details |
|---------|--------|---------|
| Automated backups | ✅ Active | Daily snapshots managed by Render |
| Backup retention | Plan-dependent | Check Render dashboard for current retention |
| Manual backup | Available | Can trigger from Render dashboard |

### 3.3 Manual External Backup (Recommended)

For defense against total Neon account loss, run a monthly `pg_dump` to external storage:

```bash
# Schema-only export (lightweight, verify structure)
pg_dump "$DATABASE_URL" --schema-only > /tmp/rekrutai_schema_$(date +%Y%m%d).sql

# Full data export (store in S3/R2 — run monthly)
pg_dump "$DATABASE_URL" > /tmp/rekrutai_full_$(date +%Y%m%d).sql

# Upload to R2 (if configured)
# aws s3 cp /tmp/rekrutai_full_$(date +%Y%m%d).sql s3://rekrutai-backups/monthly/
```

---

## 4. Disaster Recovery Procedures

### 4.1 Scenario: Bad Deployment (Application Rollback)

See [`docs/rollback-runbook.md`](./rollback-runbook.md) for detailed deployment rollback steps.

Quick summary:
1. Identify the last known good deploy in Render Dashboard → Events
2. Click **Rollback** on the good deploy
3. Verify `/health` endpoint returns 200
4. Monitor error rates and logs

### 4.2 Scenario: Accidental Data Deletion / Corruption

**Goal**: Restore database to a point before the incident with minimal data loss.

```bash
# Step 1: Identify the incident timestamp (e.g., 5 minutes before deletion)
INCIDENT_TIME="2026-08-08T09:30:00Z"

# Step 2: Create a new Neon branch from PITR (via CLI or Dashboard)
# Option A: Neon CLI (if installed and authenticated)
neonctl branches create --project-id <PROJECT_ID> \
  --name recovery-$(date +%s) \
  --parent main \
  --from-timestamp "$INCIDENT_TIME"

# Option B: Neon Dashboard
# Project → Branches → New Branch → Select point in time from slider

# Step 3: Verify recovered data on the new branch
# Update local/staging DATABASE_URL to point at the recovery branch
# Run health checks and spot-check critical tables

# Step 4: Swap production DATABASE_URL to the recovery branch
# Render Dashboard → rekrutai-prod → Environment → Edit DATABASE_URL
# Set to the recovery branch's connection string

# Step 5: Verify production health
# curl -s https://rekrutai.co/health
# Check logs: Render Dashboard → rekrutai-prod → Logs

# Step 6: Once stable, optionally promote the recovery branch to main
# Neon Dashboard → recovery branch → Promote to main
```

> ⚠️ **Important**: The `DATABASE_URL` in Render must be updated manually. It is marked `sync: false` in `render.yaml` and is NOT auto-deployed from the repo.

### 4.3 Scenario: Schema Migration Gone Wrong

A failed migration blocks application startup (migrations run in the start command).

```bash
# Step 1: Check Render logs to confirm migration failure
# Render Dashboard → rekrutai-prod → Logs

# Step 2: If the migration is irreversible, restore from PITR
# Follow Section 4.2 (Accidental Data Deletion)

# Step 3: If the migration is reversible, create a rollback migration
# Add a new .js file in migrations/ that undoes the change
# Name it with a later timestamp than the bad migration

# Step 4: Deploy the rollback migration
# Push to main → trigger GitHub Actions deploy workflow
# Or manually deploy via Render Dashboard

# Step 5: After recovery, fix the migration and test on staging first
```

### 4.4 Scenario: Full Neon Region Outage

Neon region outages are rare but possible.

```bash
# Step 1: Check Neon status: https://neonstatus.com
# Step 2: Check Render status: https://status.render.com

# Step 3: If Neon confirms regional outage, create a new Neon project
# in a different region (if available on your plan)

# Step 4: Restore from the most recent external pg_dump
pg_restore -d "$NEW_DATABASE_URL" /backups/rekrutai_full_YYYYMMDD.sql

# Step 5: Update Render production DATABASE_URL to the new project
# Render Dashboard → rekrutai-prod → Environment → Edit DATABASE_URL

# Step 6: Verify application health
# curl -s https://rekrutai.co/health
```

> ⚠️ **Note**: This scenario may exceed the 1-hour RTO target because it depends on the age of the last external backup. Consider automating daily `pg_dump` to R2 to improve RPO.

### 4.5 Scenario: Total Account Loss (Neon or Render)

```bash
# Step 1: Create new Neon project + new Render service
# Step 2: Restore database from external backup
pg_restore -d "$NEW_DATABASE_URL" /backups/rekrutai_full_YYYYMMDD.sql

# Step 3: Reconfigure all environment variables in Render
# See docs/deployment/render-env-vars.md for variable list
# Also see Section 5.2 below for env var export procedure

# Step 4: Redeploy application
# Push to main or trigger manual deploy via Render Dashboard

# Step 5: Verify DNS, SSL, and all integrations (Stripe, Google, LinkedIn)
```

---

## 5. Operational Procedures

### 5.1 Monthly DR Checklist

Run these checks on the first Monday of each month:

- [ ] Run `pg_dump --schema-only` and confirm it completes without errors
- [ ] Verify Neon PITR slider works in the console (create a test branch from yesterday)
- [ ] Verify Render staging backup exists and is restorable (check Render dashboard)
- [ ] Confirm `DATABASE_URL` and critical secrets are backed up in the team's password manager
- [ ] Review and rotate any secrets older than 90 days
- [ ] Verify the on-call engineer contact in this runbook is current

### 5.2 Environment Variable Export (Render)

To back up or migrate Render environment variables:

**Via Render Dashboard (manual)**
1. Go to Render Dashboard → Service → Environment
2. Copy each variable to a secure location (password manager)

**Via Render API (requires `RENDER_API_KEY`)**

```bash
# List all environment variables for a service
SERVICE_ID="srv-d69opaer433s73d6p570"  # rekrutai-prod

curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SERVICE_ID/env-vars" | jq .
```

**⚠️ Manual follow-up required**: No automated credential backup exists. The person with Render dashboard access should export env vars to the team's password manager quarterly.

### 5.3 Backup Verification (Automated or Manual)

Since Neon backups are managed by Neon and have not been verified:

**Recommended**: Schedule a monthly verification drill:

```bash
# 1. Create a verification branch from 24 hours ago
neonctl branches create --project-id <PROJECT_ID> \
  --name verify-backup-$(date +%Y%m%d) \
  --parent main \
  --from "$(date -d '24 hours ago' -u +%Y-%m-%dT%H:%M:%SZ)"

# 2. Connect and run row-count sanity checks
psql "$VERIFICATION_DATABASE_URL" -c "
  SELECT 'users' as table, COUNT(*) as rows FROM users
  UNION ALL
  SELECT 'jobs', COUNT(*) FROM jobs
  UNION ALL
  SELECT 'applications', COUNT(*) FROM applications;
"

# 3. Drop the verification branch
neonctl branches delete --project-id <PROJECT_ID> \
  --name verify-backup-$(date +%Y%m%d)
```

> ⚠️ **Manual follow-up required**: The above verification requires Neon CLI access and `neonctl` authentication. Run this drill monthly and record results in a shared log.

---

## 6. Roles & Responsibilities

| Role | Responsibility | Contact |
|------|---------------|---------|
| **On-call Engineer** | First responder for all DR events; executes recovery procedures | See team on-call rotation |
| **Team Lead** | Approves PITR recovery that results in data loss > 15 minutes; communicates with stakeholders | — |
| **Infrastructure Owner** | Maintains this DR plan; runs monthly verification drills; manages Neon/Render access | — |
| **Security Owner** | Manages secrets rotation; ensures env var backups in password manager | — |

---

## 7. Escalation Path

1. **P0 (Service down, data loss imminent)** → On-call engineer responds within 15 min
2. **P1 (Degraded service, recoverable without data loss)** → On-call engineer responds within 1 hour
3. **P2 (Minor issue, workarounds exist)** → Address during business hours

**Communication channels**
- Internal alerts: Render service notifications + health check monitoring
- Status page: https://status.render.com (Render), https://neonstatus.com (Neon)
- Customer communication: Post to status page or customer Slack if applicable

---

## 8. Related Documents

- [`docs/rollback-runbook.md`](./rollback-runbook.md) — Deployment rollback procedures
- [`docs/deployment/render-env-vars.md`](./deployment/render-env-vars.md) — Environment variable reference
- [`docs/guides/production-db.md`](./guides/production-db.md) — Database strategy and scaling plan
- [`render.yaml`](../render.yaml) — Infrastructure configuration
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — Production deployment pipeline

---

## 9. Verification Log

| Date | Verification Type | Result | Verified By |
|------|------------------|--------|-------------|
| 2026-08-08 | Document created | N/A | DevOps Automator |
| — | Neon PITR branch creation | **PENDING** | Requires manual execution |
| — | Render env var export | **PENDING** | Requires manual execution |
| — | Monthly pg_dump verification | **PENDING** | Requires manual execution |

> **Next action**: Person with Neon dashboard access should run the monthly verification drill and update this log.
