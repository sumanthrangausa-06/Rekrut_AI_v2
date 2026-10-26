# #1883 item 3 — Sheet focusable-selector edges: build log

**Lane:** advance run 2026-10-26 11:43 PT · Lead coordinates, Nova builds, a11y-architect specialist (STOP 1 on #1883, comment 6424515162).

## The defect (user-visible)
The shared Sheet primitive's focus trap built its Tab list from one static
selector. That list counted controls a keyboard user can never reach —
`input[type=hidden]`, controls inside a `fieldset[disabled]`, anything
inside a hidden container, and a disabled button re-included by the
`[tabindex]` clause — and it never counted `contenteditable` regions, a
real stop Tab should visit. Boundaries (first/last) are where the trap
acts, so a wrong list means Tab wraps at the wrong control or tries to
land on an invisible one.

## The fix (`client/src/components/ui/sheet.tsx` only)
- Selector gains `[contenteditable]:not([contenteditable="false"])`.
- The queried list is filtered by `isFocusableReachable`: drops hidden
  inputs, disabled controls (incl. fieldset-disabled ancestry), and
  elements hidden by self/ancestor `hidden` or computed
  `display:none`/`visibility:hidden` up to the panel.
- Deliberate shortcut (marked `ponytail:` in code): the fieldset
  first-`<legend>` exception is not modelled — no Sheet consumer uses
  fieldset+legend; model it if one appears.

## Evidence (all first-hand, HL-007)
- Red-first: new `SheetSelector1883.test.tsx` 5/5 FAILED on pristine dev
  (`7cc18f366`); existing Sheet suites green at the same time.
- Green: SheetSelector1883 5/5 + SheetHardening1883 4/4 + SheetA11y1632
  8/8 = 17/17.
- Neighbourhood: `client/src/__tests__/components/` 21 files, 90 passed /
  25 skipped / 0 failed.
- tsc: 78 errors on branch = 78 on the same tree with the fix stashed;
  zero in sheet.tsx (delta zero-new).
- jsdom probe before writing the suite (findings that shaped the fix):
  a hidden container's child reports its OWN computed display (hence the
  ancestor walk); jsdom reports `fieldset` button `.disabled === false`
  (hence the explicit ancestry check, which real browsers also need for
  the selector clause); `checkVisibility` is unavailable in jsdom and
  older Safari, so it is not used.

## Remaining on #1883
Item 1 (modal stacking — needs a stacking consumer + its own design) and
item 5 (hardcoded "Close" aria-label — revisit if the client gains i18n)
stay open, latent as filed.

## Reviewer delta (independent a11y review, PR comment 6424701153 — APPROVE, no blocking)
Three minor findings from the review were folded into this PR (same defect
class — the trap list must equal the real Tab order), each pinned red-first
(3 failed on the reviewed head, green after):
1. An element with an explicit negative `tabindex` (e.g. `<a href
   tabindex="-1">`) was counted via its element clause — now excluded by an
   attribute check (attribute, not `el.tabIndex`, so contenteditable
   regions without the attribute stay stops).
2. `visibility: collapse` (treated as hidden on non-table elements) is
   excluded alongside `visibility: hidden`.
3. Visibility is now judged on the element's OWN computed value only —
   computed visibility already resolves inheritance and overrides, so a
   `visibility:visible` child inside a hidden ancestor is correctly a
   stop; the ancestor walk now covers only `display:none`/`hidden`, which
   cannot be overridden.
Final Sheet suites after the delta: 20/20.
