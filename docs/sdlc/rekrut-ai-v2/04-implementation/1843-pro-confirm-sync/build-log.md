# #1843 — Pro payment confirmation never unlocked CV Review (build log)

**Defect (founder-hit, 2026-10-25, staging):** Stripe sandbox checkout
completed, but clicking "Analyze My CV" never unlocked analysis.

## Root cause (STOP 1, first-hand on dev)

The tier gate (`lib/subscription.js` `getUserTier`) grants Pro only when
`is_paid=true` AND `subscription_status` ∈ {`active`, `trialing`}. The
writers of that state disagreed with the gate:

1. `POST /billing/confirm-session` stored
   `subscription_status = subscription?.status || session.status`. The
   session's own status is `'complete'` — rejected by the gate. Whenever
   the expanded subscription object was absent from Stripe's response,
   a paid account was written `is_paid=true, subscription_status='complete'`
   and read back `free` forever. (The webhook path hardcodes `'active'`
   but no webhook events reached staging in the founder's window.)
2. `GET /auth/verify-payment` (the payment-success confirm path) set
   `is_paid=true` but never wrote `subscription_status` at all.
3. Client: `cv-review.tsx` `handleAnalyze` left the page in the idle
   state for the whole synchronous trigger POST (the analysing state was
   only set after the response), so the click showed no feedback and the
   button stayed clickable — the "dead click".

There was also no self-heal: no read path ever re-synced a stranded paid
account.

## Fix

- `lib/subscription.js`: `checkoutSubscriptionStatus(subscription)` —
  the status to store for a verified paid checkout (the subscription's
  own status when the gate accepts it, else `'active'`); used by
  confirm-session for both the stored value and the response.
- `routes/auth.js` verify-payment now also writes
  `subscription_status='active'`.
- `lib/subscription.js`: `repairStalePaidStatus(user)` — heals a stored
  row that is paid with a Stripe subscription on file but a gate-rejected
  status, to `'active'`. Guarded by `stripe_subscription_id IS NOT NULL`
  so it can never promote an account with no subscription evidence.
  Called from `checkFeatureAccess` (every Pro gate) and `GET /billing/tier`.
  This heals the founder's already-paid staging account on its next
  Pro-gated click or tier read — no manual DB edit. The heal only fires
  for the writer-bug artifacts (`complete`, `inactive`, NULL) — legitimate
  lifecycle statuses written by the subscription webhook (`past_due`,
  `canceled`, `unpaid`, …) are never flipped back (guard leg in the
  journey check: a `past_due` account stays gated and its stored status
  is untouched).
- `cv-review.tsx`: new `starting` page state — the analysing card renders
  from the click itself, before the trigger POST returns.
- `POST /billing/checkout-session` requires a signed-in user (401
  `AUTH_REQUIRED`): a signed-out checkout carries no `client_reference_id`
  or account email, so confirm-session could never sync it — the buyer
  would pay and stay Free silently. Refused before Stripe takes money
  (independent-review SHOULD-FIX).

Design discussion: Scout independently verified all three defects
(line-level); Rex reviewed the fix design (harden the writers, not the
gate's status set; keep the session-status fallback out of the stored
column entirely; the heal guard above is Rex's condition). One Scout
side-claim (a wrong-argument call in `/billing/usage`) was checked
first-hand and refuted — that handler passes `req.user` correctly.
Independent code review of the full diff: no BLOCKs; the signed-out
checkout SHOULD-FIX was folded in (above); two further SHOULD-FIXes
(heal not bound to one subscription id; heal fires for recruiter rows
too) were checked first-hand and accepted with reasoning recorded on
the PR — the heal only updates the caller's own row, and only when
that row is itself a paid account in the stranded state.

## Evidence

- `tests/billing-pro-confirm-1843.check.js` — real HTTP journey against
  the real routers on a fresh-migrated Postgres (real `migrate.js`
  chain): confirm-session with Stripe's unexpanded session shape →
  stored status gate-accepted, `GET /billing/tier` reads `pro`,
  `POST /candidate/cv/analyze` passes the gate (honest 400 NO_DOCUMENT);
  verify-payment path likewise; stranded-row heal leg; no-subscription
  guard leg (stays 403). RED before the fix
  (`subscription_status … got 'complete'`), PASS after.
  Only the external Stripe/Polsia transports are stubbed, at their
  network boundary; everything under test is real.
- `client/src/__tests__/pages/CvReviewAnalyzeFeedback.test.tsx` — with
  the trigger POST held unresolved, the analysing UI is on screen from
  the click. RED before, PASS after; the existing
  `CvReviewPollTimeout` suite still passes.

## Not in scope

- Why zero webhook events reached staging (Stripe endpoint/secret
  configuration for the staging service) — environment configuration,
  tracked on the issue; the confirm paths no longer depend on it.
- #1837 free-tier latency, which makes any slow click feel deader — a
  capacity/money gate for Sumanth, unchanged.
