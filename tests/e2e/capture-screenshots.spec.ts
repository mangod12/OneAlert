import { test, type Page } from '@playwright/test';
import path from 'path';

const BASE_URL = 'https://cybersec-saas-498310931350.us-central1.run.app';
const SCREENSHOT_DIR = path.resolve(__dirname, '../../docs/screenshots');

async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/app/login`);
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await page.getByPlaceholder('you@company.com').fill('admin@example.com');
  await page.getByPlaceholder('Enter your password').fill('password123');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForFunction(() => !document.querySelector('input[placeholder="you@company.com"]'), { timeout: 20000 })
    .catch(() => page.waitForTimeout(5000));
  await page.waitForTimeout(2000);
}

test.describe('Capture Screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('dashboard', async ({ page }) => {
    await loginAsAdmin(page);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard.png'), fullPage: false });
  });

  test('cases', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /Cases/i }).first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cases.png'), fullPage: false });
  });

  test('case-detail', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /Cases/i }).first().click();
    await page.waitForTimeout(3000);
    // Click first case
    const caseCard = page.locator('[class*="cursor-pointer"], a[href*="cases/"]').first();
    if (await caseCard.isVisible({ timeout: 3000 })) {
      await caseCard.click();
      await page.waitForTimeout(3000);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'case-detail.png'), fullPage: false });
  });

  test('alerts', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: 'Alerts', exact: true }).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'alerts.png'), fullPage: false });
  });

  test('events', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: 'Events' }).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'events.png'), fullPage: false });
  });

  test('mitre-map', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /MITRE/i }).click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mitre-map.png'), fullPage: false });
  });

  test('hunt-lab', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: 'Hunt Lab' }).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'hunt-lab.png'), fullPage: false });
  });

  test('assets', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: 'Assets' }).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'assets.png'), fullPage: false });
  });
});
