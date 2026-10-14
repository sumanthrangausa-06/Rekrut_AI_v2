# PRD — M16: Billing & Subscriptions

**State (verified, Scout §2): PARTIAL.** **Surfaces:** `routes/billing.js` (527 lines, raw Stripe API via fetch), `lib/subscription.js` · client: pricing, payment-success, settings billing surfaces.
**Pricing decision: Sumanth's, still open.** Atlas+Ledger's options memo (2026-10-12) recommends **A (per-interview credits) at launch → D (hybrid) on a usage trigger**; this PRD encodes the requirements whichever option is ruled, and boxes the decision.

## 1. Purpose & users
Money: plans, checkout, subscription state, and (designed, unbuilt) usage metering. Users: employers/recruiters (pay), candidates (Free/Pro candidate tiers exist in `lib/subscription.js`), platform admin (revenue surfaces, M20).

## 2. End-to-end journey
Pricing page → Stripe checkout (hand-rolled `stripePost`, `routes/billing.js:77`) → webhook (raw mount, `server.js:472`) → subscription tier applied → gated features obey tier. Candidate Pro follows the same spine.

## 3. Current state (verified)
Checkout + webhook + tier matrix exist and are wired. **Metering does not exist** — S-050/S-051/S-052 (#698/#699/#700) are open stories presupposing the pricing decision. Risks on record: #6 (P0) Stripe live-mode validation; #193 E2E payment flow failing; and #98 — **corrected 2026-10-13:** staging's Stripe secret is **TEST class today** (verified via Render API, class-only). #98's live claim was true on 2026-08-08 (`cs_live_` evidence), but the test keys Sumanth provided were applied Oct 3 and Oct 7, 2026, and the issue was never closed; its remaining scope is **behavioural verification only** (a staging checkout proving a `cs_test_` session + test card end-to-end; the publishable key's class, which lives in code/config). Separately: **production's Stripe secret is also TEST class** — production cannot take real payments as configured; live keys are required at launch (#837).

## 4. Gap to launch-ready
(1) The pricing decision (below) — metering cannot be built sanely before it. (2) #98's remaining behavioural verification (test-mode checkout on staging, publishable-key class) before staging payment tests count as evidence — and production's live keys at launch (#837, provided by Sumanth via the Secure Vault flow), with a keys-mode verification line at promotion (Relay owns). (3) #6/#193 validation of the real checkout→webhook→tier path on staging (test mode) as launch evidence.

## 5. Functional requirements
- FR-M16-1: Metering (when built per the ruled model) counts the ruled unit (interview / seat / hire) at the source of truth — the session/application record — never by client-side counters; the meter is auditable per company per period.
- FR-M16-2: Webhook handling is idempotent and signature-verified; tier changes apply only from verified webhook events or the Stripe dashboard state, never from client success-page claims.
- FR-M16-3: Staging runs Stripe **test mode only** (secret verified TEST class 2026-10-13 — #98's configuration risk is closed; behavioural checkout verification remains); promotion checklist includes a keys-mode verification line (Relay owns), and production receives LIVE keys only at launch (#837).
- FR-M16-4: Candidate Free/Pro and employer plans share one subscription model (`lib/subscription.js` matrix) — no parallel tier logic in routes.

## 6. Non-functional
- Security: payment data never touches our storage (Stripe-hosted checkout pattern as built); webhook raw-body mount is a reviewed invariant (same class as M8's mount order).
- Finance hygiene (Ledger's gates from the memo): never price below the per-interview cost floor; COGS must be measured before any public price is published.

## 7. Dependencies (verified states)
Stripe account/keys (exist; staging secret TEST class verified 2026-10-13; production secret also TEST class — live keys at launch, #837) · M2 company identity (exists) · Atlas evidence gates (discovery calls + paid pilots — the pricing decision's evidence input, business track, no issue filed — Scout §3.4 gap 4).

## 8. Sprint 11 overlap
None.

## 9. ⚠ Unverified
Checkout→webhook→tier round-trip on staging (test mode) — never evidenced; whether candidate Pro has any live purchasers (needs Stripe/DB read).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M16-1: pricing model.** Atlas+Ledger options: **A** per-interview credits (~$14–20/interview) · **B** per-seat subscription (~$79–249/seat/mo) · **C** per-hire success fee (Ledger fails it at launch: 45–90-day cash lag, unenforceable attribution, counsel flag) · **D** hybrid platform fee + credits (the evolve-to target). Memo §8 also holds your open inputs: beachhead segment, price-lock length, India INR pricing test, pilot cap, prepay policy, Sterling's deal-testing authority (±20%).
  **Rex's recommendation (concurring with Atlas+Ledger): A for the founding cohort, evolving to D on their stated trigger** (≥10 paying accounts consuming 2 consecutive months, or any account >~50 interviews/mo). Note the CEO panel's correction: January revenue is planned at **$0** until paid pilots convert — pricing is a pilot-design decision now, not a revenue forecast.
