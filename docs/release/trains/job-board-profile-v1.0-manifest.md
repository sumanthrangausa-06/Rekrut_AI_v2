# Train manifest — Job Board + Profile v1.0 (Train 4)

- **Modules:** jobs-careers v0.1 (live on staging, journey UNPROVEN) → v1.0 candidate; candidate-profile surfaces (sidebar / header / profile page) ride this train because their staging proofs (#1607, #1608) are the train's purpose — no separate registry module exists for them.
- **Base staging SHA:** `4fb792f5b` (Train 3 close-out, PR #1819) — re-verified live 2026-10-24 at assembly: staging tip = 4fb792f5b; staging code serves Train 3 merge `223b159e3`.
- **Authorization:** Sumanth's standing promotion authorization (2026-10-22: "you build everything and promote to staging and then to main") + promotions-first priority (2026-10-24: "okay go ahead"). Train order per the programme body: cv-review v2.0/v2.1 first (done, Train 3), then the modules carrying the #1606/#1607/#1608 staging-proof debts — this train carries #1607 + #1608; #1606 (assessments, migrations 279/280 + seed/catalogue chain) follows as its own train.
- **Why this train:** #1600 (Job Board Filters dead placeholder), #1601 (Job Board 0% profile completion), #1607 (missing My Profile option) and #1608 (uploaded profile picture not displayed) were all fixed and dev-proven under Aria's Job Board + Profile PRD (PRs #1614–#1616), but staging still runs the pre-fix code and #1607/#1608 remain OPEN on staging proof only. This train promotes exactly those fixes so Quinn can run the staging proofs and the two issues can close.

## Ordered picks (dev merge order)

| # | PR | Issue | Scope |
|---|----|-------|-------|
| 1 | #1629 | #1601 | job detail consumes canonical profile completion; reset to unknown on failed reload (+ client suite) |
| 2 | #1633 | #1600 | header Filters wired to the Job Board's one filter model (`routes/candidate.js`, header/jobs pages, `lib/job-board-url.ts` + suites) |
| 3 | #1637 | #1608 | refresh auth context after photo upload so header avatar updates in-session (`profile.tsx` + suite) |
| 4 | #1639 | #1634 | company_size buckets return jobs; header keyword no longer clobbered by stale skill |
| 5 | #1640 | #1634 | large bucket covers stored '1000+'; tracker consume-on-absence |
| 6 | #1643 | #1636/#1607 | My Profile entry + identity block in mobile sidebar (`sidebar.tsx` + suite) |
| 7 | #1651 | #1638 | LinkedIn import fills `users.avatar_url`; empty-string photo_url guard |
| 8 | #1815 | #1630 | delete dead `profile.tsx.backup` (divergent pre-#1601 completion calc, zero importers) |

**Assembly result: all 14 commits applied clean, zero conflicts.** File-set diff vs staging = exactly the 23-file union of the 8 PRs. **Patch-ids: 14/14 identical to the dev originals** (Relay, first-hand).

## Migrations carried: NONE
File-set diff under `migrations/`: empty. No schema change rides this train; the expand→migrate→contract rule is not engaged.

## Pre-merge checks (Relay, first-hand, 2026-10-24)
- Server suites on the train tree: candidate-jobs-filters-1600, candidate-jobs-company-size-1634, candidate-linkedin-import-avatar-1638 — **3 suites PASS, 21 passed / 16 skipped**, byte-identical counts to the same suites on the dev tip (skips are the DB-gated legs, skipped on dev too).
- Client suites on the train tree (vitest): SidebarMyProfile1636, JobDetailProfileCompletion, ProfileAvatarRefresh1608, job-board-url-1634 — **4 files, 21/21 PASS**.

## Retest plan (staging, after deploy — Quinn witnessed by Relay)
- **#1607 (JT-M1):** fresh TEST candidate on staging → My Profile reachable BOTH doors: header user menu (desktop) and mobile sidebar entry + identity block; `/candidate/profile` renders the candidate's own profile.
- **#1608 (JT-M2):** same candidate uploads a profile picture on the Profile page → header/dropdown avatar shows the NEW photo in-session without re-login; `avatar_url` read back via profile API.
- **#1600:** Job Board Filters actually filter (header Filters and board share one model — filter by a facet and read back the narrowed result set).
- **#1601:** Job Board / job detail shows the candidate's real profile-completion percentage (not a stuck 0%); incomplete profile shows its true partial value.
- **Neighbour:** staging /health 200 warm; CV Review primary path still green (Train 3 surfaces share `routes/candidate.js` / profile page).
- Partial pass = FAIL; the tag `staging/jobs-careers@v1.0` and the #1607/#1608 closures wait for a full pass.

## Boundary
- No env changes, no `RETENTION_PURGE_LIVE`, no data writes beyond TEST accounts created by the retest itself.
- Main promotion only after the staging retest passes in full (dual-environment rule).

## Close-out (Relay, 2026-10-24)
- PR #1820 merged 2026-10-24T19:52:33Z, merge commit `b7479dac41bdf83d5984eccfa33613997223ff75`. Independent review APPROVE (reviewer's own record: PR comment 6388822286; Lead record 6388796767 — see the reconciliation comment on the PR for the condensed-summary id mix-up).
- Deploy: staging Render autoDeploy=NO — triggered via API, deploy `dep-dbegp4favr4c73ashka0` LIVE; /health read back commit `b7479dac4`, db connected.
- **Staging retest: PASS.** API legs evidenced twice independently — Quinn (user 242; comments 6388854513/6388854704) and Lead first-hand (user 243): photo upload persists with avatar read-back, filters narrow (14 → 6 on search), completion canonical and rising (8% → 58% Quinn; 42% computed on Lead's profile), CV neighbour intact. Browser legs (live app, fresh account train4.browser.…@test.rekrutai.co, 19:55–21:35Z): header user menu contains "My Profile" → profile page renders own identity; sidebar shows identity block + "My Profile" link, click loads the profile; photo upload changed the header avatar in-session to the uploaded R2 image (completeness 8% → 17%); Job Board Filters drawer opens with real facets; Job Board shows 14 active jobs.
- **Tag applied:** `staging/jobs-careers@v1.0` on `b7479dac4`.
- **Riders:** (1) true mobile-viewport rendering of the sidebar not directly proven (the browser tool could not resize its viewport); the sidebar component is the one the #1636 fix shipped, verified rendered + functional in the live app and by its vitest suite on the deployed code. (2) The Job Board page itself displays no completion percentage (its percentages are match scores); the canonical completion percentage is shown truthfully on the profile page, dashboard stats, and job detail — the surfaces #1601's fix governs.
- **Main promotion: NOT run** — prod_version stays "0.1"; no train has promoted to main yet under the train system (production still runs the Oct 8 commit against the shared DB), and module-to-main steps remain a separate Relay decision per train.
- Evidence: goal hidden_files `train-4/` (run-state.md, lead-retest/, quinn-retest/).
