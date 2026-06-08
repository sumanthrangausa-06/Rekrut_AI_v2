# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.setup.ts >> authenticate admin
- Location: e2e/auth.setup.ts:152:6

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
  17  |     const origin = data.origins?.find((o: any) => {
  18  |       const token = o.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  19  |       return !!token;
  20  |     });
  21  |     const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value;
  22  |     return !!token;
  23  |   } catch {
  24  |     return false;
  25  |   }
  26  | }
  27  | 
  28  | async function getOrCreateUser(
  29  |   request: any,
  30  |   email: string,
  31  |   role: 'candidate' | 'recruiter',
  32  |   name: string,
  33  |   companyName?: string,
  34  |   maxRetries = 3
  35  | ) {
  36  |   let lastError: Error | null = null;
  37  | 
  38  |   for (let attempt = 0; attempt <= maxRetries; attempt++) {
  39  |     if (attempt > 0) {
  40  |       const delay = Math.floor(1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
  41  |       await new Promise((r) => setTimeout(r, delay));
  42  |     }
  43  | 
  44  |     const loginRes = await request.post('/api/auth/login', {
  45  |       data: { email, password: PASSWORD },
  46  |     });
  47  | 
  48  |     if (loginRes.ok()) {
  49  |       const data = await loginRes.json();
  50  |       return {
  51  |         token: data.token || data.accessToken,
  52  |         refreshToken: data.refreshToken,
  53  |       };
  54  |     }
  55  | 
  56  |     if (loginRes.status() === 429) {
  57  |       const text = await loginRes.text().catch(() => '');
  58  |       try {
  59  |         const parsed = JSON.parse(text);
  60  |         const retryAfter = parsed.retryAfter ? parsed.retryAfter * 1000 : undefined;
  61  |         if (retryAfter && attempt < maxRetries) {
  62  |           await new Promise((r) => setTimeout(r, retryAfter + 500));
  63  |           continue;
  64  |         }
  65  |       } catch {}
  66  |       lastError = new Error(`Rate limited: ${text}`);
  67  |       continue;
  68  |     }
  69  | 
  70  |     if (loginRes.status() !== 404) {
  71  |       const text = await loginRes.text().catch(() => '');
> 72  |       throw new Error(`Login failed for ${email}: ${loginRes.status()} ${text}`);
      |             ^ Error: Login failed for e2e-admin-qa@rekrutai.test: 401 {"error":"Invalid credentials"}
  73  |     }
  74  | 
  75  |     const body: any = { name, email, password: PASSWORD, role };
  76  |     if (companyName) body.company_name = companyName;
  77  | 
  78  |     const regRes = await request.post('/api/auth/register', { data: body });
  79  |     if (regRes.ok()) {
  80  |       const data = await regRes.json();
  81  |       return {
  82  |         token: data.token || data.accessToken,
  83  |         refreshToken: data.refreshToken,
  84  |       };
  85  |     }
  86  | 
  87  |     if (regRes.status() === 429) {
  88  |       const text = await regRes.text().catch(() => '');
  89  |       lastError = new Error(`Rate limited during registration: ${text}`);
  90  |       continue;
  91  |     }
  92  | 
  93  |     const text = await regRes.text().catch(() => '');
  94  |     throw new Error(`Failed to register ${email}: ${regRes.status()} ${text}`);
  95  |   }
  96  | 
  97  |   throw lastError || new Error(`Failed to getOrCreateUser for ${email} after ${maxRetries} retries`);
  98  | }
  99  | 
  100 | function writeStorageState(token: string, refreshToken: string, path: string) {
  101 |   const baseURL = process.env.BASE_URL || 'http://localhost:3000';
  102 |   const storageState = {
  103 |     cookies: [] as any[],
  104 |     origins: [
  105 |       {
  106 |         origin: baseURL,
  107 |         localStorage: [
  108 |           { name: 'rekrutai_token', value: token },
  109 |           { name: 'rekrutai_refresh', value: refreshToken },
  110 |           { name: 'token', value: token },
  111 |           { name: 'refresh_token', value: refreshToken },
  112 |         ],
  113 |       },
  114 |     ],
  115 |   };
  116 |   fs.writeFileSync(path, JSON.stringify(storageState, null, 2));
  117 | }
  118 | 
  119 | setup('authenticate candidate', async ({ request }) => {
  120 |   const path = 'e2e/.auth/candidate.json';
  121 |   if (isAuthValid(path)) {
  122 |     setup.skip(true, 'Candidate auth state is valid');
  123 |     return;
  124 |   }
  125 |   if (fs.existsSync(path)) fs.unlinkSync(path);
  126 |   const { token, refreshToken } = await getOrCreateUser(
  127 |     request,
  128 |     CANDIDATE_EMAIL,
  129 |     'candidate',
  130 |     'E2E Candidate'
  131 |   );
  132 |   writeStorageState(token, refreshToken, path);
  133 | });
  134 | 
  135 | setup('authenticate recruiter', async ({ request }) => {
  136 |   const path = 'e2e/.auth/recruiter.json';
  137 |   if (isAuthValid(path)) {
  138 |     setup.skip(true, 'Recruiter auth state is valid');
  139 |     return;
  140 |   }
  141 |   if (fs.existsSync(path)) fs.unlinkSync(path);
  142 |   const { token, refreshToken } = await getOrCreateUser(
  143 |     request,
  144 |     RECRUITER_EMAIL,
  145 |     'recruiter',
  146 |     'E2E Recruiter',
  147 |     'E2E Test Co'
  148 |   );
  149 |   writeStorageState(token, refreshToken, path);
  150 | });
  151 | 
  152 | setup('authenticate admin', async ({ request }) => {
  153 |   const path = 'e2e/.auth/admin.json';
  154 |   if (isAuthValid(path)) {
  155 |     setup.skip(true, 'Admin auth state is valid');
  156 |     return;
  157 |   }
  158 |   if (fs.existsSync(path)) fs.unlinkSync(path);
  159 |   const { token, refreshToken } = await getOrCreateUser(
  160 |     request,
  161 |     'e2e-admin-qa@rekrutai.test',
  162 |     'recruiter',
  163 |     'E2E Admin',
  164 |     'E2E Admin Co'
  165 |   );
  166 |   writeStorageState(token, refreshToken, path);
  167 | });
  168 | 
```