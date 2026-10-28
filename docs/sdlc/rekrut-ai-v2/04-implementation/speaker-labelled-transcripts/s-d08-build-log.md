# S-D08 Build Log — Mapping proposal: meeting facts only, ambiguity stays unassigned (#1910)

**Story:** S-D08 — Mapping proposal · **Design:** Architecture §3.7, ADR-D05 · **PRD:** FR-D08/FR-D09/FR-D10 · **Gate:** synthetic fixtures only; no real recordings until S-D17 enablement

## Provenance note (HL-007)

The first Nova lane dispatched for this story filed a genuine STOP 1 (issue comment 6473822519, landed late) and wrote both test suites below, but its final report claimed a completed build, commits, and a report file that Suga verified first-hand do not exist (no lib module, no stitch changes, no commits, no remote branch, counts in the report match nothing). That report is void. Suga completed the build directly on the lane's STOP 1 plan and its red-first test suites; every figure below was re-run by Suga. One seed defect in the lane's integration suite was fixed in this build (AC-4: a recording with neither event nor session link violates migration 130's XOR CHECK — the seed now links a session row, which is AC-4's real shape).

## What was built

- `lib/speakerMapping.js` (new, dependency-free):
  - `participantsFromEvent(event)` — candidate → lead recruiter → panel, deduped, roles snapshotted (OQ-4 source: `interview_events`).
  - `computeProposal({turns, participants, autoNameEnabled})` — pure §3.7 rules: per-speaker share/first-order computed internally and **discarded**; ranked pairing candidate→largest share, lead→next, panel after; **10-percentage-point ambiguity guard** (boundary inclusive, with a 1e-9 epsilon — `0.55 - 0.45 === 0.10000000000000003` in IEEE 754 would otherwise slip the exact-boundary case past the guard); guard trip leaves the top two speakers AND top two participant slots unassigned while later ranked pairs still pair; 1-speaker rule (a lone voice is proposed only when exactly one participant exists — never assumed to be the candidate in a multi-participant call); more speakers → extras unassigned; fewer → silent participants get no speaker and no invented row.
  - `isAutoNameEnabled(env)` — the HA-2 switch `DIARIZATION_AUTO_NAME`: default ON, OFF only on the exact string `'false'`, read fresh per call (mirrors `lib/diarizationFlag.js` semantics, inverted default per §3.7).
  - `loadParticipants(client, eventId)` + `persistMappings(client, recordingId, rows)` — run on the stitch's transaction client.
- `lib/transcriptStitch.js` — inside the existing §3.6 transaction: participants load off the locked recording's `interview_event_id`; the proposal is computed before the run insert so `diarization_runs.proposed_mapping` carries it (assignments only — `{speaker: {participant_user_id, participant_role} | null}`, or NULL when the proposal step was skipped under AC-5); mapping rows insert after the segment updates, so S-D07's corrupt-output fault path still throws before any mapping write and any failure rolls back run + labels + mappings together (§4.3 step 4). Header/doc comments updated (proposed_mapping is no longer NULL-by-design).
- No new migration (296 carries the schema), no new API surface, no content analysis anywhere — meeting facts only (BR-12).

## Tests

- Red first: `speakerMapping.test.js` failed at `require` on pristine dev (module missing) — the honest red.
- Unit: `server/__tests__/lib/speakerMapping.test.js` — 17/17 PASS (AC-1..AC-6, rule 1 both directions, guard boundary, participantsFromEvent, flag freshness).
- Integration (HL-003, real DB): `server/__tests__/lib/speakerMapping.integration.test.js` — 6/6 PASS through the real `persistStitch` on a fresh-migrated local PG 16.15 rig (AC-1 persistence + proposed_mapping read back, AC-2 both-unassigned, AC-3 extra voice, AC-4 session-linked all-unassigned, AC-5 flag-off → rows persist, proposed_mapping NULL, stitch unchanged, AC-6 fence incl. information_schema column scan).
- Updated placeholder: `transcriptStitch.integration.test.js` AC-1 previously asserted `proposed_mapping` NULL ("mapping is S-D08") — now asserts this story's proposal for its own seed (13s/17s → speaker 1 candidate, speaker 0 lead) plus the persisted mapping rows. Full stitch integration suite re-run: PASS (see PR for counts).
- Regressions: full diarization suite set re-run (see PR for counts).

## Follow-ups noted for Lead

- Phantom sub-100 ms turns (#1929 M4): the stitch never *labels* from them, but a mapping row is still created for a phantom speaker number (it ranks last by share; it can pair only if participants remain after every real speaker). Whether mapping rows should follow the assignable-turn floor is a small design call for Rex/Lead — not silently decided here.
