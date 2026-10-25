# Train manifest — Main Train M1 (staging → main, first main promotion since 2026-10-08)

- **Owner:** Relay (release). Prepared 2026-10-24 (advance run 22:43 PT).
- **Authorization:** Sumanth's standing promotion authorization (2026-10-22:
  "you build everything and promote to staging and then to main") +
  promotions-first priority (2026-10-24). ONE founder gate remains open —
  see "Founder gate" below. This manifest does NOT execute until that gate
  is ruled or Relay records it as a rider per Sumanth's word.
- **Source (staging):** branch tip `88bc57065` (docs close-out PR #1834);
  deployed staging code `dcecd3f71` (Train 7 merge). Staging /health
  re-verified 2026-10-25T05:46Z: status ok, commit dcecd3f71, db connected
  (https://rekrutai-staging.onrender.com/health).
- **Target (main):** tip `5fa8ade11` (2026-10-08, PR #435). Prod /health
  re-verified 2026-10-25T05:46Z: status ok, commit 5fa8ade11, db connected
  (https://rekrut-ai.onrender.com/health). Prod is live but 17 days stale
  against a forward-migrated shared database.

## What M1 carries — exactly the staging-proven registry set

Every module in `docs/release/module-versions.yaml` (canonical on staging)
is `status: current` with a staging journey/browser proof and a tag:

| Module | Version | Staging proof | Tag |
|---|---|---|---|
| auth-accounts | 1.0 | promotion #2 | (pre-train-system) |
| consent-privacy | 1.1 | Train 1 (PR #1465) | staging/consent-privacy@v1.1 |
| landing-honesty | 1.1 | Train 1 (PR #1465) | staging/landing-honesty@v1.1 |
| cv-review | 2.1 | Train 3 retest, 2026-10-24 (PR #1817) | staging/cv-review@v2.1 |
| jobs-careers | 1.0 | Train 4 retest, 2026-10-24 (PR #1820) | staging/jobs-careers@v1.0 |
| assessments | 1.0 | Train 5 retest + Train 7 patch, 2026-10-24 (PRs #1822/#1833) | staging/assessments@v1.0 |
| omniscore | 1.0 | Train 6 retest + #1828 patch re-run, 2026-10-24 (PRs #1826/#1829) | staging/omniscore@v1.0 |

In the train era (Train 1, PR #1465, onward) staging was assembled ONLY by
module trains (cherry-picks off dev) plus registry/manifest docs — every
first-parent merge since is a train or a close-out. (Pre-train-era staging
also carries direct dev merges; those predate the train system and were
live on staging long before M1.) The 249 files by which dev still differs
from staging are untrained work and do NOT ride M1.

**Registry riders that ride M1 with their modules** (carried in full, per
Rex review on PR #1835):
- cv-review: (1) parse first-try reliability ~2/10 on staging — honest
  failures, re-upload succeeds — #1818 (root-cause evidence updated
  2026-10-24: intermittent PDF-extraction XRef failures + two dead
  provider legs on staging; fix lane open); (2) Pro-analyze staging leg
  unproven — see Founder gate below.
- jobs-careers: mobile-viewport rendering of the sidebar not directly
  proven (browser tool could not resize); sidebar entry + identity block
  verified in the live app.
- assessments: subjects count on staging is 18 vs 19 on fresh install
  (staging's pre-existing DSA subject has no topics; honest empty state).
- omniscore: #1827 test-hygiene rider — CLOSED on dev 2026-10-24
  (PR #1831); the re-pinned suite has not itself ridden a train to
  staging (test-only, no product code).
- auth-accounts: registry prod_version is already "1.0" (live since
  promotion #2) — its M1 close-out is a no-op.

## Method — one staging → main merge, not per-module re-picks

- Historical method: every prior production promotion was a staging → main
  merge PR (earlier: #270, #290; the Oct-8 batch: #425, #427, #432, #435).
  M1 follows it: PR `staging → main`, merge commit becomes the prod
  candidate. (Rex verified the M1 merge itself is conflict-free via
  merge-tree.)
- Why not one module at a time onto main: the modules interleave on staging
  (Trains 1–7 cumulative, 948 files / ~740 commits vs the Oct-8 main).
  Re-picking module subsets onto the Oct-8 base re-opens every train's
  conflict surface for zero safety gain — the unit that was proven on
  staging is the staging tree as a whole, on the shared database prod
  already uses.
- The one-train-at-a-time rule is preserved where it bites: nothing reaches
  staging (and therefore main) except through a proven module train.

## Database — migrate runs at start; safety is the _migrations skip + shared-DB proof

- Staging and production share ONE database. Premise source: founder
  ruling 2026-10-19 (contractive migrations are expand→migrate→contract
  always, for this reason) + team records; both services' DATABASE_URL
  are dashboard-set (`sync: false` in render.yaml), so DB identity is
  not independently verifiable from the repo — labelled as such per
  Rex review on PR #1835.
- Migration files differing main→staging: **57** (counted:
  `git diff --name-only origin/main origin/staging -- migrations/`) —
  55 added (numbered files in 235–293 with gaps, plus
  p3e_csi_erasure_guard.js) and 2 modified (p2_schema_hardening.sql,
  p3_schema_optimizations.js). These have ALREADY applied to the shared
  database via the staging trains; staging runs the M1 tree against it
  today.
- CORRECTION to the first draft of this manifest: a migration run DOES
  execute at every prod start — render.yaml sets prod's startCommand to
  `npm run migrate && npm start`. The safety mechanism is migrate.js's
  per-file skip: it checks `_migrations` by name and skips recorded
  files, and staging boots this same tree with the same start command
  against the shared DB. M1 is therefore code-only IN EFFECT only if
  every differing file's name is already recorded — the execution
  checklist below adds the mandatory read-back: prod deploy log must
  show ZERO "Running migration:" lines at M1 start (a migration failure
  at start exits the process and bricks the deploy; a revert-PR rollback
  re-runs the same start command).
- TWO contractive items are in the set, both already applied: migration
  239 (DROP MATERIALIZED VIEW ×5 — views verified dead, Sumanth-approved
  2026-10-09) and migration 290 (#1280 DROP DEFAULT, founder-approved
  2026-10-22, touches no data). Rollback = forward code fix, or a revert
  PR of the merge — never a DB rollback.

## Deploy mechanics (verified 2026-10-24 via Render API)

- Prod service `rekrutai-prod` (srv-d69opaer433s73d6p570, branch main):
  autoDeploy = NO. Merging M1 does NOT deploy anything. Relay triggers the
  deploy explicitly after merge, then reads back /health until commit =
  M1 merge SHA and db.connected = true (instance-roll reads of the old
  commit during the roll are expected — cf. Train 7).
- Prod smoke after deploy (Quinn, witnessed by Relay): health 200;
  landing renders with honest stats; login + a fresh test candidate:
  profile, Job Board with live filters, Assessments catalogue; recruiter
  read paths. Any smoke failure → forward-fix lane opened immediately,
  registry prod_version stays at its pre-M1 value, incident reported in
  chat the same run.

## Founder gate — cv-review Pro-analyze leg (the one open question)

Registry holds cv-review's main promotion: the Pro (paid) analyze journey
is proven on dev (#1471: real score 72 persisted, 2026-10-23) and its free
path is proven on staging (exact 403 UPGRADE_REQUIRED, no fabrication), but
the Pro leg itself has never completed on staging — a Pro account cannot
be provisioned via API because signup runs through Stripe's hosted
checkout (Train 2 V3/V4 blocker). The gate decision must ALSO see
cv-review's other rider: parse first-try reliability ~2/10 on staging
(#1818, open) — M1 promotes that parse path to real users as-is; failures
are honest and re-upload succeeds, and the #1818 fix lane (extraction
path + dead provider legs) is the fast follow-up either way. Options:

- **A — Hold M1** until one manual Pro signup on staging completes the
  analyze → score read-back proof. Cost: prod stays on Oct-8 code for
  every module, including the six fully-proven ones, until that manual
  step happens.
- **B — Promote M1 with the rider recorded**: cv-review prod_version
  advances with the Pro leg explicitly unproven-on-staging (dev proof
  stands), and the staging Pro proof is run as a fast follow-up; a
  failure there opens a forward-fix lane, with the free path and parse
  path (both staging-proven) unaffected.

Team lean (Relay + Lead): **B** — the unproven leg is a provisioning
blocker, not a code doubt; the code path itself is dev-proven end-to-end
and staging-proven up to the paywall. Holding six proven modules hostage
to a checkout-page step keeps real users on the stalest code. Dissent
recorded: the dual-environment rule as written says staging proof BEFORE
main, no exceptions carved out yet — B is an exception Sumanth must rule,
not a team call.

## Pre-deploy verification (Relay, first-hand, 2026-10-24 — Render API, key names only)

- Env parity, per-service env-var listings (staging 22 keys, prod 20):
  AI_KEYS_JSON and STORAGE_KEYS_JSON are SET on both. Staging-only keys:
  CEREBRAS_API_KEY, GROQ_API_KEY (prod's cascade runs on AI_KEYS_JSON
  legs only — parity gap, non-blocking, recorded).
- BIOMETRIC_ENCRYPTION_KEY, AUDIT_PSEUDONYM_SECRET and
  THREAT_INTEL_HMAC_SECRET appear in NEITHER per-service listing. Parity
  holds between the two services, but if these are supplied via a shared
  Render env group, group attachment to rekrutai-prod MUST be confirmed
  in the dashboard at execution time — lib/biometricCrypto.js throws
  when its key is missing, so this is a hard pre-deploy check, not a
  formality.
- RETENTION_PURGE_LIVE is ABSENT on prod (verified: not set, therefore
  not 'true') — the retention purge cannot go live at M1 deploy. This
  matters because prod runs the production NODE_ENV path where the
  purge gate (`RETENTION_PURGE_LIVE === 'true' && NODE_ENV ===
  'production'`) can fire, a combination staging can never exercise.
  Re-confirm absent/not-true immediately before deploy.

## Execution checklist (after the gate is ruled)

1. PR staging → main with this manifest linked; independent review (Rex):
   diff stat vs this manifest, registry parity, no dev-only files.
2. Pre-deploy: dashboard-confirm env-group attachment for
   BIOMETRIC_ENCRYPTION_KEY on rekrutai-prod (above) and
   RETENTION_PURGE_LIVE absent/not-true on prod.
3. Merge; record merge SHA.
4. Trigger prod deploy via Render API; read the deploy log FIRST —
   zero "Running migration:" lines required (see Database section) —
   then /health read-back = merge SHA, db connected.
5. Quinn prod smoke (above); evidence attached to the PR.
6. Registry close-out PR on staging: prod_version per module (cv-review
   per the gate ruling; auth-accounts already 1.0, no-op), tags
   `prod/<module>@vX.Y` on the merge SHA.
7. Report in chat: M1 landed, smoke result, riders.
