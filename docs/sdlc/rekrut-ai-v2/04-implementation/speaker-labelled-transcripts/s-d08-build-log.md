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

- Phantom sub-100 ms turns (#1929 M4): the stitch never *labels* from them, but a mapping row is still created for a phantom speaker number (it ranks last by share; it can pair only if participants remain after every real speaker). Whether mapping rows should follow the assignable-turn floor is a small design call for Rex/Lead — not silently decided here. **→ Answered by the correction below: YES, it follows the floor (fix PR, #1933).**

## Correction — PR #1932 review BLOCK, fixed same-day (2026-10-28)

The independent review of PR #1932 was delivered first as a condensed summary reading "APPROVE, 2 minors" — Suga merged on it. The reviewer's full report was a **BLOCK (narrow, 2 items)**. HL-007's condensed-summary distortion (#1807 class) recurring; the correction is recorded on PR #1932 (comment 6474331600) and #1910 (6474332307). The fix PR (branch `fix/1910-mapping-block-fixes`) implements:

- **B-1:** the speaker set and all shares are built from **assignable turns only** (≥100 ms, `MIN_ASSIGNABLE_TURN_S` mirroring stitch's floor; local constant — a require back into transcriptStitch would be a cycle, and the two must move together). A phantom speaker gains no row and no name. Reviewer's probe re-run: phantom absent, real speakers correctly proposed.
- **B-2:** guard-trip reading **reconciled by Suga ruling**: Nova STOP 1 ("later pairs still pair") is superseded by Suga STOP 1 reading (a) — a tripped top-two guard voids **all** assignments. Rationale: every lower pairing rests on the same untrustworthy ranking, and the reviewer's zero-evidence probe (all shares 0 → third speaker named) is exactly the fabricated-fact failure FR-D09 forbids. The panel unit case was updated to the reconciled reading.
- **M-1:** first-speaking order is chronological (`min start_s`), not array/emission order.
- **M-2:** zero assignable turns + auto-name OFF returns `proposedMapping: null` (the AC-5 skipped signal survives the empty edge).
- **M-5:** stitch integration AC-5 + idempotency now read back mapping-row counts; new integration cases pin guard-trip-with-panel (all unassigned) and the phantom case (no row) against real Postgres.

Post-fix evidence (fresh runs by Suga): unit **21/21**, speakerMapping integration **8/8**, stitch integration **6/6**, diarization unit regressions **109 passed / 3 skipped**. M-3 (speaker-number range validation) and M-4 (`DIARIZATION_AUTO_NAME` casing fails open — a Rex design call on the HA-2 switch semantics) are filed as a separate follow-up for Lead, not decided here.

**Full specialist reports (landed after the merge; the PR-cited comment 6474055229 was their condensed form — same distortion class, second instance):** Suga read both full reports in the fix PR's scope. Privacy (a)/(b)/(d)/(e) hold in the shipped code (allow-listed shape, single-voice precedence, role-snapshot invariants, 10-percentage-point guard). Two items changed this PR:
- **Privacy (c) — panel cap adopted:** the full report's one near-blocker — auto-naming a *specific panel member* by share rank is a guess, because no meeting fact distinguishes panel members from each other (`panel_member_ids` order is not evidence). **Adopted:** auto-proposal is capped at candidate + lead interviewer; panel speakers stay unassigned for manual mapping. This narrows §3.7 rule 2's assign-in-order in the exact-count case and is recorded on #1910 as a **deviation for Rex to ratify or overrule** in the architecture doc — the conservative direction (fewer proposed names) holds until he does.
- **Privacy caveat on the AC-6 wording:** "share is stored nowhere" is not claimable — `diarization_runs.turns` is retained verbatim (FR-D06, by design), so share is re-derivable by anyone with run-row access. The fence as built and tested is: *no explicit share/count/confidence field is persisted in the mapping record or returned by any API*; access control + erasure on `turns`/`proposed_mapping` are the actual protection. No API (including S-D09's) may return the raw proposal.
- **DB N1–N5:** hold or are now pinned — integer-validated, deduped speaker set (N1); **no ON CONFLICT, by explicit DB ruling** (N2 — this rejects the first code review's contrary minor: an upsert could silently diverge live mappings from the run's immutable `proposed_mapping` once S-D10 corrections exist); NULL/NULL unassigned rows (N3); flag-off still inserts unassigned rows with NULL `proposed_mapping` (N4); fractional-fault zero-mappings assert (N5a, via stitch AC-5 read-back) and a re-transcription second-generation persist test (N5b, added in this PR) assert no `23505` and a cleanly replaced mapping set.
