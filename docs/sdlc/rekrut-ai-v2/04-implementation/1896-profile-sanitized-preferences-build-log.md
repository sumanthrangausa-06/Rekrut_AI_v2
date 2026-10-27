# #1896 — PUT /profile sanitized preference pass-through (build log)

**Issue:** #1896 · **Branch:** `nova/1896-profile-sanitized-preferences` · **Base:** dev `c8013ed2f`

## Defect
`PUT /profile` (`routes/candidate.js`) computed `sanitizedTimezonePreference`
and `sanitizedTravelWillingness` via `normalizeTextField`, then the UPDATE
branch passed the RAW `req.body` values for `remote_preference`,
`timezone_preference` and `travel_willingness` instead. `remote_preference`
had no sanitized variable at all (INSERT passed `remote_preference || null`
raw) into a `VARCHAR(50)` column (migration 004).

Effects: a >50-char `remote_preference` produced a raw Postgres
value-too-long 500 instead of the honest 400 every sibling field returns;
UPDATE stored timezone/travel values untrimmed and unstripped; an
empty-string timezone overwrote the stored value instead of meaning
"no answer" (the COALESCE/null semantics restored for sibling fields in
#1889/#1893).

## Fix (one handler, no schema, no client change)
- New `sanitizedRemotePreference = normalizeTextField(remote_preference, 50, 'remote_preference')`.
- UPDATE branch now passes `sanitizedRemotePreference`,
  `sanitizedTimezonePreference`, `sanitizedTravelWillingness` ($15/$16/$17).
- INSERT branch now passes `sanitizedRemotePreference` instead of
  `remote_preference || null`.
- For the values the profile page actually sends (short clean strings),
  sanitized output is byte-identical — no user-visible change for the
  normal path. Existing rows are NOT healed (separate data gate).

## Evidence (HL-003, fresh-install rig)
- Rig: local PG16 + pgvector on 127.0.0.1:55496; DBs built ONLY by
  `node migrate.js` ("All migrations completed successfully").
- RED (pristine dev, DB `red1896`): new suite 5 failed / 1 passed — only the
  clean-values control passed; overlong remote_preference returned 500 on
  both branches, raw timezone/travel stored uncleaned, `''` overwrote 'UTC'.
- GREEN (branch, DB `green1896`): 6/6 passed.
- Neighbours on the green DB: #1893 suite + #1889 suite — 11/11 passed.
- Suite: `server/__tests__/routes/candidate-profile-sanitized-preferences-1896.test.js`
  (real HTTP via supertest against the real candidate router + real lib/db;
  only auth is mocked, the #1787 pattern).

## Gates
STOP 1 on #1896 (specialist decision: none — one-point handler defect,
existing pattern reused; independent code review still applied) → red-first
→ green → independent review → merge to dev. Rides the next promotion train
after Train 14C.
