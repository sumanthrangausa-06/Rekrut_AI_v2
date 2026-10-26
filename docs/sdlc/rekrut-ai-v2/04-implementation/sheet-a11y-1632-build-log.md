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

Suite: `client/src/__tests__/components/SheetA11y1632.test.tsx` — 8 tests:
dialog role + aria-modal; accessible name = SheetTitle text; focus moves
inside on open; Tab / Shift+Tab trap cycle; Escape → onOpenChange(false);
focus returns to the trigger on close; SheetClose accessible name "Close";
plus the closed-state guard (renders nothing, traps nothing).

- RED on pristine dev sheet.tsx (fd07d0e62, file swapped in directly from
  origin/dev), verified first-hand by Suga: the original 7-test suite ran
  **6 failed / 1 passed** (the pass is the closed-state guard, already
  correct on pristine); the full 8-test suite runs **7 failed / 1 passed**
  on pristine. Run logs: goal hidden_files `0243-run-2026-10-26/red-1632.log`.
- GREEN after the fix, verified first-hand by Suga: **8 passed / 8**.
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

## Independent review — disposition (a11y-architect, PR #1882 comment 6413131870: BLOCK)

- **F1 (outside-panel Tab branch) — KEPT, dissent recorded.** While the
  dialog is modal, focus stranded on `<body>` (the Safari/non-focusable-
  click case) is stray focus; pulling it to the first focusable element is
  the trap doing its job. Narrowing the branch to the panel element only
  would let that Tab press walk into the page behind the modal in exactly
  those browsers — a trap leak. The behaviour is now pinned by a test
  (see F7). Suga's call as CTO; the reviewer's contrary position is
  preserved here and on the PR.
- **F2 (open-state timing race) — ACCEPTED known limit.** The keydown
  handler installs in the open effect; a key pressed in the sub-frame
  window between the open render and the effect is not seen. The same
  effect-installed-handler shape is the mainstream pattern; no cheap
  restructure removes it.
- **F3 (focus-return to a detached trigger) — FIXED.** Cleanup now checks
  `document.contains(previouslyFocused)` before restoring focus.
- **F4 (SheetTitle outside a Sheet) — REFUTED on this tree.** The committed
  code is `id={ctx.titleId || undefined}`; the default `''` becomes
  `undefined`, so no empty-string id attribute is rendered.
- **F5 (two Sheets, two handlers) — DOCUMENTED limit, not a live defect.**
  No consumer stacks two open Sheets at once (interview-active-layout's
  two sheets are alternative panels). Stacked-sheet Escape ordering is
  out of scope for this primitive fix and recorded here.
- **F6 (aria-labelledby with no SheetTitle) — REFUTED for current
  consumers.** Grep-verified on the branch tree: every consumer's Sheet
  renders exactly one SheetTitle (header 1/1, JobFilterBar 1/1,
  job-detail-drawer 1/1, interview-active-layout 2/2, recruiter jobs 1/1).
- **F7 (outside-panel branch untested) — FIXED.** New suite leg pins the
  body-focus Tab pull-in; suite is 8 tests (red 7/1 on pristine, green 8/8).
