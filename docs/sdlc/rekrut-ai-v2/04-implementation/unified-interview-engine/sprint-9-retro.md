---
project: Unified Interview Engine
phase: 4-Implementation
sprint: 9
status: final
created: 2026-10-12
owner: Sumanth
lead: Lead (Team Lead, smart-sdlc Phase 4)
---

# Sprint 9 Retro — E-008 Specs + Full Observer Build Track

> **Status:** Final closing record for Sprint 9. This retro supersedes the status in `sprint-9-plan.md` (which remains as the planning record; its `status: draft` header was never updated as the sprint's scope changed mid-flight — recorded here honestly rather than edited after the fact).
> **Plan:** PR #772 (merged). **Planning method:** smart-sdlc `sprint-planning` + `writing-plans`.

---

## Planned vs. Delivered

**Planned (6 / 20 pts):** a spec-only sprint — S-080 E-008 spec (#761) and S-081 threat-intel spec (#764), both Rex-owned, with Nova deliberately uncommitted.

**Delivered:** both specs **plus the entire E-008 implementation track**, pulled into the sprint by Sumanth's mid-sprint approvals (spec approval → gate amendment approval → story-by-story merge gates):

| Item | Issue | PR | Result |
|------|-------|----|--------|
| S-080 E-008 AI Observer spec | #761 | docs on `dev` (`6fbb84c3`, `cf17a39e`) | Approved by Sumanth; gates S-046–S-049 |
| S-081 Threat-intel checks spec | #764 | docs on `dev` | Approved for Sprint 10 implementation planning, with conditions (HIBP ToS verification, AbuseIPDB DPIA) |
| S-046 Observer toggle + default-deny gate | #694 | #773 | Merged; consent gate amended to default-deny (Sumanth-approved) |
| S-047 Invisible observer bot (LiveKit) | #695 | #774 | Merged; worker runs **in-process** ($0) per Rex's recommendation + Sumanth's approval |
| S-048 Observer consent disclosure | #696 | #775 | Merged; three-state disclosure (granted / declined / unknown) |
| S-049a Observer report writer (scaffold) | #776 | #778 | Merged at 2 pts (Nova's STOP 1 declaration, revised from 3) |

**Not delivered as originally written:** S-049 (#697) — split, see below. E-008 epic #638 stays **open**: its definition of done requires the S-039 renderer (#686), scheduled for Sprint 10.

## The S-049 Split (the sprint's defining event)

Nova's STOP 1 on #697 found the E-008 spec's core assumption was false: §4.1 said "reuse `AnalysisService` + `IntegrityService` (E-004/E-005)" — **neither service exists** (verified repo-wide, zero code). The 5-point story was a multi-sprint analysis pipeline in disguise. Nova refused to proceed on a broken scope.

A Rex × Nova × Lead panel (2 rounds, specialists dispatched by each persona, codebase-verified) converged on the split, approved by Sumanth 2026-10-12:

- **S-049a (#776)** — report-writer scaffold: honest `missing`-state sections, granted-only writes. Built and merged.
- **S-049b (#697, stays open)** — real analysis, formally blocked by S-027 (#674) + S-034 (#681); also carries the GET read endpoint, the Track B qa-report rename, and the erasure advisory-lock hardening.
- **Decision path created:** Gate A brief (Sprint 10) → Rex audit spike (Sprint 10) → Sumanth's binding E-004/E-005 launch-scope decision before Sprint 11 planning. The ~80-pt Phase-3 estimate for E-004/E-005 is **unverified** until the spike re-sizes it against real code.

## Process Change Adopted

**Dependency verification is now a hard rule.** The services fiction survived two sprints because nobody ran one grep. From Sprint 9 onward:

- Every spec dependency carries a verified state — *Verified-Exists* (file/table evidence + date), *Verified-Absent* (named owning story), or *Sumanth-Waived*. An unverified dependency **blocks spec approval automatically**. Rex added the dependency-verification table to the E-008 spec (§11) in his correction pass (`376a152e`), which also retired the services fiction and fixed the consent-state contradiction (§4.3 vs §3.2).
- Lead runs a repo-existence check on every story's dependency list at sprint planning.

## Specialist Review Record

The privacy-engineer earned her place in every story this sprint:

- **S-046:** 2 blockers fixed — gate bypass via the `already_enabled` short-circuit; missing production-shape test coverage.
- **S-047:** 4 blockers fixed — wrong LiveKit import (worker would have crashed), dead event handler, auto-subscribe bypassing the consent gate, missing enqueue path.
- **S-048:** 2 blockers fixed — "may include AI analysis" disclosed even when the gate blocked the observer; a contradictory pre-existing notice.
- **S-049a:** APPROVE WITH CHANGES — F2/F3/F5 fixed in-PR; **F1** (mid-flush consent-withdrawal sub-window) routed to S-049b's advisory-lock scope; **F4** (unguarded `observerJobs.cancel()`/`fail()`) filed as #779.

Rex's post-implementation reviews (the Sprint 8 norm) held throughout: Rex was briefed on specialist fixes before merges, and owned the two judgment calls Sumanth asked him for directly — the default-deny gate amendment rationale and the in-process worker recommendation.

## Honest Limitations Carried Forward

- **Erasure/withdrawal race: narrowed, not closed.** S-049a's in-transaction job-existence check + race tests cover the session-end→flush window; the fully-concurrent window needs the shared advisory lock owned by S-049b. Nova's dissent stands on the record — do not describe this race as closed.
- **No real-DB verification was possible** for any Sprint 9 story: this VM has no local Postgres and Neon is TLS-unreachable. Tests mock the DB layer; the S-049a INSERT was verified column-by-column against migration 256 by hand. Migrations 255 + 256 must run on deploy.
- **Observer analysis itself does not exist yet.** Reports render honest `missing` states. Anything downstream (S-039) must preserve that honesty — no fabricated signals, per Sumanth's no-fake-scores standard.

## Carried Into Sprint 10

- S-039 renderer (#686) — panel-sequenced immediately after S-049a.
- Threat-intel implementation planning (#764) — spec approved, entry conditions open; HIBP cost concern flagged for verification (see Sprint 10 plan — verified, and it changes the planning shape).
- Rex audit spike + Gate A brief → E-004/E-005 launch-scope decision.
- #766 (role model) still blocked on Sumanth's decision. #777 (biometric-policy promise) and the R2/#336 cleanups remain pre-launch track.
