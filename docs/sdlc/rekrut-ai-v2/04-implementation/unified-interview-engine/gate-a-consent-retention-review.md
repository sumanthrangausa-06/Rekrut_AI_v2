# Gate A — Consent & Retention Design Review + Counsel Chase Draft (#788)

**Author:** Lex — Legal & Compliance persona (advises, never approves; never the legal answer)
**For:** Sumanth (Founder, approves at gates) via Suga (CTO) and Lead (backlog / package checker)
**Parallel work:** Rex — dormant-capture technical design (Sprint 11, S-085 chain)
**Date:** 2026-10-13
**Status:** Draft for Sumanth's approval of the design package. No GitHub changes made. Nothing sent to anyone.
**Ruling this implements:** Gate A = **B, AMENDED** — Sumanth, 2026-10-13, recorded on GitHub issue #634 of `sumanthrangausa-06/Rekrut_AI_v2`.
**Launch blockers referenced:** #777 (biometric policy page), #788 / S-086 (FCRA/CRA determination, P0)

> **Counsel boundary — read first.** This document sets design *requirements* and *red lines* so engineering does not build something counsel will later have to kill. It is a compliance aid, not legal advice and not a legal determination. Every point in §9 is reserved for qualified external counsel. No one may cite this document — in a customer contract, a policy page, a sales call, or a regulator response — as "legal clearance." Clearance, where required below, means counsel's written determination, not Lex's.

**Skills / sources applied directly (no sub-agents spawned at this depth):**
- `global-hiring-compliance` (`~/workspace/skills/global-hiring-compliance/`) — SKILL.md + `references/usa.md` §2 (BIPA), §4 (AI hiring tools), §14 (retention) + `references/platform-design.md` §§1, 4, 5 (evidence-by-default, separate consent artefacts, retention engine) + `references/eu.md` §§1–2 (GDPR Art. 9, Art. 13/14, Art. 37) [substantive law as of mid-2026; ⚠ verify items flagged in-line]
- `gensecai/privacy-engineer` — privacy-by-design, data minimisation, consent enforcement at the API layer, DSAR/erasure automation, retention enforcement
- `voltagent/gdpr-ccpa-compliance` — purpose limitation, storage limitation, consent must be specific / informed / unambiguous / withdrawable, accountability documentation
- `voltagent/compliance-auditor` — evidence collection, audit trails, control testing: a control that cannot be evidenced does not count as a control
- `claude-for-legal / product-legal / launch-review` — 8-category launch walk (privacy, regulatory, marketing claims, AI governance, third-party) + HR-tech overlay (BIPA, FCRA, Title VII / AI-hiring laws); marketing-claims discipline applied to #777 and all consent copy
- Prior verified record: E-008 AI Observer spec (default-deny gate, `lib/observerConsentGate.js`, `lib/observerReportStates.js`), Gate A brief (S-082 spike), S-084 counsel brief (`s084-counsel-brief.md`, 2026-10-12)

---

## Plain-words summary — for Sumanth

In January, the AI Observer will be *in the room but doing nothing except being present* — and only for a small, named group of design-partner employers, not the public. It will not analyse anyone. That sounds simple, but legally the January step still matters, for three reasons:

1. **We will create a record for every January session** saying: who was there, whether the Observer was present, what state consent was in, and — in writing — that **no analysis was provided**. That record is our proof later that we did not quietly do more than we promised. If we don't create it cleanly now, we cannot prove it later.

2. **January permission cannot be reused.** A candidate (or employer) agreeing in January to "the Observer was present, nothing was analysed" has **not** agreed to us recording their voice or analysing it later. When — if — analysis is ever switched on, we must ask again, fresh, with a new explanation that actually describes recording and analysis. Any design that lets January consent "carry over" is a red line. I will block it.

3. **We are allowed to build recording code that records nothing.** Sprint 11 funds a dormant, audio-only capture system: code exists, a switch controls it, the switch is off by default, and while it is off it must collect **zero** audio. Legally, "trust us, it's off" is not enough. The design must be able to *prove* it's off — tests, logs, and an audit trail a regulator or a plaintiff's lawyer could be shown. If the code can be switched on silently, or collects anything while "off", I will block it.

Two things outside the build control whether any of this ever goes live:

- **The policy page (#777).** Our public biometric policy page currently promises a calibration baseline that does not exist. Until that page only promises what is true, the Observer must not be enabled for anyone — not even the cohort. That is already Sumanth's ruling; this review specifies exactly what the page may and may not say.
- **Counsel (#788).** The threat-intel signal stays dark until counsel determines in writing whether Rekrut is a consumer reporting agency (CRA) when it furnishes that signal. The Gate A re-entry contract also needs counsel's timeline *in writing, with a date*. Appendix A is the chase note, ready to send once you fill in counsel's name and firm. **It has not been sent.**

**My bottom line for Lead's package check:** Rex's design passes my review only if every requirement in §§2–7 marked **MUST** is present in the design, every red line in §8 is absent, and the open counsel determinations in §9 are listed in the package as *open* — not assumed, not worked around. Design first, your approval, then build. No real candidate audio is captured before the re-entry conditions in §4 are all met.

---

## Deliverable 1 — Consent / retention design review (requirements side)

### How to use this document

- Each requirement has an ID (`L-COH-01`, etc.). Lead checks the assembled Rex + Lex package line by line against these IDs and records Pass / Fail / Not-in-design against each.
- **MUST** = design is incomplete without it. **MUST NOT** = presence blocks the package (§8). **SHOULD** = expected; any omission needs a written reason in the package.
- "Design" means the design document Rex produces *before* Sumanth's build approval. Several requirements are design-time commitments that Nova must later implement and Quinn must later test — they are stated here so the design cannot omit the hook they need.

### 1. Scope and fixed facts the design must not re-litigate

| ID | Requirement |
|---|---|
| L-SCO-01 | **MUST** state Gate A = B, AMENDED as its premise: January = presence-only, controlled design-partner cohort only, no analysis, no public biometric-consent ask. Any design element that assumes public launch, analysis in January, or consent-banking is out of scope and a red line (§8). |
| L-SCO-02 | **MUST** keep the three data planes separate and named as such throughout: (a) January presence / audit record — no media, no analysis; (b) dormant capture code — media capability, zero collection while dormant; (c) future activated capture/analysis — does not exist until §4 re-entry is satisfied. No field, table, flag, or copy may blur (a) into (b) or (b) into (c). |
| L-SCO-03 | **MUST** preserve the existing default-deny gate as the single consent authority: Observer joins only when `biometric_collection === true` (`lib/observerConsentGate.js`). `false`, `undefined`, `null`, missing config, and config-drift all block, with distinct block codes (existing pattern: declined vs. unknown). The dormant-capture design **MUST NOT** introduce a second, parallel, or bypass consent check. |
| L-SCO-04 | **MUST** record launch geography as **USA + India**. EU launch is postponed (Sumanth, 2026-10-13). GDPR Art. 9 / Art. 88 design coverage stays on file and dormant-capture design **MUST NOT** do anything that would foreclose it, but no EU-specific consent variant is a January requirement, and EU-facing counsel scope is deprioritised (see Appendix A). |
| L-SCO-05 | **MUST NOT** change any retention period approved earlier except as §6 expressly provides for captured audio as a new data class. Approved baseline: recordings 90 days, frames 30 days, inactive embeddings 24 months. |

### 2. Cohort-only mechanics — what "cohort" means in consent terms

The cohort is not a marketing segment. In consent terms it is a **closed, enumerable set of sessions where a different, narrower promise was made**, and the system must be able to prove membership — or non-membership — for any session, after the fact.

| ID | Requirement |
|---|---|
| L-COH-01 | **MUST** define cohort membership at the **employer / design-partner level, allow-listed in configuration**, not by self-selection, not by a public toggle, and not by candidate opt-in to a public flow. A session is in-cohort only if its employer is on the allow-list *at session start*. Membership changes are prospective only: adding an employer never retroactively brings its past sessions into the cohort. |
| L-COH-02 | **MUST** make cohort membership a recorded, timestamped fact per session (employer ID, allow-list version / change record, session ID), written at or before session start and immutable thereafter. If membership cannot be evidenced for a session, the session is treated as **non-cohort** (fail-closed). |
| L-COH-03 | **MUST** enforce cohort-only enablement in code, at the same gate that enforces consent: presence-only Observer enablement for a non-cohort session **MUST** be impossible through the normal product path — not merely discouraged in copy or admin procedure. Test hook required (see L-DOR-03). |
| L-COH-04 | **MUST** state what the cohort promise *is*, verbatim-grade: the Observer may be present in the session; attendance / presence may be recorded; **no biometric collection for analysis occurs, no analysis is performed, and no analysis is provided** to the recruiter, the employer, or the candidate. Cohort consent / notice copy, employer terms for design partners, and in-product disclosure **MUST** all say the same thing. Any divergence is a package fail. |
| L-COH-05 | **MUST NOT** run a public biometric-consent ask in January. No public flow may present `biometric_collection` consent language describing capture or analysis that will not occur. The only consent-state changes in January are those arising inside the cohort flow under L-COH-04, plus declines / withdrawals, which **MUST** always be recordable (a candidate can always say no, and a "no" must always work — see L-JAN-04). |
| L-COH-06 | **MUST** address the employer as a consent actor separately from the candidate. Design-partner agreement / enablement record must show the employer understood: presence-only, no analysis, no entitlement to analysis later without a new Rekrut enablement decision, and no right to ask Rekrut to "turn on" capture for its sessions. Candidate consent never substitutes for employer enablement, and employer enablement never substitutes for candidate consent — both are required, independently recorded. |
| L-COH-07 | **SHOULD** cap the cohort in the design (named partners, or a numeric ceiling set by Sumanth at design approval). An uncapped "cohort" is a public launch wearing a label — if Rex's design proposes no cap, Lead must surface that explicitly to Sumanth at the design gate. |
| L-COH-08 | **MUST** prohibit cross-cohort data use: cohort session records, attendance data, and any dormant-capture test artefacts **MUST NOT** be used to train, calibrate, baseline, or validate any model or signal, and **MUST NOT** be pooled with non-cohort data for any analytic purpose. Cohort data exists to evidence the January promise, nothing else. (Also a red line, §8.) |

### 3. The January consent / audit record — the audit spine

**Why this record is the spine:** In January Rekrut's legal safety does not come from having collected little — it comes from being able to *prove*, session by session, exactly what state each session was in and that no analysis was provided. Presence-only is a negative claim ("we did not analyse"). Negative claims are only defensible with a contemporaneous, complete, tamper-evident record. That record is also the join key for everything later: a future activation consent (§4) must be linkable to, and distinguishable from, the January record for the same candidate/session — and any gap in the January record for a session means that session can never be used to support a later claim about that candidate.

| ID | Requirement |
|---|---|
| L-JAN-01 | **MUST** create one audit record per cohort session, written contemporaneously (at session start / end, not back-filled), containing at minimum: session ID; candidate ID; employer ID and cohort-membership evidence (L-COH-02); recruiter / interviewer identity where applicable; Observer presence (present / not present) and Observer identity (`ai-observer-{sessionId}` pattern per E-008); session start and end timestamps (with timezone / UTC offset preserved); consent state as resolved at session start (see L-JAN-02); and the analysis statement (L-JAN-03). |
| L-JAN-02 | **MUST** capture consent *state*, not just a boolean: one of `granted / declined / withdrawn / unknown` as resolved through `lib/observerReportStates.js`, plus: the timestamp the state was set, the artefact version that produced it (consent copy / flow version), and the channel (in-product, etc.). Consistent with the standing audience-split ruling (S-039, 2026-10-12): recruiter-facing surfaces collapse declined / withdrawn / unknown to one neutral line with the no-inference clause; candidate / audit surfaces may name the reason. The audit record itself stores the true state — the split is a *display* rule, never a storage rule. |
| L-JAN-03 | **MUST** record, as an explicit field — not implied by absence of a report row — `analysis_provided: false` / the canonical "analysis not provided" statement for every January cohort session, together with attendance (Observer present; candidate attended / did not attend, where the product records attendance). A missing analysis row is **not** evidence analysis was not provided; the affirmative record is. |
| L-JAN-04 | **MUST** record declines and withdrawals with the same completeness as grants, including withdrawal timestamp and the enforcement result (Observer did not join, or disconnected — with the existing <10s revocation-to-disconnect guarantee from E-008 evidenced where a mid-session withdrawal occurs). Consistent with E-008: declined / withdrawn / unknown sessions get **no** `ai_observer_reports` row; their state is derived at read time. The January audit record in L-JAN-01 is the *consent/attendance* record — it **MUST NOT** be implemented as a back-door observer report row for non-consented candidates, and **MUST NOT** contain any observation, signal, transcript excerpt, or media reference for a non-granted session. |
| L-JAN-05 | **MUST** make January audit records immutable / append-only in design (no update-in-place of consent state, presence, timestamps, or the analysis statement; corrections are new appended entries referencing the original). Retention for these records: see L-RET-05. Access: restricted role (compliance / audit), not general recruiter access; recruiter surfaces show only the report-state rendering, not the raw audit record. |
| L-JAN-06 | **MUST** define completeness as a checkable property: for every cohort session that started, exactly one January audit record exists; the design must name the reconciliation (query / job / test) that would detect a missing record, and Lead must be able to run it before any Observer enablement. An incomplete spine = no enablement. |
| L-JAN-07 | **MUST NOT** store, in or alongside the January record, any voice, frame, embedding, transcript-derived biometric feature, or "pre-analysis" artefact. January has nothing to store but the record itself. If the design's data model has a nullable media field on the January path, that is a package fail — the field must not exist on that path. |


### 4. Fresh consent at activation — January consent is never banked

**Principle (non-negotiable):** Consent is specific to a purpose described at the time it was given. January's promise was *presence without analysis*. Stretching that consent to cover *recording a voice, deriving speech patterns, or producing analysis* would fail BIPA's written-release requirement (informed, purpose-specific, before collection — 740 ILCS 14/15(b) [verify pinpoint]), GDPR Art. 9 explicit-consent specificity for any future EU scope, Illinois AI Video Interview Act consent principles, and Rekrut's own fail-closed posture — and it would be the fact pattern in the first complaint. The design must make stretching *technically impossible*, not just contractually disavowed.

| ID | Requirement |
|---|---|
| L-ACT-01 | **MUST** model activation consent as a **new consent artefact and a new consent state transition**: a candidate's January `granted` (presence) state **MUST NOT** satisfy, pre-populate, default, or be read by the capture/analysis gate. The capture gate requires a consent record whose artefact version is the activation artefact (L-ACT-02) and whose timestamp post-dates the activation enablement decision for that employer/session. Any code path where an old consent row authorises capture is a red line (§8). |
| L-ACT-02 | **MUST** specify the future activation ask's required contents (design must include the checklist, even though final copy is counsel-reviewed later): (1) that audio **will be recorded and stored** — in plain words, not "processed"; (2) what will be derived from it (speech-pattern features, named at the level the validation protocol actually uses — no generic "insights"); (3) what will **not** be claimed (no deception / lie detection — voice-deception claims are scientifically discredited and banned from Rekrut claims; stress, if ever shown, is a meter with uncertainty only); (4) who sees what (recruiter report vs. candidate feedback, per the standing report rules); (5) retention period for the audio and for derived features (§6); (6) that declining has the standing consequence — candidate may take a human interview without the Observer, recruiter decides whether to proceed — and that declining is not itself reported as a negative signal (audience-split / no-inference rule); (7) how to withdraw, and what withdrawal does to already-captured audio (stop + erasure path, §6); (8) that consent is per the scope described, and any new purpose (new signal type, video, body language) requires a **new** ask. |
| L-ACT-03 | **MUST** keep activation consent granular and unbundled: capture consent, analysis consent, and any retention-beyond-default / talent-pool-type consent are separate artefacts (platform-design rule: separate artefacts per purpose). Pre-ticked, bundled-with-interview-acceptance, or employer-blanket consent designs are prohibited. Accepting the interview must not be the same click as consenting to capture. |
| L-ACT-04 | **MUST** state the re-entry contract as design preconditions — **all** must be true before **any** real (non-synthetic) candidate audio is captured, for any employer, in any environment reachable by real candidates: (a) counsel determination(s) relevant to Observer capture/analysis received in writing, and the #788 CRA determination received in writing (threat-intel stays governed separately — dark until its own determination lands, regardless of Observer state); (b) Lex consent/retention review of the *activation* flow (this document covers January + dormancy; activation needs its own pass against final copy); (c) Quinn validation protocol executed on synthetic / test media only, with results recorded; (d) #777 policy-page fix live (§7); (e) BIPA §15(a) public retention schedule updated to cover captured audio *before* first capture (§6); (f) Sumanth's explicit activation approval at a new gate. The design **MUST** encode (a)–(f) as an enablement checklist that Lead can verify — a flag flip alone never satisfies re-entry. |
| L-ACT-05 | **MUST** honour the re-entry dates as hard design constraints: counsel + design cleared by **2026-11-01** → the speech-pattern slice *may* be proposed for activation for the cohort pilot (still subject to L-ACT-04 and Sumanth's gate); after **2026-12-01**, **nothing activates pre-launch** — the design and sprint plan must treat 2026-12-01 as a window close, not a target to negotiate. Owner of the re-entry contract: Lead. Open triggers escalate to Sumanth; re-decision only at first post-launch planning. |
| L-ACT-06 | **MUST NOT** capture real candidate audio "to have it ready" pending re-entry — no pre-positioning collection, no "record now, consent later, delete if they decline." Collection before L-ACT-04 is satisfied is collection without the required consent, and deletion afterwards does not cure it (BIPA liability attaches at collection). Synthetic / test media (L-DOR-05) is the only permitted pre-activation media. |
| L-ACT-07 | **MUST** handle the returning-candidate case: a candidate who was in a January cohort session and later sits an activated session needs the full activation ask, with copy that does not reference their January presence as a reason, expectation, or prior agreement ("you already agreed in January" in any form is prohibited copy). |

### 5. Dormancy as a legal fact — "code exists but collects nothing" must be provable

Dormancy is not a state of mind or a default in a config file. If a regulator, a design-partner employer conducting diligence, or a plaintiff asks "prove nothing was collected while you said the system was dormant," Rekrut's answer is whatever evidence the design creates *now*. Retrofitted evidence is not evidence.

| ID | Requirement |
|---|---|
| L-DOR-01 | **MUST** define dormancy mechanically: while the capture flag is off (default-off), the capture path (a) does not subscribe to / consume candidate audio tracks for persistence, (b) writes no audio, transcript-for-analysis, frame, embedding, or derived-feature artefact to any store (database, R2/B2, disk, queue payload, log payload), and (c) creates no capture job / observer media job for any session. "Off" that still buffers, samples, transcribes, or "temporarily" stores media is not dormant. In-memory presence behaviour already shipped (presence-only Observer) is out of scope of (a)–(c) only to the extent it already persists nothing — the design must say so explicitly, per data type. |
| L-DOR-02 | **MUST** make the flag fail-closed and single: one authoritative flag, default-off in code (not only in environment configuration), where a missing / malformed / unreadable flag value resolves to OFF, and where enabling requires a deliberate, authenticated, logged act by a named operator — never a deploy side-effect, seed, migration default, or employer-side setting. Design must name who can enable, and that list must not include employer / recruiter roles. |
| L-DOR-03 | **MUST** specify dormancy tests Quinn can run and Lead can cite: at minimum (i) flag-off integration test asserting zero writes across every capture store for a full synthetic session; (ii) flag-absent / flag-malformed test asserting OFF behaviour; (iii) gate test asserting capture cannot start for a non-cohort, non-consented, or January-state-only session even with the flag on; (iv) subscription test asserting no media-track consumption for persistence while dormant. Tests run in CI; results are part of the build evidence package. A design without named tests fails this review. |
| L-DOR-04 | **MUST** create the dormancy evidence trail contemporaneously: flag-state change log (who, when, old → new value, reason / ticket); build / deploy records linking the deployed artefact to the flag default; periodic (at least per-release) dormancy attestation — a recorded check that production flag = OFF and capture stores contain zero dormant-period capture artefacts, signed off by a named person, retained per L-RET-05. Logs **MUST NOT** themselves contain media or media-derived content. |
| L-DOR-05 | **MUST** segregate synthetic / test media: speech-pattern slice validation uses synthetic or consented test media only, in a non-production or clearly segregated test environment, with test artefacts labelled as test data, excluded from candidate records, and deleted on the test-data schedule in the design (named period, named owner). Test media must never share a store, bucket prefix, or table with candidate data in a way that makes them indistinguishable. A real candidate's audio found in test data — or test data found in a candidate record — is an incident, not a data point. |
| L-DOR-06 | **MUST** address observability without collection: metrics / health checks for the dormant path may count *events* (sessions, gate decisions, flag state) but **MUST NOT** log audio content, transcript content, voice features, or identifiers beyond what the January audit record already holds. "We only logged it for debugging" is collection. |
| L-DOR-07 | **SHOULD** include a kill / stay-off property: if the capture flag's control plane is unavailable or its state is disputed, the system stays OFF and presence-only behaviour is unaffected. Dormancy must never depend on a human remembering to turn something off after a deploy. |

### 6. Retention / erasure posture — captured audio as a data class

| ID | Requirement |
|---|---|
| L-RET-01 | **MUST** classify **captured raw audio as a recording**, falling in the existing **recordings bucket: 90 days maximum** from session end, then automated purge. It **MUST NOT** be classified as a frame (30 days is for frames, but see L-RET-02), an embedding (24 months is for *inactive embeddings* — raw audio is not an embedding and must never inherit that period), a transcript, or a new bucket with a longer period. Any design proposing >90 days for raw audio is a red line (§8) and requires, at minimum, counsel review and Sumanth's explicit ruling — neither is sought in this package. |
| L-RET-02 | **MUST** classify derivatives separately and no-longer-than-source in effect: (a) derived speech-pattern features / measurements — retained no longer than the report they support, under the observer-report retention already in E-008 (30 days for `ai_observer_reports`), unless Rex + Quinn's validation protocol gives a written, counsel-visible reason for a defined longer period, approved at the activation gate (not now); (b) any voice embedding / template, if the future design ever creates one, is a **biometric identifier** — it inherits the strictest handling (segregated sensitive store, narrowest access, inactive-embedding ceiling of 24 months is a *ceiling*, not a target, and BIPA §15(a) schedule must name it expressly). The dormant build **MUST NOT** create voice embeddings/templates at all — speech-pattern validation on synthetic media produces test artefacts under L-DOR-05, not candidate biometric templates. |
| L-RET-03 | **MUST** make captured audio erasable and prove the composition: audio, derivatives, and report rows must sit inside the existing candidate erasure path (`erasureService` pattern in E-008 §5) from the first build that can persist them — no "add erasure later." Design must enumerate every store the audio path touches (primary store, backups / replicas, R2/B2 objects, transcode / temp artefacts, logs, vendor / ASR sub-processor copies if any) and state the erasure / purge mechanism and maximum lag for each, including backup expiry. The E-008 erasure-vs-flush race hardening (shared advisory lock, S-049b scope) **MUST** be carried into the capture design wherever a write can race an erasure or a withdrawal. Erasure of audio on consent withdrawal **MUST** be specified separately from erasure on retention expiry and from DSAR erasure — all three reach the same stores. |
| L-RET-04 | **MUST** specify the BIPA §15(a) consequence: §15(a) (740 ILCS 14/15(a) [verify pinpoint]) requires a **publicly available written retention schedule and destruction guidelines** for biometric identifiers / information. Dormant build (no capture, no templates) does **not** by itself require a schedule update. **Before first real capture** (L-ACT-04(e)), the published schedule **MUST** be updated to state, for captured audio and any derivative biometric data: the data class in plain words, the retention period (90 days for raw audio per L-RET-01; named period for derivatives), the event that starts the clock (session end / last interaction, as applicable), the destruction method / standard, and the permanent-destruction trigger (purpose satisfied or period expiry, whichever the schedule states). The schedule is a public document — it **MUST NOT** contain security detail that would aid attack, and it **MUST NOT** promise any analysis capability (see §7). Counsel reviews the schedule wording before first capture — flagged, not assumed (§9). |
| L-RET-05 | **MUST** set retention for the *non-media* records in this design distinctly from media retention: January audit records (L-JAN-01) and dormancy evidence (L-DOR-04) and consent records generally are **accountability records** — retained for the life of the candidate relationship plus the applicable limitation / audit window as already provided in Rekrut's retention lifecycle (design must cite the existing lifecycle entry it relies on, not invent a new period in this package; if no entry covers consent/audit records, Lead flags it as a package gap for counsel, §9). They **MUST NOT** be purged on the 90-day media schedule — deleting the proof on the media schedule defeats the spine. Legal hold suspends all purges (existing rule). |
| L-RET-06 | **MUST** enforce retention automatically (sweep / job, per the S-077 retention-sweep pattern extended in E-008), not by manual deletion, with purge results logged (counts, data class, period — no content) so a completed purge is itself evidenced. A retention period without an automated purge + log is a policy statement, not a control (compliance-auditor rule). |
| L-RET-07 | **MUST NOT** retain captured audio for "future model improvement," calibration baselines, or product analytics under the capture consent. Those are new purposes requiring their own consent artefact and counsel review. The unbuilt E-003 calibration baseline in particular **MUST NOT** be used as a retention justification in this design — it does not exist, and §7 prohibits promising it. |

### 7. The #777 policy-page fix — what the page may and may not promise

**Gate:** #777 blocks **any** Observer enablement (including cohort presence-only enablement) until fixed — Sumanth's ruling. Lead's package check treats §7 as a pre-enablement checklist, independent of the capture build.

**Wording principles (apply to the policy page and, by extension, all public / candidate-facing biometric copy):**
1. **Promise only what is built, enabled, and true today.** A capability that is designed, dormant, planned, or "coming" is described as not offered — or not mentioned — never in present tense.
2. **Name data classes and periods concretely; never name mechanisms that don't exist.** Retention periods that are real may be stated; a "baseline," "calibration," or comparison population that has not been built may not be referenced at all.
3. **No analysis claims while no analysis runs.** No scores, signals, baselines, comparisons, or "insights" language for the Observer in January.
4. **No deception claims, ever.** No lie / deception detection language anywhere, in any tense. Stress language only if and when a validated meter ships, and then only as a meter with uncertainty.
5. **Consent copy and policy copy must agree.** If the page says it, the consent artefact must cover it; if the consent artefact doesn't cover it, the page must not say it.

| ID | Requirement |
|---|---|
| L-POL-01 | **MUST** remove / rewrite every statement on the biometric policy page that asserts or implies the E-003 calibration baseline exists — including present-tense descriptions of baseline comparison, norming, calibration populations, or candidate-vs-baseline reporting. Acceptable replacements: silence on baselines, or an honest statement that no baseline comparison is provided. Unacceptable: future-tense promises with dates, "will calibrate" language, or footnote qualifications that leave the impression intact (launch-review marketing-claims rule: a claim a reasonable candidate would rely on is a claim, qualified or not). |
| L-POL-02 | **MUST** audit the whole page against principles 1–5, not only the baseline sentence: every verb describing Observer behaviour must be true of the presence-only January system at the time the page is live; retention statements must match §6 and the BIPA §15(a) schedule; rights / withdrawal / contact statements must match the working flows. Lead records the page version / diff in the enablement package. |
| L-POL-03 | **MUST NOT** fix #777 by adding dormant-capture disclosure that implies collection: the page describes what Rekrut *does* with candidate data. Dormant code collects nothing, so there is nothing to disclose as collection — but the page **MUST NOT** affirmatively state Rekrut "never records audio" in unqualified terms that the future activation would make retroactively misleading without a page update. Activation requires a page update *before* first capture (tie to L-ACT-04); the January page must be worded so that update is a visible change, not a silent reinterpretation. |
| L-POL-04 | **MUST** version the fix: page version, publish date, and the approver recorded; prior version retained in the compliance record (so Rekrut can show what the page said on any given January date — this pairs with the consent-artefact version in L-JAN-02). |


### 8. Red lines — Lex BLOCKS the design package if any of these are present

Lead: any one of these in Rex's design, in Nova's build plan, or in associated copy = package does not go to Sumanth as approved-by-Lex. It returns to the owner to fix. Lex does not waive red lines; only Sumanth can overrule Lex, and only in writing, and counsel-flagged lines (marked †) should not be overruled without counsel.

- **RL-01 † — Consent-banking:** any mechanism by which January presence consent, a legacy consent state, or an employer's cohort enablement authorises future capture or analysis. (Violates L-ACT-01.)
- **RL-02 † — Collection while dormant:** any media persistence, buffering-to-store, transcription-for-analysis, sampling, or derivative creation while the capture flag is off; or a flag that defaults on, resolves ambiguous values to on, or can be enabled by an employer / recruiter role or as a deploy side-effect. (L-DOR-01, L-DOR-02.)
- **RL-03 † — Subscribe-while-dormant / silent enablement:** capture code subscribing to candidate media tracks for persistence under dormancy, or any enablement path without an authenticated, logged, named-operator act and a completed L-ACT-04 checklist.
- **RL-04 — Analysis claims anywhere:** consent copy, policy page, in-product text, recruiter UI, sales / design-partner materials, or report shells claiming, implying, or previewing analysis, scores, signals, baselines, or calibration that do not run — including "analysis coming soon" tied to a candidate's own session. (L-COH-04, L-POL-01, principles in §7.)
- **RL-05 — Retention default longer than recordings:** raw captured audio retained, by default, schedule, or derivative-classification, longer than 90 days; or raw audio classified into the 24-month embeddings bucket; or retention with no automated purge. (L-RET-01, L-RET-06.)
- **RL-06 — Cross-cohort / cross-purpose data use:** cohort records, dormant test artefacts, or (future) captured audio used for training, calibration, baselines, product analytics, cross-employer pooling, or any purpose outside the consent under which the data arose. (L-COH-08, L-RET-07.)
- **RL-07 † — Erasure gap:** any store touched by the capture path that is outside the candidate erasure path, or a flush/write path that can resurrect erased or withdrawn-consent data (including the unresolved E-008/S-049b race carried into capture without the advisory-lock hardening). (L-RET-03.)
- **RL-08 — Public January consent ask / public enablement:** any public (non-cohort) Observer enablement, public biometric-consent flow describing January capture/analysis, or cohort definition that is self-selecting or uncapped without Sumanth's explicit attention at the gate. (L-COH-01, L-COH-05, L-COH-07.)
- **RL-09 — Deception claims:** any "lie detection," "deception," "truthfulness score," or equivalent claim, in code, copy, or design intent, in any tense. (Standing scientific-validity ruling; L-ACT-02(3).)
- **RL-10 — Audit-spine gaps:** January sessions without the L-JAN-01 record, a mutable audit record, an `analysis_provided` value inferred from missing rows, or observation/report rows created for declined / withdrawn / unknown candidates. (L-JAN-03, L-JAN-04, L-JAN-05.)
- **RL-11 — Media in logs / test-data mixing:** media or media-derived content in logs or metrics; synthetic/test media indistinguishable from, co-stored with, or linked to candidate records. (L-DOR-05, L-DOR-06.)
- **RL-12 — New biometric templates in the dormant build:** creation of voice embeddings / templates, face geometry, or any biometric identifier by the dormant build or the synthetic-media validation slice as candidate-linked artefacts. (L-RET-02.)

### 9. Open determinations that remain counsel's — not Lex's, not Rex's, not Suga's

The design package must list each of these as **OPEN** with its owner and gate. Designing *around* an open item (fail-closed, dark, dormant) is required; designing *as if* it were answered is a package fail.

| # | Determination for counsel (precisely) | Gates what |
|---|---|---|
| C-01 | **Rekrut-as-CRA (#788 / S-086, Point 1 of the S-084 brief):** whether furnishing the repeat-IP threat-intel signal to an employer makes Rekrut a consumer reporting agency furnishing a consumer report under FCRA (and/or an investigative consumer report under California ICRAA/CCRAA or another state mini-FCRA), the facts the answer turns on, the compliance programme if yes, and the tripwires if no-for-narrowed-v1. | Any release of any threat-intel signal to any recruiter. Signal stays dark until this lands in writing. (Appendix A chases the timeline.) |
| C-02 | **Disparate-impact validation (S-084 brief, Point 2):** the defensible pre-release validation / monitoring method for the repeat-IP signal, the lawful way to obtain testing data, suppression thresholds, the permitted-influence boundary, and whether any AI-hiring regime (NYC LL 144, Illinois HB 3773, Colorado, California ADS rules) is triggered by the signal as designed. | Any release or escalation of the threat-intel signal; any validation study (none may run, and no demographic data may be collected for one, until counsel approves the method). |
| C-03 | **DPO trigger (S-084 brief, Point 3) — deprioritised in EU scope, live in India scope:** GDPR Art. 37 assessment at launch scale (EU launch postponed — counsel asked to scope this down accordingly in Appendix A); India DPDP Significant Data Fiduciary likelihood / timetable and interim SPDI grievance-officer position; conflict-free low-budget staffing model. No one at Rekrut is titled or held out as "DPO" until counsel determines status. | DPO appointment / titling; enterprise diligence answers about DPO posture. Does **not** gate the January cohort or the dormant build. |
| C-04 | **Activation consent sufficiency:** whether the activation consent artefact (contents per L-ACT-02), the BIPA written release, and the retention-schedule update (L-RET-04), *in their final wording*, satisfy Illinois BIPA §§15(a)–(b), Texas CUBI / Washington biometric law where applicable, Illinois AI Video Interview Act, and — for any revived EU scope — GDPR Art. 9(2) + Art. 88 member-state law for the specific launch states. Lex specifies required contents; counsel determines sufficiency of final text. | First real capture. No real audio before counsel has seen final activation copy + schedule. |
| C-05 | **Speech-pattern analysis characterisation:** whether deriving speech-pattern features from captured audio, and showing a stress *meter with uncertainty*, constitutes biometric / biometric-information processing, emotion recognition (banned in EU workplace/education contexts under the AI Act — relevant on EU revival), or an automated employment decision tool under any launch-state AI-hiring law — and what notices / bias-audit duties follow. Includes the scientific-validity boundary: deception claims are already banned internally (RL-09); counsel advises whether the meter itself is defensible. | Activation of the speech-pattern slice (the 2026-11-01 re-entry checkpoint). |
| C-06 | **Consent/audit-record retention period:** the specific retention period and legal basis for consent records, January audit records, and dormancy evidence (L-RET-05 requires the design to cite an existing lifecycle entry; if none squarely covers these records, counsel sets the period — weighing GDPR storage limitation / accountability, DPDP erasure-when-purpose-ends, California 4-year ADS-record retention [⚠ verify], and US limitation periods for BIPA / discrimination claims). | Final retention-schedule publication; does not gate building the records. |
| C-07 | **Design-partner employer terms:** whether cohort design-partner agreements adequately allocate controller / processor (and, if C-01 answers yes in any scenario, CRA-adjacent) duties between Rekrut and the employer — including who gives which notice, who honours withdrawal / erasure, and audit cooperation. Lex + the vendor-contracts checklist frame the terms; counsel determines them for execution. | First cohort enablement (terms must exist before enablement, even if counsel's full review lands in parallel — Lead escalates any slip to Sumanth). |
| C-08 | **Standing consent/retention review overlap:** confirmation of how the S-084 determinations interact with the biometric consent flow + data-retention lifecycle review already standing with counsel (flagged in the S-084 brief), so no determination in C-01–C-07 silently contradicts it. | Package completeness; Lex tracks, counsel confirms. |

### 10. Lead's package checklist (summary — full text is §§1–7)

- [ ] §§1–7: every **MUST / MUST NOT** ID marked Pass / Fail / N-A-with-reason
- [ ] §8: all 12 red lines confirmed **absent**
- [ ] §9: C-01–C-08 listed as **OPEN** in the package, with gates stated
- [ ] #777: fixed page version + diff attached (L-POL-04); enablement blocked until then
- [ ] Appendix A: chase draft noted as **complete, unsent**, awaiting Sumanth's send decision + counsel name/firm
- [ ] Next gate: Sumanth approves the assembled design package → only then does Nova build

*— Lex, Legal & Compliance. Advisory only. This review flags determinations for counsel ( §9) and red lines for Sumanth's gate; it approves nothing.*

---
---

## Appendix A — Deliverable 2: Counsel chase draft for #788 (S-086 CRA determination)

> ### ⚠️ DRAFT — NOT SENT
> **Do not send as-is.** Sumanth fills in counsel's name / firm (bracketed fields), confirms the sender, and approves sending at his gate. Prepared by Lex, 2026-10-13. No GitHub changes made in connection with this draft. Tracking: GitHub issue #788 (`[STORY] S-086` — FCRA/CRA determination, P0, launch-blocker) on `sumanthrangausa-06/Rekrut_AI_v2`; brief on file at `docs/sdlc/rekrut-ai-v2/04-implementation/unified-interview-engine/s084-counsel-brief.md` in the Rekrut_AI_v2 repo.

---

**Subject:** Timeline request — Rekrut AI counsel brief (CRA determination + two related points): decision dates 1 Nov / 1 Dec 2026

Dear [Counsel name / Firm],

I am writing to follow up on the counsel brief we filed with you on 12 October 2026 — *"S-084 Counsel Brief — Threat-Intel Signals: Three Determinations Requested"* — and to ask for a committed response timeline, with a date, that we can plan against.

For reference, the brief asks for three written determinations:

1. **Rekrut-as-CRA:** whether Rekrut is a consumer reporting agency furnishing a consumer report under the FCRA (and parallel state law, notably California) when it furnishes our narrowed threat-intel signal — repeat applications to the same employer from the same IP address, per-employer siloed, info-severity, advisory-only — to an employer customer;
2. **Disparate-impact validation:** the validation and monitoring approach you would consider defensible for that signal before it may influence any employment decision, including the lawful way to obtain the data such a study needs; and
3. **DPO trigger assessment:** whether a Data Protection Officer appointment is triggered at our launch scale and processing profile, and a conflict-free, low-budget staffing model if so.

**Why we need dates, not just answers.** Two decisions in our launch plan are contractually tied to your response, and neither can slip silently:

- **1 November 2026 — design-clearance checkpoint.** If counsel and design are cleared by this date, one narrow feature (a speech-pattern slice of our interview Observer, for a controlled design-partner cohort only) *may* be proposed for activation. Without clearance by then, it is not proposed.
- **1 December 2026 — hard window close.** After this date, nothing in this area activates before our January 2027 launch, regardless of later clearance. The window closes; it does not slide.

Separately, and most importantly: **our threat-intel signal stays dark — built chassis only, released to no recruiter — until the CRA determination in Point 1 is received in writing.** There is no interim release. Your Point 1 timeline is therefore the release timeline, and we would rather plan honestly around a later date than discover one.

**One scoping update since the brief was filed.** We have **postponed our EU launch**; launch focus is now the **USA and India**. Please scope your effort accordingly: the EU-facing elements — in particular the GDPR Article 37 limb of Point 3 and any Article 88 member-state analysis — are **deprioritised** and may be answered at summary level or deferred until we revive EU scope. The US analysis (Point 1, and the US limb of Point 2) and the India DPDP limb of Point 3 remain full priority.

**What we are asking for in reply** — a short note is sufficient at this stage:

1. Confirmation the brief is with the right team, and a named contact for these three points;
2. A **committed date** by which you will deliver the written determination on Point 1, and indicative dates for Points 2 and 3;
3. Your fee estimate for the three points as now scoped; and
4. Anything in our stated facts or interim guardrails you consider wrong or insufficient, flagged early — we would rather be corrected now than after we build.

If it helps, we can supply our launch-volume projections and growth assumptions, the underlying threat-intel specification, and our current consent / retention documentation on request. We also understand this brief sits alongside the standing review of our biometric consent flow and data-retention lifecycle already with you — please flag any overlap or conflict between the two.

Thank you — we appreciate the brief is narrow by design. We scoped it to three questions precisely so the answers could gate real build decisions, and the dates above are the decisions they gate.

Yours sincerely,

[Sumanth's full name]
Founder, Rekrut AI
[Contact details]

*Enclosed / previously filed: S-084 Counsel Brief (12 October 2026), three points as above.*

---

**Lex's sending notes (not part of the letter — delete before sending):**
- Fill: counsel name/firm, Sumanth's full name and contact details. Confirm the brief was actually received by this firm before sending — if the engagement is not yet confirmed, the first paragraph needs "we are writing to engage you on…" wording instead; escalate to Sumanth, do not improvise an engagement letter.
- Send from Sumanth (or Suga on Sumanth's explicit instruction) — Lex does not send.
- On reply: log counsel's committed dates on #788, notify Lead (re-entry contract owner) the same day, and diary the 2026-11-01 checkpoint and 2026-12-01 window close against them. If counsel's Point 1 date lands after 2026-11-01, escalate to Sumanth immediately — that fact alone changes the re-entry position.
- This draft transmits / references the S-084 brief; it does not amend it. If counsel asks for the EU scope restored, that is Sumanth's decision, not a reply-drafting decision.

*— End of Lex deliverables. Both deliverables are drafts for Sumanth's gate. Nothing has been sent, filed, or posted.*
