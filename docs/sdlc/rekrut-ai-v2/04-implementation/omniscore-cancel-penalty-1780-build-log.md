# #1780 interim (b) — cancellations no longer penalise reliability

**Date:** 2026-10-24 · **Persona:** Nova (build), Lead (coordination), Quinn (gate) · **Issue:** #1780

## User-visible behaviour change

A candidate's OmniScore reliability factor no longer deducts 10 points
(cap 20) for a cancelled interview. `scheduled_interviews` records no
actor for a cancellation, and two of its three cancellation writers are
not the candidate (recruiter PUT, reschedule-cancel), so the old
actor-blind penalty punished candidates for other people's calendars —
on a product whose promise is a trustworthy score.

The score explainer detail string changes accordingly:
`N no-shows/cancellations (-X)` → `N no-shows (-X)`.

## What did NOT change

- A cancelled interview still earns no attendance or soft-skills credit
  (the #1801 shared credited-interview predicate is untouched).
- Cancelled rows still count in the attendance denominator as
  resolved-not-attended. Removing that effect actor-aware needs the
  `cancelled_by` schema option — #1780 (c), a founder gate item.
- No schema change, no writer change in this lane.

## Evidence

- Red first: the updated pins failed 5 tests on unfixed dev
  (`omniscore-factors`: cancelled raw 50 + four detail-string pins).
- Green: `omniscore-factors` + `omniscore-reliability-1776` 39/39;
  real-DB suites (#1781 disjoint, #1776 vocabulary, #1801 rescheduled
  credit/no-credit) on a fresh `node migrate.js` database — see the
  checkpoint comment on #1780 for the run record.
