# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: recruiter-job-posting-flow.spec.ts >> recruiter job posting flow >> create job, verify listing, edit, and verify update
- Location: e2e/recruiter-job-posting-flow.spec.ts:6:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.fill: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByPlaceholder(/e\.g\. Senior Software Engineer/i)

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - navigation "Primary navigation" [ref=e5]:
    - link "Rekrut AI logo Rekrut AI" [ref=e7] [cursor=pointer]:
      - /url: /recruiter
      - img "Rekrut AI logo" [ref=e8]
      - generic [ref=e15]: Rekrut AI
    - navigation [ref=e16]:
      - link "Dashboard" [ref=e17] [cursor=pointer]:
        - /url: /recruiter
        - img [ref=e18]
        - text: Dashboard
      - link "Jobs" [ref=e23] [cursor=pointer]:
        - /url: /recruiter/jobs
        - img [ref=e24]
        - text: Jobs
      - link "Applications" [ref=e27] [cursor=pointer]:
        - /url: /recruiter/applications
        - img [ref=e28]
        - text: Applications
      - link "Assessments" [ref=e31] [cursor=pointer]:
        - /url: /recruiter/assessments
        - img [ref=e32]
        - text: Assessments
      - link "Candidates" [ref=e35] [cursor=pointer]:
        - /url: /recruiter/candidates
        - img [ref=e36]
        - text: Candidates
      - link "Interviews" [ref=e41] [cursor=pointer]:
        - /url: /recruiter/interviews
        - img [ref=e42]
        - text: Interviews
      - link "Offers" [ref=e44] [cursor=pointer]:
        - /url: /recruiter/offers
        - img [ref=e45]
        - text: Offers
      - link "Onboarding" [ref=e47] [cursor=pointer]:
        - /url: /recruiter/onboarding
        - img [ref=e48]
        - text: Onboarding
      - link "OmniScore" [ref=e52] [cursor=pointer]:
        - /url: /recruiter/omniscore
        - img [ref=e53]
        - text: OmniScore
      - link "Analytics" [ref=e55] [cursor=pointer]:
        - /url: /recruiter/analytics
        - img [ref=e56]
        - text: Analytics
      - link "Company" [ref=e58] [cursor=pointer]:
        - /url: /recruiter/company
        - img [ref=e59]
        - text: Company
      - link "Payroll" [ref=e63] [cursor=pointer]:
        - /url: /recruiter/payroll
        - img [ref=e64]
        - text: Payroll
    - link "Settings" [ref=e68] [cursor=pointer]:
      - /url: /settings
      - img [ref=e69]
      - text: Settings
  - generic [ref=e72]:
    - banner [ref=e73]:
      - generic [ref=e75]: Recruiter
      - generic [ref=e76]:
        - 'button "Theme: light. Click to cycle." [ref=e77] [cursor=pointer]':
          - img
        - button "Notifications" [ref=e78] [cursor=pointer]:
          - img [ref=e79]
        - button "ER E2E Recruiter" [ref=e83] [cursor=pointer]:
          - generic [ref=e85]: ER
          - generic [ref=e86]: E2E Recruiter
          - img [ref=e87]
    - main [ref=e89]:
      - generic [ref=e90]:
        - generic [ref=e91]:
          - button [ref=e92] [cursor=pointer]:
            - img
          - generic [ref=e93]:
            - heading "Edit Job" [level=1] [ref=e94]
            - paragraph [ref=e95]: Update your job listing
        - generic [ref=e97]:
          - button "Job Details" [ref=e98] [cursor=pointer]:
            - img [ref=e100]
            - generic [ref=e102]: Job Details
          - button "Requirements" [ref=e103] [cursor=pointer]:
            - img [ref=e105]
            - generic [ref=e107]: Requirements
          - button "Preview & Post" [ref=e108] [cursor=pointer]:
            - img [ref=e110]
            - generic [ref=e113]: Preview & Post
        - generic [ref=e117]:
          - generic [ref=e118]:
            - generic [ref=e119]:
              - heading "Candidate Preview" [level=3] [ref=e120]:
                - img [ref=e121]
                - text: Candidate Preview
              - paragraph [ref=e124]: This is how your job will appear to candidates
            - generic [ref=e126]:
              - generic [ref=e127]:
                - heading "E2E Test Engineer 1780917740871" [level=2] [ref=e128]
                - generic [ref=e129]:
                  - generic [ref=e130]:
                    - img [ref=e131]
                    - text: E2E Test Co
                  - generic [ref=e135]:
                    - generic [ref=e136]: ·
                    - img [ref=e137]
                    - text: Remote
                - generic [ref=e140]:
                  - generic [ref=e141]: Full-time
                  - generic [ref=e142]:
                    - img [ref=e143]
                    - text: Competitive salary
              - generic [ref=e145]:
                - heading "About the Role" [level=3] [ref=e146]:
                  - img [ref=e147]
                  - text: About the Role
                - generic [ref=e150]: End-to-end testing position.
              - button "Apply Now" [ref=e152] [cursor=pointer]:
                - img
                - text: Apply Now
          - generic [ref=e153]:
            - heading "SEO & Social Preview" [level=3] [ref=e155]:
              - img [ref=e156]
              - text: SEO & Social Preview
            - generic [ref=e161]:
              - paragraph [ref=e162]: Google Search Result
              - paragraph [ref=e163] [cursor=pointer]: E2E Test Engineer 1780917740871 | E2E Test Co
              - paragraph [ref=e164]: rekrutai.co/recruiter/jobs · Remote · Full-time
              - paragraph [ref=e165]: End-to-end testing position.
          - generic [ref=e166]:
            - heading "Before You Publish" [level=3] [ref=e168]:
              - img [ref=e169]
              - text: Before You Publish
            - generic [ref=e173]:
              - generic [ref=e174]:
                - img [ref=e175]
                - text: Job title set
              - generic [ref=e178]:
                - img [ref=e179]
                - text: Description filled
              - generic [ref=e182]:
                - img [ref=e183]
                - text: Requirements recommended
              - generic [ref=e185]:
                - img [ref=e186]
                - text: Location set
              - generic [ref=e189]:
                - img [ref=e190]
                - text: Salary recommended
              - generic [ref=e192]:
                - img [ref=e193]
                - text: 0 screening questions
        - generic [ref=e196]:
          - button "Back" [ref=e197] [cursor=pointer]:
            - img
            - text: Back
          - button "Update Job" [active] [ref=e198] [cursor=pointer]:
            - img
            - text: Update Job
    - contentinfo [ref=e199]:
      - generic [ref=e200]:
        - paragraph [ref=e201]: © 2026 Rekrut AI, Inc.
        - generic [ref=e202]:
          - link "Privacy" [ref=e203] [cursor=pointer]:
            - /url: "#"
          - link "Terms" [ref=e204] [cursor=pointer]:
            - /url: "#"
          - link "Help Center" [ref=e205] [cursor=pointer]:
            - /url: "#"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.use({ storageState: 'e2e/.auth/recruiter.json' })
  4  | 
  5  | test.describe('recruiter job posting flow', () => {
  6  |   test('create job, verify listing, edit, and verify update', async ({ page }) => {
  7  |     const jobTitle = 'E2E Test Engineer ' + Date.now()
  8  |     const updatedTitle = jobTitle + ' Updated'
  9  | 
  10 |     // Navigate to jobs page and create new job
  11 |     await page.goto('/recruiter/jobs')
  12 |     await page.waitForURL('/recruiter/jobs')
  13 |     await page.getByRole('button', { name: 'Post New Job' }).click()
  14 |     await page.waitForURL('/recruiter/jobs/new')
  15 | 
  16 |     // Step 1: Job Details
  17 |     await page.getByPlaceholder(/e\.g\. Senior Software Engineer/i).fill(jobTitle)
  18 |     await page.getByPlaceholder(/Leave blank to use your company name/i).fill('E2E Test Co')
  19 |     await page.getByPlaceholder(/e\.g\. New York, NY or Remote/i).fill('Remote')
  20 |     await page.getByPlaceholder(/Describe the role, responsibilities/i).fill('End-to-end testing position.')
  21 | 
  22 |     // Step 2: Requirements
  23 |     await page.getByRole('button', { name: /Next/i }).click()
  24 |     await page.waitForSelector('text=Requirements')
  25 | 
  26 |     // Step 3: Preview & Post
  27 |     await page.getByRole('button', { name: /Next/i }).click()
  28 |     await page.waitForSelector('text=Preview')
  29 |     await page.getByRole('button', { name: 'Publish Job' }).click()
  30 | 
  31 |     // Verify redirect to jobs list and job appears
  32 |     await page.waitForURL('/recruiter/jobs')
  33 |     await expect(page.getByText(jobTitle).first()).toBeVisible({ timeout: 15000 })
  34 | 
  35 |     // Edit the job via dropdown menu
  36 |     const jobRow = page.locator('text=' + jobTitle).first().locator('xpath=ancestor::*[contains(@class, "group")]')
  37 |     const moreBtn = page.locator('button').filter({ has: page.locator('svg[class*="lucide-more-horizontal"]') }).first()
  38 |     if (await moreBtn.isVisible().catch(() => false)) {
  39 |       await moreBtn.click()
  40 |       await page.getByRole('menuitem', { name: 'Edit' }).click()
  41 |     } else {
  42 |       // Fallback: find the job card and click Edit directly
  43 |       await page.getByRole('button', { name: 'Edit' }).first().click()
  44 |     }
  45 | 
  46 |     await page.waitForURL(/.*\/recruiter\/jobs\/\d+\/edit/)
  47 | 
  48 |     // Navigate through wizard to step 3 (Preview & Post) where Update Job button is
  49 |     await page.getByRole('button', { name: /Next/i }).click()
  50 |     await page.getByRole('button', { name: /Next/i }).click()
  51 |     await page.waitForSelector('text=Preview')
  52 | 
  53 |     // Update title and save
> 54 |     await page.getByPlaceholder(/e\.g\. Senior Software Engineer/i).fill(updatedTitle)
     |                                                                     ^ Error: locator.fill: Test timeout of 60000ms exceeded.
  55 |     await page.getByRole('button', { name: 'Update Job' }).click()
  56 | 
  57 |     // Verify update in job list
  58 |     await page.waitForURL('/recruiter/jobs')
  59 |     await expect(page.getByText(updatedTitle)).toBeVisible({ timeout: 15000 })
  60 |   })
  61 | })
  62 | 
```