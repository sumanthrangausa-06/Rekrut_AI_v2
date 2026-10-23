# #1752 — explainMatch unguarded embedding refresh 500s every uncached pair (build log)

**Defect:** In `services/matching-engine.js`, `explainMatch`'s on-demand
branch called `await updateCandidateEmbedding(candidateId)` and
`await updateJobEmbedding(jobId)` unguarded before
`findMatchingCandidates`. `generateEmbedding` throws when no 1536-dim
embedding leg is live (and the embedding upsert can throw PG 22000 on
wrong-dimension vectors), so `GET /api/matching/explain/:candidateId/:jobId`
500'd for every uncached pair and never reached the honest no-match
fallback shipped by #1748 (`weighted_score: null`).

**Root cause:** The two refresh calls were the only unguarded embedding
calls in the file. Their siblings already tolerate embedding absence:
`findMatchingCandidates` wraps `updateJobEmbedding` and
`findMatchingJobs` wraps `updateCandidateEmbedding` in try/catch +
`console.warn` and continues with whatever embeddings exist.
`explainMatch` was missed when that pattern was established.

**Fix (minimum, matching the sibling pattern):** Wrap each of the two
refresh calls in `explainMatch` in its own try/catch with the same
warning wording as the siblings (`Failed to update candidate/job
embedding for <id>:`, `embedErr.message`) and continue to
`findMatchingCandidates` with whatever embeddings exist. No change to
`findMatchingCandidates`, no new error shape, no change to the #1748
fallback.

**User-visible behaviour change:** With the embedding provider down, an
uncached explain request no longer 500s — it returns the computed match
from any pre-existing embeddings, or the honest no-match result
(`match_level: 'none'`, `weighted_score: null`).

**Tests:** `server/__tests__/services/matching-engine-explainmatch-embedding-guard-1752.test.js`
— real-DB integration suite mirroring the #1748 harness, with the only
mock being `lib/ai-provider` whose `generateEmbedding` rejects (the
no-provider state). Candidates carry full profiles so the refresh
actually attempts generation. Red-first: 2/2 failed on pristine
`origin/dev` (ef8418382) with the throw escaping at
`services/matching-engine.js:814`; green after the fix: 2/2 — one
no-match fallback case, one pre-existing-embedding computed-match case
(weighted_score 88.89, same geometry as #1748/#1724).

**Neighbour suites:** matching-engine 1748/1717/1724 integration suites
and the matching explain/matches route suites (1468, 1479, 1463, 1271 ×2)
all pass. `score-explainer-match-results-1458` has 2 pre-existing
failures (expects weights_hash `v2-match-results`, code now produces
`v3-omni-scores-split`) — verified identical on pristine dev with this
fix stashed; unrelated to this change.
