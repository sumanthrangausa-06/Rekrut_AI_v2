# Unified Interview Engine — v3 API Design

> **Status:** Draft (worker report to Rex, architect) | **Date:** 2026-10-10
> **Author:** Backend-architect specialist (agency-agents persona)
> **Inputs:** PRD v3.0 (`02-planning/unified-interview-engine/prd.md`), v2 architecture (`03-solutioning/unified-interview-engine/architecture.md` §5 REST, §6 security)
> **Constraints honored:** $0 infra (Express + Redis + node-cron only, no gateway); session-scoped JWT preserved; MFA step-up extended; no autonomous verdicts anywhere in the surface.

---

## 1. Route organization (answers design Q1)

**Recommendation: hybrid — session-scoped nesting for session-owned operations, top-level resources for cross-cutting domains.**

v2's single prefix `/api/v1/interview-sessions/:id/...` does not scale to ~11 new areas: it would push that resource past 20 routes, force awkward nesting for resources that outlive a session (consents, appeals, metrics), and muddle the auth matrix (session JWT vs recruiter JWT vs admin JWT on the same prefix).

**Rule:**
- **Nested** under `/api/v1/interview-sessions/:id/...` when the operation is owned by one session and naturally carries the session JWT: calibration, judgment, stage-1/integrity reports, observer toggle, challenges, signal batches (v2).
- **Top-level** when the resource spans sessions, has its own lifecycle, or is scoped to a different principal: `/api/v1/consents`, `/api/v1/appeals`, `/api/v1/integrity-events/:id/review`, `/api/v1/integrity/uncertain-queue`, `/api/v1/billing/*`, `/api/v1/admin/integrity-metrics`, `/api/v1/recruiters/me/*`, `/api/v1/candidates/me/*`.

This matches PRD's own instinct: CR-12/13 already wrote `/api/candidates/me/export` as top-level.

🟡 **Important:** PRD wrote those paths *without* version (`/api/candidates/me/export`). Align everything to `/api/v1/` per v2's URL-versioning decision.

---

## 2. Full route table (v3)

Legend: **S-JWT** = session JWT · **C-JWT** = candidate JWT · **R-JWT** = recruiter JWT · **A-JWT** = admin JWT · **MFA** = `mfa_verified` claim required (v2 §6 per-request step-up).

### 2.1 Consent (CR-21, FR-14)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/consents` | S-JWT | Record consent receipt. Body: `{session_id, type: recording\|biometric\|id_verification, text_version, accepted: bool, locale}`. Natural idempotent (upsert on candidate+session+type+version). `recording` declined → session cannot start. `biometric`/`id_verification` declined → FR-14a human-interview path. |
| GET | `/api/v1/consents/status?session_id=` | S-JWT | Per-type status: `{type, status: granted\|declined\|withdrawn\|stale, version, granted_at}`. `stale` = text_version newer than receipt → re-consent required. |
| DELETE | `/api/v1/consents/:type` | S-JWT | Withdrawal (inherently idempotent). **Must synchronously block further collection** at `requireBiometricConsent` middleware **and** push `consent_revoked` over the LiveKit data channel so the client stops capturing immediately. Biometric decline mid-session → FR-14a notification to recruiter. |

🔴 **Critical:** Withdrawal is a legal gate, not a data update. If DELETE only marks the DB row while in-flight frame/audio uploads continue for even seconds, CR-21 is violated. Middleware check on every biometric POST + data-channel kill signal are both required.

The v2 route `POST /api/v1/interview-sessions/:id/consent` is superseded by this table (v2 is still draft — one canonical contract).

### 2.2 Calibration (FR-56/58)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/interview-sessions/:id/calibration/start` | S-JWT | Opens calibration window (state machine: `not_started → calibrating`). Re-start → 200 with current state (natural idempotency). |
| POST | `/api/v1/interview-sessions/:id/calibration/complete` | S-JWT | Body: `{device_check, icebreaker_turn_ids}`. Server computes/stores baseline → `calibrated`. Re-complete → 200 replay. |
| GET | `/api/v1/interview-sessions/:id/calibration/baseline` | S-JWT or R-JWT | Baseline summary (quality floors, cohort reference) for report notes/debugging. |

Enforcement: `POST .../next-turn` returns `409 CALIBRATION_INCOMPLETE` until state = `calibrated` (FR-56 mandatory). Signal batches are *not* gated — device-check signals are calibration data.

### 2.3 Judge-first workflow + reports (FR-66/67/68)

Supersedes v2's single `GET .../report/recruiter` with a two-stage split:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/interview-sessions/:id/judgment` | R-JWT | Record initial judgment. Body: `{judgment: advance\|hold\|reject, reason}` (reason required, one sentence). Natural idempotent: upsert on (session_id, reviewer_id) → latest-wins, **append old value to `judgment_history`** (needed for FR-67 divergence logging). |
| GET | `/api/v1/interview-sessions/:id/report/stage1` | R-JWT + MFA | Assessment + behavioral, **integrity panel excluded server-side**. Always available (no judgment needed). |
| GET | `/api/v1/interview-sessions/:id/report/integrity` | R-JWT + MFA | Integrity observations (3-tier disclosure payload). Gated (see §3). |

New table: `judgments(session_id, reviewer_id, judgment, reason, created_at)` + `judgment_history` append log. Judgment is **per reviewer**: each reviewer does their own judge-first before seeing AI (faithful to FR-66; the AI-anchoring risk is per-person).

### 2.4 Appeals (FR-74/75)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/appeals` | C-JWT | Body: `{integrity_event_id, explanation}`. **409 `APPEAL_ALREADY_OPEN`** if an open case exists for that event (natural key: candidate + event). Creates case with `sla_due_at = now + 48h`. |
| GET | `/api/v1/appeals/queue` | R-JWT + MFA | Recruiter queue. Filters: `status=open\|escalated\|decided`, `sla_breach=true`, `session_id`. Scoped to recruiter's company. Sorted: SLA-breach first, then oldest. |
| GET | `/api/v1/appeals/:id` | C-JWT (own) or R-JWT | Case detail: flag + evidence + candidate explanation side by side, SLA clock. |
| PATCH | `/api/v1/appeals/:id` | R-JWT + MFA | Body: `{decision: uphold\|dismiss\|reinterview, reason}`. Reason required. `reinterview` → server creates new session (linked), appeal → closed. Naturally idempotent (same state twice = no-op); transitions guarded server-side (`open → decided`; no re-open without new case). |
| GET | `/api/v1/candidates/me/appeals` | C-JWT | Candidate's own cases. |

🟡 **Important:** 48h SLA is wall-clock (FR-74). Enforcement = cron sweep every 15 min (see §8); ≤15 min overshoot is acceptable.

### 2.5 Flag review (FR-69/70/71)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/integrity-events/:id/review` | R-JWT + MFA | Body: `{decision: confirm\|dismiss, reason}` — reason required **in both directions** (FR-69 symmetry). Natural idempotent: one active review per event; re-review updates + appends to review history. Dismiss → FR-75: flag removed from candidate's visible record, logged to FP-tracking dataset, quarantine check (flag-type dismissal rate >50% → auto-quarantine). |
| GET | `/api/v1/integrity/uncertain-queue` | R-JWT + MFA | Review queue for the 0.60–0.85 uncertain band (FR-59) + pending confirm/dismiss items. Filters: `mode`, `severity`, `from`, `to`, `session_id`. Sorted by priority (confidence desc, then age). Company-scoped. |
| GET | `/api/v1/interview-sessions/:id/integrity-events` | R-JWT + MFA | Session timeline (supports the review screen's evidence assembly; Tier 2/3 payload). |

Note the three queues are distinct: **uncertain-queue** (fusion-routed human review), **appeals/queue** (candidate-disputed cases, SLA-bound), **integrity-events timeline** (per-session evidence). Keep them separate endpoints — merging them would tangle three different SLAs and auth shapes.

### 2.6 Billing / metering (FR-76/77/78)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/billing/usage` | R-JWT | `{tier, period_start, period_end, interviews_used, interview_limit, overage_used, mock_unlimited: true, reset_at}`. |
| POST | `/api/v1/billing/overage/confirm` | R-JWT | **Requires `Idempotency-Key` header.** Body: `{acknowledged_charge: 1.50, currency: USD}`. Returns single-use `overage_token` (15-min TTL) that the next `POST /interview-sessions` consumes. Confirms bind 1:1 to the following session creation. |

Overage handshake (prevents double-charge and confirm-without-start races):

```
POST /interview-sessions  →  402 OVERAGE_CONFIRMATION_REQUIRED {charge: 1.50, currency: "USD"}
        (client shows FR-78 warning)
POST /billing/overage/confirm (Idempotency-Key)  →  200 {overage_token, expires_at}
POST /interview-sessions {overage_token}  →  201 (token consumed, single-use)
```

🔴 **Critical:** This is the only v3 POST that *must* use the `Idempotency-Key` header — it authorizes a charge-adjacent action with no natural key. Double-click/double-submit without it is a real double-charge path.

Tier-quota block (FR-76): `POST /interview-sessions` beyond limit → `402 TIER_LIMIT_REACHED` with `{limit, used, reset_at}` (see §10 error catalog for 402 vs 429).

### 2.7 Integrity metrics (FR-73)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/admin/integrity-metrics` | A-JWT + MFA | Filters: `mode`, `from`, `to`, `recruiter_id`. Response: `flag_rate`, `dismissal_rate`, `judge_divergence_rate`, `subgroup_flag_ratios`, `median_time_to_decision`, `ppv`, `override_audit_sample`, `generated_at`. Result cached 5 min (aggregations are expensive; dashboard staleness is fine — real-time alerting stays in the FR-55 alert pipeline, not this endpoint). |

🟡 **Important:** subgroup cells with n < 5 must be suppressed (k-anonymity floor) — small-n subgroup ratios can de-anonymize candidates.

### 2.8 Recruiter onboarding (FR-72)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/recruiters/me/onboarding/complete` | R-JWT | Body: `{modules_completed: [...], practice_cases: [{case_id, answer, passed}]}`. Server validates all 5 modules + 3–5 practice cases → `{integrity_access: granted, refresher_due_at}`. |
| GET | `/api/v1/recruiters/me/readiness` | R-JWT | `{onboarding_complete, modules_completed, practice_cases_passed, refresher_due_at, integrity_access}`. |

**Middleware gate** (`requireIntegrityAccess`): every integrity-surface route (report/integrity, uncertain-queue, event review, appeals queue, report/stage1? — see below) → `403 ONBOARDING_REQUIRED` unless onboarding complete **and** `refresher_due_at` not passed (FR-72 quarterly refresher). Scope decision needed: gate the *integrity* surfaces only, not all recruiter routes — a recruiter who hasn't onboarded can still schedule interviews, just can't see AI observations. 🟡 Migration note: engine is pre-launch, so day-one enforcement is clean; document the gate in the recruiter rollout runbook.

### 2.9 DSAR (CR-12/13)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/candidates/me/export` | C-JWT | **202** `{job_id, status: queued, sla_due_at: +72h}`. Idempotent: one pending job per candidate — replay returns current status. Kicks async job (see §6). |
| GET | `/api/v1/candidates/me/export/status` | C-JWT | `{status: queued\|processing\|ready\|failed, download_url?, url_expires_at?, failed_reason?}`. `download_url` = signed R2 URL, 72h validity, regenerated on status call. |
| DELETE | `/api/v1/candidates/me` | C-JWT | Body: `{confirm: true}`. **202** `{job_id, sla_due_at: +30d}`. One pending job per candidate (409 `DELETION_IN_PROGRESS` on duplicate). Async fan-out (see §7). Email confirmation on completion. |
| GET | `/api/v1/candidates/me/deletion-status` | C-JWT | Per-target progress: `{db, r2, b2, livekit, logs, backups}` each `pending\|in_progress\|done\|failed`. |

🔴 **Critical (legal):** The export must contain **all** personal data — including integrity flags — even though the report UI hides them from candidates (FR-48). GDPR Art. 15 doesn't honor product visibility rules. PRD §8.3 already lists flags in the export content — this design confirms it.

🟡 **Important:** Export *generates* biometric-containing artifacts → log `action=export` to `biometric_audit_log` (CR-05) and consider step-up auth for export (recommendation in §9).

### 2.10 Observer toggle (FR-82)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PATCH | `/api/v1/interview-sessions/:id/observer` | R-JWT | Body: `{enabled: bool}`. Human-mode only (`400` otherwise). Enable → enqueue observer job (existing `observer_jobs` pattern); disable mid-session → worker SIGTERM path + session marked unobserved. Naturally idempotent. Toggle recorded in session metadata (FR-82). |

---

## 3. Two-stage report gating (answers design Q2)

**Recommendation: synchronous DB check per request. Do NOT put judgment state in the JWT.**

`GET .../report/integrity` flow:

```
1. SELECT COUNT(*) FROM integrity_events
   WHERE interview_session_id = :id AND review_status != 'dismissed'
   → if 0: 200 {observations: [], note: "No integrity observations recorded for this session"}  (FR-68 — no judgment needed)
2. SELECT 1 FROM judgments WHERE session_id = :id AND reviewer_id = :me
   → if absent: 403 JUDGMENT_REQUIRED {next: "POST /interview-sessions/:id/judgment"}
3. else: 200 integrity payload (MFA + onboarding gates already passed)
```

**Trade-off analysis:**

| | DB check (recommended) | JWT claim |
|---|---|---|
| Freshness | Always current — dismissal/withdrawal reflected immediately | Stale: token minted pre-judgment lacks claim; re-mint churn on every judgment |
| Cost | One indexed PK lookup (~1–5 ms); report views are low-frequency | Saves ~1 ms per request |
| Security | Row is the workflow's source of truth anyway (FR-66/67 require logged judgments); no forgery surface | Claim must be re-issued per session — token-issuance endpoint becomes a confused-deputy risk; stale claims could leak integrity data post-withdrawal |
| Complexity | Zero new machinery | New mint/refresh flow, claim schema, revocation story |

The JWT-claim approach optimizes ~1 ms off an endpoint recruiters hit a few times per session while introducing a token-lifecycle problem. DB check wins on every axis that matters. ✅ **Confirmed.**

---

## 4. Idempotency (answers design Q3)

**Contract (only where needed):** `Idempotency-Key: <uuid-v4>` header → server stores `(key, route, request_hash) → response` in Redis, 24h TTL. Same key + same payload → replay stored response. Same key + different payload → `409 IDEMPOTENCY_KEY_REUSED`. Vary storage by route to prevent cross-endpoint replay.

**Which POSTs need it — decision table:**

| POST | Mechanism | Rationale |
|------|-----------|-----------|
| `POST /consents` | ✅ Natural key (candidate, session, type, version) → upsert | Legal receipt; duplicates deduped by natural key. No header needed. |
| `POST .../judgment` | ✅ Natural key (session, reviewer) → upsert + history append | Double-click = no duplicate rows; history preserves the original for FR-67. |
| `POST /appeals` | ✅ Natural key (candidate, event) → 409 if open case | Creating two cases for one flag = real harm (double SLA clocks). |
| `POST /integrity-events/:id/review` | ✅ Natural key (event) → one active review, update + history | Confirm/dismiss is a state set, not an event stream. |
| `POST /billing/overage/confirm` | 🔴 **Requires `Idempotency-Key`** | Only v3 POST with no natural key; authorizes a charge. |
| `POST .../calibration/start|complete` | ✅ State machine (start→calibrating→calibrated) | Re-POST returns current state. |
| `POST .../signal-batches` | ✅ v2: 202 + client retry (unchanged) | — |
| `DELETE /consents/:type` | ✅ Inherent | DELETE is idempotent. |
| `DELETE /candidates/me` | ✅ Natural key (candidate) → one pending job; 409 on duplicate | — |
| `PATCH .../observer`, `PATCH /appeals/:id` | ✅ Inherent | Setting state twice = no-op; transitions guarded. |
| `GET .../export` (job creation) | ✅ Natural key (candidate) → one pending job; replay status | GET-triggered job; safe by construction. |

**Summary:** only the money-adjacent endpoint needs the header. Everything else achieves idempotency through natural keys, upserts, or state machines — no extra machinery, no Redis key store to operate for the common paths. Document the `Idempotency-Key` contract anyway: future `reinterview` session creation on retry will need it.

---

## 5. Pagination / filtering (answers design Q4)

**Conventions (apply to all list endpoints: event timeline, uncertain-queue, appeals queue, metrics drill-downs):**

- Pagination: `?page=1&per_page=25` (default 25, max 100). Envelope:
  ```json
  { "data": [...], "meta": {"page": 1, "per_page": 25, "total": 132, "total_pages": 6}, "requestId": "..." }
  ```
- Filtering: `mode=mock,screening,ai-interview,human` (comma-separated multi), `from`/`to` (ISO-8601 dates, inclusive), `recruiter_id`, `severity=info,warning,critical`, `status=...`, `sla_breach=true`.
- Sorting: `sort=created_at|confidence|offset_start_ms&order=desc|asc` (whitelist per endpoint; unknown → `400 INVALID_FILTER`).
- Metrics response adds `filters_applied` echo + `generated_at` (cache transparency).

Page-based (not cursor) is the right call here: dashboard data is human-browsed, volumes are modest (hundreds of flags, not millions), and it matches repo conventions. Revisit cursors only if flag volume ever justifies it.

---

## 6. DSAR export — async (answers design Q5)

**Recommendation: async job + signed download link. Not synchronous.**

The export bundles profile + applications + scores + transcripts + consent records + integrity flags, rendered as **JSON + human-readable PDF**. Synchronous generation would:
- tie up an Express worker for minutes (PDF rendering is CPU-bound → event-loop blockage → violates the <2s turn-taking SLO for the other ~99 concurrent sessions),
- risk client timeouts on large transcripts, with no resume story.

**Pattern (fits $0, reuses existing machinery):**

```
GET /candidates/me/export → 202 {job_id, status: queued, sla_due_at}
        ↓  export processor: node-cron/interval poller in Express (same pattern as retention purges — no new process)
        ├─ assemble JSON + render PDF (paged/chunked to bound memory)
        ├─ upload to R2 `dsar-exports/` (encrypted, lifecycle auto-delete 30d)
        ├─ log action=export to biometric_audit_log (CR-05)
        └─ email signed link via Brevo
GET /candidates/me/export/status → {status, download_url (signed, 72h), url_expires_at}
```

**SLA reasoning:** legal SLA is 72h (PRD) / 30d GDPR / 45d CCPA — async comfortably meets it; target internal completion <4h with a stuck-job alert at 24h. The export content itself is a biometric-data artifact: encrypt at rest (per-candidate HKDF), sign the URL, and never log its contents.

---

## 7. DELETE /candidates/me — async orchestration (answers design Q6)

**Recommendation: async job with per-target status endpoint. Not synchronous.**

Fan-out targets: primary DB rows → R2 objects → B2 objects → LiveKit recordings/egress → log PII scrubbing → Neon backup tombstoning. A synchronous request would hang for minutes across 4+ systems and, on timeout, leave a **partially deleted** candidate — the worst compliance outcome (we'd certify deletion we didn't complete).

**Pattern:**

```
DELETE /candidates/me {confirm: true} → 202 {job_id, sla_due_at: now+30d}
        ↓  deletion worker (same cron-poller pattern; per-target idempotent deletes)
targets: db → r2 → b2 → livekit → logs → backups
GET /candidates/me/deletion-status → per-target {pending|in_progress|done|failed}
completion → email confirmation (CR-13) + stuck-target alert (>7d → admin)
```

**SLA reasoning:** legal SLA is 30 days (GDPR Art. 17 ≈ 1 month) — async is not just acceptable, it's the correct choice. Target internal completion <7d.

🔴 **Critical:** per-target deletes must be **idempotent and retried independently** (e.g., LiveKit API flakes while R2 succeeded). A job that fails atomically and retries everything from scratch will double-scrub or wedge. Track per-target state in `deletion_jobs`.

✅ **Confirmed alignment:** Neon backup tombstoning composes with the existing per-candidate HKDF crypto-erasure design (arch §4): destroy the derived key + record the tombstone → backup ciphertext becomes unrecoverable. That *is* the CR-13 tombstone mechanism.

🟡 **Important (log scrubbing):** application logs are the hardest target. Going forward: stop writing PII to logs (arch §7 already says never log transcripts/embeddings — extend to candidate names/emails). Document residual risk: unstructured log lines from before this change can't be reliably scrubbed; note it in the DPIA (CR-15).

🟡 **Important (audit log):** `biometric_audit_log` is append-only and retained 7 years. Deletion requests should **not** delete audit rows — instead pseudonymize `candidate_id` (one-way hash) and keep the access record. This needs legal sign-off; flag for the DPIA.

---

## 8. Webhooks vs polling (answers design Q7)

**Recommendation: no new webhooks. Extend the DB-polling job-table pattern (v2 ADR-005).**

| Worker | Trigger | Mechanism |
|--------|---------|-----------|
| AI Observer | session start | `observer_jobs` poll (v2, unchanged) |
| Appeal 48h escalation (FR-74) | SLA breach | **Cron sweep every 15 min** over `appeals WHERE status='open' AND sla_due_at < now` → escalate to admin. No job table needed — the appeals table *is* the queue. |
| DSAR export | candidate request | `export_jobs` poll (same claim pattern: `FOR UPDATE SKIP LOCKED`) |
| Deletion orchestration | candidate request | `deletion_jobs` poll, per-target state |
| Retention purges | schedule | existing node-cron (v2, unchanged) |

v2 already chose polling over webhooks for the observer worker, and the reasoning holds for the new workers: no new infra, no signature-verification surface, no at-least-once redelivery semantics to implement, and Express + one poller process is all we have. Webhooks remain appropriate **only** for external-to-us events (LiveKit room webhooks, already in v2 §6). Internal workers poll; that's the house pattern. ✅ **Confirmed.**

---

## 9. Rate limiting (answers design Q8)

Identity for all buckets = authenticated principal (session_id / candidate_id / recruiter_id from JWT), **never IP alone** (mobile NAT shares IPs). Redis counters (existing, arch §4).

| Endpoint group | Limit | Rationale |
|----------------|-------|-----------|
| Signal batches | existing (~40 req/s @100 sessions) | v2 — unchanged |
| `POST .../next-turn` (LLM) | per-session turn cap (20) + 30/min | client-loop defense; ConversationService budget already caps |
| Report stage1 / integrity | 60/min per recruiter + aggressive cache (immutable post-completion except reviews) | anti-scrape; FR-47 3s load via cache |
| `GET .../export`, `/export/status` | 3 export requests/day per candidate; 1 pending job | PII-exfiltration surface |
| `DELETE /candidates/me` | 1 request / 24h per candidate | fan-out is expensive; abuse vector |
| `POST /consents`, calibration | 10–30/min per session | spam, not sensitive |
| `POST .../judgment` | 20/min per recruiter | low-risk |
| Appeals create | 5/hour per candidate per event | queue-spam defense |
| Appeals queue / uncertain-queue / event review | 60/min per recruiter | operational UI |
| `GET /admin/integrity-metrics` | 30/min per admin + 5-min result cache | expensive aggregations |
| `GET /billing/usage` | 60/min per recruiter | cheap, dashboard-polled |
| `POST /billing/overage/confirm` | 10/min + `Idempotency-Key` required | money-adjacent |

**MFA step-up extension** (v2 §6 covers biometric routes + report views). New endpoints requiring `mfa_verified`:
- ✅ `GET .../report/integrity` and `.../report/stage1` — extend the existing "report views" step-up.
- ✅ `POST /integrity-events/:id/review` — FR-70 puts timestamped video clips on this screen.
- ✅ `GET/POST/PATCH /appeals*` (recruiter side) — evidence includes video clips.
- ✅ `GET /integrity/uncertain-queue`, `GET .../integrity-events` — same evidence surface.
- ✅ `GET /admin/integrity-metrics` — admins are MFA-enrolled generally; enforce claim here too.
- 🟡 `GET /candidates/me/export` — candidate's *own* biometric data leaving the system. Recommend step-up via email OTP (Brevo exists, $0 marginal). **Decision needed (Sumanth/legal):** is OTP-gated export required pre-launch, or is C-JWT + strict rate limit sufficient?
- Candidate session-JWT endpoints (consent, calibration) — **no MFA** (candidates have no TOTP enrollment; would break the interview UX).
- Billing: R-JWT suffices; note optional hardening (TOTP if ever enrolled for recruiters).

---

## 10. Error contract (answers design Q9)

**Envelope (extends v2's `requestId` rule):**

```json
{ "error": { "code": "CONSENT_REQUIRED", "message": "Biometric consent is required...", "details": {"type": "biometric", "resent_url": "/api/v1/consents"} }, "requestId": "..." }
```

- `code`: stable, machine-readable, UPPER_SNAKE. `message`: human-readable (safe to display). `details`: optional structured context (never PII/biometric content).
- Async jobs correlate via `job_id` echoed alongside `requestId`.

**Domain error catalog:**

| Code | HTTP | When |
|------|------|------|
| `CONSENT_REQUIRED` | 403 | biometric endpoint hit without valid consent (CR-21) |
| `CONSENT_VERSION_STALE` | 403 | consent text changed since receipt; re-consent required |
| `CONSENT_WITHDRAWN` | 403 | collection attempted after mid-session withdrawal |
| `JUDGMENT_REQUIRED` | 403 | integrity panel requested before judgment recorded |
| `ONBOARDING_REQUIRED` | 403 | integrity surface accessed before FR-72 onboarding/refresher |
| `MFA_REQUIRED` | 403 | missing/expired `mfa_verified` claim (v2 §6 pattern) |
| `GEO_PRICING_BLOCKED` | 403 | non-India customer attempting India PAYG (FR-77) |
| `TIER_LIMIT_REACHED` | **402** | monthly interview quota exhausted; `details: {limit, used, reset_at}` (FR-76) |
| `OVERAGE_CONFIRMATION_REQUIRED` | **402** | session start would incur overage; `details: {charge, currency}` — client then calls confirm (FR-78) |
| `APPEAL_ALREADY_OPEN` | 409 | duplicate appeal for same event |
| `EXPORT_IN_PROGRESS` / `DELETION_IN_PROGRESS` | 409 | duplicate DSAR/deletion request (or replay 202 — pick one, document it) |
| `IDEMPOTENCY_KEY_REUSED` | 409 | same key, different payload |
| `REPORT_NOT_READY` | 409 | report requested before session completion |
| `SESSION_STATE_CONFLICT` | 409 | invalid transition (e.g., complete before calibration) |
| `CALIBRATION_INCOMPLETE` | 409 | scored operation before calibration completes |
| `OBSERVER_NOT_APPLICABLE` | 400 | observer toggle on non-human session |
| `INVALID_FILTER` | 400 | unknown/contradictory query params |
| `VALIDATION_ERROR` | 400 | Zod failures (v2 — unchanged, with field details) |

**402 vs 429:** `TIER_LIMIT_REACHED` / `OVERAGE_CONFIRMATION_REQUIRED` are **402** (quota/business-rule exhaustion — the remedy is upgrade/wait/pay, and the response carries `reset_at`). **429** is reserved for rate-limit buckets (remedy: back off; carries `Retry-After`). Conflating them breaks client retry logic — keep them distinct. ✅

**FR-65 contract test:** no `integrity_score` field may appear in any API response. Add an automated contract test asserting its absence across all report/integrity payloads. 🔴 **Critical:** this is a PRD-level prohibition; a single leaked aggregate field is a compliance finding.

---

## 11. Severity-flagged findings for Rex

### 🔴 Critical (will break if missed)
1. **Overage confirm idempotency** — `Idempotency-Key` required + single-use token bound 1:1 to the next session creation. Without both, double-charge and confirm-without-start races exist.
2. **Consent withdrawal must kill collection synchronously** — middleware gate on every biometric POST *plus* LiveKit data-channel `consent_revoked` push. DB-row-only withdrawal violates CR-21 for in-flight uploads.
3. **DSAR export includes integrity flags** — GDPR Art. 15 overrides FR-48's UI hiding. PRD already lists them; the implementation must not "helpfully" filter them out.
4. **Deletion must be per-target idempotent with independent retry** — a monolithic retrying job risks partial deletion, the worst compliance outcome. Track per-target state in `deletion_jobs`.
5. **Judgment gating = DB check, not JWT claim** — avoids token churn, stale claims, and post-withdrawal leakage.
6. **No `integrity_score` anywhere** — automated contract test on all report/integrity payloads (FR-65).
7. **`requireIntegrityAccess` middleware** on all integrity surfaces — without it, judge-first/dismissal/appeal workflows are exposed to reviewers who never did FR-72 onboarding.

### 🟡 Important (should fix / decide)
1. Align PRD's unversioned `/api/candidates/me/export` → `/api/v1/candidates/me/export`.
2. Zero-flag shortcut counts **undismissed** events only (a dismissed-only session shouldn't force judgment).
3. Subgroup metrics: suppress cells with n < 5 (k-anonymity).
4. Appeal 48h escalation = cron sweep every 15 min (≤15 min overshoot acceptable).
5. Export step-up auth (email OTP via Brevo?) — decision for Sumanth/legal.
6. Audit-log handling on deletion: pseudonymize, don't delete rows — needs DPIA/legal sign-off (CR-15).
7. Log-scrubbing residual risk: stop PII in logs going forward; document pre-change logs as known residual in the DPIA.
8. Supersede v2's `POST /interview-sessions/:id/consent` and `GET .../report/recruiter` with the v3 contracts (v2 is draft — do it before anything ships).
9. Cache integrity reports (immutable post-completion) and metrics (5 min) — separate from the FR-55 real-time alert pipeline.
10. `reinterview` appeal outcome creates a **new** session (linked), never reuses the old one.

### ✅ Confirmed (aligns with v2, no change needed)
1. Session-scoped JWT pattern preserved across all new endpoints; auth matrix follows v2 §6.
2. Signal batches stay 202 + client retry; no new webhooks — DB-polling job tables for export/deletion/escalation (house pattern per ADR-005).
3. $0 infra holds: Express middleware + Redis + node-cron only. No gateway, no new services.
4. Per-candidate HKDF crypto-erasure *is* the CR-13 Neon backup tombstone mechanism.
5. 402 for quota/business-rule exhaustion, 429 for rate limits — distinct semantics, distinct remedies.

---

## 12. Open questions for Rex → Suga → Sumanth

1. **Export step-up auth:** C-JWT + rate limit vs. email-OTP step-up for DSAR export? (Legal input advisable.)
2. **Judgment scope:** per-reviewer judgment (recommended) vs. per-session (first reviewer's judgment unlocks for all)? Affects the `judgments` table key.
3. **Onboarding gate scope:** integrity surfaces only (recommended) vs. all recruiter report access?
4. **Appeal re-decision policy:** can a recruiter change uphold→dismiss after deciding, or is a decided appeal final? (Affects PATCH transition guards.)
5. **Calibration enforcement point:** `next-turn` only (recommended), or also block challenge issuance pre-calibration?

---

*End of v3 API design. Worker report — no approvals made. Awaiting Rex's synthesis and Sumanth's gate decisions.*
