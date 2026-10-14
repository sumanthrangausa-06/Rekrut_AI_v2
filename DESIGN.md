---
name: Rekrut AI
description: "Design system for Rekrut AI — AI-Powered Career Companion. Extracted from the client as implemented (origin/dev @ c15c8dfa, 2026-10-14). Frontmatter is normative; prose contextualises and never re-asserts a different value. Anything not yet true is marked TARGET and listed in Appendix B."
colors:
  background: "hsl(0 0% 100%)"
  foreground: "hsl(222.2 84% 4.9%)"
  card: "hsl(0 0% 100%)"
  card-foreground: "hsl(222.2 84% 4.9%)"
  popover: "hsl(0 0% 100%)"
  popover-foreground: "hsl(222.2 84% 4.9%)"
  primary: "hsl(221.2 83.2% 53.3%)"
  primary-foreground: "hsl(210 40% 98%)"
  secondary: "hsl(210 40% 96.1%)"
  secondary-foreground: "hsl(222.2 47.4% 11.2%)"
  muted: "hsl(210 40% 96.1%)"
  muted-foreground: "hsl(215.4 16.3% 46.9%)"
  accent: "hsl(210 40% 96.1%)"
  accent-foreground: "hsl(222.2 47.4% 11.2%)"
  destructive: "hsl(0 84.2% 60.2%)"
  destructive-foreground: "hsl(210 40% 98%)"
  border: "hsl(214.3 31.8% 91.4%)"
  input: "hsl(214.3 31.8% 91.4%)"
  ring: "hsl(221.2 83.2% 53.3%)"
typography:
  sans: "Inter, system-ui, sans-serif"
  heading: "Space Grotesk, system-ui, sans-serif"
rounded:
  lg: "0.5rem (var(--radius))"
  md: "calc(var(--radius) - 2px)"
  sm: "calc(var(--radius) - 4px)"
spacing:
  scale: "Tailwind default 0.25rem scale; no overrides in tailwind.config.ts"
---

# Rekrut AI — Design System

This document describes the design system **as it is implemented** in the client
(`client/src`), extracted 2026-10-14 from `origin/dev @ c15c8dfa` by Nova
(implementation census), Aria (design language), and Quinn (verification),
coordinated by Lead under the impeccable `document` discipline.

**Reading rules**

- The YAML frontmatter above is the normative token layer. Body prose explains
  and evidences; it never overrides a frontmatter value.
- Statements describe the current product unless marked **TARGET**. Every
  TARGET is a decided canonical choice that the code does not yet meet; all of
  them are collected in Appendix B with evidence.
- Nothing in this file describes a design that does not exist without saying
  so. Where a pattern is verified, the verification was **code-level**
  (component source at `c15c8dfa`); rendered-screen verification of the
  auth-gated dashboards is still outstanding — see the Verification note at
  the end.

## Overview

**Product.** Rekrut AI — tagline **"AI-Powered Career Companion"**
(`client/index.html:39`). A two-sided hiring platform: a candidate dashboard,
a recruiter dashboard, an admin surface, and a public site (landing, pricing,
careers, legal). Both dashboards share one app shell (see Layout).

**Wordmark and mark.** The name renders **"Rekrut AI"** in every lockup
(sidebar `client/src/components/layout/sidebar.tsx:210`; landing
`client/src/pages/landing.tsx:267`). The mark is an "R + circuit nodes" SVG in
two drawings: the `Logo` component (`client/src/components/ui/logo.tsx`,
`viewBox 48`, sizes sm 24 / md 32 / lg 40 / xl 48 px, drawn in
`stroke="currentColor"` — the mark takes the surrounding text colour; there is
no brand-colour binding in the mark) and the favicon
(`client/public/favicon.svg`, `viewBox 64`, ground `#1e1b4b`). There is no
raster logo asset and no `client/src/assets/` directory. The social/OG image
is currently a hot-linked stock photo (`client/index.html:22`) — a gap, not a
brand asset (Appendix B).

**Creative North Star.** *Not set.* No north-star phrase has been confirmed by
the founder; this document deliberately does not invent one. Until it is set,
the Overview records characteristics only.

**Key characteristics**

- A shadcn-*style* token system (CSS variables → Tailwind mapping) with
  **hand-rolled primitives**: there is no `components.json`, no `@radix-ui/*`
  dependency, and no `tailwindcss-animate`. Primitives that upstream shadcn
  builds on Radix (Dialog, Sheet, Select, Tabs…) are custom implementations
  on native elements.
- Two typefaces: Inter (UI/body) and Space Grotesk (headings). Known gap,
  recorded honestly: both are on the impeccable detector's overused-font list
  — the current pairing carries no brand distinctiveness (Appendix B).
- Light + dark theming via a `dark` class strategy and the token set below;
  dark variants of token colours flip automatically, palette colours do not.
- One honest-data rule outranks aesthetics: **no fabricated scores or data
  rendered as real** (Appendix A). Where the product violates it today, that
  is documented as a defect, not a style.

## Colors

All colour in the token system is defined once, as HSL custom properties in
`client/src/index.css:6-52` (`:root` light, `.dark` dark), and mapped into
Tailwind in `client/tailwind.config.ts:10-43` — every Tailwind colour is
`hsl(var(--…))`; **no colour is hard-coded in the Tailwind config.**

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `0 0% 100%` | `222.2 84% 4.9%` | Page ground |
| `--foreground` | `222.2 84% 4.9%` | `210 40% 98%` | Primary text |
| `--card` | `0 0% 100%` | `222.2 84% 8%` | Card surface |
| `--card-foreground` | `222.2 84% 4.9%` | `210 40% 98%` | Card text |
| `--popover` | `0 0% 100%` | `222.2 84% 8%` | Popover surface |
| `--popover-foreground` | `222.2 84% 4.9%` | `210 40% 98%` | Popover text |
| `--primary` | `221.2 83.2% 53.3%` | `217.2 91.2% 59.8%` | Brand/action colour |
| `--primary-foreground` | `210 40% 98%` | `222.2 47.4% 11.2%` | Text on primary |
| `--secondary` | `210 40% 96.1%` | `217.2 32.6% 17.5%` | Secondary surface |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` | Text on secondary |
| `--muted` | `210 40% 96.1%` | `217.2 32.6% 17.5%` | Muted surface (shell ground is `bg-muted/30`) |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `215 20.2% 65.1%` | Secondary/meta text |
| `--accent` | `210 40% 96.1%` | `217.2 32.6% 17.5%` | Accent surface |
| `--accent-foreground` | `222.2 47.4% 11.2%` | `210 40% 98%` | Text on accent |
| `--destructive` | `0 84.2% 60.2%` | `0 62.8% 30.6%` | Destructive/error |
| `--destructive-foreground` | `210 40% 98%` | `210 40% 98%` | Text on destructive |
| `--border` | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%` | Borders (applied globally via `* { @apply border-border }`) |
| `--input` | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%` | Input borders |
| `--ring` | `221.2 83.2% 53.3%` | `224.3 76.3% 48%` | Focus ring (tracks `--primary` in light) |

That is the entire token set: 19 colour properties + `--radius`. There are no
chart, sidebar, shadow, or spacing tokens.

**Usage rules (as-is, verified)**

- Shells are primarily token-driven: `bg-background`, `bg-card`,
  `bg-muted/30`, `bg-primary/10 text-primary` for active nav
  (`layout/dashboard-layout.tsx:56,68,72`; `layout/sidebar.tsx:198,234-237`;
  `layout/header.tsx:121`).
- Status/semantic colour has **no token layer**. The shared `Badge` hard-codes
  its `success`/`warning` variants in palette values with no dark variant
  (`components/ui/badge.tsx:9-16`), and per-file status chips hand-write
  palette pairs plus a manual `dark:` twin (e.g.
  `components/candidate/JobCard.tsx:487,500`). Palette classes appear ~6,009
  times across 161 files; there are 736 hand-written `dark:` occurrences in 59
  files, largely because palette colours each need a manual dark twin while
  token colours flip for free.

**The named conflict — brand colour is authored three ways (defect, TARGET in
Appendix B).** The token says blue (`--primary`). Practice says indigo: 476
`indigo-` utility usages client-wide, the header premium CTA
(`layout/header.tsx:144,283`), the recruiter dashboard's primary button
(`pages/recruiter/dashboard.tsx:1002-1016`), public-page gradients
(`pages/landing.tsx:448-449,780-784`; `pages/recruiter/public-company.tsx:124-126,441-447`),
and the auth flow — the brand's front door — bypasses tokens entirely with the
literal `#4F46E5` (`pages/login.tsx:214,322`; `pages/register.tsx:394,502` +
more; the favicon ground `#1e1b4b` is a fourth, navy, statement). **TARGET:
tokens only.** New code uses token utilities; `indigo-*` utilities and hex
literals in class names are review-blocking; the favicon ground and the token
are reconciled to one documented decision.

## Typography

**Families.** Loaded once from Google Fonts (`client/index.html:36-38`):
**Inter** 400/500/600/700 → `font-sans` (UI and body); **Space Grotesk**
500/600/700 → `font-heading` (headings, wordmark, score numerals). Nothing
else is loaded. `font-mono` (60 uses) and `font-serif` (3 uses, both in
signature contexts — `pages/candidate/offers.tsx:467`,
`pages/candidate/onboarding.tsx:2962`) are used with **no family defined** and
fall back to Tailwind's default stacks — a gap (Appendix B).

**Scale.** Tailwind's default scale, unmodified (no `fontSize` in config).
What the product actually lives on, by occurrence: `text-sm` (1,967) and
`text-xs` (1,803) dominate — **body copy is `text-sm`; meta/secondary text is
`text-xs text-muted-foreground`**. Display sizes are rare: `text-2xl` 368,
`text-lg` 266, `text-xl` 131, `text-3xl` 84, `text-4xl` 42, `text-5xl` 15,
`text-6xl` 5, `text-7xl` 2 (landing hero only). Weights: `font-medium` 1,132,
`font-bold` 690, `font-semibold` 578. A sub-`xs` micro-type layer —
`text-[10px]`, 329 occurrences in 64 files — is invented per component for
chips, counts, and ring labels; treat 10px as a floor, never go below it, and
prefer `text-xs` for anything a user must read.

**Recipes (canonical, as implemented)**

| Use | Recipe | Evidence |
|---|---|---|
| App page H1 | `font-heading text-2xl sm:text-3xl font-bold tracking-tight` + one-line `text-muted-foreground` subhead, primary action right-aligned | `pages/recruiter/dashboard.tsx:1002`; candidate variant `text-2xl` without the `sm:` step at `pages/candidate/dashboard.tsx:250` |
| Card title | `font-heading text-lg font-semibold leading-none tracking-tight` | `components/ui/card.tsx:26` |
| Card description / meta | `text-sm text-muted-foreground` | `components/ui/card.tsx:37` |
| Stat/KPI number | `text-2xl font-bold` | `pages/candidate/dashboard.tsx:306`; `components/domain/chart-card.tsx:35-39` |
| Micro-label | `text-xs font-semibold uppercase tracking-wider` | recurring, 32 occ. |
| Landing hero H1 | `font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl` | `pages/landing.tsx:462` |
| Landing section H2 | `font-heading text-3xl font-bold tracking-tight sm:text-4xl` | repeated verbatim, `pages/landing.tsx` ×10 |

Semantic headings exist (`<h1>` 132, `<h2>` 173, `<h3>` 232) but are not
standardised per component; one known violation of the recipe is a
page-title-sized `<p>` competing with the real H1
(`pages/recruiter/dashboard.tsx:606`).

**Copy mechanics that live with type** (full voice rules in Appendix A):
loading and in-progress strings end with the Unicode ellipsis `…`, never
`...` — currently true only by accident in about half the product
(`components/QPBiometricConsent.tsx:105` vs `layout/dashboard-layout.tsx:52`);
buttons name their action and object ("Post New Job", not "Continue").

## Layout

### Shells

**One app shell serves both dashboards.** `DashboardLayout`
(`client/src/components/layout/dashboard-layout.tsx`): root
`flex h-dvh-safe overflow-hidden bg-background`; skip-to-content link
(`:57-62`); `Sidebar`; `Header`; `<main id="main-content">` on `bg-muted/30`
with stepped padding `p-3 sm:p-4 lg:p-6`; an in-shell footer. The shell is
mounted for `/candidate` (`client/src/App.tsx:618`), the recruiter tree, and
`/settings`. The AI chat FAB renders on candidate routes only
(`dashboard-layout.tsx:98`).

- **Sidebar** (`layout/sidebar.tsx`): off-canvas drawer below `lg`
  (`fixed w-[18rem] max-w-[calc(100vw-1.5rem)] -translate-x-full`, backdrop,
  Escape/route-change close), static `lg:w-64` at desktop. Items are
  `min-h-[44px]` `NavLink`s with 16px Lucide icons. **Candidate nav is
  grouped** into three titled sections (`OPPORTUNITIES`, `IMPROVE YOUR
  PROFILE`, `OTHER`, `sidebar.tsx:62-120`, with count/`NEW` badges);
  **recruiter nav is one flat 21-item list** (`sidebar.tsx:122-143`).
  Active-state styling currently diverges by role — recruiter:
  `rounded-lg bg-primary/10 text-primary`; candidate grouped items:
  `border-l-2 border-primary bg-primary/10` (a side-stripe; banned pattern,
  Appendix B TARGET: one active state, the rounded background treatment).
- **Header** (`layout/header.tsx`): `sticky top-0 z-30 h-16 bg-card/95
  backdrop-blur`, hamburger below `lg`, role badge, sort dropdown, Filters
  button (opens a `Sheet`), `ThemeToggle`, notification centre, avatar menu.
  The header duplicates nav links in its user dropdown and currently carries a
  **global** Sort/Filters pair on every page whether or not the page has
  sortable content — and its Filters sheet content is a placeholder string
  (dead control; Appendix B).
- **Content width:** the app shell sets **no max-width** — content is
  full-bleed unless a page wraps itself (`pages/candidate/profile.tsx:757`
  uses `max-w-7xl mx-auto`). Public pages cap at `max-w-7xl` (44 occ.),
  pricing at `max-w-6xl`. Three answers to "how wide is content" is a gap;
  TARGET is one documented cap per surface class (Appendix B).

**Public site — no shared shell exists.** Landing, about, contact, pricing,
blog, privacy, terms each re-define local `Header()`/`Footer()` functions
(`pages/landing.tsx:347,1508`; `pages/about.tsx:79,102`;
`pages/contact.tsx:28,51`; seven files contain a `<footer`). They converge
visually (sticky `bg-background/95 backdrop-blur`, Logo + wordmark, ghost nav)
but are independent implementations that drift; the careers and
public-company pages render **no site header/footer at all**, opening straight
into a company hero. **TARGET:** one shared public shell component, one footer
with a dynamic year and one legal line (today there are three footer
identities: `© 2026 Rekrut AI, Inc.` hard-coded in the app shell,
`© {year} Rekrut AI (formerly HireLoop)` on landing, a third variant on
terms).

**Admin — no shell, different visual world (defect).** Admin pages are
standalone behind `AdminAuthGuard` with no shared nav (the dashboard page is
the menu), and every page forces a dark slate gradient ground regardless of
the user's theme (`pages/admin/dashboard.tsx:191`
`bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900`;
`pages/admin/analytics.tsx:101,105` adds a gradient-text H1). Admin ignores
the tokens, the theme toggle, and the type system simultaneously. **TARGET:**
admin adopts the token system (Appendix B).

### Responsive

Breakpoints are **Tailwind defaults** — the config defines no `screens`:
`sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Practice is a two-step
ladder: `sm:` 1,184 uses, `lg:` 236, `md:` 98, `xl:` 11, `2xl:` 0. The
standing rule is that the whole application works on **phone, tablet, and
laptop**; today the tablet (`md`) step is thin and wide screens simply stretch
the `lg` layout.

Established responsive conventions (as-is, keep):

- Sidebar is a drawer below `lg`; header controls gate at `md:`/`sm:`
  (sort hidden below `md`, role badge `hidden sm:inline-flex`, user name
  `hidden md:block`).
- Dialogs become **bottom sheets** on mobile: `items-end sm:items-center`,
  `rounded-t-2xl sm:rounded-lg`, `max-h-[85dvh]`
  (`components/ui/dialog.tsx:49-54`). Sheets are `w-full sm:w-96`.
- Viewport height uses the dvh utilities `.h-dvh-safe` / `.min-h-dvh-safe`
  (`index.css:82-91`; `100vh` → `-webkit-fill-available` → `100dvh`) — legacy
  `h-screen`/`min-h-screen` still appear 56 times and should not be added to.
- Tables shed columns (`hidden sm:table-cell` / `hidden md:table-cell`) or
  scroll (`overflow-x-auto`, 22 files); `TabsList` scrolls horizontally with
  `.scrollbar-hide`.
- Touch targets: `min-h-[44px]` appears 455 times (69 files) — a real
  convention, but **hand-applied per element**, not guaranteed by components
  (see Accessibility, Appendix C). Arbitrary fixed widths are the known
  overflow risk: 88 `min-w-[…]` occurrences include `min-w-[360px]`.

### Spacing

Tailwind's default 0.25rem scale, unmodified — and genuinely on-scale:
arbitrary spacing values (`p-[…]`, `gap-[…]`) number **zero** in the client.
Dominant steps: 2, 4, 3, 1, 6, 1.5, 8. Card padding is the one soft spot:
`CardContent` defaults to `p-6 pt-0` but dashboards routinely override to
`p-4`/`p-5` — acceptable variation inside cards, not a second scale.

## Elevation & Depth

There are **no shadow tokens**. Elevation is chosen per component from
Tailwind's default scale: `shadow-sm` 130 uses, `shadow-lg` 63, `shadow-md`
44, `shadow-xl` 7, `shadow-2xl` 7, `shadow-inner` 2, plus 7 arbitrary
`shadow-[…]`. The defaults that do exist: `Card` is `shadow-sm`
(`components/ui/card.tsx:8`); dropdowns pick `shadow-lg`
(`layout/header.tsx:170`); the mobile sidebar picks `shadow-2xl`
(`layout/sidebar.tsx:198`). Gradients act as a second, un-tokenised depth
device — 101 `bg-gradient-to-*` occurrences in 40 files, most often
indigo/violet/purple stops.

**Rule (grounded in the incumbent system): declare elevation once — border
*or* shadow, never a wide soft shadow floated on a thin border (the
"ghost card").** Cards sit on the documented card surface with `shadow-sm`;
overlays take one step up. New gradient use outside a documented brand
moment is not permitted (see Do's and Don'ts).

## Shapes

Radius derives from a single token, `--radius: 0.5rem`
(`client/src/index.css:26`), mapped in config: `rounded-lg` =
`var(--radius)`, `rounded-md` = −2px, `rounded-sm` = −4px
(`client/tailwind.config.ts:44-48`). Usage: `rounded-lg` 782, `rounded-full`
554 (chips, avatars, rings, switches), `rounded-md` 159, `rounded-xl` 121,
`rounded-2xl` 27, `rounded-3xl` 6, `rounded-sm` 3.

Known drift: the `Card` itself uses `rounded-xl` (`components/ui/card.tsx:8`)
— a fixed Tailwind step that does **not** follow `--radius` — and
`rounded-2xl`/`rounded-3xl` appear ad hoc (dialog mobile sheet
`rounded-t-2xl`, empty-state icon tile `rounded-2xl`). **TARGET:** card radius
reconciles to the `--radius` scale; `2xl`/`3xl` are reserved for the mobile
dialog sheet and large media, not general surfaces.

## Components

The library lives in two layers: `client/src/components/ui/*` (22
primitives) and `client/src/components/domain/*` (24 composites). Primitives
are hand-rolled shadcn-style components (cva + `cn()`), **not** Radix — plan
behaviour (focus, portals, dismissal) accordingly; several gaps below exist
precisely because no Radix primitive supplies them.

### Button — `components/ui/button.tsx`
Variants: `default, destructive, outline, secondary, ghost, link`. Sizes:
`default h-10 px-4`, `sm h-9`, `lg h-11 px-8`, `icon h-10 w-10`. Focus ring is
correct (`focus-visible:ring-2 ring-ring ring-offset-2`). **Gap:** only `lg`
meets the 44px touch floor — `default` is 40px, `sm` 36px (Appendix C);
consumers currently patch with `min-h-[44px]` by hand. TARGET: the 44px
minimum is built into the component.

### Card — `components/ui/card.tsx`
`rounded-xl border bg-card text-card-foreground shadow-sm`; `CardHeader`
`space-y-1.5 p-6`, `CardTitle` per the Typography recipe, `CardContent` /
`CardFooter` `p-6 pt-0`. The most-used surface in the product (`<Card` 2,206
occurrences in 141 files). There is **no canonical KPI/stat card**: the
`ChartCard` composite exists (`components/domain/chart-card.tsx`) yet both
dashboards hand-build stat cards — the candidate dashboard's four
coloured-icon-tile cards (`bg-blue-100`/`bg-green-100`/`bg-purple-100`/
`bg-amber-100` tiles, `pages/candidate/dashboard.tsx:312-380`) are the
icon-tile-stack anti-pattern (Do's and Don'ts). TARGET: one stat-card
composite on token surfaces.

### Badge & status chips — `components/ui/badge.tsx`
Variants: `default, secondary, destructive, outline, success, warning`
(`success`/`warning` are hard-coded palette values with no dark variant).
Sampled usage: `outline` 270, `secondary` 113, `destructive` 23, `success`
20, `default` 8, `warning` 6 — the semantic variants are barely used; the
de-facto status chip is a hand-rolled palette pair + dark twin per file, so
the same status renders emerald in one file, green in another, a Badge
variant in a third. **TARGET:** status is expressed through Badge variants
(tokenised, dark-aware); new hand-rolled status colour pairs are
review-blocking.

### Forms
The recipe: `<div className="space-y-2"><Label htmlFor>…</Label><Input id …/></div>`
inside `form className="space-y-5"` (`<Label` 312 uses vs native `<label`
63). `Input`/`Textarea` share one shape: `h-10`/`min-h-[80px]`, `rounded-md
border border-input bg-transparent px-3 shadow-sm`, `focus-visible:ring-1
ring-ring`. Form-level errors use one banner recipe:
`rounded-lg bg-destructive/10 p-3 text-sm text-destructive` + `AlertCircle`.
**Field-level validation display has no system:** `aria-invalid` occurs
**0 times** in the client; error colouring is ad-hoc `text-red-500/600` and
`border-red-*` (359 occurrences) competing with `text-destructive` (117).
Native elements bypass the primitives routinely (raw `<button` 230, `<input`
46, `<select` 45 in 18 files). TARGET: one field-error pattern
(`aria-invalid` + `text-destructive` message under the field); primitives
first, native elements need a stated reason.

### Tables & lists
`components/ui/table.tsx` provides `Table/Header/Body/Row/Head/Cell` (head
`h-12 px-4 font-medium text-muted-foreground`; row `border-b hover:bg-muted/50`;
cell `p-4`). It is imported by only 5 files — nearly all of them
compliance/admin. The generic `DataTable` composite
(`components/domain/data-table.tsx`: search, sort, pagination at pageSize 10,
`emptyState` prop) has **zero consumers** — it is dead code today. Everywhere
else, tabular data is card/div lists or raw `<table>` markup (11 page files).
**TARGET:** `DataTable` (or its successor) is the canonical list pattern;
raw `<table>` in a page is a review flag. Documenting tables as "solved"
would be false — this is the least standardised pattern in the product.

### Dialogs & sheets
`components/ui/dialog.tsx` is the primary dialog: 31 importing files. Its
mobile form is a genuine pattern (bottom sheet, §Layout). Hand-rolled
`fixed inset-0` overlays bypass it in 10 files, and its own panel markup is
copy-pasted inside `pages/candidate/profile.tsx:2630,2876`. **Accessibility
gap (high):** the shared Dialog and Sheet have **no dialog semantics** — no
`role="dialog"`, `aria-modal`, labelling, Escape-to-close, or focus
trap/return — and both close buttons are icon-only with **no `aria-label`**
(`components/ui/dialog.tsx:59-64`; `components/ui/sheet.tsx:70-82`). There is
no confirmation primitive: `window.confirm(` is used in 10 files. TARGET
(Appendix B/C): an accessible shared dialog + an `AlertDialog`-style confirm;
hand-rolled modals migrate onto it.

### Empty states
Canonical: `components/domain/empty-state.tsx` — icon in a `bg-muted`
`rounded-2xl` tile (`h-16 w-16`), `font-semibold text-lg` title,
`text-sm text-muted-foreground max-w-sm` description, optional image and
action. Imported by 35 files and genuinely the most-used pattern — but the
three highest-traffic list screens bypass it with three different ad-hoc Card
patterns (candidate applications `pages/candidate/applications.tsx:333-344`;
recruiter applications `pages/recruiter/applications.tsx:431-447`; recruiter
jobs `pages/recruiter/jobs.tsx:296-318`, whose CTA hard-codes
`bg-indigo-600`), and two pages re-implement the component locally with
incompatible props (`pages/candidate/jobs.tsx:1208`;
`pages/recruiter/dashboard.tsx:669`). A bare `'No data found'` fallback also
survives in `components/domain/data-table.tsx:172`. **Rule:** the shared
`EmptyState` is the default everywhere; it is documented as *primary*, never
as *only*, until the bypasses are migrated (TARGET).

### Loading
Two components named `Skeleton` with incompatible APIs:
`components/domain/skeleton.tsx` (`variant: 'card'|'list'|'table'|'text'|'avatar'`)
— 34 importers — and `components/ui/skeleton.tsx` (className-based, plus
`PageLoading`, `RouteLoading`, `DataLoading` helpers) — 8 importers. Ad-hoc
spinners are everywhere (`animate-spin` 259 occurrences; Lucide `Loader2` in
71 files). **TARGET:** `components/domain/skeleton.tsx` is canonical; the ui
composites port into it and the ui file is deleted. Note the dead animation
vocabulary below before reaching for motion classes.

### Motion
There is **no animation system**: `tailwind.config.ts` has `plugins: []`,
`tailwindcss-animate` is not a dependency, and there are **zero `@keyframes`
in the client**. Working motion is Tailwind defaults only (`animate-spin`,
`animate-pulse`, `animate-bounce`, `animate-ping`; `transition-colors` 219,
`transition-all` 140). The classes `animate-in`, `slide-in-from-*`,
`fade-in`, `zoom-in` are used in ~17 files — including the Sheet's entry
animations (`components/ui/sheet.tsx:31-34`) — and are **all no-ops today**.
`RouteLoading` references an undefined `progress` keyframe. Do not document,
use, or rely on these classes until an animation plugin/keyframes land as a
deliberate change (TARGET). Vercel guideline: never `transition: all` —
specify properties (140 current uses are legacy, not licence).

### Score rings — the product's signature component, currently four of them
| Implementation | Scale | Colour | Used by |
|---|---|---|---|
| `components/domain/score-ring.tsx` (`ScoreRing`) | 0–100 | hex thresholds ≥80 green / ≥60 amber / else red | Match scores in both job cards, job-detail drawer |
| `components/domain/omniscore-ring.tsx` (`OmniScoreRing`) | 0–1000 | hex ladder ≥900 `#f59e0b` … else `#64748b` | One file: `pages/candidate/profile.tsx` |
| Local `ScoreRing`, `pages/candidate/omniscore.tsx:156` | **300–850** | gradient `#10b981→#06b6d4` | Candidate OmniScore page |
| Local `ScoreRing`, `pages/recruiter/omniscore.tsx:104` | 0–1000 | gradient `#8b5cf6→#06b6d4` | Recruiter Trust Score page |

Plus one-off inline rings in five more files (9 files contain
`strokeDasharray` logic). The shared `omniscore-ring.tsx` requires
`score: number` (non-nullable) and always renders the number — it **cannot
represent the no-data state**. **TARGET: one ring component; the score scale
is declared in its props and nowhere else; the component takes
`score: number | null` and renders the honest state (Appendix A) for null.**
Page-local ring redefinitions are banned. Until then, DESIGN.md documents
four rings, because four rings is the truth.

### Logo — `components/ui/logo.tsx`
Inline SVG, `stroke="currentColor"`, sizes 24/32/40/48. Lockup: Logo +
`<span className="font-heading font-bold">Rekrut AI</span>` (sidebar
`text-lg`, public headers `text-xl`). Do not redraw, recolour, or substitute
the mark; the favicon is a separate drawing (Overview) pending reconciliation.

### Toasts / notifications
**There is no toast system** — no component, no library. Six files paste the
same toast container verbatim; ≥10 files implement local `showToast` state
with three placements and two colour schemes; `window.alert(` is the fallback
in ~21 files. TARGET: one tokenised toast component; `window.alert` /
`window.confirm` are review-blocking in new code.

### Icons
**Lucide (`lucide-react`) is the icon system** (174 files import it). Escape
hatches to avoid in new code: inline `<svg>` (19 files — brand logos and the
Logo excepted), a literal `▼` glyph as the Select chevron
(`components/ui/select.tsx:78`), emoji/glyph characters as UI iconography
(~101 occurrences: ✨ 👋 🎉 ⚠ …, see Appendix A), and text arrows (`→`, 73
occurrences) inside links.

## Do's and Don'ts

**Do**

- **Do** take every colour from the token set (`bg-primary`, `text-muted-foreground`, …) so light/dark flips for free.
- **Do** build on the shared primitives in `components/ui/` and composites in `components/domain/` — and extend the shared one instead of forking it.
- **Do** render the honest state when data is absent: "Insufficient data", "N/A", or the shared `EmptyState` (Appendix A).
- **Do** use the shared `EmptyState`, `Dialog`, and `DataTable` composites for lists, modals, and tabular data.
- **Do** keep interactive targets ≥44px (`min-h-[44px]`), keep `focus-visible` rings on anything focusable, and label icon-only buttons.
- **Do** write loading copy with `…` and buttons that name their action + object.
- **Do** use Lucide icons. One icon system.
- **Do** design phone-first against the responsive conventions in Layout (drawer nav, bottom-sheet dialogs, dvh-safe heights) — the app must work on phone, tablet, and laptop.

**Don't**

- **Don't render fabricated data as real** — no mock arrays presented as live data, no invented testimonials/logos/statistics, no placeholder or fallback scores (`|| 75`, `?? 0` on a score). This is the product's highest-severity design defect class; see Appendix A for the surfaces where it still occurs.
- **Don't ship a control that does nothing** — no `href="#"`, no empty `onClick={() => {}}`, no "will be wired here" placeholders, no `window.alert`/`window.confirm` as the interaction.
- **Don't hard-code colour** — no `indigo-*`/`purple-*`/`slate-*` utilities or hex literals in class names to express brand/status colour; no new gradients as decoration; no gradient text.
- **Don't use a side-stripe** (thick coloured border on one edge of a card/nav item) for active or alert states — use background + colour.
- **Don't fork a shared pattern** — no second Skeleton, JobCard, ring, empty state, toast, or editor for an entity that already has one. A second view of the same entity ships as a redirect or not at all (the healthy precedent: `pages/recruiter/job-create.tsx` is a 9-line redirect to the single job form).
- **Don't define a local `Header()`/`Footer()`** on a new public page, and don't build a page shell that ignores the token system (the admin slate-gradient pattern is a defect to migrate, not a template).
- **Don't use emoji or glyphs as iconography** in UI chrome (✨ 👋 🎉 ▼ →) — content a user typed is the only exception.
- **Don't rely on `animate-in`/`slide-in-*`/`fade-in` classes** — they are no-ops today (Motion, above).
- **Don't use `transition: all`** — specify the properties that change.
- **Don't go below `text-[10px]`**, and don't use 10px for anything a user must read.

## Appendix A — Voice & Honesty in UI Copy

*(Project extension — copy is not visual, so it rides after the canonical
sections rather than displacing one.)*

### Voice as observed
Second person, warm, contraction-heavy in both dashboards ("Welcome back,
{first name} 👋" — `pages/candidate/dashboard.tsx:250-254`; recruiter twin at
`pages/recruiter/dashboard.tsx:1002-1008`). Public voice is benefit-led and
fragment-friendly ("Match with jobs that fit your skills. Practice interviews
with AI. Get hired faster — no spam, no noise." — `pages/landing.tsx:466-469`).
Buttons mostly name the action (see Typography). **Consent copy is the best
voice in the product** and is the model: one consent type per screen, never
bundled (`pages/consent-screens.tsx:11-13`); the accept button states what is
consented to in the first person ("I consent to video analysis" —
`components/QPBiometricConsent.tsx:181`); decline is a real, neutral path
with the alternative named ("Decline and use text mode", `:189`); version +
effective date are shown (`:162`); withdrawal is stated at the moment of
consent (`pages/consent-screens.tsx:429`); error copy names the problem and
the recovery ("Something went wrong recording your consent. Please try
again." — `QPBiometricConsent.tsx:80`).

### Standing honesty rules — design law
1. **No fabricated scores or data rendered as real.** The honest pattern
   exists and is regression-tested: "Insufficient data" on the candidate
   OmniScore page (`pages/candidate/omniscore.tsx:425`), the profile ring
   (`pages/candidate/profile.tsx:1169`), the canonical sentence
   `INSUFFICIENT_DATA_COPY = 'Insufficient data to report this section.'`
   (`components/domain/ObserverAnalysis.tsx:72-75`), and the test suite that
   names the sins it prevents — "instead of the fabricated fallbacks
   75 / 300 / 500 / 100%" (`client/src/__tests__/pages/FabricatedScoreFallbacks.test.tsx:11-13`).
2. **Absent data shows "Insufficient data" / "N/A" / an honest empty state**
   — never a plausible-looking number, average, or `|| <number>` fallback.
3. **Consent copy clarity** as modelled above; no consent screen may promise
   analysis the consent does not cover.
4. **No invented social proof** — testimonials, counts, logos, ratings,
   statistics, and certification claims require a real source or do not
   render.

### Where the law is currently broken (defects, not style)
- The recruiter compliance page is built on in-file mock arrays — bias
  metrics, consent records with candidate names and IP addresses, AI
  decisions — under a literal `// ─── Mock Data ───` header
  (`pages/recruiter/compliance.tsx:39` ff.), presented as real compliance data.
- `pages/recruiter-profile.tsx` is a fake editor wired as the real
  `/recruiter/profile` route: invented company data ("TechCorp Solutions",
  rating 4.8, 127 reviews — `:44-66`) on a dark glass page in no shell, whose
  Save writes only to local state.
- Landing invents testimonials, a "trusted by" logo bar, and hero statistics
  ("50K+ Active candidates / 94% Interview success rate" —
  `pages/landing.tsx:165-213`); login claims "Trusted by 2,000+ companies" +
  "SOC 2 Type II compliant · GDPR ready" above an in-code TODO admitting the
  proof is placeholder (`pages/login.tsx:300-307`).
- The standalone Trust Score page renders a missing V2 score as a real **0**
  (`pages/recruiter-trustscore.tsx:399`, `?? 0`) and has no null path for its
  hero number (`:295`) — the #836 honest-state fixes cover five named
  surfaces (candidate OmniScore, recruiter OmniScore, candidate profile
  ring, public careers, assessment results), **not** score displays as a
  class. Do not generalise them.

Terminology rulings: the paid tier is **"Pro"** (the name on the pricing
page, `pages/pricing.tsx:189-190`) — the header's "Premium"
(`layout/header.tsx:139-147,283`) is the outlier to fix. The recruiter score
surface is labelled just "Scores" in nav (`layout/sidebar.tsx:122-143`) vs
"OmniScore" for candidates — one naming scheme is a TARGET decision, not yet
made.

## Appendix B — Known Gaps & Target Conventions

Every TARGET in this document, consolidated. Each row: the inconsistency,
the canonical choice, and the evidence. Nothing here is current fact.

| # | Gap | Canonical target | Evidence |
|---|---|---|---|
| B1 | Four score rings, three scales; shared ring can't render no-data | One ring; scale in props only; `score: number \| null` with honest null state | Components §Score rings; Quinn S1 |
| B2 | Honest score states cover 5 surfaces, not all | Honest states on every score surface (standalone TrustScore page first) | Appendix A; `pages/recruiter-trustscore.tsx:295,399` |
| B3 | Brand colour authored 3 ways (token / indigo / `#4F46E5` literals) | Tokens only; indigo utilities + hex literals review-blocking; favicon reconciled to the token decision | Colors; 476 `indigo-` uses; `pages/register.tsx` ×12 `#4F46E5` |
| B4 | Dialog/Sheet lack dialog semantics; unlabelled close; hand-rolled modals; `window.confirm` ×10 | Accessible shared Dialog (role/aria-modal/labelled close/Escape/focus) + confirm primitive; migrate bypasses | Components §Dialogs; Quinn S3 |
| B5 | Two Skeletons, incompatible APIs (34 vs 8 importers) | `components/domain/skeleton.tsx`; port ui composites, delete ui file | Components §Loading |
| B6 | Two forked JobCards (711 vs 311 lines, `id: number` vs `id: string`) | One JobCard in `components/domain/` | `components/candidate/JobCard.tsx`; `components/domain/job-card.tsx` |
| B7 | Three company-profile surfaces (real editor, fake editor, two public views) | Editor = `pages/recruiter/company.tsx`; one public company surface | Appendix A; Aria §5.4 |
| B8 | Seven local public Header/Footer copies; three footer legal lines; app footer links are `href="#"` | One shared public shell; one footer (dynamic year, one legal name); real routes | Layout §Public; `layout/dashboard-layout.tsx:77,83,89` |
| B9 | Admin slate-gradient shell ignores tokens/theme/type | Admin on the token system (DashboardLayout with admin nav, or a token-only documented variant) | Layout §Admin; `pages/admin/dashboard.tsx:191` |
| B10 | Animation vocabulary is dead (`animate-in` etc. are no-ops; no keyframes) | Land plugin/keyframes as one deliberate change, or strip the classes | Components §Motion |
| B11 | No toast system (6 pasted copies, ≥10 local impls, `window.alert` ~21 files) | One tokenised toast component | Components §Toasts |
| B12 | `DataTable` has zero consumers; raw `<table>` in 11 pages | `DataTable` (or successor) canonical for tabular data | Components §Tables |
| B13 | Empty state bypassed on the 3 key list screens; 2 local re-implementations | Shared `EmptyState` everywhere; delete local copies | Components §Empty states; Quinn S6 |
| B14 | Status colour re-invented per file; Badge semantic variants bypassed | Tokenised Badge variants for status | Components §Badge; Nova S15 |
| B15 | Field-level validation has no system (`aria-invalid` = 0) | One field-error pattern with `aria-invalid` + destructive message | Components §Forms |
| B16 | Elevation has no vocabulary (per-component shadow picks; decorative gradients) | Declared elevation steps; border *or* shadow; gradients only as documented brand use | Elevation & Depth |
| B17 | Card radius `rounded-xl` doesn't follow `--radius`; 2xl/3xl ad hoc | Cards on the `--radius` scale; 2xl/3xl reserved per Shapes | Shapes |
| B18 | Duplicate theme state (two `useTheme` writers, one storage key, opposite icon conventions) | `contexts/theme-context.tsx` only | `contexts/theme-context.tsx`; `components/ui/theme-toggle.tsx:7` |
| B19 | `font-mono`/`font-serif` used with no families defined | Define or stop using | Typography |
| B20 | OG/social image is a hot-linked stock photo; no brand asset set | Real brand assets (mark, OG image) in-repo | Overview; `client/index.html:22` |
| B21 | Type pairing (Inter + Space Grotesk) is on the detector's overused-font list | Recorded known gap; any future rebrand decides with this on the table | Overview |
| B22 | Paid tier named "Pro" and "Premium" | "Pro" everywhere | Appendix A |
| B23 | Candidate nav active state is a side-stripe (banned pattern) | Rounded background treatment (the recruiter pattern) for both roles | Layout §Shells; `layout/sidebar.tsx:287` |
| B24 | Header carries global Sort/Filters on every page; Filters sheet is a dead placeholder | Page-scoped sort/filter only where content supports it; no dead controls | Layout §Shells; `layout/header.tsx:155-215,362` |

## Appendix C — Accessibility Floor

The floor every screen must meet (Vercel Web Interface Guidelines snapshot,
pinned in the skill map, applied to what this codebase does today).

**Already true (verified in code):** `focus-visible` rings on Button, Input,
Select, Textarea, Switch (`components/ui/button.tsx:6` and siblings);
skip-to-content link (`layout/dashboard-layout.tsx:57-62`); 44px targets on
primary navigation (sidebar links and header/sidebar controls,
`layout/sidebar.tsx:234`, `layout/header.tsx:126,211`); labelled icon-only
buttons in the header/sidebar chrome (`aria-label` "Open navigation menu",
"Close navigation menu"); sidebar drawer closes on Escape and route change.

**The floor (rules for all new and touched code):**
- Contrast: text and interactive elements meet WCAG AA against their actual
  background — token pairs (`--foreground` on `--background`, `*-foreground`
  on its surface) are the pre-approved combinations; palette-on-palette chips
  must be checked individually (they are the current risk area).
- Focus: every focusable element shows a visible `focus-visible` style —
  ring utilities from the primitives, never `outline-none` without a
  replacement. **Current gap:** sidebar `NavLink`s carry no focus styling and
  `index.css` defines no global `:focus-visible` fallback
  (`layout/sidebar.tsx:232-239`); tabs triggers remove the outline at 36px
  height (`components/ui/tabs.tsx:62`).
- Touch targets: ≥44px on touch surfaces. **Current gap:** the shared Button
  meets it only at `lg` (default 40px, `sm` 36px, `icon` 40px —
  `components/ui/button.tsx:19-22`); until B-target lands, call sites must
  add `min-h-[44px]`.
- Icon-only buttons always carry an `aria-label`. **Current failures are in
  the shared layer itself:** Dialog close (`components/ui/dialog.tsx:59-64`)
  and Sheet close (`components/ui/sheet.tsx:73-81`).
- Dialogs must be dialogs: `role="dialog"`, `aria-modal`, a label, Escape to
  close, focus moved in on open and returned on close (B4).
- Forms: every input has a label (`htmlFor`/`id`), correct `type` and
  `autocomplete`, and errors exposed with `aria-invalid` + a described
  message (B15).
- Never rely on colour alone for status; never use emoji as the sole carrier
  of meaning.

## Verification note (Quinn, 2026-10-14)

Every load-bearing claim in this document was checked against the component
source at `origin/dev @ c15c8dfa` (which component renders, which tokens it
consumes) — **code-verified**. A rendered-screen pass was attempted against
the public staging root (URL from `render.yaml`) and timed out upstream; the
auth-gated dashboards cannot be render-checked without a signed-in session.
**This document is therefore not render-verified.** The doc-vs-code mismatches
found are ranked: **S1** one-ring claim false (B1) · **S2** honest score
states not system-wide (B2) · **S3** shared Dialog/Sheet not accessible
dialogs (B4) · **S4** tokens real but not exclusive (B3) · **S5** no shared
header/footer (B8) · **S6** empty state is a family, not a pattern (B13) ·
**S7** 44px is a per-call-site patch, not a component guarantee (App. C) ·
**S8** focus-visible coverage stops at the primitives (App. C). All eight are
written above as gaps/targets, never as current fact. A rendered-screen
verification pass (local build or staging session) remains an open follow-up.

---

*Owners for keeping this file true: Aria (design language), Nova
(implementation census), Quinn (verification), Lead (assembly). Update the
frontmatter first when a token changes; update Appendix B when a target
lands — a target that ships moves into the body as as-is, with its evidence.*
