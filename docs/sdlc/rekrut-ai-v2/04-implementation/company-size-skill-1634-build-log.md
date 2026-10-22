# #1634 — company_size alias + skill-param clobber: build log

**Lane:** Nova (Implementation) · **Branch:** `nova/1634-company-size-skill-fix` → dev
**Origin:** Full STOP 1 specialist review of #1600 (PR #1633), filed as the post-merge addendum issue #1634.

## User-visible behaviour changes

1. **Job Board company-size filter now returns jobs.** The in-page JobFilterBar
   company-size select (Startup / Small / Medium / Large) previously returned an
   empty board for every selection: it sends bucket labels, the server compared
   them with exact equality against stored company-size ranges, and a label can
   never equal a range. The server now translates each bucket to its stored
   range set (startup → 1-10, 11-50; small → 51-200; medium → 201-500,
   501-1000; large → 1001-5000, 5001+). A caller sending a raw stored range
   keeps the previous exact-match behaviour.
2. **A header-applied keyword is no longer silently replaced by a stale skill.**
   When a candidate had arrived via a skill chip (`?skill=…`) and then used the
   header Filters sheet to search a keyword, the board briefly adopted the
   keyword and then reset the search box to the old skill. Header Apply no
   longer preserves the `skill` param (the open-job `job` param is still
   preserved); skill chips themselves are unchanged.
3. **Filter aliases no longer die on an empty legacy param.** A URL like
   `?job_type=&type=full-time` previously dropped the type filter entirely
   (empty string won the `??` coalesce); the first non-empty alias now wins
   for type / remote_type / experience_level / company_size / sort_by.
4. **Header filter re-entry works after divergence.** After a header Apply was
   consumed and stripped from the URL, re-applying the identical values after
   changing filters in-page now re-syncs the board (the adoption signature is
   reset when the signal is stripped), and the signature itself can no longer
   collide for values containing `|` (JSON signature, not a `|`-join).

## Implementation notes

- `lib/company-size.js` — bucket → range-set translation (single source for
  the mapping; unit-tested for full, gap-free coverage of all stored ranges).
- `routes/candidate.js` GET /jobs — non-empty alias coalesce (`pickParam`);
  company_size uses `IN (...)` over the translated ranges for bucket values,
  exact match otherwise. All values remain parameterised.
- `client/src/lib/job-board-url.ts` — pure helpers extracted from
  header.tsx / jobs.tsx: `buildHeaderApplyParams`, `urlFilterSignature`,
  `createUrlFilterAdoptionTracker`. Extracted specifically so the URL-sync
  state machine has behaviour-level tests (the #1634 addendum's test-depth
  finding), not vocabulary pins.
- `client/src/components/layout/header.tsx` — Apply now builds its params via
  `buildHeaderApplyParams` (preserves `job` only).
- `client/src/pages/candidate/jobs.tsx` — URL-sync effect uses the tracker +
  JSON signature; the tracker is consumed when the signal is stripped.

## Tests

- `server/__tests__/routes/candidate-jobs-company-size-1634.test.js` —
  bucket-mapping unit tests (always run) + real-HTTP integration tests
  (CS-1a–e every UI-producible bucket selection, CS-2 raw range, CS-3 empty
  alias) gated behind `JT1634_BASE_URL` / `JT1634_INTEGRATION_DB_URL`,
  run by Quinn on the fresh-install rig; evidence attached to #1634.
- `client/src/__tests__/pages/job-board-url-1634.test.ts` — vitest behaviour
  tests: header Apply keeps keyword + drops stale skill + preserves job;
  `|`-collision signature pair adopts distinctly; tracker transitions
  (adopt → duplicate blocked → consume → identical re-entry adopts).
- `server/__tests__/routes/candidate-jobs-filters-1600.test.js` — the two
  static pins that referenced header internals now follow the code into the
  extracted builder (param names + hdr1 marker); no assertion weakened.

## Correction (follow-up lane, after PR #1639 merged)

The specialist's full report contained a BLOCK that the summary acted on
did not surface; #1634 was reopened and fixed in a follow-up PR:

1. **Stored `1000+` matched no bucket.** The candidate company-profile
   form (`client/src/pages/candidate/company-profile.tsx`) offers a
   single `1000+` option instead of the recruiter form's
   `1001-5000`/`5001+` split, so real companies store
   `company_size = '1000+'`. The original bucket map missed it — those
   companies were invisible to the Large filter. `large` is now
   `1001-5000, 5001+, 1000+`; the coverage unit test enumerates stored
   values from BOTH writer forms, and the integration seed includes a
   `1000+` company (CS-1d). Root cause of the miss: the STOP 1 premise
   check enumerated stored values from only one of the two writer forms.
2. **Tracker consume wiring** moved from inside the strip (same hdr1
   pass) to the effect's signal-absent branch, per the specialist's
   condition — the adoption guard now lives exactly while the signal is
   in the URL.
3. **Alias precedence pinned** (CS-4a/CS-4b, real HTTP): job_type is
   snake-first, the other four aliases camel-first — pre-existing,
   unchanged, now regression-pinned.
4. **Wiring pins added**: static assertions that jobs.tsx/header.tsx
   import and use the extracted helpers (helper tests alone could pass
   with zero production effect).

Still deferred (specialist advice): canonical-writer validation of
`company_size` (routes/company.js + candidate company-profile form
offering the same 7 ranges as the recruiter form) — the root-cause fix
for spelling drift, a separate change.

## Deferred (recorded on #1634 STOP 1)

- `executive` experience option — honest-empty option question, not a
  standalone defect; product/UX call, not taken in this hotfix.
- Header Filters trigger a11y (h-9 / aria) — already tracked in #1632.
