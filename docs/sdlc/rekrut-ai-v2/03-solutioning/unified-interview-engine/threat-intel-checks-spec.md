# Threat-Intel Checks for Applicant Fraud Detection — Spec

**Issue:** #764 (S-081, Sprint 9)
**Status:** Draft — awaiting Sumanth's approval
**Author:** Rex (Solution Architect)
**Date:** 2026-10-12

---

## 1. Purpose

Aperture (competitor) checks applicants against open-source threat intelligence — fraud rings, synthetic-identity patterns, known bad-actor indicators. Rekrut AI has zero external intel inputs. This spec defines how we add threat-intel checks to the screening/interview flow.

**What this spec defines:** integration points, data sources, check pipeline, privacy/legal boundaries, report format, and what we explicitly will NOT do.

**Design principle:** Threat-intel produces **observations for human review, never verdicts**. Same as the 14-event integrity taxonomy — a threat-intel hit is a signal the recruiter investigates, not an auto-reject.

---

## 2. Threat Classes in Scope

| Threat | Description | Example Indicators |
|--------|-------------|-------------------|
| **Synthetic identities** | Fabricated personas combining real + fake PII | SSN/name/DOB mismatches, thin credit files with high-velocity applications |
| **Fraud rings** | Coordinated groups submitting multiple applications | Shared IP addresses, device fingerprints, phone numbers across applications |
| **North-Korean remote-worker patterns** | DPRK operatives seeking remote tech employment | Known email patterns, VPN/proxy usage from sanctioned regions, resume template matches |
| **Credential stuffing** | Reused credentials across platforms | Email in known breach datasets (haveibeenpwned-style) |

**Out of scope:**
- Criminal background checks (different legal regime — FCRA in US, requires separate consent)
- Credit checks (FCRA-regulated, not relevant for most roles)
- Social media scraping (privacy-invasive, legally dubious)
- Continuous monitoring post-hire (this is pre-hire screening only)

---

## 3. Data Sources

### 3.1 Proposed Sources (privacy-engineer reviewed 2026-10-12)

| Source | Type | What It Provides | Cost | Status |
|--------|------|------------------|------|--------|
| **FBI IC3** (public reports) | US government | Fraud trends, not individual lookups | Free | ✅ LAWFUL |
| **HaveIBeenPwned API** | Commercial (free tier) | Email breach exposure (k-anonymity) | Free tier | ⚠️ QUESTIONABLE — ToS verification required before implementation (see §3.4) |
| **AbuseIPDB** (free tier) | Commercial (free tier) | Proxy/VPN/datacenter IP detection | Free tier | ✅ LAWFUL with caveats — DPIA + notice update required; India consent-gated |

**Removed per privacy-engineer review:**
- **CISA AIS** — ❌ REMOVED. Purpose mismatch: AIS is a cyber-defense indicator-sharing program; feeding applicant PII for HR screening violates participation terms. Also US-only (cannot cover EU/India) and raises Schrems II transfer issues.
- **Open-source fraud-ring datasets** — ❌ REMOVED. Accuracy unguaranteed (GDPR Art. 5(1)(d), DPDP §8(5)), no correction mechanism, contradicts §7.3's no-shared-blocklist commitment. May be reconsidered only with defined provenance/governance and candidate dispute path.

### 3.2 Sources Explicitly Rejected

| Source | Why Rejected |
|--------|--------------|
| CISA AIS | ❌ Purpose mismatch — cyber-defense program, not HR screening; US-only; Schrems II issues (privacy-engineer BLOCKER 3) |
| Open-source fraud-ring datasets | ❌ Accuracy unguaranteed, no correction mechanism, contradicts no-shared-blocklist commitment (privacy-engineer BLOCKER 2) |
| Commercial identity-verification APIs (Socure, Jumio, etc.) | Cost ($0 budget); also overlaps with existing `identity_verifications` table |
| Dark-web monitoring services | Legally gray; chain-of-custody issues for evidence |
| Facial-recognition databases (Clearview-style) | BIPA nightmare; fundamentally incompatible with our consent architecture |
| Government watchlists (OFAC, etc.) | Overkill for hiring; false-positive rate unacceptable |

### 3.4 HIBP Terms of Service (pre-implementation gate)

Before implementation, verify HaveIBeenPwned's acceptable-use terms for:
(a) use in employment-screening decisions, (b) free-tier rate/volume fit, (c) redistribution of breach names in recruiter UIs. **If terms prohibit screening use, drop the source.** Breach data is stolen personal data — EU processing needs Art. 6 basis + DPIA; breach attribution is frequently wrong/partial (Art. 5(1)(d) accuracy). Signal severity stays at `info` — never escalates to warning/critical.

### 3.3 The $0 Constraint

All proposed sources have free tiers or are public. If a source requires payment, it is out of scope until Sumanth approves budget. The spec MUST NOT assume any paid API.

---

## 4. Integration Points

### 4.1 Where Checks Run

```
Candidate applies → Application created
                         │
                         ▼
              ┌─────────────────────┐
              │ Threat-Intel Check   │ ← NEW (async, non-blocking)
              │ (runs in background) │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Screening / Interview│
              │ (proceeds normally)  │
              └─────────────────────┘
```

**Non-blocking by design:** Threat-intel checks run asynchronously after application submission. They NEVER block the candidate from proceeding to screening/interview. Results arrive as observations the recruiter reviews alongside other signals.

**Rationale:** False positives are inevitable with threat-intel. Blocking a candidate on a probabilistic signal before a human reviews it is both unfair and legally risky.

### 4.2 What Triggers a Check

| Trigger | When |
|---------|------|
| New job application | Async, within 5 minutes of submission |
| Recruiter manual request | On-demand re-check from candidate profile |

**Not triggered by:** interview sessions (the observer handles in-session integrity), profile views, or any candidate action beyond applying.

### 4.3 Data Collected for Checks

**Minimal set** — only what's needed for the checks:
- Email address → breach exposure check
- IP address (from application submission) → reputation check
- Phone number (if provided) → fraud-ring cross-reference
- Name + location → synthetic-identity pattern check

**NOT collected for threat-intel:**
- SSN or government IDs (we don't collect these at application time)
- Device fingerprints (would require additional consent)
- Biometric data (separate system, separate consent)

---

## 5. Check Pipeline

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Collect    │───▶│    Check     │───▶│    Report    │
│ (minimal PII)│    │ (each source)│    │ (observations)│
└──────────────┘    └──────────────┘    └──────────────┘
                           │
                    ┌──────▼──────┐
                    │  Deduplicate │
                    │  + Confidence │
                    └──────────────┘
```

### 5.1 Per-Source Checks

Each source runs independently. A source failure does not block other sources.

**Email breach check (HaveIBeenPwned-style):**
- Input: candidate email (k-anonymity: only first 5 chars of SHA-1 hash sent)
- Output: breach count, breach names, breach dates
- Signal: `email_in_breaches` (info severity — breaches are common, not fraud evidence alone)

**IP reputation check:**
- Input: submission IP address
- Output: proxy/VPN/datacenter classification, abuse confidence score
- Signal: `suspicious_ip` (warning if datacenter/VPN + high abuse score)

**Fraud-ring cross-reference:** ❌ REMOVED per privacy-engineer BLOCKER 2.

**Synthetic-identity patterns:** ❌ REMOVED. Name/location are strong proxies for ethnicity/national origin — discrimination-by-proxy risk (EU Art. 9, US Title VII). May be reconsidered only with documented methodology and bias testing.

### 5.2 Confidence and Deduplication

- Each signal carries a confidence score (0.0–1.0)
- Multiple signals from the same source are deduplicated
- No composite "fraud score" — signals are listed individually (same principle as integrity events)

---

## 6. Report Format

Threat-intel results are stored per application and surfaced in the recruiter's candidate review.

```sql
CREATE TABLE threat_intel_checks (
  id SERIAL PRIMARY KEY,
  job_application_id INTEGER NOT NULL REFERENCES job_applications(id),
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  signals JSONB NOT NULL DEFAULT '[]',
  sources_checked TEXT[] NOT NULL DEFAULT '{}',
  sources_failed TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_threat_intel_application ON threat_intel_checks(job_application_id);
```

**`signals` JSONB:**
```json
[
  {
    "signal_type": "email_in_breaches",
    "severity": "info",
    "confidence": 1.0,
    "details": {
      "breach_count": 3,
      "breaches": ["Collection1", "LinkedIn2016"],
      "most_recent": "2021-03-15"
    },
    "review_status": "unreviewed"
  },
  {
    "signal_type": "suspicious_ip",
    "severity": "warning",
    "confidence": 0.72,
    "details": {
      "ip_type": "datacenter",
      "abuse_confidence": 85
    },
    "review_status": "unreviewed"
  }
]
```

**UI presentation:**
- Signals appear in a "Threat Intel" section on the candidate profile
- Each signal shows: type, severity, confidence, details, and human-readable explanation
- Recruiter can mark each as `confirmed`, `dismissed`, or leave `unreviewed`
- **No auto-reject.** A `critical` signal triggers a prominent warning, not a block.

---

## 7. Privacy and Legal Boundaries

### 7.1 Legal Review Required

**The privacy-engineer MUST review before implementation. The following are gates, not open questions:**

1. **India DPDP Act 2023 — explicit consent required:** For candidates processed under Indian jurisdiction, threat-intel checks require **explicit, separate consent** (a clear checkbox/disclosure in the application flow). Privacy-notice-only is insufficient — DPDP has no "legitimate interests" basis for pre-hire fraud screening. Checks MUST NOT run for India-jurisdiction candidates until consent is captured. Alternatively, gate the feature off for India until counsel advises.

2. **EU — Art. 13/14 notice + Art. 6 basis + DPIA:** Full privacy notice at collection, named lawful basis, and a Data Protection Impact Assessment (Art. 35 — systematic applicant screening is a textbook trigger).

3. **GDPR Art. 22:** Non-blocking, advisory-only checks are not "solely automated decision-making" — BUT only if human review is genuinely independent. Add automation-bias controls: (a) recruiter training that signals are investigatory leads, not verdicts; (b) audit of `review_status` dispositions; (c) UI copy stating "this is a lead, not a finding."

4. **FCRA (US):** Federal trigger unlikely (no consumer reporting agency involved). **California ICRAA is the real exposure** — adopt FCRA-style adverse-action hygiene for any rejection relying on a signal. Re-run FCRA analysis if any source becomes a commercial vendor.

5. **Candidate notification:** Jurisdiction-specific (see above). US: privacy notice sufficient (with state-notice compliance). EU: Art. 13/14 notice. India: explicit consent.

6. **External queries cannot be recalled:** Emails hashed and sent to HIBP, IPs queried at AbuseIPDB leave copies outside Rekrut AI's control. Disclose this in the privacy notice.

### 7.2 Privacy Principles

| Principle | Implementation |
|-----------|---------------|
| **Data minimization** | Only 4 fields checked (email, IP, phone, name/location) |
| **Purpose limitation** | Threat-intel data used ONLY for fraud detection, never for scoring or ranking |
| **Non-blocking** | Checks never prevent a candidate from proceeding |
| **Transparency** | Candidates notified in privacy notice; signals visible to recruiter with explanations |
| **Human review** | All signals require human judgment; no automated decisions |
| **Erasure** | `threat_intel_checks` rows deleted with job application erasure |
| **No biometric crossover** | Threat-intel never touches biometric data or the observer pipeline |

### 7.3 What We Will NOT Do

- **No secret scoring:** Candidates are not assigned a hidden "fraud score"
- **No cross-employer sharing:** Threat-intel signals are per-application, not shared across companies
- **No persistent blocklists:** We do not maintain a database of "flagged" individuals
- **No law-enforcement reporting:** Signals are for recruiter review only, not for reporting to authorities (unless legally compelled)

---

## 8. Erasure and Retention

- `threat_intel_checks` rows are deleted when the parent `job_application` is erased (CASCADE or explicit DELETE in `erasePersonalData()`)
- No separate retention period — follows application lifecycle
- Source query logs (what was checked, when) retained for 90 days for audit, then purged

---

## 9. Test Strategy

### Unit Tests
- Each source adapter handles API failures gracefully (timeout, 429, 500)
- K-anonymity: verify only hash prefix sent for breach checks
- Signal deduplication logic
- Non-blocking: application proceeds even if all sources fail

### Integration Tests
- End-to-end: application → async check → signals in recruiter view
- Recruiter can confirm/dismiss each signal
- Erasure: `threat_intel_checks` rows deleted with application

### Negative Tests
- **All sources down:** Application still processes normally, signals section shows "checks unavailable"
- **False positive:** Document the handling — recruiter dismisses, no candidate impact
- **Rate limiting:** Respect source API limits; queue and retry with backoff

---

## 10. Open Questions for Sumanth

1. **Candidate notification:** Jurisdiction-specific per §7.1 — US: privacy notice; EU: Art. 13/14 notice; India: explicit consent checkbox. Confirm this approach.
2. **IP collection:** Adding IP logging requires DPIA + notice update + India consent. Proceed?
3. **Scope:** Start with email breach (if HIBP ToS clears) + IP reputation only, per privacy-engineer recommendation. Confirm.

---

## 11. Dependencies

**Requires:**
- Privacy-engineer legality review (before implementation)
- `job_applications` table (exists)
- Async job infrastructure (check what exists — may reuse observer_jobs pattern)

**Blocks:**
- Future implementation stories (Sprint 10+)

**Does NOT require:**
- E-008 AI Observer (independent system)
- Biometric infrastructure (no crossover by design)
- Paid APIs ($0 constraint)

---

*End of Threat-Intel Checks Spec*
