# #2083 — OmniScore leaderboard field allowlist — build log

**Plain first:** the recruiter leaderboard API sent every column of a
candidate's OmniScore record — including fraud signals and the full
factor breakdown — to the browser. It now sends only the fields the
ranking screen actually displays.

## Change

- `routes/omniscore.js` GET `/leaderboard`: `SELECT os.*` replaced with
  the explicit allowlist `os.user_id, os.total_score, os.score_tier,
  os.interview_score, os.technical_score, os.resume_score,
  os.behavior_score` (+ unchanged `u.name/email/avatar_url`,
  `cp.headline/location/years_experience`, `applications_count`).
- No other behaviour moves: the role gate, the #2082 discovery
  visibility predicate, the tier-label translation and the tier
  distribution query are untouched.

## Why this allowlist

The only consumer is `client/src/pages/recruiter/omniscore.tsx`; its
`CandidateRow` interface and render code use exactly the allowlisted
fields (verified first-hand at dev 66b7446da). Removed from the
response: `id`, `factor_scores`, `peer_percentile`, `fraud_signals`,
`last_checkin_at`, `version`, `last_updated`, `created_at`.

## Specialist decision

Privacy engineer — YES (field-level over-exposure of internal
evaluative data; flagged by the privacy lens in the #2082 panel).
Security-reviewer skipped (no auth surface moves), UX skipped (no UI
change). Recorded in the STOP 1 comment on #2083.

## Evidence (HL-003, fresh-install real-DB rig, PG 18 @55442)

- New suite `server/__tests__/routes/omniscore-leaderboard-allowlist-2083-realdb.test.js`
  (Quinn + Recruiter persona journey): RED before fix — 2 failed /
  2 passed (extra keys incl. `id`, `version` present; sentinel leak
  path open). GREEN after fix — **4/4 passed**: exact key set +
  rendered values, no leaked key/sentinel anywhere in the payload,
  private candidate still absent, non-recruiter still 403.
- Regression: #2082 visibility suite re-run on a second fresh DB —
  **8/8 passed**.
- Both DBs (`rekrut_2083`, `rekrut_2082`) created empty and built
  only by `node migrate.js` (exit 0).
