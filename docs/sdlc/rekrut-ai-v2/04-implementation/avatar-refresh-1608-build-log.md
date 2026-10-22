# #1608 — Uploaded profile picture not displayed in header (build log)

**Issue:** Candidate uploads a profile picture on the Profile page; the page
says "Photo updated" and shows the new picture locally, but the
header/dropdown keep showing the old/default avatar for the rest of the
session.
**PRD:** `02-planning/sumanth-batch-2026-10-21/prd-job-board-and-profile.md`
§4.4/§5.3/§6 FR-M2–M4, JT-M2–M3.
**STOP 1:** Scout, 2026-10-21 (issue #1608 comment) — root cause verified
live on dev.

## Root cause

The server write path was always correct: `POST /candidate/profile/photo`
(`routes/candidate.js:518`) writes both `candidate_profiles.photo_url` and
`users.avatar_url`. The break was client-side sync: the header/dropdown
render `user.avatar_url` from the auth context, and
`client/src/pages/candidate/profile.tsx` updated only its local state
(`setProfile`) after a successful upload — it never called the auth
context's `refreshUser()` (which re-reads `GET /auth/me` and updates the
context user), so the header stayed stale until reload or re-login.

## What changed

- `client/src/pages/candidate/profile.tsx` (only file changed):
  `CandidateProfilePage` now destructures `refreshUser` from `useAuth()`,
  and the `AvatarUpload` `onUploaded` handler calls `void refreshUser()`
  alongside the existing `setProfile` after a successful upload. No server
  change, no `header.tsx` change.

Checked and deliberately NOT changed:

- LinkedIn sync (`PersonalInfoTab.handleLinkedInSync`) also sets
  `avatar_url` in local state, but it does **not** share this root cause:
  `POST /candidate/linkedin/import` returns `{ success, summary, linkedin }`
  with no top-level `photo` field, so that handler never receives a photo
  URL from the current API contract. Separate disposition if ever pursued.
- `POST /settings/avatar` (orphaned writer, no client caller) — untouched
  per STOP 1 scope; JT-M3 disposition is a separate lane.

## Tests (red-first)

New: `client/src/__tests__/pages/ProfileAvatarRefresh1608.test.tsx`

- **RED (unmodified code):** "calls refreshUser() after a successful photo
  upload" FAILED — upload succeeded and "Photo updated" rendered, but the
  `refreshUser` spy was never called (the exact user complaint, JT-M2's
  in-session step). The FR-M4 guard test (failed upload ⇒ no refresh, real
  error shown) passed.
- **GREEN (after fix):** both tests pass; existing `ProfilePage.test.tsx`
  unaffected.
- Full client vitest suite run for regressions — see PR for the result.

## Completion gate

Unit/component evidence above proves the sync call. The Quinn E2E gate
(JT-M2 on the fresh-install rig, including verifying the stored B2 URL
actually loads in a browser rather than falling back to the generated
avatar) is a **separate lane** and is not claimed by this build log.
