# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: candidate-apply-flow.spec.ts >> Candidate Apply Flow >> browse jobs, apply with one-click, and verify on dashboard and applications
- Location: e2e/candidate-apply-flow.spec.ts:7:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/active jobs|results/).first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText(/active jobs|results/).first()

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
  1  | import { test, expect } from '@playwright/test';
  2  | import * as fs from 'fs';
  3  | 
  4  | test.use({ storageState: 'e2e/.auth/candidate.json' });
  5  | 
  6  | test.describe('Candidate Apply Flow', () => {
  7  |   test('browse jobs, apply with one-click, and verify on dashboard and applications', async ({ page }) => {
  8  |     // ─── 1. Browse Jobs ───
  9  |     await page.goto('/candidate/jobs');
  10 |     await page.waitForLoadState('networkidle');
  11 | 
> 12 |     await expect(page.getByText(/active jobs|results/).first()).toBeVisible({ timeout: 15000 });
     |                                                                 ^ Error: expect(locator).toBeVisible() failed
  13 | 
  14 |     // Find an unapplied job
  15 |     const jobCards = page.locator('.cursor-pointer');
  16 |     const count = await jobCards.count();
  17 |     let targetJobIndex = -1;
  18 |     for (let i = 0; i < count; i++) {
  19 |       const card = jobCards.nth(i);
  20 |       const hasApplied = await card.locator('text=Applied').isVisible().catch(() => false);
  21 |       if (!hasApplied) {
  22 |         targetJobIndex = i;
  23 |         break;
  24 |       }
  25 |     }
  26 | 
  27 |     if (targetJobIndex === -1) {
  28 |       test.skip(true, 'All visible jobs already applied — skipping');
  29 |       return;
  30 |     }
  31 | 
  32 |     const targetJob = jobCards.nth(targetJobIndex);
  33 |     const jobTitle = await targetJob.locator('h3').first().textContent() || 'Unknown Job';
  34 | 
  35 |     // ─── 2. View Job Detail ───
  36 |     await targetJob.click();
  37 |     await expect(page).toHaveURL(/.*\/candidate\/jobs\/\d+/, { timeout: 10000 });
  38 |     await page.waitForLoadState('networkidle');
  39 |     await page.waitForTimeout(800);
  40 | 
  41 |     await expect(page.getByRole('heading', { name: /job|engineer|developer|designer|manager/i }).first()).toBeVisible({ timeout: 10000 });
  42 | 
  43 |     // ─── 3. Apply to Job ───
  44 |     const applyBtn = page.getByRole('button', { name: 'Apply Now' }).first();
  45 |     await expect(applyBtn).toBeVisible({ timeout: 10000 });
  46 |     await applyBtn.click();
  47 | 
  48 |     // Wait for the apply form to appear
  49 |     await expect(page.getByRole('button', { name: 'Submit Application' }).first()).toBeVisible({ timeout: 10000 });
  50 | 
  51 |     // Check if One-Click Apply is available (profile completeness >= 80%)
  52 |     const oneClickBtn = page.getByRole('button', { name: /One-Click Apply/ }).first();
  53 |     const hasOneClick = await oneClickBtn.isVisible().catch(() => false);
  54 | 
  55 |     if (hasOneClick) {
  56 |       await oneClickBtn.click();
  57 | 
  58 |       // Wait for the AI generation to complete
  59 |       await expect(page.getByText(/AI is generating|One-Click Apply/).first()).toBeVisible({ timeout: 10000 });
  60 |       await expect(page.getByRole('button', { name: /Submit with AI-Tailored Documents/ }).first()).toBeVisible({ timeout: 20000 });
  61 | 
  62 |       // Submit the AI-tailored application
  63 |       await page.getByRole('button', { name: /Submit with AI-Tailored Documents/ }).first().click();
  64 |     } else {
  65 |       // Regular apply: just submit the application
  66 |       await page.getByRole('button', { name: 'Submit Application' }).first().click();
  67 |     }
  68 | 
  69 |     // Verify "Applied" badge appears on the job detail page
  70 |     await expect(page.getByText('Applied').first()).toBeVisible({ timeout: 15000 });
  71 | 
  72 |     // ─── 4. Verify on Dashboard ───
  73 |     await page.goto('/candidate/dashboard');
  74 |     await page.waitForLoadState('networkidle');
  75 |     await page.waitForTimeout(800);
  76 | 
  77 |     await expect(page.getByText('Welcome back').first()).toBeVisible({ timeout: 10000 });
  78 |     await expect(page.getByText('Applications').first()).toBeVisible({ timeout: 10000 });
  79 | 
  80 |     // ─── 5. Verify on My Applications ───
  81 |     await page.goto('/candidate/applications');
  82 |     await page.waitForLoadState('networkidle');
  83 |     await page.waitForTimeout(800);
  84 | 
  85 |     await expect(page.getByRole('heading', { name: 'My Applications' }).first()).toBeVisible({ timeout: 10000 });
  86 |     await expect(page.getByText('Total Applied').first()).toBeVisible({ timeout: 10000 });
  87 |     await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 });
  88 | 
  89 |     // Verify the job title appears in the applications list (use first 3 words for resilience)
  90 |     const jobTitleWords = jobTitle.split(' ').slice(0, 3).join(' ');
  91 |     await expect(page.getByText(jobTitleWords).first()).toBeVisible({ timeout: 10000 });
  92 |   });
  93 | });
  94 | 
```