# #1852 — CV Review: show which CV was analyzed (build log)

**Founder finding (2026-10-25, staging test):** CV Analyze completed, but
nothing on the CV Review page showed *which* uploaded CV was analyzed. The
upload/manage door lives only on the candidate Profile page, so the score
could not be traced to the user's own document — a trust gap.

## Root cause (STOP 1 on the issue)

`POST /candidate/cv/analyze` picks the caller's latest `parsed_resumes` row
server-side, but `GET /candidate/cv/analysis/:id` returned only the
`cv_analyses` row (with `document_id`, no filename or upload date), and
`cv-review.tsx` never fetched any source-document identity. The page had
nothing to display.

## Fix (display only — no change to analysis behaviour, scoring, or gating)

- `routes/candidate.js`: new `GET /candidate/cv/source-document`
  (`authMiddleware`) returning the caller's own latest `parsed_resumes`
  `{ original_filename, created_at, parsing_status }`, or
  `{ document: null }` when none. Filename + upload date ONLY — the query
  selects no `file_url` and no `parsed_data`, and the row filter is
  `WHERE user_id = req.user.id`.
- `routes/candidate.js`: `GET /candidate/cv/analysis/:id` LEFT JOINs
  `parsed_resumes` on the analysis's own `document_id` and adds
  `document_filename` + `document_uploaded_at` (both null if the document
  row is gone).
- `client/src/pages/candidate/cv-review.tsx`: on load, the idle state
  fetches the source-document endpoint and shows "Your CV on file:
  <filename> · uploaded <date>", or the honest "No CV on file yet" when
  the endpoint returns null (a failed lookup shows nothing rather than a
  false empty claim). The completed state shows "Analyzed: <filename> ·
  uploaded <date>" from the enriched analysis payload. A "Manage CV"
  button appears in both states.
- `client/src/pages/candidate/profile.tsx`: `id="resume"` anchor added to
  the ResumeUpload section. The Manage CV link targets
  `/candidate/profile?section=personal#resume` — the profile page's
  existing `?section=` mechanism selects the Personal tab where the
  resume control lives (a bare `#resume` hash alone would land on the
  default Overview tab, where the section is not rendered).

## Specialist review

Security review of the new endpoint was the mandatory specialist decision
(recorded at STOP 1 on the issue): the endpoint's safety property is
caller scoping + column minimality. Independent code review of the diff
checked the `user_id` scoping, the selected column list, and the
cross-user isolation legs of the E2E check.

## Evidence

- `tests/cv-source-document-1852.check.js` — real HTTP against the real
  auth + candidate routers on a fresh-migrated Postgres: register/login
  two candidates → empty state `{document:null}` → seeded
  `parsed_resumes` row returns exactly its filename + date + status and
  no `file_url`/`parsed_data` anywhere in the body → second user never
  sees the first user's document and sees only their own → unauthenticated
  request 401 → `GET /cv/analysis/:id` carries that analysis's document
  filename + upload date, and 404s for the other user. Full request /
  status / body log: `evidence/e2e-1852.log` in this directory.
- The full analyze path (live AI provider) is not exercised by this
  change — analysis behaviour is untouched; the display legs above are
  the gate for this story.

## Independent review outcome

Independent code review of the full diff: **APPROVE WITH FIXES, no
BLOCKs.** Security conclusion (quoted in the PR body): the endpoint can
only ever return the caller's own filename + date.

Fixes applied from the review:
- The E2E check now redacts `token`/`accessToken`/`refreshToken` before
  logging any response body, so no credential-shaped strings reach the
  committed evidence log (verified: 0 matches in `evidence/e2e-1852.log`).
- Returning to idle via "Analyze Again" (`handleReset`) now refetches the
  source document, so a CV changed in Profile during the session is not
  shown stale.

Reviewer claim checked first-hand and NOT reproduced: the reviewer
reported the existing `CvReviewAnalyzeFeedback` / `CvReviewPollTimeout`
client suites failing. Run locally on this branch (vitest, this tree):
**2 files, 3 tests, all PASS** — both before and after the review fixes.
The one local failure observed during verification was an environment
ENOSPC (`/tmp` tmpfs full), which cleared with disk space and is the
likely source of the reviewer's result.
