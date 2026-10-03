import { Page, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Decodes a JWT token to extract its payload (no signature verification).
 */
function decodeJWT(token: string): any | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = 4 - (base64.length % 4);
    const padded = base64 + '='.repeat(padding === 4 ? 0 : padding);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Writes a Playwright storageState file with the given tokens.
 */
function writeStorageState(token: string, refreshToken: string, filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const baseURL = process.env.BASE_URL || 'http://localhost:3000';
  const storageState = {
    cookies: [] as any[],
    origins: [
      {
        origin: baseURL,
        localStorage: [
          { name: 'rekrutai_token', value: token },
          { name: 'rekrutai_refresh', value: refreshToken },
          { name: 'token', value: token },
          { name: 'refresh_token', value: refreshToken },
        ],
      },
    ],
  };
  fs.writeFileSync(filePath, JSON.stringify(storageState, null, 2));
}

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

// ───────────────────────────────────────────────
// Auth helpers — resilient to expired storageState
// ───────────────────────────────────────────────

const PASSWORD = 'TestPass123!';

interface AuthCredentials {
  email: string;
  password: string;
  role: 'candidate' | 'recruiter';
}

/**
 * Logs in via API and injects tokens into page localStorage.
 * Use this when storageState tokens may be expired.
 */
export async function apiLogin(
  page: Page,
  request: APIRequestContext,
  storagePath: string,
  creds: AuthCredentials
): Promise<void> {
  // Try login first
  const loginRes = await request.post('/api/auth/login', {
    data: { email: creds.email, password: creds.password },
    headers: { 'Content-Type': 'application/json' },
  });

  let token: string | undefined;
  let refreshToken: string | undefined;

  if (loginRes.ok()) {
    const data = await loginRes.json();
    token = data.token || data.accessToken;
    refreshToken = data.refreshToken;
  } else if (loginRes.status() === 401) {
    // User doesn't exist — register
    const regBody: any = {
      name: creds.email.split('@')[0],
      email: creds.email,
      password: creds.password,
      role: creds.role,
    };
    if (creds.role === 'recruiter') regBody.company_name = 'E2E Test Co';

    const regRes = await request.post('/api/auth/register', {
      data: regBody,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!regRes.ok()) {
      const text = await regRes.text().catch(() => '');
      throw new Error(`Auth setup failed for ${creds.email}: ${regRes.status()} ${text}`);
    }
    const data = await regRes.json();
    token = data.token || data.accessToken;
    refreshToken = data.refreshToken;
  } else {
    const text = await loginRes.text().catch(() => '');
    throw new Error(`Login failed for ${creds.email}: ${loginRes.status()} ${text}`);
  }

  if (!token) {
    throw new Error(`No token received for ${creds.email}`);
  }

  // Persist refreshed tokens to storageState so later tests reuse them
  writeStorageState(token, refreshToken || '', storagePath);

  // Inject tokens into page localStorage
  await page.goto('/');
  await page.evaluate(
    ({ t, rt }) => {
      localStorage.setItem('rekrutai_token', t);
      localStorage.setItem('rekrutai_refresh', rt || '');
      localStorage.setItem('token', t);
      localStorage.setItem('refresh_token', rt || '');
    },
    { t: token, rt: refreshToken || '' }
  );
}

/**
 * Pre-seed auth tokens into page localStorage from a storageState file.
 * Falls back to API login if file is missing, invalid, or token expired.
 */
export async function ensureAuth(
  page: Page,
  request: APIRequestContext,
  storagePath: string,
  creds: AuthCredentials
): Promise<void> {
  // Check if storageState file exists and has a valid, non-expired token
  if (fs.existsSync(storagePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
      const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
      if (token) {
        const decoded = decodeJWT(token);
        // Reject expired tokens immediately so we don't waste time navigating
        if (decoded?.exp && Date.now() < decoded.exp * 1000) {
          // Token still valid — inject into page
          await page.goto('/');
          await page.evaluate(
            ({ t, rt }) => {
              localStorage.setItem('rekrutai_token', t);
              localStorage.setItem('rekrutai_refresh', rt || '');
              localStorage.setItem('token', t);
              localStorage.setItem('refresh_token', rt || '');
            },
            {
              t: token,
              rt: origin?.localStorage?.find((item: any) => item.name === 'rekrutai_refresh')?.value || '',
            }
          );
          // Verify auth works by navigating to dashboard
          await page.goto(creds.role === 'recruiter' ? '/recruiter' : '/candidate');
          await page.waitForTimeout(800);
          const url = page.url();
          if (!url.includes('/login')) {
            return; // Auth works!
          }
        }
      }
    } catch {
      // Fall through to API login
    }
  }

  // Storage state invalid or expired — use API login
  await apiLogin(page, request, storagePath, creds);
}
