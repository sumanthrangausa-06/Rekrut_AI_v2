# #2082 — OmniScore candidate-visibility gate (build log)

**Issue:** #2082 · **STOP 1 + panel record:** issue comment 6569326116 on #2082
(Rex — architecture, privacy engineer — specialist, Recruiter — domain
persona; Suga synthesis is the build spec). **Founder ruling behind it:**
#1391 (2026-11-02) — recruiter access follows the candidate's own
Public-profile switch (`user_settings.privacy->>'profile_visible'`).

## Root cause

`GET /api/omniscore/candidate/:candidateId` checked only the caller's
role, then immediately ran `getOrCreateScore` / `calculateScore` and
returned the candidate's name, email and full score to ANY recruiter who
knew or guessed the id — the candidate's Public-profile switch was never
consulted. `GET /api/omniscore/leaderboard` had the same hole in both
its list query and its tier-distribution query. Candidate search
(#416) already kept this promise; these two read surfaces did not.

## Fix (what changed)

- `lib/candidate-visibility.js` — new distinctly-named DISCOVERY
  helpers, alongside (and not changing) the #1391 fail-closed analysis
  helpers:
  - `candidateDiscoverable(candidateId)` — implements the #416
    predicate (`routes/candidateSearch.js` CANDIDATE_VISIBILITY_SQL):
    hidden only on explicit `profile_visible='false'` or soft-delete;
    absent settings row/key = visible.
  - `denyUnlessCandidateDiscoverable(req, res, { candidateId, endpoint })`
    — on denial: audit log with the distinct actionType
    `candidate_visibility_denied` (metadata: `candidate_id`, `endpoint`,
    `reason` only — no email, no score), then 404
    `{error:'Candidate not found'}`.
- `routes/omniscore.js`
  - `GET /candidate/:candidateId`: role check → discovery gate → score
    work / candidate fetch. Denial performs ZERO writes (asserted by
    read-back: no `omni_scores` row created for a denied candidate).
    No jobId/applicant exception is built on this endpoint — it carries
    no job context; the exception stays on the job-scoped #1391
    surfaces.
  - `GET /leaderboard`: the same discovery predicate added to BOTH the
    list query and the distribution query. The `os.*` response shape is
    untouched (allowlist narrowing is follow-up #2083).

## Evidence (real HTTP, fresh DB, HL-003 rig)

Suite: `server/__tests__/routes/omniscore-candidate-visibility-2082-realdb.test.js`
— PostgreSQL 18 at 127.0.0.1:55442, throwaway DB built only by
`node migrate.js`, writer-shaped seeds, per-run fixture ids.

- **RED on pristine dev (b7a4a0763): 4 failed / 4 passed.** Failing:
  private→404+audit+no-row, private-applicant-no-job-context→404,
  soft-deleted→404, leaderboard exclusion. Passing (pre-existing
  correct behaviour): public→200, absent-settings→200,
  key-absent→200, non-recruiter→403.
- **GREEN after fix: 8 passed / 8 total, run twice consecutively.**
- **Regression:** #1391 suite
  (`screening-profile-visible-gate-1391-realdb.test.js`) 13/13 passed —
  the analysis gate's fail-closed behaviour is unchanged;
  #1787 omniscore tier-label real-DB suite 9/9 passed;
  `honest-null-trustscore` suite 12/12 passed.

Cases proven: private→404 + `candidate_visibility_denied` audit row
with minimal metadata + no `omni_scores` row created; public→200;
absent-settings→200; settings-row-without-key→200;
private-but-applicant (no job context)→404; soft-deleted→404;
leaderboard excludes the private candidate from the list AND the
distribution counts while including the public one (distribution count
asserted against ground truth computed from the seeds);
non-recruiter→403.
