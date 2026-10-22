# PRD — Job Board & Profile: Working Filters, One Profile-Completion Truth, Working Profile Menu & Avatar

**Author:** Aria (Phase 2 — Planning) · **Date:** 2026-10-21 · **Status:** At Suga's review gate (docs PR, not yet merged)
**Issues covered:** #1600, #1601, #1607, #1608
**Rule basis:** Documentation-first (Sumanth, restored 2026-10-21; HL-006) — this PRD precedes any build on these issues. Acceptance criteria are written as user-journey tests (Sumanth's user-perspective rule, 2026-10-21).
**Companion docs:** `02-planning/full-application/prds/prd-m03-jobs-careers.md`, `prd-m04-candidates-profiles.md`; PRD 1 of this batch: `prd-assessments-module.md`.

> **Grounding note.** Every "current state" claim below was verified by reading the code on `origin/dev` at 50cc828be on 2026-10-21. Sumanth filed these issues from **staging**, which runs an older build — where dev and staging may differ, the PRD says so and assigns the staging check as a verification item. Anything not verified is marked ⚠ **Unverified**.

---

## 1. Executive summary

Four candidate-facing defects, one theme: **surfaces that look finished but are not connected to the real thing.** The header's Filters button opens a panel that literally says "Filter options will be wired here" (#1600). The job pages announce "Your profile is 0% complete" to candidates whose profiles are complete, because that surface reads a field that does not exist (#1601). The profile dropdown and avatar behaviour Sumanth tested does not match what he expects — a My Profile path and the uploaded picture, everywhere, in sync (#1607, #1608).

The fix principle for the whole batch: **one source of truth per fact, consumed by every surface** — one filter behaviour for the Job Board, one profile-completion calculation, one avatar value — so the pages can never disagree again.

## 2. Problem statement

**Who:** Candidates browsing jobs and managing their profile — the two most-visited candidate surfaces.

**What is broken (verified in code, §4):**

1. **Dead filters (#1600).** The global header's **Filters** button opens a sheet whose entire content is the placeholder text "Filter options will be wired here." A second, working filter implementation exists inside the Job Board page itself — so the product has two filter doors, one of which is a wall.
2. **0% completion (#1601).** The job-detail surface computes profile completeness by reading `profile.completeness` from `GET /candidate/profile` — a field that endpoint never returns (it returns the raw profile row; no `completeness` is computed or stored on it). The expression falls back to `|| 0`, so **every** candidate is told 0%, and the one-click-apply gate that depends on the same value (≥ 80%) can never open from this path. Meanwhile the Profile page and the Dashboard compute the real percentage from the shared 12-field formula — three surfaces, two truths, one of them always 0.
3. **Profile menu (#1607).** On current dev code, the header dropdown *does* contain a "My Profile" item and a clickable name/avatar block — the premise does not reproduce in this component on dev. It presumably reproduces where Sumanth tested (staging's older build) or on a surface not yet audited (e.g. mobile navigation). The requirement below stands regardless: the behaviour must be verified on **every** navigation surface and environment, and fixed wherever absent.
4. **Avatar not shown (#1608).** The profile-page photo upload writes the picture to both `candidate_profiles.photo_url` and `users.avatar_url` (correct), but the page updates only its own local state — the header keeps reading the auth session's stale `avatar_url` until a refresh/re-login. A second, divergent upload path (Settings) writes **only** `candidate_profiles.photo_url` — as a base64 data URL — and never updates `users.avatar_url`, so a picture uploaded there can *never* appear in the header, which reads `users.avatar_url`. Two write paths, two different truths, one reader.

**Why it matters:** these are first-impression surfaces. A candidate told their complete profile is "0% complete", facing a Filters button that opens an apology, is being trained not to trust the product — on the exact pages the launch depends on.

## 3. Target users

- **Primary:** Candidate browsing the Job Board (search/filter → job detail → apply) and managing their profile.
- **Secondary:** Recruiter, only in that the shared header component renders for both roles — recruiter behaviour must not regress (§9).

## 4. Current state (verified on dev @ 50cc828be)

### 4.1 Filters (#1600)

- `client/src/components/layout/header.tsx` — the Header renders a **Filters** button (desktop, ~L209) that opens a `Sheet` whose content is exactly `<p>Filter options will be wired here.</p>` (~L356-366). The Header is global (rendered by `client/src/components/layout/dashboard-layout.tsx` on candidate and recruiter pages), and the sheet's open state is local to the Header — it is connected to **nothing**: no page state, no query, no results.
- The Job Board page itself, `client/src/pages/candidate/jobs.tsx`, has a **real** filter model: `FilterState` (search, type, location, remoteType, experienceLevel, salaryMin/salaryMax, skills, companySize, sortBy, remoteOnly, matchPreferences) serialised to query params on `GET /candidate/jobs` (e.g. `type`, `remote_type`, `experience_level`, `salary_min/max`, `skills`), with clear-filters resetting to `DEFAULT_FILTERS`. ⚠ How completely the page renders controls for every field, and whether the server honours every parameter, was not fully verified — that field-by-field check is part of the build's STOP 1.
- A third filter UI exists on `client/src/pages/candidate/ai-search.tsx` (location / job type / remote / experience + Apply) — evidence the product grew three filter surfaces independently.
- Note the adjacent honesty defect in the same component: the header **Sort** dropdown dispatches a `job-sort-change` event with an in-code comment `ponytail: UI-only for now; backend wiring in follow-up`. Sort is **not** part of this batch's issues; it is recorded here so the build does not mistake the header for a wired surface (follow-up candidate for Lead's backlog, §11).

### 4.2 Profile completion (#1601)

- **The canonical calculation exists.** `client/src/lib/profile-completion.ts`: 12 equally-weighted fields (name, headline, bio, location, LinkedIn-or-GitHub, resume, ≥1 skill, ≥1 experience, ≥1 education, phone, years_experience, avatar). Its header comment already states the rule: *"Both surfaces MUST show the same percentage — do not duplicate this logic."*
- **Profile page** uses it directly (`client/src/pages/candidate/profile.tsx`, ~L735), including `getMissingProfileSections` for the nudge.
- **Dashboard** consumes the server mirror: `GET /candidate/dashboard/stats` (`routes/candidate.js:3698`) computes the same 12 fields from the `v_candidate_full_profile` view and returns `stats.profile_completeness` + `stats.missing_sections`; `client/src/pages/candidate/dashboard.tsx` renders them (L225, L264-279).
- **Job detail is the outlier:** `client/src/pages/candidate/job-detail.tsx` keeps its own `profileCompleteness` state (L178) set from `data.profile?.completeness || 0` (L313) after `GET /candidate/profile`. That endpoint (`routes/candidate.js:241`) returns the raw joined profile row — there is **no `completeness` field** in the response and no such computed value on the row (the only `completeness_score` column in migrations belongs to an unrelated AI-onboarding table, migration 044). Result: always 0. The same value gates one-click apply (`canOneClick = profileCompleteness >= 80`, L726) and drives the "Your profile is N% complete" banner (L1101-1115).
- **Correction (Rex review, 2026-10-21) — the local `profileCompletion` description:** where a local `profileCompletion` value is described for the Job Board, it reads the local candidate object populated by `GET /auth/me` (`users.full_name` etc.), not `candidates.full_name` directly; and its skills component is `Math.min(skills.length * 10, 30)` — 10 points per skill, capped at 30 — not a flat 10. This correction does not change the verified #1601 root cause above: the page only sets candidate state in `fetchProfile`'s narrow branch (job detail reads `data.profile?.completeness || 0`, a field that is never returned), so the Job Board still shows 0%.
- ⚠ Whether other surfaces compute their own variant was not exhaustively audited — FR-P2 requires a sweep of every `completeness` consumer, not just the known three.

### 4.3 Profile dropdown (#1607)

- `client/src/components/layout/header.tsx` on dev: the user dropdown contains (a) a clickable user-info block (avatar + name + email) that navigates to the profile path (L233-260, `aria-label="Go to my profile"`), and (b) a **My Profile** menu item (L296-305) navigating to the same path (`profilePath` = `/candidate/profile` for candidates, `/recruiter/company` for recruiters).
- Therefore the #1607 premise **does not reproduce in this component on dev**. ⚠ Unverified: staging's build (where Sumanth tested), the mobile sidebar (`client/src/components/layout/sidebar.tsx` contains its own sign-out/user area), and any public/landing header variant. The acceptance tests in §10 must be executed per surface and per environment before #1607 is closed as fixed *or* as already-fixed — per the standing rule, a premise that no longer reproduces is closed with journey evidence, not by assertion.

### 4.4 Avatar (#1608)

- **Reader:** the Header renders `Avatar src={user?.avatar_url}` (header.tsx L216-222 and L242-248), where `user` comes from the auth context (`client/src/contexts/auth-context.tsx`), bootstrapped/refreshed from `GET /auth/me` (`routes/auth.js:564`), which returns `users.avatar_url`. Fallback rendering: `client/src/components/ui/avatar.tsx`; URL resolution helper: `client/src/lib/avatar.ts` (`user?.avatar_url` first, L41). The default avatar's initial comes from the user's **email** first letter, not their name.
- **Writer 1 (Profile page):** `POST /candidate/profile/photo` (`routes/candidate.js:518`) uploads to B2 storage, then writes **both** `candidate_profiles.photo_url` and `users.avatar_url`, returning `{ photo_url }`. On success the Profile page updates only its local state (`onUploaded` → `setProfile(... avatar_url ...)` in `client/src/pages/candidate/profile.tsx`, ~L807/L1755). **Nothing calls the auth context's `refreshUser()`**, so the header keeps showing the session's old `avatar_url` (or fallback) until reload/re-login — a same-session sync gap, verified in code.
- **Writer 2 (Settings):** `POST /settings/avatar` (`routes/settings.js:183`) converts the file to a base64 data URL and writes **only** `candidate_profiles.photo_url`. It never touches `users.avatar_url` — so this path's picture can never reach the header at all, and it stores an entire image as a data URL in a URL column (a data-hygiene problem Rex should weigh in on).
- **Complete trace (Rex review correction):** the upload response returns `data.avatar_url`, which the client sets in state; `Profile.tsx` does **not** write `avatar_url` into the candidates row — the picture is read back via `GET /auth/me` (`users.avatar_url`, else `candidates.avatar_url`, else `null`). The header fix must therefore target the `/auth/me` contract — the value that endpoint returns and the auth context refreshes — not a candidates-row write by the client.
- **Storage dependency:** writer 1 depends on the B2 upload succeeding (it returns an honest 502 with the storage error when it fails). ⚠ Whether Sumanth's upload on staging succeeded — and whether the stored URL is publicly reachable from a browser — is unverified; both are STOP 1 checks, because "uploaded fine, stored fine, browser can't load the URL" produces exactly his symptom.

## 5. User journeys (target state)

### 5.1 Candidate filters jobs

1. Candidate opens the Job Board and clicks **Filters** (the same button Sumanth clicked). A panel opens with real controls: keyword, location, job type (Full-time / Part-time / Internship / Contract), work mode (Remote / Hybrid / On-site), experience level, salary range.
2. Candidate sets any combination and applies → the listings update to matching jobs only; the active filters are visible (chips or panel state) with the result count.
3. Candidate clears filters → the full listing returns.
4. A combination with no matches shows an honest empty state — "No jobs match these filters" with a **Clear filters** action — never a blank page, never unrelated jobs presented as matches.
5. The filters operate on the real job data the board lists (the same `GET /candidate/jobs` data), on desktop and mobile, and there is exactly **one** filter behaviour for the board — whichever door the candidate enters through (header button or in-page controls), they are setting the same filters.

### 5.2 Candidate sees one true profile completion

1. Candidate completes their profile on the Profile page, which shows e.g. 100% (or their true percentage and the sections still missing).
2. The same candidate opens the Dashboard → the same percentage and the same missing sections.
3. The same candidate opens any job → the completion banner (if shown) shows the **same** percentage; if it is ≥ 80%, one-click apply is available exactly as the banner implies.
4. Candidate adds a missing section (e.g. uploads a resume) → every surface reflects the new percentage without re-entering data and without the candidate doing anything special (no manual refresh ritual beyond normal navigation/refresh).
5. If a surface cannot load the completion value, it shows **nothing** about completion (or a neutral loading state) — it never shows 0% as a fallback for "unknown".

### 5.3 Candidate reaches their profile, and sees their own picture

1. Candidate clicks their avatar/name in the header → the dropdown contains **My Profile**; clicking it (or clicking the name/avatar block itself) opens the Profile page. Same on mobile navigation.
2. Candidate uploads a profile picture on the Profile page → the header avatar, the dropdown avatar, and the Profile page all show the uploaded picture **immediately in the same session**, and still show it after a full page refresh and after signing out and back in.
3. A picture uploaded through Settings produces the same result (one write behaviour), or the Settings upload is retired in favour of the Profile one — the candidate must never have two doors that write different truths.
4. A candidate with no picture sees the designed fallback (initials avatar) everywhere — the fallback appears only when no picture exists, never when one does.

## 6. Requirements

### Filters (#1600)

- **FR-J1 (one filter behaviour):** The header Filters button and the Job Board's filters are the same feature. On the Job Board, the header button opens the board's working filter panel (same state, same fields, same results). Off the Job Board, the header Filters button either navigates to the Job Board with the panel open or is not shown — a button that opens a dead panel must not exist on any page.
- **FR-J2 (fields):** Keyword, location, job type, work mode, experience level, salary range — applied against real job data via the board's existing query path (`GET /candidate/jobs` parameters), combinable, with apply + clear. The existing `FilterState` model in `jobs.tsx` is the starting basis; the build verifies field-by-field that the server honours each parameter (⚠ §4.1) and fixes any parameter the server ignores rather than shipping a control that does nothing.
- **FR-J3 (honest states):** Active-filter indication + result count; honest empty state with Clear filters (§5.1 step 4); filters never silently dropped (if a parameter cannot be honoured, the control is not rendered — no decorative controls anywhere).
- **FR-J4 (responsive):** The panel works on mobile (the current button is desktop-only and `jobs.tsx`'s mobile filter state is an unused stub — both gaps are in scope to close).

### Profile completion (#1601)

- **FR-P1 (single source of truth — the rule):** `client/src/lib/profile-completion.ts` (12-field formula) is the **only** definition of profile completion, and `GET /candidate/dashboard/stats`' server computation is its **only** server mirror. Every surface — Profile page, Dashboard, job detail, job board, any future surface — displays a value obtained from one of these two, computed from the same underlying profile data. **No surface may compute its own variant or read a completion value off a raw profile row.**
- **FR-P2 (fix the outlier + sweep):** `job-detail.tsx` stops reading `profile.completeness` (a field that does not exist) and consumes the canonical source; the build sweeps **all** consumers of completion-like values and brings each onto FR-P1 or removes the display.
- **FR-P3 (no fake zero):** Absent/loading/error ⇒ no percentage is displayed (§5.2 step 5). `|| 0` as a display fallback for a real user fact is a defect wherever it remains in these surfaces.
- **FR-P4 (gates agree with the banner):** One-click apply's ≥ 80% gate and the banner that explains it use the same canonical value, so the product never says "80% unlocks one-click apply" while silently computing 0%.

### Profile menu & avatar (#1607, #1608)

- **FR-M1 (menu):** The header dropdown contains **My Profile**, and the avatar/name block is clickable to the Profile page — verified on desktop header, mobile navigation, and staging, per §4.3. Where it already works (dev header), the journey evidence is attached and the issue closes as verified; where it doesn't, it is fixed. Both outcomes require evidence, not assertion.
- **FR-M2 (one avatar value):** The avatar shown everywhere is `users.avatar_url` as served by `GET /auth/me`. Every upload path writes it. The Settings upload path (`POST /settings/avatar`) is brought onto the same storage + write behaviour as the Profile path (or retired — Rex/Lead call at design; the divergent base64-data-URL write does not survive either way).
- **FR-M3 (same-session sync):** After a successful upload, the auth context is refreshed (`refreshUser()` or equivalent) so header + dropdown + profile show the new picture immediately, without reload or re-login (§5.3 step 2). Persistence across refresh/re-login is verified against `users.avatar_url`, not against local state.
- **FR-M4 (honest upload failure):** If storage fails, the upload shows the real error (the server already returns one) and the previous picture remains displayed — the UI never shows the new picture as if saved when the save failed, and never blanks an existing picture on failure.

## 7. Honesty requirements (binding)

1. **No placeholder UI.** Any control rendered must work. A panel that says it will be wired later is a launch-blocking defect class, not a cosmetic one.
2. **No fabricated or fallback facts.** A percentage, a picture, a result count — each is the real value or it is not shown. Loading and error states are visually distinct from real values (never "0%", never a default avatar presented as the user's picture).
3. **One truth per fact.** Where two surfaces can show the same fact, they consume the same source (§6 FR-J1, FR-P1, FR-M2). Divergence between pages is treated as a defect in the shared source's consumption, not fixed page-by-page with new local logic.
4. **Salary and job facts in filtered results are the jobs' real stored values** (salary display correctness itself is #315's closed precedent — do not regress).

## 8. Scope

**In scope:** header Filters sheet behaviour; Job Board filter panel + query path; profile-completion consumption on job surfaces; header dropdown + mobile nav profile entry; both avatar upload paths + auth-context sync.

**Out of scope:** the header Sort dropdown's backend wiring (noted §4.1/§11 — separate follow-up, not silently fixed or silently left); AI-search page redesign (its filter panel is evidence, not a deliverable — FR-J1's "one behaviour" applies to the Job Board; whether AI Search joins the same model is a Lead call); the 12-field formula itself (changing *what counts* toward completion is a product decision for Sumanth, not part of these bug fixes); recruiter header behaviour beyond no-regression.

## 9. Non-functional

- **Responsive:** all four fixes verified at mobile and desktop widths (the user-perspective journeys are executed on both).
- **No regression:** recruiter header (same component, role-switched paths) still renders and navigates correctly; Dashboard and Profile completion values are unchanged for the same profile data (they are the reference truth).
- **Performance:** filter application reuses the board's existing fetch path; no new per-keystroke request storms (the board's existing debounce/recent-search behaviour is preserved).

## 10. Acceptance criteria — user-journey tests

*Written from the candidate's expectations (2026-10-21 rule); executed on the fresh-install dev rig **and** re-verified on staging before closure (Sumanth filed from staging).*

**#1600 — filters**
- JT-J1: Candidate opens the Job Board, clicks Filters, sets Location = a city with known jobs + Type = Full-time → only matching jobs are listed; the count shown equals the number listed.
- JT-J2: Candidate combines three filters (keyword + work mode + salary range) → results satisfy all three; clearing filters restores the full list.
- JT-J3: Candidate sets a combination with no matches → the honest empty state appears with a working Clear filters action; no unrelated jobs are shown as results.
- JT-J4: The same journey on a mobile-width viewport works end-to-end.

**#1601 — one completion truth**
- JT-P1: Candidate with a fully completed profile opens Profile (100%), Dashboard (100%), and a job detail page → the banner shows 100% (or is absent above the threshold) and one-click apply is available. No surface shows 0%.
- JT-P2: Candidate with a partially complete profile sees the identical percentage and identical missing-sections list on Profile, Dashboard, and job pages.
- JT-P3: Candidate adds a missing section → after normal navigation, all surfaces show the updated percentage; with the completion endpoint forced to fail, job pages show no percentage at all (never 0%).

**#1607 — profile menu**
- JT-M1: Candidate clicks the header avatar → the dropdown shows **My Profile**; clicking it lands on the Profile page. Clicking the name/avatar block in the dropdown also lands there. Repeated on mobile navigation and on staging; evidence attached whichever way each surface resolves.

**#1608 — avatar**
- JT-M2: Candidate uploads a picture on the Profile page → header and dropdown show it immediately (same session, no reload); after refresh and after re-login it is still shown; the Profile page and header never disagree.
- JT-M3: The same upload performed via Settings (if that path remains) produces the identical result; a forced storage failure shows the real error and keeps the previous picture.

## 11. Open questions & verification items

1. ⚠ Field-by-field verification that `GET /candidate/jobs` honours every `FilterState` parameter (STOP 1; FR-J2 depends on it).
2. ⚠ Staging parity for all four issues — Sumanth's reports come from staging's older build; each issue's dev finding must be re-checked on staging before closure, per the two-environment rule. #1607 in particular may already be fixed on dev and live-broken only on staging (a promotion question, not a code question) — the closure evidence must say which.
3. ⚠ Mobile sidebar user area (`sidebar.tsx`) — does it offer a profile path? (FR-M1 verification.)
4. ⚠ Whether Sumanth's staging photo upload actually stored a reachable URL (storage reachability check, §4.4).
5. **Follow-up for Lead's backlog (not this batch):** header Sort dropdown is UI-only by its own in-code admission (§4.1). It is the same defect class as #1600; recommend filing so it is dispositioned deliberately (wire it or remove it), not discovered by a user.
6. **Design call for Rex/Lead:** Settings avatar path — converge onto the Profile upload behaviour or retire the endpoint (§6 FR-M2). Aria's recommendation: converge (one upload service, two entry points max), and stop storing base64 data URLs in `photo_url`.

## 12. Dependencies & risks

- **Storage (B2) reachability** affects JT-M2/M3 evidence from this environment (the journey rig has hit storage TLS failures before — steps record BLOCKED with the reason, never fake-passed).
- **Risk — fixing the wrong layer:** #1601's temptation is to add a `completeness` field to `GET /candidate/profile`. That creates a *third* computation site. FR-P1 forbids it: consumers move to the canonical source.
- **Sequencing:** all four are independent fixes on different surfaces; #1601 and #1608 both touch "what the header/job pages believe about the profile" and should be verified together in one Quinn journey pass (profile journey: complete profile → upload picture → browse jobs → apply).
