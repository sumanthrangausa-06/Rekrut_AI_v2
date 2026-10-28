# S-D13 Build Log — Erasure integration for diarization artefacts (#1915)

**Story:** S-D13 — Erasure integration for diarization artefacts · **Design:** Architecture §6.4 · **PRD:** FR-D18 · **Lex:** BR-13 · **Gate:** synthetic fixtures only; no real recordings until S-D17 enablement
**Governing STOP 1:** issue #1915 comment 6480355806 (Nova, 2026-10-28).

## What was built

- `lib/erasureService.js` — **only** the E-3 block changed, immediately after the `interview_transcripts` DELETE:
  - Four explicit DELETEs — `diarization_runs`, `transcript_speaker_audit`, `recording_speaker_mappings`, `diarization_jobs` — using a shared scope constant that reproduces the transcript DELETE's recording scope **verbatim**: event-linked branch (`interview_recordings → interview_events.candidate_id`) OR session-linked GAP-A branch (`interview_session_id IN (SELECT id FROM interview_sessions WHERE candidate_id = $1)`).
  - **Why explicit deletes, not the cascade:** erasure never hard-deletes `interview_recordings` — GAP-A (c) keep-redacts them (`status='deleted', storage_path=NULL`) because `recording_consent.recording_id` is ON DELETE CASCADE and the consent fact must survive. The migration-296 FK CASCADEs therefore never fire in the real erasure path; they remain the backstop for a genuine hard delete, exactly as Architecture §6.4 specifies ("belt and braces, mirroring how transcripts themselves are handled").
  - **Delete order is FK-driven:** `diarization_runs.job_id → diarization_jobs(id)` carries no cascade (verified in migration 296 and in the live local schema), so runs are deleted before jobs.
  - The audit return gains four counts beside `transcriptsDeleted`: `diarizationJobsDeleted`, `diarizationRunsDeleted`, `speakerMappingsDeleted`, `speakerAuditDeleted` (the file's existing count pattern).
  - `diarization_metrics_daily` is **not touched** (AC-3): schema review of migration 296 confirms the table is `(date, labelled_count, corrected_count)` — counts-only, no recording/user linkage of any kind.
- `server/__tests__/lib/erasure-diarization-1915.integration.test.js` — new JT-D7 journey suite (see Tests).
- `server/__tests__/lib/embeddings-erasure.test.js`, `server/__tests__/lib/dsar-dek-destruction.test.js` — maintenance only: these suites drive `erasePersonalData` through **ordered** `mockResolvedValueOnce` chains and exact-shape result assertions; the chains gain the four new statements (after the transcript DELETE, in implementation order) and the expected objects gain the four new count keys at 0. No assertions weakened.

## Tests

Red first (suite written before any implementation):
- **1 failed** — `result.diarizationJobsDeleted` was `undefined` (expected 2): `grep -c diarization lib/erasureService.js` on dev returned **0**. Post-red-run DB read-back proved the substantive gap: after a full real erasure, the candidate's transcripts were gone but **all** diarization artefacts survived (jobs 3, runs 3, mappings 6, audit 3, including the control's).

Green (HL-003, real DB):
- Journey suite — **1/1 PASS** on a fresh `sd13_e2e` (dropped, recreated, full `migrate.js` incl. migration 296) on the local Postgres rig (127.0.0.1:55433): seeds two diarized recordings for the erasing candidate (one event-linked, one session-linked), each with transcripts (`speaker_number` set), job + run + mappings + audit; asserts the pre-erasure transcript read composes the candidate's name; runs `erasePersonalData()` in the production caller shape (one BEGIN…COMMIT transaction client); asserts the four return counts (2/2/4/2) and `transcriptsDeleted: 4`; sweep finds **zero** artefacts for both recordings; the other candidate's control recording is fully intact; `diarization_metrics_daily` is byte-identical; the post-erasure transcript read returns absence (0 segments, `speakers: []`, `mapping_state: null`, no names).

Regressions (fresh runs by Nova):
- Erasure family (mocked + route suites): gap-a, medium-tables, pool-fallback-1343, beginless-client-1396, pool-fallback-audit-1395, observer-audio, application-keyed, application-ip, gap-f, gap-g, job-applications, threat-intel, csi-final-delete, dead-letter-drain-1337, embeddings (post-maintenance), dsar-dek (post-maintenance), admin-dsar-fulfillment, auth-delete-account-legal-hold — **all PASS**.
- Diarization unit suites (jobs, gate, flag, worker, engine) + migration 296 suite — **all PASS** (combined regression run: 20 suites, 186 passed / 3 skipped / 0 failed, plus the two maintained suites 16/16 separately).

## Independent review (PR #1943) — APPROVE-WITH-MINORS, no blockers

Reviewer: independent subagent, ecc/code-reviewer + privacy-engineer lens, cold review of the diff cross-checked against migration 296 and §6.4. Verified clean: dual-branch scope exhaustive (mig-130 XOR), FK order, CASCADE backstop reasoning, SQL safety, transaction/count handling, mock edits weaken nothing.

Findings and dispositions:
- **F-1 (minor, privacy):** `interview_recordings.diarization_status` survives on the tombstoned recording, so the post-erasure read still reports `status: 'complete'` (with zero label data). Not an AC breach (§6.4's rule is label-data reachability), but clearing both diarization columns in the GAP-A (c) redact is the right tidy-up — **follow-up story for Lead to file** (named in the #1915 checkpoint).
- **F-2 (minor, privacy):** user-keyed diarization rows on *other* candidates' recordings (mappings/audit FKs, `proposed_mapping` JSONB) survive with integer linkage to the tombstoned user; names cannot leak (composition joins the tombstoned `users.name`), but unlike GAP-H's named residual this PR neither severs nor counts it — **same follow-up**: sever (SET NULL, mirroring mig-296's own intent) or formally adopt as a named, counted residual.
- **F-3 (informational):** no per-row hold partition on the new deletes — deliberate mirror of the transcripts; the entry gate's `findActiveHold({ userId })` (incl. any-session company branch) aborts the whole erasure, so no proceeding erasure can contain a held recording. No change requested.
- **F-4/F-5/F-6 (minor, test quality):** read-back proven over HTTP for the event-linked recording only (session branch proven by DB sweep); metrics proof is one seeded date (the delete code contains no metrics statement at all — the risk is hypothetical); the real proof is env-gated per the house realdb pattern. F-4's stale test comment fixed in this PR; the rest accepted and recorded here.
- **F-7 (minor, docs):** return-shape JSDoc extended with the four new keys — **fixed in this PR**.

## Deviations from STOP 1

- The STOP 1 plan asserted the post-erasure read would return absence; the first green run showed the S-D09 composition still emits the `diarization` status block for a post-feature recording (`status` passes through from `interview_recordings.diarization_status`), but with **zero label data** (`speakers: []`, `mapping_state: null`, `corrected_by: null`, 0 segments, no names). The test's read assertion was corrected to the AC's substance — label absence — rather than pinning the block's absence. The status string is operational state on the tombstoned recording row, not label data; §6.4's rule ("no label data remains reachable") is satisfied. Recorded here per amendment-fidelity discipline.
