# QA REPORT — #1237 / #1218 TrustScore leaderboard AFTER-capture (fresh install, screenshot proof)

**Persona:** Quinn (Phase 6 — Quality) · **Date:** 2026-10-16 · **Run dir:** `~/workspace/rekrut-1237-after-run/`
**Tested commit:** `a3b411a096f161cdb64ddb49960909bbe49c4f1a` (Merge PR #1246, the #1237 fix) — verified equal to live `origin/dev` head at run start (`git fetch origin dev` → `a3b411a0`).
**Scope:** AFTER capture for the one remaining half of #1218 (TrustScore leaderboard) and for #1237 itself. #1218's AI Search half already passed in the #1184 re-run (PR #1238) and is not re-tested here.
**This run closes nothing and merges nothing.** Both issues stay OPEN for Lead. No promotion, no purge flag, no live/production DB, no outreach was performed.

## Verdict

| Check | Verdict | Evidence |
|---|---|---|
| (a) `GET /api/trustscore/leaderboard` — 200 + correct `pagination.total` for no params, `?tier=`, `?min_score=` | **PASS** | All four probes 200; totals **3 / 1 / 1 / 1**, each equal to the direct-SQL count on the seeded DB (`evidence/api-probe.json`) |
| (b) Public leaderboard page renders the seeded companies, no "Failed to load leaderboard" | **PASS** | `screenshots/1237-leaderboard-public.png` (Playwright, desktop 1440×900): "3 companies ranked", Quinn Alpha Corp 900, Quinn Beta Corp 750, Quinn Gamma Corp 600; `evidence/browser-result.json`: `hasFailedToLoad: false` |
| (c) Server log clean on this path — no 42P18, no new "does not exist" | **PASS** | Whole-run log grep: `42P18` → 0, `could not determine data type` → 0, `does not exist` → 0, `Get leaderboard error` → 0 (`evidence/server-log-excerpt.txt`) |

**Overall: PASS.** This matches the pre-merge real-DB proof totals (3/1/1/1) from PR #1246, now reproduced over HTTP on a fresh install at the merged commit, plus a rendered-page capture — the BEFORE state (2026-10-15, #1218 capture: page showed "Failed to load leaderboard", server log 42P18 at `services/trustscore.js:1146`) is gone.

## Fresh-install proof

- Local PostgreSQL **16.15** (Ubuntu cluster `16/main`) on `127.0.0.1:5432` — the only cluster present on this VM at run start (`pg_lsclusters`: 16/main, port 5432, initially down; started for this run). The 55433 cluster used by some earlier runs no longer exists; recorded here so the port difference is not a mystery.
- Database `rekrut_1237_after` created **empty**; schema built **only** by `node migrate.js` from the clean worktree at `a3b411a0` (full log in the run dir, `logs/migrate.log`).
  - 149 migrations recorded in `_migrations`, 248 public tables.
  - **Known fresh-install defect persists at this commit:** `migrate.js` exits **1** at `p2_schema_hardening.sql` — code `0A000`, `rule _RETURN on view v_candidate_full_profile depends on column "availability"`. Identical to the Wave 2 AFTER run at `c9342daf`; this is #1141 territory, pre-existing, unrelated to #1237. Migrations after it (`p3…p7`, `seed_notification_templates`) therefore do not run on a fresh install. **Nothing was hand-applied.**
- Server: `node server.js` from the worktree at `a3b411a0`, client built with `npm run build` (exit 0), serving on port **3000** (the port the CORS whitelist hardcodes, `server.js:443`). Health: `200 {"status":"ok","db":"connected"}`.
- Fixtures (this run's scratch DB only, direct seed SQL — the app has no API that creates `trust_scores` rows with chosen tiers): three qualifying companies mirroring the PR #1246 proof seed — Quinn Alpha Corp (total 900, tier `excellent`, data_sufficiency 80), Quinn Beta Corp (750, `trusted`, 90), Quinn Gamma Corp (600, `good`, 60) — plus Quinn LowSuff Corp (900, `excellent`, **10**) which must be excluded by the `data_sufficiency_score >= 50` filter. It is excluded in every probe, including `tier=excellent`.

## API detail (`evidence/api-probe.json`)

| Probe | HTTP | `pagination.total` | SQL count | Match |
|---|---|---|---|---|
| `/api/trustscore/leaderboard` | 200 | 3 | 3 | ✓ |
| `?tier=trusted` | 200 | 1 | 1 | ✓ |
| `?tier=excellent` | 200 | 1 | 1 | ✓ |
| `?min_score=800` | 200 | 1 | 1 | ✓ |

Code path: `routes/trustscore.js:208` → `services/trustscore.js` `getLeaderboard` — the count query now uses its own renumbered clause (`$1`/`$2` with `countParams`), which is the PR #1246 fix.

## Observations (not verdicts)

- **O1:** The document request `GET /leaderboard` returns HTTP **404** while serving the SPA shell body (`client/dist/index.html`); the page then renders fully and its API calls return 200. This is the server's SPA-fallback behaviour at this commit, visible in the browser result's `failedResponses`; it predates #1237 (the Oct 15 BEFORE capture rendered the same shell with the error banner inside it) and does not affect the leaderboard verdict. Lead may want it triaged separately.
- **O2:** An early discarded browser attempt via `http://127.0.0.1:3000` produced `Not allowed by CORS` log lines (whitelist permits `localhost:3000` only). The reported capture used `http://localhost:3000`. The CORS lines remain in the full server log in the run dir and are labelled in `evidence/server-log-excerpt.txt` — they are not leaderboard-path errors.

## Limits

Desktop viewport only (1440×900), per standing QA order. Local fresh install only — nothing on staging or production was touched, no PR was merged, no issue was closed, no flag flipped, no data outside this run's own local QA database was created or deleted, and no email/outreach was sent. Both #1237 and #1218 remain **OPEN** for Lead.
