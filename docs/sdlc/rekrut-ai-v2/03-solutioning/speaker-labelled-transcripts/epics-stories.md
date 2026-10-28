---
project: Speaker-Labelled Interview Transcripts (Diarization)
prd_version: 1.0
architecture_version: 1
created: 2026-10-28
owner: Sumanth
architect: Rex
stepsCompleted: ["step-01-analyze", "step-02-epics", "step-03-stories"]
status: draft — at Suga's review gate
---

# Speaker-Labelled Interview Transcripts — Epics & Stories Backlog

> **Status:** Draft v1 | **PRD:** v1.0 (`02-planning/speaker-labelled-transcripts/prd.md`) | **Architecture:** v1 (same phase folder)
> **Epic:** #1900 — `[EPIC] Speaker-labelled interview transcripts (diarization)` (single epic; tracks A–E are sequencing groups inside it)
> **Method:** smart-sdlc `create-epics-stories`. **Sizing:** Fibonacci points (1/2/3/5/8), 1 pt ≈ half-day for one dev. **Total: 72 pts across 17 stories** (~4 sprints at the team's ~20 pts/sprint single-implementer capacity — Lead sequences; the gate-blocked stories S-D15/S-D17 schedule by gate state, not by sprint pressure).
> **Gate legend (Lex BR-1):** 🟢 synthetic-audio only — buildable/testable now, no real recordings. 🔒 gate-blocked for *enablement* — the story's artefact lands, but real-recording use waits for G1 (vendor written confirmation) and/or G2 (Lex consent conditions). **Every story is 🟢 for build**; the flags mark what may not *run on real recordings* until the gates clear. The `DIARIZATION_ENABLED` flag stays OFF outside synthetic/test environments until S-D17.

---

## Epic #1900: Speaker-Labelled Interview Transcripts (Diarization)

**Goal:** A recruiter reading a recorded human interview sees who said what — named, timestamped speaker turns with correctable labels — while a candidate's voice is processed only under live biometric consent, with voice-print embeddings never stored, and labels never feeding any score.
**Personas:** Recruiter (primary), Human Interviewer, Candidate, Admin/Operator.
**PRD Coverage:** FR-D01…D21, HA-1…HA-3, NFR-D01…D06. **Lex Coverage:** BR-1…BR-14.
**Definition of Done (epic):**
- [ ] All 🟢 stories merged to dev with Quinn E2E evidence per story (HL-003: real HTTP, fresh-install rig, state read back)
- [ ] Journey suites JT-D1…JT-D7 pass on dev; staging re-proof at promotion
- [ ] HA-1 accuracy measured and recorded on this epic; HA-2 degradation rule applied to the result
- [ ] Erasure of a diarized recording verified end-to-end (BR-13)
- [ ] S-D17 enablement checklist complete before any production flag flip (G1 + G2 + D2 + BR-6/10/14)

### Story dependency order

```
S-D01 ─→ S-D02 ─┬─→ S-D09 ─┬─→ S-D10 ─→ S-D16
                │          └─→ S-D11        │
S-D03 ─→ S-D04 ─→ S-D05 ─→ S-D06 ─→ S-D07 ─→ S-D08 ─→ (S-D09)
                              S-D13 (after S-D03+S-D07)   S-D14 (after S-D07)
S-D12 (after S-D03)   S-D15 (parallel; enablement 🔒)   S-D17 (last; 🔒 G1+G2+D2)
```

**Rationale:** Track A (timestamped transcription) and Track B (worker) are independent until stitching (S-D07) joins them. Surfaces (S-D09+) wait for stitched data. Compliance artefacts (S-D13/S-D15) are built alongside, not bolted on. S-D06 (long-recording proof) precedes stitching because its memory/timing numbers size the worker envelope the stitch step runs in.

---

## Track A — Timestamped transcription (upstream)

### Story S-D01: Segment contract in the ASR cascade

**Epic:** #1900 | **PRD Ref:** FR-D01, NFR-D03 | **Architecture:** §3.2, ADR-D04 | **Priority:** Core | **Points:** 3 | 🟢

**User Story:** As the recordings pipeline, I need transcription results that carry segment timestamps, so a transcript can be stored as timed pieces instead of one block.

**Acceptance Criteria:**
- [ ] AC-1: Given `requireSegments: true`, when a segment-capable leg (Whisper/Groq/NIM verbose_json, Deepgram utterances) wins the cascade, then `transcribeAudio` returns `{ text, confidence, duration, segments: [{start_s, end_s, text}] }` with segments in order and their text concatenating to the full transcript text.
- [ ] AC-2: Given `requireSegments: true`, when the winning leg returns no segments (Cartesia), then the cascade continues to the next leg; if no leg yields segments, the call returns null (honest failure, as today).
- [ ] AC-3: Given no `requireSegments` flag (all existing consumers: mock, practice, screening), then behaviour is byte-for-byte today's — existing ASR tests pass unchanged.

**Technical Notes:** `lib/ai-provider.js` only; per-leg normalization at the existing `_result` unwrap boundary. No new providers, keys, or config. **Dependencies:** none. Blocks: S-D02.

### Story S-D02: Recordings handler stores timestamped segments, replace-on-re-run

**Epic:** #1900 | **PRD Ref:** FR-D01, FR-D02, FR-D03 | **Architecture:** §3.1 | **Priority:** Core | **Points:** 5 | 🟢

**User Story:** As a recruiter, when I transcribe a completed recording I get a transcript of timed segments; if I re-run transcription, the new transcript replaces the old one cleanly.

**Acceptance Criteria:**
- [ ] AC-1: Given a completed 45-minute recording, when the recruiter triggers transcription, then `GET /:id/transcript` returns multiple segments with real, ordered, bounded `start_time_ms`/`end_time_ms` jointly covering the recording, and their text in order is the full transcript (no words lost).
- [ ] AC-2: Given an already-transcribed recording, when transcription is re-run, then afterwards exactly one transcript generation exists for the recording (old segments and any diarization artefacts for it are gone — deleted in the same transaction), and no moment exists where old labels sit on new text.
- [ ] AC-3: Per-segment highlights still attach and survive reload; a purged recording's transcript still renders as absence (`[purged]` behaviour unchanged); the transcribe endpoint's response shape is unchanged for existing consumers.
- [ ] AC-4 (honest failure): Given all ASR legs fail, then the recording returns to `completed` with no transcript rows — today's failure behaviour, no partial segments left behind.

**Technical Notes:** `server/routes/recordings.js` transcribe handler; segments stored with `speaker_identity='unknown'` (composition happens at read, S-D09). Quinn E2E on the fresh-install rig with a real multi-segment ASR fixture. **Dependencies:** S-D01. Blocks: S-D07, S-D09.

---

## Track B — Diarization worker

### Story S-D03: Schema expansion + diarization job queue

**Epic:** #1900 | **PRD Ref:** FR-D04, FR-D07, OQ-3 | **Architecture:** §4, §3.3, ADR-D02/D03 | **Priority:** Core | **Points:** 5 | 🟢 (execution sequenced post-Nov-1 by Lead)

**User Story:** As the platform, I need the storage and queue shapes for labelling — added without touching what exists — so worker and surface stories can build against them.

**Acceptance Criteria:**
- [ ] AC-1: Migration (next number after 295) is **expand-only**: adds `interview_transcripts.speaker_number`, `interview_recordings.diarization_status` (+CHECK, `diarization_updated_at`), and tables `diarization_jobs`, `diarization_runs`, `recording_speaker_mappings`, `transcript_speaker_audit`, `diarization_metrics_daily` exactly as Architecture §4 — verified by fresh-DB migration run on the local rig and by the repo's schema-drift check.
- [ ] AC-2: The migration file contains no DROP/ALTER-narrowing and no embedding-shaped column anywhere (reviewer greps the diff; the absence of any voice-print storage is a schema fact, BR-4/BR-5).
- [ ] AC-3: `lib/diarizationJobs.js` mirrors `lib/observerJobs.js` semantics: enqueue (with supersede-pending), claim via `FOR UPDATE SKIP LOCKED`, heartbeat, stale-claim sweep, cancel-with-reason, attempt counting — each covered by unit tests cloned from the observer suite's shapes.
- [ ] AC-4: Pre-existing recordings/transcripts are untouched by the migration (row counts and a legacy transcript read are identical before/after on a fixture DB).

**Technical Notes:** Migration *executes* only after the Nov 1 Neon unfreeze, in promotion order (§4.4) — this story's dev-rig proof uses the local Postgres rig, not Neon. **Dependencies:** none (parallel with Track A). Blocks: S-D04, S-D12, S-D13.

### Story S-D04: Worker skeleton with claim-time consent gate and the enablement flag

**Epic:** #1900 | **PRD Ref:** FR-D04, FR-D07 | **Lex:** BR-1, BR-2, BR-3 | **Architecture:** §3.4, §6.1 | **Priority:** Core | **Points:** 5 | 🟢

**User Story:** As a candidate, I need labelling to be impossible on my recording unless my biometric consent is live at the moment the work starts — and impossible at all until the feature is explicitly enabled.

**Acceptance Criteria:**
- [ ] AC-1: With `DIARIZATION_ENABLED` off, the transcribe path enqueues nothing and the worker (if running) claims nothing; the recording's transcript behaves exactly as today.
- [ ] AC-2: Given a queued job whose candidate's `biometric` consent is granted and current at claim time, then the job proceeds past the gate (stub engine in this story).
- [ ] AC-3: Given consent missing / declined / withdrawn / version-stale / Tier 0 objection / Tier 1+2 posture / no session link, when the worker polls, then the job is cancelled with reason `consent_blocked_at_claim:<CODE>` and no audio is fetched and no engine process is spawned (verified by test doubles + log assertion).
- [ ] AC-4: Given consent withdrawn after claim but before write, then the completion path discards output and cancels `consent_blocked_at_write:<CODE>`; the transcript remains unlabelled.
- [ ] AC-5: Consent is resolved live from the DB via `consentService` on every claim — a test that mutates consent between enqueue and claim proves the claim-time value governs (never the enqueue-time value, never a cache, never a client field).

**Technical Notes:** `workers/diarization/` poll loop + `lib/observerConsentGate.js` reuse (`canEnableObserver` as the second check). The worker in this story ends jobs at the gate with a stub "engine" so S-D05 swaps the stub for the real child. **Dependencies:** S-D03. Blocks: S-D05.

### Story S-D05: Engine child process — pinned Who package, memory-only audio path

**Epic:** #1900 | **PRD Ref:** FR-D05 (single-piece), FR-D07, NFR-D02, NFR-D05 | **Lex:** BR-4, BR-5, BR-8, BR-9 | **Architecture:** §3.4, §3.5, ADR-D01 | **Priority:** Core | **Points:** 8 | 🟢

**User Story:** As the platform, I can diarize a recording's audio with the pinned vendor engine, in a process whose memory — including every voice-print embedding — is destroyed when the job ends.

**Acceptance Criteria:**
- [ ] AC-1: `package.json` (worker scope) pins `@desert-ant-labs/who` at exactly `4.2.1` (no range); the weights cache is provisioned at worker start (pinned HF revision, SHA-256 manifest verified by the SDK) in an access-controlled directory outside the repo; no weights file exists in the repo or client build (CI grep).
- [ ] AC-2: Given the spike's synthetic 121 s fixture, when the worker processes its job, then it stores turns matching the Step-0 reference (2 speakers, ≥98 % correct attribution on the scorer) and records `engine_package`, `sdk_version=4.2.1`, `model_version=v0.3.4` on the run row.
- [ ] AC-3: Audio reaches the child as in-memory PCM (ffmpeg stdout pipe → buffer → child stdin); a filesystem sweep of the worker host during and after the job finds no plaintext audio temp file and no embedding artefact (BR-4 verification, Quinn-witnessed).
- [ ] AC-4: Given the child is killed mid-job (SIGKILL) or exceeds the 15-minute timeout, then the job fails with the right `error_class`, the supervisor survives, the next job processes normally, and no partial output is persisted.
- [ ] AC-5: SDK telemetry is untouched by our code (diff review: no env override of `DAL_LICENSE_ENDPOINT`, no filtering wrapper) — BR-9.

**Technical Notes:** Child entry under `workers/diarization/engine-child.mjs`; supervisor spawns per job. ffmpeg is a worker-host prerequisite (v8.1.2 on the dev VM). **Dependencies:** S-D04. Blocks: S-D06, S-D07.

### Story S-D06: Long-recording proof — cross-piece join and worker sizing on synthetic fixtures

**Epic:** #1900 | **PRD Ref:** FR-D05, NFR-D01, NFR-D02 | **Architecture:** Step-0, §8.1 | **Priority:** Core | **Points:** 3 | 🟢

**User Story:** As the team, we know — measured, not extrapolated — that a full-length interview labels consistently end-to-end and what worker size that requires, before any surface depends on it.

**Acceptance Criteria:**
- [ ] AC-1: Synthetic 30-minute and 60-minute multi-voice fixtures (generated locally, ground truth by construction, speakers speaking in both the first and last 5 minutes) diarize through the full worker path; each ground-truth voice corresponds to exactly one speaker number in minute 2 and in the final minute (join correctness, FR-D05's AC).
- [ ] AC-2: Measured and recorded on the story: end-to-end labelling latency for the 60-minute fixture (against NFR-D01's 10 minutes) and peak worker RSS — the final production memory envelope is set from this measurement and written back into Architecture §8.1 by amendment comment.
- [ ] AC-3: A 2-minute single-piece fixture labels through the same path with no phantom speaker change (FR-D05 second AC).

**Technical Notes:** Fixture generation extends the spike's `make_audio.py` approach (distinct local TTS voices, concatenated turns). This story proves the vendor join on *our* pipeline; it does not re-benchmark the model (HA-1 human-voice accuracy is S-D16). **Dependencies:** S-D05. Blocks: S-D07.

---

## Track C — Stitching and mapping

### Story S-D07: Stitching — segments × turns, original output retained, partial coverage honest

**Epic:** #1900 | **PRD Ref:** FR-D05, FR-D06, FR-D15, FR-D16 | **Architecture:** §3.6 | **Priority:** Core | **Points:** 5 | 🟢

**User Story:** As a recruiter, the words and the voices line up: each transcript segment carries the speaker who said it, and wherever labelling couldn't reach, the transcript shows that honestly.

**Acceptance Criteria:**
- [ ] AC-1: Given completed diarization, when stitching finishes, then every segment's `speaker_number` equals the max-overlap diarization speaker for its span; the raw turns + engine versions are stored verbatim in `diarization_runs` before stitching and are never mutated afterwards.
- [ ] AC-2: Given diarization covering only part of a recording, then segments beyond coverage keep `speaker_number = NULL` and the run records `coverage_end_ms` — the read path can mark the boundary (FR-D15).
- [ ] AC-3: Given a single-voice recording, then stitching yields exactly one speaker number across all segments; no second speaker appears anywhere (FR-D16).
- [ ] AC-4: Given a re-transcription landing while a stale job completes, then the stale output is discarded (`superseded`) and never lands on the new segments (generation guard, FR-D03).
- [ ] AC-5: Segment updates + run + status flip commit atomically; killing the worker mid-stitch leaves the recording `processing` with unlabelled (readable) segments, never half-labelled-as-final.

**Technical Notes:** `lib/transcriptStitch.js`; overlap = interval intersection on ms. **Dependencies:** S-D02, S-D06. Blocks: S-D08, S-D13, S-D14.

### Story S-D08: Mapping proposal — meeting facts only, ambiguity stays unassigned

**Epic:** #1900 | **PRD Ref:** FR-D08, FR-D09, FR-D10 | **Lex:** BR-11, BR-12 | **Architecture:** §3.7, ADR-D05 | **Priority:** Core | **Points:** 5 | 🟢

**User Story:** As a recruiter, speaker numbers arrive already proposed as the people who were in my call — where the facts support it — and honestly unassigned where they don't.

**Acceptance Criteria:**
- [ ] AC-1: Given a 1:1 labelling with a clear speaking-share leader, when the proposal runs, then mappings persist as `state='proposed'`: largest-share speaker → candidate, next → lead interviewer (from `interview_events` + `users.name`).
- [ ] AC-2: Given top-two speaker shares within 10 %, then both stay unassigned (no guessed swap) — the proposal never guesses.
- [ ] AC-3: Given more speakers than participants, then extra speakers persist unassigned ("Speaker N"); given fewer, silent participants get no speaker and no invented turns.
- [ ] AC-4: Given no resolvable `interview_events` row, then all speakers persist unassigned and the manual path (FR-D10, via S-D10's editor) is the way names get attached.
- [ ] AC-5: With `DIARIZATION_AUTO_NAME` off, the proposal step is skipped entirely (all speakers unassigned) with no other behaviour change — the HA-2 degradation switch works before it is needed.
- [ ] AC-6: No speaking-share, turn-count, or confidence figure is persisted in the mapping rows or returned by any API (fence check, BR-12).

**Technical Notes:** `lib/speakerMapping.js`; speaking share computed transiently from turns and discarded. **Dependencies:** S-D07. Blocks: S-D09.

---

## Track D — Surfaces and correction

### Story S-D09: Transcript API composition + playback-page rendering

**Epic:** #1900 | **PRD Ref:** FR-D02, FR-D04, FR-D13, FR-D15, FR-D20 (verification) | **Lex:** BR-11 | **Architecture:** §3.8, §5.1, §5.4 | **Priority:** Core | **Points:** 5 | 🟢

**User Story:** As a recruiter, I open a transcribed interview and read a labelled conversation — names, timestamps, the honesty note, and clear states while labelling is pending or unavailable.

**Acceptance Criteria:**
- [ ] AC-1: `GET /:id/transcript` returns composed `speaker_identity` labels ("Candidate — <name>", "Interviewer — <name>", "Speaker N") + `speaker_number` + `diarization_covered` per segment and the top-level `diarization` block (Architecture §5.1); pre-feature recordings return byte-identical responses to today.
- [ ] AC-2: The playback page renders: per-speaker colours via the existing machinery, the standing estimate note visible without scrolling ("Speaker names are detected automatically and can be wrong" + correction entry point), the "being prepared" state while processing, and "Speaker labels unavailable for this recording" on failure — the report fully usable in every state (J4).
- [ ] AC-3: Partial coverage renders the labelled/unlabelled boundary visibly; unlabelled turns carry no speaker heading (FR-D15).
- [ ] AC-4: Clicking a turn's timestamp seeks playback to that offset — including a turn at minute 40 of a long recording (OQ-6 verification of existing machinery, FR-D20).
- [ ] AC-5: No percentage or confidence figure appears next to any speaker name on any surface (FR-D13).

**Technical Notes:** Composition in the recordings router's transcript handler; client changes confined to `recording-playback.tsx` + its tests. Quinn JT-D1/D2/D4 draft against this story's build. **Dependencies:** S-D02, S-D08. Blocks: S-D10, S-D11, S-D16.

### Story S-D10: Mapping editor + correction endpoints with audit trail

**Epic:** #1900 | **PRD Ref:** FR-D11, FR-D12, FR-D10 | **Lex:** BR-11 | **Architecture:** §5.2, §5.3, §4.2 | **Priority:** Core | **Points:** 8 | 🟢

**User Story:** As a recruiter (or the interviewer who was in the room), I can fix a wrong speaker name once — guided by a sample of each voice's words — and the whole transcript is set right, with a record of my fix.

**Acceptance Criteria:**
- [ ] AC-1: `GET /:id/speakers` returns, for correctors only, each speaker's current assignment + state and a sample turn (text + timestamp); a non-corrector (incl. the candidate) gets 403.
- [ ] AC-2: Given a swapped candidate/interviewer mapping, when the recruiter swaps assignments via `PUT /:id/speakers/mapping` and saves, then every turn of both speakers shows the corrected name on next read, for every viewer (JT-D3).
- [ ] AC-3: The transcript header shows "Speaker names corrected by [name] on [date]" once any correction exists; `transcript_speaker_audit` holds one row per changed speaker (actor, from → to, when); `diarization_runs.proposed_mapping` still holds the original proposal untouched (FR-D12).
- [ ] AC-4: Accepting the proposal unchanged records `state='confirmed'` distinctly from `'corrected'`.
- [ ] AC-5 (validation): assigning a non-participant user, assigning one participant to two speakers, or correcting a recording whose labelling isn't `complete` is rejected with no partial write; re-PUTting the identical mapping is a no-op (no audit rows).
- [ ] AC-6: Manual assignment from the editor covers the no-participant-list case (FR-D10) with the same audit trail.

**Technical Notes:** The largest story in the epic — Lead may split editor UI from endpoints at sprint planning if the gate review prefers; the AC set stays whole. **Dependencies:** S-D09. Blocks: S-D16.

### Story S-D11: Candidate-view parity

**Epic:** #1900 | **PRD Ref:** §7 decision, FR-D13, FR-D19 | **Architecture:** §3.8 | **Priority:** Core | **Points:** 3 | 🟢

**User Story:** As a candidate, where my interview transcript is shown to me, I see the same speaker labels the recruiter sees — with the same honesty note — and a way to raise a wrong name with the hiring team.

**Acceptance Criteria:**
- [ ] AC-1: The candidate-facing transcript (existing access path, unchanged permissions) renders the identical composed labels + estimate note as the recruiter view for the same recording (one artefact, two readers — JT-D5).
- [ ] AC-2: The candidate view offers no editor and no mapping internals; it shows the "raise it with the hiring team" route text where the recruiter view shows the correction control.
- [ ] AC-3: Nothing else in the candidate view changes: no scores, no integrity content, no interviewer data beyond the names shown in the call (PRD §7 guardrails).

**Dependencies:** S-D09. Blocks: S-D16 (JT-D5).

### Story S-D12: Operator visibility of labelling health

**Epic:** #1900 | **PRD Ref:** FR-D04, J6 | **Architecture:** §7 | **Priority:** Important | **Points:** 2 | 🟢

**User Story:** As an operator, I can see each recording's labelling state next to its transcription state, and count labelling failures separately from transcription failures.

**Acceptance Criteria:**
- [ ] AC-1: Recording-management surfaces show `diarization_status` alongside transcription/recording status for every recording (NULL renders as today's UI — nothing).
- [ ] AC-2: An admin-visible aggregate shows job counts by status and failure counts by `error_class` over a chosen window (plain SQL-backed view on existing admin patterns; no new metrics infra).
- [ ] AC-3: User-facing failure copy never includes `error_class` or `error_message` (leak check against §6.3).

**Dependencies:** S-D03. 

---

## Track E — Compliance, fence, and gates

### Story S-D13: Erasure integration for diarization artefacts

**Epic:** #1900 | **PRD Ref:** FR-D18 | **Lex:** BR-13 | **Architecture:** §6.4 | **Priority:** Core | **Points:** 3 | 🟢

**User Story:** As a candidate exercising erasure, everything diarization created about my interview dies with the interview — nothing labelled survives anywhere.

**Acceptance Criteria:**
- [ ] AC-1: `erasePersonalData()` removes a diarized recording's jobs, runs, mappings, and audit rows alongside its transcripts (explicit entries in the E-3 path in `lib/erasureService.js`, plus FK CASCADE as backstop), including the session-linked GAP-A branch.
- [ ] AC-2: After erasure, transcript/label reads for the recording return absence consistent with `[purged]` behaviour, and a post-erasure sweep query finds zero diarization artefacts for the recording (Quinn verifies, JT-D7).
- [ ] AC-3: The counts-only `diarization_metrics_daily` aggregate is untouched by erasure and contains no recording/user linkage (verified by schema review).

**Dependencies:** S-D03, S-D07. 

### Story S-D14: Presentation-only fence guard

**Epic:** #1900 | **PRD Ref:** FR-D14 | **Lex:** BR-12 | **Architecture:** §6.2 | **Priority:** Core | **Points:** 2 | 🟢

**User Story:** As the team, we have a mechanical guarantee — not a promise — that diarization output can never become a scoring input in v1.

**Acceptance Criteria:**
- [ ] AC-1: A dependency-direction test in the repo's test suite fails if any OmniScore / Trust Score / matching / screening module imports a diarization module, or vice versa; the test passes on the shipped tree.
- [ ] AC-2: A response-shape test asserts no diarization-derived quantity (share, count, confidence) appears in transcript/speakers API responses.
- [ ] AC-3: The Phase 4 code-review checklist for this epic records the fence review explicitly (PRD FR-D14's "verified by code review at the Phase 4 gate").

**Dependencies:** S-D07.

### Story S-D15: Disclosure, policy, and attribution surfaces

**Epic:** #1900 | **PRD Ref:** §7 guardrail | **Lex:** BR-6, BR-7, BR-10, BR-14 | **Architecture:** §6.1 | **Priority:** Core | **Points:** 3 | 🔒 (artefacts land 🟢; they take effect for real recordings only at enablement)

**User Story:** As a candidate (and as an interviewer), I am told in plain words — before any labelling of my voice can happen — what is created, how long it lives (it isn't stored), and who sees the labels.

**Acceptance Criteria:**
- [ ] AC-1: The `biometric` consent text is version-bumped to disclose diarization in Lex's plain words (temporary voice template, created during processing only, never stored; who sees the labels), through the existing versioned-consent machinery (stale receipts force re-consent, `CONSENT_VERSION_STALE`).
- [ ] AC-2: `biometric-policy.tsx`'s "We do not extract face measurements or voice measurements from your video or audio" line is corrected in the same change — no published page contradicts the shipped behaviour (#777 pattern).
- [ ] AC-3: The recording/joining notice shown to recruiters and panel members carries the all-speaker disclosure (BR-7).
- [ ] AC-4: The main privacy policy and biometric policy describe the processing (purpose; embeddings retained: never; labels retained with the transcript under the recording's retention clock; SDK telemetry disclosure per BR-14) (BR-14).
- [ ] AC-5: "Powered by Desert Ant Labs" with a link to desertant.com appears on the public legal/acknowledgements page, plus credit in the repository documentation (BR-10).
- [ ] AC-6: Lex reviews the landed text against BR-6/7/10/14 and records the review on the epic before S-D17 can start.

**Technical Notes:** Text is drafted with Lex, not by Nova alone; consent version mechanics are the existing `consentService` text-version path. **Dependencies:** none (parallel). Blocks: S-D17.

### Story S-D16: Quinn journey suites + HA-1 accuracy measurement

**Epic:** #1900 | **PRD Ref:** §14 (JT-D1…JT-D7), HA-1, HA-2, HA-3 | **Architecture:** §7 | **Priority:** Core | **Points:** 5 | 🟢 synthetic; human-voice fixtures only with documented internal consent and Lex's G2 posture (see note)

**User Story:** As the team, the feature is proven the way users live it — full journeys on the fresh-install rig — and its real accuracy on human voices is measured and recorded before anyone relies on the labels.

**Acceptance Criteria:**
- [ ] AC-1: JT-D1…JT-D7 (PRD §14) are authored with the Recruiter + Candidate Experience personas and pass end-to-end on the fresh-install dev rig (real HTTP, real DB, state read back — HL-003); results recorded per test on the epic.
- [ ] AC-2: HA-1 fixtures — human voices, a 2-speaker interview and a 4-speaker panel, including accented speech and overlapping talk — are diarized through the production path and attribution is measured and recorded on the epic. The spike's 98.6 % synthetic figure is not quoted anywhere as expected accuracy.
- [ ] AC-3: HA-2 applied mechanically to the AC-2 result: if 2-speaker correct attribution < 85 %, `DIARIZATION_AUTO_NAME` is set off for launch configuration and the epic records that numbered-speakers-plus-manual-mapping is the launch mode.
- [ ] AC-4: The panel auto-naming bar (OQ-8) is set by Quinn on the AC-2 panel measurement and recorded on the epic; if panels fail their bar while 1:1 passes, panel auto-naming is withheld via the same switch configuration and the epic records the split.
- [ ] AC-5: BR-4/BR-13 verifications are executed as tests: post-job artefact sweep (no embeddings anywhere) and post-erasure sweep (no diarization residue).

**Technical Notes:** Quinn owns execution (Phase 6); sized here for planning. Human-voice fixtures use team members' own recorded voices under written internal consent; if Lex's G2 posture requires more, fixtures stay synthetic and HA-1 completes after G2 — the story records which basis was used. **Dependencies:** S-D09, S-D10, S-D11. Blocks: S-D17.

### Story S-D17: Production enablement — gate checklist execution

**Epic:** #1900 | **PRD Ref:** §12 gates, D2 | **Lex:** BR-1, BR-6, BR-10, BR-14 | **Architecture:** §8.3, §8.4 | **Priority:** Core | **Points:** 2 | 🔒 **BLOCKED until all conditions hold**

**User Story:** As Sumanth, the feature turns on for real recordings only when every gate I was promised is visibly cleared — never by drift.

**Acceptance Criteria (all must hold before the flag flips):**
- [ ] AC-1: **G1** — Desert Ant Labs' written confirmation (Lex Q1.7, six points) is received and filed in `docs/sdlc` alongside the Lex position.
- [ ] AC-2: **G2** — Lex's consent conditions are met: S-D15 landed and reviewed (AC-6 there), claim-time gate proven in production-shaped tests.
- [ ] AC-3: **D2** — production worker capacity (≥ the S-D06-measured envelope) is provisioned per Sumanth's #1837 decision; the worker runs in production with the flag still off and processes synthetic canary jobs cleanly.
- [ ] AC-4: Migration 296 is live on main via the normal promotion path (post-Nov-1), and staging journey re-proof (JT-D1…D7 subset) passed against the shared DB.
- [ ] AC-5: The flag flip itself is a single, reviewed config change on Sumanth's word at the release gate, recorded on the epic with the date and the gate evidence links.

**Technical Notes:** This story is deliberately small in points and absolute in conditions — it is a checklist with a switch, not a build. **Dependencies:** S-D15, S-D16, and the three external conditions. **This story cannot be sprint-scheduled; it completes when the gates clear.**

---

## Sequencing summary for Lead (Phase 4)

| Wave | Stories | Points | Notes |
|---|---|---|---|
| 1 | S-D01, S-D03 | 8 | Independent foundations (ASR contract; schema+queue). |
| 2 | S-D02, S-D04, S-D15 | 13 | Handler segments; gated worker skeleton; disclosure text drafted with Lex in parallel. |
| 3 | S-D05, S-D12 | 10 | Real engine behind the gate; operator visibility. |
| 4 | S-D06, S-D13 | 6 | Long-recording proof + sizing; erasure integration. |
| 5 | S-D07, S-D08, S-D14 | 12 | Stitching; proposal; fence guard. |
| 6 | S-D09, S-D11 | 8 | Read surfaces (recruiter + candidate). |
| 7 | S-D10 | 8 | Correction (largest story; splittable at planning). |
| 8 | S-D16 | 5 | Quinn journeys + accuracy gates. |
| — | S-D17 | 2 | 🔒 Gate-blocked; completes when G1+G2+D2 clear. |
| **Total** | **17 stories** | **72** | |

**Specialist decisions (mandatory record):** engine route — Rex with the Step-0 evidence (no external specialist needed beyond the spike's; the route is evidence-settled); schema — checked against the ecc/database-reviewer pattern via the observer_jobs precedent (skip a separate DB specialist: the design introduces no novel query shape); consent/security — Lex's BR set is the specialist output and is incorporated as constraints (a second security review at Phase 4 code-review remains standard per story). Privacy-engineering review of S-D04/S-D05 at build time is recommended to Lead (BR-4 verification is privacy-critical).

*End of Epics & Stories v1. Next step: Suga's review at the Phase 3 gate. On approval, Lead files story issues from this backlog under epic #1900 and sequences Waves 1–8; S-D17 remains gate-blocked until its conditions clear.*
