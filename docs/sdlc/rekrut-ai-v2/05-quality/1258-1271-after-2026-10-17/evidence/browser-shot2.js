// Follow-up captures: Mutual Matches tab + Company Matches after Continue
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
  await page.locator('input[type="email"], input[name="email"]').first().fill(MM.email);
  await page.locator('input[type="password"]').first().fill(MM.pw);
  await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await page.waitForTimeout(4000);
  out.afterLoginUrl = page.url();

  await page.goto('http://localhost:3000/candidate/omniscore', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(3000);
  await page.locator('button:has-text("Mutual Matches"), [role="tab"]:has-text("Mutual Matches")').first().click().catch(e => { out.tabClickError = e.message; });
  await page.waitForTimeout(4000);
  const t1 = await page.evaluate(() => document.body.innerText);
  out.mutualTab = { url: page.url(), hasInsufficientData: t1.includes('Insufficient data'), has50Match: t1.includes('50% match'), excerpt: t1.slice(t1.indexOf('Mutual'), t1.indexOf('Mutual') + 900) };
  await page.screenshot({ path: DIR + '/screenshots/06-mutual-matches-tab.png', fullPage: true });

  await page.goto('http://localhost:3000/candidate/company-matches', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(3000);
  await page.locator('button:has-text("Continue")').first().click().catch(e => { out.continueError = e.message; });
  await page.waitForTimeout(6000);
  const t2 = await page.evaluate(() => document.body.innerText);
  out.companyMatchesAfterContinue = { url: page.url(), hasNA: t2.includes('N/A'), hasInsufficientData: t2.includes('Insufficient data'), has50pct: /50%/.test(t2), excerpt: t2.slice(0, 1500) };
  await page.screenshot({ path: DIR + '/screenshots/07-company-matches-after-continue.png', fullPage: true });

  await ctx.close(); await browser.close();
  fs.writeFileSync(DIR + '/evidence/browser-result-v2.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('BROWSER ERR', e.message); process.exit(1); });
