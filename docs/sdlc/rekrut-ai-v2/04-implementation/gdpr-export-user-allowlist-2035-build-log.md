# GDPR export user allowlist — #2035 (build log)

One-point security defect fix in `routes/compliance.js` (POST
`/gdpr/export`). STOP 1 + root cause + the full field classification
are on issue #2035.

## What changed

The handler read the subject's row with `SELECT * FROM users` and
placed the raw row in the export bundle as `user`, so the bundle
carried `password_hash` — to the subject and to any admin exporting
another user. The `user` section is now projected through an explicit
17-column allowlist at two layers:

1. **SQL:** `EXPORT_USER_COLUMNS` — an explicit column list, so
   credential material never leaves the DB.
2. **JS:** `toExportSafeUser(row)` — a key-by-key projection beside
   the #927 `toCandidateSafeDecisionExplanation` precedent (never a
   spread, never delete-keys), so a future users column reaches the
   bundle only by a deliberate edit to the list.

INCLUDE (17): id, email, name, role, title, company_name, company_id,
github_username, avatar_url, linkedin_data, is_paid,
subscription_plan, subscription_status, suspended_at, deleted_at,
created_at, updated_at.
EXCLUDE (5): password_hash, google_id, linkedin_id, oauth_provider,
stripe_subscription_id (credential verifier + external
authenticator/billing key material; the subject-facing billing facts
are included). Column set enumerated from migrate.js + migrations
002/005b/227/228/231 + the suspended_at SQL (22 columns) and verified
against `information_schema` on a fresh migrated DB.

User-visible behaviour change: the DSAR bundle's `user` section no
longer contains the five excluded keys; all other sections and status
codes (200/401/403/404) are unchanged. Biometric section untouched
(#2034); the three biometric `SELECT *` queries untouched (#2033).

## Evidence

- Red first (unmodified base 611a343b5): unit sentinel suite
  `compliance-dsar-export-user-allowlist-2035` — 4 failed / 3 passed
  (sentinel values present in the serialised bundle; `SELECT *` pin
  failed). Real-DB suite on fresh DB `rekrut_2035` — 2 failed / 2
  passed (self + admin exports leaked; 404/403 held).
- Green: unit suite 7/7; real-DB suite 4/4 (real router, real auth,
  real DB; export's `data_requests` row read back). Neighbours:
  #1548 + #1533 + #1550 + compliance-authz + admin-dsar-fulfillment +
  #2028 biometric unit suites — 188/188; #2028 biometric real-DB
  journey on a second fresh DB — 1/1.
- Rig: PostgreSQL 18.6 at 127.0.0.1:55441; fresh DBs built only by
  `node migrate.js`, exit 0.
