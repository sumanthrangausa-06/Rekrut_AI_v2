# Train 6 manifest — omniscore v1.0 → staging

**Relay (release persona) — promotions-first lane (Sumanth, 2026-10-24).**
Standing promotion authorization 2026-10-22; dual-environment rule applies:
staging journey/browser proof BEFORE any main move. A module that fails
staging proof holds at staging.

## Why

OmniScore is the next train in the standing order (cv-review v2.1, jobs-careers
v1.0 and assessments v1.0 all closed current on staging 2026-10-24). Staging
still runs the pre-honesty score code: the #1152 reader repoints, the
#1538/#1715–#1731 honest-NULL chain, the #1776/#1777 measured-only reliability
and total, the #1780–#1803 interview-vocabulary chain, and migration 290
(#1280 DROP DEFAULT, founder-approved 2026-10-22) are all dev-only. The
#1785 explainer blocker cleared 2026-10-23 (PR #1793, in this train).

## Picks (47 PRs attempted, dev merge order)

Predecessor chain (decision-explain / matching privacy, required by the
#1152 repoints): #1455, #1461, #1464, #1478, #1482, #1519.
OmniScore core: #1507 (#793), #1529, #1530, #1531, #1532, #1534, #1535,
#1536, #1545, #1546 (#1538), #1714 (migration 290), #1729 (#1717), #1734
(#1725), #1735 (#1724 TrustScore), #1743, #1746, #1749 (#1731 lanes 1–3),
#1750, #1753, #1758 (#1596), #1763, #1766, #1767 (#1728), #1778 (#1776),
#1784 (#1777), #1786 (#1783), #1791 (#1782), #1793 (#1785), #1792 (#1789),
#1795 (#1781), #1797 (#1787), #1796 (migration 293, #1788), #1799 (#1779),
#1800 (#1798), #1509 (#1504), #1802 (#1801), #1805 (#1541), #1813 (#1780),
#1814, #1816 (#1803).

- **46 commits landed; #1719 SKIP** — its diff is empty on this tree (the
  #1715 legs already rode Train 5 to staging).
- **2 conflicts, both resolved by keeping the exact dev-side content**
  (missing-predecessor hunks carried in the pick): #1749 (routes/matching.js
  — candidate-safe projection + Lane-3 confidence helpers) and #1509
  (routes/interviews.js — session-id resolver + finiteScore helper).
  After the #1478/#1482 dependency picks, `routes/matching.js`,
  `services/omniscore.js`, `services/scoreExplainer.js` and
  `routes/omniscore.js` are **byte-identical to dev tip**.
- File-set diff vs staging: 93 files (picks' union + this manifest/registry).

## Migrations carried (2)

- **290** DROP DEFAULT on 28 fabricated score columns (#1280 + #1270 rider;
  founder-approved 2026-10-22). Contractive-by-default-removal only; no
  existing rows touched.
- **293** widen scheduled_interviews status CHECK to the canonical union
  (#1788) — expand-only.

## Pre-merge evidence (first-hand, train tree)

- Server jest batches (--runInBand --forceExit): omniscore factors / honest
  nulls / #1538 / #1777 / #1776 — **5 suites, 70/70 PASS**; chain + trustscore
  + compat + explainer + disjoint + rescheduled batches — **PASS except
  `score-explainer-match-results-1458` (2 tests)**; routes batches
  (allowlist #1468, authz #1479, Lane-3, analytics repoint, dead-code,
  mutual-matches, trustscore access, #1523) — **7 suites, 74 PASS**.
- **Known dev-parity failure (not a train regression):** the #1458 suite
  expects weights_hash `v2-match-results` while dev tip code (identical
  test file, identical v3 hash code verified by archive comparison)
  produces `v3-omni-scores-split` since the #1536 R4 repoint. The suite
  fails identically on dev tip. Rider: file a test-hygiene follow-up to
  re-pin the suite to v3 (same class as #1823).
- Fresh-install (local PG, DB dropped after): `node migrate.js` exit 0,
  all migrations applied incl. 290 (post-state verified: omni_scores
  total_score column_default NULL) and 293 (status CHECK present).

## Retest plan (after merge + deploy, Quinn witnessed by Relay)

1. Fresh candidate on staging: OmniScore page/API returns honest NULL /
   insufficient-data (no 300/500 fabrication, no starter score).
2. Candidate with measured factors: total renormalises over measured
   factors only; explainer factor_breakdown agrees with the total (#1785).
3. Recruiter surfaces: /candidates/full honest NULL (#1725); matching
   /stats split fully-measured vs renormalised (#1767); explain endpoint
   candidate-self allowlist + non-self authz (#1468/#1479).
4. Migration read-back on the shared DB: the 28 columns' defaults are
   NULL; scheduled_interviews accepts the canonical status union.
5. Neighbour surfaces: Train 3/4/5 surfaces still green (CV parse,
   Job Board, Assessments catalogue).

Partial = FAIL: tag `staging/omniscore@v1.0`, registry close-out and any
main move wait for a full pass. **Do not merge until independent review
approves.**
