**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**Confirmed still present on `dev`.** `client/src/pages/recruiter/candidates.tsx` was touched by the render-loop commit, but the fabricated data was left in place. The fallback still reads:

```tsx
// Use mock data if API not available
setSavedSearches([ ... ])
```

So a brand new recruiter account with no saved searches sees invented ones, and the trend indicators still render a hardcoded `trend='up'`.

This is downstream of #109: the saved-searches endpoint does not exist on `dev`, so the fallback fires every time. Fixing the endpoint without removing the fabricated fallback would only hide the problem for accounts that happen to have data.

**Fix direction:** on API failure or empty response, render the empty state. Never substitute invented records. Trend deltas should be computed from real history, or omitted entirely when there is no prior period to compare against.

**Verification:** sign in as a newly created recruiter with no activity and confirm the saved-searches panel is empty and no trend deltas are shown.
