# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.setup.ts >> authenticate admin
- Location: e2e/auth.setup.ts:148:6

# Error details

```
Error: Login failed for e2e-admin-qa@rekrutai.test: 401 {"error":"Invalid credentials"}
```

# Test source

```ts
  1   | // Auth setup: purely API-based. No browser contexts are spawned here,
  2   | // which avoids the major memory spike that caused SIGKILL in CI.
  3   | //
  4   | // Note: The suite runners (run-e2e-sequential.js / run-e2e-suite.sh) delete
  5   | // auth files before every run, so tokens are always fresh.
  6   | import { test as setup, expect } from '@playwright/test';
  7   | import * as fs from 'fs';
  8   | 
  9   | const CANDIDATE_EMAIL = 'e2e-candidate@rekrutai.test';
  10  | const RECRUITER_EMAIL = 'e2e-recruiter@rekrutai.test';
  11  | const PASSWORD = 'TestPass123!';
  12  | 
  13  | function isAuthValid(path: string): boolean {
  14  |   if (!fs.existsSync(path)) return false;
  15  |   try {
  16  |     const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
  17  |     const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000');
  18  |     const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  19  |     return !!token;
  20  |   } catch {
  21  |     return false;
  22  |   }
  23  | }
  24  | 
  25  | async function getOrCreateUser(
  26  |   request: any,
  27  |   email: string,
  28  |   role: 'candidate' | 'recruiter',
  29  |   name: string,
  30  |   companyName?: string,
  31  |   maxRetries = 3
  32  | ) {
  33  |   let lastError: Error | null = null;
  34  | 
  35  |   for (let attempt = 0; attempt <= maxRetries; attempt++) {
  36  |     if (attempt > 0) {
  37  |       const delay = Math.floor(1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
  38  |       await new Promise((r) => setTimeout(r, delay));
  39  |     }
  40  | 
  41  |     const loginRes = await request.post('/api/auth/login', {
  42  |       data: { email, password: PASSWORD },
  43  |     });
  44  | 
  45  |     if (loginRes.ok()) {
  46  |       const data = await loginRes.json();
  47  |       return {
  48  |         token: data.token || data.accessToken,
  49  |         refreshToken: data.refreshToken,
  50  |       };
  51  |     }
  52  | 
  53  |     if (loginRes.status() === 429) {
  54  |       const text = await loginRes.text().catch(() => '');
  55  |       try {
  56  |         const parsed = JSON.parse(text);
  57  |         const retryAfter = parsed.retryAfter ? parsed.retryAfter * 1000 : undefined;
  58  |         if (retryAfter && attempt < maxRetries) {
  59  |           await new Promise((r) => setTimeout(r, retryAfter + 500));
  60  |           continue;
  61  |         }
  62  |       } catch {}
  63  |       lastError = new Error(`Rate limited: ${text}`);
  64  |       continue;
  65  |     }
  66  | 
  67  |     if (loginRes.status() !== 404) {
  68  |       const text = await loginRes.text().catch(() => '');
> 69  |       throw new Error(`Login failed for ${email}: ${loginRes.status()} ${text}`);
      |             ^ Error: Login failed for e2e-admin-qa@rekrutai.test: 401 {"error":"Invalid credentials"}
  70  |     }
  71  | 
  72  |     const body: any = { name, email, password: PASSWORD, role };
  73  |     if (companyName) body.company_name = companyName;
  74  | 
  75  |     const regRes = await request.post('/api/auth/register', { data: body });
  76  |     if (regRes.ok()) {
  77  |       const data = await regRes.json();
  78  |       return {
  79  |         token: data.token || data.accessToken,
  80  |         refreshToken: data.refreshToken,
  81  |       };
  82  |     }
  83  | 
  84  |     if (regRes.status() === 429) {
  85  |       const text = await regRes.text().catch(() => '');
  86  |       lastError = new Error(`Rate limited during registration: ${text}`);
  87  |       continue;
  88  |     }
  89  | 
  90  |     const text = await regRes.text().catch(() => '');
  91  |     throw new Error(`Failed to register ${email}: ${regRes.status()} ${text}`);
  92  |   }
  93  | 
  94  |   throw lastError || new Error(`Failed to getOrCreateUser for ${email} after ${maxRetries} retries`);
  95  | }
  96  | 
  97  | function writeStorageState(token: string, refreshToken: string, path: string) {
  98  |   const storageState = {
  99  |     cookies: [] as any[],
  100 |     origins: [
  101 |       {
  102 |         origin: 'http://localhost:3000',
  103 |         localStorage: [
  104 |           { name: 'rekrutai_token', value: token },
  105 |           { name: 'rekrutai_refresh', value: refreshToken },
  106 |           { name: 'token', value: token },
  107 |           { name: 'refresh_token', value: refreshToken },
  108 |         ],
  109 |       },
  110 |     ],
  111 |   };
  112 |   fs.writeFileSync(path, JSON.stringify(storageState, null, 2));
  113 | }
  114 | 
  115 | setup('authenticate candidate', async ({ request }) => {
  116 |   const path = 'e2e/.auth/candidate.json';
  117 |   if (isAuthValid(path)) {
  118 |     setup.skip(true, 'Candidate auth state is valid');
  119 |     return;
  120 |   }
  121 |   if (fs.existsSync(path)) fs.unlinkSync(path);
  122 |   const { token, refreshToken } = await getOrCreateUser(
  123 |     request,
  124 |     CANDIDATE_EMAIL,
  125 |     'candidate',
  126 |     'E2E Candidate'
  127 |   );
  128 |   writeStorageState(token, refreshToken, path);
  129 | });
  130 | 
  131 | setup('authenticate recruiter', async ({ request }) => {
  132 |   const path = 'e2e/.auth/recruiter.json';
  133 |   if (isAuthValid(path)) {
  134 |     setup.skip(true, 'Recruiter auth state is valid');
  135 |     return;
  136 |   }
  137 |   if (fs.existsSync(path)) fs.unlinkSync(path);
  138 |   const { token, refreshToken } = await getOrCreateUser(
  139 |     request,
  140 |     RECRUITER_EMAIL,
  141 |     'recruiter',
  142 |     'E2E Recruiter',
  143 |     'E2E Test Co'
  144 |   );
  145 |   writeStorageState(token, refreshToken, path);
  146 | });
  147 | 
  148 | setup('authenticate admin', async ({ request }) => {
  149 |   const path = 'e2e/.auth/admin.json';
  150 |   if (isAuthValid(path)) {
  151 |     setup.skip(true, 'Admin auth state is valid');
  152 |     return;
  153 |   }
  154 |   if (fs.existsSync(path)) fs.unlinkSync(path);
  155 |   const { token, refreshToken } = await getOrCreateUser(
  156 |     request,
  157 |     'e2e-admin-qa@rekrutai.test',
  158 |     'recruiter',
  159 |     'E2E Admin',
  160 |     'E2E Admin Co'
  161 |   );
  162 |   writeStorageState(token, refreshToken, path);
  163 | });
  164 | 
```