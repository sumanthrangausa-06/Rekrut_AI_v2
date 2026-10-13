# Full-Application Documentation & PRD Set — Phase 2 (2026-10-13)

**Author:** Rex (solutioning persona), Phase 2 of Sumanth's full-application pass.
**Inputs:** Scout's full-application relearn (`00-relearn/project-knowledge-base-2026-10-13-full-application.md`, verified against `origin/dev` @ `48454fea`) — module states, journeys, issue reconciliation, reverse ADRs lifted from there, not re-derived. Existing Phase 2/3 docs reconciled against; supersessions are named in each PRD.
**Chain:** Scout (relearn) → **Rex (this set)** → Sumanth's decisions → Lead (planning/build).

## Contents

| Doc | What it is |
|-----|-----------|
| [application-overview.md](application-overview.md) | Whole-application architecture & current state: 22-module map, cross-module flows (candidate journey, recruiter journey, data lifecycle), cross-cutting findings, reverse-ADR resolutions |
| [decisions-for-sumanth.md](decisions-for-sumanth.md) | **Every decision this set needs from Sumanth, consolidated** — grouped, with Rex's recommendation on each |
| `prds/prd-m01…m22` | One PRD per module — full end-to-end: purpose, users, journeys, verified current state, gap to launch-ready, functional + non-functional requirements, dependencies, Sprint 11 overlap, unverified box, and that module's boxed decisions |
| `prds/prd-s1-landing-legal.md` | Supplementary PRD for Scout's unnumbered surface (landing/marketing/legal pages) |

## Specialist decision (Rex's planning gate — stated per the standing rule)

| Lens | Applied to | Why |
|------|-----------|-----|
| Privacy-engineer | M11, M14, M15, M19 (+ M6 erasure-adjacent items) | Biometric consent, erasure completeness, and the CRA-adjacent signal are the launch's legal centre of gravity; Lex's 61 requirements / 12 red lines from the Gate A design package are carried into these PRDs as requirements |
| Database-reviewer | M6, M12, M13 | M6/M12 defects are data-shape defects (missing DELETE coverage, a score pipe reading the wrong table); M13 carries schema-era breakage debt |
| API-design-reviewer | M6, M15, M20 | The repeatable defect class is object-authorisation inconsistency across routers (Scout §4); M15's chassis is new API surface; M20's public API is a published contract |
| UX/design method (`impeccable`, taste-skill, Vercel web-interface-guidelines) | All UI-heavy PRDs (M1–M5, M7–M11 surfaces, M16, M17, S1) | Named as the required method for UI requirements because **no DESIGN.md exists** — see the DESIGN.md decision in `decisions-for-sumanth.md`. `impeccable/harden` in-build and `impeccable/polish` pre-PR follow the S-039/S-087 precedent |
| Lex (legal persona) | Consulted as requirement source, not approver | Counsel determinations (C-01…C-08, #788) are real counsel's; Lex's red lines are encoded, his open determinations are surfaced as decisions, never settled here |

**Considered and skipped, with reasons:** standalone security-reviewer pass (the authorisation defect class is already runtime-proven by S-088; its remediation is encoded as requirements, and per-story security review remains Nova's STOP 1 duty); performance-optimizer (no performance evidence base exists — perf items sit in per-module *unverified* boxes rather than invented requirements); Sage/modernize (M4/M20 god-files are noted as structural risk with refactor *options*, but no migration is scoped without Sumanth's decision).

## Reading rules for this set

- **Verified state** means Scout verified it in code or the S-088 audit proved it at runtime (credited where so). Anything else is in a module's **⚠ Unverified** box.
- **Requirements encode Sumanth's rulings** (Gate A amended, mock-scores ruling, module-order, narrowed threat-intel v1 + no-outreach, EU postponed, $0 budget, no fake scores, all-device responsiveness). Where code contradicts a ruling, the requirement states the ruling and the gap states the code.
- **Sprint 11 overlap:** the Sprint 11 spine (P0 trio #820/#821/#822, #799 legal hold, #780 erasure, #777) is approved and building under Lead. PRDs mark the overlap and treat filed Sprint 11 stories as the committed layer — nothing here re-plans them.
- Story points and sprint sequencing are **Lead's**, after Sumanth's decisions. These PRDs define *what and why*; they deliberately do not size.
