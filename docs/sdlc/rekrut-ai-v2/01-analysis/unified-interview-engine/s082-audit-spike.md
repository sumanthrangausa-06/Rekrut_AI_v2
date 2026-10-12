---
project: Unified Interview Engine
phase: 1-Analysis
story: S-082
issue: 782
status: complete
created: 2026-10-12
owner: Rex (Solution Architect)
specialist: Scout (code verification — all code claims below carry file:line evidence)
feeds: Gate A brief (Lead) → Sumanth's E-004/E-005 launch-scope decision before Sprint 11 planning
---

# S-082 Audit Spike — `interview-ai.js` Reusability + E-004/E-005 Re-size

> **Timeboxed spike. No shared-service design (panel decision: single consumer = premature abstraction). No implementation.**
> Code verified against `dev` @ `6c26ec63` (2026-10-12) by Scout; sizing arithmetic verified by Rex against `epics-stories.md`.

---

## Executive Summary

1. **Reusability is at the plumbing layer, not the service layer.** Of `services/interview-ai.js`'s nine exports, **none** is reusable by an Observer signal pipeline — they all consume transcript *text* and produce LLM *judgment scores*. What genuinely transfers: `lib/ai-provider.js` (beneath it, including its ASR cascade), and the frame→vision plumbing pattern in `lib/polsia-ai.js` over `lib/r2FrameStore.js`. The pipeline itself is new code either way.
2. **The ~80-pt figure is an accurate sum of the wrong unit.** E-004 (57) + E-005 (23) = 80 is arithmetically correct against the filed stories — but it prices two full epics across *all* interview surfaces, including 39 pts of AI-interview challenge/deepfake machinery the Observer never uses. **The Observer-only path (what S-049b actually needs) re-sizes to ~40–55 pts**, including a capture substrate **no filed story prices at all**. The complete Phase-3 vision including E-003 calibration is **94 pts**, not 80.
3. **Deferral is safe, reversible, and privacy-optimal.** The Observer worker today subscribes to media tracks but consumes, records, and analyzes none of them — there is **zero biometric processing** to be exposed by, and zero historical data lost by waiting (nothing accumulates). Building capture *before* analysis would invert that: raw biometric media stored with no consumer, carrying retention/erasure obligations for no benefit. **My verdict: deferral costs product differentiation only; it creates no compliance debt and no catch-up debt.**
4. **S-039 can build now** against the projection contract in §4. It never needs to change when populated shapes land — only a `version` bump it already tolerates.

---

## 1. Reusability Audit — `services/interview-ai.js`

### 1.1 What the file actually is (Scout-verified)

909 lines, 9 exports (`services/interview-ai.js:898-909`): `suggestSlots`, `createReminders`, `suggestRescheduleSlots` (scheduling), `generateScreeningQuestions`, `generateScreeningTopics`, `conductScreeningTurn`, `checkStalledScreenings` (screening flow), and the two evaluation functions:

- `generateScreeningReport(session)` (:369) — transcript text → LLM prompt → structured judgment JSON (5 dimensions, scores, recommendation). Callers (Scout-verified): `routes/interviews.js:3331` (legacy screening completion), `routes/interview-sessions.js:793` (unified-session completion), `services/qa-extraction.js:155` (observer Q&A report).
- `runMultiEvaluation(candidateId, jobId, companyId, context)` (:510) — transcript text → 3 parallel LLM evaluators + synthesis → rows in `interview_evaluations`/`interview_composite_scores`, feeding OmniScore. Callers: `routes/interviews.js:3369, 3610`, `services/qa-extraction.js:168`.

**The input type is the finding.** Both functions consume *prose* (conversation turns / Q&A text) and emit *judgments*. A behavioral/integrity pipeline consumes *time-series measurements* (utterances with timestamps, pause distributions, frame samples, signal-quality values) and emits *observations*. These do not compose. There is no function in this file that accepts a signal, a timestamp series, or a media reference.

### 1.2 Corrections to the sprint plan's premise

The Sprint 10 plan describes `interview-ai.js` as "reused by mock/screening/Track B." Scout's verification splits that claim:

- **AI screening: VERIFIED** — `conductScreeningTurn` via `services/conversation-engine.js:158`; report functions at both screening completion paths.
- **Observer Q&A report: VERIFIED, with a caveat** — `services/qa-extraction.js` (header: "runs the SAME analysis stack") calls `generateScreeningReport` + `runMultiEvaluation` to produce the report that `POST …/observer/report` (`routes/interview-sessions.js:1224`) stores in `interview_sessions.config.report`. **But that report is a transcript-judgment scorecard over a Q&A transcript captured by a different agent** (the Track B voice agent, §2.3 note) — it is not, and never was, behavioral/integrity analysis. Its existence does not reduce S-049b's scope by one point.
- **Legacy mock interview: CONTRADICTED** — the mock handlers (`routes/interviews.js:459-1850`) call **none** of `interview-ai.js`; mock analysis lives in `lib/polsia-ai.js` (with a duplicate in `lib/qp-ai.js`). The "mock-interview analysis stack" phrasing in code comments refers to the unified `interview_sessions` stack, not the legacy mock path.

**Net picture:** reuse is real but shallow — two LLM judgment functions shared by the screening-shaped flows, one provider layer beneath everything, and a parallel legacy stack (`polsia-ai`/`qp-ai`) beside them. There is still no shared *analysis service* in any sense that helps a signal pipeline — which is why the panel's retirement of that assumption was correct, and why Gate A should not be sold a "shared service" design now.

### 1.3 What genuinely transfers to an Observer pipeline

| Asset | Verdict | Evidence / note |
|---|---|---|
| `lib/ai-provider.js` (`chat`, `generateText`, JSON-extraction convention) | **Reuse as-is** | The one truly shared layer; all three analysis paths call it. Any future LLM summarization of computed signals uses it. |
| ASR cascade in `lib/ai-provider.js` (Whisper/Groq/Deepgram/Cartesia) + `lib/self-hosted-audio.js` whisper.cpp | **Reuse as plumbing, if audio is ever captured** | The actual transcription capability. (`lib/transcription.js` is **not** a transcriber — 101 lines of hallucination-phrase filtering and length checks, used by `routes/interviews.js` and `routes/interview-sessions.js`.) The Observer worker references none of it — reusability is conditional on the capture substrate in §2.3 existing first. |
| Vision frame analysis in `lib/polsia-ai.js` (`analyzeVideoPresentation` :618; duplicate in `lib/qp-ai.js`) fed by `lib/r2FrameStore.js` encrypted frame storage | **Reuse the plumbing pattern, not the semantics** | Proves frame sampling + encrypted storage + vision-LLM analysis works in this stack (Quick Practice / mock paths). Its output semantics (eye contact / expression / appearance scores from a vision LLM) are legacy mock concepts; E-005 measurement is explicitly **non-affective** — new measurement design, existing pipes. Note also `analyzeSpeechPatterns`/`analyzeVoiceQuality` (`lib/polsia-ai.js:875, 1042`) operate on transcript **text only** — the code says so itself (:1211-1212). No acoustic analysis exists. |
| `generateScreeningReport` / `runMultiEvaluation` | **Do not reuse** | Transcript-judgment scoring; wrong input type (§1.1). **Additional hazard:** both carry heuristic fallbacks that fabricate scores from response length when the AI call fails (labelled "degraded" in code). S-049b's contract is the opposite — absent analysis renders `missing`, never a heuristic number (Sumanth's no-fake-scores standard). Inheriting this file's fallback pattern would be a defect, not a shortcut. |
| VAD / utterance segmentation | **Exists only inside the Track B voice agent** | Silero VAD via `@livekit/agents-plugin-silero` in `agents/voice-interviewer/worker.mjs:19-20, 91` — a separate agent process, not a library. Zero hits in `lib/ services/ routes/`. The Observer worker has no VAD; S-031 vocal measurement starts from raw capture plus segmentation that doesn't exist as shared code. |
| Worker media consumption | **Does not exist** | The worker subscribes to tracks but consumes no media data (§2.3) — this is the spike's most consequential finding. |

---

## 2. E-004/E-005 Re-size Against Real Code

### 2.1 The 80-pt figure: verified arithmetic, wrong unit

Summing the filed Phase-3 story points (Rex, against `epics-stories.md`):

- **E-004 = 57** ✓ — S-022 (8), S-023a (4), S-023b (4), S-023c (4), S-024 (8), S-025 (5), S-026 (5), S-027 (8), S-028 (5), S-029 (3), S-030 (3)
- **E-005 = 23** ✓ — S-031 (5), S-032 (5), S-033 (5), S-034 (5), S-035 (3)
- **Excluded from the 80 but required by it:** E-003 calibration = **14** (S-019 8, S-020 3, S-021 3) — S-027's filed dependencies are S-029 + S-022 + **S-021**; S-028 requires S-019. Full Phase-3 vision = **94 pts**.

So the figure Lead carried was never fabricated — it is the honest sum of two epic backlogs. The error is using it as the price of the Observer's analysis. Most of E-004 serves the **AI-led interview surfaces** (mock/screening/AI interview), where active challenges and client-side detectors make sense. The Observer (human interviews) cannot run interactive challenges mid-conversation and was never their consumer.

### 2.2 The Observer path — what S-049b actually needs

| Component | Filed pts | Notes |
|---|---:|---|
| **Capture substrate (§2.3)** — *no filed story* | **8–13** (Rex estimate) | Real LiveKit track *consumption* (subscription exists today; no data handler), encrypted media persistence, frame sampling, utterance segmentation. Range reflects reuse of `r2FrameStore`/`polsia-ai` patterns vs. greenfield worker work. |
| S-029 `integrity_events` data layer | 3 | As filed. The projection's source of record. |
| S-027 quality-weighted fusion | 8 | As filed in size, **not** in shape: its ACs presuppose S-022 client signals; Observer inputs come from S-031/S-032/S-028 measurements instead. Same engine concept, different signal adapters. Its S-021 baseline dependency stands. |
| S-021 per-candidate dual baselines | 3 | Minimum viable slice of E-003 for fusion. (Full E-003 = 14 if calibration ships as designed, incl. the S-019 protocol the policy page already promises — see #777.) |
| E-005 core: S-031 vocal + S-032 visual + S-034 multimodal fusion | 15 | The `vocal`/`visual` sections of the §4.3 contract, non-affective per spec. |
| S-049b completion: populated flush + advisory-lock hardening | 3–5 | The remainder of #697 after S-049a's scaffold: write populated sections inside the flush path (spec §4.1), plus the §4.4 advisory lock (erasure/withdrawal mid-flush) already assigned to S-049b. |
| **Observer path total** | **≈ 40–48** | Excludes S-028 (5, voice consistency — valuable integrity input, not required for v1 population) and S-033 (5, linguistic — transcript-dependent). Including both: **≈ 50–58**. |

### 2.3 The substrate nobody priced (Scout-verified)

The S-047 worker **subscribes to media tracks and consumes none of them** (Scout-verified). `workers/ai-observer/index.js` (386 lines) connects with `autoSubscribe:false` and explicitly subscribes (`pub.setSubscribed(true)`, :172-177 and the `TrackPublished` handler :196-205 — inline comment: *"S-047: subscribe only. Analysis pipeline attaches in S-049"*) — but registers **no `TrackSubscribed` handler, no `AudioStream`, no frame or data consumption of any kind**. It imports no storage, frame, or transcription code. Its only state is the `activeJobs` map; its only writes are the `observerJobs` lifecycle and, on session completion via the consent tick, S-049a's `flushReport`. After an observed session, the only durable artifacts are the `observer_jobs` row and the skeleton report row.

**Do not conflate:** a *separate* agent — the Track B voice interviewer (`agents/voice-interviewer/worker.mjs`) — does capture: Silero VAD + an `AudioStream` pump (:199-220) persisting a speaker-labelled transcript to `interview_sessions.config.observer_transcript` on shutdown (:235-245). That is the AI-interview agent's pipeline, not the Observer worker's, and it captures a *transcript for Q&A scoring* (§1.2), not behavioral signals.

Consequences for Gate A:

- **Any** E-004/E-005-for-Observer estimate that omits capture is understated by the substrate's 8–13 pts. The filed stories assumed E-008's worker "captures audio/video" (spec §4.1's original wording) — it does not, and never did.
- The substrate is also the **privacy-critical** layer: it is where raw biometric media would first be persisted (encryption, per-candidate DEKs, retention wiring, erasure wiring — the S-076/S-077 patterns). It deserves its own story and its own privacy-engineer review when scheduled, not absorption into a fusion story's STOP 1.

### 2.4 What the Observer path deliberately excludes

39 of E-004's 57 pts serve other surfaces and are **not** S-049b prerequisites: S-022 client-side signal collection (8), S-023a/b/c active deepfake & liveness tests (12), S-024 challenge system (8), S-026 interactive probing (5), S-030 signal quarantine (3), S-035 rPPG (3, E-005 nice-to-have). If Sumanth rules the *full* E-004/E-005 in scope for launch, that is a decision about the AI-led interviews' anti-cheat depth — a separate product bet from the Observer — and it should be made knowing it is 94 pts with E-003, not 80.

---

## 3. Deferral Cost / Risk — Shipping January Without E-004/E-005

**Verdict: deferral is safe, fully reversible, and the privacy-optimal order. Its cost is differentiation, not exposure.**

### 3.1 Compliance exposure: none created by deferring

- **No biometric processing occurs.** The worker subscribes to tracks but consumes, records, and analyzes no media data (§2.3) — nothing is persisted, nothing is measured, no biometric template or feature is derived. There is no processed collection to breach BIPA/GDPR duties — the consent gate (default-deny, S-046) and consent records exist, but no biometric processing follows from them today. Deferral does not accumulate a compliance backlog.
- **The risky order is the reverse.** Building the capture substrate *before* the analysis exists would mean storing raw candidate audio/video with no consumer — new retention, erasure, and breach-surface obligations (the S-076/S-077 lesson set) purchased for zero product value. Capture and analysis should land together, or analysis-design first.
- **One honesty watch-item (not a blocker):** candidate-facing copy must not promise analysis that doesn't run. The S-048 disclosure copy was privacy-engineer reviewed, and S-039 renders `missing` sections as "Insufficient data / N/A" by defined behaviour. The related open item is #777 (policy page promising the unbuilt calibration baseline) — pre-launch track, already filed. Keep observer "analysis" language in marketing/policy copy aligned with what ships; that is a copy review, not engineering.

### 3.2 Product cost: real, bounded, and honestly displayed

- Recruiters get the side-by-side report (S-039) with a human column and an Observer column that says "Insufficient data" — the E-008 *presence* story (toggle, consent, disclosure, report shell) is complete; the *insight* story is absent.
- The Observer's differentiation (behavioral observations, integrity events for human review) is the main casualty. Against that: the human interviewer remains the primary channel by design, and no report anywhere presents a fabricated substitute.
- **No catch-up debt.** Because nothing is captured or stored today, there is no historical corpus a later pipeline "should have" processed, and no migration owed. The day S-049b lands, every subsequent session populates. Deferral is a pure postponement, not a compounding one.

### 3.3 What deferral does NOT decide

Deferring the Observer path does not defer the AI-led surfaces' anti-cheat questions (S-022–S-026 etc.) — those were never launch-blocking for the human-interview module and belong to their own module sequencing, like Applications after Interviews (Sumanth's 2026-10-12 module-order ruling).

---

## 4. Projection Contract — What S-039 Builds Against Now

Normative for S-039's read contract. Source shape: E-008 spec §4.3 (frozen) + S-049a's shipped writer behaviour.

1. **Branch only on `state`.** For each section of `analysis` (`vocal`, `visual`, `conversation`) and for `integrity_summary`, the renderer switches on the section's `state` field: `present | missing | declined`. `missing` ⇒ render "Insufficient data / N/A". No other field may be read before `state` is checked.
2. **States are resolved at read time, not read off the row.** Rows exist **only** for granted sessions and always carry `consent_state='granted'` (spec §4.3 write rule). Declined/withdrawn/unknown sessions have **no row** — the renderer derives their state from consent via `lib/observerReportStates.js`. No-row is a normal case with defined UI (S-039 AC-3), never an error state.
3. **Metric fields are optional, never defaulted.** When `state != 'present'`, metric fields (e.g. `speech_rate_wpm`, `gaze_away_events`) may be absent entirely — the S-049a skeleton writes state only for biometric sections. The renderer must treat absent as "Insufficient data"; it must **never** coerce absent to `0` (a rendered `0 gaze-away events` is a fabricated measurement).
4. **`version` tolerance.** `integrity_summary` carries a `version` field (the shipped skeleton writes `version: 1`). Consumers must tolerate an absent or older `version`, and must render an **unknown** version as `missing` rather than guessing its shape. Populated shapes arrive under a bumped version in S-049b; `version: 1` rows are never migrated.
5. **Events are listed, never scored.** When `integrity_summary.state = 'present'`, `events[]` entries are `{event_type, severity, count, confidence, review_status}` (spec §4.3). The renderer lists them individually in observational language. There is **no aggregate integrity score** to render, and none may be computed client-side from counts/confidences. The stored `total_events`/`critical_count`/`warning_count`/`info_count` are derived conveniences — if they disagree with the `events` array, the array wins.
6. **The summary is a projection; render nothing that pretends otherwise.** `integrity_summary` is regenerable from a future `integrity_events` table (S-029) and is not a store of record. The renderer must not persist recruiter judgments keyed to the summary's shape — `review_status` transitions belong to the future events table's contract, not to edits of this JSONB.
7. **`conversation` section:** carries `state` like every section; `transcript_available` absent/false ⇒ no transcript affordance is rendered. (No observer transcript exists today; see §2.3.)

**What this guarantees:** when S-049b lands populated sections (new `version`, same `state` vocabulary, same section keys), S-039's renderer requires no structural change — only the `present` branches it already wrote against this contract begin to receive data.

---

## 5. What Changes for Gate A

1. **The decision is mispriced as presented.** "E-004/E-005 in or out at ~80 pts" is really three separable decisions: (a) the **Observer path ≈ 40–48 pts** (58 fully loaded) — the only one that unblocks S-049b; (b) the **AI-surface anti-cheat remainder ≈ 39 pts** — a different product bet; (c) **E-003 calibration (14)** — partially prerequisite to (a) at the 3-pt S-021 slice, and independently owed on the policy page's promise (#777).
2. **Every Observer estimate must carry the substrate.** 8–13 pts of capture/persistence work exists in no filed story. Lead should create it as its own story (privacy-engineer review mandatory) if the Observer path is ruled in — created by Lead, not this spike.
3. **The reusability story is closed.** No Gate A option gets cheaper by "reusing the analysis services" — there are none (§1). The provider/transcription/vision plumbing saves integration effort inside the substrate estimate and is already reflected in its range.
4. **Deferral needs no mitigation plan.** No compliance exposure, no data catch-up, no UI debt beyond S-039's already-defined honest rendering. If Sumanth rules the Observer path out for launch, the only follow-up is copy alignment (§3.1) on the pre-launch track.

---

## Appendix — Scout Verification (summary)

Verified with file:line evidence against `dev` @ `6c26ec63`: `interview-ai.js` exports/callers (§1.1); screening/observer-Q&A reuse VERIFIED, legacy-mock reuse CONTRADICTED (§1.2); zero `integrity_events` migration across ~150 migration files, `qualityWeighted` zero hits, `fusion`/`multimodal` hits all substring false positives, comments, or model names — no fusion engine exists; worker subscribe-without-consumption state and the Track B voice agent's separate transcript capture (§2.3); `lib/transcription.js` is a hallucination filter, ASR lives in `lib/ai-provider.js` + `lib/self-hosted-audio.js`; vision analysis in `lib/polsia-ai.js`/`lib/qp-ai.js` over `lib/r2FrameStore.js` encrypted frames; VAD exists only in `agents/voice-interviewer/worker.mjs`; read surface = `GET …/observer/status` metadata only (`routes/interview-sessions.js:1177`, query :1192-1194 — `analysis`/`integrity_summary` never selected), zero content endpoints for `ai_observer_reports`, zero frontend consumers of either observer report/status API; erasure deletes both observer tables (`lib/erasureService.js:265, 272`); retention purge present (`services/euComplianceService.js:811, 817`).

*— Rex, Solution Architect. Specialist: Scout (dispatched per the plan's specialist table — the spike's value is evidence, and every load-bearing claim above is code-verified rather than asserted).*