# S-D09 Build Log — Transcript API composition + playback-page rendering (#1911)

**Story:** S-D09 — Transcript API composition + playback-page rendering · **Design:** Architecture §3.8, §5.1, §5.4 · **PRD:** FR-D02/FR-D04/D13/FR-D15/FR-D20 · **Gate:** synthetic fixtures only; no real recordings until S-D17 enablement
**Governing STOP 1:** issue #1911 comment 6475041285 (Suga, 2026-10-28), incorporating Rex's two rulings of 2026-10-28 (constraints C1–C6).

## What was built

- `server/routes/recordings.js` — **only** the `GET /:id/transcript` handler changed:
  - **Legacy vs post-feature split:** a recording is post-feature iff `interview_recordings.diarization_status IS NOT NULL` (the row `canAccessRecording` already returns — no new access path, FR-D19). Legacy recordings run the exact pre-S-D09 query and response mapping, so their responses are **byte-identical** to today (AC-1, pinned by a deep-equal test against DB read-back).
  - **Composition (post-feature):** the segment query additionally selects `speaker_number`. Names come **only** from `recording_speaker_mappings` joined to `users.name` (C1) — never from participant-list ordering, never from `diarization_runs.proposed_mapping` (the raw proposal is never returned — S-D08 privacy caveat). Role comes from the mapping row: `"Candidate — <name>"` / `"Interviewer — <name>"`. Unassigned speakers (including capped panel speakers, C2) and mappings whose participant no longer resolves (erasure `SET NULL`) compose as `"Speaker N"`, N = speaker_number + 1.
  - **Coverage (C4/C6):** `diarization_covered` is derived **per segment**: `speaker_number IS NOT NULL`. `coverage_end_ms` is never read by this handler (run provenance, Rex ruling 2); no top-level coverage field is added. Uncovered segments keep the stored `speaker_identity` in the payload and are marked `diarization_covered: false` so the client renders no heading instead of guessing from the string (§3.8).
  - **`diarization` block (§5.1 shape, post-feature only):** `status` — `complete`/`processing`/`pending` pass through; `failed` and `unavailable` both surface as `"unavailable"` (reasons never exposed, §5.5). `mapping_state` — any `corrected` row → `"corrected"`, else any `confirmed` → `"confirmed"`, else rows exist → `"proposed"`, else `null`. `corrected_by`/`corrected_at` — from the latest `transcript_speaker_audit` row's actor (current `users.name`); an unresolvable actor leaves both honestly `null` (S-D10 writes these rows). `speakers[]` — one `{speaker_number, label, assigned}` per mapping row, ordered by speaker number, same composition as segments. **No share, turn-count, confidence, or percentage key appears in any added field (AC-5)** — the suites assert the exact key sets.
  - `lib/speakerMapping.js` and `lib/transcriptStitch.js` are **not** modified (C3).
- `client/src/pages/recruiter/recording-playback.tsx` — additive only; legacy payloads (fields absent) render exactly as before:
  - Types extended (`speaker_number`, `diarization_covered`, optional `diarization` block); the block is held in state from the transcript response.
  - **Standing note** at the top of the transcript card (above the scrollable list, visible without scrolling) whenever a diarization block is present: "Speaker names are detected automatically and can be wrong." + the **correction entry point**: a "Correct speaker names" anchor (recruiters only, status `complete` only) to the **Speaker names section** rendered under the transcript — a live anchor to a real section, not a dead button; S-D10 turns that section into the editor. Candidates never see the control.
  - **Corrected-by line** in the note block when `corrected_by` is present: "Speaker names corrected by <name> on <date>" (§3.8/FR-D11 read side).
  - **State banners (AC-2/J4):** `pending`/`processing` → "Speaker labels are being prepared"; `unavailable` → "Speaker labels unavailable for this recording". The transcript text stays fully usable in every state.
  - **Boundary (AC-3):** at **every** covered→uncovered transition a marker row renders ("Speaker labels stop here — the rest of this transcript is unlabelled"; "Speaker labels resume here" on recovery) — never collapsed to one boundary. Uncovered segments render text + timestamp with **no speaker heading and no colour dot**; clicking their timestamp still seeks.
  - **Seek (AC-4):** the existing `jumpToSegment` is untouched (§5.4 — verification, not a mechanism); the acceptance test clicks a minute-40 turn and asserts `currentTime` 2400.
  - **Speaker names section** (`#speaker-names`): the `speakers[]` list with each label + Assigned / Not assigned state (capped panel speakers appear as "Speaker N" / Not assigned — the cap surfaced honestly, C2).
- `docs/…/architecture.md` — **§3.7 rule-2 amendment + HA-2 tidy, Rex's ratified wording verbatim** (verified by exact string match against the ruling document): panel participants are never auto-assigned; the OQ-8 panel-bar sentence is replaced by the closure sentence. Rules 1, 3, 4 unchanged.

## Tests

Red first (both suites written before any implementation):
- Server integration: **11 failed / 2 passed** of 13 — the 2 passing are the legacy byte-identical pin and the purged-tombstone absence, i.e. today's behaviour the story must not break. Failures were the honest red: stored `'unknown'` returned for every segment, no `diarization` block anywhere.
- Client vitest: **6 failed / 2 passed** of 8 — the 2 passing are the legacy-render pin and the minute-40 seek (existing machinery, §5.4).

Green (fresh runs by Nova):
- Server integration (HL-003, real DB): `server/__tests__/routes/recordings-transcript-composition-1911.integration.test.js` — **13/13 PASS** on a fresh `sd09_e2e` (template copy of the migrated `sd08_e2e`) through the real router + real auth over HTTP: AC-1 composition + exact key-set scan (no share/count/confidence keys), FR-D02 highlight attach + reload on a composed segment, legacy deep-equal byte-identical, processing → uncovered, failed/unavailable → `"unavailable"`, **both Rex C5 fixtures** (phantom sub-100 ms tail → tail segments uncovered despite the run row's `coverage_end_ms`; interior gap → covered/uncovered/covered), panel cap C2 ("Speaker 3", `assigned: false`), corrected (+ actor) and corrected-with-erased-actor (honest nulls), confirmed aggregation, purged absence, candidate read parity + non-participant 403.
- Client: `client/src/__tests__/pages/RecordingPlaybackDiarization1911.test.tsx` — **8/8 PASS**: note visible, entry-point anchor + speakers section, both banners, gap fixture renders both markers, uncovered segment renders no heading, legacy payload unchanged, minute-40 seek → `currentTime` 2400, no `/\d+%/` anywhere on the page, candidate sees the note but never the correction control.

Regressions (fresh runs by Nova):
- Diarization unit suites (9 files: engine, flag, gate, jobs, pinning-1907, worker, speakerMapping, transcriptStitch, migration 296): **111 passed / 3 skipped / 0 failed**.
- Diarization integration: speakerMapping **9/9** (sd08_e2e), transcriptStitch **6/6** (sd08_stitch), diarizationWorker **5/5** (sd04_e2e).
- Recordings route suites (mocked: purged-sentinel, session, transcribe-claim, whisper-confidence-1619, encryption, interview-sessions-recording-gate): **40/40**. Segments real-DB (#1904): **5/5** (sd02_1904).
- Full client suite: **502 passed / 9 failed / 29 skipped** (540 tests, 86 files). The 9 failures are in `CandidateInterviewsScreening.test.tsx` (2) and `SettingsLinkedInUrl.test.tsx` (7) — neither imports the playback page (only the new S-D09 test file does), and both files fail **identically on pristine dev `8ceddccc1`** (verified with this build stashed): pre-existing failures on untouched surfaces. The new S-D09 file passes 8/8 inside the same run.
- `diarizationEngine.integration.test.js`: **1 failed / 1 passed** — verified **pre-existing on pristine dev `8ceddccc1`** (identical result with this build stashed): the AC-2/AC-3 case drives the real engine child on this VM and fails environmentally; this story touches neither the engine nor the worker.

## Deviations from STOP 1

None. Constraints C1–C6 are all implemented as specified (C5 fixtures are the phantom-tail and interior-gap cases in the server suite; C6 — no coverage field added).

## Correction — PR #1936 independent review minors (2026-10-28, Suga)

Independent review verdict: **APPROVE-WITH-MINORS** (full report on PR #1936). Dispositions:

- **F3 (fixed here):** the stop-marker text "Speaker labels stop here — the rest of this transcript is unlabelled" is **false at an interior gap**, where labels resume below. The marker now renders the long text only when no later segment is covered; at a gap it renders "Speaker labels stop here". This refines the STOP 1's pinned wording on the reviewer's evidence — the tail-case text is unchanged. Client suite gains a tail-boundary test pinning the long text to the no-resume case and the gap test now pins the short text + absence of the long one.
- **F4c (fixed here):** the no-mapping-row composition fallback (`Speaker N` for a covered segment whose speaker has no mapping row) is now exercised — panel fixture gains a speaker-5 segment composing "Speaker 6" while `speakers[]` stays at the three mapping rows.
- **F5a (fixed here):** uncovered segments' seek is now tested (click → `currentTime` 42).
- **F1 (fixed in correction 2 — see below):** `corrected_by`/`corrected_at` read the latest audit row **regardless of `action`** (`confirm`/`correct`/`unassign`). The code reviewer rated it latent (no audit writer exists until S-D10); the privacy specialist **blocked** on it (below) and Suga accepted the block — the read contract is this story's deliverable, so it is fixed here, not routed.
- **F2 (known issue, accepted for v1):** boundary transitions are computed over the search-filtered list, so an active search can draw a marker between non-adjacent segments or hide a real one. Markers remain honest about the rendered sequence; stricter unfiltered-transition computation is a later refinement.
- **F6 (info):** `labelFor` treats any non-`candidate` role as Interviewer; §4.2 constrains the role set and S-D08 writes role+user together, so unreachable on current writers — noted for S-D10's write path.

Post-correction evidence (Suga's runs): server integration **13/13**, client **10/10**.

## Correction 2 — Privacy specialist BLOCK F-1, fixed (2026-10-28, Suga)

The privacy specialist's full review of this PR (verdict **BLOCK**, one blocker; everything else in the risk domain verified clean — exact §5.1 key inventory, `diarization_runs` never queried so the raw proposal/turns cannot leak, audience parity, legacy invariance, consent-state collapsing, erasure behaviour):

- **F-1:** the corrected-by read was action-blind — a mere `confirm` would have published the confirmer's name to every viewer (including the candidate) as the person who "corrected" the names, and a later confirm after a real correction would have silently replaced the true corrector. The handler's audit query now filters to `action IN ('correct', 'unassign')` (§5.3 treats an unassign save as a corrected state change; `confirm` is not a correction). The specialist's prescribed fixtures are added verbatim: (a) confirm-only audit row → `corrected_by`/`corrected_at` stay `null` with `mapping_state='confirmed'`; (b) `correct` row followed by a later `confirm` row → the corrector's name/date are still returned. The candidate segment key-set is also pinned now (review F-5).
- **F-2 (design note for S-D10/Lex):** the corrected-by line can name an **admin** corrector to the candidate — a back-office name the candidate would otherwise never receive. Not an S-D09 code defect (the field is §5.1-specified); S-D10/Lex to consciously accept or restrict before audit rows exist. Recorded on #1912.
- **F-3 (awareness notes, no action):** `speakers[]` cardinality discloses the count of detected voices (the §5.1-specified Speaker-names panel — conscious acceptance); per-speaker share is derivable from any labelled timestamped transcript by construction (FR-D21 is satisfied at the field level, the only level any labelling design can satisfy it).

Post-correction-2 evidence (Suga's runs): server integration **14/14** (both F-1 fixtures + candidate key-set pin included), client **10/10** (unchanged by this correction).

## Follow-ups noted for Lead

- The `diarizationEngine.integration.test.js` AC-2/AC-3 environmental failure on this VM predates this story (verified at base) — it belongs to the S-D05/S-D06 engine-rig lane, not S-D09.
- S-D10 inherits the `#speaker-names` section as its editor mount point and `transcript_speaker_audit` writes for the corrected-by line this story reads.
