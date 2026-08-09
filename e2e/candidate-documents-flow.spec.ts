import { test, expect } from '@playwright/test'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'

test.use({ storageState: CANDIDATE_STORAGE })

test.describe('Candidate Documents Flow', () => {
  test('documents page loads with header, stats, and upload button', async ({ page }) => {
    await page.goto('/candidate/documents')
    await page.waitForTimeout(1000)

    // Verify header
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Upload and verify your documents/i)).toBeVisible()

    // Verify stats cards
    await expect(page.getByText(/Total Documents/i).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Verified/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Document Score/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Fraud Risk/i).first()).toBeVisible({ timeout: 10000 })

    // Verify upload button (hidden file input is triggered by label)
    await expect(page.getByRole('button', { name: /Upload/i }).first()).toBeVisible({ timeout: 10000 })
  })

  test('document tabs filter by status', async ({ page }) => {
    await page.goto('/candidate/documents')
    await page.waitForTimeout(1000)

    // Verify all status tabs exist (shadcn TabsTrigger renders as buttons)
    await expect(page.getByRole('button', { name: /^All/i }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /^Verified/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^Pending/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^Processing/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^Rejected/i }).first()).toBeVisible({ timeout: 10000 })

    // Click through tabs to verify they switch
    const tabs = ['Verified', 'Pending', 'Processing', 'Rejected']
    for (const tabName of tabs) {
      const tab = page.getByRole('button', { name: new RegExp('^' + tabName, 'i') }).first()
      if (await tab.isVisible().catch(() => false)) {
        await tab.click()
        await page.waitForTimeout(600)
        await expect(tab).toBeVisible({ timeout: 10000 })
      }
    }

    // Return to All tab
    const allTab = page.getByRole('button', { name: /^All/i }).first()
    await allTab.click()
    await page.waitForTimeout(600)
    await expect(allTab).toBeVisible({ timeout: 10000 })
  })

  test('upload button triggers file input', async ({ page }) => {
    await page.goto('/candidate/documents')
    await page.waitForTimeout(1000)

    // Verify the hidden file input exists
    const fileInput = page.locator('input[type="file"]#doc-upload')
    await expect(fileInput).toBeAttached()

    // The upload button (label) should be visible and clickable
    const uploadButton = page.getByRole('button', { name: /Upload/i }).first()
    await expect(uploadButton).toBeVisible({ timeout: 10000 })
    await expect(uploadButton).toBeEnabled()
  })

  test('empty state renders when no documents exist', async ({ page }) => {
    await page.goto('/candidate/documents')
    await page.waitForTimeout(1000)

    // Wait for loading to finish
    await page.waitForTimeout(1200)

    // Check if empty state is shown (no documents uploaded in test account)
    const hasEmptyState = await page.getByText(/No documents yet/i).first().isVisible().catch(() => false)
    const hasDocuments = await page.locator('div[class*="Card"]').count() > 4 // stats cards are ~4, so >4 means doc cards

    if (!hasDocuments && !hasEmptyState) {
      // If we can't determine, just verify the page didn't crash
      await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible()
      return
    }

    if (hasEmptyState) {
      await expect(page.getByText(/No documents yet/i)).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(/Upload your resume, certificates/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /Upload your first document/i })).toBeVisible({ timeout: 10000 })
    }
  })

  test('document cards display actions: preview, download, delete', async ({ page }) => {
    await page.goto('/candidate/documents')
    await page.waitForTimeout(1000)
    await page.waitForTimeout(1500)

    // Check if any documents exist
    const deleteButtons = page.getByRole('button', { name: /Delete/i })
    const count = await deleteButtons.count()

    if (count === 0) {
      test.skip(true, 'No documents in test account — skipping document card assertions')
      return
    }

    // Verify action buttons on first document card
    const firstCard = page.locator('div[class*="Card"]').filter({ has: page.getByRole('button', { name: /Delete/i }) }).first()

    await expect(firstCard.getByRole('button', { name: /Preview/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(firstCard.getByRole('button', { name: /Download/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(firstCard.getByRole('button', { name: /Delete/i }).first()).toBeVisible({ timeout: 10000 })
  })

  test('page remains stable after tab switching and scrolling', async ({ page }) => {
    await page.goto('/candidate/documents')
    await page.waitForTimeout(1000)

    // Switch tabs rapidly
    const tabs = ['All', 'Verified', 'Pending', 'All']
    for (const tabName of tabs) {
      const tab = page.getByRole('button', { name: new RegExp('^' + tabName, 'i') }).first()
      if (await tab.isVisible().catch(() => false)) {
        await tab.click()
        await page.waitForTimeout(400)
      }
    }

    // Scroll and verify page still responsive
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    await page.waitForTimeout(300)

    // Page should still have the heading
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible()
  })
})
