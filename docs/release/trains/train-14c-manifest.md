# Train 14C — Remainder (email / CSRF / log-redaction / recordings / auth & client surfaces) → staging

- **Scope (issue #1867 slice 14C, the FINAL slice of Train 14):** everything dev-proven that remained after 14A (erasure/compliance, in production) and 14B (honesty, in production): the email response-first wave, CSRF 401 semantics, log-redaction, recordings/LiveKit, the storage-sweep wiring, career coach, and the auth / candidate / company / careers / questionnaire / recruiter route surfaces with their client pages, suites, journey suites and docs — 103 content files plus this manifest. Every full-file scope entry is byte-identical to its dev version (verified file-by-file vs `origin/dev`: diff = 0 lines for all 102 full files). `server.js` is the single partial file — see the hunk table. `routes/interviews.js` is carried whole — see its section.
- **Base / tip:** built off `origin/staging` b0e0bb9f2; dev source `origin/dev` 9db31d643. **No migrations differ staging↔dev (verified: 0 files) — this train carries no migration.**

## Files and purpose

**Email response-first (#1520 / #1359 / #1385 / #1353 + gap-f rescope from 14A):**
- `lib/email-queue.js`, `lib/email-service.js` — response-first send path; queue payload mapped via the shared `toSendTemplatedEmailArgs` helper.
- `server/__tests__/lib/gap-f-send-guard.test.js` — **the suite 14A explicitly rescoped to this train** (its legs test `lib/email-queue.js` `processBatch`, #1161 Finding 4). It rides here with its subject file and PASSES on this tree (see Gates).
- Suites: `email-queue-send-path-1520`, `company-email-response-first-1359`, `company-transfer-ownership-response-first-1385`, `company-transfer-ownership` (updated), `auth-register-pending-email-1353`.

**CSRF 401 semantics (#1328):**
- `server.js` hunks (see table) + suite `csrf-401-1328` — unauthenticated CSRF failures on protected routes report 401 AUTH_REQUIRED; credentialed requests and preserved public entry points keep 403; CSRF middleware moves after session middleware so it can read `req.session`.

**Log-redaction (#1179 / #1492):**
- `routes/interview-sessions.js`, the `routes/interviews.js` voice/screening hunks, suites `log-redaction-1179`, `log-redaction-interviews-route-1179`, `log-redaction-raw-model-output-1492`, `interview-sessions-log-redaction-1179`, `interview-sessions` + `interview-sessions-completion-flow` (updated).

**Recordings / LiveKit / audio:**
- `server/routes/recordings.js`, `server/services/livekit.js`, `lib/sessionRecordingStore.js`, `lib/self-hosted-audio.js`; suites `recordings-encryption`, `recordings-purged-sentinel`, `recordings-session` (updated), `recordings-whisper-confidence-1619`, `livekit-recording-encryption` (updated), `retention-s3-recording-purge` (updated).
- `public/js/video-analyzer.js` — **deleted** (dev deletes it; the analyser moved client-side).

**Storage-sweep wiring (#1172 / #1176):**
- `server.js` retention-tick hunk wires `sweepPendingStorageDeletions` (the function itself rode 14A) into the 24h tick, ungated, with its own LIVE log line; suite `storage-sweep-wiring`.

**Routes (all byte-identical to dev):**
- `routes/auth.js` (+ `auth.test.js` updated), `routes/candidate.js`, `routes/company.js` (+ `company-approval` updated), `routes/recruiter.js`, `routes/careers.js`, `routes/career-coach.js` (+ `lib/career-coach-ai.js`), `routes/questionnaire.js`.
- Candidate/company/recruiter suites carried: `candidate-score-fallbacks-1377` and `candidate-match-explanation-1463` (both declared 14B boundaries — their subject `routes/candidate.js` is in this train), `candidate-application-status-toctou-929`, `candidate-rate-limit-siblings-930`, `candidate-rate-limit-siblings-1403`, `careers-no-boilerplate`, `questionnaire-evaluate-parse-failure-1571`, `recruiter-override-confidence-1613`, `job-optimizer-analyze-honesty-1570` (14B boundary — its static leg asserts a guard in `routes/recruiter.js`, in this train), `matching-stats-split-1728a` (env-gated integration suite — see Gates).

**Dependencies:**
- `package.json` + `package-lock.json` — `undici` 8.10.0 as a direct dependency (#1444); suites `undici-direct-dependency-1444`, `proxy-noproxy-1445` (subject `lib/proxy-env.js` rode 14B).

**Client surfaces (all byte-identical to dev):**
- Auth pages `login.tsx`, `register.tsx`, `forgot-password.tsx`, `reset-password.tsx` (honest social-proof claims) + `AuthSocialProofHonestClaims` suite; `landing.tsx`, `referral-landing.tsx`, `contact.tsx` + `dashboard-layout.tsx` (FS-144 #1099 dead-end removal, suite `fs144-dead-ends-1099`), `components/domain/chat.tsx` (#1574 no simulated typing, + `scripts/check-no-simulated-typing.js` guard — PASS), admin `agents.tsx` + suite, candidate `assessment-take.tsx`, `assessments-legacy-label-1683.test.tsx`, `job-detail.tsx`, `jobs.tsx`, recruiter `interviews.tsx`, `job-assessment.tsx` (the #1726 AntiCheatNullGuard legs 14B held back ride here — suite PASSES), `recording-playback.tsx`; suites `override-confidence-honest-null-1613`, `AntiCheatNullGuard1726`, `admin/agents`.

**Scripts / journeys / docs:**
- `scripts/test-1664-curation-hazard.js` (updated), `e2e/journeys/` (README + candidate-journey + recruiter-journey — the user-perspective suites, staged for the staging journey run).
- `docs/sdlc/*` in the diff: the two Sumanth-batch PRDs (Assessments; Job Board + Profile), build logs, the interview-reschedule design, the documents-module **design doc only** for #1624 (no documents code — see Exclusions), and the **F-1 erasure keep/erase table fix** (`00-relearn/data/erasure-keep-erase-table.md`, from PR #1876).
- `tests/document-verification-omniscore-null.check.js` — #1759 runnable check (needs a real Postgres; see Gates for its run status).

## `server.js` — hunk-by-hunk (8 hunks in the staging→dev diff)

| # | Hunk (staging line) | Subject | Decision |
|---|---|---|---|
| 1 | ~19 Sentry init comment | #1180 comment-only expansion; the Sentry scrub wiring itself rode **14A** (already-trained area), no test asserts the comment | **NOT carried** — the only remaining server.js diff vs dev |
| 2 | ~500 `isCsrfPreservedPublicPost` + `hasAnyCredential` | #1328 CSRF semantics | carried |
| 3 | ~543 csrfProtection 401 branch | #1328 | carried |
| 4 | ~558 removal of early `app.use(csrfProtection)` | #1328 (middleware ordering) | carried |
| 5 | ~591 `app.use(csrfProtection)` after session middleware | #1328 | carried |
| 6 | ~617 email-queue processor payload mapping | #1520 (subject `lib/email-queue.js` in this train) | carried |
| 7 | ~1040 retention tick: `sweepPendingStorageDeletions` wiring + #1176 log line | #1172/#1176 storage sweep (function rode 14A; wiring suite in this train) | carried |
| 8 | ~2159 KNOWN_ROUTES gains `signup` | #1354 `/signup` alias (client route already on staging; SPA fallback must treat it as known) | carried |

Post-extraction verification: `git diff` of the train tree vs `origin/dev` for server.js is exactly hunk 1 and nothing else; `node --check server.js` PASS; `spa-known-routes-guard` suite PASS.

## `routes/interviews.js` — carried whole (7 hunks, listed)

14B extracted only the mock-end hunks and explicitly deferred the remaining 7 hunks "to a later interviews train". This is that train — 14C is the final remainder slice, every hunk's suite is in this train's diff, and the file is therefore carried byte-identical to dev:

1. `GET /:id/analysis` (~428) — #1377: NULL presentation scores excluded from the OmniScore average (suite `interviews-analysis-aggregate-1377`).
2. voice-respond (~2026) — #1179 log-redaction: ASR transcript content no longer logged (suite `log-redaction-interviews-route-1179`).
3. voice-respond (~2041) — #1179: SpeechRecognition fallback content no longer logged.
4. voice-respond (~2063) — #1179: Whisper hallucination content no longer logged.
5. `POST /screening/send` (~2944) — #923: company predicate on the application UPDATE (suite `interviews-screening-send-final-update-scope`).
6. screening-voice (~3324) — #1179: hallucination content no longer logged.
7. `POST /evaluate` (~3748) — #1505: null-safe `composite_score ?? null` (suite `interviews-evaluate-all-fail-1505`).

## Excluded / held (declared, with reasons)

- **`routes/documents.js` and `routes/candidate-documents.js` — EXCLUDED.** #1624-gated: Sumanth's forks on the documents module are still pending. Both files stay at their staging versions on this tree. (The #1624 *design doc* under docs/sdlc IS carried — documentation, not code.)
- **`server/__tests__/routes/document-stats-avg-authenticity-1611.test.js` — HELD** with its subject files above; it tests the documents routes and rides with them when #1624 is ruled in.
- **`docs/release/*` (module-versions.yaml + all prior train manifests) — NOT carried.** The dev↔staging delta there is an artefact of the registry living on staging; the registry rides a separate closeout PR, per the standing pattern. This manifest is the only docs/release addition.
- **server.js hunk 1** — see table.

## Gates run on the train tree (real output)

1. **Byte-identity:** all 102 full files verified identical to `origin/dev` 9db31d643 (per-file `git diff --quiet` sweep, 0 mismatches). Remaining train↔dev diff is exactly: the 2 excluded documents routes, the held document-stats suite, docs/release/* (untouched), and server.js hunk 1. Relative-require sweep over all carried server files: **NO MISSING RELATIVE REQUIRES**. Require-load: **16/16** carried libs/routes load (with `JWT_SECRET`/`SESSION_SECRET` set, the pre-existing env requirement).
2. **Syntax:** `node --check` PASS on all 61 changed `.js` files.
3. **Fresh-chain migrate (train tree, local PG16 cluster, real migrate.js):** PASS — exit 0, `All migrations completed successfully`, 0 error lines. Read-backs on the fresh DB: `_migrations` = 190 rows, 253 public tables. (This train carries no migration; the gate re-proves the full chain the tree ships with.)
4. **Scoped jest (server):** the 38 carried suites + `spa-known-routes-guard` — **38 passed, 1 skipped, 0 failed; Tests: 368 passed, 6 skipped, 374 total** (exit 0). In scope and passing: **`gap-f-send-guard` PASS** (the 14A-rescoped suite), `email-queue-send-path-1520`, `company-email-response-first-1359`, `company-transfer-ownership-response-first-1385`, `auth-register-pending-email-1353`, all log-redaction suites, all recordings suites, `questionnaire-evaluate-parse-failure-1571`, all interview-sessions and interviews suites, `csrf-401-1328`, `storage-sweep-wiring`, `undici-direct-dependency-1444`. The 1 skipped suite is `matching-stats-split-1728a`: env-gated by design (`describe.skip` unless `MATCHING1728A_INTEGRATION_DB_URL` is set — identical behaviour on dev). Spot-check outside scope: `spa-routes.test.js` (not carried) fails 142 tests on this tree and **fails identically (142 failed / 2 passed) on a clean `origin/staging` worktree** — pre-existing environmental failure (it boots the full app expecting a built client), not train-introduced.
5. **Client vitest:** carried set — **5 test files, 27 tests, all passed** (incl. AntiCheatNullGuard1726 8/8, whose job-assessment legs 14B had to hold).
6. **Client typecheck (`npx tsc --noEmit` in client/):** train tree **78 errors** vs staging base **63 errors** (staging measured on a clean `origin/staging` worktree). Signature-level diff (line/column stripped): the **only** additions are 15 errors in the one new carried test file `AuthSocialProofHonestClaims.test.ts` — all the vitest-globals class (`Cannot find name 'describe'/'it'/'expect'`, TS2582/TS2304/TS7006) that staging already carries in its sibling honesty suites (`AboutHonestClaims.test.ts` 22, `LandingHonestClaims.test.ts` 7, same pattern, no runner imports). The file is byte-identical to dev and passes vitest 7/7. **Zero new errors in any scoped non-test file**; the 2 scoped page errors (`job-detail.tsx` TS18047, `recruiter/interviews.tsx` TS2345) are byte-for-byte the pre-existing staging errors (line-shifted only). Declared here rather than fixed, because a fix would break byte-identity with the dev-proven file; the class is cosmetic (test-runner globals) and already endemic to the suite family.
7. **Guards:** `node scripts/check-no-simulated-typing.js` → `PASS: no simulated typing indicator in chat.tsx` (exit 0). `tests/document-verification-omniscore-null.check.js` (#1759) hardcodes the embedded-rig port 55433, which did not survive this VM's restart; its subject `services/document-verification.js` is **not** changed by this train (it rode 14B byte-identical), so the check is carried as content and its live run is listed as a staging-proof leg below rather than claimed here.

## Staging proof (after merge + deploy)

Deploy record + 3/3 agreeing /health samples; then Quinn's legs: (a) auth chain — register → pending-email state → login, plus `/signup` alias lands on register; (b) CSRF semantics — unauthenticated POST to a protected route returns 401 AUTH_REQUIRED, credentialed bad-CSRF returns 403; (c) email — company email + ownership transfer respond first and the templated email is logged/sent via the queue path; (d) candidate + recruiter journey suites (`e2e/journeys/`) re-run against staging; (e) recordings — playback page renders, purged recording shows the sentinel state; (f) log spot-check — no transcript/ASR content in staging logs for voice-respond/screening-voice; (g) documents read-back — `routes/documents.js` on staging is still the pre-14C version (exclusion held); (h) #1759 check run against the staging-shared DB rig. A leg that fails holds the train at staging and is reported with evidence.

## Main

Rides the next main train after staging proof lands. No version bump (no versioned module changes); registry patch-train log entry on closeout. With 14C, Train 14 is complete: after its staging proof and main ride, staging↔dev content delta should be only the #1624-gated documents files, the held document-stats suite, and server.js hunk 1.
