# Build Log — #1744 Items 1 & 2: client matchScore type honesty + Lane-1 test cache hardening

**Story:** #1744 — follow-up hygiene from the #1731 score-honesty lanes
(STOP 1 posted on #1744; items 1 and 2 only — item 3 was already fixed in
#1731 Lane 3 / PR #1749, `dashboard.tsx` untouched here)
**Branch:** `nova/1744-client-type-cache` (off origin/dev `ef8418382`)
**Persona:** Nova (build lane) · Status: built in worktree, committed and
pushed by Nova — Lead verifies and lands (HL-007).

## Item 1 — client type honesty (`client/src/pages/recruiter/candidates.tsx`)

Type-only change; no runtime behaviour change.

- `Candidate.matchScore`: `number` → `number | null`. The server payload
  (`routes/recruiter.js`, GET /candidates/full) sends
  `matchScore: row.match_score ?? null` since #1731 Lane 1, so `null` is
  the honest "no measured match" value and the client type now admits it.
  `normalizeCandidate` spreads the raw payload, so the value already
  flowed through at runtime untyped.
- `Candidate.matchScore_status?: 'insufficient_data' | 'measured'` added —
  the same payload carries `matchScore_status`
  (`row.match_score == null ? 'insufficient_data' : 'measured'`).
- `ProfilePreviewData.matchScore`: `number` → `number | null`. Both
  declarations were widened together so the fallback assignment
  `matchScore: candidate.matchScore` (~L600) still type-checks.
- `ProfilePreviewData` deliberately gets **no** `matchScore_status`: the
  preview payload (GET /api/candidates/:id/preview, `routes/candidateSearch.js`)
  carries no match score at all, and `normalizePreviewProfile` maps none —
  typing a field no payload supplies would be a new fiction.
- Downstream is already null-safe: `CandidateCard` declares
  `matchScore?: number | null` and renders only under `!= null`; the
  preview badge likewise guards `!= null` before comparing.

## Item 2 — test hardening (`server/__tests__/routes/recruiter-1731-lane1.test.js`)

- `analyticsCache.clear()` now runs in `beforeEach`, so a cached
  `/pipeline-stats` response (keyed by companyId) can never leak across
  tests in the suite.
- The singleton is required **after** `jest.resetModules()` in `beforeAll`
  (stored in a `let analyticsCache` alongside `pool`/`app`, the file's own
  pattern). A top-level import would be a different instance from the one
  the freshly loaded recruiter router uses, and clearing it would be a
  silent no-op. `analyticsCache` is the singleton exported from
  `lib/analytics-cache.js`; `.clear()` is the established reset — the same
  call `server/__tests__/analytics-cache.test.js` uses.

## Evidence

- **TypeScript** (`npx tsc --noEmit` in `client/`, no tsc script exists in
  client/package.json): 78 errors on base, 78 errors after — the error sets
  are identical except the one pre-existing `candidates.tsx` error moving
  L600 → L601 (the added status line). That error is the pre-existing
  `omniScore: candidate.omniScore ?? candidate.omniscore` assignment
  (`number | null | undefined` into `number | undefined`, from the older
  `omniscore?: number | null` field) — not introduced here, not in scope.
  Zero `matchScore` errors before or after.
- **Lane-1 suite** (real DB, local PG16 on 127.0.0.1:55448, throwaway DB
  `rekrut_1731_1744_test`):
  `RECRUITER1731_INTEGRATION_DB_URL='postgresql://postgres@127.0.0.1:55448/rekrut_1731_1744_test' npx jest server/__tests__/routes/recruiter-1731-lane1.test.js --forceExit`
  → **1 suite passed, 9 passed / 9 tests** (S-1 ×3, S-2 ×5, S-3 ×1).
- **Worktree incident (recorded honestly):** a mid-run `git stash pop`
  collided with the repo-shared stash (another lane's `fix/1224` entry was
  on top; this lane's pathspec stash entry was lost and the pop applied
  nothing). Verified the worktree was clean at base `ef8418382` with no
  foreign changes, then re-applied the edits — the resulting blob hashes
  (`8ca8ab801`, `52f2dbe58`) are byte-identical to the pre-incident diff,
  and tsc was re-run on the final content (78 errors, same set).
