import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  const requests = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[error] ${err.message}`));
  page.on('requestfailed', req => {
    requests.push(`[FAIL] ${req.url()} - ${req.failure()?.errorText}`);
  });
  page.on('requestfinished', async req => {
    const resp = await req.response();
    if (!resp) return;
    const status = resp.status();
    if (status >= 400) {
      requests.push(`[${status}] ${req.url()}`);
    }
  });

  await page.goto('https://rekrutai-staging.onrender.com/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  const bodyText = await page.evaluate(() => document.body.innerText);

  console.log('=== Body Text ===');
  console.log(bodyText.substring(0, 1000));
  console.log('=== Failed Requests ===');
  requests.forEach(l => console.log(l));
  console.log('=== Console Logs ===');
  logs.forEach(l => console.log(l));

  await browser.close();
})();
