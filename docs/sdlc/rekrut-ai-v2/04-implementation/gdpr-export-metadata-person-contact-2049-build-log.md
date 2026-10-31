# #2049 Slice B — GDPR export: person-contact keys in audit metadata

Build log, advance run 2026-10-31. STOP 1 on #2049 (comment
6545634348); Lex ruling comment 6544914912 on #2049 is the build
spec. Slice A (non-user `*_id` bookkeeping verbatim) — Lex: status
quo stands, NO code change; this lane is Slice B only.

## What changed

`sanitiseExportAuditMetadata` in `routes/compliance.js` (the #2046
sanitiser) gained Lex's Slice B rule, export copy only — stored
rows are never mutated (proven by read-back in the real-DB
journey):

1. **Census person-contact keys** (canonicalised): `targetemail`,
   `newowneremail`, `targetname`, `newownername`, plus any
   canonical key ending in `email`. Subject-relative keep (the
   string analogue of `ownIdOrNull`): an email key is kept only
   when its value, trimmed + case-insensitive, equals the subject's
   own email; a census name key only when its value, trimmed +
   case-insensitive, equals the subject's own name. Otherwise the
   key is dropped at every depth and its name joins the existing
   removed-keys bundle note.
2. **Email-shape backstop:** any string value under any key at any
   depth — array elements included, swept like the existing
   storage class — that IS an email address as a whole value
   (trimmed) and is not the subject's own email is dropped, key
   named in the note. Whole-value only: an email appearing as a
   substring of a longer bookkeeping string is NOT redacted
   (pinned by test).
3. **Explicitly unchanged:** generic `name` verbatim, `domain`
   verbatim, all Slice A bookkeeping verbatim.
4. The handler passes the subject's own email + name into the
   sanitiser alongside `targetUserId`. **Name column verified in
   code:** the subject's name is `users.name` and email is
   `users.email` — both already selected by `EXPORT_USER_COLUMNS`
   and already loaded as `userData.rows[0]` before sanitising, so
   no new query was added.

## Writer census (re-verified in code at STOP 1)

- `target_email` / `target_name`: `routes/company.js:1074, :1142,
  :1236, :1496` via `insertAuditLog` (`routes/audit.js:12`, sets no
  `user_id` column) — always the target, never the actor.
  `new_owner_email` / `new_owner_name`: `routes/company.js:1382-83`
  in the `insertAuditLog` call at :1374 — always the new owner.
  The class is latent today (no `user_id` on those rows; the
  export reads `WHERE user_id = $1`), exactly as Lex recorded.
- Own-email counterexamples: `routes/auth.js` `AuditLogger.log`
  stores the subject's OWN `email` on their own OAuth link rows
  (Google flow :897-902, gated by the email-match check just above;
  LinkedIn flow same pattern); `routes/company.js:100-105`
  join-request stores the subject's own `email` / `domain`
  (actor = target = subject). Hence subject-relative keep, not
  drop-by-name.
- Generic `name` overload: `routes/candidateSearch.js:419` stores
  the subject's own saved-search name under `name`.

## Specialist decision

Privacy specialist: **YES** (recorded at STOP 1) — this lane
extends the #2046 privacy sanitiser; email addresses and names are
stronger person identifiers than the numeric ids #2046 withholds.
An independent privacy review of the finished diff was dispatched
in the #2046 pattern; its verdict and findings are recorded in the
PR body and on #2049. Security reviewer considered, skipped as a
separate lane (no new credential/secret class, no auth/session
surface — the #1128 classes are reused unchanged). Database
specialist considered, skipped (no migration, no schema, no new
query). Lex seat: no new ruling needed — 6544914912 is the spec.

## Privacy review — PASS WITH FINDINGS (independent reviewer)

The independent privacy specialist reviewed the finished diff
against ruling 6544914912, ran both unit suites first-hand
(15/15), and probed the extracted walker empirically. Verdict:
**PASS WITH FINDINGS — no leak for any shape a current writer
produces.** Every value today's audit writers can place in
`audit_logs.metadata` on a `user_id`-carrying row is handled
exactly as the ruling requires; fail-closed edges (non-string
census values, absent subject email/name, `__proto__` shapes,
canonical variants incl. `TARGET.EMAIL`) all probed correct.

- **Finding 1 — SHOULD-FIX, FIXED in this PR:** bundle-note
  completeness only (no PII leaked) — a foreign email swept from
  an array nested inside an array did not name its owning key in
  the removed-keys note (top-level length check only). The array
  walker now reports a sweep at any depth and the owning key is
  named; pinned by the `contact_nested_list` unit case. Root
  array / root scalar removals have no key to name and stay
  note-less, as in #2046.
- **Findings 2–6 — NOTEs, recorded as residuals below / in the PR
  body:** non-census name keys (Finding 2), plural/compound email
  keys still backstopped (3, no action), OAuth-address over-drop
  where a linked account's email differs from `users.email` —
  faithful to Lex's exact keep test (4), email-shape edges the
  ruling accepts (5), emails as object key names — no writer
  produces them (6).

## Residual (recorded, not silently dropped)

A third party's NAME under a non-census key (`owner_name`,
`candidate_name`, `target_names`, spaced `target name`, …) has no
shape test and sits outside Lex's writer census; like generic
`name`, it stays verbatim in the copy until Lex rules (privacy
review Finding 2 — the reviewer confirms the implementation is
faithful to the ruling's exact census and that NO current writer
produces these keys in audit metadata; per Lex's future-census
discipline, any such key must join the census BEFORE a writer
ships it on a `user_id`-carrying row). The `owner_name` case is
pinned deliberately in the unit suite (fixture comment +
assertion) so a later ruling changes it deliberately, and the
watch item is flagged on #2049 for Lex/Suga. The email backstop
already covers every non-census key whose value is an email
address — including canonical variants (`Target-Email`,
`targetEmail`, `NEW_OWNER_NAME`), a `file_name` key whose value
is an email, and whitespace-padded whole-value emails (foreign
dropped; the subject's own padded email kept) — all pinned by
tests that pass against the built rule.

## Evidence (HL-007 — all first-hand this run)

- **Unit/behavioural suite (new)** —
  `compliance-gdpr-export-metadata-2049.test.js`, mocked pool in
  the #2046 pattern, real route: **red 5 failed / 2 passed on
  base** (third-party `target_email` / `target_name` /
  `new_owner_email`, bare email under an unrelated key, and the
  array sweeps all exported verbatim; the 2 passes are the
  verbatim-unchanged and stored-unmutated guards) → **green 7/7**
  after the fix. The #2046 suite's Slice B status-quo pin flipped
  deliberately to the new ruling (third-party `target_email` now
  dropped; `target_email` added to its bundle-note names) — **8/8**.
- **HL-003 real-DB journey (new)** —
  `compliance-gdpr-export-metadata-realdb-2049.test.js`: fresh DB
  `rekrut_2049` created empty and built ONLY by `node migrate.js`
  (**exit 0**). Rig: PostgreSQL **18.6** + pgvector **0.8.7** at
  127.0.0.1:**55439** — a fresh cluster under `/home/postgres`
  built from the `~/workspace/pgfull` PGDG tree, because the
  documented 55433 rig was down after a VM restart and
  `/home/hatch` is no longer traversable by the postgres user
  (the pgrig embedded binaries fail EACCES for that user; the
  pg-gate-2034 cluster is unreachable for the same reason). On
  base (fix stashed): **red 1 failed / 1 passed** (leak assertions
  failed; the unmutated guard passed). After the fix: **2/2
  green** — Slice B applied to the copy, the subject's own
  email/name + Slice A bookkeeping survive, stored audit rows read
  back **UNMUTATED**.
- **Neighbours green** (final code, after the Finding 1 fix):
  mocked compliance/export sweep **18 suites, 291/291** (incl.
  #1533/#1548/#1550/#2028/#2033/#2034/#2035/#2037/#2041/#2046/
  #2049 + admin-dsar-fulfillment + compliance-authz). Real-DB
  neighbours on their own fresh migrated DBs (each
  `node migrate.js` **exit 0**): #2049 ✓, #2046 ✓, #2041 ✓,
  #2035 ✓, #2037 ✓ — **5 suites, 13/13**, 0 skipped; plus the
  biometric real-DB suites #2028 ✓ / #2034 ✓ — **2 passed, 1
  skipped**, the skip being #2034's pre-296 case, which skips by
  design without `EXPORT2034_PRE296_DB_URL` (same as the #2046
  run).

— Nova
