# #1631 — years_experience answered-state: build log

**Persona:** Nova (implementation), under Lead's STOP 1 on #1631 (2026-10-26).
**Skills:** startup-cto → systematic-debugging → test-driven-development →
verification-before-completion; ponytail (minimum diff, reuse).
**Lessons:** HL-003 (E2E gate), HL-005, HL-007.

## Root cause (systematic-debugging, verified first-hand on dev `d664186c6`)

- `migrations/004_candidate_profiles.js:27` — `years_experience INTEGER
  DEFAULT 0`. Every INSERT that omits the column manufactures a 0 the
  user never gave. Side doors that omit it: `routes/candidate.js` photo
  upload (`INSERT INTO candidate_profiles (user_id, photo_url)`), resume
  paths, `routes/settings.js` (`INSERT … (user_id, bio, location,
  linkedin_url)`), `routes/candidate-preferences.js`.
- The completion formula is NOT the bug: `client/src/lib/profile-completion.ts`
  and its server mirror (GET `/dashboard/stats` in `routes/candidate.js`)
  both count `years_experience != null` — correct on honest data.
- Client defects in `client/src/pages/candidate/profile.tsx`: the Years
  of Experience number input coerced empty → `parseInt(...) || 0`
  (clearing the field answered 0 for the user), and the header chip
  rendered `0 years exp.` instead of words.
- **Additional coercion found during this build (brief §3):** the INSERT
  branch of PUT `/profile` in `routes/candidate.js` passed
  `sanitizedYearsExperience || 0` — a fresh-profile PUT carrying `null`
  (the select's unanswered option) would have been coerced back to a
  manufactured 0 even after the default was dropped. Fixed as the single
  coercion in scope: now passes `sanitizedYearsExperience` through
  (`normalizePositiveInteger` already passes null/undefined through and
  accepts explicit 0; the UPDATE branch is COALESCE-guarded, so null on
  update keeps the existing value, and null on insert writes NULL — the
  ruled semantics).

## Founder semantics (2026-10-26, recorded on #1631)

- Untouched = UNANSWERED: no completion credit, stays in the
  missing-sections nudge (`Years of Experience`).
- Explicit 0 = **'No experience'**: a real answer — counts toward
  completion and displays in words.

## Design / changes (exactly the STOP 1 scope)

1. **Migration `294_candidate_years_experience_no_default.js`**
   (290-pattern): up = `ALTER TABLE candidate_profiles ALTER COLUMN
   years_experience DROP DEFAULT;` with a post-state assertion
   (column exists, `column_default IS NULL`); down = `SET DEFAULT 0`.
   **Existing rows are NOT healed** — rows already carrying a
   manufactured 0 stay 0; backfilling them to NULL is a separate founder
   data gate, explicitly out of this lane. No UPDATE anywhere.
2. **`client/src/pages/candidate/profile.tsx`**:
   - Years of Experience number `<Input>` → native `<select>` styled
     like the neighbouring Remote Preference select: `''` → "Select…"
     (unanswered, sends `null`), `0` → "No experience", `1` → "1 year",
     `2..50` → "N years".
   - `Profile.years_experience` widened to `number | null`;
     `updateField` value type widened to include `null`. The save
     payload (`{ ...data }` spread in `saveProfile`) passes null through
     unchanged — no other client coercion found.
   - Header chip: `0` → "No experience"; `> 0` → "N years exp."
     (unchanged wording); `null` → no chip (unchanged).
3. **No change** to `profile-completion.ts` or the server formula —
   both already implement the ruled semantics on honest data.

## Class-sweep audit (founder-attached on #1631)

The 12 completion fields and their DB defaults (migration 004 read field
by field; users-table fields per STOP 1 verification):

| # | Completion field | Source | DB default that reads as a user answer? |
|---|---|---|---|
| 1 | name | users.name | No default |
| 2 | headline | candidate_profiles.headline | None |
| 3 | bio | candidate_profiles.bio | None |
| 4 | location | candidate_profiles.location | None |
| 5 | linkedin_url / github_url | candidate_profiles | None |
| 6 | resume_url | candidate_profiles.resume_url | None |
| 7 | hasSkills | candidate_skills count | n/a (count) |
| 8 | hasExperience | work_experience count | n/a (count) |
| 9 | hasEducation | education count | n/a (count) |
| 10 | phone | candidate_profiles.phone | None |
| 11 | **years_experience** | candidate_profiles.years_experience | **`DEFAULT 0` — THE defect, fixed by migration 294** |
| 12 | avatar_url | users.avatar_url / photo_url | No default |

**years_experience is the ONLY completion field with a non-null DB
default.**

Non-completion defaults that still present as user answers — audited
here, **follow-up defects under the same standard, NOT fixed in this
lane** (per STOP 1, they do not balloon this PR):

| Field | Default | Note |
|---|---|---|
| candidate_profiles.availability | `DEFAULT 'immediately'` (mig 004) | Also the profile.tsx Availability select falls back to `'open'` client-side — a different vocabulary again |
| candidate_profiles.remote_preference | `DEFAULT 'hybrid'` (mig 004) | profile.tsx select also falls back `\|\| 'hybrid'` |
| candidate_profiles.preferred_job_types | `DEFAULT '["full-time"]'` (mig 004) | profile.tsx Job Type select falls back `\|\| 'full-time'`; PUT insert branch also defaults `['full-time']` |
| candidate_profiles.preferred_locations | `DEFAULT '[]'` | Empty set — renders as nothing; lowest risk |

## Red / green evidence (real DB, HL-003)

Rig: embedded PostgreSQL 18.4 (zonky binaries via `embedded-postgres`)
on `127.0.0.1:55471` + pgvector 0.8.7 (PGDG .deb, extracted into the
rig) — no documented rig was listening at run start (TOOLS.md's pguser
layout does not exist on this VM; ports 55433/55471 were silent), so
this bounded rig was provisioned in /tmp. Both databases were built
fresh ONLY by `node migrate.js`.

Suite: `server/__tests__/routes/candidate-years-experience-answered-state-1631.test.js`
(8 tests: 4 static contract + 4 real-DB over real HTTP via supertest
against the real candidate router and real `lib/db`; only auth is
mocked, #1787 pattern). Candidate Experience journey assertions:
(a) side-door row (exact `routes/settings.js` INSERT shape) → NULL, no
credit, nudge lists the field; (b) PUT 0 → 0, credit; (c) PUT 8 → 8,
credit; (d) PUT null on a fresh profile → NULL, no credit.

**RED** — DB `nova1631_red`, migrated from dev `d664186c6` BEFORE this
fix (no migration 294, original code):

```
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55471/nova1631_red' node migrate.js   # exit 0
YEARS1631_INTEGRATION_DB_URL='postgresql://postgres:postgres@127.0.0.1:55471/nova1631_red' \
  npx jest server/__tests__/routes/candidate-years-experience-answered-state-1631.test.js --forceExit
→ Tests: 6 failed, 2 passed, 8 total
  (a) expect(readYears).toBeNull() — Received: 0
  (d) expect(readYears).toBeNull() — Received: 0
  4 static contracts failed (no migration 294, old input, old chip, || 0 present)
  (b)/(c) passed — explicit values already worked
```

**GREEN** — DB `nova1631_green`, fresh `node migrate.js` including
migration 294 (its post-state assertion printed: column_default is
NULL), same jest command with `YEARS1631_INTEGRATION_DB_URL=…/nova1631_green`:

```
→ PASS — Tests: 8 passed, 8 total
```

Regression spot-checks after green:

- `npx jest server/__tests__/honest-null-candidate-routes.test.js
  server/__tests__/routes/candidate-years-experience-answered-state-1631.test.js
  --forceExit` (no DB env — real-DB describe skipped): **2 suites
  passed, 8 passed + 4 skipped**.
- Client `npx tsc --noEmit`: no errors in `candidate/profile.tsx`
  (pre-existing test-file type errors elsewhere in the client are
  untouched by this lane).

## Migration note

Migration 294 changes only future INSERT behaviour. Existing rows are
NOT healed (separate founder data gate). Rollback is down() restoring
`DEFAULT 0`, or a forward fix per the shared-DB rule.
