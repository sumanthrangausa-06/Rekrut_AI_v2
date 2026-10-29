# S-D22 — Quinn panel journeys JT-D8a/b/c + integration I1–I7 — Results (#1959)

Owner: Quinn (Phase 6). Design: `03-solutioning/speaker-labelled-transcripts/br7-panel-notice-design.md` §14/§15.
Rig: fresh DB `sd22_e2e` on local Postgres 127.0.0.1:55433, `node migrate.js` exit 0 (migration 299 included). Base: dev @ 6ac9c15eb.

## Suites executed

| Suite | File | Result |
|---|---|---|
| Integration I1–I7 (+T13) | `server/__tests__/lib/diarizationPanel-1956.integration.test.js` | **8/8 PASS**, jest exit 0 |
| Capture/token T-C1…T-C6 | `server/__tests__/routes/panel-labelling-1955.integration.test.js` | **8/8 PASS**, jest exit 0 |
| Journeys JT-D8a/b/c (new, this story) | `server/__tests__/routes/panel-journeys-1959.integration.test.js` | **3/3 PASS**, jest exit 0 |
| Notice copy (S-D20, re-run) | `client/src/__tests__/pages/PanelLabellingNotice.test.tsx` | **19/19 PASS**, vitest exit 0 |
| Recruiter status line (S-D20, re-run) | `client/src/__tests__/pages/RecruiterLabellingStatus.test.tsx` | **5/5 PASS**, vitest exit 0 |

## JT-D8a (all agree) — per-step

1. Recruiter schedules a human interview with one panel member — PASS (event + room + governing session created).
2. Panel member joins on their own screen — PASS: token door returns `labelling_notice` with `own_decision: null`, `decision_scope: panel_leg_only` (notice is present BEFORE recording).
3. Recruiter joins — PASS: own `labelling_notice`, undecided.
4. Candidate joins — PASS: NO `labelling_notice` (not their decision).
5. Panel member agrees (capture door, HTTP 200, keyed to caller) — PASS. Recruiter agrees — PASS.
6. Candidate gives biometric consent in their own flow (`POST /api/consent/record`, 201) — PASS.
7. Recording completes; enqueue (flag on in test env only) queues a job; real worker + real gate process it — outcome `complete` — PASS.
8. Candidate reads the transcript back — PASS: 2 segments, both `diarization_covered`, two distinct `speaker_number`s, composed speaker labels present; candidate recording detail reads `diarization_status: complete`.

Decline-consequence copy step ("told before clicking, that the interview and recording still go ahead without labels"): the copy is rendered by the client notice (livekit-room.tsx) from the token payload, not carried in the API payload itself. It is asserted in the S-D20 PanelLabellingNotice suite — "states BOTH consequences BEFORE any click" — re-run above, PASS.

## JT-D8b (decline twin) — per-step

1. Panel member joins, sees the notice undecided — PASS (consequence copy per S-D20 suite above).
2. Panel member declines (200); recruiter agrees (200) — PASS.
3. Candidate consents (201) — PASS.
4. Interview + recording proceed normally — PASS: recording row `completed`, enqueue verdict `enqueued: false` (suppressed), transcript exists.
5. Transcript is unlabelled — PASS: both segments `speaker_number` null.
6. Posture-leak assertions (privacy-reviewed set) — PASS:
   - candidate recording detail reads the same folded `unavailable` as any other block, no reason attached;
   - no candidate- or panel-facing payload (transcript, recording detail) contains `PANEL_AGREEMENT_*`, the word "declin…", or the decliner's user id;
   - panel member's own recording detail likewise reads `unavailable` with no gate code;
   - the decliner's participation is otherwise identical: rejoin renders their own recorded `declined` status (no re-prompt), transcript readable (200).

## JT-D8c (never asked, never decided) — per-step

1. Panel member joins, makes NO decision; recruiter agrees — PASS.
2. Candidate consents; recording completes — PASS.
3. No labels — PASS: segments unlabelled; candidate detail reads folded `unavailable`; no `PANEL_AGREEMENT_*` string in candidate or panel payloads.
4. Operator-only naming — PASS: the enqueue verdict (operator-side record) is `PANEL_AGREEMENT_MISSING`; that code appears in no user-facing payload above.

## Integration I1–I7 — per-item

I1 full pass with snapshot read-back identical on job + run — PASS. I2 decline → `consent_blocked_at_claim:PANEL_AGREEMENT_DECLINED`, no run, unlabelled, unavailable — PASS. I3 grant→withdraw before write → `PANEL_AGREEMENT_CHANGED`, output discarded — PASS. I4 flip grant→decline→grant → still `PANEL_AGREEMENT_CHANGED` — PASS. I5 panel erasure deletes their rows across all events; candidate erasure leaves panel rows byte-identical — PASS. I6 post-write withdrawal purges labels, keeps claim snapshot, bars re-enqueue — PASS. I7 enqueue suppression on decline, granted control enqueues — PASS. (T13 snapshot write-once — PASS.)

## Privacy engineer review of JT-D8b (MANDATORY, design §15) — PASS-WITH-CONDITIONS

The privacy engineer reviewed the posture-leak assertions against the actual code (not just the design) and returned **PASS-WITH-CONDITIONS**; no BLOCK, no surface found that reveals *a decline* (vs any other block) to the candidate or another panel member. Key verified facts: all panel postures are stored as the single DB value `unavailable` (not merely rendered the same); gate codes live only in `diarization_jobs.cancel_reason` (DB) and worker logs — no HTTP route returns them; the C-6d decision notification goes to the decider only; panel capture audit rows carry `company_id` NULL, so company-scoped audit readers see zero panel rows. Conditions, and how this suite handles them:

- **C-A (settled state only):** panel blocks are suppressed at enqueue; candidate-leg blocks transiently show `pending`. Journey assertions are taken only after the enqueue verdict + DB read-back of the settled status. Honoured in JT-D8b/D8c.
- **C-B (recruiter-role raw class):** list/detail give recruiter-role viewers the raw `failed` vs `unavailable` distinction (pre-existing S-D12 split, privacy-reviewed in #1914) — a block *class*, never a decline and never a person. The panel fixture in these journeys holds the realistic recruiter role, asserts `unavailable`, and does NOT assert failed/unavailable indistinguishability on list/detail. The transcript surface folds the distinction for everyone, and the suite asserts there.
- **C-C (twin deep-equality):** presence of `unavailable` alone is not the assertion. JT-D8b stores the decline twin's full candidate `transcript.diarization` object; the withdrawn twin (grant → withdraw before transcription, run inside JT-D8b) and JT-D8c (never decided) must be **deep-equal** to it. Honoured — all three variants pass deep-equality.
- Additional locks added from the review: notification isolation read-back (only the decider's own C-6d notification names a decision; the candidate receives none) and the audit-boundary regression (panel capture audit rows keep `company_id` NULL).
- One adjacent observation from the review, NOT a JT-D8b leak (flagged for Lead, separate surface): recording detail returns the *recording-consent* array (user_id/name/email/consent_type) to any canAccess viewer — pre-existing S-D12-era behaviour about recording consent, a different table from labelling decisions; it cannot reveal a labelling decline.

## Notes / honest limits

- The diarization engine is stubbed at the worker's `runEngine` seam (established S-D19 pattern); the gate, notice, capture, enqueue and read-back behaviour under test is real. Engine accuracy is S-D05/long-proof scope, not S-D22.
- Scheduling is fixture-created (the event/room rows the scheduling flow writes); every user-facing door after scheduling — token, capture, consent, transcript, recording detail — is exercised over real HTTP.
- `DIARIZATION_ENABLED` was set only inside the test process; nothing was promoted to staging; migrations 296–299 remain held from staging until Nov 1.
