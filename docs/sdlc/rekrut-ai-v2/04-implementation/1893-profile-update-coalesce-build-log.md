# #1893 — PUT /profile UPDATE branch null pass-through: build log

**Persona:** Nova (implementation), under Lead's STOP 1 on #1893 (comment 6430022294, 2026-10-26).
**Skills:** startup-cto → systematic-debugging → test-driven-development → verification-before-completion; ponytail (minimum diff, reuse the #1889 INSERT-branch pattern).
**Lessons:** HL-003 (E2E gate), HL-007 (landing proof verified first-hand).

## Root cause (verified first-hand at dev tip `78a190232`)

`routes/candidate.js` PUT /profile UPDATE branch (lines 445–446) passed
`JSON.stringify(preferred_job_types)` / `JSON.stringify(preferred_locations)`
into `preferred_job_types = COALESCE($13, preferred_job_types)` /
`preferred_locations = COALESCE($14, preferred_locations)`.
`JSON.stringify(null)` returns the STRING `'null'`, not SQL NULL, so
COALESCE saw a non-null parameter and overwrote the stored jsonb array
with the jsonb literal `null`. An API client PUTting
`preferred_job_types: null` / `preferred_locations: null` intending
"leave unchanged" silently wiped the stored preference.

Pre-existing: not introduced by #1889 — that lane touched only the INSERT
branch, which already passed null through correctly. The profile page is
unaffected (after #1889 it sends `[]` for the unanswered job-type option,
never null); impact is direct API callers only.

## Fix (smallest correct diff, UPDATE branch only)

```js
preferred_job_types != null ? JSON.stringify(preferred_job_types) : null,
preferred_locations != null ? JSON.stringify(preferred_locations) : null,
```

`null`/`undefined` now pass SQL NULL through, so COALESCE keeps the stored
value. `[]` still writes `[]` (explicit clear) and a real array still
writes. No INSERT-branch, schema, or client change.

## Red / green evidence (real DB, HL-003)

Rig: embedded PostgreSQL 18.4 (zonky binaries via `embedded-postgres`,
/tmp/pgnative) on `127.0.0.1:55471` + pgvector 0.8.7 — the same bounded
rig the #1631/#1889 lanes used (no documented rig was listening at run
start; the existing data directory was restarted). Throwaway DB
`nova1893_throwaway` proved `node migrate.js` exit 0 before the gate.
Both gate databases were built fresh ONLY by `node migrate.js`.

Suite: `server/__tests__/routes/candidate-profile-update-coalesce-null-1893.test.js`
(4 tests: 1 static contract + 3 real-DB over real HTTP via supertest
against the real candidate router and real `lib/db`; only auth is
mocked, #1787 pattern). Journey assertions on an EXISTING profile:
(a) PUT arrays → PUT null for both fields + a headline change → arrays
UNCHANGED, headline changed; (b) PUT `[]` clears to `[]`; (c) PUT a new
array replaces.

**RED** — DB `nova1893_red`, `node migrate.js` exit 0, code BEFORE the fix:

```
PREF1893_INTEGRATION_DB_URL=…/nova1893_red npx jest …1893.test.js --forceExit
→ Tests: 2 failed, 2 passed, 4 total
  (a) Expected: ["full-time"]  Received: null  (stored array wiped to jsonb-null)
  static contract failed (no null pass-through in the UPDATE branch)
  (b)/(c) controls passed
```

**GREEN** — DB `nova1893_green`, fresh `node migrate.js` exit 0, after the fix:

```
PREF1893_INTEGRATION_DB_URL=…/nova1893_green npx jest …1893.test.js --forceExit
→ PASS — Tests: 4 passed, 4 total
```

**Regressions** on the same fresh DB `nova1893_green`:

```
PREF1889_INTEGRATION_DB_URL=…/nova1893_green npx jest …1889.test.js --forceExit
→ PASS — Tests: 7 passed, 7 total
YEARS1631_INTEGRATION_DB_URL=…/nova1893_green npx jest …1631.test.js --forceExit
→ PASS — Tests: 8 passed, 8 total
```

## Specialist decision

Per STOP 1: database-reviewer lens, YES (light) — the defect is purely a
jsonb/COALESCE parameter-semantics issue and the fix pattern is already
proven by the #1889 INSERT branch. Security / Candidate Experience /
frontend specialists considered and skipped (no auth, page-behaviour, or
client change). Independent code review on the PR is pending at the time
of this log.
