# Train manifest — CV Review v2.1 (supersedes the unproven v2.0 train)

- **Module:** cv-review v2.0 (deployed on staging, retest INCOMPLETE) → v2.1
- **Base staging SHA:** `e41c65b93ea3cf7d9181d582e72a1e9899aa3763` (Train 2 merge, PR #1467) — re-verified live 2026-10-24: staging /health 200, commit read back e41c65b93, db connected.
- **Authorization:** Sumanth's standing promotion authorization (2026-10-22: "you build everything and promote to staging and then to main") + promotions-first priority (2026-10-24: "okay go ahead").
- **Why v2.1:** Train 2 froze before the #1471 parse fix landed on dev. The product-UI resume path (POST /candidate/profile/resume) on staging still never parses — the exact defect #1471 filed from the Train 2 retest. Dev proof of the fix completed 2026-10-23 (#1471 closed: upload → parse → analyze → real score 72 read back, fresh-install rig).

## Ordered picks (dev merge order)

| # | PR | Merge SHA | Issue | Scope |
|---|----|-----------|-------|-------|
| 1 | #1473 | `dc0a8904a` | #1471 | profile resume upload parses via shared parseResumeRecord (`routes/candidate.js` + suite) |
| 2 | #1474 | `b661316db` | #1472 | multipart Documents upload + multer honest JSON + CV empty-state points to Profile (`routes/candidate.js`, `client/.../documents.tsx`, `client/.../cv-review.tsx` + suite) |
| 3 | #1481 | `570c287de` | #1477 | retire unwritable 'uploaded' parsing_status — short text lands 'failed' directly (`routes/candidate.js` + suites) |

**Assembly result: all 4 commits applied clean, zero conflicts.** File-set diff vs staging = exactly the 6-file union of the 3 PRs. parseResumeRecord present in train tree (6 refs, same as dev).

## Migrations carried: NONE
File-set diff under migrations/: empty.

## Pre-merge checks (Relay, first-hand, 2026-10-24)
- The 3 PR suites on the train tree: **16/16 PASS** (candidate-profile-resume-parse-1471, candidate-documents-upload-1472, candidate-resume-short-text-1477).
- Staging base health: 200, commit e41c65b93, db.connected true.

## Retest plan (staging, after deploy — Quinn witnessed by Relay)
- **Primary (the v2.1 delta):** fresh TEST candidate on staging → upload the test resume PDF via the product path POST /api/candidate/profile/resume → parsed_resumes row read back via API/DB: parsing_status completed + parsed_data non-NULL (on v2.0 code this stays 'processing'/NULL — the discriminating assertion).
- **Negative/honesty:** free-tier candidate → POST /api/candidate/cv/analyze returns the feature gate (403 UPGRADE_REQUIRED), never a fabricated score; candidate without resume → typed 400.
- **Documents sibling (#1472):** multipart POST /api/candidate/documents/upload succeeds (no JSON-handler shadowing 400).
- **Neighbour:** Quick Practice smoke (shared cascade) — session start + honest outcome, as Train 2.
- Pro-path analyze on staging remains gated on a completable Pro account (Train 2 V3/V4 blocker: Stripe hosted checkout is browser-only) — if a browser checkout with a test card completes during this train, run analyze → real persisted score read back; otherwise record honestly and the tag decision follows the parse-proof + honesty results.
- Health 200 warm at the end; state read back after each flow.

## Close-out (Relay, 2026-10-24)
- PR #1817 merged 2026-10-24T18:52:37Z, merge commit `223b159e33baa17b57ad447e0ba45b580f7ae8d6`. Independent review APPROVE (patch-id-identical picks; PR comment 6388179616).
- Deploy: staging Render service autoDeploy=NO — triggered via API, deploy `dep-dbeg6s1srm7s73c22sjg` LIVE; /health read back commit `223b159e3`, db connected.
- **Staging retest (Quinn; Relay first-hand re-verified): PASS with riders.** Fresh candidates 239/240: register 201; product-path upload → parse COMPLETED with parsed_data persisted (Relay read back candidate 239's profile via API: parsed experience rows present — Example Corp/Data Analyst); every attempt landed an honest terminal status (none stranded at 'processing'); free-tier analyze = exact 403 UPGRADE_REQUIRED, analyses list empty (no fabrication); Documents multipart upload 200 + read-back (not the old shadow-400); Quick Practice neighbour green incl. consent 403 and a real persisted score — Train 2's bare-500 did NOT recur; final health 200.
- **Tag applied:** `staging/cv-review@v2.1` on `223b159e3`.
- **Riders:** (1) parse first-try reliability ~2/10 on staging — honest fast failures, re-upload succeeds; filed as #1818 (provider-cascade class). (2) Pro-analyze leg still unproven on staging — no API-completable Pro account (Stripe hosted checkout, Train 2 V3/V4 blocker); no-resume 400 unreachable behind the Pro gate for the same reason. Dev proof of the full conjunction stands (#1471).
- **Main promotion: HELD** — dual-environment rule: the module's Pro journey is not staging-proven, so cv-review does not advance to main this train. prod_version stays "1.0".
- Evidence: goal hidden_files `train-3/quinn-retest/` (28 logs + run.md) and `train-3/run-state.md`.
