# Production Database Strategy

> **Document**: `docs/production-db.md`  
> **Scope**: Neon PostgreSQL (production) + Render PostgreSQL (staging/dev)  
> **Last updated**: 2026-06-09

---

## 1. Migration Strategy

### How migrations run
Migrations execute automatically on every deploy via the `startCommand` in `render.yaml`:

```yaml
startCommand: npm run migrate && npm start
```

This translates to `node migrate.js` before the application starts. Because migrations run inside the service startup sequence, a failed migration will prevent the app from starting (the process exits with code 1).

### Migration engine (`migrate.js`)
- **Custom, lightweight** — no external framework (no Knex, Prisma Migrate, or node-pg-migrate)
- **Tracker table**: `_migrations` stores applied migration names
- **Migration files**: `.js` files in `migrations/` folder, loaded in alphabetical order
- **Transaction safety**: Each migration runs in a `BEGIN ... COMMIT` block; failures trigger `ROLLBACK`
- **Idempotency**: Already-applied migrations are skipped by name lookup in `_migrations`

### Key risk: startup-time migrations
Because migrations block application startup, long-running schema changes (e.g., adding indexes on large tables without `CONCURRENTLY`) will delay health checks and can cause Render deploy timeouts.

> **Rule of thumb**: For large tables, create indexes via `CREATE INDEX CONCURRENTLY` in a manual migration script run outside deploy time, or split the migration into a no-op deploy followed by a background schema change.

### Deployment order (environments)
| Environment | Branch | Database | autoDeploy |
|-------------|--------|----------|------------|
| Production | `main` | Neon (manual `DATABASE_URL`) | ❌ Disabled |
| Staging | `staging` | Render PostgreSQL (`rekrutai-staging-db`) | ✅ Enabled |
| Dev | `dev` | Render PostgreSQL (`rekrutai-dev-db`) | ✅ Enabled |

**Production deploys are manual** (autoDeploy: false), so migrations can be reviewed before running. Staging and dev deploy automatically on push.

---

## 2. Backup Approach

### Neon (production)
Neon manages backups automatically. We rely on its built-in capabilities:

| Feature | Neon Support | Our Status |
|---------|--------------|------------|
| Continuous WAL archiving | ✅ Yes | Active |
| Point-in-time recovery (PITR) | ✅ Yes | Available via Neon console |
| Automated backups | ✅ Yes | Managed by Neon |
| Backup retention | Plan-dependent | Verify in Neon dashboard |

> **Action**: Confirm retention policy in the Neon dashboard (Project → Branches → main → Backup & Restore). Typical retention is 7–30 days depending on plan.

### Manual verification
Run a monthly sanity check to confirm backups are restorable:

```bash
# Schema-only export (lightweight, can run from any terminal)
pg_dump "$DATABASE_URL" --schema-only > /tmp/schema_backup_test.sql

# Spot-check critical tables
pg_dump "$DATABASE_URL" --data-only --table=users --table=jobs > /tmp/critical_data_test.sql
```

If you ever need to restore:
1. Create a new Neon branch from a point-in-time
2. Point staging `DATABASE_URL` at the restored branch
3. Verify data integrity before deciding whether to promote the branch to `main`

### Render PostgreSQL (staging/dev)
Render PostgreSQL includes automated daily backups. These are not production-critical but useful for environment parity.

---

## 3. Connection Pooling

### Current configuration (`lib/db.js`)
```javascript
max: 25                    // Pool size per instance
idleTimeoutMillis: 30000   // Release idle connections after 30s
connectionTimeoutMillis: 10000  // Wait up to 10s for a connection
```

### Neon considerations
- Neon Postgres uses **Neon Proxy** which multiplexes client connections to the compute endpoint
- `max_connections` on Neon: **901** (managed, scales with compute size)
- Our pool size of **25** is safe for a single web instance; well within Neon's limit

### Scaling the pool
| Scenario | Action |
|----------|--------|
| Increase to 2+ web instances | Keep pool at 25 per instance (25 × 4 = 100 still safe) |
| Add background workers / cron jobs | Consider a separate pool or connection string for long-running queries |
| Long-running analytics queries | Use a dedicated read-only connection or Neon read replica |

### Future: PgBouncer or Neon connection pooler
If connection count becomes a concern, Neon offers a built-in connection pooler (PgBouncer-like) that can be enabled in the Neon console. This is **not needed at current scale** but is the next step if:
- Connection count approaches 500+
- Many short-lived serverless functions connect directly

---

## 4. Scaling Plan

### Current state
- **Database size**: 33 MB
- **Tables**: 116
- **Indexes**: ~400
- **Plan**: Render Standard (web) + Neon managed Postgres

### Upgrade triggers
| Signal | Threshold | Action |
|--------|-----------|--------|
| Database size | > 1 GB | Review index bloat; consider `pg_repack` |
| Connection count | > 200 active | Enable Neon connection pooler; add read replica |
| Query latency (p95) | > 200 ms sustained | Enable `pg_stat_statements` (via Neon support); optimize slow queries |
| Storage I/O | High seq_scan ratio | Add missing indexes; VACUUM ANALYZE high-churn tables |
| Traffic growth | 10× users | Upgrade Neon compute; evaluate read replicas for analytics |
| Multi-region need | Latency > 100ms from users | Add Neon read replica in target region |

### Neon compute upgrade path
Neon uses compute units that scale automatically. If you hit sustained CPU or memory limits:
1. Check Neon dashboard → Usage → Compute
2. Upgrade to the next compute tier (e.g., from `ne-Free` to `ne-Standard`)
3. No downtime for compute changes (Neon scales the compute endpoint)

---

## 5. Disaster Recovery Basics

### Recovery scenarios

| Scenario | Recovery approach | RTO | RPO |
|----------|-----------------|-----|-----|
| Accidental data deletion | Neon PITR to a branch before the deletion | ~15 min | Minutes (WAL-level) |
| Schema migration gone wrong | Restore branch from PITR; swap `DATABASE_URL` | ~15 min | Minutes |
| Database corruption | Create new branch from latest healthy PITR | ~15 min | Minutes |
| Full Neon region outage | Restore to a new Neon project in another region (requires manual `pg_dump` + restore) | 1–4 hours | Hours (last manual backup) |
| Total account loss | `pg_dump` monthly to external storage (S3/R2) | 1–4 hours | Up to 30 days |

### Monthly DR checklist
- [ ] Run `pg_dump --schema-only` and verify it completes without errors
- [ ] Verify Neon PITR slider works in the console (create a test branch from yesterday)
- [ ] Check `DATABASE_URL` backup in the password manager (Render env var is the only link)

### Emergency contacts
- **Neon status**: https://neonstatus.com
- **Render status**: https://status.render.com
- **Recovery owner**: On-call engineer (update in runbook if this changes)

---

## 6. Operational Notes

### `VACUUM` and autovacuum
- Neon runs autovacuum automatically
- High-churn tables (`trust_scores`, `omni_scores`, `ai_call_log`) may need manual `VACUUM ANALYZE` if dead-tuple ratio spikes (see `DATABASE_HEALTH_REPORT.md`)
- **Do not run `VACUUM FULL`** — it locks tables exclusively. Use standard `VACUUM ANALYZE`.

### Adding indexes safely
Always use `CREATE INDEX CONCURRENTLY` to avoid table locks:
```sql
CREATE INDEX CONCURRENTLY idx_example ON table_name(column_name);
```

### Schema changes without downtime
1. Deploy backward-compatible schema change (e.g., add nullable column, add index concurrently)
2. Deploy application code that uses the new column
3. Backfill data if needed
4. Deploy final migration to add `NOT NULL` or drop old column

---

## 7. Related Documents

- `docs/DATABASE_HEALTH_REPORT.md` — Index, bloat, and query health audit
- `docs/SCHEMA_IMPROVEMENTS.md` — P0–P3 migration changelog
- `docs/prod-deploy-runbook.md` — Production deployment steps
- `migrate.js` — Migration engine source
- `render.yaml` — Infrastructure configuration
