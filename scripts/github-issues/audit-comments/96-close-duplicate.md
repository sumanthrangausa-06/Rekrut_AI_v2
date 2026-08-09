**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**This is already fixed on `dev`. Closing as a duplicate of #85.**

Two commits resolved it:

- `77f1462` fix: eliminate infinite render loops across 14 pages - wrap loaders in useCallback
- `9eaa2af` fix(perf): resolve useCallback hoisting issues - move declarations above useEffect hooks

I checked that the fix is real rather than cosmetic. Wrapping a loader in `useCallback` only breaks the loop if the callback's own dependency array is stable, so I verified each one:

| File | Loader | Dep array |
|---|---|---|
| `candidate/omniscore.tsx` | `loadMyScore`, `loadCompanies`, `loadMatches` | `[]` |
| `candidate/offers.tsx` | `loadOffers` | `[]` |
| `candidate/screening.tsx` | `loadScreening` | `[token]` |
| `candidate/profile.tsx` | `loadProfile` | `[]` |
| `candidate/onboarding.tsx` | `loadProgress` | `[]` |

All stable, across 14 files, matching the 14 affected pages in #85.

**The work is done but not deployed.** `dev` is six commits ahead of `staging`, so the loops are still live in the environment QA tests against. Deployment and re-verification are tracked in the new staging promotion issue.
