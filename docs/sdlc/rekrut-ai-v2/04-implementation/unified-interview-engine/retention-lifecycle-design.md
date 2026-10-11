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

Eight data families, with current state and proposed retention.

| # | Data | Location | Encryption | Lifecycle today | Proposed retention |
|---|------|----------|-----------|-----------------|-------------------|
| 1 | WebM recordings (unified engine) | R2/B2 `.enc` objects (`interviews/` prefix); key in `interviews.responses[].video_key` (JSONB) | DEK AES-256-GCM (S-069) | **NONE** — the #743 gap | 90 days post-session, then storage delete (counsel to confirm) |
| 2 | Video frames (vision analysis) | R2/B2 `.bin` objects (`frames/` prefix); **no DB anchor** — referenced only by short-lived proxy URL | DEK AES-256-GCM (S-059) | **NONE** — orphaned by design | 30 days post-capture, then storage delete |
| 3 | `biometric_templates` | DB rows, segregated (no FK to identity) | DEK AES-256-GCM | 90 days post-hiring-decision per migration 246 comment; S-015 deletion jobs referenced but **not verified to exist** | Keep 90d; verify S-015 jobs exist or fold into purge cron |
| 4 | `candidate_data_keys` (DEKs) | DB rows | KEK-wrapped | `destroyed_at` set on DSAR; rows retained for audit | Indefinite (audit); ciphertext zeroed |
| 5 | `interview_recordings` (legacy Track B) | DB rows + LiveKit/R2 objects | `storage_path` BYTEA (encrypted) | `retention_expires_at` (90d default) + daily soft-delete cron (`purgeExpiredRecordings`) | Keep; **extend cron to delete storage objects** (currently DB-only) |
| 6 | `interview_transcripts` | DB rows | Plaintext | Cascade on recording delete | Follows recording lifecycle |
| 7 | `biometric_audit_log` + consent receipts | DB rows | Pseudonymized (HMAC) | 7 years per `data_retention_policies` (`audit_logs`, 2555d) | Keep 7yr — see counsel question on post-erasure receipts |
| 8 | `candidate_embeddings` / `candidate_search_index` | DB rows | Plaintext | Hard-deleted on erasure (S-075) | Active-account retention: **24 months inactive proposed** (Sumanth to confirm) |

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

### Delta 4 — Verify S-015 deletion jobs
Migration 246 references "Deletion jobs (S-015)" for `biometric_templates`.
Verify they exist; if not, fold template purging into the same cron.

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

---
*Toolkit: `create-architecture` (doc structure) · `database-reviewer`
PROACTIVE (registry schema, index/sweep design, JSONB-scan avoidance) ·
`review-adversarial` (red-team section) · `migration-architect` (zero-downtime
purge patterns: dry-run first, idempotent retries, storage-before-DB
ordering) · `verification-before-completion` (every claim above is
file:line-grounded — see references).*
