import { test as base } from '@playwright/test';

/**
 * Custom test fixture that forces garbage collection after each test
 * to reduce renderer memory accumulation across the suite.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    // After each test: force GC if available, then clear caches
    try {
      await page.evaluate(() => {
        if ((window as any).gc) (window as any).gc();
      });
    } catch {
      // page may already be closing — ignore
    }
  },
});
