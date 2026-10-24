# #1787 — OmniScore tier label readers (stored metal vs API label) — Build Log

**Branch:** `nova/1787-tier-label-readers` (base: dev tip `97aacaee3`)
**STOP 1:** issue #1787 comment by Nova (STOP 1 — verified reader inventory,
specialist decision, fix shape); Scout verify-first verdict PARTIAL on the
same issue (stale-total hypothesis disproved).

## Root cause

`omni_scores.score_tier` is stored in a **metal vocabulary**
(`platinum/gold/silver/bronze/new`) — the deliberate storage encoding of
the API tier labels (`exceptional/excellent/good/fair/needs_work`), written
by `dbTierFromLabel()` in the same UPDATE as `total_score` in
`services/omniscore.js calculateScore`. A total of 592 is `Fair`, and its
correct stored tier is `bronze`. The writer and the storage are correct.

The defect was reader-side: surfaces consumed the stored metal as if it
were the label vocabulary —

- `routes/omniscore.js` leaderboard distribution ordered by a CASE over
  label names (every stored row fell to ELSE), and the payload handed
  metal values to a recruiter page keyed/rendered by labels.
- `routes/candidate.js` dashboard stats passed the stored metal through,
  so the candidate dashboard rendered `bronze — AI-powered rating`.
- `routes/candidateSearch.js` compared the caller's tier filter directly
  against the stored metal, so a `fair` filter could never match.

## Fix (read-boundary translation only — writer, storage, arithmetic untouched)

- `services/omniscore.js`: new exported `labelFromDbTier()` (the inverse of
  `dbTierFromLabel`); `tierFromScore`/`dbTierFromLabel` now also exported.
  Null/unknown stored values stay null — no fabricated label.
- `routes/omniscore.js` `/leaderboard`: candidate rows and distribution
  returned with label keys; distribution ordered by the metal band;
  `?tier=` accepts label vocabulary and is translated label → metal
  before comparing to storage (metal input still works).
- `routes/candidate.js` `/dashboard/stats`: `stats.omniscore.score_tier`
  translated metal → label.
- `routes/candidateSearch.js`: `score_tier` filter translated label →
  metal; search/semantic/preview rows returned with label tiers.

**User-visible change:** tier labels on the recruiter OmniScore page,
the candidate dashboard, and candidate search now read the API label
(e.g. `fair`) instead of the storage metal (e.g. `bronze`).

Pass-through readers inventoried at STOP 1 but intentionally unchanged
(recruiter pipeline JSON fields, memory trend, matching payload, AI
prompt strings) — separate follow-up if their consumers start
label-rendering them.

## Evidence

Real-DB suite `server/__tests__/omniscore-tier-label-readers-1787-realdb.test.js`
(fresh-install DB built only by `node migrate.js`; real HTTP via supertest
against the real routers): RED 6 failed / 1 passed before the fix
(dashboard returned `bronze` for the 592 candidate; both label filters
matched nothing), GREEN 7/7 after. Neighbour suites: mocked omniscore set
75 passed / 0 failed; real-DB neighbours (#1596/#1776/#1777/#1781/#1782)
16/16 passed.
