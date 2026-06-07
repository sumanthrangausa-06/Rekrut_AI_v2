# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation-flow.spec.ts >> Candidate Navigation >> candidate can navigate dashboard → jobs → apply
- Location: e2e/navigation-flow.spec.ts:36:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: /Browse Jobs|Jobs|Find Jobs/i }).first()
    - locator resolved to <a data-discover="true" href="/candidate/jobs">…</a>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <a data-discover="true" href="/candidate/jobs" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - <a data-discover="true" href="/candidate/jobs" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
  2 × retrying click action
      - waiting 100ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <a href="/candidate" aria-current="page" data-discover="true" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors bg-primary/10 text-primary">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
  13 × retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <a data-discover="true" href="/candidate/jobs" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <a data-discover="true" href="/candidate/jobs" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <a href="/candidate" aria-current="page" data-discover="true" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors bg-primary/10 text-primary">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <a href="/candidate" aria-current="page" data-discover="true" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors bg-primary/10 text-primary">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
  2 × retrying click action
      - waiting 500ms
      - waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <a data-discover="true" href="/candidate/jobs" class="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground">…</a> from <aside role="navigation" id="primary-navigation" aria-label="Primary navigation" class="fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-1.5rem)] flex-col border-r bg-card shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:shadow-none translate-x-0">…</aside> subtree intercepts pointer events
  - retrying click action
    - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - navigation "Primary navigation" [ref=e6]:
    - generic [ref=e7]:
      - link "Rekrut AI logo Rekrut AI" [ref=e8] [cursor=pointer]:
        - /url: /candidate
        - img "Rekrut AI logo" [ref=e9]
        - generic [ref=e16]: Rekrut AI
      - button "Close navigation menu" [ref=e17] [cursor=pointer]:
        - img [ref=e18]
    - navigation [ref=e21]:
      - link "Dashboard" [ref=e22] [cursor=pointer]:
        - /url: /candidate
        - img [ref=e23]
        - text: Dashboard
      - link "Job Board" [ref=e28] [cursor=pointer]:
        - /url: /candidate/jobs
        - img [ref=e29]
        - text: Job Board
      - link "Applications" [ref=e32] [cursor=pointer]:
        - /url: /candidate/applications
        - img [ref=e33]
        - text: Applications
      - link "Profile" [ref=e36] [cursor=pointer]:
        - /url: /candidate/profile
        - img [ref=e37]
        - text: Profile
      - link "Assessments" [ref=e41] [cursor=pointer]:
        - /url: /candidate/assessments
        - img [ref=e42]
        - text: Assessments
      - link "Interviews" [ref=e45] [cursor=pointer]:
        - /url: /candidate/interviews
        - img [ref=e46]
        - text: Interviews
      - link "AI Coaching" [ref=e48] [cursor=pointer]:
        - /url: /candidate/ai-coaching
        - img [ref=e49]
        - text: AI Coaching
      - link "Offers" [ref=e51] [cursor=pointer]:
        - /url: /candidate/offers
        - img [ref=e52]
        - text: Offers
      - link "Onboarding" [ref=e54] [cursor=pointer]:
        - /url: /candidate/onboarding
        - img [ref=e55]
        - text: Onboarding
      - link "Pay & Compensation" [ref=e59] [cursor=pointer]:
        - /url: /candidate/payroll
        - img [ref=e60]
        - text: Pay & Compensation
      - link "OmniScore" [ref=e62] [cursor=pointer]:
        - /url: /candidate/omniscore
        - img [ref=e63]
        - text: OmniScore
    - link "Settings" [ref=e66] [cursor=pointer]:
      - /url: /settings
      - img [ref=e67]
      - text: Settings
  - generic [ref=e70]:
    - banner [ref=e71]:
      - button "Close navigation menu" [expanded] [active] [ref=e73] [cursor=pointer]:
        - img [ref=e74]
      - generic [ref=e75]:
        - 'button "Theme: system. Click to cycle." [ref=e76] [cursor=pointer]':
          - img
        - button "Notifications" [ref=e77] [cursor=pointer]:
          - img [ref=e78]
        - button "EC" [ref=e82] [cursor=pointer]:
          - generic [ref=e84]: EC
    - main [ref=e85]:
      - generic [ref=e86]:
        - generic [ref=e87]:
          - generic [ref=e88]:
            - heading "Welcome back, E2E 👋" [level=1] [ref=e89]
            - paragraph [ref=e90]: Here's your job search overview
          - link "Find AI-Matched Jobs" [ref=e91] [cursor=pointer]:
            - /url: /candidate/jobs
            - button "Find AI-Matched Jobs" [ref=e92]:
              - img
              - text: Find AI-Matched Jobs
        - generic [ref=e94]:
          - img [ref=e95]
          - generic [ref=e99]:
            - paragraph [ref=e100]: Complete your profile to get better AI matches
            - paragraph [ref=e102]: 0% complete — add skills, experience, and education
          - link "Complete Profile" [ref=e103] [cursor=pointer]:
            - /url: /candidate/profile
            - button "Complete Profile" [ref=e104]
        - generic [ref=e105]:
          - generic [ref=e107]:
            - img [ref=e109]
            - generic [ref=e112]:
              - paragraph [ref=e113]: "0"
              - paragraph [ref=e114]: Applications
          - generic [ref=e116]:
            - img [ref=e118]
            - generic [ref=e120]:
              - paragraph [ref=e121]: "0"
              - paragraph [ref=e122]: Interviews
          - generic [ref=e124]:
            - img [ref=e126]
            - generic [ref=e129]:
              - paragraph [ref=e130]: "0"
              - paragraph [ref=e131]: Skills
          - generic [ref=e133]:
            - img [ref=e135]
            - generic [ref=e137]:
              - paragraph [ref=e138]: "300"
              - paragraph [ref=e139]: OmniScore
        - generic [ref=e140]:
          - link "Browse Jobs AI-matched recommendations" [ref=e141] [cursor=pointer]:
            - /url: /candidate/jobs
            - generic [ref=e143]:
              - img [ref=e145]
              - generic [ref=e148]:
                - text: Browse Jobs
                - paragraph [ref=e149]: AI-matched recommendations
              - img [ref=e150]
          - link "My Applications 0 active" [ref=e152] [cursor=pointer]:
            - /url: /candidate/applications
            - generic [ref=e154]:
              - img [ref=e156]
              - generic [ref=e159]:
                - text: My Applications
                - paragraph [ref=e160]: 0 active
              - img [ref=e161]
          - link "My Profile 0% complete" [ref=e163] [cursor=pointer]:
            - /url: /candidate/profile
            - generic [ref=e165]:
              - img [ref=e167]
              - generic [ref=e170]:
                - text: My Profile
                - paragraph [ref=e171]: 0% complete
              - img [ref=e172]
          - link "Practice Interview AI coaching" [ref=e174] [cursor=pointer]:
            - /url: /candidate/interviews
            - generic [ref=e176]:
              - img [ref=e178]
              - generic [ref=e180]:
                - text: Practice Interview
                - paragraph [ref=e181]: AI coaching
              - img [ref=e182]
        - generic [ref=e184]:
          - generic [ref=e185]:
            - heading "Recent Job Openings" [level=3] [ref=e186]
            - link "View all" [ref=e187] [cursor=pointer]:
              - /url: /candidate/jobs
              - button "View all" [ref=e188]:
                - text: View all
                - img
          - generic [ref=e190]:
            - generic [ref=e191]:
              - generic [ref=e192]:
                - paragraph [ref=e193]: E2E Integration Job
                - paragraph [ref=e194]: E2E Test Co
              - generic [ref=e195]:
                - generic [ref=e196]: Remote
                - link "View" [ref=e197] [cursor=pointer]:
                  - /url: /candidate/jobs/10
                  - button "View" [ref=e198]
            - generic [ref=e199]:
              - generic [ref=e200]:
                - paragraph [ref=e201]: E2E Test Engineer
                - paragraph [ref=e202]: E2E Test Co
              - generic [ref=e203]:
                - generic [ref=e204]: Remote
                - link "View" [ref=e205] [cursor=pointer]:
                  - /url: /candidate/jobs/9
                  - button "View" [ref=e206]
            - generic [ref=e207]:
              - generic [ref=e208]:
                - paragraph [ref=e209]: E2E Test Engineer
                - paragraph [ref=e210]: E2E Test Co
              - generic [ref=e211]:
                - generic [ref=e212]: Remote
                - link "View" [ref=e213] [cursor=pointer]:
                  - /url: /candidate/jobs/8
                  - button "View" [ref=e214]
            - generic [ref=e215]:
              - generic [ref=e216]:
                - paragraph [ref=e217]: E2E Integration Job
                - paragraph [ref=e218]: E2E Test Co
              - generic [ref=e219]:
                - generic [ref=e220]: Remote
                - link "View" [ref=e221] [cursor=pointer]:
                  - /url: /candidate/jobs/7
                  - button "View" [ref=e222]
            - generic [ref=e223]:
              - generic [ref=e224]:
                - paragraph [ref=e225]: E2E Test Engineer
                - paragraph [ref=e226]: E2E Test Co
              - generic [ref=e227]:
                - generic [ref=e228]: Remote
                - link "View" [ref=e229] [cursor=pointer]:
                  - /url: /candidate/jobs/6
                  - button "View" [ref=e230]
    - contentinfo [ref=e231]:
      - generic [ref=e232]:
        - paragraph [ref=e233]: © 2026 Rekrut AI, Inc.
        - generic [ref=e234]:
          - link "Privacy" [ref=e235] [cursor=pointer]:
            - /url: "#"
          - link "Terms" [ref=e236] [cursor=pointer]:
            - /url: "#"
          - link "Help Center" [ref=e237] [cursor=pointer]:
            - /url: "#"
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { openMobileMenuIfNeeded, openDashboardSidebarIfNeeded } from './helpers';
  3   | 
  4   | const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json';
  5   | const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';
  6   | 
  7   | // ───────────────────────────────────────────────
  8   | // Visitor navigation
  9   | // ───────────────────────────────────────────────
  10  | test.describe('Visitor Navigation', () => {
  11  |   test('visitor can navigate homepage and login', async ({ page }) => {
  12  |     await page.goto('/');
  13  | 
  14  |     // Verify homepage loads
  15  |     await expect(
  16  |       page.locator('h1').filter({ hasText: /AI-Powered Career Companion/i })
  17  |     ).toBeVisible();
  18  | 
  19  |     // Navigate to login (open mobile menu if needed)
  20  |     await openMobileMenuIfNeeded(page);
  21  |     await page.getByRole('link', { name: /Sign in/i }).click();
  22  |     await expect(page).toHaveURL(/.*\/login/);
  23  | 
  24  |     // Verify login form
  25  |     await expect(page.getByLabel('Email')).toBeVisible();
  26  |     await expect(page.getByLabel('Password')).toBeVisible();
  27  |   });
  28  | });
  29  | 
  30  | // ───────────────────────────────────────────────
  31  | // Candidate navigation
  32  | // ───────────────────────────────────────────────
  33  | test.describe('Candidate Navigation', () => {
  34  |   test.use({ storageState: CANDIDATE_STORAGE });
  35  | 
  36  |   test('candidate can navigate dashboard → jobs → apply', async ({ page }) => {
  37  |     await page.goto('/candidate');
  38  | 
  39  |     // Verify dashboard loads
  40  |     await expect(
  41  |       page.locator('text=Welcome back').or(page.locator('text=Dashboard')).first()
  42  |     ).toBeVisible();
  43  | 
  44  |     // Navigate to jobs via sidebar or direct URL
  45  |     await openDashboardSidebarIfNeeded(page);
  46  |     const jobsLink = page
  47  |       .getByRole('link', { name: /Browse Jobs|Jobs|Find Jobs/i })
  48  |       .first();
  49  |     if (await jobsLink.isVisible().catch(() => false)) {
> 50  |       await jobsLink.click();
      |                      ^ Error: locator.click: Test timeout of 30000ms exceeded.
  51  |     } else {
  52  |       await page.goto('/candidate/jobs');
  53  |     }
  54  | 
  55  |     await expect(page).toHaveURL(/.*\/candidate\/jobs/);
  56  |     await expect(page.locator('text=Jobs').first()).toBeVisible();
  57  | 
  58  |     // Try to apply to a job if one exists
  59  |     const applyBtn = page
  60  |       .locator('button, a')
  61  |       .filter({ hasText: /Apply|Apply Now/i })
  62  |       .first();
  63  |     if (await applyBtn.isVisible().catch(() => false)) {
  64  |       await applyBtn.click();
  65  |       await expect(
  66  |         page.locator('text=Apply').or(page.locator('text=Application')).first()
  67  |       ).toBeVisible();
  68  |     }
  69  |   });
  70  | });
  71  | 
  72  | // ───────────────────────────────────────────────
  73  | // Recruiter navigation
  74  | // ───────────────────────────────────────────────
  75  | test.describe('Recruiter Navigation', () => {
  76  |   test.use({ storageState: RECRUITER_STORAGE });
  77  | 
  78  |   test('recruiter can navigate dashboard → create job → view applicants', async ({ page }) => {
  79  |     await page.goto('/recruiter');
  80  | 
  81  |     // Verify dashboard loads
  82  |     await expect(
  83  |       page.locator('text=Recruiter').or(page.locator('text=Dashboard')).first()
  84  |     ).toBeVisible();
  85  | 
  86  |     // Navigate to jobs page
  87  |     await openDashboardSidebarIfNeeded(page);
  88  |     const jobsLink = page
  89  |       .getByRole('link', { name: /Jobs|My Jobs|Post Job/i })
  90  |       .first();
  91  |     if (await jobsLink.isVisible().catch(() => false)) {
  92  |       await jobsLink.click();
  93  |     } else {
  94  |       await page.goto('/recruiter/jobs');
  95  |     }
  96  | 
  97  |     await expect(page).toHaveURL(/.*\/recruiter\/jobs/);
  98  | 
  99  |     // Click create new job
  100 |     const createBtn = page
  101 |       .locator('button, a')
  102 |       .filter({ hasText: /Create Job|New Job|Post Job|Add Job/i })
  103 |       .first();
  104 |     if (await createBtn.isVisible().catch(() => false)) {
  105 |       await createBtn.click();
  106 |     } else {
  107 |       await page.goto('/recruiter/jobs/new');
  108 |     }
  109 | 
  110 |     await expect(page).toHaveURL(/.*\/recruiter\/jobs\/new/);
  111 | 
  112 |     // Fill out the multi-step job form (Step 1: Job Details)
  113 |     await page
  114 |       .getByPlaceholder(/e\.g\. Senior Software Engineer/i)
  115 |       .fill('E2E Test Engineer');
  116 |     await page
  117 |       .getByPlaceholder(/Leave blank to use your company name/i)
  118 |       .fill('E2E Test Co');
  119 |     await page
  120 |       .getByPlaceholder(/e\.g\. New York, NY or Remote/i)
  121 |       .fill('Remote');
  122 |     await page
  123 |       .getByPlaceholder(/Describe the role, responsibilities/i)
  124 |       .fill('End-to-end testing position for QA automation.');
  125 | 
  126 |     // Move to next step
  127 |     await page.getByRole('button', { name: /Next/i }).click();
  128 | 
  129 |     // Step 2: Requirements (can be minimal)
  130 |     await page.getByRole('button', { name: /Next/i }).click();
  131 | 
  132 |     // Step 3: Preview & Post — publish the job
  133 |     await page
  134 |       .getByRole('button', { name: /Publish Job/i })
  135 |       .click();
  136 | 
  137 |     // Verify success or redirect to job list
  138 |     await expect(
  139 |       page
  140 |         .locator('text=E2E Test Engineer')
  141 |         .or(page.locator('text=Success'))
  142 |         .or(page.locator('text=posted'))
  143 |         .first()
  144 |     ).toBeVisible({ timeout: 15000 });
  145 |   });
  146 | });
  147 | 
  148 | // ───────────────────────────────────────────────
  149 | // Full integration flow
  150 | // ───────────────────────────────────────────────
```