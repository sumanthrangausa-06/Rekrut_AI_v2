# PRD — M16: Billing & Subscriptions

**State (verified, Scout §2): PARTIAL.** **Surfaces:** `routes/billing.js` (527 lines, raw Stripe API via fetch), `lib/subscription.js` · client: pricing, payment-success, settings billing surfaces.
**Pricing decision: Sumanth's, still open.** Atlas+Ledger's options memo (2026-10-12) recommends **A (per-interview credits) at launch → D (hybrid) on a usage trigger**; this PRD encodes the requirements whichever option is ruled, and boxes the decision.

## 1. Purpose & users
Money: plans, checkout, subscription state, and (designed, unbuilt) usage metering. Users: employers/recruiters (pay), candidates (Free/Pro candidate tiers exist in `lib/subscription.js`), platform admin (revenue surfaces, M20).

## 2. End-to-end journey
Pricing page → Stripe checkout (hand-rolled `stripePost`, `routes/billing.js:77`) → webhook (raw mount, `server.js:472`) → subscription tier applied → gated features obey tier. Candidate Pro follows the same spine.

## 3. Current state (verified)
Checkout + webhook + tier matrix exist and are wired. **Metering does not exist** — S-050/S-051/S-052 (#698/#699/#700) are open stories presupposing the pricing decision. Risks on record: **#98 staging is wired to LIVE Stripe keys**; #6 (P0) Stripe live-mode validation; #193 E2E payment flow failing.

## 4. Gap to launch-ready
(1) The pricing decision (below) — metering cannot be built sanely before it. (2) #98's staging-on-live-keys must be resolved before any staging payment test (test-mode keys on staging; live keys only on prod, verified by config read at promotion). (3) #6/#193 validation of the real checkout→webhook→tier path on staging (test mode) as launch evidence.

## 5. Functional requirements
- FR-M16-1: Metering (when built per the ruled model) counts the ruled unit (interview / seat / hire) at the source of truth — the session/application record — never by client-side counters; the meter is auditable per company per period.
- FR-M16-2: Webhook handling is idempotent and signature-verified; tier changes apply only from verified webhook events or the Stripe dashboard state, never from client success-page claims.
- FR-M16-3: Staging runs Stripe **test mode only** (closes #98's risk); promotion checklist includes a keys-mode verification line (Relay owns).
- FR-M16-4: Candidate Free/Pro and employer plans share one subscription model (`lib/subscription.js` matrix) — no parallel tier logic in routes.

## 6. Non-functional
- Security: payment data never touches our storage (Stripe-hosted checkout pattern as built); webhook raw-body mount is a reviewed invariant (same class as M8's mount order).
- Finance hygiene (Ledger's gates from the memo): never price below the per-interview cost floor; COGS must be measured before any public price is published.

## 7. Dependencies (verified states)
Stripe account/keys (exist; mode risk #98) · M2 company identity (exists) · Atlas evidence gates (discovery calls + paid pilots — the pricing decision's evidence input, business track, no issue filed — Scout §3.4 gap 4).

## 8. Sprint 11 overlap
None.

## 9. ⚠ Unverified
Checkout→webhook→tier round-trip on staging (test mode) — never evidenced; whether candidate Pro has any live purchasers (needs Stripe/DB read).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M16-1: pricing model.** Atlas+Ledger options: **A** per-interview credits (~$14–20/interview) · **B** per-seat subscription (~$79–249/seat/mo) · **C** per-hire success fee (Ledger fails it at launch: 45–90-day cash lag, unenforceable attribution, counsel flag) · **D** hybrid platform fee + credits (the evolve-to target). Memo §8 also holds your open inputs: beachhead segment, price-lock length, India INR pricing test, pilot cap, prepay policy, Sterling's deal-testing authority (±20%).
  **Rex's recommendation (concurring with Atlas+Ledger): A for the founding cohort, evolving to D on their stated trigger** (≥10 paying accounts consuming 2 consecutive months, or any account >~50 interviews/mo). Note the CEO panel's correction: January revenue is planned at **$0** until paid pilots convert — pricing is a pilot-design decision now, not a revenue forecast.
