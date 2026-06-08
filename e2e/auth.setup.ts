// Auth setup: purely API-based. No browser contexts are spawned here,
// which avoids the major memory spike that caused SIGKILL in CI.
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
      continue;
    }

    if (loginRes.status() !== 404) {
      const text = await loginRes.text().catch(() => '');
      throw new Error(`Login failed for ${email}: ${loginRes.status()} ${text}`);
    }

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
      continue;
    }

    const text = await regRes.text().catch(() => '');
    throw new Error(`Failed to register ${email}: ${regRes.status()} ${text}`);
  }

  throw lastError || new Error(`Failed to getOrCreateUser for ${email} after ${maxRetries} retries`);
}

function writeStorageState(token: string, refreshToken: string, path: string) {
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
  fs.writeFileSync(path, JSON.stringify(storageState, null, 2));
}

setup('authenticate candidate', async ({ request }) => {
  const path = 'e2e/.auth/candidate.json';
  if (fs.existsSync(path)) {
    setup.skip(true, 'Candidate auth state already exists');
    return;
  }
  const { token, refreshToken } = await getOrCreateUser(
    request,
    CANDIDATE_EMAIL,
    'candidate',
    'E2E Candidate'
  );
  writeStorageState(token, refreshToken, path);
});

setup('authenticate recruiter', async ({ request }) => {
  const path = 'e2e/.auth/recruiter.json';
  if (fs.existsSync(path)) {
    setup.skip(true, 'Recruiter auth state already exists');
    return;
  }
  const { token, refreshToken } = await getOrCreateUser(
    request,
    RECRUITER_EMAIL,
    'recruiter',
    'E2E Recruiter',
    'E2E Test Co'
  );
  writeStorageState(token, refreshToken, path);
});
