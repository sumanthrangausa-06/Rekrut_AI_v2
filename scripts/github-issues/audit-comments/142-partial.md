**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**Partial implementation already exists on `dev`.** This is an extension, not a greenfield build.

Already present:

- `client/src/pages/admin/compliance/EUAIActDashboard.tsx`
- `routes/compliance.js`
- `services/biasDetection.js`
- `verify-compliance.js`
- Schema in `migrations/017_fix_missing_schema.js`

#64 covered the same scope and was closed as completed on 2026-08-06. Unlike #62, #60 and #63, in this case the code genuinely does exist.

**Before implementing:** review what the existing dashboard and `biasDetection` service actually compute, then rescope this issue to the delta. The requirement most likely still unmet is **per-posting** adverse impact reporting rather than aggregated, per the Stanford algorithmic-monoculture finding cited in #94. Aggregated reporting hides exactly the pattern that finding identified.
