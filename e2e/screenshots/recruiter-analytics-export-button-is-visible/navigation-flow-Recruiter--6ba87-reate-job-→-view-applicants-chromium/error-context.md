# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation-flow.spec.ts >> Recruiter Navigation >> recruiter can navigate dashboard → create job → view applicants
- Location: e2e/navigation-flow.spec.ts:83:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /.*\/recruiter\/jobs/
Received string:  "http://localhost:3000/login"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    12 × unexpected value "http://localhost:3000/login"

```

```yaml
- link "Rekrut AI logo Rekrut AI":
  - /url: /
  - img "Rekrut AI logo"
  - text: Rekrut AI
- paragraph:
  - text: Don't have an account?
  - link "Sign up":
    - /url: /register
- button "Toggle theme":
  - img
- heading "Sign in" [level=2]
- text: Email
- textbox "Email":
  - /placeholder: example.email@gmail.com
- text: Password
- textbox "Password":
  - /placeholder: Enter at least 8+ characters
- button "Show password":
  - img
- checkbox "Remember me"
- text: Remember me
- link "Forgot password?":
  - /url: /forgot-password
- button "Sign in":
  - img
  - text: Sign in
- img
- heading "Welcome back!" [level=3]
- paragraph: Sign in to access your dashboard, track applications, and continue your interview practice.
```

# Test source

```ts
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
  25  |     await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  26  |     await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
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
  50  |       try {
  51  |         await jobsLink.click({ timeout: 3000 });
  52  |       } catch {
  53  |         // Fallback: direct navigation if click is blocked by overlay
  54  |         await page.goto('/candidate/jobs');
  55  |       }
  56  |     } else {
  57  |       await page.goto('/candidate/jobs');
  58  |     }
  59  | 
  60  |     await expect(page).toHaveURL(/.*\/candidate\/jobs/);
  61  |     await expect(page.locator('text=Jobs').first()).toBeVisible();
  62  | 
  63  |     // Try to apply to a job if one exists
  64  |     const applyBtn = page
  65  |       .locator('button, a')
  66  |       .filter({ hasText: /Apply|Apply Now/i })
  67  |       .first();
  68  |     if (await applyBtn.isVisible().catch(() => false)) {
  69  |       await applyBtn.click();
  70  |       await expect(
  71  |         page.locator('text=Apply').or(page.locator('text=Application')).first()
  72  |       ).toBeVisible();
  73  |     }
  74  |   });
  75  | });
  76  | 
  77  | // ───────────────────────────────────────────────
  78  | // Recruiter navigation
  79  | // ───────────────────────────────────────────────
  80  | test.describe('Recruiter Navigation', () => {
  81  |   test.use({ storageState: RECRUITER_STORAGE });
  82  | 
  83  |   test('recruiter can navigate dashboard → create job → view applicants', async ({ page }) => {
  84  |     await page.goto('/recruiter');
  85  | 
  86  |     // Verify dashboard loads
  87  |     await expect(
  88  |       page.locator('text=Recruiter').or(page.locator('text=Dashboard')).first()
  89  |     ).toBeVisible();
  90  | 
  91  |     // Navigate to jobs page
  92  |     await openDashboardSidebarIfNeeded(page);
  93  |     const jobsLink = page
  94  |       .getByRole('link', { name: /Jobs|My Jobs|Post Job/i })
  95  |       .first();
  96  |     if (await jobsLink.isVisible().catch(() => false)) {
  97  |       await jobsLink.click();
  98  |     } else {
  99  |       await page.goto('/recruiter/jobs');
  100 |     }
  101 | 
> 102 |     await expect(page).toHaveURL(/.*\/recruiter\/jobs/);
      |                        ^ Error: expect(page).toHaveURL(expected) failed
  103 | 
  104 |     // Click create new job
  105 |     const createBtn = page
  106 |       .locator('button, a')
  107 |       .filter({ hasText: /Create Job|New Job|Post Job|Add Job/i })
  108 |       .first();
  109 |     if (await createBtn.isVisible().catch(() => false)) {
  110 |       await createBtn.click();
  111 |     } else {
  112 |       await page.goto('/recruiter/jobs/new');
  113 |     }
  114 | 
  115 |     await expect(page).toHaveURL(/.*\/recruiter\/jobs\/new/);
  116 | 
  117 |     // Fill out the multi-step job form (Step 1: Job Details)
  118 |     await page
  119 |       .getByPlaceholder(/e\.g\. Senior Software Engineer/i)
  120 |       .fill('E2E Test Engineer');
  121 |     await page
  122 |       .getByPlaceholder(/Leave blank to use your company name/i)
  123 |       .fill('E2E Test Co');
  124 |     await page
  125 |       .getByPlaceholder(/e\.g\. New York, NY or Remote/i)
  126 |       .fill('Remote');
  127 |     await page
  128 |       .getByPlaceholder(/Describe the role, responsibilities/i)
  129 |       .fill('End-to-end testing position for QA automation.');
  130 | 
  131 |     // Move to next step
  132 |     await page.getByRole('button', { name: /Next/i }).click();
  133 | 
  134 |     // Step 2: Requirements (can be minimal)
  135 |     await page.getByRole('button', { name: /Next/i }).click();
  136 | 
  137 |     // Step 3: Preview & Post — publish the job
  138 |     await page
  139 |       .getByRole('button', { name: /Publish Job/i })
  140 |       .click();
  141 | 
  142 |     // Verify success or redirect to job list
  143 |     await expect(
  144 |       page
  145 |         .locator('text=E2E Test Engineer')
  146 |         .or(page.locator('text=Success'))
  147 |         .or(page.locator('text=posted'))
  148 |         .first()
  149 |     ).toBeVisible({ timeout: 15000 });
  150 |   });
  151 | });
  152 | 
  153 | // ───────────────────────────────────────────────
  154 | // Full integration flow
  155 | // ───────────────────────────────────────────────
  156 | test.describe('End-to-End Integration Flow', () => {
  157 |   test('recruiter posts job, candidate applies, recruiter views applicants', async ({ request, page }) => {
  158 |     // 1. Recruiter creates a job via API (fast, no extra browser context)
  159 |     const recruiterLogin = await request.post('/api/auth/login', {
  160 |       data: { email: 'e2e-recruiter@rekrutai.test', password: 'TestPass123!' },
  161 |     });
  162 |     const recruiterData = await recruiterLogin.json();
  163 |     const recruiterToken = recruiterData.token || recruiterData.accessToken;
  164 | 
  165 |     const jobRes = await request.post('/api/jobs', {
  166 |       headers: { Authorization: `Bearer ${recruiterToken}` },
  167 |       data: {
  168 |         title: 'E2E Integration Job',
  169 |         company: 'E2E Integration Co',
  170 |         location: 'Remote',
  171 |         description: 'Integration test job description.',
  172 |       },
  173 |     });
  174 |     expect(jobRes.ok() || jobRes.status() === 201).toBeTruthy();
  175 | 
  176 |     // 2. Candidate finds and applies to the job via UI
  177 |     await page.goto('/candidate/jobs');
  178 |     await page.waitForLoadState('networkidle');
  179 | 
  180 |     const searchInput = page.getByPlaceholder(/Search/i).first();
  181 |     if (await searchInput.isVisible().catch(() => false)) {
  182 |       await searchInput.fill('E2E Integration Job');
  183 |       await searchInput.press('Enter');
  184 |       await page.waitForTimeout(1500);
  185 |     }
  186 | 
  187 |     const applyBtn = page
  188 |       .locator('button, a')
  189 |       .filter({ hasText: /Apply|Apply Now/i })
  190 |       .first();
  191 |     if (await applyBtn.isVisible().catch(() => false)) {
  192 |       await applyBtn.click();
  193 |       await expect(
  194 |         page
  195 |           .locator('text=Application')
  196 |           .or(page.locator('text=Apply'))
  197 |           .first()
  198 |       ).toBeVisible({ timeout: 10000 });
  199 |     }
  200 | 
  201 |     // 3. Recruiter views applicants via API (no extra browser context)
  202 |     const jobsListRes = await request.get('/api/jobs', {
```