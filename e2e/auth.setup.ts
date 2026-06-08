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
  companyName?: string
) {
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

  // If rate-limited, propagate the error so we can handle it upstream
  if (loginRes.status() === 429) {
    const text = await loginRes.text().catch(() => '');
    throw new Error(`Rate limited: ${text}`);
  }

  // Register new user
  const body: any = { name, email, password: PASSWORD, role };
  if (companyName) body.company_name = companyName;

  const regRes = await request.post('/api/auth/register', { data: body });
  if (!regRes.ok()) {
    const text = await regRes.text().catch(() => '');
    throw new Error(`Failed to register ${email}: ${regRes.status()} ${text}`);
  }

  const data = await regRes.json();
  return {
    token: data.token || data.accessToken,
    refreshToken: data.refreshToken,
  };
}

async function saveAuthState(
  browser: any,
  token: string,
  refreshToken: string,
  path: string,
  role: 'candidate' | 'recruiter'
) {
  const storageState = {
    cookies: [],
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
}

async function verifyExistingAuth(browser: any, path: string, role: 'candidate' | 'recruiter') {
  if (!fs.existsSync(path)) return false;

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
