# Train manifest — CV Review (Train 2) — FROZEN at assembly

- **Module:** cv-review v1.0 → v2.0 (MAJOR per design §2.3: dice scores → real analyser; pre/post scores incomparable)
- **Base staging SHA:** `3c0cf8e331dfabbffcb3530c9bb77b6326103b1e` (post-Train-1 staging tip: Train 1 merge 63b9684a1 + registry close-out PR #1466) — re-verified live at assembly.
- **Sumanth's release word (verbatim, 2026-10-19):** "release whats done" — Trains 1 and 2 to staging (design §3 Step 1).
- **Source:** module-trains design 2026-10-18 §6.2 (VERIFIED manifest). Design wins over any summary.

## Ordered picks (dev merge order; #1431 last per design — file-disjoint from lib/ai-provider.js)

| # | PR | Merge SHA | Issue | Scope |
|---|----|-----------|-------|-------|
| 1 | #1405 | `d110a950` | #1386 | real provider-backed CV analysis; mock deleted; honest 503 (`routes/candidate.js`) |
| 2 | #1413 | `827342e0` | #1406 | cascade proxy agent + NIM/OpenAI construction + stale Groq cleanup (`lib/ai-provider.js`, package.json, package-lock.json) |
| 3 | #1421 | `bb5aa474` | #1418 | guard HttpsProxyAgent construction — malformed proxy falls back |
| 4 | #1426 | `cb6ede37` | #1415 | remove stale groq_llama_8b |
| 5 | #1429 | `7cf91534` | #1428 | 410 → RETRYABLE_STATUS |
| 6 | #1433 | `75225cda` | #1430 | 413/422 non-retryable + circuit-recording gate |
| 7 | #1436 | `5ab54d37` | #1420 | cascade budget — demotion, race cap, fair-share |
| 8 | #1431 | `d7d2d0dd` | #1407 | stale pending hygiene, poll timeout, fail-closed (`routes/candidate.js`, cv-review.tsx) |

**Assembly result: all 8 picks applied clean, zero conflicts.** #1431's adjacency risk did NOT materialize textually. Semantic check (design §3 Step 3): per-pick diff-of-diffs vs the original merges — all 8 line-identical; the CV helpers the picks use are defined inside the train's own files. No reference to excluded #1410/#1412/#1384 content. File-set diff vs staging = exactly the 14-file union of the 8 PRs.

## Migrations carried: NONE

File-set diff under migrations/: empty. Dependency check (design §6.2): PASS — cv_analyses/cv_reviews from migrations 220/221 (staging-applied). §4.2 dynamic proof for this train asserts an EMPTY applied-diff when its exact tree boots against a DB seeded to the post-Train-1 staging applied set.

## Checked and cleared (design §6.2)

lib/polsia-ai.js changes by non-train PRs #1376/#1384 inspected in design — neither touches chat(), the cascade, or the cv-analyze path. package.json/package-lock.json: #1413 is the only pending PR touching them; its pick was clean onto staging's versions.

## Retest plan (design §3 Step 6 + §0.2 neighbour rule)

- **Primary:** Pro-gated TEST candidate with a parsed resume → POST /api/candidate/cv/analyze → real persisted analysis read back (analysis history endpoint) OR honest retryable failure — never a fabricated score.
- **Negative:** candidate without a resume → typed 400; free-tier candidate → feature gate response (403/upgrade) intact.
- **Neighbour regression (mandatory):** Quick Practice smoke on staging (QP consumes the same shipped lib/ai-provider.js cascade on the same server) — practice session start + consent state read back, honest outcome.
- **State read back** via API after each flow; health 200 warm at the end.
- Tester: Quinn (witnessed by Relay). Evidence: goal hidden_files/train-2/.
