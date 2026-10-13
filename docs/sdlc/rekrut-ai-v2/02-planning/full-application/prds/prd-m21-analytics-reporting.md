# PRD — M21: Analytics & Reporting

**State (verified, Scout §2): product analytics BUILT; integrity reporting ABSENT.** **Surfaces:** `routes/analytics.js`, `lib/analytics-cache.js`, materialized views (migration p3c) · client: recruiter/analytics, admin/analytics.

## 1. Purpose & users
Numbers for decisions: recruiter pipeline analytics, platform/revenue analytics for admin — and, in the full vision, the two formal report products (recruiter full report, candidate qualitative report) and integrity-metrics reporting. Users: recruiters, platform admin; candidates (qualitative report, unbuilt).

## 2. End-to-end journey
Recruiter opens analytics → aggregated application/interview data renders from materialized views (cached). Admin sees platform + revenue rollups (M20 pages consume the same spine).

## 3. Current state (verified)
Product analytics work. The E-006 report stories are **unbuilt**: S-036 (#683, recruiter full report) and S-037 (#684, candidate qualitative report) — today's "reports" are the interview surfaces in M9/M10, not these products. Integrity-metrics dashboards (S-053a/b, #701/#702) are absent and **depend on M11's analysis chain**, which Gate A deferred — they cannot exist honestly in January. Analytics integrity caveat: pipeline stats were among the M6/M7 correctness findings (#405's "stats count the wrong population"; #820's status manipulation poisons selection-rate/adverse-impact numbers until fixed — Sprint 11).

## 4. Gap to launch-ready
For January: analytics correctness on top of the Sprint 11 spine (stats computed from server-authoritative statuses — M6 FR-M06-1 is the precondition). The report products (E-006) and integrity dashboards are **post-launch scope** unless Sumanth rules otherwise; they are named here so their absence in January is a decision, not an oversight.

## 5. Functional requirements
- FR-M21-1: Every displayed aggregate traces to a defined population (the #405 lesson); analytics queries are company-scoped under the object-authorisation convention — a recruiter's analytics can never include another company's rows.
- FR-M21-2: No integrity metric, trend, or dashboard ships before the M11 measurement it summarises exists and is validated (slice-by-slice rule) — an empty integrity page is preferable to a fabricated one, and no page is preferable to an empty one at launch.
- FR-M21-3: Candidate-facing analytics (if any) show the candidate only their own data, consistent with the M12 panel's candidate-sees-what-recruiter-sees symmetry where the ruling requires it.

## 6. Non-functional
- Performance: materialized views + cache are the pattern; new aggregates follow it rather than scanning hot tables per request.
- Honesty: selection-rate/adverse-impact-adjacent numbers must be labelled with their population and period — a rate without a denominator is a fake-precision risk.

## 7. Dependencies (verified states)
M6 statuses (exist; correctness under Sprint 11 repair) · M11 analysis (**absent/deferred** — blocks integrity reporting only) · M20 admin surfaces (exist).

## 8. Sprint 11 overlap
None filed; Sprint 11's #820 fix is this module's data-quality precondition.

## 9. ⚠ Unverified
Materialized-view refresh cadence/correctness under real data; whether any recruiter-facing number today double-counts (beyond the filed findings).

## 10. ▣ DECISIONS FOR SUMANTH
- **D-M21-1:** Confirm E-006 report products (#683/#684) as **post-launch** scope (January's reports = the M9/M10 interview surfaces)?
  **Rex's recommendation: yes, post-launch.** The candidate qualitative report in particular deserves the Candidate Experience + copy-audit treatment the Observer reports got; rushing it into January would ship the platform's most-read candidate document with the least review.
