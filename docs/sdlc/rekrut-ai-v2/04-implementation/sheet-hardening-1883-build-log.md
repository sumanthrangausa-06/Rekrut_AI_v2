# Sheet hardening — #1883 items 2 + 4 (build log)

One-point defect fixes on the shared Sheet primitive
(`client/src/components/ui/sheet.tsx`), from the independent a11y review of
#1632 / PR #1882. STOP 1 + root cause are on issue #1883.

## What changed

1. **Item 2 — Escape `defaultPrevented` guard.** The document keydown handler
   closed the sheet on any Escape. If an inner control already consumed the
   keypress (`event.defaultPrevented`), the sheet now leaves it alone: one
   keypress, one action.
2. **Item 4 — stray-focus recovery direction.** When focus is outside the
   panel, the trap's recovery branch always focused the first focusable.
   It now follows the user's direction: Tab → first, Shift+Tab → last.

Items 1 (modal stacking), 3 (focusable-selector edges) and 5 (hardcoded
"Close" label) remain open on #1883 as latent hardening — no current
consumer stacks Sheets, embeds an Escape overlay inside a Sheet, or hits
the selector edges.

## Evidence

- Red first: new suite `SheetHardening1883.test.tsx` on pristine dev —
  2 failed (the two new behaviours), 2 passed (pins: unconsumed Escape still
  closes; plain Tab recovery still lands on the first focusable).
- Green: `SheetHardening1883` 4/4 + `SheetA11y1632` 8/8 = 12/12 vitest.
- Client `tsc --noEmit`: 145 pre-existing errors on the pristine tree and
  145 with this change (same-tree comparison); none in `sheet.tsx` or the
  new test file.
