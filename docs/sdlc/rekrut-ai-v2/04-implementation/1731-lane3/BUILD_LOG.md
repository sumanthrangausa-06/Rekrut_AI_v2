# Build log — #1731 Lane 3 (S-8/S-9/S-10/S-11 + dashboard sibling)

- **Issue:** #1731 (score-honesty siblings from the #1725 STOP 1 sweep)
- **Lane:** 3 of 3 — the sweep remainder. Lane 1 = PR #1743, Lane 2 = PR #1746.
- **Panel spec:** DISCUSSION.md §2.8–§2.11 (adopted at STOP 1 on the issue).
- **Persona:** Lead coordinating; Nova builds; independent code-reviewer
  reviews; Quinn runs the fresh-install journeys.

## What changed

| Site | File | Change |
|------|------|--------|
| S-8 | `routes/matching.js` | Audit-log `confidence` (×3 sites) now records the measured `weighted_score` producers actually carry (new `maxMeasuredConfidence` helper; explain site reads `explanation.weighted_score`). No measured score → `confidence: null`. The old expressions read non-existent `final_score`/`score` fields and fabricated `0` for every real match set and an invented `0.5` for explanations — into compliance audit records. |
| S-9 | `routes/memory.js` | Match-breakdown: `overall_score: match.weighted_score ?? null`; skills dimension `score: null, available: false` when there is **no match row** (a present row computes from its skill ratio, measured 0 included); OmniScore components `?? null` ×4 — consistent with the same object's already-honest `total: omni.total_score ?? null` and its interview/assessment `available:` precedent. |
| S-10 | `lib/career-coach-ai.js` | Company-brief prompt: TrustScore components render `?? 'N/A'` ×5 (mirroring the total's honest rendering in the same template). Measured 0 still renders `0`. |
| S-11 | `routes/recruiter-introductions.js` | Both cached branches: a NULL `weighted_score` is **no evidence** — `fitScore` stays null, `isTopFive` stays false, the existing 403 `NOT_TOP_FIVE` carries it, and no fabricated 0 can be persisted as `fit_score_at_request`. |
| #1744 item 3 | `client/src/pages/recruiter/dashboard.tsx` | Adjudicated in this lane as assigned: `matchScore: app.match_score \|\| 0` did rewrite NULL → 0 in the pipeline data model (display was masked only by the truthiness badge guard). Fixed: `?? null` + PipelineStage candidate type widened to `number \| null`. |

## Evidence

- Red-first real-DB suite `server/__tests__/routes/score-honesty-1731-lane3.test.js`:
  RED 7 failed / 2 passed on pristine dev `7746bdf35` → GREEN 9/9 after the fix.
  The 2 pristine-passing tests are the S-11 pair: they are behaviour
  guards, recorded honestly — the panel itself noted S-11's gate outcome
  was already the safe one; the defect was the fabricated-0 assertion in
  the code path (and its persistence risk one threshold-edit away).
- Neighbour suites: 54/54 (1731 Lane 1 + Lane 2, #1725, #1717,
  matching-explain allowlist #1468 + authz #1479).
- Schema note: `match_results.weighted_score` is `DECIMAL(5,2)` (migration
  008) — the test schema mirrors it; S-9's `overall_score` passes the
  measured value through unchanged (string wire form is pre-existing).

## Review round — F-1 BLOCK → fix

Independent review APPROVED S-9/S-10/S-11/dashboard but BLOCKED on
F-1: the S-8 explain site's `typeof weighted_score === 'number'` test
discarded the measured score on the cached path — `explainMatch`
returns the raw `match_results` row, whose `DECIMAL(5,2)`
`weighted_score` node-pg returns as a **string**, so nearly every real
explanation would have recorded `confidence: null` (a false
insufficient-data record — the mirror-image honesty error). Fix: a
shared `measuredConfidenceValue` helper coerces numeric strings
before the null judgement, used at the explain site and inside
`maxMeasuredConfidence`. New tests S-8e (string `'0.66'` → 0.66,
string `'0.00'` → 0; RED before the fix) and S-8f (measured-0 set →
confidence 0). Suite: 11/11 GREEN after the fix; neighbours 54/54.
Reviewer observations O-1 (`explainMatch`'s on-demand fallback itself
returns `weighted_score: 0` for no-match) is producer-side, out of
this lane's files — routed to a follow-up by Lead.

## Gate-discovered sibling fix (same handler, in-lane)

Quinn's assembled-app gate found that the S-9 handler 500ed for every
candidate WITH a match row: `routes/memory.js` `JSON.parse`d
`match_results.matching_skills` / `missing_skills`, which are JSONB
(migration 008) — node-pg returns real arrays and `JSON.parse(array)`
throws. Pre-existing on dev; S-9's measured case is unprovable on the
real app without it. Fix: one `parseSkillList` helper accepting both
arrays and JSON strings, used at both call sites in the handler's path
(breakdown build + `generateImprovementTips`). Proven by Quinn J2
(200 with a JSONB match row; pre-fix shape reproduced in the jest
suite's string-form cases).

## Quinn HL-003 gate (fresh-install assembled app)

PASS — evidence in the goal run record (0243-run-2026-10-23,
quinn-1731-lane3/EVIDENCE.md): J1 no-data breakdown honest nulls;
J2 measured-0 breakdown (overall "0.00", skills 50 computed,
omni interview 0 / resume null); J3 audit read-back `confidence: null`
vs `confidence: 0` on pre-fix code for the identical empty result;
J4 NULL cached score → 403 NOT_TOP_FIVE, nothing persisted, quota
untouched. J5 (S-10 brief) honestly BLOCKED at the provider step (no
provider configured on the rig) — its prompt behaviour is covered by
the red-first suite; a pre-existing crash defect on that path
(`withTimeout` not exported by `lib/polsia-ai.js`; unhandled chat()
rejection terminates the process) is filed as a follow-up issue.

## Not in this lane

- S-12 (`candidate_search_index` persisted default) stays routed to the
  schema lane per the panel — not a reader fix.
- #1744 items 1–2 (candidates.tsx type widening, lane-1 test cache
  hardening) remain open on #1744.
