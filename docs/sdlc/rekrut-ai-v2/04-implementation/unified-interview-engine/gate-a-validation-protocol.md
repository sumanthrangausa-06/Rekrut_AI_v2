# Gate A — Dormant Capture: Validation Protocol

| Field | Value |
|---|---|
| Author | Quinn — Quality persona (Phase 6, smart-sdlc `6-quality`) |
| Date | 2026-10-13 |
| Status | **PROTOCOL ONLY — for Sumanth's approval at the design gate. No code written, no build exists to validate yet.** |
| Subject | Dormant audio-only capture system + speech-pattern slice, funded by Sprint 11 under Gate A = B AMENDED (Sumanth, 2026-10-13, ruling on issue #634) |
| Depends on | Rex's capture design (in parallel). §9 lists the seams this protocol *requires* from that design. If a seam is absent, the corresponding protocol element is **Blocked**, not waived. |
| Sign-off owner | Quinn signs *validation* (§6). Quinn does not sign activation — activation is the re-entry contract + Sumanth (§6.3). |

**Skills applied (read before writing, per SKILL_MAP.md):**

| Skill / specialist | What it changed in this protocol |
|---|---|
| `smart-sdlc/6-quality/test-plan` + `test-execution` + `qa-signoff` | Overall skeleton: every requirement maps to a numbered test case with priority; entry/exit criteria are checklists, not prose; the execution artefact (§3.5, §6) follows the test-execution report shape (build, environment, per-case status, evidence link); sign-off is a named-role table with an unambiguous APPROVED / NOT APPROVED decision. |
| `ecc/silent-failure-hunter` | Hunt targets "dangerous fallbacks" and "swallowed errors" became §4/§5's anti-fabrication suite: a fallback that returns a plausible number *is* the defect class under test, so the protocol includes a static fallback scan, an empty-transcript canary, and a schema rule that a bare number with no status/provenance is invalid output. |
| `ecc/pr-test-analyzer` | "Meaningful assertions over no-throw checks": dormancy tests assert on **counter values** (exactly 0), not on "worker started without crashing"; accuracy tests assert numeric error against ground truth, not "returned something". Coverage gaps are rated — safety gaps are Critical and block exit. |
| `ecc/e2e-runner` | Artefact discipline + flaky-test handling: every run produces a retained evidence bundle (§3.5); a P1 dormancy test may **never** be quarantined as flaky — a flaky dormancy result is a failed dormancy result (§6.2). |
| `agency-agents/privacy-engineer` | "Consent enforced in code, not recorded"; "you can't protect data you haven't found"; "delete must mean deleted, everywhere, provably." Changed dormancy scope: assertions cover logs, caches, queues, temp files and in-memory buffers — not just the database — and consent revocation (§7, FI-6) requires a *purge attestation*, not a flag flip. |
| `agency-agents/voice-ai-integration-engineer` | Audio-input discipline: validate format/sample-rate/channels before any model sees audio; transcription confidence ≠ accuracy; long-audio chunk overflow corrupts silently. Changed the corpus spec (§4): canonical 16 kHz mono form, per-file format/corruption verification, timestamps preserved end-to-end, and ground truth taken from the *assembly timeline*, never from a model's self-report. |
| `claude-skills/chaos-engineering` | Failure injection (§7) is written as experiments — steady state, hypothesis, bounded blast radius (test environments only), abort criteria — not as a loose list of "try breaking it". |
| `claude-skills/feature-flags-architect` | The capture flag is classified as an **operational / kill-switch flag**, not a release flag: it needs a documented kill path independent of a deploy, a stale-value rule, and a lifecycle owner. That produced FI-1/FI-2/FI-7 and requirement R-Q2/R-Q11. |
| `claude-skills/observability-designer` | Dormancy is proven from metrics + structured logs (golden-signal counters with a defined schema), which is what makes §3's evidence pack machine-checkable instead of a screenshot of someone looking at code. |
| `superpowers/verification-before-completion` | The protocol's founding rule: **evidence before assertions.** No claim in this programme — above all "nothing was collected" — is accepted from inspection, intention, or code reading. Only from a produced artefact. |

---

## 1. Plain-words summary

In January the Observer ships **presence-only**: it can be in the room, it does not analyse anybody. Separately, Sprint 11 builds an audio-capture system that ships **switched off** — and "switched off" has to be *proven*, not believed. This protocol is how we prove three things, in order of importance:

1. **While the capture flag is OFF, nothing is collected.** Not "the code looks like it doesn't collect" — automated tests run a real (synthetic) interview through the system and produce a signed evidence pack showing zero subscriptions, zero audio frames, zero buffers, zero storage writes, and zero database rows. If any counter is not zero, dormancy has failed, full stop.
2. **When the speech-pattern measurements are exercised — on synthetic voices only — they are accurate, repeatable, and honest about uncertainty.** Each measurement (speaking rate, pauses, filler words, silence, turn length) is scored against recordings whose true values we know *because we built them that way*. A measurement that cannot meet its tolerance does not ship weakened — it ships **absent** (rendered `missing`).
3. **The system can never invent a number.** Silence, corrupt audio, an empty transcript, a failed storage write — every ambiguous case resolves the same way: no collection, no measurement, status `missing` with a reason. There is a dedicated test suite whose only job is to try to trick the system into fabricating a plausible-looking score, including the legacy failure mode this codebase already knows (fallback / word-count-derived scores in the legacy speech analysis in `lib/polsia-ai.js`). Any fabricated value, anywhere, is an automatic protocol failure.

Nothing in this protocol ever touches a real candidate's voice. All validation media is synthetic (§4). Activation for even the design-partner cohort is a separate, dated decision governed by the re-entry contract (counsel + design cleared by **2026-11-01**; after **2026-12-01**, nothing activates pre-launch) — passing this protocol is a *necessary* input to that decision, never a substitute for it.

**Two kinds of failure, two different consequences** (this distinction runs through the whole document):

- **Safety properties** — dormancy, fail-closed behaviour, no fabrication, consent enforcement — are **all-or-nothing**. One failure blocks the entire slice.
- **Accuracy properties** — how close a measurement lands to ground truth — are **per-measurement**. One failure shrinks the slice: that measurement stays disabled/`missing`, the rest may still validate.

---

## 2. Scope, definitions, and frozen conventions

### 2.1 In scope
- The dormant capture path: in-process LiveKit worker, capture flag, subscription/buffer/storage behaviour in both flag states.
- The speech-pattern measurement pipeline, exercised **only** against the synthetic corpus (§4) and the mock SFU harness (§3.3).
- Failure injection on the capture path (§7) and regression of the existing observer/consent/erasure families (§8).

### 2.2 Out of scope
- Presence-only Observer behaviour itself (already shipped/validated under S-046/S-070 lineage: `lib/observerConsentGate.js`, `lib/observerJobs.js`, `lib/observerReportWriter.js`) — except as regression scope (§8).
- Any video, body-language, facial, or emotion measurement. **Out of the programme** until a validation path exists (Gate A ruling); if any such output appears in the build under test, that is a scope violation and an automatic fail.
- Voice stress / deception. Not in this slice. If any stress output appears, §5.5 applies: deception framing is an automatic fail, and even a "stress meter" has no validation path in this protocol — it would need its own protocol and its own gate.
- Real-candidate media, production data, and the real Neon database from this VM (§8.2).

### 2.3 Result schema — the contract every measurement must return
No measurement may return a bare number. Every result is an object:

```
{ status: 'measured' | 'degraded' | 'missing',
  value: number | null,            // null iff status = 'missing'
  unit: string,                    // e.g. 'wpm', 'ratio', 'ms', 'count_per_100_words'
  uncertainty: number | null,      // ± half-width, same unit as value; required unless missing
  quality_flags: string[],         // e.g. LOW_SNR, NO_SPEECH, CODEC_DEGRADED, GAP_IN_CAPTURE
  reason: string | null,           // required iff missing: NO_SPEECH | CORRUPT_AUDIO | INSUFFICIENT_SPEECH | STORAGE_ERROR | CONSENT_NOT_ACTIVE | CAPTURE_INCOMPLETE …
  provenance: { engine_version, config_hash, corpus_or_session_ref, computed_at } }
```

Schema violations (numeric `value` with `status:'missing'`; `measured` with no `uncertainty`; any result with no `provenance`) are test failures, not style issues.

### 2.4 Frozen measurement conventions (to be confirmed verbatim in Rex's design — R-Q7)
- **Pause:** a silence interval ≥ **250 ms** within a speaker's turn. Shorter gaps are articulation gaps, not pauses.
- **Speaking rate:** words ÷ total turn time (minutes), reported alongside **articulation rate** (words ÷ phonation time, pauses excluded) if Rex's design includes it; each is validated separately against its own ground truth.
- **Filler rate:** filler tokens ÷ total words × 100, with the filler lexicon frozen in the corpus manifest (v1: *um, uh, er, erm, like, you know, actually, basically, literally, right* — only tokens scripted as fillers count; the same word used semantically is a known-hard case and is scored in its own corpus subset, §4.4).
- **Silence ratio:** silence duration ÷ total session/turn duration, from the waveform/VAD timeline (not from transcript gaps).
- **Turn / monologue length:** a turn is one speaker's continuous speech bounded by another speaker's speech or a ≥ 2 s silence; monologue length = longest single turn duration.
- **Audio canonical form:** 16 kHz, mono, 16-bit PCM for measurement (per voice-AI pipeline discipline); any resampling/downmix step is part of the system under test and its effect is inside the measured error, not excused by it.

---

## 3. Dormancy proof protocol

**Claim under test:** with the capture flag OFF, the capture system collects nothing — across a full synthetic interview lifecycle, an idle room, a worker restart, and a flag-config error. Dormancy is a property of *behaviour*, proven by counters, logs, and store diffs. Code inspection may explain a failure; it may never substitute for a passing run.

### 3.1 Assertions — all must be exactly zero (flag OFF)

| ID | Assertion | Observed via |
|---|---|---|
| D-1 | LiveKit `subscribe` calls for any audio track = **0**; track-subscription events = **0** | Mock SFU harness counters (§3.3) at integration level; instrumented LiveKit client wrapper counters at live level |
| D-2 | Audio frames received = **0**; audio payload bytes received = **0** (signalling/control-plane traffic is enumerated separately and is the *only* permitted non-zero traffic) | Frame-callback counter in the capture worker (R-Q3) |
| D-3 | Capture buffer allocations = **0**; frames buffered = **0**; temp/spill files created in the capture workdir = **0** | Buffer-factory counter (R-Q4) + filesystem diff of the workdir |
| D-4 | Storage writes attributable to the capture module = **0** (no PUT/POST/multipart init to R2/B2 or any bucket) | Countable storage-adapter seam (R-Q5): call log; at live level, bucket listing diff on a dedicated test prefix |
| D-5 | Rows inserted/updated in every capture-owned table = **0**; rows in measurement tables = **0** | Before/after row-count snapshot over the capture table registry (R-Q6). Registry must be exhaustive — an unregistered table is itself a finding |
| D-6 | ASR invocations = **0**; measurement-pipeline invocations = **0** | Pipeline entry counter (R-Q3) |
| D-7 | No transcript text, audio bytes, or frame metadata in application logs | Structured-log scan over the run's log bundle for payload fields (schema has no such field — R-Q3) |
| D-8 | No capture jobs enqueued; no capture-related queue messages published | Job/queue counter at the `observerJobs` seam |
| D-9 | Presence-only Observer behaviour is *unchanged*: observer may join per the existing consent gate (`biometric_collection === true` still required), attendance/audit record still written. Dormancy constrains **capture**, not presence | Existing observer suites (§8) + live-room observation |

### 3.2 Levels

| Level | Environment | Cases | Evidence rung (§8.2) |
|---|---|---|---|
| **Unit** | This VM, mocked LiveKit client, in-memory stores | Flag OFF / flag absent / flag malformed (`null`, `"true"`, `1`, stale object) → worker init, session-offered, track-published events: D-1…D-8 all zero. Malformed = OFF (same default-deny semantics as `observerConsentGate`) | Rung 1 |
| **Integration** | This VM, in-process worker + mock SFU harness (§3.3) publishing synthetic tracks | Full session lifecycle (join → synthetic speech → silence → leave), 30-min compressed session, idle room 10 min, worker restart mid-session (flag OFF throughout): D-1…D-9 | Rung 1 |
| **Live test room** | Staging, real LiveKit, synthetic publisher bot streaming corpus files, dedicated test storage prefix | One full-length synthetic interview + one idle room, flag OFF, on the **release-candidate build**: D-1…D-9, with bucket-listing diff and staging-DB row-count diff as independent confirmation of the counters | Rung 2 |

### 3.3 The mock SFU harness (required seam — R-Q3)
A test double for LiveKit that (a) records every `subscribe`/unsubscribe/connect call with timestamps, (b) publishes programmable synthetic tracks from corpus files, (c) counts frames/bytes it *would* deliver to a subscriber, so "the SFU offered audio and the worker took none of it" is itself asserted (offered > 0, received = 0), and (d) can flip flags, drop frames, and inject corrupt frames on cue for §7. Without (c), a zero could mean "nothing was ever offered" — a vacuous pass, which `pr-test-analyzer` discipline forbids.

### 3.4 Run discipline
- Dormancy suite runs on **every release-candidate build**, not once during development.
- Exit requires **3 consecutive passing runs** at integration level and **1 passing run** at live-test-room level on the same build SHA.
- No quarantine: a flaky or intermittent non-zero counter is a **fail**, investigated as a defect (intermittent collection is worse than consistent collection — it means the gate is racy).

### 3.5 Evidence artefact — the Dormancy Evidence Pack
A passed protocol produces one artefact bundle per release candidate, retained with the SDLC quality docs:

```
dormancy-evidence-<buildSHA>-<YYYYMMDD>/
  manifest.json        — build SHA, flag-config snapshot (value + source), corpus & harness versions,
                         environment, run IDs, timestamps, tester identity
  counters.json        — every D-1…D-9 counter, expected 0, observed value, per level
  sfu-offered.json     — frames/bytes OFFERED by the harness/SFU (proves the zeros are non-vacuous)
  db-diff.json         — before/after row counts for every table in the capture registry
  storage-diff.json    — before/after listing of the test storage prefix
  logs.jsonl           — structured dormancy log lines (schema per R-Q3), hash-chained to manifest
  summary.md           — human-readable one-pager: claim, build, result per assertion, Quinn's verdict
  SHA256SUMS           — integrity hashes for every file above
```

`summary.md` is the page that can be shown to Sumanth — or, later, to a regulator or a design partner's counsel — to support the sentence "while dormant, the system collected nothing," with `counters.json` + `sfu-offered.json` behind it as the machine-checkable proof. **No evidence pack, no dormancy claim.**

---

## 4. Synthetic corpus design

The measurements can only be validated against media whose true values are **known by construction**. Real speech — even consented test speech — never qualifies: its true pause durations and filler counts would have to be measured by the very class of tool being validated. The corpus is therefore manufactured, and its ground truth is the *manufacturing record*, independently audited.

### 4.1 Generation pipeline
1. **Script manifest (JSON, versioned).** Each item begins as a script: ordered segments with speaker, exact text, scripted filler tokens, and assembly instructions (pause-after durations to the millisecond, silence blocks, noise overlay, codec pass).
2. **Voice rendering.** Segments are rendered with synthetic TTS voices (see diversity matrix, §4.3). At least **two independent TTS engines** are used, so the pipeline cannot overfit to one engine's artefacts. $0 constraint: local/open engines only; any engine whose licence forbids this use is excluded (Lex to confirm — Q-4).
3. **Programmatic assembly.** Rendered segments are concatenated sample-accurately per the manifest: pauses and silence blocks are *inserted by the assembler*, not performed by the voice, so their durations are exact. Noise overlays (room tone, HVAC, keyboard, street, far-end crosstalk) are mixed at a **measured** SNR, computed from the actual waveforms, not the nominal mix gain.
4. **Ground-truth extraction.** Ground truth is computed from the assembly timeline + script (word counts, filler token counts, segment boundaries), then stored in `ground-truth.json` per item. It is never derived from running an ASR/VAD over the finished file.
5. **Independent audit.** A 10% random sample per corpus version is verified by forced alignment + human listening check: scripted fillers must be audibly present, inserted pauses within ±20 ms of manifest, no rendering dropouts. Any item failing audit is **quarantined** (excluded and listed), never silently corrected — a corrected item is a new item in a new corpus version.

### 4.2 Why ground truth is knowable, per property

| Property | Source of truth | Why it is trustworthy |
|---|---|---|
| Speaking / articulation rate | Script word count (exact) ÷ timeline speech durations (sample-accurate) | Both numerator and denominator are construction parameters |
| Pause distribution | Assembler's inserted-silence log (onset, duration per pause) | Pauses are inserted digitally, not performed |
| Filler rate | Scripted filler token positions/counts, audit-verified as audible | Tokens are scripted segments, counted before rendering |
| Silence ratio | Timeline arithmetic: total silence ÷ total duration | Pure bookkeeping over the assembly record |
| Turn / monologue length | Segment speaker map + boundaries in the manifest | Turns are assembled, diarization ground truth is the map |
| Degradation level | Measured SNR / codec log from the mixer | Computed from the rendered waveforms themselves |

Residual risk, stated honestly: TTS rendering can slur or swallow a scripted filler. That is exactly what the §4.1(5) audit exists to catch; unaudited items carry that risk and the audit rate is part of the corpus version record.

### 4.3 Diversity matrix (minimums for v1.0)
- **Voices:** ≥ 8 synthetic voices across ≥ 2 engines; accent presentation: US, UK, Indian English, plus ≥ 2 others; age presentation: younger / middle / older; gender presentation: balanced; baseline rates: slow / conversational / fast talkers.
- **Content shapes:** short answers (10–30 s), standard answers (45–90 s), long monologues (3–5 min), two-speaker exchanges (turn-taking), one dominant speaker + brief interjections.
- **Channels:** clean studio-like; laptop-mic simulation (band-limit + room reverb); mobile/codec pass (Opus at typical LiveKit bitrates); each degraded variant is a separate corpus item with its own ground truth (identical timeline, degraded rendering).

### 4.4 Corpus composition and size — v1.0

| Set | Items | Purpose |
|---|---|---|
| Clean core | 120 (24 scripts × 5 voice/condition combos) | Primary accuracy scoring (§5) |
| Degraded | 80 (SNR ladder 20 / 10 / 0 dB; reverb; codec; combinations) | Degradation behaviour (§5.4) — uncertainty must widen or status → `missing` |
| Long-form | 20 (3–5 min, incl. 2-speaker) | Turn/monologue validation; chunk-boundary integrity |
| Semantic-filler hard set | 20 | Words from the filler lexicon used *semantically* ("I **like** that", "**right** after the bridge") — ground truth filler count excludes them; tests lexicon naïveté |
| Anti-fabrication set | 40 (§5.5) | Silence, noise-only, tones, music-only, reversed audio, corrupt/truncated files, zero-byte, empty-transcript canaries |
| **Total** | **280 items** | Each 10 s – 5 min; total audio ≈ 4–5 hours |

### 4.5 Versioning and integrity
- Corpus is **immutable once versioned**: `corpus-vMAJOR.MINOR`, manifest with SHA-256 per file, generator + engine versions, seeds, audit report, quarantine list.
- Any change — a fixed item, a new voice, a lexicon change — is a **new version**. All validation results cite the corpus version; results across versions are never averaged together.
- The corpus contains no real person's voice and no real interview content; scripts are written for this purpose (no scraped transcripts).

---

## 5. Per-measurement validation criteria

### 5.1 Criteria template (applies to every measurement Rex's design adds)
For each measurement, the design must instantiate this template *before* scoring begins — tolerances are fixed in advance, never fitted to results:

1. **Definition & unit** (per §2.4 conventions).
2. **Ground-truth source** (per §4.2).
3. **Accuracy gate (clean set):** percentile-based error bound — e.g. "≥ 95% of items within tolerance T; median error ≤ T/2; **no** item in error by > 3×T unless its status is `degraded`/`missing`".
4. **Accuracy gate (degraded set):** looser bound **or** `missing` — see §5.4; silent precision is a fail.
5. **Repeatability:** §5.3.
6. **Degradation behaviour:** §5.4.
7. **Fabrication exposure:** which §5.5 cases target this measurement and their required outcome.
8. **Fairness slice:** accuracy reported **per voice group** (accent / age / gender presentation). A measurement that passes in aggregate but fails a group by > 2× the aggregate error is **not validated** — it is validated for no one until the disparity is explained and either fixed or the measurement stays disabled. Aggregate-only reporting is a test-plan defect.

### 5.2 Worked examples (v1 tolerances — Quinn's numbers, Rex to confirm feasibility at design review; changing one after scoring starts requires a new corpus run)

| Measurement | Clean-set gate | Degraded-set gate | Notes |
|---|---|---|---|
| **Speaking rate (WPM)** | ≥ 95% of items within **± max(8%, 8 WPM)**; median abs. error ≤ 4% | ≥ 90% within ±15% **or** `missing`; monotonic uncertainty (§5.4) | Error budget must be split in reporting: waveform/timing error vs ASR word-count error. If the ASR is the dominant error source, that is stated, not hidden |
| **Pause distribution** | Pause count exact or ±1 on ≥ 95%; per-pause onset error median ≤ **150 ms**, p90 ≤ 300 ms; total pause time within ±10%; mean pause duration within ±15% | Count within ±2 or `missing` on ≥ 90% | Scored only on pauses ≥ 250 ms (§2.4). Boundary precision is what downstream consumers feel — hence onset, not just count |
| **Filler rate** | Filler **count** exact on ≥ 90%, within ±1 on ≥ 98%; resulting rate within ±0.5 pp or ±10% relative (greater of) | Count within ±2 or `missing` on ≥ 90% | Semantic-filler hard set (§4.4) scored separately: false-positive rate ≤ 5% of semantic tokens. A naive substring counter fails this set by construction — that is the point |
| **Silence ratio** | Within **±3 percentage points** on ≥ 95% | Within ±5 pp or `missing` on ≥ 90% | Waveform-derived; the one measurement whose truth survives heavy noise longest — its degradation curve is the reference for §5.4 monotonicity checks on the others |
| **Turn / monologue length** | Turn count exact on ≥ 95% (2-speaker items); turn boundary median error ≤ **500 ms**; longest-monologue duration within ±10% or ±1 s (greater of) | Boundary ≤ 1 s or `missing` on ≥ 90% | Includes the long-form set; a chunk-boundary split that manufactures a false turn is an error, not an artefact to excuse (voice-pipeline overflow discipline) |

*Voice stress is deliberately absent from this table. It has no row because it has no validation path here — see §2.2 and §5.5(3).*

### 5.3 Repeatability
- Every clean-set item is processed **3 times** on the same build/config. Deterministic stages must be bit-identical; end-to-end results must agree within **ε**: WPM ±1; pause onsets ±50 ms; filler count ±0; silence ratio ±0.5 pp; turn boundaries ±100 ms.
- Each run records `engine_version` + `config_hash` (§2.3 provenance). A result that changes when only an unrelated config field changes is a repeatability failure and a design smell (hidden coupling) — reported as a defect, not averaged away.
- Run-to-run variance is **reported per measurement** in the validation report; it feeds the `uncertainty` value the system must later show users. Uncertainty invented at display time, rather than measured here, is fabrication by another name.

### 5.4 Degradation behaviour — the honesty gradient
Using the SNR ladder (clean → 20 → 10 → 0 dB) and codec/reverb variants, for every measurement:
1. **Monotonicity:** as input quality falls, reported `uncertainty` must **widen or hold**, and accuracy must worsen or hold. An item whose uncertainty *narrows* on worse audio fails.
2. **No silent precision:** below the quality floor defined per measurement, status must become `degraded` (with widened uncertainty) and then `missing` — never continue emitting clean-grade numbers. The floor is found empirically on the ladder and then frozen as an input-quality gate (SNR/quality estimator threshold) in the design.
3. **Quality estimator honesty:** if the design ships an input-quality estimator, its own accuracy is validated on the ladder (estimated vs measured SNR within ±5 dB on ≥ 90%), because every degradation decision depends on it.

### 5.5 Anti-fabrication suite — automatic-fail tests (safety class)
Any single failure in this section fails the **whole protocol**, not just one measurement:

1. **AF-1 Silence:** 60 s digital silence and 60 s room-tone-only → speaking rate, filler rate, pause distribution, turn length all `missing` with reason `NO_SPEECH`. Silence ratio may report only its true measured value (≈ 1.0 / the room-tone truth) accompanied by `NO_SPEECH` quality flag — an intermediate "plausible" value (e.g. 0.23) is fabrication and fails.
2. **AF-2 Corrupt audio:** zero-byte file, truncated header, byte-flipped payload, wrong-codec bytes, mid-file truncation at random offsets (fuzz, ≥ 50 mutations) → **all** measurements `missing` (`CORRUPT_AUDIO`); no crash, no partial numeric output, no unhandled exception escaping the pipeline.
3. **AF-3 Non-speech sound:** white/pink noise, sine sweep, music-only, keyboard-only → all speech measurements `missing` (`NO_SPEECH`); none may return a value inside the plausible human range.
4. **AF-4 Empty-transcript canary:** ASR stubbed to return an empty/whitespace transcript over real (synthetic) speech audio → transcript-derived measurements (WPM, filler) `missing`. This is the direct regression test for the legacy pattern: a word-count/fallback path must never rescue an empty transcript into a number.
5. **AF-5 Static fallback scan:** the new capture/measurement modules are scanned for fallback-to-constant patterns (`|| <number>`, `?? <number>`, catch-blocks returning numeric results, default-score constants). Every hit must be individually justified in writing at design review or removed. An unjustified hit blocks exit. (Per `silent-failure-hunter`: the fallback *is* the bug class.)
6. **AF-6 Schema gate:** fuzz the result boundary — any emitted result violating §2.3 (bare number, `measured` without uncertainty, numeric value with `missing`) fails.
7. **COPY-1 Language scan:** all report/UI strings introduced by this slice are scanned for deception and certainty language: *deception, deceptive, lying, dishonest, truthful, untruthful, "stress indicates", guilt, evasion* and equivalents. **Any deception framing of a voice measurement is an automatic fail** — of the copy, and of the sign-off, until removed. Approved framing, if a stress-adjacent measure is ever separately gated in future: a *meter*, value + uncertainty shown, no interpretation attached. It is not part of this slice.

---

## 6. Entry / exit criteria

### 6.1 Entry — protocol execution may begin only when all are true
- [ ] Rex's capture design **approved by Sumanth** at the design gate, including written answers to every R-Q item in §9 (a seam answered "later" = entry blocked for the elements that need it).
- [ ] Measurement list and definitions frozen (§2.4 instantiated per measurement); tolerances (§5.2 template) fixed **before** any scoring run.
- [ ] Synthetic corpus **v1.0 built, audited, and frozen** (§4.5), with quarantine list published.
- [ ] Mock SFU harness + countable storage/DB seams implemented in the test environment; dormancy counters (§3.1) demonstrably readable.
- [ ] Anti-fabrication suite (AF-1…AF-6, COPY-1) written and **red** against a deliberately fabricating stub — i.e. the suite is first proven capable of failing. A test suite that has never been seen to fail proves nothing.
- [ ] Regression baseline recorded: §8 suites run on the pre-slice build, results stored (counts re-baselined here — never carried from memory).

### 6.2 Exit — the measurable definition of "validated"
The speech-pattern slice is **validated** iff, on a single release-candidate build, all of the following hold:

1. **Dormancy:** §3 passes in full — 3 consecutive integration runs + 1 live-test-room run, every D-counter exactly 0 with non-vacuous SFU-offered evidence — and a complete **Dormancy Evidence Pack** (§3.5) exists for that build.
2. **Safety suite:** 100% pass on AF-1…AF-6, COPY-1, and every §7 failure-injection case, with fail-closed outcomes as specified. No exceptions, no accepted-risk waivers on this line.
3. **Per-measurement accuracy:** each measurement *individually* meets its §5.2 gates on corpus v1.0 (clean + degraded), its §5.3 repeatability ε, its §5.4 monotonicity checks, and its §5.1(8) per-voice-group fairness bound.
4. **Regression:** §8 suites green with no new failures against the §6.1 baseline.
5. **Reporting:** a validation report (per `test-execution` format: build, environment, corpus version, per-case status, evidence links) is filed with the quality docs, including per-measurement variance and the fairness breakdown — not just pass/fail.

### 6.3 What partial results mean — and who signs what
- A measurement failing §6.2(3) is **not validated** and ships **disabled**: in any future activated state it renders `missing` (reason `NOT_VALIDATED`) or is absent entirely. The slice ships **smaller, never weaker**. There is no "validated with reservations" state.
- A failure in §6.2(1), (2), or (4) means **the slice is not validated at all** — safety and regression are bundle-level properties; there is no partial dormancy.
- **Quinn signs** the validation report: per-measurement verdicts (Validated / Not validated) + the bundle verdict on dormancy/safety/regression, following the `qa-signoff` form (decision unambiguous, exceptions — accuracy only — listed by name).
- **Quinn's signature does not activate anything.** Activation additionally requires the re-entry contract: counsel determination (#788 / S-086 lineage) + design cleared by **2026-11-01**, and Sumanth's explicit decision. After **2026-12-01** the question does not arise pre-launch regardless of validation state. Validation evidence is an *input* to that decision, presented by Lead/Suga — this protocol takes no position on counsel's timeline.

---

## 7. Failure injection (chaos-format: steady state → fault → required behaviour → abort)

Discipline per `chaos-engineering`: every experiment states its steady state and hypothesis up front, runs **only** in unit/integration/live-test-room environments (never production, never a real interview), has a bounded blast radius (the test session only), and has an abort condition (any collection outside the specified post-fault behaviour → stop the run, treat as protocol failure, investigate before resuming). **Universal rule: ambiguity ⇒ no collection, no measurement.** Where this section and any design convenience disagree, this section wins.

| ID | Fault injected | Steady state / hypothesis | Required behaviour (fail-closed) |
|---|---|---|---|
| FI-1 | Flag flipped OFF→ON mid-session (synthetic room, harness only) | Session running presence-only; hypothesis: capture, if it ever starts, starts *from the flip*, never retroactively | No frames from before the flip may exist anywhere (buffer/storage/measurement input). Capture additionally still requires every other gate (consent `=== true`, test-cohort scope); flag ON alone in a non-test context collects nothing. First captured frame timestamp ≥ flip timestamp, asserted from harness log |
| FI-2 | Flag flipped ON→OFF mid-capture | Capturing a synthetic session under test scope | Unsubscribe within **≤ 2 s** of the flip (bound for Rex to confirm at design review — R-Q9); in-flight buffers **purged**, with purge attested by counter + log line; the interrupted window's measurements → `missing` (`CAPTURE_INCOMPLETE`), never computed from the partial segment as if complete |
| FI-3 | Worker process killed & restarted mid-capture | Capturing under test scope | On restart, flag **and** consent are re-read before any subscribe — no resume path may bypass either gate; no pre-crash buffered audio is recovered into measurement; the gap window → `missing`/`degraded` with `GAP_IN_CAPTURE`; no interpolation across the gap |
| FI-4 | Storage write failure (adapter forced to error / bucket unavailable) | Capturing under test scope | No measurement is persisted or reported as succeeded; affected measurements → `missing` (`STORAGE_ERROR`) surfaced in the audit log — a silent drop dressed as success is an AF-class failure; retry, if any, is bounded and may not extend audio retention in memory beyond the design's stated window; worker does not crash-loop |
| FI-5 | Corrupt audio injected mid-stream (garbage frames for 5 s within valid speech) | Measuring a corpus long-form item | Corrupt segment quarantined: its window → `missing` (`CORRUPT_AUDIO`); valid windows before/after still measure correctly; corruption may not poison session-level aggregates — aggregates either exclude the window *and say so* (`quality_flags`) or go `missing` |
| FI-6 | Consent revoked mid-session (synthetic session, consent `true` → withdrawn via the real consent path) | Capturing under test scope | Strongest case in this table: unsubscribe ≤ 2 s; in-flight buffers purged (attested); no new measurements from revocation onward; audit event written via the existing consent/audit machinery; already-captured segments enter the erasure/retention path defined by the consent design (Lex's review owns the retention answer — Q-3) — the build may not invent its own retention behaviour here |
| FI-7 | Flag source unavailable / malformed at worker start and mid-session (config service down, value `null`, `"true"`, stale cached ON) | Worker starting; worker running | Unavailable/malformed/stale = **OFF** (default-deny, mirroring `observerConsentGate` semantics: only an explicit, current, boolean `true` — ANDed with consent — means anything else). A cached ON may never outlive its stated TTL; on config-service loss mid-capture, capture stops (→ FI-2 behaviour) |
| FI-8 | Duplicate / out-of-order / clock-skewed frames from the SFU | Measuring a corpus item | Deduplication by frame timestamp/sequence per the design's stated rule; if ordering cannot be established for a window, that window → `missing` rather than measured on a guess; no negative or double-counted durations in pause/turn outputs |

---

## 8. Regression + non-regression scope, and the evidence ladder

### 8.1 Must stay green (baseline per §6.1; paths verified in repo @ 2026-10-13)
- **Consent gate family:** `server/__tests__/lib/observerConsentGate.test.js`, `consentService.test.js`, `consent-audit-company.test.js`, `server/__tests__/middleware/requireBiometricConsent.test.js`, `server/__tests__/routes/consent-withdraw-observer.test.js`; migrations 244/245/250 consent tests.
- **Observer family:** `observerJobs.test.js`, `observerReportStates.test.js`, `observerReportWriter.test.js`, `aiObserverWorker.test.js`; client: `observer-report-columns.test.tsx`, `ObserverDisclosure.test.tsx`, `ConsentScreens.test.tsx`, `consent-screens-human-interview.test.tsx`, `QPBiometricConsent.test.tsx`, `WithdrawnConsentRecovery.test.tsx`, `consentErrorHandler.test.ts`.
- **Erasure / retention family:** `embeddings-erasure.test.js`, `erasure-medium-tables.test.js`, `resume-family-erasure.test.js`, `dsar-dek-destruction` (suite in `server/__tests__/lib/`), `retention-lifecycle.test.js`, `retention-audit-integration.test.js`, `biometricAudit.test.js`, `biometricCrypto.test.js`.
- **Audio/transcription neighbours:** `tests/transcription-module.test.js`, `tests/whisper-hallucination-filter.test.js`, `tests/tts-service.test.js`, `tests/compliance-audit.test.js`.
- **Full server + client suites:** no new failures vs the §6.1 baseline. (Baseline counts are recorded at entry; this protocol deliberately asserts no remembered count.)
- **Non-regression of meaning, not just tests:** presence-only January behaviour, report-state language (declined/withdrawn/unknown still collapse to the one neutral recruiter-facing sentence per the S-039 ruling), and the `observerReportStates` canonical states must be behaviourally unchanged. A green suite with changed copy is caught by COPY-1-style review of any touched report strings.

### 8.2 The evidence ladder — honest environment limitation
**This VM cannot reach the real database** (Neon pooler TLS handshake fails from here — standing, verified limitation) and must never use production data in any case. Evidence therefore comes in rungs, and every protocol element is labelled with the rung its evidence sits on:

| Rung | Environment | What it can prove | Protocol elements |
|---|---|---|---|
| **1 — Mocked/local (this VM)** | Unit + integration suites, mock SFU, in-memory DB/storage doubles, locally-run audio pipeline | Counter-level dormancy (D-1…D-9 at unit/integration), all accuracy/repeatability/degradation scoring on the corpus, all of §5.5, all of §7 | §3 unit+integration, §4 scoring, §5, §7, §8 suites |
| **2 — Staging QA** | Staging deploy (manual, on Sumanth's trigger per standing rules), real LiveKit test room, dedicated test storage prefix, staging-DB assertions via staging surfaces | Dormancy against the *real* SFU and real storage/DB plumbing; end-to-end flag behaviour on the release candidate | §3 live test room — **required for exit** (§6.2(1)) |
| **3 — Production** | — | **Not a validation rung.** Nothing is validated in production, on real candidates, ever, under this protocol. Post-launch, dormancy counters may be *re-observed* in production with the flag OFF as an operational check — that is monitoring, not evidence for activation | None |

Any report that presents Rung-1 evidence as if it were Rung-2 (e.g. "database stayed empty" when the database was a mock) is a reporting defect and voids that section of the report. Conversely, Rung 1 is not "weak" for the things it genuinely proves: the corpus accuracy numbers *are* Rung-1 numbers by design, because the corpus is synthetic by design.

---

## 9. Requirements on Rex's design (seams Quinn needs) + open questions

### 9.1 Requirements — the design is not approvable by Quinn until each is answered in writing

| ID | Requirement | Needed by |
|---|---|---|
| R-Q1 | **Single flag-read point.** One function/module reads the capture flag; every capture decision flows through it; its result (value + source + read timestamp) is emitted in structured logs. No scattered `if (process.env…)` checks | §3, FI-7 |
| R-Q2 | **Flag semantics stated:** name, scope (global / per-session / cohort allowlist), default in code (OFF; absent config = OFF), TTL/staleness rule, and a **kill path independent of deploy** (flag is an operational kill-switch-class flag, per `feature-flags-architect`) | §3, §7 |
| R-Q3 | **Instrumentation seam:** named counters for every D-assertion (subscribe calls, frames received, payload bytes, buffer allocations, storage calls, capture-table writes, ASR calls, pipeline calls, jobs enqueued) + a structured log schema with **no payload fields** (no transcript/audio/frame content, ever). Counter names frozen in the design so tests bind to them | §3.1, §3.5 |
| R-Q4 | **Buffer seam:** all capture buffering goes through one factory/component tests can count and inspect; a purge operation exists and attests (counter + log) | D-3, FI-2/FI-6 |
| R-Q5 | **Storage seam:** all capture storage writes go through one adapter whose calls are countable/mockable; no direct SDK calls from capture code | D-4, FI-4 |
| R-Q6 | **Capture table registry:** exhaustive list of every table the slice writes (capture, measurement, audit), supplied in the design; any table found in code/migrations but absent from the registry is a design defect | D-5 |
| R-Q7 | **Measurement definitions frozen** per §2.4 (pause threshold, rate definitions, filler lexicon location, turn rule, canonical audio form) + the §2.3 result schema implemented as a validated boundary (schema-invalid results cannot leave the pipeline) | §2, §5 |
| R-Q8 | **Determinism statement:** which stages are deterministic; where ASR (if any) introduces variance, its engine/version/seed-or-config is pinned and recorded in provenance | §5.3 |
| R-Q9 | **Latency bounds stated:** max unsubscribe latency after flag-off/consent-revoke (protocol assumes ≤ 2 s — confirm or counter-propose *before* build), max config-staleness window | FI-2, FI-6, FI-7 |
| R-Q10 | **Gate composition stated:** how capture flag ANDs with the existing consent gate (`biometric_collection === true` via `observerConsentGate`) and with cohort scope — capture must be *impossible* on flag alone, consent alone, or cohort alone | FI-1, FI-6 |
| R-Q11 | **No-fallback rule acknowledged in design:** error paths return status objects (§2.3), never default numerics; the design names every place a default could hide and what it does instead | §5.5 AF-5 |
| R-Q12 | **Synthetic-only enforcement:** a stated mechanism (test-cohort scoping / environment guard) by which the measurement pipeline *cannot* be pointed at a non-test session before activation — "we just won't run it" is a process promise, not a seam, and is not accepted | §1, §4 |

### 9.2 Open questions

| ID | Question | Owner |
|---|---|---|
| Q-1 | Flag scope for January: global OFF, or OFF-by-default with a design-partner cohort allowlist for the *presence* tier only? (Capture stays OFF either way pre-activation — confirm the design keeps the two concepts separate.) | Sumanth / Rex |
| Q-2 | Does the dormant capture worker share a process/room presence with the presence-only Observer in January, and if so, how is subscription isolation between "present" and "capturing" enforced and observed? | Rex |
| Q-3 | On consent revocation mid-capture (post-activation future), are already-captured segments erased immediately, sealed pending review, or retained per schedule? Protocol tests whichever Lex's review decides — it does not decide it. | Lex |
| Q-4 | TTS engine licences for corpus generation at $0 — confirmed permissible for internal validation use? | Lex / Lead |
| Q-5 | Language scope of v1 validation: English only? Corpus v1.0 is English-only as specified; any additional launch language needs its own corpus version and its own validation run — it inherits nothing from English results. | Sumanth / Aria |
| Q-6 | Where do Dormancy Evidence Packs live long-term (SDLC quality docs in-repo vs retained artefact store), and who besides Quinn countersigns the live-test-room run? | Lead / Suga |
| Q-7 | ASR choice for transcript-derived measures: whichever engine Rex selects sets the achievable WPM/filler tolerances (§5.2 error-budget split). If the selected ASR cannot meet the clean-set gate on synthetic speech, does the measurement wait for a better ASR, or is it dropped from the slice? (Protocol's default answer: dropped — §6.3.) | Rex / Sumanth |

---

*Quinn — Quality. This protocol is complete as a design-gate deliverable. It validates nothing yet: no build exists, no corpus exists, no run has occurred. Its claim is narrower and stronger — when the build arrives, this is exactly how its dormancy, honesty, and accuracy will be proven, and what "validated" will measurably mean at the 2026-11-01 decision.*
