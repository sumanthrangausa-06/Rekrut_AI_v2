# #1613 — human_override ai_confidence honesty (build log)

**Defect:** three `human_override` audit writes in `routes/recruiter.js`
(status change, batch status change, offer send) stamped a fabricated
`ai_confidence: 0.85` whenever the overridden AI decision had recorded no
confidence (`aiMetadata.confidence || 0.85`); `||` also destroyed a
legitimately measured `0`. Same fabrication class as #1584 item 4.

**Fix:** `aiMetadata.confidence ?? null` at all three sites — the merged
#1584 pattern. Unrecorded → `null` in `audit_logs.metadata`; measured `0`
survives; recorded values pass through.

**Client sibling (included, per STOP 1 on #1613):** the admin compliance
overrides pages rendered the field unguarded, so a null would have shown
as a fabricated `0%`:
- `client/src/pages/admin/compliance.tsx` — type `number | null`; cell
  renders `N/A` when null; "Avg AI Confidence" averages recorded values
  only (`N/A` when none recorded).
- `client/src/pages/admin/compliance/EUAIActDashboard.tsx` — type
  `number | null`; cell renders `N/A` when null.

**User-visible behaviour change:** on the admin compliance overrides
surfaces, overrides whose AI decision recorded no confidence now show
"N/A" instead of the previously fabricated 85% (server) / 0% (client).

**Tests:** `server/__tests__/routes/recruiter-override-confidence-1613.test.js`
(red-first: 9 failed on dev with `Received: 0.85`; green 12/12 after fix)
drives all three endpoints; `client/src/__tests__/components/override-confidence-honest-null-1613.test.ts`
pins the client render contract (5/5). Neighbouring suites pass (42/42).
Quinn HL-003 fresh-install rig evidence is recorded on issue #1613.
