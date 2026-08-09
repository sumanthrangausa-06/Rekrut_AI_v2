## Summary

The `rekrutai-staging` service is configured with a **live Stripe secret key** (`sk_live_*`). Every deploy to staging now fails at boot, and before the guard existed, staging was transacting against live Stripe credentials.

## Evidence

Render service `srv-d8j6js3bc2fs73bf4rmg` (rekrutai-staging), deploy `dep-d9sahlrbc2fs73b6v8c0`:

```
[FATAL] Non-production environment detected with live Stripe key. Refusing to start.
  NODE_ENV: staging
  STRIPE_SECRET_KEY prefix: sk_live_*
==> Exited with status 1
```

Two consecutive staging deploys failed this way:

| Deploy | Commit | Status |
|---|---|---|
| `dep-d9sagt1t0dsc73bka850` | `c67fdec` merge dev into staging | update_failed |
| `dep-d9sahlrbc2fs73b6v8c0` | `6faddc1` promote dev to staging (#148) | update_failed |

Staging is therefore still serving the older commit `7323258`, confirmed via `/deploy-check`:

```json
{"deployed":true,"commit":"7323258c1857a04d1e0c88f9db01fc29b80a650b","env":"staging"}
```

## Why this matters

The guard added in `5e8f0d4` is working as designed — it caught a real misconfiguration. The important finding is not the failed deploy, it is that **staging held production payment credentials**. Any checkout exercised against staging during QA could have created real charges, customers or subscriptions in the live Stripe account.

## Required actions

1. Replace `STRIPE_SECRET_KEY` on the staging service with a test key (`sk_test_*`).
2. Do the same for `STRIPE_PUBLISHABLE_KEY` (`pk_test_*`) and `STRIPE_WEBHOOK_SECRET`.
3. **Rotate the exposed live key** in the Stripe dashboard — it has been sitting in a non-production environment.
4. Audit the live Stripe account for test-looking activity (customers, charges, subscriptions) created while staging pointed at it.
5. Re-run the dev to staging promotion once the keys are corrected.

## Acceptance criteria

- [ ] Staging boots successfully with `sk_test_*` credentials
- [ ] The previously configured live key is rotated in Stripe
- [ ] Live Stripe account audited for activity originating from staging
- [ ] `rekrutai-staging` `/deploy-check` reports the promoted commit
- [ ] A check prevents non-production services from being configured with live keys
