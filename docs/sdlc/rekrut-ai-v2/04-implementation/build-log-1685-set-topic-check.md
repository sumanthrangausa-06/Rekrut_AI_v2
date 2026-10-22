# Build log — #1685 (item 1): assessment-set creation verifies member question topics

- **Issue:** #1685, item 1 — `scripts/create-assessment-set.js` created an assessment set from question ids without verifying each question's `topic_id` equals the set's topic.
- **STOP 1:** Posted on #1685, comment 6349170058 (per dispatch brief; not re-verified from this local-only lane — no `gh` use per HL-007 lane rules).
- **Persona:** Nova (Phase 4 — Implementation). Worktree `wt-1685`, branch `nova/1685-set-topic-check`, off dev `3e8cc8f4a`. Local-only: no push, no commit, no `gh` — the parent verifies and lands.
- **Skills:** startup-cto → superpowers/test-driven-development (red-first) → ponytail (minimum diff, no new deps) → verification-before-completion. Harness lessons: HL-003 (evidence before done), HL-006 (this log, same piece of work), HL-007 (report claims only what exists on disk in the worktree).

## Root cause

`createAssessmentSet()` in `scripts/create-assessment-set.js` selected only `id, review_status` for the member questions, checked that every id exists, then inserted the set and its membership. `topic_id` was never read, so a question belonging to a different topic — or an unmapped question with `topic_id NULL` — could be placed into a set for another topic and creation succeeded.

## Fix (minimum diff, one file)

`scripts/create-assessment-set.js`:

1. The member-question query now also selects `topic_id`:
   `SELECT id, review_status, topic_id FROM assessment_questions WHERE id = ANY($1::int[])`
2. Immediately after the existing unknown-id check — and **before any INSERT** — a topic check aborts creation if any member's `topic_id !== topicId` (strict inequality, so `NULL` counts as a mismatch):
   - Error format: `question topic mismatch: question <id> has topic_id <question topic | NULL (unmapped)>, not set topic <set topic>` — one clause per offending question, joined with `; `, so every offender is named with both topics.
   - The throw happens inside the existing transaction, which rolls back; because the check precedes the set INSERT, nothing is written at all.

No other behaviour changes: validation order for all pre-existing checks, the set/member inserts, position ordering, the returned `{ setId, questionCount, approvedCount }`, and the CLI are untouched. No new dependencies, no schema change.

## Red-first evidence

No dedicated test suite for this script exists (grep over `server/`, `tests/`, `e2e/`, `scripts/` finds only the script itself; the only prior caller proof is the #1656 C3 real-DB E2E under `docs/sdlc/.../sumanth-batch-2026-10-21/1656-c3-e2e-proof.js`, which exercises only on-topic creation). Per the STOP 1 fallback, a runnable node check was written under `evidence-1685/`:

- Harness: `evidence-1685/check-1685-set-topic-check.js` — exercises the real exported `createAssessmentSet()` with a pg-style fake client (the function's own documented contract: "any pg-style client"). The fake only stands in for Postgres, returning fixture rows for the exact queries the script issues and recording every INSERT so "writing nothing" is observable. Fixtures: set topic 20; question 101 → topic 20/approved, 102 → topic 99/approved, 103 → NULL/approved, 104 → topic 20/pending.
  - Case 1: off-topic member (102) must be rejected, naming 102 and both topics (99, 20), with zero INSERTs.
  - Case 2: NULL-topic member (103) must be rejected, naming 103, NULL/unmapped, and set topic 20, with zero INSERTs.
  - Case 3: on-topic members (101, 104) must succeed exactly as before — `{ questionCount: 2, approvedCount: 1 }`, one set INSERT + two member INSERTs in order (101@1, 104@2).

- **RED** (`evidence-1685/red.log`, unpatched script, exit 1): **6 checks failed.** Case 1 outcome: `CREATED set {"setId":999,"questionCount":2,"approvedCount":2}` with 3 INSERTs including off-topic question 102. Case 2 outcome: `CREATED set {"setId":999,"questionCount":1,"approvedCount":1}` with 2 INSERTs including NULL-topic question 103. Case 3 (on-topic baseline) passed 3/3, confirming the harness pins pre-existing correct behaviour.
- **GREEN** (`evidence-1685/green.log`, patched script, exit 0): **all 9 checks passed.**
  - Case 1 rejected: `question topic mismatch: question 102 has topic_id 99, not set topic 20`, inserts=0.
  - Case 2 rejected: `question topic mismatch: question 103 has topic_id NULL (unmapped), not set topic 20`, inserts=0.
  - Case 3 unchanged: created with `{ questionCount: 2, approvedCount: 1 }` and the same insert sequence as RED.
  - `node --check scripts/create-assessment-set.js`: OK (recorded in green.log).

## Existing tests

None exist for this script (see above), so there was no existing suite to re-run; green.log records the grep that establishes this. The on-topic path pinned by case 3 is the same creation path the #1656 C3 E2E proof exercises against a real DB.

## Deviations / notes

- Evidence harness uses a pg-style fake client rather than a real Postgres throwaway DB (the `scripts/test-1664-curation-hazard.js` style). Reason: `createAssessmentSet` takes its client as a parameter by design, so the fake exercises the real function and its exact queries with full INSERT observability, without a migration-chain run. The parent may still run a real-DB proof at landing if it wants HL-003-grade evidence for this internal seed/test-time path.
- Biome: `npx @biomejs/biome check scripts/create-assessment-set.js` (this worktree has no installed `node_modules`; npx-fetched Biome) reports 1 formatting error on **both** the pristine HEAD file and the patched file — pre-existing formatting debt in untouched lines (e.g. the `questionIds` guard). Biome's suggestions for the two long lines this fix touched were applied to those lines only (patched Biome output: 80 lines vs HEAD's 92 — fewer complaints, none new); a whole-file reformat was deliberately not done (ponytail: minimum diff). Biome is therefore not claimed as passing — it did not pass before this change either. `node --check` passes.
- No GitHub writes, pushes, or commits from this lane (HL-007): all artefacts are files in the worktree, listed in the lane report for parent verification.
