## Summary

`dev` is **six commits ahead of `staging`**, and those six commits contain every bug fix completed this week. None of them are observable in the environment QA tests against, so completed work is being re-reported as broken.

This is currently the highest-leverage item on the board. It costs almost nothing to resolve and it is corrupting our signal about what is actually done.

## Evidence

```
origin/staging  472c89f  fix(admin): skip password strength check in non-prod envs
origin/main     6146888  docs(qa): full end-to-end candidate + recruiter QA sweep
origin/dev      9eaa2af  fix(perf): resolve useCallback hoisting issues
```

Commits on `dev` but not on `staging`:

| Commit | Change | Closes |
|---|---|---|
| `9eaa2af` | useCallback hoisting fixes | #85 |
| `77f1462` | Eliminate infinite render loops across 14 pages | #85 |
| `269a847` | SEO: sitemap, meta tags, structured data | #48 |
| `d696d7f` | Install react-helmet-async | #48 |
| `4add2d4` | Mobile responsive pass, touch targets, scroll lock | #47 |
| `bd99ee6` | Disaster recovery plan and rollback runbook | #46 |

`main` is also missing all six, and is itself only one commit ahead of `staging`.

## Why this matters

The 2026-08-08 QA sweep recorded `/recruiter/candidates` firing 1,255 API calls and `/candidate/omniscore` firing 286 including 70 POST writes. That sweep ran against an environment without the fix. The numbers are accurate but they describe stale code, so anyone reading the report concludes the work was never done. #96 was filed on exactly that misreading and has been closed as a duplicate.

## Acceptance criteria

- [ ] `dev` is merged to `staging` and deployed
- [ ] Network panel on `/recruiter/candidates` shows a bounded request count on load, not 1,255
- [ ] `/candidate/omniscore` issues exactly one `POST /omniscore/checkin` per page view, not 70
- [ ] The 14 pages listed in #85 are each loaded once and confirmed loop-free
- [ ] SEO from #48 and the mobile pass from #47 are verified on staging
- [ ] The branch promotion path is written down so this gap cannot silently reopen

## Out of scope

- Fixing #97 and #101, which the audit confirmed are still genuinely broken on `dev`
- Any new feature work

## Verification

```bash
git fetch --all
git rev-list --count origin/staging..origin/dev   # must be 0 when done
```

Then load each of the 14 pages from #85 with the network panel open and confirm request counts are bounded.

## Follow-up

Decide and document the promotion path, whether `dev` merges to `staging` directly or through `main`. The current three-branch state, with `main` ahead of `staging` but behind `dev`, is ambiguous, and that ambiguity is what produced this gap.
