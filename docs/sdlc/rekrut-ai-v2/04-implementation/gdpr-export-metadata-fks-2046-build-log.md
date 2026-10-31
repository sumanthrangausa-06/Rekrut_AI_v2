# #2046 — GDPR export: Lex ruling on metadata JSONB + other-user FKs

Build log, advance run 2026-10-31. STOP 1 on #2046 (comment
6544330118); Lex ruling comment 6544214655 on #2046; the privacy
specialist's #2041 dissent/addendum is recorded on #2046 (comment
6543685638).

## What changed

`POST /gdpr/export` (`routes/compliance.js`) placed consent_records
and audit_logs rows verbatim in the bundle. Column lists (#2041)
cannot govern what rides INSIDE three fields, so Lex ruled on the
content. This lane applies that ruling to the **export copy only** —
stored rows are never mutated (proven by read-back in the real-DB
journey):

1. `consent_records.metadata` → `{}` in the copy (client-supplied
   verbatim at write time, no allowlist; erasure already wipes it
   as untrusted caller PII).
2. `audit_logs.metadata` → sanitised key-by-key in the copy, in
   Lex's order: (1) secret / credential / storage-reference keys
   dropped (the #1128 sanitiser class — canonical key matching as
   in `lib/erasureResultSanitizer.js`, plus credential key names;
   storage-pattern string values dropped under any key);
   (2) user-identifier keys kept only when the value is the
   subject's own id, otherwise the key is **dropped**;
   (3) recruiter-authored free text dropped (`recruiter_notes`,
   `override_reason` — the human_override writer sets
   `override_reason` from `recruiter_notes` verbatim);
   (4) everything else verbatim. Sanitisation recurses into nested
   objects/arrays.
3. `consent_records.revocation_reason` → `null` in the copy
   (`revoked_at` and the revocation fact stay).
4. `consent_records.revoked_by` and `audit_logs.actor_id` →
   `ownIdOrNull` in the copy (the #2034 pattern already in this
   handler): subject's own id kept, others `null`, **no admin
   exception**.
5. Bundle notes (new top-level `notes` array, Lex's required
   wording): the consent note always — "Consent record metadata is
   withheld in this copy because its contents are caller-supplied
   and unverified." — and, only when keys were removed, an audit
   note listing the removed key **names** (never values). Row
   shapes are unchanged (#2041 pins untouched); the #1533/#1548
   top-level bundle pins grow by exactly `notes`, the documented
   pin-growth precedent those files carry for `biometric` (#2028).

## Ambiguities flagged at STOP 1 (status quo kept, not invented)

- **Non-user `*_id` keys in audit metadata** (`job_id`, `company_id`,
  `session_id`, …): a literal all-`*_id` reading of Lex's rule (2)
  would drop the subject's own bookkeeping (rule 4) and keep a key
  only on numeric coincidence with the subject's id. The build
  applies rule (2) to the census of **user**-identifier keys only
  (`candidate_id`, `actor_id`, `user_id`, `recruiter_id`,
  `requester_id`, `previous_owner_id`, `new_owner_id`, `owner_id`,
  `sent_by`, `updated_by`, `created_by`, `changed_by`, `revoked_by`
  — canonicalised); non-user `*_id` stays verbatim pending Lex
  confirmation. Pinned by test so a later ruling changes it
  deliberately.
- **Other-person PII in non-`*_id` string keys** (`target_email`,
  `target_name`, `new_owner_email`, `new_owner_name`, `email`,
  `name`): not named by the ruling's classes, and some instances
  are the subject's own (the join-request writer stores the
  subject's own `email`). Left verbatim pending a Lex ruling.

## Specialist decision

Privacy specialist: **YES** (recorded at STOP 1) — this lane exists
from the privacy specialist's #2041 dissent; an independent privacy
reviewer reviews the finished diff and its findings are recorded on
#2046 and in the PR body. Separate security review skipped: the
credential/storage class is the already-shipped #1128 class, reused.

## Privacy review — PASS WITH FINDINGS (recorded on #2046 and the PR)

The independent privacy reviewer probed the extracted sanitiser
empirically (canonical variants, numeric-string ids, nesting,
`__proto__`, non-mutation) and read Lex's ruling + STOP 1 first-hand.
Verdict: **PASS WITH FINDINGS** — no live leak of any ruled class for
any shape a current writer produces; slices (A) and (B) and the
`notes` placement explicitly **ACCEPTED** with reasoning. SHOULD-FIX
findings 1–4 were **fixed in-PR** (second commit):

1. Compound user-id keys (`actor_user_id`, `from_user_id`, …) escaped
   the exact-match set → canonical keys ending in `userid` now follow
   rule (2) too.
2. A root-array `audit_logs.metadata` failed open → root arrays are
   walked; a root storage-reference scalar becomes `null` (#2039
   fail-closed precedent).
3. **STOP 1 census correction:** `notes` (proctoring flag-review,
   `routes/proctoring.js`) and `reason` (screening override,
   `routes/questionnaire.js`) are other-authored free text the STOP 1
   census missed → both added to the rule-(3) set.
4. Test pins for the behaviour above + canonical variants,
   numeric-string ids, the slice-(B) `target_email` status-quo pin,
   the no-removals/no-audit-note negative case, and nested
   non-mutation (unit suite is now 8 tests).
7. (NOTE, also fixed) array-element sweeps now name their key in the
   bundle note.

Remaining NOTEs (5, 6, 8 — plural user-id keys, credential-name
long tail beyond the #1128 class, circular/BigInt robustness) are
recorded on #2046 for Lex/Suga; the reviewer judged them faithful to
the ruling as written, not compliance gaps.

## Evidence (HL-007 — all first-hand this run)

- **Unit/behavioural suite (new)** —
  `compliance-gdpr-export-metadata-2046.test.js`, mocked pool in the
  #2035 pattern, sentinels in metadata/FKs: **red 5/6 on base**
  (foreign `actor_id`/`candidate_id` and every sentinel exported
  verbatim; no `notes`) → **green 6/6** after the fix, including
  stored-row non-mutation and the no-admin-exception case; **8/8**
  after the privacy-review fix-up commit (findings 1–4 pins).
- **HL-003 real-DB journey (new)** —
  `compliance-gdpr-export-metadata-realdb-2046.test.js`: fresh DB
  `rekrut_2046` (PostgreSQL at 127.0.0.1:55433) created empty and
  built only by `node migrate.js` (**exit 0**). On base the
  serialised bundle contained every sentinel verbatim (red 1/2; the
  unmutated-read-back guard passed). After the fix: **2/2 green** —
  Lex's rule applied to the copy, the subject's own bookkeeping
  (`job_id`, `new_status`, own ids) survives, and stored consent /
  audit rows read back **unmutated**.
- **Neighbours green**: mocked export suites 109/109 (10 suites:
  #1533/#1548/#1550/#2028/#2033/#2034/#2035/#2037/#2041 +
  admin-dsar-fulfillment); broader compliance sweep 188/188 (9
  suites incl. compliance-authz); real-DB neighbours on fresh
  migrated DBs: #2041 ✓, #2035 ✓, #2037 ✓, #2028 ✓ (with
  `BIOMETRIC_ENCRYPTION_KEY` set for its fixtures), #2034 ✓ on its
  own fresh DB `rekrut_2046_2034` (migrate.js exit 0; its pre-296
  test skips by design without `EXPORT2034_PRE296_DB_URL`). Two
  initial real-DB neighbour failures were rig artefacts, verified
  as such: missing `BIOMETRIC_ENCRYPTION_KEY` env and a fixed
  sentinel `object_key` collision from sharing one DB across suites.

— Nova
