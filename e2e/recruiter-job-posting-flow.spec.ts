import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/recruiter.json' })

test.describe('recruiter job posting flow', () => {
  test('create job, verify listing, edit, and verify update', async ({ page }) => {
    const jobTitle = 'E2E Test Engineer ' + Date.now()
    const updatedTitle = jobTitle + ' Updated'

    // Navigate to jobs page and create new job
    await page.goto('/recruiter/jobs')
    await page.waitForURL('/recruiter/jobs')
    await page.getByRole('button', { name: 'Post New Job' }).click()
    await page.waitForURL('/recruiter/jobs/new')

    // Step 1: Job Details
    await page.getByPlaceholder(/e\.g\. Senior Software Engineer/i).fill(jobTitle)
    await page.getByPlaceholder(/Leave blank to use your company name/i).fill('E2E Test Co')
    await page.getByPlaceholder(/e\.g\. New York, NY or Remote/i).fill('Remote')
    await page.getByPlaceholder(/Describe the role, responsibilities/i).fill('End-to-end testing position.')

    // Step 2: Requirements
    await page.getByRole('button', { name: /Next/i }).click()
    await page.waitForSelector('text=Requirements')

    // Step 3: Preview & Post
    await page.getByRole('button', { name: /Next/i }).click()
    await page.waitForSelector('text=Preview')
    await page.getByRole('button', { name: 'Post Job' }).click()

    // Verify redirect to jobs list and job appears
    await page.waitForURL('/recruiter/jobs')
    await expect(page.getByText(jobTitle)).toBeVisible({ timeout: 15000 })

    // Edit the job via dropdown menu
    const jobRow = page.locator('text=' + jobTitle).first().locator('xpath=ancestor::*[contains(@class, "group")]')
    const moreBtn = page.locator('button').filter({ has: page.locator('svg[class*="lucide-more-horizontal"]') }).first()
    if (await moreBtn.isVisible().catch(() => false)) {
      await moreBtn.click()
      await page.getByRole('menuitem', { name: 'Edit' }).click()
    } else {
      // Fallback: find the job card and click Edit directly
      await page.getByRole('button', { name: 'Edit' }).first().click()
    }

    await page.waitForURL(/.*\/recruiter\/jobs\/\d+\/edit/)

    // Update title and save
    await page.getByPlaceholder(/e\.g\. Senior Software Engineer/i).fill(updatedTitle)
    await page.getByRole('button', { name: 'Update Job' }).click()

    // Verify update in job list
    await page.waitForURL('/recruiter/jobs')
    await expect(page.getByText(updatedTitle)).toBeVisible({ timeout: 15000 })
  })
})
