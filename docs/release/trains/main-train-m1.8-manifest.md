# Main Train M1.8 — Train 14B (honesty / score integrity) → production

- **Content:** exactly Train 14B as merged to staging (PR #1877, merge 3ebb45fd2):
  fabricated-fallback removal across the AI provider layer, quick-practice
  cascade, recruiter-screener guards, screening ownership, interview/QA/job/
  document-verification honesty, tied client pages, migration 275, plus the
  panel-amended additions (lib/proxy-env.js C1; routes/interviews.js mock-end
  hunk extraction C2). Manifest: docs/release/trains/train-14b-manifest.md.
- **Panel:** Rex APPROVE WITH CONDITIONS — C1/C2/C4 discharged in the train,
  C3 (#1338 basic-fit) accepted as a designed, labelled exception (recorded on
  #1867). Both blocking claims verified first-hand by Suga before the build
  was amended.
- **Train-tree gates:** byte-identity vs dev 0-diff on all full files;
  fresh-chain migrate on PG16 rig exit 0 with migration 275 read-back
  (chk_verification_docs_status includes 'pending_review'); server jest
  37 suites / 238 passed / 0 failed on the amended tree; client vitest 28/28;
  tsc 63 errors vs 119 staging base (no new errors in scoped files).
- **Staging proof (deploy dep-dbfdtutg1s2s73fe9q40, live):** /health 3/3 agree
  at 3ebb45fd2, db connected (healthy boot = shared-DB migrate read-back for
  275). Journey, fresh candidate via the real API: register 201 -> unauth
  screening gate 401 -> practice session start 201 -> practice submit
  returned REAL provider coaching (score 8, strengths/improvements citing the
  actual answer — not the deleted fabricated flat 5) -> sessions read-back
  shows the persisted score + coaching. The honesty path works end-to-end
  with a live provider leg, and the failure path is the trained honest 503
  (suite-proven), never a fabricated score.
- **Authorization:** Sumanth's standing promotion authorization (2026-10-22),
  dual-environment rule satisfied (staging proven before main).
- **Rollback:** forward code fix only (migration 275 is expand-only and does
  not un-apply).
