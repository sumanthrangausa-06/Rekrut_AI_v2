# #1824 — Save & Exit promises resume, but the Assessments list shows no Resume door (build log)

**Issue:** Candidate starts a configured test, presses Exit → Save & Exit.
The exit dialog (`exit-fullscreen.tsx`) promises "You can resume this test
from the Assessments page." The candidate lands on the Assessments list and
the topic card shows only "Configure & Start" — no Resume affordance —
even though the session stays `in_progress` server-side with its draft
persisted, and direct navigation to `/candidate/assessments/<id>/take`
resumes it. Found on staging during the Train 5 retest (2026-10-24).
**STOP 1:** posted on #1824 (comment 6392142524) — root cause verified;
specialist decision: none needed (reuse the existing affordance pattern),
independent review + Quinn journey at the gate.

## Root cause

The catalogue payload's per-topic object carried `{availability, progress}`
but no resumable-session field. `CatalogTopic`
(`client/src/pages/candidate/assessment-configure.tsx`) had no such field
either, so the topic card in `assessments.tsx` could never switch to a
Resume action for a configured (topic) session; the only Resume render on
the list was the unrelated start-error banner.

## What changed

- `routes/assessments.js` — `loadCatalogTables(userId)` gains ONE query:
  latest `in_progress` session per topic for this user
  (`SELECT DISTINCT ON (topic_id) id AS session_id, topic_id FROM
  assessment_sessions WHERE user_id = $1 AND status = 'in_progress' AND
  topic_id IS NOT NULL ORDER BY topic_id, id DESC`), returned as
  `resumableSessions`. `GET /catalog` maps it to an explicit per-topic
  field `resumable: { sessionId } | null` (allowlist — rows never spread).
- `client/src/pages/candidate/assessment-configure.tsx` — `CatalogTopic`
  gains `resumable: { sessionId: number } | null`.
- `client/src/pages/candidate/assessments.tsx` — the topic card renders,
  when `topic.resumable` is non-null, the honest line "Test in progress —
  resume where you left off." and a **Resume** button (min-h-[44px])
  navigating to `/candidate/assessments/<sessionId>/take`, INSTEAD of
  Configure & Start. Configure & Start is deliberately not rendered while
  a session is resumable: a new start abandons the saved session
  (routes `/start` abandons prior `in_progress` per topic), so offering
  both would let a candidate silently destroy the saved attempt.

User-visible behaviour change: the Assessments list now keeps the exit
dialog's promise — a saved in-progress topic test shows Resume on its
card; all other cards are unchanged.

## Tests

- RED first, then green. Server: new
  `server/__tests__/routes/assessments-catalog-resumable-1824.test.js`
  (5 tests: owning user's resumable surfaced, other topics null, another
  user's session never leaks, no-session user gets null everywhere,
  topic allowlist shape, SQL pinned user-scoped / in_progress-only /
  topic-keyed / latest-first / no draft content). The #1653 catalogue
  suite's shape pin was extended with the new `resumable` key.
- Client: new
  `client/src/pages/candidate/assessments-resume-1824.test.tsx` (2 tests:
  resumable → Resume present + in-progress line + Configure & Start
  absent + click navigates to the same session's take page; null →
  Configure & Start only).
- E2E gate (HL-003): fresh-install rig — empty PG16 database built only
  by `node migrate.js`, real server over HTTP. Journey: register →
  catalog (resumable null) → configured start → Save & Exit with draft →
  DB read-back (session `in_progress`, draft stored) → catalog now
  carries `resumable {sessionId}` for the same session → second user
  sees null → `GET /session/:id/current` reads back `in_progress` with
  the draft intact. 6/6 PASS. Evidence:
  `hidden_files/1824-e2e-evidence.json` in the launch goal workspace.
