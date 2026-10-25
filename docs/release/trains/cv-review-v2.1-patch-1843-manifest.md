# Train 9 patch manifest — cv-review v2.1 patch: #1843 Pro unlock fix → staging

**Relay — P1 patch for cv-review v2.1 (M1 prod, PR #1836).**
Issue #1843: paid Stripe checkout completes on staging, CV Analyze never
unlocks — founder-hit 2026-10-25 during the manual staging Pro proof.
Version stays cv-review v2.1 (patch-train precedent, Trains 8 / #1829 / #1833).

## Root cause (from the #1843 fix commits, dev PRs #1844–#1846)

- `POST /billing/confirm-session` stored `subscription_status='complete'`
  (the checkout *session* status) whenever the expanded subscription object
  was absent. `getUserTier` accepts only `active`/`trialing`, so paid
  accounts stayed `free` and CV Analyze 403'd forever. The webhook path
  (which hardcodes `active`) never fired on staging — zero webhook events
  in the checkout window.
- `POST /auth/verify-payment` set `is_paid` but never `subscription_status`
  — same stranded state via the second confirm path.
- The Analyze button showed no in-flight feedback, so a slow/cold request
  looked like a dead click.

## Picks (3, cherry-picked from dev, clean)

- `eea6fcc22` (PR #1844) → `db8a97167` — confirm writers store a
  tier-accepted status (`checkoutSubscriptionStatus()`); `repairStalePaidStatus()`
  heals the caller's own stranded paid row (writer-artifact statuses only —
  webhook lifecycle statuses `past_due`/`canceled` are never flipped), called
  from `checkFeatureAccess` + `GET /billing/tier`; checkout-session requires
  a signed-in user; cv-review.tsx shows analysing feedback from the click.
- `a96de70b2` (PR #1845) → `fddb2324b` — Rex amendment: `active` only when
  the subscription status is missing.
- `35d2f21af` (PR #1846) → `f076174dc` — same heal on
  `GET /billing/subscription-status` (Scout full-verification follow-up).

Files: `lib/subscription.js`, `routes/billing.js`, `routes/auth.js`,
`client/src/pages/candidate/cv-review.tsx` + journey check + component test
+ build log. **No migrations.**

## Evidence (dev, first-hand from the fix commits)

- `tests/billing-pro-confirm-1843.check.js`: real HTTP against a
  fresh-migrated Postgres, 9 legs, red before / PASS after (PR #1846 note).
- `CvReviewAnalyzeFeedback.test.tsx`: red before / PASS after.

## Retest plan (staging, after merge + deploy)

1. `/health` commit read-back matches the train merge.
2. Stranded-row heal through the real door: the founder's staging account
   (paid, stranded by the original proof attempt) reads `GET /billing/tier`
   and `GET /billing/subscription-status` → tier `pro`; then Analyze runs.
   This leg needs the founder's signed-in staging session — the team cannot
   provision a Pro account via API (Stripe hosted checkout).
3. On pass: registry close-out noting the #1843 rider cleared on cv-review,
   then a patch main train (staging → main) under the standing
   authorization, with prod `/health` + tier read-back as the prod smoke.

**Do not merge until independent review approves.**
