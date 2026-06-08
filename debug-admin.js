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

  await page.goto('https://rekrutai-staging.onrender.com/admin/login', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('=== Body Text ===');
  console.log(bodyText.substring(0, 1000));
  console.log('=== Body HTML ===');
  console.log(await page.evaluate(() => document.body.innerHTML.substring(0, 1000)));

  await browser.close();
})();
