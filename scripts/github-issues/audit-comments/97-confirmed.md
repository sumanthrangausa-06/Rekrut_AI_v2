**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**Confirmed still broken on `dev`.** The render-loop work did not touch this.

`client/src/pages/candidate/jobs.tsx:1092` navigates to the apply URL:

```tsx
if (selectedJob) navigate(`/candidate/jobs/${selectedJob.id}?apply=true`)
```

But `client/src/pages/candidate/job-detail.tsx` never reads that parameter. It imports no `useSearchParams`, and its `showApplyForm` state is initialised to `false` with no effect that inspects the query string. The `?apply=true` is silently discarded and the candidate lands on the detail page with the apply form closed.

**Fix direction:** in `job-detail.tsx`, read `useSearchParams()` and seed `showApplyForm` from the `apply` parameter.

**Verification:** from the job board, open a job in the drawer, click Apply Now, and confirm the apply form is expanded on arrival rather than closed.
