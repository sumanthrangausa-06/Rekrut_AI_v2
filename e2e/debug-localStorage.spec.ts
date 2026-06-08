import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/candidate.json' });

test.describe('Debug', () => {
  test('debug localStorage and API', async ({ page }) => {
    await page.goto('/candidate/jobs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check localStorage
    const token = await page.evaluate(() => localStorage.getItem('rekrutai_token'));
    console.log('TOKEN PRESENT:', !!token);
    console.log('TOKEN FIRST 50:', token?.substring(0, 50));

    // Check if jobs loaded via API
    const apiResponse = await page.evaluate(async () => {
      const res = await fetch('/api/candidate/jobs?limit=200', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rekrutai_token')}` }
      });
      const data = await res.json();
      return { status: res.status, jobCount: data?.data?.length || data?.jobs?.length || 0 };
    });
    console.log('API STATUS:', apiResponse.status);
    console.log('API JOB COUNT:', apiResponse.jobCount);

    // Check the page job count
    const jobsText = await page.getByText(/active jobs/).first().textContent().catch(() => 'none');
    console.log('PAGE JOBS TEXT:', jobsText);
  });
});