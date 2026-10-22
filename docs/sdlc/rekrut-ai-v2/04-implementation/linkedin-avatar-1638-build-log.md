# #1638 — LinkedIn import set photo_url without avatar_url (build log)

**Issue:** `mergeLinkedInProfile` could fill `candidate_profiles.photo_url`
with the imported LinkedIn picture while never writing `users.avatar_url`.
The header renders `users.avatar_url` from the auth context, so an
imported picture existed on the profile while the header kept showing the
default avatar — the same symptom class as #1608, via a different writer.
Filed from the independent review of PR #1637 (finding 5).
**PRD:** `02-planning/sumanth-batch-2026-10-21/prd-job-board-and-profile.md`
§6 FR-M2 (one avatar value).
**STOP 1:** Nova, 2026-10-22 — root cause verified live on dev.

## Root cause

`routes/candidate.js:5932` `mergeLinkedInProfile(userId, linkedinProfile)`,
step 2 upsert (`routes/candidate.js:5966`): `photo_url = COALESCE(candidate_profiles.photo_url, EXCLUDED.photo_url)`
with `linkedinProfile.picture` — and no statement anywhere in the function
writes `users.avatar_url`. Step 1's users UPDATE touches only
name/title/linkedin_data. Contrast the converged writer,
`POST /candidate/profile/photo` (`routes/candidate.js:540–553`), which
writes `photo_url` and then `UPDATE users SET avatar_url = $1 WHERE id = $2`.

Cross-module writer audit (STOP 1, 2026-10-22):

- `candidate_profiles.photo_url` writers: profile photo upload
  (converged — also writes `avatar_url`); LinkedIn merge (this bug);
  orphaned `POST /settings/avatar` (`routes/settings.js:203`, divergent,
  no client caller — disposition JT-M3 still owed on #1608, out of scope
  here); erasure (`services/euComplianceService.js:680` NULLs it, paired
  with `lib/erasureService.js:857` NULLing `avatar_url` — converged).
- `users.avatar_url` writers: photo upload (paired); OAuth link/create in
  `routes/auth.js` (fill-gaps `COALESCE(avatar_url, $2)`, users-side only —
  profile reads fall back `avatar_url || photo_url` at
  `routes/candidate.js:3750`, so no header symptom); deletion/erasure NULLs.

## Fix (fill-gaps, following the merge's own semantics)

The merge never overwrites manually-entered data, so the avatar write is
fill-gaps too. New step 2b immediately after the step-2 upsert in
`mergeLinkedInProfile` — one statement that copies the profile's
*effective* `photo_url` into `users.avatar_url` only when `avatar_url`
is empty:

```sql
UPDATE users u
SET avatar_url = cp.photo_url, updated_at = NOW()
FROM candidate_profiles cp
WHERE cp.user_id = u.id AND u.id = $1
	AND (u.avatar_url IS NULL OR TRIM(u.avatar_url) = '')
	AND cp.photo_url IS NOT NULL
```

Copying the effective value (not just the LinkedIn picture) converges the
two columns in every branch: fresh import, pre-existing profile photo with
an empty avatar (legacy divergence healed on next import), and it no-ops
when there is no photo or an avatar is already set.

## Tests

`server/__tests__/routes/candidate-linkedin-import-avatar-1638.test.js`
(jest + supertest, repo-standard mocked `lib/db` extended with an in-memory
interpreter applying real fill-gaps semantics; LinkedIn API and token
decrypt are the mocked boundaries). Four cases:

1. Import fills `photo_url` ⇒ `users.avatar_url` holds the same picture. **Red before the fix** (`avatar_url` stayed `null`), green after.
2. Existing `avatar_url` (manual upload) is never overwritten by an import.
3. Existing `photo_url` is not overwritten; the empty avatar fills with that same value.
4. No picture anywhere ⇒ no avatar written (no fabricated value).

Neighbouring suites re-run: candidate-one-click-apply,
candidate-application-status-guard, candidate-company-matches-1271 and
honest-null-candidate-routes pass. `candidate-autosend.test.js` has 3
failures that are **pre-existing on unmodified origin/dev** (verified by
stash-and-rerun) and unrelated to this change.

Fresh-install rig E2E (HL-003) and independent review remain Suga/Quinn
lanes before closure.
