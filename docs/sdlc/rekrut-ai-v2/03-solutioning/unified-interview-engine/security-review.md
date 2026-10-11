# Unified Interview Engine — Security Review

> **Reviewer:** Security review specialist (worker) → reports to Rex (System Architect)
> **Date:** 2026-10-10
> **Scope:** `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/architecture.md` (v1 draft)
> **Methodology:** `~/workspace/skill-repos/ecc/agents/security-reviewer.md` (OWASP Top 10, PII handling, secrets management)
> **Status:** FINDINGS ONLY — no approvals, no merges, no "done" declarations.

This review is architecture-level. Code does not exist yet for the new components, so findings are design gaps and required controls, grounded in the existing codebase patterns (`lib/document-crypto.js`, `lib/crypto-utils.js`, `middleware/dataAccessAudit.js`, `middleware/rbac.js`, `middleware/api-auth.js`, `server/services/livekit.js`, `lib/auth.js`).

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical (must fix before any biometric collection) | 4 |
| 🟡 Important (should fix) | 9 |
| 🟢 Suggestion (nice to have) | 5 |

**Bottom line:** The architecture gets the structural shape right (separate biometric tables, audit log table, consent-gated collection, human-review-only integrity decisions). But it has four launch-blocking gaps: (1) no auth design on the signal/integrity POST endpoints, (2) audit log append-only is aspirational, not enforced, (3) zero MFA design despite CR-08, and (4) third-party LLM sharing has no DPA/contractual path despite CR-09. The PRD's own pre-launch gate (Section 8.3) already lists most of these as checkboxes — the architecture must be updated to show *how* each is satisfied.

---

## 🔴 Critical findings

### C-1. Signal and integrity POST endpoints have no authentication/authorization design

**Criteria:** 7 (API authentication), 4 (client-side tampering), OWASP A01:2021 Broken Access Control

**Finding:** The data-flow diagram shows `IntegrityMonitor →|POST events| IntegrityService` and `FrameAnalyzer/VoiceAnalyzer →|POST signals| AnalysisService`, but the architecture specifies no auth for these endpoints. Without it, anyone can POST fabricated `integrity_events` or `behavioral_signals` for any `interview_session_id` (IDOR on the body-supplied session id). A candidate could inject fake "clean" signals to mask cheating, or flood another candidate's session with high-severity events to sabotage them.

**Remediation:**
1. Require the interview **session-scoped JWT** on every signal/event POST (minted at session start by `SessionService`; short TTL, e.g. 4h, refreshed on activity). Reuse the existing `authMiddleware` pattern from `lib/auth` — do not invent a new auth scheme.
2. **Object-level authorization:** the `interview_session_id` in the request body/URL MUST match the session claim in the token. Never trust a client-supplied session id alone.
3. Bind the token to the LiveKit participant identity (`candidate-{id}`) so a token stolen from one session cannot be replayed into another.
4. Apply the existing `middleware/api-rate-limit.js` / `distributed-rate-limiter.js` per session (2fps × 100 sessions = sustained write load; also a DoS vector).
5. Zod-validate every payload at the route boundary (the architecture already mandates Zod interfaces — enforce it here first).

### C-2. `biometric_audit_log` append-only is not enforced anywhere

**Criteria:** 2 (audit log integrity), CR-05 / FR-54 (append-only, 7-year retention)

**Finding:** The DDL creates a plain table. Nothing prevents `UPDATE`/`DELETE` — not a trigger, not `REVOKE`, not RLS, not application code. A compromised app credential or a malicious/buggy admin query can silently rewrite history, which defeats the entire purpose of CR-05. "Append-only" in a comment is not a control.

**Remediation (defense in depth):**
1. **Database trigger (primary control):** `CREATE TRIGGER prevent_audit_mutation BEFORE UPDATE OR DELETE ON biometric_audit_log FOR EACH ROW EXECUTE FUNCTION raise_audit_immutable();` — the function raises an exception. Triggers apply even to the table owner, unlike `REVOKE`.
2. **Least privilege:** the app's Postgres role gets `GRANT INSERT, SELECT` only — no `UPDATE`/`DELETE`. Run migrations under a separate DDL role (Neon supports multiple roles).
3. **Application layer:** all writes go through `ComplianceService.logAccess()`; no raw SQL against the table elsewhere. Wire the existing `middleware/dataAccessAudit.js` onto every biometric route (it already logs after 2xx responses — extend its resource types to `biometric_*`).
4. Consider hash-chaining each row to the previous row's hash (`prev_hash` column) so tampering is *detectable* even if the DB is fully compromised. $0, ~20 lines.

### C-3. MFA for biometric access (CR-08) has no design at all

**Criteria:** 8 (MFA enforcement)

**Finding:** CR-08 requires MFA for admin access to biometric data. The architecture never mentions MFA. Verified: there is no TOTP/MFA code anywhere in the current codebase (`totp|mfa|2fa|otplib|speakeasy` — zero hits). This is a hard compliance requirement with no implementation path.

**Remediation:**
1. Implement TOTP MFA for admin/recruiter roles using `otplib` ($0, no external service). Enrollment: QR code at first admin login; store only the TOTP *secret* encrypted with `ENCRYPTION_KEY` (never plaintext).
2. **Enforce at the architecture level, not just at login:** mint a short-lived `mfa_verified` claim (e.g. 8h TTL, step-up re-challenge for biometric report views) in the JWT. Every route that touches biometric tables or `ReportService` recruiter reports MUST check this claim — login-time MFA alone does not survive session hijack.
3. Deny-by-default: if the claim is absent/expired, biometric reads return 403 with an audit-logged denial (also satisfies CR-05's "every access logged" for denied attempts).
4. Document the fallback for lost MFA devices (admin recovery flow) — otherwise this becomes a lockout incident, not a security feature.

### C-4. LLM data sharing violates CR-09 without DPAs; biometric features must never reach third-party APIs

**Criteria:** 6 (LLM data sharing), CR-09

**Finding:** `AnalysisService` sends transcripts to Groq/Cohere for "linguistic forensics." Two problems:
1. **No DPA path.** CR-09 allows third-party processors *only* "with signed DPAs" and "in-memory only with no retention." The architecture has no DPA section; the PRD lists "DPA signed with any third-party AI provider" as an unchecked pre-launch gate item. Shipping the Groq/Cohere call path without executed DPAs is a per-record BIPA/GDPR violation exposure.
2. **Scope creep of what's sent.** Voice-derived features (F0, eGeMAPS, emotion vectors) are biometric identifiers under BIPA ("voiceprint") and biometric data under GDPR Art. 9. The architecture does not state what subset goes to the LLM. Raw features must never leave the first-party boundary.

**Remediation:**
1. **Data minimization at the LLM boundary:** send only the text transcript + aggregate scores. Never send raw F0/intensity/spectral-flux series, emotion vectors, gaze coordinates, or face landmarks to any third-party API. Enforce with a sanitizer function in `AnalysisService` with unit tests asserting banned keys are stripped.
2. Execute DPAs with **every** processor that touches biometric-adjacent data — this includes **LiveKit Cloud** (raw audio/video of candidates flows through it), Groq, Cohere, and the storage providers (R2/B2). Verify each provider's data-retention terms; prefer zero-retention API options where offered.
3. If a DPA cannot be obtained for a provider, that provider is disqualified for any biometric-adjacent workload — including transcripts of voice interviews. Document the per-provider decision in the architecture.
4. Log every third-party transmission (what data type, to whom, when) in the audit trail — this is the evidence CR-09's "when audited" clause will demand.

---

## 🟡 Important findings

### I-1. PII segregation: "separate tables" is necessary but the key management is unspecified

**Criterion:** 1. **Related PRD:** CR-04 (separate tables AND different encryption key AND no direct JOIN to identity).

**Finding:** The architecture states "separate tables + encryption keys, not separate DB instances ($0 constraint)" — the right call. But it never specifies *how* keys are managed. CR-04 requires a *different* encryption key for biometric data, and key derivation from a single master without domain separation would not satisfy the spirit of the requirement.

**Remediation ($0):**
1. Add a dedicated `BIOMETRIC_ENCRYPTION_KEY` env var (Render env config; never in code — the existing `document-crypto.js` pattern already reads keys from env and throws in production when missing).
2. Derive **per-candidate** keys via HKDF-SHA256: `HKDF(master=BIOMETRIC_ENCRYPTION_KEY, info="biometric-candidate-{id}-v1")` — reuse the exact pattern in `lib/document-crypto.js` (`deriveUserKey`). This gives CR-04's "different key" plus crypto-erasure for free (see I-9).
3. Keep the linkage indirection CR-04 demands: biometric tables reference `interview_sessions.id`; the session→user mapping lives in the session table, and no view/procedure should expose a direct template→name/email join to the app role.

### I-2. ID photo 24-hour deletion is not crash-safe

**Criterion:** 3. **Related PRD:** "extract embedding → delete image within 24 hours → keep only match score"; FR-53 (daily cron).

**Finding:** Deletion is assigned to `ComplianceService.runRetentionPurge()` (daily cron). If the server crashes or the cron fails between embedding extraction and the purge run, ID images (government IDs — the highest-sensitivity artifact in the system) persist indefinitely with no backstop. There is also no `expires_at` marker on the stored image record, so a failed cron is silent.

**Remediation:**
1. **Crash-proof backstop ($0):** store ID images under a dedicated R2/B2 prefix (e.g. `id-verification/`) with a **bucket lifecycle rule** auto-deleting objects after 1 day. Lifecycle deletion happens even if the app is down.
2. Add an `expires_at` column; the purge job deletes `WHERE expires_at < NOW()` and is idempotent (safe to re-run, logs record counts per FR-53).
3. Alert (not just log) when a purge run deletes 0 rows while `expires_at`-overdue rows exist — that's the signal the lifecycle rule or cron is broken.
4. Store only the embedding (pgvector) + match score + image hash; never retain the raw image beyond the 24h window for any reason, including debugging.

### I-3. LiveKit bot: token least-privilege and impersonation risk are unspecified

**Criterion:** 5.

**Finding:** `AIObserverService` joins rooms as `ai-observer-{sessionId}`. The architecture does not specify the token grants for the bot, and identity strings are predictable. If observer tokens are minted with publish or room-admin grants, a leaked token lets an attacker inject media into an interview or eavesdrop on other rooms.

**Remediation:**
1. Mint observer tokens **server-side only** (the existing `server/services/livekit.js` mints tokens with `LIVEKIT_API_KEY/SECRET` from env — never expose the API secret to the browser; verify `AIObserverService` follows this).
2. Grants: `canSubscribe: true`, `canPublish: false`, `canPublishData: false`, room-admin `false`, scoped to the single room. Short TTL (session duration + buffer).
3. Validate LiveKit webhooks with the API secret (check incoming webhook signatures) — room events drive observer lifecycle.
4. Unpredictable room names (UUID, not `interview-{sessionId}` sequential) so room enumeration is infeasible.

### I-4. JSONB `details` fields will hold raw biometric vectors in plaintext

**Criterion:** 9. **Related PRD:** CR-03 (AES-256 at rest for biometric templates).

**Finding:** `integrity_events.details` "may contain gaze coordinates"; `behavioral_signals.details` "may contain emotion vectors." These are biometric identifiers stored as plaintext JSONB. Any `SELECT` on these tables exposes raw vectors; they also linger in Neon backups/WAL beyond the retention window. Neon's storage-layer encryption does not satisfy CR-03's intent (application-level encryption of *templates*).

**Remediation:**
1. **Data minimization first:** persist derived events ("gaze off-screen 3.2s", "blink-rate anomaly 0.91"), not raw coordinate/vector series. Raw vectors stay in browser memory or the ephemeral session — they are not needed for human review.
2. For any vector that must persist (e.g. face embedding for ID match), encrypt at the application layer with the per-candidate biometric key (AES-256-GCM via the `document-crypto.js` pattern) before INSERT; store `{iv, tag, ciphertext}` — or use `pgcrypto`'s `pgp_pub_encrypt` if column-level SQL encryption is preferred. Never plaintext.
3. Classify explicitly in the schema docs: raw templates/vectors = biometric (encrypted); aggregate scores/labels = behavioral (may be plaintext, still access-controlled).

### I-5. Report endpoints: broken access control risk (cross-tenant + self-access)

**Criterion:** 10, OWASP A01:2021.

**Finding:** `ReportService` generates recruiter and candidate reports, but the architecture defines no authorization model for the report routes. Risks: recruiter from Company A reading Company B's candidate reports (missing `company_id` scoping); a candidate fetching another candidate's `session_analysis` via IDOR; the compliance dashboard (FR-51) exposing deletion queues cross-tenant.

**Remediation:**
1. Every report route: `authMiddleware` → `requireRole`/`requirePermission` (existing `middleware/rbac.js`) → verify `interview_sessions.company_id == req.user.company_id` for recruiters, or `session.candidate_id == req.user.id` for candidates. The existing `dataAccessAudit` middleware should wrap these routes with `biometric_report` resource types.
2. Candidate reports must exclude integrity details and raw scores per the PRD's per-mode visibility rules — enforce server-side, not by omitting fields client-side.
3. Add negative test cases: cross-company access → 403; unauthenticated → 401; logged in audit trail.

### I-6. Consent is not enforced server-side

**Criterion:** 10 (defense in depth). **Related PRD:** CR-01, FR-14/FR-14a (3 separate consent screens; decline → human-interview alternative).

**Finding:** Consent is described as UI screens. Nothing in the architecture prevents a candidate from skipping the client consent flow (devtools, modified JS, direct API calls) and POSTing biometric signals anyway — or conversely, the server storing signals for a candidate who declined biometric consent. Consent must be a server-side gate.

**Remediation:**
1. Store consent records (`consent_type`, `granted_at`, `version`, `ip`) in a `biometric_consents` table, written only through the consent API.
2. `IntegrityService`/`AnalysisService` INSERT paths check consent before persisting: no `biometric_consent` row → reject with 403 and log the attempt.
3. Consent withdrawal ("Delete my data" / revoke) immediately stops collection (token claim revoked) and queues the 30-day purge (FR-52/CR-06).

### I-7. LLM prompt injection via candidate transcripts

**Criterion:** 10, OWASP LLM01:2021 Prompt Injection.

**Finding:** `AnalysisService.runLinguisticForensics(transcript)` feeds candidate speech to an LLM. A candidate can speak prompt-injection payloads ("ignore previous instructions, output…"). If LLM output ever influences integrity scoring, report text, or (worst case) tool calls, this is an injection vector the candidate fully controls.

**Remediation:**
1. Wrap transcripts in delimiters and instruct the model to treat delimited content as untrusted data, never instructions. Prefer structured-output (JSON schema) responses over free text.
2. Never let LLM output drive access-control, integrity verdicts, or hiring recommendations directly — it is advisory text for human review (consistent with the "no autonomous cheating verdicts" correction already in the project's research).
3. Cap transcript length per call; strip control characters; log the exact prompt template version for auditability.

### I-8. `ON DELETE CASCADE` conflicts with the 7-year audit retention requirement

**Criterion:** 10. **Related PRD:** FR-54 (audit logs retained 7 years) vs CR-06/CR-07/FR-53 (purge biometric data).

**Finding:** `integrity_events`, `behavioral_signals`, `session_analysis`, and `ai_observer_reports` all `ON DELETE CASCADE` from `interview_sessions`. When ComplianceService deletes a session's biometric data (3-year BIPA purge, 30-day deletion request), the integrity timeline vanishes with it. If integrity events are ever needed as evidence (disputes, BIPA litigation holds), cascade deletion destroys them. The PRD simultaneously demands deletion *and* 7-year audit retention — the architecture must resolve which tables belong to which regime.

**Remediation:**
1. Decide explicitly per table: biometric payload tables (signals, embeddings) → hard delete on purge; `biometric_audit_log` → never deleted (7 years, append-only per C-2); `integrity_events` → either anonymized (strip `details`, keep event_type/severity/timestamps) or retained under litigation-hold exemption with documented legal basis.
2. Replace `ON DELETE CASCADE` with application-driven purge in `ComplianceService` so each table gets its correct deletion semantics. Cascades are invisible and bypass the audit log.

### I-9. Backups defeat deletion — use crypto-erasure

**Criterion:** PII handling / GDPR Art. 17, DPDP Act erasure.

**Finding:** "Delete my data → purge within 30 days" (CR-06) deletes rows, but Neon point-in-time-recovery backups retain the ciphertext/plaintext for the backup window. True erasure from all backups is operationally infeasible on a $0 budget.

**Remediation ($0):** with per-candidate derived keys (I-1), deletion = delete rows **and** destroy the candidate's derived key material (delete the key record / rotate the derivation salt version for that candidate). Ciphertext remaining in backups becomes permanently unrecoverable — this is the industry-standard answer to "erasure vs. backups" and should be documented as the destruction method CR-02's public policy page describes.

---

## 🟢 Suggestions

### S-1. Verify TLS 1.3 minimum on Render and Neon
CR-03 requires TLS 1.3 in transit. Render terminates TLS at its edge and Neon enforces TLS for Postgres — but the *minimum version* must be verified, not assumed. Add it to the pre-launch security scan checklist. If either endpoint negotiates 1.2, CR-03's acceptance criterion ("all API transmissions use TLS 1.3") fails.

### S-2. R2/B2 lifecycle rules as the deletion backstop for all media
Extend the I-2 lifecycle-policy pattern: videos pending the 90-day purge should also live under a prefix with a lifecycle rule. Belt and suspenders against cron failure, at $0.

### S-3. Signal-dropout as a first-class integrity signal
A candidate who disables MediaPipe or blocks the POST endpoint produces *absence* of signals. The server should treat sustained signal gaps (e.g. no visual signals for >30s mid-interview, impossible gaze-velocity jumps, timestamps from the future) as integrity events themselves. This partially mitigates the client-tampering threat (criterion 4) without trusting the client.

### S-4. Partitioning + retention alignment
The architecture already plans monthly partitioning on `integrity_events`/`behavioral_signals` (ADR-001) — good. Align partition drops with the retention schedule: dropping a whole partition is cheaper and more auditable than row-by-row deletes, and partition-drop is trivially logged.

### S-5. Publish the biometric policy page (CR-02) before any test collection
Even internal QA with real faces/voices counts as biometric collection under BIPA. The `/privacy/biometric-policy` page and the 3-screen consent flow must exist before the first staged interview with a real human — not just before production launch.

---

## Confirmed correct (no changes needed)

1. **Separate biometric tables** (`integrity_events`, `behavioral_signals`, `ai_observer_reports`, `biometric_audit_log`) — correct structural basis for CR-04 segregation.
2. **Audit log field coverage** — `user_id`, `user_role`, `action`, `data_type`, `candidate_id`, `ip_address`, timestamp: matches CR-05/FR-54 exactly.
3. **Secrets in env vars** — LiveKit (`LIVEKIT_API_KEY/SECRET/URL`), `ENCRYPTION_KEY`, `AI_KEYS_JSON`: matches the skill's secrets guidance; no hardcoded credentials found in the reviewed services.
4. **Existing crypto pattern is sound and reusable** — `lib/document-crypto.js` implements AES-256-GCM with HKDF-SHA256 key derivation and throws in production when `ENCRYPTION_KEY` is missing (fail-secure). The biometric key design (I-1) should copy this pattern, not invent a new one.
5. **Existing audit middleware** — `middleware/dataAccessAudit.js` already implements post-2xx access logging via `auditLogService`; wiring it to biometric routes is reuse, not new code.
6. **Existing RBAC + rate limiting** — `middleware/rbac.js` (permission-based, denial logging) and the rate limiters are the right enforcement points for C-1 and I-5.
7. **Client-side ML inference** — running MediaPipe/Web Audio in-browser means raw video/audio never traverses the network for analysis; only derived signals are POSTed. This is a genuine privacy win — but note the AIObserverService LiveKit bot reintroduces server-side raw media access (see I-3, C-4).
8. **Conservative integrity thresholds (≥0.85, 3+ signals) + human review** — no autonomous cheating verdicts. This is the correct posture both ethically and legally (avoids automated-decision issues under GDPR Art. 22).
9. **ID flow design** (embedding → 24h image deletion → keep match score) — correct data-minimization shape; needs the crash-safety hardening in I-2.
10. **PRD pre-launch compliance gate (§8.3)** already lists the DPA, encryption-verification, consent, and retention checkboxes — the architecture needs to show the mechanism behind each checkbox, which is what the findings above specify.

---

## Criterion coverage map

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | PII segregation / key management | 🟡 I-1 |
| 2 | Audit log append-only enforcement | 🔴 C-2 |
| 3 | ID photo 24h deletion crash-safety | 🟡 I-2 |
| 4 | Client-side tampering threat model | 🔴 C-1 (auth) + 🟢 S-3 (dropout detection) |
| 5 | LiveKit bot security | 🟡 I-3 |
| 6 | LLM data sharing / CR-09 | 🔴 C-4 |
| 7 | API auth on signal POSTs | 🔴 C-1 |
| 8 | MFA for biometric access | 🔴 C-3 |
| 9 | JSONB details encryption | 🟡 I-4 |
| 10 | OWASP Top 10 (injection, access control) | 🟡 I-5, I-6, I-7, I-8 |

*Report ends. All findings are recommendations for Rex's architecture decision — nothing here is approved or final.*
