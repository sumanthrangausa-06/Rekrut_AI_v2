# Gate A — Dormant Capture: Design Package (S-085 / #787)

**Status: AT SUMANTH'S APPROVAL GATE.** Gate A was ruled **B, AMENDED** on 2026-10-13 (ruling recorded on #634). Sumanth's order: *"build the safety design and build it"* — design first, his approval, then Nova builds. His scope doctrine: **"design it and then build it completely, not half-half work"** — one complete unit, designed whole, built whole, closing whole. **Nova does not build until this package is approved.**

**Package contents** (this folder):
| Document | What it is |
|---|---|
| `gate-a-dormant-capture-design.md` (this file) | The package: Lead's summary, ownership, conflicts, slotting + Rex's capture & safety design v2 in full |
| `gate-a-validation-protocol.md` | Quinn's validation protocol (dormancy proof, synthetic corpus, measurable "validated") |
| `gate-a-consent-retention-review.md` | Lex's consent/retention requirements, red lines, counsel-only determinations + Appendix A: the #788 counsel-chase draft (**DRAFT — NOT SENT**) |
| `gate-a-privacy-review.md` | Privacy-engineer review (v1: BLOCK) + delta re-review of v2 (**BLOCK CLEARED WITH CONDITIONS**) |

---

## Package summary — in plain words (Lead)

**What exists today:** the AI Observer can join a human interview (with candidate consent) and be present. It hears nothing, records nothing, analyses nothing. That is deliberate.

**What this package designs:** the machine that *could* listen — built completely, but **switched off**. An audio-only capture system inside the Observer worker: if it were ever switched on, it would record only the candidate's audio, in 30-second encrypted pieces, each locked with that candidate's own key, each registered so it can be found, kept for 30 days, and erased on demand. From the audio it would compute simple, honest speech measurements (how fast someone speaks, pauses, pitch) — and anything it cannot compute honestly, it reports as `missing`. It never invents a number.

**Why it stays off:** switching it on for real candidates is a separate, future decision with hard conditions — the lawyer's answer in writing, a brand-new consent from the candidate (January's consent can never be stretched to cover recording), a closed test group only, and proof the measurements are accurate on fake test voices first. The dates are fixed: if the lawyer and this design are cleared by **1 Nov 2026**, the simple speech measurements may be tried with the test group. After **1 Dec 2026**, nothing switches on before launch.

**What the safety review did:** the first design was **blocked** by the privacy reviewer — the old consent could have been stretched to cover recording, a crashed upload could have left a recording no one could find or erase, and flipping one switch could have turned recording on for everyone. The architect rewrote those parts. The re-review **cleared the block with conditions** (small fixes and proof-items that are now tracked build conditions). No red line is tripped by the revised design.

**What approval buys:** Nova builds the whole unit — **40 points, five stories that finish together** — inside Sprint 11 planning *after* the Applications sprint, which this work does not displace. Approval does **not** switch anything on. Nothing is recorded. The switch-on decision comes back to Sumanth separately, later, with the lawyer's answer and the test-voice proof in hand.

---

# Gate A Design Package — Lead's Sections (ownership, conflicts, slotting, approval ask)

*Authored by Lead for the assembled package. Companion documents: Rex's capture + safety design v2, Lex's consent/retention review, Quinn's validation protocol, privacy-engineer review + delta re-review.*

## A. Ownership table for L-COH / L-JAN requirements (privacy finding P-14)

The privacy-engineer review found RL-10 (audit-spine gaps) "cannot be confirmed absent" because Lex's cohort/audit-spine requirements (L-COH-*, L-JAN-*) had **no named owner** in Rex's capture design. They are not capture-build scope — they are **cohort-enablement scope**. Owners are named here; this table is the package's evidence for RL-10.

| Requirement family | Owner | Where it lands | Gate it blocks |
|---|---|---|---|
| L-COH-01/02/03 — cohort allow-list, per-session membership record, code-level enforcement (presence path) | **Nova** — new **Cohort Enablement story** (Sprint 11; Lead writes it at sprint planning) | Enablement build; STOP 1 must verify what S-046/S-047 already enforce (verified-state rule) before scoping | First cohort session |
| L-COH-01/02/03 — cohort check **inside the capture path** | **Rex** (design v2, P-2 fix) → Nova (build C-stories) | Capture design §gate composition | Any capture enablement |
| L-COH-04 — the cohort promise, identical in consent copy, employer terms, in-product disclosure | **Candidate Experience** (copy) + **Lex** (sign-off) | Enablement story ACs; one canonical wording, no forks (S-039 discipline) | First cohort session |
| L-COH-05 — no public biometric-consent ask in January | **Lead** (scope guard) + Quinn (gate test at enablement) | Sprint 11 scope; enablement checklist | January launch |
| L-COH-06 + C-07 — employer as consent actor; design-partner terms | **Lex** (terms frame) → **counsel** (determination) | Must exist before first enablement; Lead escalates any slip to Sumanth | First cohort session |
| L-COH-07 — cohort cap | **Sumanth** (decision at this gate — see §C, D-2) | Recorded on #634 | Design approval |
| L-COH-08 — no cross-cohort/cross-purpose use | **Rex** (v2 no-secondary-use clause, P-16) for capture data; **Lead** for cohort records (enablement story AC) | Design + enablement story | — |
| L-JAN-01…07 — the January audit spine (per-session record, true consent state, explicit `analysis_provided: false`, immutability, restricted access, completeness reconciliation, no media fields on the January path) | **Nova** — Cohort Enablement story; **Quinn** verifies completeness reconciliation (L-JAN-06) | Partial coverage may already exist in S-047/S-049a/S-039 surfaces — STOP 1 verifies before scoping (never assumed) | First cohort session (an incomplete spine = no enablement, per Lex) |
| L-ACT-01…07 — activation consent mechanics | **Rex** v2 (P-1/P-2 technical preconditions) now; **Lex** owns the activation-flow pass against final copy at the activation gate | Capture design + future activation package | First real capture |
| L-DOR-01…07 — dormancy mechanics + evidence | **Rex** v2 + **Quinn** protocol; per-release dormancy **attestation owned by Lead** (Relay release checklist) | Design + build + release process | Build sign-off / each release |
| L-RET-01…07 — retention/erasure | **Rex** v2 (§5 incl. erasure-reachability table); consent/audit-record periods stay **OPEN for counsel (C-06)** | Design; schedule publication needs C-06 | First real capture (schedule) |
| L-POL-01…04 — #777 policy-page fix | **Nova** (fix) + **Lex / Candidate Experience** (review), versioned per L-POL-04 | Pre-launch track; already labelled `launch-blocker` on #777 | **Any** Observer enablement |

## B. Conflicts register — named, not smoothed

| # | Conflict | Positions | Resolution / status |
|---|---|---|---|
| K-1 | Cohort gate absent from capture design | Rex v1: flag + consent + job only. Lex L-COH + Quinn R-Q10: cohort allow-list is a gate condition | **Resolved in Rex v2** (P-2 fix) — pending privacy delta re-review |
| K-2 | Kill-switch latency | Rex v1: ≤30 s (next chunk checkpoint). Quinn FI-2: ≤2 s unsubscribe + buffer purge | **Resolved in Rex v2** (P-6: ≤2 s re-read bound + teardown) — Quinn confirms at build STOP 1 |
| K-3 | Two measurement schemas + divergent definitions | Rex §7.4 shape vs Quinn §2.3 contract; pause 250 ms vs segmenter 700 ms; filler lexicon unfrozen | **Resolved in Rex v2** (P-13: Quinn's contract adopted, Rex's `n`/`uncertainty.kind` carried inside; three-term pause vocabulary mapped; lexicon frozen in one place) |
| K-4 | Retention classification of captured audio | Rex v1: 30 days justified from frames precedent. Lex L-RET-01: raw audio is **recording-class**, 90-day ceiling | **Resolved as: recording-class with a shortened 30-day sub-policy** (P-9) — Sumanth approves the 30-day period explicitly at this gate (D-1) |
| K-5 | Effect of consent withdrawal on already-persisted chunks | Unspecified by all three v1 documents (Quinn Q-3 deferred to Lex; Lex required it specified) | **Rule stated in Rex v2** (P-7): withdrawal stops capture AND queues persisted chunks + measurements for ledger-driven deletion, unless counsel states a retention basis (C-04) — Lex confirms at package check |
| K-6 | January audit spine unowned (RL-10 unprovable) | Lex requires it; Rex's design didn't cover it; nobody owned it | **Resolved by §A of this package** — Cohort Enablement story owns it; spine completeness blocks enablement |
| K-7 | Validation language scope | Quinn corpus v1.0 is English-only; launch includes India | **OPEN — carried as an activation constraint:** the speech slice, if ever activated, is validated for English sessions only until another language's corpus validates separately (it inherits nothing). Sumanth/Aria decision, needed before any non-English activation, not before this build |
| K-8 | TTS licence for synthetic corpus at $0 (Quinn Q-4) | Unverified | **Carried build condition:** Lead verifies the TTS engine's licence permits internal validation use before build story C-5 starts |
| K-9 | Evidence-pack custody (P-15/P-22) | Quinn's pack has no retention/access/redaction rules; D-5 omits `candidate_data_keys` | **Carried build condition:** Quinn amends the protocol at build planning (synthetic IDs only in packs; accountability-schedule retention; restricted access; D-5 registry addition) |
| K-10 | In-process CPU/memory headroom on the $0 tier | Rex risk: capture + ASR in the web process; one-capturing-session cap proposed | **Carried build condition:** synthetic load measurement is part of C-5's exit evidence; activation is impossible until headroom is measured, per Rex §11 |

## C. Decisions Sumanth is asked to make at this gate

- **D-1 — Retention period:** captured audio = recording-class, **30 days** (shorter than the 90-day recordings ceiling), automated purge. Approve / change.
- **D-2 — Cohort cap (Lex L-COH-07):** Rex's design proposes no numeric cap. Package recommendation: **the named employer allow-list IS the cap** — cohort membership only by named design-partner employers on the allow-list, and adding one is a config change Sumanth approves. Approve / set a number.
- **D-3 — The design itself:** approve Rex v2 + Quinn's protocol + Lex's requirements as the build basis (with the carried conditions in §B) → Nova builds the complete unit. Or send back with changes.

## D. Open items the package carries honestly (not blockers to design approval)

- Counsel determinations **C-01…C-08 stay OPEN** (Lex §9). C-01 is chased in writing via the Appendix A draft (unsent — Sumanth's send decision). The re-entry dates stand: counsel + design cleared by **2026-11-01** → speech slice may be proposed for cohort activation; after **2026-12-01** → nothing activates pre-launch.
- Incidental interviewer audio in candidate-track chunks (privacy P-17): activation-gate item, tracked for counsel (C-04/C-05).
- Legal-hold mechanism: Rex v2 names it or flags its absence (P-10) — if absent, that's a discovered gap Lead files at build planning.
- PRD scope amendment: Aria, Sprint 11 planning item (recorded on #634) — analysis explicitly out for January, vision unchanged.
- Atlas evidence gates (15–20 discovery calls, 3–5 paid pilots) run in parallel; if workflow alone doesn't sell, Gate A reopens (ruling, #634).
---

## Sprint 11 slotting (Lead)

**Priority order is fixed by the ruling: the capture build does NOT displace the Applications module sprint.**

1. **Applications module sprint — main track, committed first.** Full module wiring + security + compliance, incl. the #780 `job_applications` erasure gap (parked there by Sumanth's module-order rule).
2. **Cohort Enablement story** (new; owns L-COH/L-JAN per §A) — estimated at Sprint 11 planning after its STOP 1 verifies what S-046/S-047/S-039 already shipped. Together with #777 it blocks the first cohort session, not the launch.
3. **#777 policy-page fix** — launch-blocker label applied; blocks any Observer enablement.
4. **Threat-intel build** (chassis + internal repeat-IP signal; approved narrowed v1) — slots behind Gate A per the S-084 sequencing; the signal stays dark until #788 (C-01) closes in writing.
5. **The dormant-capture build unit — 40 points, five stories, closing together:**
   | Story | Pts |
   |---|---:|
   | C-1 Capture core + gate composition (flag, watchdog, cohort + consent-artefact gates, env scoping) | 8 |
   | C-2 Encrypted persistence, registry-first (migration 257, reconciler) | 7 |
   | C-3 Retention + erasure + withdrawal composition | 5 |
   | C-4 Speech-pattern slice (single schema, frozen lexicon, self-hosted ASR only) | 15 |
   | C-5 Dormancy + synthetic validation suite (T1–T14 + T4b/T4c/T8b/T11/T12; Dormancy Evidence Pack) | 5 |
   | **Total** | **40** |
   The unit enters Sprint 11 **only** with capacity that does not touch the Applications sprint; if it does not fit whole, it moves whole to the next sprint. It is never split into partial closures (Sumanth's doctrine; the S-049 scaffold split is the anti-pattern). Delta from v1's 29: +11 — the gate went from 3 conditions to 5 plus a watchdog; registration/reconciliation and withdrawal deletion are new machinery; the schema/transcript/encryption work was previously assumed free. Re-pricing honestly is the point of the revision.
6. **#785** markObserving guard (1 pt) — small-fix queue.
7. **Parallel, non-engineering:** Aria's PRD scope amendment (analysis explicitly out for January, vision unchanged); Lex's counsel chase (Appendix A of the Lex document — Sumanth's send decision); Atlas's evidence gates (15–20 discovery calls, 3–5 paid pilots — if workflow alone doesn't sell, Gate A reopens).

## Build-phase conditions carried from the privacy reviews (named, not waived)

From the delta re-review's final lists — verified by Quinn/Lead at build, each traceable to the review documents:
- **P-4 conditions:** record the actual Neon PITR window in build evidence before the unit closes (Lex acceptance required if >30 days); evidence object-versioning OFF for both observer prefixes in the Dormancy Evidence Pack; re-verify versioning at activation.
- **D-1 (on P-5):** build STOP 1 must evidence that staging and production carry **distinct environment identities** (if both share one `NODE_ENV` value, `origin_env` scoping is vacuous) or add a dedicated env-identity stamp.
- **D-2 (errata):** reconcile §3.3 "corrections are appended rows" with §9's `observer_cohort_membership` session-ID primary key at build planning.
- **D-3 (errata):** add an enumerated `gate_code` field to the §6.4 log schema so T4b's gate codes are loggable within the closed field list.
- **D-4:** name the owner + runbook for the PITR-restore re-erasure rule (§5.3 row 4) — Relay is the assignee.
- **P-10:** legal-hold seam is built into both purge paths; **purge-live verification for the `observer_audio` class is an activation precondition**. **G-1 escalation:** the platform has **no legal-hold mechanism at all** (Rex, verified absence) — the design builds only the seam. Lead files G-1 as its own tracked issue at build planning; it predates this unit and affects existing purges.
- **P-11:** log schema as designed; per-release dormancy attestation is a **Lead-owned release deliverable** (Relay checklist).
- **P-15/P-22:** Evidence-pack custody (synthetic IDs only; accountability-schedule retention; restricted access); `candidate_data_keys` added to Quinn's D-5 registry.
- **P-18–P-21:** T8b DEK-resurrection test; ledger `source_family` discriminator (migration 257 — verified absent in migration 252's table); role-flip abort note; decrypt-path isolation — all build-story acceptance criteria.
- **K-8:** Lead verifies the synthetic-corpus TTS licence ($0, internal validation use) before C-5 starts.

## The approval ask

Sumanth is asked for exactly three things at this gate:
1. **D-3 — Approve this design package** (Rex v2 + Quinn's protocol + Lex's requirements, with the conditions above) as the build basis → Lead slots the 40-point unit per the slotting above and Nova builds it whole.
2. **D-1 — Approve the retention period:** captured audio is recording-class data with a **30-day** sub-policy (ceiling is 90), automated purge.
3. **D-2 — Decide the cohort cap:** package recommendation — the named employer allow-list **is** the cap; adding a design partner is a config change Sumanth approves.

Approving this package does **not** approve activation, does **not** send the counsel chase (separate send decision), and does **not** close #674/#697 (parked under the re-entry contract on #634).

---

---

# Appendix — Rex: Capture & Safety Design v2 (full text)

---
project: Unified Interview Engine — Gate A (amended B) dormant capture
phase: 3-Solutioning (design only — no code, no GitHub changes)
story: S-085 (#787), re-scoped by Sumanth's Gate A ruling on #634 (2026-10-13)
owner: Rex (Solution Architect)
revision: 2 — supersedes rex-capture-safety-design.md (v1, retained untouched for the record)
status: FOR RE-REVIEW (privacy engineer) THEN SUMANTH'S APPROVAL — nothing builds until this package is approved
evidence: read directly from the repo at ~/workspace/skill-repos/rekrut-ai-v2
  (workers/ai-observer/index.js, lib/observerJobs.js, lib/observerConsentGate.js,
  lib/consentService.js, lib/observerReportStates.js, lib/observerReportWriter.js,
  lib/biometricCrypto.js, lib/self-hosted-audio.js, lib/r2FrameStore.js,
  lib/r2RecordingStore.js, lib/file-storage.js, lib/erasureService.js,
  services/euComplianceService.js, server.js, migrations 252–256,
  S-082 spike, Gate A brief, E-008 spec §4)
review inputs: privacy-engineer-review.md (verdict BLOCK, P-1…P-22),
  lex-consent-retention-review.md (L-ACT-*, L-COH-*, L-DOR-*, L-RET-*),
  quinn-validation-protocol.md (§2.3, §2.4, §3, §7, R-Q1…R-Q12)
---

# Dormant Capture — Safety Design v2 (S-085, complete unit)

## Specialists consulted (mandatory disclosure)

Same selection discipline as v1 — from `~/workspace/SKILL_MAP.md`, by the risk
domains of *this* change. The v2 revision additionally works from the
independent privacy-engineer review of the assembled v1 package (a separate
step Lead commissioned; that review is an input to this revision, and v2
returns to the same reviewer for re-review before Sumanth's gate).

| Specialist (source) | Why this design needs it | What it changed in v2 |
|---|---|---|
| `startup-cto` (method, first) | Gate discipline, $0 constraint | In-process worker kept; no new services, no new paid dependencies; the honest re-estimate (§10) prices the review fixes instead of absorbing them silently |
| `smart-sdlc/create-architecture` + `ecc/architect` (Rex default toolkit) | Architecture structure, trade-off discipline | Gate composition (§3.2) is now the spine: five independent conditions, each fail-closed, none implying another |
| `ecc/database-reviewer` (Rex default toolkit) | Migration 257 (revised), registry, erasure queries | Registry-intent-first registration (§4.4); family discriminator on the deletion ledger (§5.2); capture-outcome record (§8.5) |
| `ecc/security-reviewer` | Envelope encryption, key handling, fail-closed paths | Measurement payloads are now DEK-encrypted under the same envelope discipline as audio (§7.5, P-12); decrypt path is isolated and runtime-guarded (§4.5, P-21) |
| `agency-agents/privacy-engineer` | Consent enforcement in code, deletion that provably reaches every copy | Activation-consent separation (§3.2), cohort enforcement in the capture path (§3.3), erasure-reachability table with maximum lags (§5.3), withdrawal-erasure rule (§5.4), transcript lifecycle (§7.4) — each traces to a numbered finding in §0.2 |
| `agency-agents/voice-ai-integration-engineer` | Audio pipeline correctness | Frozen measurement vocabulary reconciled with Quinn §2.4 (§7.2–§7.3); ASR file behaviour audited against the real `lib/self-hosted-audio.js` (§7.4) |
| `claude-skills/feature-flags-architect` | The capture flag is a lifecycle, not an `if` | Flag re-read bound now meets Quinn FI-2 (≤ 2 s) with teardown on flip (§6.1); worker-observed flag-transition audit line (§6.4) |
| `global-hiring-compliance` (workspace skill) | BIPA / GDPR Art. 9 / DPDP framing for voice data | Classification corrected: recording-class data with a shortened 30-day sub-policy (§5.1, P-9); January consent is never banked (§3.2, P-1) |

Considered and skipped, with reasons: `ecc/e2e-runner` and `gstack/qa`
(Quinn's phase — this package designs the seams her protocol calls,
§7.6/§8); `agency-agents/video-streaming-engineer` (video capture is out by
ruling, §2.2); `ecc/mle-reviewer` (no ML model is trained or run —
measurements are deterministic signal processing plus self-hosted ASR).

---

## 0. Revision 2 — what changed and why

### 0.1 Why there is a v2

The independent privacy-engineer review of the v1 package returned **BLOCK**
with 8 blockers (P-1…P-8), 8 should-fixes (P-9…P-16), and 6 notes
(P-17…P-22). Three of Lex's red lines tripped in v1 as written — RL-01
(consent-banking), RL-03 second clause (silent enablement), RL-07 (erasure
gap) — and RL-11 tripped partially (test-data mixing). The review's core
judgement, which this revision accepts without re-argument: v1's *dormant*
half was sound, but v1 also wrote down an *activation path*, and that path
was wrong — a single env-var flip would have recorded real candidates on
January's presence consent, for any employer, with a registration order that
could orphan an object no deletion system could ever find. Approving v1
would have ratified that path. v2 rewrites the activation path; it does not
patch around it.

Nothing in this section re-argues a required fix. Where the reviewer gave a
direct answer to a v1 §12 question (Q1, Q3–Q6, Q8–Q10), v2 adopts it as
binding design input and says so at the point of use.

### 0.2 What changed, in plain words

1. **Capture now needs its own consent, not January's.** The capture gate
   requires a distinct *activation consent artefact* — a new consent record
   type (`observer_capture`), versioned, granted *after* the employer's
   activation enablement decision. The existing `biometric_collection`
   presence consent is still required, but it is necessary and **never
   sufficient**, and the two are checked separately at every checkpoint
   (§3.2, P-1). No activation artefact exists in this build — its wording is
   counsel's (C-04) — so in this build the activation scope of the gate can
   never pass for a real session. That is deliberate: the dormant build
   ships a gate whose real-candidate path is closed by a missing artefact,
   not by an operator's promise.
2. **A flag flip is no longer the activation.** The capture decision now
   also checks, *inside the code path*: employer cohort membership recorded
   per session (fail-closed if unevidenced), an employer activation
   enablement record that can only be created with the L-ACT-04(a)–(f)
   evidence references attached, and a scope guard that separates
   synthetic/test capture from real capture so the pre-activation pipeline
   cannot be pointed at a non-test session (§3.2–§3.3, P-2). §3.3 maps every
   L-ACT-04 item to either a technical precondition in the path or gate
   evidence Lead verifies. A flag flip alone satisfies **none** of them.
3. **Registration order is reversed: intent first, bytes second.** The
   registry row is committed in a `PENDING` state *before* the storage PUT;
   the PUT is then confirmed into the row. A crash can now leave only a
   harmless row pointing at nothing (reconcilable by a sweeper), never an
   object pointing at nothing (an orphan forever). A reconciliation sweeper
   and a storage-vs-registry diff test under kill-mid-PUT injection prove
   it (§4.4, P-3).
4. **Erasure now has a map.** §5.3 is an erasure-reachability table: every
   copy — live object, object versions, provider replicas, Neon PITR
   backups, ASR temp files, in-memory buffers — with the mechanism that
   kills it and its **maximum lag**. Where the honest answer is "expires
   with the backup window," the table says so in §5, as an acceptance for
   Lex/Sumanth, not buried in risks (P-4).
5. **Environments can no longer cross-claim.** Capture may only claim or
   process jobs whose stamped origin environment matches the worker's own
   environment — the shared staging/production database can no longer let a
   staging worker capture a production-originated session. Synthetic/test
   captures use a distinct storage prefix (`observer-audio-test/`) and a
   test marker on every row, are excluded from candidate-facing and erasure
   views of real data, and are deleted on a named schedule by a named
   owner. Enabling the flag in the production service for synthetic
   sessions is **prohibited** (§3.4, §6.2, P-5).
6. **The kill switch now kills in ≤ 2 seconds.** While capturing, a
   dedicated watchdog re-reads the flag (and re-checks consent) every 1 s;
   a flip — or a withdrawal — closes the stream, unsubscribes, and zeroes
   buffers within the FI-2 bound. v2 also states plainly the
   received-not-retained window for consent withdrawal and why it is
   acceptable (§6.1, §6.3, P-6).
7. **Measurements get the same write discipline as chunks, and withdrawal
   now has a rule.** Measurement persist runs under the same advisory lock
   with job-existence + consent + flag re-checks inside the transaction,
   abort-and-discard otherwise. Withdrawal stops capture immediately **and**
   queues already-persisted chunks and measurements for the same
   ledger-driven deletion as erasure, unless Lex/counsel later state a
   retention basis (§5.2, §5.4, P-7).
8. **The transcript has a lifecycle, and the ASR layer was actually read.**
   `lib/self-hosted-audio.js` as shipped writes temp files into the shared
   OS temp dir, cleans them with a plain unlink in a `finally` (no zeroing,
   no crash recovery — a killed process orphans them), and **logs the first
   80 characters of every transcript**. The capture path therefore may not
   call it as-is. §7.4 designs the transcript as ephemeral in-memory data
   and specifies the ASR invocation rigour — named capture workdir,
   zero-and-delete on every exit path, crash-recovery sweep at worker
   start, transcript never logged, never in an error object, never in the
   measurements payload — plus the failure-injection test that proves it
   (P-8).
9. **Classification fixed in one sentence.** Captured audio is
   **recording-class data with a shortened 30-day sub-policy** — the
   30-day number from v1, Lex's classification, never the frames bucket.
   Measurements stay at 30 days, aligned to L-RET-02(a), and §5.1 says so
   (P-9).
10. **One measurement contract, one vocabulary, one lexicon.** v2 adopts
    Quinn's §2.3 result schema as the single contract (status
    `measured|degraded|missing`, `quality_flags[]`, mandatory `reason` when
    missing, `provenance`), carrying v1's `n` and `uncertainty.kind` inside
    it. The segmenter utterance-gap (700 ms), Quinn's pause (≥ 250 ms), and
    the long-pause (≥ 2 s) are named as three different things, mapped, and
    used consistently. The filler lexicon is Quinn's frozen 10-token list,
    in one named place (§7.2–§7.3, §7.5, P-13).
11. **What was only promised is now written down.** A persisted per-session
    **capture-outcome record** (counts only) makes what was/was not
    collected reconstructible after the fact (§8.5, Q10). Measurements are
    **DEK-encrypted** (§7.5, P-12 — the reviewer's "adopt encrypt" answer).
    The structured log schema is enumerated field by field (§6.4, P-11).
    The no-secondary-use prohibition is stated as a verbatim-grade clause
    (§2.4, P-16). Legal hold is named in both purge paths — and the design
    states plainly that **no legal-hold mechanism exists in the codebase
    today**; that absence is a discovered gap for Lead, not a control
    (§5.5, P-10). Incidental interviewer capture (P-17), role-flip abort
    (P-20), decrypt-path enforcement (P-21), the DEK-resurrection test T8b
    (P-18), and ledger family attribution (P-19) each have design text.
12. **The January spine is referenced, not silently absent.** §1.4
    cross-references every L-COH / L-JAN requirement to its owner in Lead's
    package ownership table. Rex's capture-path cohort check is Rex's; the
    January audit spine itself is owned elsewhere in the package, and this
    design now says where (P-14).

### 0.3 Dispositions — every P-finding, where it lands

"Resolved" means the design text in the cited v2 section implements the
reviewer's required fix. "Carried" means the item is named in the cited v2
section as an explicit build-phase condition, exactly as the review's
closing list permits. Nothing in the carried list was used to argue any
must-fix item down.

| ID | Sev. | Disposition | Where in v2 |
|---|---|---|---|
| P-1 Activation-consent separation (RL-01) | BLOCKER | **Resolved in design** — distinct `observer_capture` artefact, version + post-enablement timestamp checks, presence consent necessary-never-sufficient, checked separately at all checkpoints; banked-consent test case added | §3.2 (gate composition, artefact model); §8.3 T4b |
| P-2 Cohort + test-scope + L-ACT-04 encoding (RL-03) | BLOCKER | **Resolved in design** — cohort check inside the capture decision with per-session membership record; synthetic/test-scope guard; L-ACT-04(a)–(f) mapping table (technical precondition vs Lead-verified gate evidence); flag flip satisfies none | §3.2, §3.3 |
| P-3 Registry-intent-first (RL-07) | BLOCKER | **Resolved in design** — PENDING row → PUT → confirm; reconciliation sweeper; storage-vs-registry diff test under kill-mid-PUT | §4.4; §8.3 T11 |
| P-4 Erasure-reachability enumeration (RL-07) | BLOCKER | **Resolved in design** — full table: live object, versions, replicas, Neon PITR, temp artefacts, buffers, logs; mechanism + maximum lag per copy; backup-window acceptance stated in §5 for Lex/Sumanth | §5.3 |
| P-5 Environment scoping + synthetic segregation (RL-11) | BLOCKER | **Resolved in design** — origin-environment claim scoping (named mechanism); `observer-audio-test/` prefix + `is_test` markers; exclusion from real-data views; named deletion schedule + owner; production synthetic prohibition | §3.4; §6.2; §9 |
| P-6 Kill-switch latency / FI-2 (≤ 2 s) | BLOCKER | **Resolved in design** — 1 s watchdog re-read while capturing, teardown on flip; received-not-retained window stated with justification | §6.1; §6.3 |
| P-7 Measurement-write race + withdrawal erasure | BLOCKER | **Resolved in design** — measurement persist under advisory lock with in-transaction re-checks, abort-and-discard; withdrawal rule stated (stop + queue persisted chunks/measurements for ledger-driven deletion) | §5.2; §5.4; §7.5 |
| P-8 Transcript + ASR temp-file lifecycle | BLOCKER | **Resolved in design** — audited actual behaviour of `lib/self-hosted-audio.js` stated; in-memory transcript lifecycle; named workdir, zero/delete on every exit path, crash-recovery sweep; AF-style failure test | §7.4; §8.3 T12 |
| P-9 Retention classification | SHOULD-FIX (must-fix list #9) | **Resolved in design** — one sentence: recording-class, shortened 30-day sub-policy; measurements 30 d aligned to L-RET-02(a); frames bucket never cited | §5.1 |
| P-10 Legal hold + purge-live | Carried condition | **Design text present; practice carried** — hold check named in both purge paths; absence of any existing hold mechanism flagged as discovered gap G-1 for Lead; purge-live verification for `observer_audio` named as an activation precondition | §5.5; §3.3 (activation precondition list) |
| P-11 Log schema + flag-transition line + attestation | Carried condition | **Schema in design; attestation carried** — structured log schema enumerated (fields in/out); worker-observed flag-transition audit line specified; per-release dormancy attestation named as a Lead-owned release deliverable | §6.4 |
| P-12 DEK-encrypt measurements | Carried condition (decision at design) | **Decision taken in design: ENCRYPT** — same envelope/AAD discipline; only row state + `method_version` outside the envelope; cross-session aggregation/profiling prohibited. Implementation is build-phase | §7.5 |
| P-13 Single result schema + frozen definitions | SHOULD-FIX (must-fix list #10) | **Resolved in design** — Quinn §2.3 adopted, carrying `n` + `uncertainty.kind`; three-term gap vocabulary mapped; one frozen filler lexicon in one named place | §7.2, §7.3, §7.5 |
| P-14 L-COH / L-JAN ownership | SHOULD-FIX (must-fix list #11) | **Resolved by cross-reference** — §1.4 points to Lead's package ownership table for every L-COH/L-JAN requirement; Rex's own capture-path cohort check is in §3.3 | §1.4; §3.3 |
| P-15 Evidence-pack custody | Carried condition | **Design text present** — packs contain synthetic identifiers only (a real session ID in a pack is an incident); accountability-schedule retention, restricted access; corpus/run-artefact custody, owner, deletion period | §8.6 |
| P-16 No-secondary-use clause | Carried condition | **Clause in design, verbatim-grade** | §2.4 |
| P-17 Incidental interviewer capture | NOTE (carried) | **Recorded as activation-gate open item** for counsel tracking, with what activation design must add (notice wording, session-keyed retrieval, never analysed) | §3.5 |
| P-18 DEK reading — T8b + creation-race note | NOTE (carried) | **In design as build acceptance criteria** — T8b (erasure → capture attempt ⇒ zero DEKs recreated, zero chunks); one-line concurrency-race note (one-capturing-session cap moots it) | §4.2; §8.3 T8b |
| P-19 Ledger family attribution | NOTE (carried) | **Resolved in design** — the ledger has **no** discriminator today (verified, migration 252), so migration 257 (revised) adds `source_family`; observer-audio rows always joinable to `recording_objects` by key; per-family purge/erasure reporting | §5.2; §9 |
| P-20 Role-flip mid-session | NOTE (carried) | **Design paragraph present** — role binding fixed at Gate 2; identity/role change aborts capture; test optional at build | §3.5 |
| P-21 Decrypt-path enforcement | NOTE (carried) | **Mechanism specified** — decrypt isolated in a test-support module the worker never imports, plus a runtime guard (throws outside test scope / test environment) | §4.5 |
| P-22 D-5 registry: `candidate_data_keys` | NOTE (carried) | **In design** — `candidate_data_keys` named in the §9 capture table registry; dormant run must create zero DEK rows | §9; §8.2 |

Red-line position after v2 (Rex's claim, for the reviewer's re-check —
Lex enforces, Rex does not self-certify): RL-01 closed by §3.2; RL-03
second clause closed by §3.2–§3.3; RL-07 closed by §4.4 + §5.2–§5.4;
RL-11 closed by §3.4 + §6.4. RL-10 remains a **package-level** item: it can
only be confirmed absent against Lead's ownership table (§1.4), not from
this design alone — v2 says so rather than claiming it.

---

## 1. Plain-words summary

Today the AI Observer joins an interview room and listens to nothing. It can
see that tracks exist, but it never receives the actual sound. That is on
purpose: we have not yet built the part that handles a candidate's voice, and
a candidate's voice is sensitive — it can identify them, so the law treats
it carefully.

This design builds that missing part, but builds it **switched off** — and
v2 makes "switched off" and "can only ever be switched on by a decision,
never by an accident" the same engineering property.

- A single switch (the "capture flag") controls it. The switch ships
  **off**. While it is off, the Observer does not subscribe to the
  candidate's audio, does not receive any sound, does not hold any sound in
  memory, and does not save anything. Not "saves nothing but still listens"
  — it does not listen. While capturing (test scope only, in this build) a
  watchdog re-reads the switch every second; turning it off stops capture
  within 2 seconds.
- Turning the switch on is **not** enough to record anyone real. Capture of
  a real candidate additionally requires: the candidate's original presence
  consent, a **separate recording consent** given after the employer was
  formally enabled for activation, the employer being on the design-partner
  cohort list with that membership recorded for that session, and the
  session having started in the same environment the worker runs in. In
  this build the separate recording consent does not exist yet (its wording
  belongs to counsel), so real capture cannot happen in this build at all.
  The end-to-end path is exercised only on **fake (synthetic) voices**, in
  a test scope that is technically incapable of pointing at a real session.
- If capture ever runs, the Observer receives **only the candidate's
  microphone audio** — never the interviewer's — in small 30-second pieces.
  Before any piece is saved, the system first writes a register entry
  saying "a piece with this name is about to exist." If the save then
  fails, the register entry is cleaned up. A saved piece the system cannot
  track — and therefore cannot delete later — is not allowed to exist.
- Each piece is scrambled (encrypted) with a key that belongs to that one
  candidate **before** it is saved, and the register entry carries an
  expiry date of **30 days**. Captured audio is legally a *recording*;
  Rekrut keeps it for a shortened 30 days under that classification. The
  existing daily cleanup deletes expired pieces automatically. If a piece
  cannot be entered in the register, it is deleted instead of kept.
- The measurements computed from the sound are encrypted with the same
  candidate key before they are stored, so deleting a candidate destroys
  the measurements' readability everywhere the key is gone — the same
  guarantee as the audio, not a weaker one.
- From the sound we compute a small set of honest speech measurements: how
  fast the candidate spoke, how long their pauses were, pitch (how high or
  low the voice is) and how much it varied, how loud, how much they spoke.
  If a measurement cannot be computed properly, the system records it as
  `missing`, with a reason. It never invents a number. There is no "stress
  score" and nothing in this design claims to detect lying — the science
  does not support that, and Sumanth has already banned it.
- The words the speech recogniser produces on the way to two of the
  measurements are **never kept**: they exist in memory for the duration of
  one calculation, are never written to disk as a transcript, never logged,
  and never stored. The recogniser's temporary working files live in one
  named folder, are wiped on every exit, and are swept clean when the
  worker starts, in case a crash left any behind.
- Nothing in this build shows the measurements to anyone. There is no
  report, no screen, no recruiter view. Building the report is a different,
  parked piece of work. This build is the safe plumbing plus the
  measurements, tested end-to-end on synthetic voices only — plus a
  permanent per-session record of *counts* (how many pieces were saved or
  dropped, why capture stopped) so that what was and was not collected can
  always be reconstructed afterwards.

The whole thing is one indivisible unit (§10): five stories that are
planned together, built together, and closed together — **40 points**
(re-estimated in v2; §10 explains the +11 delta over v1's 29). No story in
it is "done" on its own, and the switch stays off in production regardless.

### 1.4 Cross-reference — L-COH / L-JAN ownership (P-14)

The January presence tier (cohort definition as a product matter, the
January consent/attendance audit record — Lex's "audit spine") is **not
implemented by this design** and was not implemented by v1 either; v1's
defect was silence about who owns it. The authoritative artefact is
**Lead's package ownership table** in the assembled Gate A package, which
names, for every requirement below, the owning design/story and where it is
evidenced. This design's obligations are the capture-path touchpoints only,
listed in the right-hand column. Sumanth should not approve the package
until Lead's table shows an owner for every row; Rex's rows are closed by
this design, the rest are Lead's to evidence.

| Lex requirement family | Owner (per Lead's package table) | Rex / this design's touchpoint |
|---|---|---|
| L-COH-01/02 cohort allow-list + per-session membership record | Lead's table names the January-tier owner | Capture decision enforces membership and fails closed if unevidenced — §3.3 (capture-side record: `observer_cohort_membership`) |
| L-COH-03 cohort-only enablement in code | Shared: January enablement owner + Rex | Capture enablement for a non-cohort session is impossible through the capture path — §3.2/§3.3 |
| L-COH-04 cohort promise wording | Lead's table (copy owner) | No capture copy exists in this build; §2.2/§2.4 prohibit divergence |
| L-COH-05 no public January consent ask | Lead's table | No public flow in this design; activation artefact (§3.2) is not a January ask |
| L-COH-06 employer as separate consent actor | Lead's table | Activation enablement record is per-employer and independent of candidate consent — §3.3 |
| L-COH-07 cohort cap | Sumanth at design gate, via Lead's table | Capture path honours whatever allow-list exists; absence of a cap is Lead's to surface, not Rex's to set |
| L-COH-08 no cross-cohort data use | Rex (design clause) + Lead's table | §2.4 no-secondary-use clause |
| L-JAN-01…07 January audit record (incl. `analysis_provided: false`, immutability, completeness, no media on that path) | Lead's table names the spine owner — **not Rex, not this build** | This design creates no January record and no observer report rows beyond the existing S-049a skeleton (§2.2); the capture-outcome record (§8.5) is a *capture* accountability record and is not a substitute for the January spine |

## 2. Complete-unit scope boundary

### 2.1 In — and in fully

1. **Audio consumption** in the existing in-process Observer worker
   (`workers/ai-observer/index.js`), candidate track only, behind the
   capture gate (§3, §6).
2. **Encrypted persistence** of captured audio using the codebase's existing
   envelope-encryption pattern (`lib/biometricCrypto.js` +
   `lib/r2FrameStore.js`/`lib/r2RecordingStore.js` precedent), as a new store
   module (§4), with registry-intent-first registration (§4.4).
3. **Registration in `recording_objects`** plus full composition with the
   S-077 retention lifecycle and the migration-252 `pending_storage_deletions`
   ledger — retention-bound and erasable from day one, including new
   erasure-service wiring for this object family (§5) and the
   withdrawal-erasure path (§5.4). No orphan paths.
4. **Gate composition** (§3.2): flag + presence consent + activation consent
   artefact + cohort membership + origin-environment match + scope
   resolution, as independent fail-closed conditions.
5. **Flag mechanics** whose OFF state is zero collection: no subscribe, no
   receive, no buffer, no persist — and whose ON→OFF transition stops
   capture within ≤ 2 s (§6).
6. **Dormancy proof hooks**: in-process counters and test seams that let
   Quinn's automated tests *prove* zero collection while dormant, and prove
   the end-to-end flow on synthetic media while enabled in test scope (§8).
7. **The speech-pattern slice**: honest measurements only, computed as
   designed in §7, returned under the single Quinn §2.3 contract. Hard
   rule: **no heuristic fallback scores, ever** — a measurement that cannot
   be computed is `missing`, with a reason.

### 2.2 Out — by ruling, named, not designed

| Out | Where it lives / what governs it |
|---|---|
| Integrity fusion (quality-weighted signal fusion) | #674 — parked. Not a dependency of this unit; nothing here feeds it |
| Visual / body measurement of any kind (gaze, face, expression, body language) | Out of the programme entirely per Gate A ruling — not deferred, removed |
| S-049b report generation (populated observer reports) | #697 — parked. This unit writes **no** report rows beyond the existing S-049a skeleton and adds **no** reader of measurements or audio |
| Video capture | Not ruled in anywhere; the worker must not subscribe to video tracks for capture (§3.5) |
| Activation for real candidates | Re-entry contract on #634: counsel + design cleared by **2026-11-01** → cohort pilot *may* activate; after **2026-12-01** → nothing activates pre-launch. Activation is a separate, future, Sumanth-approved act. This design builds the gate that activation must pass through; the gate's activation scope cannot pass in this build because the activation consent artefact (counsel-reviewed wording, C-04) does not exist yet (§3.2) |
| Interviewer audio capture/persistence | Never in scope (§3.5, data minimisation). Incidental interviewer speech inside candidate-track audio is a named activation-gate open item (§3.5, P-17) |
| Transcripts as a product surface, or as stored data of any kind | ASR is used inside §7 only as an ephemeral measurement input; no transcript is stored, shown, logged, or retained (§7.4) |
| The January audit spine (L-JAN-01…07) | Owned elsewhere in the package — see §1.4. This design references it; it does not implement it and does not claim it |

### 2.3 The one deliberate behaviour change to shipped code

The S-047 worker currently calls `pub.setSubscribed(true)` on participant
tracks even though it consumes nothing (S-082 spike, verified). Under this
design, **subscription to the candidate's audio track moves behind the
capture gate** (§3.2). Presence does not need media: the Observer is present
by joining the room, which it still does exactly as today. This change is
what makes "zero collection while dormant" literally true and provable (§8)
rather than "subscribed but we promise we dropped the frames." It ships
inside this unit, behind the same flag, and is covered by the dormancy
tests — it is not a side fix to S-047.

Binding addition from the review's Q1 answer: while dormant, the worker
must also never sample, log, or store any SDK-surfaced **audio-level /
speaking-indicator** values. Those values are derived from media energy;
sampling them while dormant would turn "presence" into quiet measurement.
The capture module never reads audio-level/speaking indicators in *any*
mode — measurements come from PCM only, and only while capturing (§7).
Track *metadata* (that a track exists, its kind) remains presence data,
covered by the January audit record, not by capture consent.

### 2.4 No-secondary-use clause (P-16 — verbatim-grade)

> Captured audio, speech measurements, capture-outcome records, cohort
> records, and synthetic-run artefacts produced under this design must not
> be used to train, calibrate, baseline, or validate any model or signal;
> must not be pooled across employers, across cohort and non-cohort data,
> or across purposes for any analytic purpose; and must not be used for
> product analytics. Any such use is a new purpose: it requires its own
> consent artefact, its own counsel review, and its own Sumanth-approved
> gate, before any data moves. The unbuilt E-003 calibration baseline is
> named expressly: it is not a permitted use, a retention justification, or
> a roadmap assumption for any data in this design. (Lex L-COH-08,
> L-RET-07; red line RL-06.)


## 3. Architecture

### 3.1 Dormant state machine

Per session, the worker is in exactly one of `DORMANT` (joined,
presence-only) or `CAPTURING`, as sub-states of the existing `observing` job
status — **no new `observer_jobs` status values** (the lifecycle in
`lib/observerJobs.js` is unchanged; capture state lives in the worker's
`activeJobs` entry, extended with a `capture` field:
`{ mode: 'dormant'|'capturing', scope, stats: {...} }`).

```
                         ┌──────────────────────────────────────────────┐
                         │            WORKER (in-process)               │
                         │  poll 5s · heartbeat 30s · sweeper 60s     │
                         │  + capture watchdog 1s (capturing only)    │
                         └──────────────┬───────────────────────────────┘
                                        │ claim job (existing; capture
                                        │  additionally origin-scoped §3.4)
                                        ▼
                              ┌───────────────────┐   gate fails
                              │ GATE 1: claim-time │──────────────► cancel job
                              │ presence consent   │   (existing codes)
                              └─────────┬─────────┘
                                        │ granted
                                        ▼
                              join room (autoSubscribe:false, existing)
                                        │
                                        ▼
                              ┌───────────────────┐   gate fails
                              │ GATE 2: pre-       │──────────────► disconnect,
                              │ subscribe presence │   cancel job (existing)
                              │ consent            │
                              └─────────┬─────────┘
                                        │ granted
                                        ▼
                        ┌───────── CAPTURE DECISION (§3.2) ──────────┐
                        │ flag (fresh) AND scope resolved AND:     │
                        │  · test scope: test marker + non-prod env │
                        │  · activation scope: activation artefact  │
                        │    + presence consent + cohort member-    │
                        │    ship + origin-env match                │
                        └───────┬───────────────────┬────────────────┘
                     any fails│                   │all pass
                               ▼                   ▼
                    ┌──────────────────┐  ┌──────────────────────────┐
                    │ DORMANT          │  │ CAPTURING                │
                    │ presence-only    │  │ candidate audio only:    │
                    │ · no subscribe   │  │ subscribe → AudioStream  │
                    │ · no stream      │  │ → segment → measure →    │
                    │ · no buffer      │  │ intent → encrypt → PUT → │
                    │ · counters stay 0│  │ confirm (30s chunks)     │
                    └────────┬─────────┘  └───────┬──────────┬───────┘
                             │ 5s consent tick    │ watchdog │ teardown
                             │ (existing)         │ 1s: flag/│ triggers:
                             ▼                    ▼ consent ▼ (§6.3)
                    session completed →   TEARDOWN: unsubscribe, close
                    flushReport (S-049a,  stream, zero buffers, write
                    unchanged)            capture-outcome record (§8.5);
                                          job path unchanged
```

Transitions out of `CAPTURING` are all fail-closed and one-way per session:
a session that leaves `CAPTURING` never re-enters it (a fresh job would be
required, and `observer_jobs` is one-job-per-session by UNIQUE constraint —
so in practice, capture loss is final for that session and is recorded in
the capture-outcome record, §8.5). In particular, a flag flipped ON
mid-session does **nothing** to a session already dormant: the capture
decision is made once, at Gate 2. This is stricter than Quinn FI-1's floor
(no frame from before a flip may exist — here no frame from the session
exists at all), and Quinn should record the stricter behaviour as the
expected result for FI-1 rather than expecting capture to start at the flip.

### 3.2 The capture gate — composition (P-1, P-2)

Capture requires **all** of the following, each checked independently, each
fail-closed, none implying another. "We could not check" is a failure of
that condition (see §6.3).

| # | Condition | Mechanism |
|---|---|---|
| G-FLAG | Capture flag is exactly `'true'`, read fresh | `lib/observerCaptureFlag.js` (§6.1); checkpoints: capture decision, `TrackSubscribed` entry, every chunk persist, every measurement persist, plus the 1 s watchdog while capturing |
| G-SCOPE | A capture scope resolves (§3.3): `test` or `activation`. No scope ⇒ no capture | `resolveCaptureScope(session, job, workerEnv)` in the capture module; scope is recorded on the session's capture state and in the capture-outcome record |
| G-PRESENCE | Presence consent granted: `biometric_collection === true` via the existing single authority `lib/observerConsentGate.js` | Unchanged shipped gate; **necessary, never sufficient** for capture. Lex L-SCO-03 is honoured: this design adds no parallel *presence* check — the capture gate *composes* the presence gate, it does not duplicate or bypass it |
| G-ACTIVATION | *(activation scope only)* A distinct activation consent artefact exists and is satisfied — see artefact model below | New check in `lib/observerCaptureGate.js`, reading `consent_receipts` via `lib/consentService.js`; checked **separately from** G-PRESENCE at Gate 1, Gate 2, `TrackSubscribed`, every chunk persist, and measurement persist |
| G-COHORT | *(activation scope only)* The session's employer is on the cohort allow-list, with membership recorded for this session (§3.3) | `observer_cohort_membership` row for the session; missing/unevidenced ⇒ treated as non-cohort ⇒ no capture |
| G-ENV | *(both scopes)* The job's stamped origin environment equals the worker's own environment (§3.4) | `observer_jobs.origin_env` vs the worker's environment identity, checked at claim, at the capture decision, and at every persist |
| G-JOB | *(both scopes)* The `observer_jobs` row for the session still exists | Existing job-existence rule (S-049a pattern), re-checked inside every persist transaction under the advisory lock (§5.2) |

**The activation consent artefact (P-1, Lex L-ACT-01/02).** Activation
consent is a new consent type, `observer_capture`, in the existing consent
machinery — not a new interpretation of an old row:

- `lib/consentService.js` gains `observer_capture` in its valid types. Its
  text lives in `consent_texts` as a versioned artefact whose required
  contents are Lex L-ACT-02(1)–(8): recording and storage in plain words;
  what is derived; what will not be claimed (no deception; stress, if ever,
  only as a meter with uncertainty); who sees what; retention for audio and
  for derivatives (§5.1); the consequence of declining and the no-inference
  rule; how to withdraw and what withdrawal does to already-captured audio
  (§5.4); per-purpose scope, with any new purpose requiring a new ask.
  Final wording is counsel's determination (C-04) — **this build ships no
  activation artefact text**, so no `consent_texts` row for
  `observer_capture` exists, so no receipt can exist, so G-ACTIVATION can
  never pass for a real session in this build. That is the intended
  dormant-build posture, not a missing feature.
- A receipt satisfies G-ACTIVATION only if **all** hold, read live from
  `consent_receipts` (never cached, per `consentService` discipline):
  (a) `consent_type = 'observer_capture'` for this session and candidate;
  (b) `granted_at IS NOT NULL` and `withdrawn_at IS NULL`;
  (c) `consent_text_version` equals the **current** activation artefact
  version (server-side `MAX(effective_from)` resolution, as
  `getCurrentTextVersion` already does — a receipt under a superseded
  artefact version does not satisfy the gate);
  (d) `granted_at` is **strictly after** the employer's activation
  enablement timestamp (§3.3, `observer_activation_enablements.enabled_at`).
  A grant timestamped before the enablement decision is, by construction,
  consent given for something else — banked consent — and the gate rejects
  it with a distinct code (`CAPTURE_CONSENT_BEFORE_ENABLEMENT`), alongside
  `CAPTURE_CONSENT_MISSING` (no receipt), `CAPTURE_CONSENT_STALE_VERSION`,
  and `CAPTURE_CONSENT_WITHDRAWN`. Distinct codes matter: Lead and Quinn
  must be able to tell "never asked" from "asked under the wrong promise"
  in evidence.
- Granularity (L-ACT-03): `observer_capture` is its own artefact, separate
  from any future analysis consent and from any retention-beyond-default
  consent. Accepting an interview is never the same act as granting it.
  Returning candidates (L-ACT-07): a January cohort candidate sitting a
  later activated session takes the full activation ask; no copy or flow
  may reference their January presence as prior agreement. (Copy is
  counsel/Lex scope at activation; the gate property — a fresh receipt,
  post-enablement — is this design's.)

**Checkpoints.** G-PRESENCE is checked where it already is (Gate 1, Gate 2,
5 s tick) and additionally at `TrackSubscribed` and every persist.
G-ACTIVATION, G-COHORT, G-ENV, G-FLAG are checked at: the capture decision,
`TrackSubscribed` entry, every chunk persist (inside the persist
transaction where a DB fact is involved), and measurement persist (§5.2).
The 1 s watchdog (§6.1) re-checks G-FLAG and both consent conditions while
capturing.

**The missing test case is now named (P-1).** T4b (§8.3): a session whose
only consent is January-state presence consent (`biometric_collection ===
true`, no `observer_capture` receipt), flag ON, activation scope attempted
⇒ capture never starts and **all capture counters stay exactly 0**. This is
Lex's L-DOR-03(iii) case; v1's T4 (unknown/declined) did not cover it.

### 3.3 Scope, cohort, and the L-ACT-04 map (P-2)

**Scope resolution.** `resolveCaptureScope` returns exactly one of:

- **`test`** — all of: worker environment is **not** production; the
  session carries the synthetic/test marker (set only by the validation
  harness at session creation — no product path sets it; the session's
  candidate is a synthetic test candidate, not a real user); the flag is
  ON. Test scope may capture **only** test-marked sessions. Storage prefix
  and row markers follow §3.4.
- **`activation`** — all of G-FLAG, G-PRESENCE, G-ACTIVATION, G-COHORT,
  G-ENV hold. In this build G-ACTIVATION cannot hold (no artefact exists),
  so this scope is unreachable until activation — by construction.
- **`none`** — anything else. No capture.

A real (non-test-marked) session can therefore never be captured under
test scope, and a test session can never be captured under activation
scope. That disjointness is the technical content of Quinn R-Q12 and Lex
L-ACT-06: pre-activation, the pipeline *cannot* be pointed at a non-test
session — "we just won't run it" is not the control; the scope check is.

**Cohort mechanics in the capture path (Lex L-COH-01/02/03).**

- The cohort is an employer-level allow-list:
  `observer_cohort_allowlist` (company/employer ID, added-at, added-by,
  allow-list version). Membership is never by self-selection, public
  toggle, or candidate opt-in (L-COH-01).
- At or before session start, membership is snapshotted per session into
  `observer_cohort_membership` (session ID, employer ID, allow-list
  version, `in_cohort` boolean, recorded-at; immutable thereafter —
  corrections are appended rows, never edits, mirroring L-JAN-05's
  discipline for the spine). Adding an employer is prospective only: it
  never retroactively brings past sessions into the cohort.
- The capture decision reads the snapshot. **No snapshot ⇒ non-cohort ⇒
  no capture** (fail-closed if unevidenced). The decision and the snapshot
  version it relied on are recorded in the capture-outcome record (§8.5).

**Employer activation enablement.** `observer_activation_enablements`
holds at most one current row per employer: employer ID, `enabled_at`,
enabled-by, and the six L-ACT-04 evidence reference fields below (each a
document/issue/version reference, all non-null — the row cannot be
inserted with any of them empty). Creating this row is a deliberate,
out-of-band operator act performed only after Lead has verified the
checklist; there is no UI, API, employer-side setting, or deploy path that
creates it. Candidate consent never substitutes for it, and it never
substitutes for candidate consent (L-COH-06). It does not exist for any
employer in this build.

**L-ACT-04(a)–(f) — what satisfies what (P-2 requirement (c)).** A flag
flip satisfies **none** of (a)–(f). The table is exhaustive:

| L-ACT-04 item | Kind | How it is satisfied / evidenced |
|---|---|---|
| (a) Counsel determinations in writing (Observer capture/analysis; #788 CRA determination tracked separately — threat-intel stays dark on its own determination regardless) | **Gate evidence** Lead verifies | Reference stored in `observer_activation_enablements.counsel_ref`; no enablement row without it. Not a per-session technical check — the enablement row's *existence* is the technical precondition, and G-ACTIVATION's post-enablement timestamp rule (§3.2(d)) ties every consent to it |
| (b) Lex activation-flow review against final copy | **Gate evidence** Lead verifies | Reference in `lex_activation_ref`; same row-existence mechanism as (a) |
| (c) Quinn validation executed on synthetic/test media, results recorded | **Gate evidence** Lead verifies **+ technical precondition in the path** | Reference in `quinn_validation_ref`; *and* the only scope reachable before it is `test` (§3.3) — the pipeline Quinn validates is technically incapable of reaching a real session, so validation cannot accidentally become collection |
| (d) #777 policy-page fix live | **Gate evidence** Lead verifies | Page version reference in `policy777_ref`. (#777 also blocks January *presence* enablement independently — a package-level gate Lead keeps distinct from this build, per the review's RL-04 note) |
| (e) BIPA §15(a) public retention schedule updated to cover captured audio **before** first capture | **Gate evidence** Lead verifies | Schedule version reference in `bipa_schedule_ref`; the schedule wording itself is counsel-reviewed (L-RET-04, C-04) |
| (f) Sumanth's explicit activation approval at a new gate | **Gate evidence** — the decision itself | Approval reference in `sumanth_activation_ref`. Sumanth's approval is the act that permits the enablement row to be created; nothing in the code path creates it |
| Cohort membership (L-COH-01/02) | **Technical precondition in the path** | G-COHORT, checked per session at every checkpoint (§3.2) |
| Activation consent artefact, current version, post-enablement (L-ACT-01/02) | **Technical precondition in the path** | G-ACTIVATION, checked per session at every checkpoint (§3.2) |
| Re-entry dates (L-ACT-05: cleared by 2026-11-01 → pilot *may* be proposed; after 2026-12-01 → nothing activates pre-launch) | **Gate discipline**, owner Lead | Stated here as a hard constraint on when an enablement row may be created; the code cannot encode a calendar decision, so Lead's contract owns it and open triggers escalate to Sumanth |

### 3.4 Environment claim-scoping and synthetic segregation (P-5)

Staging shares the production database (standing, intentional). v1 ignored
what that means for a claiming worker; v2 designs for it.

**Origin stamping (the named mechanism).** Migration 257 (revised, §9)
adds `origin_env` to `observer_jobs`, stamped at job creation from the
creating process's environment identity — `process.env.NODE_ENV`
normalised to `production | staging | test | development`, the same value
the codebase already uses to distinguish services (`server.js`,
`lib/db.js`). Rows created before the migration, or by any path that does
not stamp, carry `origin_env = 'unknown'`.

**Claim scoping.** Presence claiming is unchanged (presence already ships
and is not capture). Capture is scoped separately and strictly:

- The worker may only *decide capture* for a job whose `origin_env` equals
  the worker's own environment identity. A staging worker that claims a
  production-originated job for presence treats it as presence-only,
  always — the capture decision fails G-ENV before any other capture
  condition is consulted.
- `origin_env = 'unknown'` is capture-ineligible (fail-closed).
- G-ENV is re-checked at the capture decision and inside every persist
  transaction (the job row is already re-read there for G-JOB, §5.2), so a
  job cannot change eligibility mid-session unnoticed.

**Synthetic/test segregation (Lex L-DOR-05, RL-11).**

- **Storage:** test-scope chunks use the distinct prefix
  `observer-audio-test/`; real chunks use `observer-audio/` (§4.2). The
  prefixes never mix, and Quinn's dedicated test prefix (§3.2 of her
  protocol) is this prefix.
- **Rows:** `observer_audio_chunks`, `observer_speech_measurements`, and
  `observer_capture_outcomes` each carry `is_test BOOLEAN NOT NULL`
  (test-scope writes set it `true`; activation-scope writes set it
  `false`). Registry rows for test chunks are identifiable by their
  `observer-audio-test/` key prefix.
- **Views:** every candidate-facing surface and every erasure/retention
  view of *real* data filters `is_test = false` (no such surface reads
  this data in this build — the filter rule is stated now so the first
  reader inherits it). Test rows are never returned as a candidate's data,
  and a real candidate's data is never written with `is_test = true` — a
  violation of either is an incident, not a data point (L-DOR-05).
- **Deletion schedule + owner:** test-scope artefacts (storage objects,
  chunk rows, measurement rows, outcome rows) are deleted by
  `purgeTestObserverAudio()` (§5.5) — run at the end of each validation
  run and at least weekly during any period test capture has run — with a
  maximum test-artefact lifetime of **7 days**. Owner: **Lead** (schedule),
  executed by the worker sweeper / Quinn's run teardown (mechanism).
  The synthetic *corpus* itself is governed separately in §8.6 (it is a
  versioned test asset, not a run artefact).
- **Production prohibition:** enabling `OBSERVER_AUDIO_CAPTURE_ENABLED` in
  the **production service** for synthetic sessions is prohibited — full
  stop (the reviewer's Q8 answer, adopted). The production worker rejects
  test scope outright (scope resolution returns `none` when the worker
  environment is `production` and the session is test-marked), and
  production is not a validation rung (Quinn §8.2). Rung 2 staging, with
  the segregated prefix above, is the designed ceiling for synthetic
  end-to-end evidence.

### 3.5 Who is captured, the segmenter, roles, and incidental capture

- **Candidate only.** Interviewer tracks are not subscribed for capture,
  not consumed, not persisted. (Interviewer speech was "diarization
  context" in the E-008 spec; capturing a second person's voice to measure
  a first person fails data minimisation, and §7 shows every in-scope
  measurement is computable from the candidate track alone — the ones that
  are not are honestly `missing`, §7.2.)
- **Video tracks are never subscribed for capture** in any mode. While
  dormant they are not subscribed at all (§2.3); while capturing, only the
  candidate audio publication is subscribed.
- **Segmenter**: a small pure-JS energy segmenter over PCM frames — RMS
  energy above an adaptive noise floor = speech; gaps ≥ 700 ms close an
  utterance (the *segmenter utterance-gap*, §7.3 — a segmentation
  parameter, not a pause definition). No new dependency (the Silero VAD
  lives in the separate Track B agent process and pulling the agents
  framework into the web process for one VAD is not justified — ponytail:
  a deterministic energy segmenter is also *more* testable on synthetic
  media, §7.6). Its thresholds are named constants in one place, versioned
  with the measurements (`method_version` / provenance, §7.5).
- **Role binding and role-flip abort (P-20).** "Candidate only" rests on
  the existing `resolveRoles`. v2 states the failure mode plainly: if role
  resolution ever mislabels the interviewer as the candidate, every
  downstream control (AAD binding, erasure-by-candidate) would faithfully
  protect the *wrong person's* audio under the wrong consent and the wrong
  DEK. The design does not re-engineer role resolution; it contains the
  blast radius: the candidate participant identity (LiveKit identity
  string) resolved at Gate 2 is **bound** into the session's capture state,
  and the pump verifies on every chunk persist that the track's participant
  identity still equals the bound identity. A participant identity change,
  a re-resolve that flips the role, or a reconnect presenting a different
  identity ⇒ **capture aborts** (teardown per §6.3, outcome
  `stop_reason = 'role_flip'`). Chunks are never re-bound to a different
  candidate mid-session.
- **Incidental interviewer capture (P-17) — activation-gate open item.**
  The candidate's microphone will pick up the interviewer's voice
  (speakerphone, room echo). Persisted chunks will therefore incidentally
  contain a second person's voice, processed under the candidate's consent
  and keyed to the candidate's ID. This does not block the dormant build
  (nothing is captured), but v2 records it as a named open item for the
  activation gate and for counsel tracking (alongside C-04/C-05): before
  activation, the activation design must include (i) interviewer notice
  wording — candidate-track audio may incidentally contain them, and whose
  notice/basis covers it (the employer's, not the candidate's consent);
  (ii) a standing rule that incidental audio is never *analysed* (no
  diarization revival, no interviewer measurement of any kind); and
  (iii) session-keyed retrievability, so an interviewer erasure/DSAR can
  reach the chunks of sessions they sat in — today's candidate-keyed
  erasure queries cannot find incidental audio by person.

### 3.6 LiveKit audio subscription / consumption path

The consumption pattern is not new invention — it copies the one working
in-repo precedent, the Track B voice agent's observer pump
(`agents/voice-interviewer/worker.mjs`: `RoomEvent.TrackSubscribed` →
`new AudioStream(track, sampleRate, 1)` → `for await (const frame of
stream)`). What does **not** transfer from Track B: its VAD library pipeline
and its transcript persistence into `interview_sessions.config` (that
pattern is exactly what this design forbids for observer audio, §7.4).
Nothing from `services/interview-ai.js` transfers (S-082 §1, settled).

Path, step by step (all inside `workers/ai-observer/index.js` plus the new
modules in §3.8):

1. Room connect unchanged: `new Room({ autoSubscribe: false })`,
   subscribe-only token via `createObserverToken` (existing, least
   privilege: `canPublish:false, canSubscribe:true, canPublishData:false`).
2. Gate 2 (pre-subscribe presence consent) unchanged and still runs
   **before any subscription of any kind**.
3. Capture decision (§3.2): evaluate G-FLAG + scope + (activation scope)
   G-ACTIVATION + G-COHORT + G-ENV. If the decision is not CAPTURING →
   skip every `setSubscribed(true)` call for media tracks and register
   **no** `TrackSubscribed` handler. The `TrackPublished` handler
   (existing) is amended the same way: while dormant it observes the event
   and subscribes to nothing.
4. If CAPTURING → subscribe only to the **candidate's audio publication**
   (`pub.kind === 'audio'`, participant resolved as candidate by the
   existing `resolveRoles`, identity bound per §3.5). On
   `RoomEvent.TrackSubscribed` for that track — and only after the full
   gate is re-checked at that moment — open `new AudioStream(track, 16000,
   1)` (16 kHz mono — the rtc-node stream resamples; voice-specialist rule:
   normalise once, at the boundary) and start the frame pump. Start the 1 s
   capture watchdog (§6.1).
5. Frame pump: each `AudioFrame.data` (Int16 PCM) is appended to the
   current utterance buffer and fed to the segmenter (§3.5) and the
   streaming measurement accumulators (§7). Frames are never written
   anywhere raw.
6. Every 30 seconds of accumulated audio, or at a **long-pause** (≥ 2 s,
   §7.3) ending an utterance group, or at teardown-with-all-gates-intact:
   the buffered PCM is handed to the persistence path (§4) as one chunk.
   Persist is **per-chunk gated**: the full gate (§3.2) is re-evaluated at
   persist time, inside the persist transaction where a DB fact is
   involved (§5.2) — not assumed from join time.

### 3.7 Where audio lives in memory, and for how long

| Location | Content | Lifetime | Cap |
|---|---|---|---|
| Frame pump | One `AudioFrame` at a time | Duration of one iteration | One frame (~10–20 ms audio) |
| Utterance buffer | Int16 PCM of the current chunk being accumulated | Until chunk persist or teardown, then **zeroed** (`buffer.fill(0)`) and released | 30 s audio = 960 KB at 16 kHz/16-bit mono; hard cap 120 s (3.84 MB) — cap hit forces an early chunk persist |
| Measurement accumulators | Running sums/counts/histograms only (no PCM) | Session duration | Fixed-size structs, < 64 KB |
| Transcript string (§7.4) | ASR output text for the current computation only | Duration of one `computeSpeechMeasurements` call; reference dropped at return | One session's transcript, in memory only — never accumulated across calls, never copied into accumulators, logs, or rows |
| ASR temp files (§7.4) | Whisper input/output sidecars, capture workdir only | Duration of one ASR invocation; zeroed + deleted on every exit path; crash orphans swept at worker start | One invocation's files at a time (one capturing session per process) |
| DEK plaintext | Per chunk / per measurement, inside `biometricCrypto` encrypt call | One encrypt operation | 32 bytes, zeroed by existing code |

Hard rules: raw PCM is **never** written to disk, logs, or the database;
never held past its chunk boundary; total in-memory audio per session
< 5 MB. One capturing session at a time per process (the worker is
in-process in the web server on a $0 tier — a second concurrent capturing
session stays `DORMANT` with reason `capture_concurrency_cap`; presence is
unaffected). On any teardown — consent withdrawal, flag flip, session end,
worker shutdown — all buffers are zeroed before the room disconnects,
reusing the existing "discard in-memory buffers" semantics of the consent
tick.

### 3.8 New / changed components

| Component | New or changed | Responsibility |
|---|---|---|
| `workers/ai-observer/index.js` | Changed | Capture decision at Gate 2, TrackSubscribed pump, per-chunk persist gate, 1 s capture watchdog, capture stats, teardown zeroing, crash-recovery sweep of the capture workdir at start (§7.4), flag-transition observation (§6.4) |
| `lib/observerCaptureGate.js` | **New** | Gate composition (§3.2): scope resolution, activation-artefact check, cohort check, env check — one function, one place (Quinn R-Q1/R-Q10 analogue for the capture gate) |
| `lib/observerCapture.js` | **New** | Segmenter + streaming accumulators + chunk assembly. Pure functions over PCM where possible (Quinn's seam, §7.6) |
| `lib/r2ObserverAudioStore.js` | **New** | Envelope encrypt for audio chunks (§4), modelled on `lib/r2RecordingStore.js`; registry-intent-first registration (§4.4). Exports **no** decrypt (see §4.5) |
| `lib/observerAudioTestDecrypt.js` | **New** (test-support only) | The sole decrypt path for observer audio (§4.5, P-21) — never imported by the worker |
| `lib/observerSpeech.js` | **New** | §7 measurement computation from PCM (+ ephemeral ASR transcript, §7.4), producing the Quinn §2.3 record (§7.5); owns the frozen filler lexicon and method constants |
| `lib/observerCaptureFlag.js` | **New** (small) | The single flag reader (§6.1) — one function, strict parsing, no caching; the only place the env var is read |
| `lib/consentService.js` | Changed (small) | `observer_capture` added to valid consent types (§3.2). No artefact text ships in this build |
| `lib/erasureService.js` | Changed | New object-family wiring incl. withdrawal queue consumption (§5.2, §5.4) |
| `services/euComplianceService.js` | Changed (small) | Registry-purge cleanup of chunk metadata, measurement purge, pending-intent reconciliation, test-artefact purge — all behind the hold-check seam (§5.5) |
| Migration 257 (revised) | **New** | §9 |
| `server.js` | **Unchanged** | Worker already starts in-process; retention cron already calls the registry sweep |

## 4. Encrypted persistence design

### 4.1 Pattern: reuse, do not reinvent

Observer audio uses the exact envelope the codebase already trusts for
frames (`lib/r2FrameStore.js`) and recordings (`lib/r2RecordingStore.js`):

- AES-256-GCM via `lib/biometricCrypto.js`, per-candidate **random** DEK
  from `candidate_data_keys`, wrapped under `BIOMETRIC_ENCRYPTION_KEY`.
- Envelope bytes: `0x01 || iv(12) || tag(16) || ciphertext`, packed with the
  existing `packEnvelope`/`unpackEnvelope`.
- The storage PUT only ever sees ciphertext. There is no plaintext path and
  no fallback: any crypto or storage failure **drops the chunk** (§6.3) —
  plaintext is never written anywhere as a consolation.

### 4.2 Key hierarchy and binding

```
BIOMETRIC_ENCRYPTION_KEY (env, master)
  └─ wraps ─► per-candidate DEK (random 256-bit, candidate_data_keys)
                └─ encrypts ─► each audio chunk envelope
                └─ encrypts ─► the session measurement payload (§7.5)
```

- AAD for chunk *n* of a session:
  `r2observeraudio:v1:candidate:<candidateId>:session:<sessionId>:chunk:<n>` —
  a **new namespace**, disjoint from `r2frame:` and `r2recording:`, so no
  envelope can be replayed as another data type; the session + chunk
  binding (the `r2RecordingStore` crypto-H1 lesson) means a chunk cannot be
  replayed into a different session or position even under the same
  candidate's DEK. Measurement payloads use the sibling namespace in §7.5.
- Encrypt path uses `encryptWithDEK` (get-or-create, as recordings do —
  first capture for a candidate legitimately creates their DEK). The
  (test-only) decrypt path uses `decryptWithExistingDEK` — select-only,
  never creates key material (the S-059 crypto-L1 rule), and lives behind
  the §4.5 enforcement.
- Object keys: prefix `observer-audio/` (activation scope) or
  `observer-audio-test/` (test scope, §3.4), opaque random filename
  (`audio-<16 hex>.enc`), mimetype `application/octet-stream`. No session
  ID, candidate ID, or timestamp in the key (the S-059 privacy-L1 /
  S-069 privacy-M1 rule). The key is generated **before** the PUT (§4.4).
  The decrypt path validates keys against
  `/^(b2|r2)\/observer-audio(-test)?\//` before fetching (the pentest
  LOW-1 rule).
- **DEK resurrection — reading accepted, evidence required (P-18, Q5).**
  Rex's v1 reading stands and the reviewer accepted it *as a reading*:
  `getOrCreateDEK` refuses destroyed DEKs, so an erased candidate's DEK
  cannot be resurrected by the encrypt path; encrypt throws, the chunk is
  dropped, and the job-existence persist check aborts capture entirely
  (§6.3). No path in §3/§4 as designed recreates a destroyed DEK. Because
  this programme verifies by test, not by reading, build acceptance
  includes **T8b** (§8.3): post-erasure capture attempt ⇒ zero DEKs
  recreated, zero chunks persisted. One-line race note: concurrent
  first-capture chunks for one candidate could race get-or-create — the
  one-capturing-session cap (§3.7) plus per-session chunk serialisation
  moots it in this design.
- Crypto-shredding consequence, stated honestly (per `biometricCrypto.js`'s
  own header): destroying a candidate's DEK makes their chunks
  unrecoverable **from the live database**; it is not backup-proof until
  master-key rotation exists. This unit therefore *also* physically
  deletes chunks on erasure (§5.2) — shredding is the backstop, not the
  mechanism — and §5.3 states exactly what backups do and do not preserve.

### 4.3 Object layout

One storage object per chunk (≤ 30 s audio, ≤ ~1 MB envelope). One
`observer_audio_chunks` row per chunk (§9) holding provenance: session,
candidate, chunk index, duration, byte size, sample rate, object key,
`is_test`. The measurement record (§7) references the session, not
individual chunks.

### 4.4 Registration — intent first, fail-closed (P-3; Q3 answered: registry-first)

Frames and recordings register in `recording_objects` **best-effort** (a
failed INSERT logs a warning; the upload stands). For observer audio that
precedent remains rejected, on the privacy-engineer's rule that delete must
reach every copy *provably*. v1's chosen order (PUT → register →
compensating delete) is **reversed** in v2, per the reviewer's binding
answer to Q3: the compensating delete handles the *detected* failure; it
cannot handle the *silent* one — a crash between PUT and the ledger INSERT
leaves an object no system can find. The reverse orphan (a registry row
whose object never arrives) is visible, countable, and reconcilable; it
contains no media. Hygiene loses to breach-with-no-detection-path, every
time.

Per chunk, in order:

1. **Intent.** Generate the object key. In its **own committed
   transaction**: INSERT the `recording_objects` row with
   `registration_state = 'pending'` and `expires_at = NOW() + 30 days`,
   and INSERT the `observer_audio_chunks` row (same key, byte size not yet
   known). If this transaction fails: no PUT is attempted, the chunk is
   dropped (§6.3) — nothing exists anywhere.
2. **PUT.** Encrypt → PUT ciphertext to storage under the pre-generated
   key. If PUT fails: DELETE the intent rows (they point at nothing) in a
   cleanup transaction; if *that* fails, the rows remain `pending` and the
   reconciler (step 4) removes them — a pending row is self-describing and
   cannot be mistaken for a live object.
3. **Confirm.** In one DB transaction (under the §5.2 advisory lock, with
   the persist-gate re-checks of §3.2 inside it): UPDATE the registry row
   to `registration_state = 'confirmed'`, fill the chunk row's byte size.
   If confirm fails: **compensating delete** — `deleteStorageObject(key)`
   immediately; if that also fails, INSERT the key into
   `pending_storage_deletions` with `source_family = 'observer_audio'`
   (§5.2) so the S-077 sweep keeps retrying the physical delete, stamp the
   registry row for deletion, and raise a loud error log. The object is
   *findable* throughout — by registry row and, failing that, by ledger
   row — which is the property v1's order could not guarantee.
4. **Reconciliation.** A sweeper (`reconcileObserverAudioIntents`, run on
   the worker's existing 60 s sweeper cadence and from the retention cron)
   finds `pending` registry rows older than a 5-minute grace period: if
   the object exists in storage, it deletes the object (+ ledger row on
   failure) and retires the intent rows; if no object exists, it retires
   the intent rows. Separately, the storage-vs-registry diff in §8.3 (T11)
   — bucket listing vs registry, run in the test environment — must prove
   **zero unregistered objects** after kill-mid-PUT injection.

An unregistered object is therefore not "chased" (v1's model); it is
**impossible by construction** — bytes cannot exist before the row that
names them — and the reconciler + diff test exist to prove the
construction holds under crash injection.

### 4.5 Decrypt path — enforcement, not an adjective (P-21)

This unit mints no read path and no presigned URLs for observer audio
(§2.1/§5.2) — that stands. The decrypt *function* nevertheless has to
exist for Quinn's T3/T8 verification. "Test-only" is enforced by two
mechanisms, not a comment:

1. **Module isolation.** Decrypt lives in `lib/observerAudioTestDecrypt.js`,
   imported **only** by tests. `lib/r2ObserverAudioStore.js` (the module
   the worker loads) exports encrypt/persist functions and **no decrypt**.
   A future reader story (S-049b) cannot "conveniently" call a decrypt
   that is not in its import graph; build evidence includes a grep
   assertion that no non-test file imports the test-decrypt module.
2. **Runtime guard.** Inside the test-decrypt module, decrypt throws
   unless **both**: the worker environment identity is not `production`,
   **and** the target key is under the `observer-audio-test/` prefix (or
   the process is running under the test runner, `NODE_ENV = test`).
   Decrypting an activation-scope key outside a test environment is
   impossible through this module by construction — activation-scope
   decryption, if a future reader ever needs it, is a new design with its
   own gate, not a reuse of this module.


## 5. Retention + erasure composition

### 5.1 Retention (S-077 lifecycle, no new machinery) — classification fixed (P-9)

> **Classification (one sentence, in both documents' terms): captured
> audio is recording-class data with a shortened 30-day sub-policy** —
> Rex's 30-day number, Lex's classification (L-RET-01: raw audio is a
> recording, 90-day bucket maximum). The frames bucket is never cited as
> the basis for this data class, and the BIPA §15(a) schedule update at
> activation (L-ACT-04(e)) must use this classification wording.

- Migration 257 (revised) widens `recording_objects.object_type` to
  include `'observer_audio'`, adds `registration_state` (§4.4), and adds a
  policy row: `('observer_audio', 30, true, 'Delete encrypted observer
  audio chunks 30 days post-capture — recording-class data, shortened
  30-day sub-policy (S-085)')`. The value comes from the policy row, not a
  literal, so Lex/Sumanth can shorten it without a code change.
- **Measurements stay at 30 days, aligned to L-RET-02(a)** — derived
  speech-pattern features are retained no longer than the observer-report
  retention they would support (30 days) — and §5.2's purge enforces it on
  the same clock as the audio.
- The existing cron path needs **no new sweep for chunks**:
  `server.js` → `EuComplianceService.purgeRecordingObjects()` already
  selects expired registry rows generically by `expires_at`, deletes the
  storage object first, and stamps `deleted_at` only on a confirmed delete
  (soft-failures stay for retry). Only `registration_state = 'confirmed'`
  rows are purge-eligible; `pending` rows belong to the §4.4 reconciler.
  Observer chunks flow through the purge the day migration 257 (revised)
  lands.
- Two small additions in that sweep's per-row handling, when
  `object_type = 'observer_audio'` and the storage delete is confirmed:
  delete the matching `observer_audio_chunks` row (provenance dies with
  the object). Measurement rows get their own purge alongside the existing
  observer-report purge — `purgeExpiredSpeechMeasurements({ dryRun,
  retentionDays: 30 })`, called from the same cron block with the same
  `RETENTION_PURGE_LIVE` gate and dry-run default.
- Dry-run behaviour is inherited unchanged: everything above reports counts
  and deletes nothing until `RETENTION_PURGE_LIVE=true` in production —
  and the staging guard (shared production DB; purge-live requires
  `NODE_ENV=production`, per `server.js`) applies exactly as today.
- Both purge paths route through the legal-hold seam in §5.5 before
  deleting anything.

### 5.2 Erasure (S-076/S-078 service, new family wiring) — write discipline (P-7a, P-19)

**The shared lock discipline (applies to chunk persist, measurement
persist, capture-outcome write, erasure, and withdrawal deletion).**
Chunk-persist transactions, measurement-persist (§7.5), the
capture-outcome write (§8.5), `erasePersonalData`, and withdrawal deletion
(§5.4) all take `pg_advisory_xact_lock(<hash of candidateId>)`. Inside the
transaction, the writer re-checks: the `observer_jobs` row for the session
still exists (G-JOB), presence consent still granted (G-PRESENCE),
activation consent still valid where activation scope applies
(G-ACTIVATION), flag still ON (G-FLAG, persist-time read), and origin-env
still matching (G-ENV). **Any check fails ⇒ abort the transaction and
discard** — for a chunk, discard means the §4.4 compensating path (the
intent row already exists, so the object is deleted or ledger-chased,
never kept); for a measurement or outcome write, discard means the
in-memory result is dropped and nothing is written. This is the discipline
v1 specified for chunks only; v2 extends it to **every** capture-family
write, closing the measurement-resurrection race the review identified: a
measurement write can no longer land after `erasePersonalData` has deleted
the candidate's rows, because erasure holds the same lock and the writer
re-validates job existence inside it. (The S-049b report-flush race is
**not** closed by this unit and must never be recorded as closed here —
the flush joins this lock when S-049b is designed, exactly as v1 stated.)

**Erasure wiring.** Inside `erasePersonalData(userId, { client, audit })`,
in-transaction, next to the existing S-047 observer block, the new family
is wired **both** ways the codebase erases storage — registry-driven and
ledger-driven — because they protect against different failures:

1. **Enumerate**: `SELECT object_key FROM recording_objects WHERE
   candidate_id = $1 AND object_type = 'observer_audio' AND deleted_at IS
   NULL AND registration_state = 'confirmed'`, plus any
   `observer_audio_chunks` keys for the candidate's sessions
   (belt-and-braces for a chunk whose registry row was written but whose
   `candidate_id` was not — §9 makes candidate_id NOT NULL on chunks, so
   this second query should always return the same set; if it ever returns
   more, that is a defect the erasure test in §8 must catch). Test-scope
   rows (`is_test = true`) are excluded — they carry no real candidate's
   data (§3.4) and are governed by §5.5's test purge; synthetic candidate
   IDs never collide with real user IDs in this enumeration because test
   sessions reference synthetic candidates, not `users` rows.
2. **Ledger (in-tx)**: for each key, INSERT into
   `pending_storage_deletions` `(user_id, file_url,
   storage_type='r2', status='pending', source_family='observer_audio')`
   with `file_url = '/api/files/' + encodeURIComponent(object_key)` — the
   URL form the existing Phase-2 `deleteErasedStorageFiles` already routes
   through `deleteFile()` (raw registry keys are *not* `/api/files/` URLs
   and would be skipped as `unrecognized_format`; this encoding is the
   seam that makes the existing Phase 2 work unmodified). Crash between
   commit and Phase 2 ⇒ the existing sweep reconciles, exactly as for CV
   files.
3. **Rows (in-tx)**: DELETE `observer_audio_chunks` and
   `observer_speech_measurements` for the candidate; stamp
   `recording_objects.deleted_at` for their chunk rows (the registry row
   itself is the purge audit trail and is retained, as with frames). The
   capture-outcome record (§8.5) is **not** deleted by erasure of the
   media — it is an accountability record (counts only, no media, no
   measurements) retained on the §8.5 schedule; if a DSAR requires its
   removal, it is deletable by candidate through the same service, and
   §5.3 lists it so the choice is visible rather than accidental.
4. **Backstop**: the existing `destroyDEK` at the top of
   `erasePersonalData` already renders every chunk ciphertext — and now
   every measurement payload (§7.5) — unrecoverable from the live DB even
   if a physical delete is still pending. Order in code: DEK destruction
   already precedes the family blocks; the new block inherits it.
5. **Return surface**: `erasePersonalData` gains
   `observerAudioChunksDeleted: boolean` and the chunk keys join
   `storageKeys`, following the existing per-family boolean pattern.

**Ledger family attribution (P-19, Q4 answered: reuse acceptable, with a
marker).** Verified at design time: `pending_storage_deletions`
(migration 252) has **no** source/type discriminator — only `user_id`,
`file_url`, `storage_type` (`r2|local`), and `status`. Reusing the ledger
unmodified would make biometric-adjacent deletions indistinguishable from
CV-file deletions in counts, dashboards, and any "what is pending deletion
and why" audit — the exact confusion the reviewer flagged. Migration 257
(revised) therefore adds `source_family TEXT NOT NULL DEFAULT 'file'` to
the ledger (§9). Phase 2 routing is unchanged (it routes by `file_url`);
purge/erasure reporting counts observer-audio ledger rows **as their own
family**; and independently of the column, every observer-audio ledger row
remains joinable to `recording_objects` by key. The reuse stands; the
ambiguity does not.

**Race conditions, handled explicitly:**

- **Erasure vs. in-flight persist** — closed for every capture-family
  write by the shared lock + in-transaction re-checks above.
- **Erasure of a session being captured right now.** The worker's 1 s
  watchdog (§6.1) finds the consent/job checks failing and tears down;
  the persist gate covers the sub-second window between watchdog ticks
  (no persist can commit once erasure holds the lock). Unpersisted
  in-memory audio is zeroed, never flushed "one last time."

**No orphan paths — the checklist this design holds itself to:** a chunk
can come into existence only via §4.4 (intent row first, always); it
leaves existence via exactly four doors — retention purge (§5.1), erasure
(this section), withdrawal deletion (§5.4), compensating delete (§4.4) —
and every door either deletes the storage object or writes a ledger row
that keeps trying. There is no read path, no export, no presigned URL, and
no admin route for observer audio in this unit.

### 5.3 Erasure-reachability table (P-4)

Every copy the capture path touches, the mechanism that kills it, and the
**maximum lag**. "Lag" is measured from the erasure/withdrawal/purge
decision. This table is a design deliverable (Lex L-RET-03); if build
discovers a copy not listed here, that is a design defect, not an
implementation detail.

| # | Copy | Kill mechanism | Maximum lag | Notes / acceptance |
|---|---|---|---|---|
| 1 | Live storage object (R2 primary *or* B2 — exactly one provider per chunk; the provider is encoded in the key's `r2/`/`b2/` prefix and the delete routes to it) | Retention purge / erasure Phase 2 / withdrawal deletion via `deleteStorageObject` + ledger retry until confirmed | **0 days** on confirmed delete; if a delete soft-fails, the ledger retries indefinitely and the object remains *registered and findable* throughout — and DEK destruction (row 6) makes it unreadable from the moment erasure commits | No dual-write exists in this design; if a future change writes a chunk to both providers, this table must be amended before that change ships |
| 2 | Object **versions** (prior versions of a chunk object, if bucket versioning were on) | **Versioning must be OFF for the `observer-audio/` and `observer-audio-test/` prefixes.** Design requirement: bucket configuration is verified at build (evidence in the Dormancy Evidence Pack, §8.6) and re-verified as an **activation precondition** (§3.3). If versioning is ever found ON, a lifecycle rule expiring non-current versions within **1 day** must be applied and activation is blocked until versioning state is evidenced | **0 days** with versioning off (a delete is a delete); **1 day** under the lifecycle-rule fallback | v1 never addressed versions; `lib/file-storage.js` itself warns that with versioning on, `DeleteObject` only places a delete marker and prior versions remain recoverable. The design closes this by configuration requirement, not by hoping the bucket default is right |
| 3 | Provider-internal replicas (R2/B2 distributed replication of a deleted object) | Provider delete propagation — not independently controllable by Rekrut | Bounded by the provider's own deletion propagation; not separately enumerated by the provider | **Acceptance for Lex/Sumanth:** Rekrut's control is the confirmed delete in row 1 + DEK destruction (row 6). Residual provider-internal propagation is a provider property, identical for recordings today; it is stated here so it is accepted knowingly |
| 4 | Neon Postgres PITR backups — registry rows, chunk provenance, **encrypted** measurement payloads, capture-outcome records, intent rows | Expiry of the backup itself. There is no mechanism that reaches inside a PITR backup and deletes rows | **Expires with the backup window: maximum lag = the project's configured Neon PITR retention window.** Build must record the actual configured window in the package evidence; if it exceeds 30 days, Lex must explicitly accept the longer lag before build closes | **Acceptance for Lex/Sumanth, stated plainly:** an erasure is effective in the live database immediately. Backup copies are inaccessible in normal operation and expire with the PITR window. Two mitigations, honestly bounded: (i) measurement payloads and audio are ciphertext whose DEK is destroyed in the *live* DB — but a PITR *restore* restores the wrapped DEK row too, so crypto-shredding does **not** cover a restore; (ii) therefore a PITR restore is a named runbook event: after any restore, erasure must be **re-run** for every candidate erased since the restore point (the erasure audit log is the source list). Neither mitigation shortens the window; they bound what a restore can resurrect |
| 5 | ASR temp files (whisper input + `.json/.txt/.srt/.vtt` sidecars) in the named capture workdir (§7.4) | Zero-fill + unlink on **every** exit path of the ASR invocation (success, error, timeout); crash/SIGKILL orphans removed by the worker-start crash-recovery sweep (zero + delete anything in the workdir predating process start) | **0 days** in normal operation; worst case (process killed and not restarted) = until next worker start. The workdir is on the capture host only and holds no other tenant's data | Counted here per L-RET-03's temp-artefact enumeration. The §8.3 T12 test asserts the workdir is empty after success, failure, and kill cases |
| 6 | Per-candidate DEK (`candidate_data_keys`) | `destroyDEK` inside `erasePersonalData` (existing) — zeroes the live DEK, rendering all live ciphertext (audio + measurements) unrecoverable | **0 days** (in-transaction with erasure) | Backstop, not the mechanism (§4.2). Backup limitation is row 4's, stated there |
| 7 | In-memory PCM buffers, accumulators, transcript string | Zeroed/dropped on teardown, chunk boundary, and computation return (§3.7, §7.4); die with the process on crash | **0 days** — seconds in operation | Never written to any store, so there is nothing to reach after the fact |
| 8 | Application logs | Nothing to kill: the §6.4 log schema contains **no** media, transcript, feature values, or candidate ID — by schema, not by intention | n/a | A log line that could contain media would be a row in this table; the schema (§6.4) exists to keep this row "n/a" |
| 9 | Capture-outcome record (§8.5) — counts only | Retained deliberately as an accountability record on the consent/audit schedule (§8.5), **not** the media schedule; deletable by candidate via the erasure service if a DSAR requires it | Media schedule does not apply; DSAR deletion lag **0 days** when invoked | Listed so its retention is a visible, accepted choice (Lex L-RET-05 pattern), not an unnoticed survivor of media erasure |
| 10 | Sub-processor copies | **None exist.** ASR is self-hosted only (§7.4); storage providers are rows 1–3; no cloud ASR, no analytics sink, no queue carries media (capture is in-process) | n/a | If a future design introduces any sub-processor copy, this table must gain a row with mechanism + lag before that design is approvable |

### 5.4 Withdrawal erasure — the rule, stated (P-7b)

Lex requires erasure on consent **withdrawal** specified separately from
DSAR erasure and retention expiry; Quinn FI-6 defers the answer to Lex;
v1 was silent. v2 states the rule for Lex to rule on — silence is not
acceptable, because Nova would otherwise have to invent the behaviour at
build time:

> **Withdrawal rule.** When a candidate withdraws biometric consent or
> activation consent (either, via the existing consent withdrawal path):
> (1) capture stops immediately — the 1 s watchdog (§6.1) detects the
> withdrawal, unsubscribes within ≤ 2 s, zeroes buffers, and discards all
> unpersisted audio; (2) **already-persisted chunks and measurements for
> that candidate are queued for the same ledger-driven deletion as
> erasure** — registry enumeration, `pending_storage_deletions` rows with
> `source_family = 'observer_audio'`, chunk/measurement row deletion,
> registry `deleted_at` stamping — executed by a withdrawal sweeper that
> scans for withdrawn receipts with surviving capture artefacts (60 s
> cadence, same sweeper family as §4.4 reconciliation), under the §5.2
> advisory lock; (3) the DEK is **not** destroyed by withdrawal alone
> (withdrawal is not account erasure — the candidate may hold other data
> under the same DEK); physical deletion carries the guarantee here, with
> the registry/ledger trail as evidence. **Unless Lex/counsel later state
> a retention basis for keeping already-captured audio after withdrawal,
> deletion is the rule.** If Lex states such a basis, this section is
> amended in writing before build — the build implements this section as
> written, not whichever way is easier at the time.

All three deletion triggers — retention expiry (§5.1), DSAR erasure
(§5.2), withdrawal (this section) — reach the same stores, per L-RET-03.

### 5.5 Purge-path conditions carried into build (P-10, P-15 custody cross-ref)

**Legal hold (P-10).** Lex L-RET-05: legal hold suspends all purges.
Design-time verification, stated plainly: **no legal-hold mechanism exists
in the codebase today** — no hold flag, table, or check was found in
`lib/`, `services/`, or `server.js` at v2 design time, and neither the
S-077 registry purge nor the observer-report purge consults one. That
absence is recorded here as **discovered gap G-1**, owned by Lead to raise
with Lex/Sumanth (it predates this design and affects existing data
classes too — it is not created by this unit, and this unit does not
pretend to close it platform-wide). What this design *does* require:

- Both new purge paths — the `observer_audio` branch of
  `purgeRecordingObjects` and `purgeExpiredSpeechMeasurements`, plus the
  test-artefact purge below and the §5.4 withdrawal sweeper — call a
  single hold-check seam, `isLegalHoldActive({ candidateId, sessionId })`,
  before deleting, and skip + log (counts only) any held item. Until a
  real hold mechanism exists, the seam has nothing to consult; it is built
  anyway so that the day a hold can be recorded, every capture purge
  already respects it, and so G-1 has a named integration point instead of
  four future edits.
- **Activation precondition (not a build blocker):** before first real
  capture, purge-live must be verified **ON** for the `observer_audio`
  class in production (`RETENTION_PURGE_LIVE` + `NODE_ENV` gate), with a
  purge log line for the class evidenced — a 30-day retention that is only
  a policy statement is not a control (L-RET-06). Recorded in §3.3's
  activation evidence set for Lead to verify.

**Test-artefact purge.** `purgeTestObserverAudio({ dryRun })` deletes
test-scope storage objects (prefix `observer-audio-test/`), chunk rows,
measurement rows, and outcome rows where `is_test = true`, oldest first,
enforcing the 7-day maximum lifetime in §3.4. It runs the hold seam (a
test artefact under hold is a contradiction the seam surfaces, not a case
to optimise for), logs counts only (§6.4 schema), and is dry-run by
default outside the validation teardown that invokes it. Owner: Lead
(schedule); mechanism owner: the worker/retention cron (§3.4).

## 6. Flag mechanics, configuration surface, failure modes

### 6.1 The flag — and the ≤ 2 s kill bound (P-6)

- **Name**: `OBSERVER_AUDIO_CAPTURE_ENABLED` (env var, following the
  `AI_OBSERVER_IN_PROCESS` / `RETENTION_PURGE_LIVE` house pattern).
- **Semantics**: capture is enabled **iff** the value is exactly the
  string `'true'`. Unset, empty, `'1'`, `'TRUE'`, anything else ⇒ OFF (the
  `RETENTION_PURGE_LIVE` strict-parse precedent). Parsed by the single
  reader in `lib/observerCaptureFlag.js`; **no other file reads this env
  var**, and the reader is called fresh at each checkpoint — the value is
  never cached at boot, so a flag flip needs no restart and no deploy
  (Quinn R-Q1/R-Q2: single read point, kill path independent of deploy,
  malformed/stale = OFF per FI-7).
- **Classification** (feature-flags-architect): an *operational kill
  switch*, not a release flag. It is long-lived by design, owned by
  Sumanth, and its "rollout plan" is the #634 re-entry contract, not a
  percentage ramp. Named operator only: enabling requires a deliberate,
  authenticated act by Sumanth (or Suga on Sumanth's instruction) in the
  Render console — never an employer/recruiter role, never a deploy
  side-effect, seed, or migration default (Lex L-DOR-02).
- **Checkpoints**: (1) capture decision after Gate 2; (2)
  `TrackSubscribed` handler entry; (3) every chunk persist; (4) measurement
  persist. Consent (both artefacts, per scope) is re-checked at the same
  points plus the existing 5 s presence tick. Capture requires every
  §3.2 condition — independent fail-closed conditions; no one of them
  implies another.
- **The watchdog (the P-6 fix).** v1 re-read the flag only at checkpoints,
  so a mid-session flip could leave audio *being received and buffered*
  for up to a full chunk interval (≤ 30 s) — failing Quinn FI-2 and Lex
  L-DOR-07. v2 adds a dedicated **capture watchdog**: while a session is
  CAPTURING, a 1 s interval re-reads the flag via the single reader and
  re-checks both consent conditions (live DB read, per `consentService`
  discipline). On any failure — flag OFF, consent withdrawn or no longer
  valid, job row gone — the watchdog performs the §6.3 teardown:
  unsubscribe, close the stream, zero buffers, discard unpersisted audio,
  write the capture-outcome record. **Hard bound: capture stops within
  ≤ 2 s of a flag flip or a withdrawal becoming visible in the DB**
  (1 s interval + teardown well inside the second second), meeting Quinn
  FI-2/FI-6. The interrupted window's measurements become `missing` with
  reason `CAPTURE_INCOMPLETE` (FI-2), never computed from a partial segment
  as if complete. If Quinn later amends FI-2, this bound is the design's
  number to amend against — the v1 defect was the *silent disagreement*
  between the documents, and v2 removes it by adopting ≤ 2 s outright.

### 6.2 Configuration surface — deliberately small

| Surface | Exists? | Why |
|---|---|---|
| Env var (Render) | Yes — the only switch | Changing it is a deliberate operator act by Sumanth; auditable in Render's env history **and** by the worker-observed transition line (§6.4) |
| Admin UI / API endpoint to toggle | **No** | An endpoint that can enable biometric capture is itself an attack and accident surface; the re-entry contract deserves a slower, human, out-of-band act |
| Per-session / per-company capture override | **No** — and v2 is explicit about why this does not contradict §3.3: the cohort allow-list and the enablement record are *activation preconditions*, not toggles. They can only ever *restrict* capture further (absence ⇒ no capture); no value of them can enable capture for a session the flag + consents do not already permit | v1 rejected overrides to avoid unreviewed states; v2 keeps that rejection for *enabling* overrides while adding the *restricting* gates P-2 requires. Restriction-only configuration cannot create a state nobody reviewed — it can only close states |
| Flag ON in the production service for synthetic sessions | **Prohibited** (§3.4) | Production is not a validation rung; the production worker rejects test scope outright |
| Boot-time log line | Yes | Worker logs capture mode at start and at every capture decision, per the §6.4 schema, so dormancy is observable in production logs, not just tests |

### 6.3 Failure modes — fail-closed analysis

**The invariant: media is never collected while consent, flag, cohort,
scope, or environment state is ambiguous.** "Ambiguous" includes "we could
not check."

| Failure | Behaviour | Why it is safe |
|---|---|---|
| Flag flips OFF mid-session | Watchdog (§6.1) detects within ≤ 2 s: stream closed, unsubscribed, buffers zeroed, no further persist; interrupted-window measurements `missing`/`CAPTURE_INCOMPLETE`. Already-persisted chunks stay — they were collected while ON + fully gated, and retention/erasure/withdrawal govern them | No new collection after the flip; nothing is retroactively mis-collected; the kill latency is now a bound, not a chunk interval |
| Flag flips ON mid-session | **Nothing happens to in-flight sessions.** The capture decision is made once per session, at Gate 2. A session already dormant stays dormant | Prevents a session that began presence-only from silently becoming a captured session; activation applies to future sessions only |
| Consent withdrawn mid-capture | Watchdog detects at its next 1 s tick (capture teardown ≤ 2 s; the existing 5 s presence tick still disconnects the Observer from the room in < 10 s, as today); teardown zeroes buffers; unpersisted audio is discarded, never persisted; **already-persisted chunks + measurements are queued for deletion per §5.4** | Matches shipped S-047 presence semantics, tightened for capture; the withdrawal rule is now stated (§5.4) instead of inherited by accident |
| **Received-not-retained window (stated plainly, P-6).** Between a withdrawal (or flip) becoming true and the watchdog's next tick, up to ~1 s of audio may still arrive into the volatile utterance buffer; the persist gate independently re-checks consent/flag inside its transaction, so none of that audio can be *persisted* after the state change is visible in the DB | That sub-second-to-≤ 2 s of audio exists only in volatile memory, is never written, never measured (the interrupted window goes `missing`), and is zeroed at teardown. It is *received-not-retained*, on the same principle as the shipped consent-tick window for presence, tightened from < 10 s to ≤ 2 s for capture. v2 states it so Lex/Sumanth accept it knowingly, rather than the design implying receipt stops instantaneously — it cannot, and pretending otherwise would be the defect | — |
| Consent/flag/cohort check throws (DB down, read fails) | Capture stops at the **first** failed check — watchdog or persist gate, whichever hits it (stricter than the room-level 3-failure rule, which also still applies and disconnects the room) | Persisting or continuing on unverified gate state is the one unforgivable failure; presence degrades more slowly than capture on purpose |
| Worker restart / crash mid-session | In-memory buffers die with the process — nothing unregistered exists on disk, ever (§4.4: bytes follow intent rows). The capture workdir crash sweep (§7.4) runs at start. Persisted chunks are already registered/confirmed or reconciled (§4.4 step 4). Stale-claim sweeper recovers the job (existing); a recovered job re-enters at Gate 1 and re-decides capture from scratch; the gap window → `missing`/`degraded` with `GAP_IN_CAPTURE` (FI-3) | Crash can lose audio; it can never leak or orphan it |
| Storage PUT fails | Chunk dropped, gap counter incremented (§8), measurement accumulators note a gap (§7.5). The §4.4 intent rows are retired by cleanup/reconciler. 3 consecutive chunk failures ⇒ capture stops for the session (outcome `stop_reason = 'capture_storage_failed'`), presence continues | No plaintext fallback, no local-disk fallback, no retry-forever buffering (which would grow memory and extend in-memory retention) |
| Intent INSERT fails (§4.4 step 1) | No PUT is attempted; chunk dropped as above | Bytes never precede their registry row — the P-3 property |
| Confirm transaction fails after PUT (§4.4 step 3) | Compensating delete, then ledger chase (§4.4) — with the registry row present throughout, so the object is findable at every instant | The object is never left untracked |
| DEK missing/destroyed (encrypt throws) | Same as storage failure — chunk dropped; if the DEK was *destroyed*, that means erasure ran, and the job-existence persist check aborts capture entirely | A destroyed DEK mid-session is an erasure signal, not an error to retry through |
| `BIOMETRIC_ENCRYPTION_KEY` unset/malformed | `getMasterKey()` already throws (existing fail-secure behaviour); first chunk drops, capture stops, presence unaffected | No chunk is ever written under a fallback key |
| Flag env var malformed (`'TRUE'`, `'1'`) | Parsed as OFF (§6.1) | The dangerous direction of a typo is "on"; strict parsing makes typos land on "off" |
| Role/identity flip mid-session | Capture aborts (§3.5): teardown, outcome `stop_reason = 'role_flip'`; chunks already persisted stay bound to the original candidate (they were persisted under the bound identity's checks) and remain erasable by that candidate | A mislabelled participant is never captured under a second identity "to be safe" — capture stops instead |
| Capture-scope confusion (test session in production, real session offered test scope) | Scope resolution returns `none` (§3.3/§3.4): production rejects test scope; test scope requires the harness-set marker a product path cannot set | Scope is a property of the session + environment, never of an operator's intention |

### 6.4 Structured log schema, flag-transition line, attestation (P-11)

Lex L-DOR-02/04/06 and Quinn R-Q3 require the same artefact: a schema, not
an intention. The §8.1 counters themselves are pure aggregate integers and
leak nothing — the review is explicit that they are the safest part of the
design; the leakage risk lives in unspecified log fields, so v2 specifies
them.

**Permitted fields (the whole list).** Every capture-path log line is a
structured record drawn only from: `ts` (timestamp), `event` (enumerated:
`capture_decision`, `capture_started`, `capture_stopped`, `chunk_persisted`,
`chunk_dropped`, `flag_transition`, `watchdog_teardown`, `reconcile`,
`purge`, `stats`), `flag_state` (`on|off`), `scope`
(`test|activation|none`), `env` (worker environment identity),
`session_id` (**only** on events tied to a session that the January audit
record already carries — i.e. decision/start/stop lines for a session with
an audit record; never on aggregate `stats` lines), `counters` (the §8.1
integer fields), `stop_reason` (enumerated, §8.5), `counts` (purge/reconcile
row counts). **Forbidden fields, always:** candidate ID or any user ID,
employer ID, transcript text or fragments, audio bytes or hashes of audio,
any measurement/feature value (no F0, no energy, no WPM — ever), consent
artefact contents, object keys on routine lines (keys appear only in the
purge/erasure audit trail that already carries them for other families).
A field not on the permitted list does not ship; adding one is a design
change, not a logging tweak.

**Worker-observed flag-transition audit line.** The env change itself
happens in the Render console; Rekrut's own evidence is the worker
observing it: whenever any flag read returns a different value from the
previous read (boot baseline counts), the worker emits one
`flag_transition` line with `old → new`, `ts`, and `env`. Together with
Render's env history (who/when/reason is the operator act recorded there,
per L-DOR-04), this gives an in-system, timestamped transition record
without pretending the worker knows who flipped it.

**Per-release dormancy attestation (carried build/release condition).**
Named deliverable, owned by **Lead**: at each release while this code is
deployed dormant, a recorded attestation — production flag = OFF (with the
evidence: boot/decision log lines + the transition history showing no
unexplained ON), capture stores contain zero dormant-period artefacts
(registry/storage counts), signed by a named person, retained as an
accountability record per L-RET-05 (§8.5 schedule). The *practice* is a
release deliverable; the *schema and the counters it cites* are this
design (§8.1), so the attestation is checkable rather than ceremonial.


## 7. Speech-pattern slice design

### 7.1 Principles (hard rules, from the ruling)

1. **Measurements, not judgments.** Every output is a physical quantity
   computed from the audio, with a unit. Nothing is scored against a norm,
   graded, or labelled with an emotion, a trait, or a verdict.
2. **No heuristic fallback, ever.** If a measurement cannot be computed
   from the actual audio, its status is `missing` (with a `reason`, §7.5)
   and its value is `null`. There is no length-based estimate, no flat
   default, no rescued number — the exact failure mode S-082 found in
   `interview-ai.js`'s fallbacks, banned here by name. (Sumanth's standing
   rule: no placeholder scores.) This is also Quinn R-Q11: the design
   names the places a default could hide — segmenter thresholds,
   ASR-confidence handling, gap handling — and each returns a status
   object (§7.5), never a default numeric.
3. **Voice stress is, at most, a meter with uncertainty.** This unit
   computes **no stress value at all** — it computes pitch variability
   (§7.2), an honest physical quantity. Constraints fixed now, while they
   cost nothing (reviewer's Q7 answer): (a) the name `pitch_variability`
   is **contractual** — any rename toward "stress" requires the C-05
   counsel determination and its own gate; (b) **no cross-session
   aggregation or candidate-level profiling** of this field (or any
   measurement) exists in this design's data model — per-session rows
   only, 30-day life (§7.5); (c) any future presentation of variability
   as a "stress meter" is a separate design that must show the uncertainty
   (§7.5) next to the meter, and deception claims are banned outright:
   nothing in this unit produces, stores, or names a deception signal.
4. **Body language is out of the programme** (§2.2) — no visual measurement
   appears anywhere in this design.
5. Measurements are computed from the candidate track only, in the worker,
   persisted as one versioned, DEK-encrypted record per session (§7.5).
   They are **not** written into `ai_observer_reports` (that is S-049b,
   parked) and have no reader.

### 7.2 The measurements

All DSP measurements are deterministic pure functions of PCM (16 kHz mono)
— same input, same output, no model, no network (Quinn R-Q8 determinism
statement: every stage in §7.2 except M8/M9 is deterministic and
bit-identical across runs; M8/M9 inherit ASR variance, pinned by engine +
model version in `provenance`, §7.5). "Voiced" = segmenter speech frames
(§3.5). Definitions below are stated in the single frozen vocabulary of
§7.3. `missing` conditions produce `status: 'missing'` + `reason` (§7.5),
never a zero-filled value.

| # | Measurement | How it is computed | Unit | `missing` / `degraded` when |
|---|---|---|---|---|
| M1 | `speaking_time_sec` | Sum of voiced segment durations | seconds | `missing` (`INSUFFICIENT_SPEECH`): total captured audio < 5 s. `missing` (`CAPTURE_INCOMPLETE`): capture gaps (§7.5) cover > 50% of session audio. Otherwise `degraded` with `GAP_IN_CAPTURE` when gaps cover > 0% |
| M2 | `utterance_count` | Count of segmenter utterances (speech runs closed by the segmenter utterance-gap, §7.3) | count | As M1 |
| M3 | `avg_utterance_sec` / `median_utterance_sec` | Duration statistics over M2 utterances | seconds | `missing` (`INSUFFICIENT_SPEECH`): fewer than 3 utterances |
| M4 | `pause_stats` | Distribution over **pauses** (§7.3, ≥ 250 ms) within turns: `avg_pause_ms`, `pause_count`, `long_pause_count` (**long-pauses**, ≥ 2 s) | ms / counts | `missing` (`INSUFFICIENT_SPEECH`): fewer than 3 utterances |
| M5 | `pitch_median_hz` / `pitch_iqr_hz` | Per-frame F0 by autocorrelation over voiced frames (lag range for 50–400 Hz); median and interquartile range of confident frames only | Hz | `missing` (`INSUFFICIENT_SPEECH`): confident voiced frames < 30% of voiced frames, or < 2 s of confident voicing (unvoiced/shouted/noisy audio fails honestly instead of yielding a number). `degraded` with `LOW_SNR`-class quality flag when the confident ratio is within 10 points of the floor |
| M6 | `pitch_variability` | Coefficient of variation of the confident F0 series (IQR/median reported alongside) | ratio | As M5. **This is the only stress-adjacent quantity, and it is stored under this physical name — never as "stress"** (§7.1 rule 3) |
| M7 | `energy_mean_dbfs` / `energy_variance` | RMS per frame → dBFS; mean and variance over voiced frames | dBFS | As M1. Reported as *relative* level only — microphone gain is unknown, so cross-session loudness comparison is meaningless; the method note in the record's provenance (§7.5) carries this, and aggregation across sessions is prohibited (§7.1 rule 3(b) applies to all measurements) |
| M8 | `speech_rate_wpm` | Word count from the ephemeral ASR transcript (§7.4) ÷ **total turn time** in minutes (§7.3 — Quinn §2.4 definition: words ÷ total turn time, reported as the slice's speaking rate) | words/min | `missing`: ASR unavailable (`ASR_UNAVAILABLE`), ASR mean confidence below threshold (`LOW_CONFIDENCE`), or transcribed words < 20 (`INSUFFICIENT_SPEECH`). **Never** estimated from energy or duration |
| M9 | `filler_word_rate` | Count of the frozen filler lexicon (§7.3) in the ASR transcript ÷ total words × 100 (Quinn §2.4 form) | count per 100 words | As M8 |
| M10 | `response_latency_ms` | — | — | **Always `missing`** in this unit, reason `NOT_VALIDATED` (no honest source). Honest latency needs the interviewer's turn-end timestamps; interviewer audio is not captured (§3.5), and estimating it from candidate-track silence would fabricate a conversational fact. Named here so nobody "completes" the table later by guessing |

Excluded by name: any emotion label, any deception/lying signal, any
"confidence" trait score, any aggregate speech score. The E-008 spec's
§4.3 example `vocal` fields that this unit does not produce stay absent —
under the S-082 §4 projection contract, absent metric fields are the honest
state, never zero-filled.

### 7.3 Frozen vocabulary and lexicon (P-13)

Three different gap concepts exist in this design and Quinn's protocol.
v1 used their numbers interchangeably; v2 names all three, maps them, and
uses them consistently everywhere (design, code constants, tests):

| Term | Value | What it is | Used by |
|---|---|---|---|
| **Segmenter utterance-gap** | ≥ **700 ms** of non-speech | The energy segmenter's rule for closing one utterance and opening the next (§3.5) | M2/M3 utterance counting; chunk-group boundaries follow utterances |
| **Pause** (Quinn §2.4) | a silence interval ≥ **250 ms** within a speaker's turn | The measurement-level definition of a pause. Shorter gaps are articulation gaps, not pauses, and are never counted | M4 `pause_stats` (count, durations, onsets) |
| **Long-pause** | ≥ **2 s** of silence | A pause long enough to bound a **turn** (Quinn §2.4 turn rule: a turn is bounded by another speaker's speech or a ≥ 2 s silence) and to close a chunk group | M4 `long_pause_count`; turn/monologue derivation; §3.6 chunk-close trigger |

Mapping notes: every long-pause is a pause; every pause ≥ 700 ms inside
speech also closes an utterance; a pause of 250–699 ms is counted in M4
without splitting an utterance. The v1 "≥ 1.5 s chunk-close pause" number
is **removed** — chunk groups now close on the long-pause (≥ 2 s), the 30 s
timer, or teardown (§3.6), so no fourth gap number exists anywhere.

**Turn time** (for M8): the sum of turn durations for the session, where a
turn is the candidate's continuous speech bounded per the long-pause rule
above (single-speaker track: turns are bounded by long-pauses and session
start/end). **Speaking rate** is words ÷ total turn time in minutes;
articulation rate (words ÷ phonation time) is **not** in this slice —
Quinn §2.4 validates it separately only if a design includes it, and this
one does not.

**Filler lexicon — frozen, in one named place.** The lexicon is Quinn
§2.4's v1 frozen list, verbatim, and lives in exactly one place — the
`FILLER_LEXICON_V1` constant in `lib/observerSpeech.js`, versioned into
`method_version` / `config_hash` (§7.5):

> `um, uh, er, erm, like, you know, actually, basically, literally, right`

Counting rules: matching is on whole tokens in the ASR transcript,
case-insensitive; `you know` counts as one filler occurrence (matched as a
bigram before single tokens). The lexicon's known naïveté — the same word
used semantically ("I *like* that") — is a scored corpus subset in Quinn's
protocol (§4.4 semantic-filler hard set), not something the counter
pretends to solve. Changing the lexicon is a `method_version` bump and a
new corpus version; results across versions are never averaged (Quinn
§4.5).

**Canonical audio form** (Quinn §2.4): 16 kHz, mono, 16-bit PCM for all
measurement. The LiveKit stream resampling to that form (§3.6) is part of
the system under test; its effect is inside the measured error.

### 7.4 ASR: self-hosted only, transcript ephemeral, temp files designed (P-8)

M8/M9 need words. The `lib/ai-provider.js` ASR cascade includes third-party
cloud providers (OpenAI/Groq/Deepgram/Cartesia). Sending candidate voice to
a third-party processor is a new data flow — new processor, new DPA
question, new retention surface — and it is **not** authorised by this
design. The speech slice therefore uses **only** the self-hosted layer
(whisper.cpp) when it is available, and M8/M9 are `missing` when it is not.
In the synthetic test environment, Quinn may inject a fixture transcript
(§7.6) — the measurement code consumes a transcript interface, not a
provider. Revisit cloud ASR only with Lex's review and a named processor
decision; that remains an open question (§11), not a default.

**Audit of the actual layer (required by P-8 — read, not assumed).**
`lib/self-hosted-audio.js` `transcribe()` as shipped today:

- writes the input audio buffer to `os.tmpdir()/wh-in-<id><ext>` with
  `fs.writeFileSync` — the **shared OS temp dir**, with a 6-byte random
  suffix as the only name protection;
- whisper.cpp writes its outputs alongside: `wh-out-<id>.json` (plus
  `.txt/.srt/.vtt` sidecars the cleanup anticipates);
- cleanup is `fs.unlinkSync` in a `finally` — it covers success and thrown
  errors, but performs **no zeroing**, and a process kill (SIGKILL, OOM,
  host failure) between write and `finally` **orphans the files
  indefinitely** — nothing ever sweeps `os.tmpdir()` for them;
- on success it executes
  `console.log(... "${transcript.substring(0, 80)}...")` — **the first 80
  characters of every transcript are written to the application log** by
  the shipped code.

Any one of these disqualifies calling `transcribe()` as-is from the
capture path; the log line alone violates L-DOR-06/RL-11. The capture path
therefore does not call it as-is. The design:

1. **One controlled change to the shared layer.** `transcribe()` gains
   optional parameters with defaults preserving current behaviour for
   existing (Track B / transcription) callers: `{ tmpDir, suppressTranscriptLog }`.
   The capture path always passes both: `tmpDir` = the named capture
   workdir (below), `suppressTranscriptLog = true` (the success log then
   records byte counts only — for **all** callers in that mode, the log
   statement itself is parameterised, not branched around at the call
   site). No other behavioural change to the shared layer ships in this
   unit.
2. **Named capture workdir.** `CAPTURE_WORKDIR` =
   `<os.tmpdir()>/rekrut-observer-capture/` (created mode `0700`, owned by
   the worker process; path is a named constant in `lib/observerSpeech.js`).
   All whisper input/output files for capture ASR live there and nowhere
   else. Quinn's D-3 filesystem diff already watches a capture workdir —
   this is that directory.
3. **Zero-and-delete on every exit path.** For capture invocations, the
   cleanup overwrites each file (input + every sidecar) with zeros to its
   full length, then unlinks — in the `finally`, covering success, ASR
   error, empty-transcript error, and timeout/kill of the whisper child.
   A whisper *child* killed by timeout leaves its output files for the
   parent's `finally`, which still runs; a *parent* killed outright is
   covered by (4).
4. **Crash-recovery sweep at worker start.** Before the worker claims any
   job, it sweeps `CAPTURE_WORKDIR`: every file predating process start is
   zeroed and deleted, and the sweep count (integers only) is logged per
   §6.4. The workdir is single-purpose and single-process (§3.7 cap), so
   "predating process start" unambiguously means "orphan."
5. **Transcript lifecycle (PCM-grade rigour).** The transcript is produced
   in memory by the ASR call, passed as a local value into the word/filler
   counters inside the same `computeSpeechMeasurements` invocation, and
   destroyed when that call returns (reference dropped; the string is
   never copied into accumulators, module state, or any returned object —
   the returned record is §7.5's numbers-only shape). The transcript is:
   **never logged** (see (1)); **never in an error object** (ASR errors
   surface as reason codes — `ASR_UNAVAILABLE`, `LOW_CONFIDENCE`,
   `EMPTY_TRANSCRIPT` — with byte/duration counts only); **never in the
   measurements payload** (§7.5's schema has no text field, and the
   DEK-encryption in §7.5 does not change that — encryption is not a
   licence to store text); **never in a fixture** outside synthetic scope
   (§7.6 fixtures are generated text for generated audio).
6. **The test that proves it (T12, §8.3).** ASR failure injected
   mid-transcript (whisper stubbed to emit partial output then fail) ⇒
   assertions scan logs, DB rows, the workdir, and the whole filesystem
   diff for transcript text: none may exist anywhere. This is Quinn's
   AF-style discipline applied to the transcript, and AF-4 (empty-transcript
   canary) composes with it: an empty transcript yields `missing`, and a
   failed transcript yields `missing` + no residue.

### 7.5 Result schema — one contract (P-13), encrypted at rest (P-12)

**One schema.** Every measurement is stored and returned in exactly
Quinn's §2.3 contract, extended with two fields carried *inside* it from
v1 (`n`, `uncertainty.kind`) — the extension is additive and named here so
Quinn validates the extended shape, not a divergent one:

```json
{
  "status": "measured | degraded | missing",
  "value": 142.0,
  "unit": "wpm",
  "uncertainty": 6.0,
  "uncertainty_kind": "asr_mean_confidence",
  "n": 47,
  "quality_flags": [],
  "reason": null,
  "provenance": {
    "engine_version": "observer-speech-v1",
    "config_hash": "<sha256 of frozen constants: segmenter + F0 params + lexicon version>",
    "corpus_or_session_ref": "<session ref, or corpus item ref in validation>",
    "computed_at": "<ISO timestamp>"
  }
}
```

Rules (schema violations are test failures, per Quinn §2.3/AF-6):
`status: 'missing'` ⇒ `value` is `null`, `reason` is **mandatory** (one of
`NO_SPEECH | CORRUPT_AUDIO | INSUFFICIENT_SPEECH | STORAGE_ERROR |
CONSENT_NOT_ACTIVE | CAPTURE_INCOMPLETE | ASR_UNAVAILABLE |
LOW_CONFIDENCE | EMPTY_TRANSCRIPT | NOT_VALIDATED`), and `uncertainty`
is `null`. `status: 'measured'` ⇒ numeric `value`, numeric `uncertainty`
(± half-width, same unit — run-to-run variance measured by Quinn §5.3
feeds this, never invented at display time), `reason: null`.
`status: 'degraded'` ⇒ numeric `value` with widened `uncertainty` and a
non-empty `quality_flags` (e.g. `LOW_SNR`, `GAP_IN_CAPTURE`,
`CODEC_DEGRADED`) — `degraded` is how a weak measurement avoids
masquerading as a clean one; v1 had no such state, which was itself an
honesty gap. `n` is always the real sample count behind the number
(utterances, voiced frames, words). `uncertainty_kind` is
measurement-specific: `f0_confident_frame_ratio` (M5/M6),
`asr_mean_confidence` (M8/M9), `capture_gap_ratio` (session-level, below),
`segment_count` (M1–M4/M7). No bare number may leave the pipeline — the
schema is a validated boundary in `lib/observerSpeech.js`, not a
convention (Quinn R-Q7).

The record header carries `capture_gap_ratio` (the fraction of session
audio lost to dropped chunks, §6.3 — a session with gaps reports them, it
does not silently average over a hole), `audio_seconds_captured`, and
`method_version` (integer; any change to segmenter thresholds, F0
parameters, or the filler lexicon bumps it and changes `config_hash`).
Records are never recomputed in place.

**Encrypted at rest (P-12 — decision: ENCRYPT, adopting the reviewer's
Q6 answer).** The deciding argument is erasure symmetry, in the design's
own terms: destruction must provably reach derived copies. Plaintext JSONB
measurements would survive DEK destruction in the live DB and in Neon
backups; encrypted measurements die with the key everywhere the key is
gone, which is the only backup story this platform currently has (§5.3
row 4). The cost is one envelope wrap on a per-session JSON blob, and there
is no reader to inconvenience. Therefore:

- `observer_speech_measurements.measurements` (JSONB in v1) is replaced by
  `measurements_envelope BYTEA` — the §7.5 record (header + per-measurement
  objects) serialised and packed with the existing
  `packEnvelope`/`encryptWithDEK` discipline, AAD
  `observermeasurements:v1:candidate:<candidateId>:session:<sessionId>`
  (disjoint from the chunk namespace, §4.2).
- **Outside the envelope, the row carries only:** `interview_session_id`,
  `candidate_id`, `is_test`, `method_version`, a coarse row `state`
  (`recorded` — no per-measurement statuses, values, or reasons outside),
  and timestamps. Erasure deletes the row (§5.2); DEK destruction
  independently renders any surviving copy (e.g. in a PITR backup)
  unreadable, subject to §5.3 row 4's restore caveat, stated there.
- Measurement persist runs under the §5.2 lock discipline (advisory lock,
  in-transaction G-JOB/G-PRESENCE/G-ACTIVATION/G-FLAG/G-ENV re-checks,
  abort-and-discard on any failure).

### 7.6 Synthetic-media validation hooks (what Quinn's protocol can call)

- `computeSpeechMeasurements(pcmBuffer, sampleRate, opts?)` in
  `lib/observerSpeech.js` — **pure**: no DB, no storage, no env. Quinn
  feeds generated PCM (sine tones at known F0, silence-gap patterns with
  known pause structure, TTS-generated speech WAVs) and asserts outputs
  within stated tolerances (e.g. F0 of a 120 Hz tone ⇒ `pitch_median_hz`
  120 ± 3; a file of pure silence ⇒ every measurement `missing` with
  `NO_SPEECH`, not zero).
- Transcript injection: `opts.transcript = { words: [...], confidence }`
  bypasses ASR so M8/M9 are testable deterministically without whisper.cpp
  — and the injected value flows through the same in-memory-only handling
  as a real transcript (§7.4 rule 5).
- Segmenter exported separately (`segmentUtterances(pcm, opts)`) so pause/
  utterance expectations can be asserted exactly on synthetic gap patterns,
  in the §7.3 vocabulary.
- A fixture WAV/PCM corpus lives with the tests (generated, not recorded —
  **no real human voice is used in validation at any point**). Corpus
  custody is §8.6.

## 8. Dormancy proof design

Dormancy is a claim that must be *provable by test*, not by code reading.
The design provides five independent seams; Quinn's protocol (§7.6, §8
therein) combines them.

### 8.1 The counters (primary seam)

The worker's capture module maintains a stats object, exported for tests
(following the worker's existing pattern of exporting internals). Counter
names are frozen here so Quinn's tests bind to them (R-Q3):

```js
captureStats = {
  streamsOpened: 0,        // AudioStream constructions
  framesReceived: 0,       // AudioFrame iterations
  bytesBuffered: 0,        // peak/current PCM held
  chunksPersisted: 0,      // successful §4.4 confirmed persists
  chunksDropped: 0,        // failed/gated persists (incl. intent failures)
  registryRowsWritten: 0,  // intent + confirm writes for observer_audio
  asrInvocations: 0,       // self-hosted ASR calls from the capture path
  measurementWrites: 0,    // observer_speech_measurements inserts
  outcomeRowsWritten: 0,   // observer_capture_outcomes inserts
}
```

**Dormancy assertion**: with the flag OFF, after a full synthetic session
(join → tracks published → session completed → flush), **every counter is
exactly 0**. Not "small" — 0. Any non-zero value is a dormancy breach and
fails the build. These counters map onto Quinn's D-1…D-9 (subscribe calls
are asserted via §8.2's subscription seam; storage calls via the storage
spy; DEK creation via the §9 registry, which now includes
`candidate_data_keys` per P-22 — a dormant run that mints key material is
a write D-5 must catch).

### 8.2 Structural seams

- **Lazy require**: the capture module (`lib/observerCapture.js`) and the
  audio store are required *inside* the capture-enabled branch only. While
  dormant, the code that can open a stream is not loaded into the session's
  execution path. (Defence-in-depth; the counters in §8.1 are the proof,
  this is the reason the proof is expected to hold.)
- **Storage spy**: tests stub `lib/file-storage.js` `uploadFile`/
  `uploadToB2` with a counting stub — dormant ⇒ 0 calls, from any code path.
- **DB assertion**: dormant synthetic session ⇒ 0 rows in
  `recording_objects` with `object_type='observer_audio'`, 0 rows in
  `observer_audio_chunks`, 0 rows in `observer_speech_measurements`, 0 rows
  in `observer_capture_outcomes`, and **0 new rows in
  `candidate_data_keys`** for the session's candidate (P-22).
- **Subscription assertion**: the fake-room test double records every
  `setSubscribed(true)` call — dormant ⇒ 0 calls for media tracks.
- **Workdir assertion**: the capture workdir (§7.4) contains 0 files after
  a dormant session (ASR never ran).

### 8.3 The test matrix Quinn's protocol implements

| # | Scenario | Expected proof |
|---|---|---|
| T1 | Flag OFF, synthetic session, candidate publishes audio | All §8.1 counters 0; §8.2 DB/storage/subscription/workdir assertions hold; presence + S-049a skeleton flush behave exactly as today |
| T2 | Flag unset / malformed (`'TRUE'`) | Identical to T1 (strict-parse proof) |
| T3 | Flag ON, **test scope**, synthetic candidate audio (known F0/gaps) | Chunks persisted under `observer-audio-test/` + registered `confirmed` with 30 d expiry and `is_test = true`; measurements match §7.6 tolerances and the §7.5 schema; interviewer-track audio produces **no** chunks; decrypt of a test chunk succeeds via the §4.5 test module only |
| T4 | Flag ON, presence consent unknown/declined | Identical to T1 — consent closed ⇒ capture closed, flag irrelevant |
| T4b | **Flag ON, January-state-only (banked) presence consent, no `observer_capture` receipt, activation scope attempted (P-1)** | Identical to T1 — capture never starts; all counters exactly 0. Variants: receipt with stale artefact version ⇒ 0; receipt timestamped **before** the employer's enablement ⇒ 0 (distinct gate codes asserted in logs) |
| T4c | Flag ON, activation scope, employer **not** on cohort allow-list / no membership snapshot (P-2) | Identical to T1. Variant: test-scope attempt against a **non-test-marked** (real-shaped) session ⇒ scope `none`, counters 0 (R-Q12 proof). Variant: production-env worker + test-marked session ⇒ scope `none`, counters 0 |
| T5 | Flag flipped OFF mid-capture (test scope) | Teardown within **≤ 2 s** of the flip (timestamps asserted from the harness log): unsubscribe + buffers zeroed; persist count freezes; no chunk spans the flip; interrupted-window measurements `missing`/`CAPTURE_INCOMPLETE`; outcome record written with `stop_reason = 'flag_off'` |
| T6 | Consent withdrawn mid-capture | Capture teardown ≤ 2 s (room disconnect < 10 s as today); unpersisted audio never persisted; **persisted chunks + measurements enter the §5.4 withdrawal deletion queue and are deleted** (storage stub + DB assertions verify; this replaces v1's "persisted chunks remain" expectation) |
| T7 | Storage failure injected | Chunks dropped, gap ratio recorded, 3 failures ⇒ capture stops; **zero plaintext anywhere** (test asserts no local files outside the workdir discipline, no DB blobs); intent rows retired by reconciler — registry contains no stuck `pending` rows after the grace period |
| T8 | Erasure after T3 (against a real-shaped activation-scope fixture in the test DB) | All chunk objects deleted (storage stub verifies), ledger rows reach `deleted` **and are counted under `source_family = 'observer_audio'`**, chunk/measurement rows gone, DEK destruction makes any retained ciphertext undecryptable |
| T8b | **Erasure → capture attempt (P-18)** | After T8's erasure, a capture attempt for the same candidate: encrypt throws on the destroyed DEK, **zero DEKs recreated** (`candidate_data_keys` row count/content unchanged), zero chunks, capture aborts |
| T9 | Retention purge (dry-run then live, test DB) | Expired chunks deleted storage-first, `deleted_at` stamped, chunk rows removed; measurement purge removes expired measurement rows on the same 30-day clock; unexpired chunks untouched; hold seam consulted (held fixture row is skipped + logged) |
| T10 | Worker restart mid-capture | No unregistered objects; no partial chunk; `pending` intents reconciled; recovered job re-decides from Gate 1; gap window `missing`/`degraded` with `GAP_IN_CAPTURE` |
| T11 | **Kill-mid-PUT injection (P-3)** | Process killed at randomised points during §4.4 (before intent / after intent before PUT / mid-PUT / after PUT before confirm), repeatedly: after restart + reconciler run, **storage-vs-registry diff = 0 unregistered objects**, 0 stuck `pending` rows |
| T12 | **ASR failure mid-transcript (P-8)** | Whisper stubbed to produce partial output then fail: M8/M9 `missing` with reason codes; **no transcript text in logs, DB, or disk** (log scan, row scan, workdir + filesystem diff); workdir empty after the run |
| T13 | Role/identity flip mid-capture (P-20) | Participant identity change injected ⇒ capture aborts, outcome `stop_reason = 'role_flip'`, no chunk is ever bound to the second identity |
| T14 | Origin-env mismatch (P-5) | Job stamped `origin_env = 'production'` claimed by a staging-identity worker with flag ON + full test fixtures: presence proceeds, capture decision fails G-ENV, all capture counters 0 |

### 8.4 Production observability

The §6.4-schema decision lines plus a periodic `[ai-observer] capture
stats` line (aggregate counters only, no session ID) make dormancy
*continuously* observable in production, not only in tests: while the flag
is off in production, any non-zero counter in logs is an incident. (No
metrics service exists at $0; logs are the honest surface, and this design
does not pretend otherwise.) The per-release attestation that cites these
lines is §6.4's Lead-owned deliverable.

### 8.5 Capture-outcome record (Q10 — binding answer adopted)

v1's audit trail (`error_message` + in-process stats) evaporates on restart
and cannot answer, per session, "what was and was not collected." v2 adds
a persisted, non-media record:

- **Table**: `observer_capture_outcomes` (§9) — one row per session that
  **entered CAPTURING**, written at capture end (any teardown path) under
  the §5.2 lock discipline.
- **Contents — counts only**: session ID, candidate ID, scope, `is_test`,
  cohort allow-list version relied on (activation scope), chunks persisted,
  chunks dropped, `capture_gap_ratio`, `stop_reason` (enumerated:
  `session_end | flag_off | consent_withdrawn | consent_check_failed |
  storage_failed | dek_unavailable | role_flip | job_gone |
  concurrency_cap | worker_shutdown`), capture started/stopped timestamps.
  No media, no measurement values, no transcript, no feature data — the
  row proves *collection facts*, it is not itself collected content.
- **Retention**: an **accountability record**, not media — retained on the
  consent/audit schedule (Lex L-RET-05 pattern: the design cites the
  existing retention-lifecycle entry for consent/audit records; if Lead's
  package check finds no entry squarely covering it, that is the C-06 gap
  for counsel to set — flagged here, not papered over with an invented
  period). It is never purged on the 30-day media schedule (deleting the
  proof on the media schedule defeats its purpose), and it is deletable
  by candidate through the erasure service if a DSAR requires it (§5.3
  row 9).
- Dormant sessions write **no** outcome row (there is nothing to account
  for, and D-5 counts this table) — presence accountability for dormant
  sessions is the January audit record's job (§1.4), not this table's.

### 8.6 Evidence-pack and corpus custody (P-15, P-22)

Quinn's Dormancy Evidence Pack (§3.5 of her protocol) is safe in content
and was ungoverned in custody; v2 governs it at design level:

- **Synthetic identifiers only.** A pack may contain synthetic session
  references, synthetic candidate references, and test-prefix object keys
  only. A **real** session ID (or any real identifier) appearing in a pack
  is an **incident** (mis-pointed run), handled as one — not filed as
  evidence.
- **Retention + access.** Packs are accountability records under
  L-RET-05 (same schedule as §8.5), with access restricted to
  compliance/audit and the Gate A package reviewers — not general
  engineering distribution, and never attached to a candidate record.
- **Corpus vs run artefacts.** The synthetic **corpus** (Quinn §4) is a
  versioned, immutable test asset — manufactured voices, no real person —
  retained across versions so validation stays reproducible; it lives
  **outside candidate storage** (never under `observer-audio/` or any
  candidate table), with **Quinn as named owner**. **Validation run
  outputs** (per-run listings, diffs, intermediate renders) are *not* the
  corpus: they are deleted within **30 days** of the validation report
  being filed, owner **Quinn**, except the filed Evidence Pack itself,
  which follows the accountability schedule above. Nobody "cleans up" the
  corpus into unreproducible validation, and nobody retains run outputs
  by the corpus's logic.
- The D-5 table registry Quinn diffs is the §9 registry, which includes
  `candidate_data_keys` (P-22) and `observer_capture_outcomes` (§8.5).


## 9. Migration sketch (257, revised) + data model + capture table registry

Migration **257** (`257_observer_audio_capture.js`), following house
conventions (idempotent `IF NOT EXISTS`, constraint surgery by name per
migration 254's pattern — never assume a constraint name). Revised from v1:
adds `registration_state`, `is_test` markers, the outcome/cohort/enablement
tables, `origin_env`, and the ledger discriminator. Quinn's capture table
registry (R-Q6) is the list at the end of this section — any table the
slice writes that is absent from it is a design defect.

```sql
-- 1. Widen recording_objects.object_type CHECK to include 'observer_audio'
--    (look up the CHECK constraint by table via information_schema, drop,
--     re-add with ('frame','recording','observer_audio') — migration 254 pattern)

-- 2. Registration state for intent-first registration (§4.4).
--    Legacy families keep the default; only observer_audio uses 'pending'.
ALTER TABLE recording_objects
  ADD COLUMN IF NOT EXISTS registration_state TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (registration_state IN ('pending','confirmed'));

-- 3. Retention policy row (classification per §5.1)
INSERT INTO data_retention_policies (data_type, retention_days, auto_delete, description)
VALUES ('observer_audio', 30, true,
        'Delete encrypted observer audio chunks 30 days post-capture — recording-class data, shortened 30-day sub-policy (S-085)')
ON CONFLICT (data_type) DO NOTHING;

-- 4. Chunk provenance (now with test marker, §3.4)
CREATE TABLE IF NOT EXISTS observer_audio_chunks (
  id              SERIAL PRIMARY KEY,
  interview_session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  candidate_id    INTEGER NOT NULL,
  object_key      TEXT NOT NULL UNIQUE,        -- = recording_objects.object_key
  chunk_index     INTEGER NOT NULL,
  duration_ms     INTEGER NOT NULL,
  byte_size       INTEGER,                     -- NULL until §4.4 confirm
  sample_rate     INTEGER NOT NULL DEFAULT 16000,
  is_test         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (interview_session_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_observer_audio_chunks_candidate
  ON observer_audio_chunks (candidate_id);
CREATE INDEX IF NOT EXISTS idx_observer_audio_chunks_session
  ON observer_audio_chunks (interview_session_id);

-- 5. Speech measurements — payload DEK-encrypted (§7.5).
--    Outside the envelope: ids, is_test, method_version, coarse state only.
CREATE TABLE IF NOT EXISTS observer_speech_measurements (
  id              SERIAL PRIMARY KEY,
  interview_session_id INTEGER NOT NULL UNIQUE
                    REFERENCES interview_sessions(id) ON DELETE CASCADE,
  candidate_id    INTEGER NOT NULL,
  measurements_envelope BYTEA NOT NULL,        -- §7.5 record, packEnvelope form
  method_version  INTEGER NOT NULL DEFAULT 1,
  state           TEXT NOT NULL DEFAULT 'recorded',
  is_test         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_observer_speech_measurements_candidate
  ON observer_speech_measurements (candidate_id);

-- 6. Capture-outcome record (§8.5) — counts only, accountability schedule
CREATE TABLE IF NOT EXISTS observer_capture_outcomes (
  interview_session_id INTEGER PRIMARY KEY
                    REFERENCES interview_sessions(id) ON DELETE CASCADE,
  candidate_id    INTEGER NOT NULL,
  scope           TEXT NOT NULL CHECK (scope IN ('test','activation')),
  is_test         BOOLEAN NOT NULL DEFAULT false,
  cohort_allowlist_version INTEGER,            -- NULL in test scope
  chunks_persisted INTEGER NOT NULL DEFAULT 0,
  chunks_dropped   INTEGER NOT NULL DEFAULT 0,
  capture_gap_ratio NUMERIC,
  stop_reason     TEXT NOT NULL,
  capture_started_at TIMESTAMPTZ NOT NULL,
  capture_stopped_at TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_observer_capture_outcomes_candidate
  ON observer_capture_outcomes (candidate_id);

-- 7. Cohort allow-list + per-session membership snapshot (§3.3)
CREATE TABLE IF NOT EXISTS observer_cohort_allowlist (
  company_id      INTEGER PRIMARY KEY,
  allowlist_version INTEGER NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_cohort_membership (
  interview_session_id INTEGER PRIMARY KEY
                    REFERENCES interview_sessions(id) ON DELETE CASCADE,
  company_id      INTEGER NOT NULL,
  allowlist_version INTEGER NOT NULL,
  in_cohort       BOOLEAN NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Employer activation enablement (§3.3) — all evidence refs non-null,
--    so the row cannot exist without the L-ACT-04 checklist behind it.
--    No rows are inserted by this migration or by this build.
CREATE TABLE IF NOT EXISTS observer_activation_enablements (
  company_id      INTEGER PRIMARY KEY,
  enabled_at      TIMESTAMPTZ NOT NULL,
  enabled_by      TEXT NOT NULL,
  counsel_ref     TEXT NOT NULL,
  lex_activation_ref TEXT NOT NULL,
  quinn_validation_ref TEXT NOT NULL,
  policy777_ref   TEXT NOT NULL,
  bipa_schedule_ref TEXT NOT NULL,
  sumanth_activation_ref TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Origin environment on observer jobs (§3.4)
ALTER TABLE observer_jobs
  ADD COLUMN IF NOT EXISTS origin_env TEXT NOT NULL DEFAULT 'unknown';

-- 10. Ledger family discriminator (§5.2, P-19) — migration 252's table has
--     none today (verified); existing rows keep the 'file' default.
ALTER TABLE pending_storage_deletions
  ADD COLUMN IF NOT EXISTS source_family TEXT NOT NULL DEFAULT 'file';
CREATE INDEX IF NOT EXISTS idx_pending_storage_deletions_family
  ON pending_storage_deletions (source_family, status);
```

Data-model notes (database-reviewer discipline):

- `recording_objects` rows for chunks populate **both** `candidate_id` and
  `interview_id` (= the interview session id) — frames populate candidate
  only and recordings neither; chunks populate both because erasure (§5.2)
  and audit both need the linkage without a join through chunks.
- `object_key` is the join key to the registry (its PK); chunks reference it
  by UNIQUE column rather than a formal FK because registry rows are
  retained (stamped, not deleted) after purge — an FK with CASCADE would be
  wrong, and with NO ACTION would fight the purge's chunk-row cleanup order.
  The purge deletes chunk rows explicitly (§5.1).
- No audio bytes and no transcript text ever appear in any table.
  `measurements_envelope` holds ciphertext only; decrypted, it holds
  numbers + statuses + uncertainty (§7.5) — never text.
- `consent_receipts` / `consent_texts` are **existing** tables
  (`lib/consentService.js`); this unit adds the `observer_capture` type to
  the service's valid-type list (§3.2) and **no** `consent_texts` row —
  the activation artefact's text is counsel-reviewed content inserted at
  activation time, not build content.
- `down()`: drops the new tables/columns added here except the widened
  CHECK and the `registration_state` / `source_family` / `origin_env`
  columns, which are **left in place** (migration 254 precedent — reverting
  a widened CHECK or dropping a defaulted column while rows use the new
  values would fail, and the additions are harmless dormant).

**Capture table registry (Quinn R-Q6 / D-5 — exhaustive).** Tables this
slice writes, or whose writing it can cause: `recording_objects`
(`object_type='observer_audio'` rows), `observer_audio_chunks`,
`observer_speech_measurements`, `observer_capture_outcomes`,
`observer_cohort_membership` (snapshot writes at session start),
`pending_storage_deletions` (`source_family='observer_audio'` rows), and
**`candidate_data_keys`** (a first capture legitimately creates a DEK via
the encrypt path — which is exactly why a *dormant* run must create zero,
P-22). Tables read but never written by capture: `consent_receipts`,
`consent_texts`, `observer_cohort_allowlist`,
`observer_activation_enablements`, `observer_jobs` (lifecycle writes are
the existing worker's, unchanged), `interview_sessions` (existing config
propagation is `consentService`'s, unchanged). Any capture-family write
found in build outside this registry is a design defect (R-Q6).

## 10. Build breakdown — one unit, closes together (re-estimated)

Sumanth's doctrine for this build stands: **design it completely, build it
completely, not half-half.** These five stories are *one* unit: planned
together, branched together where practical, reviewed together, and
**closed together** — no story closes, and S-085 does not close, until all
five are merged and the §8 test matrix passes end-to-end. In particular the
unit must never ship in the state "capture works but erasure isn't wired" —
that intermediate state is precisely the S-049 scaffold-split failure this
ruling bans.

| Story (working labels — Lead assigns S-numbers) | Content | Points |
|---|---|---|
| **C-1 Dormant capture core + gate composition** | Flag reader (§6.1); capture decision + state machine (§3.1); **gate composition module (§3.2): scope resolution, activation-artefact check, cohort snapshot read, env check**; subscription gating (§2.3/§3.6); TrackSubscribed pump; segmenter + buffers + memory discipline (§3.5/§3.7); **1 s watchdog with ≤ 2 s teardown (§6.1)**; role binding + role-flip abort (§3.5); capture stats (§8.1); §6.4 log schema; teardown zeroing | 8 |
| **C-2 Encrypted persistence, registry-first** | `lib/r2ObserverAudioStore.js` (§4); migration 257 revised (§9); **intent-first registration + confirm + reconciler (§4.4)**; chunk provenance writes; test prefix + `is_test` plumbing (§3.4); **test-decrypt module isolation + runtime guard (§4.5)**; ledger `source_family` wiring on the compensating path | 7 |
| **C-3 Retention + erasure + withdrawal composition** | Purge-sweep chunk cleanup + measurement purge (§5.1); erasure wiring incl. ledger encoding + family counts + return surface (§5.2); **shared advisory-lock discipline across chunk/measurement/outcome persist (§5.2)**; **withdrawal sweeper + deletion queue (§5.4)**; hold-check seam in all purge paths (§5.5); test-artefact purge (§5.5) | 5 |
| **C-4 Speech-pattern slice** | §7 measurements M1–M9 under the **Quinn §2.3 schema with `degraded` + reasons + provenance (§7.5)** (+ M10 honestly `missing`); pure DSP (F0 autocorrelation, energy, pause/utterance stats) in the **frozen §7.3 vocabulary**; **transcript lifecycle + ASR hardening: `transcribe()` options, capture workdir, zero-and-delete, crash sweep (§7.4)**; **DEK-encrypted measurement persist (§7.5)**; capture-outcome writer (§8.5) | 15 |
| **C-5 Dormancy + synthetic validation suite** | §8 test matrix **T1–T14** (incl. T4b/T4c gate cases, T8b, T11 kill-mid-PUT + storage-vs-registry diff, T12 transcript-residue scan, T14 env mismatch) as automated tests; synthetic PCM/WAV fixture generation; storage/DB/subscription/workdir spies; §7.6 tolerance tests; evidence-pack custody mechanics (§8.6) | 5 |
| **Total** | | **40** |

**Delta explanation (+11 over v1's 29), in one paragraph.** The increase
is not scope growth — the measurement set, the surfaces (none), and the
one-unit structure are unchanged — it is the price of the review's fixes,
which v1 under-priced because v1 priced a gate made of three conditions
and a registration order made of hope: gate composition grew from
flag + presence-consent to a five-condition gate with a new consent type, a
cohort snapshot read, scope resolution, and a 1 s watchdog (C-1, 5 → 8);
registry-intent-first registration, the reconciler, test segregation, and
decrypt isolation are new machinery, not edits (C-2, 5 → 7); the lock
discipline now covers three write paths instead of one and withdrawal
deletion is a new sweeper, not a sentence (C-3, 3 → 5); the Quinn-schema
reconciliation, the transcript/ASR hardening, DEK-encrypted measurement
persist, and the outcome record all land in the slice (C-4, 13 → 15, still
at the top of — and now honestly just above the middle of — the range once
the safety work is counted inside it rather than assumed free); and the
test matrix grew from 10 cases to 17, including crash-injection and
residue-scan cases that are each real test engineering (C-5, 3 → 5).
Estimating this at 29 again would repeat v1's exact error — pricing the
happy path and calling the safety machinery free — so v2 prices what the
review proved the design actually contains.

Sizing notes, for the record:

- Specialist decision (mandatory STOP-1 question, answered here at design
  time and to be re-answered by Nova at implementation STOP 1): **Yes** —
  security/crypto (envelope + AAD design, §4/§7.5), privacy (§3.2/§4.4/§5 —
  plus the separately commissioned independent privacy-engineer re-review
  of this v2 package), database (migration 257 revised), voice/media (§7).
  Considered and skipped: UX (no surface exists), frontend/React (no UI),
  payments/commercial (none).
- Sequencing inside the unit: C-1 → C-2 → C-3 → C-4 → C-5 is the natural
  build order, but the *closure* is atomic (§10 preamble). If any story
  grows at STOP 1, the unit is re-estimated as a unit and returns to
  Sumanth — points are not absorbed silently.

## 11. Risks + open questions

**Risks**

1. **In-process memory/CPU on a $0 tier.** F0 autocorrelation per frame plus
   PCM buffering runs inside the web process; v2 adds a 1 s watchdog (one
   flag read + consent reads per capturing session — bounded, and only
   while capturing). Mitigations in-design: one capturing session at a
   time (§3.7), < 5 MB audio memory per session, 16 kHz mono. Residual
   risk: a capturing session degrading web latency during the future pilot
   — acceptable for a controlled cohort, must be measured in the synthetic
   load test before any activation decision.
2. **The dormancy change touches shipped S-047 behaviour** (§2.3). A bug in
   subscription gating could affect presence-only operation (the January
   ship). Mitigation: T1/T2 prove presence behaviour unchanged with the flag
   off; the change is inside this unit's review, not a drive-by.
3. **The shared ASR layer change (§7.4 rule 1) touches a non-capture
   caller surface.** `transcribe()`'s new options default to current
   behaviour, but the change must be regression-covered by the existing
   transcription suites (Quinn §8.1) — a capture-driven edit that breaks
   Track B transcription would be exactly the cross-module orphan failure
   this programme forbids.
4. **whisper.cpp availability.** M8/M9 depend on the self-hosted ASR layer
   being operable in the environment; if it is not, they are `missing` —
   by design, not by failure. Nobody may "fix" that by enabling a cloud
   provider without the §7.4 review.
5. **Energy segmenter quality on real speech.** Synthetic validation proves
   correctness on generated media; real-world VAD quality (accents, noise,
   crosstalk) is *unproven* and cannot be proven without real candidate
   audio — which this unit must not collect. Measurement accuracy claims at
   activation time must be limited accordingly; `method_version`,
   `config_hash`, and uncertainty fields exist precisely so early records
   are identifiable.
6. **Backup-proof deletion does not exist yet** (§4.2, §5.3 row 4). v2's
   improvement over v1 is not a fix but an honest map: physical deletion +
   ledger + purge + DEK destruction in the live DB, with the PITR window
   and the restore re-erasure rule stated as acceptances for Lex/Sumanth.
   The underlying gap (no master-key rotation) remains a previously
   documented platform gap (ADR-012 follow-up), not a new one created here.

**Discovered gap carried to Lead (not a risk — a finding)**

- **G-1: no legal-hold mechanism exists** in the codebase (§5.5). It
  predates this design, affects every existing purge, and needs a
  Lex/Sumanth decision on whether a hold capability is built platform-wide.
  This unit builds only the hold-check seam its own purges consult.

**Open questions (for Sumanth / Lex, not for Nova to decide)**

1. Retention for observer audio: the 30-day shortened sub-policy (§5.1) is
   now classified correctly; is 30 days the number Sumanth/Lex want, or
   shorter? (P-9 closed the *classification* question; the *number* was
   always Sumanth's/Lex's to shorten.)
2. The §5.3 row 4 acceptance: is "erasure effective live immediately; backup
   copies expire with the Neon PITR window (actual configured value to be
   recorded in package evidence); restore triggers re-erasure" acceptable
   as stated, or does Sumanth want the PITR window itself shortened (a
   platform/plan decision outside this unit)?
3. Withdrawal rule (§5.4): delete-on-withdrawal as stated, unless
   Lex/counsel state a retention basis. Lex to confirm or amend **before
   build** — the build implements §5.4 as written.
4. Is the advisory-lock scope (§5.2) acceptable as capture-family-only,
   with the report-flush extension remaining S-049b's debt — explicitly
   restated so the flush race is never recorded as closed early?
5. Cloud ASR: permanently out for observer audio, or revisitable with a
   named processor + DPA at activation time? (Design assumes out.)
6. Concurrency cap of one capturing session (§3.7): acceptable for the
   design-partner cohort size envisaged by Gate A?
7. Consent/audit-record retention period for the §8.5 outcome record: the
   design cites the existing lifecycle entry per L-RET-05; if Lead's check
   finds none squarely covering it, the period is counsel's (C-06) — the
   package should list it as open rather than let build invent one.

## 12. What v2 asks of the re-review

v1's §12 questions are **closed** — the review answered Q1–Q10, and v2
adopts those answers at §2.3 (Q1), §3.5 (Q2/P-17), §4.4 (Q3), §5.2 (Q4),
§4.2 + T8b (Q5), §7.5 (Q6), §7.1 (Q7), §3.4/§6.2 (Q8), §3.2 (Q9), and §8.5
(Q10). They are not re-asked. The re-review is asked to verify, against
§0.3's dispositions table:

1. That G-ACTIVATION (§3.2) is genuinely distinct from presence consent —
   artefact, version, and post-enablement timestamp — at **every**
   checkpoint, and that T4b covers the banked-consent case.
2. That the capture decision (§3.2/§3.3) cannot be satisfied by a flag flip
   for any real session, and that the L-ACT-04 map (§3.3) correctly
   separates technical preconditions from Lead-verified gate evidence.
3. That §4.4's order makes an unregistered object impossible (not chased),
   and T11's injection points cover the crash windows.
4. That §5.3's table is complete against the build's actual copy surface —
   in particular rows 2 (versioning) and 4 (PITR) — and that the
   acceptances are worded so Lex/Sumanth can accept or reject them as
   written.
5. That §5.4's withdrawal rule and §7.4's transcript lifecycle are stated
   at buildable precision — Nova should never have to invent behaviour in
   either place.

---

*— Rex, Solution Architect. Design revision only — no code written, no
GitHub changes made. v1 (`rex-capture-safety-design.md`) is retained
untouched for the record. Next gates: privacy-engineer re-review of this
v2 → Lead's package check (incl. the §1.4 ownership table and the RL-10
package-level confirmation) → Sumanth's approval of the assembled package
→ only then does Nova build, as one complete unit.*
