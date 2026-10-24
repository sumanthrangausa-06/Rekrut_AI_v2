# #1679 items 3–9 — build log (C2 client residuals, second lane)

Base: dev `122587d20`. Branch `nova/1679-items-3-9`. STOP 1: #1679 comment
6347378630 (all premises parent-verified first-hand on the dev tip).

**Provenance (HL-007) — CORRECTED 2026-10-22 (see #1679 comment
6348974826):** an earlier version of this paragraph attributed claims to
the builder's report (a non-existent commit, a never-created evidence
directory, a summary claiming the NIT was skipped) that the builder never
made — those specifics came from interim batch-preview summaries the
parent received mid-run (the garbled-summary failure mode), and the
paragraph was wrong to state them as the builder's conduct. The accurate
record: the builder's edits in its worktree are what shipped; the builder
committed nothing and made no GitHub writes (per its instructions); the
parent committed the worktree (7262e0bd7) while the builder was still
working, after re-verifying every item against the diff and re-running
all suites plus the RED discrimination first-hand. The builder's own
evidence (wt-1679b/evidence-1679/: tests-first RED 7F/22P, GREEN 29/29)
exists and matches the parent's independent runs. The NIT hardening IS
in the diff, as the builder built it.

## Per-item disposition

3. **AI disclosure + format labels** — disclosure `<li>` renders only for
   `mixed`/`short_answer` (written-bearing) formats; FORMATS labels now
   "Mixed — multiple choice and written answers" / "Written answers"
   (UX spec §0.2).
4. **Retry on pre-flight failure** — a `flightRetry` counter added to the
   availability effect's deps; the failure state renders a working Retry
   button that re-checks the CURRENT configuration.
5. **Dead count chip** — the non-enum accepted count now renders as an
   inert `<span>`, never a `<Button>` without onClick.
6. **bestScore guard** — `assessments.tsx`: the "Best: N/100" fragment
   renders only when `bestScore != null`; the attempt count still shows
   on its own. Tests pin null → no "Best:" text, 73 → "Best: 73/100".
7. **Legacy "Adaptive" label** — verified: the legacy `/available`
   builders hardcode `difficulty: "Adaptive"` while a new legacy start
   snapshots mixed / medium / 10. The false label is no longer rendered;
   the card states the real default: "Mixed · Medium (levels 2–4)".
8. **Build-log consolidation** — the round-1 log
   (`04-implementation/assessments-c2-client-1654-build-log.md`) is
   DELETED; the surviving log
   (`04-implementation/sumanth-batch-2026-10-21/c2-client-1654-build-log.md`)
   carries a consolidation note stating the verified server truth: a
   `setId` start returns 400 SETS_NOT_AVAILABLE after ROLLBACK, before
   the session INSERT — no session is created.
9. **Test discriminators + flag** — GAP-4 discriminators added
   (passed:false+score:88 → "Not passed"; passed:true+score:42 →
   "Passed"); sessionStorage hand-off pinned (stored.config asserted;
   storage-seeded take test starts from the stored config);
   SETS_NOT_AVAILABLE test asserts the "Use N instead" offer is ABSENT;
   `setsUnavailable` is now CONSUMED (suppresses Resume + smaller-count
   affordances on a SETS 400). PLUS the #1680-review NIT hardening:
   `isShort`/`isEmpty` are additionally gated on `!flightLoading`.

## Evidence (parent-run, this worktree)

- GREEN: `vitest run assessment-configure-1654.test.tsx
  assessment-take-1654.test.tsx` → **29/29 PASS** (configure 20, take 9).
- RED discrimination (parent): product files temporarily reverted to
  pristine dev, tests kept → **7 FAIL / 22 PASS** — the new tests fail
  exactly where the defects live; tree restored and re-verified 29/29
  before commit.
- No server files touched; no schema change; no new dependency.
