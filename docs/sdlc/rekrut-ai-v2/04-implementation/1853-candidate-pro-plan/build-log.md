# #1853 — Candidate 'Upgrade to Pro' led to recruiter plans (build log)

**Defect (founder-hit, 2026-10-25, staging):** signed in as a candidate,
the sidebar 'Upgrade to Pro' CTA and every candidate Pro-feature gate
navigate to `/pricing` — which showed only recruiter team plans. There
was no candidate plan to buy, even though candidate features are gated
behind tier `pro`.

**Founder ruling (2026-10-25 12:01 PT, Option b):** Candidate Pro STAYS.
Build a real candidate plan and role-aware pricing. (The 'candidates
free at launch' recommendation was presented and NOT taken.)

## Root cause (STOP 1, first-hand on dev)

- `routes/billing.js` `PLANS` held exactly 3 plans — `starter` $29/mo,
  `growth` $79/mo, `enterprise` custom — all recruiter/team plans, with
  no `audience` field and no plan id `pro` anywhere. `GET
  /billing/plans` could therefore never return a candidate plan.
- `client/src/pages/pricing.tsx` contradicted itself: the SEO meta
  promised the candidate offer ("Upgrade to Pro for $19/month…") while
  the visible headline was teams-only ("Simple plans for teams that
  need to hire faster" / "Choose a plan that fits your hiring
  volume.").
- `lib/subscription.js` `FEATURE_MATRIX` gates candidate features
  behind tier `pro`, and the tier sync is plan-blind (`getUserTier`:
  `is_paid` + an accepted `subscription_status`, regardless of plan
  id) — which is why buying a recruiter plan on a candidate account
  unlocked Pro in #1843, and why a real `pro` plan needs no gate
  change.

## Fix

- `routes/billing.js`: new candidate plan — id `pro`, name `Pro`,
  `audience: 'candidate'`, $19/mo (1900), yearly $190 (19000, the
  existing 10x pattern); features are the Pro column of
  `FEATURE_MATRIX` (CV Review, LinkedIn Optimizer, Career Diagnosis,
  Auto-Apply 10/day, Top Matches, Recruiter Intros, unlimited
  matching / mock interviews / coaching). Existing plans gain
  `audience: 'recruiter'`; `publicPlan()` now exposes `audience`.
  Checkout is unchanged — `pro` flows through the same Stripe
  `checkout-session` mechanism as starter/growth (code only; no
  Stripe dashboard, live-key, or live-plan changes).
- `client/src/pages/pricing.tsx`: role-aware rendering from the
  existing auth context (`useAuth().isRecruiter`, built on
  `isRecruiterRole`). A signed-in candidate sees the candidate plans
  — a Free card (the honest free tier from `FEATURE_MATRIX`; not a
  purchasable billing plan, never sent to checkout) vs Pro. A
  signed-in recruiter/employer sees Starter/Growth/Enterprise only.
  A logged-out visitor sees both groups under "For candidates" /
  "For hiring teams" headings. Headline, badge, subcopy, and SEO
  title/description are per-audience, so no audience sees the other
  audience's framing (the $19 Pro meta now matches a page a
  candidate can actually buy from; recruiters get a teams meta).

## Evidence

- `tests/billing-candidate-pro-1853.check.js` — real HTTP journey
  against the real routers on a fresh-migrated Postgres (real
  `migrate.js` chain), only the external Stripe transport stubbed at
  its network boundary (same pattern as the #1843 check): plans
  carry `pro` with audience/prices/features and recruiter plans with
  `audience: 'recruiter'`; free candidate is gated (403
  UPGRADE_REQUIRED); `pro` checkout reaches the Stripe door at
  1900/mo and 19000/yr with `metadata[plan_id]=pro` and the account
  linked; confirm-session with plan `pro` syncs, stores
  `subscription_plan='pro'`, tier reads back `pro` with `cv_review`
  allowed; CV Analyze then passes the gate (honest 400 NO_DOCUMENT);
  recruiter growth checkout unchanged at 7900. RED before the fix
  (`plans must include a candidate plan with id 'pro', got
  ["starter","growth","enterprise"]`), PASS after.
- `tests/billing-pro-confirm-1843.check.js` re-run on the same rig:
  PASS — no regression to the #1843 heal/confirm paths.
- `client/src/__tests__/pages/PricingRoleAware1853.test.tsx` —
  renders the real page with the real plans response shape for each
  audience: candidate sees Free vs Pro ($19) and no team plans;
  recruiter sees team plans and no Pro; logged-out sees both groups
  under their audience headings. 3/3 PASS. Client `vite build` PASS.

## Independent review (security/payments lens) — NO BLOCK

The reviewer verified first-hand: amounts are server-priced from
`PLANS` (the checkout handler reads only `planId`/`billingCycle` from
the body), no tier unlock exists outside the verified-paid confirm /
webhook paths, `lib/subscription.js` is untouched (all #1843 guards
intact), and the client-rendered Free card cannot reach checkout (it
is not a server plan — `planId:'free'` is a 400). Three SHOULD-FIXes
were raised and folded in:

1. **Audience is now enforced at the purchase door**, not only in
   the page grouping: `POST /billing/checkout-session` rejects a
   candidate buying a recruiter plan or a recruiter buying `pro`
   with 403 `PLAN_AUDIENCE_MISMATCH` (role set mirrors
   `lib/auth.js`). The tier sync itself stays plan-blind — that is
   the #1843 heal mechanism, unchanged.
2. **The Free card no longer claims "Current plan"** for any
   signed-in user (false for a candidate already on Pro): it offers
   a neutral "Open dashboard" action instead.
3. **Negative legs added** to the journey check for the new surface:
   `planId:'free'` → 400, signed-out `pro` checkout → 401
   `AUTH_REQUIRED`, a spoofed body (`amount:1, audience:'recruiter'`)
   still charges 1900 for `pro`, and both cross-audience purchases
   → 403.

NITs folded in: 'Advanced assessments' added to the Pro feature
list (FEATURE_MATRIX pro tier), the Free card's highlight is now
distinct from Pro's, and a failed plans load renders no plan groups
instead of a lone Free card. One NIT accepted as-is: both `pro` and
`growth` are `popular` — the badge is per audience group, and each
group shows exactly one "Most popular".

## Not proven here (honest boundaries)

- The live Stripe hosted checkout page itself (sandbox or live) was
  not exercised — the journey is proven up to the checkout door
  (session creation request captured at the transport boundary) and
  from the Stripe return (confirm-session) onward, exactly as the
  #1843 suite proves its legs. The staging journey proof (Quinn,
  per the ruling: free candidate → CV gate → Upgrade → candidate Pro
  → sandbox checkout → unlock; recruiter still sees team plans)
  remains for the staging promotion step.
- No Stripe configuration was changed by this work.
