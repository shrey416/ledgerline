import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100}});
for(const [name,url,text] of [
  ['platform','http://localhost:30080/#platform','Live service health'],
  ['grafana','http://localhost:3000/d/ledgerline-overview','Healthy application scrape targets'],
  ['kibana','http://localhost:5601/app/dashboards#/view/ledgerline-logs','Ledgerline / Application logs'],
  ['kubernetes','http://localhost:3000/d/ledgerline-kubernetes','Ready application pod containers'],
]) {
  const errors=[];
  const listener=error=>errors.push(error.message);
  page.on('pageerror',listener);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByText(text,{exact:false}).first().waitFor({timeout:60000});
  if(name==='platform')await page.getByText('Ready',{exact:true}).nth(4).waitFor({timeout:30000});
  await page.waitForTimeout(name==='platform'?1000:8000);
  await page.screenshot({path:`artifacts/runtime-${name}.png`,fullPage:true});
  console.log(`${name}: rendered; browser exceptions=${errors.length}`);
  if(errors.length)console.log(errors.slice(0,3));
  page.off('pageerror',listener);
}
await browser.close();
