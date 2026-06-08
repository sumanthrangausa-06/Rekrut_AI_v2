import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';

const CANDIDATE_EMAIL = 'e2e-candidate@rekrutai.test';
const RECRUITER_EMAIL = 'e2e-recruiter@rekrutai.test';
const PASSWORD = 'TestPass123!';

async function getOrCreateUser(
  request: any,
  email: string,
  role: 'candidate' | 'recruiter',
  name: string,
  companyName?: string,
  maxRetries = 3
) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter: 1s, 2s, 4s
      const delay = Math.floor(1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
      await new Promise((r) => setTimeout(r, delay));
    }

    const loginRes = await request.post('/api/auth/login', {
      data: { email, password: PASSWORD },
    });

    if (loginRes.ok()) {
      const data = await loginRes.json();
      return {
        token: data.token || data.accessToken,
        refreshToken: data.refreshToken,
      };
    }

    // If rate-limited, retry with backoff
    if (loginRes.status() === 429) {
      const text = await loginRes.text().catch(() => '');
      try {
        const parsed = JSON.parse(text);
        const retryAfter = parsed.retryAfter ? parsed.retryAfter * 1000 : undefined;
        if (retryAfter && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, retryAfter + 500));
          continue;
        }
      } catch {}
      lastError = new Error(`Rate limited: ${text}`);
      continue; // retry on next iteration
    }

    // If not found (404), attempt registration
    if (loginRes.status() !== 404) {
      const text = await loginRes.text().catch(() => '');
      throw new Error(`Login failed for ${email}: ${loginRes.status()} ${text}`);
    }

    // Register new user
    const body: any = { name, email, password: PASSWORD, role };
    if (companyName) body.company_name = companyName;

    const regRes = await request.post('/api/auth/register', { data: body });
    if (regRes.ok()) {
      const data = await regRes.json();
      return {
        token: data.token || data.accessToken,
        refreshToken: data.refreshToken,
      };
    }

    if (regRes.status() === 429) {
      const text = await regRes.text().catch(() => '');
      lastError = new Error(`Rate limited during registration: ${text}`);
      continue; // retry on next iteration
    }

    const text = await regRes.text().catch(() => '');
    throw new Error(`Failed to register ${email}: ${regRes.status()} ${text}`);
  }

  throw lastError || new Error(`Failed to getOrCreateUser for ${email} after ${maxRetries} retries`);
}

async function saveAuthState(
  browser: any,
  token: string,
  refreshToken: string,
  path: string,
  role: 'candidate' | 'recruiter'
) {
  const storageState = {
    cookies: [] as any[],
    origins: [
      {
        origin: 'http://localhost:3000',
        localStorage: [
          { name: 'rekrutai_token', value: token },
          { name: 'rekrutai_refresh', value: refreshToken },
          { name: 'token', value: token },
          { name: 'refresh_token', value: refreshToken },
        ],
      },
    ],
  };

  try {
    const context = await browser.newContext({ storageState });
    try {
      const page = await context.newPage();

      const dashboardPath = role === 'recruiter' ? '/recruiter' : '/candidate';
      await page.goto(dashboardPath);

      await expect(page).toHaveURL(new RegExp(`.*${dashboardPath}`));
      await page.waitForLoadState('networkidle');

      await page.context().storageState({ path });
    } finally {
      await context.close().catch(() => {});
    }
  } catch {
    // Fallback: write storage state directly without browser validation
    // (browser may be under memory pressure in CI)
    fs.writeFileSync(path, JSON.stringify(storageState, null, 2));
  }
}

async function verifyExistingAuth(browser: any, path: string, role: 'candidate' | 'recruiter') {
  if (!fs.existsSync(path)) return false;

  try {
    const context = await browser.newContext({ storageState: path });
    try {
      const page = await context.newPage();
      const dashboardPath = role === 'recruiter' ? '/recruiter' : '/candidate';
      await page.goto(dashboardPath);
      await page.waitForLoadState('networkidle');
      // Give React time to run the auth check and redirect if needed
      await page.waitForTimeout(500);
      const url = page.url();
      return url.includes(dashboardPath);
    } finally {
      await context.close().catch(() => {});
    }
  } catch {
    return false;
  }
}

setup('authenticate candidate', async ({ request, browser }) => {
  const path = 'e2e/.auth/candidate.json';
  if (await verifyExistingAuth(browser, path, 'candidate')) {
    setup.skip(true, 'Candidate auth state already valid');
    return;
  }

  const { token, refreshToken } = await getOrCreateUser(
    request,
    CANDIDATE_EMAIL,
    'candidate',
    'E2E Candidate'
  );
  await saveAuthState(
    browser,
    token,
    refreshToken,
    path,
    'candidate'
  );
});

setup('authenticate recruiter', async ({ request, browser }) => {
  const path = 'e2e/.auth/recruiter.json';
  if (await verifyExistingAuth(browser, path, 'recruiter')) {
    setup.skip(true, 'Recruiter auth state already valid');
    return;
  }

  const { token, refreshToken } = await getOrCreateUser(
    request,
    RECRUITER_EMAIL,
    'recruiter',
    'E2E Recruiter',
    'E2E Test Co'
  );
  await saveAuthState(
    browser,
    token,
    refreshToken,
    path,
    'recruiter'
  );
});
