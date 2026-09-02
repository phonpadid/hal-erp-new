import pw from '/Users/haltech/Documents/erp-test/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core/index.js';
const { chromium } = pw;

const OUT = '/Users/haltech/Documents/erp-test/docs/screenshots';
const BASE = 'http://localhost:5173';
const USER = 'admin';
const PASS = 'HAL@1419';
const COMPANY_MATCH = 'ອາລຸນ'; // ຣຸ່ງອາລຸນຂົນສົ່ງດ່ວນ

const log = (...a) => console.log('•', ...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.setDefaultTimeout(20000);

async function shot(name) {
  await page.waitForTimeout(1200); // let animations / data settle
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log('shot', name);
}

async function goto(path, name) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(800);
  if (name) await shot(name);
}

async function openNewDialog(name) {
  // Click the first "+" (pi-plus) toolbar button to open the create dialog
  const btn = page.locator('button:has(.pi-plus)').first();
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(900);
    // dialog visible?
    if (await page.locator('.p-dialog').first().isVisible().catch(() => false)) {
      await shot(name);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
      return true;
    }
  }
  log('no dialog for', name);
  return false;
}

try {
  // 1. LOGIN
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.fill('#username', USER).catch(() => {});
  await page.fill('input[type="password"]', PASS).catch(() => {});
  await shot('00-login');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);

  // 2. SELECT COMPANY (if shown)
  if (page.url().includes('select-company')) {
    await shot('01-select-company');
    const btn = page.locator(`button:has-text("${COMPANY_MATCH}")`).first();
    if (await btn.count()) {
      await btn.click();
    } else {
      await page.locator('button').first().click(); // fallback: first company
    }
    await page.waitForTimeout(2500);
  }
  log('after login url =', page.url());

  // 2b. SWITCH COMPANY to ຣຸ່ງອາລຸນ (HAL) via topbar Select
  const companySelect = page.locator('.layout-config-menu .p-select, .layout-topbar-actions .p-select').first();
  if (await companySelect.count()) {
    await companySelect.click().catch(() => {});
    await page.waitForTimeout(700);
    const opt = page.locator(`.p-select-option:has-text("${COMPANY_MATCH}"), li:has-text("${COMPANY_MATCH}")`).first();
    if (await opt.count()) {
      await opt.click().catch(() => {});
      await page.waitForTimeout(3000); // full reload on switch
      log('switched company, url =', page.url());
    } else {
      log('company option not found, staying on current');
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  // 3. DASHBOARD
  await goto('/', '02-dashboard');

  // 4. CURRENCY
  await goto('/currency-admin', '10-currency-list');
  await openNewDialog('11-currency-new-dialog');

  // 5. CHART OF ACCOUNTS
  await goto('/accounts', '20-accounts-list');
  await openNewDialog('21-account-new-dialog');

  // 6. DEPARTMENTS
  await goto('/org-admin/departments', '30-departments-list');
  await openNewDialog('31-department-new-dialog');

  // 7. FISCAL YEARS
  await goto('/org-admin/fiscal-years', '40-fiscal-years-list');
  await openNewDialog('41-fiscal-year-new-dialog');

  // 8. BUDGET LIST + CREATE FORM
  await goto('/budgets', '50-budget-list');
  await goto('/budgets/new', '51-budget-new-form');

  log('DONE');
} catch (e) {
  console.error('ERROR:', e.message);
  await page.screenshot({ path: `${OUT}/_error.png` }).catch(() => {});
} finally {
  await browser.close();
}
