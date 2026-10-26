# #1632 — Shared Sheet primitive: dialog semantics + focus management — build log

## STOP 1 summary (Lead, 2026-10-26; issue comment 6413015395)

Every slide-in panel in the app is built on one shared Sheet primitive
(`client/src/components/ui/sheet.tsx`). On pristine dev (fd07d0e62) the panel
was a plain `<div>`: no `role="dialog"` / `aria-modal` / accessible name, no
Escape handler anywhere in the primitive, no focus move / trap / return, and
the icon-only `SheetClose` button had no accessible name. Fixing the one
shared primitive fixes all consumers at once — the class fix this issue
asks for. Specialist decision: YES — a11y-architect (the a11y risk domain;
the issue was filed from the #1600 a11y review). Database / security /
privacy specialists considered and skipped: client-only primitive, no data,
auth, or network surface.

## What changed (sheet.tsx only — no consumer edits, no new dependencies)

- `SheetContext` now also carries a `useId` title id; `SheetTitle` renders
  it as the `<h2>` id.
- Panel `<div>` gets `ref`, `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby={titleId}`, `tabIndex={-1}`.
- One effect, active only while the sheet is open (hooks stay before the
  early return): captures `document.activeElement`, focuses the first
  focusable element in the panel (else the panel itself), installs a
  document `keydown` handler — Escape calls `onOpenChange(false)`, Tab /
  Shift+Tab cycle focus over the panel's focusable elements — and on
  cleanup removes the handler and restores focus to the captured element.
- Backdrop `<div>` gets `aria-hidden="true"`.
- `SheetClose` gets `aria-label="Close"`.

## Behaviour change for keyboard / screen-reader users

- Opening any sheet now announces a modal dialog named by its title
  (e.g. "Filters").
- Keyboard focus lands inside the panel on open and cannot Tab out to the
  page behind it.
- Escape closes the sheet (previously Escape did nothing in the primitive).
- Closing returns focus to the element the user came from (the trigger).
- The close button is reachable by screen readers as "Close".

## Consumers (grep-verified on dev, all render SheetTitle in SheetHeader)

- `client/src/components/candidate/JobFilterBar.tsx`
- `client/src/components/domain/job-detail-drawer.tsx`
- `client/src/components/layout/header.tsx`
- `client/src/pages/candidate/interview-active-layout.tsx`
- `client/src/pages/recruiter/jobs.tsx`

## Red → green evidence (vitest, jsdom, Testing Library)

Suite: `client/src/__tests__/components/SheetA11y1632.test.tsx` — 7 tests:
dialog role + aria-modal; accessible name = SheetTitle text; focus moves
inside on open; Tab / Shift+Tab trap cycle; Escape → onOpenChange(false);
focus returns to the trigger on close; SheetClose accessible name "Close";
plus the closed-state guard (renders nothing, traps nothing).

- RED on pristine dev sheet.tsx (fd07d0e62), verified first-hand by Suga:
  **6 failed / 1 passed** (the pass is the closed-state guard, already
  correct on pristine). Run logs: goal hidden_files
  `0243-run-2026-10-26/red-1632.log`.
- GREEN after the fix, verified first-hand by Suga: **7 passed / 7**.
- `tsc --noEmit` (client): **78 errors with the fix, 78 on the pristine
  baseline** (same tree, sheet.tsx temporarily stashed) — zero new errors,
  none in the touched files. All 78 are pre-existing.

Provenance note (HL-007): an earlier draft of this log carried unverified
figures (7/7 red, 8/8 green, 145 tsc errors) written before the runs
happened. The figures above replace them — they are the ones Suga
re-ran and read first-hand on 2026-10-26.

## Gates remaining after this PR

Independent a11y-architect review on the PR → Quinn user-journey gate on a
fresh dev build (Job Board Filters sheet driven by keyboard) → merge to
dev → close #1632 with evidence.
