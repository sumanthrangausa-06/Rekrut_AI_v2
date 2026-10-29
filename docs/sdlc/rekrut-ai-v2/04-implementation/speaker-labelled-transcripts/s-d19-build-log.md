# S-D19 Build Log — BR-7 gate panel leg + worker snapshot/compare + withdrawal purge (#1956)

**Persona:** Nova (Phase 4 Implementation) · **Story:** S-D19, 5 pts · **Design:** `br7-panel-notice-design.md` §7/§7.1/§7.2/§10/§13/§14/§15 (Rex, ADR-D07)
**STOP 1:** https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/1956#issuecomment-6493438991 (posted before any build)
**Base:** dev `5ee4e1793` (PR #1960 merge, S-D18) — verified first-hand via `git fetch` at run start; #1955 CLOSED, migration 299 + `lib/panelLabelling.js` + capture endpoint + freeze all present on dev.
**Branch:** `nova/1956-sd19-panel-gate`

## Specialist decision (STOP 1, mandatory question answered)

- **Privacy engineer — MANDATORY, consulted** (design §2.1 full report): ACCEPT-WITH-CONDITIONS on ADR-D07; conditions C-1 (post-write purge), C-2 (claim snapshot is the evidence record — never purged), C-3 (no never-speaks cure), C-4 (per-recording judgement), C-7 (stale at recording start), C-8 (erasure by `user_id` across all events) govern this build.
- **Security reviewer — MANDATORY, consulted** (design §2.1 full report): C-1 freeze-only gate reads (T8), C-2 snapshot includes the expected set, C-5 snapshot-and-claim one transaction under per-event advisory lock + write compares latest overall, S-2 write-once snapshot, S-4 frozen-set mapping validation, S-7 enqueue as third check. Its gate-time version-equality formulation was NOT adopted (privacy C-7 governs; dissent preserved in the design).
- **Database reviewer — considered and SKIPPED:** no schema in this story (299 was S-D18's, DB-reviewed there).

## S-D18 review minor 6 — `versionInForce` (decision: FIX)

Fixed in `lib/panelLabelling.js`: `versionInForce(at)` now returns `null` when `at` is before the first registry version's `effective_from` (or unparseable), instead of initialising to `br7-1`. It also accepts an optional registry parameter (C-7 two-version testability). Gate consequence (P3): a recording that started before any notice version existed can hold no valid panel grant — `notice_version !== null` → `PANEL_AGREEMENT_STALE`, fail-closed. Pinned by `server/__tests__/lib/panelLabelling.test.js` (5 tests).

## What was built

| Piece | Where |
|---|---|
| Panel leg P1–P5 (bridge path only; session path untouched; candidate precedence) | `lib/diarizationGate.js` (`panelLegForRecording`, exported `evaluatePanelLeg` for §7.2 + the worker re-check; `panelSnapshotsEqual`/`normalizePanelSnapshot` for P6) |
| Worker snapshot-and-claim (P5): write-once guarded snapshot + governing provenance in ONE transaction under `pg_advisory_xact_lock(hashtext('panel-event:<id>'))` with a live panel re-check on the transaction client; `PANEL_SNAPSHOT_CONFLICT` on a differing retry; capture endpoint takes the same lock inside its transaction (lock pairing) | `workers/diarization/index.js` (`persistClaimProvenance`, exported), `routes/interview-events.js` |
| Write-time comparison (P6): frozen set/hash divergence → `PANEL_EXPECTED_SET_CHANGED`; decision-tuple divergence → `PANEL_AGREEMENT_CHANGED`; panel block at write after a claim pass translates to the comparison code (§8/I3/I4); candidate codes never translated | `workers/diarization/index.js` (`panelWriteComparisonCode`) |
| Run snapshot at stitch (identical to job snapshot, I1) | `lib/transcriptStitch.js` (`panelConsentSnapshot` param → `diarization_runs.panel_consent_snapshot`) |
| Enqueue suppression (§7.2): transcribe handler's enqueue step extracted to one helper that evaluates the panel leg and suppresses (no job row, state `unavailable`) on a block | `lib/diarizationEnqueue.js` (new), `server/routes/recordings.js` |
| Post-write withdrawal purge (§7.1): capture handler, after COMMIT on a `declined`/`withdrawn` decision, deletes runs + mappings + correction audit, clears `speaker_number`s, folds state to `unavailable` — the re-transcribe deletion family, no new machinery; job rows + claim snapshots NOT deleted | `lib/panelWithdrawalPurge.js` (new), `routes/interview-events.js` |
| Erasure step (§10): `DELETE FROM event_labelling_consent WHERE user_id = $1` (all events, IP/UA die with the row), count returned as `panelLabellingConsentDeleted`; candidate erasure cannot touch panel rows (keys on subject's own id only) | `lib/erasureService.js` |
| §13 item 7 (S-4): mapping-correction validation + editor participant list now source from the recording's FROZEN set ∪ candidate ∪ recruiter; pre-299 (unfrozen) recordings keep the legacy event source | `lib/speakerMapping.js` (`participantsFromFrozenSet`), `server/routes/recordings.js` (`mappingParticipantRefs`) |
| §13 reconciliation items 1, 2, 4, 5, 7 (items 3+6 landed in S-D18) | `architecture.md` §3.3 codes, §3.4 step 4, §5.3 validation, §6.1 BR-7 row, §9 ADR-D07, header note; gate header in `lib/diarizationGate.js` |
| Erasure findability (§10 AC) | keep/erase table line **E-17** (`00-relearn/data/erasure-keep-erase-table.md`) + data-map row (`00-relearn/data/data-model.md` §3.5) |

**Boundaries honoured:** no migration (no schema in this story), `DIARIZATION_ENABLED` untouched (stays off), no staging/main promotion, no emails, no deletion beyond §7.1/§10 scope.

## Red-first evidence (tests written before the build, run on unmodified dev)

- `diarizationGate.test.js`: **11 failed / 34 passed** (T1 snapshot expectation + T2–T9, T11 panel tests red; T10/T12/session-untouched are precedence pins that pass trivially pre-build).
- `diarizationWorker.test.js`: **2 failed / 22 passed** (snapshot persist + T13 conflict).
- `panelLabelling.test.js`: **3 failed / 2 passed** (minor-6).
- `diarizationPanel-1956.integration.test.js`: **8 failed / 8** (suite cannot load `lib/diarizationEnqueue` — the SUT does not exist yet).
- Total red: **16 unit + 8 integration**.

## E2E gate (HL-003) — fresh-install rig, state read back

**Rig note (deviation, recorded):** the documented local rig (`/home/pguser`, 127.0.0.1:55433) is not present in this VM instance and nothing listens on 55433. An equivalent rig was stood up from PGDG debs (PostgreSQL **18.6** + pgvector 0.8.6, Ubuntu 24.04) at `~/workspace/.pg19rig/` on the same host/port. (First attempt under `/tmp` died when the 512 MB `/tmp` tmpfs filled during WAL writes — server PANIC in its log, no test evidence was taken from the crashed instance; the rig was rebuilt on the workspace mount and every suite below was re-run clean against it.)

- Fresh empty DBs created per suite; `DATABASE_URL='postgresql://postgres@127.0.0.1:55433/<db>' node migrate.js` → **exit 0** ("All migrations completed successfully", incl. 296–299) for every DB used.
- **New integration suite `diarizationPanel-1956.integration.test.js`: 8/8 PASS** — I1 (job + run `panel_consent_snapshot` read back from the DB, record ids match the inserted grant rows, snapshots identical), I2 (decline → `consent_blocked_at_claim:PANEL_AGREEMENT_DECLINED`, no run row, segment unlabelled, state `unavailable`), I3 (withdrawal before write → `consent_blocked_at_write:PANEL_AGREEMENT_CHANGED`, no run), I4 (grant→decline→grant flip → still `PANEL_AGREEMENT_CHANGED`), T13 real-DB (write-once: differing retry conflicts, stored snapshot byte-identical via `::text` compare; requeue = new job row accepts the new snapshot), I5 (panel erasure deletes rows across 2 events, `panelLabellingConsentDeleted = 2`; candidate erasure leaves the panel row byte-identical), I7 (decline suppresses enqueue — zero job rows, state `unavailable`; granted control enqueues, state `pending`), I6 (withdrawal via the real capture endpoint purges runs/mappings/`speaker_number`s, state `unavailable`, claim snapshot on the job read back intact, re-enqueue suppressed).
- **Unit suites: 74/74 PASS** — gate 45 (T1–T13 unit + all pre-existing session/bridge tests; bridge fixtures gained the frozen set + grants per design §14), worker 24 (incl. T13 unit), panelLabelling 5.
- **Neighbour suites, all PASS:** migrations 296/297/298/299 + transcriptStitch + speakerMapping + diarizationJobs + diarizationFlag units (81 passed, 3 skipped); `diarizationWorker.integration` 9/9 on its own fresh DB (its bridge fixture gained frozen set + recruiter grant per the same §14 fixture rule); S-D18 capture integration 8/8; S-D13 erasure integration 1/1; transcriptStitch integration 6/6; speaker-mapping editor integration 12/12 (incl. the new S-4 frozen-set test: post-freeze event addition is not assignable, frozen panellist is); speakerMapping integration 9/9; erasure unit suites (gap-a, gap-c, medium-tables, pool-fallback, beginless-client) 43/43; recordings transcribe/purged-sentinel suites pass.
- One cross-suite artefact observed and discounted with evidence: running two integration suites against ONE shared DB made the #1925 worker suite claim the S-D19 suite's leftover pending jobs (global claim order) and fail 2 session-path tests; on its own fresh DB it passes 9/9. Suites are per-DB by house pattern for exactly this reason.

## Observation flagged for Lead/Lex (not fixed here — out of S-D19 scope)

Migration 299's `event_labelling_consent.interview_event_id` FK is `ON DELETE RESTRICT` (S-D18 privacy B-1). GAP-C's candidate-erasure path whole-DELETEs `interview_events` where no recording survives; an event carrying panel rows but no surviving recording would make that DELETE fail and roll back the candidate's erasure. §10 forbids deleting the panel rows on a candidate erasure, so the reconciliation (redact-instead-of-delete for such events, mirroring GAP-C's recording-survives branch) is a follow-up decision for Lead/Lex — S-D19's I5 fixture uses the recording-survives branch, which works today.

## Not in this PR

S-D20's in-flight client changes in the working tree (`PanelLabellingNotice` etc.) belong to that lane and are deliberately excluded from this PR's file list. JT-D8 (Quinn journey) is S-D22. Promotion of migrations 296–299 remains held until the Nov 1 Neon unfreeze.
