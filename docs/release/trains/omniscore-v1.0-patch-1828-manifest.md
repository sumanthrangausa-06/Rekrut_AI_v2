# Train 6 patch manifest — #1828 explain-endpoint fix → staging

**Relay (release persona) — Train 6 hold-clearing patch (2026-10-24).**
Train 6 (OmniScore v1.0, PR #1826) merged + deployed to staging but its
Quinn retest step 3c FAILED: `GET /api/matching/explain/:candidateId/:jobId`
500s for every authorized caller when no cached match exists. The train
holds at staging (no tag, no registry close-out, no main move) until this
patch lands and step 3c re-runs green.

## Root cause (first-hand; STOP 1 on #1828)

Train omission, not a dev defect. Staging's `explainMatch`
(services/matching-engine.js) still calls `updateCandidateEmbedding` /
`updateJobEmbedding` unguarded; when no embedding leg is live on staging
(openai_embed key rejected 401 → circuit open; NIM embed legs not
configured), `generateEmbedding` throws and the request 500s before
reaching the #1748 honest fallback. Dev fixed exactly this in #1752
(embedding-refresh guards) + #1755 (candidate existence pre-check), but
neither PR (#1754 / #1757) ever rode a train to staging.

Staging server log for the reproduced ref (fresh candidate 249, job 197):
`Explain match error: AuthenticationError: 401 … at updateJobEmbedding
(matching-engine.js:207) → at explainMatch (matching-engine.js:815) →
routes/matching.js:222`.

## Picks (2, dev order)

- ba839ff29 — #1752 guard (PR #1754) → picked as f287c2985, patch-id
  f8ad44a1d47b894f2d37bf43bcd1e51dce847ecc (identical).
- b8428976c — #1755 existence pre-check (PR #1757) → picked as 3513d62bc,
  patch-id f03ac33e7924f0eb2d7e23098970e36559e4d812 (identical).

After the picks, `services/matching-engine.js` is byte-identical to dev
tip. Diff vs staging: 4 files (service + the two real-DB suites + the
#1752 build log). No migrations.

## Pre-merge evidence (first-hand, train tree)

- RED on staging code: the #1752 suite (copied in untracked) fails 2/2
  against the pre-pick tree.
- GREEN on train tree (local PG16, real DBs): #1752 suite 2/2 PASS,
  #1755 suite 2/2 PASS. Same suites also PASS on dev tip.
- The only mock in the suites is the external embedding API (stubbed to
  reject, simulating the staging provider state); all SQL, scoring and
  persistence are the real code path.

## Retest plan (after merge + deploy)

Re-run Train 6 retest step 3c ONLY, first-hand against staging:
candidate-self explain for an uncached pair → 200 with the honest
no-match shape (candidate-safe projection, weighted_score null);
owning-recruiter explain for the same pair → 200 with the full honest
explanation; non-self candidate → 403 (unchanged). On full pass: tag
`staging/omniscore@v1.0`, registry close-out, #1828 closure.
