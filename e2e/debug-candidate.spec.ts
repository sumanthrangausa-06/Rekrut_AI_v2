import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/candidate.json' });

test.describe('Debug', () => {
  test('debug jobs page', async ({ page }) => {
    await page.goto('/candidate/jobs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const body = await page.locator('body').textContent();
    console.log('BODY TEXT:', body?.substring(0, 500));
    
    const jobCards = page.locator('.cursor-pointer');
    const count = await jobCards.count();
    console.log('JOB CARDS COUNT:', count);
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const card = jobCards.nth(i);
      const text = await card.textContent();
      const hasApplied = await card.locator('text=Applied').isVisible().catch(() => false);
      console.log(`Card ${i}: hasApplied=${hasApplied}, text=${text?.substring(0, 100)}`);
    }
  });
});
