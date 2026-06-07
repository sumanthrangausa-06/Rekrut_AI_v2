import { Page } from '@playwright/test';

/**
 * Opens the mobile hamburger menu if the viewport is small enough
 * that the desktop nav is hidden.
 */
export async function openMobileMenuIfNeeded(page: Page) {
  const mobileMenuBtn = page.getByRole('button', { name: 'Open menu' });
  if (await mobileMenuBtn.isVisible().catch(() => false)) {
    await mobileMenuBtn.click();
  }
}

/**
 * Opens the dashboard sidebar on mobile if needed.
 */
export async function openDashboardSidebarIfNeeded(page: Page) {
  const sidebarToggle = page.getByRole('button', {
    name: /Open navigation menu/i,
  });
  if (await sidebarToggle.isVisible().catch(() => false)) {
    await sidebarToggle.click();
  }
}

/**
 * Navigates to a dashboard page via sidebar or direct URL.
 */
export async function navigateDashboard(page: Page, path: string) {
  await openDashboardSidebarIfNeeded(page);
  const link = page.getByRole('link', { name: new RegExp(path, 'i') }).first();
  if (await link.isVisible().catch(() => false)) {
    await link.click();
  } else {
    await page.goto(path);
  }
}
