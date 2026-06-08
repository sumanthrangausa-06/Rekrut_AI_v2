import { test, expect } from '@playwright/test';

const PASSWORD = 'TestPass123!';

function generateUniqueEmail(prefix: string) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `e2e-${prefix}-${ts}-${rand}@rekrutai.test`;
}

async function getLatestResetToken(email: string): Promise<string | null> {
  require('dotenv').config({ path: '.env' });
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT t.token FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE u.email = $1 AND t.expires_at > NOW()
       ORDER BY t.created_at DESC LIMIT 1`,
      [email]
    );
    return res.rows[0]?.token || null;
  } finally {
    await client.end();
  }
}

// ───────────────────────────────────────────────
// Password Reset Flow — Desktop
// ───────────────────────────────────────────────
test.describe('Password Reset Flow', () => {
  test('forgot-password page loads with correct form elements', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: /Reset your password/i })).toBeVisible({ timeout: 10000 });

    // Verify email input is present and required
    const emailInput = page.locator('input#email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('required', '');

    // Verify submit button is present
    await expect(page.getByRole('button', { name: /Send reset link/i })).toBeVisible();

    // Verify back-to-login link is present
    await expect(page.getByRole('link', { name: /Back to sign in/i })).toBeVisible();
  });

  test('forgot-password with non-existent email shows success (security)', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.fill('input#email', 'nonexistent@rekrutai.test');
    await page.getByRole('button', { name: /Send reset link/i }).click();

    // Should still show success to avoid email enumeration
    await expect(page.getByText('Check your console').first()).toBeVisible({ timeout: 10000 });
  });

  test('reset-password page with missing token shows error', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: /Set new password/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Invalid or missing reset token').first()).toBeVisible({ timeout: 5000 });
  });

  test('full reset flow: forgot → token → reset → login', async ({ page, request }) => {
    const email = generateUniqueEmail('reset');
    const newPassword = 'NewSecurePass456!';

    // ─── 1. Seed a new candidate user via API ───
    const regRes = await request.post('/api/auth/register', {
      headers: { 'X-Forwarded-For': '9.9.9.9' },
      data: {
        name: 'E2E Password Reset User',
        email,
        password: PASSWORD,
        role: 'candidate',
      },
    });
    if (!regRes.ok()) {
      throw new Error(`Failed to register user: ${regRes.status()} ${await regRes.text()}`);
    }

    // ─── 2. Navigate to forgot-password and submit ───
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '9.9.9.9' });
    await page.goto('/forgot-password');
    await page.fill('input#email', email);
    await page.getByRole('button', { name: /Send reset link/i }).click();

    // ─── 3. Verify success state ───
    await expect(page.getByText('Check your console').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /Back to sign in/i })).toBeVisible();

    // ─── 4. Get reset token from DB ───
    const token = await getLatestResetToken(email);
    if (!token) {
      throw new Error('No reset token found in database for ' + email);
    }

    // ─── 5. Navigate to reset-password with token ───
    await page.goto(`/reset-password?token=${token}`);
    await expect(page.getByRole('heading', { name: /Set new password/i })).toBeVisible({ timeout: 10000 });

    // ─── 6. Test form validation: password mismatch ───
    await page.fill('input#password', newPassword);
    await page.fill('input#confirmPassword', 'DifferentPass789!');
    await page.getByRole('button', { name: /Update password/i }).click();
    await expect(page.getByText('Passwords do not match').first()).toBeVisible({ timeout: 5000 });

    // ─── 7. Submit valid password ───
    await page.fill('input#password', newPassword);
    await page.fill('input#confirmPassword', newPassword);
    await page.getByRole('button', { name: /Update password/i }).click();

    // ─── 9. Verify success state ───
    await expect(page.getByText('Password reset successful').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();

    // ─── 10. Verify redirect to login ───
    await expect(page).toHaveURL(/.*\/login/, { timeout: 10000 });

    // ─── 11. Login with new password ───
    await page.fill('input#email', email);
    await page.fill('input#password', newPassword);
    await page.getByRole('button', { name: /Sign in/i }).click();
    await expect(page).toHaveURL(/.*\/candidate/, { timeout: 15000 });
    await expect(page.locator('text=Dashboard').or(page.locator('text=Welcome back')).first()).toBeVisible({ timeout: 15000 });
  });
});
