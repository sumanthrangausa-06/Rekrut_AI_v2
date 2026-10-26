# #1889 — profile preference answered-state: build log

**Persona:** Nova (implementation), under Lead's STOP 1 on #1889 (comment 6429151587, 2026-10-26).
**Skills:** startup-cto → systematic-debugging → test-driven-development → verification-before-completion; ponytail (minimum diff, reuse the #1631 pattern).
**Lessons:** HL-003 (E2E gate), HL-005 (merge-as-you-go), HL-007 (landing proof verified first-hand).

## Root cause (verified first-hand on dev `6ac33fc51`)

Same defect family as #1631 (fixed the same day, PR #1888): a database/system default read as if the user answered it, on three NON-completion profile fields.

- `migrations/004_candidate_profiles.js:21,24,26` — `availability DEFAULT 'immediately'`, `preferred_job_types DEFAULT '["full-time"]'`, `remote_preference DEFAULT 'hybrid'`. Every side-door INSERT that omits the columns manufactures answers (`routes/settings.js:107,203`, `routes/candidate.js:542,615,712`, `routes/candidate-preferences.js:214`, others).
- The invented availability is not even a real choice: the profile page vocabulary is `open / actively_looking / not_looking / available_soon`; `'immediately'` has no label and the header badge renders the raw invented word.
- Client fallbacks in `client/src/pages/candidate/profile.tsx`: `profile.remote_preference || 'hybrid'`, `profile.preferred_job_types?.[0] || 'full-time'`, `profile.availability || 'open'` (a third vocabulary).
- Server coercions on the PUT `/profile` INSERT branch (`routes/candidate.js`): `JSON.stringify(preferred_job_types || ['full-time'])` and `remote_preference || 'hybrid'`.
- Downstream consumers are null-safe (verified first-hand): `client/src/pages/candidate/jobs.tsx` treats null/empty preferences as "no preference"; `services/fitScore.js` guards with `|| ''` / `|| []`; the header badge renders only when `profile.availability` is truthy.

## Founder semantics (Sumanth's #1631 ruling, 2026-10-26 — applies to this sweep by the issue's own terms)

- Untouched = UNANSWERED: no invented availability, work-style or job-type preference anywhere — not on the profile, not in job filtering, not in fit scoring.
- An explicit choice = the answer, stored and shown exactly as chosen.

## Design / changes (exactly the STOP 1 scope)

1. **Migration `295_candidate_profile_preferences_no_default.js`** (294-pattern): up = DROP DEFAULT on `availability`, `remote_preference`, `preferred_job_types` with a post-state assertion (all three `column_default IS NULL`); down = restores the three migration-004 defaults. **Existing rows are NOT healed** — separate founder data gate, out of this lane. No UPDATE anywhere.
2. **`preferred_locations` DEFAULT '[]' KEPT — decided on STOP 1:** an empty set renders as nothing and is never presented as a candidate's choice; it does not violate the standard. This completes the audit pass the issue asked for.
3. **`client/src/pages/candidate/profile.tsx`**: the three selects get the #1631 treatment — value falls back to `''`, first option `<option value="">Select…</option>`, change sends `null` (availability / remote_preference) or `[]` (preferred_job_types) for the unanswered option.
4. **`routes/candidate.js`** PUT /profile INSERT branch: `JSON.stringify(preferred_job_types || ['full-time'])` → pass-through (`preferred_job_types ? JSON.stringify(preferred_job_types) : null`); `remote_preference || 'hybrid'` → `remote_preference || null`. The UPDATE branch is COALESCE-guarded, so null on update keeps the existing answer (the #1631 ruled semantics).

## Mid-build discoveries — STOP 1 amendments 1 + 2 (on #1889, comments 6429231137 / 6429254832)

The journey test's explicit-choice leg failed with HTTP 500 even for the
page's own values, exposing a deeper defect in the same field:

1. **Zero vocabulary overlap (amendment 1):** `chk_candidate_profiles_availability`
   (migration 047) allows only notice-period values; the profile page offered
   search-status values (`open / actively_looking / not_looking / available_soon`)
   that no save could ever store. The page was aligned to the notice-period
   vocabulary the DB, `candidate_search_index` and the search seeds share.
2. **Two overlapping CHECKs (amendment 2):** a second, older constraint pair
   (`chk_profiles_availability` / `chk_profiles_remote_preference`,
   `migrations/p2_schema_hardening.sql`) further narrows the storable set.
   Verified via `pg_constraint` on the rig DB: storable availability =
   `immediately / '2 weeks' / '1 month'` only; storable remote_preference =
   `remote / hybrid / onsite` (`flexible` 500s). The page now offers exactly
   the storable set (the unstorable `flexible` option was a dead button and
   was removed). **No constraint was touched.** Reconciling the duplicate
   CHECKs and restoring the richer options is filed as **#1891** (schema
   decision, own STOP 1). The screening-enrichment free-text availability
   write is filed as **#1890**.

## Red / green evidence (real DB, HL-003)

Rig: embedded PostgreSQL 18.4 (zonky binaries via `embedded-postgres`, /tmp/pgnative) on `127.0.0.1:55471` + pgvector 0.8.7 — the same bounded rig the #1631 lane used (no documented rig was listening at run start; ports 55433/55471 were silent, the data directory from the #1631 lane was restarted). Both databases were built fresh ONLY by `node migrate.js`.

Suite: `server/__tests__/routes/candidate-profile-preferences-answered-state-1889.test.js` (7 tests: 3 static contract + 4 real-DB over real HTTP via supertest against the real candidate router and real `lib/db`; only auth is mocked, #1787 pattern). Candidate Experience journey assertions: (a) side-door row → all three NULL; (b) PUT explicit choices → read back exactly; (c) PUT with no preference fields on a fresh profile → NULLs, no server coercion; (d) PUT the page's unanswered payload shape (null / null / []) → NULL / NULL / [].

**RED** — DB `nova1889_red`, migrated from dev `6ac33fc51` BEFORE this fix (no migration 295, original code):

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55471/nova1889_red node migrate.js → exit 0 (pre-fix tree, no migration 295)
PREF1889_INTEGRATION_DB_URL=…/nova1889_red npx jest …1889.test.js --forceExit
→ Tests: 7 failed, 7 total
  (a) side-door row read back manufactured values; (b) explicit PUT → HTTP 500;
  (c)/(d) remote_preference read back "hybrid" (server coercion + DB default);
  3 static contracts failed (no migration 295, client fallbacks present, server coercions present)
```

**GREEN** — DB `nova1889_green`, fresh `node migrate.js` including migration 295:

```
Fresh DB nova1889_green3 built ONLY by node migrate.js → exit 0;
migration 295 post-state line printed; column_default read back NULL for
availability / remote_preference / preferred_job_types (preferred_locations
keeps '[]'::jsonb, as decided; years_experience NULL — migration 294 intact).
PREF1889_INTEGRATION_DB_URL=…/nova1889_green3 npx jest …1889.test.js --forceExit
→ PASS — Tests: 7 passed, 7 total
Regressions on the same fresh DB: #1631 suite 8/8 PASS;
honest-null-candidate-routes 4/4 PASS (no DB env).
Client npx tsc --noEmit: no errors in candidate/profile.tsx.
```

## Migration note

Migration 295 changes only future INSERT behaviour. Existing rows are NOT healed (separate founder data gate). Rollback is down() restoring the migration-004 defaults, or a forward fix per the shared-DB rule.
