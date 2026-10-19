# Train manifest — Trust Foundation (Train 1) — FROZEN at assembly

- **Modules:** consent-privacy v1.0 → v1.1 · landing-honesty v1.0 → v1.1
- **Multi-module justification (design §0.1):** the two lines are file-disjoint (verified in design §6.1); each module gets its own version bump, tag, registry row, and retest section inside this one train PR.
- **Base staging SHA:** `007a65523a652814ff1ee03de411f32fa28516d7` — re-verified live 2026-10-19 (`git ls-remote`: staging tip 007a6552; live deploy dep-db9qsa8m7kps73edj2n0 at that commit; staging /health 200 on that commit at assembly time).
- **Sumanth's release word (verbatim, 2026-10-19):** "release whats done" — release of Trains 1 and 2 to staging (design §3 Step 1).
- **Train order source:** module-trains design 2026-10-18, §5/§6.1/Appendix A. Design wins over any summary.

## Ordered picks (dev merge order; consent internal order #1316 → #1324 preserved) — all 10 applied clean, zero conflicts

| # | PR | Merge SHA | Issue | Scope |
|---|----|-----------|-------|-------|
| 1 | #1309 | `bd44df67` | #1306 | consent recording fix — double-/api paths + type deduction (`lib/consentService.js`, QPBiometricConsent, screening-questionnaire, job-applicants) |
| 2 | #1310 | `06290498` | #1278 | landing: remove invented stats / Live Stats / unsourced testimonials |
| 3 | #1313 | `61c821e1` | #1311 | About: remove fabricated stats |
| 4 | #1316 | `a57792cd` | #1315 | migration 268: recorded declines on consent_receipts |
| 5 | #1319 | `574da332` | #1314 | About: verify timeline claims |
| 6 | #1320 | `ed9b468e` | #1317 | consent history renders declines truthfully |
| 7 | #1321 | `3133b009` | #1314 | test only: '(formerly HireLoop)' guard |
| 8 | #1322 | `98fb24bd` | #1317 | consent history fail-closed status |
| 9 | #1324 | `35f7ab49` | #1318 | migration 268 fail-loud + 269 repair |
| 10 | #1355 | `d08d6677` | #1354 | SOC 2 claims → 'in progress'; /signup redirect |

## Migrations carried

| File | Class | Dependency check |
|------|-------|------------------|
| `migrations/268_consent_receipts_decline.js` | additive (constraint widen) | references `consent_receipts` (mig 244, staging-applied) → §4 rule (a). Fail-loud by design — §4.2 seeded proof is the pre-flight. |
| `migrations/269_consent_receipts_decline_repair.js` | additive (constraint repair) | depends on 268 → §4 rule (b), same train, numeric order. |

File-set diff (assembly, authoritative `git diff origin/staging..HEAD -- migrations/`): **exactly 268 + 269** — no strays. Modified-in-place already-applied files: none in this train.

## Shared files / cross-module impact

- `lib/consentService.js` — consent surfaces also live in screening-questionnaire + recruiter job-applicants pages (consent-only hunks). No AI libraries, no package.json changes.

## Explicit exclusions

- All other pending dev work (Trains 3–9, design Appendix A). PR #1312 (UNVERIFIED assignment) not picked.

## Retest plan (design §3 Step 6)

- **consent-privacy:** fresh TEST candidate on staging → consent grant records (API response + state read back), consent decline records truthfully (no fabricated granted-at), consent history labels the decline as declined.
- **landing-honesty:** served landing/About bundles contain no "50,000+", no "Live Stats", no "94%"; SOC 2 copy reads "in progress"; /signup redirect present in the client routes.
- **Neighbour:** staging /health 200 warm after flows; candidate login smoke.
- Tester: Quinn (witnessed by Relay). Evidence: goal hidden_files/train-1/.
