## Problem

Every route on `dev` — including the public homepage — renders the error boundary instead of the app:

> Something went wrong. An unexpected error occurred. Please try refreshing the page.

Confirmed on `dev` @ `80326e3` with a clean local deploy. All 26 audited pages failed, public and authenticated alike.

## Root cause

Two components are rendered in `client/src/App.tsx` but never imported or declared.

| Component | Rendered at | Module that exports it | Introduced by |
|---|---|---|---|
| `CandidateOmniScorePage` | `App.tsx:648` | `client/src/pages/candidate/omniscore.tsx` | `9cb0c37` (2026-08-15) — #24 |
| `RecruiterInterviewsPage` | `App.tsx:1112` | `client/src/pages/recruiter/interviews.tsx` | `a32b389` (2026-08-15) — #126 |

The route table is constructed at module scope, so a single missing symbol throws
`ReferenceError` before any page can mount. That is why the *public homepage* breaks
even though the missing components are authenticated pages.

Browser console:

```
ReferenceError: CandidateOmniScorePage is not defined
    at Dn (assets/index-DwFUGHYm.js:2:70764)
[ErrorBoundary] Caught error: ReferenceError: CandidateOmniScorePage is not defined
```

then, after fixing the first:

```
ReferenceError: RecruiterInterviewsPage is not defined
    at zn (assets/index-BaHeQMsA.js:2:75170)
```

## Why CI did not catch it

`npm run build` **exits 0**. Vite does not type-check during build, so an
unresolved identifier ships as a clean artifact. Nothing in the pipeline loads a
page after building.

This also went unnoticed for two days because staging last deployed on Aug 12
(`origin/staging` @ `5578391`) while both bad commits landed on Aug 15.

## Reproduction

```bash
git checkout dev
cd client && npm install --include=dev && npm run build && cd ..
node server.js
# open http://localhost:3000/  -> "Something went wrong"
```

## Fix

```ts
const CandidateOmniScorePage = lazy(() =>
  import('@/pages/candidate/omniscore').then((m) => ({ default: m.CandidateOmniScorePage })),
)
const RecruiterInterviewsPage = lazy(() =>
  import('@/pages/recruiter/interviews').then((m) => ({ default: m.RecruiterInterviewsPage })),
)
```

Verified locally: with both added, all 26 pages render and the public pages are
console-clean.

## Acceptance criteria

- [ ] `CandidateOmniScorePage` and `RecruiterInterviewsPage` are imported in `App.tsx`
- [ ] `/`, `/login`, `/candidate/omniscore` and `/recruiter/interviews` all render without the error boundary
- [ ] CI runs `tsc --noEmit` (or an equivalent type-check) and **fails** the build on an unresolved identifier
- [ ] CI performs a smoke load of `/` after building and fails if the error boundary renders
- [ ] A regression test asserts the homepage mounts without a console `ReferenceError`

## Notes for the implementer

A ready-made detector for this class of bug is at
`docs/qa/local-qa-2026-08-17/find_undefined_components.py` — it diffs JSX
identifiers rendered in `App.tsx` against names in scope, and currently reports 0
after the fix. It is cheap enough to run in CI as a stopgap before full type-checking.

Found by local QA on 2026-08-17. Full report: `docs/qa/local-qa-2026-08-17/REPORT.md`
