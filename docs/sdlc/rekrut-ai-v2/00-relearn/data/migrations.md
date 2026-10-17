# Rekrut_AI_v2 — Migrations: Inventory & Mechanics

Source of truth for this document: `migrate.js`, `render.yaml`, `package.json` and the `migrations/` directory on **`origin/dev` at commit `e55999009642dfc6a9d58cfe1db08645f8b696c5` (2026-10-13)**, read from the git tree. No live database was reachable from the build VM; anything about what has actually run on a given database is inferred from code + the tracking-table design, and flagged where it cannot be verified.

## Mechanics — how migrations actually run

- **Entry point.** `package.json` defines `"migrate": "node migrate.js"`. Every Render service in `render.yaml` (prod, staging, dev) uses the start command:
  > `npm run migrate && npm start`
  So migrations run **at every boot/deploy, before the server starts** — not as a build step and not manually. If migration fails, `npm start` never runs.
- **Bootstrap first.** Before looking at `migrations/`, `migrate()` creates the tracking table and 13 core tables with `CREATE TABLE IF NOT EXISTS` (see `schema.md`, "Tables created outside migrations"). These bootstrap definitions win over later `IF NOT EXISTS` creates of the same table.
- **Run order = lexical filename sort, nothing else.** `migrate.js`: `const files = allFiles.sort();` over `fs.readdirSync(migrationsDir)` filtered only to skip dotfiles. JavaScript's default string sort is the application order. Consequences, all verified against the sorted list:
  - Zero-padded 3-digit files run in numeric order (`001`…`258`) **only because** they are zero-padded and share the `0`/`1`/`2` prefix range.
  - `1739617200000_p1_interview_flow_schema.js` sorts among the `1xx` files (between `139_…` and `2024-…`), **not** at position 1.
  - `2024-06-13-…`, `2024-06-14-…`, `2026-08-11-…`, `2026-08-16-…` sort after `1739…` and before `219_…`.
  - `219`–`258` run after all date-prefixed files.
  - `p2_…`, `p3_…`, `p3b_…`, `p3c_…`, `p3d_…`, `p4_…`–`p7_…` run **after every numbered file** (`p` > `2`), and `seed_notification_templates.js` runs **last** (`s` > `p`).
  - Duplicate numbers are not an error: both files run, in filename order (e.g. `010_document_status_enum_update.js` before `010_video_analysis.js`; three `128_*` files; three `070_*` files; two `240_*` files).
- **File inventory size.** The directory holds 156 entries in git: **155 runnable files** (141 `.js` + 14 `.sql`) plus `.gitkeep`, which the runner skips as a dotfile. Any file that is neither `.js` nor `.sql` makes the runner **throw before running anything** (`Unrecognized migration file… Only .js and .sql files are supported`).
- **Tracking table.** `_migrations` (`id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, applied_at TIMESTAMP DEFAULT NOW()`), created by `migrate.js` itself.
- **Tracking key is the exported `name`, not the filename** (for `.js`): `migrationName = migration.name || file.replace('.js','')`. Verified mismatches include `001_add_omniscore.js` → tracked as `add_omniscore_tables`; `002_add_trustscore.js` → `add_trustscore_tables`; `003b_add_role_column.js` → `003_add_role_column`; `005b_oauth_refresh_tokens.js` → `005_oauth_refresh_tokens`; `030_omniscore_v2.js` → `omniscore_v2_two_sided`; `252_pending_storage_deletions.js` → `252_pending_storage_deletions_ledger`; `p3b_candidate_search.js` → `130_candidate_search`; `p3c_analytics_materialized_views.js` → `071_analytics_materialized_views`. Files with no `name` export are tracked under their filename without extension. For `.sql` files the tracking name is the **full filename including `.sql`**.
- **Idempotency.** A migration runs only if its tracking name is absent from `_migrations` (`SELECT id FROM _migrations WHERE name = $1`). That is the only gate: re-running `migrate.js` skips recorded migrations, but a migration whose `name` changes will run again. Most DDL inside migrations is additionally `IF NOT EXISTS`-guarded, but not all (e.g. plain `CREATE INDEX` in `046_password_reset_tokens.js`).
- **Failure behaviour (verified in `migrate.js`).** Each migration file runs in its own transaction: `BEGIN` → `up(client)` (or the whole `.sql` file as one query) → insert tracking row → `COMMIT`. On any error: `ROLLBACK`, the error is **rethrown**, `migrate()` catches it, logs `Migration error:`, and calls **`process.exit(1)`**. Net effect: the failing migration leaves no partial DDL and no tracking row; migrations after it in sort order **never run**; already-committed earlier migrations stay applied; and because the start command is `npm run migrate && npm start`, **the service does not boot**. The next deploy retries the same failing migration first.
- **`down` is never executed.** The runner only requires and calls `up` (it throws if `up` is not a function). `down` functions exist in 39 of the `.js` files (see inventory column) purely as documentation/convention; no `.sql` file has a down. There is no rollback command.

## Deploy-pending: migrations 252–258 (written, NOT yet run anywhere)

No promotion has been authorised, so **252–258 have not run against any deployed database**. State this plainly because of the boot mechanics above: **the moment a staging deploy boots, `npm run migrate` will apply 252–258 — in lexical order, in one boot, before the server starts — against the SHARED production database** (staging and prod share one database by Sumanth's design; staging's `DATABASE_URL` in `render.yaml` is a separately-set secret, so the shared-DB fact comes from the standing project rule, and the render.yaml file alone does NOT VERIFY which database staging points at). There is no staging-only rehearsal for these migrations.

| # | File | What it does (one line) |
|---|------|--------------------------|
| 252 | `252_pending_storage_deletions.js` | Creates `pending_storage_deletions` ledger (erasure Phase-1→Phase-2 storage-deletion handoff) + adds `metadata JSONB` to `biometric_audit_log` (header, file:1-24; tracked as `252_pending_storage_deletions_ledger`) |
| 253 | `253_recording_objects_registry.js` | Creates `recording_objects` registry (`object_key TEXT` PK, expiry sweep index) + realigns `data_retention_policies` for `interview_recordings` (730d policy → 90d enforced) (file:1-30) |
| 254 | `254_compliance_audit_retention_purge.js` | Widens `compliance_audit_trail` entity_type CHECK to also allow `'retention_purge'` (drops old CHECK by name lookup, adds new one) (file:1-6) |
| 255 | `255_observer_jobs.js` | Creates `observer_jobs` — AI Observer worker queue, `interview_session_id UNIQUE` FK→`interview_sessions(id) ON DELETE CASCADE`, status CHECK (file:1-20) |
| 256 | `256_ai_observer_reports.js` | Creates `ai_observer_reports` — observer behavioural/integrity analysis per session, `interview_session_id UNIQUE` FK→`interview_sessions(id) ON DELETE CASCADE`, consent_state CHECK (file:1-25) |
| 257 | `257_observer_capture.js` | Gate A dormant-capture substrate (S-085/#787): widens `recording_objects` object_type CHECK with `'observer_audio'` + `registration_state`; seeds `data_retention_policies` observer_audio 30d; creates `observer_audio_chunks`, `observer_speech_measurements`, `observer_capture_outcomes`, `observer_cohort_allowlist` (file:1-30) |
| 258 | `258_legal_holds.js` | Creates `legal_holds` (user_id and/or company_id, deliberately **no FKs**; active while `released_at IS NULL`) backing `lib/legalHold.js` (file:1-27) |

## Conventions for adding a new migration (as actually practised, 250–258)

- **Numbering/filename:** next 3-digit number, zero-padded, snake_case suffix: `NNN_short_description.js`. All of 250–258 follow this. (Older exceptions exist — date-prefixed and `pN_` files — do not copy them; their sort position is not where their name suggests.)
- **Export shape (recent practice):** either `module.exports = { name: 'NNN_short_description', up, down }` (250–253) or `async function up(client) {…}` + `module.exports = { up, down }` with **no `name`** (254–258), in which case the tracking name is the filename without `.js`. 252 is the exception that proves the rule: its exported name (`252_pending_storage_deletions_ledger`) differs from its filename.
- **`down` in recent files: YES, they have them** — every one of 250–258 defines a `down`. It is never run by the runner (see Mechanics); write it as the honest inverse anyway, matching the neighbourhood.
- **Idempotency style (recent practice):** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; CHECK-constraint replacement via an `information_schema` name lookup + `DROP CONSTRAINT` in a DO block, then `ADD CONSTRAINT` (pattern set by 254, reused by 257). Each file runs in one transaction supplied by the runner — do not open your own.
- **Header comment is mandatory in practice:** migration number, story/issue reference, why, and safety notes — every file 250–258 has one. Cite the issue in the header.
- **Never rename a file or change an exported `name` after it has run anywhere** — the tracking key is the name; a rename means re-execution.

## KNOWN DEFECT — fresh-database build halts at migration 238 (issue #894)

Verified from the git tree, mechanism in three steps:

1. `migrate.js` bootstrap creates `candidate_profiles` **without a `bio` column** (bootstrap block at `migrate.js:220` — columns: headline, summary, skills, experience, education, resume_url, …; no `bio`, no `photo_url`, no `availability`, no `years_experience`).
2. Migration `004_candidate_profiles.js:9-13` defines the richer table **with `bio TEXT` (:13)** — but as `CREATE TABLE IF NOT EXISTS`, so on a fresh build it is a **no-op**: the bootstrap table already exists. `bio` is never created on the fresh path. (The only other `bio` in migrations is a local variable in `p3b_candidate_search.js:31,122`, which sorts after 238 and never runs on a fresh build.)
3. Migration `238_v_candidate_full_profile.js:36` does `CREATE OR REPLACE VIEW v_candidate_full_profile AS SELECT … cp.bio …`. On a fresh database this fails (column `cp.bio` does not exist). Per the runner's failure behaviour, 238 is rolled back, `migrate()` exits 1, and **every migration ≥239 never applies to a fresh database**; the service does not boot.

The live database is unaffected: it grew incrementally, so its `candidate_profiles` predates / bypasses the bootstrap collision — the live table's exact provenance is NOT VERIFIED from the build VM. Tracked as **issue #894**. Until it is fixed, "the schema" in `schema.md` describes the incremental-path database, not anything a fresh build can produce.

## Inventory — all 155 files in application (lexical-sort) order

`down` = the file defines a `down` function (never executed by the runner; see Mechanics).

| # | File | Purpose (one line) | down |
|---|------|--------------------|------|
| 1 | `001_add_omniscore.js` | OmniScore Migration - Candidate Credit Score System | — |
| 2 | `002_add_trustscore.js` | TrustScore Migration - Employer Credit Score System | — |
| 3 | `003_add_company_profile_fields.js` | alters companies | — |
| 4 | `003b_add_role_column.js` | alters users | — |
| 5 | `004_candidate_profiles.js` | Migration: Candidate Profiles Module | — |
| 6 | `005_backfill_application_company_id.js` | Data backfill: UPDATE job_applications.company_id from jobs where NULL (verified, file lines 7-14) | — |
| 7 | `005b_oauth_refresh_tokens.js` | Migration: OAuth & Refresh Tokens Support | — |
| 8 | `006_dynamic_assessments.js` | Migration: Dynamic Assessment Engine | — |
| 9 | `007_practice_sessions.js` | Practice Sessions Migration - AI Interview Coaching & Practice Mode | — |
| 10 | `008_matching_engine.js` | Matching & Ranking Engine Migration | — |
| 11 | `009_document_verification.js` | Document Verification Migration - Phase 5 | — |
| 12 | `010_document_status_enum_update.js` | Migration: Update document verification status enum + add encryption columns | — |
| 13 | `010_video_analysis.js` | creates interview_analysis | — |
| 14 | `011_payroll_system.js` | creates employee_benefits, employees, paychecks, payroll_configs… | — |
| 15 | `012_payroll_fixes.js` | alters payroll_configs | — |
| 16 | `013_compliance_system.js` | creates audit_logs, bias_reports, consent_records, data_requests… | — |
| 17 | `014_onboarding_system.js` | creates company_policies, offer_templates, offers, onboarding_chats… | — |
| 18 | `015_add_company_id_to_offers.js` | alters offers | — |
| 19 | `016_conversion_tracking.js` | creates events | — |
| 20 | `017_fix_missing_schema.js` | creates omniscore_results; alters users | — |
| 21 | `018_extend_onboarding_documents.js` | alters onboarding_documents | — |
| 22 | `019_candidate_onboarding_wizard.js` | creates candidate_onboarding_data; alters onboarding_documents | — |
| 23 | `020_w4_filing_status.js` | alters candidate_onboarding_data | — |
| 24 | `021_payroll_company_bridge.js` | alters employees, payroll_runs | — |
| 25 | `022_screening_questions.js` | alters job_applications, jobs | — |
| 26 | `023_fix_interviews_updated_at.js` | alters interviews | — |
| 27 | `024_offer_letter_generation.js` | alters offers | — |
| 28 | `025_real_onboarding_documents.js` | alters candidate_onboarding_data, onboarding_documents | — |
| 29 | `026_i9_government_spec_fields.js` | alters candidate_onboarding_data | — |
| 30 | `027_multi_country_support.js` | creates country_configs, country_document_types; alters candidate_onboarding_data, companies, employees… | — |
| 31 | `028_video_practice.js` | alters practice_sessions | — |
| 32 | `029_global_payroll_enhancements.js` | creates pay_periods; alters paychecks, payroll_configs, payroll_runs | — |
| 33 | `030_omniscore_v2.js` | OmniScore v2 Migration - Two-sided scoring system | — |
| 34 | `031_question_bank.js` | creates mock_interview_sessions, question_bank | — |
| 35 | `032_mock_interview_cached_feedback.js` | alters mock_interview_sessions | yes |
| 36 | `033_tts_audio_cache.js` | creates tts_cache | yes |
| 37 | `034_activity_log.js` | creates activity_log | — |
| 38 | `035_email_notifications.js` | creates notification_logs, notification_preferences, notification_queue, notification_templates | — |
| 39 | `035_pg_sessions.js` | creates IF | — |
| 40 | `036_smart_data_reuse.js` | alters candidate_profiles, question_bank | — |
| 41 | `037_smart_profile_memory.js` | creates recruiter_feedback, recruiter_preferences, screening_answers, user_memory; alters candidate_profiles, match_results, score_history | — |
| 42 | `038_ai_agents_pipeline_automation.js` | Pipeline automation rules + AI agent support tables | — |
| 43 | `039_ai_health_monitoring.js` | Migration 039: AI Health Monitoring — Call Logs, Prompt Registry, Model Metrics | — |
| 44 | `040_communication_hub.js` | creates communication_sequences, communication_templates, communications, sequence_enrollments | — |
| 45 | `040_mock_per_question_analysis.js` | alters mock_interview_sessions | yes |
| 46 | `041_interview_scheduling_screening.js` | AI Interview Scheduling, Screening Pipeline, Multi-Evaluator tables | — |
| 47 | `042_job_assessments.js` | Migration: Job-Based AI Assessment Engine | — |
| 48 | `043_ai_health_persistence.js` | Migration 043: AI Health Persistence — Survive Deploys | — |
| 49 | `044_ai_onboarding_plans.js` | creates onboarding_plans, onboarding_tasks; alters onboarding_chats, onboarding_documents | — |
| 50 | `045_fix_company_id_fk_constraints.sql` | alters company_policies, offer_templates, offers… | — |
| 51 | `046_password_reset_tokens.js` | Password Reset Tokens Migration | yes |
| 52 | `046_voice_notifications.js` | Migration: Add voice notification support | — |
| 53 | `047_p2_schema_hardening.js` | P2 Schema Hardening Migration | — |
| 54 | `048_company_domain_enforcement.js` | Migration: Company Domain Enforcement | — |
| 55 | `051_screening_tables.js` | Migration: Screening tables for recruiter AI screener | yes |
| 56 | `060_add_user_settings.js` | Migration: Add user_settings table for unified settings endpoint | yes |
| 57 | `061_add_notification_system.js` | Migration: Add notification system tables (templates, preferences, queue, logs) | yes |
| 58 | `062_calendar_integration.js` | Calendar Integration — Google Calendar + Microsoft Outlook OAuth | — |
| 59 | `063_add_missing_email_templates.js` | Seed: inserts missing email templates (hired / rejection / interview_reminder) into notification templates table (verified, file head) | yes |
| 60 | `064_add_job_like_dislike.js` | Migration: Add like/dislike (swipe) system for job cards | — |
| 61 | `065_usage_limits.js` | Migration: usage_limits table for Free vs Pro tier feature gating (#35) | — |
| 62 | `066_e_signature_engine.js` | Migration: E-Signature Engine Foundation (#131) | — |
| 63 | `067_encrypted_oauth_tokens.js` | Encrypted OAuth Token Storage | — |
| 64 | `068_identity_verification.js` | Migration 068: Identity Verification System | yes |
| 65 | `068_job_search_filter_columns.js` | Job search filter columns | — |
| 66 | `069_in_app_notifications.js` | Migration: Add in-app notification table for pending recruiter join requests (Issue #155) | yes |
| 67 | `070_analytics_indexes.js` | Migration: Analytics Indexes | — |
| 68 | `070_audit_logs.js` | Migration: Add audit_logs columns for recruiter approvals and rejections (Issue #156) | yes |
| 69 | `070_refer_and_earn.js` | Migration: Refer & Earn — referral codes, tracking, rewards (#80) | yes |
| 70 | `071_audit_logs_fix.js` | Fix audit_logs columns for staging environments where 070 was a no-op | yes |
| 71 | `072_add_conversations_messages_saved_searches.js` | Migration 072: Add conversations, messages, and saved_searches tables | — |
| 72 | `073_screening_questionnaire.js` | Migration 073: Screening Questionnaire System (Issue #110) | — |
| 73 | `074_aptitude_test_engine.js` | Migration 074: Aptitude Test Engine (Issue #111) | — |
| 74 | `076_ai_screener_results.js` | Migration 076: AI Recruiter Screener Results (Issue #112) | yes |
| 75 | `077_omniscore_v2_eight_factor.js` | creates score_snapshots; alters omni_scores | — |
| 76 | `078_chat_schema_enhancements.js` | Migration 078: Chat schema enhancements | — |
| 77 | `117_code_sandbox.js` | Migration: Code Sandbox — Self-Hosted Judge0 Execution Engine (Issue #117) | — |
| 78 | `119_coding_templates.js` | Migration: Technical Test Templates and Auto-Grading System (Issue #119) | — |
| 79 | `120_proctoring_system.sql` | creates proctoring_events, proctoring_flags, proctoring_sessions | — |
| 80 | `125_interview_panels.js` | Migration: Multi-Interviewer Panel with Scorecards and Shared Notes (Issue #125) | — |
| 81 | `126_interview_events_proposed_slots.js` | Calendar Integration — Interview Events & Proposed Slots (Issue #127) | — |
| 82 | `127_livekit_interview_rooms.js` | LiveKit Video Infrastructure — Interview Rooms (Issue #124) | — |
| 83 | `128_collaboration.sql` | creates comment_mentions, comments, hiring_activity, shared_notes | — |
| 84 | `128_interview_recordings.js` | Migration: Interview Recording Infrastructure (Issue #126) | yes |
| 85 | `128_rbac_foundation.js` | Migration 128: RBAC Foundation — roles, permissions, junction tables, seed data | — |
| 86 | `129_compliance_audit_trail.js` | Compliance Audit Trail with Hash Chain | yes |
| 87 | `129_interview_sessions_unified.js` | Unified interview_sessions table (Issue #322, Phase 1) | yes |
| 88 | `130_recordings_session_nullable.js` | allow session-linked recordings (#322, Task 4) | — |
| 89 | `131_career_coach_schema.js` | Migration: AI Career Coach Schema (Issue #121) | — |
| 90 | `132_trustscore_v2.js` | TrustScore v2 Migration — Deep company scoring and accountability (Issue #122) | — |
| 91 | `133_eu_ai_act_compliance.js` | EU AI Act Compliance Backend — Issue #142 | — |
| 92 | `134_document_fraud_detection.sql` | creates document_review_queue; alters document_verifications | — |
| 93 | `135_aadhaar_verification.sql` | creates identity_verifications | — |
| 94 | `135_background_check.js` | Migration 135: Background Check System | yes |
| 95 | `136_profile_enhancement_tools.js` | Migration: Profile Enhancement Tools Schema (Issue #26) | — |
| 96 | `137_outreach_attempts.js` | creates outreach_attempts | — |
| 97 | `138_interview_flows.js` | Migration 138: interview_flows — generalized interview configuration (#322) | yes |
| 98 | `139_interview_rooms_session_link.js` | Migration 139: session-linked LiveKit rooms (#323) | — |
| 99 | `1739617200000_p1_interview_flow_schema.js` | alters interview_analysis, interview_composite_scores, interview_evaluations… | — |
| 100 | `2024-06-13-add-email-templates.js` | Migration: Add default email notification templates | — |
| 101 | `2024-06-14-add-email-queue.js` | creates email_queue | yes |
| 102 | `2026-08-11-add-user-suspended-at.sql` | alters users | — |
| 103 | `2026-08-16_recruiter_introductions.sql` | creates candidate_intro_quota, recruiter_introductions | — |
| 104 | `219_add_auto_apply_flag.sql` | alters job_applications | — |
| 105 | `220_cv_analyses.sql` | creates cv_analyses | — |
| 106 | `221_cv_reviews.sql` | creates cv_reviews | — |
| 107 | `222_bulk_import.sql` | creates import_jobs | — |
| 108 | `223_api_keys.sql` | creates api_key_usage, api_keys | — |
| 109 | `224_department_hierarchy.js` | Migration 224: Department hierarchy — departments, department_members, job scoping | — |
| 110 | `225_career_diagnosis.js` | Migration 225: Career Diagnosis — 360° skills assessment | — |
| 111 | `226_working_style_profile.js` | alters candidate_profiles | yes |
| 112 | `227_linkedin_profile_import.js` | LinkedIn Profile Import Support (Issue #79) | — |
| 113 | `228_auto_apply_schema.sql` | creates auto_apply_profiles; alters job_applications | — |
| 114 | `228_qa_schema_hotfixes.js` | Migration 228: QA schema hotfixes (local + staging Neon) | — |
| 115 | `229_career_diagnoses_updated_at.js` | Migration 229: career_diagnoses.updated_at (#77 GET query) | — |
| 116 | `230_oauth_exchange_codes.js` | Migration 230: oauth_exchange_codes — one-time codes bridging OAuth to SPA auth | — |
| 117 | `231_add_users_deleted_at.js` | Migration 231: users.deleted_at — soft-delete tombstone for account deletion | — |
| 118 | `232_assessment_attempt_due_date.js` | Migration: assessment attempt deadlines (#343 task 3) | — |
| 119 | `233_assessment_score_roundtrip.js` | Migration: assessment score round-trip (#343 task 4) | — |
| 120 | `234_assessment_referrals.js` | Migration 234: assessment_referrals — tokenized referral links for assessments | — |
| 121 | `235_interview_invite_expiry.js` | Migration 235: interview invite expiry — 7-week max invite window | — |
| 122 | `236_unified_interviews_view.js` | Migration 236: unified_interviews view — read-only union over the two | — |
| 123 | `237_unified_interviews_view_slot_ids.js` | Migration 237: unified_interviews view — include proposed_slots slot ids | — |
| 124 | `238_v_candidate_full_profile.js` | Migration 238: v_candidate_full_profile view — single read surface for | yes |
| 125 | `239_drop_dead_materialized_views.js` | Migration 239: Drop 5 dead analytics materialized views | yes |
| 126 | `240_extend_candidate_full_profile_view.js` | Migration 240: extend v_candidate_full_profile for dashboard consolidation (#521) | yes |
| 127 | `240_v_unified_assessments.js` | Migration 240: v_unified_assessments VIEW | yes |
| 128 | `241_skill_endorsements.js` | Migration 241: Create skill_endorsements table | yes |
| 129 | `242_job_alerts.js` | Migration 242: job_alerts table (#528) | — |
| 130 | `243_biometric_audit_log.js` | Biometric audit log (S-014, Issue #573, Phase 4 Sprint 1) | — |
| 131 | `244_consent_tables.js` | Consent tables (S-010, Issue #568, Phase 4 Sprint 1) | — |
| 132 | `245_consent_hardening.js` | Consent hardening (S-011, Issue #571) | — |
| 133 | `246_biometric_segregation.js` | Biometric/PII segregation (S-058, Issue #582, Phase 4 Sprint 2) | — |
| 134 | `247_interview_sessions_indexes.js` | interview_sessions indexes + type constraint (S-001, Issue #640) | yes |
| 135 | `248_session_lifecycle.js` | Session lifecycle columns (S-003, Issue #642, Phase 4 Sprint 2) | — |
| 136 | `249_human_interview_requests.js` | Human interview requests (S-012, Issue #651, Phase 4 Sprint 2) | — |
| 137 | `250_qp_biometric_consent_text.js` | QP-specific biometric consent text (S-066, Issue #719) | yes |
| 138 | `251_audit_log_company_id.js` | Tenant isolation for biometric_audit_log (S-065 C1 fix) | yes |
| 139 | `252_pending_storage_deletions.js` | Persistent storage-deletion ledger + audit metadata (S-076) | yes |
| 140 | `253_recording_objects_registry.js` | Migration 253: recording_objects registry for retention lifecycle (S-077 #760) | yes |
| 141 | `254_compliance_audit_retention_purge.js` | extend compliance_audit_trail entity_type CHECK for retention purges | yes |
| 142 | `255_observer_jobs.js` | observer_jobs table for E-008 AI Observer worker | yes |
| 143 | `256_ai_observer_reports.js` | ai_observer_reports table for E-008 AI Observer worker | yes |
| 144 | `257_observer_capture.js` | Gate A dormant-capture substrate (S-085, #787) | yes |
| 145 | `258_legal_holds.js` | legal holds (G-1, #799) | yes |
| 146 | `p2_schema_hardening.sql` | alters _migrations, activity_log, agent_data… | — |
| 147 | `p3_schema_optimizations.js` | alters statement | — |
| 148 | `p3b_candidate_search.js` | Migration 130: Candidate Search Index & Invites | — |
| 149 | `p3c_analytics_materialized_views.js` | Migration: Analytics Materialized Views | — |
| 150 | `p3d_fix_users_trigger_user_id.js` | Migration p3d: Fix trg_sync_csi_users trigger — use NEW.id not NEW.user_id | — |
| 151 | `p4_application_status_stages.js` | Expand job_applications status CHECK constraint to include the | yes |
| 152 | `p5_screening_conversational_phase.js` | Migration: Add current_phase to screening_sessions for conversational screening | yes |
| 153 | `p6_screening_template_topics.js` | Migration: Add topics to screening_templates for conversational screening | yes |
| 154 | `p7_auto_send_screening_on_jobs.js` | alters jobs | — |
| 155 | `seed_notification_templates.js` | Seed default email notification templates | — |
## Gaps in this inventory

- One-line purposes are extracted from each file's header comment where one exists, otherwise summarised from the file's CREATE/ALTER targets; two files (005, 063) were hand-verified and say so inline. A purpose line is a summary, not a substitute for the file.
- Whether any specific migration below 252 has actually been recorded in the live `_migrations` table is NOT VERIFIED (no live-DB access from the build VM). 252–258 are asserted not-run on the basis of the task brief (no promotion authorised), not on a tracking-table read.

---

**Data documentation pack:** [index](./README.md) · [data model](./data-model.md) · [schema](./schema.md) · [migrations](./migrations.md) · [access control / RLS](./rls-policies.md) · [seed data](./seed-data.md)
