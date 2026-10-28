---
project: Speaker-Labelled Interview Transcripts (Diarization)
version: 1.0
status: draft — at Suga's review gate
created: 2026-10-28
owner: Sumanth
analyst: Aria (Planning persona, smart-sdlc Phase 2)
stepsCompleted: ["step-01-requirements", "step-02-draft"]
change_log:
  v1.0: "Initial PRD (Aria, 2026-10-28). Founder ruling 2026-10-28: 'Start the full build path' for speaker diarization, after the spike (~/workspace/spikes/who-diarization/FINDINGS.md) proved Desert Ant Labs' 'Who' model runs server-side on Linux. Epic: #1900. Scope centre: recorded human interviews on the recordings path. Two hard gates recorded as dependencies (§12): vendor license confirmation and Lex's consent/biometrics position — development and testing proceed on synthetic audio only until both clear. No application code in this PR; PRD only."
---

# Speaker-Labelled Interview Transcripts (Diarization) — Product Requirements Document

> **Status:** Draft v1.0 — at Suga's review gate | **Version:** 1.0 | **Owner:** Sumanth | **Analyst:** Aria
> **Phase Gate:** ⏸️ Suga review, then Sumanth's approval required before Phase 3 (Solutioning). No build starts on this PRD before that gate.
> **Epic:** #1900 — `[EPIC] Speaker-labelled interview transcripts (diarization)`
> **Rule basis:** Documentation-first (Sumanth, restored 2026-10-21; HL-006) — this PRD precedes any design or build. Acceptance criteria are written as user-visible outcomes so Quinn (Phase 6) can turn them into user-journey tests directly (Sumanth's user-perspective testing rule, 2026-10-21).

---

## 0. Grounding note — what was verified, and from where

Every "current state" claim below was verified first-hand on `origin/dev` @ `72bcb3e42` on 2026-10-28, or is quoted from the spike findings with its provenance labelled. Anything not verified is marked ⚠ **Unverified** and appears as an open question, not a fact.

- **The defect is in the code's own words.** `server/routes/recordings.js`, transcribe handler (~L700–716): the Whisper result is stored as **one** `interview_transcripts` row spanning the whole recording (`start_time_ms = 0`, `end_time_ms = duration`), with `speaker_identity = 'unknown'` and the comment *"Speaker diarization not available in basic Whisper."*
- **The read path is segment-shaped already.** `GET /:id/transcript` (~L748+) returns segments ordered by `start_time_ms`, with per-segment recruiter highlights; candidates are permitted by the API (`canAccessRecording`) but get no highlights/internal notes.
- **The recruiter UI already renders speakers — it just has only one.** `client/src/pages/recruiter/recording-playback.tsx` colours segments per `speaker_identity`, builds a speaker colour map, and searches over `speaker_identity`. With a single `'unknown'` segment, that machinery renders one colour and no attribution. The missing piece is data, not display.
- **No candidate page consumes this transcript today** (verified: candidate client code calls the recordings API for consent/start/stop only). The candidate-side decision in §7 is therefore written at the level of the transcript artefact and any surface that displays it, not tied to one page.
- **Transcripts already sit inside the erasure machinery.** The repo's erasure/retention test suites treat `interview_transcripts` as an erasure-covered family — diarization artefacts must join that coverage, not bypass it (FR-D18).
- **The promise already exists.** The Unified Interview Engine PRD (§6.10, FR-47) specifies the recruiter report includes a *"Full transcript with speaker labels and timestamps."* That requirement was never implemented for the recordings path. This PRD is how it gets kept — for human interviews. (§5.4 of the same PRD likewise anticipates the interviewer being "tracked for diarization only.")
- **Spike facts** (`~/workspace/spikes/who-diarization/FINDINGS.md`, 2026-10-28, $0, synthetic audio only): Desert Ant Labs' "Who" diarization model runs server-side on Linux via its LiteRT build (121 s of audio diarized in 1.84 s = 66× realtime on a 2-vCPU VM; peak memory 695 MB) and its ONNX build (43× realtime; 752 MB). On a scripted two-voice test it attributed 98.6% of speech correctly — a **best-case smoke signal, not a benchmark** (see §9). The pipeline's cross-piece voice-print join (needed for recordings over 5 minutes) is specified by the vendor but **not yet ported or tested**.

---

## 1. Overview

When a human interview is recorded on Rekrut, the transcript a recruiter reads is one unlabelled block of text: every question and every answer attributed to "unknown". This feature adds **speaker diarization** to the recordings pipeline — timestamped transcription segments, a diarization step that works out who spoke when, and a proposed mapping from speaker numbers to the people who were in the call — so the interview report reads as a conversation: who asked, who answered, in order, with timestamps, and with a one-click way for the recruiter to correct a name the system got wrong.

## 2. Problem statement

**Who:** Recruiters (and interviewers) reviewing recorded human interviews — 1:1s and panels — after the call.

**What is broken (verified, §0):**

1. **No attribution.** The transcript of a recorded interview is a single segment with `speaker_identity = 'unknown'`. In a panel interview there is no way to tell which interviewer asked a question, or to separate the candidate's answers from the panel's discussion.
2. **No timestamps to navigate by.** One segment spans 0 → duration, so a reader cannot locate a moment in the recording from the transcript, and per-segment highlights anchor to the whole recording instead of the moment they were about.
3. **A promise unkept.** The Unified Interview Engine PRD (FR-47) already commits the recruiter report to a transcript "with speaker labels and timestamps". The recordings implementation shipped with a placeholder instead.

**Why it matters:** the interview report is where hiring decisions get justified. An unattributed transcript forces the recruiter to re-listen to the recording to reconstruct the conversation — or worse, to quote from memory. Speaker labels are the difference between a transcript that is evidence and one that is a wall of text.

## 3. Goals and Non-Goals

### Goals

- **G1 — Readable conversations.** A recruiter opening a recorded human interview sees the transcript as speaker turns with names (or honest fallbacks, §8.3) and timestamps, for 1:1 and panel interviews alike.
- **G2 — The normal case is the long case.** Interviews run 30–60 minutes. Labelling must work across a full recording, with the same voice keeping the same speaker identity from the first minute to the last (cross-piece join, FR-D05).
- **G3 — Honest labels.** Labels are best-effort and are presented that way on every surface (§9). A speaker the system cannot map is "Speaker N", never a guessed name. Labels are correctable by the recruiter, with an audit trail. When labelling fails or is unavailable, the transcript degrades to exactly today's behaviour — it never blocks transcription or the report.
- **G4 — No silent consent expansion.** Diarization runs on real recordings only after the two gates in §12 clear (vendor license confirmation; Lex's consent/biometrics position). Until then, development and testing use synthetic audio only.

### Non-Goals

- **AI-led voice interviews.** Out of scope: their turns are already attributed by LiveKit participant identity (`agents/voice-interviewer/pipeline.js` — "no ML diarization needed"). This feature is for recorded/mixed audio on the recordings path only.
- **Real-time diarization** during a live call. This is a post-recording pipeline step.
- **Naming speakers the platform doesn't know.** The model numbers speakers; names come only from the call's participant list or a human. No voice is ever matched against other recordings — there is no cross-interview voice identity, and the design must not accidentally create one (OQ-9).
- **Scores from diarization.** Speaking time, turn counts, or any other diarization output are **not** inputs to OmniScore, Trust Score, matching, ranking, or evaluation in v1 (FR-D14).
- **Backfilling history.** Recordings transcribed before this feature ships are not auto-labelled in v1. (A recruiter re-running transcription on an old recording gets labels through the normal path.) Bulk backfill would process candidate audio at scale under the §12 gates and is a separate founder decision (OQ-7).
- **Candidate editing of the mapping.** Candidates see labels (§7) but cannot change them in v1; correction belongs to the report's owner (§8.4).

## 4. Definitions

| Term | Definition |
|------|------------|
| **Diarization** | The process of partitioning a recording into segments by who spoke when. Output is *when* each speaker spoke — not words, and not names. |
| **Speaker timeline** | The diarization output for one recording: a list of `{speaker number, start, end}` spans covering the speech in the recording. |
| **Piece** | A processing window of at most 300 s of audio. The model consumes one piece at a time; a 45-minute interview is 9 pieces. |
| **Voice print** | A numeric embedding the model computes from a speaker's voice to recognise the same voice across pieces of the same recording. A biometric identifier (see gate G2, §12). |
| **Cross-piece join** | Matching speaker numbers across pieces (piece 1's "Speaker 0" = piece 6's "Speaker 1") via voice prints, so one voice keeps one number across the whole recording. |
| **Speaker mapping** | The assignment of speaker numbers to people: `{0 → Candidate, 1 → Interviewer A, …}`. States: **proposed** (system-generated, unconfirmed) or **confirmed/corrected** (a human has accepted or changed it). |
| **DER** | Diarization Error Rate — the share of speech time attributed to the wrong speaker, missed, or falsely detected. Lower is better. The honesty yardstick in §9. |
| **Labelled transcript** | Transcript segments (words + timestamps) intersected with the speaker timeline and the mapping, rendered as named turns. |

## 5. User personas

### Recruiter (primary)
- **Role:** Owns the hiring decision and the interview report.
- **Primary goal:** Reconstruct the interview conversation from the report without re-listening to the recording.
- **Pain point today:** One unlabelled block of text; quotes unattributable; panel interviews unreadable.
- **Success definition:** Opens the report and can immediately see who asked what and what the candidate answered, with timestamps — and can fix a wrong name in seconds when the system errs.

### Human Interviewer
- **Role:** Was in the call; may review the report and is often the person who best knows who said what.
- **Primary goal:** Check the record of their interview; correct attribution errors they can spot at a glance.
- **Pain point today:** The transcript contradicts their memory of the conversation and offers no way to set it right.
- **Success definition:** Can correct a speaker mapping from the report view, with the correction attributed to them.

### Candidate
- **Role:** Was interviewed; receives qualitative feedback under the two-reports model (Unified Interview Engine PRD, FR-48).
- **Primary goal:** Understand what was said and decided about them from a truthful record.
- **Pain point today:** Any transcript they can access says "unknown" for their own words.
- **Success definition:** Wherever their interview transcript is shown to them, it shows the same labels the recruiter sees (§7), with the same honesty note.

### Admin / Operator
- **Role:** Keeps the pipeline healthy.
- **Primary goal:** See whether labelling is keeping up and where it is failing.
- **Pain point today:** No visibility into per-recording processing state beyond transcription.
- **Success definition:** Labelling state per recording (pending / processing / complete / failed) is visible where recording state is managed, and failures are countable.

## 6. User journeys (target state)

### J1 — Recruiter reads a 1:1 human interview
1. The interview ends; the recording completes. The recruiter triggers transcription from the recordings page, as today.
2. Transcription completes; labelling runs automatically afterwards — no second button, no extra step for the recruiter.
3. The recruiter opens the recording: the transcript is a sequence of turns — **"Interviewer — [name] · 00:03"**, the question; **"Candidate — [name] · 00:41"**, the answer — each turn timestamped, colour-coded per speaker (the playback page already colours by speaker), and the standing note is visible: speaker names are detected automatically and can be wrong, with the correction control beside it.
4. The recruiter highlights a sentence in the candidate's answer; the highlight anchors to that turn, not to the whole recording.

### J2 — Recruiter reads a panel interview (candidate + 3 interviewers)
1. Same flow as J1. The transcript shows four voices, each interviewer labelled by name where the mapping could propose one.
2. One voice could not be matched to a participant: its turns render as **"Speaker 4"** — visibly unassigned in the mapping editor, never silently given someone's name.
3. The recruiter can follow who asked each question across the full 45 minutes: the same interviewer keeps the same name in minute 2 and minute 40 (the cross-piece join held).

### J3 — Recruiter corrects a wrong mapping
1. Reading the report, the recruiter sees answers attributed to the interviewer that the candidate plainly gave (the two voices were similar; the proposal swapped them).
2. They open the speaker mapping from the transcript view: it lists each speaker number, its proposed name, and a short sample turn for each so they can tell the voices apart.
3. They swap the two assignments and save. **Every** turn of those speakers updates across the whole recording, immediately on re-read.
4. The transcript now notes: "Speaker names corrected by [recruiter name] on [date]." The original system proposal remains in the audit record — the correction changes the display, not history.

### J4 — Honest failure states
1. **Still processing:** the recruiter opens the recording while labelling is running. They see the full transcript text with timestamps and the state "Speaker labels are being prepared" — never a half-labelled transcript presented as final.
2. **Labelling failed:** the transcript renders exactly as it does today, with the note "Speaker labels unavailable for this recording." The report is fully usable; nothing about the failure blames the candidate or the recording.
3. **One voice only:** a recording where only the candidate audibly speaks labels as one speaker — the system does not invent a second speaker to fill the pattern.

### J5 — Candidate sees their interview record
1. The candidate opens their interview feedback. Where the transcript of their interview is shown, it carries the **same** speaker labels the recruiter sees — including the standing note that names are auto-detected and can be wrong.
2. Nothing else about the candidate's view changes: no scores, no integrity content, no new data about other people beyond the names of the interviewers who were in their call (which the candidate already saw during the call).

### J6 — Operator checks labelling health
1. The operator reviews recordings and can see each recording's labelling state alongside its transcription state.
2. A spike in failures is visible as a count of failed labellings, distinguishable from transcription failures.

## 7. Decision — the candidate sees speaker labels (with justification)

**Decision: YES.** Wherever a candidate is shown the transcript of their own recorded interview, they see the same speaker labels as the recruiter, under the same honesty framing (§9), read-only.

**Justification:**
1. **The two-reports model restricts evaluation, not the record.** Under the Unified Interview Engine PRD (FR-48), the candidate report is qualitative feedback — no scores, no integrity details. Speaker labels are neither: they are the conversational facts of a meeting the candidate personally attended (who was in the room was visible to them throughout the call). Withholding them would not protect any evaluative judgement; it would only make the candidate's copy of the conversation worse.
2. **One conversation, one transcript.** If the recruiter's transcript says "Candidate: …" and the candidate's says "unknown", the product holds two versions of the same conversation. Divergence is a trust defect and a support burden ("your transcript says I didn't say that" becomes unanswerable). A single labelled artefact, displayed to both, keeps one source of truth.
3. **The API already permits it.** Candidate access to their own recording's transcript exists today at the permission level (`canAccessRecording`); labels change the transcript's readability, not its audience (FR-D19 holds the audience fixed).
4. **Feedback quality.** The candidate's qualitative feedback references the conversation ("when you were asked about X, your answer…"). Labels make those references checkable by the person they affect most.

**Guardrails:** candidate view is read-only (correction is the report owner's action, J3); labels carry the same best-effort note; no interviewer data beyond the name displayed in the call is exposed; if Lex's consent position (gate G2) requires candidate-facing disclosure wording about voice-print processing, that wording ships with this feature — the gate's output is an input to the build, not an afterthought.

## 8. Functional requirements

### 8.1 Timestamped transcription (upstream)

**User story:** As a recruiter, I want the transcript broken into timed pieces so that a moment in the text can be found in the recording.

| ID | Requirement | Priority | Acceptance criteria (user-visible outcomes) |
|----|-------------|----------|----------------------------------------------|
| FR-D01 | Transcription of a completed recording SHALL produce timestamped segments — multiple `interview_transcripts` rows with real `start_time_ms`/`end_time_ms` — instead of one row spanning the whole recording. Segment-level timestamps are the minimum; word-level timestamps are not required in v1. | Core | **Given** a completed 45-minute recording **When** the recruiter triggers transcription **Then** the transcript endpoint returns multiple segments ordered by start time, jointly covering the recording, each covering a bounded span (not the whole recording) **And** the segments' text, read in order, is the full transcript — segmentation loses no words |
| FR-D02 | Existing transcript behaviour SHALL NOT regress: per-segment highlights keep working, the `[purged]` tombstone still renders as absence, response shapes stay compatible for existing consumers. | Core | **Given** a labelled, highlighted transcript **When** the recording is purged **Then** the transcript request shows absence, exactly as today **And Given** a recruiter highlights a segment **Then** the highlight attaches to that segment and survives a reload |

### 8.2 Diarization processing

**User story:** As a recruiter, I want speaker labelling to happen by itself after transcription, on recordings of real interview length, without my managing another tool.

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-D03 | Diarization SHALL run automatically after transcription completes for a recording on the recordings path. No separate recruiter action. Re-running transcription re-runs diarization, and the pair replace the old transcript and labels together — never new text under old labels. | Core | **Given** a completed recording **When** transcription finishes **Then** labelling starts without further user action **And Given** transcription is re-run on a labelled recording **Then** the visible result is the new transcript with its own labels, with no moment where old labels sit on new text |
| FR-D04 | Labelling state per recording SHALL be one of `pending / processing / complete / failed`, visible wherever the transcript is shown and wherever recording state is managed. A failed labelling never marks a transcript as labelled and never blocks viewing the report. | Core | **Given** a recording whose labelling failed **When** the recruiter opens it **Then** the transcript is fully readable with the "Speaker labels unavailable" note (J4) **And** the state shown is `failed`, not `complete` |
| FR-D05 | Long recordings are the normal case: a recording of up to 60 minutes SHALL be processed in pieces of ≤300 s with the cross-piece voice-print join applied, so one voice keeps one speaker number across the entire recording. | Core | **Given** a synthetic 30-minute two-voice fixture with known ground truth **When** diarization completes **Then** each ground-truth voice corresponds to exactly one speaker number in minute 2 and in minute 28 (join correctness; Quinn measures attribution quality per §9) **And Given** a 2-minute recording (a single piece) **When** diarization completes **Then** it is labelled through the same path with no join artefacts — no phantom speaker change mid-recording |
| FR-D06 | The speaker timeline and the mapping SHALL be stored as data, separate from any single rendering, so that re-mapping (FR-D11) never requires re-running the model, and the original model output is retained for audit. | Core | **Given** a completed labelling **When** a recruiter corrects the mapping **Then** the correction takes effect without the model re-running **And** the original proposed mapping is still retrievable in the audit record |
| FR-D07 | Diarization SHALL run as queued worker work, never inline in a web request. The model needs ~0.7 GB peak memory (spike measurement) and runs on a worker with ≥1 GB (dependency D2, §12). One recording's failure SHALL NOT affect others in the queue. | Core | **Given** three recordings transcribed back-to-back **When** their labellings are queued **Then** each completes or fails independently **And** the transcribe API's response behaviour is unchanged (no inference in the request path) |

### 8.3 Numbers → names mapping

**User story:** As a recruiter, I want the speaker numbers turned into the names of the people who were actually in my interview — and "unknown" honesty where the system can't tell.

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-D08 | The system SHALL propose a mapping from speaker numbers to the call's participants (candidate + interviewer(s) of record) using meeting facts — who was in the call, speaking share, speaking order. A proposed mapping is displayed immediately (reading is never blocked on confirmation) and is always framed as proposed until a human confirms or corrects it (§9 note). | Core | **Given** a completed 1:1 labelling **When** the recruiter opens the transcript **Then** turns display participant names with the standing best-effort note visible **And** the mapping editor shows the mapping state as `proposed` |
| FR-D09 | A speaker that cannot be matched to a participant SHALL render as "Speaker N" and appear in the mapping editor as unassigned. The system SHALL NEVER guess a name for an unmatched speaker or silently merge it into another speaker. | Core | **Given** a panel recording with one unmatched voice **When** the recruiter reads the transcript **Then** that voice's turns are headed "Speaker N" **And** no turn of that voice carries a participant's name |
| FR-D10 | If the participant list for a recording is unavailable, all speakers SHALL render as numbers and the mapping editor SHALL let the recruiter assign names manually. | Important | **Given** a labelled recording with no participant list **When** the recruiter opens the mapping editor **Then** they can type/select a name for each speaker number and save, with the same audit trail as FR-D11 **And When** they save **Then** the assigned name renders on every turn of that speaker |

### 8.4 Correction

**User story:** As a recruiter (or the interviewer who was in the room), I want to fix a wrong speaker name once and have the whole transcript set right, with a record of the fix.

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-D11 | A recruiter, or the interviewer of record, SHALL be able to reassign any speaker number to a different participant (or to unassigned) from the transcript view. The mapping editor SHALL show, for each speaker number, a sample turn (its text and timestamp) so the corrector can tell the voices apart without re-listening to the recording. The change applies to every turn of that speaker across the whole recording, is effective on next read, and is audit-logged (who, when, from → to). The transcript displays that names were corrected, by whom, and when. | Core | **Given** a transcript with a swapped candidate/interviewer mapping **When** the recruiter swaps the assignments and saves **Then** every affected turn shows the corrected name **And** the transcript header notes "Speaker names corrected by [name] on [date]" **And** a second user opening the same report sees the corrected labels |
| FR-D12 | Corrections SHALL NOT rewrite the model's original output: the original timeline and original proposed mapping are retained (FR-D06); the displayed mapping is the corrected one. | Important | **Given** a corrected mapping **When** the audit record is inspected **Then** both the original proposal and each correction are present, in order **And Given** at least one correction exists **Then** every reader sees the corrected mapping — the original proposal is never re-displayed as the live labels |

### 8.5 Presentation and honesty

**User story:** As any reader of a labelled transcript, I want to know the names were machine-detected and can be wrong — before I rely on them, not after.

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-D13 | Every surface that displays speaker labels SHALL carry the standing note, in plain words, that speaker names are detected automatically and can be wrong — with the correction path one click away for those who can correct, and a "raise it with the hiring team" route for candidates. No surface SHALL present a label as verified fact, and no accuracy percentage SHALL be shown to users (percentages are internal QA metrics, §9). | Core | **Given** any labelled transcript view (recruiter, interviewer, candidate) **When** it renders **Then** the best-effort note is visible without scrolling into a footnote **And** no percentage or confidence figure appears next to any speaker name |
| FR-D14 | Diarization outputs (labels, speaking time, turn counts) SHALL NOT be inputs to OmniScore, Trust Score, matching, ranking, filtering, or any candidate evaluation in v1. | Core | **Given** this feature shipped **When** any score or ranking for a candidate is produced **Then** diarization data is not among its inputs (verified by code review at the Phase 4 gate and stated in the Phase 3 epics) **And** no diarization-derived figure (speaking share, turn count, talk ratio) appears in any score display, candidate profile, or ranking surface |
| FR-D15 | Degradation is explicit: partial labelling is never presented as complete. If only part of a recording could be labelled, the labelled/unlabelled boundary is visible in the transcript. | Core | **Given** a recording whose labelling covers only part of its duration **When** the recruiter reads the transcript **Then** turns beyond the labelled range render unlabelled with a visible marker of where labelling stops **And** the unlabelled turns carry no speaker heading at all — visually distinct from labelled turns, never a name carried over by implication |
| FR-D16 | A recording in which only one voice is audible SHALL be labelled as one speaker. The system SHALL NOT invent additional speakers. | Important | **Given** a single-voice recording **When** labelling completes **Then** the transcript shows exactly one speaker, mapped or as "Speaker 1" **And** if that voice matches a participant, the mapping proposal treats it like any other speaker (FR-D08) rather than assuming it is the candidate |

### 8.6 Data, privacy, and erasure

**User story:** As a candidate, I want the voice data taken from my interview to live and die with that interview's record — never kept as a reusable identity, never surviving an erasure.

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-D17 | Voice-print embeddings are processing artefacts of a single recording's labelling job: they SHALL NOT be stored as a reusable voice identity, SHALL NOT be matched against other recordings, and SHALL be deleted when the job completes — unless Lex's consent position (gate G2) sets a stricter rule, in which case the stricter rule wins. Stored outputs are the speaker timeline, the mapping, and the correction audit. | Core | **Given** a completed labelling **When** the job's artefacts are inspected **Then** no per-speaker embedding remains stored beyond the job (subject to G2's final rule) **And** no code path compares embeddings across recordings |
| FR-D18 | Diarization artefacts inherit the recording's lifecycle: purging or erasing a recording (account deletion, retention purge, tombstones) SHALL remove or tombstone its speaker timeline, mapping, and labels with it. No orphan labelled data survives its recording. | Core | **Given** a labelled recording that is purged **When** any transcript/label data for it is requested **Then** the response is absence, consistent with the existing `[purged]` behaviour **And** the mapping and correction audit for that recording are removed or tombstoned with it — no label data outlives its recording in any store |
| FR-D19 | Access control is unchanged: labelled transcripts are visible to exactly the users who can access the recording/transcript today. Diarization adds no new audience and removes none. | Core | **Given** a user who cannot access a recording today **When** this feature ships **Then** they still cannot access its labelled transcript **And Given** the candidate for that interview **Then** they can access it as today (§7) |

### 8.7 Nice-to-have (post-v1 candidates, recorded so they are not silently absorbed)

**User story:** As a recruiter, I want the transcript and the recording to work as one document.

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| FR-D20 | Clicking a turn's timestamp seeks the recording playback to that moment. | Nice-to-Have | **Given** a labelled transcript beside the player **When** the recruiter clicks a timestamp **Then** playback starts at that offset (feasibility: OQ-6) **And** seeking works for turns late in a long recording, not only in its first minutes |
| FR-D21 | Speaking-share summary per participant, displayed as descriptive fact only (never scored, per FR-D14). | Nice-to-Have | Deferred — requires its own honesty review before any display; not part of v1 acceptance |

## 9. Honest-accuracy requirements

The founder's no-fake-numbers standard applies to this feature in its sharpest form: a wrong name on a transcript is a fabricated fact about a real person. These requirements are therefore Core, not polish.

**The numbers, with provenance (never to be shown to users — FR-D13):**

- The spike's 98.6% correct attribution was measured on two maximally distinct synthetic voices in clean audio. It proves the pipeline runs; it is **not** the accuracy any user should expect, and it must never appear in product copy, marketing, or a report to the founder as the feature's accuracy.
- The vendor's own published figures (vendor claims, from the model card via the spike findings): ~7.7% DER for 2-speaker recordings (VoxConverse), 12.6% DER on AMI meetings, ~17% DER at 5–8 speakers, ~25% at 9+ speakers. Overlapping speech is the model's weakest point (≈65% of its AMI misses).
- Plainly: on a real 1:1 interview, roughly 1 in 10 speech moments may be attributed to the wrong person; on panels, more. The product must be designed so that this error rate is *visible and correctable* (J3, FR-D13), never hidden.

**Requirements:**

- **HA-1 (Core):** Phase 6 (Quinn) measures attribution accuracy on realistic fixtures before launch: human voices, a 2-speaker interview and a 4-speaker panel, including accented speech and some overlapping talk. The measured figures are recorded on the epic (#1900). The spike's synthetic fixture (FR-D05) is a pipeline test, not a substitute.
- **HA-2 (Core) — the degradation rule:** if Quinn's measured 2-speaker attribution falls below **85% of speech time attributed to the correct speaker**, the feature does not launch with automatic names. It launches with numbered speakers ("Speaker 1 / Speaker 2") plus manual mapping (FR-D10) only, until accuracy improves. Auto-naming is earned by measurement, not assumed. (85% sits deliberately below the vendor's 2-speaker claims, so the bar is demanding but reachable if the vendor's numbers are honest.)
- **HA-3 (Core):** The correction rate in production (share of labelled recordings whose mapping a human corrects) is the standing real-world accuracy signal and is reported with the success metrics (§13). A rising correction rate is treated as a defect signal, not user error.

## 10. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-D01 — Timeliness | A 60-minute recording's labelling completes within **10 minutes** of transcription completing, on the production worker. (Grounding: the spike measured 66× realtime inference on 2 vCPU; even at a tenth of that throughput on shared production hardware, 60 minutes of audio labels in ~9 minutes. Quinn verifies on the production-class worker in Phase 6.) |
| NFR-D02 — Footprint | The diarization worker runs within a ≥1 GB memory envelope (spike peak: 695–752 MB). It must not degrade the web service: no inference in the web process (FR-D07). |
| NFR-D03 — Cost | $0 new spend: model weights are free downloads; inference is local CPU. The only cost surface is worker capacity (dependency D2) — no per-interview API fees are introduced. |
| NFR-D04 — Reliability | Labelling jobs are idempotent and retryable: re-running a job for a recording produces the same stored artefacts without duplicating segments or mappings (see FR-D03 for the transcript/label pairing rule). |
| NFR-D05 — Security | Model weights and any voice-print artefacts stay server-side. Weights are never shipped to browsers or clients (also a license condition — §12, G1). Recordings continue to be decrypted in memory via the existing path; diarization introduces no new plaintext copies of audio. |
| NFR-D06 — Compatibility | The labelled transcript renders on the existing recording playback page and transcript endpoints; no new client surface is required for v1 beyond the mapping editor and the honesty note. |

## 11. Technical constraints (established by the spike — design works within these)

- The model consumes pieces of ≤300 s of 16 kHz mono audio; recordings arrive as mp4/LiveKit egress and must be decoded to that form (the transcribe handler already holds the audio buffer in memory).
- There is **no vendor server SDK**. The spike reproduced the single-piece pipeline in ~250 lines of Python from the vendor's Swift source; the cross-piece voice-print join (voice-print graph + embedding pooling + cosine clustering, specified in the vendor's `who_meta.json` / `Voices.swift`) is **not yet ported** — it is the main engineering chunk of the build, with its own accuracy test (FR-D05).
- Today's transcript storage is one row per recording; timestamped segments (FR-D01) change that shape. Any schema change follows the standing shared-database rule: expand → migrate → contract, never a one-step shrink (staging and production share one database).
- The vendor's FAQ says the model "doesn't run in the browser or in Node yet", while its Hugging Face card and SDK repo ship a Node package (`@desert-ant-labs/who`, `packages/who-node`). The contradiction is unresolved — it is Rex's first design question (OQ-1), because the answer changes the build's shape materially.

## 12. Dependencies and gates

### Hard gates (owned by Lex — block real-recording use, not design or build)

| Gate | What is required | Blocks | Does not block |
|------|------------------|--------|----------------|
| **G1 — License** | Desert Ant Labs' **written confirmation** that server-side processing of uploaded recordings is permitted under their Source-Available License v1.0 (the license as written is built around on-device distribution — "monthly active devices", SDK telemetry — and §6 bans distributing the models "as a hosted service"; free tier is <100k monthly active devices; attribution is a license condition). Lex owns the vendor contact; nobody else approaches the vendor. | Running the model on any real recording in production; any launch enablement | Phase 3 design; implementation; all testing on synthetic audio |
| **G2 — Consent / biometrics** | Lex's written position on voice-print processing: whether computing voice prints from candidate recordings needs its own consent line beyond the existing recording consent, the retention rule for embeddings (FR-D17 defaults to delete-on-complete; stricter wins), candidate-facing disclosure wording (§7 guardrail), and erasure treatment (FR-D18). Same treatment as the Observer's biometric gates. | Running the model on any real candidate recording | Phase 3 design; implementation; synthetic-audio testing |

Until G1 and G2 both clear, **development and testing proceed on synthetic audio only**. This sequencing is deliberate: the gates are chased in parallel with Phase 3 so the build is ready if they clear, and no real candidate's voice is processed on an uncleared basis if they don't.

### Dependencies

| ID | Dependency | Notes |
|----|-----------|-------|
| D1 | Timestamped transcription (§8.1) | In-scope upstream work of this feature, not an external wait. The current Whisper path returns whole-recording text; segment timestamps must come from somewhere (OQ-5). |
| D2 | Worker capacity ≥1 GB in production | The 512 MB free-tier web instance cannot host the model (~0.7 GB peak). Relates to open issue #1837 (production cold-start/capacity). Noted as an infrastructure dependency for production enablement; dev/staging proofs run on the VM rig. Not solved by this PRD. |
| D3 | Engine route decision (Rex, Phase 3) | Vendor Node package vs the spike's Python port (LiteRT or ONNX). This PRD is engine-agnostic: requirements bind the outputs (timeline, join correctness, footprint), not the route. |
| D4 | Unified Interview Engine PRD alignment | This PRD delivers the recordings-path half of UIE FR-47 (speaker labels + timestamps in the recruiter report). If the two documents ever conflict, the conflict is escalated to Suga — neither silently overrides the other. |

## 13. Success metrics (measured after launch, reported to the epic)

- **Coverage:** ≥95% of newly transcribed human-interview recordings reach labelling state `complete` (the rest visibly `failed`, per FR-D04 — a silent gap counts against coverage).
- **Timeliness:** p95 labelling completion within NFR-D01's 10 minutes for a 60-minute recording.
- **Correction rate (HA-3):** share of labelled recordings with at least one human mapping correction — tracked as the real-world accuracy signal; a sustained rate above 25% on 1:1 interviews triggers an accuracy review before panels are auto-named.
- **Zero 'unknown' by default:** for recordings transcribed after launch, the share whose final displayed transcript still shows speaker `unknown` trends to the failure cases only (FR-D04 states), not the norm.

## 14. Journey-test map (for Quinn, Phase 6)

Acceptance criteria in §8 are written as outcomes; these are the journey tests they roll up into. Quinn authors the suites with the Recruiter and Candidate Experience personas, per the user-perspective testing rule.

| Test | Journey | Core assertions (user-visible) |
|------|---------|-------------------------------|
| JT-D1 | J1 | After transcription of a 1:1 recording, the recruiter sees named, timestamped turns; the honesty note is visible; a highlight anchors to one turn. |
| JT-D2 | J2 | A 4-speaker panel fixture labels consistently across the full duration (same name in minute 2 and minute 40); an unmatched voice renders "Speaker N". |
| JT-D3 | J3 | Swapping a mapping updates every turn of both speakers, shows the correction note with name/date, and persists for a second viewer. |
| JT-D4 | J4 | Processing state, failed state, and single-speaker state each render honestly; the report is usable in all three; no partial labelling presents as complete. |
| JT-D5 | J5 | The candidate-facing transcript shows identical labels + note, and nothing else changes in the candidate view (no scores, no new data). |
| JT-D6 | §9 / HA-1 | Measured attribution on human-voice fixtures (2-speaker and 4-speaker) is recorded on the epic; HA-2's degradation rule is applied to the result. |
| JT-D7 | FR-D18/D19 | Purging a labelled recording removes its labels with it; a user without recording access cannot reach the labelled transcript. |

## 15. Risks

| Risk | Impact | Mitigation in this plan |
|------|--------|------------------------|
| G1 fails — the vendor will not license server-side use | The model can never run on real recordings; build effort is stranded | Gates are chased from Phase 3, in parallel, before implementation spend deepens. The PRD's requirements (timeline, mapping, correction, honesty) are engine-agnostic (D3): if Who is refused, Rex evaluates alternative diarization engines against the same requirements instead of the feature dying with one vendor. |
| G2 requires a new consent flow | Launch sequencing changes; candidate UX gains a step | Lex's position is an input to Phase 3 design, not a Phase 4 surprise. The Observer's consent machinery is the precedent. |
| Panel accuracy disappoints (vendor: 17–25% DER at 5+ speakers) | Wrong names on the highest-stakes transcripts | HA-2's degradation rule; correction UX is Core, not an afterthought; panel auto-naming can be withheld while 1:1 ships (a Phase 3 scoping decision on measured evidence). |
| Worker capacity (D2) is not funded (#1837 territory) | Feature proven on dev/staging but cannot enable in production | Named now, at planning — not discovered at release. Production enablement is explicitly gated on D2 in the release checklist. |
| Cross-piece join proves inaccurate at 30–60 min | Speaker numbers fragment mid-interview (J2 fails) | It is the build's named main chunk with its own fixture test (FR-D05, JT-D2) before any UI work depends on it. |

## 16. Open questions for Phase 3 (Rex — Solutioning)

| # | Question | Owner | Needed by |
|---|----------|-------|-----------|
| OQ-1 | **Engine route:** does `@desert-ant-labs/who` (the vendor's Node package) actually run on Linux? If yes: vendor SDK vs the spike's Python port — weighing integration cost, memory, maintainability, and what each route implies under the license (e.g. SDK device telemetry vs a weights-only port). | Rex | Phase 3 design start |
| OQ-2 | **Worker shape:** where does diarization run (in-repo worker process, separate service, existing queue infrastructure)? Queueing, retries, and back-to-back interview behaviour. | Rex | Phase 3 |
| OQ-3 | **Storage shape:** extend `interview_transcripts` (speaker number + mapping table) vs a separate speaker-timeline table; migration path for existing one-row transcripts; expand → migrate → contract sequencing on the shared database. | Rex | Phase 3 |
| OQ-4 | **Participant-list source:** which record reliably names who was in the call for a given recording (LiveKit room/participant records, scheduled-interview interviewer list, event metadata)? ⚠ Unverified in this PRD pass — the mapping proposal (FR-D08) and its fallback (FR-D10) both depend on the answer per surface. | Rex (Scout verifies) | Phase 3 |
| OQ-5 | **Timestamp source:** does the current transcription chain (`transcribeAudioWithWhisper` and the wider provider chain) return segment timestamps, or must a different mode/provider supply them for recordings? | Rex | Phase 3 |
| OQ-6 | **Playback seek:** does the existing recording playback support seek-to-timestamp (decides FR-D20)? | Rex | Phase 3 (Nice-to-Have only) |
| OQ-7 | **Backfill:** v1 excludes labelling pre-existing recordings (§3). If Sumanth later wants history labelled, what is the cost and the gate posture (G1/G2 apply at scale)? Recorded so the exclusion is a decision, not an oversight. | Lead (to Sumanth, only if raised) | Post-v1 |
| OQ-8 | **Accuracy bars:** Quinn's fixture design and the panel auto-naming threshold (the 2-speaker bar is set in HA-2; the panel bar is Quinn's, set on measured evidence in Phase 6 planning). | Quinn | Phase 6 test plan |
| OQ-9 | **No accidental voice identity:** confirm no design element (caching, logging, analytics) persists voice prints or embeddings beyond the single-recording job (FR-D17) — including in the engine route chosen under OQ-1. | Rex + Lex | Phase 3 design review |

---

*End of PRD v1.0. Next step: Suga's review at the Phase 2 gate; on Sumanth's approval, Rex owns Phase 3 (architecture + epics/stories), with Lex's gates G1/G2 chased in parallel from Phase 3 start.*
