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

Nothing else is on staging: staging was assembled ONLY by module trains
(cherry-picks off dev) plus registry/manifest docs. The ~249 files by which
dev still differs from staging are untrained work and do NOT ride M1.

## Method — one staging → main merge, not per-module re-picks

- Historical method: every prior production promotion was a staging → main
  merge PR (#425, #427, #432, #435). M1 follows it: PR `staging → main`,
  merge commit becomes the prod candidate.
- Why not one module at a time onto main: the modules interleave on staging
  (Trains 1–7 cumulative, 948 files / ~740 commits vs the Oct-8 main).
  Re-picking module subsets onto the Oct-8 base re-opens every train's
  conflict surface for zero safety gain — the unit that was proven on
  staging is the staging tree as a whole, on the shared database prod
  already uses.
- The one-train-at-a-time rule is preserved where it bites: nothing reaches
  staging (and therefore main) except through a proven module train.

## Database — no migration runs at M1 deploy

- Staging and production share ONE database (founder ruling 2026-10-19:
  contractive migrations are expand→migrate→contract always, for this
  reason). All 60 migration files that differ main→staging (235–293 +
  p2/p3 hardening) have ALREADY applied to that shared database via the
  staging trains; staging runs the M1 tree against it today.
- The only contractive item in the set, migration 290 (#1280 DROP DEFAULT,
  founder-approved 2026-10-22), already ran under Train 6 and touches no
  data. M1 is a code-only promotion: rollback = forward code fix, or a
  revert PR of the merge — never a DB rollback.

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
checkout (Train 2 V3/V4 blocker; rider on #1818's train). Options:

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

## Execution checklist (after the gate is ruled)

1. PR staging → main with this manifest linked; independent review (Rex):
   diff stat vs this manifest, registry parity, no dev-only files.
2. Merge; record merge SHA.
3. Trigger prod deploy via Render API; /health read-back = merge SHA.
4. Quinn prod smoke (above); evidence attached to the PR.
5. Registry close-out PR on staging: prod_version per module (cv-review
   per the gate ruling), tags `prod/<module>@vX.Y` on the merge SHA.
6. Report in chat: M1 landed, smoke result, riders.
