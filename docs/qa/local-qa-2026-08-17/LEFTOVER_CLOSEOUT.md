# Local QA leftover close-out — 2026-08-21

## Plan vs leftover

Browser E2E, nav audit, and the verdict matrix were already done. What was still open:

1. GitHub issue comments (MCP GitHub server is down; comments not posted from this session).
2. P0 code/schema fixes that made those tests fail.
3. Git push of the fixes (this commit). Render staging + Neon were **not** used as the live test DB: Neon compute quota is exhausted (HTTP 402) and staging Render is billing-suspended. Local Postgres `:5433` remains the test target. Secrets were not committed.

## Fixes in this commit

- Recruiter dashboard/analytics: `analyticsCache.key` instance method (#12/#72/#129).
- Recruiter Candidates: import `UNSPLASH_IMAGES` (#112).
- Owner RBAC on company create (#138).
- Header + back-links: `/candidate/ai-coaching`, `/recruiter`.
- SPA `KNOWN_ROUTES` for referrals/calendar/panels/etc. (#80/#127).
- Auth context: skip `/api/company/profile` for non-recruiters.
- Migrations 119 JSON seed, 130 trigger/typo/ivfflat, 131 `"current_role"`.
- OmniScore query columns + DB tier mapping (#113).
- TrustScore location via `candidate_profiles` (#122).
- `diagnosis_data` / `updated_at` / billing columns (#77).
- App.tsx missing lazy imports (#182); migrate SSL localhost (#183).

## Retest on localhost:3000 (local DB, staging-style keys in gitignored `.env`)

| Check | Result |
|---|---|
| `GET /api/health` | 200 |
| Recruiter dashboard | 200 |
| Recruiter company profile | 200 |
| Candidate search | 200 |
| Coding templates | 200 |
| TrustScore breakdown | 200 |
| Career coach status/history | 200 |
| Pipeline-stats / analytics | 200 |
| SPA `/recruiter/calendar`, `/candidate/referrals` | 200 (was HTTP 404) |
| Candidate company profile | 403 (expected; UI no longer calls it) |
| OmniScore | still 500 until server restart after tier map (constraint was `new/bronze/silver/gold/platinum`) |
| Career diagnosis GET | 500 until 229 `updated_at`; empty user should then 404 |
| LiveKit / Cartesia live / Stripe live / OAuth consoles | still blocked |

## Staging / Neon

Do **not** point local `DATABASE_URL` at Neon. After Render billing is restored and Neon quota is available, deploy this `dev` commit (or cherry-pick onto `staging`) and run `npm run migrate` **before** relying on `npm start` (staging currently starts without migrate).
