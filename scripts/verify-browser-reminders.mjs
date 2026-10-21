import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
try {
  await page.goto('http://localhost:30080/#notifications');
  await page.getByRole('button',{name:'Sign in to connect reminders'}).click();
  await page.locator('#username').waitFor({timeout:60000});
  await page.locator('#username').fill('demo');
  await page.getByLabel('Password',{exact:true}).fill('local-demo-only');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.getByRole('button',{name:'Disconnect',exact:true}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Save preferences',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.notification-form button')?.disabled);
  await page.getByText(/^[1-9]\d* commitments synced/).waitFor({timeout:60000});
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/runtime-notifications.png',fullPage:true});
  console.log('VERIFIED browser authorization-code/PKCE sign-in and authenticated notification preferences.');
}catch(error){
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/reminder-browser-error.png',fullPage:true});
  console.log('Sign-in page:',new URL(page.url()).pathname,(await page.locator('body').innerText()).slice(0,700));throw error;
}finally{await browser.close();}
