# S-D10 Build Log — Mapping editor + correction endpoints with audit trail

**Story:** S-D10 (#1912) · **Epic:** #1900 · **Design:** Architecture §5.2, §5.3, §4.2 · **PRD:** FR-D10/FR-D11/FR-D12, Lex BR-11 · **Gate:** synthetic fixtures + local rig only; no real recordings until S-D17 enablement.

## What was built

- **`GET /api/interviews/recordings/:id/speakers`** (§5.2) — correctors only (recruiter of record, panel interviewer of record, admin; candidates and unrelated users get 403). Returns per-speaker current assignment (user, role, name, state), a sample turn (the speaker's longest segment, earliest start on ties — the most identifying words, so the corrector can tell voices apart without re-listening), the participant list from `interview_events` as assignment options, and the correction-history summary (`mapping_state`, `corrected_by`, `corrected_at` under the S-D09 rule: latest `correct`/`unassign` audit row only).
- **`PUT /api/interviews/recordings/:id/speakers/mapping`** (§5.3) — one transaction, all validation before any write: corrector gate (403), labelling not `complete` → 409 (§5.5), unknown speaker / non-participant user / one participant on two speakers / duplicate speaker entry → 400 with no partial write. Authorship comes from the session, never the body; roles are written together with the user exactly as S-D08 writes them (PR #1936 F6), taken from the participant list, never from the request.
- **Audit + states (§4.2)** — one `transcript_speaker_audit` row per changed speaker (`correct`, or `unassign` when the new assignment is null; actor, from → to). Changed rows become `corrected`; unchanged rows keep their state. Accepting the proposal unchanged while every row is still `proposed` records the acceptance distinctly (AC-4): rows → `confirmed`, one `confirm` audit row per speaker — and a `confirm` never surfaces in `corrected_by` (S-D09 semantics). Any other identical re-PUT is a pure no-op (§5.3 idempotency). `diarization_metrics_daily.corrected_count` increments once, on a recording's first correction (HA-3). `diarization_runs.proposed_mapping` is never written by this story (FR-D12).
- **Editor UI** — the `#speaker-names` section S-D09 landed on `recording-playback.tsx` becomes the editor for correctors: a labelled assignment `<select>` per speaker (participants + "Not assigned"), the sample turn under each label, one Save that PUTs the full mapping and reloads. Non-recruiters never fetch the editor endpoints and keep the read-only list; any editor load failure falls back to the read-only list.

## Decisions recorded at STOP 1 (#1912, discussed — HL-004)

- **F-2 (admin name in the corrected-by line): build exactly as §5.1 specifies.** Privacy-engineer consultation: FR-D11 in the approved PRD already specifies the line with the corrector's name and S-D09 already shipped the rendering; the write path adds no new disclosure category and no consent/legal-posture change. Privacy dissent recorded, non-blocking: an admin was not in the call, so role-labelling admins is a defensible *future* Lex/PRD amendment — not an S-D10 change.
- **AC-6 reading:** manual assignment through these endpoints on recordings whose proposal assigned nobody (ambiguity guard, HA-2 off, panel cap, unresolvable event at stitch time). §5.3 stays fail-closed — there is no free-text name store (the mapping column is an FK to `users`); a recording with zero resolvable participants returns an empty option list. Participants come strictly from `interview_events`; the session candidate is not added for session-linked recordings.
- **Split:** kept whole (Lead's call) — endpoints + UI share one corrector set and one audit transaction; the AC set stays in one PR.

## Evidence (fresh-install local rig, HL-003)

- Rig: PG 16.15 + pgvector 0.8.7 on 127.0.0.1:55433 (rebuilt per HL-009 from PGDG .debs); fresh DB `sd10_fresh`, `node migrate.js` exit 0.
- Journey suite (Quinn + Recruiter lens, JT-D3) — `server/__tests__/routes/recordings-speaker-mapping-1912.integration.test.js`, real router + real DB + supertest, state read back from the DB: **11/11 pass** (red-first: 9/9 failed before the build; the two review-driven tests below also failed/passed as noted). Covers AC-1…AC-6, the swap journey for recruiter *and* candidate readers, audit rows, the untouched proposal, the first-correction metric, no-partial-write rejections (including a single-speaker PUT colliding with an untouched speaker), 409, idempotent re-PUT, and unassign.
- Client editor suite — `client/src/__tests__/pages/RecordingPlaybackSpeakerEditor1912.test.tsx`: **4/4 pass** (labelled selects pre-filled, sample turns, exact PUT body on swap+save, server rejection surfaced, non-recruiter read-only with no editor fetch).
- Regressions on the same fresh DB: S-D09 transcript composition **14/14**, recordings-router suites **52/52**, speakerMapping unit + integration and transcriptStitch integration green; S-D09 client suite **10/10**.

## Review history — independent review BLOCK-1 and its fix

The independent reviewer (code-reviewer + security/privacy lenses) **BLOCKED** the first PR revision: the corrector gate was derived as `canAccess && !isCandidate`, but `canAccessRecording` is *company-scoped* — any same-company recruiter may view — so the gate admitted recruiters who are neither of record, panel, nor admin, on both the event and session branches. §5.2's set is narrower than the view set; the derivation was the defect. The original fixtures could not see it (the panel fixture shared the owner's company; the "unrelated" user was candidate-role).

Fix (same PR): `correctorAccess` now derives the set explicitly — `event.recruiter_id === user.id`, `panel_member_ids ∋ user.id`, or `role === 'admin'`; a session-linked recording (no event) admits admins only. Fixtures rebuilt to pin the boundary: panel moved to a different company (panel access via membership alone), a same-company peer recruiter and an other-company recruiter added as 403 cases, a session-linked recording fixture added (peer + recruiter of the company refused; admin admitted, empty participant list), a duration-vs-word-count discriminator pinning the §5.2 sample-turn rule ("longest" = duration), and the duplicate-across-unlisted-speaker test. The BLOCK-1 regression test failed against the old gate and passes against the fix; the full recordings set (77 tests) is green on the fresh DB. Delta re-review followed the fix.

One deliberate equivalence, recorded: §5.3 says validate `speaker_number` against "the recording's latest completed run"; the build validates against the live mapping rows, which the stitch creates one-per-run-speaker — equivalent in the stitch flow (review NOTE-1).

## Specialist reviews

- STOP 1: privacy engineer (gensecai pool) — F-2 + AC-6 positions above; security reviewer mandatory at code review (see the PR's Specialist Reviews section).
