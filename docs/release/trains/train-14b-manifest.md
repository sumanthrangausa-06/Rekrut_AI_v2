# Train 14B — Honesty / score integrity → staging

- **Scope (issue #1867 slice 14B):** the dev-proven honesty/score-integrity wave that never rode a module train: fabricated-fallback removal across the AI provider layer, quick-practice provider cascade, recruiter-screener guards, screening-route ownership, interview/QA/job-optimizer/document-verification honesty, the client pages tied to those surfaces, migration 275, and (panel amendment C2) a hunk extraction from `routes/interviews.js` covering only the mock-end fabricated-score region — 67 files plus this manifest. Every full-file scope entry is byte-identical to its dev version (verified file-by-file vs `origin/dev`: diff = 0 lines; `git diff origin/staging --stat` lists only scope files). `routes/interviews.js` is the single partial file — see the C2 section.
- **Base / tip:** built off `origin/staging` c6eaa33b1; dev source `origin/dev` 7058f76d4.

## Files and purpose

**AI provider layer — fabricated fallbacks removed (honesty wave #1357/#1364/#1372/#1377/#1387):**
- `lib/polsia-ai.js` — #1372/#1377: fabricated fallback scores deleted; honest null on AI failure.
- `lib/qp-ai.js` — #1364: fabricated quick-practice fallbacks deleted.
- `lib/ai-provider.js` — cascade/proxy hardening #1406/#1418/#1419/#1438; Deepgram confidence honesty #1628.
- `lib/proxy-env.js` — **panel-approved addition (Rex panel condition C1):** new on dev, required at top level by `lib/qp-provider.js`, `lib/ai-provider.js`, `lib/polsia-ai.js`; without it the train breaks module loading on staging. Self-contained (node:http/https + `https-proxy-agent`, already in staging's package.json). Byte-identical to dev — blob `8fdf4179a` verified on the train tree.

**Quick-practice provider cascade (#1414/#1424/#1432/#1437/#1484/#1486):**
- `lib/qp-provider.js` — cascade proxy #1414, NIM/Groq legs #1424, race recording #1432, sequential recording #1437, AI_KEYS_JSON #1484, OpenAI gate #1486.

**Recruiter screener (#1338/#1345/#1346 + audit anchor #1145):**
- `lib/recruiter-screener.js` — chat-fallback guard #1338, unguarded-chat fix #1345, batch pairing #1346.
- `routes/ai-screener.js` — screener route + #1145 audit anchor.

**Screening ownership (#1366/#1373/#1379/#1382):**
- `routes/screening.js` — batch skills normalisation #1366, questions skills normalisation #1373, questions ownership #1379, compare ownership #1382.

**Interview / QA / job / document services (honesty wave + #1512/#1569/#1570/#1580/#1581/#1586):**
- `services/interview-ai.js` — multi-eval honesty; report-fallback honesty #1512.
- `services/qa-extraction.js` — rubric honesty #1512.
- `services/job-optimizer.js` — analyze honesty #1570; fit/salary honesty #1580/#1581.
- `services/document-verification.js` — #1569 verification honesty; #1586 null authenticity score (never a fabricated number).
- `routes/quick-practice.js` — practice submit #1352, video submit #1357 honesty.

**Migration (expand-only):**
- `migrations/275_verification_documents_pending_review_status.js` — widens the `verification_documents` status CHECK to admit `pending_review` (expand-type CHECK widening; no drops, no shrinks; inert to current staging/production code, safe on the shared DB). Dev-only file, added.
- **Sequencing (panel note C4):** migration 275 rides in this same train as `services/document-verification.js` — the service change that writes the `pending_review` status and its migration land together; neither ships without the other.

**Panel amendment C2 — `routes/interviews.js` hunk extraction (NOT the whole file; Train 14A server.js precedent):**
- Only the mock-end / session-feedback region was extracted from dev: the 7 staging→dev diff hunks whose context is `router.post('/mock/:sessionId/end', …)` (staging-side hunk starts 1077, 1090, 1107, 1163, 1249, 1298, 1335). They remove every fabricated-score persistence in that region — all `overall_score || 5` fallbacks and hard-coded `overall_score: 5` writes (staging carried them at lines 1082, 1114, 1177, 1302, 1320, 1339 plus the `score: 5` fallback blocks at 1093–1101 and 1346–1348; dev has zero).
- **Post-extraction verification (train tree):** `grep -c "overall_score || 5"` = **0**; `grep -c "overall_score: 5"` = **0**; `node --check routes/interviews.js` PASS; require-load PASS (with `JWT_SECRET` env, as for the other routes); the applied diff vs staging is exactly the 7 selected hunks, and the remaining diff vs dev is exactly the 7 untrained hunks below.
- **Explicitly NOT trained — the remaining `routes/interviews.js` hunks ride a later interviews train:** (1) `GET /:id/analysis` (~428) #1377 aggregate presentation score — NULL rows excluded from the OmniScore average (this train keeps staging's `|| 0` averaging there); (2–4) voice-respond route (~1979, ~1994, ~2016) log-redaction — ASR/SpeechRecognition/Whisper content no longer written to logs; (5) `POST /screening/send` (~2895) #923 company predicate on the application UPDATE; (6) screening-voice route (~3272) log-redaction — Whisper hallucination content; (7) `POST /evaluate` (~3694) null-safe `composite_score ?? null`.
- The C2 verification suite `server/__tests__/routes/interviews-mock-end-fabricated-scores-1372.test.js` is carried and passes 7/7 on the train tree. The other two interviews suites (`interviews-analysis-aggregate-1377`, `interviews-evaluate-all-fail-1505`) test untrained hunks (1) and (7), fail on this tree (3 tests), and ride the later interviews train with them.

**Accepted exception (panel decision C3, recorded by Suga as panel lead):**
- The #1338 basic-fit exception in `lib/recruiter-screener.js` is **ACCEPTED as designed**: it is pre-existing staging behaviour, deterministic from real data, and labelled 'Basic automated screening'. It is not a fabricated score and is not changed by this train.

**Client pages tied to the surfaces above:**
- `client/src/pages/candidate/quick-practice-session.tsx` (#1352/#1357/#1371/#1378 session honesty + retry clamps), `client/src/pages/candidate/company-matches.tsx` (match-explanation surface #1463 client side), `client/src/components/domain/SessionReport.tsx` (#1512 honest-null report), `client/src/pages/candidate/interview-analysis.tsx`, `client/src/pages/candidate/interview-results-page.tsx`, `client/src/pages/candidate/ai-coaching-progress.tsx` (honest-null score displays), `client/src/pages/candidate/aptitude-test-results.tsx`, `client/src/pages/recruiter/aptitude-test-results.tsx` (#1726 anti-cheat honest-null rendering).

**Test suites carried (44):** server (37) — interviews mock-end fabricated scores (#1372, the C2 extraction suite), ai-provider cascade/proxy/seam/deepgram (1406/1418/1419/1438/1628), polsia fallbacks (1372/1377), qp-ai fallbacks (1364), qp-provider cascade/keys/NIM-Groq/OpenAI-gate/race/sequential (1414/1424/1432/1437/1484/1486), qp-voice-clamp (1377), recruiter-screener (1338/1345/1346), migration 275, omniscore-compat-null (#1596), ai-screener audit anchor (#1145), batch-screening pairing (#1346), qp-practice-submit (1352/1357), screening (1366/1373/1379/1382), score-explainer match results (#1458) + EU explanation (#1462; subject services byte-identical on staging — EU service rode 14A), document-verification (1569/1586), interview-ai honesty + #1512, job-optimizer fit/salary (1580/1581), qa-extraction #1512. Client (7) — session-report honest-null #1512, CandidateAptitudePendingState, quick-practice-session (1352/1371/1378/1357), voice-null-safe #1387.

## Declared scoping boundaries (14A gap-f precedent)

- **`lib/proxy-env.js` is the one dependency-driven scope addition, approved by the Rex panel as condition C1.** Three in-scope dev files `require('./proxy-env')` at load time and the module does not exist on staging; without it the trained provider layer cannot load at all (verified: `Cannot find module './proxy-env'`). It is carried byte-identical (blob `8fdf4179a`) and resolves the panel's BLOCK-as-scoped on this point.
- **Four dev test suites do NOT ride this train** — their failing legs test files outside 14B scope, and they ride with their subject files:
  - `server/__tests__/candidate-score-fallbacks-1377.test.js` — 8 failing tests, all against `routes/candidate.js` (differs on staging; not 14B scope).
  - `server/__tests__/routes/candidate-match-explanation-1463.test.js` — 2 failing tests; the #1463 endpoint lives in `routes/candidate.js` (staging's handler still feeds `match_explanation` into the LLM prompt). The client side (`company-matches.tsx`) IS in this train.
  - `server/__tests__/services/job-optimizer-analyze-honesty-1570.test.js` — 1 failing test statically asserting a `Number.isFinite` guard in `routes/recruiter.js` (not 14B scope); the suite's job-optimizer service legs pass.
  - `client/src/__tests__/pages/AntiCheatNullGuard1726.test.ts` — 2 failing tests asserting on `client/src/pages/recruiter/job-assessment.tsx` (not 14B scope); its legs against the in-scope `recruiter/aptitude-test-results.tsx` pass.
- **Not touched, per #1867 slice rules:** `routes/documents.js` (#1624 gated), `routes/matching.js` / `routes/recruiter-introductions.js` (already byte-identical staging↔dev), auth pages, assessments files, email-queue/email-service (all Train 14C), and `server.js` (no scoped file needed a server.js hunk — verified by the load gate below). Other differing dev tests (interviews routes, recordings, log-redaction, company/auth routes, admin pages) test surfaces outside this slice and were excluded.

## Gates run on the train tree (real output)

1. **Syntax/load:** `node --check` PASS on all 13 scoped server files (4 services, 5 lib, 3 routes, migration 275). Require-load PASS 14/14: libs/services/migration load bare; the 3 routes load with `JWT_SECRET` set (pre-existing `lib/auth.js` env requirement, not a code dependency). Before the proxy-env addition, load failed verbatim with `Error: Cannot find module './proxy-env'` from `lib/qp-provider.js` — the only missing relative dependency in the scoped set (full relative-require sweep of all 12 scoped server files: 3 hits, all `./proxy-env`).
2. **Scoped jest (server):** final carried set — **37 suites, 238 tests passed, 8 skipped, 0 failed (246 total)** (the original 36 suites at 231 passed, plus the C2 suite `interviews-mock-end-fabricated-scores-1372` at 7/7). First run including the 4 boundary suites above: 240 passed / 11 failed / 8 skipped of 259 — every one of the 11 failures traced to an out-of-scope subject file (listed under Boundaries), none to a carried file. C2 spot-checks: the two interviews suites covering untrained hunks fail on this tree (3 tests), confirming they belong to the later interviews train.
3. **Client vitest:** carried set — **7 test files, 28 tests, all passed**. With AntiCheatNullGuard1726 included: 34/36 passed, its 2 failures being the out-of-scope job-assessment legs.
4. **Client typecheck (`npx tsc --noEmit` in client/):** train tree **63 errors** vs staging base **119 errors** (staging measured on a clean `origin/staging` worktree) — net −56, and **zero new errors in scoped files**: the only scoped-file errors are 2 TS2367 in `quick-practice-session.tsx` (lines 913/928) that are the identical pre-existing errors on staging (lines 860/875, shifted by the carried diff).

## Excluded / deferred

- The 4 boundary test suites above ride with `routes/candidate.js`, `routes/recruiter.js`, and `job-assessment.tsx` in their own slices.
- No version bump (no versioned module changes); registry patch-train log entry on closeout.
- **Staging proof (after merge + deploy):** deploy record + /health samples; shared-DB read-back that the `verification_documents` status CHECK admits `pending_review` after migration 275 applies via the staging deploy's migrate step (expand-only, inert to current production code); journey legs per Quinn: quick-practice session end-to-end, screening ownership (cross-company compare/questions refused), document-verification honest-null state, match-explanation client surface.
- **Main:** rides the next main train after staging proof lands.
