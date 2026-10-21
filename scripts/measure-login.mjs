// Local development fixture only. Never prints tokens, passwords, or URL queries.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  const requests = new Map();
  page.on('request',r=>requests.set(r,performance.now()));
  page.on('requestfinished',r=>{const ms=performance.now()-requests.get(r);if(ms>1000)console.log(`Slow request: ${new URL(r.url()).pathname} ${Math.round(ms)} ms`);requests.delete(r);});
  const path = process.argv[2] || '/';
  await page.goto('http://localhost:30080' + path);
  const login = performance.now();
  if(path==='/') await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.locator('#username').waitFor();
  console.log(`Sign-in form visible: ${Math.round(performance.now()-login)} ms`);
  await page.locator('#username').fill('notification-check');
  await page.locator('#password').fill('local-check-only');
  const workbench = performance.now();
  await page.locator('#kc-login').click();
  await page.getByRole('heading',{name:'A clearer view of your money.'}).waitFor();
  console.log(`Authenticated workbench visible: ${Math.round(performance.now()-workbench)} ms`);
} finally {await browser.close();}
