# DPIA — Application-time IP capture + consent gate (#815, S-095)

**Status:** Built dark. The capture runs only while the #807 dark chassis flag is ON, and enabling that flag in any production environment is blocked until (1) counsel confirms the retention period and this DPIA, and (2) the #788 determination closes. This document is the engineering/privacy assessment for counsel review — it is not legal advice and does not replace counsel's determination.

## 1. Processing description

When a candidate submits a **manual** job application (`POST /candidate/jobs/:jobId/apply`), and only when **all** of the following hold —

1. the dark chassis flag is ON,
2. the candidate ticked an unchecked-by-default consent checkbox in the apply form (`ip_capture_consent === true` in the request),
3. a usable request IP exists,
4. a current `application_ip` consent text exists,
5. the job's company is known (the fingerprint silo),

— the server records **one row** in `application_ip_captures` (migration 261) containing:

- the application, candidate, and company ids,
- a **company-siloed HMAC-SHA256 fingerprint** of the normalised request IP,
- the server-resolved consent text version, the grant timestamp, and a receipt hash binding candidate + application + grant instant,
- a retention expiry stamped at insert (**captured_at + 12 months**).

The raw IP address is **never persisted** — there is no raw-IP column, and a database format CHECK makes a non-fingerprint value in the fingerprint column impossible. The pipeline has **no read path**: nothing in this story reads the table back, no API exposes it, and no recruiter- or candidate-facing surface shows it. Auto-apply and one-click server routes never capture (capture is wired at the manual apply route only).

## 2. Lawful basis

- **India DPDP Act 2023, ss. 5–6 (notice + explicit consent)** — the strictest-global basis, applied everywhere: a plain-language notice at the point of application (what, purpose, retention, withdrawal route, and that declining changes nothing), an unchecked-by-default checkbox, consent resolved against a versioned consent text held server-side, and a receipt hash as proof of the grant.
- **DPDP s. 7(i) (legitimate uses / security) was considered and REJECTED** as the basis: fraud-prevention-by-fingerprint is precisely the kind of processing a data principal should be able to refuse, and a consent-free basis would make the decline path meaningless. Consent is also the basis that survives the strictest reading across launch markets.
- **CCPA/CPRA (California):** the notice at collection is the apply-form notice itself (categories: a derived security fingerprint; purpose: fraud/duplicate detection; retention: 12 months). The fingerprint is not sold or shared; no cross-company comparison exists, so no cross-context use arises.
- **FCRA: NOT triggered.** This is not a consumer report, is not obtained from or furnished by a consumer reporting agency, and no eligibility decision is made from it in this build (there is no read path at all). Any future signal use requires a fresh FCRA/background-check analysis before it ships.
- **GDPR note (EU launch is postponed):** if the EU returns to scope, the design intent is Art. 6(1)(a) consent with Art. 7 conditions (demonstrable, withdrawable, unbundled — the checkbox is separate and non-blocking). This DPIA must be revisited before any EU enablement.

## 3. Data inventory

| Item | Stored? | Notes |
|---|---|---|
| Raw IP address | **Never** | Exists only transiently as `req.ip` at the route; normalised in memory; never logged, never returned, never a query parameter except as the HMAC input computed in-process |
| IP fingerprint | Yes | HMAC-SHA256 hex, keyed per company (silo). Pseudonymised personal data — **not** anonymised data |
| Candidate id / application id / company id | Yes | Linkage ids for the silo, erasure, and provenance |
| Consent text version, grant timestamp, receipt hash | Yes | Proof-of-consent provenance (receipt hash = SHA-256 over type:candidate:application:instant:true) |
| User agent, device data, location | No | Out of scope; not collected by this story |
| Any recruiter-visible signal | No | No read path exists; #788 quarantine applies (below) |

## 4. Risks and mitigations

| Risk | Honest assessment | Mitigation |
|---|---|---|
| **Reversal by secret-holder via recomputation** | Real. IPv4 space is small; anyone holding the fingerprint secret can enumerate candidate IPs per company and match fingerprints. The fingerprint is pseudonymisation, **not** anonymisation, and this document does not claim otherwise. | Secret held as a dedicated env secret, read lazily in exactly one module; fingerprints never returned by the capture API; no lookup/compare function exists in the codebase, so the store cannot be used as a guessing oracle from inside the product. Secret rotation orphans all fingerprints (accepted; no recompute path is built). |
| **NAT / CGNAT shared IPs** | Many candidates can share one egress IP (corporate NAT, mobile CGNAT). A future repeat-pattern signal would over-match shared-IP candidates. | This build stores captures only — no signal, no matching, no decision. Any future evaluation story must treat shared-IP collisions as a first-class false-positive source and remains advisory-only, never auto-reject. |
| **IP spoofing / VPN / proxy residual** | `req.ip` reflects the platform's proxy configuration; a determined fraudster can vary IPs trivially. The control deters casual duplication only. | Documented as a residual limit; the capture is not represented to employers as proof of identity or fraud. |
| **Function creep** | A per-application fingerprint store invites future uses (screening, scoring, cross-checks) beyond the consented purpose. | Purpose is bound in the consent text ("security only… never used to judge your application"); no read path ships; any future read/signal use needs its own story, its own counsel gate, and — for pre-determination rows — the #788 purge-not-migrate rule. |
| **Consent fatigue / dark patterns** | A pre-ticked or application-blocking checkbox would invalidate consent. | Checkbox is unchecked by default, visually separate, decline text states nothing changes, and the server treats anything other than boolean `true` as no consent. |
| **Breach exposure** | A leaked table links fingerprints to candidate/application ids. | Fingerprints are useless without the secret; ids are the same linkage the applications table already carries; erasure deletes rows (below). |

## 5. Retention

- **12-month TTL**, stamped per row at insert (`retention_expires_at = captured_at + 12 months`). **Counsel must confirm this period before the flag is enabled in production** — the TTL is a schema stamp, and the purge job that enforces expiry is a separate follow-up; until both exist, the flag stays OFF in production.
- Erasure does not wait for the TTL (below).

## 6. Erasure and legal hold

- Candidate erasure (`erasePersonalData()`) deletes the candidate's capture rows with an explicit, counted DELETE keyed by the **unheld** application set — mirroring the threat-intel erasure pattern exactly. Rows belonging to applications under an active **legal hold survive** and are counted (`applicationIpRowsHeld`); they are erased when the hold releases and erasure resumes. There is deliberately **no candidate-keyed delete**, which would destroy legally-held rows.
- Withdrawal of consent (notice gives the privacy@ route) is an erasure request against the same path.

## 7. The #788 quarantine

Captures recorded before the #788 determination closes are **never surfaced** to any employer, in any form. If counsel's determination does not clear retroactive use, the disposition for pre-determination rows is **purge, not migrate**: they are deleted, never carried into a future signal system. The dark-flag-OFF default plus this quarantine is why the build can ship ahead of the determination.

## 8. Decline is never a negative signal

Declining (or never being asked because the flag is off) records **nothing** — no row, no flag on the application, no marker anywhere. The application row and response are byte-identical whether consent was given, declined, or the capture failed. Absence of a capture can therefore never be read as a negative signal by any future system: the consented and declined populations are indistinguishable in the application data itself.

## 9. Residual risks and counsel-flag list

Residual risks accepted by this design (to be confirmed by counsel):

1. Pseudonymisation reversibility by a secret-holder (Section 4) — inherent to any keyed-fingerprint design over a low-entropy subject.
2. Shared-IP (NAT/CGNAT) collisions — dormant only because no evaluation ships; must be re-assessed by any future signal story.
3. The 12-month TTL is stamped but the expiry purge job is not yet built; production enablement is blocked until it exists.

**Counsel flags (open, blocking production enablement):**

- Confirm the 12-month retention period (or set another) — Lex consult position is that counsel sets the period.
- Confirm the consent notice copy (EN + HI, migration 261 seed — draft translation, native + legal review required, house pattern).
- Close the #788 determination (retroactive-use question + quarantine disposition).
- Confirm the DPDP s. 7(i) rejection and the consent-first basis for India, and the CCPA notice sufficiency for US launch.
- DSAR/export coverage for `application_ip_captures` (the #1210 follow-up family covers the chassis tables; this table has candidate linkage and must be included before enablement).
