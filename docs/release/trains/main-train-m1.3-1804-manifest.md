# Main Train M1.3 — #1804 interview outcome hygiene (Train 11) → production

Date: 2026-10-25 · Owner: Relay · Authorization: standing promotion authorization (Sumanth, 2026-10-22)

## Contents (cherry-picks from staging, patch-identical to the staging train)
- Train 11 (PR #1851 on staging): #1804(i) candidate reschedule clears stale outcome to NULL (staging pick 3a1f3146e, patch-id 51494c728769cb58abe59d886ebf8b0a7057b357 — also identical to the dev original 68af93766) + #1804(ii) recruiter PUT cross-field guard (staging pick 999e1acbd, patch-id 48bf820b796936fdcca7b28d40a7a7584689b538; the staging pick's base context differs from dev's bbba344a6, the applied change is the staging-proven one).
- Picks onto main 38f16c0ec applied clean, zero conflicts: 51ae8260e (i) + a1eb65cb0 (ii), patch-ids re-verified identical to the staging picks above.
- No migrations, no env changes.

## Proof — why Train 11's staging hold is now cleared
M1.2 held Train 11 at staging for two stated reasons; both were closed first-hand in the 2026-10-25 13:43 PT advance run (Relay):
1. *"The Quinn fresh-install suite file cited in its manifest was not found on the build VM."* — The suites exist on both the dev and staging trees (`tests/interview-reschedule-clear-outcome-1804.check.js`, `tests/interview-recruiter-put-guard-1804.check.js`); the earlier miss was a stale local checkout (HL-002). Relay re-ran both suites first-hand on the Train 11 tree against a fresh-migrated Postgres 18.4 (real HTTP): **part (i) PASS; part (ii) PASS (T1–T11)**. Both suites also PASS on this M1.3 tree.
2. *"The live staging read-back legs have not been run."* — Run live against rekrutai-staging.onrender.com at staging commit 9ccfb8abb (deploy verified: 3/3 /health samples agreeing, db connected). Full recruiter+candidate journey through the real API doors (register → post job → apply → schedule → outcome written on scheduled row → candidate reschedule → recruiter PUT attempt): **ALL 15 legs PASS** — read-back after reschedule: status `reschedule_requested`, outcome `null` (part i live); recruiter PUT of outcome/feedback on the rescheduled row: **400** with the guard message, row read back unchanged (part ii live). Also verified: a completed interview cannot be rescheduled (404, honest behaviour). Evidence: goal hidden_files `train-11-proof/live-leg-run5.log` (script `live-staging-1804-leg.js` alongside it).

## After merge
- Trigger prod deploy (autoDeploy off), verify deploy record + repeated /health samples agree on the merge commit.
- Train 11 closes out in the registry on staging (interviews hygiene carried under Train 11; no versioned module entry exists for interviews — registry note updated on the staging copy).
