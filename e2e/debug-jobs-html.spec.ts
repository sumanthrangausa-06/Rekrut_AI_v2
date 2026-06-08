import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/candidate.json' });

test.describe('Debug', () => {
  test('debug jobs page HTML', async ({ page }) => {
    await page.goto('/candidate/jobs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const html = await page.content();
    // Find all elements with cursor-pointer or job-related text
    const cursorElements = await page.locator('.cursor-pointer').count();
    console.log('CURSOR-POINTER COUNT:', cursorElements);

    // Try finding by other selectors
    const jobCards = await page.locator('article, [class*="job"], [class*="card"]').count();
    console.log('GENERIC JOB/CARD COUNT:', jobCards);

    // Look for job title text
    const titleText = await page.getByText('Software Engineer').first().isVisible().catch(() => false);
    console.log('HAS SOFTWARE ENGINEER:', titleText);

    // Look for the results count text
    const resultsText = await page.getByText(/\d+ results/).first().textContent().catch(() => 'none');
    console.log('RESULTS TEXT:', resultsText);

    // Get body text for debugging
    const body = await page.locator('body').textContent();
    console.log('BODY TOP 500:', body?.substring(0, 500));
  });
});