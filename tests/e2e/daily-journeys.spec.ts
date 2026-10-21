import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedWorkspace } from '../../apps/web/src/domain';
async function navigate(page: Page, name: string) {
  if (await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: false })
    .click();
}
test.beforeEach(async ({ page }) => {
  // UI journeys use an explicit account API fixture; live owner isolation is checked separately.
  let workspaces=[seedWorkspace('personal','personal'),seedWorkspace('business','business')];
  let revision=0;
  await page.addInitScript(()=>{
    sessionStorage.setItem('oidc.user:http://localhost:8180/realms/ledgerline:ledgerline-local',JSON.stringify({id_token:'fixture',access_token:'ui-fixture',token_type:'Bearer',scope:'openid profile email',profile:{sub:'ui-fixture-user',name:'UI fixture user',email:'fixture@example.com'},expires_at:Math.floor(Date.now()/1000)+3600}));
  });
  await page.route('**/api/v1/core/me/workbench',async route=>{
    if(route.request().method()==='PUT'){
      const command=route.request().postDataJSON();
      if(command.revision!==revision){await route.fulfill({status:409,json:{message:'Stale revision'}});return;}
      workspaces=command.workspaces;revision++;
    }
    await route.fulfill({json:{workspaces,revision,updatedAt:new Date().toISOString()}});
  });
  await page.route('**/api/v1/core/me/history',route=>route.fulfill({json:[]}));
  await page.route('**/api/v1/notifications/**',route=>route.fulfill({json:{preferences:{email:'fixture@example.com',enabled:false,leadDays:3,timezone:'Asia/Kolkata'},verified:false,emailMode:'local-inbox',syncedCount:3,inbox:[]}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'A clearer view of your money.'})).toBeVisible();
});

test('converter opens on any page and reports use the running finance services', async ({page}) => {
  await expect(page.getByRole('heading',{name:'Finance tools',exact:true})).toHaveCount(0);
  await navigate(page,'Currency converter');
  const dialog=page.getByRole('dialog',{name:'Currency converter'});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Amount',{exact:true}).fill('850');
  await dialog.getByRole('button',{name:'Convert amount',exact:true}).click();
  await expect(dialog.locator('.conversion-result strong')).toHaveText('10 USD');
  await expect(dialog.locator('.conversion-result')).toContainText('1 INR =');
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await navigate(page,'Reports');
  await page.getByRole('button',{name:'Generate report',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Category breakdown'})).toBeVisible();
  await expect(page.getByText('TOTAL SPENDING',{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  expect((await download).suggestedFilename()).toContain('ledgerline-report-');
  await navigate(page,'Currency converter');
  await expect(page.getByRole('dialog',{name:'Currency converter'})).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`artifacts/reports-${page.viewportSize()?.width}.png`,animations:'disabled'});
});

test('Account notification preferences have accessible controls',async({page})=>{
  await navigate(page,'Notifications');
  await expect(page.getByRole('button',{name:'Save preferences',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Pause reminders',exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('sidebar collapses, retains useful navigation, and orders system tools last', async ({ page }, info) => {
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close sidebar', exact: true })).toBeVisible();
    await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await page.screenshot({ path: 'artifacts/mobile-navigation.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Close sidebar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  } else {
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect(page.locator('.app')).toHaveClass(/navigation-collapsed/);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search activity' })).toBeVisible();
    await expect(page.locator('.sidebar')).toHaveCSS('width', '76px');
    await page.screenshot({ path: 'artifacts/desktop-navigation-collapsed.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Switch workspace' })).toBeVisible();
  }
  expect(await page.locator('.navigation-primary button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toContain('Notifications');
  expect(await page.locator('.navigation-utilities button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['Your account', 'Platform health']);
});

test('verification gateway timeout is readable and keeps the recipient form usable', async ({ page }) => {
  await page.route('**/api/v1/notifications/**/verification', route => route.fulfill({ status: 504, contentType: 'text/plain', body: 'upstream request timeout' }));
  await navigate(page, 'Notifications');
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByText(/Check your inbox before requesting another code/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send verification code', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Recipient email')).toHaveValue('fixture@example.com');
});

test('verification accepts a formatted pasted code and submits the saved recipient', async ({ page }) => {
  let submitted: unknown;
  await page.route('**/api/v1/notifications/**/verification/confirm', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { verified: true } });
  });
  await navigate(page, 'Notifications');
  await page.getByLabel('Verification code').fill('１２３ ４５６');
  await expect(page.getByLabel('Verification code')).toHaveValue('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByText('Email verified. Your saved reminder preference is now active.')).toBeVisible();
  expect(submitted).toEqual({ code: '123456', email: 'fixture@example.com' });
});

test('large activity lists paginate while search finds records across every page', async ({ page }) => {
  const workspace = seedWorkspace('personal', 'personal');
  workspace.transactions = Array.from({ length: 123 }, (_, index) => ({ ...workspace.transactions[0], id: `large-${index}`, merchant: `Merchant ${String(index).padStart(3, '0')}` }));
  await page.route('**/api/v1/core/me/workbench', route => route.fulfill({ json: { workspaces: [workspace, seedWorkspace('business', 'business')], revision: 0, updatedAt: new Date().toISOString() } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A clearer view of your money.' })).toBeVisible();
  await navigate(page, 'Activity');
  await expect(page.locator('.data-table tbody tr')).toHaveCount(50);
  await expect(page.getByText('1–50 of 123 records')).toBeVisible();
  await page.getByRole('button', { name: 'Next activity page' }).click();
  await expect(page.getByText('51–100 of 123 records')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search activity' }).fill('Merchant 122');
  await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
  await expect(page.getByRole('table').getByText('Merchant 122')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('Lucide controls are centered in both themes', async ({ page }) => {
  for (const dark of [false, true]) {
    if (dark) {
      if (await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible())
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('button', { name: 'Toggle theme' }).click();
      if (await page.getByRole('button', { name: 'Close navigation', exact: true }).isVisible())
        await page.getByRole('button', { name: 'Close navigation', exact: true }).press('Enter');
    }
    const offsets = await page.locator('.icon-button:visible').evaluateAll(buttons => buttons.map(button => {
      const icon = button.querySelector('svg');
      if (!icon) return 0;
      const b = button.getBoundingClientRect(); const i = icon.getBoundingClientRect();
      return Math.max(Math.abs(b.x + b.width/2 - i.x - i.width/2), Math.abs(b.y + b.height/2 - i.y - i.height/2));
    }));
    expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
  }
});
test('overview is useful at desktop and mobile sizes', async ({ page }, info) => {
  await expect(page.getByRole('heading', { name: 'A clearer view of your money.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upcoming payments' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    info.project.use.viewport!.width,
  );
  expect(await page.evaluate(() => window.innerWidth)).toBe(info.project.use.viewport!.width);
  await page.screenshot({ path: `artifacts/${info.project.name}-overview.png`, fullPage: true });
});
test('expense save persists after reload and filters search', async ({ page }) => {
  await navigate(page, 'Activity');
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Amount in INR' }).fill('123.45');
  await dialog.getByLabel('Merchant / description').fill('Daily workflow test');
  await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search activity' }).fill('Daily workflow test');
  await expect(page.getByRole('table').getByText('Daily workflow test')).toBeVisible();
  await page.reload();
  await page.getByRole('textbox', { name: 'Search activity' }).fill('Daily workflow test');
  await expect(page.getByRole('table').getByText('Daily workflow test')).toBeVisible();
});
test('payment records once and is linked', async ({ page }) => {
  await navigate(page, 'Bills');
  page.on('dialog', (dialog) => dialog.accept());
  const row = page.locator('.commitment-row').filter({ hasText: 'Apartment rent' });
  await row.getByRole('button', { name: 'Record paid' }).click();
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await expect(row.getByText('Paid', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Record paid' })).toHaveCount(1); // next unpaid cycle
  await expect(row.getByText('Paid', {exact:true})).toHaveCount(1);
  await navigate(page, 'Activity');
  await page.getByRole('textbox', { name: 'Search activity' }).fill('Apartment rent');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText('Linked payment', { exact: true })).toBeVisible();
});
test('workspaces are isolated', async ({ page }) => {
  await navigate(page, 'Activity');
  if (await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('combobox', {name: 'Switch workspace'}).click();
  await page.getByRole('option', {name: 'Studio workspace',exact:true}).click();
  if (await page.getByRole('button', { name: 'Close navigation', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(page.getByRole('table').getByText('AWS cloud services')).toBeVisible();
  await expect(page.getByRole('table').getByText('Freshmart', { exact: true })).toHaveCount(0);
});
test('same-account transfer is rejected without corrupting data', async ({ page }) => {
  await navigate(page, 'Activity');
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Amount in INR' }).fill('500');
  await dialog.getByRole('combobox',{name:'To account',exact:true}).click();
  await page.getByRole('option',{name:'Main account',exact:true}).click();
  await dialog.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Choose two different accounts for a transfer.',
  );
});
test('keyboard and reduced-motion entry remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await navigate(page, 'Activity');
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add entry', exact: true })).toBeFocused();
});
test('overview and entry pass automated accessibility checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.page-content')).toHaveCSS('opacity', '1');
  const overview = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(overview.violations).toEqual([]);
  await navigate(page, 'Activity');
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  const entry = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(entry.violations).toEqual([]);
});


test('overall budget persists separately from category limits and dropdowns work in dialogs',async({page})=>{
  await navigate(page,'Budget plan');
  await page.getByRole('button',{name:'Add budget',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Amount in INR'}).fill('10000');
  await dialog.getByRole('button',{name:'Save budget',exact:true}).click();
  await expect(page.locator('.overall-budget-card').getByText('Your monthly spending plan',{exact:true})).toBeVisible();
  await expect(page.locator('.page-content .panel')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `artifacts/${test.info().project.name}-budget-plan.png`, fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.locator('.overall-budget-card').getByText('Your monthly spending plan',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Category limits',exact:true}).click();
  await expect(page.locator('.budget-row').getByText('Groceries',{exact:true})).toBeVisible();
  await navigate(page,'Activity');
  await page.getByRole('button',{name:'Add entry',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Account',exact:true}).click();
  await page.getByRole('option',{name:'Cash',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'Account',exact:true})).toContainText('Cash');
  await dialog.getByRole('combobox',{name:'Category',exact:true}).click();
  await page.getByRole('option',{name:'Transport',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:'Category',exact:true})).toContainText('Transport');
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});
