# #1636 — Mobile sidebar has no My Profile label or identity block (build log)

**Issue:** Follow-up to #1607. On mobile, a candidate opens the sidebar drawer
and finds no "My Profile" entry and no sign of who they are signed in as —
only a nav item called "Profile" they must guess is the same door.
**PRD:** `02-planning/sumanth-batch-2026-10-21/prd-job-board-and-profile.md`
(#1607/#1608 area, §6 FR-M1 — profile entry verified on every navigation
surface, mobile included).
**STOP 1:** Nova, 2026-10-22 (issue #1636 comment 6336673198) — root cause
confirmed live on `origin/dev`, specialist decision recorded there
(Candidate Experience persona USED; accessibility lens USED; Recruiter
persona, UX architect, security/privacy considered and skipped with
reasons).

## Root cause

`client/src/components/layout/sidebar.tsx` contained "My Profile" 0 times,
no `Avatar` component, and no user name/email identity block (grep-verified
on `origin/dev` @ 1a8a6da). The only profile affordance was the candidate
nav item "Profile" → `/candidate/profile`; the sidebar bottom area was
Settings / Sign out only. The desktop header dropdown already had the
correct pattern (clickable avatar/name block + explicit "My Profile" item,
verified on #1607) — the sidebar simply never received it.

## What changed

- `client/src/components/layout/sidebar.tsx` (only production file changed):
  - Imports the existing `Avatar` component (same component and props the
    header uses: `src=user.avatar_url`, `fallback=user.name`,
    `seed=user.email || user.id`, `size="sm"`).
  - Adds an identity block directly under the sidebar header, rendered only
    when a user is signed in: a clickable NavLink (`aria-label="Go to my
    profile"`, ≥44px target, focus-visible ring) showing avatar, name and
    email, followed by an explicit "My Profile" NavLink with the `User`
    icon — mirroring the header dropdown's two doors to the same page.
  - Target follows the nav layout actually shown (`showRecruiterNav`):
    candidate layout → `/candidate/profile`, recruiter layout →
    `/recruiter/company` — the header dropdown's targets.
  - No `header.tsx` change. No new data: name/email/avatar already come
    from the `useAuth()` user the sidebar already consumed.

## Tests (red-first, user-journey)

New: `client/src/__tests__/components/SidebarMyProfile1636.test.tsx`
(JT-M1 on the mobile navigation surface):

- **RED (unmodified dev):** all 4 tests failed — no name/email identity,
  no avatar image, no link named "My Profile" (the exact user complaint).
- **GREEN (after fix):** 4/4 pass —
  1. candidate opening the sidebar sees name, email, avatar image, and a
     "My Profile" link to `/candidate/profile`;
  2. tapping "My Profile" lands on the Profile page;
  3. tapping the identity block also lands on the Profile page;
  4. recruiter sidebar shows the recruiter identity and "My Profile"
     goes to `/recruiter/company`, landing on the Company page.
- Full client vitest suite + client build: see PR for results.

## Independent review

Dispatched by Nova (ecc/code-reviewer + a11y-architect lens), 2026-10-22:
**APPROVE, no blockers.** Applied from its findings before opening the PR:
the identity link's accessible name now carries whose profile it opens
("Go to my profile, \<name\>"), and the "My Profile" entry gained the
focus ring-offset for parity with the header. Noted, not applied: a role
badge in the identity block (header parity nicety — deferred, the drawer
already badges role elsewhere in the app shell) and extracting a shared
profile-path helper for `header.tsx` (out of scope — header is untouched
by this lane; a follow-up may dedupe).

## Completion gate — evidence still owed

This lane provides the red→green journey test and the client build. The
Quinn fresh-install E2E (real HTTP against a fresh-install dev build on a
real database, mobile-viewport browser pass of the drawer) under HL-003 is
**not** claimed here — it remains owed before #1636 is closed, and the
issue stays open until Lead merges after independent review + that
evidence. The change is client-only with no API/DB writes, so the journey
risk the rig must cover is the rendered drawer in the real app shell
(auth bootstrap → drawer → profile page), not a data path.
