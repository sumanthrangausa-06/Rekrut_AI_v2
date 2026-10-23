# #1626 — Memory-service fabricated confidence 0.8 (build log)

**Defect:** `services/memory-service.js` used `confidence || 0.8` at both
`addMemory` insert sites. Callers that record no confidence (the routes
and the service's own application/recruiter extractors) therefore
persisted an invented 0.8, and a genuinely measured 0 was destroyed by
the same `||`.

**Fix (pattern from #1619):** one `measuredConfidence()` helper — a
finite number in [0, 1] is recorded verbatim (0 included); anything
else (absent, NaN, out of range, non-number) is stored as NULL, the
honest not-recorded state. The column is nullable; migration 037's
`DEFAULT 0.80` only applies when the column is omitted, and this writer
always sends the column explicitly. `getMemories` now orders
`confidence DESC NULLS LAST` so unmeasured rows stop sorting ahead of
measured ones (Postgres `DESC` defaults to NULLS FIRST).

**User-visible behaviour change:** AI memory entries no longer carry an
invented confidence; consumers see `confidence: null` for unrecorded
memories instead of a fake 0.8.

**Tests:** `server/__tests__/services/memory-service-confidence-1626.test.js`
— red-first (9 failures on pristine dev), green after (11/11), covering
both insert paths including the conflict fallback. Quinn HL-003
fresh-install evidence (real PG read-back) is recorded on the issue.
