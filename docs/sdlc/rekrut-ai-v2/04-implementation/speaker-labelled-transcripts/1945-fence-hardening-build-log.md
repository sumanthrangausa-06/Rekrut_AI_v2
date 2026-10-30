# #1945 Build Log — Diarization fence hardening (follow-up to S-D14 / #1916)

**Issue:** #1945 · **Governing STOP 1:** issue #1945 comment 6515207119
(Lead, advance run 2026-10-29 21:43 PT) · **Branch:**
`nova/1945-fence-hardening` · **Scope:** test/guard code + docs wording
only — no production code, no schema/migration, no flag, no promotion.

## STOP 1 summary

The scores-lock fence (diarization labels can never feed OmniScore /
Trust Score / matching) passed on the then-current tree, but the S-D14
reviewer's probes P1–P5 evaded it, and its header/checklist wording
claimed more than it guarantees. This lane: (1) bans dynamic/computed
import forms in fence-side (set-S/set-D) files, (2) widens the
set-completeness vocabulary with `score|evaluat|rank`, dispositioning
newly flagged existing files honestly, (3) narrows the claim wording
in the fence header and the epic code-review checklist, disclosing
segment-level share derivability and the unexercised
`PUT /:id/speakers/mapping` response shape.

**Specialist decision (from STOP 1, mandatory question): YES.**
Security reviewer is mandatory — the fence is a security/privacy guard
(Lex BR-12, presentation-only), and hardening a guard without a
security lens risks a guard that looks stronger than it is; the
reviewer must re-run P1–P5 against the hardened fence. Privacy is
consulted via that review for the claim wording. **Status at PR time:
security review PENDING — a separate reviewer runs on the PR after it
opens; this log does not claim it.** Skipped: database (no schema/SQL),
UX (no surface), Rex design (one-point guard fix; the issue is the
settled design — STOP 1 suffices per documentation-first rule 4).

## Baseline finding — the fence was already RED on dev (pre-existing debt)

Before any hardening edit, on dev tip `1e6cb6934`:

```
npx jest server/__tests__/lib/diarizationFence-1916.test.js
→ 3 passed / 2 failed
  ✕ repo-wide: only the allowlist imports diarization modules
      lib/diarizationEnqueue.js -> lib/diarizationJobs / diarizationFlag / diarizationGate
  ✕ set completeness
      diarization?: lib/diarizationEnqueue.js
```

`lib/diarizationEnqueue.js` (S-D19, #1956) is a genuine diarization
module — it imports `diarizationJobs`/`diarizationFlag`/`diarizationGate`,
and its only non-test importer is the allowlisted
`server/routes/recordings.js` — but it was in neither set D nor the
importer allowlist. Disposition: added to `DIARIZATION_MODULES`
(which also allowlists it as an importer, as a D-internal module).
Recorded here as pre-existing fence debt found at baseline, not as
damage from this lane. Re-verified first-hand by this lane (same
3 passed / 2 failed result).

## RED evidence — evasions against the pre-hardening fence

Method for every probe: plant → run the fence test → record → remove
plant → verify the file is clean (`git checkout` / delete scratch).

- **P1 (prior lane, summarised from its /tmp evidence, not committed):**
  planted `import("../lib/speakerMapping");` (no space after `import`)
  in `routes/omniscore.js`. The S→D test stayed **GREEN** (1 passed,
  4 skipped under the `-t` filter) — the specifier regex requires
  whitespace after `import`, so the dynamic import was invisible.
- **P2 (this lane):** planted
  `const _p2 = require('../lib/' + 'speakerMapping');` in
  `routes/omniscore.js`. S→D test stayed **GREEN** (1 passed, 4 skipped,
  exit 0) — only the `'../lib/'` fragment is captured as a specifier,
  which resolves to no diarization module.
- **P3 (this lane):** planted
  `const _p3 = require(path.join(__dirname, '../lib/speakerMapping'));`
  in `routes/omniscore.js`. S→D test stayed **GREEN** (1 passed,
  4 skipped, exit 0) — a computed specifier is invisible to the scan.
- **P4 (this lane):** created scratch `lib/evaluation.js` and planted
  `const _p4 = require('./evaluation');` in `lib/speakerMapping.js`
  (a set-D module). Full suite result was identical to baseline
  (3 passed / 2 failed, both failures the pre-existing Enqueue debt)
  with **zero mentions of `evaluation`** in the output — neither the
  reverse-edge test nor completeness flagged it, because the
  completeness vocabulary had no `evaluat`.

Also from the prior lane (relied on, not re-derived): a non-literal
`require(`/`import(` scan of all then-current set-S + set-D files found
**zero** hits, so the new ban needs no allowlist exception.

## Changes (GREEN)

File: `server/__tests__/lib/diarizationFence-1916.test.js`

1. **New check (a)** — `nonLiteralImports()` + test case
   *"no scoring or diarization module uses a dynamic or non-literal
   import (#1945)"*: scans every set-S/set-D file for
   `require(`/`import(` occurrences. `import(` is a violation outright
   (dynamic import banned in fence-side files). `require(` is allowed
   only with a single plain string-literal argument — the char after
   `(` must be a quote, a backtick argument must contain no `${`
   interpolation (a static template literal is literal, consistent
   with the existing `SPECIFIER_RE`), and the char after the closing
   quote must be `)`, which catches concatenation. Deliberately small:
   it does not parse JS, it only refuses forms the specifier scan
   cannot resolve exactly.
2. **Completeness vocabulary (b)** — the scoring pattern gains
   `score|evaluat|rank`.
3. **Sets (c)** —
   - `lib/diarizationEnqueue.js` → `DIARIZATION_MODULES` (baseline
     debt above).
   - `client/src/components/domain/score-ring.tsx` →
     `SCORING_MODULES` — renders a numeric score ring, used with
     matchScore; a real scored display surface.
   - `client/src/pages/recruiter/panel-scorecard-criteria.tsx` →
     `SCORING_MODULES` — weighted interview-evaluation criteria
     config; a real evaluation surface.
   Both were flagged by the widened vocabulary, both are real scoring
   surfaces (prior-lane evidence, spot-checked in this lane's set
   edit), and neither imports a diarization module, so the fence
   stays green with them in set S. No other existing file was flagged
   by the widened vocabulary, and no collision-list entry was needed.
4. **Header wording (d)** — the header now states the narrowed
   guarantee (current-tree static edges + realistic accidental
   coupling; NOT deliberately obfuscated imports — dynamic/computed
   forms are banned outright in S/D files, but synonym-named new
   modules remain a named residual) and discloses: (i) segment-level
   speaking share IS derivable — segments carry
   `speaker_number`/`start_time_ms`/`end_time_ms`, so per-speaker
   share is computable by summing durations; (ii) the fence-shape
   suite exercises only `GET /:id/transcript` and `GET /:id/speakers`
   — the `PUT /:id/speakers/mapping` response shape
   (`server/routes/recordings.js`) is NOT exercised.

File: `docs/sdlc/rekrut-ai-v2/04-implementation/speaker-labelled-transcripts/code-review-checklist.md`

5. **Checklist (3)** — the fence/S-D14 section gains the same narrowed
   claim wording and both disclosures, pointing at this build log.

No production file was changed; all planted probes were removed
uncommitted.

## MUTATION VERIFICATION — hardened fence vs the same probes

Each probe planted alone on the hardened tree, full fence suite run,
then removed:

| Probe | Plant | Result (hardened fence) |
|---|---|---|
| P1 | `import("../lib/speakerMapping");` in `routes/omniscore.js` | **FAIL** — 1 failed / 5 passed; new check names `routes/omniscore.js: dynamic import()` |
| P2 | `require('../lib/' + 'speakerMapping')` in `routes/omniscore.js` | **FAIL** — 1 failed / 5 passed; new check names `routes/omniscore.js: non-literal require() argument` |
| P3 | `require(path.join(__dirname, '../lib/speakerMapping'))` in `routes/omniscore.js` | **FAIL** — 1 failed / 5 passed; new check names `routes/omniscore.js: non-literal require() argument` |
| P4 | scratch `lib/evaluation.js` imported by `lib/speakerMapping.js` | **FAIL** — 1 failed / 5 passed; completeness names `scoring?: lib/evaluation.js` |
| — | all plants removed | **PASS** — 6 passed / 6 total |

## Suite results — final tree

```
npx jest server/__tests__/lib/diarizationFence-1916.test.js \
         server/__tests__/lib/diarizationPinning-1907.test.js \
         server/__tests__/lib/speakerMapping.test.js \
         server/__tests__/lib/transcriptStitch.test.js
→ Test Suites: 4 passed, 4 total · Tests: 54 passed, 54 total

# additionally, the remaining diarization unit suites:
npx jest server/__tests__/lib/diarizationEngine.test.js \
         server/__tests__/lib/diarizationFlag.test.js \
         server/__tests__/lib/diarizationGate.test.js \
         server/__tests__/lib/diarizationJobs.test.js \
         server/__tests__/lib/diarizationWorker.test.js
→ Test Suites: 5 passed, 5 total · Tests: 101 passed, 101 total
```

The fence suite itself is now 6 tests (was 5): all 6 pass, including
the new #1945 non-literal-import check. This is a static guard suite,
so the HL-003 fresh-install E2E gate does not apply to it directly —
its evidence standard is the red-first + mutation record above,
exercised against the real tree exactly as CI will run it.

## Review dispositions — independent security review of PR #1995

Reviewer (ecc/security-reviewer + privacy lens, a separate reviewer
who did not build this lane) verdict on head `decb99ae6`:
**APPROVE-WITH-MINORS** — no BLOCK, no MAJOR. Full review:
PR #1995 comment 6515433611. The reviewer re-ran probes P1–P5 plus
extras E1/E2 first-hand; the fence behaved as claimed in every case,
and P5 (synonym-named module) was confirmed as the disclosed
residual. Dispositions, worked in this lane on the same branch:

- **FIX-1 (review MINOR-1) — DONE.** A require literal containing a
  backslash escape evaded the fence: `require('../lib/speaker\u004dapping')`
  stayed green while Node resolves it to the real
  `lib/speakerMapping` module (the scan compares un-decoded text, and
  the non-literal scan's backslash-skip treated it as a clean literal).
  Fix, narrowest form: `nonLiteralInText()` (the text-level core of
  `nonLiteralImports()`, split out so the rule is unit-pinnable) now
  treats any backslash inside a `require()` literal as non-literal
  for set-S/set-D files. Pinned by a new fence test,
  *"non-literal scan pins the backslash-escape evasion (#1945 review
  MINOR-1)"* (escaped literal → violation; plain literal → allowed).
  No current set-S/set-D file legitimately has a backslash in a
  specifier — the full fence suite stays green with the rule active.
  **Mutation verification (this lane):** planted
  `const _u = require('../lib/speaker\u004dapping');` in
  `routes/omniscore.js` (line 658) → fence **FAIL** (1 failed /
  6 passed; new check names `routes/omniscore.js: non-literal
  require() argument`); plant removed → fence **PASS** (7 passed /
  7 total). The fence suite is now 7 tests (was 6).
- **FIX-2 (review MINOR-2) — DONE.** The fence header's residual
  wording now names the remaining deliberate-obfuscation forms the
  reviewer verified: a comment between callee and parenthesis
  (`require/*c*/('...')` — written with an escaped slash in the JS
  header because the literal form would terminate the block comment),
  require aliasing (`const r = require; r('...')`), and a no-space
  static import (`import"..."`). The same sentence is mirrored in
  `code-review-checklist.md`'s narrowed-claim wording so header and
  checklist stay consistent.
- **MINOR-3 — ACCEPTED as-is, no code change.** The non-literal scan
  is raw-text, so an `import(`/`require(` mention inside a comment or
  string in a set-S/set-D file false-positives. That is the safe
  direction for a fence (over-blocking, never under-blocking), and
  the reviewer verified zero such occurrences in current S/D files.
  Accepted.
- **MINOR-4 — ACCEPTED as-is, no code change.** Disclosure (ii) (the
  fence-shape suite does not exercise `PUT /:id/speakers/mapping`)
  under-claims coverage — the PUT response shares
  `speakerEditorPayload()` with the exercised GET and has its own
  integration suite. Under-claiming is the safe direction for a
  disclosure. Accepted.

Post-fix suite results (this lane):

```
npx jest server/__tests__/lib/diarizationFence-1916.test.js \
         server/__tests__/lib/diarizationPinning-1907.test.js \
         server/__tests__/lib/speakerMapping.test.js \
         server/__tests__/lib/transcriptStitch.test.js
→ Test Suites: 4 passed, 4 total · Tests: 55 passed, 55 total
```

## Residual risk (honest sentence)

The hardened fence guarantees the current tree's static edges and
realistic accidental coupling, and bans dynamic/computed import forms
inside today's fence-side files — but a future module named with a
synonym outside the completeness vocabulary (P5, e.g.
`lib/speakerLabels.js`), or obfuscation outside set-S/set-D files that
never touches a known diarization module, can still evade it, which is
why the header and checklist now claim no more than that.
