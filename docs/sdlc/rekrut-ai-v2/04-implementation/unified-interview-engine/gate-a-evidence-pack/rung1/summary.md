# Gate A Dormancy Evidence Pack — Rung 1

Generated: 2026-10-13T09:02:21.676Z by `scripts/gate-a-evidence-pack.js` (mock SFU + in-memory PG/storage fakes, synthetic PCM).

## What this pack proves (Rung 1)

- **Dormancy (T1/T2):** with the flag OFF (or malformed), a full synthetic session with 120 offered candidate-audio frames, 120 video frames and 60 interviewer-audio frames produced **zero** `setSubscribed` calls, **zero** registered track handlers, **zero** constructed audio streams, **zero** delivered frames, **zero** rows in `recording_objects` / `observer_audio_chunks` / `observer_speech_measurements` / `observer_capture_outcomes`, **zero** `candidate_data_keys` rows, **zero** storage calls, and an empty capture workdir — while presence behaviour (join, completion report flush) was unchanged. The zero is non-vacuous: the SFU had real media to take (see `sfu-offered.json`).
- **Capture (T3):** flag ON + test scope subscribed ONLY the candidate audio track (never video, never interviewer), persisted 2 encrypted chunks (30 s + 5 s partial), wrote DEK-encrypted measurements (speaking time ≈ 35 s, pitch 120 ± 3 Hz against ground truth; M10 `NOT_VALIDATED`; M8/M9 honestly `ASR_UNAVAILABLE` — no whisper on this VM), and a `session_end` outcome. The stored chunk decrypts (test path only) to PCM measuring 120 ± 3 Hz.
- **Kill bound (T5):** flag flipped OFF mid-capture → teardown completed in the measured milliseconds recorded in `scenarios.json` (≤ 2000 ms bound), outcome `flag_off`, interrupted measurements written as `CAPTURE_INCOMPLETE`.
- **Withdrawal (T6):** mid-capture withdrawal stopped capture (`consent_withdrawn`), wrote NO measurements, and the sweeper queued the persisted chunk for ledger deletion (registry stamped, chunk rows deleted, DEK NOT destroyed).
- **Role flip (T13)** → `role_flip` outcome. **Origin-env mismatch (T14)** → dormant with `CAPTURE_ENV_MISMATCH`. **Concurrency cap** → second session dormant with a `concurrency_cap` outcome. **Restart consistency (T10, module level)** → reconciler leaves settled state untouched.

## What this pack does NOT prove

- No real LiveKit SFU, Neon database, or R2/B2 bucket was touched (all are unreachable from the build VM). **Rung 2 — the staging live-room run — is still required for protocol exit.**
- The Neon PITR window is **not recorded** here (API unreachable); if it exceeds 30 days, Lex acceptance is owed.
- Bucket versioning state for the observer prefixes is **not verified** here (storage APIs unreachable).
- Multi-process worker restart is simulated at module level only (T10).

## Files

- `manifest.json` — pack metadata and unverified items
- `counters.json` — §8.1 counters (dormancy: all zero, with side-effect diffs)
- `sfu-offered.json` — non-vacuous offered-media proof for the dormant session
- `db-diff.json`, `storage-diff.json` — dormant-session side-effect diffs
- `logs.jsonl` — §6.4-schema structured capture logs emitted during the runs
- `scenarios.json` — per-scenario measured results
- `SHA256SUMS` — checksums
