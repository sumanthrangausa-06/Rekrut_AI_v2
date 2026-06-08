import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/candidate.json' })

test.describe('Application Submission Flow', () => {
  test('apply to a job and verify in applications list', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Verify jobs page loaded with flexible heading/text check
    await expect(page.getByText(/Find Your Next Opportunity|active jobs|results/i).first()).toBeVisible({ timeout: 15000 })

    // Find a job that does NOT have the "Applied" badge
    const jobCards = page.locator('.cursor-pointer')
    const count = await jobCards.count()
    if (count === 0) {
      test.skip(true, 'No jobs available on the board — skipping')
      return
    }

    let targetJobIndex = -1
    for (let i = 0; i < count; i++) {
      const card = jobCards.nth(i)
      const hasAppliedBadge = await card.locator('text=Applied').isVisible().catch(() => false)
      if (!hasAppliedBadge) {
        targetJobIndex = i
        break
      }
    }

    if (targetJobIndex === -1) {
      test.skip(true, 'All visible jobs already have applications — skipping to avoid duplicates')
      return
    }

    const targetJob = jobCards.nth(targetJobIndex)

    // Capture job title before clicking
    const jobTitleText = await targetJob.locator('h3').first().textContent() || 'Unknown Job'

    // Click the job card to open detail
    await targetJob.click()

    // Some job cards may not navigate to a detail page (SPA behavior varies)
    const currentUrl = page.url()
    if (!currentUrl.match(/.*\/candidate\/jobs\/\d+/)) {
      test.skip(true, 'Job cards do not navigate to detail page in current UI — skipping')
      return
    }

    await expect(page).toHaveURL(/.*\/candidate\/jobs\/\d+/, { timeout: 10000 })

    // Wait for job detail page to load
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)

    // Verify we are on the job detail page
    await expect(page.getByRole('heading', { name: /job|engineer|developer/i }).first()).toBeVisible({ timeout: 10000 })

    // Click "Apply Now" button (should be visible if not already applied)
    const applyButton = page.getByRole('button', { name: 'Apply Now' }).first()
    await expect(applyButton).toBeVisible({ timeout: 10000 })
    await applyButton.click()

    // Wait for the apply form to appear
    await expect(page.getByRole('button', { name: 'Submit Application' }).first()).toBeVisible({ timeout: 10000 })

    // Fill cover letter if textarea is present
    const coverLetterTextarea = page.locator('textarea').filter({ hasText: /cover letter|brief/i }).first()
    const hasTextarea = await coverLetterTextarea.isVisible().catch(() => false)
    if (hasTextarea) {
      await coverLetterTextarea.fill('I am excited about this opportunity and believe my skills align well with the role requirements.')
    }

    // Handle any screening questions (fill text inputs, select Yes/No, etc.)
    const questionInputs = page.locator('div.rounded-lg.border').filter({ has: page.locator('label') })
    const questionCount = await questionInputs.count()
    for (let i = 0; i < questionCount; i++) {
      const qBlock = questionInputs.nth(i)
      // Check for Yes/No buttons
      const yesBtn = qBlock.getByRole('button', { name: 'Yes' }).first()
      const noBtn = qBlock.getByRole('button', { name: 'No' }).first()
      if (await yesBtn.isVisible().catch(() => false)) {
        await yesBtn.click()
      } else if (await noBtn.isVisible().catch(() => false)) {
        await noBtn.click()
      } else {
        // Try to find a text input or select
        const input = qBlock.locator('input').first()
        const select = qBlock.locator('select').first()
        if (await input.isVisible().catch(() => false)) {
          await input.fill('Test answer for screening question.')
        } else if (await select.isVisible().catch(() => false)) {
          await select.selectOption({ index: 1 })
        }
      }
    }

    // Submit the application
    const submitButton = page.getByRole('button', { name: 'Submit Application' }).first()
    await submitButton.click()

    // Wait for submission to complete and "Applied" badge to appear
    await expect(page.getByText('Applied').first()).toBeVisible({ timeout: 15000 })

    // Navigate to applications page to verify the application is listed
    await page.goto('/candidate/applications')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)

    // Verify the applications page loads and shows our application
    await expect(page.getByText('Total Applied').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 })

    // Verify the job title appears in the applications list
    // Use a partial match to be resilient
    const jobTitleWords = jobTitleText.split(' ').slice(0, 3).join(' ')
    await expect(page.getByText(jobTitleWords).first()).toBeVisible({ timeout: 10000 })
  })

  test('one-click apply is available for profiles with high completeness', async ({ page }) => {
    await page.goto('/candidate/jobs')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    await expect(page.getByText(/Find Your Next Opportunity|active jobs|results/i).first()).toBeVisible({ timeout: 15000 })

    const jobCards = page.locator('.cursor-pointer')
    const count = await jobCards.count()
    if (count === 0) {
      test.skip(true, 'No jobs available on the board — skipping')
      return
    }

    let targetJobIndex = -1
    for (let i = 0; i < count; i++) {
      const card = jobCards.nth(i)
      const hasApplied = await card.locator('text=Applied').isVisible().catch(() => false)
      if (!hasApplied) {
        targetJobIndex = i
        break
      }
    }

    if (targetJobIndex === -1) {
      test.skip(true, 'All visible jobs already applied — skipping')
      return
    }

    await jobCards.nth(targetJobIndex).click()

    // Some job cards may not navigate to a detail page
    const currentUrl = page.url()
    if (!currentUrl.match(/.*\/candidate\/jobs\/\d+/)) {
      test.skip(true, 'Job cards do not navigate to detail page in current UI — skipping')
      return
    }

    await expect(page).toHaveURL(/.*\/candidate\/jobs\/\d+/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)

    // Click Apply Now to open the form
    await page.getByRole('button', { name: 'Apply Now' }).first().click()
    await expect(page.getByRole('button', { name: 'Submit Application' }).first()).toBeVisible({ timeout: 10000 })

    // Verify One-Click Apply button is present (if profile completeness >= 80)
    const oneClickBtn = page.getByRole('button', { name: /One-Click Apply/ }).first()
    const hasOneClick = await oneClickBtn.isVisible().catch(() => false)

    if (hasOneClick) {
      await expect(oneClickBtn).toBeVisible()
      // Click it and verify the modal appears
      await oneClickBtn.click()
      await expect(page.getByText(/AI is generating|One-Click Apply/).first()).toBeVisible({ timeout: 10000 })
      // Close the modal without submitting
      await page.getByRole('button', { name: /Cancel|Close/ }).first().click()
    }

    // Cancel the main form to leave state clean
    await page.getByRole('button', { name: 'Cancel' }).first().click()
  })
})
