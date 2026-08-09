**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**Scope has narrowed. Three of the endpoints now exist on `dev`:**

| Endpoint | Status on dev |
|---|---|
| `screenings` | Exists in `routes/screening.js` |
| `conversations` | Exists in `routes/assessments.js` and `routes/onboarding.js` |
| `documents` | Exists in `routes/documents.js` and `routes/onboarding.js` |
| `saved-searches` | **Still missing** |
| `omniscore/explainer` | **Still missing** |

Both missing endpoints have live callers. `candidate/omniscore.tsx` calls `/omniscore/explainer` inside its loader, and `recruiter/candidates.tsx` calls the saved-searches endpoint, which is exactly why that page falls back to the fabricated data tracked in #101.

Worth re-walking the full original list of ten against `dev` before starting, since more may have landed than this audit sampled. The two confirmed gaps above are the minimum scope.
