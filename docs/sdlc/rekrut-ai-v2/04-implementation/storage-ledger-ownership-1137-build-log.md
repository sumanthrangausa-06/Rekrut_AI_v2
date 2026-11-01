# Build log — #1137 storage-ledger ownership check

**Story:** [FOLLOW-UP] Storage-ledger ownership check: client-supplied
`/api/files/` URLs can name another tenant's object (S-076-inherited).
**Persona:** Nova (implementation), panel per STOP 1 on #1137.
**Branch:** `fix/1137-ledger-ownership` → PR to `dev` (not merged by
Nova; Suga gates the merge).

## Problem (verified first-hand on origin/dev `9007127bb`)

The erasure storage ledger proved a URL is *shaped* like an app
storage URL (`/api/files/` prefix + provider prefix, in
`lib/file-storage.js` `deleteFile`), never that the object belongs to
the erasing candidate. Ledgered URL fields that are client-supplied:
`onboarding_documents.document_url` and `offers.signature_url`
(straight from `req.body`, routes/onboarding.js),
`portfolio_projects.image_url` (free-form), `documents.url`. A
candidate could plant `/api/files/<provider>/<another tenant's key>`
on their own row and have that object deleted at their erasure.

## Key-shape dry-run (before fixing behaviour, per the issue)

Every upload caller was traced: real keys are
`/api/files/<provider>/<family-prefix>/<timestamp>-<random>-<name>`
(prefixes resumes/photos/documents/chat/frames/cv/onboarding/offers/
signatures/portfolio/legacy). **No key contains a user/tenant id**, so
a key-pattern/prefix ownership check cannot work — family prefixes
are shared by all tenants. Ownership is therefore proven negatively,
from database references.

## Design (STOP 1 on #1137 — discussed panel: Lead, Rex, Scout,
## Privacy Engineer, Security Reviewer; dissent recorded there)

Enforcement at the single choke point: the Phase-2 drain
`deleteErasedStorageFiles` in `lib/erasureService.js`, after the
per-entry legal-hold consult. New helper `lib/storageOwnership.js`:

- For each non-catalogue `r2` entry whose URL is `/api/files/`-shaped
  and addressable (decodable, provider-prefixed — the same floor
  `deleteFile` itself applies; unaddressable URLs keep the legacy
  soft-skip path because `deleteFile` can never delete them), the
  drain asks whether **any surviving database row still references
  the object**: exact equality only (never LIKE), comparing all
  spellings of the object — raw stored, canonical fully-decoded,
  and whole-key encoded (plus
  decoded key forms for `recording_objects.object_key`), across
  `cv_uploads.file_url`, `parsed_resumes.file_url`,
  `candidate_profiles.resume_url/photo_url`, `users.avatar_url`,
  `verification_documents.file_url`, `messages.file_url`,
  `onboarding_documents.document_url`, `offers.signature_url`,
  `signature_documents.file_url`, `portfolio_projects.image_url`,
  `job_applications.resume_url`, `companies.logo_url`,
  `recording_objects.object_key` (live rows), and
  `interviews.video_urls` (JSONB exact element / `->>'url'` match).
- `documents.url` is checked separately, guarded by
  `to_regclass('public.documents')`: that table is **not created by
  any migration** (routes/candidate.js creates it lazily), so a hard
  reference throws on fresh installs — caught by the Quinn gate on a
  migrate.js-only DB and fixed in this lane. It is attributed
  (`user_id <> erasing user`) because the table is not itself erased.
- **Surviving reference → fail closed:** the object is NOT deleted;
  the ledger row stays `pending` (legal-hold precedent — never
  `failed`, no `attempts` increment; a contested object is not a
  dead letter and must never reach the verified-absent disposition);
  counted in the drain result + aggregate audit metadata as
  `ownershipSkips` / `ownershipSkipsByFamily` (counts only, K-2 —
  no URL, key, or hash is persisted).
- **Reference query throws → fail closed the same way**, counted as
  `ownershipLookupFailed`.
- **Exempt by source, never by shape:** `source_family` in
  (`frame`, `observer_audio`, `livekit_recording`) — server-generated
  keys ledgered from candidate-keyed catalogue rows
  (`recording_objects.candidate_id`, decrypted recording pointers);
  no client write path can plant those keys. `local` entries are
  unchanged.
- The drain return (and its early-return) grows the three counters;
  exact-shape assertions in the #1171 / #1395 / GAP-I / S-076 suites
  were updated in the same PR, and the two finite-queue S-076 drain
  tests gained ownership-query response slots next to the existing
  #799 hold-check slots.
- `sweepPendingStorageDeletions` return shape is unchanged; each
  per-user drain it delegates to carries the ownership counters in
  its own audit entry.

## Behaviour change (user-visible surface)

Erasure (self-serve delete-account and admin DSAR) now never deletes
a storage object that any surviving record still references. The
erasing user's own objects still delete exactly as before. A
contested object is deferred, not dropped: once the referencing
tenant's own erasure removes the reference, a later drain deletes
it (proven in the integration suite).

## Named residuals

1. An object whose owner has **no** surviving DB reference at drain
   time (orphans; references held only inside other recordings'
   encrypted pointers) cannot be caught by reference-checking. Keys
   are unguessable (timestamp + random) — the posture recorded in
   the original S-1 adjudication on the issue.
2. A permanently-contested row stays `pending` and is re-disclosed
   by every sweep. A terminal contested status would need a
   migration widening the ledger status CHECK — recorded as a
   follow-up decision, not taken in this lane (no schema change).
3. Panel dissent (Lead + Rex preferred checks at ledger-insert time
   too, and a terminal state): drain-only was adopted because it is
   the only point covering pre-existing ledger rows and the
   crash-recovery sweep; insert-time plumbing across 8 insert sites
   in the mock-queue-sensitive erasure file is a follow-up.

## Evidence

- **Red first:** new unit suite on pristine drain code — 7 failed /
  3 passed (plant deleted by the old code). After fix: **11/11**
  (incl. the review C-1 quadrant added on the fix round).
- **Unit suite:** `server/__tests__/lib/erasure-storage-ownership-1137.test.js`
  — cross-tenant plant skipped + disclosed, `%2F` encoding-variant
  plant caught, own object deleted, lookup failure fails closed,
  catalogue families exempt, hold precedes ownership, normalisation.
- **Quinn gate (HL-003):**
  `server/__tests__/lib/erasure-storage-ownership-1137.integration.test.js`
  — real Postgres (PG 18, embedded rig on 127.0.0.1:55437), DB
  `rekrut_1137_e2e` built **only** by `node migrate.js` (exit 0),
  real drain + real `lib/file-storage` + real AWS SDK over real HTTP
  to a local S3 stub standing in for the B2 endpoint (real storage
  egress is unavailable from this VM — the stub proves exactly which
  keys the drain attempted to delete; it proves nothing about a real
  bucket). Result: **2/2 pass** — A's drain deleted only A's own key
  + the observer-audio chunk (`ownershipSkips=2`, ledger read-back:
  plants `pending`/attempts 0, own rows `deleted`, B's rows
  untouched); after B's referencing rows were removed, the deferred
  entries deleted.
- **Independent security review** (separate reviewer, not the
  builder; posted on #1137 as comment 6551147413): **BLOCK** — one
  CRITICAL, reproduced first-hand by Nova before fixing:
  - **C-1 (fixed in this PR):** the comparison set was {raw,
    decoded}. For a *plain* plant both forms are the plain string,
    while the dominant real writer stores the whole-key **encoded**
    spelling (`uploadFile` returns `/api/files/<encodeURIComponent
    (key)>`, stored verbatim into cv_uploads/parsed_resumes/etc.) —
    so the headline plant case still deleted the victim's object.
    The first suites masked it: they pinned only the
    encoded-ledger × plain-reference quadrant and seeded victim
    rows in the unrealistic plain spelling (review H-1). Fix:
    `storageUrlForms` now also derives `encodedUrl`, compared in
    every `IN (…)` list, the JSONB branch, and the documents query;
    the C-1 quadrant (plain plant × encoded reference) is now
    pinned in the unit suite, and the integration suite seeds
    victim rows in the encoded spelling the real writers produce.
  - Notes N-1..N-4 (non-blocking): the `storageUrlForms == null`
    fall-through wording was corrected (trailing-slash keys error
    to `failed` in `deleteFile` without deleting anything);
    `documents` NULL-`user_id` rows can't count as surviving (all
    current writers set it from auth — residual); `video_urls`
    object elements match via `->> 'url'` only (consistent with
    observed GAP-C shapes); the `livekit_recording` exemption is
    now exercised by the unit suite.
  - **Record correction:** an earlier checkpoint on #1137 and the
    first version of this log reported this review as "APPROVE
    WITH NOTES" with a comment id (6550951449) that **does not
    exist on the issue** — that was a premature interim reviewer
    report, accepted without first-hand verification (HL-007
    breach by Nova, owned here). The only review comment on #1137
    is the BLOCK (6551147413); the sanitizer note in that interim
    report was never the reviewer's and is withdrawn.
- **Regression:** erasure-adjacent suites — 420 passed, 2 failed.
  The 2 failures (`resume-family-erasure` Phase-1 tests) plus
  `erasure-gap-a` (3) and `embeddings-erasure` (5) failures were
  verified **pre-existing on pristine origin/dev** in the shared
  checkout (Phase-1 `erasePersonalData` suites, unrelated to the
  drain) and are unchanged by this PR.
