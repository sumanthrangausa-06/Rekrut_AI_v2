# #2041 — GDPR export: explicit projections for the non-user sections

Build log, advance run 2026-10-31. STOP 1 on #2041 (comment 6543543159).

## What changed

`POST /gdpr/export` (routes/compliance.js) read eight sections with
`SELECT *` and shipped rows verbatim: omni_scores, score_history,
score_snapshots, interviews, assessment_results, candidate_profiles,
consent_records, audit_logs. Any column added to one of those tables
later would have been exported by default, with no gate — the
future-column class #2035 closed for `users` and #2033 for the
biometric tables.

Each query now selects an explicit `EXPORT_*_COLUMNS` list naming
exactly the table's live columns, verified column-for-column against
information_schema on a fresh migrated DB (PG 18.6). Today's bundle
is field-for-field identical; no exclusions were made — every live
column is the subject's own data in DSAR scope, and shrinking the
subject's copy is a Lex ruling, not a hardening lane (#2033
precedent; #1533's raw/native score export untouched).

Note on the issue body: it enumerated candidate_profiles at 25
columns; the live fresh-schema count is 42 (verified first-hand this
run). The lists in this PR follow the live schema.

## Specialist verification note (HL-007)

The privacy specialist's advisory report was verified claim by
claim before use. Confirmed: consent_records.revoked_by and
audit_logs.actor_id are other-user FKs; both metadata JSONB columns
are free-form. Refuted on first-hand evidence and NOT acted on:
(a) "migration 295 drops peer_percentile" — migration 290 dropped
only the column DEFAULT (#1280, approved); the column is live and
actively written by services/omniscore.js with an honest-null
percentile; (b) "fraud_signals carries cross-candidate similar_to
ids via lib/fraudDetection.js" — no such file or field exists; the
real detectFraudSignals (services/omniscore.js:872) emits only
{type, severity, message} about the subject's own data;
(c) "audit_logs has no id column" — the live schema has one.
The confirmed residuals (metadata JSONB content; revoked_by /
actor_id inside subject rows) are pre-existing verbatim behaviour,
unchanged by this lane, and are filed for a Lex ruling as a
follow-up (see the #2041 closing checkpoint for the issue number).

## Evidence

- Pin suite (new): red 8/8 on base → green 9/9 (incl. handler-region
  check). It slices the export handler's source region, so the
  consent-history endpoint's own consent_records read — a different
  surface, out of this lane's scope — is neither pinned nor
  condemned by it.
- Real-DB journey (new, Quinn user-perspective): fresh DB
  `rekrut_2041` built only by migrate.js (exit 0). On base: today's
  copy complete (pass) and the future-column test RED — a sentinel
  column added to candidate_profiles + audit_logs leaked its value
  into the bundle through the real route. After the fix: 2/2 green —
  every section carries exactly today's columns with values intact,
  and the added column appears nowhere in the bundle.
- Neighbours: mocked export suites 45/45 (2033/2035/2037/2028/2034
  + this pin); real-DB 2035 + 2037 journeys 7/7 on the same fresh DB.

## Gates

Red-first → fresh-DB green → independent review → Suga first-hand
gate → merge to dev. No migration, no scheduler;
RETENTION_PURGE_LIVE and DIARIZATION_ENABLED untouched.
