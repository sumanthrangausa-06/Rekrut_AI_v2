# Gate Note for Lead — M11 Tiered Observer (2026-10-13 ruling)

**From:** Rex · **Companion to:** `prds/prd-m11-ai-observer-integrity.md` (§2–§5, §8) · **Status:** Sumanth ruled "all three" (2026-10-13). Tier 1+2 are new build scope; Tier 3 stays parked. File the stories; do not fold them into S-089.

## New stories to file (STOP 1 specialist decision mandatory on each; privacy is the risk domain — Lex's red lines ride as ACs)
1. **Tier 1 no-media presence branch** — no-subscription join path + presence notice/objection artefacts + tier resolver (PRD §3). The January audit spine it writes into is S-089's record shape.
2. **Tier 2 feedback composer** — post-lock composition from locked human scorecards, provenance-linked (PRD FR-M11-6). **Dependency:** reads scorecards through the S-093 session-resolver path (or an equivalent read path scoped at STOP 1) — sequence after/with S-093, not around it.

## What the Tier 1+2 build must PROVE before any enablement (evidence, not assertion)
- **No-subscription evidence, Dormancy-Evidence-Pack style:** with candidate tracks actually published/offered (non-vacuous), a Tier 1 session shows exactly **zero** subscriptions, zero frames received/decoded, zero media buffers, zero storage writes, zero analysis rows — and exactly the permitted writes: attendance + `analysis_provided: false`. One failing counter fails the gate.
- **Tier-resolution coverage:** every row of the PRD §3 table has a test, including row 4 (consent granted, class not activatable → Tier 1+2, consent recorded not banked), row 6 (no notice → no presence), mid-session withdrawal downgrades, and **no mid-session upgrade**.
- **Blindness at the API:** a scorer (incl. the recruiter==interviewer same-person fixture) gets denial/derived-state for the AI section until their own scorecard is submitted+locked; UI-hiding alone does not discharge this.
- **Composer provenance:** composition **fails** on any statement that cannot be traced to a human source artefact (red-first test); Tier 1+2 output carries no AI-assessment labelling; any combined number is arithmetically human-scores-only.
- **No-inference presentation:** recruiter-surface payload + DOM are indistinguishable across declined / objected / unknown (the S-039 T-16 standard) — objection must not be inferable.

## What stays parked (do not slot, do not build toward)
- **Tier 3 activation** — governed solely by the Gate A re-entry contract: counsel + design cleared by **2026-11-01** (cohort-pilot speech slice) / after **2026-12-01** nothing pre-launch; open triggers escalate to Sumanth. Counsel **C-04** (notice-only presence sufficiency) and **C-05** (transcript-content classification; voice/face classification) are open — Tier 1 ships as Sumanth's product ruling with C-04 named against it; no Tier 3 class activates without C-05.
- **Lex's S-085 conditions:** C-L1 (outcome-rows) → pre-activation resolution; C-L2 (PITR evidence) → Relay/promotion track; C-L4 (Rung 2 live-room) → Quinn, activation-blocking. C-L3 (jest) remains staging-promotion-blocking for capture code.
- **#777 blocks ANY Observer enablement** (all tiers) until the policy-page promise is fixed. S-089 (audit spine) likewise precedes any enablement. The capture flag stays OFF everywhere; January/presence consent is never banked (RL-01).
- S-049b (#697), S-027 (#674), S-034 (#681): parked under the contract — not Sprint 11/12 build scope unless the contract fires.
