# Build log — #1883 item 1: Sheet modal stacking

**Lane:** Nova (build), coordinated by Lead, gated by Suga. STOP 1 on issue
#1883 (comment 6551945517). Scope is item 1 ONLY — items 2, 3, 4 already
shipped; item 5 (i18n `aria-label`) stays parked and #1883 stays open for it.

## Root cause

In `client/src/components/ui/sheet.tsx`, every open Sheet ran its focus
effect independently: each installed its own `document` keydown handler,
each trapped Tab against its own panel, and each effect cleanup restored
focus to the element it captured on open (`previouslyFocused`). With two
Sheets open at once there was no coordination, so:

- one Escape fired **both** handlers and closed both sheets;
- the lower sheet's Tab trap treated focus inside the top sheet as
  "stranded outside my panel" and dragged it into the lower panel, after
  which the top trap dragged it again — the traps fought;
- a closing sheet's cleanup restored focus to its captured element even
  when that element sat outside the sheet still open, throwing the
  keyboard user out of a live modal.

No consumer stacks Sheets today (verified at #1632 review time), so this
was a latent defect in the shared primitive, sealed before a stacking
consumer appears.

## Fix shape (sheet.tsx only, ponytail: one array + one check)

- Module-level `openSheetStack: HTMLDivElement[]` in `sheet.tsx`. A Sheet
  pushes its panel in its existing focus effect and splices it out in
  cleanup. Last entry = topmost open sheet.
- `handleKeyDown` returns immediately unless its panel is the topmost
  entry — only the top sheet acts on Escape / Tab (the item-2
  `defaultPrevented` guard is unchanged inside the surviving handler).
- Cleanup focus: after unregistering, if a sheet remains open, focus its
  first reachable focusable (same `FOCUSABLE_SELECTOR` +
  `isFocusableReachable` filter as the trap) or the remaining panel
  itself. If none remains, restore `previouslyFocused` exactly as before.
- Single-sheet behaviour unchanged; backdrop click unchanged (per-sheet,
  and only the top backdrop is reachable when stacked).
- No new dependencies, no new production files.

## User-journey tests — red → green

New suite `client/src/__tests__/components/SheetStacking1883.test.tsx`
(Quinn + Candidate Experience lens, per the STOP 1 acceptance): a keyboard
user with two stacked panels.

**RED — against unchanged dev `4cf5af89c`:** `3 failed | 3 passed (6)`

- × (a) one Escape with two stacked sheets closes ONLY the top sheet
- × (b) Tab on a middle control of the top sheet is not hijacked by the
  lower sheet trap
- × (c) closing the top sheet returns focus into the still-open lower sheet
- ✓ (b2) top trap still wraps Tab from its last control (regression leg)
- ✓ (c2) closing the lower sheet keeps focus inside the top (regression leg)
- ✓ (d) single sheet open → Escape → focus returns to trigger (regression leg)

**GREEN — after the fix:** the new suite 6/6, and the neighbouring Sheet
suites all pass in the same run:

- `SheetStacking1883` — 6 passed
- `SheetA11y1632` — 8 passed
- `SheetHardening1883` — 4 passed
- `SheetSelector1883` — 8 passed
- **Total: Test Files 4 passed (4), Tests 26 passed (26)**

No other test files import `ui/sheet` (checked by grep over
`client/src/__tests__`); the five Sheet consumers (JobFilterBar,
job-detail-drawer, header, interview-active-layout, recruiter jobs) have
no dedicated component suites touching the primitive.

Typecheck: `tsc --noEmit` reports 83 errors on this branch and the
identical 83 on pristine `origin/dev` — all pre-existing in unrelated
test files, none in `sheet.tsx` or the new suite; this lane adds zero.

## Specialist decision note

Per STOP 1: **ecc a11y-architect lens — YES**, because the risk domain is
keyboard/focus behaviour in an accessibility primitive. The fix applies
that lens's focus-management principles (single owner of the trap,
topmost-only key handling, focus never leaves a live modal). The
independent a11y review of this diff happens after the PR, at Suga's
gate — it is not performed by the builder. Security / database / UX
specialists were considered and skipped at STOP 1 (no auth/data surface,
no visual or copy change).
