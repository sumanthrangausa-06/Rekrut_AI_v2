# Retention Lifecycle Design — Unified Interview Engine

**Issue:** #743 · **Spike** (design only, no code) · **Sprint 6**
**Author:** Rex (architect) · **Date:** 2026-10-11
**Status:** Design for review — implementation scoped for Sprint 7

## Problem

S-069's privacy review (finding H-1) found no retention/deletion lifecycle for
encrypted R2/B2 recording objects (`.enc` files from `lib/r2RecordingStore.js`).
They accumulate indefinitely. This spike defines the lifecycle.

Related: `data_retention_policies` holds retention *policies* as data, and
`EuComplianceService.executePurge` / `purgeExpiredRecordings()` enforce *some*
of them — but the unified interview engine's storage objects were never wired
into any purge path.

## Data Inventory

Eight data families, with current state, proposed retention, and proposed **legal basis**
(per `privacy-engineer`'s retention-policy pattern: every period needs a basis).

| # | Data | Location | Encryption | Lifecycle today | Proposed retention | Proposed legal basis |
|---|------|----------|-----------|-----------------|-------------------|---------------------|
| 1 | WebM recordings (unified engine) | R2/B2 `.enc` objects (`interviews/` prefix); key in `interviews.responses[].video_key` (JSONB) | DEK AES-256-GCM (S-069) | **NONE** — active Art. 5(1)(e) exposure | 90 days post-session, then storage delete (counsel to confirm) | Contract (interview service delivery) + legitimate interests (integrity review window) |
| 2 | Video frames (vision analysis) | R2/B2 `.bin` objects (`frames/` prefix); **no DB anchor** — referenced only by short-lived proxy URL | DEK AES-256-GCM (S-059) | **NONE** — active Art. 5(1)(e) exposure, orphaned by design | 30 days post-capture, then storage delete | Legitimate interests (analysis + integrity review); minimization: downsampled frames only |
| 3 | `biometric_templates` | DB rows, segregated (no FK to identity) | DEK AES-256-GCM | 90 days post-hiring-decision per migration 246 comment; S-015 deletion jobs **verified absent** — no purge code exists | Keep 90d; fold into purge cron (Delta 4) | Legal obligation (BIPA §15(a) schedule) + contract |
| 4 | `candidate_data_keys` (DEKs) | DB rows | KEK-wrapped | `destroyed_at` set on DSAR; rows retained for audit | Indefinite (audit); ciphertext zeroed | Legal obligation (audit trail of erasure) |
| 5 | `interview_recordings` (legacy Track B) | DB rows + LiveKit/R2 objects | `storage_path` BYTEA (encrypted) | `retention_expires_at` (90d default) + daily soft-delete cron (`purgeExpiredRecordings`) | Keep; **extend cron to delete storage objects** (currently DB-only) | Contract |
| 6 | `interview_transcripts` | DB rows | Plaintext | Cascade on recording delete | Follows recording lifecycle | Contract (derivative of recording) |
| 7 | `biometric_audit_log` + consent receipts | DB rows | Pseudonymized (HMAC) | 7 years per `data_retention_policies` (`audit_logs`, 2555d) | Keep 7yr — see counsel question on post-erasure receipts | Legal obligation (accountability, Art. 5(2)) |
| 8 | `candidate_embeddings` / `candidate_search_index` | DB rows | Plaintext | Hard-deleted on erasure (S-075) | Active-account retention: **24 months inactive proposed** (Sumanth to confirm) | Legitimate interests (matching); consent as fallback basis |

### Inconsistency flagged

`data_retention_policies.interview_recordings` = **730 days**, but the
per-row `retention_expires_at` default = **90 days** and
`purgeExpiredRecordings()` enforces the 90-day clock. Two clocks, one winner
(the 90-day one). **Recommendation:** align the policy row to 90 days (or the
counsel-confirmed period) so the documented policy matches enforced behavior.
A policy table that disagrees with the cron is a compliance liability.

## Deletion Triggers (priority order)

1. **DSAR erasure / account deletion — immediate.** `erasePersonalData()`
   calls `destroyDEK()`, which crypto-shreds **all** DEK-encrypted objects at
   once: `.enc` recordings, `.bin` frames, `biometric_templates`. This is the
   hard guarantee — no per-object purge needed for compliance. (S-067, S-075,
   #746.)
2. **Consent withdrawal mid-session — immediate for that session.** S-070
   tears down the active Observer on withdrawal. In-flight `.enc`/`.bin`
   objects for the withdrawn session should be deleted (not just shredded —
   the candidate withdrew, delete the artifacts).
3. **Automatic expiry — scheduled.** `retention_expires_at` cron, extended to
   storage objects and the unified engine (the Sprint 7 build — see below).
4. **Recruiter/company manual deletion — on demand.** Admin action; same
   code path as the purge, single-object scope.

## Crypto-Shredding Interaction (the key design rule)

`destroyDEK()` renders every DEK-encrypted object **unrecoverable instantly**.
After shredding, R2 objects are inert ciphertext — GDPR Art. 17 erasure is
satisfied at the crypto layer without touching storage.

**So why delete storage objects at all?** Two reasons: (a) storage cost —
orphaned ciphertext bills forever; (b) hygiene — a future key-compromise
question is moot if the object is gone. Compliance does not require it;
economics and defense-in-depth do.

**Purge ordering rule:** delete the **storage object first**, then mark the DB
row. Rationale: if the DB update fails after a storage delete, the row still
references a missing object → playback fails closed (404), and the next purge
run retries cleanly (storage delete is idempotent). The reverse order orphans
billable objects on crash.

## BIPA §15(a) — Documented Schedule Requirement

BIPA §15(a) requires a private entity in possession of biometric
identifiers/information to:

- Develop a **written policy**, made available to the public,
- Establishing a **retention schedule** and **guidelines for permanent
  destruction**,
- Destroy biometric data when the initial purpose for collection is
  satisfied **or within 3 years of the individual's last interaction**,
  whichever occurs first.

**What this means for us:** the retention schedule in this doc must become a
public-facing written policy before launch. The 90-day periods above sit
comfortably inside BIPA's 3-year ceiling, but **counsel must confirm** the
periods and review the public policy text. This is not engineer-decidable.

## Purge-Cron Design Delta (Sprint 7 build)

Existing machinery to reuse: `EuComplianceService.executePurge()` (dry-run
pattern), `purgeExpiredRecordings()` (daily cron in `server.js`),
`data_retention_policies` (policy data + admin endpoints).

### Delta 1 — Storage-object deletion for legacy recordings
`purgeExpiredRecordings()` soft-deletes DB rows but leaves storage files
(its own JSDoc admits this). Add: for each soft-deleted row, resolve the
storage object key and delete it from R2/B2. Requires the object key to be
resolvable — `storage_path` is encrypted BYTEA; either decrypt at purge time
or add a plaintext `storage_object_key` column (keys are opaque random hex —
no PII — plaintext storage is acceptable).

### Delta 2 — Unified-engine recording lifecycle (the #743 fix)
`.enc` objects keyed in `interviews.responses[].video_key` have no expiry
column. **Recommended:** new registry table —
`recording_objects(object_key PK, interview_id, candidate_id, object_type,
created_at, expires_at, deleted_at)` — written at upload time (best-effort,
outside the hot path). The purge cron sweeps `expires_at < NOW() AND
deleted_at IS NULL`: delete storage object, stamp `deleted_at`, write a
`biometric_audit_log` 'purge' entry per batch.

Why a registry instead of scanning JSONB: `responses` is a JSONB array —
purging would mean full-table scans with JSONB unnesting. The registry gives
an indexed `expires_at` sweep. Per `database-reviewer` guidance: index the
sweep column, batch with `LIMIT` + `SKIP LOCKED`.

### Delta 3 — Frame objects
Frames have no DB anchor today. Same registry, `object_type='frame'`,
`expires_at = created_at + 30 days`. Registry write at upload is one extra
INSERT on the vision path — make it best-effort (try/catch, never break
analysis).

### Delta 4 — `biometric_templates` purge (S-015 jobs verified absent)
Migration 246:73 references "Deletion jobs (S-015) purge by created_at" — a
codebase-wide grep for delete/purge/expire/cron/schedule touching
`biometric_templates` returns **zero results**. The jobs do not exist. Fold
template purging into the same cron: sweep `biometric_templates WHERE
created_at < NOW() - INTERVAL '90 days'` (or per hiring-decision date when
available), storage-delete-first ordering (N/A for DB rows — crypto-shredding
via `destroyDEK` is the hard guarantee), stamp and audit per batch.

### Non-goals for Sprint 7
- Changing the 90-day periods (counsel decision).
- Backfilling `expires_at` for pre-registry objects (one-time script, separate).
- Consent-receipt retention policy (counsel question below).

## Counsel vs. Engineering

**Needs legal counsel sign-off (blocking launch, not blocking Sprint 7 build):**
1. Final retention periods (90d recordings / 30d frames / 90d templates) —
   BIPA 3-year ceiling and GDPR Art. 5(1)(e) storage limitation.
2. **Consent receipts after erasure:** GDPR Art. 7(1) requires demonstrating
   consent was given; Art. 17 requires erasure on request. Standard
   resolution is retaining a minimal receipt under Art. 17(3)(e) (defence of
   legal claims) — counsel must confirm our basis and what fields survive.
3. Public-facing BIPA §15(a) written retention policy text.
4. Whether inert post-shredding ciphertext retention (if we ever defer
   storage deletion) is acceptable.

**Engineering-decided:**
- Purge mechanics (registry schema, cron schedule, batching, idempotency).
- Storage-before-DB deletion ordering.
- Dry-run-then-enforce rollout (follow `executePurge`'s pattern).
- Aligning `data_retention_policies` rows with enforced behavior.

## Compliance-Skill Review (2026-10-11)

Per Sumanth's directive, the design was run against three compliance skills.
Findings below; doc updated accordingly, code changes enumerated for Sprint 7.

### `gensecai/privacy-engineer` findings

1. **Legal basis per data type (FIXED in doc).** The skill's retention-policy
   pattern requires `{retention_period_days, legal_basis}` per data type —
   a period without a basis is not a policy. The inventory table now carries
   a proposed legal basis per family (contract / legitimate interests /
   legal obligation). Counsel confirms; engineering does not decide.
2. **DPIA required (ADDED to counsel list).** GDPR Art. 35 triggers present:
   special-category data (biometric identifiers), innovative technology (AI
   vision analysis), systematic evaluation of individuals. A Data Protection
   Impact Assessment for the retention lifecycle + AI analysis pipeline is
   almost certainly required before launch — separate from, and in addition
   to, the Art. 9 counsel review already flagged in #745.
3. **Article 30 RoPA (noted).** Records of processing activities must include
   purposes, data categories, recipients, third-country transfers, retention
   periods, security measures, and legal basis per activity. The inventory
   table above supplies the retention/security/basis columns; legal owns the
   full RoPA. Flagged so it is not assumed complete.
4. **Data minimization (documented).** Frames are downsampled analysis
   artifacts, not full-fidelity video — stated as the minimization posture
   for the 30-day proposal. Counsel to confirm sufficiency.

### `voltagent/gdpr-ccpa-compliance` findings

5. **Art. 5(1)(e) storage limitation — active exposure, not just a gap
   (REFRAMED in doc).** Items 1 and 2 have *no* lifecycle today: data kept
   longer than necessary with no defined necessity period is a live storage-
   limitation issue, not a future improvement. This gives the Sprint 7 build
   a compliance-deadline character, not just hygiene.
6. **Art. 5(2) accountability (STRENGTHENED).** The 730d-vs-90d policy/enforcement
   mismatch is an accountability failure: documented policy must match enforced
   behavior. Recommendation upgraded from "align the row" to **single source
   of truth**: refactor the cron to read `data_retention_policies` so policy
   and enforcement cannot drift again (see code changes §7 below).
7. **CCPA 45-day deletion SLA (ADDED).** DSAR deletion fulfillment (#746,
   PR #757) exists; the design now notes the 45-day CCPA response window as
   the operational SLA for the fulfillment endpoint.
8. **GDPR product checklist.** "Data retention policies documented and
   enforced" — documented here; enforced by Deltas 1–4. The checklist item
   closes when the Sprint 7 build ships with dry-run evidence.

### `voltagent/compliance-auditor` findings

9. **Purge audit entry field spec (ADDED).** Per-batch `biometric_audit_log`
   'purge' entries (action already in `VALID_ACTIONS`, `lib/biometricAudit.js:14-24`)
   must carry: purge run id, objects deleted, period covered, dry-run vs
   enforced flag, and error count. Who/what/when, queryable.
10. **Continuous monitoring (ADDED).** The 730d/90d drift is the exemplar of
    what drift detection catches. Until the single-source-of-truth refactor
    (§7) lands, add a lightweight scheduled consistency check (policy row vs
    cron constant) that alerts on mismatch.
11. **Control coverage (VERIFIED).** All 8 families now have an enforcement
    path: items 1→Delta 2, 2→Delta 3, 3→Delta 4, 4→audit-basis retention,
    5→Delta 1, 6→cascade, 7→7yr + counsel, 8→S-075 + 24mo proposal. QP
    practice frames confirmed to flow through `r2FrameStore` (same `frames/`
    prefix, `lib/qp-ai.js:9`) — covered by Delta 3, no separate family.

### Counsel list — additions from this review
5. DPIA (Art. 35) for the retention lifecycle + AI vision-analysis pipeline
   (launch-blocking, alongside the Art. 9 review).
6. Confirm proposed legal bases per data family (inventory table above).
7. RoPA completeness for retention processing activities.

## Adversarial Review (red-teaming this design)

- *"Crypto-shredding already satisfies erasure — is the registry
  over-engineering?"* Partially fair. For **compliance**, shredding suffices.
  For **cost**, it doesn't — objects bill forever. The registry is a cost
  control with a compliance co-benefit. If Sumanth wants minimum scope: Delta
  2 only, Deltas 1/3/4 deferred.
- *"Registry INSERT on the hot vision path adds latency/failure modes."*
  Mitigated: best-effort try/catch, never blocks upload. Worst case a frame
  misses the registry and is swept by a periodic prefix listing (fallback).
- *"Two clocks (730d policy vs 90d cron) — which is the lie?"* The cron is
  the truth; the policy row is stale. Aligned in this design.
- *"What if a candidate deletes their account the day before purge runs?"*
  Erasure path (trigger 1) is independent of the purge — `destroyDEK` covers
  it immediately. No race.

## Implementation story for Sprint 7 (scoped)

**Title:** Purge-cron storage deletion + recording-object registry
**Points:** 5 (estimate — Lead to confirm)
**Scope:** Deltas 1–4 above. Migration for `recording_objects` (+ optional
`storage_object_key` on `interview_recordings`). Extend daily cron. Dry-run
mode first; enforce after Sumanth reviews dry-run output. Tests: purge
idempotency, storage-before-DB ordering, best-effort registry writes.
**Out of scope:** retention period changes (counsel), pre-registry backfill
(separate script), consent-receipt policy (counsel).

### Precise code changes (Sprint 7 checklist)

1. **Migration (new):** `recording_objects(object_key TEXT PK,
   interview_id UUID NULL, candidate_id UUID NOT NULL, object_type TEXT NOT NULL
   CHECK (object_type IN ('recording','frame')), created_at TIMESTAMPTZ DEFAULT
   NOW() NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
   deleted_at TIMESTAMPTZ NULL)` + `CREATE INDEX
   idx_recording_objects_expiry ON recording_objects(expires_at) WHERE
   deleted_at IS NULL`. Optional: `ALTER TABLE interview_recordings ADD
   COLUMN storage_object_key TEXT` (avoids decrypt-at-purge; keys are opaque
   hex, no PII).
2. **`services/euComplianceService.js:604-611`** — extend
   `purgeExpiredRecordings()`: for each row with `retention_expires_at < NOW()`,
   resolve storage object key (decrypt `storage_path` BYTEA at purge time, or
   read new `storage_object_key`), delete object from R2/B2, then `UPDATE ...
   SET status='deleted'`. Storage-first ordering (crash-safe).
3. **`routes/interviews.js`** — after `uploadEncryptedRecording` succeeds
   (upload path, ~line 209 per current code): best-effort `INSERT INTO
   recording_objects(object_key, interview_id, candidate_id,
   object_type='recording', expires_at = NOW() + INTERVAL '90 days')`
   in try/catch — never break the upload.
4. **`lib/r2FrameStore.js:252`** — in `uploadEncryptedFrameForVision`:
   best-effort registry INSERT with `object_type='frame'`, `expires_at =
   NOW() + INTERVAL '30 days'`. Covers unified engine, screening, and QP
   frames (all flow through this function: `lib/qp-ai.js:9`,
   `lib/polsia-ai.js:8`).
5. **`server.js:1006` (daily cron)** — new `purgeRecordingObjects()` sweep:
   `SELECT ... WHERE expires_at < NOW() AND deleted_at IS NULL ORDER BY
   expires_at LIMIT <batch> FOR UPDATE SKIP LOCKED`; per object: storage
   delete → `UPDATE recording_objects SET deleted_at=NOW()`; per batch: one
   `biometricAudit.logAccess` 'purge' entry (action already allowlisted,
   `lib/biometricAudit.js:14-24`) with run id, object count, period, dry-run
   flag, error count. Dry-run mode first (log-only), enforce after Sumanth
   reviews output — follow `EuComplianceService.executePurge()`'s pattern.
6. **Delta 4 (templates):** add `biometric_templates` sweep to the same cron
   (`created_at < NOW() - INTERVAL '90 days'`); crypto-shredding via
   `destroyDEK` remains the hard erasure guarantee.
7. **Policy single-source-of-truth:** refactor `purgeExpiredRecordings()` and
   the new sweep to read periods from `data_retention_policies` instead of
   hardcoded intervals; fix the stale row: `UPDATE data_retention_policies
   SET retention_days = 90 WHERE data_type = 'interview_recordings'`
   (`migrations/013_compliance_system.js:149` seeded 730). Until the refactor
   lands, add a scheduled consistency check (policy row vs cron constant)
   that alerts on mismatch.
8. **Tests:** purge idempotency (re-run deletes nothing twice), storage-before-
   DB ordering (DB failure after storage delete → row still swept next run),
   best-effort registry writes (upload succeeds when registry INSERT fails),
   dry-run produces zero deletions, batch `SKIP LOCKED` under concurrency.

---
*Toolkit: `create-architecture` (doc structure) · `database-reviewer`
PROACTIVE (registry schema, index/sweep design, JSONB-scan avoidance) ·
`review-adversarial` (red-team section) · `migration-architect` (zero-downtime
purge patterns: dry-run first, idempotent retries, storage-before-DB
ordering) · `verification-before-completion` (every claim above is
file:line-grounded — see references) · compliance skills (2026-10-11 pass):
`gensecai/privacy-engineer` (legal-basis-per-type, DPIA, RoPA, minimization) ·
`voltagent/gdpr-ccpa-compliance` (Art. 5(1)(e) reframing, Art. 5(2)
accountability, CCPA 45-day SLA, checklist) ·
`voltagent/compliance-auditor` (purge audit field spec, drift detection,
control coverage verification).*
