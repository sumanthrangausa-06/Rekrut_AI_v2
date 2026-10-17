# PRD — M15: Threat-Intel

**State (verified, Scout §2): ABSENT — zero code, zero tables.** `grep -ri threat_intel` across lib/routes/services/workers/migrations returns no hits. What exists: the S-081 spec (privacy-reviewed), Sumanth's narrowed-v1 approval (2026-10-12), filed stories, and the counsel gate.
**Governing constraints:** narrowed v1 approved · signal stays DARK until #788 (S-086 CRA determination) closes · Sumanth's 2026-10-13 instruction: **no outreach to anyone** — the counsel track is paused by his decision, so nothing in this module can go live pre-launch unless that changes.

## 1. Purpose & users
Advisory integrity signals on applications — v1 is exactly one internal signal: **multiple applications to the same employer from the same IP**, shown to that employer's recruiters as an *observation to review*, never a verdict. Users: recruiters (review UI), candidates (subjects of the observation — with dispute rights by design).

## 2. End-to-end journey (as designed — nothing built)
Application created (M6) → IP captured at application time, stored **cryptographically siloed** (`HMAC(ip, company key)` — never raw IP; Rex's Sprint 11 correction: no application-time IP capture exists today, so this is net-new — S-095) → chassis evaluates the repeat pattern inside the employer's silo only → signal row (`threat_intel_checks`) with provenance/timestamp/source → recruiter reviews in UI (confirm/dismiss, advisory-only, no auto-reject anywhere in the chain) → erasure deletes the payload with the application; audit metadata survives per the two-tier retention design (counsel-set period).

## 3. Current state (verified)
Design-complete, code-absent. Stories: S-090 chassis, **S-095 IP capture + consent gate (#815, prerequisite)**, S-091 signal (dark), S-092 UI (**deferred behind #788** per Rex's Sprint 11 review — not built dark). External sources are **all blocked at $0 by their own terms** (AbuseIPDB free = non-commercial; HIBP email API paid, k-anonymity Pro-only; XposedOrNot commercial licence + 100/day cap) — held behind written licensing clearance + a Sumanth budget call. FBI IC3 is context-only (no per-candidate lookup exists).

## 4. Gap to launch-ready
For January: build the chassis + capture + signal **dark** (Sprint 11 sequenced set), with the release gate welded shut. Live-to-recruiters is **not** a January requirement under the current counsel posture — it requires #788 closed, which requires outreach Sumanth has paused. The PRD's launch definition for M15 is therefore: *built, dark, disputable-by-design, and releasable by configuration when counsel lands* — not live.

## 5. Functional requirements
- FR-M15-1: The repeat-IP observation is stored **on the application**, as an observation — never as a person- or IP-level blocklist; severity `info` only in v1; the per-employer silo is enforced in code (HMAC with a per-company key), not by query discipline.
- FR-M15-2: The signal is **never** an input to ranking, filtering, matching, scoring, or auto-rejection (same guardrail family as #792). Recruiters see provenance, timestamp, and source on the face of the signal; confirm/dismiss are human acts, logged.
- FR-M15-3: India explicit-consent gate + DPIA coverage precede any activation (spec's conditions, privacy-reviewed); activation is a configuration change behind the #788 gate, requiring a fresh Sumanth decision at that time.
- FR-M15-4: Erasure: signal payload dies with the application (M6/M19 path); audit metadata retention period is set by counsel's answer, defaulting to the design's two-tier proposal until then.
- FR-M15-5: No external source is integrated without (a) written licensing clearance for commercial use and (b) Sumanth's budget approval on file (the $19/mo-class unlock is a config plug-in later, not a rebuild).

## 6. Non-functional
- Privacy (privacy-engineer lens — the spec's 3 BLOCKERs were fixed in design and are requirements here): no fraud-ring datasets, no CISA AIS, no full-email disclosure patterns; k-anonymity or nothing for any future breach source.
- Legal: FCRA-style adverse-action hygiene adopted voluntarily in the UI copy and workflow (notice, dispute path) regardless of the CRA determination's outcome — Lex's design position.

## 7. Dependencies (verified states)
M6 application creation (exists; IP capture **absent** — S-095 builds it) · #788 counsel (**open, paused by Sumanth's no-outreach ruling**) · M19 erasure (exists; M15 joins its map via FR-M15-4 when built).

## 8. Sprint 11 overlap
S-090 → S-095 → S-091 is the sprint's sequenced order for this module; S-092 deferred. This PRD's launch definition (built-dark) matches the sprint's.

## 9. ⚠ Unverified
Nothing to verify — no code exists. The spec's disparate-impact validation approach for the repeat-IP signal is counsel question 2, unanswered.

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M15-1:** None for launch beyond what you've ruled (v1 approved, dark, no outreach). The module's only live question is the one already on your desk: if/when counsel outreach resumes, #788 unblocks both this module's release and M14's expansion.
