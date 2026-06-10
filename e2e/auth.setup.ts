// Auth setup: purely API-based. No browser contexts are spawned here,
// which avoids the major memory spike that caused SIGKILL in CI.
//
// Note: The suite runners (run-e2e-sequential.js / run-e2e-suite.sh) delete
// auth files before every run, so tokens are always fresh.
import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Load env vars from .env so ADMIN_PASSWORD is available in setup
const dotenvPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const CANDIDATE_EMAIL = 'e2e-candidate@rekrutai.test';
const RECRUITER_EMAIL = 'e2e-recruiter@rekrutai.test';
const PASSWORD = 'TestPass123!';

function decodeJWT(token: string): any | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    // base64url → base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = 4 - (base64.length % 4);
    const padded = base64 + '='.repeat(padding === 4 ? 0 : padding);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function cleanupStaleAuthFiles(): void {
  const dir = 'e2e/.auth';
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.json')) {
      const path = `${dir}/${file}`;
      if (!isAuthValid(path)) {
        fs.unlinkSync(path);
      }
    }
  }
}

function isAuthValid(path: string): boolean {
  if (!fs.existsSync(path)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
    // Check for JWT token in localStorage
    const origin = data.origins?.find((o: any) => {
      const token = o.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
      return !!token;
    });
    const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
    if (token) {
      const decoded = decodeJWT(token);
      if (decoded && decoded.exp) {
        return Date.now() < decoded.exp * 1000;
      }
    }
    // Check for admin session cookies (no JWT, just session cookies)
    if (data.cookies && data.cookies.some((c: any) => c.name === 'connect.sid')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function getCsrfToken(request: any): Promise<string> {
  const csrfRes = await request.get('/csrf-token');
  if (!csrfRes.ok()) {
    const text = await csrfRes.text().catch(() => '');
    throw new Error(`Failed to fetch CSRF token: ${csrfRes.status()} ${text}`);
  }
  const data = await csrfRes.json();
  if (!data.csrfToken) {
    throw new Error('CSRF token missing from response');
  }
  return data.csrfToken;
}

async function getOrCreateUser(
  request: any,
  email: string,
  role: 'candidate' | 'recruiter',
  name: string,
  companyName?: string,
  maxRetries = 3
) {
  let lastError: Error | null = null;

  const csrfToken = await getCsrfToken(request);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.floor(1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
      await new Promise((r) => setTimeout(r, delay));
    }

    const loginRes = await request.post('/api/auth/login', {
      data: { email, password: PASSWORD },
      headers: { 'X-CSRF-Token': csrfToken },
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

    const regRes = await request.post('/api/auth/register', {
      data: body,
      headers: { 'X-CSRF-Token': csrfToken },
    });
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
  fs.writeFileSync(path, JSON.stringify(storageState, null, 2));
}

setup('cleanup stale auth files', async () => {
  cleanupStaleAuthFiles();
});

setup('authenticate candidate', async ({ request }) => {
  const path = 'e2e/.auth/candidate.json';
  if (isAuthValid(path)) {
    setup.skip(true, 'Candidate auth state is valid');
    return;
  }
  if (fs.existsSync(path)) fs.unlinkSync(path);
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
  if (isAuthValid(path)) {
    setup.skip(true, 'Recruiter auth state is valid');
    return;
  }
  if (fs.existsSync(path)) fs.unlinkSync(path);
  const { token, refreshToken } = await getOrCreateUser(
    request,
    RECRUITER_EMAIL,
    'recruiter',
    'E2E Recruiter',
    'E2E Test Co'
  );
  writeStorageState(token, refreshToken, path);
});

async function getAdminSession(request: any, path: string): Promise<void> {
  const csrfToken = await getCsrfToken(request);
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || '';

  if (!password) {
    throw new Error('ADMIN_PASSWORD environment variable is required for admin setup');
  }

  const loginRes = await request.post('/api/admin/login', {
    data: { username, password },
    headers: { 'X-CSRF-Token': csrfToken },
  });

  if (!loginRes.ok()) {
    const text = await loginRes.text().catch(() => '');
    throw new Error(`Admin login failed: ${loginRes.status()} ${text}`);
  }

  // Save session cookies from request context
  const storageState = await request.storageState();
  fs.writeFileSync(path, JSON.stringify(storageState, null, 2));
}

setup('authenticate admin', async ({ request }) => {
  const path = 'e2e/.auth/admin.json';
  if (isAuthValid(path)) {
    setup.skip(true, 'Admin auth state is valid');
    return;
  }
  if (fs.existsSync(path)) fs.unlinkSync(path);
  await getAdminSession(request, path);
});
