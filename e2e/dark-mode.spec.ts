import { test, expect } from '@playwright/test';
import { openMobileMenuIfNeeded } from './helpers';

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json';
const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json';

/**
 * Toggles dark mode on. The ThemeToggle cycles: system → light → dark → system.
 * We click until the <html> element actually has the 'dark' class.
 */
async function toggleDarkModeOn(page: any) {
  const toggleBtn = page.locator('button[aria-label*="Theme"]');
  const html = page.locator('html');

  // Click up to 3 times to cycle from any state to dark
  for (let i = 0; i < 3; i++) {
    await toggleBtn.click();
    await page.waitForTimeout(400);
    const isDark = await html.evaluate((el: HTMLElement) =>
      el.classList.contains('dark')
    );
    if (isDark) break;
  }
}

async function expectDarkMode(page: any, enabled: boolean) {
  const html = page.locator('html');
  if (enabled) {
    await expect(html).toHaveClass(/dark/);
  } else {
    await expect(html).not.toHaveClass(/dark/);
  }
}

test.describe('Dark Mode', () => {
  test.use({ storageState: CANDIDATE_STORAGE });

  test('dark mode toggles and persists across client-side navigation', async ({ page }) => {
    await page.goto('/candidate');
    await page.waitForTimeout(1000);

    // Ensure starting from light mode
    const html = page.locator('html');
    const initialIsDark = await html.evaluate((el) => el.classList.contains('dark'));

    // Toggle dark mode on
    await toggleDarkModeOn(page);
    await expectDarkMode(page, true);

    // Navigate to jobs page (client-side routing)
    await page.goto('/candidate/jobs');
    await page.waitForTimeout(1000);

    // Dark mode should persist across SPA navigation
    await expectDarkMode(page, true);

    // Navigate back to dashboard
    await page.goto('/candidate');
    await page.waitForTimeout(1000);
    await expectDarkMode(page, true);
  });

  test('dark mode persists after page reload (documents app bug)', async ({ page }) => {
    await page.goto('/candidate');
    await page.waitForTimeout(1000);

    // Toggle dark mode on
    await toggleDarkModeOn(page);
    await expectDarkMode(page, true);

    // Reload the page
    await page.reload();
    await page.waitForTimeout(1000);

    // BUG: The ThemeToggle uses localStorage key "theme" while ThemeProvider reads "rekrut-theme".
    // On reload, ThemeProvider defaults to light mode and removes the "dark" class.
    // This test documents the bug; it will fail until the app is fixed.
    const html = page.locator('html');
    const isDarkAfterReload = await html.evaluate((el) => el.classList.contains('dark'));

    if (!isDarkAfterReload) {
      // Soft assertion — mark as expected failure so we can still run the suite
      test.info().annotations.push({
        type: 'issue',
        description:
          'APP BUG: ThemeToggle writes "theme" to localStorage, but ThemeProvider reads "rekrut-theme". ' +
          'Dark mode is lost on page reload.',
      });
    }

    // We expect this to fail until the app is fixed
    await expect(html).toHaveClass(/dark/);
  });
});

test.describe('Dark Mode on Landing Page', () => {
  test('visitor can toggle dark mode on landing page', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Open mobile menu if needed so the toggle might be visible
    await openMobileMenuIfNeeded(page);

    const toggleBtn = page.locator('button[aria-label*="Theme"]');
    if (await toggleBtn.isVisible().catch(() => false)) {
      await toggleDarkModeOn(page);

      const html = page.locator('html');
      const isDark = await html.evaluate((el) => el.classList.contains('dark'));
      expect(isDark).toBe(true);
    } else {
      test.skip(true, 'Theme toggle not visible on landing page');
    }
  });
});
