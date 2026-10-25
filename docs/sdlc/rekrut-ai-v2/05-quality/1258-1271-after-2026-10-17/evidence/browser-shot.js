// QUINN batched AFTER #1258+#1271 — Playwright captures, desktop 1440x900, http://localhost:3000 @4be9bb02
// Login via UI as seeded candidate (exercises the #1258 login payload in the real client),
// then candidate omniscore page (mutual matches section, #1271a) and company-matches page (#1271b).
const fs = require('fs');
const DIR = '/home/hatch/workspace/goals/launch-rekrut-ai-v2-by-january/hidden_files/1258-1271-after-run';
const REPO = DIR + '/repo';
const MM = { email: 'quinn-1271-mm@example.com', pw: 'Quinn1271-Mm-Pw!' };

(async () => {
  const pw = require(REPO + '/node_modules/playwright');
  const browser = await pw.chromium.launch();
  const out = {};
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: DIR + '/screenshots/01-login-page.png', fullPage: true });
  out.loginPage = { url: page.url(), textHasLogin: /log in|sign in/i.test(await page.evaluate(() => document.body.innerText)) };

  // Fill login form
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const pwInput = page.locator('input[type="password"]').first();
  await emailInput.fill(MM.email);
  await pwInput.fill(MM.pw);
  await page.screenshot({ path: DIR + '/screenshots/02-login-filled.png', fullPage: true });
  await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await page.waitForTimeout(5000);
  out.afterLogin = { url: page.url() };
  const storedUser = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const hits = {};
    for (const k of keys) { try { const v = localStorage.getItem(k); if (v && v.includes('company_id')) hits[k] = v.slice(0, 400); } catch {} }
    return { keys, hits };
  });
  out.storedUser = storedUser;
  await page.screenshot({ path: DIR + '/screenshots/03-after-login.png', fullPage: true });

  // Candidate omniscore page (mutual matches UI)
  await page.goto('http://localhost:3000/candidate/omniscore', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(4000);
  const omniText = await page.evaluate(() => document.body.innerText);
  out.omniscorePage = { url: page.url(), hasInsufficientData: omniText.includes('Insufficient data'), has50Match: omniText.includes('50% match'), excerpt: omniText.slice(0, 1200) };
  await page.screenshot({ path: DIR + '/screenshots/04-omniscore-mutual.png', fullPage: true });

  // Company matches page
  await page.goto('http://localhost:3000/candidate/company-matches', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(4000);
  const cmText = await page.evaluate(() => document.body.innerText);
  out.companyMatchesPage = { url: page.url(), hasNA: cmText.includes('N/A'), hasInsufficientData: cmText.includes('Insufficient data'), has50pct: /50%/.test(cmText), excerpt: cmText.slice(0, 1200) };
  await page.screenshot({ path: DIR + '/screenshots/05-company-matches.png', fullPage: true });

  await ctx.close();
  await browser.close();
  fs.writeFileSync(DIR + '/evidence/browser-result.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('BROWSER ERR', e.message); process.exit(1); });
