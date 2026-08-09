Reopening — the promotion was attempted but **never landed**. Staging is still serving the pre-promotion commit.

Two staging deploys ran and both failed at boot:

| Deploy | Commit | Status |
|---|---|---|
| `dep-d9sagt1t0dsc73bka850` | `c67fdec` merge dev into staging | update_failed |
| `dep-d9sahlrbc2fs73b6v8c0` | `6faddc1` promote dev to staging | update_failed |

Live verification against `rekrutai-staging`:

```json
{"deployed":true,"commit":"7323258c1857a04d1e0c88f9db01fc29b80a650b","env":"staging"}
```

`7323258` is the commit from before the promotion, so none of the fixes this issue tracks are on staging. The service is healthy only because Render kept the previous release running after the new one failed to boot.

Root cause is a live Stripe key configured on the staging service, tracked in #149:

```
[FATAL] Non-production environment detected with live Stripe key. Refusing to start.
  NODE_ENV: staging
  STRIPE_SECRET_KEY prefix: sk_live_*
```

This issue stays open until `/deploy-check` on staging reports the promoted commit. Blocked by #149.
