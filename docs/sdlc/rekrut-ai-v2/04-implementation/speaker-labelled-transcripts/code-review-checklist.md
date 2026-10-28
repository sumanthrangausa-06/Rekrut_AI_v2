# Phase 4 Code-Review Checklist — Speaker-labelled transcripts epic (#1900)

One entry per story, recorded at its Phase 4 gate. Each story's full
review narrative lives in its build log in this folder; this checklist
is the epic-level record the PRD asks for (FR-D14: the presentation-only
fence is "verified by code review at the Phase 4 gate" — that entry is
recorded explicitly below, under S-D14).

| Story | Issue | Independent review | Verdict / disposition | Record |
|---|---|---|---|---|
| S-D02 | #1904 | Yes | Merged; see build log | `s-d02-build-log.md` |
| S-D03 | #1905 | Yes | Merged; see build log | `s-d03-build-log.md` |
| S-D05 | #1907 | Yes | Merged; see build log | `s-d05-build-log.md` |
| S-D07 | #1909 | Yes | Merged; see build log | `s-d07-build-log.md` (in `04-implementation/`) |
| S-D08 | #1910 | Yes | Merged; see build log | `s-d08-build-log.md` |
| S-D09 | #1911 | Yes — code reviewer + privacy specialist | APPROVE-WITH-MINORS, then privacy **BLOCK F-1** (corrected-by read was action-blind); fixed in-story with the specialist's prescribed fixtures; minors F3/F4c/F5a fixed, F2 accepted for v1 | `s-d09-build-log.md` |
| S-D10 | #1912 | Yes — code reviewer + security/privacy lenses | **BLOCK**: corrector gate derived from the wider company-scoped view access; fixed in-story (corrector set derived explicitly per §5.2) | `s-d10-build-log.md` |
| S-D11 | #1913 | Yes | Merged; see build log | `s-d11-build-log.md` |
| S-D12 | #1914 | Yes | Merged; see build log | `s-d12-build-log.md` |
| S-D14 | #1916 | Yes — see the fence review below | See below | `s-d14-build-log.md` |

## FENCE REVIEW — S-D14 (#1916), PRD FR-D14 / Lex BR-12 / Architecture §6.2

**Reviewer:** independent reviewer subagent (ecc/code-reviewer with
ecc/pr-test-analyzer lens), dispatched by Nova on the PR diff.
**First verdict: BLOCK** — the dependency scan's roots omitted
`services/` (home of `services/omniscore.js`, the OmniScore
computation service) and `client/`, and the specifier regex missed
backtick-quoted requires; plus three further minors (numeric-exemption
anchoring, `total` in the forbidden-key pattern, citation accuracy).
**All findings fixed in the same PR** (scan roots now cover every
shipped source tree; set S extended to the services + client scoring
surfaces; backtick specifiers scanned; new bite-proofs for the closed
holes — see `s-d14-build-log.md`), and the fence re-verified green on
the shipped tree with the reviewer re-checking the fix before merge.
Full record: PR #1942 "Specialist Reviews" + `s-d14-build-log.md`.

**Scope reviewed — the three enforcement ways of §6.2:**

1. **Schema (way 1, shipped earlier — re-verified by reference):**
   diarization artefacts live only in diarization-owned tables
   (migration 296, S-D03); speaking share is computed transiently in
   the S-D08 proposal and stored nowhere; no scoring/matching/
   evaluation table gained a diarization-fed column.
2. **Module dependency (way 2, built by this story — AC-1):**
   `server/__tests__/lib/diarizationFence-1916.test.js` scans every
   import specifier in the tree, resolves it as Node does, and fails
   if (a) any OmniScore / Trust Score / matching / screening module
   imports a diarization module, (b) any diarization module imports a
   scoring module, or (c) any non-test source file outside the explicit
   allowlist (diarization-internal, the recordings presentation
   composition, the long-proof harness) imports a diarization module.
   A set-completeness check stops the fence vacating by rename.
   **Bite-proof (red-first evidence, in the PR body):** a scratch
   `require("../lib/speakerMapping")` added to `routes/omniscore.js`
   failed the suite naming `routes/omniscore.js -> lib/speakerMapping`
   (2 tests); a scratch scoring import added to `lib/speakerMapping.js`
   failed naming the reverse edge (1 test); both probes were removed
   uncommitted and the suite passes 5/5 on the shipped tree.
3. **API response shape (way 3, built by this story — AC-2):**
   `server/__tests__/routes/recordings-fence-shape-1916.integration.test.js`
   exercises the real recordings router + real auth + real Postgres
   with an adversarial fixture (speaker 0 ≈ 90% of timed segments; a
   `diarization_runs` row carrying `speaker_count`, `turns`, and the
   raw `proposed_mapping` present in the DB). It pins the exact key
   sets of the transcript object, segments, the `diarization` block,
   `speakers[]` entries, and the whole `GET /:id/speakers` payload;
   scans recursively for forbidden quantity keys (share, ratio,
   turn/speaker counts, percent, speaking time, diarization
   confidence); and asserts the `diarization` block carries no numeric
   value except `speaker_number`, for recruiter AND candidate
   audiences. **Bite-proof:** a scratch `share: 0.9` field added to the
   composed `speakers[]` failed 3 of 4 tests; removed uncommitted; the
   suite passes 4/4 on the shipped tree.
   Precision note: segment-level ASR `confidence` and the transcript
   `segment_count` are pre-existing legacy fields (byte-identical on
   pre-feature recordings, pinned by S-D09) — not diarization-derived,
   and consciously outside the quantity ban; `speakers[]` cardinality
   is the §5.1-specified panel, consciously accepted in the S-D09
   privacy review (F-3). Per-speaker quantities remain banned.

**Fence verdict:** the fence holds on the shipped tree and is proven
to bite in both directions and on the API surface. Any future surface
that wants a diarization-derived number must come back through a new
PRD decision (FR-D21 stays deferred).
