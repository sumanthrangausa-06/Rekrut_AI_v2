# S-D14 Build Log — Presentation-only fence guard (#1916)

**Story:** S-D14 — Presentation-only fence guard · **Design:** Architecture §6.2 · **PRD:** FR-D14 · **Lex:** BR-12 · **Gate:** synthetic fixtures only; no real recordings until S-D17 enablement
**Governing STOP 1:** issue #1916 comment 6480346247 (Nova, 2026-10-28).

## What was built

Tests and documentation only — no production code changes, no scoring/
matching/screening behaviour touched, `lib/erasureService.js` untouched.

- `server/__tests__/lib/diarizationFence-1916.test.js` (**AC-1**, §6.2
  way 2) — static dependency-direction fence in the style of
  `diarizationPinning-1907.test.js`, running in the repo's jest suite:
  - Set D (diarization): `lib/diarizationEngine/Jobs/Gate/Flag.js`,
    `lib/speakerMapping.js`, `lib/transcriptStitch.js`,
    `workers/diarization/index.js`, `workers/diarization/engine-child.mjs`.
    `lib/transcription.js` (shared pre-existing ASR) is excluded by design.
  - Set S (scoring): `routes/omniscore.js`, `routes/trustscore.js`,
    `routes/matching.js`, `routes/fitScore.js`,
    `routes/candidate-company-matches.js`, `routes/screening.js`,
    `routes/ai-screener.js`, `lib/recruiter-screener.js`,
    `lib/job-alert-matcher.js`.
  - Every `require()`/`import`/`export … from` specifier is resolved
    against the tree as Node resolves it (extension- and
    index-normalised) and compared by canonical path. Fails if an S
    module imports a D module, a D module imports an S module, or —
    repo-wide backstop — any non-test source file outside the allowlist
    (D-internal, `server/routes/recordings.js` presentation composition,
    `scripts/diarization-long-proof.js`) imports a D module. A
    set-completeness check (module trees only) fails if a new file's
    name marks it as a fence-side module without joining the sets.
- `server/__tests__/routes/recordings-fence-shape-1916.integration.test.js`
  (**AC-2**, §6.2 way 3) — real recordings router + real auth + real
  Postgres (local rig, cloned migrated DB), cloned from the S-D09
  suite's harness. Adversarial fixture: speaker 0 holds 9 of 10 timed
  segments (~90% share) and a `diarization_runs` row carrying
  `speaker_count`, `turns`, and the raw `proposed_mapping` exists in
  the DB. Asserts exact key sets (transcript, segments, `diarization`
  block, `speakers[]`, the whole `GET /:id/speakers` payload),
  recursively scans diarization-owned surfaces for forbidden quantity
  keys, asserts the `diarization` block carries no number except
  `speaker_number`, and checks recruiter AND candidate audiences.
  Precision (STOP 1): segment ASR `confidence` and `segment_count` are
  pre-existing legacy quantities (S-D09 byte-identical pin), not
  diarization-derived; `speakers[]` cardinality is the §5.1 panel,
  consciously accepted at S-D09 privacy review F-3.
- `docs/…/code-review-checklist.md` (**AC-3**) — the epic's Phase 4
  code-review checklist, created in this folder following the
  S-D09–S-D12 build-log pattern (no checklist file existed), with the
  fence review recorded explicitly (scope, evidence, verdict).

## Tests

Green on the shipped tree (Nova's runs, local PG rig 127.0.0.1:55433,
DB `sd14_e2e` cloned from the migrated `sd12_final`):
- AC-1 fence: **5/5 PASS**.
- AC-2 response shape: **4/4 PASS**.

Bite-proof (scratch violations, never committed, reverted with
`git checkout`; full outputs in the PR body):
- `require("../lib/speakerMapping")` appended to `routes/omniscore.js`
  → fence suite **FAILED** (2 tests), naming
  `routes/omniscore.js -> lib/speakerMapping` in both the direction
  check and the repo-wide backstop.
- `require("../routes/omniscore")` appended to `lib/speakerMapping.js`
  → fence suite **FAILED** (1 test), naming
  `lib/speakerMapping.js -> routes/omniscore`.
- `share: 0.9` inserted into the composed `speakers[]` in
  `server/routes/recordings.js` → response-shape suite **FAILED**
  (3 of 4; the unaffected `/speakers` editor test stayed green, as it
  should). After every revert both suites returned to full green.

Regressions (same runs):
- Diarization unit suites (flag, gate, jobs, engine, worker,
  pinning-1907, long-proof, migration 296): **85 passed / 3 skipped /
  0 failed**.
- S-D09 composition integration: **14/14**. S-D10 speaker-mapping
  integration: **11/11** (both on `sd14_e2e`).

## Specialist reviews

Recorded in the PR body ("Specialist Reviews") and in
`code-review-checklist.md`. STOP 1 decision: `ecc/architect` consulted
on the fence design (curated sets + repo-wide allowlist backstop);
independent review by a reviewer subagent (ecc/code-reviewer with
ecc/pr-test-analyzer lens) on the PR diff — see the PR for the verdict
and dispositions.

## Deviations from STOP 1

One scoping correction inside the AC-1 test itself, made during the
red phase: the set-completeness name scan initially covered `scripts/`
and flagged the allowlisted proof harness; it now covers module trees
(lib/routes/server/workers/agents). The direction checks and the
repo-wide importer backstop were not changed.
