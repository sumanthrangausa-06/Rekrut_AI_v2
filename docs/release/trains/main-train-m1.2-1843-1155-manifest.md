# Main Train M1.2 — #1843 Pro-unlock fix (Train 9) + #1155 fresh-chain fix (Train 10) → production

Date: 2026-10-25 · Owner: Relay · Authorization: standing promotion authorization (Sumanth, 2026-10-22)

## Contents (cherry-picks from staging, patch-identical to the staging trains)
- Train 9 (PR #1847 on staging): #1843 — paid checkout now unlocks Pro: confirm writers store a tier-accepted status, stranded paid rows heal on /auth/me, verify-payment and /billing/subscription-status, Analyze click shows feedback.
- Train 10 (PR #1848 on staging): #1155/#1329 — migrations 254/257 restrict CHECK lookups to pg_constraint contype='c' (fresh-install chain repair; both migrations already applied on the shared DB — no schema change).

## Proof
- Train 9: staging live at 81b0c6471 (deploy dep-dbf29ldg1s2s73e7o5gg, 3/3 health samples agreeing) AND **founder proof 2026-10-25 ~11:54 PT** — Sumanth signed in to staging on his stranded paid account and CV Analyze completed end-to-end (impossible on the pre-fix 'complete' tier status). This was the last gate on #1843.
- Train 10: fresh DB migrate on the train tree completed ("All migrations completed successfully", Train 10 manifest); zero effect on the already-migrated shared DB.

## NOT in this train
- Train 11 (#1804 interview outcome hygiene, PR #1851 on staging, live on staging at 9ccfb8abb — verified by 3/3 health samples 2026-10-25): HOLDS at staging. Its staging proof is incomplete: the Quinn fresh-install suite file cited in its manifest was not found on the build VM (unverified claim, HL-007) and the live staging read-back legs have not been run. It promotes only after that proof lands.

## After merge
- Trigger prod deploy (autoDeploy off), verify deploy record + repeated /health samples agree on the merge commit.
- Close #1843 with this evidence. #1837 (prod auth cold-hang) remains open and unaffected.
