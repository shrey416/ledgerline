import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100}});
page.on('pageerror',e=>console.log('Browser error:',e.message));
page.on('response',async response=>{if(response.status()>=400)console.log('HTTP',response.status(),new URL(response.url()).pathname,(await response.text()).slice(0,200));});
await page.goto('http://localhost:5601/app/dashboards#/view/ledgerline-logs',{waitUntil:'domcontentloaded'});
try{await page.getByText('Loading results',{exact:true}).waitFor({state:'visible',timeout:30000});await page.getByText('Loading results',{exact:true}).waitFor({state:'hidden',timeout:90000});}catch{}
await page.waitForTimeout(15000);
await page.screenshot({path:'artifacts/runtime-kibana.png',fullPage:true});
console.log((await page.locator('body').innerText()).slice(-1400));
await browser.close();
