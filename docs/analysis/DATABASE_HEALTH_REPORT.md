# Database Health Report - Rekrut AI

**Generated**: 2026-06-09 01:47 GMT+8  
**Database**: PostgreSQL (Neon Managed)  
**Database Size**: 33 MB (35,086,336 bytes)  
**XID Age**: 1,361,511 (safe — well below wraparound limit of 2 billion)  
**Total Tables**: 116  
**Total Indexes**: ~400+  
**Connection Pool**: max 25, idleTimeout 30s, connectionTimeout 10s  
**Slow Query Threshold**: 200ms

---

## 1. Executive Summary

The database is **functionally healthy** with no critical operational issues. However, there are **several optimization opportunities** that can improve performance, reduce storage overhead, and prevent future degradation. No schema changes were made during this audit.

**Overall Grade: B+** — Good operational health, moderate optimization debt.

---

## 2. Connection Pool Analysis

### Current Settings

```javascript
// From lib/db.js
max: 25                    // Maximum pool size
idleTimeoutMillis: 30000  // Idle timeout: 30 seconds
connectionTimeoutMillis: 10000  // Connection timeout: 10 seconds
SLOW_THRESHOLD_MS: 200     // Slow query threshold: 200ms
```

### Assessment

| Setting | Value | Assessment |
|---------|-------|------------|
| max | 25 | ✅ **Appropriate** for current load (1 active connection observed) |
| idleTimeoutMillis | 30,000ms | ✅ **Good** — prevents connection leaks |
| connectionTimeoutMillis | 10,000ms | ✅ **Adequate** |
| SLOW_THRESHOLD_MS | 200ms | ✅ **Reasonable** for web application |
| SSL | rejectUnauthorized: true | ✅ **Secure** in production |

### Recommendations
- **No changes needed** for current scale. Monitor `queriesPerMinute` and active connection count as user base grows.
- Consider adding **statement_timeout** at the database level (e.g., `30s`) to prevent runaway queries.
- **Enable pg_stat_statements** if Neon allows it (requires `shared_preload_libraries` change) for deeper query analysis.

---

## 3. Query Performance Analysis

### Slow Query Detection

| Metric | Value | Status |
|--------|-------|--------|
| pg_stat_statements | Not available | ⚠️ **Cannot analyze historical slow queries** |
| Long-running queries (>1 min) | 0 | ✅ None detected |
| Active lock waits | 0 | ✅ None detected |
| Slow queries (app-level) | Tracked by `lib/db.js` | ✅ Monitoring in place |

### Critical Finding: Missing `pg_stat_statements`

The `pg_stat_statements` extension is **not available** on this Neon instance. This is the most powerful tool for identifying slow queries. Without it, we rely on application-level monitoring (the `slowQueries` counter in `lib/db.js`).

**Recommendation**: Contact Neon support to enable `pg_stat_statements` if available on your plan, or upgrade to a plan that supports it.

---

## 4. Index Analysis

### Index Summary

- **Total indexed tables**: 116
- **Total index count**: ~400+
- **Index-to-table ratio**: ~3.4:1 (healthy)

### Top 10 Most Used Indexes (by scans)

| Table | Index | Scans | Tuples Read | Tuples Fetched | Size |
|-------|-------|-------|-------------|----------------|------|
| ai_provider_verification | ai_provider_verification_provider_key_modality_key | 17,501 | 36,762 | 17,489 | 16 kB |
| users | users_pkey | 17,254 | 17,294 | 17,258 | 16 kB |
| job_applications | idx_job_applications_job | 13,718 | 1,248 | 33 | 16 kB |
| ai_call_log | idx_ai_call_log_created | 11,648 | 1,505,898 | 1,451,842 | 208 kB |
| user_sessions | IDX_user_sessions_expire | 8,135 | 11,527 | 5,820 | 16 kB |
| job_analytics | idx_job_analytics_job | 5,795 | 5,790 | 621 | 16 kB |
| job_applications | idx_job_applications_company_id | 4,597 | 6,002 | 0 | 16 kB |
| ai_token_budget_daily | ai_token_budget_daily_date_key | 2,787 | 7,166 | 7,166 | 16 kB |
| interviews | idx_interviews_user_id | 2,660 | 0 | 0 | 8 kB |
| omni_scores | idx_omni_scores_user_unique | 2,246 | 216 | 215 | 16 kB |

### Critical Finding: Missing Index

**Table**: `ai_verification_meta`  
**Problem**: 2,750 sequential scans, 0 index scans, 2,084,293 tuples read  
**Impact**: Every query on this table performs a full table scan  
**Recommendation**: Add index on the most frequently queried column(s). Example:

```sql
-- Analyze query patterns first, then add appropriate index
CREATE INDEX CONCURRENTLY idx_ai_verification_meta_key ON ai_verification_meta(key_column);
```

### Unused Indexes (32 indexes with 0 scans)

These indexes consume storage and slow down writes without providing read benefits:

| Table | Index | Size | Recommendation |
|-------|-------|------|----------------|
| candidate_embeddings | idx_candidate_embeddings_vector | 1,616 kB | ⚠️ **Keep** — vector indexes may be used by pgvector ANN queries (not tracked by pg_stat_user_indexes) |
| job_embeddings | idx_job_embeddings_vector | 1,608 kB | ⚠️ **Keep** — same reason as above |
| ai_call_log | ai_call_log_pkey | 208 kB | ✅ **Keep** — PK required for data integrity |
| events | idx_events_session | 152 kB | 🔴 **Consider dropping** — verify no queries use session filtering |
| ai_call_log | idx_ai_call_log_module | 128 kB | 🔴 **Consider dropping** |
| ai_call_log | idx_ai_call_log_modality | 120 kB | 🔴 **Consider dropping** |
| ai_call_log | idx_ai_call_log_success | 112 kB | 🔴 **Consider dropping** |
| activity_log | activity_log_pkey | 104 kB | ✅ **Keep** — PK required |
| events | events_pkey | 104 kB | ✅ **Keep** — PK required |
| activity_log | idx_activity_log_category | 64 kB | 🔴 **Consider dropping** |
| activity_log | idx_activity_log_event_type | 64 kB | 🔴 **Consider dropping** |
| ai_verification_meta | ai_verification_meta_pkey | 56 kB | ✅ **Keep** — PK required |
| events | idx_events_user | 56 kB | 🔴 **Consider dropping** |
| assessment_events | idx_assessment_events_session | 16 kB | 🔴 **Consider dropping** |
| password_reset_tokens | password_reset_tokens_token_key | 16 kB | ⚠️ **Keep** — unique constraint for token lookup |
| practice_sessions | practice_sessions_pkey | 16 kB | ✅ **Keep** — PK required |
| notification_templates | notification_templates_pkey | 16 kB | ✅ **Keep** — PK required |
| password_reset_tokens | idx_password_reset_tokens_expires_at | 16 kB | 🔴 **Consider dropping** — if no TTL cleanup query |
| assessment_events | assessment_events_pkey | 16 kB | ✅ **Keep** — PK required |
| candidate_embeddings | idx_candidate_embeddings_user | 16 kB | 🔴 **Consider dropping** — if user_id is covered by other indexes |
| notification_logs | idx_notification_logs_email | 16 kB | 🔴 **Consider dropping** |
| notification_logs | idx_notification_logs_user_id | 16 kB | 🔴 **Consider dropping** |
| candidate_profiles | candidate_profiles_pkey | 16 kB | ✅ **Keep** — PK required |
| notification_logs | idx_notification_logs_type | 16 kB | 🔴 **Consider dropping** |
| work_experience | work_experience_pkey | 16 kB | ✅ **Keep** — PK required |
| notification_logs | idx_notification_logs_status | 16 kB | 🔴 **Consider dropping** |
| education | education_pkey | 16 kB | ✅ **Keep** — PK required |
| notification_logs | idx_notification_logs_created_at | 16 kB | 🔴 **Consider dropping** |
| trust_scores | trust_scores_company_id_key | 16 kB | 🔴 **Consider dropping** — if no unique constraint needed |
| score_history | score_history_pkey | 16 kB | ✅ **Keep** — PK required |

**Estimated reclaimable space**: ~1,200 kB (non-essential indexes)  
**Note**: `pg_stat_user_indexes` does not track GiST/IVFFlat/HNSW index usage for pgvector ANN queries. The embedding vector indexes may be actively used for similarity search even with 0 scans reported.

---

## 5. Foreign Keys Without Indexes

Foreign keys without indexes cause **full table scans on the child table** when the parent row is updated or deleted. This is a critical performance issue at scale.

| Table | Column | References | Risk Level |
|-------|--------|------------|------------|
| job_application_screenings | screened_by | users(id) | 🔴 **High** |
| notification_logs | template_id | notification_templates(id) | 🟡 **Medium** |
| notification_queue | user_id | users(id) | 🟡 **Medium** |
| notification_queue | template_id | notification_templates(id) | 🟡 **Medium** |
| offer_templates | company_id | users(id) | 🟡 **Medium** |
| screening_logs | job_id | jobs(id) | 🟡 **Medium** |
| screening_logs | candidate_id | users(id) | 🟡 **Medium** |

**Recommended fixes**:

```sql
-- Add these indexes concurrently (no table locks)
CREATE INDEX CONCURRENTLY idx_job_application_screenings_screened_by ON job_application_screenings(screened_by);
CREATE INDEX CONCURRENTLY idx_notification_logs_template_id ON notification_logs(template_id);
CREATE INDEX CONCURRENTLY idx_notification_queue_user_id ON notification_queue(user_id);
CREATE INDEX CONCURRENTLY idx_notification_queue_template_id ON notification_queue(template_id);
CREATE INDEX CONCURRENTLY idx_offer_templates_company_id ON offer_templates(company_id);
CREATE INDEX CONCURRENTLY idx_screening_logs_job_id ON screening_logs(job_id);
CREATE INDEX CONCURRENTLY idx_screening_logs_candidate_id ON screening_logs(candidate_id);
```

---

## 6. Table Bloat & Vacuum Analysis

### Overall Assessment

| Metric | Status |
|--------|--------|
| Autovacuum enabled | ✅ Yes (confirmed running) |
| Autoanalyze enabled | ✅ Yes |
| Tables with vacuum issues | 🔴 3 critical, 🟡 2 moderate |

### Critical Tables (High Dead Tuple Ratio)

| Table | Live Tuples | Dead Tuples | Dead Ratio | Last Autovacuum | Action |
|-------|-------------|-------------|------------|-----------------|--------|
| **trust_scores** | 3 | 40 | **1,333%** | Never | 🔴 **CRITICAL** — Manual vacuum required |
| **omni_scores** | 5 | 34 | **680%** | Never | 🔴 **CRITICAL** — Manual vacuum required |
| ai_provider_verification | 12 | 14 | 117% | 2026-06-08 17:31 | 🟡 **Autovacuum working** |
| refresh_tokens | 428 | 91 | 21% | 2026-06-08 01:42 | 🟡 **Monitor** |
| job_analytics | 116 | 16 | 14% | Never | 🟡 **Manual vacuum recommended** |

### Tables with Zero Rows but Non-Zero Indexes (Empty Tables)

Several tables have 0 rows but maintain indexes (e.g., `interview_evaluations`, `interview_composite_scores`, `mutual_matches`, `document_verifications`, `job_recommendations`, `match_results`, `candidate_feedback`, `data_requests`). These are **not harmful** but indicate features that may not yet be actively used in production.

### Vacuum Commands to Run

```sql
-- Critical: High dead tuple ratio
VACUUM ANALYZE trust_scores;
VACUUM ANALYZE omni_scores;
VACUUM ANALYZE job_analytics;
VACUUM ANALYZE refresh_tokens;
VACUUM ANALYZE parsed_resumes;
VACUUM ANALYZE password_reset_tokens;
VACUUM ANALYZE notification_templates;
```

**Note on Neon**: `VACUUM FULL` is **not recommended** as it requires exclusive table locks. Use standard `VACUUM ANALYZE` which is non-blocking.

---

## 7. Schema Review & Optimization Opportunities

### Database Configuration (Neon-Managed)

| Parameter | Value | Assessment |
|-----------|-------|------------|
| max_connections | 901 | ✅ Managed by Neon |
| shared_buffers | 230 MB (29,440 × 8KB) | ✅ Adequate for 33MB database |
| work_mem | 4 MB (4,096 KB) | ✅ Standard |
| maintenance_work_mem | 64 MB | ✅ Adequate |
| effective_cache_size | 6.5 GB (838,784 × 8KB) | ✅ Aggressive — good for SSD |
| random_page_cost | 4.0 | ✅ Standard for SSD |
| effective_io_concurrency | 20 | ✅ Good for SSD/Neon |

### Schema Observations

1. **Every table has a PRIMARY KEY** — ✅ Excellent practice
2. **Comprehensive CHECK constraints** — ✅ Good data integrity
3. **Foreign key coverage** — ✅ Well-constrained schema
4. **UNIQUE constraints properly indexed** — ✅ PostgreSQL handles this automatically

### Potential Optimizations

#### A. Add `updated_at` Triggers (if missing)

Many tables have `created_at` but check if `updated_at` is auto-managed. Common pattern:

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables with updated_at
-- (Check each table individually before applying)
```

#### B. Partitioning Candidates (Future Scale)

For a 33MB database, partitioning is **not needed yet**. However, as data grows, consider:

- `ai_call_log` — partition by `created_at` (range, monthly)
- `activity_log` — partition by `created_at` (range, monthly)
- `events` — partition by `created_at` (range, monthly)
- `audit_logs` — partition by `created_at` (range, monthly)

#### C. JSON Column Indexing

Several tables appear to store JSON data. If queries filter on JSON fields, add GIN indexes:

```sql
-- Example (verify columns first)
CREATE INDEX CONCURRENTLY idx_table_json_column ON table_name USING GIN (json_column);
```

---

## 8. Backup Verification

### Status

| Check | Status | Notes |
|-------|--------|-------|
| Neon Automated Backups | ✅ **Managed by Neon** | Point-in-time recovery (PITR) available |
| Manual backup verification | ⚠️ **Cannot verify from here** | Requires Neon console or `pg_dump` test |
| Backup frequency | ✅ Continuous (WAL archiving) | Neon default |
| Backup retention | ✅ Based on Neon plan | Verify in Neon dashboard |

### Recommendation

Run a periodic backup verification by restoring to a staging environment:

```bash
# Example: Monthly backup test restore
pg_dump "$DATABASE_URL" --schema-only > schema_backup_test.sql
pg_dump "$DATABASE_URL" --data-only --table=users > users_data_test.sql
# Restore to staging and verify
```

**Action item**: Set a calendar reminder to verify backup integrity monthly.

---

## 9. Critical Issues Summary

| Priority | Issue | Impact | Recommended Action |
|----------|-------|--------|-------------------|
| 🔴 **P0** | `trust_scores` dead ratio 1,333% | Table bloat, slow queries | `VACUUM ANALYZE trust_scores;` |
| 🔴 **P0** | `omni_scores` dead ratio 680% | Table bloat, slow queries | `VACUUM ANALYZE omni_scores;` |
| 🔴 **P1** | 7 foreign keys without indexes | DELETE/UPDATE on parent tables will be slow | Add 7 indexes concurrently |
| 🟡 **P2** | `ai_verification_meta` missing index | 2,750 sequential scans | Add index on query columns |
| 🟡 **P2** | 22+ unused indexes | Write overhead, storage waste | Review and drop safe indexes |
| 🟡 **P2** | `pg_stat_statements` unavailable | Cannot identify slow queries | Enable via Neon or use app-level monitoring |
| 🟢 **P3** | Several empty tables with indexes | Minor storage waste | Monitor for feature adoption |
| 🟢 **P3** | No `updated_at` automation | Stale timestamps | Add triggers if needed |

---

## 10. Recommended Next Steps

1. **Immediate (this week)**:
   - Run `VACUUM ANALYZE` on `trust_scores` and `omni_scores`
   - Add the 7 missing FK indexes using `CREATE INDEX CONCURRENTLY`

2. **Short-term (next 2 weeks)**:
   - Add index to `ai_verification_meta` after identifying query patterns
   - Review and drop confirmed unused indexes (non-PK, non-unique)
   - Request `pg_stat_statements` from Neon support

3. **Medium-term (next month)**:
   - Set up automated `VACUUM ANALYZE` for high-churn tables
   - Implement backup verification procedure
   - Review and add `updated_at` triggers if missing

4. **Long-term (as scale grows)**:
   - Consider partitioning for `ai_call_log`, `activity_log`, `events`
   - Evaluate read replicas if query load increases
   - Tune `shared_buffers` and `work_mem` based on actual workload

---

## 11. Appendix: Index Details

### Total Index Count per Table

```
screening_sessions: 11 indexes
onboarding_plans: 7 indexes
onboarding_documents: 7 indexes
communications: 8 indexes
offers: 8 indexes
job_applications: 6 indexes
interview_composite_scores: 6 indexes
interview_evaluations: 6 indexes
notification_logs: 6 indexes
scheduled_interviews: 6 indexes
mutual_matches: 6 indexes
saved_jobs: 5 indexes
question_bank: 5 indexes
onboarding_tasks: 5 indexes
practice_sessions: 4 indexes
assessment_sessions: 4 indexes
onboarding_chats: 4 indexes
screening_answers: 5 indexes
sequence_enrollments: 5 indexes
skill_assessments: 4 indexes
omniscore_results: 4 indexes
omni_scores: 3 indexes
... (see full JSON output for complete list)
```

---

*Report generated by Database Optimizer Agent*  
*Do not make schema changes without stakeholder approval*
