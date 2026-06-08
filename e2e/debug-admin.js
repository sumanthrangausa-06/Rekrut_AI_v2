import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:3000/admin/login');
  
  const cookies = await context.cookies();
  console.log('Cookies:', cookies.map(c => ({ name: c.name, value: c.value.slice(0, 20) })));
  
  await browser.close();
}

test().catch(console.error);
