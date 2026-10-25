# Main Train M1.4 — #1853 candidate Pro plan (Train 12) → production

Date: 2026-10-25 · Owner: Relay · Authorization: standing promotion authorization (Sumanth, 2026-10-22)

## Contents (cherry-pick from staging, patch-identical to the staging train)
- Train 12 (PR #1856 on staging): #1853 candidate Pro plan ($19/mo, $190/yr, audience 'candidate') + role-aware pricing + server-side audience↔role checkout enforcement. Founder ruling 2026-10-25: candidate Pro STAYS (Option b).
- Pick onto main edf5d2993 applied clean, zero conflicts: 96e00d74, patch-id dabc87822c686f6233f1bd0130958d35ea8366cb — re-verified identical to the staging pick 7dc088a78 and the dev original 08becb6f3.
- Files (exactly Train 12's 5): routes/billing.js, client/src/pages/pricing.tsx, client/src/__tests__/pages/PricingRoleAware1853.test.tsx, tests/billing-candidate-pro-1853.check.js, docs/sdlc build-log for #1853.
- No migrations, no env changes.

## Proof — staging gate complete before this train
- Dev gate (PR #1855): Relay first-hand E2E re-run PASS 7/7 + #1843 regression PASS 9/9; independent security/payments review NO BLOCK (3 SHOULD-FIXes folded in pre-merge).
- Staging (Train 12, deploy dep-dbf6rblg1s2s73emkkb0 live @ f58d0c74e): session + sandbox-door legs PASS 7/7 — pro plan live at $19/$190 with audience candidate, cross-audience checkout 403 both ways, Stripe test-mode sessions created.
- Browser hosted-checkout completion leg completed 2026-10-25: a fresh candidate paid the Stripe test-mode Pro checkout, redirect banner "Payment confirmed. Your account is active.", subscription verified first-hand via the staging API (isPaid true / plan pro / tier pro, exact subscription-id match); CV analyze gate passes with honest NO_DOCUMENT instead of the free 403. #1853 CLOSED on that evidence.
- Cosmetic follow-up #1859 (pricing card + sidebar still show checkout/upgrade CTA for an active Pro account on clean load) is filed separately and does not block this train.

## After merge
- Trigger prod deploy (autoDeploy off), verify deploy record + repeated /health samples agree on the merge commit.
- Registry patch-train log on staging updated with the M1.4 line.
