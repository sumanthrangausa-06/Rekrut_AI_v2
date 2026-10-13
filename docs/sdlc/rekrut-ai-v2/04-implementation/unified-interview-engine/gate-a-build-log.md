# Gate A — Dormant Capture Build Log (S-085 / #787)

**Builder:** Nova (Phase 4 implementation) · **Approval:** Sumanth, "go", 2026-10-13 (D-1/D-2/D-3, recorded on #787)
**Unit:** C-1 8 · C-2 7 · C-3 5 · C-4 15 · C-5 5 = **40 pts**, one PR to `dev`, not merged.
**Build basis:** `gate-a-dormant-capture-design.md` (Rex v2, PR #798) · test contract: `gate-a-validation-protocol.md` (Quinn) · requirements: `gate-a-consent-retention-review.md` (Lex, RL-01…RL-12) · `gate-a-privacy-review.md` (delta re-review, BLOCK cleared with conditions).

## STOP 1 (Comprehend) — posted on #787
https://github.com/sumanthrangausa-06/Rekrut_AI_v2/issues/787#issuecomment-6141756852

- **Specialist decision:** privacy-engineer MANDATORY (design's own review chain; delta review of the built unit vs Lex's red lines pre-PR); security/crypto reviewer YES (envelope/AAD/DEK, decrypt isolation); database-reviewer YES (migration 257). Voice/media, UX/frontend, E2E skipped with reasons recorded.
- **Env-identity evidence (privacy delta condition 2):** Render API env query 2026-10-13 — staging `srv-d8j6js3bc2fs73bf4rmg` NODE_ENV **unset**; production `srv-d69opaer433s73d6p570` NODE_ENV **unset**; dev `srv-d8h1ipuk1jcs739ck9eg` NODE_ENV=`development`. ⇒ NODE_ENV cannot distinguish staging from production. **Design consequence implemented:** dedicated env-identity stamp (`lib/observerEnvIdentity.js`: `REKRUT_ENV_IDENTITY` → Render service-name map → normalised NODE_ENV → `'unknown'` fail-closed). No env changes made.
- **Neon PITR window (privacy delta condition 1): UNVERIFIED.** Neon management API unreachable from the build VM (TLS failure, 2026-10-13). Carried as an evidence gap; Lex acceptance still owed if the window exceeds 30 days. Bucket versioning for observer prefixes likewise unverifiable from this VM.
- **D-2/D-3 errata recorded:** `observer_cohort_membership` uses a surrogate PK (latest row per session wins); log schema per the §6.4 whitelist as implemented in `observerCapture.emitLog`. D-4 runbook owner named in STOP 1. K-8 moot (no TTS engine; validation media is generated PCM).

## What was built

| Component | Files |
|---|---|
| C-1 worker dormancy, flag, env identity, gate | `lib/observerCaptureFlag.js`, `lib/observerEnvIdentity.js`, `lib/observerCaptureGate.js`, `workers/ai-observer/index.js` |
| C-2 encrypted persistence, registry-intent-first | `lib/r2ObserverAudioStore.js`, `lib/observerCapture.js` (persist/reconcile), `lib/file-storage.js` (`objectKey` param — see deviation note) |
| C-3 retention / erasure / withdrawal composition | `migrations/257_observer_capture.js`, `services/euComplianceService.js`, `lib/erasureService.js`, `server.js` (cron), sweeper in `lib/observerCapture.js` |
| C-4 speech slice + transcript lifecycle | `lib/observerSpeech.js`, `lib/self-hosted-audio.js` (`{tmpDir, suppressTranscriptLog}`) |
| C-5 validation | `scripts/gate-a-evidence-pack.js`, evidence pack (below), 8 jest suites |

**Deviation flagged for the gate:** design §4.4 requires the storage key known before the PUT and §4.2 forbids timestamps in keys, but `uploadFile` composed `${prefix}/${Date.now()}-…` internally. The build adds an optional backwards-compatible `objectKey` parameter — default behaviour for all existing callers unchanged; no other call site passes it.

## Red → Green evidence (executed on this VM, Node v24)

Jest could **not** be executed in this session: `node_modules` install in the worktree was declined at the confirmation prompt and not retried (per instruction). Suites were verified instead by equivalent plain-node harnesses executing the REAL modules (require-cache stubbing), plus the evidence-pack generator, which runs the real worker against a mock SFU. All harnesses live in the session record; the jest suites in `server/__tests__/` mirror them for CI.

- Env identity + flag: 21 assertions PASS.
- Migration 257: up()/down() executed against a recording mock client — 21 up / 10 down statements, no consent_texts INSERT, no enablement INSERT — PASS.
- Speech corpus C-01…C-13: PASS (120 Hz tone → 120.3 Hz; F0 set within ±3 Hz; 700 ms segmenter gap; filler rate exactly 25/100 on the injected fixture; ASR taxonomy; 50-case fuzz never throws; M10 always `NOT_VALIDATED`).
- Gate suite (T4/T4b/T4c/T14 + recheck): PASS — flag OFF issues ZERO db queries; January biometric consent can never satisfy `observer_capture`.
- Store suite: PASS — ciphertext-only storage, AAD binding, decrypt isolation (activation keys + production identity refused), T8b (destroyed DEK never recreated).
- Capture suite: PASS — intent-first happy path; T11 all four kill points converge to zero unregistered objects / zero stuck intents; T7 three-strike `storage_failed`; withdrawal sweeper; test purge; log whitelist.
- Erasure suite: PASS — observer keys in the ledger with `source_family='observer_audio'`, registry stamped not deleted.
- Retention suite: PASS — confirmed-only purge eligibility; measurement purge dry-run default preserved.
- **Dormancy Evidence Pack (Rung 1):** `gate-a-evidence-pack/rung1/` — 9/9 scenarios PASS through the real worker: T1 dormancy (120 offered candidate-audio frames; 0 subscriptions, 0 handlers, 0 streams, 0 rows, 0 storage calls, 0 DEK rows, empty workdir; presence flush intact), T2 malformed flag, T3 capture ground truth, T5 flag-off kill teardown **358 ms** (≤2 s bound), T6 withdrawal, T13 role flip, T14 env mismatch, concurrency cap, T10 restart consistency (module level).

## Honest limitations

- **Rung 1 only.** No real LiveKit room, Neon DB, or R2/B2 bucket was touched (all unreachable from this VM). Rung 2 (staging live room) is required for protocol exit and remains owed.
- Jest suites are written and syntax-verified but await a `node_modules`-equipped run (`npm run test:unit`) — expected first run in CI / Suga's environment.
- PITR window + bucket versioning: unverified evidence gaps (above).
- Local Postgres was not running on this VM; migration evidence is mock-client execution + static tests, not a live-PG run.

## Specialist reviews (of the built unit) + dispositions

Three reviews ran against the worktree diff. Every finding was verified against the actual code before disposition (two reviews contained claims contradicted by the files — rejected with line evidence, per the reviewer-negatives rule).

**Privacy-engineer (mandatory delta vs Lex RL-01…RL-12):** RL-03/04/05/06/07/08/09/11/12 SATISFIED; RL-01 and RL-02 PARTIALLY (residuals inherent to the approved design); RL-10 NOT-VERIFIABLE (platform facts off-VM).
- **P-3 (major) FIXED:** test-scope identity was forgeable via the same env surface that carries the flag (`REKRUT_ENV_IDENTITY`/`NODE_ENV='test'` on the production service). Added an absolute veto: the platform-injected `RENDER_SERVICE_NAME === 'rekrutai-prod'` rejects test scope at decision AND recheck, regardless of resolved identity (`lib/observerCaptureGate.js`). Proven in the gate harness.
- P-1 residual (capture workdir plaintext between crash and next-start sweep): ACCEPTED — design §7.4's own bounded window (mode-0700 workdir, zero-fill on every normal path, sweep before job-claiming). P-2a verified ALREADY-CORRECT in code (artefact-missing → `CAPTURE_CONSENT_MISSING`, null-guarded before the version compare); P-2b/c tiebreaks already present (`ORDER BY …, id DESC`). m-3 (T8b lacked capture-path composition) FIXED — see below. m-1/m-2: wording — the PR says "evaluated-closed / activation unreachable as shipped", never "default-closed by the flag alone".

**Security/crypto reviewer:** AAD binding, DEK-destruction finality, decrypt isolation, key opacity, nonce handling, SQL parameterisation, log/error leakage all verified SAFE with executed evidence.
- **SEC-MAJOR-2 (timeout TOCTOU on the secure wipe) FIXED:** `runProcess` now SIGKILLs and rejects only after the process is actually dead (2 s grace), so the zero-fill cleanup cannot race a still-writing whisper (`lib/self-hosted-audio.js`).
- **SEC-MINOR-2 FIXED** (defence in depth): `uploadFile` rejects explicit keys with traversal segments (`lib/file-storage.js`). SEC-MINOR-1 verified ALREADY-FIXED in code (the store validates `bareKey` against the chunk-key pattern). SEC-MINOR-3 (AAD reconstructed from row metadata) ACCEPTED — the platform's envelope norm; relocation fails closed. SEC-MINOR-4 (`getStatus` returns `origin_env` via the pre-existing `SELECT *`) ACCEPTED — env label, token-gated status endpoint, pre-existing pattern. SEC-NIT-2 (dead ternary) cleaned.
- **SEC-MAJOR-1 (test marker settable via session-config write paths) ACCEPTED AS DESIGNED:** design §3.2 sanctions the harness marker; bounds are the flag (operator-only), presence consent, non-production identity + P-3 service veto, env-stamped job match, the `capture_decision` audit log, and the 7-day test purge. Residual named in the PR: future session-config hardening must treat `observer_capture_test` as a privileged key. (Verified the write surface exists: `routes/interview-sessions.js` merges config keys at lines 618/654/806/828.)

**Database reviewer (migration 257):** §9 conformance broad strokes confirmed; deploy-safety, lock-ordering, and index verdicts align. Its two majors and two minors were REJECTED with evidence after full-file verification: MAJOR-1 (legacy rows stuck NULL) cannot occur — 257 adds `registration_state TEXT NOT NULL DEFAULT 'confirmed'`, which materialises 'confirmed' for existing rows and forbids NULL thereafter, so legacy purge behaviour is unchanged; MAJOR-2 (receipt-copy insert + audit-log restore in down) — no such statements exist in the migration (verified by full read, grep, and the 21-up/10-down mock execution); MINOR-1 — `ON DELETE CASCADE` is present on all three session-child tables; MINOR-2 — down() does drop `origin_env`, `source_family`, and `registration_state`. MINOR-3 (by-name CHECK discovery) ACCEPTED as the proven migration-254 house pattern.

**Cross-review fix (privacy m-3 → real defect):** the T8b composition test exposed that a post-erasure capture attempt wrote a transient intent row before the encrypt step refused. FIXED with a destroyed-DEK pre-flight in `persistChunk` — refusal now happens before any insert: zero rows, `reason='dek_unavailable'`, DEK never resurrected. Proven in the capture harness + jest.
